-- ════════════════════════════════════════════════════════════════════════════
-- COMMUNICATIONS HUB — POSTCHECK (READ-ONLY)
--
-- Run AFTER docs/communications_hub_RUNME.sql. Writes nothing.
-- It re-proves, from the live catalogue, the four claims that matter:
--   A. the hub is installed and locked down (RLS, no anon, service-only writes)
--   B. NOTHING CAN SEND (every channel dry_run; email + whatsapp disabled)
--   C. the two hard safety rules are physically enforced by a trigger
--   D. the legacy queue was not touched
-- Any FAIL line below means do not proceed to the go-live guide.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── A. INSTALLED ───────────────────────────────────────────────────────────
select 'A.tables' as check_id,
       case when count(*) = 7 then 'PASS' else 'FAIL — expected 7, found ' || count(*) end as verdict,
       string_agg(relname, ', ' order by relname) as detail
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'comms\_%';

select 'A.rls' as check_id,
       case when count(*) filter (where not relrowsecurity) = 0
            then 'PASS' else 'FAIL — RLS off on: ' ||
                 string_agg(relname, ', ') filter (where not relrowsecurity) end as verdict,
       count(*)::text || ' comms_* tables' as detail
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'comms\_%';

select 'A.functions' as check_id,
       case when count(*) >= 24 then 'PASS' else 'FAIL — only ' || count(*) || ' comms_* functions' end as verdict,
       count(*)::text as detail
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'comms\_%';

select 'A.search_path_pinned' as check_id,
       case when count(*) = 0 then 'PASS'
            else 'FAIL — ' || count(*) || ' SECURITY DEFINER function(s) without a pinned search_path' end as verdict,
       coalesce(string_agg(p.proname, ', '), 'none') as detail
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'comms\_%' and p.prosecdef
  and coalesce(array_to_string(p.proconfig, ','), '') not like '%search_path%';

select 'A.no_anon_tables' as check_id,
       case when count(*) = 0 then 'PASS' else 'FAIL — ' || count(*) || ' anon/PUBLIC table grant(s)' end as verdict,
       coalesce(string_agg(distinct table_name || ':' || privilege_type, ', '), 'none') as detail
from information_schema.role_table_grants
where table_schema = 'public' and table_name like 'comms\_%' and grantee in ('anon','PUBLIC');

select 'A.no_anon_functions' as check_id,
       case when count(*) = 0 then 'PASS' else 'FAIL — ' || count(*) || ' anon/PUBLIC EXECUTE grant(s)' end as verdict,
       coalesce(string_agg(distinct routine_name, ', '), 'none') as detail
from information_schema.routine_privileges
where routine_schema = 'public' and routine_name like 'comms\_%' and grantee in ('anon','PUBLIC');

-- The write surface must be unreachable from a browser session.
select 'A.service_only_write_surface' as check_id,
       case when count(*) = 0 then 'PASS'
            else 'FAIL — authenticated can call: ' || string_agg(routine_name, ', ') end as verdict,
       'comms_enqueue / claim / settle / reap / resolve / rate_check / audit_write' as detail
from information_schema.routine_privileges
where routine_schema = 'public' and grantee = 'authenticated'
  and routine_name in ('comms_enqueue','comms_claim','comms_settle','comms_reap',
                       'comms_resolve','comms_rate_check','comms_audit_write');

-- The five catalogue keys /api/comms/legacy-notify maps the old BROWSER relay
-- events onto. A missing key does not error anywhere visible — the adapter just
-- answers UNKNOWN_EVENT and the notification disappears — so it is checked here
-- explicitly rather than left to be discovered in production.
select 'A.legacy_adapter_events' as check_id,
       case when count(*) = 5 then 'PASS — all five browser-replacement events are catalogued'
            else 'FAIL — only ' || count(*) || ' of 5 present' end as verdict,
       coalesce(string_agg(event_key, ', ' order by event_key), 'none') as detail
from public.comms_event_catalog
where active and event_key in ('deliverable.preview_sent','deliverable.final_ready',
                               'project.member_assigned','project.assignment_note',
                               'deliverable.client_commented');

select 'A.assignment_events_internal' as check_id,
       case when count(*) = 0 then 'PASS — assignment events are internal-only'
            else 'FAIL — ' || string_agg(event_key || '=' || audience, ', ') end as verdict,
       'a private instruction to staff must never be client-facing' as detail
from public.comms_event_catalog
where event_key in ('project.assignment_note','project.member_assigned') and audience <> 'internal';

-- ─── B. NOTHING CAN SEND ────────────────────────────────────────────────────
select 'B.channels_safe' as check_id,
       case when count(*) filter (where enabled and channel <> 'portal') = 0
             and count(*) filter (where not dry_run) = 0
            then 'PASS — every channel dry_run; email/whatsapp disabled'
            else 'FAIL — a channel can send' end as verdict,
       string_agg(channel || '(enabled=' || enabled || ',dry_run=' || dry_run || ')', ', ' order by channel) as detail
