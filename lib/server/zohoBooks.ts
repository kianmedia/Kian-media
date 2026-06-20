// ════════════════════════════════════════════════════════════════════════
// Kian — Zoho Books (.sa) DRAFT estimate creation. SERVER-ONLY.
//
// Creates a DRAFT Estimate (عرض سعر / تقدير) only. It NEVER:
//   • sends the estimate to the customer (no /status/sent, no /email)
//   • creates an invoice or a ZATCA e-invoice
// Hard-gated: returns null config unless ZOHO_BOOKS_ESTIMATES_ENABLED=true, and
// createDraftEstimate THROWS if ZOHO_BOOKS_ESTIMATE_DRAFT_ONLY is not "true".
//
// OAuth reuses the shared Zoho .sa app (accounts.zoho.sa) — the refresh token's
// scope must include ZohoBooks.estimates.CREATE + ZohoBooks.contacts.* . Region
// API base defaults to https://www.zohoapis.sa/books/v3 (override ZOHO_BOOKS_API_BASE).
// Secrets are NEVER logged — only safe tags + HTTP status.
// ════════════════════════════════════════════════════════════════════════

if (typeof window !== "undefined") {
  throw new Error("lib/server/zohoBooks must never be imported in the browser");
}

export function booksFeatureEnabled(): boolean {
  return process.env.ZOHO_BOOKS_ESTIMATES_ENABLED === "true";
}
export function booksDraftOnly(): boolean {
  // Fail-safe: anything other than an explicit "false" means draft-only.
  return process.env.ZOHO_BOOKS_ESTIMATE_DRAFT_ONLY !== "false";
}

export interface ZohoBooksConfig {
  clientId: string; clientSecret: string; refreshToken: string;
  accountsUrl: string; apiBase: string; orgId: string; vatTaxId: string | null;
}

export function readBooksConfig(): ZohoBooksConfig | null {
  const clientId = process.env.ZOHO_CLIENT_ID ?? "";
  const clientSecret = process.env.ZOHO_CLIENT_SECRET ?? "";
  const refreshToken = process.env.ZOHO_REFRESH_TOKEN ?? "";
  const accountsUrl = (process.env.ZOHO_ACCOUNTS_URL ?? "").replace(/\/+$/, "");
  const apiBase = (process.env.ZOHO_BOOKS_API_BASE ?? "https://www.zohoapis.sa/books/v3").replace(/\/+$/, "");
  const orgId = process.env.ZOHO_BOOKS_ORGANIZATION_ID ?? "";
  const vatTaxId = process.env.ZOHO_BOOKS_VAT_TAX_ID || null;
  if (!clientId || !clientSecret || !refreshToken || !accountsUrl || !orgId) return null;
  return { clientId, clientSecret, refreshToken, accountsUrl, apiBase, orgId, vatTaxId };
}

export function booksConfigured(): boolean { return readBooksConfig() !== null; }

// ─── Token cache (separate from the CRM client) ──────────────────────────────
let _token: string | null = null;
let _apiDomain: string | null = null;
let _expiresAtMs = 0;
function resetToken() { _token = null; _apiDomain = null; _expiresAtMs = 0; }

async function getAccessToken(cfg: ZohoBooksConfig): Promise<{ token: string; base: string }> {
  const now = Date.now();
  if (_token && now < _expiresAtMs - 5 * 60_000) return { token: _token, base: _apiDomain ?? cfg.apiBase };
  const url = new URL(`${cfg.accountsUrl}/oauth/v2/token`);
  url.searchParams.set("grant_type", "refresh_token");
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("client_secret", cfg.clientSecret);
  url.searchParams.set("refresh_token", cfg.refreshToken);
  const res = await fetch(url.toString(), { method: "POST", cache: "no-store" });
  if (!res.ok) throw new Error(`books_token_http_${res.status}`);
  const json = (await res.json()) as { access_token?: string; api_domain?: string; expires_in?: number };
  if (!json.access_token) throw new Error("books_token_no_access_token");
  _token = json.access_token;
  _apiDomain = json.api_domain ? `${json.api_domain.replace(/\/+$/, "")}/books/v3` : cfg.apiBase;
  _expiresAtMs = now + (json.expires_in ?? 3600) * 1000;
  return { token: _token, base: _apiDomain };
}

const authHeaders = (token: string) => ({ Authorization: `Zoho-oauthtoken ${token}`, "Content-Type": "application/json" });
const digits = (s: string) => (s || "").replace(/[^\d]/g, "");

// ─── Contact (customer) match-or-create — NOT an invoice ─────────────────────
async function findContactId(base: string, token: string, orgId: string, email: string, phone: string): Promise<string | null> {
  const tryQuery = async (qs: string): Promise<string | null> => {
    const res = await fetch(`${base}/contacts?organization_id=${encodeURIComponent(orgId)}&${qs}`, {
      method: "GET", headers: authHeaders(token), cache: "no-store",
    });
    if (res.status === 401) throw new Error("INVALID_TOKEN");
    if (!res.ok) return null;
    const j = (await res.json()) as { contacts?: Array<{ contact_id?: string }> };
    return j.contacts?.[0]?.contact_id ?? null;
  };
  if (email) { const id = await tryQuery(`email=${encodeURIComponent(email)}`); if (id) return id; }
  if (phone) { const id = await tryQuery(`phone=${encodeURIComponent(phone)}`); if (id) return id; }
  return null;
}

