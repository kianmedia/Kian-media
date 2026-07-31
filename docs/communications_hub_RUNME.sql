-- ════════════════════════════════════════════════════════════════════════════
-- COMMUNICATIONS HUB — RUNME (idempotent · transactional · additive)
--
-- WHAT THIS IS
--   One event model, one outbox, one state machine, over the notification
--   machinery that already exists. It COMPOSES; it does not replace:
--     • public.notifications          stays the portal inbox
--     • public.email_deliveries       stays the legacy email queue — READ ONLY
--                                     from here, via an adapter. Never written.
--     • notification_resolve_recipients stays the recipient authority WHEN
--                                     PRESENT (feature-detected at runtime)
--   No second resolver, no second provider, no second cron.
--
-- ⛔ NOTHING SENDS. Every channel is seeded dry_run = true. email and whatsapp
--   are seeded DISABLED. The provider layer in TypeScript is a mock. A row may
--   only reach status 'sent' with dry_run = false if the caller passes a
--   positive provider acknowledgment — comms_settle refuses otherwise. That
--   refusal is the SQL-level version of the lesson that HTTP 200 is not
--   delivery (lib/server/projectNotify.ts:96-100).
--
-- TWO HARD SAFETY RULES, ENFORCED SERVER-SIDE, TWICE
--   R1  A client never receives an internal notification.
--   R2  No internal or financial content reaches a client.
--   Enforced (a) in comms_enqueue when recipients are filtered, and (b) again
--   in a BEFORE INSERT/UPDATE trigger on comms_outbox, which recomputes
--   "is this recipient external" from the database instead of trusting the
--   caller. (b) holds even against a direct service_role INSERT.
--
-- NULL DISCIPLINE
--   Every predicate here returns an explicit boolean and can never return NULL.
--   comms_is_external() fails CLOSED: an unknown user is treated as external,
--   so an internal message is never delivered to somebody we cannot identify.
--
-- ⚠️ SELF-TESTS ARE STATIC. The SQL editor runs as postgres with auth.uid()
--   NULL, so calling a protected RPC here would raise "not authorized" and kill
--   the migration. Everything below §90 asserts catalogue state and function
--   bodies via pg_get_functiondef + ilike. Nothing is wrapped in a catch-all.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- §0  42P13 GUARD — an existing comms_* function with a different return type
--     cannot be replaced. Fail LOUDLY and early rather than half-way through.
-- ════════════════════════════════════════════════════════════════════════════
do $g0$
declare r record;
begin
  for r in
    select p.proname as fname,
           pg_get_function_identity_arguments(p.oid) as args,
           pg_get_function_result(p.oid) as ret
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in
      ('comms_is_external','comms_is_staff','comms_can_view','comms_can_admin',
       'comms_channel_enabled','comms_channel_dry_run','comms_body_has_restricted_content',
       'comms_rate_check','comms_render')
  loop
    if r.ret <> 'boolean' and r.fname <> 'comms_render' then
      raise exception 'HUB 42P13: public.%(%) already returns % — drop it before running this file', r.fname, r.args, r.ret;
    end if;
    if r.fname = 'comms_render' and r.ret <> 'text' then
      raise exception 'HUB 42P13: public.comms_render(%) already returns % — drop it first', r.args, r.ret;
    end if;
  end loop;
end $g0$;

-- ════════════════════════════════════════════════════════════════════════════
-- §1  PREDICATES — the hub's OWN. Deliberately NOT can_manage_projects():
--     communications authority is not project authority, and gating on the
--     project platform's predicate would couple this module to a frozen system.
-- ════════════════════════════════════════════════════════════════════════════

-- Is this user OUTSIDE Kian? Fails closed: unknown ⇒ external ⇒ never gets
-- internal content. NEVER returns NULL.
create or replace function public.comms_is_external(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select (p.account_type is distinct from 'admin') and p.staff_role is null
       from public.profiles p where p.id = p_user),
    true);
$$;

-- Is the CURRENT session an active Kian staff member? NEVER NULL.
create or replace function public.comms_is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.account_status = 'active'
                     and (p.account_type = 'admin' or p.staff_role is not null)
                   from public.profiles p where p.id = auth.uid()), false);
$$;

-- May read the communications dashboard (read-only tier). NEVER NULL.
create or replace function public.comms_can_view()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.account_status = 'active'
                     and (p.account_type = 'admin'
                          or p.staff_role in ('super_admin','manager','support','readonly','finance'))
                   from public.profiles p where p.id = auth.uid()), false);
$$;

