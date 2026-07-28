// ════════════════════════════════════════════════════════════════════════════
// tests/mfa_login_challenge_s35.test.js — P2 · S3.5 · LOGIN-TIME MFA CHALLENGE
//
// Enrollment alone changed nothing at sign-in: a privileged user with a verified
// factor still landed straight in the portal on an aal1 session. S3.5 makes the login
// FLOW real, so the whole path can be exercised before S4 adds server-side gates.
//
// HONEST SCOPE, pinned below: this is a client-side flow gate, not the security
// boundary. A caller could still talk to PostgREST directly with an aal1 token. That
// is expected here and is exactly why S4 exists. What this must get right is the
// anti-lockout behaviour, which is asserted hard:
//
//   • entry is conditional on the user's OWN verified factor — an admin who has not
//     enrolled is never challenged, so enrollment mode cannot lock anyone out
//   • sign-out is ALWAYS reachable from the challenge screen
//   • a failure to READ assurance falls through to the portal, never to a denial
//   • employees and clients are not affected at all
// ════════════════════════════════════════════════════════════════════════════
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(root, p), "utf8");

const SHELL = R("components/portal/PortalShell.tsx");
const SCREEN = R("components/portal/MfaLoginChallenge.tsx");
const MFA = R("lib/portal/mfa.ts");
const strip = (s) => s.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
const shell = strip(SHELL);
const screen = strip(SCREEN);

// ─── (A) THE DECISION MATRIX — evaluated against the REAL function ──────────
//
// shouldChallengeMfa is extracted from lib/portal/mfa.ts and its type annotations
// stripped so the ACTUAL shipped code runs here. A hand-written model would only
// prove the model, and the two defects this section exists to prevent were both
// cases where the code and the intent had quietly diverged.

// The BODY brace is the one followed by a newline. mfaRoleOf's parameter type is an
// inline object literal (`{ account_type?: ... }`) whose brace is followed by a space,
// so this disambiguates the two without needing a parser.
const bodyOf = (src, name) => {
  const at = src.indexOf(`export function ${name}`);
  if (at < 0) throw new Error(`${name} not found`);
  const open = src.indexOf("{\n", at);
  return src.slice(open + 1, src.indexOf("\n}", open) + 1);
};
const shouldChallengeMfa = new Function("i", bodyOf(MFA, "shouldChallengeMfa"));

const CASE = (role, enforcementMode, hasVerifiedFactor, isAal2) =>
  shouldChallengeMfa({ role, enforcementMode, hasVerifiedFactor, isAal2 });

test("S3.5 matrix 1: owner + factor + aal1 + enrollment => challenge", () => {
  assert.equal(CASE("owner", "enrollment", true, false), true);
});

test("S3.5 matrix 2: owner + factor + aal2 + enrollment => portal", () => {
  assert.equal(CASE("owner", "enrollment", true, true), false, "already elevated; nothing to ask");
});

test("S3.5 matrix 3: owner + NO factor + enrollment => portal, no lockout", () => {
  assert.equal(CASE("owner", "enrollment", false, false), false,
    "an admin who has not enrolled must never be blocked — this is the anti-lockout invariant");
});

test("S3.5 matrix 4: owner + factor + OFF => portal, no challenge (BREAK-GLASS)", () => {
  assert.equal(CASE("owner", "off", true, false), false,
    "set enforcement_mode='off' must bypass the screen immediately, even with a verified factor");
});

test("S3.5 matrix 5: employee + factor + enrollment => portal", () => {
  assert.equal(CASE("employee", "enrollment", true, false), false,
    "employees are out of scope even if they enrol a factor of their own accord");
});

test("S3.5 matrix 6: client + factor + enrollment => portal", () => {
  assert.equal(CASE("client", "enrollment", true, false), false);
});

test("S3.5 matrix 7: super_admin and admin follow the owner rule exactly", () => {
  for (const role of ["super_admin", "admin"]) {
    assert.equal(CASE(role, "enrollment", true, false), true, `${role} + factor + aal1 => challenge`);
    assert.equal(CASE(role, "enrollment", true, true), false, `${role} at aal2 => portal`);
    assert.equal(CASE(role, "enrollment", false, false), false, `${role} without a factor => portal`);
    assert.equal(CASE(role, "off", true, false), false, `${role} with mode off => portal`);
  }
});

test("S3.5 the break-glass check comes FIRST, so nothing can override it", () => {
  // Every privileged/factor/aal combination must yield false when the mode is off.
  for (const role of ["owner", "super_admin", "admin"]) {
    for (const hasFactor of [true, false]) {
      for (const aal2 of [true, false]) {
        assert.equal(CASE(role, "off", hasFactor, aal2), false,
          `mode=off must win for ${role}/factor=${hasFactor}/aal2=${aal2}`);
      }
    }
  }
});

test("S3.5 an unknown or absent mode never challenges", () => {
  // 'enforced' is not a legal DB value; if one ever appeared it must not silently
  // start gating, and a null/garbled read must fail open.
  for (const mode of ["enforced", "", "ENROLLMENT", "unknown", undefined, null]) {
    assert.equal(CASE("owner", mode, true, false), false, `mode='${mode}' must not challenge`);
  }
});

