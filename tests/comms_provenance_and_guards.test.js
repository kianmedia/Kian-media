// ════════════════════════════════════════════════════════════════════════════
// tests/comms_provenance_and_guards.test.js
//
// Four things this file pins, all of which failed or nearly failed in
// production and none of which a dashboard would have shown:
//
//   1. PROVENANCE IS DATA. "Is this row a real send" used to be inferred from
//      provider = 'legacy_email_deliveries', a free-text column. One typo there
//      promoted a mirrored row to a live send. Provenance is now four explicit,
//      constrained, re-derived columns, and R0 makes "mirror stored as a live
//      successful send" physically unrepresentable.
//
//   2. THE SELF-TEST IS NOT VACUOUS. The migration aborted because its own
//      guard could NEVER match a correct function:
//          v_def !~* $re$'sent_live'[^)]*legacy_email_deliveries$re$
//      [^)] cannot cross the ')' that closes count(*). This file proves the old
//      pattern was unmatchable and that the replacement matches — and would
//      still fail if an exclusion were removed.
//
//   3. THE anon CHECK IS A TRUE ALLOWLIST across ALL privilege types, not a
//      denylist of the four CRUD verbs wearing an allowlist's name.
//
//   4. NO DOUBLE SEND and NO ANONYMOUS RELAY.
//
// Static only: reading files is the whole method, like every other comms_* suite.
// ════════════════════════════════════════════════════════════════════════════
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(root, p), "utf8");

const RUNME = R("docs/communications_hub_RUNME.sql");
const PRE = R("docs/communications_hub_PREFLIGHT.sql");
const POST = R("docs/communications_hub_POSTCHECK.sql");
const VERIFY = R("docs/communications_hub_AFTER_FAILURE_VERIFY.sql");
const ROLLBACK = R("docs/communications_hub_ROLLBACK.sql");
const ROUTE = R("app/api/comms/legacy-notify/route.ts");
const PROCESS = R("app/api/comms/process/route.ts");

const fnBody = (name, src = RUNME) => {
  const i = src.indexOf(`create or replace function public.${name}(`);
  assert.ok(i > -1, `${name} exists`);
  const open = src.indexOf("as $$", i);
  const end = src.indexOf("$$;", open + 5);
  assert.ok(open > i && end > open, `${name} has a terminated body`);
  return src.slice(i, end);
};
/** Strip SQL comments. An assertion satisfied by prose is not an assertion. */
const code = (s) => s.replace(/--[^\n]*/g, " ");

// ═══ 1. PROVENANCE IS DATA ══════════════════════════════════════════════════

test("the outbox carries four explicit provenance columns, all NOT NULL with defaults", () => {
  const table = RUNME.slice(RUNME.indexOf("create table if not exists public.comms_outbox"),
                            RUNME.indexOf("create unique index if not exists uq_comms_outbox_idem"));
  for (const [col, decl] of [["source_kind", /source_kind\s+text not null default 'native'/],
                             ["is_legacy_mirror", /is_legacy_mirror\s+boolean not null default false/],
                             ["delivery_mode", /delivery_mode\s+text not null default 'dry_run'/],
                             ["provider_state", /provider_state\s+text not null default 'none'/]]) {
    assert.match(table, decl, `${col} is declared explicitly and cannot be NULL`);
  }
  // and the retro-fit path exists for a table an earlier run already created
  for (const col of ["source_kind", "is_legacy_mirror", "delivery_mode", "provider_state"])
    assert.ok(RUNME.includes(`alter table public.comms_outbox add column if not exists ${col}`),
      `${col} is also added idempotently for an existing table`);
});

test("the vocabularies are closed, and each is exactly the one the brief names", () => {
  const c = code(RUNME);
  assert.ok(c.includes("source_kind in ('native','legacy_mirror','imported')"), "source_kind vocabulary");
  assert.ok(c.includes("delivery_mode in ('live','dry_run')"), "delivery_mode vocabulary");
  assert.ok(c.includes("provider_state in ('none','attempted','accepted','delivered','unavailable','relay_handler_missing')"),
    "provider_state vocabulary");
});

