-- ════════════════════════════════════════════════════════════════════════════
-- COMMUNICATIONS HUB — AFTER-FAILURE VERIFY (READ-ONLY · ONE RESULT SET)
--
-- WHY THIS FILE EXISTS
--   docs/communications_hub_RUNME.sql aborted before COMMIT with
--     ERROR P0001: HUB FAIL: comms_health counts mirrored legacy rows as live
--                  sends — forged success
--   raised by its own §90 self-test. The file is ONE transaction and uses no
--   CONCURRENTLY, so PostgreSQL rolled the whole thing back. That is the
--   EXPECTED behaviour, not the damage — but "expected" is a claim, and this
--   file turns it into evidence. Run it BEFORE re-running anything.
--
-- WHAT IT IS
--   • READ-ONLY. There is not one INSERT, UPDATE, DELETE, CREATE, ALTER, DROP,
--     GRANT, REVOKE or TRUNCATE below. Nothing is created, not even a temp
--     helper: the data-dependent probes go through query_to_xml(), a built-in,
--     so no function has to be defined to run dynamic SQL.
--   • ONE result set, ordered, so it can be read top to bottom.
--   • Safe from the Supabase SQL editor, where auth.uid() is NULL: no protected
--     RPC is called anywhere. (Calling one is what nearly killed the migration.)
--   • Safe whether the hub objects exist or not. Every probe against a hub table
--     is guarded by to_regclass BEFORE the query text is built, so an absent
--     table can never turn into a "relation does not exist" error.
--
-- WHAT IT PROVES
--   V1  no partial state was left behind by the failed attempt
--   V2  the current state of the hub tables, functions, trigger and constraints
--   V3  channels are still disabled — nothing can send
--   V4  nothing was ever actually sent
--   V5  no legacy row has become a live send
--   V6  the legacy queue is intact
--   V7  the FULL anon privilege picture, across EVERY privilege type
-- ════════════════════════════════════════════════════════════════════════════

