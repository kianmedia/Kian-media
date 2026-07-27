// ════════════════════════════════════════════════════════════════════════════
// tests/mfa_stepup_s3.test.js — P2 · S3 · ASSURANCE + STEP-UP (STILL NO DENIAL)
//
// S3 ships the recovery UI BEFORE anything can deny — the modal that resolves an
// aal1 session must exist before a gate can produce one. Nothing triggers it yet:
// enforcement mode is 'off' and 'enforced' is not a legal value in the constraint.
//
// The rule these pins defend hardest: assurance is NEVER computed by decoding a JWT
// in JavaScript. Two routes in this repo base64-decode a token payload without
// verifying the signature; they are safe only because their output is re-validated
// downstream. Assurance is a security decision — a forgeable source would let one
// edited base64 segment claim aal2. It comes from Postgres reading request.jwt.claims
// AFTER PostgREST has verified the signature. M-009 proved that path works.
// ════════════════════════════════════════════════════════════════════════════
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(root, p), "utf8");

const SQL = R("docs/mfa_assurance_s3_RUNME.sql");
const MFA = R("lib/portal/mfa.ts");
const STEPUP = R("components/portal/MfaStepUp.tsx");
const ENROLL = R("components/portal/MfaEnrollment.tsx");
const strip = (s, c) => s.split("\n").filter((l) => !l.trim().startsWith(c)).join("\n");
const sql = strip(SQL, "--");
// The function body ONLY. Slicing to end-of-file would sweep in the self-check block,
// which deliberately contains 'sub' and `raise exception` as part of its privacy
// assertion — a test that matched those would be checking its own guard, not the code.
const fnStart = sql.indexOf("create or replace function public.mfa_my_assurance");
const fnBody = sql.slice(fnStart, sql.indexOf("$$;", fnStart));
const mfaCode = strip(MFA, "//");
const stepCode = strip(STEPUP, "//");
const enrollCode = strip(ENROLL, "//");

// ─── (A) assurance comes from Postgres, never from decoding a token ─────────

