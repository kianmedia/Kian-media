// ════════════════════════════════════════════════════════════════════════════
// Kian — TOTP MFA over the GoTrue REST API.
//
// WHY NOT supabase.auth.mfa.* — this is the whole architectural decision.
//
// @supabase/supabase-js is NOT a dependency of this project and never has been
// (check package.json). Every auth call in this portal is a raw fetch to GoTrue:
// lib/portalAuth.ts:72 signs in via /auth/v1/token?grant_type=password and stores
// the session itself. So supabase.auth.mfa.enroll/challenge/verify do not exist here
// and cannot be called.
//
// Installing the SDK just for MFA would put a SECOND auth client beside the existing
// one — two session stores, two refresh strategies, two notions of "current user".
// That is precisely the parallel authentication system the constraints forbid. These
// functions call the exact endpoints the SDK wraps: same GoTrue service, same
// auth.mfa_factors table, same aal claim. One auth path, no new dependency.
//
// SECRET HANDLING — hard constraint, enforced by construction:
//   • The TOTP secret / otpauth URI from enroll is RETURNED TO THE CALLER ONLY.
//     It is never persisted here, never sent to any /api route, never written to
//     Postgres, never placed in localStorage.
//   • Logging is STAGE-ONLY (see mfaLog): stage, HTTP status, our safe code, a random
//     correlation id. Never a raw GoTrue body — those can echo request content — and
//     never an OTP, token, secret, QR URI, email, or full factor/challenge id.
//   • Errors are mapped to a small fixed code union, mirroring mapAuthError in
//     lib/portal/auth.ts, so raw provider text never reaches the UI or a log.
//
// AFTER A SUCCESSFUL VERIFY: GoTrue issues a NEW access token carrying aal2. It must
// be written through the single existing session store (saveSession) or every
// subsequent request keeps presenting the old aal1 token and the user is challenged
// forever. mfaVerify does that and returns the refreshed Session.
// ════════════════════════════════════════════════════════════════════════════
import { SUPABASE_URL, SUPABASE_KEY, saveSession, loadSession, type Session } from "@/lib/portalAuth";

/** Closed vocabulary, keyed on GoTrue's own `error_code` wherever one exists, so a
 *  message can never be a guess made from prose. The last three are synthesised by us. */
export type MfaError =
  | "not_configured"            // our env is missing
  | "no_authorization"          // 401 — no/expired bearer
  | "bad_jwt"                   // 403 — token malformed or unverifiable
  | "invalid_credentials"       // session credentials rejected
  | "mfa_verification_failed"   // the 6-digit code was wrong
  | "mfa_challenge_expired"     // challenge outlived its window
  | "mfa_factor_not_found"      // the factor vanished between load and submit
  | "mfa_totp_verify_not_enabled" // TOTP disabled in project settings
  | "mfa_ip_address_mismatch"   // challenge and verify came from different IPs
  | "over_request_rate_limit"   // GoTrue rate limit
  | "already_enrolled"
  | "network"
  | "mfa_session_not_elevated"  // synthesised: verify succeeded, Postgres still says aal1
  | "mfa_assurance_unavailable" // synthesised: could not read assurance at all
  | "unexpected_response";      // synthesised: 2xx/near-2xx whose shape we did not expect

export interface MfaFactor {
  id: string;
  friendly_name: string | null;
  factor_type: string;
  status: "verified" | "unverified" | string;
  created_at?: string;
}

/** Result of starting enrollment. `secret` and `uri` are for IMMEDIATE display only. */
export interface MfaEnrollment {
  factorId: string;
  /** otpauth:// URI — render as a QR, then drop. Never store. */
  uri: string;
  /** Base32 secret — shown as a manual fallback, then drop. Never store. */
  secret: string;
}

type Ok<T> = { ok: true; data: T };
type Err = { ok: false; error: MfaError };
export type MfaResult<T> = Ok<T> | Err;

const fail = (e: MfaError): Err => ({ ok: false, error: e });

