// ════════════════════════════════════════════════════════════════════════════
// tests/case_study_sql_package.test.js — CASE STUDIES · THE FOUR SQL FILES
//
// Shape rules the brief fixes: RUNME transactional + idempotent + no CONCURRENTLY,
// POSTCHECK read-only + a SINGLE result set + structural + safe with auth.uid()=NULL,
// PREFLIGHT proves dependencies, ROLLBACK honest that it destroys real history.
// Self-tests must be STATIC — a live protected-RPC call dies under postgres.
// ════════════════════════════════════════════════════════════════════════════
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(root, p), "utf8");

const PRE = R("docs/case_studies_platform_PREFLIGHT.sql");
const RUNME = R("docs/case_studies_platform_RUNME.sql");
const POST = R("docs/case_studies_platform_POSTCHECK.sql");
const BACK = R("docs/case_studies_platform_ROLLBACK.sql");

test("all four files exist and none is a stub", () => {
  for (const [name, body] of Object.entries({ PRE, RUNME, POST, BACK })) {
    assert.ok(body.length > 2000, `${name} has real content`);
  }
});

test("RUNME is one transaction, idempotent, and never uses CONCURRENTLY", () => {
  assert.ok(/^\s*begin;/im.test(RUNME), "opens a transaction");
  assert.ok(/^\s*commit;/im.test(RUNME), "commits it");
  const code = RUNME.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  assert.ok(!/concurrently/i.test(code), "CONCURRENTLY cannot run inside a transaction");
  // Idempotency: every table/index/policy is created defensively.
  const creates = RUNME.match(/^create table (?!if not exists)/gim) ?? [];
  assert.deepEqual(creates, [], "tables use IF NOT EXISTS");
  const idx = RUNME.match(/^create index (?!if not exists)/gim) ?? [];
  assert.deepEqual(idx, [], "indexes use IF NOT EXISTS");
  const policies = (RUNME.match(/^create policy/gim) ?? []).length;
  const drops = (RUNME.match(/^drop policy if exists/gim) ?? []).length;
  assert.ok(drops >= policies, "every policy is dropped-if-exists before being created");
  for (const trg of RUNME.match(/^create trigger (\w+)/gim) ?? []) {
    const name = trg.split(/\s+/)[2];
    assert.ok(new RegExp(`drop trigger if exists ${name}`, "i").test(RUNME), `${name} is dropped first`);
  }
});

test("RUNME self-tests are STATIC — no live protected RPC call", () => {
  const selftest = RUNME.slice(RUNME.indexOf("SELF-TEST"));
  assert.ok(selftest.length > 0, "there are self-tests");
  // A live gate call would return false under postgres/auth.uid()=NULL and read as broken.
  // Naming a function inside to_regprocedure('…') / pg_get_functiondef is STATIC and fine;
  // executing it is not.
  for (const gate of ["can_publish_case_studies", "can_edit_case_studies", "can_review_case_studies",
                      "can_view_case_studies_internal"]) {
    assert.ok(!new RegExp(`(select|perform|if not)\\s+(coalesce\\()?public\\.${gate}\\(\\)`).test(selftest),
      `${gate} is never invoked live inside a self-test`);
  }
  assert.ok(!/(select|perform)\s+public\.cs_(publish|upsert|approve|preview|list|get)\(/.test(selftest),
    "no protected RPC is executed by the migration itself");
  assert.ok(/pg_get_functiondef|pg_proc|pg_constraint|information_schema/.test(selftest),
    "assertions read the catalogue instead");
});

test("every function is SECURITY DEFINER with a pinned search_path", () => {
  const defs = RUNME.match(/create or replace function public\.\w+\([^)]*\)[\s\S]{0,300}?as \$\$/g) ?? [];
  assert.ok(defs.length > 40, "the package defines the expected surface");
  for (const d of defs) {
    const name = d.match(/function public\.(\w+)/)[1];
    assert.ok(/set search_path = public/.test(d), `${name} pins search_path`);
    // immutable text helpers are the only ones allowed to be plain
    if (!/immutable/.test(d)) {
      assert.ok(/security definer/.test(d), `${name} is SECURITY DEFINER`);
    }
  }
});

