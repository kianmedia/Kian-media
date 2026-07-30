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

do $preflight_done$
begin
  raise notice 'PREFLIGHT COMPLETE — read-only. Nothing was changed. Next: docs/communications_hub_RUNME.sql';
end $preflight_done$;
