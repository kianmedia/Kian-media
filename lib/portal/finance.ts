// ════════════════════════════════════════════════════════════════════════
// Kian Portal — invoices read. RLS scopes rows: owner/admin/manager/finance see
// all; a client sees only their own. Invoices are written server-side by the
// (future) Zoho sync — never from the browser. Empty until Zoho is wired.
// ════════════════════════════════════════════════════════════════════════
import { pget, prpc, type Result } from "@/lib/portal/client";
import { getValidSession } from "@/lib/portalAuth";
import type { Invoice } from "@/lib/portal/types";

// ─── Read/sync invoices from Zoho Books (owner/finance). Read-only: never creates
// an official invoice. Returns a graceful "not configured" result when Zoho env
// is missing so the UI can show a setup message. ───
export type ZohoSyncResult =
  | { ok: true; configured: true; customerFound: boolean; fetched: number; synced: number }
  | { ok: false; configured: boolean; reason: string };

export async function syncZohoInvoices(email: string): Promise<ZohoSyncResult> {
  const s = await getValidSession();
  if (!s) return { ok: false, configured: true, reason: "not_authenticated" };
  try {
    const res = await fetch("/api/integrations/zoho/sync-invoices", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.access_token}` },
      body: JSON.stringify({ email }),
    });
    const d = (await res.json()) as { ok?: boolean; configured?: boolean; customer_found?: boolean; fetched?: number; synced?: number; reason?: string; error?: string };
    if (!d.ok) return { ok: false, configured: !!d.configured, reason: d.reason || d.error || `HTTP ${res.status}` };
    return { ok: true, configured: true, customerFound: !!d.customer_found, fetched: d.fetched ?? 0, synced: d.synced ?? 0 };
  } catch (e) {
    return { ok: false, configured: true, reason: String(e) };
  }
}

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

// ─── Admin/finance invoice review controls (portal metadata only — never edits
//     or deletes the official Zoho invoice) ───
export function updateInvoiceReviewState(invoiceId: string, input: {
  reviewStatus?: string; internalNotes?: string; clientNote?: string; visible?: boolean;
}): Promise<Result<boolean>> {
  return prpc<boolean>("admin_update_invoice_review_state", {
    p_invoice: invoiceId,
    p_review_status: input.reviewStatus ?? null, p_internal_notes: input.internalNotes ?? null,
    p_client_note: input.clientNote ?? null, p_visible: input.visible ?? null,
  });
}
/** action: "hide" | "unhide" | "soft_delete" — soft-delete only hides the PORTAL record. */
export function hideOrSoftDeleteInvoice(invoiceId: string, action: "hide" | "unhide" | "soft_delete"): Promise<Result<boolean>> {
  return prpc<boolean>("admin_hide_or_soft_delete_invoice", { p_invoice: invoiceId, p_action: action });
}
