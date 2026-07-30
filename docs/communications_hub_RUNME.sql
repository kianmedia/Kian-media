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
create trigger t_comms_outbox_guard
  before insert or update of subject, body, audience_scope, recipient_user_id
  on public.comms_outbox
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
        entity_type, entity_id, project_id, actor_id, meta)
      values (
        v_corr, v_key, p_event, cat.category, ch, v_scope,
        rec.user_id, v_addr, rec.role, v_ext, v_locale,
        tpl.id, tpl.version, v_subject, v_body, coalesce(rec.action_url, '/client-portal'),
        'queued', v_dry, now(),
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
begin
  select * into o from public.comms_outbox where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if o.status <> 'processing' then
    return jsonb_build_object('ok', false, 'error', 'not_claimed', 'status', o.status);
  end if;

  v_ack := coalesce((p_provider_response->>'ack')::boolean, false);

  if p_outcome = 'sent' and not o.dry_run and not v_ack then
    p_outcome := 'failed'; p_error := coalesce(p_error, 'provider did not acknowledge');
    p_error_class := 'no_provider_ack';
  end if;

  if p_outcome in ('sent','delivered') then
    v_status := p_outcome;
    update public.comms_outbox set
      status = v_status, provider = p_provider, provider_message_id = p_provider_message_id,
      provider_response = coalesce(p_provider_response, '{}'::jsonb),
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
      last_error = left(coalesce(p_error, 'send_failed'), 500),
      error_class = coalesce(p_error_class, 'send_failed')
    where id = p_id;
  end if;

  return jsonb_build_object('ok', true, 'id', p_id, 'status', v_status,
                            'attempts', o.attempts, 'dry_run', o.dry_run);
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
  if o.legacy_delivery_id is not null then
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

  select jsonb_build_object(
    'queued',      count(*) filter (where status = 'queued'),
    'processing',  count(*) filter (where status = 'processing'),
    'retrying',    count(*) filter (where status = 'retrying'),
    'sent_dry_run',count(*) filter (where status in ('sent','delivered') and dry_run),
    -- ⚠️ MIRRORED LEGACY ROWS ARE EXCLUDED FROM sent_live ON PURPOSE.
    --    comms_adapter_import_legacy() copies TERMINAL email_deliveries rows in
    --    with dry_run = false and status 'sent'. Counting those as sent_live
    --    would put a green "actually sent" number on the dashboard for mail this
    --    hub never touched — and whose legacy 'sent' is not evidence of delivery
    --    at all, since the Apps Script portal_notify handler is not deployed.
    --    That is precisely the forged-success signal this module exists to kill.
    'sent_live',   count(*) filter (where status in ('sent','delivered') and not dry_run
                                      and coalesce(provider,'') <> 'legacy_email_deliveries'),
    'delivered',   count(*) filter (where status = 'delivered' and not dry_run
                                      and coalesce(provider,'') <> 'legacy_email_deliveries'),
    'mirrored_legacy', count(*) filter (where provider = 'legacy_email_deliveries'),
    'failed',      count(*) filter (where status = 'failed'),
    'dead_letter', count(*) filter (where status = 'dead_letter'),
    'cancelled',   count(*) filter (where status = 'cancelled'),
    'blocked_external_total',
      (select count(*) from public.comms_audit where action in ('recipient_blocked_r1','content_blocked_r2')),
    'total',       count(*))
  into v from public.comms_outbox;

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
    'note_ar', 'الأرقام تحت sent_dry_run محاكاة ولم تُرسَل فعليًا، وmirrored_legacy صفوف منسوخة من الطابور القديم للعرض فقط — ليست دليل تسليم ولا تُحتسب ضمن الإرسال الفعلي.',
    'note_en', 'sent_dry_run rows were simulated and never actually sent; mirrored_legacy rows are read-only copies of the old queue — not evidence of delivery, and never counted as live sends.');
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
        'legacy_email_deliveries', r.provider_message_id, r.last_error,
        r.id, r.created_at, r.sent_at,
        jsonb_build_object('legacy_status', r.status, 'mirror', true))
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

-- ════════════════════════════════════════════════════════════════════════════
-- §90 SELF-TESTS — STATIC ONLY.
--     No protected RPC is called here. The SQL editor runs as postgres with
--     auth.uid() = NULL, so calling one would raise "not authorized" and abort
--     the migration. Every assertion below reads the catalogue or the function
--     body via pg_get_functiondef + ilike (the deparser uppercases keywords,
--     hence ilike). Nothing is wrapped in a catch-all that would pass anyway.
-- ════════════════════════════════════════════════════════════════════════════
do $selftest$
declare v_def text; t text; f text; v_n int;
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

  -- (9b) sent_live MUST exclude rows mirrored from the legacy queue. Static
  --      body assertion — calling comms_health() here would hit its own
  --      comms_can_view() gate under auth.uid() = NULL and abort the migration.
  v_def := pg_get_functiondef(to_regprocedure('public.comms_health()'));
  if v_def !~* $re$'sent_live'[^)]*legacy_email_deliveries$re$ then
    raise exception 'HUB FAIL: comms_health counts mirrored legacy rows as live sends — forged success';
  end if;
  if v_def not ilike '%mirrored_legacy%' then
    raise exception 'HUB FAIL: comms_health does not report mirrored_legacy separately';
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
