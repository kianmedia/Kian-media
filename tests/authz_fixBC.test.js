// tests/authz_fixBC.test.js — FIX B (identity vs projects) and FIX C (NULL fail-open)
//
// FIX B: seven SECURITY DEFINER write RPCs accepted can_manage_projects(), which
// includes staff_role='manager'. So any project manager could rewrite any employee's
// permissions AND assign themselves a profession loaded with sensitive ones - a
// permanent self-escalation with nothing to do with managing projects.
//
// FIX C: six predicates could return NULL. Consumed by `if not <pred> then raise`,
// NULL means the IF is never TRUE, the exception never fires, and the SECURITY DEFINER
// body runs on - bypassing RLS. That is the exact shape of the incident that let an
// unauthenticated caller read company data.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(root, p), "utf8");
const B = R("docs/authz_fixB_identity_permissions_RUNME.sql");
const BR = R("docs/authz_fixB_identity_permissions_ROLLBACK.sql");
const C = R("docs/authz_fixC_null_failopen_gates_RUNME.sql");
const CR = R("docs/authz_fixC_null_failopen_gates_ROLLBACK.sql");
const nc = (s) => s.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const b = nc(B), c = nc(C), br = nc(BR), cr = nc(CR);

// ─── FIX B ──────────────────────────────────────────────────────────────────
test("FixB every identity-write RPC drops can_manage_projects", () => {
  for (const fn of ["admin_set_employee_professions", "admin_set_profession_permission",
                    "admin_set_employee_override", "admin_copy_profession_permissions",
                    "admin_apply_profession_template", "admin_upsert_profession",
                    "admin_delete_profession"]) {
    const at = b.indexOf(`function public.${fn}`);
    assert.ok(at > 0, `${fn} must be rebuilt`);
    const body = b.slice(at, b.indexOf("$$;", at));
    assert.ok(!/can_manage_projects/.test(body), `${fn} still accepts can_manage_projects`);
    assert.match(body, /can_manage_identity\(\), false\)/, `${fn} must gate on identity authority`);
  }
});

test("FixB the gate result is coalesced - NULL must not read as permission", () => {
  const gates = b.match(/if not coalesce\(public\.can_manage_identity\(\), false\)/g) ?? [];
  assert.ok(gates.length >= 7, `expected >=7 coalesced gates, found ${gates.length}`);
});

test("FixB denials carry a code, not prose", () => {
  assert.ok((b.match(/errcode = 'P0003'/g) ?? []).length >= 7);
  assert.match(b, /authorization_denied/);
});

test("FixB keeps the sensitive-key owner restriction it did not come to change", () => {
  assert.match(b, /sensitivity/, "sensitive-permission handling must survive");
  assert.match(b, /is_owner\(\)/, "the existing sensitive-key owner filter stays");
});

test("FixB the bulk wrapper is deliberately untouched and still inherits", () => {
  assert.ok(!/create or replace function public\.admin_bulk_set_profession_permissions/.test(b),
    "it has no auth condition of its own; its body only calls the inner function");
  assert.match(B, /admin_bulk_set_profession_permissions/, "but the decision must be documented");
});

test("FixB changes no signature, grant, policy or read gate", () => {
  assert.ok(!/^\s*(grant|revoke)/mi.test(b), "create or replace preserves privileges");
  assert.ok(!/create policy|alter policy|drop policy/i.test(b));
  for (const g of ["is_owner", "is_admin", "can_manage_projects", "can_manage_staff"]) {
    assert.ok(!new RegExp(`create or replace function public\\.${g}\\b`).test(b), `${g} redefined`);
  }
});

test("FixB has no TOP-LEVEL destructive statement", () => {
  // DELETEs exist inside function bodies (replacing an assignment set, clearing an
  // override, the safe delete of an unassigned profession) - all original behaviour.
  // A top-level statement starts at column 0. Indented ones are inside a function body,
  // where these DELETEs are original behaviour faithfully reproduced.
  for (const line of b.split("\n")) {
    if (/^(drop|delete|truncate)\s/i.test(line)) assert.fail(`top-level destructive: ${line}`);
  }
});

test("FixB rollback restores the pre-fix authorization and says what it costs", () => {
  assert.match(br, /can_manage_projects/, "rollback must restore the original condition");
  assert.match(BR, /manager|مدير/i, "and state that managers regain permission-writing");
});

// ─── FIX C ──────────────────────────────────────────────────────────────────
test("FixC all six predicates are made NULL-proof", () => {
  for (const fn of ["can_manage_hr", "can_see_invoices", "can_see_opportunities",
                    "can_manage_quotes", "can_manage_custody", "civ_can_manage"]) {
    const at = c.indexOf(`function public.${fn}`);
    assert.ok(at > 0, `${fn} must be rebuilt`);
    const body = c.slice(at, c.indexOf("$$;", at));
    assert.match(body, /coalesce\(/, `${fn} can still return NULL`);
    assert.match(body, /security definer set search_path = public/, `${fn} must pin search_path`);
  }
});

test("FixC does NOT revoke anon EXECUTE - the conservative call", () => {
  assert.ok(!/revoke .* from anon/i.test(c),
    "three of the six are anon-executable; a blind REVOKE could break the public " +
      "quote-request flow, so the fix returns a real false instead of removing access");
});

test("FixC widens nobody's permissions", () => {
  assert.ok(!/create policy|alter policy|drop policy/i.test(c), "no RLS change");
  for (const g of ["is_owner", "is_admin", "can_manage_projects"]) {
    assert.ok(!new RegExp(`create or replace function public\\.${g}\\b`).test(c), `${g} redefined`);
  }
  for (const line of c.split("\n")) {
    if (/^(drop|delete|truncate)\s/i.test(line)) assert.fail(`top-level destructive: ${line}`);
  }
});

test("FixC rollback exists and restores the NULL-capable bodies", () => {
  for (const fn of ["can_manage_hr", "civ_can_manage"]) {
    assert.ok(cr.includes(fn), `rollback missing ${fn}`);
  }
  assert.match(CR, /fail-open|فشل مفتوح|NULL/i, "the cost of rolling back must be stated");
});

// ─── my own corrected citation ──────────────────────────────────────────────
test("s4pre header records that my original citation was wrong", () => {
  const s4 = R("docs/authz_identity_hardening_s4pre_RUNME.sql");
  assert.match(s4, /تصحيح لاستشهادي أنا/, "the wrong file:line must be corrected in place");
  // The phrase spans a line break and a comment prefix - [\s\S] is required.
  assert.match(s4, /قراءة[\s\S]{0,40}?لا كتابة/,
    "emp_has_permission and emp_can are READ functions, not the write sites");
  assert.match(s4, /emp_has_permission/, "the misattributed functions must be named");
});
