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
//   • Nothing in this module logs. No console.* at all — not even on error — because
//     a GoTrue error body can echo request content.
//   • Errors are mapped to a small fixed code union, mirroring mapAuthError in
//     lib/portal/auth.ts, so raw provider text never reaches the UI or a log.
//
// AFTER A SUCCESSFUL VERIFY: GoTrue issues a NEW access token carrying aal2. It must
// be written through the single existing session store (saveSession) or every
// subsequent request keeps presenting the old aal1 token and the user is challenged
// forever. mfaVerify does that and returns the refreshed Session.
// ════════════════════════════════════════════════════════════════════════════
import { SUPABASE_URL, SUPABASE_KEY, saveSession, type Session } from "@/lib/portalAuth";

export type MfaError =
  | "not_configured"      // env missing
  | "unauthorized"        // no/expired session
  | "totp_disabled"       // TOTP not enabled in the Supabase dashboard (422)
  | "invalid_code"        // wrong 6-digit code
  | "too_many_attempts"   // rate limited by GoTrue
  | "already_enrolled"
  | "not_found"
  | "network"
  | "failed";

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

/** Map a GoTrue response to our closed error vocabulary. Never surfaces provider text. */
function mapError(status: number, body: Record<string, unknown>): MfaError {
  const raw = `${body.error_code ?? ""} ${body.msg ?? ""} ${body.message ?? ""} ${body.error ?? ""}`.toLowerCase();
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 429 || /rate|too many/.test(raw)) return "too_many_attempts";
  if (status === 404) return "not_found";
  if (/invalid.*(code|otp|totp)|incorrect/.test(raw)) return "invalid_code";
  if (/already|exists|duplicate/.test(raw)) return "already_enrolled";
  // 422 with an MFA-disabled project is the single most likely first-run failure.
  if (status === 422 && /mfa|factor|enroll|disabled|not enabled/.test(raw)) return "totp_disabled";
  if (status === 422) return "totp_disabled";
  return "failed";
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

/** List this user's factors. Safe to call for anyone — returns only their own. */
export async function mfaListFactors(accessToken: string): Promise<MfaResult<MfaFactor[]>> {
  if (!configured()) return fail("not_configured");
  if (!accessToken) return fail("unauthorized");
  try {
    const { status, data } = await gotrueAuthed("/auth/v1/factors", accessToken, { method: "GET" });
    if (status >= 400) return fail(mapError(status, data));
    // GoTrue has returned either a bare array or {totp:[...]} across versions.
    const raw = Array.isArray(data) ? data
      : Array.isArray((data as { totp?: unknown }).totp) ? (data as { totp: unknown[] }).totp
      : Array.isArray((data as { factors?: unknown }).factors) ? (data as { factors: unknown[] }).factors
      : [];
    return { ok: true, data: raw as MfaFactor[] };
  } catch { return fail("network"); }
}

/**
 * Begin TOTP enrollment. Returns the QR URI and secret for one-time display.
 * The factor is UNVERIFIED until mfaVerify succeeds — an abandoned enrollment leaves
 * the account exactly as it was, which is the safe failure direction.
 */
export async function mfaEnrollTotp(accessToken: string, friendlyName = "Kian Portal"): Promise<MfaResult<MfaEnrollment>> {
  if (!configured()) return fail("not_configured");
  if (!accessToken) return fail("unauthorized");
  try {
    const { status, data } = await gotrueAuthed("/auth/v1/factors", accessToken, {
      method: "POST",
      body: { factor_type: "totp", friendly_name: friendlyName },
    });
    if (status >= 400) return fail(mapError(status, data));
    const totp = (data.totp ?? {}) as { qr_code?: string; secret?: string; uri?: string };
    const factorId = typeof data.id === "string" ? data.id : "";
    if (!factorId) return fail("failed");
    return {
      ok: true,
      data: { factorId, uri: totp.uri ?? "", secret: totp.secret ?? "" },
    };
  } catch { return fail("network"); }
}

/** Start a challenge for a factor. Returns the challenge id needed by verify. */
export async function mfaChallenge(accessToken: string, factorId: string): Promise<MfaResult<{ challengeId: string }>> {
  if (!configured()) return fail("not_configured");
  if (!accessToken || !factorId) return fail("unauthorized");
  try {
    const { status, data } = await gotrueAuthed(`/auth/v1/factors/${encodeURIComponent(factorId)}/challenge`, accessToken, { method: "POST" });
    if (status >= 400) return fail(mapError(status, data));
    const id = typeof data.id === "string" ? data.id : "";
    return id ? { ok: true, data: { challengeId: id } } : fail("failed");
  } catch { return fail("network"); }
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
  if (!session?.access_token) return fail("unauthorized");
  const clean = (code ?? "").replace(/\D/g, "");
  if (clean.length !== 6) return fail("invalid_code");
  try {
    const { status, data } = await gotrueAuthed(
      `/auth/v1/factors/${encodeURIComponent(factorId)}/verify`,
      session.access_token,
      { method: "POST", body: { challenge_id: challengeId, code: clean } },
    );
    if (status >= 400) return fail(mapError(status, data));

    const access = typeof data.access_token === "string" ? data.access_token : "";
    const refresh = typeof data.refresh_token === "string" ? data.refresh_token : "";
    if (!access) return fail("failed");

    const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 3600;
    const next: Session = {
      ...session,
      access_token: access,
      refresh_token: refresh || session.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + expiresIn,
    };
    // Single session store. No second copy anywhere.
    saveSession(next);
    return { ok: true, data: { session: next, aal2: true } };
  } catch { return fail("network"); }
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
  if (!accessToken || !factorId) return fail("unauthorized");
  try {
    const { status, data } = await gotrueAuthed(`/auth/v1/factors/${encodeURIComponent(factorId)}`, accessToken, { method: "DELETE" });
    if (status >= 400) return fail(mapError(status, data));
    return { ok: true, data: true };
  } catch { return fail("network"); }
}

/** Bilingual, non-technical copy for each error code. */
export function mfaErrorText(e: MfaError, isAr: boolean): string {
  const m: Record<MfaError, [string, string]> = {
    not_configured:   ["الخدمة غير مهيّأة.", "The service is not configured."],
    unauthorized:     ["انتهت جلستك. سجّل الدخول مرة أخرى.", "Your session expired. Please sign in again."],
    totp_disabled:    ["التحقّق بخطوتين غير مفعَّل في إعدادات المشروع بعد.", "Two-factor is not enabled in the project settings yet."],
    invalid_code:     ["الرمز غير صحيح. تحقّق من التطبيق وأعد المحاولة.", "That code is not correct. Check your app and try again."],
    too_many_attempts:["محاولات كثيرة. انتظر قليلًا ثم أعد المحاولة.", "Too many attempts. Wait a moment and try again."],
    already_enrolled: ["يوجد عامل مسجَّل بالفعل.", "A factor is already enrolled."],
    not_found:        ["العنصر غير موجود.", "Not found."],
    network:          ["تعذّر الاتصال. تحقّق من الشبكة.", "Could not connect. Check your network."],
    failed:           ["تعذّر إتمام العملية.", "The operation could not be completed."],
  };
  const [ar, en] = m[e] ?? m.failed;
  return isAr ? ar : en;
}
