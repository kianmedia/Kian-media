// ════════════════════════════════════════════════════════════════════════
// Kian — Zoho Books ESTIMATES integration. SERVER-ONLY. Zoho Books is the source
// of truth for official quotes/proposals; the portal mirrors them.
//
// Capabilities (require these OAuth scopes on the refresh token):
//   ZohoBooks.contacts.READ, ZohoBooks.contacts.CREATE,
//   ZohoBooks.estimates.READ, ZohoBooks.estimates.CREATE, ZohoBooks.estimates.UPDATE
// NO invoice write scopes are needed or used.
//
// Safety: creates a DRAFT estimate only — it is NEVER emailed/sent to the customer
// here (admin approval + an explicit "mark sent" action controls that). Fails
// gracefully (configured:false) when env is missing. Tokens are never logged.
//
// Env (spec names; fall back to the existing ZOHO_BOOKS_* / ZOHO_ACCOUNTS_URL):
//   ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN, ZOHO_ORGANIZATION_ID,
//   ZOHO_API_BASE_URL (=…/books/v3), ZOHO_ACCOUNTS_BASE_URL (=accounts.zoho.sa).
// ════════════════════════════════════════════════════════════════════════

if (typeof window !== "undefined") {
  throw new Error("lib/server/zohoBooksEstimates must never be imported in the browser");
}

interface Cfg { clientId: string; clientSecret: string; refreshToken: string; accountsUrl: string; apiBase: string; orgId: string; }

function readCfg(): Cfg | null {
  const clientId = process.env.ZOHO_CLIENT_ID ?? "";
  const clientSecret = process.env.ZOHO_CLIENT_SECRET ?? "";
  const refreshToken = process.env.ZOHO_REFRESH_TOKEN ?? "";
  const orgId = process.env.ZOHO_ORGANIZATION_ID || process.env.ZOHO_BOOKS_ORGANIZATION_ID || "";
  const accountsUrl = (process.env.ZOHO_ACCOUNTS_BASE_URL || process.env.ZOHO_ACCOUNTS_URL || "https://accounts.zoho.sa").replace(/\/+$/, "");
  const apiBase = (process.env.ZOHO_API_BASE_URL || process.env.ZOHO_BOOKS_API_BASE || "https://www.zohoapis.sa/books/v3").replace(/\/+$/, "");
  if (!clientId || !clientSecret || !refreshToken || !orgId) return null;
  return { clientId, clientSecret, refreshToken, accountsUrl, apiBase, orgId };
}
export function estimatesConfigured(): boolean { return readCfg() !== null; }

let _token: string | null = null, _apiDomain: string | null = null, _exp = 0;
function resetToken() { _token = null; _apiDomain = null; _exp = 0; }
async function getToken(cfg: Cfg): Promise<{ token: string; base: string }> {
  const now = Date.now();
  if (_token && now < _exp - 5 * 60_000) return { token: _token, base: _apiDomain ?? cfg.apiBase };
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
  _exp = now + (j.expires_in ?? 3600) * 1000;
  return { token: _token, base: _apiDomain };
}
const headers = (t: string) => ({ Authorization: `Zoho-oauthtoken ${t}`, "Content-Type": "application/json" });
const digits = (s: string) => (s || "").replace(/[^\d]/g, "");

// ─── Suggested line items from requested services (proposed; price = review) ───
const SERVICE_PACKAGES: Record<string, { ar: string; en: string }> = {
  "Corporate Films": { ar: "باقة فيلم مؤسسي", en: "Corporate film package" },
  "Documentary Films": { ar: "باقة فيلم وثائقي", en: "Documentary package" },
  "Live Streaming": { ar: "باقة بث مباشر", en: "Live streaming package" },
  "Drone Filming": { ar: "تصوير بالدرون", en: "Drone filming" },
  "Video Editing": { ar: "مونتاج وما بعد الإنتاج", en: "Post-production / editing" },
  "Product Photography": { ar: "تصوير منتجات", en: "Product photography" },
  "Short Reels": { ar: "باقة ريلز قصيرة", en: "Short reels package" },
  "Real Estate Media": { ar: "باقة تصوير عقاري", en: "Real estate media package" },
};
export interface EstLine { name: string; description?: string; rate: number; quantity: number; }
export function suggestedLineItems(services: string[]): EstLine[] {
  const list = (services || []).filter(Boolean);
  const out: EstLine[] = list.map((s) => {
    const pkg = SERVICE_PACKAGES[s];
    return { name: pkg ? `${pkg.en} (${pkg.ar})` : s, description: "Requires pricing review — يتطلب مراجعة التسعير", rate: 0, quantity: 1 };
  });
  if (out.length === 0) out.push({ name: "Production services", description: "Requires pricing review", rate: 0, quantity: 1 });
  return out;
}

export interface NormalizedEstimate {
  zohoEstimateId: string; zohoCustomerId: string; estimateNumber: string; status: string;
  currency: string; subtotal: number; vat: number; total: number; estimateUrl: string | null;
  lineItems: { title: string; description: string; quantity: number; unit_price: number; total: number }[];
  raw: Record<string, unknown>;
}

