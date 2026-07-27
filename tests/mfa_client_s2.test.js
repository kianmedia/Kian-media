// ════════════════════════════════════════════════════════════════════════════
// tests/mfa_client_s2.test.js — P2 · S2 · TOTP ENROLLMENT OVER GoTrue REST
//
// The architectural point these pins protect: @supabase/supabase-js is NOT a
// dependency of this project. Every auth call is a raw fetch to GoTrue. So
// supabase.auth.mfa.* cannot be called here, and installing the SDK just for MFA
// would place a SECOND auth client beside the existing one — two session stores, two
// refresh strategies — which is exactly the parallel authentication system the
// constraints forbid. These functions call the endpoints the SDK wraps: same GoTrue,
// same auth.mfa_factors, same aal claim, one auth path.
//
// And the owner's hard constraint: no TOTP secret, QR or OTP may ever be stored or
// logged. That is asserted structurally below, not just reviewed by eye.
// ════════════════════════════════════════════════════════════════════════════
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(root, p), "utf8");

const MFA = R("lib/portal/mfa.ts");
const UI = R("components/portal/MfaEnrollment.tsx");
const PROFILE = R("components/portal/ProfileSettings.tsx");
const PKG = JSON.parse(R("package.json"));
const strip = (s) => s.split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*")).join("\n");
const mfaCode = strip(MFA);
const uiCode = strip(UI);

// ─── (A) one auth path, no second client ────────────────────────────────────

test("S2 the Supabase SDK is still not a dependency", () => {
  const deps = { ...(PKG.dependencies ?? {}), ...(PKG.devDependencies ?? {}) };
  assert.ok(!deps["@supabase/supabase-js"],
    "adding it would create a second auth client beside lib/portalAuth.ts — the forbidden parallel system");
});

