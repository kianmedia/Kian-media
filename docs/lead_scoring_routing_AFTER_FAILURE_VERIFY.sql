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
-- ── SECOND ABORT (SAME DEFECT, DIFFERENT RULE) ─────────────────────────────
--   The corrected RUNME was re-run. It aborted again, before COMMIT, in §14:
--
--     ERROR P0001: LSR SELF-TEST: قراءة مالية ممنوعة (تكلفة/هامش/ربح/أرضية)
--                  داخل lsr_dashboard_client
--     PL/pgSQL function inline_code_block line 69 at RAISE
--
--   The rule that fired was `forbidden_finance_read`, whose second alternative
--   was still a BARE WORD LIST — the one rule the first repair did not reshape:
--
--     v_both ~* '\m(base_cost|cost_rate|margin_pct|gross_profit
--                   |floor_price|supplier_rate|sq_quote_internal)\M'
--
--   It matched inside public.lsr_dashboard_client, in this array:
--
--     jsonb_build_array('internal_notes','internal_metadata','decision_reason',
--                       'cost','margin','floor_price','profit','supplier_rate')
--
--   — the `excluded_by_design` list, i.e. the projection's own declaration that
--   these fields are NOT shown. Matched tokens: floor_price, supplier_rate.
--   THE DASHBOARD ABORTED THE MIGRATION BY LISTING WHAT IT REFUSES TO EMIT.
--   Structurally identical to the `zoho` bug it replaced. FALSE POSITIVE: the
--   function reads no cost, margin, floor or supplier column in executable
--   code — §V2c below proves that mechanically, on this database.
--
--   THE REPAIR (already in RUNME)
--     • forbidden_finance_read now requires READ SHAPE: a QUALIFIED COLUMN
--       reference (`s.base_cost`) or a TABLE reference (`from public.fin_costs`).
--       A bare name inside a string array is a LABEL and can no longer fire.
--       Strings are still scanned — this module reads through `execute '…'`.
--     • The last remaining bare-word alternative over strings (pg_net | dblink |
--       pg_background in external_call) was reshaped the same way. Every rule
--       that scans strings now matches shape; every rule that matches a bare
--       name is restricted to `code`, where comments are gone and strings are
--       emptied, so a name IS a use.
--     • Shape is necessary, not sufficient: it cannot stop a NEW internal column
--       whose name nobody enumerated. So an EXPLICIT CLOSED ALLOWLIST of the
--       JSON keys lsr_dashboard_client emits was added (public.lsr_json_keys +
--       public.lsr_client_scan), refusing any key outside it — in both
--       directions, so the list cannot be pre-padded either. Wide row projection
--       (to_jsonb(row) / row_to_json / jsonb_agg(row)) is refused as well: an
--       unnamed snapshot is an open list, i.e. no list. And every client query
--       must carry client_id = $1.
--     • The excluded_by_design array was NOT edited to dodge the test. Deleting
--       the declaration to satisfy a broken detector is concealment, not repair.
--
-- ── THIRD ABORT (THE READER, NOT THE RULE) ────────────────────────────────
--   The corrected RUNME was re-run. It aborted again, before COMMIT, in §14:
--
--     ERROR P0001: LSR SELF-TEST: لوحة العميل تُصدر مفتاحًا خارج القائمة
--                  المغلقة — أضفه (<computed>) …
--     PL/pgSQL function inline_code_block line 243 at RAISE
--
--   This time THE RULE WAS RIGHT AND THE READER WAS WRONG. public.lsr_key_of
--   turned one argument into one key with:
--
--     substring(btrim(coalesce(p_arg, '')) from '^''(.*)''$')
--
--   In PostgreSQL, btrim(str) IS btrim(str, ' '): it trims SPACES ONLY. It does
--   not trim a newline and it does not trim a tab. jsonb_build_object arguments
--   in a formatted file begin on new lines, so the argument text is literally
--   chr(10) || '      ''message'''. btrim leaves the leading chr(10); the
--   anchored pattern requires the string to START with a quote; it therefore
--   does not match, and A PERFECTLY LITERAL KEY IS REPORTED AS <computed>.
--   32 of the 63 keyed arguments in lsr_dashboard_client were mangled this way.
--   The first in scan order is 'message', from the identity_not_enabled branch.
--
--   THE CLOSED LIST WAS CORRECT AND WAS NOT CHANGED. The 49 keys stand exactly
--   as they were. Nothing was added to the allowlist to make the check pass —
--   that would have been the concealment this file refused twice already.
--
--   WHY THE NODE SUITE DID NOT CATCH IT
--     JavaScript's .trim() removes ALL whitespace, so the JS port read the key
--     correctly while PostgreSQL did not. The suite measured with the wrong
--     ruler — for the SECOND time (the first was a repetition bound of 400
--     against RE_DUP_MAX = 255). tests/lead_json_key_parser.test.js now models
--     btrim, and the anchored match, with PostgreSQL semantics, and fails if
--     anyone "simplifies" the model back to .trim().
--
--   THE REPAIR (already in RUNME, nothing to do by hand)
--     • lsr_key_of trims ' ' || chr(9) || chr(10) || chr(13), and on rejection
--       returns the OFFENDING EXPRESSION instead of an opaque <computed> tag,
--       so the next failure names itself instead of hiding.
--     • The identical one-argument btrim in the "argument is empty" test inside
--       lsr_json_keys was widened for the same reason: same rake, one step over.
--     • No rule was weakened, no key was added, no evidence was edited.
--
-- WHAT IT PROVES
--   V1  no partial lsr_* state — tables, functions, policies, triggers, types
--   V2  the FIRST false positive, spelled out, and that no real violation existed
--   V2c the SECOND false positive, spelled out, and that the new rule is not blind
--   V2d the THIRD abort — a READER defect, reproduced on this server with plain
--       built-ins, and that the corrected reader still refuses a computed key
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
-- The array below is a verbatim copy of the `excluded_by_design` list inside
-- public.lsr_dashboard_client — the projection's own declaration of what it
-- refuses to emit, and the text that aborted the second run.
excluded_array(txt) as (
  values ('jsonb_build_array(''internal_notes'',''internal_metadata'',''decision_reason'',''cost'',''margin'',''floor_price'',''profit'',''supplier_rate'')')
),
-- §V2d: the argument text that aborted the THIRD run, byte for byte. It is the
-- SEVENTH argument of the identity_not_enabled branch of lsr_dashboard_client:
-- a newline, six spaces, then the literal 'message'. Nothing exotic — this is
-- simply what an argument looks like when a call is spread over two lines.
third_arg(txt) as (
  values (chr(10) || '      ''message''')
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
      as old_check2_fires_on_comment,

    -- ── the SECOND abort, reproduced the same way ──────────────────────────
    -- the OLD forbidden_finance_read alternative, exactly as it was written
    (select txt from excluded_array)
      ~* '\m(base_cost|cost_rate|margin_pct|gross_profit|floor_price|supplier_rate|sq_quote_internal)\M'
      as old2_fires,
    -- the NEW judgement: a QUALIFIED COLUMN reference, never a bare label
    (select txt from excluded_array)
      ~* '\m[a-z_][a-z_0-9]{0,62}\.(base_cost|cost_rate|margin_pct|gross_profit|floor_price|supplier_rate)\M'
      as new2_fires_column,
    -- ... nor a TABLE reference in a statement
    (select txt from excluded_array)
      ~* '\m(from|join|into|update|table)\s+(only\s+)?(public\.)?(fin_costs|sq_quote_internal)\M'
      as new2_fires_table,
    -- proof it is not blind: a REAL qualified read of the floor price still fires
    'execute ''select s.floor_price from public.csub_subscriptions s'''
      ~* '\m[a-z_][a-z_0-9]{0,62}\.(base_cost|cost_rate|margin_pct|gross_profit|floor_price|supplier_rate)\M'
      as new2_catches_real_read,
    -- ... and a REAL reference to the internal cost table still fires
    'execute ''select 1 from public.sq_quote_internal q'''
      ~* '\m(from|join|into|update|table)\s+(only\s+)?(public\.)?(fin_costs|sq_quote_internal)\M'
      as new2_catches_real_table,
    -- ... and the last bare-word alternative over strings was reshaped too
    'this module never uses pg_net for anything'
      ~* '\m(pg_net|dblink|pg_background)[a-z_0-9]{0,40}\s*[(.]'   as new2_prose_pg_net_fires,
    'perform pg_net.http_collect_response(p_lead);'
      ~* '\m(pg_net|dblink|pg_background)[a-z_0-9]{0,40}\s*[(.]'   as new2_catches_real_pg_net,

    -- ── the THIRD abort: the READER, reproduced with built-ins only ───────
    -- (a) the whole defect in one expression: btrim(str) trims SPACES ONLY.
    btrim(chr(10) || '  x  ') = chr(10) || '  x'                as btrim_default_is_space_only,
    -- (b) the OLD reader, exactly as written, on the exact argument
    substring(btrim((select txt from third_arg)) from '^''(.*)''$') is null
                                                                as old3_mangles_literal_key,
    -- (c) the CORRECTED reader on the same argument: it is the key 'message'
    substring(btrim((select txt from third_arg), ' ' || chr(9) || chr(10) || chr(13))
              from '^''(.*)''$') = 'message'                    as new3_reads_literal_key,
    -- (d) proof it is not simply permissive: a genuinely computed key is still
    --     refused, so the closed list keeps its meaning
    substring(btrim(chr(9) || 'case when x then ''a'' else ''b'' end',
                    ' ' || chr(9) || chr(10) || chr(13)) from '^''(.*)''$') is null
                                                                as new3_still_refuses_computed
),

