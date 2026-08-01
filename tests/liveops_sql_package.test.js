// ════════════════════════════════════════════════════════════════════════════
// tests/liveops_sql_package.test.js — the four-file contract, and the promise
// that this module is ADDITIVE.
//
// House rules under test:
//   • PREFLIGHT / RUNME / POSTCHECK / ROLLBACK all exist
//   • RUNME is transactional and idempotent, with no CONCURRENTLY
//   • POSTCHECK is read-only, ONE result set, structural, and safe when
//     auth.uid() is NULL
//   • self-tests are STATIC — a live protected-RPC call dies under `postgres`
//     and has already broken two migrations in this repository
//   • no catch-all that makes a check pass regardless of reality
//   • ⛔ the frozen project platform and the twelve finished modules are not
//     touched: project_id is an OPTIONAL READ-ONLY reference with no FK
// ════════════════════════════════════════════════════════════════════════════
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { R, FILES, root } = require("./liveops_helpers");

const RUNME = R(FILES.RUNME);
const PRE = R(FILES.PREFLIGHT);
const POST = R(FILES.POSTCHECK);
const ROLL = R(FILES.ROLLBACK);

/** Drop `-- comments` and '...' literals so a `;` or a name INSIDE a string is
 *  not mistaken for real SQL. Several of these checks are meaningless without
 *  it: 'return DENY;' is a literal, and to_regprocedure('public.f(x)') is a
 *  NAME, not a call. */
function code(sql) {
  return sql.replace(/--.*$/gm, "").replace(/'(?:[^']|'')*'/g, "''");
}

/** Slice out one numbered section by its banner line, not by the first stray
 *  mention of the marker inside the file header. */
function section(sql, from, to) {
  const a = sql.indexOf(`-- ${from}`);
  const b = to ? sql.indexOf(`-- ${to}`, a + 1) : sql.length;
  assert.ok(a > -1, `section ${from} not found`);
  return sql.slice(a, b > -1 ? b : sql.length);
}

test("all four files ship", () => {
  for (const key of ["RUNME", "PREFLIGHT", "POSTCHECK", "ROLLBACK"]) {
    assert.ok(fs.existsSync(path.join(root, FILES[key])), `${FILES[key]} must exist`);
  }
});

test("RUNME is transactional, idempotent and never uses CONCURRENTLY", () => {
  assert.match(RUNME, /^begin;$/m);
  assert.match(RUNME, /^commit;$/m);
  // ⚠️ الشيفرة وحدها: التعليق الذي يشرح **غياب** CONCURRENTLY ليس استعمالًا له.
  //    الصيغة السابقة أدانت تعليقًا يوثّق سبب دمج المعاملتين — وهو تاسع ظهور
  //    لصنف «طابق الاسم لا الشكل» في هذا البرنامج.
  const codeOnlyRunme = RUNME.split("\n")
    .map((l) => { let q = false;
      for (let i = 0; i < l.length; i++) {
        if (l[i] === "'") q = !q;
        else if (!q && l[i] === "-" && l[i + 1] === "-") return l.slice(0, i);
      }
      return l; }).join("\n");
  assert.ok(!/concurrently/i.test(codeOnlyRunme), "CONCURRENTLY cannot run inside a transaction");

  // Idempotent DDL only.
  const creates = RUNME.match(/^create table (?!if not exists)/gm) ?? [];
  assert.deepStrictEqual(creates, [], "every table creation must be `create table if not exists`");
  const indexes = RUNME.match(/^create index (?!if not exists)/gm) ?? [];
  assert.deepStrictEqual(indexes, [], "every index must be `create index if not exists`");
  const fns = RUNME.match(/^create function /gm) ?? [];
  assert.deepStrictEqual(fns, [], "functions use `create or replace`");
  // Policies and triggers are dropped before being (re)created.
  assert.match(RUNME, /drop policy if exists/);
  assert.match(RUNME, /drop trigger if exists/);
});

