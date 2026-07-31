-- ════════════════════════════════════════════════════════════════════════════
-- COMMUNICATIONS HUB — POSTCHECK (READ-ONLY · ONE RESULT SET)
--
-- Run AFTER docs/communications_hub_RUNME.sql. Writes nothing, locks nothing.
-- Safe from the SQL editor, where auth.uid() is NULL: no protected RPC is
-- called, so nothing here can die on its own authorization gate.
--
-- It re-proves, from the live catalogue and the live data, the claims that
-- matter:
--   A. the hub is installed and locked down (RLS, no anon, service-only writes)
--   B. NOTHING CAN SEND (every channel dry_run; email + whatsapp disabled) and
--      nothing HAS been sent
--   C. the safety rules R0/R1/R2 are physically enforced
--   P. PROVENANCE is explicit, constrained, and honest — legacy, dry-run and
--      live are three different things and are never added together
--   D. the legacy queue was not touched
--   G. anon holds nothing outside an explicit ALLOWLIST, across ALL privilege
--      types — not a denylist of the four CRUD verbs
--   H. public.notification_preferences — the ONE table a browser session reaches
--      directly with a user JWT — grants `authenticated` EXACTLY what
--      lib/portal/account.ts uses and nothing else, DIRECTLY rather than through
--      PUBLIC, and is row-isolated. Read from pg_class.relacl and
--      pg_attribute.attacl at BOTH granularities: the run that failed before this
--      one did so because a column-level grant is invisible to
--      has_table_privilege() and to information_schema.role_table_grants.
--
-- Read every FAIL. The final block raises an ERROR only on a real failure.
-- ════════════════════════════════════════════════════════════════════════════

