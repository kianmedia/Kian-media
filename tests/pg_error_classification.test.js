// ════════════════════════════════════════════════════════════════════════════
// tests/pg_error_classification.test.js — the guard on error HONESTY.
//
// The incident these tests exist for: the large-project dashboard sent
// `projects?select=…,due_date`. public.projects has no due_date column — the
// project deadline lives on public.project_core.due_date — so PostgREST
// answered HTTP 400 / 42703. The classifier folded 42703 in with PGRST204 and
// the screen said «الترحيلة غير مطبّقة: عمود مطلوب غير موجود بعد». The
// migration was fine; the QUERY was wrong. A production debugging cycle was
// spent hunting a migration that did not need running.
//
// So: nine causes, nine answers, no collapsing. Plus the two rules that make
// the failure mode impossible to reintroduce —
//   • a permission denial is NEVER phrased as a missing column;
//   • «الترحيل معلّق» is reserved for a genuinely absent function or table.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadTs } = require("./import_engine_loader");

const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const PG = loadTs("lib/portal/pgerror.ts");
const RPC = loadTs("lib/portal/import/rpc.ts");
const LP = loadTs("lib/portal/large-projects.ts");

/** The real wire messages. The browser client flattens the body to `message`
 *  (no SQLSTATE); the import server keeps a "CODE | message" prefix. Both. */
const SAMPLES = {
  fn_browser: ["Could not find the function public.large_project_dashboard(p_project) in the schema cache", 404],
  fn_server: ["PGRST202 | Could not find the function public.project_import_execute(p_payload) in the schema cache", 404],
  fn_sqlstate: ["42883: function project_import_execute(jsonb) does not exist", 400],
  cache_col: ["PGRST204 | Could not find the 'schedule_status' column of 'deliverables' in the schema cache", 400],
  cache_tbl: ["PGRST205 | Could not find the table 'public.deliverable_internal' in the schema cache", 404],
  // ← THE incident
  col_browser: ["column projects.due_date does not exist", 400],
  col_server: ['42703 | column "external_key" does not exist', 400],
  tbl_browser: ['relation "public.deliverable_internal" does not exist', 400],
  tbl_server: ["42P01 | relation \"public.planning_resources\" does not exist", 400],
  perm_table: ["permission denied for table projects", 403],
  perm_sqlstate: ["42501: permission denied for function large_project_deliverables_bulk_update", 400],
  rls_write: ["new row violates row-level security policy for table \"deliverables\"", 400],
  syntax: ['42601: syntax error at or near ")"', 400],
  parse: ['PGRST100 | unexpected "e" expecting digit', 400],
  auth: ["session_expired", 401],
  network: ["TypeError: Failed to fetch", 0],
  opaque: ["HTTP 400", 400],
};

// ─── (١) كل سبب في دلوه ─────────────────────────────────────────────────────

test("each PostgreSQL/PostgREST cause lands in its OWN bucket", () => {
  const expected = {
    fn_browser: "missing_function", fn_server: "missing_function", fn_sqlstate: "missing_function",
    cache_col: "schema_cache_stale", cache_tbl: "schema_cache_stale",
    col_browser: "missing_column", col_server: "missing_column",
    tbl_browser: "missing_table", tbl_server: "missing_table",
    perm_table: "permission_denied", perm_sqlstate: "permission_denied", rls_write: "permission_denied",
    syntax: "invalid_query", parse: "invalid_query",
    auth: "not_authenticated", network: "network", opaque: "unknown",
  };
  for (const [name, kind] of Object.entries(expected)) {
    const [msg, status] = SAMPLES[name];
    assert.equal(PG.pgClassify(msg, status).kind, kind, `${name} misclassified`);
  }
});

test("42703 and PGRST204 are NOT the same bucket, and neither is 42P01 and PGRST205", () => {
  const c42703 = PG.pgClassify(...SAMPLES.col_browser).kind;
  const c204 = PG.pgClassify(...SAMPLES.cache_col).kind;
  const c42P01 = PG.pgClassify(...SAMPLES.tbl_browser).kind;
  const c205 = PG.pgClassify(...SAMPLES.cache_tbl).kind;
  assert.notEqual(c42703, c204, "a wrong column name is not a stale schema cache");
  assert.notEqual(c42P01, c205, "an absent table is not a stale schema cache");
});

// ─── (٢) الحادثة نفسها: 42703 لا يُقرأ «الترحيلة غير مطبّقة» ───────────────