/**
 * Map a GoTrue response to our closed vocabulary. Keyed on `error_code` FIRST.
 *
 * The previous version keyed on HTTP status and prose, and that is precisely how the
 * production failure became unreadable: a 405 with an EMPTY body matched no status rule
 * and no regex, so it fell through to a generic "failed" and the operator was told
 * nothing. Every branch below now yields a NAMED code, and the terminal case is
 * `unexpected_response` — which says "we did not understand the reply", not "something
 * went wrong". Provider text is still never surfaced.
 */
function mapError(status: number, body: Record<string, unknown>): MfaError {
  const code = typeof body.error_code === "string" ? body.error_code.toLowerCase() : "";
  // 1) GoTrue's own machine-readable code is authoritative when present.
  const KNOWN: Record<string, MfaError> = {
    no_authorization: "no_authorization",
    bad_jwt: "bad_jwt",
    invalid_credentials: "invalid_credentials",
    mfa_verification_failed: "mfa_verification_failed",
    mfa_challenge_expired: "mfa_challenge_expired",
    mfa_factor_not_found: "mfa_factor_not_found",
    mfa_totp_verify_not_enabled: "mfa_totp_verify_not_enabled",
    mfa_totp_enroll_not_enabled: "mfa_totp_verify_not_enabled",
    mfa_ip_address_mismatch: "mfa_ip_address_mismatch",
    over_request_rate_limit: "over_request_rate_limit",
    mfa_factor_name_conflict: "already_enrolled",
  };
  if (code && KNOWN[code]) return KNOWN[code];

  // 2) Status fallback for responses that carry no error_code (e.g. chi's bare 405).
  if (status === 401) return "no_authorization";
  if (status === 403) return "bad_jwt";
  if (status === 404) return "mfa_factor_not_found";
  if (status === 429) return "over_request_rate_limit";

  // 3) Prose, last and narrowly. NOTE: a blanket "422 => totp_disabled" used to live
  //    here and actively mislabelled mfa_challenge_expired and mfa_ip_address_mismatch
  //    as "two-factor is not enabled in project settings", sending an operator to the
  //    wrong dashboard page. Only match when the text really says so.
  const raw = `${code} ${body.msg ?? ""} ${body.message ?? ""} ${body.error ?? ""}`.toLowerCase();
  if (/invalid.*(code|otp|totp)|incorrect/.test(raw)) return "mfa_verification_failed";
  if (/expired/.test(raw)) return "mfa_challenge_expired";
  if (/not enabled|disabled/.test(raw)) return "mfa_totp_verify_not_enabled";
  if (/already|exists|duplicate|conflict/.test(raw)) return "already_enrolled";
  if (/rate|too many/.test(raw)) return "over_request_rate_limit";

  return "unexpected_response";
}

// ── Safe diagnostics ────────────────────────────────────────────────────────
// The production failure was invisible because nothing on this path logged anything.
// These emit a STAGE, an HTTP status, our safe code and a random correlation id — and
// nothing else, ever. Forbidden by construction: OTP codes, access/refresh tokens, TOTP
// secrets, QR URIs, Authorization headers, full factor or challenge ids, raw response
// bodies, JWT claims, and the user's email.
export type MfaStage =
  | "factors_list" | "factor_selection" | "challenge_create"
  | "verify" | "aal2_tokens_persist" | "assurance_recheck";

const corr = () => Math.random().toString(36).slice(2, 10);

function mfaLog(stage: MfaStage, ok: boolean, status: number | null, code: string | null, id: string) {
  console.info(JSON.stringify({
    tag: "MFA_FLOW", stage, ok, status, code, correlation_id: id, at: new Date().toISOString(),
  }));
}

/**
 * Authenticated GoTrue call. Deliberately a sibling of, not a change to, the private
 * gotrue() helper in lib/portal/auth.ts — that one is POST-only, sends no
 * Authorization header, and three unauthenticated flows depend on its exact shape.
 */
async function gotrueAuthed(
  path: string,
  accessToken: string,
  init: { method: "GET" | "POST" | "DELETE"; body?: unknown },
): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method: init.method,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${accessToken}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
    cache: "no-store",
  });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try { data = text ? (JSON.parse(text) as Record<string, unknown>) : {}; } catch { /* keep {} */ }
  return { status: res.status, data };
}