with
-- ─── THE ALLOWLIST ──────────────────────────────────────────────────────────
-- An ALLOWLIST of (table, grantee, privilege) triples that anon/PUBLIC are
-- permitted to hold. It is deliberately EMPTY, and that is a finding, not an
-- oversight:
--   • the only anonymous caller that reaches these tables is
--     public.submit_opportunity_request(...), which is SECURITY DEFINER and
--     writes through public.notify(), so it needs no table privilege at all;
--   • no browser module reads or writes any of them directly;
--   • every server route reaches them as service_role or as a user JWT.
-- An earlier pass kept SELECT/INSERT/UPDATE/DELETE "in case a public form needs
-- them". No form ever did. A privilege that nothing exercises cannot be caught
-- by a regression, so it is not a spare capability — it is a standing hole, and
-- it is now revoked. THIS IS AN ALLOWLIST, NOT A DENYLIST: it does not enumerate
-- forbidden verbs, so a privilege type nobody thought of is still a failure.
-- Add a row here ONLY with a named caller that provably needs it. Anything not
-- named below is reported as a failure, whatever its privilege type.
allowed(table_name, grantee, privilege_type) as (
  select null::text, null::text, null::text where false
),
legacy_tables(t) as (
  values ('notifications'), ('notification_events'), ('notification_preferences'),
         ('notification_delivery_log'), ('email_deliveries')
),
-- ─── THE authenticated CONTRACT ON notification_preferences ─────────────────
-- The one table in this whole surface that a BROWSER session reaches directly,
-- through PostgREST, with a user JWT — every other path is service_role or a
-- SECURITY DEFINER function. The allowlist below is derived from the code, not
-- from the error message the earlier failed run printed:
--   lib/portal/account.ts:32  GET   ...?user_id=eq.<uid>&select=*   → table SELECT
--   lib/portal/account.ts:42  PATCH ...?user_id=eq.<uid>            → UPDATE on
--        exactly portal_enabled, email_enabled, whatsapp_enabled, plus SELECT
--        again because lib/portal/client.ts:131 sends Prefer: return=representation
-- INSERT is deliberately NOT on the list: the row is created at signup by the
-- SECURITY DEFINER trigger handle_new_user() (phase0_migration.sql:515) and
-- backfilled for older accounts (phase0_migration.sql:127); no browser path
-- inserts, and there is no INSERT policy for one to use.
-- to_regclass, so a database without the table produces `absent` rather than an
-- error — every row below still reports.
np(reloid) as ( select to_regclass('public.notification_preferences')::oid ),
np_cols(c) as ( values ('portal_enabled'), ('email_enabled'), ('whatsapp_enabled') ),
-- Direct table-level ACL entries, read from pg_class.relacl. information_schema
-- is not used here: it shows table-level grants only, and only for roles the
-- current session happens to have enabled. In an ACL, grantee 0 IS "PUBLIC".
np_tbl_acl(grantee_name, priv) as (
  select case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end, a.privilege_type
    from pg_class c
    cross join lateral aclexplode(c.relacl) a
   where c.oid = (select reloid from np)
),
-- Direct COLUMN-level ACL entries, from pg_attribute.attacl. This is the
-- catalogue the earlier run never read, and the reason it misdiagnosed itself.
np_col_acl(grantee_name, priv, column_name) as (
  select case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end,
         a.privilege_type, at.attname::text
    from pg_attribute at
    cross join lateral aclexplode(at.attacl) a
   where at.attrelid = (select reloid from np) and at.attnum > 0 and not at.attisdropped
),
np_policy(polname, cmd, polcmd, qual, wcheck, permissive) as (
  select p.polname::text,
         case p.polcmd when 'r' then 'select' when 'a' then 'insert' when 'w' then 'update'
                       when 'd' then 'delete' else 'all' end,
         p.polcmd,
         coalesce(pg_get_expr(p.polqual, p.polrelid), ''),
         -- The documented fallback: a policy with no WITH CHECK uses its USING
         -- expression as the check. Evaluated here rather than reported as a
         -- hole that is not one.
         coalesce(nullif(coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''), ''),
                  coalesce(pg_get_expr(p.polqual, p.polrelid), '')),
         p.polpermissive
    from pg_policy p
   where p.polrelid = (select reloid from np)
),
checks(sort_key, check_id, verdict, detail) as (

-- ─── A. INSTALLED ───────────────────────────────────────────────────────────
select 10, 'A.tables',
       case when count(*) = 7 then 'PASS' else 'FAIL — expected 7, found ' || count(*) end,
       string_agg(relname, ', ' order by relname)
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'comms\_%'

union all
select 11, 'A.rls',
       case when count(*) filter (where not relrowsecurity) = 0
            then 'PASS' else 'FAIL — RLS off on: ' ||
                 string_agg(relname, ', ') filter (where not relrowsecurity) end,
       count(*)::text || ' comms_* tables'
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'comms\_%'

union all
select 12, 'A.functions',
       case when count(*) >= 24 then 'PASS' else 'FAIL — only ' || count(*) || ' comms_* functions' end,
       count(*)::text
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'comms\_%'

union all
select 13, 'A.search_path_pinned',
       case when count(*) = 0 then 'PASS'
            else 'FAIL — ' || count(*) || ' SECURITY DEFINER function(s) without a pinned search_path' end,
       coalesce(string_agg(p.proname, ', '), 'none')
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'comms\_%' and p.prosecdef
  and coalesce(array_to_string(p.proconfig, ','), '') not like '%search_path%'

union all
select 14, 'A.no_anon_comms_tables',
       case when count(*) = 0 then 'PASS' else 'FAIL — ' || count(*) || ' anon/PUBLIC table grant(s)' end,
       coalesce(string_agg(distinct table_name || ':' || privilege_type, ', '), 'none')
from information_schema.role_table_grants
where table_schema = 'public' and table_name like 'comms\_%' and grantee in ('anon','PUBLIC')

union all
select 15, 'A.no_anon_comms_functions',
       case when count(*) = 0 then 'PASS' else 'FAIL — ' || count(*) || ' anon/PUBLIC EXECUTE grant(s)' end,
       coalesce(string_agg(distinct routine_name, ', '), 'none')
from information_schema.routine_privileges
where routine_schema = 'public' and routine_name like 'comms\_%' and grantee in ('anon','PUBLIC')

union all
-- The write surface must be unreachable from a browser session.
select 16, 'A.service_only_write_surface',
       case when count(*) = 0 then 'PASS'
            else 'FAIL — authenticated can call: ' || string_agg(routine_name, ', ') end,
       'comms_enqueue / claim / settle / reap / resolve / rate_check / audit_write'
from information_schema.routine_privileges
where routine_schema = 'public' and grantee = 'authenticated'
  and routine_name in ('comms_enqueue','comms_claim','comms_settle','comms_reap',
                       'comms_resolve','comms_rate_check','comms_audit_write')

union all
-- The five catalogue keys /api/comms/legacy-notify maps the old BROWSER relay
-- events onto. A missing key does not error anywhere visible — the adapter just
-- answers UNKNOWN_EVENT and the notification disappears.
select 17, 'A.legacy_adapter_events',
       case when count(*) = 5 then 'PASS — all five browser-replacement events are catalogued'
            else 'FAIL — only ' || count(*) || ' of 5 present' end,
       coalesce(string_agg(event_key, ', ' order by event_key), 'none')
from public.comms_event_catalog
where active and event_key in ('deliverable.preview_sent','deliverable.final_ready',
                               'project.member_assigned','project.assignment_note',
                               'deliverable.client_commented')

union all
select 18, 'A.assignment_events_internal',
       case when count(*) = 0 then 'PASS — assignment events are internal-only'
            else 'FAIL — ' || string_agg(event_key || '=' || audience, ', ') end,
       'a private instruction to staff must never be client-facing'
from public.comms_event_catalog
where event_key in ('project.assignment_note','project.member_assigned') and audience <> 'internal'

-- ─── B. NOTHING CAN SEND, AND NOTHING HAS ───────────────────────────────────
union all
select 20, 'B.channels_safe',
       case when count(*) filter (where enabled and channel <> 'portal') = 0
             and count(*) filter (where not dry_run) = 0
            then 'PASS — every channel dry_run; email/whatsapp disabled'
            else 'FAIL — a channel can send' end,
       string_agg(channel || '(enabled=' || enabled || ',dry_run=' || dry_run || ')', ', ' order by channel)
from public.comms_channels

union all
-- A LIVE SEND, defined on evidence rather than on a free-text provider string.
select 21, 'B.no_live_sends_recorded',
       case when count(*) = 0 then 'PASS — zero rows carry provider evidence of a real send'
            else 'REVIEW — ' || count(*) || ' row(s) are genuine live sends' end,
       coalesce(string_agg(distinct coalesce(provider,'(null)') || '/' || provider_state, ', '), 'none')
from public.comms_outbox
where status in ('sent','delivered') and source_kind = 'native' and not is_legacy_mirror
  and delivery_mode = 'live' and provider_state in ('accepted','delivered')
  and coalesce(provider,'') <> 'legacy_email_deliveries'

union all
select 22, 'B.provider_ack_rule',
       case when pg_get_functiondef('public.comms_settle(uuid,text,text,text,jsonb,text,text)'::regprocedure) ilike '%no_provider_ack%'
            then 'PASS — a live send without provider acknowledgment is recorded as FAILED'
            else 'FAIL — comms_settle would accept an unacknowledged send' end,
       'HTTP 200 is not delivery'

union all
select 23, 'B.delivery_evidence_rule',
       case when pg_get_functiondef('public.comms_settle(uuid,text,text,text,jsonb,text,text)'::regprocedure) ilike '%v_delivered%'
            then 'PASS — "delivered" is downgraded to "sent" without delivery evidence'
            else 'FAIL — comms_settle takes a delivered claim as proof of itself' end,
       'acceptance is not delivery'

-- ─── C. THE SAFETY RULES ────────────────────────────────────────────────────
union all
select 30, 'C.guard_trigger',
       case when exists (select 1 from pg_trigger
                          where tgname = 't_comms_outbox_guard'
                            and tgrelid = 'public.comms_outbox'::regclass and not tgisinternal)
            then 'PASS' else 'FAIL — the guard trigger is not attached' end,
       't_comms_outbox_guard on public.comms_outbox'

union all
select 31, 'C.rules_in_guard',
       case when pg_get_functiondef('public.comms_outbox_guard()'::regprocedure) ilike '%COMMS R0%'
             and pg_get_functiondef('public.comms_outbox_guard()'::regprocedure) ilike '%COMMS R1%'
             and pg_get_functiondef('public.comms_outbox_guard()'::regprocedure) ilike '%COMMS R2%'
             and pg_get_functiondef('public.comms_outbox_guard()'::regprocedure) ilike '%comms_is_external%'
            then 'PASS — R0 + R1 + R2 present; externality and provenance are recomputed, not trusted'
            else 'FAIL' end,
       'server-side enforcement'

union all
select 32, 'C.external_fails_closed',
       case when public.comms_is_external('00000000-0000-0000-0000-000000000000'::uuid) is true
            then 'PASS — an unknown user is treated as EXTERNAL'
            else 'FAIL — unknown user is not fail-closed' end,
       'comms_is_external(unknown) must be true'

union all
select 33, 'C.no_client_template_for_internal_event',
       case when count(*) = 0 then 'PASS'
            else 'FAIL — ' || count(*) || ' client template(s) on internal-only event(s)' end,
       coalesce(string_agg(distinct t.event_key, ', '), 'none')
from public.comms_templates t
join public.comms_event_catalog c on c.event_key = t.event_key
where t.audience_scope = 'client' and c.audience = 'internal'

union all
-- Zero is normal on a fresh install; a non-zero number is the rules working.
select 34, 'C.blocked_recipients', 'INFO',
       coalesce((select string_agg(action || '=' || n::text, ', ')
                   from (select action, count(*) as n from public.comms_audit
                          where action in ('recipient_blocked_r1','content_blocked_r2')
                          group by action) s), 'none yet')

-- ─── P. PROVENANCE ──────────────────────────────────────────────────────────
union all
select 40, 'P.columns',
       case when count(*) = 4 then 'PASS — all four provenance columns exist and are NOT NULL'
            else 'FAIL — only ' || count(*) || ' of 4 present and non-nullable' end,
       coalesce(string_agg(column_name || ' ' || data_type, ', ' order by column_name), 'none')
from information_schema.columns
where table_schema = 'public' and table_name = 'comms_outbox' and is_nullable = 'NO'
  and column_name in ('source_kind','is_legacy_mirror','delivery_mode','provider_state')

union all
select 41, 'P.constraints',
       case when count(*) = 6 then 'PASS — vocabulary, consistency and R0 are all CHECK-enforced'
            else 'FAIL — only ' || count(*) || ' of 6 validated CHECK constraints' end,
       coalesce(string_agg(conname, ', ' order by conname), 'none')
from pg_constraint
where conrelid = 'public.comms_outbox'::regclass and contype = 'c' and convalidated
  and conname in ('comms_outbox_source_kind_ck','comms_outbox_delivery_mode_ck',
                  'comms_outbox_provider_state_ck','comms_outbox_provenance_consistent_ck',
                  'comms_outbox_delivery_mode_matches_dry_run_ck',
                  'comms_outbox_mirror_never_live_ck')

union all
-- R0 as DATA, not only as a constraint definition.
select 42, 'P.mirror_never_live',
       case when count(*) = 0 then 'PASS — no legacy mirror carries provider evidence'
            else 'FAIL — ' || count(*) || ' mirrored row(s) claim provider evidence' end,
       'is_legacy_mirror AND provider_state in (accepted, delivered) must be empty'
from public.comms_outbox
where is_legacy_mirror and provider_state in ('accepted','delivered')

union all
-- The forged-success detector. Any number but 0 is a bug in a settle path.
select 43, 'P.no_forged_success',
       case when count(*) = 0 then 'PASS — nothing claims a terminal success without provider evidence'
            else 'FAIL — ' || count(*) || ' row(s) claim sent/delivered with no evidence' end,
       'native + live + sent/delivered + provider_state not in (accepted, delivered)'
from public.comms_outbox
where status in ('sent','delivered') and source_kind = 'native' and not is_legacy_mirror
  and delivery_mode = 'live' and provider_state not in ('accepted','delivered')

union all
select 44, 'P.provenance_agrees_with_legacy_link',
       case when count(*) = 0 then 'PASS — the flag, the FK link and the provider string agree on every row'
            else 'FAIL — ' || count(*) || ' row(s) disagree about being a mirror' end,
       'is_legacy_mirror vs legacy_delivery_id vs provider'
from public.comms_outbox
where is_legacy_mirror <> (legacy_delivery_id is not null
                           or coalesce(provider,'') = 'legacy_email_deliveries')

-- ─── D. THE LEGACY QUEUE WAS NOT TOUCHED ────────────────────────────────────
union all
select 50, 'D.legacy_mirror_is_terminal_only',
       case when count(*) = 0 then 'PASS — no mirrored row is in a runnable state'
            else 'FAIL — ' || count(*) || ' mirrored row(s) are claimable' end,
       'a mirrored row must never be claimed, retried or re-sent'
from public.comms_outbox
where (is_legacy_mirror or legacy_delivery_id is not null)
  and status in ('queued','retrying','processing')

union all
select 51, 'D.legacy_queue_now', 'INFO — must equal the PREFLIGHT baseline',
       case when to_regclass('public.email_deliveries') is null then 'email_deliveries ABSENT'
            else (select coalesce(string_agg(status || '=' || n::text, ', ' order by status), 'empty')
                    from (select status, count(*) as n from public.email_deliveries group by status) s) end

-- ─── E. LEGACY vs DRY-RUN vs LIVE, KEPT APART ───────────────────────────────
union all
select 60, 'E.outbox_breakdown', 'INFO',
       'total=' || count(*) ||
       ' · mirrored_legacy=' || count(*) filter (where is_legacy_mirror) ||
       ' · imported='        || count(*) filter (where source_kind = 'imported') ||
       ' · dry_run='         || count(*) filter (where delivery_mode = 'dry_run') ||
       ' · live_with_evidence=' ||
         count(*) filter (where source_kind = 'native' and not is_legacy_mirror
                            and delivery_mode = 'live'
                            and provider_state in ('accepted','delivered')) ||
       ' · runnable='        || count(*) filter (where status in ('queued','retrying','processing'))
from public.comms_outbox

union all
select 61, 'E.outbox_by_status', 'INFO',
       coalesce((select string_agg(status || '=' || n || '(dry_run ' || d || ')', ', ' order by status)
                   from (select status, count(*) as n, count(*) filter (where dry_run) as d
                           from public.comms_outbox group by status) s), 'empty')

-- ─── G. THE anon ALLOWLIST, ACROSS ALL PRIVILEGE TYPES ──────────────────────
-- No filter on privilege_type anywhere below. A check that enumerates SELECT /
-- INSERT / UPDATE / DELETE is a denylist of four verbs with an allowlist's name,
-- and that is precisely how REFERENCES, TRIGGER and TRUNCATE survived on these
-- tables long enough for the PREFLIGHT to find them. TRUNCATE is not restricted
-- by row level security at all.
union all
select 70, 'G.anon_allowlist_legacy_tables',
       case when count(*) = 0 then 'PASS — anon/PUBLIC hold NO privilege of any type outside the allowlist'
            else 'FAIL — ' || count(*) || ' privilege(s) outside the allowlist' end,
       coalesce(string_agg(distinct g.grantee || ' ' || g.privilege_type || ' on ' || g.table_name, ', '), 'none')
from information_schema.role_table_grants g
join legacy_tables lt on lt.t = g.table_name
where g.table_schema = 'public' and g.grantee in ('anon','PUBLIC')
  and not exists (select 1 from allowed a
                   where a.table_name = g.table_name and a.grantee = g.grantee
                     and a.privilege_type = g.privilege_type)

union all
select 71, 'G.anon_allowlist_comms_tables',
       case when count(*) = 0 then 'PASS — anon/PUBLIC hold NO privilege of any type on comms_*'
            else 'FAIL — ' || count(*) || ' privilege(s) held' end,
       coalesce(string_agg(distinct grantee || ' ' || privilege_type || ' on ' || table_name, ', '), 'none')
from information_schema.role_table_grants
where table_schema = 'public' and table_name like 'comms\_%' and grantee in ('anon','PUBLIC')

union all
-- Proof of REACH, so the reader can see the check is not blind to a type it
-- never thought to name: every privilege type anon holds anywhere in public.
select 72, 'G.anon_privilege_types_seen_in_public', 'INFO',
       coalesce((select string_agg(distinct privilege_type, ', ' order by privilege_type)
                   from information_schema.role_table_grants
                  where table_schema = 'public' and grantee in ('anon','PUBLIC')), 'none')

union all
select 73, 'G.anon_execute_on_notify_helpers',
       case when count(*) = 0 then 'PASS — anon cannot execute the notification writers'
            else 'REVIEW — ' || count(*) || ' EXECUTE grant(s); confirm each has a named public caller' end,
       coalesce(string_agg(distinct routine_name, ', '), 'none')
from information_schema.routine_privileges
where routine_schema = 'public' and grantee in ('anon','PUBLIC')
  and routine_name in ('notify','notify_emit_event','notification_dispatch_portal',
                       'notification_resolve_recipients')

-- ─── G2. ONE ASSERTION PER PRIVILEGE TYPE ──────────────────────────────────
-- The rows above ask "is anything held?" in aggregate. These ask the question
-- once for EACH of the seven table privilege types, so a report cannot say PASS
-- while quietly never having considered TRUNCATE. Every type is named, and the
-- type list is the driving table (a LEFT JOIN), so each type produces a row even
-- when the answer is zero — a type can never vanish from the report by being clean.
union all
select 74 + t.ord, 'G2.anon_zero_' || lower(t.pt),
       case when count(g.table_name) = 0
            then 'PASS — anon/PUBLIC hold no ' || t.pt || ' on any communications table'
            else 'FAIL — ' || count(g.table_name) || ' ' || t.pt || ' grant(s)' end,
       coalesce(string_agg(distinct g.grantee || ' on ' || g.table_name, ', '), 'none')
from (values ('SELECT',1),('INSERT',2),('UPDATE',3),('DELETE',4),
             ('TRUNCATE',5),('REFERENCES',6),('TRIGGER',7)) t(pt, ord)
left join information_schema.role_table_grants g
  on  g.table_schema = 'public'
  and g.grantee in ('anon','PUBLIC')
  and g.privilege_type = t.pt
  and (g.table_name like 'comms\_%'
    or g.table_name in ('notifications','notification_events','notification_preferences',
                        'notification_delivery_log','email_deliveries'))
group by t.pt, t.ord

-- ─── G3. NON-VACUITY, PER PRIVILEGE TYPE ───────────────────────────────────
-- G2 is seven "expect zero" checks, and a broken query returns zero just as
-- convincingly as a clean database. For each type, this row reports whether the
-- probe can see that type AT ALL elsewhere in public. A type reported as
-- unobservable means the corresponding G2 PASS carries no information.
union all
select 82 + t.ord, 'G3.probe_sees_' || lower(t.pt) || '_elsewhere',
       case when count(g.table_name) > 0
            then 'PASS — probe observes ' || t.pt || ' on ' || count(distinct g.table_name) || ' other public table(s), so the G2 check is real'
            else 'REVIEW — probe never observes ' || t.pt || ' anywhere in public; G2.anon_zero_' || lower(t.pt) || ' may be vacuous' end,
       coalesce(string_agg(distinct g.table_name, ', '), 'none')
from (values ('SELECT',1),('INSERT',2),('UPDATE',3),('DELETE',4),
             ('TRUNCATE',5),('REFERENCES',6),('TRIGGER',7)) t(pt, ord)
left join information_schema.role_table_grants g
  on  g.table_schema = 'public'
  and g.grantee in ('anon','PUBLIC')
  and g.privilege_type = t.pt
  and not (g.table_name like 'comms\_%'
        or g.table_name in ('notifications','notification_events','notification_preferences',
                            'notification_delivery_log','email_deliveries'))
group by t.pt, t.ord

-- ─── G4. SEQUENCES ─────────────────────────────────────────────────────────
-- A sequence is not a table. `revoke all on table` never reaches it, and USAGE
-- on the sequence behind an identity column is a privilege in its own right.
-- comms_audit.id is `bigint generated always as identity`, so this is not
-- hypothetical here.
union all
select 90, 'G4.anon_zero_on_owned_sequences',
       -- Phrased as a list, not as "UPDATE on ...": the read-only guard in
       -- tests/comms_feature_detection.test.js greps for an UPDATE statement,
       -- and prose that reads like one is a false positive worth avoiding.
       case when count(*) = 0 then 'PASS — anon/PUBLIC hold no sequence privilege (USAGE, SELECT, UPDATE)'
            else 'FAIL — ' || count(*) || ' sequence privilege(s) held' end,
       coalesce(string_agg(distinct u.grantee || ' ' || u.privilege_type || ' on ' || u.object_name, ', '), 'none')
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

-- ─── G5. THE FUNCTION ALLOWLIST SURVIVED THE TABLE REVOKE ──────────────────
-- The whole point of keeping table privileges and routine privileges in separate
-- statements. If revoking CRUD had collateral-damaged the one legitimate public
-- RPC, the public opportunities form would be dead and this row would say so.
union all
-- to_regprocedure(), never 'literal'::regprocedure. The cast form is a CONSTANT
-- expression, so the planner evaluates it before any CASE branch runs and the
-- whole POSTCHECK dies with "function does not exist" on a database where the
-- opportunities module was never installed — the exact case the first branch
-- exists to handle. to_regprocedure returns NULL instead of raising.
-- The single-row anchor with a LEFT JOIN keeps this row present even when the
-- function is absent; a bare `from pg_proc where …` would emit no row at all,
-- and a check that vanishes is indistinguishable from a check that passed.
select 91, 'G5.allowlisted_public_rpc_intact',
       case
         when a.oid is null then 'INFO — submit_opportunity_request absent on this database'
         when coalesce(has_function_privilege('anon', a.oid, 'EXECUTE'), false)
          and coalesce(p.prosecdef, false)
          and coalesce(array_to_string(p.proconfig, ','), '') ilike '%search_path%'
           then 'PASS — anon EXECUTE retained, SECURITY DEFINER, search_path pinned'
         else 'FAIL — the allowlisted public RPC is broken or no longer qualifies'
       end,
       'the only entry on the public-callable allowlist'
from (select to_regprocedure('public.submit_opportunity_request(text,text,text,text,text,text,jsonb,boolean)') as oid) a
left join pg_proc p on p.oid = a.oid

-- ─── H. THE authenticated CONTRACT ON notification_preferences ─────────────
-- The section the previous run died in, rebuilt around what the code actually
-- does. Everything here reads the ACL catalogues directly, at BOTH
-- granularities, because a column-level grant is invisible to
-- has_table_privilege() and to information_schema.role_table_grants — which is
-- precisely how a table-level guard came to assert a requirement that had never
-- been true. Read-only; nothing below calls a protected RPC, and nothing below
-- depends on auth.uid(), so it is safe from the SQL editor.
union all
select 100, 'H.np_table_exists',
       case when (select reloid from np) is not null then 'PASS' else 'FAIL — public.notification_preferences is absent' end,
       'every H row below is about this table'

union all
select 101, 'H.np_anon_zero',
       case when (select count(*) from np_tbl_acl where grantee_name = 'anon')
               + (select count(*) from np_col_acl where grantee_name = 'anon') = 0
            then 'PASS — anon holds ZERO privileges, table-level and column-level'
            else 'FAIL — anon still holds privileges' end,
       coalesce((select string_agg(distinct priv, ', ' order by priv)
                   from np_tbl_acl where grantee_name = 'anon'), 'none (table)')
       || ' · ' ||
       coalesce((select string_agg(distinct priv || '(' || column_name || ')', ', ')
                   from np_col_acl where grantee_name = 'anon'), 'none (column)')

union all
select 102, 'H.np_public_zero',
       case when (select count(*) from np_tbl_acl where grantee_name = 'PUBLIC')
               + (select count(*) from np_col_acl where grantee_name = 'PUBLIC') = 0
            then 'PASS — PUBLIC holds ZERO privileges, table-level and column-level'
            else 'FAIL — PUBLIC still holds privileges, and every role inherits them' end,
       coalesce((select string_agg(distinct priv, ', ' order by priv)
                   from np_tbl_acl where grantee_name = 'PUBLIC'), 'none (table)')
       || ' · ' ||
       coalesce((select string_agg(distinct priv || '(' || column_name || ')', ', ')
                   from np_col_acl where grantee_name = 'PUBLIC'), 'none (column)')

union all
-- DIRECT, not merely effective. has_table_privilege() would also answer true for
-- a privilege inherited from PUBLIC — the very state the revoke removes — so a
-- grant arriving via PUBLIC must NOT be able to satisfy this row.
select 103, 'H.np_authenticated_direct_select',
       case when exists (select 1 from np_tbl_acl
                          where grantee_name = 'authenticated' and priv = 'SELECT')
            then 'PASS — DIRECT table SELECT, so it survives any future revocation of PUBLIC'
            when coalesce(has_table_privilege('authenticated', (select reloid from np), 'SELECT'), false)
            then 'FAIL — SELECT is only EFFECTIVE, not DIRECT: it is inherited, and revoking PUBLIC removes it'
            else 'FAIL — no SELECT at all; lib/portal/account.ts:32 (select=*) would return nothing' end,
       'required by account.ts:32 (GET select=*) and by account.ts:42 (Prefer: return=representation)'

union all
select 104, 'H.np_authenticated_direct_update_columns',
       case when (select count(*) from np_col_acl
                   where grantee_name = 'authenticated' and priv = 'UPDATE'
                     and column_name in (select c from np_cols)) = (select count(*) from np_cols)
             and (select count(*) from np_col_acl
                   where grantee_name = 'authenticated' and priv = 'UPDATE'
                     and column_name not in (select c from np_cols)) = 0
             and not coalesce(has_table_privilege('authenticated', (select reloid from np), 'UPDATE'), false)
            then 'PASS — exactly the three preference columns are directly writable; the whole-table privilege is absent'
            when coalesce(has_table_privilege('authenticated', (select reloid from np), 'UPDATE'), false)
            then 'FAIL — the write privilege covers the WHOLE TABLE; user_id and updated_at are writable too'
            else 'FAIL — the three preference columns are not all directly updatable' end,
       coalesce((select string_agg(column_name, ', ' order by column_name) from np_col_acl
                  where grantee_name = 'authenticated' and priv = 'UPDATE'), 'none')
       || '   (required: portal_enabled, email_enabled, whatsapp_enabled — account.ts:42)'

union all
-- INSERT is not on the allowlist and its absence is asserted, not shrugged at.
-- The first-use path was checked specifically: updateMyPrefs PATCHes, it never
-- POSTs, and the row is created at signup by a SECURITY DEFINER trigger.
select 105, 'H.np_authenticated_no_insert',
       case when not coalesce(has_table_privilege('authenticated', (select reloid from np), 'INSERT'), false)
             and not exists (select 1 from np_col_acl
                              where grantee_name = 'authenticated' and priv = 'INSERT')
            then 'PASS — no INSERT, and none is needed: handle_new_user() creates the row as SECURITY DEFINER'
            else 'FAIL — authenticated can INSERT; no code path does, so nothing would catch it going wrong' end,
       'first-row creation is phase0_migration.sql:515 (signup trigger) and :127 (backfill), not the browser'

union all
select 106, 'H.np_authenticated_forbidden_zero',
       case when (select count(*) from (
                    select 1 from unnest(array['TRUNCATE','REFERENCES','TRIGGER','DELETE']) v(pt)
                     where coalesce(has_table_privilege('authenticated', (select reloid from np), v.pt), false)
                    union all
                    select 1 from np_col_acl
                     where grantee_name = 'authenticated' and priv in ('INSERT','REFERENCES')
                  ) z) = 0
            then 'PASS — none of the forbidden types is held, at either granularity'
            else 'FAIL — a forbidden privilege is held' end,
       'forbidden: ' || array_to_string(array['TRUNCATE','REFERENCES','TRIGGER','DELETE','INSERT'], ', ')
         || ' — the first of those is NOT restricted by row level security at all'

union all
select 107, 'H.np_row_isolation_rls',
       case when (select c.relrowsecurity from pg_class c where c.oid = (select reloid from np))
            then 'PASS — row level security is enabled'
            else 'FAIL — RLS is OFF; the grants above would expose every user''s row' end,
       'a table privilege decides WHETHER; only RLS decides WHICH ROW'

union all
-- Structural, because a read-only check running with auth.uid() = NULL cannot
-- impersonate two users. What it CAN prove is that no permissive policy is
-- unconditionally true and that every read path is keyed on the caller's own id.
select 108, 'H.np_cross_user_read_denied',
       case when (select count(*) from np_policy
                   where permissive and polcmd in ('r','*') and qual ~ 'auth\.uid\(\)') = 0
            then 'FAIL — no own-row SELECT policy keyed on auth.uid()'
            when (select count(*) from np_policy
                   where permissive and polcmd in ('r','*') and (qual = '' or qual = 'true')) > 0
            then 'FAIL — a permissive read policy is unconditionally true; every user reads every row'
            else 'PASS — every permissive read path is keyed on auth.uid() (admins read all by design, via is_admin())'
       end,
       coalesce((select string_agg(polname || ' USING ' || qual, ' | ' order by polname)
                   from np_policy where polcmd in ('r','*')), 'no read policy at all')

union all
select 109, 'H.np_cross_user_update_denied',
       case when (select count(*) from np_policy
                   where permissive and polcmd in ('w','*') and qual ~ 'auth\.uid\(\)') = 0
            then 'FAIL — no own-row write policy keyed on auth.uid()'
            when (select count(*) from np_policy
                   where permissive and polcmd in ('w','a','*')
                     and (wcheck = '' or wcheck = 'true' or wcheck !~ 'auth\.uid\(\)')) > 0
            then 'FAIL — a write policy has no effective WITH CHECK keyed on auth.uid(); a user could rewrite another user''s row'
            when exists (select 1 from np_col_acl
                          where grantee_name = 'authenticated' and priv = 'UPDATE'
                            and column_name = 'user_id')
              or coalesce(has_column_privilege('authenticated', (select reloid from np), 'user_id', 'UPDATE'), false)
            then 'FAIL — user_id is writable; the row can be re-pointed at another user'
            else 'PASS — WITH CHECK keyed on auth.uid(), and user_id is not writable at all'
       end,
       coalesce((select string_agg(polname || ' WITH CHECK ' || wcheck, ' | ' order by polname)
                   from np_policy where polcmd in ('w','a','*')), 'no write policy at all')

union all
-- The account.ts contract as a whole: the three columns it names must exist, and
-- select=* must be able to return every column of the row.
select 110, 'H.np_account_ts_contract',
       case when (select count(*) from information_schema.columns
                   where table_schema = 'public' and table_name = 'notification_preferences'
                     and column_name in (select c from np_cols)) = (select count(*) from np_cols)
             and coalesce(has_table_privilege('authenticated', (select reloid from np), 'SELECT'), false)
            then 'PASS — the three toggles exist and the whole row is readable, so select=* and the PATCH representation both work'
            else 'FAIL — the account preferences screen would break' end,
       'lib/portal/account.ts:29-45 · components/portal/ProfileSettings.tsx:47,75'

union all
-- NON-VACUITY for the column probe. public.profiles carries a column-level
-- UPDATE grant on five columns and NOT on account_type (phase0_migration.sql:778),
-- so one control shows the probe both sees a column grant and discriminates
-- between columns. A probe stuck on true or on false fails one half or the other.
-- The regclass form, never the text form: the text form RAISES on a missing
-- table, and SQL does not guarantee the `is null` branch of a CASE runs first
-- when every argument is a constant. The regclass form returns NULL instead.
select 111, 'H.np_column_probe_non_vacuous',
       case when to_regclass('public.profiles') is null then 'INFO — public.profiles absent; no control available'
            when coalesce(has_column_privilege('authenticated', to_regclass('public.profiles')::oid, 'full_name', 'UPDATE'), false)
             and not coalesce(has_column_privilege('authenticated', to_regclass('public.profiles')::oid, 'account_type', 'UPDATE'), false)
            then 'PASS — the column probe sees a real column-level privilege AND distinguishes a column without one'
            else 'REVIEW — the control did not read as expected; treat H.np_* results as UNPROVEN until explained' end,
       'control: profiles.full_name is column-granted, profiles.account_type is not (phase0_migration.sql:778)'
)
select check_id, verdict, detail from checks order by sort_key;

