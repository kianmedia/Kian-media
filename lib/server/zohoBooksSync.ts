// ════════════════════════════════════════════════════════════════════════
// Kian — Zoho Books WRITE-SYNC client (Batch 8). SERVER-ONLY.
//
// كيان يدير التشغيل والاعتماد؛ Zoho Books هو السجل المحاسبي الرسمي.
// - أوضاع التشغيل: ZOHO_BOOKS_SYNC_MODE = disabled | dry_run | live (افتراضي disabled).
// - منع التكرار: reference_number = KIAN-… + فحص Zoho بالمرجع قبل أي إنشاء + الخرائط المحلية.
// - لا DELETE لقيود منشورة إطلاقًا. organization_id يُرسل مع كل طلب.
// - يتشارك OAuth مع تكامل Zoho القائم (fallback لأسماء env القديمة).
// - أخطاء منظّمة، لا أسرار في السجلات، Timeout + 429 backoff + تجديد التوكن على 401.
// (منفصل عن lib/server/zohoBooks.ts القائم الخاص بمسودات عروض الأسعار.)
// ════════════════════════════════════════════════════════════════════════

if (typeof window !== "undefined") {
  throw new Error("lib/server/zohoBooksSync must never be imported in the browser");
}

export type ZohoSyncMode = "disabled" | "dry_run" | "live";
export function zohoSyncMode(): ZohoSyncMode {
  const m = (process.env.ZOHO_BOOKS_SYNC_MODE ?? "disabled").toLowerCase();
  return m === "live" ? "live" : m === "dry_run" ? "dry_run" : "disabled";
}

interface BooksConfig { clientId: string; clientSecret: string; refreshToken: string; accountsUrl: string; apiBase: string; orgId: string }
export function readBooksConfig(): BooksConfig | null {
  const clientId = process.env.ZOHO_BOOKS_CLIENT_ID || process.env.ZOHO_CLIENT_ID || "";
  const clientSecret = process.env.ZOHO_BOOKS_CLIENT_SECRET || process.env.ZOHO_CLIENT_SECRET || "";
  const refreshToken = process.env.ZOHO_BOOKS_REFRESH_TOKEN || process.env.ZOHO_REFRESH_TOKEN || "";
  const orgId = process.env.ZOHO_BOOKS_ORGANIZATION_ID || process.env.ZOHO_ORGANIZATION_ID || "";
  const accountsUrl = (process.env.ZOHO_ACCOUNTS_BASE || process.env.ZOHO_ACCOUNTS_BASE_URL || process.env.ZOHO_ACCOUNTS_URL || "https://accounts.zoho.sa").replace(/\/+$/, "");
  const apiBase = (process.env.ZOHO_BOOKS_API_BASE || process.env.ZOHO_API_BASE_URL || "https://www.zohoapis.sa/books/v3").replace(/\/+$/, "");
  if (!clientId || !clientSecret || !refreshToken || !orgId) return null;
  return { clientId, clientSecret, refreshToken, accountsUrl, apiBase, orgId };
}
export function booksSyncConfigured(): boolean { return readBooksConfig() !== null; }

const log = (tag: string, extra: Record<string, unknown>) => console.log(JSON.stringify({ tag, ...extra }));

let _tok: string | null = null; let _base: string | null = null; let _exp = 0;
async function token(cfg: BooksConfig): Promise<{ tok: string; base: string }> {
  if (_tok && Date.now() < _exp - 5 * 60_000) return { tok: _tok, base: _base ?? cfg.apiBase };
  const u = new URL(`${cfg.accountsUrl}/oauth/v2/token`);
  u.searchParams.set("grant_type", "refresh_token");
  u.searchParams.set("client_id", cfg.clientId);
  u.searchParams.set("client_secret", cfg.clientSecret);
  u.searchParams.set("refresh_token", cfg.refreshToken);
  const res = await fetch(u.toString(), { method: "POST", cache: "no-store" });
  if (!res.ok) throw new Error(`token_http_${res.status}`);
  const j = (await res.json()) as { access_token?: string; api_domain?: string; expires_in?: number };
  if (!j.access_token) throw new Error("token_missing");
  _tok = j.access_token;
  _base = j.api_domain ? `${j.api_domain.replace(/\/+$/, "")}/books/v3` : cfg.apiBase;
  _exp = Date.now() + (j.expires_in ?? 3600) * 1000;
  return { tok: _tok, base: _base };
}

export interface BooksResult<T = Record<string, unknown>> { ok: boolean; status?: number; data?: T; error?: string }