const configured = () => SUPABASE_URL.length > 0 && SUPABASE_KEY.length > 0;

/**
 * List this user's factors.
 *
 * ★ THE PRODUCTION BUG WAS HERE. ★
 * This used to call `GET /auth/v1/factors`. That endpoint DOES NOT EXIST in GoTrue and
 * never has: the /factors route registers only `POST /` (enroll), plus
 * POST /{id}/challenge, POST /{id}/verify and DELETE /{id}. The only list route is
 * `GET /admin/users/{id}/factors`, which needs the service_role key and is unusable
 * from a browser.
 *
 * With a VALID token, a GET to that path resolved the route node but found no GET
 * handler, so chi returned its default **405 with an empty body** — no error_code, no
 * msg. The old status/prose mapper matched nothing and fell through to "failed", i.e.
 * "تعذّر إتمام العملية". And because this runs FIRST in mfaStepUp, challenge and verify
 * were never called at all — which is why entering a CORRECT code still produced a
 * generic error rather than "wrong code".
 *
 * (A no-token probe returns 401 instead, because the auth middleware short-circuits
 * before method routing. That is why this could not be caught by probing unauthenticated.)
 *
 * The correct mechanism — and exactly what supabase-js's listFactors() does — is to read
 * the `factors` array off the user object. Note it is `json:"factors,omitempty"`, so the
 * key is ABSENT rather than `[]` when the user has none, and the array includes
 * UNVERIFIED factors, which is why callers must filter on status.
 */
export async function mfaListFactors(accessToken: string): Promise<MfaResult<MfaFactor[]>> {
  if (!configured()) return fail("not_configured");
  if (!accessToken) return fail("no_authorization");
  const id = corr();
  try {
    const { status, data } = await gotrueAuthed("/auth/v1/user", accessToken, { method: "GET" });
    if (status >= 400) {
      const e = mapError(status, data);
      mfaLog("factors_list", false, status, e, id);
      return fail(e);
    }
    const raw = (data as { factors?: unknown }).factors;
    // An absent key is legitimate (no factors). A present-but-not-array value is not,
    // and must surface as "we did not understand the reply" rather than "no factors" —
    // otherwise a future shape change silently looks like an un-enrolled user.
    if (raw !== undefined && !Array.isArray(raw)) {
      mfaLog("factors_list", false, status, "unexpected_response", id);
      return fail("unexpected_response");
    }
    const list = Array.isArray(raw) ? (raw as MfaFactor[]) : [];
    mfaLog("factors_list", true, status, null, id);
    return { ok: true, data: list };
  } catch {
    mfaLog("factors_list", false, null, "network", id);
    return fail("network");
  }
}

/**
 * Pick the factor to challenge. NEVER list[0].
 *
 * Written to accept a future 'phone' factor without touching TOTP: the type filter is a
 * parameter, and the caller decides precedence. Phone is NOT implemented — no provider,
 * no env var, no UI — this only ensures adding it later will not require reworking
 * selection logic.
 */
export function mfaSelectFactors(list: MfaFactor[], type: "totp" | "phone" = "totp"): MfaFactor[] {
  return list.filter((f) => f.status === "verified" && f.factor_type === type);
}

/**
 * Begin TOTP enrollment. Returns the QR URI and secret for one-time display.
 * The factor is UNVERIFIED until mfaVerify succeeds — an abandoned enrollment leaves
 * the account exactly as it was, which is the safe failure direction.
 */
export async function mfaEnrollTotp(accessToken: string, friendlyName = "Kian Portal"): Promise<MfaResult<MfaEnrollment>> {
  if (!configured()) return fail("not_configured");
  if (!accessToken) return fail("no_authorization");
  try {
    const { status, data } = await gotrueAuthed("/auth/v1/factors", accessToken, {
      method: "POST",
      body: { factor_type: "totp", friendly_name: friendlyName },
    });
    if (status >= 400) return fail(mapError(status, data));
    const totp = (data.totp ?? {}) as { qr_code?: string; secret?: string; uri?: string };
    const factorId = typeof data.id === "string" ? data.id : "";
    if (!factorId) return fail("unexpected_response");
    return {
      ok: true,
      data: { factorId, uri: totp.uri ?? "", secret: totp.secret ?? "" },
    };
  } catch { return fail("network"); }
}