with
-- ─── What actually exists right now ─────────────────────────────────────────
present as (
  select to_regclass('public.comms_outbox')      is not null as has_outbox,
         to_regclass('public.comms_channels')    is not null as has_channels,
         to_regclass('public.comms_audit')       is not null as has_audit,
         to_regclass('public.email_deliveries')  is not null as has_legacy,
         to_regclass('public.notifications')     is not null as has_notifications
),
-- Does comms_outbox carry the provenance columns? A half-applied package could
-- have the table without them, and the live-send question must still be
-- answerable in that world — from the old provider string.
prov as (
  select (select count(*) from information_schema.columns
           where table_schema = 'public' and table_name = 'comms_outbox'
             and column_name in ('source_kind','is_legacy_mirror','delivery_mode','provider_state')
         ) = 4 as has_provenance
),
-- ─── Data probes. The QUERY TEXT is chosen before it is run, so a missing
--     table yields a constant instead of an error. ────────────────────────────
q(name, sql) as (
  select 'outbox_total',
         case when (select has_outbox from present)
              then 'select count(*)::text as v from public.comms_outbox'
              else 'select ''-1'' as v' end
  union all
  select 'outbox_runnable',
         case when (select has_outbox from present)
              then 'select count(*)::text as v from public.comms_outbox where status in (''queued'',''retrying'',''processing'')'
              else 'select ''-1'' as v' end
  union all
  -- ANY row that claims a real, non-simulated terminal success — evaluated the
  -- strict way if provenance exists, and the old way if it does not, so the
  -- answer is honest in both worlds.
  select 'outbox_claimed_live',
         case when not (select has_outbox from present) then 'select ''-1'' as v'
              when (select has_provenance from prov)
              then 'select count(*)::text as v from public.comms_outbox
                     where status in (''sent'',''delivered'') and not dry_run
                       and not is_legacy_mirror and source_kind = ''native''
                       and provider_state in (''accepted'',''delivered'')'
              else 'select count(*)::text as v from public.comms_outbox
                     where status in (''sent'',''delivered'') and not dry_run
                       and coalesce(provider,'''') <> ''legacy_email_deliveries''' end
  union all
  -- A mirrored legacy row that would be read as a live send. Must be 0.
  select 'legacy_rows_counted_live',
         case when not (select has_outbox from present) then 'select ''-1'' as v'
              when (select has_provenance from prov)
              then 'select count(*)::text as v from public.comms_outbox
                     where (is_legacy_mirror or legacy_delivery_id is not null
                            or coalesce(provider,'''') = ''legacy_email_deliveries'')
                       and provider_state in (''accepted'',''delivered'')'
              else 'select count(*)::text as v from public.comms_outbox
                     where legacy_delivery_id is not null
                       and status in (''sent'',''delivered'') and not dry_run
                       and coalesce(provider,'''') <> ''legacy_email_deliveries''' end
  union all
  select 'outbox_mirrored',
         case when not (select has_outbox from present) then 'select ''-1'' as v'
              else 'select count(*)::text as v from public.comms_outbox where legacy_delivery_id is not null' end
  union all
  select 'audit_rows',
         case when (select has_audit from present)
              then 'select count(*)::text as v from public.comms_audit'
              else 'select ''-1'' as v' end
  union all
  select 'channels_that_can_send',
         case when (select has_channels from present)
              then 'select count(*)::text as v from public.comms_channels where (enabled and channel <> ''portal'') or not dry_run'
              else 'select ''-1'' as v' end
  union all
  select 'channels_detail',
         case when (select has_channels from present)
              then 'select coalesce(string_agg(channel || '' enabled='' || enabled || '' dry_run='' || dry_run, '' | '' order by channel), ''empty'') as v from public.comms_channels'
              else 'select ''comms_channels absent'' as v' end
  union all
  select 'legacy_queue_detail',
         case when (select has_legacy from present)
              then 'select coalesce(string_agg(status || ''='' || n, '' | '' order by status), ''empty'') as v
                      from (select status, count(*) as n from public.email_deliveries group by status) s'
              else 'select ''email_deliveries absent'' as v' end
  union all
  select 'notifications_total',
         case when (select has_notifications from present)
              then 'select count(*)::text as v from public.notifications'
              else 'select ''-1'' as v' end
),
probe(name, val) as (
  select q.name,
         (xpath('/row/v/text()', query_to_xml(q.sql, false, true, '')))[1]::text
  from q
),
p(name, n) as (
  select name, case when val ~ '^-?[0-9]+$' then val::bigint else null end from probe
),
-- ─── Catalogue facts ────────────────────────────────────────────────────────
cat as (
  select
    (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'comms\_%') as n_tables,
    (select count(*) from pg_proc pr join pg_namespace n on n.oid = pr.pronamespace
      where n.nspname = 'public' and pr.proname like 'comms\_%') as n_funcs,
    (select count(*) from pg_trigger
      where tgname = 't_comms_outbox_guard' and not tgisinternal) as n_trigger,
    (select count(*) from pg_constraint
      where conname in ('comms_outbox_source_kind_ck','comms_outbox_delivery_mode_ck',
                        'comms_outbox_provider_state_ck','comms_outbox_provenance_consistent_ck',
                        'comms_outbox_delivery_mode_matches_dry_run_ck',
                        'comms_outbox_mirror_never_live_ck')) as n_checks
),
rows_out(sort_key, claim, verdict, detail) as (

-- ─── V1. NO PARTIAL STATE ───────────────────────────────────────────────────
select 100, 'V1.no_partial_state',
       case when c.n_tables = 0 and c.n_funcs = 0 and c.n_trigger = 0
              then 'PASS — clean rollback: the failed transaction left nothing behind'
            when c.n_tables = 7 and c.n_funcs >= 24 and c.n_trigger = 1
              then 'INSTALLED — a complete package is present (this is not partial state)'
            else 'FAIL — PARTIAL STATE: some hub objects exist and some do not' end,
       c.n_tables || ' comms_* table(s) · ' || c.n_funcs || ' comms_* function(s) · '
         || c.n_trigger || ' guard trigger(s) · ' || c.n_checks || ' provenance CHECK(s)'
from cat c

union all
select 101, 'V1.hub_tables_present', 'INFO',
       coalesce((select string_agg(c.relname, ', ' order by c.relname)
                   from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'comms\_%'),
                'none — no comms_* table exists')

union all
select 102, 'V1.hub_functions_present', 'INFO',
       coalesce((select string_agg(pr.proname, ', ' order by pr.proname)
                   from pg_proc pr join pg_namespace n on n.oid = pr.pronamespace
                  where n.nspname = 'public' and pr.proname like 'comms\_%'),
                'none — no comms_* function exists')

union all
-- The failure was raised by the self-test, i.e. AFTER every DDL statement in the
-- file had already run inside the transaction. If any of it had survived the
-- abort, this is where it would show.
select 103, 'V1.rollback_reasoning', 'INFO',
       'the RUNME is one transaction and uses no CONCURRENTLY, so an exception in §90 discards every statement in it; V1 above is the check of that claim, not a restatement of it'

-- ─── V2. PROVENANCE STATE ───────────────────────────────────────────────────
union all
select 110, 'V2.provenance_columns',
       case when (select has_provenance from prov) then 'PRESENT — all four columns exist'
            when not (select has_outbox from present) then 'N/A — comms_outbox does not exist'
            else 'ABSENT — comms_outbox exists without provenance columns' end,
       coalesce((select string_agg(column_name, ', ' order by column_name)
                   from information_schema.columns
                  where table_schema = 'public' and table_name = 'comms_outbox'
                    and column_name in ('source_kind','is_legacy_mirror','delivery_mode','provider_state')),
                'none')

-- ─── V3. NOTHING CAN SEND ───────────────────────────────────────────────────
union all
select 120, 'V3.channels_disabled',
       case when (select n from p where name = 'channels_that_can_send') is null then 'UNKNOWN'
            when (select n from p where name = 'channels_that_can_send') = -1
              then 'PASS — comms_channels does not exist, so no channel can send'
            when (select n from p where name = 'channels_that_can_send') = 0
              then 'PASS — every channel is dry_run; email and whatsapp are disabled'
            else 'FAIL — ' || (select n from p where name = 'channels_that_can_send') || ' channel(s) could send' end,
       (select val from probe where name = 'channels_detail')

-- ─── V4. NOTHING WAS EVER SENT ──────────────────────────────────────────────
union all
select 130, 'V4.nothing_was_sent',
       case when (select n from p where name = 'outbox_claimed_live') = -1
              then 'PASS — comms_outbox does not exist, so no send can have been recorded'
            when (select n from p where name = 'outbox_claimed_live') = 0
              then 'PASS — zero rows carry evidence of a real send'
            else 'REVIEW — ' || (select n from p where name = 'outbox_claimed_live') || ' row(s) claim a real send' end,
       'outbox rows total=' || (select n from p where name = 'outbox_total')
         || ' · runnable=' || (select n from p where name = 'outbox_runnable')
         || ' · audit rows=' || (select n from p where name = 'audit_rows')
         || '   (-1 means the table does not exist)'

-- ─── V5. NO LEGACY ROW HAS BECOME A LIVE SEND ───────────────────────────────
union all
select 140, 'V5.no_legacy_row_is_live',
       case when (select n from p where name = 'legacy_rows_counted_live') = -1
              then 'PASS — comms_outbox does not exist, so nothing was mirrored at all'
            when (select n from p where name = 'legacy_rows_counted_live') = 0
              then 'PASS — no mirrored legacy row would be read as a live send'
            else 'FAIL — ' || (select n from p where name = 'legacy_rows_counted_live')
                 || ' mirrored row(s) would be read as live sends' end,
       'mirrored rows present=' || (select n from p where name = 'outbox_mirrored')
         || ' · evaluated with '
         || case when (select has_provenance from prov) then 'explicit provenance columns'
                 else 'the legacy provider string (provenance columns not installed)' end

-- ─── V6. THE LEGACY QUEUE IS INTACT ─────────────────────────────────────────
union all
select 150, 'V6.legacy_queue', 'INFO — compare with the PREFLIGHT baseline; the hub never writes here',
       (select val from probe where name = 'legacy_queue_detail')

union all
select 151, 'V6.notifications_table', 'INFO',
       'public.notifications row count = ' || (select n from p where name = 'notifications_total')
         || '   (-1 means the table does not exist)'

-- ─── V7. THE FULL anon PICTURE, EVERY PRIVILEGE TYPE ────────────────────────
-- No privilege_type filter anywhere in this section. Listing only SELECT /
-- INSERT / UPDATE / DELETE would be a denylist of four verbs with an
-- allowlist's name — which is how REFERENCES, TRIGGER and TRUNCATE stayed
-- invisible on these tables. TRUNCATE is not restricted by RLS at all.
union all
select 160, 'V7.anon_on_legacy_notification_tables',
       case when count(*) = 0 then 'CLEAN — anon/PUBLIC hold no privilege of any type'
            else 'PRESENT — ' || count(*) || ' privilege(s) held' end,
       coalesce(string_agg(distinct grantee || ' ' || privilege_type || ' on ' || table_name, ', '), 'none')
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon','PUBLIC')
  and table_name in ('notifications','notification_events','notification_preferences',
                     'notification_delivery_log','email_deliveries')

union all
select 161, 'V7.anon_privilege_types_on_those_tables', 'INFO — the reach of the check above',
       coalesce((select string_agg(distinct privilege_type, ', ' order by privilege_type)
                   from information_schema.role_table_grants
                  where table_schema = 'public' and grantee in ('anon','PUBLIC')
                    and table_name in ('notifications','notification_events','notification_preferences',
                                       'notification_delivery_log','email_deliveries')), 'none')

union all
select 162, 'V7.anon_on_comms_tables',
       case when count(*) = 0 then 'CLEAN — anon/PUBLIC hold no privilege of any type on comms_*'
            else 'PRESENT — ' || count(*) || ' privilege(s) held' end,
       coalesce(string_agg(distinct grantee || ' ' || privilege_type || ' on ' || table_name, ', '), 'none')
from information_schema.role_table_grants
where table_schema = 'public' and table_name like 'comms\_%' and grantee in ('anon','PUBLIC')

union all
select 163, 'V7.anon_privilege_types_anywhere_in_public', 'INFO',
       coalesce((select string_agg(distinct privilege_type, ', ' order by privilege_type)
                   from information_schema.role_table_grants
                  where table_schema = 'public' and grantee in ('anon','PUBLIC')), 'none')

union all
-- Named so the reader can see WHY the CRUD verbs are not being revoked here:
-- the one genuine anonymous caller is SECURITY DEFINER and needs no table
-- privilege. If this row is empty, the public opportunities form is broken.
select 164, 'V7.anon_execute_on_the_one_genuine_public_caller',
       case when count(*) > 0 then 'PRESENT — the public opportunities form can still submit'
            else 'ABSENT — the public opportunities form would fail' end,
       coalesce(string_agg(distinct routine_name, ', '), 'submit_opportunity_request not granted to anon')
from information_schema.routine_privileges
where routine_schema = 'public' and grantee in ('anon','PUBLIC')
  and routine_name = 'submit_opportunity_request'
)
select claim, verdict, detail from rows_out order by sort_key;
