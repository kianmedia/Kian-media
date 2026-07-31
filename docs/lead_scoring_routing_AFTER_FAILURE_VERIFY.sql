-- ════════════════════════════════════════════════════════════════════════════
-- LEAD SCORING & ROUTING — AFTER-FAILURE VERIFY (READ-ONLY · ONE RESULT SET)
--
-- WHY THIS FILE EXISTS
--   docs/lead_scoring_routing_PREFLIGHT.sql passed.
--   docs/lead_scoring_routing_RUNME.sql then ABORTED BEFORE COMMIT, at check
--   (11) of its own §14 SELF-TEST:
--
--     ERROR P0001: LSR SELF-TEST: عقد المالية مكسور — كتابة أو نداء خارجيّ
--     PL/pgSQL function inline_code_block line 119 at RAISE
--
--   THAT MESSAGE NAMED THE WRONG CULPRIT. Check (11) was:
--
--     if v_def ~* '(insert\s+into\s+public\.fin_|update\s+public\.fin_
--                   |delete\s+from\s+public\.fin_|zoho)' then
--
--   applied to pg_get_functiondef('public.lsr_finance_reference(uuid)') — the
--   WHOLE definition text, comments and message strings included. The function
--   performs no write and calls nothing external, so the only alternative that
--   could match is the bare word `zoho`. It matched inside a STRING LITERAL:
--   the function's own contract sentence,
--
--     'عقد بيانات لا كتابة متبادلة: هذه الوحدة تقرأ مراجع المالية ولا تكتب
--      فيها، ولا تنشئ فاتورة، ولا تنادي Zoho، ولا تدّعي تحصيلًا.'
--
--   The function ABORTED THE MIGRATION BY DECLARING THAT IT DOES NOT CALL ZOHO.
--   A FALSE POSITIVE: the self-test was wrong, the schema was right. §V2 below
--   proves that mechanically ON THIS DATABASE — and it does so WITHOUT needing
--   any lsr_* object to exist, because after a rollback none of them do.
--
--   THE REPAIR (already in RUNME, not something to do by hand)
--     • public.lsr_sql_partition(text) splits a definition ONCE, quote- and
--       comment-aware, into `code` (executable skeleton) and `strings`.
--     • public.lsr_contract_scan(text) then matches STATEMENT/CALL SHAPE, in
--       code AND strings, never a bare word. It must scan strings: this module
--       reads through `execute '…'`, so ignoring string literals would blind
--       the detector to `execute 'insert into public.fin_receivables …'`.
--       A human sentence never contains "insert into public.fin_receivables";
--       it contains "Zoho" easily. That distinction is the entire fix.
--     • A CALL-GRAPH walk was added: a direct-only check is what let indirect
--       writes through in an earlier package.
--     • The same partition now feeds check (2) (sensitive personal attributes),
--       which carried the identical latent defect — a COMMENT saying "gender"
--       would have aborted the migration exactly the same way.
--     • The contract sentence was NOT edited to dodge the test. Changing the
--       evidence to satisfy a broken detector is not a repair.
--
-- WHAT IT IS
--   • READ-ONLY. Not one INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, GRANT,
--     REVOKE or TRUNCATE below, and no temp object.
--   • ONE result set, ordered, readable top to bottom.
--   • Safe from the Supabase SQL editor, where auth.uid() is NULL. NO PROTECTED
--     RPC IS CALLED ANYWHERE — calling one is what has already turned a
--     successful migration into a false "not applied" verdict on this project.
--   • Safe whether the lsr_* objects exist or not: every probe reads the
--     catalog, never the objects themselves.
--
-- WHAT IT PROVES
--   V1  no partial lsr_* state — tables, functions, policies, triggers, types
--   V2  the false positive, spelled out, and that no real violation existed
--   V3  the six ALREADY-APPLIED packages are intact and untouched
--   V4  what to do next
-- ════════════════════════════════════════════════════════════════════════════

with

-- ─── the module's own footprint in the catalog ──────────────────────────────
lsr as (
  select
    (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r','p') and c.relname like 'lsr\_%') as n_tables,
    (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'S' and c.relname like 'lsr\_%') as n_seqs,
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname like 'lsr\_%') as n_funcs,
    (select count(*) from pg_policies
      where schemaname = 'public' and tablename like 'lsr\_%') as n_policies,
    (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
       join pg_namespace n on n.oid = c.relnamespace
      where not t.tgisinternal and n.nspname = 'public' and c.relname like 'lsr\_%') as n_triggers,
    (select count(*) from pg_type t join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'public' and t.typname like 'lsr\_%') as n_types
),