async function createContact(base: string, token: string, orgId: string, name: string, company: string, email: string, phone: string): Promise<string> {
  const body: Record<string, unknown> = { contact_name: company || name || "WhatsApp Lead" };
  if (company) body.company_name = company;
  const person: Record<string, unknown> = {};
  if (name) { const parts = name.trim().split(/\s+/); person.first_name = parts[0]; if (parts.length > 1) person.last_name = parts.slice(1).join(" "); }
  if (email) person.email = email;
  if (phone) person.phone = phone;
  if (Object.keys(person).length) body.contact_persons = [person];
  const res = await fetch(`${base}/contacts?organization_id=${encodeURIComponent(orgId)}`, {
    method: "POST", headers: authHeaders(token), cache: "no-store", body: JSON.stringify(body),
  });
  if (res.status === 401) throw new Error("INVALID_TOKEN");
  const j = (await res.json()) as { contact?: { contact_id?: string }; message?: string };
  if (!res.ok || !j.contact?.contact_id) throw new Error(`books_contact_http_${res.status}`);
  return j.contact.contact_id;
}

export interface BooksEstimateLine { name: string; description?: string; quantity: number; rate: number; }
export interface BooksEstimateInput {
  customerName: string; company?: string; email?: string; phone?: string;
  lineItems: BooksEstimateLine[]; vatPercent?: number; discountPercent?: number;
  notes?: string; terms?: string; referenceNumber?: string;
}
export interface BooksEstimateResult {
  estimateId: string; estimateNumber: string; status: string; total: number; currency: string; url: string;
}

/** Create a DRAFT estimate. THROWS if draft-only guard is off. NEVER sends/emails. */
export async function createDraftEstimate(input: BooksEstimateInput): Promise<BooksEstimateResult> {
  if (!booksDraftOnly()) throw new Error("books_draft_only_guard"); // refuse non-draft modes outright
  const cfg = readBooksConfig();
  if (!cfg) throw new Error("books_not_configured");

  const lines = (input.lineItems || []).filter((l) => l && l.name && Number(l.quantity) > 0).map((l) => {
    const item: Record<string, unknown> = { name: l.name, rate: Number(l.rate) || 0, quantity: Number(l.quantity) || 1 };
    if (l.description) item.description = l.description;
    if (cfg.vatTaxId && Number(input.vatPercent) > 0) item.tax_id = cfg.vatTaxId; // only if org has a configured VAT tax
    return item;
  });
  if (lines.length === 0) throw new Error("books_no_line_items");

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { token, base } = await getAccessToken(cfg);
      const email = (input.email || "").trim();
      const phone = digits(input.phone || "");
      let contactId = await findContactId(base, token, cfg.orgId, email, phone);
      if (!contactId) contactId = await createContact(base, token, cfg.orgId, input.customerName, input.company || "", email, phone);

      const body: Record<string, unknown> = { customer_id: contactId, line_items: lines };
      if (input.referenceNumber) body.reference_number = input.referenceNumber;
      if (input.notes) body.notes = input.notes;
      if (input.terms) body.terms = input.terms;
      if (Number(input.discountPercent) > 0) { body.discount = `${Number(input.discountPercent)}%`; body.is_discount_before_tax = true; }

      // Default status for a freshly created estimate IS "draft". Do NOT send_to=true / no email.
      const res = await fetch(`${base}/estimates?organization_id=${encodeURIComponent(cfg.orgId)}`, {
        method: "POST", headers: authHeaders(token), cache: "no-store", body: JSON.stringify(body),
      });
      if (res.status === 401 && attempt === 0) { resetToken(); continue; }
      const j = (await res.json()) as { code?: number; message?: string; estimate?: { estimate_id?: string; estimate_number?: string; status?: string; total?: number; currency_code?: string } };
      if (!res.ok || j.code !== 0 || !j.estimate?.estimate_id) throw new Error(`books_estimate_http_${res.status}_${j.code ?? "x"}`);
      const e = j.estimate;
      return {
        estimateId: e.estimate_id!, estimateNumber: e.estimate_number || "",
        status: e.status || "draft", total: Number(e.total) || 0, currency: e.currency_code || "SAR",
        url: `https://books.zoho.sa/app/${cfg.orgId}#/estimates/${e.estimate_id}`,
      };
    } catch (err) {
      const msg = String((err as Error)?.message ?? err);
      if (msg === "INVALID_TOKEN" && attempt === 0) { resetToken(); continue; }
      throw err;
    }
  }
  throw new Error("books_unreachable");
}
