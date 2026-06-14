// ════════════════════════════════════════════════════════════════════════
// Kian Portal — auth helpers (GoTrue REST): signup, login, logout, session,
// profile bootstrap. Shares the localStorage session with lib/portalAuth.ts.
//
// NOTE: we deliberately do NOT call public.log_login() after sign-in — the
// auth.sessions trigger (Phase 0 Part 2) already records user.logged_in;
// a client call would double-log. The RPC remains a dormant fallback.
// ════════════════════════════════════════════════════════════════════════

import {
  SUPABASE_URL,
  SUPABASE_KEY,
  SUPABASE_CONFIGURED,
  saveSession,
  clearSession,
  getValidSession,
  type Session,
} from "@/lib/portalAuth";
import { pget, enc, currentUserId, type Result } from "@/lib/portal/client";
import type { Profile } from "@/lib/portal/types";

export type AuthErrorCode =
  | "invalid_credentials"
  | "email_not_confirmed"
  | "user_already_exists"
  | "weak_password"
  | "rate_limited"
  | "not_configured"
  | "unknown";

export type AuthResult =
  | { ok: true; session?: Session; needsConfirmation?: boolean }
  | { ok: false; code: AuthErrorCode; error: string };

function mapAuthError(status: number, raw: string): AuthErrorCode {
  const m = raw.toLowerCase();
  if (m.includes("not confirmed")) return "email_not_confirmed";
  if (m.includes("invalid login") || m.includes("invalid_credentials")) return "invalid_credentials";
  if (m.includes("already registered") || m.includes("already exists")) return "user_already_exists";
  if (m.includes("password")) return "weak_password";
  if (status === 429) return "rate_limited";
  return "unknown";
}

async function gotrue(path: string, body: unknown): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try { data = text ? (JSON.parse(text) as Record<string, unknown>) : {}; } catch { /* keep {} */ }
  return { status: res.status, data };
}

function rawError(data: Record<string, unknown>): string {
  for (const k of ["error_description", "msg", "message", "error"]) {
    if (typeof data[k] === "string" && data[k]) return data[k] as string;
  }
  return "Request failed";
}

function toSession(data: Record<string, unknown>): Session | null {
  if (typeof data.access_token !== "string") return null;
  const user = (data.user ?? {}) as Record<string, unknown>;
  return {
    access_token: data.access_token,
    refresh_token: (data.refresh_token as string) ?? "",
    expires_at: Math.floor(Date.now() / 1000) + ((data.expires_in as number) || 3600) - 60,
    user_id: (user.id as string) ?? "",
    email: (user.email as string) ?? "",
  };
}

/**
 * Public signup. Email confirmation is ON for this project, so the normal
 * outcome is `{ ok: true, needsConfirmation: true }` with no session.
 * The DB trigger auto-provisions the lead profile + notification prefs.
 * `meta` is stored as GoTrue user metadata (raw_user_meta_data) — profile
 * fields themselves are synced after the first confirmed login (see shell).
 */
export async function signup(
  email: string,
  password: string,
  meta?: Record<string, string | boolean>
): Promise<AuthResult> {
  if (!SUPABASE_CONFIGURED) return { ok: false, code: "not_configured", error: "Portal is not configured." };
  const { status, data } = await gotrue("/auth/v1/signup", { email, password, data: meta ?? {} });
  if (status >= 400) {
    const raw = rawError(data);
    return { ok: false, code: mapAuthError(status, raw), error: raw };
  }
  const session = toSession(data);
  if (session) {
    // Autoconfirm projects return a session immediately.
    saveSession(session);
    return { ok: true, session };
  }
  // user created, confirmation email sent
  return { ok: true, needsConfirmation: true };
}

/** Login with mapped error codes (wraps the same endpoint as portalAuth.login). */
export async function login(email: string, password: string): Promise<AuthResult> {
  if (!SUPABASE_CONFIGURED) return { ok: false, code: "not_configured", error: "Portal is not configured." };
  const { status, data } = await gotrue("/auth/v1/token?grant_type=password", { email, password });
  if (status >= 400) {
    const raw = rawError(data);
    return { ok: false, code: mapAuthError(status, raw), error: raw };
  }
  const session = toSession(data);
  if (!session) return { ok: false, code: "unknown", error: "No session returned" };
  saveSession(session);
  return { ok: true, session };
}

/** Best-effort server-side revoke, then always clear the local session. */
export async function logout(): Promise<void> {
  const s = await getValidSession();
  if (s) {
    try {
      await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
        method: "POST",
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${s.access_token}` },
      });
    } catch { /* offline logout is fine */ }
  }
  clearSession();
}

export { getValidSession, currentUserId };
export type { Session };

/** The logged-in user's profile row (account_type/status drive the UI gates). */
export async function getMyProfile(): Promise<Result<Profile | null>> {
  const uid = currentUserId();
  if (!uid) return { ok: false, error: "not_authenticated", status: 401 };
  const r = await pget<Profile[]>(`profiles?id=eq.${enc(uid)}&select=*`);
  if (!r.ok) return r;
  return { ok: true, data: r.data[0] ?? null };
}
