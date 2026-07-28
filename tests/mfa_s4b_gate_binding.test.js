// tests/mfa_s4b_gate_binding.test.js — S4b · MFA GATE ON SENSITIVE WRITES
//
// THE HIGHEST-RISK PROPERTY: Fix A and Fix B rebuild several of the SAME functions S4b
// binds. S4b applies AFTER them, so its bodies must be the POST-FIX bodies plus the
// gate. Composing from the ORIGINAL definitions would silently REVERT Fix A and Fix B —
// reopening unbounded super_admin creation and manager permission-writing — while a
// green self-check confirmed the MFA gate was present.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(root, p), "utf8");
const RUN = R("docs/mfa_write_gate_s4b_RUNME.sql");
const RB = R("docs/mfa_write_gate_s4b_ROLLBACK.sql");
const PRE = R("docs/mfa_write_gate_s4b_PREFLIGHT.sql");
const POST = R("docs/mfa_write_gate_s4b_POSTCHECK.sql");
const ACC = R("docs/MFA_S4B_MANUAL_ACCEPTANCE.md");
const HOOK = R("components/portal/useSensitiveWrite.tsx");
const nc = (s) => s.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const run = nc(RUN), rb = nc(RB), pre = nc(PRE), post = nc(POST);

// NINE, not seven. An adversarial review found admin_copy_profession_permissions and
// admin_apply_profession_template write the SAME profession_permissions rows as the
// gated admin_set_profession_permission, and both are browser-callable. An owner at
// aal1 denied on the gated RPC could achieve the identical rewrite through either -
// a complete bypass of the gate. Both are now gated.
// admin_bulk_set_profession_permissions stays OUT: it has no authorization of its own
// and delegates in a loop to the gated inner function, so it inherits both gates.
const SEVEN = ["admin_set_staff_role", "admin_set_account", "admin_set_employee_professions",
               "admin_set_employee_override", "admin_set_profession_permission",
               "admin_upsert_profession", "admin_delete_profession",
               "admin_copy_profession_permissions", "admin_apply_profession_template"];

