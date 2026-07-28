// tests/authz_fixA_super_admin.test.js — FIX A · UNBOUNDED SUPER_ADMIN CREATION
//
// The hole: admin_set_staff_role checks the TARGET's current status ("protected owner
// account") but never the role being GRANTED, and 'super_admin' is in its allow-list.
// Since is_owner() = is_admin() OR staff_role='super_admin', any super_admin could
// promote an ordinary employee to full owner-level, without limit.
//
// The winning definition is portal_custody_v2_claims_photos_roles_PATCH_RUNME.sql:39,
// NOT the file named after the feature - which is four months stale. Fixing the stale
// one would have looked done and changed nothing.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(root, p), "utf8");
const FIX = R("docs/authz_fixA_super_admin_grant_RUNME.sql");
const RB = R("docs/authz_fixA_super_admin_grant_ROLLBACK.sql");
const P1 = R("docs/PREFLIGHT_P1_role_census.sql");
const strip = (s) => s.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const fix = strip(FIX), rb = strip(RB), p1 = strip(P1);

test("FixA the GRANTED role is checked, not just the target's status", () => {
  assert.match(fix, /p_role = 'super_admin' and not exists/);
  assert.match(fix, /id = auth\.uid\(\) and account_type = 'admin' and account_status = 'active'/,
    "only the true owner account may create owner-level");
  assert.match(fix, /role_change_denied/);
  assert.match(fix, /errcode = 'P0003'/, "a code, not message text");
});

test("FixA rebuilds the WINNING definition, and says why it wins", () => {
  assert.match(FIX, /portal_custody_v2_claims_photos_roles_PATCH_RUNME\.sql:39-57/);
  assert.match(FIX, /staff_roles_task_assignment_RUNME\.sql:172/, "the stale decoy must be named");
  assert.match(FIX, /roles\.ts:100-102/, "with the live corroboration");
});

test("FixA drops NO original condition", () => {
  for (const c of ["can_manage_staff()", "cannot change your own staff role",
                   "protected owner account", "custody_officer", "get diagnostics"]) {
    assert.ok(fix.includes(c), `original condition lost: ${c}`);
  }
});

test("FixA self-check proves each original condition survived", () => {
  for (const c of ["can_manage_staff", "cannot change your own staff role",
                   "protected owner account", "custody_officer"]) {
    assert.ok(fix.includes(`v_def not like '%${c}%'`), `no survival check for: ${c}`);
  }
});

test("FixA changes no signature, grants, gate or policy", () => {
  assert.match(fix, /revoke execute on function public\.admin_set_staff_role\(uuid,text\) from public, anon/);
  assert.match(fix, /grant  execute on function public\.admin_set_staff_role\(uuid,text\) to authenticated/);
  for (const g of ["is_owner", "is_admin", "can_manage_staff", "can_manage_projects"]) {
    assert.ok(!new RegExp(`create or replace function public\\.${g}\\b`).test(fix));
  }
  assert.ok(!/create policy|alter policy|org_admin|mfa_/i.test(fix),
    "no policy change, no org_admin creation, no MFA binding");
});

test("FixA rollback restores the pre-fix body verbatim and warns", () => {
  assert.match(rb, /create or replace function public\.admin_set_staff_role/);
  assert.ok(!/role_change_denied/.test(rb), "rollback must NOT retain the new check");
  for (const c of ["can_manage_staff()", "protected owner account", "custody_officer"]) {
    assert.ok(rb.includes(c), `rollback lost an original condition: ${c}`);
  }
  assert.match(RB, /يُعيد فتح الثغرة|reopen/i, "the cost of rolling back must be stated");
});

test("P1 preflight is strictly read-only", () => {
  assert.ok(!/\b(insert|update|delete|alter|drop|truncate|create)\b/i.test(p1),
    "a census must not be able to change anything");
  assert.ok((p1.match(/select/gi) ?? []).length >= 7, "all seven questions must be covered");
});

test("P1 masks identifying data", () => {
  assert.match(p1, /left\(coalesce\(email,'\?'\), 1\)/, "first letter plus domain only");
  assert.match(p1, /right\(id::text, 4\)/, "id tail only");
  assert.ok(!/select \*/i.test(p1), "never select everything from profiles");
});

test("P1 settles whether the six fail-open gates are live or latent", () => {
  for (const g of ["can_manage_hr", "can_see_invoices", "can_see_opportunities",
                   "can_manage_quotes", "can_manage_custody", "civ_can_manage"]) {
    assert.ok(p1.includes(g), `gate not censused: ${g}`);
  }
  assert.match(p1, /has_function_privilege\('anon'/, "anon reachability is what decides live vs latent");
});
