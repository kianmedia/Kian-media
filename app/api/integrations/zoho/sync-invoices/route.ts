// ════════════════════════════════════════════════════════════════════════
// POST /api/integrations/zoho/sync-invoices   (SERVER-ONLY)
//
// Owner/finance action: READ a customer's invoices from Zoho Books (matched by
// email) and mirror them into the portal's invoices table as read-only display
// records. It NEVER creates/sends/edits/voids anything in Zoho. Gated by
// can_see_invoices() (as the user). Fails gracefully when Zoho env is missing.
// ════════════════════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { rpcAsUser, rpcAsService } from "@/lib/server/supabaseAdmin";
import { invoiceSyncConfigured, syncInvoicesByEmail } from "@/lib/server/zohoBooksInvoices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const asStr = (v: unknown) => (typeof v === "string" ? v : "");

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!bearer) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  // Permission: owner/manager/finance only (can_see_invoices, enforced in DB as the user).
  const perm = await rpcAsUser<boolean>("can_see_invoices", {}, bearer);
  if (!perm.ok) return NextResponse.json({ ok: false, error: perm.error }, { status: perm.status || 502 });
  if (perm.data !== true) return NextResponse.json({ ok: false, error: "not_permitted" }, { status: 403 });

  // Graceful setup message when Zoho is not configured (no failure).
  if (!invoiceSyncConfigured()) {
    return NextResponse.json({ ok: false, configured: false, reason: "zoho_not_configured" }, { status: 200 });
  }

  let b: { email?: unknown };
  try { b = await req.json(); } catch { return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 }); }
  const email = asStr(b.email).trim();
  if (!email) return NextResponse.json({ ok: false, error: "email_required" }, { status: 400 });

  const result = await syncInvoicesByEmail(email);
  if (!result.ok) {
    return NextResponse.json({ ok: false, configured: result.configured, reason: result.reason }, { status: 200 });
  }

  // Mirror each invoice (read-only) via the service_role upsert RPC.
  let synced = 0;
  for (const inv of result.invoices) {
    const up = await rpcAsService<string>("upsert_zoho_invoice", {
      p_zoho_invoice_id: inv.zohoInvoiceId, p_zoho_customer_id: inv.zohoCustomerId, p_email: email,
      p_invoice_number: inv.invoiceNumber, p_status: inv.status, p_currency: inv.currency,
      p_subtotal: inv.subtotal, p_vat: inv.vat, p_total: inv.total, p_due_date: inv.dueDate, p_pdf_url: inv.pdfUrl,
    });
    if (up.ok) synced += 1;
  }
  console.log(`[zoho/sync-invoices] email=${email} customer_found=${!!result.customerId} fetched=${result.invoices.length} synced=${synced}`);
  return NextResponse.json({
    ok: true, configured: true, customer_found: !!result.customerId,
    fetched: result.invoices.length, synced,
  }, { status: 200 });
}
