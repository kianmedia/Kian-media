// SERVER-ONLY: POST upsert عبر PostgREST بمفتاح الخدمة (لخرائط Zoho).
if (typeof window !== "undefined") throw new Error("server-only");
const SUPABASE_URL = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
export async function postAsService(query: string, body: Record<string, unknown>, headers: Record<string, string> = {}): Promise<{ ok: boolean; error?: string }> {
  if (!SUPABASE_URL || !SERVICE_KEY) return { ok: false, error: "not_configured" };
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${query}`, {
      method: "POST",
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body), cache: "no-store",
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true };
  } catch (e) { return { ok: false, error: String(e).slice(0, 120) }; }
}