test("the incident: 42703 on projects.due_date never reads as an unapplied migration", () => {
  const d = PG.pgClassify(...SAMPLES.col_browser);
  assert.equal(d.kind, "missing_column");
  assert.equal(d.verdict, "our_request", "the fault is OUR select, and the diagnosis must say so");
  assert.equal(PG.pgIsMigrationPending(d), false, "«الترحيل معلّق» is not an honest answer to a 42703");
  assert.equal(d.column, "projects.due_date", "the missing column must be named — that is the whole fix");

  const ar = PG.pgUserMessageAr(d);
  assert.match(ar, /projects\.due_date/, "the user message must name the column");
  assert.doesNotMatch(ar, /الترحيلة غير مطبّقة/, "this exact sentence sent the owner hunting a fine migration");
  assert.match(ar, /42703/, "the underlying code must never be swallowed");

  // …and the same through the large-projects layer the dashboard actually calls.
  assert.equal(LP.lpClassify(...SAMPLES.col_browser), "missing_column");
  assert.equal(LP.lpIsMigrationPending(LP.lpClassify(...SAMPLES.col_browser)), false);
  assert.doesNotMatch(LP.lpErr(...SAMPLES.col_browser), /الترحيلة غير مطبّقة/);
});

test("a genuinely absent function or table IS reported as a pending migration", () => {
  for (const s of [SAMPLES.fn_server, SAMPLES.tbl_server]) {
    const d = PG.pgClassify(...s);
    assert.equal(PG.pgIsMigrationPending(d), true);
    assert.match(PG.pgUserMessageAr(d), /الترحيلة غير مطبّقة/);
    assert.equal(LP.lpIsMigrationPending(LP.lpClassify(...s)), true);
  }
});

test("a stale schema cache asks for a reload, not for a migration", () => {
  for (const s of [SAMPLES.cache_col, SAMPLES.cache_tbl]) {
    const d = PG.pgClassify(...s);
    assert.equal(d.verdict, "cache_stale");
    assert.equal(PG.pgIsMigrationPending(d), false);
    assert.match(PG.pgUserMessageAr(d), /Reload schema|المخطط/);
  }
});

// ─── (٣) القاعدة الحمراء: صلاحية ≠ عمود ────────────────────────────────────

test("a permission error is NEVER shown as a missing column", () => {
  for (const s of [SAMPLES.perm_table, SAMPLES.perm_sqlstate, SAMPLES.rls_write]) {
    const d = PG.pgClassify(...s);
    assert.equal(d.kind, "permission_denied");
    const ar = PG.pgUserMessageAr(d);
    assert.doesNotMatch(ar, /عمود/, "a denial must not mention a column");
    assert.doesNotMatch(ar, /الترحيل/, "a denial must not mention a migration");
    assert.match(ar, /صلاحية/);
    assert.equal(LP.lpClassify(...s), "forbidden");
    assert.doesNotMatch(LP.lpErr(...s), /عمود/);
  }
  // Even a denial whose text happens to mention a relation stays a denial.
  assert.equal(PG.pgClassify("permission denied for relation projects", 400).kind, "permission_denied");
});

// ─── (٤) صفر صفوف ليس خطأ ──────────────────────────────────────────────────

test("zero rows is a RESULT, not an error — RLS is often answering correctly", () => {
  const d = PG.pgClassifyResult({ ok: true }, 0);
  assert.equal(d.kind, "empty_result");
  assert.equal(d.isError, false);
  assert.equal(PG.pgIsMigrationPending(d), false);
  assert.doesNotMatch(PG.pgUserMessageAr(d), /الترحيل|خطأ/);
  assert.equal(PG.pgClassifyResult({ ok: true }, 7), null, "rows returned ⇒ nothing to diagnose");
});

// ─── (٥) مخرجات المطوّر: كاملة، وبلا أسرار ─────────────────────────────────

test("the developer line carries component, target, code, column and purpose", () => {
  const line = PG.pgDevLine(PG.pgClassify(...SAMPLES.col_browser), {
    component: "LargeProjectDashboard", table: "projects", purpose: "load the project header",
  });
  assert.match(line, /LargeProjectDashboard/);
  assert.match(line, /table:projects/);
  assert.match(line, /code=42703/);
  assert.match(line, /column=projects\.due_date/);
  assert.match(line, /purpose="load the project header"/);
  assert.match(line, /Check the select list BEFORE suspecting a migration/);
});

