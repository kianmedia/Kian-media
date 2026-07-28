// tests/org_admin_migration.test.js — org_admin (مسؤول إداري) — INERT PACKAGE
//
// Production census made this the simplest possible migration: owner_count=2,
// super_admin_count=0, so NO existing row is touched and there is no backfill.
//
// The name is the whole safety story. ViewRole = "admin" | "client" | "lead" | StaffRole,
// and a TypeScript union is a SET — adding "admin" to StaffRole adds NO member, so
// roles.ts:46 (isOwner = view === "admin" || …) would evaluate TRUE, granting ten
// owner-grade flags, while Record<ViewRole,…> in nav.ts still compiles. "org_admin"
// genuinely widens the union, so the build BREAKS until a tab set is assigned.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(root, p), "utf8");
const SQL = R("docs/org_admin_migration_RUNME.sql");
const RB = R("docs/org_admin_migration_ROLLBACK.sql");
const TYPES = R("lib/portal/types.ts");
const ROLES = R("lib/portal/roles.ts");
const NAV = R("components/portal/nav.ts");
const strip = (s) => s.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const sql = strip(SQL), rb = strip(RB);

// ─── the name ───────────────────────────────────────────────────────────────
test("org_admin the forbidden name is nowhere near StaffRole", () => {
  const u = TYPES.slice(TYPES.indexOf("export type StaffRole ="), TYPES.indexOf(";", TYPES.indexOf("export type StaffRole =")));
  assert.match(u, /"org_admin"/);
  assert.ok(!/\|\s*"admin"/.test(u), "'admin' in StaffRole collapses ViewRole and grants owner UI silently");
});

test("org_admin is NOT treated as owner or admin-area in caps()", () => {
  const c = ROLES.slice(ROLES.indexOf("export function caps("), ROLES.indexOf("export function caps(") + 900);
  assert.match(c, /const isOwner = view === "admin" \|\| view === "super_admin";/);
  assert.ok(!/isOwner = [^;]*org_admin/.test(c), "it must not inherit owner flags");
  assert.ok(!/isAdminArea = [^;]*org_admin/.test(c));
});

test("org_admin has an explicit, minimal nav set — the union guard fired", () => {
  assert.match(NAV, /org_admin:\s*\[/, "Record<ViewRole,…> forces this key to exist");
  const set = NAV.slice(NAV.indexOf("org_admin:"), NAV.indexOf("]", NAV.indexOf("org_admin:")));
  for (const forbidden of ["accounts", "staff", "invoices", "project_core", "whatsapp"]) {
    assert.ok(!set.includes(`"${forbidden}"`), `day one must not include '${forbidden}'`);
  }
  assert.ok(set.includes('"profile"') && set.includes('"notifications"'), "minimum viable set");
});

test("org_admin is not selectable until the flag is on", () => {
  assert.match(ROLES, /ORG_ADMIN_ROLE_ENABLED/);
  assert.match(ROLES, /\?\?\s*"false"/, "default OFF");
  assert.match(ROLES, /ORG_ADMIN_ROLE_ENABLED \? \(\["org_admin"\] as StaffRole\[\]\) : \[\]/,
    "so shipping code before the SQL cannot offer a value the CHECK rejects");
});

test("org_admin has a bilingual label distinct from the owner's", () => {
  assert.match(ROLES, /org_admin:\s*\{ ar: "مسؤول إداري", en: "Org Admin" \}/);
});

// ─── the SQL creates nobody and grants nothing ──────────────────────────────
test("org_admin SQL widens the constraint without dropping any existing value", () => {
  const c = sql.slice(sql.indexOf("add constraint profiles_staff_role_check"));
  for (const r of ["super_admin", "manager", "support", "editor", "sales", "hr", "readonly",
                   "finance", "photographer", "lighting_tech", "camera_assistant", "custody_officer"]) {
    assert.ok(c.includes(`'${r}'`), `dropping '${r}' would invalidate existing rows: ${r}`);
  }
  assert.ok(c.includes("'org_admin'"));
});

test("org_admin SQL creates no account and asserts it created none", () => {
  assert.ok(!/insert into public\.profiles|update public\.profiles set staff_role/i.test(sql),
    "no account may be created or converted");
  assert.match(sql, /count\(\*\) into v_n from public\.profiles where staff_role = 'org_admin'/);
  assert.match(sql, /v_n <> 0 then\s*\n?\s*raise exception/, "and it must fail if any exists");
});

test("org_admin SQL proves no existing row moved", () => {
  assert.match(sql, /v_n <> 2 then raise exception 'فشل: عدد المُلّاك/, "owner count must still be 2");
  assert.match(sql, /v_n <> 0 then raise exception 'فشل: ظهر super_admin/, "super_admin must still be 0");
});

test("org_admin is not owner, not super_admin, cannot change security settings", () => {
  // The check spans a variable assignment then an if — match the two anchors separately
  // rather than assuming they are adjacent.
  assert.match(sql, /v_def := pg_get_functiondef\(to_regprocedure\('public\.is_owner\(\)'\)\)/,
    "is_owner() must be read back");
  assert.match(sql, /v_def ilike '%org_admin%' then[\s\S]{0,140}?raise exception/,
    "and proven not to include org_admin");
  assert.match(sql, /is_super_admin\(\)'\)\) ilike '%org_admin%'/);
  assert.match(sql, /can_change_security_settings\(\)'\)\) ilike '%org_admin%'/);
});

test("org_admin new predicates always return a real boolean", () => {
  for (const f of ["is_super_admin", "is_org_admin", "is_privileged_admin", "can_change_security_settings"]) {
    const at = sql.indexOf(`function public.${f}()`);
    assert.ok(at > 0, `${f} must exist`);
    const body = sql.slice(at, sql.indexOf("$$;", at));
    assert.match(body, /coalesce\(/, `${f} must not be able to return NULL`);
    assert.match(body, /security definer set search_path = public/, `${f} must pin search_path`);
  }
});

test("org_admin can_change_security_settings is the TRUE owner only", () => {
  const at = sql.indexOf("function public.can_change_security_settings()");
  const body = sql.slice(at, sql.indexOf("$$;", at));
  assert.match(body, /account_type = 'admin'/);
  assert.ok(!/is_owner\(\)|super_admin/.test(body),
    "is_owner() includes super_admin, which is wider than the owner intended here");
});

test("org_admin touches no read gate and no policy", () => {
  for (const g of ["is_owner", "is_admin", "can_manage_projects", "can_manage_staff"]) {
    assert.ok(!new RegExp(`create or replace function public\\.${g}\\b`).test(sql), `${g} redefined`);
  }
  assert.ok(!/create policy|alter policy|drop policy/i.test(sql));
});

// ─── rollback is narrower than the migration ────────────────────────────────
test("org_admin rollback refuses to run while anyone holds the role", () => {
  assert.match(rb, /count\(\*\) into v_n from public\.profiles where staff_role = 'org_admin'/);
  assert.match(rb, /v_n > 0 then\s*\n?\s*raise exception 'تراجُع مرفوض/,
    "narrowing the constraint under a live row would invalidate it and break every later update");
});

test("org_admin rollback deliberately leaves the new predicates", () => {
  assert.ok(!/drop function/i.test(rb), "nothing calls them; dropping is riskier than keeping");
  assert.match(RB, /أخطر من إبقائها|riskier/);
});
