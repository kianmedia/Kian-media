// ════════════════════════════════════════════════════════════════════════
// Kian Portal — typed REST client for Supabase (PostgREST + RPC).
//
// - Reuses the env-based config + session store from lib/portalAuth.ts so the
//   live portal page and this layer share one localStorage session.
// - Injects apikey + Bearer headers, refreshes the token once on 401, and
//   normalizes every response into Result<T>.
// - Anon/public key only — never a service-role key (admin power lives in
//   is_admin()-guarded RPCs on the database side).
// ════════════════════════════════════════════════════════════════════════

import {
  SUPABASE_URL,
  SUPABASE_KEY,
  SUPABASE_CONFIGURED,
  loadSession,
  refreshSession,
  getValidSession,
} from "@/lib/portalAuth";

export type Result<T> =
  | { ok: true; data: T; count?: number }
  | { ok: false; error: string; status?: number };

export function currentUserId(): string | null {
  return loadSession()?.user_id ?? null;
}

/** Extract a human-readable message from a PostgREST/GoTrue error body. */
function errMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    for (const k of ["message", "msg", "error_description", "hint", "error"]) {
      if (typeof b[k] === "string" && b[k]) return b[k] as string;
    }
  }
  return fallback;
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

type RequestOpts = {
  method: "GET" | "POST" | "PATCH" | "HEAD";
  body?: unknown;
  /** Ask PostgREST for an exact row count (reads Content-Range). */
  count?: boolean;
  /** POST/PATCH: return the affected rows (Prefer: return=representation). */
  representation?: boolean;
};

async function request<T>(path: string, opts: RequestOpts, allowRetry = true): Promise<Result<T>> {
  if (!SUPABASE_CONFIGURED) {
    return { ok: false, error: "Portal is not configured (missing Supabase env vars).", status: 0 };
  }
  const session = await getValidSession();
  if (!session) return { ok: false, error: "not_authenticated", status: 401 };

  const prefer: string[] = [];
  if (opts.count) prefer.push("count=exact");
  if (opts.representation) prefer.push("return=representation");

  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}${path}`, {
      method: opts.method,
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
        ...(prefer.length ? { Prefer: prefer.join(",") } : {}),
        ...(opts.count ? { Range: "0-0", "Range-Unit": "items" } : {}),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch (e) {
    return { ok: false, error: String(e), status: 0 };
  }

  // Expired/revoked token → force one refresh, retry once.
  if (res.status === 401 && allowRetry) {
    const s = loadSession();
    const refreshed = s ? await refreshSession(s) : null;
    if (refreshed) return request<T>(path, opts, false);
    return { ok: false, error: "session_expired", status: 401 };
  }

  if (!res.ok) {
    const body = await parseBody(res);
    // تشخيص (Dev/Server logs فقط): أظهر خطأ PostgREST الكامل — SQLSTATE/message/details/hint —
    // بينما يبقى ما يراه المستخدم رسالةً عامة موجزة. لا نكشف تفاصيل PostgreSQL في الواجهة.
    if (body && typeof body === "object") {
      const b = body as Record<string, unknown>;
      console.error(`[portal] ${opts.method} ${path} → HTTP ${res.status}`, {
        code: b.code, message: b.message, details: b.details, hint: b.hint,
      });
    }
    return { ok: false, error: errMessage(body, `HTTP ${res.status}`), status: res.status };
  }

  let count: number | undefined;
  if (opts.count) {
    // Content-Range: "0-0/42" (or "*/0" when empty)
    const cr = res.headers.get("content-range");
    const total = cr?.split("/")[1];
    if (total && total !== "*") count = parseInt(total, 10);
  }

  const data = (res.status === 204 ? null : await parseBody(res)) as T;
  return count === undefined ? { ok: true, data } : { ok: true, data, count };
}

// ─── Public surface ────────────────────────────────────────────────────────

/** GET /rest/v1/<query>. `query` is the PostgREST path incl. filters. */
export function pget<T>(query: string, opts?: { count?: boolean }): Promise<Result<T>> {
  return request<T>(`/rest/v1/${query}`, { method: "GET", count: opts?.count });
}

/** POST /rest/v1/<table>. Returns inserted rows (return=representation). */
export function ppost<T>(query: string, body: unknown): Promise<Result<T>> {
  return request<T>(`/rest/v1/${query}`, { method: "POST", body, representation: true });
}

/** PATCH /rest/v1/<table>?<filters>. Returns affected rows. */
export function ppatch<T>(query: string, body: unknown): Promise<Result<T>> {
  return request<T>(`/rest/v1/${query}`, { method: "PATCH", body, representation: true });
}

/** POST /rest/v1/rpc/<fn>. Scalar/rows result, null for void functions. */
export function prpc<T>(fn: string, args?: Record<string, unknown>): Promise<Result<T>> {
  return request<T>(`/rest/v1/rpc/${fn}`, { method: "POST", body: args ?? {} });
}

/** Encode a value for use inside a PostgREST filter (eq.<value> etc.). */
export function enc(v: string): string {
  return encodeURIComponent(v);
}
