// ════════════════════════════════════════════════════════════════════════════
// tests/ai_sql_package.test.js — THE FOUR FILES, AND THE RULES THEY MUST OBEY.
//
// PREFLIGHT proves dependencies · RUNME is one transaction, idempotent, no
// CONCURRENTLY · POSTCHECK is read-only, ONE result set, and safe under
// auth.uid() = NULL · ROLLBACK is honest about what it destroys.
//
// ⚠️ THE RULE THAT HAS ALREADY BROKEN TWO MIGRATIONS IN THIS REPO ⚠️
//    A self-test that CALLS a protected function runs as `postgres` with
//    auth.uid() = NULL, so the gate returns false and the check reads that as a
//    fault. Every self-test here must be STATIC — reading the catalog, not
//    exercising behaviour. This file pins that, because the failure mode is a
//    migration that aborts on a healthy database.
// ════════════════════════════════════════════════════════════════════════════
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { R, FILES, stripComments, sqlCode } = require("./ai_helpers");

const ROOT = path.join(__dirname, "..");
const RUNME = R(FILES.RUNME);
const PREFLIGHT = R(FILES.PREFLIGHT);
const POSTCHECK = R(FILES.POSTCHECK);
const ROLLBACK = R(FILES.ROLLBACK);

test("all four files of the package exist", () => {
  for (const key of ["RUNME", "PREFLIGHT", "POSTCHECK", "ROLLBACK"]) {
    const p = path.join(ROOT, FILES[key]);
    assert.ok(fs.existsSync(p), `${FILES[key]} must exist`);
    assert.ok(fs.statSync(p).size > 2000, `${FILES[key]} must not be a stub`);
  }
});

// ─── RUNME ──────────────────────────────────────────────────────────────────

test("★ the RUNME is ONE transaction and contains no CONCURRENTLY", () => {
  const code = stripComments(RUNME);
  assert.strictEqual((code.match(/^begin;$/gm) || []).length, 1, "exactly one begin");
  assert.strictEqual((code.match(/^commit;$/gm) || []).length, 1, "exactly one commit");
  assert.ok(RUNME.indexOf("\nbegin;") < RUNME.indexOf("\ncommit;"), "in that order");
  assert.ok(!/concurrently/i.test(code), "CONCURRENTLY cannot run inside a transaction");
});

