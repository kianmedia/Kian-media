-- ════════════════════════════════════════════════════════════════════════════
-- COMMUNICATIONS HUB — PREFLIGHT (READ-ONLY)
--
-- Run this FIRST, in the Supabase SQL editor. It writes nothing, locks nothing
-- and changes nothing. It answers four questions:
--
--   1. Which parts of the EXISTING notification machinery are actually present?
--      (the hub composes over them and feature-detects each one — it never
--       assumes, because the repo's own notes disagree about what was applied)
--   2. Is anything already named comms_* that would collide?
--   3. Is any comms_* function present with a DIFFERENT return type? Replacing
--      such a function raises 42P13 and aborts the whole migration.
--   4. What is the current legacy queue backlog, so the RUNME's effect on it
--      can be judged afterwards (the answer must be: none — the hub does not
--      touch email_deliveries).
--
-- §5 additionally baselines ANONYMOUS EXPOSURE across every privilege type, on
-- tables AND on sequences, and proves the probe is not vacuous. The RUNME takes
-- anon/PUBLIC direct table access to ZERO — including the four CRUD verbs an
-- earlier pass left in place — so this baseline is what that change is measured
-- against. §5d names the single anonymous caller that must survive it.
--
-- Nothing here is fatal. Read the NOTICEs, then run the RUNME.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1) EXISTING MACHINERY THE HUB COMPOSES OVER ────────────────────────────
select 'existing_object' as check_kind, obj as name,
       case when present then 'PRESENT' else 'ABSENT — hub feature-detects and degrades' end as state
from (
  select 'table public.notifications'              as obj, to_regclass('public.notifications')              is not null as present
  union all select 'table public.notification_preferences',  to_regclass('public.notification_preferences')  is not null
  union all select 'table public.notification_events',       to_regclass('public.notification_events')       is not null
  union all select 'table public.email_deliveries',          to_regclass('public.email_deliveries')          is not null
  union all select 'table public.notification_delivery_log', to_regclass('public.notification_delivery_log') is not null
  union all select 'table public.profiles',                  to_regclass('public.profiles')                  is not null
  union all select 'table public.project_members',           to_regclass('public.project_members')           is not null
  union all select 'fn notification_resolve_recipients',
         to_regprocedure('public.notification_resolve_recipients(text,text,uuid,uuid,uuid,jsonb)') is not null
  union all select 'fn notification_dispatch_portal',
         to_regprocedure('public.notification_dispatch_portal(text,text,uuid,uuid,uuid,text,text,text,jsonb)') is not null
  union all select 'fn notify_emit_event',
         to_regprocedure('public.notify_emit_event(text,text,uuid,uuid,uuid,text,text,jsonb,uuid)') is not null
  union all select 'fn notification_trace',        to_regprocedure('public.notification_trace(jsonb)') is not null
  union all select 'fn is_owner',                  to_regprocedure('public.is_owner()')  is not null
  union all select 'fn staff_role',                to_regprocedure('public.staff_role()') is not null
) t
order by 2;

-- ─── 2) COLLISIONS: anything already called comms_* ─────────────────────────
select 'existing_comms_relation' as check_kind, c.relname as name,
       case c.relkind when 'r' then 'table' when 'v' then 'view' when 'm' then 'matview'
                      when 'i' then 'index' when 'S' then 'sequence' else c.relkind::text end as state
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname like 'comms\_%'
order by 2;

select 'existing_comms_function' as check_kind,
       p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as name,
       pg_get_function_result(p.oid) as state
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'comms\_%'
order by 2;

-- ─── 3) 42P13 TRAP: a comms_* function whose RETURN TYPE would change ───────
-- `create or replace function` CANNOT change a return type. If any row appears
-- here, DROP that exact function before running the RUNME, or the migration
-- aborts mid-way. This cost two production cycles on an earlier batch.
do $preflight_42p13$
declare r record; v_n int := 0;
begin
  for r in
    select p.proname as fname,
           pg_get_function_identity_arguments(p.oid) as args,
           pg_get_function_result(p.oid) as ret
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'comms\_%'
  loop
    v_n := v_n + 1;
    raise notice '42P13 CHECK — public.%(%) returns % · compare with the RUNME before running it', r.fname, r.args, r.ret;
  end loop;
  if v_n = 0 then
    raise notice '42P13 CHECK — no pre-existing comms_* function. Clean install.';
  end if;