test("provenance cannot contradict itself — consistency is CHECK-enforced, not conventional", () => {
  const c = code(RUNME);
  assert.ok(c.includes("(source_kind = 'legacy_mirror') = is_legacy_mirror"),
    "a typo in source_kind can no longer desynchronise it from the flag the counters read");
  assert.ok(c.includes("(delivery_mode = 'dry_run') = dry_run"),
    "delivery_mode is the NAME of dry_run, not a second writable opinion about it");
});

test("★ R0: a legacy mirror can NEVER be stored as a live successful send", () => {
  // Enforced twice, and the CHECK is the one that survives a disabled trigger.
  assert.ok(code(RUNME).includes("not (is_legacy_mirror and provider_state in ('accepted','delivered'))"),
    "a CHECK constraint makes the state unrepresentable");
  assert.match(RUNME, /add constraint %I check/, "the constraints are added by name, idempotently");
  assert.ok(RUNME.includes("comms_outbox_mirror_never_live_ck"), "the R0 constraint is named");
  const guard = fnBody("comms_outbox_guard");
  assert.match(guard, /COMMS R0/, "the trigger raises a named R0 error too");
  assert.match(guard, /new\.is_legacy_mirror\s*:=/, "the guard RE-DERIVES the mirror flag");
  assert.match(guard, /new\.delivery_mode\s*:=\s*case when new\.dry_run/, "and derives delivery_mode from dry_run");
  assert.match(guard, /coalesce\(new\.provider,''\) = 'legacy_email_deliveries'/,
    "a row tagged with the legacy provider is recognised as a mirror whatever the writer claimed");
  // the migration refuses to install a guard without R0
  assert.ok(RUNME.includes("R0 (a mirror can never be stored as a live send) is not enforced"),
    "a static self-test guards R0");
});

test("the importer STATES provenance rather than leaving it to be inferred", () => {
  const imp = fnBody("comms_adapter_import_legacy");
  assert.match(imp, /source_kind, is_legacy_mirror, delivery_mode, provider_state/,
    "the four columns are in the INSERT column list");
  assert.match(imp, /'legacy_mirror', true, 'live', 'unavailable'/,
    "and are given explicit values — a mirror never carries provider evidence");
  assert.ok(!/'accepted'|'delivered'/.test(code(imp).split("values (")[1] ?? ""),
    "the importer never writes provider evidence");
});

test("the enqueue states provenance for every native row it creates", () => {
  const enq = fnBody("comms_enqueue");
  assert.match(enq, /source_kind, is_legacy_mirror, delivery_mode, provider_state/, "in the column list");
  assert.match(enq, /'native', false, case when v_dry then 'dry_run' else 'live' end, 'none'/,
    "a fresh row is native, not a mirror, and carries NO provider evidence yet");
});

test("comms_settle records what the provider actually said, and never inflates it", () => {
  const s = fnBody("comms_settle");
  assert.match(s, /provider_state = v_pstate/, "provider_state is written on every settle path");
  assert.ok((s.match(/provider_state = v_pstate/g) || []).length >= 3,
    "on the success path, the deferral path AND the failure path");
  assert.match(s, /when o\.is_legacy_mirror\s+then 'unavailable'/,
    "a mirror can never gain evidence through settle");
  assert.match(s, /when o\.dry_run\s+then 'none'/,
    "a simulation records NO provider evidence — this is how a dry run stays a dry run");
  assert.match(s, /v_delivered := lower\(coalesce\(p_provider_response->>'delivered',''\)\)/,
    "delivery evidence is parsed defensively, never a bare cast of caller text");
  assert.match(s, /elsif not v_delivered then\s*\n\s*p_outcome := 'sent';/,
    "'delivered' without delivery evidence is DOWNGRADED to 'sent', not accepted and not failed");
  // downgraded rather than failed on purpose: failing an accepted message would
  // invite a second send of something already in flight.
  assert.match(s, /'counts_as_live_send'/, "the caller is told, honestly, whether this counted");
});