test("the hard PREFLIGHT inside the RUNME runs BEFORE begin — it stops before writing a byte", () => {
  const pre = RUNME.indexOf("do $pre$");
  const begin = RUNME.indexOf("\nbegin;");
  assert.ok(pre > 0 && begin > pre, "the dependency check precedes the transaction");
  assert.match(RUNME.slice(pre, begin), /raise exception 'PREFLIGHT فشل/, "and aborts loudly when unmet");
});

test("the RUNME is idempotent: creates are guarded, policies are dropped first", () => {
  const creates = RUNME.match(/^create table (?!if not exists)/gm) || [];
  assert.deepStrictEqual(creates, [], "every create table uses IF NOT EXISTS");
  const idx = RUNME.match(/^create index (?!if not exists)/gm) || [];
  assert.deepStrictEqual(idx, [], "every create index uses IF NOT EXISTS");
  // Every policy is dropped before it is created.
  const created = (RUNME.match(/create policy (\w+)/g) || []).map((s) => s.split(" ")[2]);
  for (const name of created) {
    assert.ok(RUNME.includes(`drop policy if exists ${name}`), `policy ${name} must be dropped before creation`);
  }
  // Constraints are added only when absent.
  const adds = (RUNME.match(/alter table public\.\w+ add constraint/g) || []).length;
  const guards = (RUNME.match(/if not exists \(select 1 from pg_constraint where conname = /g) || []).length;
  assert.ok(guards >= adds, `each of the ${adds} constraint additions is guarded (${guards} guards)`);
  assert.ok(/on conflict \(id\) do nothing/.test(RUNME), "seed inserts are conflict-safe");
});

test("★ every function is SECURITY DEFINER with a pinned search_path (or a pure IMMUTABLE)", () => {
  const sigs = RUNME.match(/create or replace function public\.\w+\([\s\S]*?as \$/g) || [];
  assert.ok(sigs.length > 40, `the package defines many functions (${sigs.length})`);
  for (const sig of sigs) {
    const name = /function public\.(\w+)/.exec(sig)[1];
    assert.match(sig, /set search_path = public/, `${name} must pin its search_path`);
    if (!/\bimmutable\b/.test(sig)) {
      assert.match(sig, /security definer/, `${name} must be SECURITY DEFINER`);
    }
  }
  // And the migration self-tests the same property at install time.
  assert.match(RUNME, /دالّة-بلا-definer-أو-search_path/, "the self-test enforces it too");
});

test("★ every gate returns an explicit boolean and never NULL", () => {
  for (const fn of [
    "ai_gate", "ai_perm", "ai_is_owner", "ai_is_staff", "ai_can_use_internal",
    "ai_can_view_knowledge", "ai_can_manage_knowledge", "ai_can_approve_knowledge",
    "ai_can_view_all_conversations", "ai_can_redact", "ai_can_review_leads", "ai_can_manage_settings",
  ]) {
    const start = RUNME.indexOf(`create or replace function public.${fn}(`);
    assert.ok(start > 0, `${fn} exists`);
    const body = RUNME.slice(start, RUNME.indexOf("$$;", start) + 3);
    assert.match(body, /returns boolean/, `${fn} returns boolean`);
    assert.match(body, /coalesce\(/, `★ ${fn} collapses NULL to false — an undefined predicate is not a permission`);
  }
});

test("★ RLS is enabled on every table, and NOT ONE write policy exists", () => {
  const tables = [
    "ai_settings", "ai_role_gate_map", "ai_role_source_access", "ai_knowledge_sources",
    "ai_source_revisions", "ai_source_chunks", "ai_conversations", "ai_messages",
    "ai_message_citations", "ai_lead_drafts", "ai_public_rate_limits", "ai_abuse_log",
    "ai_provider_log", "ai_audit",
  ];
  for (const t of tables) {
    assert.ok(RUNME.includes(`alter table public.${t} enable row level security`), `RLS on ${t}`);
  }
  const policies = RUNME.match(/create policy \w+ on public\.\w+ for (\w+)/g) || [];
  assert.ok(policies.length > 5, "policies exist");
  for (const p of policies) {
    assert.ok(/for select/.test(p), `every policy must be SELECT-only — found: ${p}`);
  }
  assert.match(RUNME, /سياسة-كتابة-مباشرة/, "and the self-test refuses to install a write policy");
});

test("★ the self-tests are STATIC — no protected function is CALLED at install time", () => {
  const selftest = RUNME.slice(RUNME.indexOf("do $selftest$"));
  // Reading the catalog is fine; invoking a gate is not.
  for (const forbidden of [
    "select public.ai_can_", "perform public.ai_can_", "select public.ai_ask",
    "perform public.ai_ask", "select public.ai_search_sources", "select public.ai_actor_roles",
  ]) {
    assert.ok(!selftest.includes(forbidden),
      `★ the self-test must not invoke ${forbidden} — under postgres auth.uid() is NULL, the gate returns false, and a healthy migration would abort`,
    );
  }
  // What it does instead:
  assert.match(selftest, /to_regclass\(/, "it reads the relation catalog");
  assert.match(selftest, /pg_get_functiondef\(/, "and function definitions");
  assert.match(selftest, /information_schema\.columns/, "and the column catalog");
  assert.match(RUNME, /ساكن بالكامل/, "and the file states the rule where it is applied");
});

test("the self-test has no catch-all that could make a check pass regardless", () => {
  const selftest = RUNME.slice(RUNME.indexOf("do $selftest$"));
  assert.ok(!/exception\s+when\s+others\s+then\s+null/i.test(selftest),
    "a swallowed exception would turn every check into a pass");
  assert.match(selftest, /if v_missing <> '' then\s*\n\s*raise exception 'SELF-TEST فشل/,
    "and a failure really aborts the transaction");
});

// ─── PREFLIGHT ──────────────────────────────────────────────────────────────

test("★ the PREFLIGHT is READ-ONLY — it does not write a single byte", () => {
  // Executable SQL only: PREFLIGHT's explanatory strings legitimately MENTION
  // "create table if not exists" when telling the operator what RUNME will do.
  const code = sqlCode(PREFLIGHT);
  for (const forbidden of [
    "insert into", "update ", "delete from", "create table", "create function",
    "alter table", "drop ", "grant ", "revoke ", "begin;", "commit;",
  ]) {
    assert.ok(!code.toLowerCase().includes(forbidden), `PREFLIGHT must not contain "${forbidden}"`);
  }
});

test("the PREFLIGHT PROVES its dependencies rather than assuming them", () => {
  assert.match(PREFLIGHT, /is_staff/, "it checks the identity gate");
  assert.match(PREFLIGHT, /is_owner/, "and the owner gate");
  assert.match(PREFLIGHT, /prorettype/, "★ and their RETURN TYPE — a non-boolean gate makes every policy above it 'undefined', which is not a denial");
  assert.match(PREFLIGHT, /BLOCKER/, "and grades findings so a blocker cannot be mistaken for a note");
  assert.match(PREFLIGHT, /OPTIONAL/, "with optional dependencies named as optional");
});

test("the PREFLIGHT calls no protected function either", () => {
  const code = sqlCode(PREFLIGHT);
  assert.ok(!/select public\.(is_staff|is_owner|ai_can_)/.test(code),
    "a live gate call under postgres would report a false blocker");
});

// ─── POSTCHECK ──────────────────────────────────────────────────────────────

test("★ the POSTCHECK is read-only and returns exactly ONE result set", () => {
  const code = sqlCode(POSTCHECK);
  for (const forbidden of ["insert into", "update ", "delete from", "create ", "alter ", "drop ", "grant ", "revoke "]) {
    assert.ok(!code.toLowerCase().includes(forbidden), `POSTCHECK must not contain "${forbidden}"`);
  }
  // One statement: a single trailing semicolon at the end of the file.
  const statements = code.split(";").map((s) => s.trim()).filter(Boolean);
  assert.strictEqual(statements.length, 1, `exactly one statement (found ${statements.length})`);
  assert.match(statements[0], /^with[\s\S]+order by sort_key, area, object$/,
    "one CTE chain ending in one ordered SELECT");
});

test("the POSTCHECK is safe under auth.uid() = NULL — it checks STRUCTURE, not behaviour", () => {
  // Literals stripped: every legitimate reference is a NAME inside
  // to_regprocedure('...') / pg_get_functiondef(...), i.e. a catalog read.
  // What must not survive is an actual invocation in executable position.
  const code = sqlCode(POSTCHECK);
  for (const forbidden of ["public.ai_ask(", "public.ai_public_ask(", "public.ai_search_sources(", "public.ai_can_use_internal("]) {
    assert.ok(!code.includes(forbidden),
      `★ POSTCHECK must not invoke ${forbidden} — it runs with no session, and the result would be read as a fault`);
  }
  assert.match(POSTCHECK, /pg_get_functiondef|to_regprocedure|pg_policies|pg_constraint/,
    "it reads the catalog instead");
});

test("the POSTCHECK verdicts are graded, and FAIL sorts first", () => {
  assert.match(POSTCHECK, /case verdict when 'FAIL' then 1/, "failures sort to the top");
  for (const v of ["FAIL", "SKIP", "INFO"]) {
    assert.ok(POSTCHECK.includes(`'${v}'`), `the ${v} verdict exists`);
  }
});

test("the POSTCHECK actually covers the module's promises, not just its objects", () => {
  for (const claim of [
    "r_no_cot", "r_no_tool_exec", "r_provider_off", "r_citations_required",
    "r_unapproved_never_indexed", "r_double_filter", "r_no_project_membership",
    "r_captcha_failclosed", "r_rate_limits", "r_matrix_external", "r_no_relay",
  ]) {
    assert.ok(POSTCHECK.includes(claim), `POSTCHECK must verify ${claim}`);
  }
});

// ─── ROLLBACK ───────────────────────────────────────────────────────────────

test("★ the ROLLBACK's destructive half is COMMENTED OUT and its cost is spelled out", () => {
  const armed = ROLLBACK.split("\n").filter((l) => /^\s*drop table/i.test(l));
  assert.deepStrictEqual(armed, [], "no active DROP TABLE — data loss is never the default path");
  assert.match(ROLLBACK, /-- drop table if exists public\.ai_knowledge_sources;/, "the destructive option exists, disabled");
  assert.match(ROLLBACK, /✂️/, "and every destructive line states what is lost forever");
});

test("the safe sections drop functions, then policies, then grants — in that order", () => {
  const fns = ROLLBACK.indexOf("القسم ١ — الدوالّ");
  const pol = ROLLBACK.indexOf("القسم ٢ — السياسات");
  const grants = ROLLBACK.indexOf("القسم ٣ — المنح");
  assert.ok(fns > 0 && pol > fns && grants > pol, "the three safe sections are present and ordered");
  assert.match(ROLLBACK, /تُحذَف \*\*بعد\*\* الدوالّ/, "and the ordering reason is written down");
});

test("the ROLLBACK offers the reversible alternative FIRST", () => {
  assert.match(ROLLBACK, /ai_settings_update\('\{"assistant_enabled":false/,
    "switching the assistant off in one row is presented as the usual answer");
  assert.match(ROLLBACK, /الطريق الصحيح في ٩٩٪/, "and framed as the correct path");
});

test("⛔ the ROLLBACK touches nothing outside this module", () => {
  const code = stripComments(ROLLBACK);
  for (const forbidden of ["public.projects", "project_core", "deliverables", "public.clients", "opportunity_requests", "custody_", "crm_", "sq_", "fin_"]) {
    assert.ok(!code.includes(forbidden), `the rollback must not reference ${forbidden}`);
  }
  // The one shared-catalog action is disabled and labelled.
  assert.match(ROLLBACK, /-- delete from public\.permissions where key in \(/, "the permission-key deletion is commented out");
});

// ─── THE PERMISSION CATALOG IS REUSED, NOT DUPLICATED ──────────────────────

test("the assistant's permission keys are ROWS in the shared catalog, not a second engine", () => {
  assert.match(RUNME, /if to_regclass\('public\.permissions'\) is not null then/,
    "the seed is feature-detected — a missing catalog is not a crash");
  for (const key of [
    "ai.knowledge.view", "ai.knowledge.manage", "ai.knowledge.approve",
    "ai.conversation.view_all", "ai.conversation.redact", "ai.lead.review",
  ]) {
    assert.ok(RUNME.includes(`'${key}'`), `${key} is seeded into public.permissions`);
  }
  assert.match(RUNME, /on conflict \(key\) do nothing/, "and never overwrites an existing definition");
  // No second resolver.
  assert.ok(!/create table if not exists public\.ai_permissions/.test(RUNME), "no second permission table");
});

test("the storage bucket is private, and its policies are gated by the module's own keys", () => {
  assert.match(RUNME, /values \('ai-knowledge', 'ai-knowledge', false\)/, "the bucket is not public");
  assert.match(RUNME, /ai_knowledge_objects_read[\s\S]{0,220}?ai_can_view_knowledge/, "reads are gated");
  assert.match(RUNME, /ai_knowledge_objects_write[\s\S]{0,220}?ai_can_manage_knowledge/, "writes are gated");
  assert.match(RUNME, /ai_sources_storage_is_pinned/, "and a stored path is pinned to this bucket by CHECK");
  assert.ok(RUNME.includes("storage_path !~ '\\.\\.'"), "with traversal refused");
});
