// ════════════════════════════════════════════════════════════════════════════
// tests/mfa_verify_repair.test.js — THE PRODUCTION FAILURE, AND ITS FIX
//
// ROOT CAUSE: mfaListFactors called `GET /auth/v1/factors`. That endpoint DOES NOT
// EXIST in GoTrue and never has — the /factors route registers only POST / (enroll),
// POST /{id}/challenge, POST /{id}/verify and DELETE /{id}. The only list route is
// GET /admin/users/{id}/factors, behind the service_role key.
//
// With a VALID token, a GET there resolved the path node but found no GET handler, so
// chi returned its default 405 WITH AN EMPTY BODY. mapError had no rule for 405 and no
// prose to match, so it fell through to "failed" -> "تعذّر إتمام العملية".
//
// And because listing runs FIRST in mfaStepUp, challenge and verify were NEVER CALLED.
// That is why entering a CORRECT code produced a generic error instead of "wrong code":
// the code never reached GoTrue at all.
//
// (Probing unauthenticated returns 401 instead, because auth middleware short-circuits
// before method routing — which is why this could not be caught that way.)
// ════════════════════════════════════════════════════════════════════════════
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(root, p), "utf8");

const MFA = R("lib/portal/mfa.ts");
const SCREEN = R("components/portal/MfaLoginChallenge.tsx");
const strip = (s) => s.split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*")).join("\n");
const mfa = strip(MFA);
const screen = strip(SCREEN);

const bodyOf = (src, name) => {
  const at = src.indexOf(`function ${name}`);
  assert.ok(at > 0, `${name} must exist`);
  const open = src.indexOf("{\n", at);
  return src.slice(open + 1, src.indexOf("\n}", open) + 1);
};

// ─── (1) THE ROOT CAUSE IS GONE ─────────────────────────────────────────────

test("REPAIR the non-existent GET /auth/v1/factors endpoint is no longer called", () => {
  const list = bodyOf(mfa, "mfaListFactors");
  assert.ok(!/gotrueAuthed\("\/auth\/v1\/factors"[^)]*method: "GET"/.test(list),
    "GET /auth/v1/factors does not exist in any GoTrue version");
  assert.match(list, /gotrueAuthed\("\/auth\/v1\/user", accessToken, \{ method: "GET" \}\)/,
    "factors are read off the user object — exactly what supabase-js listFactors() does");
  assert.match(list, /\.factors/, "and read from data.factors");
});