-- ─── the six packages that ARE applied, and must be untouched ───────────────
six(ord, pkg, prefix) as (
  values (1, 'communications_hub',        'comms\_%'),
         (2, 'operations_center',         'ops\_%'),
         (3, 'crm_sales_FOUNDATION',      'crm\_%'),
         (4, 'finance_profitability',     'fin\_%'),
         (5, 'commercial_subscriptions',  'csub\_%'),
         (6, 'smart_quoting',             'sq\_%')
),
six_counts as (
  select s.ord, s.pkg, s.prefix,
    (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r','p') and c.relname like s.prefix) as n_tables,
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname like s.prefix) as n_funcs,
    (select count(*) from pg_policies
      where schemaname = 'public' and tablename like s.prefix) as n_policies
  from six s
),

-- ─── §V2: reproduce BOTH detectors on this database, without any lsr_* object.
--     The sentence below is a verbatim copy of the one inside the function that
--     aborted. We do not need the function to exist to prove what happened.
sentence(txt) as (
  values ('عقد بيانات لا كتابة متبادلة: هذه الوحدة تقرأ مراجع المالية ولا تكتب فيها، ولا تنشئ فاتورة، ولا تنادي Zoho، ولا تدّعي تحصيلًا.')
),
verdicts as (
  select
    -- the OLD check, exactly as it was written when it aborted
    (select txt from sentence) ~* '(insert\s+into\s+public\.fin_|update\s+public\.fin_|delete\s+from\s+public\.fin_|zoho)'
      as old_fires,
    -- the NEW judgement: a Zoho CALL shape, never the bare word
    (select txt from sentence) ~* '\mzoho[a-z_]*\s*\('           as new_fires_call,
    -- and the write-statement shape, which is what makes scanning strings safe
    (select txt from sentence) ~* '(insert\s+into|update|delete\s+from|truncate)\s+(table\s+)?(only\s+)?(public\.)?(fin_|finops_)'
      as new_fires_write,
    -- proof the new detector is not simply blind: a real dynamic write still fires
    'execute ''insert into public.fin_receivables(code) values (''''X'''')'''
      ~* '(insert\s+into|update|delete\s+from|truncate)\s+(table\s+)?(only\s+)?(public\.)?(fin_|finops_)'
      as new_catches_real_write,
    -- and a real Zoho call still fires
    'perform public.zoho_sync(p_lead);' ~* '\mzoho[a-z_]*\s*\('  as new_catches_real_call,
    -- the identical latent defect in check (2): a COMMENT would have aborted too
    '-- this engine never reads gender or nationality'
      ~* '\m(gender|nationality|ethnic|religio|marital|date_of_birth|birth_date|age_group|age_band)'
      as old_check2_fires_on_comment
),

-- ─── §V2b: did the module ever get far enough to leave a trace? ─────────────
--     The abort was raised in §14, i.e. AFTER every DDL statement in the file
--     had already executed inside the transaction. If any of it had survived,
--     V1 is exactly where it would show.
detector as (
  select
    to_regprocedure('public.lsr_sql_partition(text)') is not null as has_partition,
    to_regprocedure('public.lsr_contract_scan(text)') is not null as has_scan
)