test("S2 MFA goes to GoTrue's own factor endpoints", () => {
  for (const ep of ["/auth/v1/factors"]) assert.ok(mfaCode.includes(ep), `must call ${ep}`);
  assert.match(mfaCode, /\/challenge`/, "challenge endpoint");
  assert.match(mfaCode, /\/verify`/, "verify endpoint");
  assert.ok(!/\/rest\/v1\//.test(mfaCode), "MFA is an auth concern, not a PostgREST table operation");
});

test("S2 it does not widen the shared unauthenticated gotrue() helper", () => {
  // That helper is POST-only, sends no Authorization header, and three unauthenticated
  // flows depend on its exact shape.
  assert.ok(!/from "@\/lib\/portal\/auth"/.test(mfaCode), "must not import the private sign-in helper");
  assert.match(mfaCode, /async function gotrueAuthed/, "a sibling helper, not a mutation of the existing one");
  assert.match(mfaCode, /Authorization: `Bearer \$\{accessToken\}`/, "MFA endpoints need the user's token");
  assert.match(mfaCode, /method: "GET" \| "POST" \| "DELETE"/, "and verbs the old helper does not support");
});

// ─── (B) the secret never leaves the browser ────────────────────────────────

test("S2 nothing in the MFA client logs, at all", () => {
  assert.ok(!/console\./.test(mfaCode),
    "a GoTrue error body can echo request content; no console call may exist on any path");
  assert.ok(!/console\./.test(uiCode), "the enrollment UI must not log either");
});

test("S2 the secret is never persisted or transmitted anywhere", () => {
  for (const sink of ["localStorage", "sessionStorage", "document.cookie"]) {
    assert.ok(!new RegExp(sink.replace(".", "\\.")).test(uiCode), `the secret must never reach ${sink}`);
    assert.ok(!new RegExp(sink.replace(".", "\\.")).test(mfaCode), `the secret must never reach ${sink}`);
  }
  // The UI must not POST the secret to any of our own endpoints or RPCs.
  assert.ok(!/fetch\(\s*["'`]\/api\//.test(uiCode), "no /api call from the enrollment UI");
  for (const rpc of ["prpc", "ppost", "rpcAsService", "rpcAsUser"]) {
    assert.ok(!new RegExp(`\\b${rpc}\\b`).test(uiCode), `${rpc} would send the secret to our own backend`);
  }
});

test("S2 the QR is rendered client-side from the already-installed package", () => {
  assert.match(uiCode, /from "@\/lib\/qr\/qr"/, "reuses the existing helper");
  assert.match(uiCode, /qrSvg\(/);
  assert.ok(PKG.dependencies?.qrcode, "qrcode is already a dependency — no new one added");
});

test("S2 enrollment state is dropped when the dialog closes or succeeds", () => {
  assert.match(uiCode, /const clearEnrollment = useCallback/);
  assert.match(uiCode, /setSecret\(""\)/, "the secret must be cleared, not merely hidden");
  // Called on both exits: cancel and successful verify.
  const calls = (uiCode.match(/clearEnrollment\(\)/g) ?? []).length;
  assert.ok(calls >= 2, `clearEnrollment must run on success AND on cancel; found ${calls}`);
});

// ─── (C) the aal2 token must replace the stored one ─────────────────────────

test("S2 verify writes the new aal2 token through the single session store", () => {
  const v = mfaCode.slice(mfaCode.indexOf("export async function mfaVerify"));
  assert.match(v, /saveSession\(next\)/,
    "GoTrue returns a NEW token carrying aal2; without storing it every later request " +
      "still presents the aal1 token and the user is challenged forever");
  assert.match(v, /access_token: access/);
  assert.match(v, /refresh_token: refresh \|\| session\.refresh_token/,
    "a missing refresh token must not wipe the existing one");
});

test("S2 verify computes a real expiry rather than trusting the old one", () => {
  const v = mfaCode.slice(mfaCode.indexOf("export async function mfaVerify"));
  assert.match(v, /expires_at: Math\.floor\(Date\.now\(\) \/ 1000\) \+ expiresIn/);
});

test("S2 there is exactly one session store", () => {
  assert.equal((mfaCode.match(/saveSession\(/g) ?? []).length, 1, "one write, in verify only");
  assert.ok(!/new Storage|createSession|setSession\(/.test(mfaCode), "no second session concept");
});

// ─── (D) errors are a closed vocabulary, never provider text ────────────────

test("S2 provider error text never reaches the UI", () => {
  assert.match(mfaCode, /export type MfaError =/, "a closed union");
  assert.match(mfaCode, /function mapError\(status: number/);
  assert.match(mfaCode, /export function mfaErrorText\(e: MfaError, isAr: boolean\)/, "bilingual copy per code");
  // The UI must render mapped copy, not raw fields off the response.
  assert.ok(!/\.msg\b|\.error_description\b/.test(uiCode), "no raw provider strings in the UI");
});

test("S2 the most likely first-run failure is named specifically", () => {
  assert.match(mfaCode, /"totp_disabled"/,
    "POST /auth/v1/factors returns 422 until TOTP is enabled in the Supabase dashboard; " +
      "a generic failure here would send the owner hunting in the wrong place");
  assert.match(mfaCode, /غير مفعَّل|not enabled/, "and says so in both languages");
});

// ─── (E) it enforces nothing, and is bilingual + RTL ────────────────────────

test("S2 the enrollment UI enforces nothing", () => {
  for (const w of ["mfa_ok", "enforcement_mode", "aal2 required", "mfa_required"]) {
    assert.ok(!new RegExp(w).test(uiCode), `enrollment must not gate anything (${w})`);
  }
});

test("S2 unenroll is documented as NOT the lost-device recovery path", () => {
  const u = MFA.slice(MFA.indexOf("export async function mfaUnenroll") - 900, MFA.indexOf("export async function mfaUnenroll"));
  assert.match(u, /auth\.mfa_factors/, "the real break-glass is deleting the row in the Supabase SQL editor");
  assert.match(u, /LOCK-OUT/i, "because unenroll needs a working session, which a lost authenticator denies");
});

test("S2 the UI is bilingual and direction-aware", () => {
  assert.match(uiCode, /dir=\{isAr \? "rtl" : "ltr"\}/);
  const pairs = (uiCode.match(/\{\s*ar:\s*"/g) ?? []).length;
  assert.ok(pairs >= 10, `Arabic and English are both mandatory; found ${pairs} translated strings`);
});

test("S2 the code field is numeric, one-time-code, and length-capped", () => {
  assert.match(uiCode, /inputMode="numeric"/);
  assert.match(uiCode, /autoComplete="one-time-code"/);
  assert.match(uiCode, /maxLength=\{6\}/);
  assert.match(uiCode, /replace\(\/\\D\/g, ""\)\.slice\(0, 6\)/, "non-digits stripped on entry");
  assert.match(mfaCode, /clean\.length !== 6/, "and re-validated before any network call");
});

// ─── (F) actually mounted — a component nobody renders is not a feature ─────

test("S2 the enrollment component is mounted on a real page", () => {
  assert.match(PROFILE, /import MfaEnrollment from "@\/components\/portal\/MfaEnrollment"/);
  assert.match(PROFILE, /<MfaEnrollment \/>/);
  assert.match(R("app/client-portal/profile/page.tsx"), /ProfileSettings/,
    "and that component is what /client-portal/profile renders");
});

// ─── (G) the temporary diagnostic is gone ───────────────────────────────────

test("S2 the temporary claim-diagnostic page and route were removed", () => {
  for (const p of ["app/client-portal/mfa-diagnostics/page.tsx", "app/api/admin/mfa-probe/route.ts"]) {
    assert.ok(!fs.existsSync(path.join(root, p)), `${p} must not ship to production`);
  }
});

test("S2 no surface exposes sub, session_id or a claims dump any more", () => {
  const scan = (dir) => {
    const out = [];
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) out.push(...scan(rel));
      else if (/\.(ts|tsx)$/.test(e.name)) out.push(rel);
    }
    return out;
  };
  // Match the AUTH claim only. `shoot_session_id` is a filming session and has nothing
  // to do with authentication — a bare /session_id/ flags it and would train the next
  // reader to ignore this test.
  const authSessionId = /(?<![a-z_])session_id/;
  for (const f of [...scan("app"), ...scan("components")]) {
    const src = R(f);
    assert.ok(!authSessionId.test(src), `${f} must not surface the auth session_id claim`);
    assert.ok(!/claim_keys/.test(src), `${f} must not surface a claims dump`);
  }
});