async function call(method: "GET" | "POST", url: string, token: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(url, { method, headers: headers(token), cache: "no-store", ...(body ? { body: JSON.stringify(body) } : {}) });
  if (res.status === 401) throw new Error("INVALID_TOKEN");
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

function normalize(cfg: Cfg, inv: Record<string, unknown>): NormalizedEstimate {
  const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : 0);
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const eid = str(inv.estimate_id);
  const items = (inv.line_items as Array<Record<string, unknown>> | undefined) ?? [];
  return {
    zohoEstimateId: eid, zohoCustomerId: str(inv.customer_id), estimateNumber: str(inv.estimate_number),
    status: str(inv.status) || "draft", currency: str(inv.currency_code) || "SAR",
    subtotal: num(inv.sub_total), vat: num(inv.tax_total), total: num(inv.total),
    estimateUrl: eid ? `https://books.zoho.sa/app/${cfg.orgId}#/estimates/${eid}` : null,
    lineItems: items.map((li) => ({
      title: str(li.name) || "-", description: str(li.description), quantity: num(li.quantity) || 1,
      unit_price: num(li.rate), total: num(li.item_total),
    })),
    raw: inv,
  };
}

export type EstimateResult<T> = { ok: true; configured: true; data: T } | { ok: false; configured: boolean; reason: string };

async function withToken<T>(fn: (cfg: Cfg, token: string, base: string) => Promise<T>): Promise<EstimateResult<T>> {
  const cfg = readCfg();
  if (!cfg) return { ok: false, configured: false, reason: "zoho_not_configured" };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { token, base } = await getToken(cfg);
      return { ok: true, configured: true, data: await fn(cfg, token, base) };
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      if (msg === "INVALID_TOKEN" && attempt === 0) { resetToken(); continue; }
      console.error("[zoho/estimates] failed:", msg);
      return { ok: false, configured: true, reason: msg };
    }
  }
  return { ok: false, configured: true, reason: "books_unreachable" };
}

/** Find a Zoho contact by email, else CREATE one. Returns contact_id. */
async function findOrCreateContact(base: string, token: string, org: string, c: { email: string; name?: string; company?: string; phone?: string }): Promise<string> {
  const found = await call("GET", `${base}/contacts?organization_id=${encodeURIComponent(org)}&email=${encodeURIComponent(c.email)}`, token);
  const rows = (found.json.contacts as Array<{ contact_id?: string }> | undefined) ?? [];
  if (rows[0]?.contact_id) return rows[0].contact_id;
  const person: Record<string, unknown> = {};
  if (c.name) { const p = c.name.trim().split(/\s+/); person.first_name = p[0]; if (p.length > 1) person.last_name = p.slice(1).join(" "); }
  if (c.email) person.email = c.email;
  if (c.phone) person.phone = digits(c.phone);
  const body: Record<string, unknown> = { contact_name: c.company || c.name || c.email };
  if (c.company) body.company_name = c.company;
  if (Object.keys(person).length) body.contact_persons = [person];
  const made = await call("POST", `${base}/contacts?organization_id=${encodeURIComponent(org)}`, token, body);
  const id = (made.json.contact as { contact_id?: string } | undefined)?.contact_id;
  if (!id) throw new Error(`books_contact_http_${made.status}`);
  return id;
}

/** Create a DRAFT estimate for the customer (matched/created by email). Never sent. */
export function createDraftEstimateForCustomer(input: {
  email: string; name?: string; company?: string; phone?: string;
  lineItems: EstLine[]; referenceNumber?: string; notes?: string;
}): Promise<EstimateResult<NormalizedEstimate>> {
  return withToken(async (cfg, token, base) => {
    const org = cfg.orgId;
    const customerId = await findOrCreateContact(base, token, org, input);
    const lines = (input.lineItems.length ? input.lineItems : suggestedLineItems([])).map((l) => ({
      name: l.name, description: l.description || undefined, rate: Number(l.rate) || 0, quantity: Number(l.quantity) || 1,
    }));
    const body: Record<string, unknown> = { customer_id: customerId, line_items: lines };
    if (input.referenceNumber) body.reference_number = input.referenceNumber;
    if (input.notes) body.notes = input.notes;
    const res = await call("POST", `${base}/estimates?organization_id=${encodeURIComponent(org)}`, token, body);
    const est = res.json.estimate as Record<string, unknown> | undefined;
    if (res.json.code !== 0 || !est?.estimate_id) throw new Error(`books_estimate_http_${res.status}_${res.json.code ?? "x"}`);
    return normalize(cfg, est);
  });
}

/** READ one estimate (re-sync). */
export function getEstimate(estimateId: string): Promise<EstimateResult<NormalizedEstimate>> {
  return withToken(async (cfg, token, base) => {
    const res = await call("GET", `${base}/estimates/${encodeURIComponent(estimateId)}?organization_id=${encodeURIComponent(cfg.orgId)}`, token);
    const est = res.json.estimate as Record<string, unknown> | undefined;
    if (!est?.estimate_id) throw new Error(`books_estimate_http_${res.status}`);
    return normalize(cfg, est);
  });
}