test("S3 no JavaScript anywhere decodes a JWT to read assurance", () => {
  for (const [name, src] of [["mfa.ts", mfaCode], ["MfaStepUp", stepCode], ["MfaEnrollment", enrollCode]]) {
    assert.ok(!/atob\(|Buffer\.from\([^)]*base64|split\("\."\)|jwtDecode/.test(src),
      `${name} must not decode a token payload — one edited base64 segment would claim aal2`);
  }
});

test("S3 the client reads assurance through the database", () => {
  assert.match(mfaCode, /prpc<MfaAssurance>\("mfa_my_assurance", \{\}\)/);
  assert.match(sql, /current_setting\('request\.jwt\.claims', true\)/,
    "PostgREST verifies the signature before Postgres sees these claims");
});

test("S3 the assurance payload stays minimal — no claims can leak back", () => {
  // The temporary diagnostic that exposed sub/session_id was removed once M-009 was
  // answered; it must not return through this function.
  const ret = fnBody;
  for (const leak of ["'sub'", "'session_id'", "'claim_keys'", "'amr'"]) {
    assert.ok(!ret.includes(leak), `${leak} must not be returned`);
  }
  for (const need of ["'aal'", "'is_aal2'", "'has_verified_factor'", "'enforcement_mode'"]) {
    assert.ok(ret.includes(need), `${need} is required by the UI`);
  }
});

test("S3 the SQL self-check enforces that privacy rule", () => {
  assert.match(sql, /\(v \? 'sub'\) or \(v \? 'session_id'\) or \(v \? 'claim_keys'\)/);
  assert.match(sql, /raise exception 'فشل خصوصية/);
});

// ─── (B) the lock-out invariant that makes S4 safe ─────────────────────────

test("S3 exposes has_verified_factor — the invariant S4 depends on", () => {
  assert.match(sql, /from auth\.mfa_factors f/, "read from GoTrue's own table; we store no copy");
  assert.match(sql, /f\.status = 'verified'/);
  assert.match(sql, /f\.user_id = auth\.uid\(\)/, "only the caller's own factors");
});

test("S3 a failure to read factors degrades to false, never to an error", () => {
  const blk = sql.slice(sql.indexOf("select exists"), sql.indexOf("enforcement_mode into v_mode"));
  assert.match(blk, /exception when others then v_has := false/,
    "an auth-schema change must not break the settings page");
});

test("S3 the whole function fails open, because it is a display helper", () => {
  const tail = fnBody.slice(fnBody.lastIndexOf("exception when others"));
  assert.match(tail, /'is_aal2', false/);
  assert.ok(!/raise exception/.test(tail), "a read error must not darken a UI");
});

// ─── (C) it enforces nothing ────────────────────────────────────────────────

test("S3 defines no enforcement predicate and touches no policy", () => {
  assert.ok(!/function public\.mfa_ok/i.test(sql), "enforcement is S4");
  assert.ok(!/create policy|alter policy|drop policy/i.test(sql), "no RLS change");
  for (const gate of ["is_admin", "is_owner", "is_staff", "can_manage_projects", "pc_can_read_project"]) {
    assert.ok(!new RegExp(`create or replace function public\\.${gate}\\b`, "i").test(sql),
      `${gate} anchors ~50 SELECT policies — redefining it would blank the owner's screen`);
  }
});

test("S3 does not change the enforcement mode", () => {
  assert.ok(!/update public\.mfa_settings/i.test(sql), "S3 reads the mode; it never writes it");
});

test("S3 the step-up modal is documented as UX, not a boundary", () => {
  assert.match(STEPUP, /NOT a security boundary/i);
  assert.match(STEPUP, /cannot get\s*\n?\/\/ past a gate by closing a dialog/i);
});

// ─── (D) step-up mechanics ──────────────────────────────────────────────────

test("S3 step-up reuses an existing verified factor — no new secret", () => {
  const f = mfaCode.slice(mfaCode.indexOf("export async function mfaStepUp"));
  assert.match(f, /f\.status === "verified" && f\.factor_type === "totp"/);
  assert.match(f, /mfaChallenge\(/);
  assert.match(f, /mfaVerify\(/);
  assert.ok(!/mfaEnrollTotp|secret|qr/i.test(f), "step-up must never mint a new secret");
});

test("S3 step-up stores the upgraded token via the same single session store", () => {
  // mfaVerify is the only writer; step-up delegates to it rather than duplicating.
  assert.equal((mfaCode.match(/saveSession\(/g) ?? []).length, 1);
});

test("S3 an absent factor is reported distinctly, not as a wrong code", () => {
  const f = mfaCode.slice(mfaCode.indexOf("export async function mfaStepUp"));
  assert.match(f, /if \(!factor\) return fail\("not_found"\)/);
  assert.match(stepCode, /r\.error === "not_found"/, "and the modal says so specifically");
});

// ─── (E) session expiry is handled, not blamed on the user ─────────────────

test("S3 an expired session during step-up is named correctly", () => {
  assert.match(stepCode, /getValidSession\(\)/, "refresh is attempted first");
  const blk = stepCode.slice(stepCode.indexOf("if (!s)"), stepCode.indexOf("const r = await mfaStepUp"));
  assert.match(blk, /انتهت جلستك|session expired/i,
    "telling the user their CODE was wrong when their SESSION died sends them in circles");
});

test("S3 getValidSession is the refresh path both flows use", () => {
  const calls = (enrollCode.match(/getValidSession\(\)/g) ?? []).length;
  assert.ok(calls >= 3, `enrollment, verification and removal must each refresh first; found ${calls}`);
});

// ─── (F) UI truthfulness ────────────────────────────────────────────────────

test("S3 assurance is shown only to users who actually have a factor", () => {
  assert.match(enrollCode, /assurance\?\.has_verified_factor && stage === "idle"/,
    "telling someone with no authenticator that they are at level 1 is noise, not information");
});

test("S3 a missing S3 SQL install hides the badge instead of breaking the page", () => {
  assert.match(enrollCode, /setAssurance\(a\.ok \? a\.data : null\)/);
  const f = mfaCode.slice(mfaCode.indexOf("export async function mfaMyAssurance"));
  assert.match(f, /PGRST202|not find|does not exist/, "an unapplied function is 'unknown', not 'denied'");
});

test("S3 both surfaces are bilingual and direction-aware", () => {
  for (const [name, src] of [["MfaStepUp", stepCode], ["MfaEnrollment", enrollCode]]) {
    assert.match(src, /dir=\{isAr \? "rtl" : "ltr"\}/, `${name} must be RTL-aware`);
    const pairs = (src.match(/\{\s*ar:\s*"/g) ?? []).length;
    assert.ok(pairs >= 5, `${name} needs Arabic and English; found ${pairs}`);
  }
});

test("S3 the modal names a recovery route for a lost device", () => {
  assert.match(stepCode, /فقدت جهازك|Lost your device/);
  assert.match(stepCode, /Supabase/, "the break-glass path is outside the portal, and must be stated");
});

test("S3 neither surface logs anything", () => {
  assert.ok(!/console\./.test(stepCode));
  assert.ok(!/console\./.test(enrollCode));
});

test("S3 the modal is accessible", () => {
  assert.match(stepCode, /role="dialog"/);
  assert.match(stepCode, /aria-modal="true"/);
  assert.match(stepCode, /aria-label=/);
  assert.match(stepCode, /inputMode="numeric"/);
  assert.match(stepCode, /autoComplete="one-time-code"/);
});