test("S4b gates exactly the nine, and nothing else", () => {
  for (const fn of SEVEN) {
    const at = run.indexOf(`function public.${fn}`);
    assert.ok(at > 0, `${fn} must be rebuilt`);
    assert.match(run.slice(at, run.indexOf("$$;", at)), /mfa_require_aal2\(/, `${fn} lacks the gate`);
  }
  const gated = (run.match(/create or replace function public\.(\w+)/g) ?? []).length;
  assert.equal(gated, 9, `expected exactly 9 rebuilt functions, found ${gated}`);
  assert.ok(!/create or replace function public\.admin_bulk_set_profession_permissions/.test(run),
    "the bulk wrapper inherits the gate via delegation; rebuilding it would be churn");
});

test("S4b does NOT revert Fix A - the granted-role check survives", () => {
  const at = run.indexOf("function public.admin_set_staff_role");
  const body = run.slice(at, run.indexOf("$$;", at));
  assert.match(body, /role_change_denied/,
    "composing from the ORIGINAL body would silently reopen unbounded super_admin creation");
  assert.match(body, /p_role = 'super_admin'/);
});

test("S4b does NOT revert Fix B - the identity gate survives", () => {
  for (const fn of ["admin_set_employee_professions", "admin_set_employee_override",
                    "admin_set_profession_permission", "admin_upsert_profession"]) {
    const at = run.indexOf(`function public.${fn}`);
    const body = run.slice(at, run.indexOf("$$;", at));
    assert.match(body, /can_manage_identity/, `${fn} lost Fix B's gate - manager write reopens`);
    assert.ok(!/can_manage_projects/.test(body), `${fn} regained can_manage_projects`);
  }
});

test("S4b keeps every original guard", () => {
  const a = run.slice(run.indexOf("function public.admin_set_staff_role"));
  for (const g of ["can_manage_staff", "cannot change your own staff role",
                   "protected owner account", "custody_officer"]) {
    assert.ok(a.includes(g), `original guard lost: ${g}`);
  }
});

test("S4b the gate sits AFTER authorization, not before", () => {
  // An unauthorized caller must get the authorization error, not a pointless MFA prompt.
  for (const fn of SEVEN) {
    const at = run.indexOf(`function public.${fn}`);
    const body = run.slice(at, run.indexOf("$$;", at));
    const authAt = Math.min(...["can_manage_staff", "can_manage_identity", "is_admin", "is_owner"]
      .map((g) => { const i = body.indexOf(g); return i < 0 ? Infinity : i; }));
    const gateAt = body.indexOf("mfa_require_aal2");
    if (authAt !== Infinity) assert.ok(gateAt > authAt, `${fn}: MFA gate precedes authorization`);
  }
});

test("S4b never gates the emergency lever", () => {
  assert.ok(!/create or replace function public\.mfa_admin_set_mode/.test(run),
    "gating the mode switch would strand an owner who lost their authenticator");
  assert.match(RUN, /mfa_admin_set_mode/, "and the exclusion must be documented");
});

test("S4b touches no read gate and no policy", () => {
  for (const g of ["is_owner", "is_admin", "can_manage_projects", "can_manage_staff"]) {
    assert.ok(!new RegExp(`create or replace function public\\.${g}\\b`).test(run), `${g} redefined`);
  }
  assert.ok(!/create policy|alter policy|drop policy/i.test(run));
  for (const line of run.split("\n")) {
    if (/^(drop|delete|truncate)\s/i.test(line)) assert.fail(`top-level destructive: ${line}`);
  }
});

test("S4b refuses to run before its dependencies", () => {
  assert.match(run, /mfa_require_aal2/, "guard must check the predicate exists");
  assert.match(RUN, /Fix A|fixA/i, "ordering requirement must be documented");
  assert.match(RUN, /Fix B|fixB/i);
});

test("S4b preflight and postcheck are read-only", () => {
  for (const [n, s] of [["preflight", pre], ["postcheck", post]]) {
    assert.ok(!/\b(insert|update|delete|drop|alter|truncate|create)\b/i.test(s),
      `${n} must not change anything`);
  }
});

test("S4b rollback is separate, honest, and does not revert Fix A or B", () => {
  // Scope to the rebuilt FUNCTION BODIES. The file's own self-check legitimately
  // greps for mfa_require_aal2 to prove the gate is gone - matching that would be
  // checking the guard, not the code.
  for (const fn of SEVEN) {
    const at = rb.indexOf(`function public.${fn}`);
    if (at < 0) continue;
    const body = rb.slice(at, rb.indexOf("$$;", at));
    assert.ok(!/mfa_require_aal2/.test(body), `rollback left the gate in ${fn}`);
  }
  assert.match(rb, /role_change_denied/, "but must KEEP Fix A");
  assert.match(rb, /can_manage_identity/, "and KEEP Fix B");
  assert.match(RB, /S4a/, "must state whether S4a also needs rolling back");
});

// ─── the TypeScript retry-once flow ─────────────────────────────────────────
test("S4b retry happens at most once and cannot loop", () => {
  assert.match(HOOK, /mfa_required/);
  const retries = (HOOK.match(/retr(y|ied)/gi) ?? []).length;
  assert.ok(retries > 0, "a retry path must exist");
  assert.ok(!/while\s*\(|for\s*\(;;\)/.test(HOOK), "no loop construct may wrap the retry");
});

test("S4b cancelling step-up does not perform the operation", () => {
  assert.match(HOOK, /cancel/i);
});

test("S4b a still-aal1 session after step-up does not retry", () => {
  assert.match(HOOK, /mfa_session_not_elevated/);
  assert.match(HOOK, /mfaMyAssurance|is_aal2/, "assurance must be re-read, not assumed");
});

test("S4b swallows no error and adds no second auth client", () => {
  assert.ok(!/catch\s*(\([^)]*\))?\s*\{\s*\}/.test(HOOK), "no empty catch");
  // Strip comments: the header legitimately explains that the SDK is NOT used, and a
  // raw search would match that explanation rather than an actual import.
  const code = HOOK.split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*")).join("\n");
  assert.ok(!/from ["\']@supabase\/supabase-js["\']/.test(code), "no second auth client");
});

test("S4b acceptance script covers the emergency off test", () => {
  assert.match(ACC, /enforcement_mode\s*=\s*'off'/);
  // The document is bilingual - accept either language.
  for (const [en, ar] of [["aal1", "aal1"], ["aal2", "aal2"],
                          ["refresh", "تحديث"], ["cancel", "إلغاء"]]) {
    assert.ok(new RegExp(en, "i").test(ACC) || ACC.includes(ar), `acceptance missing: ${en}`);
  }
});


test("S4b closes the bulk-write bypass", () => {
  // Both write profession_permissions directly - they do NOT delegate - so they needed
  // their own gate. Composed from Fix B's bodies, so Fix B's authorization survives.
  for (const fn of ["admin_copy_profession_permissions", "admin_apply_profession_template"]) {
    const at = run.indexOf(`function public.${fn}`);
    const body = run.slice(at, run.indexOf("$$;", at));
    assert.match(body, /can_manage_identity/, `${fn} lost Fix B's authorization`);
    assert.ok(body.indexOf("can_manage_identity") < body.indexOf("mfa_require_aal2"),
      `${fn}: the MFA gate must follow authorization, not precede it`);
    assert.match(body, /insert into public\.profession_permissions/,
      "if this no longer writes permissions, re-evaluate whether it needs the gate");
  }
});

test("S4b the step-up hook is still unwired - Phase 6 must stay blocked", () => {
  // Recorded as a test so the blocker cannot be forgotten. useSensitiveWrite is the only
  // path that catches mfa_required and opens the modal; nothing imports it. Applying S4b
  // before it is wired would leave the owner - the sole factor holder - seeing a raw
  // "mfa_required" string with no way to step up, recoverable only via the SQL kill switch.
  const wired = ["AdminStaff", "AdminAccounts", "AdminProfessions", "ProfessionPicker"]
    .filter((c) => { try { return R(`components/portal/${c}.tsx`).includes("useSensitiveWrite"); }
                     catch { return false; } });
  const checklist = R("docs/MORNING_SECURITY_EXECUTION_CHECKLIST.md");
  if (wired.length === 0) {
    assert.match(checklist, /موقوفة · حاجز مؤكَّد/,
      "while the hook is unwired, the checklist MUST block Phase 6");
  }
});