end $preflight_42p13$;

-- ─── 4) LEGACY QUEUE BASELINE (the RUNME must not change any of these) ──────
do $preflight_baseline$
declare v_txt text := 'email_deliveries ABSENT';
begin
  if to_regclass('public.email_deliveries') is not null then
    execute $q$
      select 'email_deliveries · ' || coalesce(string_agg(status || '=' || n::text, ', ' order by status), 'empty')
      from (select status, count(*) as n from public.email_deliveries group by status) s
    $q$ into v_txt;
  end if;
  raise notice 'LEGACY BASELINE — %', v_txt;
  raise notice 'LEGACY BASELINE — the hub NEVER writes to email_deliveries. Re-run this block after the RUNME; the numbers must be identical.';
end $preflight_baseline$;

-- ─── 5) ANON EXPOSURE BASELINE — ALL PRIVILEGE TYPES, NOT JUST CRUD ────────
-- No filter on privilege_type on purpose. A check that looks only for SELECT /
-- INSERT / UPDATE / DELETE is a denylist of four verbs wearing an allowlist's
-- name, and it is exactly why REFERENCES / TRIGGER / TRUNCATE sat unnoticed on
-- the legacy notification tables. TRUNCATE in particular is not restricted by
-- row level security at all.
select 'anon_grant_on_notification_object' as check_kind,
       table_schema || '.' || table_name as name, privilege_type as state
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon','PUBLIC')
  and (table_name like 'comms\_%' or table_name in
       ('notifications','notification_preferences','notification_events',
        'email_deliveries','notification_delivery_log'))
order by 2, 3;

-- ─── 5b) THE SAME QUESTION FOR SEQUENCES ───────────────────────────────────
-- `revoke all on table` does NOT reach a sequence, and a sequence carries its
-- own USAGE / SELECT / UPDATE privileges. comms_audit.id is
-- `bigint generated always as identity`, so at least one sequence exists here.
-- A cleanup that reports "no table privileges" while anon still holds USAGE on
-- the owned sequence has not finished the job.
select 'anon_grant_on_notification_sequence' as check_kind,
       u.object_schema || '.' || u.object_name as name,
       u.grantee || ' ' || u.privilege_type as state
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
                                 'email_deliveries')))
order by 2, 3;

-- ─── 5c) PROVE THE PROBE IS NOT BLIND (non-vacuity) ─────────────────────────
-- §5 and §5b are "expect zero rows" checks. A zero-row result proves nothing if
-- the catalogue query itself is wrong — a typo'd grantee name, an unsupported
-- view — because a broken query also returns zero. anon legitimately holds
-- privileges on OTHER public tables in this database, so the count below must be
-- greater than zero. If it is zero, §5 is vacuous and must be fixed, not trusted.
do $preflight_nonvacuity$
declare v_any bigint; v_types text;
begin
  select count(*) into v_any
    from information_schema.role_table_grants
   where table_schema = 'public' and grantee in ('anon','PUBLIC');
  select string_agg(distinct privilege_type, ', ' order by privilege_type) into v_types
    from information_schema.role_table_grants
   where table_schema = 'public' and grantee in ('anon','PUBLIC');
  if v_any = 0 then
    raise notice 'NON-VACUITY — ⚠️ anon/PUBLIC hold NOTHING anywhere in public. §5 cannot distinguish "clean" from "blind". Verify the probe before trusting it.';
  else
    raise notice 'NON-VACUITY — the probe sees % anon/PUBLIC grant(s) elsewhere in public, across types: %. §5 is therefore a real observation.', v_any, v_types;
  end if;
end $preflight_nonvacuity$;