test("no token, key, address, row id or URL ever reaches a log", () => {
  const dirty = [
    "apikey=sb_secret_abc123",
    "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig",
    "https://example-project-ref.supabase.co/rest/v1/projects?id=eq.11111111-2222-3333-4444-555555555555&select=due_date",
    "Key (email)=(owner@example.com) already exists",
    "phone 0512345678901",
  ].join(" | ");
  const out = PG.pgRedact(dirty);
  for (const secret of ["sb_secret_abc123", "eyJhbGciOiJIUzI1NiJ9", "supabase.co", "owner@example.com", "11111111-2222-3333-4444-555555555555", "0512345678901"]) {
    assert.ok(!out.includes(secret), `pgRedact leaked ${secret}`);
  }
  const line = PG.pgDevLine(PG.pgClassify(dirty, 400), { component: "x", table: "projects?id=eq.abc&select=due_date", purpose: "p" });
  assert.ok(!line.includes("eyJhbGciOiJIUzI1NiJ9"), "a JWT reached the log line");
  assert.ok(!line.includes("id=eq."), "the URL filters reached the log line");
  assert.match(line, /table:projects\b/, "only the table name is logged");
});

test("pgSafeTarget keeps the table and drops every filter", () => {
  assert.equal(PG.pgSafeTarget("/rest/v1/projects?id=eq.9f&select=name"), "projects");
  assert.equal(PG.pgSafeTarget("rpc/large_project_dashboard"), "rpc/large_project_dashboard");
});

test("the real error is never swallowed: message and code survive", () => {
  const d = PG.pgClassify(...SAMPLES.opaque);
  assert.equal(d.kind, "unknown", "an unrecognised error is labelled honestly, not guessed");
  assert.equal(d.message, "HTTP 400", "the raw message is preserved verbatim");
});

// ─── (٦) محرّك الاستيراد: نسخة مطابقة (لأنه ممنوع من الاستيراد الخارجيّ) ────

test("the import engine's local classifier agrees with the app-wide one", () => {
  // The engine may not import app modules (tests/import_contract.test.js), so
  // it carries the same table locally. This pins the two together.
  const map = {
    missing_function: "function", missing_table: "table", missing_column: "column",
    schema_cache_stale: "cache", permission_denied: "permission", invalid_query: "invalid",
    not_authenticated: "auth", network: "network", unknown: "other",
  };
  for (const [name, [msg, status]] of Object.entries(SAMPLES)) {
    const app = PG.pgClassify(msg, status).kind;
    assert.equal(RPC.pgKindOf(msg, status), map[app], `engine and app disagree on ${name}`);
  }
  assert.equal(RPC.pgColumnOf(SAMPLES.col_browser[0]), "projects.due_date");
});

test("the import engine keeps «الترحيلة لم تُحدَّث» for absent objects only", () => {
  assert.equal(RPC.isMigrationPending(...SAMPLES.fn_server), true);
  assert.equal(RPC.isMigrationPending(...SAMPLES.tbl_server), true);
  assert.equal(RPC.isMigrationPending(...SAMPLES.col_server), false, "42703 is not «run the SQL»");
  assert.equal(RPC.isMigrationPending(...SAMPLES.cache_col), false, "a stale cache is not «run the SQL»");
  assert.equal(RPC.importFailureReason(...SAMPLES.fn_server), RPC.MIGRATION_PENDING_AR);
  const colMsg = RPC.importFailureReason(...SAMPLES.col_server);
  assert.match(colMsg, /external_key/);
  assert.doesNotMatch(colMsg, /لم تُحدَّث بعد/, "a missing column must not be filed under «run the migration»");
  assert.doesNotMatch(RPC.importFailureReason(...SAMPLES.perm_table), /عمود/);
  // classifyMissing keeps its three-value shape for the capability switches.
  assert.equal(RPC.classifyMissing(...SAMPLES.col_server), "column");
  assert.equal(RPC.classifyMissing(...SAMPLES.fn_server), "function");
  assert.equal(RPC.classifyMissing(...SAMPLES.tbl_server), "table");
  assert.equal(RPC.classifyMissing("permission denied for function"), null);
  assert.equal(RPC.classifyMissing(""), null);
});

// ─── (٧) لا عودة إلى الدمج القديم ──────────────────────────────────────────

test("nothing in the app re-collapses 42703 into a migration message", () => {
  const LIB = read("lib/portal/large-projects.ts");
  const DASH = read("components/portal/LargeProjectDashboard.tsx");
  assert.doesNotMatch(LIB, /PGRST204\|42703/, "the collapsed bucket must stay gone");
  assert.match(DASH, /setMigrationPending\(lpIsMigrationPending\(k\)\)/);
  // The old sentence may only survive where a table/function really is absent.
  const err = LIB.match(/export function lpErr[\s\S]*?\n\}/)[0];
  assert.doesNotMatch(err, /عمود مطلوب غير موجود بعد/, "the sentence that caused the incident is retired");
});
