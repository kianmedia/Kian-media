// ════════════════════════════════════════════════════════════════════════════
// tests/mfa_write_gate_s4a.test.js — P2 · S4a · THE GATE PREDICATE (UNAPPLIED)
//
// S4a ships the predicate INERT. Nothing calls it, so running the SQL changes no
// behaviour. Binding it to the sensitive functions is S4b, because each target needs
// a full create-or-replace of its body and a copy error there breaks user management.
//
// Two audit findings this file encodes:
//   1. admin_set_staff_role has FOUR competing definitions. Gating the stale one would
//      be a no-op that looks finished.
//   2. mfa_admin_set_mode must NEVER be gated — requiring aal2 to change the MFA mode
//      puts the emergency lever behind the very gate it exists to release.
// ════════════════════════════════════════════════════════════════════════════
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(root, p), "utf8");
const SQL = R("docs/mfa_write_gate_s4a_RUNME.sql");
const code = SQL.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const fn = code.slice(code.indexOf("function public.mfa_write_ok"), code.indexOf("$$;", code.indexOf("mfa_write_ok")));

// ─── ordering IS the safety property ────────────────────────────────────────

test("S4a service_role is checked FIRST — cron carries no aal claim", () => {
  const svc = fn.indexOf("'service_role'");
  assert.ok(svc > 0, "the bypass must exist");
  for (const later of ["enforcement_mode", "account_type", "mfa_factors", "'aal'"]) {
    assert.ok(fn.indexOf(later) > svc,
      `${later} must be checked AFTER service_role, or the nightly crons die silently at 03:00`);
  }
});

test("S4a the kill switch outranks every other condition", () => {
  const mode = fn.indexOf("<> 'enrollment'");
  assert.ok(mode > 0);
  assert.ok(fn.indexOf("account_type") > mode, "role is checked after the mode");
  assert.ok(fn.indexOf("'aal2'") > mode, "assurance is checked after the mode");
});

test("S4a only owner/super_admin/admin are in scope", () => {
  assert.match(fn, /coalesce\(v_acct, ''\) = 'admin' or coalesce\(v_staff, ''\) = 'super_admin'/);
  assert.ok(!/'manager'|'custody_officer'|'finance'/.test(fn),
    "employees are out of scope by the owner's standing decision");
});

test("S4a a user with no verified factor is never blocked", () => {
  assert.match(fn, /if not coalesce\(v_has, false\) then return true; end if/,
    "the anti-lockout invariant: only a factor you personally hold can challenge you");
  assert.ok(fn.indexOf("v_has") < fn.indexOf("'aal2'"), "checked before aal2 is demanded");
});

// ─── unknown must mean ALLOW, which inverts the usual rule ──────────────────

test("S4a every failure path returns true, and none can return NULL", () => {
  const handlers = fn.match(/exception when others then[^;]*;/g) ?? [];
  assert.ok(handlers.length >= 4, `each read must be isolated; found ${handlers.length}`);
  for (const h of handlers) {
    // Two legitimate shapes: assign a safe local (the claim parsers), or return true
    // (the control-flow handlers). What must never appear is a path that denies.
    const assignsLocal = /:=\s*(null|'off'|false)/.test(h);
    const allows = /return true/.test(h);
    assert.ok(assignsLocal || allows,
      `a failure path must allow or set a safe default, never deny: ${h.trim().slice(0, 60)}`);
    assert.ok(!/return false/.test(h), `no handler may deny on error: ${h.trim().slice(0, 60)}`);
  }
  assert.ok(!/coalesce\([^)]*, false\)\s*;?\s*$/m.test(fn.slice(fn.lastIndexOf("exception when others"))),
    "the terminal handler must not coalesce to false");
});

test("S4a the inverted default is explained, so it is not 'corrected' later", () => {
  assert.match(SQL, /عكس الغريزة المعتادة|inverted/i);
  assert.match(SQL, /قادرة على الإقفال|lock/i);
});

test("S4a the self-check proves it allows rather than raises with no session", () => {
  assert.match(code, /if v is not true then[\s\S]{0,140}?raise exception/);
  assert.match(code, /if v is null then raise exception/);
});

// ─── it is genuinely inert ──────────────────────────────────────────────────

test("S4a binds no function — that is S4b", () => {
  assert.ok(!/create or replace function public\.admin_/i.test(code),
    "no business function may be redefined here");
  assert.match(code, /pg_get_functiondef\(p\.oid\) ilike '%mfa_require_aal2%'/,
    "and the file self-checks that it bound nothing");
});

test("S4a touches no read gate and no policy", () => {
  for (const g of ["is_admin", "is_owner", "is_staff", "can_manage_projects", "can_manage_staff"]) {
    assert.ok(!new RegExp(`create or replace function public\\.${g}\\b`, "i").test(code),
      `${g} anchors RLS SELECT policies — redefining it blanks the owner's screen`);
  }
  assert.ok(!/create policy|alter policy|drop policy/i.test(code));
  assert.ok(!/\bdrop\s+(function|table)\b/i.test(code));
});

// ─── the error must be machine-readable ─────────────────────────────────────

test("S4a mfa_required is raised with a SQLSTATE, not matched by message text", () => {
  assert.match(code, /raise exception 'mfa_required' using errcode = 'P0002'/,
    "message matching breaks under translation; the code is stable");
});

test("S4a a failed audit write cannot flip the denial into an allow", () => {
  const req = code.slice(code.indexOf("function public.mfa_require_aal2"));
  const auditIdx = req.indexOf("mfa_audit");
  const raiseIdx = req.indexOf("raise exception 'mfa_required'");
  assert.ok(auditIdx < raiseIdx, "audit first, then deny");
  assert.match(req, /exception when others then null;\s*--[^\n]*تدقيق|exception when others then null/);
});

// ─── the two audit findings ─────────────────────────────────────────────────

test("S4a records that admin_set_staff_role has a superseded decoy definition", () => {
  assert.match(SQL, /portal_custody_v2_claims_photos_roles_PATCH_RUNME\.sql:39/,
    "the WINNING definition must be named");
  assert.match(SQL, /staff_roles_task_assignment_RUNME\.sql:172/, "and the stale one flagged");
  assert.match(SQL, /roles\.ts:100-102/, "with the live corroboration that settles which wins");
});

test("S4a records that mfa_admin_set_mode must never be gated", () => {
  assert.match(SQL, /mfa_admin_set_mode/);
  assert.match(SQL, /زرّ الطوارئ نفسه خلف البوّابة|emergency lever/i,
    "gating it would put the escape hatch behind the lock it releases");
});