test("the backfill is conservative — a migration may not invent evidence", () => {
  const bf = RUNME.slice(RUNME.indexOf("update public.comms_outbox set\n  provider_state"),
                         RUNME.indexOf("do $prov_constrain$"));
  assert.ok(bf.length > 100, "the provider_state backfill exists");
  assert.match(bf, /when is_legacy_mirror\s+then 'unavailable'/, "mirrors get no evidence");
  assert.match(bf, /when dry_run\s+then 'none'/, "dry runs get no evidence");
  assert.match(bf, /then 'attempted'/, "a bare claim of 'sent' becomes attempted, not accepted");
  assert.match(bf, /provider_response->>'ack'/, "acceptance is granted only where an ack actually exists");
});

// ═══ 2. THE SELF-TEST IS NOT VACUOUS ════════════════════════════════════════

test("THE BUG: the old guard pattern could never match a correct comms_health", () => {
  // This is the regression itself, stated as a test so it cannot come back.
  const health = fnBody("comms_health");
  const old = /'sent_live'[^)]*legacy_email_deliveries/i;
  assert.ok(!old.test(health),
    "the old pattern still cannot match — [^)] cannot cross the ')' of count(*)");
  // and it is unmatchable in principle, not just against this body
  assert.ok(!old.test("'sent_live', count(*) filter (where coalesce(provider,'') <> 'legacy_email_deliveries')"),
    "even a textbook-correct counter fails the old pattern");
  // It survives ONLY inside the comment that explains the incident. It must
  // never again appear as executable code.
  assert.ok(!code(RUNME).includes("$re$'sent_live'[^)]*legacy_email_deliveries$re$"),
    "the unmatchable pattern is still executable somewhere in the migration");
  assert.ok(RUNME.includes("$re$'sent_live'[^)]*legacy_email_deliveries$re$"),
    "the incident is documented in the migration so the lesson is not lost");
});

test("the replacement guard normalises whitespace and strips comments FIRST", () => {
  assert.match(RUNME, /v_flat := regexp_replace\(pg_get_functiondef\(to_regprocedure\('public\.comms_health\(\)'\)\),\s*\n?\s*'--\[\^' \|\| chr\(10\) \|\| '\]\*', ' ', 'g'\)/,
    "comments are removed before flattening, so no assertion can be met by prose");
  assert.match(RUNME, /v_flat := regexp_replace\(v_flat, '\\s\+', ' ', 'g'\)/,
    "then whitespace is normalised, so no pattern has to guess at line wrapping");
  assert.ok(RUNME.indexOf("'--[^' || chr(10) || ']*'") < RUNME.indexOf("regexp_replace(v_flat, '\\s+', ' ', 'g')"),
    "order matters: flattening first would let a comment swallow the rest of the body");
});

test("the replacement guard checks BOTH live counters, not one", () => {
  const st = RUNME.slice(RUNME.indexOf("-- (9b)"), RUNME.indexOf("-- (9c)"));
  assert.match(st, /'sent_live', \(\.\*\?\)'delivered',/, "it slices out the sent_live counter alone");
  assert.match(st, /'delivered', \(\.\*\?\)'mirrored_legacy',/, "and the delivered counter alone");
  assert.match(st, /comms_health\.sent_live lost the/, "sent_live has its own named failure");
  assert.match(st, /comms_health\.delivered lost the/, "delivered has its own named failure");
  for (const tok of ["source_kind = 'native'", "not is_legacy_mirror", "delivery_mode = 'live'",
                     "provider_state in ('accepted','delivered')", "<> 'legacy_email_deliveries'"])
    assert.ok(st.includes(tok), `the guard asserts the "${tok}" condition`);
  assert.ok(st.includes("provider_state = 'delivered'"),
    "and holds delivered to the stricter evidence bar");
});

