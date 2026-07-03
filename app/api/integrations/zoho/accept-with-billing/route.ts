// ════════════════════════════════════════════════════════════════════════
// POST /api/integrations/zoho/accept-with-billing   (SERVER-ONLY, client owner)
//
// The e-invoice acceptance gate. BEFORE a quote is marked accepted we:
//   1. save the client's billing profile        (upsert_client_billing_profile, RLS-owned)
//   2. create/UPDATE the Zoho Books contact       (upsertContactBilling — matches by id/email)
//   3. record the Zoho sync on the profile         (set_billing_profile_zoho, service)
//   4. ONLY THEN mark the quote accepted           (accept_quote_with_billing_profile)
//
// If billing data is invalid, Zoho is unconfigured, or the Zoho contact update fails,
// the quote is NOT accepted and no invoice is created. Never emails/WhatsApps anyone.
// Recoverable: the profile + Zoho contact persist, so a retry safely completes step 4.
// ════════════════════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { rpcAsUser, rpcAsService } from "@/lib/server/supabaseAdmin";
import { estimatesConfigured, upsertContactBilling } from "@/lib/server/zohoBooksEstimates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const orNull = (v: unknown) => { const s = str(v); return s === "" ? null : s; };

interface ProfileCtx {
  profile_id?: string; client_id?: string; customer_type?: string; zoho_customer_id?: string | null;
  name?: string | null; contact_person?: string | null; email?: string | null; phone?: string | null;
  vat_number?: string | null; cr_number?: string | null; city?: string | null; country?: string | null;
  building_number?: string | null; street?: string | null; district?: string | null;
  postal_code?: string | null; additional_number?: string | null;
}

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!bearer) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  let b: Record<string, unknown>;
  try { b = (await req.json()) as Record<string, unknown>; } catch { return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 }); }

  const quoteId = str(b.quote_id);
  const customerType = str(b.customer_type) === "business" ? "business" : "individual";
  if (!quoteId) return NextResponse.json({ ok: false, error: "quote_id_required" }, { status: 400 });

  // 1) Save the billing profile (RLS-owned; authoritative validation lives in the RPC).
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
    const code = /individual_name/.test(e) ? "individual_name_required"
      : /individual_contact/.test(e) ? "individual_contact_required"
      : /business_legal_name/.test(e) ? "business_legal_name_required"
      : /business_vat/.test(e) ? "business_vat_required"
      : /business_address/.test(e) ? "business_address_required"
      : /no_client_context/.test(e) ? "no_client_context"
      : /not authorized/.test(e) ? "not_authorized" : "billing_save_failed";
    return NextResponse.json({ ok: false, code, reason: e }, { status: up.status && up.status < 500 ? up.status : 200 });
  }
  const p = up.data || {};
  if (!p.profile_id) return NextResponse.json({ ok: false, code: "billing_save_failed", reason: "no_profile" }, { status: 200 });

  // 2) Zoho must be configured to update the customer/contact before acceptance.
  if (!estimatesConfigured()) {
    await rpcAsService("set_billing_profile_zoho", { p_profile: p.profile_id, p_customer_id: null, p_status: "failed", p_error: "zoho_not_configured" }).catch(() => undefined);
    return NextResponse.json({ ok: false, code: "not_configured", reason: "zoho_not_configured" }, { status: 200 });
  }

  // 3) Create / UPDATE the Zoho Books contact from the billing profile.
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
    console.error(`[zoho/accept-with-billing] contact upsert failed quote=${quoteId} profile=${p.profile_id}: ${zc.reason}`);
    return NextResponse.json({ ok: false, code: scopeIssue ? "zoho_scope" : "zoho_failed", reason: zc.reason }, { status: 200 });
  }

  // 4) Record the sync, then mark the quote accepted (DB gate requires a synced profile).
  await rpcAsService("set_billing_profile_zoho", { p_profile: p.profile_id, p_customer_id: zc.data.customerId, p_status: "synced", p_error: null }).catch(() => undefined);

  const acc = await rpcAsUser<boolean>("accept_quote_with_billing_profile", { p_quote: quoteId, p_note: orNull(b.note) }, bearer);
  if (!acc.ok) {
    console.error(`[zoho/accept-with-billing] accept failed quote=${quoteId}: ${acc.error}`);
    // Billing + Zoho are saved; a retry re-enters at step 4 and completes safely.
    return NextResponse.json({ ok: false, code: "accept_failed", reason: acc.error, recoverable: true }, { status: 200 });
  }

  console.log(`[zoho/accept-with-billing] accepted quote=${quoteId} customer=${zc.data.customerId} type=${customerType}`);
  return NextResponse.json({ ok: true, status: "accepted", zoho_customer_id: zc.data.customerId, customer_type: customerType }, { status: 200 });
}
