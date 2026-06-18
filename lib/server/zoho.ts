// ════════════════════════════════════════════════════════════════════════
// Kian — Zoho CRM (.sa) lead sync. SERVER-ONLY.
//
// Idempotent Lead upsert-by-phone against the Saudi Arabia data center. Safe by
// contract: if the ZOHO_* env vars are missing it returns {ok:false,skipped:true}
// WITHOUT throwing, and any runtime error is caught — so WhatsApp ingest is never
// blocked by CRM. Nothing here is ever imported by client code (window guard +
// non-NEXT_PUBLIC env). Secrets (tokens, client secret) are NEVER logged.
//
// Region (.sa):
//   ZOHO_ACCOUNTS_URL = https://accounts.zoho.sa        (OAuth — no "www")
//   ZOHO_CRM_API_BASE = https://www.zohoapis.sa/crm/v5  (fallback; the token
//                       response's api_domain is preferred at runtime, "www")
// Auth header for CRM calls is `Zoho-oauthtoken <token>` (NOT Bearer).
// ════════════════════════════════════════════════════════════════════════

if (typeof window !== "undefined") {
  throw new Error("lib/server/zoho must never be imported in the browser");
}

export interface ZohoConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  accountsUrl: string;
  apiBase: string;
}

export function readZohoConfig(): ZohoConfig | null {
  const clientId = process.env.ZOHO_CLIENT_ID ?? "";
  const clientSecret = process.env.ZOHO_CLIENT_SECRET ?? "";
  const refreshToken = process.env.ZOHO_REFRESH_TOKEN ?? "";
  const accountsUrl = (process.env.ZOHO_ACCOUNTS_URL ?? "").replace(/\/+$/, "");
  const apiBase = (process.env.ZOHO_CRM_API_BASE ?? "").replace(/\/+$/, "");
  if (!clientId || !clientSecret || !refreshToken || !accountsUrl || !apiBase) return null;
  return { clientId, clientSecret, refreshToken, accountsUrl, apiBase };
}

export function zohoConfigured(): boolean {
  return readZohoConfig() !== null;
}

// Minimal shapes the caller hands us (kept local so this file has no app deps).
export interface ZohoContactInput {
  wa_id: string;
  phone: string | null;
  display_name: string | null;
}
export interface ZohoConversationInput {
  id: string;
  category: string;
  ai_summary: string | null;
  /** Pipeline stage → Lead_Status. Omit to leave the lead's status untouched. */
  sales_stage?: string;
}
export interface ZohoMessageInput {
  body: string | null;
}

export type ZohoLeadResult =
  | { ok: true; crm_lead_id: string; action: "insert" | "update" }
  | { ok: false; skipped: true; reason: string }
  | { ok: false; skipped: false; error: string };

// ─── Token cache (module scope; per serverless instance) ─────────────────────
let _accessToken: string | null = null;
let _apiDomain: string | null = null;
let _expiresAtMs = 0;

function resetTokenCache() { _accessToken = null; _apiDomain = null; _expiresAtMs = 0; }

interface ZohoToken { accessToken: string; apiBase: string }