test("the guard carries its own non-vacuity control and refuses a NULL slice", () => {
  const st = RUNME.slice(RUNME.indexOf("-- (9b)"), RUNME.indexOf("-- (9c)"));
  assert.ok((st.match(/THIS_TOKEN_MUST_NOT_EXIST/g) || []).length >= 2,
    "both slices are probed with a token that provably does not exist");
  assert.match(st, /the sent_live assertion is vacuous/, "and say so if the probe ever matches");
  assert.match(st, /if v_seg is null then/, "a NULL slice raises instead of silently skipping every check");
  assert.ok(!/exception when others/.test(st), "no catch-all that would make the block pass regardless");
});

test("the SLICE actually isolates one counter — proved on the real function body", () => {
  // The same extraction the migration performs, executed here in JS. If the
  // slice ever spanned both counters, a conjunct present on only one of them
  // would satisfy the check for both, and the guard would be weaker than it
  // reads. This is the property the old pattern lacked.
  const flat = code(fnBody("comms_health")).replace(/\s+/g, " ");
  const live = flat.match(/'sent_live', (.*?)'delivered',/);
  const del = flat.match(/'delivered', (.*?)'mirrored_legacy',/);
  assert.ok(live && del, "both slices are found on the real body — the guard CAN match");
  assert.ok(!live[1].includes("'mirrored_legacy'"), "the sent_live slice stops before the next counter");
  assert.ok(!del[1].includes("'sent_live'"), "and the delivered slice does not reach back");
  for (const tok of ["source_kind = 'native'", "not is_legacy_mirror", "delivery_mode = 'live'",
                     "<> 'legacy_email_deliveries'"]) {
    assert.ok(live[1].includes(tok), `sent_live really carries ${tok}`);
    assert.ok(del[1].includes(tok), `delivered really carries ${tok}`);
  }
  assert.ok(live[1].includes("provider_state in ('accepted','delivered')"), "sent_live requires evidence");
  assert.ok(del[1].includes("provider_state = 'delivered'"), "delivered requires delivery evidence");
});

test("the self-tests stay STATIC: no protected RPC is called during the migration", () => {
  const st = RUNME.slice(RUNME.indexOf("do $selftest$"));
  for (const rpc of ["comms_health()", "comms_dashboard(", "comms_prefs_get()", "comms_preview(",
                     "comms_adapter_import_legacy(200", "comms_enqueue("]) {
    assert.ok(!new RegExp(`(select|perform)\\s+public\\.${rpc.replace(/[.()*+?^${}|[\]\\]/g, "\\$&")}`, "i").test(st),
      `the self-test must not CALL ${rpc} — auth.uid() is NULL in the SQL editor`);
  }
  assert.ok(st.includes("pg_get_functiondef"), "it asserts on function bodies instead");
  assert.ok(!/exception\s+when\s+others/i.test(st), "and never wraps a check in a catch-all");
});

test("every provenance column and constraint is asserted before the migration commits", () => {
  assert.match(RUNME, /provenance must be explicit and total/, "columns are checked for NOT NULL");
  for (const c of ["comms_outbox_source_kind_ck", "comms_outbox_delivery_mode_ck",
                   "comms_outbox_provider_state_ck", "comms_outbox_provenance_consistent_ck",
                   "comms_outbox_delivery_mode_matches_dry_run_ck", "comms_outbox_mirror_never_live_ck"])
    assert.ok(RUNME.includes(c), `the self-test names ${c}`);
  assert.match(RUNME, /and convalidated/, "a NOT VALID constraint would not count as enforcement");
});

// ═══ 3. THE anon CHECK IS A TRUE ALLOWLIST ══════════════════════════════════