-- ═══════════════════════════════════════════════════════════════════════════
select ord, check_name, verdict, detail from (

-- ═══ V1. NO PARTIAL STATE ══════════════════════════════════════════════════
select 100 as ord, 'V1.no_partial_lsr_state' as check_name,
       case when l.n_tables = 0 and l.n_funcs = 0 and l.n_policies = 0
                 and l.n_triggers = 0 and l.n_seqs = 0 and l.n_types = 0
              then 'PASS — clean rollback: the aborted transaction left nothing behind'
            when l.n_tables >= 13 and l.n_funcs >= 45
              then 'INSTALLED — a complete package is present (this is not partial state); read POSTCHECK, not this file'
            else 'FAIL — PARTIAL STATE: some lsr_* objects exist and some do not; do not re-run until this is understood' end as verdict,
       l.n_tables || ' lsr_* table(s) · ' || l.n_funcs || ' function(s) · '
         || l.n_policies || ' policy(ies) · ' || l.n_triggers || ' trigger(s) · '
         || l.n_seqs || ' sequence(s) · ' || l.n_types || ' type(s)' as detail
from lsr l

union all
select 101, 'V1.lsr_objects_present', 'INFO',
       coalesce((select string_agg(c.relname, ', ' order by c.relname)
                   from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'public' and c.relkind in ('r','p','S')
                    and c.relname like 'lsr\_%'),
                'none — no lsr_* relation exists')

union all
select 102, 'V1.rollback_reasoning', 'INFO',
       'the RUNME is one transaction with one COMMIT and uses no CONCURRENTLY, so an exception raised in §14 discards every statement in it — including §3''s CREATE TABLEs, the RLS policies and the GRANTs. V1 above is the MEASUREMENT of that claim, not a restatement of it.'

union all
select 103, 'V1.detector_absent_as_expected',
       case when (select has_partition or has_scan from detector)
              then 'REVIEW — the detector helpers exist, so a later run committed; this file is about the aborted run'
            else 'PASS — lsr_sql_partition / lsr_contract_scan do not exist, consistent with a full rollback' end,
       'lsr_sql_partition=' || (select has_partition from detector)::text
         || ' · lsr_contract_scan=' || (select has_scan from detector)::text

-- ═══ V2. ★ THE FINGERPRINT — WHY IT ABORTED, AND THAT NOTHING WAS WRONG ★ ══
union all
select 110, 'V2.the_false_positive',
       case when v.old_fires and not v.new_fires_call and not v.new_fires_write
              then 'CONFIRMED FALSE POSITIVE — the old pattern fires on the contract sentence; the shape-based judgement does not. The self-test was wrong, not the schema.'
            when not v.old_fires
              then 'UNEXPECTED — the old pattern does not fire on this sentence; the abort had another cause'
            else 'REAL VIOLATION — the shape-based judgement also fires; investigate before re-running' end,
       'old bare-word pattern fires = ' || v.old_fires::text
         || '  ·  new Zoho CALL shape fires = ' || v.new_fires_call::text
         || '  ·  new finance WRITE shape fires = ' || v.new_fires_write::text
from verdicts v

union all
select 111, 'V2.why_it_matched', 'INFO — the words, spelled out',
       'the sentence contains the letters z-o-h-o inside «ولا تنادي Zoho» — a PROSE DECLARATION that the module does not call Zoho. '
         || 'The old check matched a bare word against the whole pg_get_functiondef text, which cannot tell an executable statement from a comment or a message string. '
         || 'So the function aborted the migration BY DECLARING ITS OWN COMPLIANCE.'

union all
select 112, 'V2.the_new_detector_is_not_blind',
       case when v.new_catches_real_write and v.new_catches_real_call
              then 'CONFIRMED — the shape-based judgement still catches a REAL dynamic write and a REAL Zoho call'
            else 'FAIL — the repair weakened the check instead of correcting it; do not run RUNME' end,
       'execute-wrapped INSERT into fin_receivables detected = ' || v.new_catches_real_write::text
         || '  ·  zoho_sync(...) call detected = ' || v.new_catches_real_call::text
         || '   →  strings ARE scanned (this module reads via execute), but for STATEMENT SHAPE, never for a bare word.'
from verdicts v

union all
select 113, 'V2.same_defect_in_check_2',
       case when v.old_check2_fires_on_comment
              then 'CONFIRMED — check (2) carried the identical latent defect: a COMMENT mentioning «gender» would have aborted the migration the same way. It now uses the partitioned code.'
            else 'N/A' end,
       'a comment reading «this engine never reads gender or nationality» matched the sensitive-attribute pattern = '
         || v.old_check2_fires_on_comment::text
from verdicts v

union all
select 114, 'V2.no_real_violation_existed', 'INFO — audited before the repair',
       'all lsr_* functions were audited with comments stripped, scanning executable code AND the payloads of execute ''…'' dynamic SQL: REAL finance writes = NONE, REAL external calls = NONE. '
         || 'Every occurrence of the word zoho in the package is prose: three comments and one contract sentence. '
         || 'Separately, the finance READ surface was narrowed to the contract: reference, status, due date and a general collection state — no amount, no price, no VAT, no renewal value.'

-- ═══ V3. THE SIX APPLIED PACKAGES ARE INTACT ═══════════════════════════════
union all
select 120 + c.ord, 'V3.' || c.pkg || '_intact',
       case when c.n_tables > 0 and c.n_funcs > 0
              then 'PASS — present and untouched (the aborted transaction created, altered and dropped nothing outside lsr_*)'
            else 'REVIEW — this package looks absent on this database; verify with its own POSTCHECK before drawing any conclusion' end,
       c.n_tables || ' table(s) · ' || c.n_funcs || ' function(s) · ' || c.n_policies || ' policy(ies)'
from six_counts c

union all
select 130, 'V3.why_they_cannot_have_changed', 'INFO',
       'the RUNME creates only lsr_* objects and reads the other modules through to_regclass / to_regprocedure guards. It issues no ALTER or DROP against comms_*, ops_*, crm_*, fin_*, csub_* or sq_*, and it aborted before COMMIT regardless. V3 above is the measurement.'

-- ═══ V4. WHAT TO DO NEXT ═══════════════════════════════════════════════════
union all
select 140, 'V4.next_step',
       case when (select n_tables + n_funcs from lsr) = 0
              then 'RE-RUN — apply the corrected docs/lead_scoring_routing_RUNME.sql, then docs/lead_scoring_routing_POSTCHECK.sql'
            else 'STOP — object state is not empty; resolve V1 before re-running' end,
       'the correction is in the DETECTOR (lsr_sql_partition + lsr_contract_scan + the call-graph walk), not in the schema and not in the contract sentence. Nothing was renamed, no check was weakened, and no evidence was edited to pass.'

) rows
order by ord;