test("★ the 42P13 guard fails loudly BEFORE any half-migration is left behind", () => {
  const guard = section(RUNME, "§0", "§1  ");
  assert.match(guard, /raise exception 'LIVEOPS 42P13/);
  assert.match(guard, /pg_get_function_result\(p\.oid\)/);
  // Every function family has a declared expected return type.
  for (const t of ["'boolean'", "'text'", "'jsonb'", "'trigger'", "'void'", "'uuid'"]) {
    assert.ok(guard.includes(t), `the guard must know the expected type ${t}`);
  }
});

test("★ the self-test is STATIC — it never calls a protected RPC", () => {
  const selfTest = RUNME.slice(RUNME.lastIndexOf("-- §20"));
  // Everything is catalogue introspection.
  for (const src of ["pg_class", "pg_policies", "pg_proc", "pg_trigger", "pg_constraint",
                     "information_schema.role_table_grants", "information_schema.role_routine_grants"]) {
    assert.ok(selfTest.includes(src), `the self-test should assert against ${src}`);
  }
  // No protected function is invoked. The one call that IS made is to a pure
  // immutable text classifier with no session context and no writes.
  // Strip literals first: to_regprocedure('public.liveops_x(uuid)') is a NAME.
  const calls = code(selfTest).match(/public\.liveops_[a-z_]+\(/g) ?? [];
  const allowed = new Set(["public.liveops_secret_reason("]);
  assert.ok(selfTest.includes("public.liveops_secret_reason("),
    "the one permitted call is the pure, immutable, session-free text classifier");
  for (const c of calls) {
    assert.ok(allowed.has(c), `the self-test must not invoke ${c} — it would raise 'not authorized' under postgres`);
  }
});

test("the self-test has no catch-all that would make a check pass regardless", () => {
  const selfTest = RUNME.slice(RUNME.lastIndexOf("-- §20"));
  assert.ok(!/exception when others then\s*\n\s*null;/.test(selfTest));
  assert.ok(!/exception when others then\s*\n\s*return;/.test(selfTest));
  // Every check raises on failure rather than logging.
  const raises = selfTest.match(/raise exception 'LIVEOPS SELF-TEST/g) ?? [];
  assert.ok(raises.length >= 15, `expected a dense self-test, found ${raises.length} assertions`);
});

test("PREFLIGHT is read-only and proves its dependencies", () => {
  assert.ok(!/^\s*(insert|update|delete|create table|alter table|drop)\b/im.test(code(PRE)),
    "PREFLIGHT must not write");
  assert.match(PRE, /to_regprocedure\('public\.is_owner\(\)'\)/);
  assert.match(PRE, /to_regprocedure\('pg_catalog\.sha256\(bytea\)'\)/);
  // ★ The return-type check: a gate that returns non-boolean evaluates to NULL
  //   in a boolean composition, which reads as "undetermined", not "deny".
  assert.match(PRE, /p\.prorettype = 'boolean'::regtype/);
  assert.match(PRE, /raise exception 'LIVEOPS PREFLIGHT/);
  // Optional dependencies are listed as optional, not as blockers.
  assert.match(PRE, /الاعتمادات الاختيارية/);
});

test("★ POSTCHECK is ONE statement returning ONE result set", () => {
  // Literals stripped first — 'return DENY;' is a string, not a statement end.
  const statements = code(POST).split(";").filter((s) => s.trim().length > 0);
  assert.strictEqual(statements.length, 1,
    "a SQL editor shows only the LAST statement's result; several statements would silently hide every check but one");
  assert.match(POST, /^with\s*$/m);
  assert.match(POST, /from checks order by ord;/);
});

test("POSTCHECK is safe when auth.uid() is NULL and when the migration never ran", () => {
  assert.ok(!/^\s*(insert|update|delete)\b/im.test(code(POST)), "POSTCHECK must not write");
  // Every object reference goes through to_regclass/to_regprocedure so a missing
  // object reports as missing instead of killing the file with 42P01/42883.
  assert.match(POST, /to_regprocedure\('public\.liveops_client_payload\(uuid\)'\)/);
  assert.match(POST, /to_regclass\('public\.permissions'\) is null/);

  // ★ No optional table or function is named in a FROM or as a call: both are
  //   resolved at planning time and would abort the WHOLE file.
  assert.ok(!/from public\.permissions/i.test(code(POST)),
    "referencing an optional table in FROM would abort the whole POSTCHECK when it is absent");
  assert.ok(!/public\.liveops_secret_reason\(/.test(code(POST)),
    "calling a module function would abort the whole POSTCHECK if RUNME had failed");

  // The verdict column is explicit; nothing passes by default.
  assert.match(POST, /'✅ PASS' else '❌ FAIL'/);
  assert.match(POST, /'ℹ️ INFO'/);
});

test("POSTCHECK covers each headline guarantee of the module", () => {
  for (const claim of [
    "FORCE RLS مطفأة",
    "لا سياسة كتابة",
    "anon/PUBLIC بلا منح",
    "جدول الروابط وسجلّه بلا منح قراءة مباشرة",
    "liveops_client_view غير ممنوحة",
    "حمولة العميل خالية من الأعمدة الحسّاسة",
    "رمز مجهول/منتهٍ/ملغى ⇒ استجابة واحدة",
    "حارس الحالة مركَّب ويفحص العميل والسلطة والانتقال",
    "قيد صدق مصدر القياس",
    "ماسح الأسرار مركَّب",
    "لا مفتاح أجنبيّ نحو projects/ops_jobs/deliverables",
  ]) {
    assert.ok(POST.includes(claim), `POSTCHECK must verify: ${claim}`);
  }
});

test("ROLLBACK separates the safe part from the destructive part, and names what is lost", () => {
  // Sections 1-3 are live and lossless.
  assert.match(ROLL, /القسم ١ — المُشغِّلات \(آمن · بلا فقدان صفوف\)/);
  assert.match(ROLL, /القسم ٢ — الدوالّ \(آمن · بلا فقدان صفوف\)/);
  assert.match(ROLL, /القسم ٣ — المنح والسياسات \(آمن · بلا فقدان صفوف\)/);

  // Every destructive statement is commented out.
  for (const line of ROLL.split("\n")) {
    if (/^\s*drop table /i.test(line) || /^\s*delete from /i.test(line)) {
      assert.fail(`destructive statement must be commented out: ${line.trim()}`);
    }
  }
  assert.match(ROLL, /^-- drop table if exists public\.liveops_incidents;$/m);
  assert.match(ROLL, /^-- delete from public\.permissions where key in$/m);

  // And it explains, concretely, what disappears.
  assert.match(ROLL, /يُمحى ما حدث فعلًا أثناء بثّ مباشر/);
  assert.match(ROLL, /من فتح رابط المتابعة ومتى، والمحاولات المرفوضة/);
});

test("ROLLBACK leaves the module fail-closed rather than half-open", () => {
  const safe = section(ROLL, "القسم ٣ — المنح", "القسم ٤ — 🚨");
  assert.match(safe, /revoke all on public\.%I from authenticated/);
  assert.match(safe, /alter table public\.%I enable row level security/,
    "RLS stays on, so a table with no policy and no grant is unreachable");
  // The dangerous ordering is called out where it matters.
  assert.match(ROLL, /شغّل ١ و٢ و٣ معًا أو لا تشغّل شيئًا/);
});

// ─── the freeze and the finished modules ────────────────────────────────────

test("★★ no foreign key points at the frozen platform or at a finished module", () => {
  // A FK would silently change DELETE behaviour on a table this module does not own.
  const fks = RUNME.match(/references public\.[a-z_]+/g) ?? [];
  for (const fk of fks) {
    assert.ok(/references public\.liveops_/.test(fk),
      `${fk} — the only permitted FKs are internal to the module`);
  }
  // auth.users is the one external reference, and it is a user id, not a business row.
  assert.ok(RUNME.includes("references auth.users(id)"));
  // Declared plainly, and proven again by the self-test against the catalogue.
  assert.match(RUNME, /prodops_job_id\s+uuid,\s*\n\s*project_id\s+uuid,/);
  assert.match(RUNME, /مفتاح أجنبيّ نحو وحدة مجمَّدة\/مكتملة/);
});

test("project_id is an OPTIONAL, READ-ONLY reference validated by feature detection", () => {
  assert.match(RUNME, /if v_project is not null and to_regclass\('public\.projects'\) is not null then/);
  assert.match(RUNME, /if not exists \(select 1 from public\.projects pr where pr\.id = v_project\) then/);
  // The module never writes to the platform.
  for (const t of ["projects", "project_core", "deliverables", "deliverable_internal",
                   "project_transition_requests"]) {
    const writes = new RegExp(`(insert into|update|delete from)\\s+public\\.${t}\\b`, "i");
    assert.ok(!writes.test(RUNME), `the module must never write to public.${t}`);
    const alters = new RegExp(`alter table\\s+public\\.${t}\\b`, "i");
    assert.ok(!alters.test(RUNME), `the module must never alter public.${t}`);
  }
});

test("the twelve finished modules are only ever READ, never altered", () => {
  const prefixes = ["comms_", "prodops_", "crm_", "fin_", "csub_", "sq_", "lsr_",
                    "custody_inventory_", "tvn_", "vcc_", "cs_", "mgmt_"];
  for (const p of prefixes) {
    const alter = new RegExp(`alter (table|function|policy)\\s+public\\.${p}`, "i");
    assert.ok(!alter.test(RUNME), `the module must not alter ${p}* objects`);
    const drop = new RegExp(`drop (table|function|policy|trigger)[^\\n]*public\\.${p}`, "i");
    assert.ok(!drop.test(RUNME), `the module must not drop ${p}* objects`);
  }
  // ops_jobs (production operations) is read for validation only.
  assert.match(RUNME, /if not exists \(select 1 from public\.ops_jobs j where j\.id = v_job\) then/);
  assert.ok(!/insert into public\.ops_jobs|update public\.ops_jobs/.test(RUNME));
});

test("optional integrations are feature-detected, never hard dependencies", () => {
  // notify() may be absent, may be constrained by a different CHECK, may throw.
  const notify = RUNME.slice(RUNME.indexOf("create or replace function public.liveops_notify"));
  assert.match(notify, /if to_regprocedure\('public\.notify\(uuid,text,text,text,uuid,text,text\)'\) is null then/);
  assert.match(notify, /notify_unavailable/);
  assert.match(notify, /exception when others then/, "a broken notification path must not kill a live broadcast");
  // And the type is validated against the known constraint shape before use.
  assert.match(notify, /p_type !~ '\^\[a-z\]\[a-z0-9_\]\{2,60\}\$'/);
});

test("the audit writer can never abort an operation during a live broadcast", () => {
  const log = RUNME.slice(RUNME.indexOf("create or replace function public.liveops_log"));
  assert.match(log, /exception when others then\s*\n\s*return;/);
  assert.match(log, /تدقيق معطوب لا يُسقط عملية تشغيل مباشر/);
  // But sensitive writes ARE audited on the happy path.
  for (const action of ["session_create", "session_set_status", "incident_open",
                        "incident_root_cause_release", "link_issue", "link_revoke", "report_approve"]) {
    assert.ok(RUNME.includes(`'${action}'`), `${action} must be audited`);
  }
});

test("the file names match the brief exactly", () => {
  assert.strictEqual(FILES.RUNME, "docs/live_operations_dashboard_RUNME.sql");
  assert.strictEqual(FILES.PREFLIGHT, "docs/live_operations_dashboard_PREFLIGHT.sql");
  assert.strictEqual(FILES.POSTCHECK, "docs/live_operations_dashboard_POSTCHECK.sql");
  assert.strictEqual(FILES.ROLLBACK, "docs/live_operations_dashboard_ROLLBACK.sql");
});