// ⚠️ POLICY REVERSAL, DELIBERATE. These two tests previously asserted the
// OPPOSITE: that §13.b revoked ONLY REFERENCES/TRIGGER/TRUNCATE and left the
// four CRUD verbs alone "in case a public form needs one". The owner has retired
// that reasoning — no caller ever used those privileges, and a privilege nothing
// exercises cannot be caught by a regression, so it is a standing hole rather
// than a spare capability. The tests are INVERTED rather than deleted, so the
// old policy cannot quietly come back. Per-type coverage and its non-vacuity
// proofs live in tests/comms_anon_zero_access.test.js.
test("the RUNME revokes EVERY privilege type, on the legacy tables and on comms_*", () => {
  const blk = RUNME.slice(RUNME.indexOf("do $anon_tables$"), RUNME.indexOf("end $anon_tables$"));
  for (const g of ["anon", "public"]) {
    assert.ok(
      new RegExp(`revoke all privileges on table public\\.%I from ${g}`).test(blk),
      `all privileges revoked from ${g} — a privilege held via PUBLIC is not removed by revoking from anon`
    );
    assert.ok(
      new RegExp(`revoke select, insert, update, delete, truncate, references, trigger\\s+on table public\\.%I from ${g}`).test(blk),
      `the seven types are also named explicitly for ${g}, so the intent does not depend on how ALL expands`
    );
  }
  for (const t of ["notifications", "notification_events", "notification_preferences",
                   "notification_delivery_log", "email_deliveries"])
    assert.ok(blk.includes(`'${t}'`), `${t} is named`);
  assert.ok(/relname like 'comms\\_%'/.test(blk), "comms_* tables are discovered from the catalogue");
  // The retired stance must not reappear.
  assert.ok(!/SELECT \/ INSERT \/ UPDATE \/ DELETE are deliberately NOT touched/.test(RUNME),
    "the 'CRUD left in place on purpose' rationale is retired and must not return");
  assert.match(RUNME, /SECURITY DEFINER/,
    "the file records WHY this is safe: the one anonymous caller needs no table privilege");
});