/**
 * Start a challenge for a factor. Returns the challenge id needed by verify.
 *
 * Sends an explicit `{}` body so the request always carries Content-Type:
 * application/json. TOTP does not require a payload, but a bodyless POST is the kind of
 * ambiguity that produces an unhelpful 4xx, and this path had already proven it can
 * fail in ways nobody can read.
 */
export async function mfaChallenge(accessToken: string, factorId: string): Promise<MfaResult<{ challengeId: string }>> {
  if (!configured()) return fail("not_configured");
  if (!accessToken) return fail("no_authorization");
  if (!factorId) return fail("mfa_factor_not_found");
  const id = corr();
  try {
    const { status, data } = await gotrueAuthed(
      `/auth/v1/factors/${encodeURIComponent(factorId)}/challenge`, accessToken,
      { method: "POST", body: {} });
    if (status >= 400) {
      const e = mapError(status, data);
      mfaLog("challenge_create", false, status, e, id);
      return fail(e);
    }
    const challengeId = typeof data.id === "string" ? data.id : "";
    if (!challengeId) {
      mfaLog("challenge_create", false, status, "unexpected_response", id);
      return fail("unexpected_response");
    }
    mfaLog("challenge_create", true, status, null, id);
    return { ok: true, data: { challengeId } };
  } catch {
    mfaLog("challenge_create", false, null, "network", id);
    return fail("network");
  }
}

/**
 * Verify a 6-digit code. On success GoTrue returns a NEW access token carrying aal2.
 *
 * That token MUST replace the stored one. If it does not, every later request still
 * presents the aal1 token, the assurance level never rises, and the user is challenged
 * again forever. This is why the function takes the current Session, not just a token.
 */
export async function mfaVerify(
  session: Session,
  factorId: string,
  challengeId: string,
  code: string,
): Promise<MfaResult<{ session: Session; aal2: boolean }>> {
  if (!configured()) return fail("not_configured");
  if (!session?.access_token) return fail("no_authorization");
  if (!factorId) return fail("mfa_factor_not_found");
  if (!challengeId) return fail("mfa_challenge_expired");
  const clean = (code ?? "").replace(/\D/g, "");
  if (clean.length !== 6) return fail("mfa_verification_failed");
  const id = corr();
  try {
    const { status, data } = await gotrueAuthed(
      `/auth/v1/factors/${encodeURIComponent(factorId)}/verify`,
      session.access_token,
      { method: "POST", body: { challenge_id: challengeId, code: clean } },
    );
    if (status >= 400) {
      const e = mapError(status, data);
      mfaLog("verify", false, status, e, id);
      return fail(e);
    }

    // HTTP 200 is NOT success. GoTrue must have returned a real session, or there is
    // nothing to elevate with and reporting success would be a lie.
    const access = typeof data.access_token === "string" ? data.access_token : "";
    const refresh = typeof data.refresh_token === "string" ? data.refresh_token : "";
    if (!access) {
      mfaLog("verify", false, status, "unexpected_response", id);
      return fail("unexpected_response");
    }
    mfaLog("verify", true, status, null, id);

    const expiresIn = typeof data.expires_in === "number" && data.expires_in > 0 ? data.expires_in : 3600;
    const next: Session = {
      ...session,
      access_token: access,
      refresh_token: refresh || session.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + expiresIn,
    };
    // Single session store. No second copy anywhere.
    saveSession(next);

    // Prove the write actually took. If storage silently failed (private mode, quota,
    // a disabled localStorage), the next request would present the OLD aal1 token and
    // the user would loop through this screen forever with no explanation.
    const back = loadSession();
    if (!back || back.access_token !== access) {
      mfaLog("aal2_tokens_persist", false, null, "mfa_session_not_elevated", id);
      return fail("mfa_session_not_elevated");
    }
    mfaLog("aal2_tokens_persist", true, null, null, id);

    return { ok: true, data: { session: next, aal2: true } };
  } catch {
    mfaLog("verify", false, null, "network", id);
    return fail("network");
  }
}