-- ─── 5d) THE DEPENDENCY THIS PHASE IS ABOUT: IS THERE AN ANONYMOUS CALLER? ──
-- The RUNME revokes ALL anon table privileges, including SELECT/INSERT/UPDATE/
-- DELETE that an earlier pass deliberately left behind. That is only safe if no
-- anonymous caller uses them. Proven in the repo, restated here so the operator
-- can see the dependency before running anything:
--   • no browser module reads or writes these tables directly (zero .from(...)
--     hits in app/, lib/, components/);
--   • every server route uses lib/server/supabaseAdmin (service_role or a user
--     JWT) — including app/api/cron/notify-email, which is rpcAsService only;
--   • the one anonymous entry point, submit_opportunity_request, is SECURITY
--     DEFINER and needs no table grant.
-- The block below checks the LIVE database for the piece that must be true after
-- the migration: that RPC must exist and keep its anon EXECUTE.
do $preflight_public_caller$
declare v_oid oid;
begin
  v_oid := to_regprocedure('public.submit_opportunity_request(text,text,text,text,text,text,jsonb,boolean)');
  if v_oid is null then
    raise notice 'PUBLIC CALLER — submit_opportunity_request is ABSENT on this database. Nothing anonymous reaches the notification tables.';
    return;
  end if;
  raise notice 'PUBLIC CALLER — submit_opportunity_request present · SECURITY DEFINER = % · anon EXECUTE = % · pinned search_path = %',
    (select prosecdef from pg_proc where oid = v_oid),
    has_function_privilege('anon', v_oid, 'EXECUTE'),
    (select coalesce(array_to_string(proconfig, ','), '') ilike '%search_path%' from pg_proc where oid = v_oid);
  raise notice 'PUBLIC CALLER — all three must still read true in the POSTCHECK. The RUNME revokes TABLE privileges only; it never touches this FUNCTION grant.';
end $preflight_public_caller$;

-- ─── 6) PROVENANCE COLUMNS — only relevant if comms_outbox already exists ───
-- The RUNME adds source_kind / is_legacy_mirror / delivery_mode / provider_state
-- and backfills them. If the table is already there WITHOUT them, that backfill
-- is the interesting part of the run; if the table is absent this is a clean
-- install and there is nothing to migrate.
do $preflight_provenance$
declare v_missing text; v_rows bigint;
begin
  if to_regclass('public.comms_outbox') is null then
    raise notice 'PROVENANCE — comms_outbox absent. Clean install; nothing to backfill.';
    return;
  end if;
  execute 'select count(*) from public.comms_outbox' into v_rows;
  select string_agg(c, ', ') into v_missing
    from unnest(array['source_kind','is_legacy_mirror','delivery_mode','provider_state']) c
   where not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'comms_outbox'
                        and column_name = c);
  if v_missing is null then
    raise notice 'PROVENANCE — all four columns already present on comms_outbox (% row(s)).', v_rows;
  else
    raise notice 'PROVENANCE — comms_outbox has % row(s); the RUNME will add and backfill: %', v_rows, v_missing;
  end if;
end $preflight_provenance$;

-- ─── 7) FORGED-SUCCESS BASELINE ────────────────────────────────────────────
-- If comms_outbox already exists, how many rows would TODAY be reported as a
-- live send purely because of the free-text provider string? Compare with the
-- POSTCHECK, which counts on explicit provenance instead.
do $preflight_forged$
declare v_txt text;
begin
  if to_regclass('public.comms_outbox') is null then
    raise notice 'FORGED-SUCCESS BASELINE — comms_outbox absent; nothing can be miscounted yet.';
    return;
  end if;
  execute $q$
    select 'claims sent/delivered and not dry_run = ' ||
           count(*) filter (where status in ('sent','delivered') and not dry_run) ||
           ' · of which tagged legacy_email_deliveries = ' ||
           count(*) filter (where status in ('sent','delivered') and not dry_run
                              and coalesce(provider,'') = 'legacy_email_deliveries')
      from public.comms_outbox $q$ into v_txt;
  raise notice 'FORGED-SUCCESS BASELINE — %', v_txt;
end $preflight_forged$;

