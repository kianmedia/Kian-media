// ════════════════════════════════════════════════════════════════════════
// POST /api/integrations/zoho/accept-with-billing   (SERVER-ONLY, client owner)
//
// The e-invoice acceptance gate. Self-sufficient client resolution so it works even
// for a quote the client sees only by EMAIL match (public/guest origin, quotes.client_id
// NULL, no clients row yet):
//   step auth          — identify the logged-in user (their JWT) + verified email
//   step resolve_quote — load the quote AS THE USER (RLS) → proves ownership/visibility
//   step ensure_client — resolve/claim/create the caller's OWN clients row (service role,
//                        only AFTER auth + ownership are verified → never cross-client)
//   step save_billing  — upsert_client_billing_profile (runs as the user; client row now exists)
//   step zoho_contact  — create/UPDATE the Zoho Books contact
//   step accept_quote  — accept_quote_with_billing_profile (requires a synced Zoho contact)
//
// The quote is NEVER accepted if ownership/billing/Zoho fails. No invoice, no email/WhatsApp.
// Structured non-sensitive logs are emitted per step (never tokens/secrets).
// ════════════════════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { rpcAsUser, rpcAsService, selectAsUser, selectAsService, insertAsService, patchAsService } from "@/lib/server/supabaseAdmin";
import { estimatesConfigured, upsertContactBilling } from "@/lib/server/zohoBooksEstimates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const orNull = (v: unknown) => { const s = str(v); return s === "" ? null : s; };
const maskEmail = (e: string) => { const [l, d] = (e || "").split("@"); return d ? `${(l || "").slice(0, 2)}***@${d}` : "***"; };
const isMissingFn = (e: string) => /PGRST202|could not find the function|does not exist|schema cache/i.test(e || "");
// Read the sub/email claims from the bearer WITHOUT trusting them yet — they are
// verified below by an as-user query PostgREST authenticates (bad signature → 401,
// and RLS "own profile" returns a row only when auth.uid() equals the claimed sub).
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

  if (!bearer) { log("auth", { code: "no_bearer" }); return NextResponse.json({ ok: false, code: "not_authenticated", error: "unauthorized" }, { status: 401 }); }

  let b: Record<string, unknown>;
  try { b = (await req.json()) as Record<string, unknown>; } catch { return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 }); }
  quoteId = str(b.quote_id);
  const customerType = str(b.customer_type) === "business" ? "business" : "individual";
  if (!quoteId) return NextResponse.json({ ok: false, error: "quote_id_required" }, { status: 400 });

  // ── step auth: identify the logged-in user + verified email, then VALIDATE ──
  const claims = jwtClaims(bearer);
  if (!claims.sub) { log("auth", { code: "no_sub" }); return NextResponse.json({ ok: false, code: "not_authenticated", reason: "no_sub" }, { status: 200 }); }
  // Validate the token + that sub is really the caller: as-user RLS returns the
  // caller's OWN profile only, so filtering by the claimed id proves identity.
  const me = await selectAsUser<{ id: string; email: string | null }[]>(`profiles?id=eq.${encodeURIComponent(claims.sub)}&select=id,email&limit=1`, bearer);
  const authUid = me.ok ? (me.data[0]?.id ?? "") : "";
  const email = (me.ok ? (me.data[0]?.email ?? "") : (claims.email || "")).trim();
  if (!authUid) { log("auth", { code: "session_invalid", detail: me.ok ? "no_profile" : me.error }); return NextResponse.json({ ok: false, code: "not_authenticated", reason: me.ok ? "no_profile" : me.error }, { status: 200 }); }
  log("auth", { auth_user_id: authUid, email: maskEmail(email) });

  // ── step resolve_quote: load the quote AS THE USER (RLS proves ownership/visibility) ──
  const qr = await selectAsUser<QuoteRow[]>(`quotes?id=eq.${encodeURIComponent(quoteId)}&is_deleted=eq.false&select=id,client_id,email,quote_number,total,public_portal_visible,status,billing_profile_id`, bearer);
  if (!qr.ok) { log("resolve_quote", { code: "read_failed", detail: qr.error }); return NextResponse.json({ ok: false, code: "billing_save_failed", reason: qr.error }, { status: 200 }); }
  const quote = qr.data[0];
  if (!quote) { log("resolve_quote", { code: "not_visible_to_user" }); return NextResponse.json({ ok: false, code: "not_owner" }, { status: 200 }); }
  log("resolve_quote", { quote_number: quote.quote_number, quote_client_id: quote.client_id, email_linked: !!quote.email });

  // ── route-side billing validation (authoritative check also lives in the RPC) ──
  const missing = customerType === "individual"
    ? (!orNull(b.full_name) ? "individual_name_required" : (!orNull(b.email) && !orNull(b.phone) ? "individual_contact_required" : null))
    : (!orNull(b.legal_name) ? "business_legal_name_required"
      : !orNull(b.vat_number) ? "business_vat_required"
      : (!orNull(b.building_number) || !orNull(b.street) || !orNull(b.district) || !orNull(b.city) || !orNull(b.postal_code)) ? "business_address_required" : null);
  if (missing) { log("validate", { code: missing }); return NextResponse.json({ ok: false, code: missing }, { status: 200 }); }

  // ── step ensure_client: resolve/claim/create the CALLER's own clients row ──
  //    Safe: only ever acts on auth.uid()+their verified email, AFTER ownership is proven.
  let clientId = "";
  const ex = await selectAsService<{ id: string }[]>(`clients?user_id=eq.${encodeURIComponent(authUid)}&is_deleted=eq.false&select=id&limit=1`);
  if (ex.ok && ex.data[0]) clientId = ex.data[0].id;
  if (!clientId && email) {
    const pend = await selectAsService<{ id: string }[]>(`clients?user_id=is.null&is_deleted=eq.false&email_is_placeholder=eq.false&email=ilike.${encodeURIComponent(email)}&select=id&limit=1`);
    const pid = pend.ok ? pend.data[0]?.id : undefined;
    if (pid) {
      const cl = await patchAsService<{ id: string }[]>(`clients?id=eq.${encodeURIComponent(pid)}`, { user_id: authUid });
      if (cl.ok && cl.data[0]) { clientId = cl.data[0].id; log("ensure_client", { action: "claimed", client_id: clientId }); }
    }
  }
  if (!clientId) {
    const ins = await insertAsService<{ id: string }[]>("clients", {
      user_id: authUid,
      full_name: orNull(b.legal_name) ?? orNull(b.full_name),
      email: email || `pending+${authUid}@pending.kian.local`,
      email_is_placeholder: !email,
    });
    if (!ins.ok || !ins.data[0]) { log("ensure_client", { code: "create_failed", detail: ins.ok ? "no_row" : ins.error }); return NextResponse.json({ ok: false, code: "no_client_context", reason: ins.ok ? "no_row" : ins.error }, { status: 200 }); }
    clientId = ins.data[0].id;
    log("ensure_client", { action: "created", client_id: clientId });
  } else if (ex.ok && ex.data[0]) {
    log("ensure_client", { action: "existing", client_id: clientId });
  }
  // Promote lead → client so my_client_id()/RLS resolve for the freshly-linked client.
  await patchAsService(`profiles?id=eq.${encodeURIComponent(authUid)}&account_type=eq.lead`, { account_type: "client" }).catch(() => undefined);
  // Best-effort: link this user's email-matched quotes to their client context.
  await rpcAsUser("promote_and_link_by_email", {}, bearer).catch(() => undefined);

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
    const code = isMissingFn(e) ? "sql_not_run"
      : /individual_name/.test(e) ? "individual_name_required"
      : /individual_contact/.test(e) ? "individual_contact_required"
      : /business_legal_name/.test(e) ? "business_legal_name_required"
      : /business_vat/.test(e) ? "business_vat_required"
      : /business_address/.test(e) ? "business_address_required"
      : /not_owner/.test(e) ? "not_owner"
      : /no_client_context/.test(e) ? "no_client_context" : "billing_save_failed";
    log("save_billing_profile", { code, detail: e });
    return NextResponse.json({ ok: false, code, reason: e }, { status: up.status && up.status < 500 ? up.status : 200 });
  }
  const p = up.data || {};
  if (!p.profile_id) { log("save_billing_profile", { code: "no_profile" }); return NextResponse.json({ ok: false, code: "billing_save_failed", reason: "no_profile" }, { status: 200 }); }
  log("save_billing_profile", { profile_id: p.profile_id, client_id: p.client_id });

  // ── step zoho_contact: Zoho must be configured; create/UPDATE the contact ──
  if (!estimatesConfigured()) {
    await rpcAsService("set_billing_profile_zoho", { p_profile: p.profile_id, p_customer_id: null, p_status: "failed", p_error: "zoho_not_configured" }).catch(() => undefined);
    log("zoho_contact", { code: "not_configured" });
    return NextResponse.json({ ok: false, code: "not_configured", reason: "zoho_not_configured" }, { status: 200 });
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
    log("zoho_contact", { code: scopeIssue ? "zoho_scope" : "zoho_failed", detail: zc.reason });
    return NextResponse.json({ ok: false, code: scopeIssue ? "zoho_scope" : "zoho_failed", reason: zc.reason }, { status: 200 });
  }
  log("zoho_contact", { zoho_customer_id: zc.data.customerId });

  // ── step accept_quote: record sync, then mark accepted (gate requires 'synced') ──
  await rpcAsService("set_billing_profile_zoho", { p_profile: p.profile_id, p_customer_id: zc.data.customerId, p_status: "synced", p_error: null }).catch(() => undefined);

  const acc = await rpcAsUser<boolean>("accept_quote_with_billing_profile", { p_quote: quoteId, p_note: orNull(b.note) }, bearer);
  if (!acc.ok) {
    const code = isMissingFn(acc.error) ? "sql_not_run" : "accept_failed";
    log("accept_quote", { code, detail: acc.error });
    return NextResponse.json({ ok: false, code, reason: acc.error, recoverable: true }, { status: 200 });
  }

  log("accept_quote", { ok: true, quote_number: quote.quote_number, zoho_customer_id: zc.data.customerId });
  return NextResponse.json({ ok: true, status: "accepted", zoho_customer_id: zc.data.customerId, customer_type: customerType }, { status: 200 });
}