test("REPAIR POST /auth/v1/factors (enroll) is untouched — that route DOES exist", () => {
  const enroll = bodyOf(mfa, "mfaEnrollTotp");
  assert.match(enroll, /gotrueAuthed\("\/auth\/v1\/factors", accessToken, \{\s*method: "POST"/);
});

test("REPAIR an absent factors key is 'no factors', a wrong-typed one is 'unexpected'", () => {
  // GoTrue tags Factors as json:"factors,omitempty" — the key is ABSENT, not [], when
  // the user has none. But a present-but-not-array value means the contract moved, and
  // must not silently masquerade as an un-enrolled user.
  const list = bodyOf(mfa, "mfaListFactors");
  assert.match(list, /raw !== undefined && !Array\.isArray\(raw\)/);
  assert.match(list, /return fail\("unexpected_response"\)/);
  assert.match(list, /Array\.isArray\(raw\) \? \(raw as MfaFactor\[\]\) : \[\]/);
});

// ─── (2) NO FAILURE CAN BE ANONYMOUS AGAIN ──────────────────────────────────

test("REPAIR the generic 'failed' code no longer exists", () => {
  assert.ok(!/\| "failed"/.test(mfa), "'failed' told the operator nothing and cost a full diagnosis cycle");
  assert.ok(!/fail\("failed"\)/.test(mfa));
  assert.match(mfa, /"unexpected_response"/, "the terminal case now names what actually happened");
});

test("REPAIR mapError keys on GoTrue's error_code first, not on prose", () => {
  const m = bodyOf(mfa, "mapError");
  assert.match(m, /body\.error_code/, "the machine-readable code is authoritative");
  const codeIdx = m.indexOf("KNOWN[code]");
  const statusIdx = m.indexOf("status === 401");
  const proseIdx = m.indexOf("const raw =");
  assert.ok(codeIdx < statusIdx && statusIdx < proseIdx, "error_code -> status -> prose, in that order");
});

test("REPAIR every required error code is mapped", () => {
  const m = bodyOf(mfa, "mapError");
  for (const c of ["mfa_verification_failed", "mfa_challenge_expired", "mfa_factor_not_found",
                   "mfa_totp_verify_not_enabled", "no_authorization", "invalid_credentials",
                   "over_request_rate_limit", "bad_jwt"]) {
    assert.ok(m.includes(c), `missing mapping: ${c}`);
  }
});

test("REPAIR the blanket 422 => totp_disabled misclassification is gone", () => {
  const m = bodyOf(mfa, "mapError");
  assert.ok(!/status === 422\)\s*return/.test(m),
    "it labelled mfa_challenge_expired and mfa_ip_address_mismatch as 'two-factor not enabled', " +
      "sending an operator to the wrong dashboard page");
});

test("REPAIR every error code has bilingual copy — none falls back to a generic sentence", () => {
  const union = MFA.slice(MFA.indexOf("export type MfaError ="), MFA.indexOf(";", MFA.indexOf("export type MfaError =")));
  const codes = [...union.matchAll(/"([a-z_0-9]+)"/g)].map((x) => x[1]);
  assert.ok(codes.length >= 14, `expected the full union; found ${codes.length}`);
  const table = MFA.slice(MFA.indexOf("const m: Record<MfaError"), MFA.indexOf("const [ar, en]"));
  for (const c of codes) {
    assert.ok(table.includes(`${c}:`), `no message for '${c}'`);
  }
});

test("REPAIR an unknown response gives a reference tag, never raw provider text", () => {
  const at = MFA.indexOf("unexpected_response:");
  // Drop the key name itself — it contains "response" and would match its own guard.
  const t = MFA.slice(at + "unexpected_response:".length, at + 420);
  assert.match(t, /MFA-URESP/, "a non-sensitive reference the user can quote");
  // The prose legitimately says "reply"/"service"; what must not appear is any carrier
  // of provider detail.
  assert.ok(!/\bbody\b|stack|token|error_code|msg/i.test(t),
    "the message must not carry a response body, stack, token or provider code");
});

// ─── (3) VERIFY IS NOT TRUSTED ON HTTP 200 ALONE ────────────────────────────

test("REPAIR a 200 without a session is not success", () => {
  const v = bodyOf(mfa, "mfaVerify");
  assert.match(v, /if \(!access\) \{[\s\S]{0,160}?return fail\("unexpected_response"\)/);
});

test("REPAIR the session write is read back and proven", () => {
  const v = bodyOf(mfa, "mfaVerify");
  assert.match(v, /const back = loadSession\(\)/);
  assert.match(v, /back\.access_token !== access[\s\S]{0,200}?mfa_session_not_elevated/,
    "a silently failed write would loop the user through this screen forever");
});

test("REPAIR entry is refused unless POSTGRES confirms aal2", () => {
  const s = bodyOf(mfa, "mfaStepUp");
  assert.match(s, /const recheck = await mfaMyAssurance\(\)/);
  assert.match(s, /!recheck\.data\.is_aal2[\s\S]{0,200}?return fail\("mfa_session_not_elevated"\)/,
    "our own belief that verify worked is not evidence the token carries aal2");
  const verifyAt = s.indexOf("await mfaVerify");
  assert.ok(s.indexOf("mfaMyAssurance") > verifyAt, "the recheck must come after verify");
});

// ─── (4) FACTOR SELECTION ───────────────────────────────────────────────────

test("REPAIR selection filters on verified AND totp — never list[0]", () => {
  const sel = bodyOf(mfa, "mfaSelectFactors");
  assert.match(sel, /f\.status === "verified" && f\.factor_type === type/);
  const s = bodyOf(mfa, "mfaStepUp");
  assert.ok(!/usable\[0\]/.test(s.replace(/usable\.length === 1 \? usable\[0\] : undefined/, "")),
    "auto-selection is only legitimate when exactly one candidate exists");
  assert.match(s, /usable\.length === 1 \? usable\[0\] : undefined/);
});

test("REPAIR a caller's chosen factor is validated against a FRESH list, not trusted", () => {
  const s = bodyOf(mfa, "mfaStepUp");
  const listAt = s.indexOf("await mfaListFactors");
  const chooseAt = s.indexOf("preferredFactorId");
  assert.ok(listAt < chooseAt, "the list must be refetched before honouring a preference");
  assert.match(s, /usable\.find\(\(f\) => f\.id === preferredFactorId\)/);
});

test("REPAIR the factor list and challenge are refetched per attempt", () => {
  const s = bodyOf(mfa, "mfaStepUp");
  assert.match(s, /await mfaListFactors/);
  assert.match(s, /await mfaChallenge/);
  assert.ok(!/challengeId/.test(screen), "the screen caches no challenge id across attempts or reloads");
});

test("REPAIR selection is ready for a future phone factor without touching TOTP", () => {
  assert.match(mfa, /type: "totp" \| "phone" = "totp"/);
  // But phone must NOT be implemented now.
  assert.ok(!/twilio|vonage|messagebird|sms_provider/i.test(mfa), "no SMS provider may be added");
  assert.ok(!/factor_type: "phone"/.test(mfa), "no phone enrollment is implemented");
  assert.ok(!/SMS|رسالة نصية/.test(screen), "no non-functional SMS button may be shown");
});

// ─── (5) SAFE DIAGNOSTICS ───────────────────────────────────────────────────

test("REPAIR the flow now logs stages — the failure was invisible before", () => {
  assert.match(mfa, /tag: "MFA_FLOW", stage, ok, status, code, correlation_id/);
  for (const st of ["factors_list", "challenge_create", "verify", "aal2_tokens_persist", "assurance_recheck"]) {
    assert.ok(mfa.includes(`"${st}"`), `stage '${st}' must be observable`);
  }
});

test("REPAIR no secret, token, code or raw body is ever logged", () => {
  const calls = [...MFA.matchAll(/console\.\w+\(([\s\S]{0,240}?)\)\);/g)].map((m) => m[1]).join(" ");
  for (const f of ["access_token", "refresh_token", "secret", "uri", "qr", "clean",
                   "challengeId", "factorId", "data)", "body", "email"]) {
    assert.ok(!calls.includes(f), `'${f}' must never appear in a log call`);
  }
  assert.ok(!/console\.\w+\([^)]*JSON\.stringify\(data/.test(MFA), "never log a raw GoTrue body");
});

// ─── (6) UI BEHAVIOUR ───────────────────────────────────────────────────────

test("REPAIR paste and auto-submit work, guarded against double submission", () => {
  assert.match(screen, /onPaste=/);
  assert.match(screen, /if \(v\.length === 6\) void submit\(v\)/, "auto-submit on the sixth digit");
  assert.match(screen, /inFlight\.current/, "a re-entry guard is required once submission is automatic");
  assert.match(screen, /if \(entered\.length !== 6 \|\| inFlight\.current\) return/);
});

test("REPAIR a multi-factor user chooses, and only friendly_name is shown", () => {
  assert.match(screen, /factors\.length > 1 &&/);
  assert.match(screen, /f\.friendly_name \|\|/);
  // key={f.id} is a React reconciliation key, not output. What must never happen is the
  // id appearing in a TEXT position where a user could read it.
  assert.ok(!/>\s*\{f\.id\}|\{f\.id\}\s*</.test(screen), "a factor id must never be rendered as text");
  assert.match(screen, /key=\{f\.id\}/, "using it as a React key is fine and expected");
  assert.match(screen, /if \(!chosen\)/, "submitting without a choice must be refused, not guessed");
});

test("REPAIR the field clears after a wrong code and keeps focus", () => {
  assert.match(screen, /setCode\(""\)/);
  assert.match(screen, /inputRef\.current\?\.focus\(\)/);
});
