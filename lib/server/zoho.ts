// ════════════════════════════════════════════════════════════════════════
// Kian — Zoho CRM integration skeleton (Phase 7). SERVER-ONLY.
//
// Today this is a SAFE STUB: if the Zoho env vars are missing it logs a single
// server-side warning and returns { ok:false, skipped:true } WITHOUT throwing —
// so WhatsApp ingest is never blocked by CRM being unconfigured.
//
// When configured later, fill in the three TODO blocks in
// createOrUpdateZohoLeadFromWhatsApp(). The OAuth refresh-token flow + search/
// create/update calls are sketched but intentionally not wired to real network
// calls yet (per the "do not auto-call external CRM until reviewed" rule).
//
// Required env (NONE are NEXT_PUBLIC — never expose to the browser):
//   ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN,
//   ZOHO_ACCOUNTS_URL (e.g. https://accounts.zoho.com),
//   ZOHO_CRM_API_BASE (e.g. https://www.zohoapis.com/crm/v5)
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
}
export interface ZohoMessageInput {
  body: string | null;
}

export type ZohoLeadResult =
  | { ok: true; crm_lead_id: string }
  | { ok: false; skipped: true; reason: string }
  | { ok: false; skipped: false; error: string };

/**
 * Create or update a Zoho CRM lead from a WhatsApp conversation.
 *
 * STUB CONTRACT: never throws. On missing config returns {ok:false,skipped:true}.
 * Callers should treat any non-ok result as non-fatal (ingest must still succeed).
 */
export async function createOrUpdateZohoLeadFromWhatsApp(
  conversation: ZohoConversationInput,
  contact: ZohoContactInput,
  latestMessage: ZohoMessageInput,
): Promise<ZohoLeadResult> {
  const cfg = readZohoConfig();
  if (!cfg) {
    // Single, non-noisy server log. Never expose to the client.
    console.warn("[zoho] skipped: Zoho CRM env vars are not configured (lead sync disabled).");
    return { ok: false, skipped: true, reason: "not_configured" };
  }

  try {
    // ── TODO(1): exchange refresh token → short-lived access token ──
    //   POST `${cfg.accountsUrl}/oauth/v2/token`
    //     ?refresh_token=…&client_id=…&client_secret=…&grant_type=refresh_token
    //
    // ── TODO(2): search lead by phone ──
    //   GET `${cfg.apiBase}/Leads/search?criteria=(Phone:equals:${contact.phone})`
    //
    // ── TODO(3): create if missing / update if found ──
    //   POST/PUT `${cfg.apiBase}/Leads` with:
    //     Last_Name = contact.display_name || contact.wa_id
    //     Phone     = contact.phone
    //     Lead_Source = "WhatsApp"
    //     Service_Interest / Description = conversation.category + ai_summary + latest body
    //   then return the Zoho lead id so the route can persist it back onto
    //   whatsapp_contacts.crm_lead_id / whatsapp_conversations.crm_lead_id.
    //
    // Intentionally NOT performing live network calls yet (review-gated).
    console.warn("[zoho] configured but lead sync is not yet wired (review-gated). conversation:",
      conversation.id, "category:", conversation.category);
    return { ok: false, skipped: true, reason: "configured_but_not_wired" };
  } catch (e) {
    console.error("[zoho] lead sync failed (non-fatal):", e);
    return { ok: false, skipped: false, error: String(e) };
  }
}
