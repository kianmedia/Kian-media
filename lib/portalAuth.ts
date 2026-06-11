// ════════════════════════════════════════════════════════════════════════
// Kian Media — Client Portal: Supabase connection (REST, no extra packages)
//
// ⚠️ املأ القيمتين التاليتين من Supabase → Project Settings → API:
//    1) SUPABASE_URL  = "https://gmqpkbrlwmkkylarbcqi.supabase.co/rest/v1/";
//    2) SUPABASE_KEY  = "sb_publishable_9jh0CE30Z-9wGevHmVx5SQ_7uv3pz-6";
//
// المفتاح العام آمن للعرض في المتصفح لأن الحماية الفعلية في
// Row Level Security داخل قاعدة البيانات (كل عميل يرى بياناته فقط).
// ════════════════════════════════════════════════════════════════════════

export const SUPABASE_URL = "PASTE_YOUR_PROJECT_URL_HERE";   // مثال: https://abcdefgh.supabase.co
export const SUPABASE_KEY = "PASTE_YOUR_PUBLISHABLE_KEY_HERE";

// ─── Types ───
export type Session = {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch seconds
  user_id: string;
  email: string;
};

export type ClientRow = {
  id: string;
  full_name: string;
  company: string | null;
  mobile: string | null;
  email: string;
};

export type ProjectRow = {
  id: string;
  project_name: string;
  status: string;
  shooting_date: string | null;
  delivery_status: string | null;
  revision_status: string | null;
  download_url: string | null;
  notes: string | null;
  created_at: string;
};

const LS_KEY = "kian_portal_session";

// ─── Session storage ───
export function saveSession(s: Session) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch {}
}
export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch { return null; }
}
export function clearSession() {
  try { localStorage.removeItem(LS_KEY); } catch {}
}

// ─── Auth: email + password login ───
export async function login(email: string, password: string): Promise<{ ok: boolean; session?: Session; error?: string }> {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { ok: false, error: data?.error_description || data?.msg || "Invalid credentials" };
    }
    const session: Session = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + (data.expires_in || 3600) - 60,
      user_id: data.user?.id || "",
      email: data.user?.email || email,
    };
    saveSession(session);
    return { ok: true, session };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// ─── Auth: refresh an expired session ───
export async function refreshSession(s: Session): Promise<Session | null> {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY },
      body: JSON.stringify({ refresh_token: s.refresh_token }),
    });
    const data = await res.json();
    if (!res.ok) return null;
    const ns: Session = {
      access_token: data.access_token,
      refresh_token: data.refresh_token || s.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + (data.expires_in || 3600) - 60,
      user_id: data.user?.id || s.user_id,
      email: data.user?.email || s.email,
    };
    saveSession(ns);
    return ns;
  } catch { return null; }
}

// Get a valid session (refresh if expired), or null
export async function getValidSession(): Promise<Session | null> {
  const s = loadSession();
  if (!s) return null;
  if (Math.floor(Date.now() / 1000) < s.expires_at) return s;
  return await refreshSession(s);
}

// ─── Data: fetch the logged-in client's record ───
export async function fetchClient(s: Session): Promise<ClientRow | null> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/clients?select=id,full_name,company,mobile,email&user_id=eq.${s.user_id}`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${s.access_token}` } }
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as ClientRow[];
    return rows[0] || null;
  } catch { return null; }
}

// ─── Data: fetch the client's projects ───
export async function fetchProjects(s: Session, clientId: string): Promise<ProjectRow[]> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/projects?select=*&client_id=eq.${clientId}&order=created_at.desc`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${s.access_token}` } }
    );
    if (!res.ok) return [];
    return (await res.json()) as ProjectRow[];
  } catch { return []; }
}

export function logout() {
  clearSession();
}
