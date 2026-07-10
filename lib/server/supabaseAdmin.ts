// ════════════════════════════════════════════════════════════════════════
// Kian — SERVER-ONLY Supabase access with the service-role key.
//
// ⚠️ NEVER import this from a client component. The service-role key bypasses
// RLS and must never reach the browser. It is read from SUPABASE_SERVICE_ROLE_KEY
// (NOT prefixed NEXT_PUBLIC_), so Next.js will not inline it into client bundles;
// the runtime guard below is a second line of defence.
//
// Mirrors the rest of the codebase: raw PostgREST over fetch, no extra packages.
// ════════════════════════════════════════════════════════════════════════

if (typeof window !== "undefined") {
  throw new Error("lib/server/supabaseAdmin must never be imported in the browser");
}

const SUPABASE_URL = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/** True when the server can talk to Supabase with elevated privileges. */
export function adminConfigured(): boolean {
  return SUPABASE_URL.length > 0 && SERVICE_KEY.length > 0;
}

export type AdminResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status: number };

/**
 * Call a Postgres function via PostgREST RPC as the service_role.
 * Used by the n8n ingest route to invoke public.whatsapp_ingest_message(...).
 */
export async function rpcAsService<T>(fn: string, args: Record<string, unknown>): Promise<AdminResult<T>> {
  if (!adminConfigured()) {
    return { ok: false, error: "server_supabase_not_configured", status: 500 };
  }
  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
      cache: "no-store",
    });
  } catch (e) {
    return { ok: false, error: String(e), status: 502 };
  }

  const text = await res.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }

  if (!res.ok) {
    const msg = (body && typeof body === "object" && "message" in (body as Record<string, unknown>))
      ? String((body as Record<string, unknown>).message)
      : `HTTP ${res.status}`;
    return { ok: false, error: msg, status: res.status };
  }
  return { ok: true, data: body as T };
}

/** Read rows via PostgREST as the service_role (bypasses RLS). Server-only.
 *  Use sparingly and never return service-role data straight to a client. */
export async function selectAsService<T>(query: string): Promise<AdminResult<T>> {
  if (!adminConfigured()) return { ok: false, error: "server_supabase_not_configured", status: 500 };
  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1/${query}`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      cache: "no-store",
    });
  } catch (e) {
    return { ok: false, error: String(e), status: 502 };
  }
  const text = await res.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, status: res.status };
  return { ok: true, data: body as T };
}

/** Return the AUTHENTICATED user's own id from their JWT via GoTrue /auth/v1/user
 *  (SERVER-ONLY). Immune to RLS/profiles-policy quirks — the token identifies itself,
 *  so admin callers resolve to THEIR OWN id (not an arbitrary profiles row). */
export async function authGetUserId(bearer: string): Promise<string | null> {
  if (SUPABASE_URL.length === 0 || ANON_KEY.length === 0 || !bearer) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${bearer}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const u = (await res.json()) as { id?: string };
    return u && typeof u.id === "string" ? u.id : null;
  } catch { return null; }
}

/** Resolve emails from auth.users by user_id via the Supabase Auth Admin API
 *  (service-role, SERVER-ONLY). Field staff often have an email in auth.users but
 *  NOT in public.profiles, so HR task-assignment mail must resolve here. Returns a
 *  { user_id: email } map; ids that fail/have no email are simply omitted. Never
 *  log the returned emails — callers log counts only. */
export async function authAdminEmails(ids: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (!adminConfigured()) return out;
  const uniqueIds = Array.from(new Set(ids.filter((x) => !!x)));
  await Promise.all(uniqueIds.map(async (id) => {
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(id)}`, {
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
        cache: "no-store",
      });
      if (!res.ok) return;
      const u = (await res.json()) as { email?: string | null };
      if (u && typeof u.email === "string" && u.email.includes("@")) out[id] = u.email;
    } catch { /* omit on failure — never blocks the dispatch */ }
  }));
  return out;
}

/** Read rows via PostgREST AS THE LOGGED-IN USER (their JWT) — RLS applies, so the
 *  query only returns rows that user may see. Used to confirm a staff member can
 *  actually read a quote row before acting on it server-side. */
export async function selectAsUser<T>(query: string, bearer: string): Promise<AdminResult<T>> {
  if (SUPABASE_URL.length === 0 || ANON_KEY.length === 0) {
    return { ok: false, error: "server_supabase_not_configured", status: 500 };
  }
  if (!bearer) return { ok: false, error: "missing_bearer", status: 401 };
  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1/${query}`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${bearer}` },
      cache: "no-store",
    });
  } catch (e) {
    return { ok: false, error: String(e), status: 502 };
  }
  const text = await res.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, status: res.status };
  return { ok: true, data: body as T };
}

/**
 * Call a Postgres function via PostgREST RPC AS THE LOGGED-IN USER (their JWT),
 * so RLS + the function's internal role guards apply exactly as in the browser.
 * The anon key is the public apikey; `bearer` is the user's access token. This
 * never uses the service-role key — authorization is enforced by the database.
 */
export async function rpcAsUser<T>(fn: string, args: Record<string, unknown>, bearer: string): Promise<AdminResult<T>> {
  if (SUPABASE_URL.length === 0 || ANON_KEY.length === 0) {
    return { ok: false, error: "server_supabase_not_configured", status: 500 };
  }
  if (!bearer) return { ok: false, error: "missing_bearer", status: 401 };
  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${bearer}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
      cache: "no-store",
    });
  } catch (e) {
    return { ok: false, error: String(e), status: 502 };
  }
  const text = await res.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    const msg = (body && typeof body === "object" && "message" in (body as Record<string, unknown>))
      ? String((body as Record<string, unknown>).message)
      : `HTTP ${res.status}`;
    return { ok: false, error: msg, status: res.status };
  }
  return { ok: true, data: body as T };
}