-- ─── 8) ★ THE DEPENDENCY THE PUBLIC REVOKE RESTS ON ★ ──────────────────────
-- §13.b of the RUNME revokes EVERY table privilege from anon AND from PUBLIC on
-- the five legacy notification tables. `authenticated` is a MEMBER of PUBLIC,
-- so that revoke is only safe if authenticated holds its OWN direct grant.
--
-- ONE LEGITIMATE authenticated CALLER EXISTS and it reads a legacy table
-- directly through PostgREST, not through an RPC:
--   lib/portal/account.ts:32  pget  notification_preferences?user_id=eq...
--   lib/portal/account.ts:42  ppatch notification_preferences?user_id=eq...
-- Both send `Bearer <session.access_token>`, so they execute as `authenticated`.
-- If that role's SELECT/UPDATE were inherited via PUBLIC rather than granted
-- directly, the revoke would silently break the account preferences screen —
-- and it would break it AFTER the migration reported success.
--
-- The RUNME no longer relies on that assumption (it preserves the effective
-- privilege before revoking PUBLIC), but the assumption is still PROVEN here so
-- the operator sees the real state of the database before touching it.
-- Read the NOTICE: `via_public_only` naming any table is the interesting case.
do $preflight_authenticated$
declare
  t text;
  v_direct text := '';
  v_via_public text := '';
  v_absent text := '';
  v_privs text[] := array['SELECT','INSERT','UPDATE','DELETE'];
  p text;
  v_has_direct boolean;
  v_has_effective boolean;
begin
  foreach t in array array['notifications','notification_events','notification_preferences',
                           'notification_delivery_log','email_deliveries']
  loop
    if to_regclass('public.' || quote_ident(t)) is null then
      v_absent := v_absent || ' ' || t;
      continue;
    end if;
    foreach p in array v_privs loop
      -- DIRECT grant: the grantee column literally says 'authenticated'.
      v_has_direct := exists (
        select 1 from information_schema.role_table_grants
         where table_schema = 'public' and table_name = t
           and grantee = 'authenticated' and privilege_type = p);
      -- EFFECTIVE privilege: true even when it is only inherited from PUBLIC.
      v_has_effective := has_table_privilege('authenticated', format('public.%I', t), p);

      if v_has_effective and not v_has_direct then
        v_via_public := v_via_public || ' ' || t || ':' || p;
      elsif v_has_direct then
        v_direct := v_direct || ' ' || t || ':' || p;
      end if;
    end loop;
  end loop;

  if v_absent <> '' then
    raise notice 'AUTHENTICATED DEPENDENCY — absent table(s), nothing to prove:%', v_absent;
  end if;
  raise notice 'AUTHENTICATED DEPENDENCY — held DIRECTLY (survives a PUBLIC revocation untouched):%',
               coalesce(nullif(v_direct, ''), ' (none)');
  if v_via_public <> '' then
    raise notice 'AUTHENTICATED DEPENDENCY — ⚠️ held ONLY VIA PUBLIC:%', v_via_public;
    raise notice 'AUTHENTICATED DEPENDENCY — ⚠️ a bare PUBLIC revocation WOULD have removed these. '
                 '§13.b of the RUNME re-grants them to authenticated FIRST, so the account '
                 'preferences screen (lib/portal/account.ts) keeps working. No action needed here.';
  else
    raise notice 'AUTHENTICATED DEPENDENCY — nothing is held only via PUBLIC. The revocation is a no-op for authenticated.';
  end if;

  -- Non-vacuity: prove the probe can actually SEE a privilege, so an all-clear
  -- is not simply a query that matches nothing.
  if not has_table_privilege('authenticated', 'public.profiles', 'SELECT')
     and to_regclass('public.profiles') is not null then
    raise notice 'AUTHENTICATED DEPENDENCY — ⚠️ probe saw NO privilege even on public.profiles; '
                 'treat the all-clear above as UNPROVEN and investigate before running the RUNME.';
  end if;
end $preflight_authenticated$;

do $preflight_done$
begin
  raise notice 'PREFLIGHT COMPLETE — read-only. Nothing was changed. Next: docs/communications_hub_RUNME.sql';
end $preflight_done$;