/** Fetch the official Zoho Books estimate PDF as raw bytes (for authorized portal streaming).
 *  Uses a raw fetch (not the JSON call() helper) so we read the binary body. Needs only
 *  the existing estimates.READ scope. */
export function fetchEstimatePdf(estimateId: string): Promise<EstimateResult<{ bytes: ArrayBuffer; filename: string }>> {
  return withToken(async (cfg, token, base) => {
    const url = `${base}/estimates/${encodeURIComponent(estimateId)}?organization_id=${encodeURIComponent(cfg.orgId)}&accept=pdf`;
    const res = await fetch(url, { method: "GET", headers: { Authorization: `Zoho-oauthtoken ${token}`, Accept: "application/pdf" }, cache: "no-store" });
    if (res.status === 401) throw new Error("INVALID_TOKEN");
    if (!res.ok) throw new Error(`books_estimate_pdf_http_${res.status}`);
    return { bytes: await res.arrayBuffer(), filename: `estimate-${estimateId}.pdf` };
  });
}

/** Mark an estimate sent / accepted / declined in Zoho (status sync). */
export function markEstimateStatus(estimateId: string, action: "sent" | "accepted" | "declined"): Promise<EstimateResult<{ status: string }>> {
  return withToken(async (cfg, token, base) => {
    const res = await call("POST", `${base}/estimates/${encodeURIComponent(estimateId)}/status/${action}?organization_id=${encodeURIComponent(cfg.orgId)}`, token);
    if (res.json.code !== 0) throw new Error(`books_status_http_${res.status}_${res.json.code ?? "x"}`);
    return { status: action };
  });
}

// ─── Official tax invoice creation from an accepted estimate (invoices.CREATE) ──
export interface NormalizedInvoice {
  zohoInvoiceId: string; zohoCustomerId: string; invoiceNumber: string; status: string;
  currency: string; subtotal: number; vat: number; total: number; dueDate: string | null; pdfUrl: string | null;
  lineItems: { title: string; description: string; quantity: number; unit_price: number; total: number }[];
}
function normalizeInvoice(cfg: Cfg, inv: Record<string, unknown>): NormalizedInvoice {
  const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : 0);
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const iid = str(inv.invoice_id);
  const items = (inv.line_items as Array<Record<string, unknown>> | undefined) ?? [];
  return {
    zohoInvoiceId: iid, zohoCustomerId: str(inv.customer_id), invoiceNumber: str(inv.invoice_number),
    status: str(inv.status) || "sent", currency: str(inv.currency_code) || "SAR",
    subtotal: num(inv.sub_total), vat: num(inv.tax_total), total: num(inv.total),
    dueDate: /^\d{4}-\d{2}-\d{2}/.test(str(inv.due_date)) ? str(inv.due_date).slice(0, 10) : null,
    pdfUrl: iid ? `https://books.zoho.sa/app/${cfg.orgId}#/invoices/${iid}` : null,
    lineItems: items.map((li) => ({ title: str(li.name) || "-", description: str(li.description), quantity: num(li.quantity) || 1, unit_price: num(li.rate), total: num(li.item_total) })),
  };
}

/** Create an official tax invoice from an ACCEPTED estimate (reads the estimate for
 *  customer + line items, then POST /invoices). Requires ZohoBooks.invoices.CREATE.
 *  Draft estimates with no priced items will produce an empty/zero invoice → callers
 *  should only invoke this for a priced, accepted estimate. */
export function createInvoiceFromEstimate(estimateId: string): Promise<EstimateResult<NormalizedInvoice>> {
  return withToken(async (cfg, token, base) => {
    const org = cfg.orgId;
    const er = await call("GET", `${base}/estimates/${encodeURIComponent(estimateId)}?organization_id=${encodeURIComponent(org)}`, token);
    const est = er.json.estimate as Record<string, unknown> | undefined;
    if (!est?.estimate_id) throw new Error(`books_estimate_http_${er.status}`);
    const customerId = typeof est.customer_id === "string" ? est.customer_id : "";
    if (!customerId) throw new Error("estimate_has_no_customer");
    const lines = ((est.line_items as Array<Record<string, unknown>> | undefined) ?? []).map((li) => ({
      name: typeof li.name === "string" ? li.name : "-",
      description: typeof li.description === "string" ? li.description : undefined,
      rate: typeof li.rate === "number" ? li.rate : Number(li.rate) || 0,
      quantity: typeof li.quantity === "number" ? li.quantity : Number(li.quantity) || 1,
    }));
    const body: Record<string, unknown> = { customer_id: customerId, line_items: lines };
    if (typeof est.estimate_number === "string") body.reference_number = est.estimate_number;
    const res = await call("POST", `${base}/invoices?organization_id=${encodeURIComponent(org)}`, token, body);
    const inv = res.json.invoice as Record<string, unknown> | undefined;
    if (res.json.code !== 0 || !inv?.invoice_id) throw new Error(`books_invoice_http_${res.status}_${res.json.code ?? "x"}`);
    return normalizeInvoice(cfg, inv);
  });
}