/**
 * Remove a factor.
 *
 * NOTE ON LOCK-OUT: this is intentionally NOT the recovery path for a lost device —
 * it needs a working session, which is exactly what a lost authenticator denies once
 * enforcement is on. The real break-glass is deleting the row from auth.mfa_factors in
 * the Supabase SQL editor, a credential path independent of the portal. That is
 * documented in docs/mfa_foundation_batch_s1_RUNME.sql and the manual-actions queue.
 */
export async function mfaUnenroll(accessToken: string, factorId: string): Promise<MfaResult<true>> {
  if (!configured()) return fail("not_configured");
  if (!accessToken) return fail("no_authorization");
  if (!factorId) return fail("mfa_factor_not_found");
  try {
    const { status, data } = await gotrueAuthed(`/auth/v1/factors/${encodeURIComponent(factorId)}`, accessToken, { method: "DELETE" });
    if (status >= 400) return fail(mapError(status, data));
    return { ok: true, data: true };
  } catch { return fail("network"); }
}

/** Bilingual copy, one message per REAL error code.
 *
 *  The production failure surfaced as a single generic sentence that told the owner
 *  nothing and cost a full diagnosis cycle to trace. Every code now names what happened
 *  and what to do about it. `unexpected_response` deliberately carries a reference tag
 *  rather than raw provider text — never a response body, stack, token or factor id. */
export function mfaErrorText(e: MfaError, isAr: boolean): string {
  const m: Record<MfaError, [string, string]> = {
    not_configured: ["الخدمة غير مهيّأة.", "The service is not configured."],
    no_authorization: ["انتهت جلسة الدخول. سجّل الدخول مجددًا.", "Your sign-in session expired. Please sign in again."],
    bad_jwt: ["تعذر التحقق من بيانات الجلسة. سجّل الدخول مجددًا.", "Your session credentials could not be verified. Please sign in again."],
    invalid_credentials: ["تعذر التحقق من بيانات الجلسة.", "Your session credentials could not be verified."],
    mfa_verification_failed: ["الرمز غير صحيح. تحقق من الرمز الحالي في تطبيق المصادقة.", "That code is not correct. Check the current code in your authenticator app."],
    mfa_challenge_expired: ["انتهت صلاحية محاولة التحقق. تم إنشاء محاولة جديدة — أدخل الرمز الظاهر الآن.", "That verification attempt expired. A new one has been started — enter the code showing now."],
    mfa_factor_not_found: ["لم يعد عامل المصادقة متاحًا. أعد تحميل الصفحة أو أعد الإعداد.", "That authenticator is no longer available. Reload the page or set it up again."],
    mfa_totp_verify_not_enabled: ["التحقق عبر تطبيق المصادقة غير مفعّل في إعدادات النظام.", "Authenticator verification is not enabled in the project settings."],
    mfa_ip_address_mismatch: ["تغيّرت الشبكة أثناء التحقق. أعد المحاولة على نفس الاتصال.", "Your network changed mid-verification. Try again on the same connection."],
    over_request_rate_limit: ["محاولات كثيرة. انتظر قليلًا ثم حاول مجددًا.", "Too many attempts. Wait a moment and try again."],
    already_enrolled: ["يوجد عامل مسجَّل بهذا الاسم بالفعل.", "A factor with that name is already enrolled."],
    network: ["تعذر الاتصال. تحقق من الشبكة ثم أعد المحاولة.", "Could not connect. Check your network and try again."],
    mfa_session_not_elevated: ["تم قبول الرمز لكن لم يتم رفع مستوى الجلسة. حاول تسجيل الدخول مجددًا.", "The code was accepted but the session was not elevated. Please sign in again."],
    mfa_assurance_unavailable: ["تعذر التحقق من مستوى أمان الجلسة حاليًا.", "The session security level could not be checked right now."],
    unexpected_response: ["ردّ غير متوقع من خدمة المصادقة. أعد المحاولة، وإن تكرر أبلغ الدعم بالرمز MFA-URESP.", "Unexpected reply from the authentication service. Try again; if it persists, report reference MFA-URESP."],
  };
  const [ar, en] = m[e] ?? m.unexpected_response;
  return isAr ? ar : en;
}


