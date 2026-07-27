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

// ─── (A) the gate is a factor, not a role ───────────────────────────────────

test("S3.5 only a user with their OWN verified factor is challenged", () => {
  assert.match(shell, /a\.data\.has_verified_factor && !a\.data\.is_aal2/,
    "gating on 'is privileged' alone would strand an admin who has not enrolled");
  assert.match(shell, /setPhase\("mfa_challenge"\)/);
});

test("S3.5 an admin with no factor passes straight through", () => {
  // The challenge branch is entered only inside the has_verified_factor condition,
  // and every other path reaches setPhase("ready").
  const block = shell.slice(shell.indexOf("const privileged ="), shell.indexOf('setPhase("ready")'));
  assert.match(block, /if \(privileged\)/);
  assert.ok(!/setPhase\("blocked"\)|setErr/.test(block), "a missing factor must never be an error state");
});

test("S3.5 employees and clients are untouched", () => {
  assert.match(shell, /p\.account_type === "admin" \|\| p\.staff_role === "super_admin"/,
    "the scope is owner / super_admin / admin only");
  assert.ok(!/staff_role === "manager"|account_type === "client"/.test(
    shell.slice(shell.indexOf("const privileged ="), shell.indexOf('setPhase("ready")'))),
    "no other role may be pulled into the challenge at this stage");
});

// ─── (B) reading assurance must never deny ──────────────────────────────────

test("S3.5 a failed assurance read falls through to the portal", () => {
  const block = shell.slice(shell.indexOf("if (privileged)"), shell.indexOf('setPhase("ready")'));
  assert.match(block, /try \{/);
  assert.match(block, /catch \{/, "a network blip or unapplied SQL must not strand a legitimate admin");
  assert.match(block, /a\.ok &&/, "an unsuccessful result must not be treated as 'needs challenge'");
});

// ─── (C) nobody can be trapped ──────────────────────────────────────────────

test("S3.5 sign-out is always available on the challenge screen", () => {
  assert.match(screen, /onSignOut/);
  assert.match(SHELL, /onSignOut=\{\(\) => void signOut\(\)\}/, "and wired to the real sign-out");
  assert.match(screen, /تسجيل الخروج|Sign out/);
});

test("S3.5 the lost-device recovery path is stated on screen", () => {
  assert.match(screen, /Supabase/);
  assert.match(screen, /فقدت جهازك|Lost your device/);
  assert.match(screen, /مستقل عن البوابة|independent of the portal/,
    "the recovery lever must be one this very screen cannot block");
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
  const block = SHELL.slice(SHELL.indexOf("S3.5 · privileged login"), SHELL.indexOf('setPhase("ready")'));
  assert.ok(!/console\./.test(block), "the shell's MFA branch must not log");
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
  for (const f of ["components/portal/PortalShell.tsx", "components/portal/MfaLoginChallenge.tsx"]) {
    const src = R(f);
    assert.ok(!/mfa_admin_set_mode|enforcement_mode\s*=|mfa_ok\(/.test(src),
      `${f} must not change the mode or introduce a gate`);
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
