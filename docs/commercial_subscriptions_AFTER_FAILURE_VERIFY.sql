-- ════════════════════════════════════════════════════════════════════════════
-- COMMERCIAL SUBSCRIPTIONS — AFTER-FAILURE VERIFY (READ-ONLY · ONE RESULT SET)
--
-- ⚠️ SECOND FAILURE — READ THIS FIRST (2026-07-31)
--   After the repair below was applied to the file, the corrected PREFLIGHT ran
--   and PASSED, and RUNME was run again. It ABORTED BEFORE COMMIT a second time,
--   for a completely unrelated reason — not a self-test verdict but a REGEX
--   COMPILE error, so no check ever ran:
--
--     ERROR 2201B: invalid regular expression: invalid repetition count(s)
--     PL/pgSQL function inline_code_block line 255 at assignment
--
--   Block `do $st$` (the §15 pricing self-test) begins at file line 2609, so
--   plpgsql line 255 is file line 2863 — `v_txt := regexp_replace(v_txt,` —
--   whose pattern was:
--       '[a-z_]+'\s*,\s*case\s+when\s+v_price\s+then[^;]{0,400}?else\s+null\s+end
--   PostgreSQL caps a regex repetition bound at 255 (RE_DUP_MAX). {0,400}
--   exceeds it, so the ENGINE refused to compile the pattern. JavaScript RegExp
--   has no such cap, which is exactly why every Node test compiled it happily —
--   the local tests were not under-covering, they were measuring with the wrong
--   ruler. tests/sql_regex_postgres_compat.test.js now judges by PostgreSQL ARE
--   rules instead, and refuses any bound over 255 anywhere in this package.
--
--   The fix removes the bound rather than shrinking it: `[^;]*?`. A negated
--   class is already linear, so the bound bought nothing — and it did harm: a
--   masked expression longer than 400 characters escaped the strip step and
--   would have been read as an unmasked leak.
--
--   CONSEQUENCE FOR STATE: identical to the first failure. One transaction, one
--   COMMIT, no CONCURRENTLY, aborted before COMMIT ⇒ FULL ROLLBACK, no partial
--   state. Everything this file verifies below applies unchanged to both runs.
--
-- WHY THIS FILE EXISTS
--   docs/commercial_subscriptions_PREFLIGHT.sql passed.
--   docs/commercial_subscriptions_RUNME.sql then ABORTED BEFORE COMMIT, at
--   check (11) of its own §17 SELF-TEST:
--
--     ERROR P0001: CSUB §17 SELF-TEST: عمود ماليّ في طلبات الخدمة —
--                  السطح التشغيليّ يجب أن يبقى بلا مال
--
--   THAT MESSAGE NAMED THE WRONG CULPRIT. Check (11) was a substring DENYLIST
--   over column names:
--       column_name ilike '%price%' or '%amount%' or '%cost%'
--                or '%vat%'  or '%margin%' or '%profit%'
--   applied to public.csub_service_requests. The column it fired on is
--
--       reservation_entry_id uuid references public.csub_ledger(id)
--
--   because the letters of "reser·VAT·ion" contain 'vat'. That column is a uuid
--   FOREIGN KEY to the credit ledger — the operational linkage the design
--   REQUIRES — and carries no money at all. A FALSE POSITIVE: the self-test was
--   wrong, not the schema. V2 below proves that ON THIS DATABASE, mechanically,
--   without needing the table to exist.
--
--   The denylist was wrong in the other direction too, and that half is the
--   dangerous one: a genuinely financial column that avoids those six substrings
--   — unit_rate, overage_value, billing_line — would have passed unseen. It has
--   been replaced by an explicit ALLOWLIST (§17.7 checks 11-أ … 11-هـ).
--
-- WHAT IT IS
--   • READ-ONLY. Not one INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, GRANT,
--     REVOKE or TRUNCATE below, and no temp object: the data-dependent probes go
--     through query_to_xml(), a built-in, so nothing has to be defined to run
--     dynamic SQL.
--   • ONE result set, ordered, readable top to bottom.
--   • Safe from the Supabase SQL editor, where auth.uid() is NULL. NO PROTECTED
--     RPC IS CALLED ANYWHERE — calling one is what has already turned a
--     successful migration into a false "not applied" verdict on this project.
--   • Safe whether the csub objects exist or not. Every probe against a csub
--     table is guarded by to_regclass BEFORE the query text is built, so an
--     absent table can never become a "relation does not exist" error.
--
-- WHAT IT PROVES
--   V1  no partial state — the aborted transaction left nothing half-built
--   V2  ★ THE FINGERPRINT ★ the exact false positive, reproduced mechanically
--   V3  the two operational tables carry no money (allowlist, not denylist)
--   V4  the four APPLIED packages are intact: Communications · Operations ·
--       CRM · Finance
--   V5  Communications is still dry-run — nothing can send
--   V6  the frozen project platform was not touched
--   V7  anon holds nothing, anywhere near this module
-- ════════════════════════════════════════════════════════════════════════════