// ════════════════════════════════════════════════════════════════════════════
// S3 — ASSURANCE STATE (read-only; enforces nothing)
// ════════════════════════════════════════════════════════════════════════════

/** What the UI is allowed to know about the caller's own assurance. Deliberately the
 *  minimum: no sub, no session_id, no claim list. The temporary diagnostic that
 *  exposed those was removed once M-009 was answered, and must not return by a side door. */
export interface MfaAssurance {
  authenticated: boolean;
  /** 'aal1' | 'aal2' | null (null = the claim could not be read) */
  aal: string | null;
  is_aal2: boolean;
  /** THE lock-out-prevention invariant: only a user who HAS a factor can ever be
   *  challenged by one. Someone with no factor always passes. */
  has_verified_factor: boolean;
  /** 'off' | 'enrollment'. 'enforced' is not a legal value in the DB constraint. */
  enforcement_mode: string;
}

/**
 * Read the caller's assurance from Postgres.
 *
 * Deliberately NOT computed by decoding the JWT in JavaScript. Two routes in this repo
 * base64-decode a token payload without verifying the signature; both are safe only
 * because their output is re-validated downstream. Assurance is a security decision, so
 * a forgeable source is unacceptable — one edited base64 segment would claim aal2.
 * PostgREST verifies the signature before Postgres ever sees request.jwt.claims, which
 * makes the database the only trustworthy reader. Confirmed live by M-009.
 */
export async function mfaMyAssurance(): Promise<MfaResult<MfaAssurance>> {
  const { prpc } = await import("@/lib/portal/client");
  const r = await prpc<MfaAssurance>("mfa_my_assurance", {});
  if (!r.ok) {
    // A missing function means the S3 SQL is not applied yet. Treat as "unknown",
    // never as "denied" — this is a display helper and must not darken a UI.
    return fail("mfa_assurance_unavailable");
  }
  return { ok: true, data: r.data };
}

/**
 * Raise the current session from aal1 to aal2 using an existing verified factor.
 *
 * The factor list is fetched FRESH on every attempt, never cached, so a factor removed
 * or re-created between page load and submit cannot leave us using a stale id. The same
 * applies to the challenge: a new one is created per attempt, so an expired challenge
 * resolves itself simply by retrying.
 *
 * `preferredFactorId` lets the UI honour a user's choice when several factors exist. It
 * is validated against the fresh list rather than trusted — if it is gone, we fall back
 * to the sole remaining factor, or report that a choice is needed.
 */
export async function mfaStepUp(
  session: Session,
  code: string,
  preferredFactorId?: string,
): Promise<MfaResult<{ session: Session }>> {
  const list = await mfaListFactors(session.access_token);
  if (!list.ok) return fail(list.error);

  const usable = mfaSelectFactors(list.data, "totp");
  if (usable.length === 0) return fail("mfa_factor_not_found");

  // Never usable[0] blindly: honour the caller's choice if it is still valid, and only
  // auto-select when there is exactly one candidate.
  const chosen = preferredFactorId
    ? usable.find((f) => f.id === preferredFactorId)
    : usable.length === 1 ? usable[0] : undefined;
  if (!chosen) return fail("mfa_factor_not_found");

  const ch = await mfaChallenge(session.access_token, chosen.id);
  if (!ch.ok) return fail(ch.error);

  const v = await mfaVerify(session, chosen.id, ch.data.challengeId, code);
  if (!v.ok) return fail(v.error);

  // ── The check that makes this trustworthy ──────────────────────────────────
  // A 200 from verify plus a stored token is still only OUR belief. Ask Postgres what
  // assurance the new token actually carries. If it is not aal2, the elevation did not
  // really happen — refuse entry and say so specifically, rather than waving the user
  // through on an aal1 session while the UI claims they are verified.
  const recheck = await mfaMyAssurance();
  const id = corr();
  if (!recheck.ok) {
    mfaLog("assurance_recheck", false, null, "mfa_assurance_unavailable", id);
    return fail("mfa_assurance_unavailable");
  }
  if (!recheck.data.is_aal2) {
    mfaLog("assurance_recheck", false, null, "mfa_session_not_elevated", id);
    return fail("mfa_session_not_elevated");
  }
  mfaLog("assurance_recheck", true, null, null, id);

  return { ok: true, data: { session: v.data.session } };
}