-- ─── FATAL SUMMARY — raises an ERROR only on a real failure ─────────────────
do $verdict$
declare v_fail int := 0; v_names text;
begin
  select count(*), string_agg(x.id, ', ')
    into v_fail, v_names
  from (
    select 'A.tables' as id where (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
                                    where n.nspname='public' and c.relkind='r' and c.relname like 'comms\_%') <> 7
    union all
    select 'A.no_anon_comms_tables' where exists (
      select 1 from information_schema.role_table_grants
       where table_schema='public' and table_name like 'comms\_%' and grantee in ('anon','PUBLIC'))
    union all
    select 'B.channels_safe' where exists (
      select 1 from public.comms_channels where (enabled and channel <> 'portal') or not dry_run)
    union all
    select 'C.guard_trigger' where not exists (
      select 1 from pg_trigger where tgname='t_comms_outbox_guard'
        and tgrelid='public.comms_outbox'::regclass and not tgisinternal)
    union all
    select 'P.columns' where (select count(*) from information_schema.columns
                               where table_schema='public' and table_name='comms_outbox'
                                 and is_nullable='NO'
                                 and column_name in ('source_kind','is_legacy_mirror',
                                                     'delivery_mode','provider_state')) <> 4
    union all
    select 'P.constraints' where (select count(*) from pg_constraint
                                   where conrelid='public.comms_outbox'::regclass and contype='c'
                                     and convalidated
                                     and conname in ('comms_outbox_source_kind_ck','comms_outbox_delivery_mode_ck',
                                                     'comms_outbox_provider_state_ck',
                                                     'comms_outbox_provenance_consistent_ck',
                                                     'comms_outbox_delivery_mode_matches_dry_run_ck',
                                                     'comms_outbox_mirror_never_live_ck')) <> 6
    union all
    select 'P.mirror_never_live' where exists (
      select 1 from public.comms_outbox where is_legacy_mirror
        and provider_state in ('accepted','delivered'))
    union all
    select 'P.no_forged_success' where exists (
      select 1 from public.comms_outbox
       where status in ('sent','delivered') and source_kind='native' and not is_legacy_mirror
         and delivery_mode='live' and provider_state not in ('accepted','delivered'))
    union all
    select 'D.legacy_mirror_is_terminal_only' where exists (
      select 1 from public.comms_outbox
       where (is_legacy_mirror or legacy_delivery_id is not null)
         and status in ('queued','retrying','processing'))
    union all
    select 'G.anon_allowlist_legacy_tables' where exists (
      select 1 from information_schema.role_table_grants
       where table_schema='public' and grantee in ('anon','PUBLIC')
         and table_name in ('notifications','notification_events','notification_preferences',
                            'notification_delivery_log','email_deliveries'))
    union all
    -- Sequences are a separate catalogue and a separate revoke. Their own row.
    select 'G4.anon_zero_on_owned_sequences' where exists (
      select 1 from information_schema.usage_privileges u
       where u.object_schema='public' and u.object_type='SEQUENCE'
         and u.grantee in ('anon','PUBLIC')
         and exists (
           select 1 from pg_class s
             join pg_namespace sn on sn.oid = s.relnamespace
             join pg_depend d on d.objid = s.oid and d.classid = 'pg_class'::regclass
             join pg_class tb on tb.oid = d.refobjid
            where s.relkind='S' and sn.nspname='public'
              and s.relname::text = u.object_name::text and d.deptype in ('a','i')
              and (tb.relname::text like 'comms\_%'
                or tb.relname::text in ('notifications','notification_events',
                                        'notification_preferences','notification_delivery_log',
                                        'email_deliveries'))))
    union all
    -- Collateral damage to the allowlisted public RPC is a failure of this
    -- migration, not an acceptable side effect of tightening tables.
    -- The oid form, and an explicit boolean. SQL does NOT guarantee that `A and
    -- B` evaluates A first, so a to_regprocedure() guard in the same AND cannot
    -- protect a text-form has_function_privilege() from raising on an absent
    -- function. Passing the oid makes it return NULL instead, and coalesce turns
    -- that NULL into an explicit false: absent is not a failure, and no predicate
    -- here is ever NULL.
    select 'G5.allowlisted_public_rpc_intact'
     where coalesce(
             not has_function_privilege('anon',
               to_regprocedure('public.submit_opportunity_request(text,text,text,text,text,text,jsonb,boolean)'),
               'EXECUTE'),
             false)
    union all
    -- A vacuous probe must not be able to report success. anon holds privileges
    -- on other public tables in this database; seeing none means the catalogue
    -- query is broken and every "PASS" above is meaningless.
    select 'G3.probe_is_vacuous'
     where not exists (
       select 1 from information_schema.role_table_grants
        where table_schema='public' and grantee in ('anon','PUBLIC'))

    -- ─── H. THE authenticated CONTRACT ────────────────────────────────────
    -- Every condition below reads pg_class.relacl / pg_attribute.attacl rather
    -- than has_table_privilege() alone. Two reasons, both learned the hard way:
    -- a column-level grant is invisible to the table-level probe, and
    -- has_table_privilege() cannot tell a DIRECT grant from one inherited via
    -- PUBLIC — so a grant arriving via PUBLIC must not be able to satisfy these.
    -- Each is guarded on the table existing, so an absent table is `absent`,
    -- never a false failure.
    union all
    select 'H.np_anon_or_public_hold_privileges' where
      exists (select 1 from pg_class c cross join lateral aclexplode(c.relacl) a
               where c.oid = to_regclass('public.notification_preferences')::oid
                 and (a.grantee = 0 or a.grantee = to_regrole('anon')::oid))
      or exists (select 1 from pg_attribute at cross join lateral aclexplode(at.attacl) a
                  where at.attrelid = to_regclass('public.notification_preferences')::oid
                    and at.attnum > 0 and not at.attisdropped
                    and (a.grantee = 0 or a.grantee = to_regrole('anon')::oid))
    union all
    select 'H.np_authenticated_direct_select'
     where to_regclass('public.notification_preferences') is not null
       and not exists (select 1 from pg_class c cross join lateral aclexplode(c.relacl) a
                        where c.oid = to_regclass('public.notification_preferences')::oid
                          and a.grantee = to_regrole('authenticated')::oid
                          and a.privilege_type = 'SELECT')
    union all
    select 'H.np_authenticated_direct_update_columns'
     where to_regclass('public.notification_preferences') is not null
       and ((select count(*) from pg_attribute at cross join lateral aclexplode(at.attacl) a
              where at.attrelid = to_regclass('public.notification_preferences')::oid
                and at.attnum > 0 and not at.attisdropped
                and a.grantee = to_regrole('authenticated')::oid and a.privilege_type = 'UPDATE'
                and at.attname = any (array['portal_enabled','email_enabled','whatsapp_enabled'])) <> 3
         or (select count(*) from pg_attribute at cross join lateral aclexplode(at.attacl) a
              where at.attrelid = to_regclass('public.notification_preferences')::oid
                and at.attnum > 0 and not at.attisdropped
                and a.grantee = to_regrole('authenticated')::oid and a.privilege_type = 'UPDATE'
                and at.attname <> all (array['portal_enabled','email_enabled','whatsapp_enabled'])) > 0
         or has_table_privilege('authenticated', to_regclass('public.notification_preferences')::oid, 'UPDATE'))
    union all
    select 'H.np_authenticated_forbidden_privileges'
     where to_regclass('public.notification_preferences') is not null
       and (has_table_privilege('authenticated', to_regclass('public.notification_preferences')::oid, 'TRUNCATE')
         or has_table_privilege('authenticated', to_regclass('public.notification_preferences')::oid, 'REFERENCES')
         or has_table_privilege('authenticated', to_regclass('public.notification_preferences')::oid, 'TRIGGER')
         or has_table_privilege('authenticated', to_regclass('public.notification_preferences')::oid, 'DELETE')
         or has_table_privilege('authenticated', to_regclass('public.notification_preferences')::oid, 'INSERT'))
    union all
    select 'H.np_row_isolation_rls' where exists (
      select 1 from pg_class c
       where c.oid = to_regclass('public.notification_preferences')::oid and not c.relrowsecurity)
    union all
    select 'H.np_cross_user_read_denied'
     where to_regclass('public.notification_preferences') is not null
       and (not exists (select 1 from pg_policy p
                         where p.polrelid = to_regclass('public.notification_preferences')::oid
                           and p.polpermissive and p.polcmd in ('r','*')
                           and coalesce(pg_get_expr(p.polqual, p.polrelid), '') ~ 'auth\.uid\(\)')
         or exists (select 1 from pg_policy p
                     where p.polrelid = to_regclass('public.notification_preferences')::oid
                       and p.polpermissive and p.polcmd in ('r','*')
                       and coalesce(pg_get_expr(p.polqual, p.polrelid), '') in ('', 'true')))
    union all
    select 'H.np_cross_user_update_denied'
     where to_regclass('public.notification_preferences') is not null
       and (has_column_privilege('authenticated', to_regclass('public.notification_preferences')::oid,
                                 'user_id', 'UPDATE')
         or not exists (select 1 from pg_policy p
                         where p.polrelid = to_regclass('public.notification_preferences')::oid
                           and p.polpermissive and p.polcmd in ('w','*')
                           and coalesce(pg_get_expr(p.polqual, p.polrelid), '') ~ 'auth\.uid\(\)')
         or exists (select 1 from pg_policy p
                     where p.polrelid = to_regclass('public.notification_preferences')::oid
                       and p.polpermissive and p.polcmd in ('w','a','*')
                       and coalesce(nullif(coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''), ''),
                                    coalesce(pg_get_expr(p.polqual, p.polrelid), '')) !~ 'auth\.uid\(\)'))
  ) x;

  if v_fail > 0 then
    raise exception 'POSTCHECK FAILED — % check(s): %. Do not open docs/COMMUNICATIONS_GO_LIVE_GUIDE.md until every one is green.', v_fail, v_names;
  end if;
  raise notice 'POSTCHECK COMPLETE — read-only, no failures. Legacy, dry-run and live are reported separately and are never summed.';
end $verdict$;
