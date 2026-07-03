// ════════════════════════════════════════════════════════════════════════
// Kian Portal — client billing profile (e-invoice details) + invoice notes.
// The accept-with-billing flow runs through a server route that saves the
// profile, updates the Zoho Books contact, and only then marks the quote
// accepted. Reads are RLS-scoped (client sees own; finance/manager see all).
// ════════════════════════════════════════════════════════════════════════
import { pget, prpc, enc, type Result } from "@/lib/portal/client";
import { getValidSession } from "@/lib/portalAuth";
import type { BillingProfile, InvoiceNote } from "@/lib/portal/types";

export interface BillingInput {
  customerType: "individual" | "business";
  fullName?: string; email?: string; phone?: string; city?: string; country?: string; notes?: string;
  legalName?: string; contactPerson?: string; vatNumber?: string; crNumber?: string;
  poReference?: string; financeEmail?: string;
  buildingNumber?: string; street?: string; district?: string; postalCode?: string; additionalNumber?: string;
}

export type AcceptBillingResult =
  | { ok: true; zohoCustomerId?: string; customerType?: string }
  | { ok: false; code?: string; step?: string; detail?: string; reason?: string; recoverable?: boolean };

/** Save billing details, sync the Zoho contact, and (only on success) accept the quote. */
export async function acceptQuoteWithBilling(quoteId: string, b: BillingInput, note?: string): Promise<AcceptBillingResult> {
  const s = await getValidSession();
  if (!s) return { ok: false, code: "not_authenticated" };
  try {
    const res = await fetch("/api/integrations/zoho/accept-with-billing", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.access_token}` },
      body: JSON.stringify({
        quote_id: quoteId, customer_type: b.customerType, note: note ?? "",
        full_name: b.fullName, email: b.email, phone: b.phone, city: b.city, country: b.country, notes: b.notes,
        legal_name: b.legalName, contact_person: b.contactPerson, vat_number: b.vatNumber, cr_number: b.crNumber,
        po_reference: b.poReference, finance_email: b.financeEmail,
        building_number: b.buildingNumber, street: b.street, district: b.district,
        postal_code: b.postalCode, additional_number: b.additionalNumber,
      }),
    });
    const d = (await res.json()) as { ok?: boolean; code?: string; step?: string; detail?: string; reason?: string; recoverable?: boolean; zoho_customer_id?: string; customer_type?: string };
    if (!d.ok) return { ok: false, code: d.code, step: d.step, detail: d.detail || d.reason, recoverable: d.recoverable };
    return { ok: true, zohoCustomerId: d.zoho_customer_id, customerType: d.customer_type };
  } catch (e) { return { ok: false, code: "network", detail: String(e) }; }
}

// ─── Billing profile reads (RLS: own for client, all for finance/manager) ───
export async function getBillingProfileForClient(clientId: string): Promise<Result<BillingProfile | null>> {
  const r = await pget<BillingProfile[]>(`billing_profiles?client_id=eq.${enc(clientId)}&is_deleted=eq.false&select=*&limit=1`);
  if (!r.ok) return r;
  return { ok: true, data: r.data[0] ?? null };
}
export async function getMyBillingProfile(): Promise<Result<BillingProfile | null>> {
  const r = await pget<BillingProfile[]>(`billing_profiles?is_deleted=eq.false&select=*&order=updated_at.desc&limit=1`);
  if (!r.ok) return r;
  return { ok: true, data: r.data[0] ?? null };
}

// ─── Invoice notes (client ⇄ admin) ───
export function listInvoiceNotes(invoiceId: string): Promise<Result<InvoiceNote[]>> {
  return pget<InvoiceNote[]>(`invoice_notes?invoice_id=eq.${enc(invoiceId)}&select=*&order=created_at.asc`);
}
export function submitInvoiceNote(invoiceId: string, body: string): Promise<Result<string>> {
  return prpc<string>("submit_invoice_note", { p_invoice: invoiceId, p_body: body });
}
export function markInvoiceNoteResolved(noteId: string, resolved = true): Promise<Result<boolean>> {
  return prpc<boolean>("admin_mark_invoice_note_resolved", { p_note: noteId, p_resolved: resolved });
}