/** Fetch the user's selectable TOTP factors. The UI uses this to decide whether to show
 *  a chooser. Only friendly_name is ever displayed — never the id. */
export async function mfaUsableFactors(accessToken: string): Promise<MfaResult<MfaFactor[]>> {
  const list = await mfaListFactors(accessToken);
  if (!list.ok) return fail(list.error);
  return { ok: true, data: mfaSelectFactors(list.data, "totp") };
}

// ════════════════════════════════════════════════════════════════════════════
// S3.5 — THE CHALLENGE DECISION
// ════════════════════════════════════════════════════════════════════════════

/** Roles that may ever be challenged. Employees and clients are out of scope for this
 *  phase and stay out even if they enrol a factor of their own accord. */
export type MfaRole = "owner" | "super_admin" | "admin" | "employee" | "client";

export interface MfaChallengeInput {
  role: MfaRole;
  /** 'off' | 'enrollment'. 'enforced' is not a legal value in the DB constraint. */
  enforcementMode: string;
  hasVerifiedFactor: boolean;
  isAal2: boolean;
}

/** Exactly the four conditions, all required:
 *
 *      enforcementMode === 'enrollment'
 *   && role ∈ { owner, super_admin, admin }
 *   && hasVerifiedFactor
 *   && !isAal2
 *
 * A PURE function on purpose. The decision was previously inline in PortalShell where
 * it could only be verified by reading it; here every combination is testable, which is
 * how the two defects this replaces were found.
 *
 * ── Defect 1 it fixes: the break-glass lever did not work. ──
 * The mode was not consulted at all, so
 *     update public.mfa_settings set enforcement_mode = 'off' where id = 1;
 * did NOT bypass the challenge, even though S1 documents it as the emergency lever.
 * Mode is now checked FIRST, so 'off' is a true kill switch: one UPDATE in the Supabase
 * SQL editor — a credential path independent of the portal — and the screen is gone on
 * the next page load. Deleting a row from auth.mfa_factors is NOT the primary exit; it
 * is a formal, audited administrative action for a genuinely lost device.
 *
 * ── Defect 2 it fixes: the role condition was implicit. ──
 * It relied on hasVerifiedFactor plus a role expression tangled into the shell. The
 * role is now an explicit allow-list, so an employee or client who enrols a factor is
 * never challenged.
 */
export function shouldChallengeMfa(i: MfaChallengeInput): boolean {
  // 1. Break-glass first. Nothing else can override an operator turning this off.
  if (i.enforcementMode !== "enrollment") return false;
  // 2. Privileged roles only.
  if (i.role !== "owner" && i.role !== "super_admin" && i.role !== "admin") return false;
  // 3. Only a factor the user personally holds can challenge them — this is what makes
  //    enabling enrollment mode incapable of locking out anyone who has not enrolled.
  if (!i.hasVerifiedFactor) return false;
  // 4. Already elevated ⇒ nothing to ask for.
  return !i.isAal2;
}

/** Map a portal profile onto the role vocabulary above. account_type 'admin' is the
 *  owner/admin anchor (the two protected emails); staff_role 'super_admin' is explicit.
 *  Everything else — manager, custody_officer, finance, client, lead — is out of scope. */
export function mfaRoleOf(p: { account_type?: string | null; staff_role?: string | null }): MfaRole {
  if (p.staff_role === "super_admin") return "super_admin";
  if (p.account_type === "admin") return "admin";
  if (p.staff_role) return "employee";
  return "client";
}
