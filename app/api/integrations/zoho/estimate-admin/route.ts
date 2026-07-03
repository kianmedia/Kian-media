// ════════════════════════════════════════════════════════════════════════
// POST /api/integrations/zoho/estimate-admin   (SERVER-ONLY, owner/sales/finance)
//
// action = "create" | "sync" | "approve". Zoho Books Estimates are the source of
// truth for official quotes; this mirrors them into the portal's quotes table.
//   • create  — find/create the Zoho contact (by email) + create a DRAFT estimate
//               (suggested line items, price = pricing-review) + mirror locally.
//   • sync    — re-READ an estimate from Zoho and refresh the local mirror.
//   • approve — expose the mirror to the client (local) + mark "sent" in Zoho.
// Gated by can_manage_quotes() (as the user). NEVER creates an invoice or emails the
// estimate to the customer. Fails gracefully (configured:false) when Zoho env is missing.
// ════════════════════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { rpcAsUser, rpcAsService } from "@/lib/server/supabaseAdmin";
import {
  estimatesConfigured, createDraftEstimateForCustomer, getEstimate, markEstimateStatus,
  suggestedLineItems,
} from "@/lib/server/zohoBooksEstimates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const asStr = (v: unknown) => (typeof v === "string" ? v : "");

interface QrRow { email: string | null; full_name: string | null; company: string | null; phone: string | null; services: string[] | null; description: string | null; }

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!bearer) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const perm = await rpcAsUser<boolean>("can_manage_quotes", {}, bearer);
  if (!perm.ok) return NextResponse.json({ ok: false, error: perm.error }, { status: perm.status || 502 });
  if (perm.data !== true) return NextResponse.json({ ok: false, error: "not_permitted" }, { status: 403 });

  let b: { action?: unknown; quote_request_id?: unknown; quote_id?: unknown; zoho_estimate_id?: unknown };
  try { b = await req.json(); } catch { return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 }); }
  const action = asStr(b.action);

  // approve does NOT require Zoho; do the local exposure first, then best-effort Zoho status.
  if (action === "approve") {
    const quoteId = asStr(b.quote_id);
    if (!quoteId) return NextResponse.json({ ok: false, error: "quote_id_required" }, { status: 400 });
    const r = await rpcAsUser<{ ok?: boolean }>("approve_quote_for_client", { p_quote: quoteId }, bearer);
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error === "empty_or_zero_quote" ? "empty_or_zero_quote" : r.error }, { status: r.status && r.status < 500 ? r.status : 200 });
    let zoho: string | null = null;
    const zid = asStr(b.zoho_estimate_id);
    if (zid && estimatesConfigured()) {
      const m = await markEstimateStatus(zid, "sent");
      zoho = m.ok ? "sent" : `skip_${m.reason}`;
    }
    return NextResponse.json({ ok: true, action: "approve", zoho_status: zoho }, { status: 200 });
  }

  // create / sync need Zoho.
  if (!estimatesConfigured()) {
    return NextResponse.json({ ok: false, configured: false, reason: "zoho_not_configured" }, { status: 200 });
  }

  if (action === "create") {
    const reqId = asStr(b.quote_request_id);
    if (!reqId) return NextResponse.json({ ok: false, error: "quote_request_id_required" }, { status: 400 });
    const qrR = await rpcAsService<QrRow[]>("get_quote_request_for_estimate", { p_request: reqId });
    const qr = qrR.ok ? qrR.data?.[0] : undefined;
    if (!qr) return NextResponse.json({ ok: false, error: "request_not_found" }, { status: 404 });
    if (!qr.email) return NextResponse.json({ ok: false, error: "request_has_no_email" }, { status: 200 });
    const created = await createDraftEstimateForCustomer({
      email: qr.email, name: qr.full_name || undefined, company: qr.company || undefined, phone: qr.phone || undefined,
      lineItems: suggestedLineItems(qr.services ?? []), referenceNumber: reqId.slice(0, 8),
      notes: qr.description || undefined,
    });
    if (!created.ok) return NextResponse.json({ ok: false, configured: created.configured, reason: created.reason }, { status: 200 });
    const e = created.data;
    const up = await rpcAsService<string>("upsert_zoho_estimate", {
      p_zoho_estimate_id: e.zohoEstimateId, p_zoho_customer_id: e.zohoCustomerId, p_quote_request: reqId, p_email: qr.email,
      p_estimate_number: e.estimateNumber, p_zoho_status: e.status, p_currency: e.currency,
      p_subtotal: e.subtotal, p_vat: e.vat, p_total: e.total, p_estimate_url: e.estimateUrl,
      p_items: e.lineItems, p_raw: e.raw,
    });
    return NextResponse.json({ ok: up.ok, action: "create", quote_id: up.ok ? up.data : null, estimate_number: e.estimateNumber, total: e.total }, { status: 200 });
  }

  if (action === "sync") {
    const zid = asStr(b.zoho_estimate_id);
    if (!zid) return NextResponse.json({ ok: false, error: "zoho_estimate_id_required" }, { status: 400 });
    const got = await getEstimate(zid);
    if (!got.ok) return NextResponse.json({ ok: false, configured: got.configured, reason: got.reason }, { status: 200 });
    const e = got.data;
    const up = await rpcAsService<string>("upsert_zoho_estimate", {
      p_zoho_estimate_id: e.zohoEstimateId, p_zoho_customer_id: e.zohoCustomerId, p_quote_request: null, p_email: null,
      p_estimate_number: e.estimateNumber, p_zoho_status: e.status, p_currency: e.currency,
      p_subtotal: e.subtotal, p_vat: e.vat, p_total: e.total, p_estimate_url: e.estimateUrl,
      p_items: e.lineItems, p_raw: e.raw,
    });
    return NextResponse.json({ ok: up.ok, action: "sync", quote_id: up.ok ? up.data : null, total: e.total, status: e.status }, { status: 200 });
  }

  return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 400 });
}