test("S3.5 role mapping keeps employees and clients out of the privileged set", () => {
  const mfaRoleOf = new Function("p", bodyOf(MFA, "mfaRoleOf"));
  assert.equal(mfaRoleOf({ staff_role: "super_admin" }), "super_admin");
  assert.equal(mfaRoleOf({ account_type: "admin" }), "admin");
  assert.equal(mfaRoleOf({ account_type: "admin", staff_role: "super_admin" }), "super_admin");
  for (const r of ["manager", "custody_officer", "finance"]) {
    assert.equal(mfaRoleOf({ account_type: "client", staff_role: r }), "employee", `${r} is not privileged`);
  }
  assert.equal(mfaRoleOf({ account_type: "client", staff_role: null }), "client");
  assert.equal(mfaRoleOf({ account_type: "lead", staff_role: null }), "client");
});

test("S3.5 the shell delegates to the pure function rather than re-deciding inline", () => {
  assert.match(shell, /shouldChallengeMfa\(\{/);
  assert.match(shell, /role: mfaRoleOf\(p\)/);
  assert.match(shell, /enforcementMode: a\.data\.enforcement_mode/,
    "the mode MUST be passed — omitting it is the defect that made the break-glass lever inert");
  assert.ok(!/p\.account_type === "admin" \|\| p\.staff_role === "super_admin"/.test(shell),
    "the old inline role expression must be gone");
});

// ─── (B) reading assurance must never deny ──────────────────────────────────

test("S3.5 a failed assurance read falls through to the portal", () => {
  // Slice from the ENCLOSING try, which opens before the call itself.
  const call = shell.indexOf("const a = await mfaMyAssurance()");
  const block = shell.slice(shell.lastIndexOf("try {", call), shell.indexOf('setPhase("ready")', call));
  assert.match(block, /try \{/);
  assert.match(block, /catch \{/, "a network blip or unapplied SQL must not strand a legitimate admin");
  assert.match(block, /if \(a\.ok\)/, "an unsuccessful result must not be treated as 'needs challenge'");
  assert.match(block, /MFA_ASSURANCE_UNAVAILABLE/,
    "a degraded read must be visible, not silent — we must never imply the session is protected");
});

// ─── (C) nobody can be trapped ──────────────────────────────────────────────

test("S3.5 sign-out is always available on the challenge screen", () => {
  assert.match(screen, /onSignOut/);
  assert.match(SHELL, /onSignOut=\{\(\) => void signOut\(\)\}/, "and wired to the real sign-out");
  assert.match(screen, /تسجيل الخروج|Sign out/);
});

test("S3.5 the screen names the REAL emergency lever, not factor deletion", () => {
  assert.match(screen, /Supabase/);
  assert.match(screen, /مستقل عن البوابة|independent of the portal/,
    "the lever must be one this very screen cannot block");
  // The copy must point at switching enforcement off, because that is instant and
  // reversible. Telling a stuck user to delete their factor would push them into an
  // irreversible action (full re-enrollment) as a first resort.
  assert.match(screen, /إيقاف هذا التحقّق|switch this check off/);
  assert.ok(!/احذف|delete the factor|remove the factor/i.test(screen),
    "deleting a factor is a formal administrative step, not the escape hatch");
});

test("S3.5 the break-glass card in S1 makes 'off' primary and deletion secondary", () => {
  const s1 = R("docs/mfa_foundation_batch_s1_RUNME.sql");
  const card = s1.slice(s1.indexOf("بطاقة كسر الزجاج"));
  const offAt = card.indexOf("enforcement_mode = 'off'");
  const delAt = card.indexOf("delete from auth.mfa_factors");
  assert.ok(offAt > 0 && delAt > 0, "both must be documented");
  assert.ok(offAt < delAt, "the instant, reversible lever must be listed first");
  assert.match(card, /ليست وسيلة الخروج|إجراء إداري رسمي/,
    "factor deletion must be labelled as a formal administrative action, not an escape hatch");
});

// ─── (D) the flow states the brief requires ─────────────────────────────────

test("S3.5 a wrong code is distinguished from a missing factor", () => {
  assert.match(screen, /r\.error === "not_found"/);
  assert.match(screen, /mfaErrorText\(r\.error, isAr\)/);
});

test("S3.5 an expired session is not reported as a wrong code", () => {
  // Anchor on the CALL, not the identifier — `mfaStepUp` appears in the import first.
  const blk = screen.slice(screen.indexOf("const s = await getValidSession()"), screen.indexOf("mfaStepUp(s, code)"));
  assert.match(blk, /انتهت جلستك|session expired/i,
    "blaming the code when the session died sends the user round in circles");
});

test("S3.5 an expired challenge self-heals on retry", () => {
  // mfaStepUp issues a fresh challenge each attempt, so there is no stale challenge id
  // the screen could get stuck on — retrying is the resend.
  const f = MFA.slice(MFA.indexOf("export async function mfaStepUp"));
  assert.match(f, /mfaChallenge\(/);
  assert.ok(!/challengeId/.test(screen),
    "the screen must not hold a challenge id at all — a cached one would expire and stick");
});

test("S3.5 a page refresh mid-challenge returns to the challenge, not the portal", () => {
  // The phase is derived in bootstrap() on every mount, from Postgres — not from any
  // client-held flag that a reload would lose.
  assert.match(shell, /useEffect\(\(\) => \{ void bootstrap\(\); \}, \[bootstrap\]\)/);
  assert.ok(!/localStorage[^\n]*mfa/i.test(shell), "no client-held 'passed MFA' flag to forge or lose");
});

test("S3.5 success re-derives assurance rather than trusting the screen", () => {
  assert.match(SHELL, /onVerified=\{\(\) => void bootstrap\(\)\}/,
    "re-running bootstrap re-reads assurance from Postgres");
});

test("S3.5 the user lands back on the route they asked for", () => {
  // The shell never navigates; it swaps what it renders. So the URL is preserved and
  // a deep link survives the challenge.
  const block = shell.slice(shell.indexOf("const privileged ="), shell.indexOf('setPhase("ready")'));
  assert.ok(!/router\.push|redirect\(|location\.href/.test(block),
    "navigating away would lose the requested route");
});

// ─── (E) direct-URL entry ───────────────────────────────────────────────────

test("S3.5 the challenge lives in the shell, so every portal route is covered", () => {
  assert.match(shell, /type Phase = .*"mfa_challenge"/);
  assert.match(R("app/client-portal/layout.tsx"), /PortalShell/,
    "the shell wraps every /client-portal/* route, which is what covers a pasted deep link");
});

test("S3.5 the sign-in screen itself is not gated", () => {
  // phase 'auth' is returned before the challenge branch is ever reached, because
  // bootstrap() exits early when there is no session.
  const authIdx = shell.indexOf('if (!session) { setPhase("auth"); return; }');
  const mfaIdx = shell.indexOf('setPhase("mfa_challenge")');
  assert.ok(authIdx > 0 && authIdx < mfaIdx, "no session must short-circuit to the login screen");
});

// ─── (F) secrets and logging ────────────────────────────────────────────────

test("S3.5 nothing logs a code, token or provider response", () => {
  assert.ok(!/console\./.test(screen), "the challenge screen must not log");
  // The shell DOES log when assurance cannot be read — a silent degrade would imply a
  // protection we do not actually have. What it must never log is anything identifying.
  const logs = [...SHELL.matchAll(/console\.\w+\(([^;]*)\)/g)].map((m) => m[1]).join(" ");
  for (const leak of ["p.email", "p.id", "session", "access_token", "a.data", "profile", "code"]) {
    assert.ok(!logs.includes(leak), `'${leak}' must never be logged`);
  }
  assert.match(logs, /MFA_ASSURANCE_UNAVAILABLE/);
  assert.match(logs, /reason/, "a failure code only");
});

test("S3.5 no secret or QR is involved — this uses an existing factor", () => {
  for (const w of ["secret", "qrSvg", "mfaEnrollTotp", "otpauth"]) {
    assert.ok(!new RegExp(w, "i").test(screen), `${w} belongs to enrollment, not to a login challenge`);
  }
});

// ─── (G) scope honesty and no enforcement ───────────────────────────────────

test("S3.5 documents that it is a flow gate, not the security boundary", () => {
  assert.match(SCREEN, /HONEST SCOPE/);
  assert.match(SCREEN, /S4 adds server-side SQL gates|S4 adds/,
    "the next reader must not mistake this for the enforcement layer");
});

test("S3.5 changes no enforcement mode and adds no SQL gate", () => {
  // Comments are stripped first: the explanatory header quotes the break-glass UPDATE,
  // and a raw search would match that prose rather than executable code.
  for (const f of ["components/portal/PortalShell.tsx", "components/portal/MfaLoginChallenge.tsx"]) {
    const src = strip(R(f));
    assert.ok(!/mfa_admin_set_mode|mfa_ok\(/.test(src), `${f} must not introduce a gate`);
    assert.ok(!/enforcement_mode\s*=\s*["']/.test(src), `${f} must not assign the mode`);
  }
});

// ─── (H) UI quality ─────────────────────────────────────────────────────────

test("S3.5 the screen is bilingual, RTL-aware and accessible", () => {
  assert.match(screen, /dir=\{isAr \? "rtl" : "ltr"\}/);
  const pairs = (screen.match(/\{\s*ar:\s*"/g) ?? []).length;
  assert.ok(pairs >= 8, `Arabic and English are mandatory; found ${pairs}`);
  assert.match(screen, /aria-label=/);
  assert.match(screen, /inputMode="numeric"/);
  assert.match(screen, /autoComplete="one-time-code"/);
  assert.match(screen, /e\.key === "Enter"/, "Enter should submit — this is a one-field form");
});

test("S3.5 repeated failures surface the most common real cause", () => {
  assert.match(screen, /attempts >= 2/);
  assert.match(screen, /وقت جهازك|device clock/,
    "TOTP failures are usually clock drift, not a mistyped code");
});
