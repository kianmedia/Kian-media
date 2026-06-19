// ════════════════════════════════════════════════════════════════════════
// Kian — Zoho CRM (.sa) lead sync. SERVER-ONLY.
//
// ONE phone number = ONE Zoho Lead. Dedup strategy (does NOT rely on /upsert):
//   1. If we already know the crm_lead_id → UPDATE that lead by id.
//   2. Else SEARCH existing leads by normalized phone VARIANTS across Phone+Mobile.
//   3. If a match is found → UPDATE it. Only CREATE when nothing matches.
// Idempotent; never creates duplicates even if the Zoho Phone field isn't unique.
//
// Safe by contract: missing env or no phone → {skipped}, any error → caught and
// returned (never throws) so WhatsApp ingest is never blocked. Secrets are NEVER
// logged — only safe tags + reason codes/HTTP status.
//
// Region (.sa): accounts.zoho.sa (OAuth) + www.zohoapis.sa (API; preferred from
// the token response's api_domain). Auth header: `Zoho-oauthtoken <token>`.
// ════════════════════════════════════════════════════════════════════════

if (typeof window !== "undefined") {
  throw new Error("lib/server/zoho must never be imported in the browser");
}

export interface ZohoConfig {
  clientId: string; clientSecret: string; refreshToken: string; accountsUrl: string; apiBase: string;
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

export function zohoConfigured(): boolean { return readZohoConfig() !== null; }

export interface ZohoContactInput { wa_id: string; phone: string | null; display_name: string | null; }
export interface ZohoConversationInput {
  id: string; category: string; ai_summary: string | null;
  sales_stage?: string;
  /** When known, we update this lead directly (no search) — strongest dedupe. */
  crm_lead_id?: string | null;
}
export interface ZohoMessageInput { body: string | null; }

export type ZohoLeadResult =
  | { ok: true; crm_lead_id: string; action: "insert" | "update" }
  | { ok: false; skipped: true; reason: string }
  | { ok: false; skipped: false; error: string };

// ─── Token cache ─────────────────────────────────────────────────────────────
let _accessToken: string | null = null;
let _apiDomain: string | null = null;
let _expiresAtMs = 0;
function resetTokenCache() { _accessToken = null; _apiDomain = null; _expiresAtMs = 0; }

async function getAccessToken(cfg: ZohoConfig): Promise<{ accessToken: string; apiBase: string }> {
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
  if (!res.ok) throw new Error(`zoho_token_http_${res.status}`);
  const json = (await res.json()) as { access_token?: string; api_domain?: string; expires_in?: number };
  if (!json.access_token) throw new Error("zoho_token_no_access_token");
  _accessToken = json.access_token;
  _apiDomain = json.api_domain ? `${json.api_domain.replace(/\/+$/, "")}/crm/v5` : cfg.apiBase;
  _expiresAtMs = now + (json.expires_in ?? 3600) * 1000;
  return { accessToken: _accessToken, apiBase: _apiDomain };
}

// ─── Phone helpers ───────────────────────────────────────────────────────────
/** Canonical +E.164 (used as the primary stored Phone). */
export function normalizePhone(waId: string, phone: string | null): string {
  const digits = (waId || phone || "").replace(/[^\d]/g, "");
  return digits ? `+${digits}` : "";
}

/** Search variants to catch leads saved in any common format / field.
 *  e.g. wa_id 9665XXXXXXXX → ["+9665XXXXXXXX","9665XXXXXXXX","05XXXXXXXX", raw…]. */
export function phoneVariants(waId: string, phone: string | null): string[] {
  const out = new Set<string>();
  const digits = (waId || "").replace(/[^\d]/g, "");
  if (digits) {
    out.add(`+${digits}`);
    out.add(digits);
    if (digits.startsWith("966") && digits.length > 3) out.add(`0${digits.slice(3)}`); // national 05…
  }
  const pDigits = (phone || "").replace(/[^\d]/g, "");
  if (pDigits) {
    out.add(`+${pDigits}`);
    out.add(pDigits);
    if (pDigits.startsWith("966") && pDigits.length > 3) out.add(`0${pDigits.slice(3)}`);
  }
  // Digit-only / +digit forms only — no raw free text (keeps the Zoho search
  // criteria well-formed; phone equals-search already over-matches).
  return Array.from(out).filter((v) => /^\+?\d{6,}$/.test(v));
}

/** Portal sales_stage → Zoho Lead_Status. null ⇒ omit (avoids INVALID_DATA). */
export function mapStageToLeadStatus(stage: string | undefined): string | null {
  if (!stage) return null;
  const m: Record<string, string> = {
    new: "Not Contacted", collecting: "Attempted to Contact", quote_requested: "Contacted",
    awaiting_sales_review: "Pre-Qualified", quote_sent: "Contacted",
    follow_up: "Contact in Future", converted: "Pre-Qualified", rejected: "Lost Lead",
  };
  return m[stage] ?? null;
}

function buildRecord(c: ZohoConversationInput, ct: ZohoContactInput, m: ZohoMessageInput): Record<string, unknown> {
  const record: Record<string, unknown> = {
    Last_Name: ct.display_name || ct.wa_id,
    Phone: normalizePhone(ct.wa_id, ct.phone),
    Lead_Source: "WhatsApp",
    Description: c.ai_summary || m.body || "",
  };
  const status = mapStageToLeadStatus(c.sales_stage);
  if (status) record.Lead_Status = status;
  return record;
}

// ─── CRM calls (throw 'INVALID_TOKEN' on 401 so the caller can refresh + retry) ─
async function searchLeadByPhone(apiBase: string, token: string, variants: string[]): Promise<string | null> {
  if (variants.length === 0) return null;
  const clauses = variants.flatMap((v) => [`(Phone:equals:${v})`, `(Mobile:equals:${v})`]);
  const criteria = `(${clauses.join("or")})`;
  const res = await fetch(`${apiBase}/Leads/search?criteria=${encodeURIComponent(criteria)}`, {
    method: "GET", headers: { Authorization: `Zoho-oauthtoken ${token}` }, cache: "no-store",
  });
  if (res.status === 204) return null;          // no match
  if (res.status === 401) throw new Error("INVALID_TOKEN");
  if (!res.ok) throw new Error(`zoho_search_http_${res.status}`);
  const json = (await res.json()) as { data?: Array<{ id?: string }> };
  return json.data?.[0]?.id ?? null;
}

async function createLead(apiBase: string, token: string, record: Record<string, unknown>): Promise<{ id: string; created: boolean }> {
  const res = await fetch(`${apiBase}/Leads`, {
    method: "POST",
    headers: { Authorization: `Zoho-oauthtoken ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ data: [record], trigger: ["workflow"] }), cache: "no-store",
  });
  if (res.status === 401) throw new Error("INVALID_TOKEN");
  if (res.status !== 202 && !res.ok) throw new Error(`zoho_create_http_${res.status}`);
  const json = (await res.json()) as {
    data?: Array<{ status?: string; code?: string; details?: { id?: string; duplicate_record?: { id?: string } } }>;
  };
  const row = json.data?.[0];
  // Race / Phone-unique: a concurrent create loses → Zoho returns DUPLICATE_DATA
  // with the existing lead id. Treat it as a found-existing (no duplicate created).
  if (row?.code === "DUPLICATE_DATA") {
    const dupId = row.details?.duplicate_record?.id ?? row.details?.id;
    if (dupId) return { id: dupId, created: false };
  }
  if (row?.status !== "success" || !row.details?.id) throw new Error(`zoho_create_${row?.code ?? "unknown"}`);
  return { id: row.details.id, created: true };
}

async function updateLead(apiBase: string, token: string, id: string, record: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${apiBase}/Leads/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { Authorization: `Zoho-oauthtoken ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ data: [record], trigger: ["workflow"] }), cache: "no-store",
  });
  if (res.status === 401) throw new Error("INVALID_TOKEN");
  if (!res.ok) throw new Error(`zoho_update_http_${res.status}`);
  const json = (await res.json()) as { data?: Array<{ status?: string; code?: string }> };
  const row = json.data?.[0];
  if (row && row.status !== "success") throw new Error(`zoho_update_${row.code ?? "unknown"}`);
}