with
-- ─── What actually exists right now ─────────────────────────────────────────
present as (
  select to_regclass('public.csub_subscriptions')     is not null as has_subs,
         to_regclass('public.csub_ledger')            is not null as has_ledger,
         to_regclass('public.csub_service_requests')  is not null as has_sr,
         to_regclass('public.clients')                is not null as has_clients,
         to_regclass('public.comms_channels')         is not null as has_channels
),
-- ─── Catalogue facts: this module ───────────────────────────────────────────
cat as (
  select
    (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'csub\_%')   as n_tables,
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname like 'csub\_%')                        as n_funcs,
    (select count(*) from pg_policies where schemaname = 'public'
      and tablename like 'csub\_%')                                                   as n_policies,
    (select count(*) from pg_trigger where not tgisinternal
      and tgname in ('t_csub_ledger_no_update','t_csub_ledger_no_delete',
                     't_csub_ledger_no_truncate','t_csub_ledger_post'))               as n_triggers,
    (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'S' and c.relname like 'csub\_%')    as n_seqs
),
-- ─── Catalogue facts: the four packages that are ALREADY APPLIED ────────────
-- Counted by their own object prefixes. These four must be untouched by an
-- abort in a different package; if any count is 0 the abort is not the story.
applied as (
  select
    (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'comms\_%')   as comms_t,
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname like 'comms\_%')                        as comms_f,
    (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'ops\_%')     as ops_t,
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname like 'prodops\_%')                      as ops_f,
    (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'crm\_%')     as crm_t,
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname like 'crm\_%')                          as crm_f,
    (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'fin\_%')     as fin_t,
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname like 'finops\_%')                       as fin_f
),
-- ─── ★ THE FINGERPRINT ★ ────────────────────────────────────────────────────
-- The intended column list of csub_service_requests, written out as literal
-- data. It does NOT depend on the table existing — which matters, because after
-- a clean rollback the table does not exist, and the failure must still be
-- explainable from this file alone.
intended(col, kind) as (values
  ('id','uuid'),('code','text'),('client_id','uuid'),('subscription_id','uuid'),
  ('unit_type','text'),('status','text'),('units','numeric'),
  ('credits_required','numeric'),('overage_estimate_units','numeric'),
  ('city','text'),('location_text','text'),('preferred_date','date'),
  ('alternative_date','date'),('scheduled_date','date'),('description','text'),
  ('contact_person_name','text'),('contact_person_phone','text'),('is_urgent','boolean'),
  ('client_notes','text'),('client_decision_note','text'),('internal_notes','text'),
  ('decision_reason','text'),
  ('reservation_entry_id','uuid'),('consumption_entry_id','uuid'),
  ('approval_request_id','uuid'),('project_id','uuid'),
  ('project_linked_at','timestamptz'),('project_linked_by','uuid'),
  ('submitted_at','timestamptz'),('decided_at','timestamptz'),('decided_by','uuid'),
  ('fulfilled_at','timestamptz'),('created_by','uuid'),('created_at','timestamptz'),
  ('updated_at','timestamptz'),('is_deleted','boolean'),('deleted_reason','text')
),
-- Every column the OLD denylist would have rejected, and the substring that did
-- it. This is the abort, reproduced.
denylist_hits as (
  select i.col, i.kind,
         case when i.col ilike '%price%'  then 'price'
              when i.col ilike '%amount%' then 'amount'
              when i.col ilike '%cost%'   then 'cost'
              when i.col ilike '%vat%'    then 'vat'
              when i.col ilike '%margin%' then 'margin'
              else 'profit' end as matched_substring
    from intended i
   where i.col ilike '%price%' or i.col ilike '%amount%' or i.col ilike '%cost%'
      or i.col ilike '%vat%'   or i.col ilike '%margin%' or i.col ilike '%profit%'
),
-- Of those, which actually carry money? A money column would be numeric AND
-- named in the module's money vocabulary. A uuid foreign key is neither.
truly_financial as (
  select d.col from denylist_hits d
   where d.kind = 'numeric'
     and d.col in ('price_net','price_gross','vat_amount','vat_rate',
                   'overage_unit_price_net','overage_amount_net','overage_vat_amount',
                   'overage_amount_gross','unit_price','unit_rate','cost','margin','profit')
),
-- The counter-proof for the OTHER half of the bug: financial column names that
-- the old denylist would have waved straight through.
denylist_misses(col) as (
  select c from (values ('unit_rate'),('overage_value'),('billing_line'),
                        ('selling_figure'),('contract_value'),('receivable')) v(c)
   where c not ilike '%price%' and c not ilike '%amount%' and c not ilike '%cost%'
     and c not ilike '%vat%'   and c not ilike '%margin%' and c not ilike '%profit%'
),
-- ─── Live columns, if the tables happen to exist ────────────────────────────
live_sr_cols as (
  select coalesce(string_agg(column_name || ' ' || data_type, ', ' order by column_name), '')  as s,
         count(*)::int as n
    from information_schema.columns
   where table_schema = 'public' and table_name = 'csub_service_requests'
),
-- Any numeric column on the two operational tables that is NOT one of the three
-- unit counters. Type-aware, so 'reservation_entry_id' can never appear here.
live_money as (
  select coalesce(string_agg(table_name || '.' || column_name, ', '
                             order by table_name, column_name), '') as s
    from information_schema.columns
   where table_schema = 'public'
     and table_name in ('csub_service_requests','csub_service_request_attachments')
     and data_type in ('numeric','double precision','real','money')
     and column_name not in ('units','credits_required','overage_estimate_units')
),
-- ─── Data probes. The QUERY TEXT is chosen before it runs, so a missing table
--     yields a constant instead of an error. ───────────────────────────────────
q(name, sql) as (
  select 'subs_rows',
         case when (select has_subs from present)
              then 'select count(*)::text as v from public.csub_subscriptions'
              else 'select ''-1'' as v' end
  union all
  select 'ledger_rows',
         case when (select has_ledger from present)
              then 'select count(*)::text as v from public.csub_ledger'
              else 'select ''-1'' as v' end
  union all
  select 'sr_rows',
         case when (select has_sr from present)
              then 'select count(*)::text as v from public.csub_service_requests'
              else 'select ''-1'' as v' end
  union all
  select 'clients_rows',
         case when (select has_clients from present)
              then 'select count(*)::text as v from public.clients'
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
),
probe(name, val) as (
  select q.name,
         (xpath('/row/v/text()', query_to_xml(q.sql, false, true, '')))[1]::text
    from q
),
p(name, n) as (
  select name, case when val ~ '^-?[0-9]+$' then val::bigint else null end from probe
),
-- ─── The frozen platform ────────────────────────────────────────────────────
plat as (
  select (select count(*) from pg_policies where schemaname = 'public'
            and tablename in ('projects','project_core','deliverables','deliverable_internal'))::int as pc,
         (select count(*) from information_schema.columns
            where table_schema = 'public' and table_name = 'projects')::int as cc,
         (select count(*) from information_schema.columns
            where table_schema = 'public' and table_name = 'clients')::int  as clc
),
rows_out(sort_key, claim, verdict, detail) as (

-- ═══ V1. NO PARTIAL STATE ══════════════════════════════════════════════════
select 100, 'V1.no_partial_state',
       case when c.n_tables = 0 and c.n_funcs = 0 and c.n_policies = 0
                 and c.n_triggers = 0 and c.n_seqs = 0
              then 'PASS — clean rollback: the aborted transaction left nothing behind'
            when c.n_tables >= 13 and c.n_funcs >= 62 and c.n_triggers = 4
              then 'INSTALLED — a complete package is present (this is not partial state); re-read POSTCHECK, not this file'
            when c.n_tables >= 11 and c.n_funcs >= 62 and c.n_triggers = 4
              then 'INSTALLED (phase 1+2) — the base package is present without the two service-request tables'
            else 'FAIL — PARTIAL STATE: some csub objects exist and some do not; do not re-run until this is understood' end,
       c.n_tables || ' csub_* table(s) · ' || c.n_funcs || ' function(s) · '
         || c.n_policies || ' policy(ies) · ' || c.n_triggers || ' ledger trigger(s) · '
         || c.n_seqs || ' sequence(s)'
from cat c

union all
select 101, 'V1.csub_objects_present', 'INFO',
       coalesce((select string_agg(c.relname, ', ' order by c.relname)
                   from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'public' and c.relkind in ('r','S')
                    and c.relname like 'csub\_%'),
                'none — no csub_* relation exists')

union all
-- The abort was raised by §17.7, i.e. AFTER every DDL statement in the file had
-- already executed inside the transaction. If any of it had survived, V1 is
-- where it would show. This row states the reasoning; V1 is the measurement.
select 102, 'V1.rollback_reasoning', 'INFO',
       'the RUNME is one transaction and uses no CONCURRENTLY, so an exception in §17.7 discards every statement in it — including §3''s CREATE TABLEs and §15''s GRANTs; V1 above is the check of that claim, not a restatement of it'

union all
select 103, 'V1.no_business_data_was_created',
       case when (select n from p where name = 'subs_rows') <= 0
             and (select n from p where name = 'ledger_rows') <= 0
             and (select n from p where name = 'sr_rows') <= 0
              then 'PASS — no subscription, no ledger entry, no service request exists'
            else 'REVIEW — rows exist; they are real data from an earlier successful run, not from the abort (an aborted transaction cannot leave rows)' end,
       'subscriptions=' || (select n from p where name = 'subs_rows')
         || ' · ledger=' || (select n from p where name = 'ledger_rows')
         || ' · service_requests=' || (select n from p where name = 'sr_rows')
         || '   (-1 means the table does not exist)'

-- ═══ V2. ★ THE FINGERPRINT ★ ═══════════════════════════════════════════════
union all
select 110, 'V2.the_false_positive',
       case when not exists (select 1 from denylist_hits)
              then 'UNEXPECTED — the old denylist matches no intended column; the abort had another cause'
            when exists (select 1 from truly_financial)
              then 'REAL LEAK — a genuinely financial column is present: '
                   || (select string_agg(col, ', ') from truly_financial)
            else 'CONFIRMED FALSE POSITIVE — every column the old denylist rejected is non-financial. '
                 || 'The self-test was wrong, not the schema.' end,
       coalesce((select string_agg(d.col || ' (' || d.kind || ') matched ''%' || d.matched_substring || '%''',
                                   '  |  ' order by d.col) from denylist_hits d),
                'no column matches')

union all
select 111, 'V2.why_it_matched', 'INFO — the letters, spelled out',
       'reservation_entry_id  →  reser' || upper('vat') || 'ion_entry_id  →  ilike ''%vat%'' = '
         || ('reservation_entry_id' ilike '%vat%')::text
         || '   ·   it is uuid, not numeric, and it is a FOREIGN KEY to public.csub_ledger(id) — '
         || 'the operational link between a service request and the credit entry it reserved. No money.'

union all
select 112, 'V2.the_other_half_of_the_bug',
       case when exists (select 1 from denylist_misses)
              then 'CONFIRMED — the old denylist would have let '
                   || (select count(*) from denylist_misses)
                   || ' genuinely financial column name(s) through unseen'
            else 'N/A' end,
       'financial names invisible to the six substrings: '
         || coalesce((select string_agg(col, ', ' order by col) from denylist_misses), 'none')
         || '   →  this is why the replacement is an ALLOWLIST: a denylist guards the names someone '
         || 'thought of, an allowlist guards the ones nobody did.'

-- ═══ V3. THE OPERATIONAL SURFACE CARRIES NO MONEY ══════════════════════════
union all
select 120, 'V3.operational_tables_money_free',
       case when not (select has_sr from present)
              then 'N/A — csub_service_requests does not exist (consistent with the rollback)'
            when (select s from live_money) = ''
              then 'PASS — every numeric column on the two operational tables is a unit counter'
            else 'FAIL — non-unit numeric column(s): ' || (select s from live_money) end,
       'checked by TYPE and NAME, not by substring: numeric/real/money columns outside '
         || '{units, credits_required, overage_estimate_units}. A uuid foreign key can never appear here.'

union all
select 121, 'V3.live_columns', 'INFO',
       case when (select n from live_sr_cols) = 0 then 'csub_service_requests does not exist'
            else (select s from live_sr_cols) end

-- ═══ V4. THE FOUR APPLIED PACKAGES ═════════════════════════════════════════
-- One row per package, always emitted, so "nothing found" is a finding and not
-- a query that silently looked nowhere.
union all
select 130, 'V4.communications_hub_intact',
       case when a.comms_t >= 7 and a.comms_f >= 20 then 'PASS — applied and intact'
            when a.comms_t = 0 and a.comms_f = 0 then 'FAIL — ABSENT: the Communications Hub is not on this database'
            else 'REVIEW — partial: ' || a.comms_t || ' table(s), ' || a.comms_f || ' function(s)' end,
       a.comms_t || ' comms_* table(s) · ' || a.comms_f || ' comms_* function(s)   (expected >= 7 / >= 20)'
from applied a

union all
select 131, 'V4.operations_center_intact',
       case when a.ops_t >= 20 and a.ops_f >= 10 then 'PASS — applied and intact'
            when a.ops_t = 0 and a.ops_f = 0 then 'FAIL — ABSENT: the Operations Center is not on this database'
            else 'REVIEW — partial: ' || a.ops_t || ' table(s), ' || a.ops_f || ' function(s)' end,
       a.ops_t || ' ops_* table(s) · ' || a.ops_f || ' prodops_* function(s)   (expected >= 20 / >= 10)'
from applied a

union all
select 132, 'V4.crm_sales_foundation_intact',
       case when a.crm_t >= 20 and a.crm_f >= 10 then 'PASS — applied and intact'
            when a.crm_t = 0 and a.crm_f = 0 then 'FAIL — ABSENT: the CRM foundation is not on this database'
            else 'REVIEW — partial: ' || a.crm_t || ' table(s), ' || a.crm_f || ' function(s)' end,
       a.crm_t || ' crm_* table(s) · ' || a.crm_f || ' crm_* function(s)   (expected >= 20 / >= 10)'
from applied a

union all
select 133, 'V4.finance_profitability_intact',
       case when a.fin_t >= 22 and a.fin_f >= 10 then 'PASS — applied and intact'
            when a.fin_t = 0 and a.fin_f = 0 then 'FAIL — ABSENT: the Finance package is not on this database'
            else 'REVIEW — partial: ' || a.fin_t || ' table(s), ' || a.fin_f || ' function(s)' end,
       a.fin_t || ' fin_* table(s) · ' || a.fin_f || ' finops_* function(s)   (expected >= 22 / >= 10)'
from applied a

union all
select 134, 'V4.why_they_cannot_have_been_harmed', 'INFO',
       'the aborted transaction contains no DDL and no DML against any comms_*, ops_*, crm_* or fin_* object; '
         || 'the rows above are the measurement of that claim, taken independently of it'

-- ═══ V5. COMMUNICATIONS STILL DRY-RUN ══════════════════════════════════════
union all
select 140, 'V5.nothing_can_send',
       case when (select n from p where name = 'channels_that_can_send') is null then 'UNKNOWN'
            when (select n from p where name = 'channels_that_can_send') = -1
              then 'N/A — comms_channels does not exist, so no channel can send'
            when (select n from p where name = 'channels_that_can_send') = 0
              then 'PASS — every channel is dry_run; nothing leaves the database'
            else 'FAIL — ' || (select n from p where name = 'channels_that_can_send')
                 || ' channel(s) could send' end,
       (select val from probe where name = 'channels_detail')

-- ═══ V6. THE FROZEN PLATFORM ═══════════════════════════════════════════════
union all
select 150, 'V6.frozen_platform_snapshot', 'INFO — compare with PREFLIGHT §7; any change means the freeze was breached',
       plat.pc || ' policy(ies) on projects/project_core/deliverables · '
         || plat.cc || ' projects column(s) · ' || plat.clc || ' clients column(s)'
from plat

union all
select 151, 'V6.no_csub_function_writes_to_the_platform',
       case when count(*) = 0 then 'PASS — no csub_* function writes to the frozen platform'
            else 'FAIL — ' || count(*) || ' function(s) write to it' end,
       coalesce(string_agg(p.proname, ', ' order by p.proname), 'none')
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'csub\_%'
  and pg_get_functiondef(p.oid) ~* '(insert\s+into|update|delete\s+from)\s+public\.(projects|project_core|deliverables|deliverable_internal|project_transition_requests)\M'

-- ═══ V7. anon ══════════════════════════════════════════════════════════════
-- No privilege_type filter: listing only SELECT/INSERT/UPDATE/DELETE would be a
-- denylist of four verbs wearing an allowlist's name — the same mistake, one
-- catalogue over. TRUNCATE is not restricted by RLS at all.
union all
select 160, 'V7.anon_on_csub_tables',
       case when count(*) = 0 then 'PASS — anon/PUBLIC hold no privilege of any type on csub_*'
            else 'FAIL — ' || count(*) || ' privilege(s) held' end,
       coalesce(string_agg(distinct grantee || ' ' || privilege_type || ' on ' || table_name, ', '), 'none')
from information_schema.role_table_grants
where table_schema = 'public' and table_name like 'csub\_%' and grantee in ('anon','PUBLIC')

union all
select 161, 'V7.anon_execute_on_csub_functions',
       case when count(*) = 0 then 'PASS — anon holds EXECUTE on no csub_* function'
            else 'FAIL — ' || count(*) || ' function(s) executable by anon' end,
       coalesce(string_agg(distinct p.proname, ', '), 'none')
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'csub\_%'
  and exists (select 1 from pg_roles where rolname = 'anon')
  and has_function_privilege('anon', p.oid, 'EXECUTE')

union all
-- Control row. Without it, a wall of "none" above is indistinguishable from a
-- probe that was structurally unable to find anything.
select 162, 'V7.probe_non_vacuity', 'INFO — control',
       'anon holds ' ||
       (select count(*)::text from information_schema.role_table_grants
         where table_schema = 'public' and grantee in ('anon','PUBLIC'))
       || ' table privilege(s) elsewhere in public, across types: '
       || coalesce((select string_agg(distinct privilege_type, ', ' order by privilege_type)
                      from information_schema.role_table_grants
                     where table_schema = 'public' and grantee in ('anon','PUBLIC')), 'none')
       || '   — if this reads 0/none, the two rows above prove nothing and the query itself is suspect'
)
select claim, verdict, detail from rows_out order by sort_key;
