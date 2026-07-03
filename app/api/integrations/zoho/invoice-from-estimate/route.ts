// ════════════════════════════════════════════════════════════════════════
// POST /api/integrations/zoho/invoice-from-estimate   (SERVER-ONLY, owner/finance)
//
// Owner/finance APPROVES creating the official tax invoice for an accepted estimate.
//   1. approve_invoice_creation() records approval + dedups (no duplicate invoice).
//   2. If Zoho is configured, create the invoice in Zoho Books from the estimate
//      (requires ZohoBooks.invoices.CREATE) and mirror it locally read-only.
//   3. Mark the quote invoice_created (notify client + admin) or invoice_creation_failed.
// Never auto-creates before approval; never emails the client; never loses the
// client's acceptance. Graceful when Zoho/scope is missing.
// ════════════════════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { rpcAsUser, rpcAsService } from "@/lib/server/supabaseAdmin";
import { estimatesConfigured, createInvoiceFromEstimate } from "@/lib/server/zohoBooksEstimates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const asStr = (v: unknown) => (typeof v === "string" ? v : "");

interface ApproveResult { ok?: boolean; zoho_estimate_id?: string | null; email?: string | null; existing_invoice_id?: string | null; already_created?: boolean }

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!bearer) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const perm = await rpcAsUser<boolean>("can_see_invoices", {}, bearer);
  if (!perm.ok) return NextResponse.json({ ok: false, error: perm.error }, { status: perm.status || 502 });
  if (perm.data !== true) return NextResponse.json({ ok: false, error: "not_permitted" }, { status: 403 });

  let b: { quote_id?: unknown };
  try { b = await req.json(); } catch { return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 }); }
  const quoteId = asStr(b.quote_id);
  if (!quoteId) return NextResponse.json({ ok: false, error: "quote_id_required" }, { status: 400 });

  // 1) Record approval + dedup (enforces accepted + can_see_invoices in the DB).
  //    The RPC only blocks when the client hasn't accepted; an ACCEPTED quote that
  //    hasn't changed is a perfectly valid state to invoice from — it is NOT an error.
  const ap = await rpcAsUser<ApproveResult>("approve_invoice_creation", { p_quote: quoteId }, bearer);
  if (!ap.ok) {
    // The one legitimate guard: the client hasn't accepted yet.
    const notAccepted = /not accepted/i.test(ap.error || "");
    console.error(`[zoho/invoice-from-estimate] approve failed quote=${quoteId}: ${ap.error}`);
    return NextResponse.json(
      { ok: false, status: "blocked", code: notAccepted ? "not_accepted" : "approve_failed", reason: ap.error },
      { status: ap.status && ap.status < 500 ? ap.status : 200 },
    );
  }
  const a = ap.data || {};
  // 2) Idempotency guard = "invoice already exists" (NOT "quote unchanged"): never
  //    create a duplicate; surface the existing invoice instead.
  if (a.existing_invoice_id) {
    return NextResponse.json({ ok: true, status: "invoice_created", deduped: true, invoice_id: a.existing_invoice_id }, { status: 200 });
  }

  // 3) If Zoho isn't set up, approval is recorded but creation waits for config.
  if (!estimatesConfigured()) {
    return NextResponse.json({ ok: true, configured: false, status: "invoice_creation_approved",
      code: "not_configured", message: "Client accepted the estimate, but Zoho invoice creation is not configured yet." }, { status: 200 });
  }
  const estId = asStr(a.zoho_estimate_id);
  if (!estId) {
    return NextResponse.json({ ok: false, status: "invoice_creation_approved", code: "no_zoho_estimate",
      reason: "no_zoho_estimate", message: "Approved, but this quote has no Zoho estimate to invoice from." }, { status: 200 });
  }

  // 4) Create the official invoice in Zoho + mirror locally, or record an HONEST failure.
  const created = await createInvoiceFromEstimate(estId);
  if (!created.ok) {
    await rpcAsService("set_quote_invoice_status", { p_quote: quoteId, p_status: "invoice_creation_failed", p_invoice: null }).catch(() => undefined);
    // A missing invoices.CREATE scope surfaces from Zoho as 401/403 OR as INVALID_TOKEN
    // (the invoice endpoint rejects the token) — treat all of those as a scope issue.
    const scopeIssue = /401|403|scope|permission|invalid_token|unauthor/i.test(created.reason);
    // Log the real technical reason for developers; the user sees an honest,
    // actionable message (a genuine Zoho failure is NOT blamed on the accepted quote).
    console.error(`[zoho/invoice-from-estimate] Zoho create failed quote=${quoteId} estimate=${estId}: ${created.reason}`);
    return NextResponse.json({ ok: false, configured: created.configured, status: "invoice_creation_failed",
      code: scopeIssue ? "zoho_scope" : "zoho_failed", reason: created.reason,
      message: scopeIssue ? "Zoho invoice creation permission/scope is missing (ZohoBooks.invoices.CREATE)." : "Zoho Books rejected the invoice creation." }, { status: 200 });
  }
  const inv = created.data;
  const up = await rpcAsService<string>("upsert_zoho_invoice", {
    p_zoho_invoice_id: inv.zohoInvoiceId, p_zoho_customer_id: inv.zohoCustomerId, p_email: asStr(a.email),
    p_invoice_number: inv.invoiceNumber, p_status: inv.status, p_currency: inv.currency,
    p_subtotal: inv.subtotal, p_vat: inv.vat, p_total: inv.total, p_due_date: inv.dueDate, p_pdf_url: inv.pdfUrl,
    p_quote_id: quoteId, p_zoho_estimate_id: estId, p_line_items: inv.lineItems,
  });
  if (!up.ok) {
    await rpcAsService("set_quote_invoice_status", { p_quote: quoteId, p_status: "invoice_creation_failed", p_invoice: null }).catch(() => undefined);
    console.error(`[zoho/invoice-from-estimate] mirror failed quote=${quoteId} invoice=${inv.zohoInvoiceId}: ${up.error}`);
    return NextResponse.json({ ok: false, status: "invoice_creation_failed", code: "mirror_failed", reason: up.error, message: "Invoice created in Zoho but mirroring failed." }, { status: 200 });
  }
  await rpcAsService("set_quote_invoice_status", { p_quote: quoteId, p_status: "invoice_created", p_invoice: up.data });
  console.log(`[zoho/invoice-from-estimate] quote=${quoteId} estimate=${estId} invoice=${inv.zohoInvoiceId} (${inv.invoiceNumber})`);
  return NextResponse.json({ ok: true, status: "invoice_created", invoice_number: inv.invoiceNumber, total: inv.total }, { status: 200 });
}
