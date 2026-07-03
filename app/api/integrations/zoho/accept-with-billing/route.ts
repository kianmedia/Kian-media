// ════════════════════════════════════════════════════════════════════════
// POST /api/integrations/zoho/accept-with-billing   (SERVER-ONLY, client owner)
//
// The e-invoice acceptance gate. Works for a quote the client sees only by EMAIL
// match (public/guest origin, quotes.client_id NULL, no clients row yet):
//   step auth          — decode + VALIDATE the JWT (as-user RLS query) → auth uid + email
//   step resolve_quote  — load the quote AS THE USER (RLS) → proves ownership/visibility
//   step prepare_client — portal_prepare_quote_accept_client_v1: verify ownership + ensure the
//                         caller's OWN clients row via a SECURITY DEFINER RPC that returns
//                         STRUCTURED JSON (never a raw throw), so an internal DB error can't be
//                         mislabeled "function not found". The clients table has no direct write grant.
//   step save_billing  — upsert_client_billing_profile (client row now exists → succeeds)
//   step zoho_contact  — create/UPDATE the Zoho Books contact
//   step accept_quote  — accept_quote_with_billing_profile (requires a synced Zoho contact)
//
// Never accepts unless ownership + billing + Zoho all succeed. Never returns HTTP 200
// on failure. Structured per-step logs (never tokens/secrets). No invoice, no email/WhatsApp.
// ════════════════════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { rpcAsUser, rpcAsService, selectAsUser, adminConfigured } from "@/lib/server/supabaseAdmin";
import { estimatesConfigured, upsertContactBilling } from "@/lib/server/zohoBooksEstimates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const orNull = (v: unknown) => { const s = str(v); return s === "" ? null : s; };
const maskEmail = (e: string) => { const [l, d] = (e || "").split("@"); return d ? `${(l || "").slice(0, 2)}***@${d}` : "***"; };
// ONLY a genuine "PostgREST can't find this function" — NOT any error whose text
// happens to contain "does not exist"/"schema cache" (those can come from inside a
// function and must NOT be mislabeled as sql_not_run).
const isMissingFn = (e: string) => /PGRST202|could not find the function .* in the schema cache/i.test(e || "");
// Read sub/email claims WITHOUT trusting them yet — verified below by an as-user query
// PostgREST authenticates (bad signature → 401; RLS own-profile returns a row only when
// auth.uid() equals the claimed sub).
function jwtClaims(bearer: string): { sub: string; email: string } {
  try {
    const p = bearer.split(".")[1] || "";
    const j = JSON.parse(Buffer.from(p.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as { sub?: string; email?: string };
    return { sub: typeof j.sub === "string" ? j.sub : "", email: typeof j.email === "string" ? j.email : "" };
  } catch { return { sub: "", email: "" }; }
}

interface ProfileCtx {
  profile_id?: string; client_id?: string; customer_type?: string; zoho_customer_id?: string | null;
  name?: string | null; contact_person?: string | null; email?: string | null; phone?: string | null;
  vat_number?: string | null; cr_number?: string | null; city?: string | null; country?: string | null;
  building_number?: string | null; street?: string | null; district?: string | null;
  postal_code?: string | null; additional_number?: string | null;
}
interface QuoteRow { id: string; client_id: string | null; email: string | null; quote_number: string | null; total: number | null; public_portal_visible: boolean | null; status: string | null; billing_profile_id: string | null }

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  let quoteId = "";
  const log = (step: string, extra: Record<string, unknown> = {}) =>
    console.log(JSON.stringify({ tag: "accept-with-billing", step, quote_id: quoteId, ...extra }));
  const fail = (step: string, code: string, status: number, extra: Record<string, unknown> = {}) => {
    log(step, { code, ...extra });
    // `step`/`detail` are safe diagnostics (no tokens/secrets) surfaced to the UI too.
    return NextResponse.json({ ok: false, step, code, ...extra }, { status });
  };

  if (!bearer) return fail("auth", "not_authenticated", 401, { detail: "no_bearer" });

  let b: Record<string, unknown>;
  try { b = (await req.json()) as Record<string, unknown>; } catch { return fail("parse", "invalid_json", 400); }
  quoteId = str(b.quote_id);
  const customerType = str(b.customer_type) === "business" ? "business" : "individual";
  if (!quoteId) return fail("parse", "quote_id_required", 400);

  // The server needs the service-role key to record the Zoho sync (service-only RPC).
  if (!adminConfigured()) return fail("config", "missing_service_role_env", 500);

  // ── step auth: decode JWT sub/email, then VALIDATE via an as-user RLS query ──
  const claims = jwtClaims(bearer);
  if (!claims.sub) return fail("auth", "not_authenticated", 401, { detail: "no_sub" });
  const me = await selectAsUser<{ id: string; email: string | null }[]>(`profiles?id=eq.${encodeURIComponent(claims.sub)}&select=id,email&limit=1`, bearer);
  const authUid = me.ok ? (me.data[0]?.id ?? "") : "";
  const email = (me.ok ? (me.data[0]?.email ?? "") : (claims.email || "")).trim();
  if (!authUid) return fail("auth", "not_authenticated", 401, { detail: me.ok ? "no_profile" : me.error });
  log("auth", { auth_user_id: authUid, email: maskEmail(email) });

  // ── step resolve_quote: load the quote AS THE USER (RLS proves ownership/visibility) ──
  const qr = await selectAsUser<QuoteRow[]>(`quotes?id=eq.${encodeURIComponent(quoteId)}&is_deleted=eq.false&select=id,client_id,email,quote_number,total,public_portal_visible,status,billing_profile_id`, bearer);
  if (!qr.ok) return fail("resolve_quote", "quote_read_failed", 502, { detail: qr.error });
  const quote = qr.data[0];
  if (!quote) return fail("resolve_quote", "not_owner", 403, { detail: "not_visible_to_user" });
  log("resolve_quote", { quote_number: quote.quote_number, quote_client_id: quote.client_id, email_linked: !!quote.email });

  // ── route-side billing validation (the RPC re-validates authoritatively) ──
  const missing = customerType === "individual"
    ? (!orNull(b.full_name) ? "individual_name_required" : (!orNull(b.email) && !orNull(b.phone) ? "individual_contact_required" : null))
    : (!orNull(b.legal_name) ? "business_legal_name_required"
      : !orNull(b.vat_number) ? "business_vat_required"
      : (!orNull(b.building_number) || !orNull(b.street) || !orNull(b.district) || !orNull(b.city) || !orNull(b.postal_code)) ? "business_address_required" : null);
  if (missing) return fail("validate", missing, 400);

  // ── step prepare_client: verify ownership + ensure the caller's OWN clients row via a
  //    purpose-specific SECURITY DEFINER RPC that RETURNS STRUCTURED JSON (never a raw
  //    throw). So the only thing isMissingFn can catch here is a genuinely missing RPC. ──
  const pc = await rpcAsUser<{ ok?: boolean; client_id?: string; ownership_mode?: string; code?: string; message?: string; sqlstate?: string }>(
    "portal_prepare_quote_accept_client_v1", { p_quote_id: quoteId }, bearer);
  if (!pc.ok) {
    // Transport-level failure (function missing / PostgREST error).
    if (isMissingFn(pc.error || "")) return fail("prepare_client", "sql_not_run", 503, { detail: pc.error });
    return fail("prepare_client", "prepare_client_failed", 500, { detail: pc.error });
  }
  const prep = pc.data || {};
  if (!prep.ok || !prep.client_id) {
    const c = prep.code || "prepare_client_failed";
    const status = c === "not_authenticated" ? 401 : c === "not_owner" ? 403 : c === "quote_missing" ? 404 : 500;
    return fail("prepare_client", c, status, { detail: prep.message || prep.sqlstate });
  }
  log("prepare_client", { client_id: prep.client_id, ownership_mode: prep.ownership_mode });

  // ── step save_billing_profile: runs as the user; the clients row now exists ──
  const up = await rpcAsUser<ProfileCtx>("upsert_client_billing_profile", {
    p_quote: quoteId, p_type: customerType,
    p_full_name: orNull(b.full_name), p_email: orNull(b.email), p_phone: orNull(b.phone),
    p_city: orNull(b.city), p_country: orNull(b.country), p_notes: orNull(b.notes),
    p_legal_name: orNull(b.legal_name), p_contact_person: orNull(b.contact_person),
    p_vat_number: orNull(b.vat_number), p_cr_number: orNull(b.cr_number),
    p_po_reference: orNull(b.po_reference), p_finance_email: orNull(b.finance_email),
    p_building_number: orNull(b.building_number), p_street: orNull(b.street), p_district: orNull(b.district),
    p_postal_code: orNull(b.postal_code), p_additional_number: orNull(b.additional_number),
  }, bearer);
  if (!up.ok) {
    const e = up.error || "";
    if (isMissingFn(e)) return fail("save_billing_profile", "sql_not_run", 503, { detail: e });
    const code = /individual_name/.test(e) ? "individual_name_required"
      : /individual_contact/.test(e) ? "individual_contact_required"
      : /business_legal_name/.test(e) ? "business_legal_name_required"
      : /business_vat/.test(e) ? "business_vat_required"
      : /business_address/.test(e) ? "business_address_required" : null;
    if (code) return fail("save_billing_profile", code, 400, { detail: e });
    if (/not_owner/.test(e)) return fail("save_billing_profile", "not_owner", 403, { detail: e });
    if (/no_client_context/.test(e)) return fail("save_billing_profile", "no_client_context", 500, { detail: e });
    return fail("save_billing_profile", "billing_save_failed", 500, { detail: e });
  }
  const p = up.data || {};
  if (!p.profile_id) return fail("save_billing_profile", "billing_save_failed", 500, { detail: "no_profile" });
  log("save_billing_profile", { profile_id: p.profile_id, client_id: p.client_id });

  // ── step zoho_contact: Zoho must be configured; create/UPDATE the contact ──
  if (!estimatesConfigured()) {
    await rpcAsService("set_billing_profile_zoho", { p_profile: p.profile_id, p_customer_id: null, p_status: "failed", p_error: "zoho_not_configured" }).catch(() => undefined);
    return fail("zoho_contact", "not_configured", 502, { detail: "zoho_not_configured" });
  }
  const zc = await upsertContactBilling({
    zohoCustomerId: p.zoho_customer_id ?? null, customerType,
    name: p.name || p.contact_person || p.email || "Customer",
    contactPerson: p.contact_person ?? null, email: p.email ?? null, phone: p.phone ?? null,
    vatNumber: p.vat_number ?? null, crNumber: p.cr_number ?? null,
    buildingNumber: p.building_number ?? null, street: p.street ?? null, district: p.district ?? null,
    city: p.city ?? null, postalCode: p.postal_code ?? null, additionalNumber: p.additional_number ?? null,
    country: p.country ?? null,
  });
  if (!zc.ok) {
    await rpcAsService("set_billing_profile_zoho", { p_profile: p.profile_id, p_customer_id: null, p_status: "failed", p_error: zc.reason }).catch(() => undefined);
    const scopeIssue = /401|403|scope|permission|invalid_token|unauthor/i.test(zc.reason);
    return fail("zoho_contact", scopeIssue ? "zoho_scope" : "zoho_failed", 502, { detail: zc.reason });
  }
  log("zoho_contact", { zoho_customer_id: zc.data.customerId });

  // ── step accept_quote: record sync, then mark accepted (gate requires 'synced') ──
  const sync = await rpcAsService("set_billing_profile_zoho", { p_profile: p.profile_id, p_customer_id: zc.data.customerId, p_status: "synced", p_error: null });
  if (!sync.ok) return fail("accept_quote", isMissingFn(sync.error) ? "sql_not_run" : "sync_write_failed", isMissingFn(sync.error) ? 503 : 500, { detail: sync.error });

  const acc = await rpcAsUser<boolean>("accept_quote_with_billing_profile", { p_quote: quoteId, p_note: orNull(b.note) }, bearer);
  if (!acc.ok) {
    const code = isMissingFn(acc.error) ? "sql_not_run" : "accept_failed";
    return fail("accept_quote", code, code === "sql_not_run" ? 503 : 500, { detail: acc.error, recoverable: true });
  }

  log("accept_quote", { ok: true, quote_number: quote.quote_number, zoho_customer_id: zc.data.customerId });
  return NextResponse.json({ ok: true, status: "accepted", zoho_customer_id: zc.data.customerId, customer_type: customerType }, { status: 200 });
}
