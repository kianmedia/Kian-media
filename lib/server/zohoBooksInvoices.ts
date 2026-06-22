// ════════════════════════════════════════════════════════════════════════
// Kian — Zoho Books INVOICE READ/SYNC foundation. SERVER-ONLY, READ-ONLY.
//
// Reads invoices for a customer (matched by email) from Zoho Books so they can be
// mirrored into the portal's invoices table as read-only display records. It does
// NOT create, send, edit, or void anything in Zoho — only GET requests.
//
// Env (spec names, with fallback to the existing ZOHO_BOOKS_* names so either set
// works): ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN,
// ZOHO_ORGANIZATION_ID, ZOHO_API_BASE_URL, ZOHO_ACCOUNTS_BASE_URL.
// Fails gracefully (configured:false) when anything required is missing.
// ════════════════════════════════════════════════════════════════════════

if (typeof window !== "undefined") {
  throw new Error("lib/server/zohoBooksInvoices must never be imported in the browser");
}

interface SyncConfig { clientId: string; clientSecret: string; refreshToken: string; accountsUrl: string; apiBase: string; orgId: string; }

function readSyncConfig(): SyncConfig | null {
  const clientId = process.env.ZOHO_CLIENT_ID ?? "";
  const clientSecret = process.env.ZOHO_CLIENT_SECRET ?? "";
  const refreshToken = process.env.ZOHO_REFRESH_TOKEN ?? "";
  const orgId = process.env.ZOHO_ORGANIZATION_ID || process.env.ZOHO_BOOKS_ORGANIZATION_ID || "";
  const accountsUrl = (process.env.ZOHO_ACCOUNTS_BASE_URL || process.env.ZOHO_ACCOUNTS_URL || "https://accounts.zoho.sa").replace(/\/+$/, "");
  const apiBase = (process.env.ZOHO_API_BASE_URL || process.env.ZOHO_BOOKS_API_BASE || "https://www.zohoapis.sa/books/v3").replace(/\/+$/, "");
  if (!clientId || !clientSecret || !refreshToken || !orgId) return null;
  return { clientId, clientSecret, refreshToken, accountsUrl, apiBase, orgId };
}

export function invoiceSyncConfigured(): boolean { return readSyncConfig() !== null; }

let _token: string | null = null;
let _apiDomain: string | null = null;
let _expiresAtMs = 0;
function resetToken() { _token = null; _apiDomain = null; _expiresAtMs = 0; }

async function getToken(cfg: SyncConfig): Promise<{ token: string; base: string }> {
  const now = Date.now();
  if (_token && now < _expiresAtMs - 5 * 60_000) return { token: _token, base: _apiDomain ?? cfg.apiBase };
  const url = new URL(`${cfg.accountsUrl}/oauth/v2/token`);
  url.searchParams.set("grant_type", "refresh_token");
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("client_secret", cfg.clientSecret);
  url.searchParams.set("refresh_token", cfg.refreshToken);
  const res = await fetch(url.toString(), { method: "POST", cache: "no-store" });
  if (!res.ok) throw new Error(`books_token_http_${res.status}`);
  const j = (await res.json()) as { access_token?: string; api_domain?: string; expires_in?: number };
  if (!j.access_token) throw new Error("books_token_no_access_token");
  _token = j.access_token;
  _apiDomain = j.api_domain ? `${j.api_domain.replace(/\/+$/, "")}/books/v3` : cfg.apiBase;
  _expiresAtMs = now + (j.expires_in ?? 3600) * 1000;
  return { token: _token, base: _apiDomain };
}
const authHeaders = (t: string) => ({ Authorization: `Zoho-oauthtoken ${t}`, "Content-Type": "application/json" });

export interface SyncedInvoice {
  zohoInvoiceId: string; zohoCustomerId: string; invoiceNumber: string; status: string;
  currency: string; subtotal: number; vat: number; total: number; dueDate: string | null; pdfUrl: string | null;
}
export type InvoiceSyncResult =
  | { ok: true; configured: true; customerId: string | null; invoices: SyncedInvoice[] }
  | { ok: false; configured: boolean; reason: string };

async function getJson(url: string, token: string): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(url, { method: "GET", headers: authHeaders(token), cache: "no-store" });
  if (res.status === 401) throw new Error("INVALID_TOKEN");
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

/** READ Zoho Books invoices for the customer matching `email`. Never writes to Zoho. */
export async function syncInvoicesByEmail(email: string): Promise<InvoiceSyncResult> {
  const cfg = readSyncConfig();
  if (!cfg) return { ok: false, configured: false, reason: "zoho_not_configured" };
  const e = (email || "").trim();
  if (!e) return { ok: false, configured: true, reason: "email_required" };

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { token, base } = await getToken(cfg);
      const org = encodeURIComponent(cfg.orgId);
      // 1) Find the Zoho contact (customer) by email.
      const contacts = await getJson(`${base}/contacts?organization_id=${org}&email=${encodeURIComponent(e)}`, token);
      const contactRows = (contacts.json.contacts as Array<{ contact_id?: string }> | undefined) ?? [];
      const customerId = contactRows[0]?.contact_id ?? null;
      if (!customerId) return { ok: true, configured: true, customerId: null, invoices: [] };

      // 2) List that customer's invoices (cap to keep the sync bounded).
      const list = await getJson(`${base}/invoices?organization_id=${org}&customer_id=${encodeURIComponent(customerId)}&per_page=50`, token);
      const listRows = (list.json.invoices as Array<{ invoice_id?: string }> | undefined) ?? [];

      // 3) Detail per invoice → subtotal/tax/total/url (READ-only GETs).
      const invoices: SyncedInvoice[] = [];
      for (const row of listRows.slice(0, 50)) {
        const iid = row.invoice_id;
        if (!iid) continue;
        const det = await getJson(`${base}/invoices/${encodeURIComponent(iid)}?organization_id=${org}`, token);
        const inv = (det.json.invoice as Record<string, unknown> | undefined) ?? (row as Record<string, unknown>);
        const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : 0);
        const str = (v: unknown) => (typeof v === "string" ? v : "");
        invoices.push({
          zohoInvoiceId: str(inv.invoice_id) || iid,
          zohoCustomerId: str(inv.customer_id) || customerId,
          invoiceNumber: str(inv.invoice_number),
          status: str(inv.status) || "sent",
          currency: str(inv.currency_code) || "SAR",
          subtotal: num(inv.sub_total),
          vat: num(inv.tax_total),
          total: num(inv.total),
          dueDate: /^\d{4}-\d{2}-\d{2}/.test(str(inv.due_date)) ? str(inv.due_date).slice(0, 10) : null,
          pdfUrl: str(inv.invoice_url) || null,
        });
      }
      return { ok: true, configured: true, customerId, invoices };
    } catch (err) {
      const msg = String((err as Error)?.message ?? err);
      if (msg === "INVALID_TOKEN" && attempt === 0) { resetToken(); continue; }
      console.error("[zoho/invoice-sync] failed:", msg);
      return { ok: false, configured: true, reason: msg };
    }
  }
  return { ok: false, configured: true, reason: "books_unreachable" };
}