async function getAccessToken(cfg: ZohoConfig): Promise<ZohoToken> {
  const now = Date.now();
  if (_accessToken && now < _expiresAtMs - 5 * 60_000) {
    return { accessToken: _accessToken, apiBase: _apiDomain ?? cfg.apiBase };
  }
  const url = new URL(`${cfg.accountsUrl}/oauth/v2/token`);
  url.searchParams.set("grant_type", "refresh_token");
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("client_secret", cfg.clientSecret);
  url.searchParams.set("refresh_token", cfg.refreshToken);

  const res = await fetch(url.toString(), { method: "POST", cache: "no-store" });
  if (!res.ok) throw new Error(`zoho_token_http_${res.status}`); // never log the body
  const json = (await res.json()) as { access_token?: string; api_domain?: string; expires_in?: number };
  if (!json.access_token) throw new Error("zoho_token_no_access_token");

  _accessToken = json.access_token;
  _apiDomain = json.api_domain ? `${json.api_domain.replace(/\/+$/, "")}/crm/v5` : cfg.apiBase;
  _expiresAtMs = now + (json.expires_in ?? 3600) * 1000;
  return { accessToken: _accessToken, apiBase: _apiDomain };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
/** Canonical +E.164 from the WhatsApp wa_id (clean MSISDN) or a fallback phone. */
export function normalizePhone(waId: string, phone: string | null): string {
  const raw = (waId || phone || "").trim();
  const digits = raw.replace(/[^\d]/g, "");
  return digits ? `+${digits}` : "";
}

/** Portal sales_stage → Zoho Lead_Status. null ⇒ omit the field (safer than an
 *  unknown picklist value, which Zoho rejects with INVALID_DATA). */
export function mapStageToLeadStatus(stage: string | undefined): string | null {
  if (!stage) return null;
  const m: Record<string, string> = {
    new: "Not Contacted",
    collecting: "Attempted to Contact",
    quote_requested: "Contacted",
    awaiting_sales_review: "Pre-Qualified",
    quote_sent: "Contacted",          // upgrade to "Quote Sent" if the owner adds it
    follow_up: "Contact in Future",
    converted: "Pre-Qualified",       // upgrade to "Converted" if the owner adds it
    rejected: "Lost Lead",
  };
  return m[stage] ?? null;
}

interface UpsertOutcome { id: string; action: "insert" | "update" }

async function upsertLead(apiBase: string, token: string, record: Record<string, unknown>): Promise<UpsertOutcome> {
  const res = await fetch(`${apiBase}/Leads/upsert`, {
    method: "POST",
    headers: { Authorization: `Zoho-oauthtoken ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ data: [record], duplicate_check_fields: ["Phone"], trigger: ["workflow"] }),
    cache: "no-store",
  });
  if (res.status === 401) throw new Error("INVALID_TOKEN");
  if (!res.ok) throw new Error(`zoho_upsert_http_${res.status}`);
  const json = (await res.json()) as {
    data?: Array<{ status?: string; code?: string; action?: string; details?: { id?: string } }>;
  };
  const row = json.data?.[0];
  if (row?.status !== "success" || !row.details?.id) {
    throw new Error(`zoho_upsert_${row?.code ?? "unknown"}`);
  }
  return { id: row.details.id, action: (row.action as "insert" | "update") ?? "update" };
}

function buildRecord(c: ZohoConversationInput, ct: ZohoContactInput, m: ZohoMessageInput): Record<string, unknown> {
  const record: Record<string, unknown> = {
    Last_Name: ct.display_name || ct.wa_id,
    Phone: normalizePhone(ct.wa_id, ct.phone),
    Lead_Source: "WhatsApp",
    Description: c.ai_summary || m.body || "",
  };
  const status = mapStageToLeadStatus(c.sales_stage);
  if (status) record.Lead_Status = status; // omit when unknown
  return record;
}

/**
 * Create or update a Zoho CRM lead from a WhatsApp conversation. NEVER throws.
 * Idempotent on Phone (Zoho upsert with duplicate_check_fields=["Phone"]).
 */
export async function createOrUpdateZohoLeadFromWhatsApp(
  conversation: ZohoConversationInput,
  contact: ZohoContactInput,
  latestMessage: ZohoMessageInput,
): Promise<ZohoLeadResult> {
  const cfg = readZohoConfig();
  if (!cfg) {
    console.warn("[zoho] skipped: ZOHO_* env not configured (lead sync disabled).");
    return { ok: false, skipped: true, reason: "not_configured" };
  }

  const phone = normalizePhone(contact.wa_id, contact.phone);
  if (!phone) return { ok: false, skipped: true, reason: "no_phone" };

  const record = buildRecord(conversation, contact, latestMessage);

  // One retry on an expired/invalid token: clear cache, refresh, try again.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { accessToken, apiBase } = await getAccessToken(cfg);
      const out = await upsertLead(apiBase, accessToken, record);
      return { ok: true, crm_lead_id: out.id, action: out.action };
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      if (msg === "INVALID_TOKEN" && attempt === 0) { resetTokenCache(); continue; }
      // Log the reason code/status only — never tokens or request bodies.
      console.error("[zoho] lead sync failed (non-fatal):", msg);
      return { ok: false, skipped: false, error: msg };
    }
  }
  return { ok: false, skipped: false, error: "zoho_unreachable" };
}
