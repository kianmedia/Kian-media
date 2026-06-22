// ════════════════════════════════════════════════════════════════════════
// Kian Portal — invoices read. RLS scopes rows: owner/admin/manager/finance see
// all; a client sees only their own. Invoices are written server-side by the
// (future) Zoho sync — never from the browser. Empty until Zoho is wired.
// ════════════════════════════════════════════════════════════════════════
import { pget, prpc, type Result } from "@/lib/portal/client";
import type { Invoice } from "@/lib/portal/types";

export function listInvoices(limit = 200): Promise<Result<Invoice[]>> {
  return pget<Invoice[]>(`invoices?is_deleted=eq.false&select=*&order=created_at.desc&limit=${limit}`);
}

// ─── Invoice DISPLAY records (owner/finance). Official invoices live in Zoho
// Books — never auto-issued here; entered/synced for the client to view read-only.
// All writes go through SECURITY DEFINER RPCs (no table write grants). ───
export function createInvoiceDisplay(input: {
  clientId: string; projectId?: string | null; invoiceNumber?: string; status?: string;
  subtotal?: number; vat?: number; total?: number; currency?: string; dueDate?: string | null;
  pdfUrl?: string; zohoInvoiceId?: string; visible?: boolean;
}): Promise<Result<string>> {
  return prpc<string>("create_invoice_display", {
    p_client: input.clientId, p_project: input.projectId ?? null, p_invoice_number: input.invoiceNumber ?? null,
    p_status: input.status ?? "draft", p_subtotal: input.subtotal ?? 0, p_vat: input.vat ?? 0,
    p_total: input.total ?? 0, p_currency: input.currency ?? "SAR", p_due_date: input.dueDate ?? null,
    p_pdf_url: input.pdfUrl ?? null, p_zoho_invoice_id: input.zohoInvoiceId ?? null, p_visible: input.visible ?? false,
  });
}
export function setInvoiceVisibility(invoiceId: string, visible: boolean): Promise<Result<boolean>> {
  return prpc<boolean>("set_invoice_visibility", { p_invoice: invoiceId, p_visible: visible });
}