-- ─── §V2b: did the module ever get far enough to leave a trace? ─────────────
--     The abort was raised in §14, i.e. AFTER every DDL statement in the file
--     had already executed inside the transaction. If any of it had survived,
--     V1 is exactly where it would show.
detector as (
  select
    to_regprocedure('public.lsr_sql_partition(text)') is not null as has_partition,
    to_regprocedure('public.lsr_contract_scan(text)') is not null as has_scan,
    to_regprocedure('public.lsr_json_keys(text)')     is not null as has_keys,
    to_regprocedure('public.lsr_client_scan(text)')   is not null as has_client_scan
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
         || ' · lsr_json_keys=' || (select has_keys from detector)::text
         || ' · lsr_client_scan=' || (select has_client_scan from detector)::text

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

-- ═══ V2c. ★ THE SECOND FINGERPRINT — SAME DEFECT, DIFFERENT RULE ★ ════════
union all
select 115, 'V2c.the_second_false_positive',
       case when v.old2_fires and not v.new2_fires_column and not v.new2_fires_table
              then 'CONFIRMED FALSE POSITIVE — the old bare-word alternative fires on the excluded_by_design array; the read-shape judgement does not. lsr_dashboard_client reads no cost, margin, floor or supplier column.'
            when not v.old2_fires
              then 'UNEXPECTED — the old alternative does not fire on this array; the second abort had another cause'
            else 'REAL VIOLATION — the read-shape judgement also fires; investigate before re-running' end,
       'old bare-word alternative fires = ' || v.old2_fires::text
         || '  ·  new QUALIFIED-COLUMN shape fires = ' || v.new2_fires_column::text
         || '  ·  new TABLE-reference shape fires = ' || v.new2_fires_table::text
from verdicts v

union all
select 116, 'V2c.why_it_matched', 'INFO — the words, spelled out',
       'the array is the projection''s own excluded_by_design list. It names floor_price and supplier_rate in order to DECLARE THAT THEY ARE NOT SHOWN. '
         || 'The old alternative matched a bare word in code AND strings, so it could not tell a qualified column reference (s.floor_price — a read) from a string label (''floor_price'' — a declaration). '
         || 'So the client dashboard aborted the migration BY LISTING WHAT IT REFUSES TO EMIT — the same failure mode as the Zoho sentence, one rule later.'

union all
select 117, 'V2c.the_new_rule_is_not_blind',
       case when v.new2_catches_real_read and v.new2_catches_real_table
                 and v.new2_catches_real_pg_net and not v.new2_prose_pg_net_fires
              then 'CONFIRMED — a REAL qualified read (s.floor_price), a REAL cost-table reference and a REAL pg_net call all still fire, while prose mentioning pg_net no longer does'
            else 'FAIL — the repair weakened the check instead of correcting it; do not run RUNME' end,
       'qualified read s.floor_price detected = ' || v.new2_catches_real_read::text
         || '  ·  from public.sq_quote_internal detected = ' || v.new2_catches_real_table::text
         || '  ·  pg_net.http_collect_response(...) detected = ' || v.new2_catches_real_pg_net::text
         || '  ·  prose «never uses pg_net» fires = ' || v.new2_prose_pg_net_fires::text
from verdicts v

union all
select 118, 'V2c.shape_alone_is_not_the_guard', 'INFO — what was ADDED, not weakened',
       'shape-matching is necessary and not sufficient: it cannot stop a NEW internal column nobody enumerated. RUNME therefore also enumerates the JSON keys lsr_dashboard_client actually emits and refuses any key outside an explicit closed allowlist — and refuses any allowlist entry that is not emitted, so the list cannot be padded in advance. '
         || 'Wide row projection (to_jsonb(row) / row_to_json / jsonb_agg(row)) is refused as an open list. Every client query must carry client_id = $1. '
         || 'Every amount on that allowlist is a SELLING amount billed to that same client: their own contract price, its VAT, and their own overage charges. None is cost, margin, floor price or supplier rate, and no two of them subtract to one.'

-- ═══ V2d. ★ THE THIRD FINGERPRINT — THE READER, NOT THE RULE ★ ════════════
union all
select 119, 'V2d.the_third_abort_was_a_reader_defect',
       case when v.old3_mangles_literal_key and v.new3_reads_literal_key
              then 'CONFIRMED READER DEFECT — btrim(str) trims spaces only, so a literal key that begins on a new line was read as <computed>. The closed list was right; the reader was wrong. The list was NOT changed.'
            when not v.old3_mangles_literal_key
              then 'UNEXPECTED — the old expression reads the key correctly on this server; the third abort had another cause'
            else 'FAIL — the corrected expression does not read the key either; do not run RUNME' end,
       'btrim(str) behaves as btrim(str, '' '') on this server = ' || v.btrim_default_is_space_only::text
         || '  ·  OLD reader returns NULL for chr(10) || ''      ''''message'''''' = ' || v.old3_mangles_literal_key::text
         || '  ·  CORRECTED reader returns the key «message» = ' || v.new3_reads_literal_key::text
from verdicts v

union all
select 120, 'V2d.why_it_matched', 'INFO — the characters, spelled out',
       'jsonb_build_object arguments in a formatted file begin on NEW LINES, so the text of an argument is chr(10) followed by indentation and then the quoted key. '
         || 'btrim with one argument does not remove chr(10), the pattern ''^''''(.*)''''$'' requires the string to START with a quote, so the match fails and a literal key is reported as computed. '
         || '32 of the 63 keyed arguments in lsr_dashboard_client were mangled that way; the first in scan order is «message», in the identity_not_enabled branch. '
         || 'This is not a schema problem, not a contract problem and not a naming problem — it is one missing function argument.'

union all
select 121, 'V2d.the_corrected_reader_is_not_blind',
       case when v.new3_reads_literal_key and v.new3_still_refuses_computed
              then 'CONFIRMED — the corrected reader reads a literal key that starts on a new line, and STILL refuses a CASE expression as a key. A computed key cannot be audited statically, so it is refused by design.'
            else 'FAIL — the repair made the reader permissive instead of correct; do not run RUNME' end,
       'literal key read = ' || v.new3_reads_literal_key::text
         || '  ·  «case when x then ''a'' else ''b'' end» still refused = ' || v.new3_still_refuses_computed::text
         || '   →  and on refusal the reader now returns the OFFENDING EXPRESSION, not an opaque tag, so the next failure names itself.'
from verdicts v

union all
select 122, 'V2d.the_wrong_ruler', 'INFO — why the test suite did not catch it',
       'the Node port of this reader used JavaScript''s .trim(), which removes ALL whitespace, so it read the key correctly while PostgreSQL did not: the suite measured the SQL with a ruler the SQL does not use. '
         || 'That is the second occurrence of exactly this class — the first was a regex repetition bound of 400 against PostgreSQL''s RE_DUP_MAX of 255 (this file may not spell that bound out: the repository guard refuses the literal anywhere, mention or use). '
         || 'tests/lead_json_key_parser.test.js now ports btrim, the anchored match, the literal scanner and the key scanner with PostgreSQL semantics, asserts the 49 keys against the allowlist PARSED FROM RUNME (no second copy), and fails if the btrim model is ever "simplified" to .trim().'

-- ═══ V3. THE SIX APPLIED PACKAGES ARE INTACT ═══════════════════════════════
union all
select 130 + c.ord, 'V3.' || c.pkg || '_intact',
       case when c.n_tables > 0 and c.n_funcs > 0
              then 'PASS — present and untouched (the aborted transaction created, altered and dropped nothing outside lsr_*)'
            else 'REVIEW — this package looks absent on this database; verify with its own POSTCHECK before drawing any conclusion' end,
       c.n_tables || ' table(s) · ' || c.n_funcs || ' function(s) · ' || c.n_policies || ' policy(ies)'
from six_counts c

union all
select 137, 'V3.why_they_cannot_have_changed', 'INFO',
       'the RUNME creates only lsr_* objects and reads the other modules through to_regclass / to_regprocedure guards. It issues no ALTER or DROP against comms_*, ops_*, crm_*, fin_*, csub_* or sq_*, and it aborted before COMMIT regardless. V3 above is the measurement.'

-- ═══ V4. WHAT TO DO NEXT ═══════════════════════════════════════════════════
union all
select 140, 'V4.next_step',
       case when (select n_tables + n_funcs from lsr) = 0
              then 'RE-RUN — apply the corrected docs/lead_scoring_routing_RUNME.sql, then docs/lead_scoring_routing_POSTCHECK.sql'
            else 'STOP — object state is not empty; resolve V1 before re-running' end,
       'the correction is in the DETECTOR (lsr_sql_partition + lsr_contract_scan + the call-graph walk + lsr_json_keys/lsr_client_scan) and, for the third attempt, in the READER (lsr_key_of''s btrim character set) — not in the schema, not in the contract sentence, not in the excluded_by_design array and not in the 49-key closed list, which is unchanged. Nothing was renamed, no check was weakened — one was added — and no evidence was edited to pass.'

) rows
order by ord;