/**
 * Create or update a Zoho CRM lead from a WhatsApp conversation. NEVER throws.
 * Guarantees one Lead per phone via known-id → search → create/update.
 */
export async function createOrUpdateZohoLeadFromWhatsApp(
  conversation: ZohoConversationInput,
  contact: ZohoContactInput,
  latestMessage: ZohoMessageInput,
): Promise<ZohoLeadResult> {
  const cfg = readZohoConfig();
  if (!cfg) {
    console.log("[zoho] zoho_sync_skipped reason=not_configured");
    return { ok: false, skipped: true, reason: "not_configured" };
  }
  const phone = normalizePhone(contact.wa_id, contact.phone);
  if (!phone) {
    console.log("[zoho] zoho_sync_skipped reason=no_phone");
    return { ok: false, skipped: true, reason: "no_phone" };
  }

  const record = buildRecord(conversation, contact, latestMessage);
  const variants = phoneVariants(contact.wa_id, contact.phone);

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { accessToken, apiBase } = await getAccessToken(cfg);

      // 1) Known lead id → update directly (strongest dedupe).
      if (conversation.crm_lead_id && conversation.crm_lead_id.trim()) {
        await updateLead(apiBase, accessToken, conversation.crm_lead_id.trim(), record);
        console.log(`[zoho] zoho_lead_updated id=${conversation.crm_lead_id} via=known_id`);
        return { ok: true, crm_lead_id: conversation.crm_lead_id.trim(), action: "update" };
      }

      // 2) Search existing by phone variants (Phone + Mobile).
      const foundId = await searchLeadByPhone(apiBase, accessToken, variants);
      if (foundId) {
        console.log(`[zoho] zoho_existing_lead_found id=${foundId}`);
        await updateLead(apiBase, accessToken, foundId, record);
        console.log(`[zoho] zoho_lead_updated id=${foundId} zoho_duplicate_prevented`);
        return { ok: true, crm_lead_id: foundId, action: "update" };
      }

      // 3) No match → create. If a concurrent create won the race (DUPLICATE_DATA),
      //    Zoho returns the existing id → update it instead of duplicating.
      const created = await createLead(apiBase, accessToken, record);
      if (!created.created) {
        await updateLead(apiBase, accessToken, created.id, record);
        console.log(`[zoho] zoho_existing_lead_found id=${created.id} zoho_duplicate_prevented via=create_race`);
        return { ok: true, crm_lead_id: created.id, action: "update" };
      }
      console.log(`[zoho] zoho_lead_created id=${created.id}`);
      return { ok: true, crm_lead_id: created.id, action: "insert" };
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      if (msg === "INVALID_TOKEN" && attempt === 0) { resetTokenCache(); continue; }
      console.error("[zoho] zoho_sync_failed_non_blocking reason=" + msg);
      return { ok: false, skipped: false, error: msg };
    }
  }
  console.error("[zoho] zoho_sync_failed_non_blocking reason=unreachable");
  return { ok: false, skipped: false, error: "zoho_unreachable" };
}