-- May retry, cancel, change a channel flag, publish a template. NEVER NULL.
create or replace function public.comms_can_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.account_status = 'active'
                     and (p.account_type = 'admin' or p.staff_role in ('super_admin','manager'))
                   from public.profiles p where p.id = auth.uid()), false);
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- §2  TABLES
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 2.1 Channels + per-channel feature flag ────────────────────────────────
create table if not exists public.comms_channels (
  channel     text primary key check (channel in ('portal','email','whatsapp')),
  enabled     boolean not null default false,
  dry_run     boolean not null default true,
  label_ar    text not null default '',
  label_en    text not null default '',
  note        text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

-- ─── 2.2 Event catalogue — a CLOSED vocabulary. No free-text events. ────────
-- audience: 'internal' (never a client) | 'client' | 'both' (client recipients
-- get the client-scoped template; staff get the internal one).
create table if not exists public.comms_event_catalog (
  event_key        text primary key,
  category         text not null,
  audience         text not null default 'internal' check (audience in ('internal','client','both')),
  is_financial     boolean not null default false,
  mandatory        boolean not null default false,   -- preferences may not suppress it
  channels         text[] not null default array['portal','email'],
  rate_limit_hour  int not null default 200,
  label_ar         text not null default '',
  label_en         text not null default '',
  active           boolean not null default true,
  created_at       timestamptz not null default now()
);

-- ─── 2.3 Templates — VERSIONED and immutable once published ─────────────────
create table if not exists public.comms_templates (
  id             uuid primary key default gen_random_uuid(),
  event_key      text not null references public.comms_event_catalog(event_key) on delete cascade,
  locale         text not null check (locale in ('ar','en')),
  audience_scope text not null default 'internal' check (audience_scope in ('internal','client')),
  version        int  not null default 1,
  subject_tpl    text not null,
  body_tpl       text not null,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  created_by     uuid,
  unique (event_key, locale, audience_scope, version)
);
create unique index if not exists uq_comms_tpl_active
  on public.comms_templates(event_key, locale, audience_scope) where is_active;

-- ─── 2.4 THE OUTBOX — one row per (event, recipient, channel) ───────────────
create table if not exists public.comms_outbox (
  id                    uuid primary key default gen_random_uuid(),
  correlation_id        uuid not null,
  idempotency_key       text,
  event_key             text not null,
  category              text not null,
  channel               text not null check (channel in ('portal','email','whatsapp')),
  audience_scope        text not null check (audience_scope in ('internal','client')),
  recipient_user_id     uuid,
  recipient_address     text,
  recipient_role        text,
  recipient_is_external boolean not null default true,
  locale                text not null default 'ar' check (locale in ('ar','en')),
  template_id           uuid,
  template_version      int,
  subject               text not null,
  body                  text not null,
  action_url            text,
  status                text not null default 'queued'
                        check (status in ('queued','processing','sent','delivered',
                                          'failed','retrying','dead_letter','cancelled')),
  dry_run               boolean not null default true,
  attempts              int not null default 0,
  max_attempts          int not null default 5,
  next_attempt_at       timestamptz,
  lease_until           timestamptz,
  provider              text,
  provider_message_id   text,
  provider_response     jsonb not null default '{}'::jsonb,
  last_error            text,
  error_class           text,
  entity_type           text,
  entity_id             uuid,
  project_id            uuid,
  actor_id              uuid,
  legacy_delivery_id    uuid,          -- adapter link to email_deliveries (read-only mirror)
  -- ── PROVENANCE — DATA, NOT A MAGIC STRING ─────────────────────────────────
  -- "Is this row a real send?" used to be inferred from provider =
  -- 'legacy_email_deliveries', a free-text column any writer could set to
  -- anything. One typo there silently promoted a mirrored row to a live send —
  -- the forged success this module exists to prevent. Provenance is now
  -- explicit, constrained, cross-checked (§2.4b) and re-derived on every write
  -- by the guard trigger (§4), so no caller can lie about it.
  -- The CHECKs for these four are NAMED and added in §2.4b, not inline, so that
  -- a fresh install and a re-run over an existing table end in the identical
  -- catalogue state and the POSTCHECK can assert on stable constraint names.
  source_kind           text not null default 'native',
  is_legacy_mirror      boolean not null default false,
  -- The honest NAME of dry_run. It is not an independent fact: a CHECK in §2.4b
  -- ties it to dry_run so the two can never drift into two sources of truth.
  delivery_mode         text not null default 'dry_run',
  -- What the PROVIDER actually told us. Only 'accepted' and 'delivered' are
  -- evidence; everything else is an absence of evidence and never counts live.
  provider_state        text not null default 'none',
  meta                  jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  claimed_at            timestamptz,
  sent_at               timestamptz,
  delivered_at          timestamptz,
  cancelled_at          timestamptz,
  cancelled_by          uuid,
  cancel_reason         text
);
create unique index if not exists uq_comms_outbox_idem
  on public.comms_outbox(idempotency_key) where idempotency_key is not null;
create index if not exists ix_comms_outbox_runnable
  on public.comms_outbox(status, next_attempt_at) where status in ('queued','retrying');
create index if not exists ix_comms_outbox_corr    on public.comms_outbox(correlation_id);
create index if not exists ix_comms_outbox_created on public.comms_outbox(created_at desc);
create index if not exists ix_comms_outbox_event   on public.comms_outbox(event_key, created_at desc);
create unique index if not exists uq_comms_outbox_legacy
  on public.comms_outbox(legacy_delivery_id) where legacy_delivery_id is not null;
create index if not exists ix_comms_outbox_provenance
  on public.comms_outbox(source_kind, delivery_mode, provider_state);

-- ─── 2.4b PROVENANCE: retro-fit, backfill, and CONSTRAIN ────────────────────
-- The columns above only exist for a table this file creates. If comms_outbox
-- already exists from an earlier run they must be added, backfilled from what
-- is already known, and only THEN constrained — a CHECK added before the
-- backfill would fail validation on legitimate historical rows.
alter table public.comms_outbox add column if not exists source_kind      text;
alter table public.comms_outbox add column if not exists is_legacy_mirror boolean;
alter table public.comms_outbox add column if not exists delivery_mode    text;
alter table public.comms_outbox add column if not exists provider_state   text;

-- BACKFILL. Conservative on purpose: evidence is granted only where evidence
-- actually exists. A row that merely CLAIMS 'sent' gets 'attempted', not
-- 'accepted' — inventing evidence during a migration would be the same lie in
-- a different place.
-- PROMOTE ONLY, never demote — the same one-way OR the guard trigger uses. If a
-- row already declares itself a mirror, this backfill will not un-declare it on
-- the strength of a missing tag: demoting a mirror is precisely how it would
-- become countable as a live send, which is the failure being repaired here.
update public.comms_outbox set
  is_legacy_mirror = coalesce(is_legacy_mirror, false)
                     or legacy_delivery_id is not null
                     or coalesce(provider,'') = 'legacy_email_deliveries'
                     or coalesce(source_kind,'') = 'legacy_mirror'
where is_legacy_mirror is null
   or (not is_legacy_mirror
       and (legacy_delivery_id is not null
            or coalesce(provider,'') = 'legacy_email_deliveries'
            or coalesce(source_kind,'') = 'legacy_mirror'));

update public.comms_outbox set
  source_kind = case when is_legacy_mirror then 'legacy_mirror' else 'native' end
where source_kind is null or (source_kind = 'legacy_mirror') <> is_legacy_mirror;

update public.comms_outbox set
  delivery_mode = case when dry_run then 'dry_run' else 'live' end
where delivery_mode is null or (delivery_mode = 'dry_run') <> dry_run;

update public.comms_outbox set
  provider_state = case
    -- A mirror carries somebody else's outcome. This hub has no provider
    -- evidence for it and never will; 'unavailable' says exactly that.
    when is_legacy_mirror                                     then 'unavailable'
    when dry_run                                              then 'none'
    when coalesce(last_error,'') like '%relay_handler_missing%'
      or coalesce(error_class,'') like '%relay_handler_missing%'             then 'relay_handler_missing'
    when status = 'delivered'
     and lower(coalesce(provider_response->>'delivered','')) in ('true','t','1')
                                                              then 'delivered'
    when status in ('sent','delivered')
     and lower(coalesce(provider_response->>'ack','')) in ('true','t','1')   then 'accepted'
    when status in ('sent','delivered')                       then 'attempted'
    when coalesce(error_class,'') = 'channel'                 then 'unavailable'
    when status in ('failed','retrying','dead_letter')        then 'attempted'
    else 'none' end
where provider_state is null;

do $prov_constrain$
declare c text;
begin
  alter table public.comms_outbox alter column source_kind      set default 'native';
  alter table public.comms_outbox alter column is_legacy_mirror set default false;
  alter table public.comms_outbox alter column delivery_mode    set default 'dry_run';
  alter table public.comms_outbox alter column provider_state   set default 'none';
  alter table public.comms_outbox alter column source_kind      set not null;
  alter table public.comms_outbox alter column is_legacy_mirror set not null;
  alter table public.comms_outbox alter column delivery_mode    set not null;
  alter table public.comms_outbox alter column provider_state   set not null;

  -- Idempotent CHECKs. A CHECK, not only a trigger: triggers can be disabled
  -- (`alter table ... disable trigger`) and do not fire on COPY without
  -- `FREEZE`; a CHECK constrains every writer including service_role.
  for c in select unnest(array[
    -- closed vocabularies (repeated here for a table created by an earlier run)
    $c$comms_outbox_source_kind_ck|source_kind in ('native','legacy_mirror','imported')$c$,
    $c$comms_outbox_delivery_mode_ck|delivery_mode in ('live','dry_run')$c$,
    $c$comms_outbox_provider_state_ck|provider_state in ('none','attempted','accepted','delivered','unavailable','relay_handler_missing')$c$,
    -- provenance may not contradict itself: one typo in source_kind can no
    -- longer desynchronise it from the boolean the counters read.
    $c$comms_outbox_provenance_consistent_ck|(source_kind = 'legacy_mirror') = is_legacy_mirror$c$,
    -- delivery_mode is the NAME of dry_run, never a second opinion about it.
    $c$comms_outbox_delivery_mode_matches_dry_run_ck|(delivery_mode = 'dry_run') = dry_run$c$,
    -- ★ COMMS R0 ★ A legacy mirror can NEVER be stored carrying provider
    -- evidence, so the state "mirrored row that counts as a live send" is not
    -- merely uncounted — it is unrepresentable. This is the database-level
    -- version of the rule the whole module exists for.
    $c$comms_outbox_mirror_never_live_ck|not (is_legacy_mirror and provider_state in ('accepted','delivered'))$c$
  ]) loop
    if not exists (select 1 from pg_constraint
                    where conrelid = 'public.comms_outbox'::regclass
                      and conname = split_part(c, '|', 1)) then
      execute format('alter table public.comms_outbox add constraint %I check (%s)',
                     split_part(c, '|', 1), split_part(c, '|', 2));
    end if;
  end loop;
end $prov_constrain$;

-- ─── 2.5 Preference centre — per user, per CATEGORY, per channel ────────────
create table if not exists public.comms_preferences (
  user_id     uuid not null,
  category    text not null,
  portal      boolean not null default true,
  email       boolean not null default true,
  whatsapp    boolean not null default false,
  locale      text not null default 'ar' check (locale in ('ar','en')),
  updated_at  timestamptz not null default now(),
  primary key (user_id, category)
);

-- ─── 2.6 Rate limiting — a SHARED store, unlike the per-instance memory one ─
create table if not exists public.comms_rate_counters (
  bucket_key   text primary key,
  window_start timestamptz not null default now(),
  hits         int not null default 0
);

-- ─── 2.7 Audit — who retried, cancelled, flipped a flag, published a template
create table if not exists public.comms_audit (
  id          bigint generated always as identity primary key,
  actor_id    uuid,
  action      text not null,
  target_type text,
  target_id   text,
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists ix_comms_audit_time on public.comms_audit(created_at desc);

-- ════════════════════════════════════════════════════════════════════════════
-- §3  SEEDS — additive and idempotent. Channels ship SAFE.
-- ════════════════════════════════════════════════════════════════════════════
insert into public.comms_channels(channel, enabled, dry_run, label_ar, label_en, note) values
  ('portal',   true,  true, 'إشعارات البوابة', 'Portal inbox', 'in-app only; still dry_run until the owner flips it'),
  ('email',    false, true, 'البريد الإلكتروني', 'Email',      'DISABLED: the Apps Script portal_notify handler is not deployed'),
  ('whatsapp', false, true, 'واتساب (لاحقًا)',   'WhatsApp (placeholder)', 'placeholder only — no provider is wired')
on conflict (channel) do nothing;

insert into public.comms_event_catalog(event_key, category, audience, is_financial, mandatory, channels, label_ar, label_en) values
  ('project.status_changed',        'projects',  'both',     false, true,  array['portal','email'], 'تغيّر حالة مشروع',        'Project status changed'),
  ('project.delivery_recorded',     'projects',  'both',     false, true,  array['portal','email'], 'تسجيل تسليم',              'Delivery recorded'),
  ('project.member_assigned',       'projects',  'internal', false, true,  array['portal','email'], 'تكليف عضو فريق',           'Member assigned'),
  -- Assignment notes used to be mailed by the BROWSER no-cors relay
  -- (docs/NOTIFICATIONS_CURRENT_STATE_AUDIT.md §5, path D5). That path is gone;
  -- the server adapter /api/comms/legacy-notify maps it here, so the event must
  -- exist in the catalogue or the adapter answers UNKNOWN_EVENT and records
  -- nothing. Internal only: a note to a staff member is never client-facing.
  ('project.assignment_note',       'projects',  'internal', false, false, array['portal','email'], 'ملاحظة على تكليف',         'Assignment note'),
  ('deliverable.preview_sent',      'delivery',  'both',     false, true,  array['portal','email'], 'إرسال معاينة للعميل',      'Preview sent'),
  ('deliverable.final_ready',       'delivery',  'both',     false, true,  array['portal','email'], 'النسخة النهائية جاهزة',    'Final ready'),
  ('deliverable.client_commented',  'delivery',  'internal', false, true,  array['portal','email'], 'تعليق من العميل',          'Client commented'),
  ('deliverable.download_recorded', 'delivery',  'internal', false, false, array['portal','email'], 'تسجيل تنزيل',              'Download recorded'),
  ('task.overdue',                  'tasks',     'internal', false, false, array['portal','email'], 'مهمّة متأخّرة',            'Task overdue'),
  ('risk.critical_raised',          'governance','internal', false, true,  array['portal','email'], 'مخاطرة حرجة',              'Critical risk raised'),
  ('issue.critical_raised',         'governance','internal', false, true,  array['portal','email'], 'مشكلة حرجة',               'Critical issue raised'),
  ('custody.assigned',              'custody',   'internal', false, false, array['portal','email'], 'تسليم عهدة',               'Custody assigned'),
  ('custody.overdue',               'custody',   'internal', false, true,  array['portal','email'], 'تأخّر إرجاع عهدة',         'Custody overdue'),
  ('rental.request_created',        'rental',    'both',     false, false, array['portal','email'], 'طلب تأجير جديد',           'Rental request created'),
  ('rental.charges_pending',        'rental',    'internal', true,  true,  array['portal','email'], 'رسوم تأجير معلّقة',        'Rental charges pending'),
  ('finance.invoice_issued',        'finance',   'internal', true,  true,  array['portal','email'], 'إصدار فاتورة',             'Invoice issued'),
  ('hr.task_assigned',              'hr',        'internal', false, false, array['portal','email'], 'تكليف مهمّة موظف',         'HR task assigned'),
  ('comms.self_test',               'system',    'internal', false, false, array['portal','email'], 'اختبار قناة',              'Channel self-test')
on conflict (event_key) do nothing;

-- Templates: Arabic + English, internal + client scope. `{{token}}` substitution.
-- The CLIENT-scoped bodies deliberately carry no amounts, no internal ids and no
-- correlation id — that is rule R2 expressed as content, not just as a check.
do $seed_tpl$
declare r record;
begin
  for r in select event_key, label_ar, label_en, audience from public.comms_event_catalog loop
    -- internal / ar
    insert into public.comms_templates(event_key, locale, audience_scope, version, subject_tpl, body_tpl)
    values (r.event_key, 'ar', 'internal', 1,
            r.label_ar || ' — كيان',
            r.label_ar || E'\n\nالمشروع: {{project_name}}\nالعنصر: {{entity_label}}\nبواسطة: {{actor_name}}\nالتفاصيل: {{details}}\n\nافتح البوابة: {{action_url}}')
    on conflict (event_key, locale, audience_scope, version) do nothing;
    -- internal / en
    insert into public.comms_templates(event_key, locale, audience_scope, version, subject_tpl, body_tpl)
    values (r.event_key, 'en', 'internal', 1,
            r.label_en || ' — Kian',
            r.label_en || E'\n\nProject: {{project_name}}\nItem: {{entity_label}}\nBy: {{actor_name}}\nDetails: {{details}}\n\nOpen the portal: {{action_url}}')
    on conflict (event_key, locale, audience_scope, version) do nothing;
    if r.audience in ('client','both') then
      insert into public.comms_templates(event_key, locale, audience_scope, version, subject_tpl, body_tpl)
      values (r.event_key, 'ar', 'client', 1,
              r.label_ar || ' — كيان',
              E'مرحبًا،\n\n' || r.label_ar || E' في مشروعكم «{{project_name}}».\n\nيمكنكم متابعة التفاصيل من بوابة العملاء: {{action_url}}\n\nفريق كيان')
      on conflict (event_key, locale, audience_scope, version) do nothing;
      insert into public.comms_templates(event_key, locale, audience_scope, version, subject_tpl, body_tpl)
      values (r.event_key, 'en', 'client', 1,
              r.label_en || ' — Kian',
              E'Hello,\n\n' || r.label_en || E' on your project "{{project_name}}".\n\nYou can follow the details in the client portal: {{action_url}}\n\nThe Kian team')
      on conflict (event_key, locale, audience_scope, version) do nothing;
    end if;
  end loop;
end $seed_tpl$;

-- ════════════════════════════════════════════════════════════════════════════
-- §4  SAFETY — rules R1 and R2, in the database, on every write path
-- ════════════════════════════════════════════════════════════════════════════

-- High-confidence markers only. This is a backstop against a careless caller,
-- not a censor: it must not block ordinary client mail, so it looks for things
-- that have no business in a client message at all. NEVER returns NULL.
create or replace function public.comms_body_has_restricted_content(p_text text)
returns boolean language sql immutable set search_path = public as $$
  select coalesce(
    lower(coalesce(p_text, '')) ~
      '(iban|swift code|profit margin|gross margin|cost price|supplier price|markup|internal only|do not forward|service[_ ]role|correlation_id)'
    or coalesce(p_text, '') ~
      '(الآيبان|رقم الحساب البنكي|هامش الربح|سعر التكلفة|التكلفة الداخلية|سعر المورد|عمولة داخلية|داخلي فقط|للاستخدام الداخلي)',
    false);
$$;

-- The guard. Recomputes externality from the DATABASE rather than trusting the
-- inserted value, so a direct service_role INSERT cannot lie its way past R1.
create or replace function public.comms_outbox_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- ── PROVENANCE IS RE-DERIVED, NEVER TRUSTED ──────────────────────────────
  -- Same principle as recipient_is_external below: the caller states it, the
  -- database decides it. A row linked to email_deliveries, or tagged with the
  -- legacy provider string, or declaring itself a legacy_mirror, IS a mirror —
  -- whichever of the three the writer happened to set.
  new.is_legacy_mirror := coalesce(new.is_legacy_mirror, false)
                          or new.legacy_delivery_id is not null
                          or coalesce(new.provider,'') = 'legacy_email_deliveries'
                          or coalesce(new.source_kind,'') = 'legacy_mirror';
  if new.is_legacy_mirror then
    new.source_kind := 'legacy_mirror';
  elsif coalesce(new.source_kind,'') not in ('native','imported') then
    new.source_kind := 'native';
  end if;
  -- delivery_mode is the NAME of dry_run, so it is computed from dry_run and
  -- never read from the caller: two writable copies of one fact is how a
  -- simulation gets reported as a send.
  new.delivery_mode  := case when new.dry_run then 'dry_run' else 'live' end;
  new.provider_state := coalesce(new.provider_state, 'none');

  -- ★ RULE R0 ★ A legacy mirror may never carry provider evidence, and evidence
  -- is the only thing that makes a row count as a live send. The CHECK
  -- constraint comms_outbox_mirror_never_live_ck enforces the same rule against
  -- writers that bypass triggers; this arm names it in the error message.
  if new.is_legacy_mirror and new.provider_state in ('accepted','delivered') then
    raise exception 'COMMS R0: a mirrored legacy row can never be stored as a live successful send (event=%, provider_state=%)',
      new.event_key, new.provider_state using errcode = 'check_violation';
  end if;

  if new.recipient_user_id is not null then
    new.recipient_is_external := public.comms_is_external(new.recipient_user_id);
  else
    -- No user id ⇒ we cannot prove who this is ⇒ external (fail closed).
    new.recipient_is_external := coalesce(new.recipient_is_external, true);
  end if;

  -- R1: a client never receives an internal notification.
  if new.audience_scope = 'internal' and new.recipient_is_external then
    raise exception 'COMMS R1: internal notification refused for an external recipient (event=%, channel=%)',
      new.event_key, new.channel using errcode = 'check_violation';
  end if;

  -- R2: no internal or financial content reaches a client.
  if new.recipient_is_external
     and public.comms_body_has_restricted_content(coalesce(new.subject,'') || ' ' || coalesce(new.body,'')) then
    raise exception 'COMMS R2: restricted content refused for an external recipient (event=%)',
      new.event_key using errcode = 'check_violation';
  end if;

  return new;
end $$;

drop trigger if exists t_comms_outbox_guard on public.comms_outbox;
-- No `update of <columns>` list: the guard now also derives provenance, which
-- changes when status / provider / dry_run / provider_state are written by
-- comms_settle. A column list would have let a settle slip past the derivation
-- and leave provenance stale — a stale mirror flag is exactly the failure this
-- module exists to prevent, so the guard runs on every write.
create trigger t_comms_outbox_guard
  before insert or update on public.comms_outbox
  for each row execute function public.comms_outbox_guard();

-- ════════════════════════════════════════════════════════════════════════════
-- §5  RATE LIMIT — a real shared counter (fixed window). NEVER returns NULL.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.comms_rate_check(p_key text, p_limit int, p_window_secs int)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_hits int;
begin
  if p_key is null or p_limit is null or p_limit <= 0 then return false; end if;
  -- NOTE the unqualified `comms_rate_counters.` prefix: inside ON CONFLICT DO
  -- UPDATE the existing row is referenced by the TABLE NAME, not schema-qualified.
  -- Both SET expressions read the OLD row, so the window test is consistent
  -- between them even though one of them is rewriting window_start.
  insert into public.comms_rate_counters(bucket_key, window_start, hits)
  values (p_key, now(), 1)
  on conflict (bucket_key) do update
    set window_start = case when comms_rate_counters.window_start
                                 < now() - make_interval(secs => greatest(p_window_secs, 1))
                            then now() else comms_rate_counters.window_start end,
        hits         = case when comms_rate_counters.window_start
                                 < now() - make_interval(secs => greatest(p_window_secs, 1))
                            then 1 else comms_rate_counters.hits + 1 end
  returning comms_rate_counters.hits into v_hits;
  return coalesce(v_hits, 1) <= p_limit;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §6  AUDIT WRITER — internal; never fails the caller.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.comms_audit_write(
  p_action text, p_target_type text, p_target_id text, p_meta jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.comms_audit(actor_id, action, target_type, target_id, meta)
  values (auth.uid(), p_action, p_target_type, p_target_id, coalesce(p_meta, '{}'::jsonb));
exception when others then
  return;   -- audit must never abort a business action
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §7  RENDERING + RECIPIENTS + ENQUEUE
-- ════════════════════════════════════════════════════════════════════════════

-- {{token}} substitution. Unicode-safe (plain text replace, no regex classes).
create or replace function public.comms_render(p_tpl text, p_vars jsonb)
returns text language plpgsql immutable set search_path = public as $$
declare v_out text := coalesce(p_tpl, ''); k text; v text;
begin
  if p_vars is null or jsonb_typeof(p_vars) <> 'object' then return v_out; end if;
  for k, v in select key, coalesce(value #>> '{}', '') from jsonb_each(p_vars) loop
    v_out := replace(v_out, '{{' || k || '}}', v);
  end loop;
  -- Any token the caller did not supply becomes empty rather than leaking "{{x}}".
  v_out := regexp_replace(v_out, '\{\{[a-z0-9_]+\}\}', '', 'gi');
  return v_out;
end $$;

-- Recipient resolution. Uses the CANONICAL resolver when it is deployed; falls
-- back to base tables when it is not, so the hub degrades instead of dying.
-- Dynamic EXECUTE deliberately: the canonical resolver may be absent.
create or replace function public.comms_resolve(
  p_event text, p_entity_type text, p_entity_id uuid, p_project uuid,
  p_actor uuid, p_payload jsonb default '{}'::jsonb)
returns table(user_id uuid, email text, role text, reason text, action_url text)
language plpgsql stable security definer set search_path = public as $$
declare d jsonb; v_url text := coalesce(nullif(p_payload->>'action_url',''), '/client-portal');
begin
  if to_regprocedure('public.notification_resolve_recipients(text,text,uuid,uuid,uuid,jsonb)') is not null then
    return query execute
      'select r.user_id, r.email, r.role, r.recipient_reason, coalesce(r.action_url, $7)
         from public.notification_resolve_recipients($1,$2,$3,$4,$5,$6) r
        where r.user_id is not null'
      using p_event, p_entity_type, p_entity_id, p_project, p_actor,
            coalesce(p_payload, '{}'::jsonb), v_url;
    return;
  end if;

  -- ── FALLBACK: base tables only (they always exist) ──
  return query
    select p.id, lower(coalesce(nullif(btrim(au.email),''), nullif(btrim(p.email),''))),
           'management', 'management_fallback', v_url
    from public.profiles p left join auth.users au on au.id = p.id
    where p.account_status = 'active'
      and (p.account_type = 'admin' or p.staff_role in ('super_admin','manager'));

  if p_project is not null and to_regclass('public.project_members') is not null then
    return query
      select pm.user_id, lower(coalesce(nullif(btrim(au.email),''), nullif(btrim(pr.email),''))),
             'project_manager', 'project_manager_fallback', v_url
      from public.project_members pm
      left join auth.users au on au.id = pm.user_id
      left join public.profiles pr on pr.id = pm.user_id
      where pm.project_id = p_project and pm.is_deleted = false
        and pm.role = 'kian_manager' and pm.user_id is not null;
  end if;

  if jsonb_typeof(p_payload->'direct') = 'array' then
    for d in select jsonb_array_elements(p_payload->'direct') loop
      if (d->>'user_id') ~ '^[0-9a-fA-F-]{36}$' then
        return query
          select x.uid, lower(coalesce(nullif(btrim(au.email),''), nullif(btrim(pr.email),''))),
                 'direct', coalesce(d->>'reason','direct'), v_url
          from (select (d->>'user_id')::uuid as uid) x
          left join auth.users au on au.id = x.uid
          left join public.profiles pr on pr.id = x.uid;
      end if;
    end loop;
  end if;
end $$;

-- THE ENQUEUE. Service-internal: a server route calls it AFTER the business row
-- is committed. Never mutates business data. Returns an honest report.
create or replace function public.comms_enqueue(
  p_event text, p_entity_type text default null, p_entity_id uuid default null,
  p_project uuid default null, p_actor uuid default null,
  p_payload jsonb default '{}'::jsonb, p_correlation uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cat  record; rec record; tpl record; ch text;
  v_corr    uuid := coalesce(p_correlation, gen_random_uuid());
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_vars    jsonb;
  v_ext boolean; v_scope text; v_locale text; v_key text; v_id uuid;
  v_subject text; v_body text; v_addr text; v_dry boolean;
  v_seen uuid[] := '{}';
  v_queued int := 0; v_blocked_r1 int := 0; v_blocked_r2 int := 0;
  v_skipped_pref int := 0; v_skipped_chan int := 0; v_dupe int := 0;
  v_ids uuid[] := '{}';
  -- Per-channel counts. The legacy adapter needs to know whether the hub
  -- actually took the EMAIL leg, otherwise it cannot decide between "the hub
  -- has this" and "fall through to the old sender" — and guessing there is
  -- exactly how a double-send happens.
  v_by_channel jsonb := jsonb_build_object('portal', 0, 'email', 0, 'whatsapp', 0);
begin
  select * into cat from public.comms_event_catalog where event_key = p_event and active;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'event_not_in_catalog', 'event', p_event,
                              'correlation_id', v_corr);
  end if;

  if not public.comms_rate_check('event:' || p_event, cat.rate_limit_hour, 3600) then
    perform public.comms_audit_write('enqueue_rate_limited', 'event', p_event,
             jsonb_build_object('limit_per_hour', cat.rate_limit_hour));
    return jsonb_build_object('ok', false, 'error', 'rate_limited', 'event', p_event,
                              'correlation_id', v_corr);
  end if;

  v_vars := v_payload - 'direct';

  for rec in select * from public.comms_resolve(p_event, p_entity_type, p_entity_id, p_project, p_actor, v_payload) loop
    if rec.user_id is null or rec.user_id = any(v_seen) then continue; end if;
    v_seen := v_seen || rec.user_id;

    v_ext := public.comms_is_external(rec.user_id);

    -- ── RULE R1, first enforcement point ──
    if v_ext and cat.audience = 'internal' then
      v_blocked_r1 := v_blocked_r1 + 1;
      perform public.comms_audit_write('recipient_blocked_r1', 'user', rec.user_id::text,
               jsonb_build_object('event', p_event, 'reason', 'internal_event_external_recipient'));
      continue;
    end if;
    -- An internal user on a client-only event simply gets the internal scope.
    v_scope := case when v_ext then 'client' else 'internal' end;
    if cat.audience = 'client' and not v_ext then v_scope := 'internal'; end if;

    v_locale := coalesce((select pf.locale from public.comms_preferences pf
                           where pf.user_id = rec.user_id and pf.category = cat.category), 'ar');

    foreach ch in array cat.channels loop
      -- ── FEATURE FLAG PER CHANNEL ──
      if not coalesce((select c.enabled from public.comms_channels c where c.channel = ch), false) then
        v_skipped_chan := v_skipped_chan + 1; continue;
      end if;
      v_dry := coalesce((select c.dry_run from public.comms_channels c where c.channel = ch), true);

      -- ── PREFERENCES (mandatory events are not suppressible) ──
      if not cat.mandatory then
        if not coalesce((select case ch when 'portal' then pf.portal when 'email' then pf.email
                                        when 'whatsapp' then pf.whatsapp else false end
                         from public.comms_preferences pf
                         where pf.user_id = rec.user_id and pf.category = cat.category),
                        ch <> 'whatsapp')   -- default: portal+email yes, whatsapp no
        then
          v_skipped_pref := v_skipped_pref + 1; continue;
        end if;
      end if;

      v_addr := case ch when 'email' then nullif(lower(btrim(coalesce(rec.email,''))), '')
                        when 'portal' then rec.user_id::text
                        else null end;
      if ch = 'email' and (v_addr is null or position('@' in v_addr) = 0) then
        continue;   -- no address ⇒ nothing to queue; never a fake row
      end if;

      select * into tpl from public.comms_templates t
       where t.event_key = p_event and t.locale = v_locale
         and t.audience_scope = v_scope and t.is_active
       order by t.version desc limit 1;
      if not found then
        select * into tpl from public.comms_templates t
         where t.event_key = p_event and t.locale = 'ar'
           and t.audience_scope = v_scope and t.is_active
         order by t.version desc limit 1;
      end if;
      if not found then continue; end if;

      v_subject := public.comms_render(tpl.subject_tpl, v_vars);
      v_body    := public.comms_render(tpl.body_tpl,
                     v_vars || jsonb_build_object('action_url', coalesce(rec.action_url, '/client-portal')));

      -- ── RULE R2, first enforcement point ──
      if v_ext and (cat.is_financial
                    or public.comms_body_has_restricted_content(v_subject || ' ' || v_body)) then
        v_blocked_r2 := v_blocked_r2 + 1;
        perform public.comms_audit_write('content_blocked_r2', 'user', rec.user_id::text,
                 jsonb_build_object('event', p_event, 'channel', ch));
        continue;
      end if;

      v_key := p_event || ':' || coalesce(p_entity_id::text, '-') || ':' || rec.user_id::text || ':' || ch;
      v_id := null;
      insert into public.comms_outbox(
        correlation_id, idempotency_key, event_key, category, channel, audience_scope,
        recipient_user_id, recipient_address, recipient_role, recipient_is_external, locale,
        template_id, template_version, subject, body, action_url,
        status, dry_run, next_attempt_at,
        -- Provenance stated EXPLICITLY at the only place native rows are born:
        -- this row was produced by the hub, it mirrors nothing, and no provider
        -- has been asked anything yet.
        source_kind, is_legacy_mirror, delivery_mode, provider_state,
        entity_type, entity_id, project_id, actor_id, meta)
      values (
        v_corr, v_key, p_event, cat.category, ch, v_scope,
        rec.user_id, v_addr, rec.role, v_ext, v_locale,
        tpl.id, tpl.version, v_subject, v_body, coalesce(rec.action_url, '/client-portal'),
        'queued', v_dry, now(),
        'native', false, case when v_dry then 'dry_run' else 'live' end, 'none',
        p_entity_type, p_entity_id, p_project, p_actor,
        jsonb_build_object('recipient_reason', rec.reason))
      on conflict (idempotency_key) where idempotency_key is not null do nothing
      returning id into v_id;

      if v_id is null then v_dupe := v_dupe + 1;
      else
        v_queued := v_queued + 1; v_ids := v_ids || v_id;
        v_by_channel := jsonb_set(v_by_channel, array[ch],
                          to_jsonb(coalesce((v_by_channel->>ch)::int, 0) + 1));
      end if;
    end loop;
  end loop;

  perform public.comms_audit_write('enqueue', 'event', p_event, jsonb_build_object(
    'correlation_id', v_corr, 'queued', v_queued, 'duplicates_suppressed', v_dupe,
    'blocked_r1', v_blocked_r1, 'blocked_r2', v_blocked_r2,
    'skipped_preference', v_skipped_pref, 'skipped_channel_disabled', v_skipped_chan));

  return jsonb_build_object(
    'ok', true, 'event', p_event, 'correlation_id', v_corr,
    'queued', v_queued, 'queued_by_channel', v_by_channel,
    'ids', to_jsonb(v_ids), 'duplicates_suppressed', v_dupe,
    'blocked_r1', v_blocked_r1, 'blocked_r2', v_blocked_r2,
    'skipped_preference', v_skipped_pref, 'skipped_channel_disabled', v_skipped_chan);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §8  THE STATE MACHINE — claim, settle, reap
-- ════════════════════════════════════════════════════════════════════════════

-- Claim runnable rows: queued|retrying, due, under max_attempts. Atomic; the
-- attempt is burned AT CLAIM (the lesson from lib/server/notifyWorker.ts:94-101:
-- a worker that dies mid-send must still cost exactly one attempt, otherwise a
-- broken row becomes immortal).
create or replace function public.comms_claim(p_limit int default 25, p_ids uuid[] default null)
returns setof public.comms_outbox language plpgsql security definer set search_path = public as $$
begin
  return query
  with due as (
    select o.id from public.comms_outbox o
    where o.status in ('queued','retrying')
      and o.attempts < o.max_attempts
      and (o.next_attempt_at is null or o.next_attempt_at <= now())
      and (p_ids is null or o.id = any(p_ids))
    order by o.created_at asc
    limit greatest(1, least(coalesce(p_limit, 25), 200))
    for update skip locked
  )
  update public.comms_outbox o
     set status = 'processing', attempts = o.attempts + 1,
         claimed_at = now(), lease_until = now() + interval '1 hour'
   from due where o.id = due.id
  returning o.*;
end $$;

-- Settle one claimed row.
--   p_outcome: 'sent' | 'delivered' | 'failed' | 'channel_deferred'
-- 'sent' with dry_run = false REQUIRES a positive provider acknowledgment in
-- p_provider_response ("ack": true). Without it the row is settled as FAILED with
-- error_class 'no_provider_ack'. This is the "HTTP 200 is not delivery" rule,
-- moved into the database so no future caller can forget it.
create or replace function public.comms_settle(
  p_id uuid, p_outcome text, p_provider text default null,
  p_provider_message_id text default null, p_provider_response jsonb default '{}'::jsonb,
  p_error text default null, p_error_class text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o record; v_next timestamptz; v_status text; v_ack boolean;
        v_delivered boolean; v_outcome0 text; v_pstate text;
begin
  select * into o from public.comms_outbox where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if o.status <> 'processing' then
    return jsonb_build_object('ok', false, 'error', 'not_claimed', 'status', o.status);
  end if;

  v_outcome0 := p_outcome;
  v_ack := coalesce((p_provider_response->>'ack')::boolean, false);
  -- Delivery evidence is a STRONGER claim than acceptance and needs its own
  -- proof. Parsed defensively (never a bare ::boolean cast on caller text).
  v_delivered := lower(coalesce(p_provider_response->>'delivered','')) in ('true','t','1')
                 or nullif(btrim(coalesce(p_provider_response->>'delivery_receipt','')), '') is not null;

  if p_outcome = 'sent' and not o.dry_run and not v_ack then
    p_outcome := 'failed'; p_error := coalesce(p_error, 'provider did not acknowledge');
    p_error_class := 'no_provider_ack';
  end if;

  -- 'delivered' without delivery evidence is downgraded, never inflated. It is
  -- NOT failed: the provider did accept it, and marking an accepted message
  -- failed would invite a second send of something already in flight.
  if p_outcome = 'delivered' and not o.dry_run then
    if not v_ack then
      p_outcome := 'failed'; p_error := coalesce(p_error, 'provider did not acknowledge');
      p_error_class := 'no_provider_ack';
    elsif not v_delivered then
      p_outcome := 'sent';
    end if;
  end if;

  -- ── PROVIDER EVIDENCE, RECORDED AS DATA ──────────────────────────────────
  -- Only 'accepted' and 'delivered' are evidence. A mirror can never reach
  -- them (R0). A dry run never engaged a provider at all, so it is 'none' —
  -- not 'accepted', which is how a simulation would become a green number.
  v_pstate := case
    when o.is_legacy_mirror                                          then 'unavailable'
    when o.dry_run                                                   then 'none'
    when p_outcome = 'delivered'                                     then 'delivered'
    when p_outcome = 'sent'                                          then 'accepted'
    when lower(coalesce(p_error,'') || ' ' || coalesce(p_error_class,''))
         like '%relay_handler_missing%'                              then 'relay_handler_missing'
    when v_outcome0 = 'channel_deferred'
      or coalesce(p_error_class,'') = 'channel'                      then 'unavailable'
    else 'attempted' end;

  if p_outcome in ('sent','delivered') then
    v_status := p_outcome;
    update public.comms_outbox set
      status = v_status, provider = p_provider, provider_message_id = p_provider_message_id,
      provider_response = coalesce(p_provider_response, '{}'::jsonb),
      provider_state = v_pstate,
      last_error = null, error_class = null, lease_until = null, next_attempt_at = null,
      sent_at = coalesce(sent_at, now()),
      delivered_at = case when v_status = 'delivered' then now() else delivered_at end
    where id = p_id;

  elsif p_outcome = 'channel_deferred' then
    -- The message is fine, the CHANNEL is not (disabled / no endpoint / handler
    -- missing). Hand the attempt back and requeue — never dead-letter a backlog
    -- because a relay is undeployed.
    update public.comms_outbox set
      status = 'queued', attempts = greatest(0, o.attempts - 1),
      last_error = coalesce(p_error, 'channel_unavailable'),
      error_class = coalesce(p_error_class, 'channel'),
      provider_response = coalesce(p_provider_response, '{}'::jsonb),
      provider_state = v_pstate,
      lease_until = null, next_attempt_at = now() + interval '30 minutes'
    where id = p_id;
    v_status := 'queued';

  else
    if o.attempts >= o.max_attempts then
      v_status := 'dead_letter'; v_next := null;
    else
      v_status := 'retrying';
      v_next := now() + make_interval(mins => (5 * power(2, o.attempts))::int);
    end if;
    update public.comms_outbox set
      status = v_status, next_attempt_at = v_next, lease_until = null,
      provider = p_provider, provider_response = coalesce(p_provider_response, '{}'::jsonb),
      provider_state = v_pstate,
      last_error = left(coalesce(p_error, 'send_failed'), 500),
      error_class = coalesce(p_error_class, 'send_failed')
    where id = p_id;
  end if;

  return jsonb_build_object('ok', true, 'id', p_id, 'status', v_status,
                            'attempts', o.attempts, 'dry_run', o.dry_run,
                            'provider_state', v_pstate,
                            'counts_as_live_send',
                              v_status in ('sent','delivered') and not o.dry_run
                              and not o.is_legacy_mirror and v_pstate in ('accepted','delivered'));
end $$;

-- Return rows whose processing lease expired. A row already at max_attempts
-- terminates in the dead-letter queue instead of cycling forever.
create or replace function public.comms_reap()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_requeued int; v_dead int;
begin
  update public.comms_outbox set status = 'dead_letter', lease_until = null,
         next_attempt_at = null, last_error = 'reclaimed_stuck_processing', error_class = 'stuck'
   where status = 'processing' and lease_until is not null and lease_until < now()
     and attempts >= max_attempts;
  get diagnostics v_dead = row_count;

  update public.comms_outbox set status = 'retrying', lease_until = null,
         next_attempt_at = now() + interval '5 minutes',
         last_error = 'reclaimed_stuck_processing', error_class = 'stuck'
   where status = 'processing' and lease_until is not null and lease_until < now();
  get diagnostics v_requeued = row_count;

  return jsonb_build_object('ok', true, 'requeued', v_requeued, 'dead_lettered', v_dead);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §9  AUTHORIZED OPERATIONS — retry, cancel, preview, flags, templates
--     Hiding a button is not authorization: every one of these re-checks.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.comms_retry(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o record;
begin
  if not public.comms_can_admin() then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;
  select * into o from public.comms_outbox where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  -- A mirrored legacy row is a REPORT of something the old queue already did.
  -- Retrying it here would send a second copy of a message that path may have
  -- already delivered. Refuse — this is the double-send the audit warned about.
  -- Three independent ways to recognise a mirror; any one of them refuses. The
  -- provenance flag is the primary test, the FK link and the provider string
  -- are belt and braces for a row written before §2.4b existed.
  if o.is_legacy_mirror or o.source_kind = 'legacy_mirror'
     or o.legacy_delivery_id is not null
     or coalesce(o.provider,'') = 'legacy_email_deliveries' then
    return jsonb_build_object('ok', false, 'error', 'legacy_mirror_not_retryable',
      'hint', 'this row mirrors public.email_deliveries; retry it in the legacy monitor instead');
  end if;
  if o.status not in ('failed','dead_letter','retrying','cancelled') then
    return jsonb_build_object('ok', false, 'error', 'not_retryable', 'status', o.status);
  end if;
  update public.comms_outbox
     set status = 'queued', attempts = 0, next_attempt_at = now(), lease_until = null,
         last_error = null, error_class = null,
         cancelled_at = null, cancelled_by = null, cancel_reason = null
   where id = p_id;
  perform public.comms_audit_write('manual_retry', 'outbox', p_id::text,
           jsonb_build_object('from_status', o.status, 'event', o.event_key));
  return jsonb_build_object('ok', true, 'id', p_id, 'status', 'queued');
end $$;

create or replace function public.comms_cancel(p_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o record;
begin
  if not public.comms_can_admin() then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;
  select * into o from public.comms_outbox where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  -- Cancel is BEFORE SEND only. A claimed row is in flight; a sent row is gone.
  if o.status not in ('queued','retrying') then
    return jsonb_build_object('ok', false, 'error', 'too_late', 'status', o.status);
  end if;
  update public.comms_outbox
     set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(),
         cancel_reason = left(coalesce(p_reason, ''), 300), next_attempt_at = null, lease_until = null
   where id = p_id;
  perform public.comms_audit_write('cancel', 'outbox', p_id::text,
           jsonb_build_object('event', o.event_key, 'reason', left(coalesce(p_reason,''), 300)));
  return jsonb_build_object('ok', true, 'id', p_id, 'status', 'cancelled');
end $$;

-- Render a message WITHOUT queuing it. Staff-only; refuses to preview an
-- internal template as if it were client-facing.
create or replace function public.comms_preview(
  p_event text, p_locale text default 'ar', p_scope text default 'internal',
  p_vars jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tpl record; v_subject text; v_body text; cat record;
begin
  if not public.comms_can_view() then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;
  select * into cat from public.comms_event_catalog where event_key = p_event;
  if not found then return jsonb_build_object('ok', false, 'error', 'event_not_in_catalog'); end if;
  select * into tpl from public.comms_templates t
   where t.event_key = p_event and t.locale = coalesce(p_locale,'ar')
     and t.audience_scope = coalesce(p_scope,'internal') and t.is_active
   order by t.version desc limit 1;
  if not found then return jsonb_build_object('ok', false, 'error', 'template_not_found'); end if;
  v_subject := public.comms_render(tpl.subject_tpl, coalesce(p_vars, '{}'::jsonb));
  v_body    := public.comms_render(tpl.body_tpl,    coalesce(p_vars, '{}'::jsonb));
  return jsonb_build_object('ok', true, 'event', p_event, 'locale', tpl.locale,
    'audience_scope', tpl.audience_scope, 'version', tpl.version,
    'subject', v_subject, 'body', v_body,
    'would_violate_r2', (tpl.audience_scope = 'client'
      and (cat.is_financial or public.comms_body_has_restricted_content(v_subject || ' ' || v_body))));
end $$;

create or replace function public.comms_channel_set(
  p_channel text, p_enabled boolean, p_dry_run boolean default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o record;
begin
  if not public.comms_can_admin() then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;
  select * into o from public.comms_channels where channel = p_channel;
  if not found then return jsonb_build_object('ok', false, 'error', 'unknown_channel'); end if;
  update public.comms_channels
     set enabled = coalesce(p_enabled, enabled),
         dry_run = coalesce(p_dry_run, dry_run),
         note = coalesce(p_note, note),
         updated_at = now(), updated_by = auth.uid()
   where channel = p_channel;
  perform public.comms_audit_write('channel_flag', 'channel', p_channel, jsonb_build_object(
    'from', jsonb_build_object('enabled', o.enabled, 'dry_run', o.dry_run),
    'to',   jsonb_build_object('enabled', coalesce(p_enabled, o.enabled),
                               'dry_run', coalesce(p_dry_run, o.dry_run))));
  return jsonb_build_object('ok', true, 'channel', p_channel);
end $$;

-- New template VERSION. Published templates are never mutated in place: a
-- change creates version+1 and deactivates the previous active row.
create or replace function public.comms_template_publish(
  p_event text, p_locale text, p_scope text, p_subject text, p_body text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ver int; v_id uuid;
begin
  if not public.comms_can_admin() then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;
  if not exists (select 1 from public.comms_event_catalog where event_key = p_event) then
    return jsonb_build_object('ok', false, 'error', 'event_not_in_catalog');
  end if;
  if coalesce(btrim(p_subject),'') = '' or coalesce(btrim(p_body),'') = '' then
    return jsonb_build_object('ok', false, 'error', 'subject_and_body_required');
  end if;
  select coalesce(max(version), 0) + 1 into v_ver from public.comms_templates
   where event_key = p_event and locale = p_locale and audience_scope = p_scope;
  update public.comms_templates set is_active = false
   where event_key = p_event and locale = p_locale and audience_scope = p_scope and is_active;
  insert into public.comms_templates(event_key, locale, audience_scope, version,
                                     subject_tpl, body_tpl, is_active, created_by)
  values (p_event, p_locale, p_scope, v_ver, p_subject, p_body, true, auth.uid())
  returning id into v_id;
  perform public.comms_audit_write('template_publish', 'template', v_id::text,
           jsonb_build_object('event', p_event, 'locale', p_locale, 'scope', p_scope, 'version', v_ver));
  return jsonb_build_object('ok', true, 'id', v_id, 'version', v_ver);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §10 READ MODELS — dashboard, health. Address is MASKED for the view-only tier.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.comms_dashboard(
  p_status text default null, p_channel text default null, p_event text default null,
  p_search text default null, p_from timestamptz default null, p_to timestamptz default null,
  p_limit int default 100, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_rows jsonb; v_total int; v_admin boolean;
begin
  if not public.comms_can_view() then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;
  v_admin := public.comms_can_admin();

  select count(*) into v_total from public.comms_outbox o
   where (p_status  is null or o.status = p_status)
     and (p_channel is null or o.channel = p_channel)
     and (p_event   is null or o.event_key = p_event)
     and (p_from    is null or o.created_at >= p_from)
     and (p_to      is null or o.created_at <= p_to)
     and (p_search  is null or btrim(p_search) = '' or
          o.subject ilike '%' || p_search || '%' or
          o.event_key ilike '%' || p_search || '%' or
          coalesce(o.recipient_address,'') ilike '%' || p_search || '%');

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb) into v_rows
  from (
    select o.id, o.created_at, o.event_key, o.category, o.channel, o.status, o.dry_run,
           o.audience_scope, o.recipient_is_external, o.locale, o.attempts, o.max_attempts,
           o.next_attempt_at, o.sent_at, o.subject, o.last_error, o.error_class,
           o.provider, o.provider_message_id, o.correlation_id, o.template_version,
           case when v_admin then o.recipient_address
                when o.recipient_address is null then null
                else regexp_replace(o.recipient_address, '^(.).*(@.*)$', '\1***\2') end as recipient_address,
           o.recipient_role, o.cancel_reason
    from public.comms_outbox o
    where (p_status  is null or o.status = p_status)
      and (p_channel is null or o.channel = p_channel)
      and (p_event   is null or o.event_key = p_event)
      and (p_from    is null or o.created_at >= p_from)
      and (p_to      is null or o.created_at <= p_to)
      and (p_search  is null or btrim(p_search) = '' or
           o.subject ilike '%' || p_search || '%' or
           o.event_key ilike '%' || p_search || '%' or
           coalesce(o.recipient_address,'') ilike '%' || p_search || '%')
    order by o.created_at desc
    limit greatest(1, least(coalesce(p_limit, 100), 500))
    offset greatest(0, coalesce(p_offset, 0))
  ) x;

  return jsonb_build_object('ok', true, 'total', v_total, 'rows', v_rows, 'is_admin', v_admin);
end $$;

-- Queue health. sent_dry_run and sent_live are SEPARATE and never summed: a
-- simulated send must never be counted as a delivery.
create or replace function public.comms_health()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb; v_ch jsonb; v_old timestamptz; v_legacy jsonb := 'null'::jsonb;
begin
  if not public.comms_can_view() then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;

  -- ══ THE COUNTING RULE ═════════════════════════════════════════════════════
  -- A row counts as a LIVE SEND only on REAL EVIDENCE. The five conjuncts below
  -- are repeated verbatim on both live counters — deliberately, because §90
  -- asserts each token on each counter, so the repetition is what makes the
  -- guard able to catch a removal. Every conjunct does work:
  --   source_kind = 'native'                     not a mirror, not an import
  --   not is_legacy_mirror                       the explicit provenance flag
  --   delivery_mode = 'live'                     not a simulation
  --   provider_state in ('accepted','delivered') the provider actually took it
  --   provider <> 'legacy_email_deliveries'      belt and braces on the old string
  -- NONE of these may ever be counted live: legacy_mirror, dry_run, imported,
  -- provider unavailable, relay_handler_missing, queued, processing, retrying —
  -- each gets its own honestly named bucket below instead.
  select jsonb_build_object(
    'queued',      count(*) filter (where status = 'queued'),
    'processing',  count(*) filter (where status = 'processing'),
    'retrying',    count(*) filter (where status = 'retrying'),
    -- SIMULATED. Never summed with anything live.
    -- The three mirror tests are repeated here, not just on the live counters:
    -- a mirror is reported ONLY as a mirror, so sent_dry_run and mirrored_legacy
    -- can never both fire on one row even if the guard trigger was bypassed.
    'sent_dry_run',count(*) filter (where status in ('sent','delivered')
                                      and (dry_run or delivery_mode = 'dry_run')
                                      and not is_legacy_mirror
                                      and source_kind <> 'legacy_mirror'
                                      and coalesce(provider,'') <> 'legacy_email_deliveries'),
    'sent_live',   count(*) filter (where status = 'sent'
                                      and source_kind = 'native' and not is_legacy_mirror
                                      and delivery_mode = 'live'
                                      and provider_state in ('accepted','delivered')
                                      and coalesce(provider,'') <> 'legacy_email_deliveries'),
    -- Same four exclusions; a STRICTER evidence bar. Acceptance is not delivery.
    'delivered',   count(*) filter (where status = 'delivered'
                                      and source_kind = 'native' and not is_legacy_mirror
                                      and delivery_mode = 'live'
                                      and provider_state = 'delivered'
                                      and coalesce(provider,'') <> 'legacy_email_deliveries'),
    -- ⚠️ MIRRORED LEGACY ROWS ARE NOT SENDS BY THIS HUB.
    --    comms_adapter_import_legacy() copies TERMINAL email_deliveries rows in.
    --    Counting those live would put a green "actually sent" number on the
    --    dashboard for mail this hub never touched — and whose legacy 'sent' is
    --    not evidence of delivery at all, since the Apps Script portal_notify
    --    handler is not deployed. That is the forged success this module kills.
    'mirrored_legacy', count(*) filter (where is_legacy_mirror
                                          or source_kind = 'legacy_mirror'
                                          or coalesce(provider,'') = 'legacy_email_deliveries'),
    'imported',    count(*) filter (where source_kind = 'imported'),
    -- Absence-of-evidence buckets, named for what they actually are.
    'provider_unavailable',
      count(*) filter (where provider_state = 'unavailable' and not is_legacy_mirror),
    'relay_handler_missing',
      count(*) filter (where provider_state = 'relay_handler_missing'),
    -- ★ The forged-success detector: a native, live row that claims a terminal
    --   success it has no evidence for. Must always read 0; any other number is
    --   a bug in a settle path, surfaced instead of hidden. The second arm
    --   catches the subtler case — status 'delivered' backed only by
    --   acceptance — so that every native live terminal row lands in exactly one
    --   of sent_live, delivered and this bucket, and none can go unreported.
    'claimed_sent_without_evidence',
      count(*) filter (where status in ('sent','delivered') and source_kind = 'native'
                         and not is_legacy_mirror and delivery_mode = 'live'
                         and (provider_state not in ('accepted','delivered')
                              or (status = 'delivered' and provider_state <> 'delivered'))),
    'failed',      count(*) filter (where status = 'failed'),
    'dead_letter', count(*) filter (where status = 'dead_letter'),
    'cancelled',   count(*) filter (where status = 'cancelled'),
    'blocked_external_total',
      (select count(*) from public.comms_audit where action in ('recipient_blocked_r1','content_blocked_r2')),
    'total',       count(*))
  into v from public.comms_outbox;

  -- The ONLY number that may be read as "really sent". sent_live and delivered
  -- are disjoint by status, so this is a sum and not a double count.
  v := v || jsonb_build_object('live_total',
         coalesce((v->>'sent_live')::int, 0) + coalesce((v->>'delivered')::int, 0));

  select min(created_at) into v_old from public.comms_outbox where status in ('queued','retrying');

  select coalesce(jsonb_object_agg(channel, jsonb_build_object('enabled', enabled, 'dry_run', dry_run)), '{}'::jsonb)
    into v_ch from public.comms_channels;

  -- Legacy queue, READ ONLY, for side-by-side honesty. Never written.
  if to_regclass('public.email_deliveries') is not null then
    execute $q$ select jsonb_build_object('pending', count(*) filter (where status = 'pending'),
                                          'sent',    count(*) filter (where status = 'sent'),
                                          'failed',  count(*) filter (where status = 'failed'),
                                          'total',   count(*))
                 from public.email_deliveries $q$ into v_legacy;
  end if;

  return jsonb_build_object('ok', true, 'counts', v, 'channels', v_ch,
    'oldest_runnable_at', v_old, 'legacy_email_deliveries', v_legacy,
    'note_ar', 'الإرسال الفعلي هو live_total فقط، ويشترط إقرارًا حقيقيًا من المزوّد. أمّا sent_dry_run فمحاكاة لم تُرسَل، وmirrored_legacy صفوف منسوخة من الطابور القديم للعرض فقط، وprovider_unavailable وrelay_handler_missing وimported وclaimed_sent_without_evidence كلّها ليست إرسالًا فعليًّا ولا تُحتسب ضمنه.',
    'note_en', 'live_total is the only "really sent" number and requires real provider evidence. sent_dry_run was simulated and never sent; mirrored_legacy are read-only copies of the old queue; provider_unavailable, relay_handler_missing, imported and claimed_sent_without_evidence are absences of evidence. None of them is ever counted as a live send.');
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §11 PREFERENCE CENTRE — self-service, per category, per channel
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.comms_prefs_get()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.category), '[]'::jsonb) into v
  from (
    select c.category,
           coalesce(p.portal,   true)  as portal,
           coalesce(p.email,    true)  as email,
           coalesce(p.whatsapp, false) as whatsapp,
           coalesce(p.locale,   'ar')  as locale,
           bool_or(c.mandatory)        as has_mandatory
    from (select distinct category, mandatory from public.comms_event_catalog where active) c
    left join public.comms_preferences p
           on p.user_id = auth.uid() and p.category = c.category
    group by c.category, p.portal, p.email, p.whatsapp, p.locale
  ) x;
  return jsonb_build_object('ok', true, 'categories', v);
end $$;

create or replace function public.comms_prefs_set(
  p_category text, p_portal boolean, p_email boolean,
  p_whatsapp boolean default false, p_locale text default 'ar')
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;
  if not exists (select 1 from public.comms_event_catalog where category = p_category) then
    return jsonb_build_object('ok', false, 'error', 'unknown_category');
  end if;
  insert into public.comms_preferences(user_id, category, portal, email, whatsapp, locale, updated_at)
  values (auth.uid(), p_category, coalesce(p_portal,true), coalesce(p_email,true),
          coalesce(p_whatsapp,false), case when p_locale in ('ar','en') then p_locale else 'ar' end, now())
  on conflict (user_id, category) do update
    set portal = excluded.portal, email = excluded.email, whatsapp = excluded.whatsapp,
        locale = excluded.locale, updated_at = now();
  perform public.comms_audit_write('prefs_set', 'category', p_category,
           jsonb_build_object('portal', p_portal, 'email', p_email, 'whatsapp', p_whatsapp));
  return jsonb_build_object('ok', true, 'category', p_category);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §12 LEGACY ADAPTER — ONE WAY, READ ONLY.
--     Mirrors email_deliveries rows into the outbox so the dashboard shows the
--     whole picture. It NEVER writes to email_deliveries and NEVER re-sends
--     anything: mirrored rows land in a terminal status and carry
--     provider = 'legacy_email_deliveries', so the worker never claims them.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.comms_adapter_import_legacy(p_limit int default 200)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; v_n int := 0; v_blocked int := 0; v_live int := 0;
begin
  if not public.comms_can_admin() then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;
  if to_regclass('public.email_deliveries') is null then
    return jsonb_build_object('ok', true, 'imported', 0, 'note', 'email_deliveries absent');
  end if;

  -- Count the rows the legacy queue still owns. They are DELIBERATELY not
  -- mirrored: a pending/processing legacy row is live work over there, and a
  -- copy of it here could be retried into a second send.
  execute $q$ select count(*) from public.email_deliveries
               where status not in ('sent','failed','bounced') $q$ into v_live;

  -- Terminal rows only, one at a time, so a single row that violates R1/R2
  -- (which is a real finding worth surfacing) is counted rather than aborting
  -- the whole import.
  for r in execute $q$
      select d.id, d.correlation_id, d.recipient_id, d.recipient_email, d.subject,
             d.body_text, d.direct_url, d.status, d.attempts, d.provider_message_id,
             d.last_error, d.created_at, d.sent_at
        from public.email_deliveries d
       where d.status in ('sent','failed','bounced')
         and not exists (select 1 from public.comms_outbox o where o.legacy_delivery_id = d.id)
       order by d.created_at desc
       limit greatest(1, least($1, 1000)) $q$ using p_limit
  loop
    begin
      insert into public.comms_outbox(
        correlation_id, idempotency_key, event_key, category, channel, audience_scope,
        recipient_user_id, recipient_address, recipient_role, recipient_is_external, locale,
        subject, body, action_url, status, dry_run, attempts, max_attempts,
        -- PROVENANCE, STATED — not left to be inferred from the provider string.
        -- provider_state is 'unavailable' for every mirror without exception:
        -- whatever the old queue recorded, THIS hub has no provider evidence for
        -- it, and R0 (trigger + CHECK) makes 'accepted'/'delivered' impossible
        -- here anyway. A mirror can therefore never become a live send.
        source_kind, is_legacy_mirror, delivery_mode, provider_state,
        provider, provider_message_id, last_error, legacy_delivery_id, created_at, sent_at, meta)
      values (
        coalesce(r.correlation_id, gen_random_uuid()), 'legacy:' || r.id::text,
        'legacy.email_delivery', 'legacy', 'email',
        case when public.comms_is_external(r.recipient_id) then 'client' else 'internal' end,
        r.recipient_id, r.recipient_email, 'legacy',
        public.comms_is_external(r.recipient_id), 'ar',
        coalesce(nullif(btrim(r.subject), ''), '(بلا عنوان)'), coalesce(r.body_text, ''), r.direct_url,
        case r.status when 'sent' then 'sent' when 'failed' then 'dead_letter' else 'failed' end,
        false, coalesce(r.attempts, 0), 5,
        'legacy_mirror', true, 'live', 'unavailable',
        'legacy_email_deliveries', r.provider_message_id, r.last_error,
        r.id, r.created_at, r.sent_at,
        jsonb_build_object('legacy_status', r.status, 'mirror', true,
                           'provenance_note',
                           'mirrored from public.email_deliveries; this hub holds no provider evidence for it'))
      on conflict do nothing;
      v_n := v_n + 1;
    exception when others then
      v_blocked := v_blocked + 1;   -- e.g. COMMS R1/R2 on a historical row
    end;
  end loop;

  perform public.comms_audit_write('legacy_import', 'email_deliveries', null,
           jsonb_build_object('imported', v_n, 'blocked_by_safety_rules', v_blocked,
                              'left_with_legacy_queue', v_live));
  return jsonb_build_object('ok', true, 'imported', v_n,
    'blocked_by_safety_rules', v_blocked, 'left_with_legacy_queue', v_live,
    'note', 'read-only mirror of TERMINAL rows only; email_deliveries was not modified, live rows were not copied, and mirrored rows can never be retried from here');
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §13 RLS + GRANTS — no anon anywhere; writes only through the RPCs above.
-- ════════════════════════════════════════════════════════════════════════════
alter table public.comms_channels       enable row level security;
alter table public.comms_event_catalog  enable row level security;
alter table public.comms_templates      enable row level security;
alter table public.comms_outbox         enable row level security;
alter table public.comms_preferences    enable row level security;
alter table public.comms_rate_counters  enable row level security;
alter table public.comms_audit          enable row level security;

drop policy if exists comms_channels_read on public.comms_channels;
create policy comms_channels_read on public.comms_channels
  for select to authenticated using (public.comms_can_view());

drop policy if exists comms_catalog_read on public.comms_event_catalog;
create policy comms_catalog_read on public.comms_event_catalog
  for select to authenticated using (public.comms_is_staff());

drop policy if exists comms_templates_read on public.comms_templates;
create policy comms_templates_read on public.comms_templates
  for select to authenticated using (public.comms_can_view());

drop policy if exists comms_outbox_read on public.comms_outbox;
create policy comms_outbox_read on public.comms_outbox
  for select to authenticated using (public.comms_can_view());

drop policy if exists comms_prefs_own_read on public.comms_preferences;
create policy comms_prefs_own_read on public.comms_preferences
  for select to authenticated using (user_id = auth.uid());

drop policy if exists comms_audit_read on public.comms_audit;
create policy comms_audit_read on public.comms_audit
  for select to authenticated using (public.comms_can_admin());

-- comms_rate_counters gets NO policy: RLS on with zero policies = deny all.
-- Only the SECURITY DEFINER functions above may touch it.

do $grants$
declare t text; f text;
begin
  foreach t in array array['comms_channels','comms_event_catalog','comms_templates',
                           'comms_outbox','comms_preferences','comms_rate_counters','comms_audit'] loop
    execute format('revoke all on table public.%I from public, anon', t);
    execute format('grant select on table public.%I to authenticated', t);
  end loop;
  -- Preferences are the ONE table a user writes directly (own row, RLS-scoped).
  execute 'grant insert, update on table public.comms_preferences to authenticated';
  drop policy if exists comms_prefs_own_write on public.comms_preferences;
  execute 'create policy comms_prefs_own_write on public.comms_preferences
             for insert to authenticated with check (user_id = auth.uid())';
  drop policy if exists comms_prefs_own_update on public.comms_preferences;
  execute 'create policy comms_prefs_own_update on public.comms_preferences
             for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())';

  -- USER-CALLABLE (each re-checks authorization inside).
  foreach f in array array[
    'public.comms_can_view()', 'public.comms_can_admin()', 'public.comms_is_staff()',
    'public.comms_preview(text,text,text,jsonb)',
    'public.comms_dashboard(text,text,text,text,timestamptz,timestamptz,int,int)',
    'public.comms_health()', 'public.comms_prefs_get()',
    'public.comms_prefs_set(text,boolean,boolean,boolean,text)',
    'public.comms_retry(uuid)', 'public.comms_cancel(uuid,text)',
    'public.comms_channel_set(text,boolean,boolean,text)',
    'public.comms_template_publish(text,text,text,text,text)',
    'public.comms_adapter_import_legacy(int)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;

  -- SERVICE-ONLY. Never reachable from a browser session.
  foreach f in array array[
    'public.comms_enqueue(text,text,uuid,uuid,uuid,jsonb,uuid)',
    'public.comms_claim(int,uuid[])',
    'public.comms_settle(uuid,text,text,text,jsonb,text,text)',
    'public.comms_reap()',
    'public.comms_resolve(text,text,uuid,uuid,uuid,jsonb)',
    'public.comms_rate_check(text,int,int)',
    'public.comms_audit_write(text,text,text,jsonb)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;

  -- Pure helpers: safe to expose to staff UI, no data access of their own.
  foreach f in array array['public.comms_is_external(uuid)',
                           'public.comms_body_has_restricted_content(text)',
                           'public.comms_render(text,jsonb)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;

  -- ⚠️ THE TRIGGER FUNCTION NEEDS ITS OWN REVOKE. PostgreSQL grants EXECUTE to
  -- PUBLIC on every newly created function, and a trigger fires regardless of
  -- grants — so if this one is left out of the loops above, PUBLIC (and
  -- therefore anon) silently keeps EXECUTE on it and the "no anon" self-test
  -- below aborts the migration. Nobody ever needs to call it directly.
  execute 'revoke all on function public.comms_outbox_guard() from public, anon, authenticated';
end $grants$;

-- ─── 13.b ANONYMOUS DIRECT TABLE ACCESS → ZERO ──────────────────────────────
-- SCOPE: public.notifications, notification_events, notification_preferences,
-- notification_delivery_log, email_deliveries, EVERY public.comms_* table, and
-- the SEQUENCES those tables own. Grantees: anon AND PUBLIC.
--
-- TARGET STATE, stated up front so the block can be read against it:
--   anon                     — 0 direct privileges, table AND column, on every
--                              table in scope, plus 0 on their sequences.
--   PUBLIC                   — the same, 0.
--   authenticated            — on notification_preferences: EXACTLY
--                              SELECT (table) + UPDATE (portal_enabled,
--                              email_enabled, whatsapp_enabled), granted
--                              DIRECTLY so it never depends on PUBLIC.
--                              On the other tables in scope: unchanged, with
--                              whatever it effectively held restated as a direct
--                              grant at the same granularity.
-- ORDER: capture what authenticated needs → revoke from anon → revoke from
-- PUBLIC → apply the direct allowlist → verify every required privilege is
-- present → verify every unexpected privilege is absent → verify row isolation.
--
-- ══ THE FAILURE THIS SECTION WAS REWRITTEN AFTER ══
-- A previous run of this file aborted before COMMIT with
--   HUB FAIL: the revoke stripped authenticated of SELECT/UPDATE on
--             notification_preferences
-- That message named the wrong culprit. The two revokes in this block are
-- `from anon` and `from public`; neither can remove a grant whose grantee is
-- `authenticated`. What actually happened is that the guard asked
-- has_table_privilege(...,'UPDATE'), while docs/phase0_migration.sql:781 grants
-- that privilege at COLUMN level:
--     grant update (portal_enabled, email_enabled, whatsapp_enabled)
--       on public.notification_preferences to authenticated;
-- has_table_privilege() answers only for the table as a whole — a column grant
-- does not make it true, which is exactly why PostgreSQL also ships
-- has_any_column_privilege() and has_column_privilege(). The guard therefore
-- asserted a requirement that was never true on ANY database where the shipped
-- Phase-0 migration had been applied. Nothing had been broken; the check was
-- measuring the wrong thing, at the wrong granularity, and then blaming a
-- statement that had not run against that role at all.
--
-- WHAT CHANGED, AND WHY. An earlier pass revoked only REFERENCES, TRIGGER and
-- TRUNCATE and deliberately left SELECT / INSERT / UPDATE / DELETE in place on
-- the reasoning that "a public form might need them". That reasoning is now
-- retired: a privilege that no caller exercises is not a spare capability, it is
-- a standing hole that survives every review because nothing fails when it is
-- abused. The revoke below removes EVERY privilege type instead.
--
-- SOURCE OF THE RESIDUE, established from the repo rather than assumed: not one
-- SQL file in docs/ grants anything to anon on any of these tables. The origin is
--   docs/authz_fixD_profiles_direct_write_RUNME.sql:34
--     "grant all on all tables in schema public to anon, authenticated;"
-- which every Supabase project is created with.
--
-- IS THERE A GENUINE ANONYMOUS CALLER? Re-checked against the working tree
-- before widening the revoke, because this is the step that would break a public
-- form if the answer were yes:
--   • DIRECT TABLE ACCESS FROM JAVASCRIPT: none. A grep across app/, lib/ and
--     components/ for .from('notifications' | 'notification_events' |
--     'notification_preferences' | 'notification_delivery_log' |
--     'email_deliveries' | 'comms_*') returns ZERO hits outside tests/.
--   • THE ROUTES THAT DO TOUCH THIS DATA — app/api/comms/process,
--     app/api/comms/legacy-notify, app/api/integrations/project/notify,
--     .../notify-admin, app/api/cron/notify-email and lib/server/notifyEvent.ts —
--     all go through lib/server/supabaseAdmin (rpcAsUser / rpcAsService /
--     selectAsService / patchAsService). Those are server-side identities. Not
--     one of them is the anon role, so not one of them loses anything here.
--     THE CRON ROUTE WAS CHECKED SPECIFICALLY: app/api/cron/notify-email imports
--     rpcAsService only — it is service_role, never anon.
--   • THE PUBLIC FORMS — the opportunities page and the quote request — reach
--     this data through exactly ONE anonymous entry point:
--     public.submit_opportunity_request(text,text,text,text,text,text,jsonb,boolean)
--     (opportunities_center_RUNME.sql:117, public_portal_rate_limit_RUNME.sql:195).
--     It is SECURITY DEFINER with `set search_path = public`, so its INSERT into
--     opportunity_requests and its public.notify() fan-out both execute as the
--     function OWNER. It needs NO table privilege of any kind, and it is a
--     FUNCTION grant, which §13.c below leaves untouched.
--   • THE PUBLIC CASE-STUDY SURFACE (cs_public_index / cs_public_study /
--     cs_public_slugs, case_studies_platform_RUNME.sql:2611) is anon-granted but
--     reads case-study tables only; it never touches a notification table.
-- CONCLUSION: nothing legitimate depends on anon's table privileges here, so
-- nothing is being routed through a new RPC — there is nothing to route.
--
-- WHY EACH TYPE MATTERS, so this is not a ritual:
--   TRUNCATE   — row level security does NOT apply to TRUNCATE. anon holding it
--                means the public browser key can empty the notification tables.
--   DELETE     — RLS applies, but a permissive policy anywhere makes it real.
--   INSERT     — forge a notification into someone else's inbox.
--   SELECT     — read recipients and message bodies.
--   UPDATE     — rewrite a delivery record into a false "delivered".
--   TRIGGER    — attach a trigger to a table privileged code writes.
--   REFERENCES — create a foreign key that constrains other people's deletes.
--   USAGE      — on a SEQUENCE, not on a table. Handled separately below,
--                because `revoke all on table` does not reach a sequence and a
--                cleanup that forgets sequences leaves nextval() callable.
--
-- FUNCTION EXECUTE IS NOT TOUCHED IN THIS BLOCK. Table privileges and routine
-- privileges live in different catalogues and are revoked by different
-- statements; mixing them is how a table cleanup silently kills an allowlisted
-- public RPC. §13.c handles functions, separately and explicitly.
do $anon_tables$
declare
  t text;
  v_targets text[];
  v_left text;
  v_seq record;
  v_nseq int := 0;
  v_priv text;
  v_col text;
  v_rec record;
  v_preserved text := '';
  -- ★ THE PROVEN authenticated CONTRACT ON notification_preferences ★
  -- Derived from the CODE, not from an error message. Every reader and writer of
  -- public.notification_preferences in this repository:
  --   lib/portal/account.ts:32  pget  'notification_preferences?user_id=eq.<uid>&select=*'
  --                             → PostgREST GET with a user JWT → needs a REAL
  --                               table SELECT covering EVERY column (select=*).
  --   lib/portal/account.ts:42  ppatch 'notification_preferences?user_id=eq.<uid>'
  --                             with Partial<portal_enabled|email_enabled|whatsapp_enabled>
  --                             → PostgREST PATCH with a user JWT, sent with
  --                               `Prefer: return=representation` (lib/portal/client.ts:131),
  --                               so it needs UPDATE on exactly those three
  --                               columns AND SELECT to return the row.
  --   components/portal/ProfileSettings.tsx:47/75 — the only UI, calls the two above.
  --   public.notify() (phase0_migration.sql:95), public.handle_new_user()
  --   (phase0_migration.sql:515) and the project_core email helpers are all
  --   SECURITY DEFINER: they run as the function owner and need NO grant here.
  -- CONSEQUENCES, each one checked rather than assumed:
  --   • INSERT is NOT required. The row is created at signup by the SECURITY
  --     DEFINER trigger handle_new_user(), and backfilled for pre-existing users
  --     (phase0_migration.sql:127). No browser path inserts, and there is no
  --     INSERT policy on the table, so granting INSERT would be dead privilege.
  --   • DELETE is NOT required — phase0 grants no delete anywhere by design.
  --   • No sequence is involved: the primary key is user_id uuid, not identity.
  --   • Function EXECUTE is not involved: nothing here is called as an RPC.
  v_np  text   := 'public.notification_preferences';
  v_np_cols text[] := array['portal_enabled','email_enabled','whatsapp_enabled'];
  v_missing text := '';
  v_extra   text := '';
  v_badpol  text;
begin
  -- The five legacy tables, plus every comms_* table that actually exists.
  select array(
    select x from unnest(array['notifications','notification_events',
                               'notification_preferences','notification_delivery_log',
                               'email_deliveries']) x
    union
    -- ::text explicitly: relname is `name`, and a UNION of name with text relies
    -- on implicit resolution. 'p' as well as 'r' so a partitioned table is not
    -- silently skipped.
    select c.relname::text
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r','p') and c.relname like 'comms\_%'
  ) into v_targets;

  foreach t in array v_targets loop
    if to_regclass('public.' || quote_ident(t)) is null then
      raise notice 'ANON REVOKE — public.% is absent, skipped', t;
      continue;
    end if;

    -- ★ MAKE authenticated's PRIVILEGES DIRECT BEFORE REVOKING PUBLIC ★
    -- Exactly the hazard §13.c already handles for FUNCTIONS, which applies to
    -- TABLES for the same reason. `authenticated` is a MEMBER of PUBLIC, so
    -- `revoke ... from public` removes any privilege authenticated holds ONLY by
    -- inheritance. One real caller depends on these tables: lib/portal/account.ts
    -- reads and PATCHes notification_preferences directly through PostgREST with
    -- a user JWT.
    --
    -- ══ WHAT THE PREVIOUS VERSION OF THIS LOOP GOT WRONG (it aborted the run) ══
    -- It re-granted a privilege only when
    --     has_table_privilege(...) AND NOT <a direct row in role_table_grants>.
    -- Both halves are TABLE-LEVEL-ONLY probes:
    --   • has_table_privilege() answers "is this privilege held ON THE TABLE".
    --     A COLUMN-level grant does NOT make it true — that is precisely why
    --     PostgreSQL ships has_any_column_privilege() / has_column_privilege()
    --     as separate functions.
    --   • information_schema.role_table_grants lists table-level grants only;
    --     column grants live in information_schema.column_privileges.
    -- docs/phase0_migration.sql:781 grants authenticated
    --     update (portal_enabled, email_enabled, whatsapp_enabled)
    --       on public.notification_preferences
    -- i.e. UPDATE exists ONLY at column level. So on every database where the
    -- shipped migration was applied, has_table_privilege(...,'UPDATE') is FALSE,
    -- this loop skipped UPDATE, and the guard at the end of the block raised —
    -- while blaming a revoke that had never touched `authenticated` at all
    -- (the two revoke statements below name `anon` and `public`; neither can
    -- remove a grant whose grantee is `authenticated`).
    --
    -- THE FIX: probe BOTH granularities, and re-grant at the SAME granularity
    -- that was found. A table-level privilege is restated as table-level; a
    -- column-level privilege is restated column by column. Nothing is widened:
    -- every statement below can only restate access that exists at this instant,
    -- and it runs per table inside the same transaction as the revoke that would
    -- otherwise have removed it. Re-granting a privilege that is ALREADY direct
    -- is a harmless no-op, so no "is it already direct?" test is needed — and
    -- that test is what silently skipped the column case before.
    foreach v_priv in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
      if has_table_privilege('authenticated', format('public.%I', t), v_priv) then
        execute format('grant %s on table public.%I to authenticated', v_priv, t);
        v_preserved := v_preserved || ' ' || t || ':' || v_priv;
      elsif v_priv = any (array['SELECT','INSERT','UPDATE','REFERENCES']) then
        -- Not held on the table — but it can still be held on INDIVIDUAL
        -- COLUMNS, which the branch above is structurally unable to see. Only
        -- these four types can be granted per column in PostgreSQL; passing any
        -- other type to the column functions raises, so the list is explicit.
        for v_col in
          select a.attname::text
            from pg_attribute a
           where a.attrelid = to_regclass(format('public.%I', t))
             and a.attnum > 0 and not a.attisdropped
           order by a.attnum
        loop
          if has_column_privilege('authenticated', format('public.%I', t), v_col, v_priv) then
            execute format('grant %s (%I) on table public.%I to authenticated', v_priv, v_col, t);
            v_preserved := v_preserved || ' ' || t || ':' || v_priv || '(' || v_col || ')';
          end if;
        end loop;
      end if;
    end loop;

    -- Two statements, not one. A privilege held via PUBLIC is NOT removed by
    -- revoking from anon, and vice versa. Revoking one grantee and reporting
    -- success is exactly how a privilege survives a cleanup.
    --
    -- `revoke all` is the catch-all so a privilege type a future PostgreSQL adds
    -- is covered without editing this file. The explicit list that follows names
    -- the seven table privilege types that exist today, so the intent is legible
    -- in the file and does not depend on how ALL happens to expand.
    execute format('revoke all privileges on table public.%I from anon', t);
    execute format('revoke all privileges on table public.%I from public', t);
    execute format('revoke select, insert, update, delete, truncate, references, trigger
                      on table public.%I from anon', t);
    execute format('revoke select, insert, update, delete, truncate, references, trigger
                      on table public.%I from public', t);

    -- COLUMN-LEVEL ACLs, cleared explicitly and for the same reason the
    -- authenticated normalisation below does it: whether a table-level REVOKE
    -- also clears the matching column grants is a rule this file refuses to
    -- depend on, and a column grant is invisible to every table-level probe —
    -- which is the exact class of mistake that aborted the previous run.
    -- Driven off pg_attribute.attacl itself, so PUBLIC (grantee 0, which no
    -- *_privilege() function will accept as a role name) is covered the same way
    -- anon is. Only privileges actually present are revoked, so this emits no
    -- "no privileges could be revoked" warnings.
    for v_rec in
      select at.attname::text as col, a.privilege_type as pt,
             case when a.grantee = 0 then 'public' else 'anon' end as who
        from pg_attribute at
        cross join lateral aclexplode(at.attacl) a
       where at.attrelid = to_regclass(format('public.%I', t))
         and at.attnum > 0 and not at.attisdropped
         and (a.grantee = 0 or a.grantee = 'anon'::regrole)
    loop
      execute format('revoke %s (%I) on table public.%I from %s',
                     v_rec.pt, v_rec.col, t, v_rec.who);
    end loop;
  end loop;

  -- SEQUENCES. `revoke all on table` does not reach them. An identity column
  -- (comms_audit.id is `bigint generated always as identity`) owns a sequence,
  -- and USAGE/SELECT/UPDATE on a sequence are separate privileges. Discovered
  -- through pg_depend rather than by guessing a _id_seq naming convention.
  for v_seq in
    select distinct s.relname as seqname
      from pg_class s
      join pg_namespace sn on sn.oid = s.relnamespace
      join pg_depend d on d.objid = s.oid and d.classid = 'pg_class'::regclass
      join pg_class tb on tb.oid = d.refobjid
      join pg_namespace tn on tn.oid = tb.relnamespace
     where s.relkind = 'S' and sn.nspname = 'public' and tn.nspname = 'public'
       and d.deptype in ('a','i')
       and tb.relname::text = any (v_targets)
  loop
    v_nseq := v_nseq + 1;
    execute format('revoke all privileges on sequence public.%I from anon', v_seq.seqname);
    execute format('revoke all privileges on sequence public.%I from public', v_seq.seqname);
    execute format('revoke usage, select, update on sequence public.%I from anon', v_seq.seqname);
    execute format('revoke usage, select, update on sequence public.%I from public', v_seq.seqname);
  end loop;
  raise notice 'ANON REVOKE — % owned sequence(s) stripped of USAGE/SELECT/UPDATE.', v_nseq;

  -- VERIFY IN THE SAME TRANSACTION. No privilege_type filter: a check that
  -- enumerates the four CRUD verbs is a denylist wearing an allowlist's name,
  -- and that is precisely how REFERENCES/TRIGGER/TRUNCATE went unnoticed here.
  select string_agg(distinct table_name || ':' || privilege_type, ', ')
    into v_left
    from information_schema.role_table_grants
   where table_schema = 'public' and grantee in ('anon','PUBLIC')
     and table_name::text = any (v_targets);
  if v_left is not null then
    raise exception 'HUB FAIL: anon/PUBLIC still hold table privilege(s) after the revoke: %', v_left;
  end if;
  raise notice 'ANON REVOKE — anon/PUBLIC now hold NO table privilege of ANY type on % communications table(s).',
               array_length(v_targets, 1);
  if v_preserved <> '' then
    -- Every EFFECTIVE privilege authenticated held is listed, whether it was
    -- already direct (the re-grant was a no-op) or inherited from PUBLIC (the
    -- re-grant is what saved it). The list does not claim to separate the two:
    -- claiming a distinction the probe cannot draw is what produced the
    -- misleading "the revoke stripped authenticated" message this file used to
    -- raise. `name:PRIV` is table level, `name:PRIV(col)` is column level.
    raise notice 'ANON REVOKE — authenticated''s effective privileges were restated as DIRECT grants before '
                 'PUBLIC was revoked, at the granularity each was actually held:%', v_preserved;
  else
    raise notice 'ANON REVOKE — authenticated holds no privilege of any type on these tables.';
  end if;

  -- COLUMN-LEVEL RESIDUE. `revoke ... on table` does revoke the matching column
  -- privileges, but role_table_grants above cannot SEE a column grant, so on its
  -- own it would report "clean" for a table whose columns are still open. Read
  -- the ACLs directly: pg_class.relacl for the table, pg_attribute.attacl for
  -- every column. In an ACL, grantee 0 IS "PUBLIC".
  select string_agg(distinct z.who || ' ' || z.pt || ' on ' || z.obj || z.col, ', ')
    into v_left
  from (
    select c.relname::text as obj, a.privilege_type as pt, '' as col,
           case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as who
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      cross join lateral aclexplode(c.relacl) a
     where n.nspname = 'public' and c.relname::text = any (v_targets)
       and (a.grantee = 0 or a.grantee = 'anon'::regrole)
    union all
    select c.relname::text, a.privilege_type, '.' || at.attname,
           case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute at on at.attrelid = c.oid and at.attnum > 0 and not at.attisdropped
      cross join lateral aclexplode(at.attacl) a
     where n.nspname = 'public' and c.relname::text = any (v_targets)
       and (a.grantee = 0 or a.grantee = 'anon'::regrole)
  ) z;
  if v_left is not null then
    raise exception 'HUB FAIL: anon/PUBLIC still hold table OR COLUMN privilege(s) after the revoke: %', v_left;
  end if;

  -- ══════════════════════════════════════════════════════════════════════════
  -- ★ THE authenticated ALLOWLIST ON notification_preferences ★
  -- The contract is declared at the top of this block and is derived from the
  -- code. It is applied UNCONDITIONALLY here rather than "preserved", because
  -- preserving can only ever restate a privilege that already exists — and the
  -- privilege this caller needs was, on this database, held at COLUMN level
  -- where the old table-level probe could not see it.
  --
  -- NORMALISE, then GRANT — in three explicit steps, so that what follows is
  -- EXACTLY the allowlist and nothing else and no privilege that drifted in from
  -- an old pass survives. The table-level ACL and the column-level ACLs are
  -- cleared SEPARATELY rather than assuming the first reaches the second; STEP 2
  -- says why. It is one transaction, so there is no window in which the caller is
  -- without its grant, and it is idempotent: on a database already in the target
  -- state the end state is identical.
  --
  -- THE GRANTS ARE DIRECT. `to authenticated`, never relying on PUBLIC — the
  -- revoke two statements up is exactly what would take a PUBLIC-derived
  -- privilege away.
  -- ══════════════════════════════════════════════════════════════════════════
  if to_regclass(v_np) is not null then
    -- STEP 1 — clear the TABLE-level ACL.
    execute 'revoke all privileges on table public.notification_preferences from authenticated';

    -- STEP 2 — clear whatever survives at COLUMN level. Whether a table-level
    -- REVOKE also clears the matching column grants is a detail this file
    -- deliberately refuses to depend on: the repository's own
    -- docs/authz_fixD_profiles_direct_write_RUNME.sql:101 states one reading of
    -- that rule and the PostgreSQL REVOKE notes state another, and the whole
    -- reason this section is being rewritten is a column-level grant that a
    -- table-level assumption could not see. So the column ACLs are cleared
    -- explicitly. has_column_privilege() is asked AFTER step 1, so it now
    -- reports column-level residue only — nothing is revoked that was not held,
    -- which also keeps the run free of "no privileges could be revoked" noise.
    for v_col in
      select a.attname::text from pg_attribute a
       where a.attrelid = to_regclass(v_np) and a.attnum > 0 and not a.attisdropped
       order by a.attnum
    loop
      foreach v_priv in array array['SELECT','INSERT','UPDATE','REFERENCES'] loop
        if has_column_privilege('authenticated', v_np, v_col, v_priv) then
          execute format('revoke %s (%I) on table public.notification_preferences from authenticated',
                         v_priv, v_col);
        end if;
      end loop;
    end loop;

    -- STEP 3 — grant exactly the allowlist, DIRECTLY.
    execute 'grant select on table public.notification_preferences to authenticated';
    execute 'grant update (portal_enabled, email_enabled, whatsapp_enabled) on table public.notification_preferences to authenticated';
    raise notice 'AUTHENTICATED CONTRACT — notification_preferences normalised to: SELECT (table) + UPDATE (%).',
                 array_to_string(v_np_cols, ', ');

    -- VERIFY WHAT IS REQUIRED IS PRESENT — AND PRESENT AS A *DIRECT* GRANT.
    -- has_table_privilege() would also answer true for a privilege inherited
    -- from PUBLIC, which is the state this whole section exists to eliminate, so
    -- the check reads the ACL and demands the grantee literally be
    -- `authenticated`. A grant that arrives via PUBLIC does NOT satisfy it.
    if not exists (
      select 1
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        cross join lateral aclexplode(c.relacl) a
       where n.nspname = 'public' and c.relname = 'notification_preferences'
         and a.grantee = 'authenticated'::regrole and a.privilege_type = 'SELECT')
    then
      raise exception 'HUB FAIL: authenticated has no DIRECT table SELECT on notification_preferences — '
                      'lib/portal/account.ts:32 reads it through PostgREST with a user JWT (select=*) '
                      'and lib/portal/account.ts:42 needs it again to return the PATCHed row.';
    end if;

    foreach v_col in array v_np_cols loop
      if not exists (
        select 1
          from pg_attribute at
          cross join lateral aclexplode(at.attacl) a
         where at.attrelid = to_regclass(v_np) and at.attname = v_col and not at.attisdropped
           and a.grantee = 'authenticated'::regrole and a.privilege_type = 'UPDATE')
      then
        v_missing := v_missing || ' ' || v_col;
      end if;
    end loop;
    if v_missing <> '' then
      raise exception 'HUB FAIL: authenticated has no DIRECT column UPDATE on notification_preferences(%) — '
                      'lib/portal/account.ts:42 PATCHes exactly these columns and would break.', trim(v_missing);
    end if;

    -- VERIFY WHAT IS NOT REQUIRED IS ABSENT. An allowlist that only checks the
    -- privileges it wants is a wish list; this half is what makes it an
    -- allowlist. Every type PostgreSQL defines is named, at both granularities.
    foreach v_priv in array array['INSERT','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
      if has_table_privilege('authenticated', v_np, v_priv) then
        v_extra := v_extra || ' ' || v_priv;
      end if;
    end loop;
    foreach v_priv in array array['INSERT','REFERENCES'] loop
      if has_any_column_privilege('authenticated', v_np, v_priv) then
        v_extra := v_extra || ' ' || v_priv || '(column)';
      end if;
    end loop;
    -- No column outside the three may be updatable. user_id is the one that
    -- matters: a user who can write user_id can hand its own preference row to
    -- somebody else, and a WITH CHECK is then the only thing standing in the
    -- way. Here it cannot be written at all.
    for v_col in
      select a.attname::text from pg_attribute a
       where a.attrelid = to_regclass(v_np) and a.attnum > 0 and not a.attisdropped
       order by a.attnum
    loop
      if not (v_col = any (v_np_cols))
         and has_column_privilege('authenticated', v_np, v_col, 'UPDATE') then
        v_extra := v_extra || ' UPDATE(' || v_col || ')';
      end if;
    end loop;
    if v_extra <> '' then
      raise exception 'HUB FAIL: authenticated holds privilege(s) on notification_preferences that no code path '
                      'uses, so nothing would ever catch them being wrong:%', v_extra;
    end if;

    -- ★ ROW ISOLATION — CHECKED HERE, NOT ASSUMED ★
    -- A table grant is worth exactly as much as the policy behind it. The grant
    -- above lets `authenticated` reach the table; only row level security decides
    -- WHICH ROW. Three things are verified, because each one on its own is
    -- insufficient:
    --   1. RLS is actually enabled. A grant on a table with RLS off hands every
    --      user every other user's preferences.
    --   2. No permissive policy is unconditionally true. `using (true)` with an
    --      UPDATE grant is how one user rewrites another user's row.
    --   3. The UPDATE path has an effective WITH CHECK scoped by auth.uid().
    --      PostgreSQL falls back to the USING expression when WITH CHECK is
    --      absent, so the fallback is evaluated here rather than reported as a
    --      hole that is not one.
    -- The strongest guarantee is structural and was already established above:
    -- user_id is NOT in the updatable column set, so the row cannot be re-pointed
    -- at another user even if a policy were wrong.
    if not (select c.relrowsecurity from pg_class c where c.oid = to_regclass(v_np)) then
      raise exception 'HUB FAIL: row level security is OFF on notification_preferences — the SELECT/UPDATE '
                      'grant above would expose every user''s row to every other logged-in user, for reading '
                      'and for writing.';
    end if;

    select string_agg(z.polname || ' (' || z.cmd || ')', ', ')
      into v_badpol
    from (
      select p.polname::text as polname,
             case p.polcmd when 'r' then 'select' when 'a' then 'insert' when 'w' then 'update'
                           when 'd' then 'delete' else 'all' end as cmd,
             p.polcmd as polcmd,
             coalesce(pg_get_expr(p.polqual, p.polrelid), '') as q,
             -- The documented fallback: an UPDATE/ALL policy with no WITH CHECK
             -- uses its USING expression as the check.
             coalesce(nullif(coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''), ''),
                      coalesce(pg_get_expr(p.polqual, p.polrelid), '')) as wc
        from pg_policy p
       where p.polrelid = to_regclass(v_np) and p.polpermissive
    ) z
    -- An INSERT policy (polcmd 'a') legitimately has NO USING expression —
    -- PostgreSQL does not accept one — so an empty qual is only a finding for the
    -- other command types. Flagging it there too would be a false alarm that
    -- taught the next reader to ignore this check.
    where (z.polcmd <> 'a' and (z.q = '' or z.q = 'true'))
       or (z.polcmd in ('w','a','*') and (z.wc = '' or z.wc = 'true' or z.wc !~ 'auth\.uid\(\)'));
    if v_badpol is not null then
      raise exception 'HUB FAIL: notification_preferences has a permissive policy that is not scoped to the '
                      'caller''s own row, so the grant above is not row-isolated: %', v_badpol;
    end if;

    if not exists (
      select 1 from pg_policy p
       where p.polrelid = to_regclass(v_np) and p.polpermissive and p.polcmd in ('r','*')
         and coalesce(pg_get_expr(p.polqual, p.polrelid), '') ~ 'auth\.uid\(\)')
    then
      raise exception 'HUB FAIL: notification_preferences has no own-row SELECT policy keyed on auth.uid() — '
                      'with the table SELECT granted above, a logged-in user could read every other user''s row.';
    end if;
    if not exists (
      select 1 from pg_policy p
       where p.polrelid = to_regclass(v_np) and p.polpermissive and p.polcmd in ('w','*')
         and coalesce(pg_get_expr(p.polqual, p.polrelid), '') ~ 'auth\.uid\(\)')
    then
      raise exception 'HUB FAIL: notification_preferences has no own-row UPDATE policy keyed on auth.uid() — '
                      'lib/portal/account.ts:42 would either fail or write somebody else''s row.';
    end if;

    -- NON-VACUITY OF THE PRIVILEGE PROBE ITSELF. The two halves above are
    -- answered by the same function on the same table: three columns must read
    -- TRUE and every other column must read FALSE. A probe stuck on true fails
    -- the second half; a probe stuck on false fails the first. Neither can
    -- report success. The same holds for the policy probe: it must find a
    -- scoped policy (the two `not exists` checks) AND find no unscoped one.
    raise notice 'AUTHENTICATED CONTRACT — verified DIRECT: SELECT on the table, UPDATE on % column(s), '
                 'nothing else of any type at either granularity, RLS on, own-row policies keyed on auth.uid().',
                 array_length(v_np_cols, 1);
  end if;
end $anon_tables$;

-- ─── 13.c THE PUBLIC-CALLABLE FUNCTION ALLOWLIST ────────────────────────────
-- Separate statement class, separate catalogue, separate block — on purpose.
-- Nothing above touched EXECUTE, and nothing here touches a table privilege.
--
-- THE ALLOWLIST, by name AND signature. Exactly one entry:
--   public.submit_opportunity_request(text,text,text,text,text,text,jsonb,boolean)
-- It qualifies on every count the standard requires:
--   SECURITY DEFINER      — yes, with `set search_path = public` pinned.
--   payload-validated     — p_type checked against a closed 10-value list,
--                           p_full_name required non-blank, p_consent must be true.
--   rate-limited          — public_portal_rate_limit_RUNME.sql wraps it in
--                           rl_consume() before any row is written.
--   no caller-selected recipient — the caller cannot name who gets notified. The
--                           recipient set is derived server-side from
--                           profiles.staff_role matched against the request type;
--                           no parameter reaches public.notify()'s target.
--   grants no table access — being SECURITY DEFINER, it runs as its owner; anon
--                           holds nothing on any table it writes.
-- NOTHING in the communications surface is allowlisted. The revoke below is
-- therefore total for that surface.
--
-- WHY authenticated IS GRANTED BEFORE PUBLIC IS REVOKED, and why that is not a
-- widening: PostgreSQL grants EXECUTE to PUBLIC on every newly created function,
-- and `authenticated` is a member of PUBLIC. If a staff-facing RPC has only ever
-- held that default grant, a bare `revoke ... from public` would take it away
-- from logged-in staff too and break the admin UI. Re-granting to authenticated
-- first preserves exactly the access authenticated already had — it adds none.
-- ONE HONEST SIDE EFFECT: that access stops being implicit (via PUBLIC) and
-- becomes an explicit grant. The effective permission is identical today, but a
-- future `revoke ... from public` will no longer remove it. That is stated here
-- rather than discovered later.
-- Tightening `authenticated` is a different question with a different blast
-- radius and is NOT in this phase's scope.
do $anon_functions$
declare
  r record;
  v_allowlist text[] := array[
    'submit_opportunity_request(text,text,text,text,text,text,jsonb,boolean)'
  ];
  v_sig text;
  v_n int := 0;
  v_left text;
  v_secdef boolean;
  v_cfg text;
begin
  for r in
    select p.oid,
           p.proname,
           pg_get_function_identity_arguments(p.oid) as args,
           p.prosecdef,
           coalesce(array_to_string(p.proconfig, ','), '') as cfg
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and (p.proname like 'comms\_%'
         or p.proname like 'notification%'
         or p.proname like 'notify%')
  loop
    v_sig := r.proname || '(' || r.args || ')';
    if v_sig = any (v_allowlist) then
      raise notice 'FUNCTION ALLOWLIST — public.% is allowlisted, left as is', v_sig;
      continue;
    end if;
    if not has_function_privilege('anon', r.oid, 'EXECUTE') then
      continue;  -- already closed; nothing to preserve, nothing to revoke
    end if;
    -- Preserve what authenticated/service_role hold via PUBLIC, then close anon.
    execute format('grant execute on function public.%I(%s) to authenticated, service_role', r.proname, r.args);
    execute format('revoke execute on function public.%I(%s) from public', r.proname, r.args);
    execute format('revoke execute on function public.%I(%s) from anon',   r.proname, r.args);
    v_n := v_n + 1;
  end loop;
  raise notice 'FUNCTION ALLOWLIST — EXECUTE closed to anon/PUBLIC on % communications function(s).', v_n;

  -- The allowlisted RPC must still be callable, and must still deserve to be.
  -- If the public opportunities form is dead, that is a failure of this file.
  if to_regprocedure('public.submit_opportunity_request(text,text,text,text,text,text,jsonb,boolean)') is not null then
    if not has_function_privilege('anon',
         'public.submit_opportunity_request(text,text,text,text,text,text,jsonb,boolean)', 'EXECUTE') then
      raise exception 'HUB FAIL: the allowlisted public RPC lost anon EXECUTE — the opportunities form is broken';
    end if;
    -- Dedicated scalars, NOT the loop's record variable: `select into` rebinds a
    -- record's fields to the select list's output names, so reusing `r` here
    -- would silently read a differently-shaped row.
    select p.prosecdef, coalesce(array_to_string(p.proconfig, ','), '')
      into v_secdef, v_cfg
      from pg_proc p
     where p.oid = 'public.submit_opportunity_request(text,text,text,text,text,text,jsonb,boolean)'::regprocedure;
    if not coalesce(v_secdef, false) then
      raise exception 'HUB FAIL: the allowlisted public RPC is not SECURITY DEFINER';
    end if;
    if coalesce(v_cfg, '') not ilike '%search_path%' then
      raise exception 'HUB FAIL: the allowlisted public RPC has no pinned search_path';
    end if;
  else
    raise notice 'FUNCTION ALLOWLIST — submit_opportunity_request absent on this database; nothing to preserve.';
  end if;

  -- No unallowlisted communications function may remain anon-callable.
  select string_agg(distinct routine_name, ', ') into v_left
    from information_schema.routine_privileges
   where routine_schema = 'public' and grantee in ('anon','PUBLIC')
     and (routine_name like 'comms\_%' or routine_name like 'notification%'
       or routine_name like 'notify%');
  if v_left is not null then
    raise exception 'HUB FAIL: anon/PUBLIC still hold EXECUTE on communications function(s): %', v_left;
  end if;
end $anon_functions$;

-- ════════════════════════════════════════════════════════════════════════════
-- §90 SELF-TESTS — STATIC ONLY.
--     No protected RPC is called here. The SQL editor runs as postgres with
--     auth.uid() = NULL, so calling one would raise "not authorized" and abort
--     the migration. Every assertion below reads the catalogue or the function
--     body via pg_get_functiondef + ilike (the deparser uppercases keywords,
--     hence ilike). Nothing is wrapped in a catch-all that would pass anyway.
-- ════════════════════════════════════════════════════════════════════════════
do $selftest$
declare v_def text; v_flat text; v_seg text; t text; f text; v_n int;
begin
  -- (1) Every table exists.
  foreach t in array array['comms_channels','comms_event_catalog','comms_templates',
                           'comms_outbox','comms_preferences','comms_rate_counters','comms_audit'] loop
    if to_regclass('public.' || t) is null then
      raise exception 'HUB FAIL: table public.% missing', t;
    end if;
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then
      raise exception 'HUB FAIL: RLS not enabled on public.%', t;
    end if;
  end loop;

  -- (2) Every function exists with the exact signature the grants used.
  foreach f in array array[
    'public.comms_is_external(uuid)', 'public.comms_is_staff()',
    'public.comms_can_view()', 'public.comms_can_admin()',
    'public.comms_body_has_restricted_content(text)', 'public.comms_outbox_guard()',
    'public.comms_rate_check(text,int,int)', 'public.comms_audit_write(text,text,text,jsonb)',
    'public.comms_render(text,jsonb)', 'public.comms_resolve(text,text,uuid,uuid,uuid,jsonb)',
    'public.comms_enqueue(text,text,uuid,uuid,uuid,jsonb,uuid)',
    'public.comms_claim(int,uuid[])', 'public.comms_settle(uuid,text,text,text,jsonb,text,text)',
    'public.comms_reap()', 'public.comms_retry(uuid)', 'public.comms_cancel(uuid,text)',
    'public.comms_preview(text,text,text,jsonb)',
    'public.comms_channel_set(text,boolean,boolean,text)',
    'public.comms_template_publish(text,text,text,text,text)',
    'public.comms_dashboard(text,text,text,text,timestamptz,timestamptz,int,int)',
    'public.comms_health()', 'public.comms_prefs_get()',
    'public.comms_prefs_set(text,boolean,boolean,boolean,text)',
    'public.comms_adapter_import_legacy(int)'] loop
    if to_regprocedure(f) is null then raise exception 'HUB FAIL: function % missing', f; end if;
  end loop;

  -- (3) NULL DISCIPLINE: every predicate coalesces. A NULL predicate caused a
  --     real fail-open incident in this codebase.
  foreach f in array array['public.comms_is_external(uuid)', 'public.comms_is_staff()',
                           'public.comms_can_view()', 'public.comms_can_admin()',
                           'public.comms_body_has_restricted_content(text)'] loop
    v_def := pg_get_functiondef(f::regprocedure);
    if v_def !~* 'coalesce' then
      raise exception 'HUB FAIL: % does not coalesce — it can return NULL', f;
    end if;
    if v_def !~* 'set +search_path' then
      raise exception 'HUB FAIL: % has no pinned search_path', f;
    end if;
  end loop;

  -- (3b) comms_is_external must fail CLOSED (unknown user ⇒ true ⇒ external).
  v_def := pg_get_functiondef('public.comms_is_external(uuid)'::regprocedure);
  if v_def !~* 'coalesce\s*\(' or v_def !~* 'true\s*\)' then
    raise exception 'HUB FAIL: comms_is_external must default an unknown user to TRUE (external)';
  end if;

  -- (4) Every SECURITY DEFINER function in this module pins search_path.
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'comms\_%'
     and p.prosecdef and not (coalesce(array_to_string(p.proconfig, ','), '') like '%search_path%');
  if v_n > 0 then
    raise exception 'HUB FAIL: % SECURITY DEFINER comms_* function(s) without a pinned search_path', v_n;
  end if;

  -- (5) RULE R1 and RULE R2 are physically present in the guard.
  v_def := pg_get_functiondef('public.comms_outbox_guard()'::regprocedure);
  if v_def !~* 'COMMS R1' then raise exception 'HUB FAIL: R1 not enforced in comms_outbox_guard'; end if;
  if v_def !~* 'COMMS R2' then raise exception 'HUB FAIL: R2 not enforced in comms_outbox_guard'; end if;
  if v_def !~* 'comms_is_external' then
    raise exception 'HUB FAIL: the guard must RECOMPUTE externality, not trust the caller';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 't_comms_outbox_guard'
                   and tgrelid = 'public.comms_outbox'::regclass and not tgisinternal) then
    raise exception 'HUB FAIL: trigger t_comms_outbox_guard is not attached to comms_outbox';
  end if;

  -- (6) comms_settle refuses a live "sent" without provider acknowledgment.
  v_def := pg_get_functiondef('public.comms_settle(uuid,text,text,text,jsonb,text,text)'::regprocedure);
  if v_def !~* 'no_provider_ack' then
    raise exception 'HUB FAIL: comms_settle must refuse a live send without provider ack';
  end if;

  -- (7) The full state vocabulary is on the CHECK constraint.
  foreach t in array array['queued','processing','sent','delivered','failed','retrying','dead_letter','cancelled'] loop
    if not exists (
      select 1 from pg_constraint c
      where c.conrelid = 'public.comms_outbox'::regclass and c.contype = 'c'
        and pg_get_constraintdef(c.oid) ilike '%status%' and pg_get_constraintdef(c.oid) like '%''' || t || '''%')
    then raise exception 'HUB FAIL: status % missing from the comms_outbox CHECK', t; end if;
  end loop;

  -- (8) NO ANON. Not on a table, not on a function.
  if exists (select 1 from information_schema.role_table_grants
              where table_schema = 'public' and table_name like 'comms\_%'
                and grantee in ('anon','PUBLIC')) then
    raise exception 'HUB FAIL: anon/PUBLIC holds a grant on a comms_* table';
  end if;
  if exists (select 1 from information_schema.routine_privileges
              where routine_schema = 'public' and routine_name like 'comms\_%'
                and grantee in ('anon','PUBLIC')) then
    raise exception 'HUB FAIL: anon/PUBLIC holds EXECUTE on a comms_* function';
  end if;

  -- (9) The service-only surface is genuinely service-only.
  foreach f in array array['comms_enqueue','comms_claim','comms_settle','comms_reap',
                           'comms_resolve','comms_rate_check','comms_audit_write'] loop
    if exists (select 1 from information_schema.routine_privileges
                where routine_schema = 'public' and routine_name = f
                  and grantee = 'authenticated') then
      raise exception 'HUB FAIL: % must not be callable by authenticated', f;
    end if;
    if not exists (select 1 from information_schema.routine_privileges
                    where routine_schema = 'public' and routine_name = f
                      and grantee = 'service_role') then
      raise exception 'HUB FAIL: service_role lost EXECUTE on %', f;
    end if;
  end loop;

  -- (9b) THE COUNTING RULE, asserted statically. Calling comms_health() here
  --      would hit its own comms_can_view() gate under auth.uid() = NULL and
  --      abort the migration, so the assertion reads the function BODY.
  --
  -- ⚠️ WHY THIS WAS REWRITTEN. The previous form was
  --        if v_def !~* $re$'sent_live'[^)]*legacy_email_deliveries$re$
  --    and it can NEVER match a correct function: [^)] cannot cross a ')', and
  --    the ')' of count(*) appears immediately after the sent_live label. So a
  --    perfectly correct comms_health failed its own guard and rolled the whole
  --    migration back. Same class as the earlier case-sensitive LIKE that could
  --    not match a deparsed COALESCE: an assertion that cannot pass is not a
  --    strict test, it is a broken one.
  --
  -- The replacement is STRICTER, not looser, in three ways:
  --    (a) pg_get_functiondef returns the body AS WRITTEN, i.e. line-wrapped, so
  --        whitespace is normalised FIRST and no pattern has to guess at layout;
  --    (b) it checks BOTH live counters, where the old one checked one;
  --    (c) it checks every conjunct of the counting rule, not just the legacy
  --        provider string.
  --
  -- WHY IT STILL FAILS IF SOMEBODY REMOVES AN EXCLUSION — reasoning, not hope:
  -- v_seg is the text BETWEEN the sent_live label and the delivered label, i.e.
  -- exactly one counter's own predicate and nothing else. A conjunct that
  -- survives only on the OTHER counter is therefore outside v_seg and cannot
  -- satisfy the check. position() is a plain substring test on that slice, so
  -- deleting `and not is_legacy_mirror` from sent_live removes the only
  -- occurrence inside v_seg, position() returns 0, and the migration aborts.
  -- The same argument holds for the delivered slice, bounded by the
  -- mirrored_legacy label. And v_seg being NULL — the failure mode that would
  -- make every position() vacuously skipped — is itself an exception below.
  -- Comments are stripped BEFORE whitespace is normalised, so no assertion here
  -- can ever be satisfied by prose that merely describes the rule. (Flattening
  -- first would be wrong: with the newlines gone, a `--` comment would swallow
  -- the rest of the body.)
  v_flat := regexp_replace(pg_get_functiondef(to_regprocedure('public.comms_health()')),
                           '--[^' || chr(10) || ']*', ' ', 'g');
  v_flat := regexp_replace(v_flat, '\s+', ' ', 'g');

  v_seg := substring(v_flat from $re$'sent_live', (.*?)'delivered',$re$);
  if v_seg is null then
    raise exception 'HUB FAIL: comms_health has no sent_live counter followed by a delivered counter — the counting rule cannot be verified';
  end if;
  -- NON-VACUITY CONTROL. If position() ever stopped discriminating (an empty
  -- slice, a pattern that matches everything) this would pass a token that is
  -- provably absent, and the whole block below would be theatre.
  if position('legacy_email_deliveries_THIS_TOKEN_MUST_NOT_EXIST' in v_seg) > 0 then
    raise exception 'HUB FAIL: the sent_live assertion is vacuous — it matches a token that does not exist';
  end if;
  foreach t in array array[
      $c$source_kind = 'native'$c$,
      $c$not is_legacy_mirror$c$,
      $c$delivery_mode = 'live'$c$,
      $c$provider_state in ('accepted','delivered')$c$,
      $c$<> 'legacy_email_deliveries'$c$] loop
    if position(t in v_seg) = 0 then
      raise exception 'HUB FAIL: comms_health.sent_live lost the "%" condition — something that is not a proven send could be counted as a live send', t;
    end if;
  end loop;

  v_seg := substring(v_flat from $re$'delivered', (.*?)'mirrored_legacy',$re$);
  if v_seg is null then
    raise exception 'HUB FAIL: comms_health has no delivered counter followed by a mirrored_legacy counter';
  end if;
  if position('legacy_email_deliveries_THIS_TOKEN_MUST_NOT_EXIST' in v_seg) > 0 then
    raise exception 'HUB FAIL: the delivered assertion is vacuous — it matches a token that does not exist';
  end if;
  foreach t in array array[
      $c$source_kind = 'native'$c$,
      $c$not is_legacy_mirror$c$,
      $c$delivery_mode = 'live'$c$,
      $c$provider_state = 'delivered'$c$,     -- acceptance is not delivery
      $c$<> 'legacy_email_deliveries'$c$] loop
    if position(t in v_seg) = 0 then
      raise exception 'HUB FAIL: comms_health.delivered lost the "%" condition — delivery would be reported without delivery evidence', t;
    end if;
  end loop;

  -- Every never-live category is reported under its own honest name.
  foreach t in array array['mirrored_legacy','imported','provider_unavailable',
                           'relay_handler_missing','claimed_sent_without_evidence',
                           'sent_dry_run','live_total'] loop
    if position('''' || t || '''' in v_flat) = 0 then
      raise exception 'HUB FAIL: comms_health does not report % as its own bucket', t;
    end if;
  end loop;

  -- (9c) PROVENANCE IS DATA. The counters above are only trustworthy if the
  --      columns they read cannot be set to a lie.
  foreach t in array array['source_kind','is_legacy_mirror','delivery_mode','provider_state'] loop
    if not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'comms_outbox'
                      and column_name = t and is_nullable = 'NO') then
      raise exception 'HUB FAIL: comms_outbox.% is missing or nullable — provenance must be explicit and total', t;
    end if;
  end loop;
  foreach t in array array['comms_outbox_source_kind_ck','comms_outbox_delivery_mode_ck',
                           'comms_outbox_provider_state_ck','comms_outbox_provenance_consistent_ck',
                           'comms_outbox_delivery_mode_matches_dry_run_ck',
                           'comms_outbox_mirror_never_live_ck'] loop
    if not exists (select 1 from pg_constraint
                    where conrelid = 'public.comms_outbox'::regclass
                      and contype = 'c' and conname = t and convalidated) then
      raise exception 'HUB FAIL: validated CHECK constraint % is missing from comms_outbox', t;
    end if;
  end loop;
  -- ★ R0 is enforced by a CHECK (survives a disabled trigger) AND by the guard.
  if pg_get_constraintdef((select oid from pg_constraint
                            where conrelid = 'public.comms_outbox'::regclass
                              and conname = 'comms_outbox_mirror_never_live_ck'))
     !~* 'is_legacy_mirror' then
    raise exception 'HUB FAIL: the mirror-never-live CHECK does not mention is_legacy_mirror';
  end if;
  v_def := pg_get_functiondef('public.comms_outbox_guard()'::regprocedure);
  if v_def !~* 'COMMS R0' then
    raise exception 'HUB FAIL: R0 (a mirror can never be stored as a live send) is not enforced in comms_outbox_guard';
  end if;
  if v_def !~* 'new\.delivery_mode\s*:=' or v_def !~* 'new\.is_legacy_mirror\s*:=' then
    raise exception 'HUB FAIL: the guard must RE-DERIVE provenance, not trust the writer';
  end if;
  -- The importer must state provenance rather than leave it to the default.
  v_def := pg_get_functiondef('public.comms_adapter_import_legacy(int)'::regprocedure);
  foreach t in array array['source_kind','is_legacy_mirror','delivery_mode','provider_state',
                           'legacy_mirror','unavailable'] loop
    if position(t in v_def) = 0 then
      raise exception 'HUB FAIL: comms_adapter_import_legacy does not set % explicitly', t;
    end if;
  end loop;
  -- comms_settle must record evidence, and must not accept 'delivered' as proof
  -- of itself.
  v_def := pg_get_functiondef('public.comms_settle(uuid,text,text,text,jsonb,text,text)'::regprocedure);
  if position('provider_state = v_pstate' in v_def) = 0 then
    raise exception 'HUB FAIL: comms_settle does not record provider_state';
  end if;
  if v_def !~* 'v_delivered' then
    raise exception 'HUB FAIL: comms_settle accepts a delivered outcome without delivery evidence';
  end if;

  -- (9d) ANONYMOUS DIRECT TABLE ACCESS IS ZERO — ACROSS ALL PRIVILEGE TYPES.
  --      NO privilege_type filter. The previous version of this assertion named
  --      REFERENCES/TRIGGER/TRUNCATE and treated a residual SELECT or INSERT as
  --      "a pre-existing condition to report". That is what let CRUD sit here.
  --      §13.b now revokes everything, so anything left is a failure.
  select count(*) into v_n
    from information_schema.role_table_grants
   where table_schema = 'public' and grantee in ('anon','PUBLIC')
     and (table_name like 'comms\_%'
       or table_name in ('notifications','notification_events','notification_preferences',
                         'notification_delivery_log','email_deliveries'));
  if v_n > 0 then
    raise exception 'HUB FAIL: anon/PUBLIC still hold % table privilege(s) of some type on the communications tables', v_n;
  end if;

  -- (9d-ii) NON-VACUITY. If the catalogue view returns nothing for anon
  --         ANYWHERE in public, the check above passes because it is blind, not
  --         because the tables are clean. anon legitimately holds privileges on
  --         other public tables, so an empty result means the probe is broken.
  select count(*) into v_n
    from information_schema.role_table_grants
   where table_schema = 'public' and grantee in ('anon','PUBLIC');
  if v_n = 0 then
    raise exception 'HUB FAIL: the anon privilege probe returned nothing anywhere in public — the check is vacuous, not passing';
  end if;

  -- (9d-iii) SEQUENCES. Revoking table privileges never touches a sequence.
  select count(*) into v_n
    from information_schema.usage_privileges u
   where u.object_schema = 'public' and u.object_type = 'SEQUENCE'
     and u.grantee in ('anon','PUBLIC')
     and exists (
       select 1
         from pg_class s
         join pg_namespace sn on sn.oid = s.relnamespace
         join pg_depend d on d.objid = s.oid and d.classid = 'pg_class'::regclass
         join pg_class tb on tb.oid = d.refobjid
        where s.relkind = 'S' and sn.nspname = 'public'
          and s.relname::text = u.object_name::text
          and d.deptype in ('a','i')
          and (tb.relname::text like 'comms\_%'
            or tb.relname::text in ('notifications','notification_events',
                                    'notification_preferences','notification_delivery_log',
                                    'email_deliveries')));
  if v_n > 0 then
    raise exception 'HUB FAIL: anon/PUBLIC still hold % privilege(s) on sequences owned by the communications tables', v_n;
  end if;

  -- (9d-iv) THE authenticated CONTRACT SURVIVED THE WHOLE FILE.
  --         §13.b normalises public.notification_preferences to exactly
  --         SELECT (table) + UPDATE (portal_enabled, email_enabled,
  --         whatsapp_enabled), granted DIRECTLY. §13.b verifies that at the
  --         moment it runs; this re-verifies it at the END of the migration, so
  --         a later section that widened or narrowed it cannot slip through.
  --         Read from the ACL, not from has_table_privilege(): the point of the
  --         grant is that it is DIRECT, and has_table_privilege() cannot tell a
  --         direct grant from one inherited via PUBLIC.
  if to_regclass('public.notification_preferences') is not null then
    select count(*) into v_n
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      cross join lateral aclexplode(c.relacl) a
     where n.nspname = 'public' and c.relname = 'notification_preferences'
       and a.grantee = 'authenticated'::regrole and a.privilege_type = 'SELECT';
    if v_n = 0 then
      raise exception 'HUB FAIL: authenticated lost its DIRECT SELECT on notification_preferences before COMMIT — '
                      'lib/portal/account.ts:32 reads it with a user JWT';
    end if;
    select count(distinct at.attname) into v_n
      from pg_attribute at
      cross join lateral aclexplode(at.attacl) a
     where at.attrelid = to_regclass('public.notification_preferences')
       and at.attname = any (array['portal_enabled','email_enabled','whatsapp_enabled'])
       and a.grantee = 'authenticated'::regrole and a.privilege_type = 'UPDATE';
    if v_n <> 3 then
      raise exception 'HUB FAIL: authenticated holds DIRECT column UPDATE on only % of the 3 preference columns — '
                      'lib/portal/account.ts:42 PATCHes all three', v_n;
    end if;
    if has_table_privilege('authenticated', 'public.notification_preferences', 'TRUNCATE')
       or has_table_privilege('authenticated', 'public.notification_preferences', 'REFERENCES')
       or has_table_privilege('authenticated', 'public.notification_preferences', 'TRIGGER')
       or has_table_privilege('authenticated', 'public.notification_preferences', 'INSERT')
       or has_table_privilege('authenticated', 'public.notification_preferences', 'DELETE') then
      raise exception 'HUB FAIL: authenticated holds a privilege on notification_preferences that no code path uses';
    end if;
    if has_column_privilege('authenticated', 'public.notification_preferences', 'user_id', 'UPDATE') then
      raise exception 'HUB FAIL: authenticated can UPDATE notification_preferences.user_id — a preference row could '
                      'be re-pointed at another user';
    end if;
  end if;

  -- (10) CHANNELS SHIP SAFE: nothing may send after this migration.
  if exists (select 1 from public.comms_channels where channel in ('email','whatsapp') and enabled) then
    raise exception 'HUB FAIL: email/whatsapp must ship DISABLED';
  end if;
  if exists (select 1 from public.comms_channels where not dry_run) then
    raise exception 'HUB FAIL: every channel must ship dry_run = true';
  end if;

  -- (11) The catalogue and the templates are seeded, Arabic AND English.
  select count(*) into v_n from public.comms_event_catalog where active;
  if v_n < 10 then raise exception 'HUB FAIL: event catalogue is not seeded (% rows)', v_n; end if;
  if not exists (select 1 from public.comms_templates where locale = 'ar' and is_active) then
    raise exception 'HUB FAIL: no active Arabic template';
  end if;
  if not exists (select 1 from public.comms_templates where locale = 'en' and is_active) then
    raise exception 'HUB FAIL: no active English template';
  end if;
  if not exists (select 1 from public.comms_templates where audience_scope = 'client' and is_active) then
    raise exception 'HUB FAIL: no active client-scoped template';
  end if;

  -- (12) No client-scoped template exists for an internal-only event.
  if exists (select 1 from public.comms_templates t
               join public.comms_event_catalog c on c.event_key = t.event_key
              where t.audience_scope = 'client' and c.audience = 'internal') then
    raise exception 'HUB FAIL: a client template exists for an internal-only event';
  end if;

  -- (13) The adapter is one-way: it must never write to email_deliveries, and it
  --      must leave the legacy queue's LIVE rows alone.
  v_def := pg_get_functiondef('public.comms_adapter_import_legacy(int)'::regprocedure);
  if v_def ~* '(update|insert +into|delete +from)\s+public\.email_deliveries' then
    raise exception 'HUB FAIL: the legacy adapter must be READ ONLY on email_deliveries';
  end if;
  if v_def !~* 'status in \(''sent'',''failed'',''bounced''\)' then
    raise exception 'HUB FAIL: the legacy adapter must mirror TERMINAL rows only';
  end if;

  -- (13b) A mirrored legacy row can never be retried from the hub (double-send).
  v_def := pg_get_functiondef('public.comms_retry(uuid)'::regprocedure);
  if v_def !~* 'legacy_mirror_not_retryable' then
    raise exception 'HUB FAIL: comms_retry must refuse mirrored legacy rows';
  end if;

  -- (14) The idempotency index exists and is partial.
  if not exists (select 1 from pg_indexes where schemaname = 'public'
                   and indexname = 'uq_comms_outbox_idem'
                   and indexdef ilike '%unique%' and indexdef ilike '%where%') then
    raise exception 'HUB FAIL: partial unique idempotency index missing';
  end if;

  -- (15) THE BROWSER-RELAY REPLACEMENT. /api/comms/legacy-notify maps the five
  --       surviving legacy browser events onto these catalogue keys. If one is
  --       missing the adapter answers UNKNOWN_EVENT and the notification is
  --       silently lost, which is exactly the failure mode this phase exists to
  --       end. Each key is asserted individually so the error names the gap.
  foreach t in array array['deliverable.preview_sent','deliverable.final_ready',
                           'project.member_assigned','project.assignment_note',
                           'deliverable.client_commented'] loop
    if not exists (select 1 from public.comms_event_catalog where event_key = t and active) then
      raise exception 'HUB FAIL: legacy-adapter event % is missing from the catalogue', t;
    end if;
  end loop;

  -- (15b) Those five are the ones a BROWSER can trigger. None of them may be
  --       financial: a browser-triggered event must never carry money to a
  --       client, whatever the template says later.
  if exists (select 1 from public.comms_event_catalog
              where event_key in ('deliverable.preview_sent','deliverable.final_ready',
                                  'project.member_assigned','project.assignment_note',
                                  'deliverable.client_commented')
                and is_financial) then
    raise exception 'HUB FAIL: a browser-triggerable event is marked financial';
  end if;

  -- (15c) An assignment note is internal. If it were ever flipped to client or
  --       both, a private instruction to a staff member would reach a client.
  if exists (select 1 from public.comms_event_catalog
              where event_key in ('project.assignment_note','project.member_assigned')
                and audience <> 'internal') then
    raise exception 'HUB FAIL: assignment events must stay internal-only';
  end if;

  raise notice 'COMMUNICATIONS HUB SELF-TEST PASSED — % catalogue events, all channels dry_run, email+whatsapp disabled.', v_n;
end $selftest$;

commit;

notify pgrst, 'reload schema';