test("POSTCHECK is read-only, single result set, structural and NULL-safe", () => {
  assert.ok(!/^\s*(insert|update|delete|create|drop|alter|grant|revoke)\b/im.test(POST),
    "POSTCHECK writes nothing");
  assert.ok(!/\bbegin;|\bcommit;/i.test(POST), "no transaction control needed for a read-only file");
  // Exactly one statement terminator in the whole file: a single WITH … SELECT.
  const postCode = POST.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  const terminators = (postCode.match(/;/g) ?? []).length;
  assert.equal(terminators, 1, `POSTCHECK returns ONE result set (found ${terminators} statements)`);
  assert.ok(/^\s*with\b/im.test(POST) && /union all/i.test(POST));
  // Structural: reads the catalogue, never calls a live gate.
  assert.ok(/pg_get_functiondef/.test(POST));
  // Naming a gate inside to_regprocedure('…') is a catalogue lookup. CALLING it
  // under postgres (auth.uid() = NULL) would return false and read as "broken".
  for (const gate of ["can_publish_case_studies", "can_view_case_studies_internal",
                      "can_edit_case_studies", "can_review_case_studies", "cs_is_public"]) {
    assert.ok(!new RegExp(`(select|when|and|or)\\s+(coalesce\\()?public\\.${gate}\\(`).test(POST),
      `${gate} is never invoked live in POSTCHECK`);
  }
  assert.ok(!/select public\.cs_(list|get|checklist|preview|public_index|public_study)\(/.test(POST),
    "POSTCHECK executes no RPC at all");
  assert.ok(/'FAIL'/.test(POST) && /'PASS'/.test(POST), "verdicts are real");
});

test("POSTCHECK has no catch-all that would pass regardless", () => {
  // A row like  case when true then 'PASS' ... would be a lie. Each verdict must
  // depend on a lookup expression.
  assert.ok(!/case when true then 'PASS'/i.test(POST));
  assert.ok(!/coalesce\(.*, 'PASS'\)/i.test(POST), "no default-to-PASS");
  // Sanity: the number of PASS/FAIL branches is proportional to the row count.
  const failBranches = (POST.match(/'FAIL'/g) ?? []).length;
  assert.ok(failBranches >= 25, `every check can fail (${failBranches} FAIL branches)`);
});

test("PREFLIGHT proves dependencies and refuses a half-apply", () => {
  assert.ok(!/^\s*(insert|update|delete|create|drop|alter|grant|revoke)\b/im.test(PRE), "PREFLIGHT writes nothing");
  for (const dep of ["auth.users", "is_owner", "is_staff", "gen_random_uuid"]) {
    assert.ok(PRE.includes(dep), `${dep} is verified`);
  }
  assert.ok(/BLOCKER/.test(PRE), "a missing hard dependency is a BLOCKER");
  assert.ok(/OPTIONAL/.test(PRE), "optional dependencies are named as such");
  assert.ok(/emp_has_permission/.test(PRE), "the permission resolver is checked as optional");
  // The honest consequence of the optional dependency is stated.
  assert.ok(/المالك/.test(PRE), "PREFLIGHT says who can use the module without the permission package");
});

test("ROLLBACK is emergency-only, commented out, and honest about destroying history", () => {
  assert.ok(/للطوارئ وحدها/.test(BACK));
  // Every destructive statement must be commented out.
  const live = BACK.split("\n").filter((l) => /^\s*(drop|delete|truncate)\b/i.test(l));
  assert.deepEqual(live, [], `no live destructive statement, found: ${live.join(" | ")}`);
  for (const t of ["cs_versions", "cs_permissions", "cs_credits", "cs_audit"]) {
    assert.ok(BACK.includes(t), `${t} loss is described`);
  }
  assert.ok(/سجلّ موافقة طرف ثالث/.test(BACK), "it says the permission log is third-party consent evidence");
  assert.ok(/لا يلمس منصّة المشاريع/.test(BACK), "and that it does not touch the frozen platform");
});

test("the package touches no other module's objects", () => {
  const sqlLines = RUNME.split("\n").filter((l) => !l.trim().startsWith("--"));
  for (const foreign of ["tvn_documents", "hr_employee_documents", "_bak_tvn_documents",
                         "public.projects", "project_core", "deliverables"]) {
    // Reading, joining, inserting into or referencing another module's table is the ban.
    // Naming it inside a self-test that PROVES the absence is the opposite of a violation.
    const hits = sqlLines.filter((l) =>
      new RegExp(`(from|join|into|update|references)\\s+(public\\.)?${foreign.replace("public.", "")}\\b`, "i").test(l));
    assert.deepEqual(hits, [], `${foreign} is never read or referenced, found: ${hits.join(" | ")}`);
  }
  // and it never widens an existing role
  assert.ok(!/grant .* to service_role/i.test(RUNME));
  assert.ok(!/can_manage_projects|is_kian_member/.test(RUNME));
});

test("the six required documents exist and are wired to reality", () => {
  const docs = {
    "docs/CASE_STUDIES_ROLE_MATRIX.md": ["can_publish_case_studies", "case_study.review"],
    "docs/CASE_STUDIES_EDITORIAL_WORKFLOW.md": ["cs_submit", "cs_publish_blockers"],
    "docs/CASE_STUDIES_GO_LIVE.md": ["PREFLIGHT", "POSTCHECK", "public_enabled"],
    "docs/CASE_STUDIES_ACCEPTANCE.md": ["named_without_permission", "sitemap"],
    "docs/CASE_STUDY_CONFIDENTIALITY_CONTRACT.md": ["cs_mask", "embargo_until"],
    "docs/PUBLIC_MEDIA_SECURITY_CONTRACT.md": ["cs_media_no_private_source", "virus_scan_provider"],
  };
  for (const [file, needles] of Object.entries(docs)) {
    const body = R(file);
    assert.ok(body.length > 1200, `${file} is substantive`);
    for (const n of needles) assert.ok(body.includes(n), `${file} mentions ${n}`);
  }
});