from public.comms_channels;

select 'B.no_live_sends_recorded' as check_id,
       case when count(*) = 0 then 'PASS — zero non-dry-run sends'
            else 'REVIEW — ' || count(*) || ' row(s) claim a real send' end as verdict,
       coalesce(string_agg(distinct provider, ', '), 'none') as detail
from public.comms_outbox where status in ('sent','delivered') and not dry_run
  and coalesce(provider,'') <> 'legacy_email_deliveries';

select 'B.provider_ack_rule' as check_id,
       case when pg_get_functiondef('public.comms_settle(uuid,text,text,text,jsonb,text,text)'::regprocedure) ilike '%no_provider_ack%'
            then 'PASS — a live send without provider acknowledgment is recorded as FAILED'
            else 'FAIL — comms_settle would accept an unacknowledged send' end as verdict,
       'HTTP 200 is not delivery' as detail;

-- ─── C. THE TWO HARD SAFETY RULES ───────────────────────────────────────────
select 'C.guard_trigger' as check_id,
       case when exists (select 1 from pg_trigger
                          where tgname = 't_comms_outbox_guard'
                            and tgrelid = 'public.comms_outbox'::regclass and not tgisinternal)
            then 'PASS' else 'FAIL — the guard trigger is not attached' end as verdict,
       't_comms_outbox_guard on public.comms_outbox' as detail;

select 'C.rules_in_guard' as check_id,
       case when pg_get_functiondef('public.comms_outbox_guard()'::regprocedure) ilike '%COMMS R1%'
             and pg_get_functiondef('public.comms_outbox_guard()'::regprocedure) ilike '%COMMS R2%'
             and pg_get_functiondef('public.comms_outbox_guard()'::regprocedure) ilike '%comms_is_external%'
            then 'PASS — R1 + R2 present and externality is recomputed, not trusted'
            else 'FAIL' end as verdict, 'server-side enforcement' as detail;

select 'C.external_fails_closed' as check_id,
       case when public.comms_is_external('00000000-0000-0000-0000-000000000000'::uuid) is true
            then 'PASS — an unknown user is treated as EXTERNAL'
            else 'FAIL — unknown user is not fail-closed' end as verdict,
       'comms_is_external(unknown) must be true' as detail;

select 'C.no_client_template_for_internal_event' as check_id,
       case when count(*) = 0 then 'PASS'
            else 'FAIL — ' || count(*) || ' client template(s) on internal-only event(s)' end as verdict,
       coalesce(string_agg(distinct t.event_key, ', '), 'none') as detail
from public.comms_templates t
join public.comms_event_catalog c on c.event_key = t.event_key
where t.audience_scope = 'client' and c.audience = 'internal';

-- Any recipient the hub refused. Zero is normal on a fresh install; a non-zero
-- number here is the safety rules doing their job, not a defect.
select 'C.blocked_recipients' as check_id, 'INFO' as verdict,
       coalesce(string_agg(action || '=' || n::text, ', '), 'none yet') as detail
from (select action, count(*) as n from public.comms_audit
       where action in ('recipient_blocked_r1','content_blocked_r2') group by action) s;

-- ─── D. THE LEGACY QUEUE WAS NOT TOUCHED ────────────────────────────────────
-- Compare this with the same block in the PREFLIGHT. The numbers must match.
do $legacy$
declare v_txt text := 'email_deliveries ABSENT';
begin
  if to_regclass('public.email_deliveries') is not null then
    execute $q$ select 'email_deliveries · ' ||
                       coalesce(string_agg(status || '=' || n::text, ', ' order by status), 'empty')
                  from (select status, count(*) as n from public.email_deliveries group by status) s $q$
      into v_txt;
  end if;
  raise notice 'LEGACY AFTER — %  (must equal the PREFLIGHT baseline)', v_txt;
end $legacy$;

select 'D.legacy_mirror_is_terminal_only' as check_id,
       case when count(*) = 0 then 'PASS — no live legacy row was mirrored'
            else 'FAIL — ' || count(*) || ' mirrored row(s) are in a runnable state' end as verdict,
       'mirrored rows must never be claimable' as detail
from public.comms_outbox
where legacy_delivery_id is not null and status in ('queued','retrying','processing');

-- ─── E. WHAT IS ACTUALLY IN THE QUEUE RIGHT NOW ─────────────────────────────
select 'E.outbox_by_status' as check_id, status as verdict,
       count(*)::text || ' row(s), dry_run=' ||
       count(*) filter (where dry_run)::text as detail
from public.comms_outbox group by status order by status;

do $done$
begin
  raise notice 'POSTCHECK COMPLETE — read-only. Read every FAIL before opening docs/COMMUNICATIONS_GO_LIVE_GUIDE.md.';
end $done$;