test("the RUNME self-test proves the revoke worked, for every type, and cannot pass vacuously", () => {
  const st = RUNME.slice(RUNME.indexOf("-- (9d)"), RUNME.indexOf("-- (10)"));
  assert.ok(!/privilege_type in \('REFERENCES','TRIGGER','TRUNCATE'\)/.test(st),
    "the three-type filter is gone — it was a denylist wearing an allowlist's name");
  assert.ok(!/privilege_type\s+in\s*\(/i.test(st),
    "the self-test must not filter on privilege_type at all");
  assert.match(st, /raise exception 'HUB FAIL: anon\/PUBLIC still hold/, "it aborts if any survived");
  assert.match(st, /the check is vacuous, not passing/,
    "a probe that sees nothing anywhere must abort rather than report success");
  assert.match(st, /sequences owned by the communications tables/,
    "sequences are checked separately — revoking table privileges never reaches them");
});

test("the POSTCHECK anon check is an ALLOWLIST across ALL privilege types", () => {
  const g = POST.slice(POST.indexOf("G.anon_allowlist_legacy_tables"));
  assert.match(POST, /allowed\(table_name, grantee, privilege_type\) as \(/, "there is a named allowlist");
  assert.match(POST, /select null::text, null::text, null::text where false/,
    "and it is empty — nothing was found that needs a table privilege");
  assert.match(g, /not exists \(select 1 from allowed a/, "the check is 'not on the allowlist', not 'is a bad verb'");
  // The denylist shape this repo has already been bitten by, in any spelling.
  const anonBlock = POST.slice(POST.indexOf("-- ─── G."), POST.indexOf("select check_id, verdict, detail"));
  assert.ok(!/privilege_type\s+in\s*\(\s*'SELECT'/i.test(anonBlock),
    "no denylist of the four CRUD verbs anywhere in the anon section");
  assert.ok(!/privilege_type\s*=\s*'/i.test(anonBlock), "and no single-type filter either");
  assert.match(POST, /G\.anon_privilege_types_seen_in_public/,
    "the reach of the check is reported, so a type nobody thought to name is still visible");
});

test("the PREFLIGHT baseline was already all-types, which is how the three were found", () => {
  const s = PRE.slice(PRE.indexOf("5) ANON EXPOSURE BASELINE"));
  assert.ok(!/privilege_type\s+in\s*\(/i.test(s), "no privilege_type filter in the baseline query");
  assert.match(PRE, /denylist of four verbs wearing an allowlist's\s+-- name/,
    "and the reason is written down where the next person will read it");
});

test("the AFTER-FAILURE verify reports the FULL anon picture and every privilege type", () => {
  const v = VERIFY.slice(VERIFY.indexOf("V7."));
  assert.ok(!/privilege_type\s+in\s*\(/i.test(v), "no privilege_type filter");
  assert.match(VERIFY, /V7\.anon_privilege_types_anywhere_in_public/, "types seen anywhere are listed");
  assert.match(VERIFY, /V7\.anon_on_comms_tables/, "the comms surface is covered too");
  assert.match(VERIFY, /submit_opportunity_request/,
    "and the one genuine public caller is checked, so a revoke cannot silently break the public form");
});

// ═══ 4. NO DOUBLE SEND · NO ANONYMOUS RELAY ═════════════════════════════════

test("no double send: a mirrored row can be neither retried nor claimed", () => {
  const retry = fnBody("comms_retry");
  assert.match(retry, /o\.is_legacy_mirror or o\.source_kind = 'legacy_mirror'/,
    "retry refuses on explicit provenance first");
  assert.match(retry, /o\.legacy_delivery_id is not null/, "and on the FK link");
  assert.match(retry, /coalesce\(o\.provider,''\) = 'legacy_email_deliveries'/, "and on the provider tag");
  assert.match(retry, /'legacy_mirror_not_retryable'/, "with a named refusal");
  // and the worker cannot pick one up either: mirrors land terminal, and claim
  // only ever selects queued/retrying rows.
  const imp = fnBody("comms_adapter_import_legacy");
  assert.match(imp, /when 'sent' then 'sent' when 'failed' then 'dead_letter' else 'failed' end/,
    "mirrors are imported straight into a terminal status");
  assert.match(fnBody("comms_claim"), /status in \('queued','retrying'\)/, "claim only takes runnable rows");
  assert.ok(POST.includes("D.legacy_mirror_is_terminal_only"), "and the POSTCHECK re-proves it on live data");
});

test("no double send: the legacy queue's own live rows are never mirrored", () => {
  const imp = fnBody("comms_adapter_import_legacy");
  assert.match(imp, /status in \('sent','failed','bounced'\)/, "only terminal legacy rows are copied");
  assert.match(imp, /left_with_legacy_queue/, "and the live ones are reported as still belonging over there");
  assert.match(imp, /not exists \(select 1 from public\.comms_outbox o where o\.legacy_delivery_id = d\.id\)/,
    "a row is never mirrored twice");
  assert.ok(RUNME.includes("uq_comms_outbox_legacy"), "backed by a unique index, not just a query");
});

test("no anonymous relay: both comms routes demand an identity before they do work", () => {
  assert.match(ROUTE, /not_authenticated[\s\S]{0,200}status: 401/, "the legacy-notify route 401s without a session");
  assert.match(ROUTE, /rpcAsUser<boolean>\("comms_is_staff", \{\}, token\)/,
    "and re-checks staff IN THE DATABASE as that user, not from a client claim");
  assert.match(PROCESS, /status: 401/, "the process route 401s too");
  assert.match(PROCESS, /CRON_SECRET/, "its other door is the scheduler secret, not the public");
  assert.ok(!/anon/i.test(RUNME.slice(RUNME.indexOf("USER-CALLABLE"), RUNME.indexOf("SERVICE-ONLY")).replace(/from public, anon/g, "")),
    "no comms_* function is granted to anon");
});

// ═══ THE PACKAGE ITSELF ═════════════════════════════════════════════════════

test("RUNME stays transactional, idempotent, and incapable of sending", () => {
  assert.ok(RUNME.trimStart().startsWith("--"), "starts with its own explanation");
  assert.match(RUNME, /\nbegin;/, "one transaction");
  assert.match(RUNME, /\ncommit;/, "that commits at the end");
  assert.ok(!/concurrently/i.test(RUNME), "no CONCURRENTLY — it would break the single transaction");
  assert.ok(!/\bhttp[_ ]?(get|post)\b|pg_net|dblink/i.test(RUNME), "no external call of any kind");
  assert.match(RUNME, /HUB FAIL: email\/whatsapp must ship DISABLED/, "channels ship disabled");
  assert.match(RUNME, /HUB FAIL: every channel must ship dry_run = true/, "and dry_run");
  for (const t of ["add column if not exists", "create table if not exists", "create or replace function"])
    assert.ok(RUNME.includes(t), `idempotent: ${t}`);
});

test("PREFLIGHT, POSTCHECK and AFTER_FAILURE_VERIFY write nothing at all", () => {
  const forbidden = /\b(insert into|update\s+public\.|delete from|truncate|drop\s+(table|function|trigger)|create\s+(table|function|trigger|index)|grant\s|revoke\s|alter table)\b/i;
  // A privilege NAME inside single quotes is DATA, not a statement: the read-only
  // files drive their per-type checks from a literal list that necessarily
  // contains 'TRUNCATE'. Neutralise exactly that shape — a lone quoted keyword —
  // and nothing else, so a real `truncate public.x` is still caught. The
  // detection is narrowed to what it was always meant to mean, not weakened:
  // no statement can hide inside a single quoted word.
  const dataLiterals = /'(SELECT|INSERT|UPDATE|DELETE|TRUNCATE|REFERENCES|TRIGGER|USAGE|EXECUTE)'/gi;
  const scrub = (s) => code(s).replace(dataLiterals, "''");
  for (const [name, src] of [["PREFLIGHT", PRE], ["AFTER_FAILURE_VERIFY", VERIFY]]) {
    const c = scrub(src);
    assert.ok(!forbidden.test(c), `${name} contains a write statement`);
    assert.ok(!/\bbegin;|\bcommit;/i.test(c), `${name} opens no transaction`);
  }
  // The POSTCHECK's only non-SELECT is the final verdict block, which raises.
  assert.ok(!forbidden.test(scrub(POST)), "POSTCHECK contains a write statement");

  // Non-vacuity: the scrubbing must not have disarmed the detector.
  assert.ok(forbidden.test(scrub("truncate public.notifications;")),
    "a real TRUNCATE statement must still be detected after scrubbing data literals");
  assert.ok(forbidden.test(scrub("revoke all on table public.x from anon;")),
    "a real REVOKE must still be detected");
});

test("AFTER_FAILURE_VERIFY is one result set, absence-safe, and proves the six claims", () => {
  assert.strictEqual((VERIFY.match(/;\s*$/gm) || []).length, 1, "exactly one statement, so exactly one result set");
  assert.match(VERIFY, /select claim, verdict, detail from rows_out order by sort_key;/, "one final SELECT");
  assert.ok(!/auth\.uid\(\)/.test(code(VERIFY)), "nothing depends on auth.uid(), which is NULL in the SQL editor");
  assert.match(VERIFY, /query_to_xml/, "data probes run through a built-in, so no helper has to be created");
  assert.match(VERIFY, /to_regclass\('public\.comms_outbox'\)/, "and are guarded by existence checks");
  for (const claim of ["V1.no_partial_state", "V2.provenance_columns", "V3.channels_disabled",
                       "V4.nothing_was_sent", "V5.no_legacy_row_is_live", "V6.legacy_queue",
                       "V7.anon_on_legacy_notification_tables"])
    assert.ok(VERIFY.includes(claim), `it proves ${claim}`);
});

test("the ROLLBACK still refuses to destroy evidence of a real send", () => {
  assert.match(ROLLBACK, /ROLLBACK REFUSED: % real send\(s\)/, "it refuses loudly");
  assert.match(ROLLBACK, /provider_state in \('accepted','delivered'\)/,
    "and decides 'real' on provenance when the columns exist");
  assert.match(ROLLBACK, /coalesce\(provider, ''\) <> 'legacy_email_deliveries'/,
    "falling back to the old definition when they do not, so the file is correct either way");
});
