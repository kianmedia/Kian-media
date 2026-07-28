// tests/authz_identity_s4pre.test.js — S4-PRE · IDENTITY-MANAGEMENT AUTHORIZATION
//
// Two audit claims were checked before writing anything. One was wrong.
//
//  ✗ "admin_set_staff_role lets a manager change roles" — FALSE. It gates on
//    can_manage_staff() = coalesce(is_owner(), false). Owner-only, correctly
//    coalesced. Nothing was "fixed" there.
//  ✓ It does contain a DIFFERENT real hole: 'super_admin' is in its allow-list and
//    the protected-account check inspects the TARGET's current status, never the
//    role being GRANTED. So an owner can mint a brand-new owner-level account.
//  ✓ The permission RPCs really do accept can_manage_projects(), which includes
//    staff_role='manager'.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(root, p), "utf8");
const SQL = R("docs/authz_identity_hardening_s4pre_RUNME.sql");
const code = SQL.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

test("S4pre identity management is separated from project management", () => {
  assert.match(code, /function public\.can_manage_identity\(\)/);
  assert.match(code, /coalesce\(public\.is_owner\(\), false\)/, "NULL must not read as permission");
  // Scope to the DEFINITION. The self-check block below legitimately mentions both
  // names (it greps the function body for the forbidden one), and a file-wide search
  // would match that guard rather than the code it guards.
  const at = code.indexOf("function public.can_manage_identity()");
  const def = code.slice(at, code.indexOf("$$;", at));
  assert.ok(!/can_manage_projects/.test(def),
    "accepting can_manage_projects is the bug being fixed - it includes staff_role='manager'");
});

test("S4pre the self-check proves the separation rather than asserting it", () => {
  assert.match(code, /pg_get_functiondef\(to_regprocedure\('public\.can_manage_identity\(\)'\)\) ilike '%can_manage_projects%'/);
  assert.match(code, /raise exception 'فشل: can_manage_identity تقبل can_manage_projects/);
});

test("S4pre granting super_admin is restricted to the TRUE owner", () => {
  const g = code.slice(code.indexOf("function public.assert_can_grant_role"));
  assert.match(g, /coalesce\(p_role, ''\) = 'super_admin'/, "the GRANTED role must be inspected");
  assert.match(g, /account_type = 'admin' and account_status = 'active'/,
    "only the hardcoded owner account may create another owner-level account");
  assert.match(g, /authorization_denied/);
});

test("S4pre self-elevation is refused", () => {
  const g = code.slice(code.indexOf("function public.assert_can_grant_role"));
  assert.match(g, /p_target = auth\.uid\(\)/);
});

test("S4pre denials use a SQLSTATE, not message text", () => {
  assert.match(code, /errcode = 'P0003'/);
  assert.equal((code.match(/errcode = 'P0003'/g) ?? []).length, 3, "every denial path carries it");
});

test("S4pre changes no read gate, no policy, nothing destructive", () => {
  for (const g of ["is_admin", "is_owner", "can_manage_projects", "can_manage_staff", "is_staff"]) {
    assert.ok(!new RegExp(`create or replace function public\\.${g}\\b`, "i").test(code),
      `${g} must not be redefined`);
  }
  assert.ok(!/create policy|alter policy|drop policy/i.test(code));
  assert.ok(!/\bdrop\s|\bdelete\s+from\b|\btruncate\b/i.test(code));
});

test("S4pre binds nothing yet - the target functions are untouched", () => {
  assert.ok(!/create or replace function public\.admin_/i.test(code),
    "rebinding happens in the next file, after the owner reviews the list");
});

test("S4pre records the audit claim it DISPROVED", () => {
  assert.match(SQL, /غير صحيح|FALSE/i);
  assert.match(SQL, /can_manage_staff\(\)/, "the real gate on admin_set_staff_role must be named");
});

test("S4pre states the schema limit instead of inventing a third tier", () => {
  assert.match(SQL, /لا يعرف ثلاثًا|does not know three/i);
  assert.match(SQL, /phase1_addendum_s1\.sql:152-157/, "the two-email restriction must be cited");
  assert.ok(!/alter table public\.profiles add column/i.test(code),
    "adding a role column is a schema decision for the owner, not an assumption");
});

test("S4pre every SECURITY DEFINER pins search_path", () => {
  const d = (code.match(/security definer/gi) ?? []).length;
  const p = (code.match(/security definer set search_path = public/gi) ?? []).length;
  assert.equal(p, d, `all ${d} definer functions must pin search_path`);
});
