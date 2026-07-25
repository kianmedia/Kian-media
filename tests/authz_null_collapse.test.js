// ════════════════════════════════════════════════════════════════════════════
// tests/authz_null_collapse.test.js — PROJECT PLATFORM AUTHZ HARDENING
//
// PROVEN LIVE ON PRODUCTION (unauthenticated, public anon key only):
//   rpc/can_manage_projects      → null      (should be false)
//   rpc/can_see_financials       → null
//   rpc/staff_reads_all_projects → null
//   rpc/company_execution_report → 200 with REAL company data
//       {"health_distribution":{"healthy":20},"total_overdue_tasks":2,
//        "bottleneck_by_status":{"todo":41,"in_progress":2,"internal_review":1}}
//
// ROOT CAUSE: staff_role() returns NULL when auth.uid() is NULL, so
//   can_manage_projects() = is_owner() OR (NULL in ('manager')) = false OR NULL = NULL
// and in plpgsql `if not NULL then raise 'not authorized'` NEVER fires — every gate
// written that way is dead code, and SECURITY DEFINER bodies bypass RLS on top.
// Compounded by PostgreSQL granting EXECUTE to PUBLIC by default where a file granted
// to `authenticated` without revoking.
//
// This test pins the SQL remedy so the defect cannot silently return.
// Static only — no DB, no network.
// ════════════════════════════════════════════════════════════════════════════
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(root, p), "utf8");

const FIX = R("docs/project_platform_authz_hardening_RUNME.sql");

// ─── boolean semantics of the defect (why `if not X then raise` is dead code) ───
// SQL three-valued logic, faithfully modelled.
const TRUE = true, FALSE = false, NULL = null;
function or3(a, b) { if (a === TRUE || b === TRUE) return TRUE; if (a === NULL || b === NULL) return NULL; return FALSE; }
function in3(v, set) { return v === NULL ? NULL : set.includes(v); }
function not3(a) { return a === NULL ? NULL : !a; }
/** plpgsql: the guarded branch runs ONLY when the condition is exactly TRUE. */
const guardFires = (cond) => cond === TRUE;

test("AUTHZ: the unpatched gate is dead code for an unauthenticated caller", () => {
  const isOwner = FALSE;               // is_owner() correctly returns false
  const staffRole = NULL;              // staff_role() → NULL (auth.uid() is NULL)
  const canManage = or3(isOwner, in3(staffRole, ["manager"]));
  assert.equal(canManage, NULL, "reproduces the observed rpc/can_manage_projects → null");
  assert.equal(guardFires(not3(canManage)), false, "`if not NULL then raise` NEVER fires ⇒ the guard is bypassed");
});

test("AUTHZ: coalesce(...,false) makes the gate fire, and only in the NULL case", () => {
  const co = (v) => (v === NULL ? FALSE : v);
  // unauthenticated → now denied
  assert.equal(guardFires(not3(co(NULL))), true, "unauthenticated is now rejected");
  // authenticated semantics are untouched
  assert.equal(co(TRUE), TRUE, "an authorized user stays authorized");
  assert.equal(guardFires(not3(co(TRUE))), false, "…and is still not rejected");
  assert.equal(co(FALSE), FALSE, "an explicitly-denied user stays denied");
});

// ─── the remedy file must actually contain the fix ───
test("AUTHZ fix: every NULL-collapsing boolean helper is wrapped in coalesce", () => {
  for (const fn of ["can_manage_projects", "can_see_financials", "can_support",
                    "staff_reads_all_projects", "can_final_deliver", "can_manage_staff", "can_edit_project"]) {
    const i = FIX.indexOf(`function public.${fn}(`);
    assert.ok(i > -1, `${fn} is redefined`);
    const body = FIX.slice(i, i + 500);
    assert.ok(/coalesce\(/.test(body), `${fn} body is coalesce-guarded`);
  }
});

test("AUTHZ fix: staff_role() is deliberately NOT changed (NULL there means 'no role')", () => {
  assert.ok(!/create or replace function public\.staff_role\(/.test(FIX),
    "redefining staff_role would change a correct semantic");
});

test("AUTHZ fix: anon EXECUTE is revoked from the data-returning RPCs", () => {
  assert.ok(/revoke all on function %s from public/.test(FIX), "revokes the default PUBLIC grant");
  assert.ok(/from anon/.test(FIX), "revokes anon explicitly");
  assert.ok(/grant execute on function %s to authenticated/.test(FIX), "real users keep access");
  for (const fn of ["company_execution_report", "team_execution_report", "project_execution_dashboard",
                    "project_stage_advance", "pc_task_assign", "admin_grant_client_project_access"]) {
    assert.ok(FIX.includes(`'${fn}'`), `${fn} is locked down`);
  }
});

test("AUTHZ fix: signatures are resolved from pg_proc, never hardcoded (overload-safe)", () => {
  assert.ok(/from pg_proc p join pg_namespace n/.test(FIX), "iterates the catalog");
  assert.ok(/oid::regprocedure/.test(FIX), "uses the real signature, so overloads cannot be missed");
});

test("AUTHZ fix: gate helpers themselves are NOT revoked (they are used inside RLS policies)", () => {
  const revokeBlock = FIX.slice(FIX.indexOf("v_names text[]"), FIX.indexOf("r record;"));
  for (const helper of ["can_manage_projects", "can_see_financials", "staff_reads_all_projects", "is_staff", "is_owner"]) {
    assert.ok(!revokeBlock.includes(`'${helper}'`), `${helper} must keep EXECUTE — revoking it could break RLS evaluation`);
  }
});

test("AUTHZ fix: additive and safe (no DROP/DELETE, self-tested, re-runnable)", () => {
  const code = FIX.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  assert.ok(!/\bdrop\s+(table|function|policy)\b/i.test(code), "no DROP");
  assert.ok(!/\bdelete\s+from\b/i.test(code) && !/\btruncate\b/i.test(code), "no data deletion");
  assert.ok(/AUTHZ FAIL/.test(FIX), "raises on self-test failure");
  assert.ok(/AUTHZ SELF-TEST PASSED/.test(FIX), "confirms success");
  assert.ok(/create or replace function/.test(FIX), "re-runnable definitions");
});

test("AUTHZ fix: self-test asserts both no-NULL and not-true-when-unauthenticated", () => {
  assert.ok(/is null then raise exception 'AUTHZ FAIL/.test(FIX), "rejects any surviving NULL gate");
  assert.ok(/is true then raise exception 'AUTHZ FAIL: unauthenticated/.test(FIX), "rejects a gate that would open up");
  assert.ok(/has_function_privilege\('anon'/.test(FIX), "verifies anon can no longer execute");
});

test("AUTHZ safety: static only (no DB/network)", () => {
  const self = R("tests/authz_null_collapse.test.js");
  const reqs = [...self.matchAll(/require\(["']([^"']+)["']\)/g)].map((m) => m[1]);
  for (const r of reqs) assert.ok(["node:test", "node:assert", "node:fs", "node:path"].includes(r), `static (got ${r})`);
});