/** طلب Books موقّع — Timeout 20s + 429 backoff + تجديد التوكن على 401. */
export async function booksFetch<T = Record<string, unknown>>(path: string, init?: RequestInit & { query?: Record<string, string> }): Promise<BooksResult<T>> {
  const cfg = readBooksConfig();
  if (!cfg) return { ok: false, error: "not_configured" };
  const doOnce = async (): Promise<Response> => {
    const { tok, base } = await token(cfg);
    const u = new URL(`${base}${path.startsWith("/") ? "" : "/"}${path}`);
    u.searchParams.set("organization_id", cfg.orgId);
    for (const [k, v] of Object.entries(init?.query ?? {})) u.searchParams.set(k, v);
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 20_000);
    try {
      return await fetch(u.toString(), {
        ...init,
        headers: { Authorization: `Zoho-oauthtoken ${tok}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
        cache: "no-store", signal: ctrl.signal,
      });
    } finally { clearTimeout(to); }
  };
  try {
    let res = await doOnce();
    if (res.status === 401) { _tok = null; res = await doOnce(); }
    if (res.status === 429) { await new Promise((r) => setTimeout(r, 3000)); res = await doOnce(); }
    const text = await res.text();
    let body: unknown = null; try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    if (!res.ok) {
      const msg = (body as { message?: string } | null)?.message ?? `http_${res.status}`;
      log("zoho_books_sync_error", { path: path.split("?")[0], status: res.status });
      return { ok: false, status: res.status, error: String(msg).slice(0, 200) };
    }
    return { ok: true, status: res.status, data: body as T };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 150) };
  }
}

/** بحث بالمرجع قبل الإنشاء — الدرع الثاني ضد التكرار (بعد الخرائط المحلية). */
export async function findByReference(entity: "expenses" | "bills" | "invoices" | "customerpayments" | "vendorpayments", reference: string): Promise<string | null> {
  const idKey: Record<string, string> = {
    expenses: "expense_id", bills: "bill_id", invoices: "invoice_id",
    customerpayments: "payment_id", vendorpayments: "payment_id",
  };
  const r = await booksFetch<Record<string, Array<Record<string, unknown>>>>(`/${entity}`, { method: "GET", query: { reference_number: reference } });
  if (!r.ok) return null;
  const arr = r.data?.[entity];
  if (Array.isArray(arr) && arr.length > 0) return String(arr[0][idKey[entity]] ?? "") || null;
  return null;
}

/** العميل/المورد: بحث بالبريد ثم الاسم؛ إنشاء عند الغياب. لا خلط Customer/Vendor. */
export async function ensureContact(kind: "customer" | "vendor", name: string, email?: string | null): Promise<BooksResult<{ contact_id: string }>> {
  const tryFind = async (query: Record<string, string>) => {
    const r = await booksFetch<{ contacts?: Array<{ contact_id: string }> }>(`/contacts`, { method: "GET", query: { ...query, contact_type: kind } });
    return r.ok && Array.isArray(r.data?.contacts) && r.data.contacts.length > 0 ? r.data.contacts[0].contact_id : null;
  };
  let id = email ? await tryFind({ email }) : null;
  if (!id) id = await tryFind({ contact_name: name });
  if (id) return { ok: true, data: { contact_id: id } };
  const c = await booksFetch<{ contact?: { contact_id: string } }>(`/contacts`, {
    method: "POST", body: JSON.stringify({ contact_name: name, contact_type: kind, ...(email ? { email } : {}) }),
  });
  if (c.ok && c.data?.contact?.contact_id) return { ok: true, data: { contact_id: c.data.contact.contact_id } };
  return { ok: false, error: c.error ?? "contact_create_failed" };
}

/** فحص الاتصال: المؤسسة الحالية. */
export async function testConnection(): Promise<BooksResult<{ organization_id: string; name: string }>> {
  const cfg = readBooksConfig();
  if (!cfg) return { ok: false, error: "not_configured" };
  const r = await booksFetch<{ organizations?: Array<{ organization_id: string; name: string }> }>(`/organizations`, { method: "GET" });
  if (!r.ok) return { ok: false, status: r.status, error: r.error };
  const org = (r.data?.organizations ?? []).find((o) => String(o.organization_id) === cfg.orgId) ?? r.data?.organizations?.[0];
  if (!org) return { ok: false, error: "org_not_found" };
  return { ok: true, data: { organization_id: String(org.organization_id), name: org.name } };
}

export async function listChartOfAccounts(): Promise<BooksResult<{ accounts: Array<{ account_id: string; account_name: string; account_type: string }> }>> {
  const r = await booksFetch<{ chartofaccounts?: Array<{ account_id: string; account_name: string; account_type: string }> }>(`/chartofaccounts`, { method: "GET" });
  if (!r.ok) return { ok: false, status: r.status, error: r.error };
  return { ok: true, data: { accounts: r.data?.chartofaccounts ?? [] } };
}
export async function listTaxes(): Promise<BooksResult<{ taxes: Array<{ tax_id: string; tax_name: string; tax_percentage: number }> }>> {
  const r = await booksFetch<{ taxes?: Array<{ tax_id: string; tax_name: string; tax_percentage: number }> }>(`/settings/taxes`, { method: "GET" });
  if (!r.ok) return { ok: false, status: r.status, error: r.error };
  return { ok: true, data: { taxes: r.data?.taxes ?? [] } };
}
