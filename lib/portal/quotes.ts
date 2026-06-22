// ════════════════════════════════════════════════════════════════════════
// Kian Portal — formal (priced) quotes. Reads are RLS-scoped: a client sees only
// their own visible quotes (public_portal_visible OR status sent/accepted); staff
// managers (can_manage_quotes) see all. Every write goes through a SECURITY DEFINER
// RPC (no table write grants); clients can Accept / Request-revision but never edit
// prices. Mirrors docs/portal_quotes_invoices_RUNME.sql.
// ════════════════════════════════════════════════════════════════════════
import { pget, prpc, enc, type Result } from "@/lib/portal/client";
import type { Quote, QuoteItem, QuoteRevisionRequest } from "@/lib/portal/types";

// ─── Reads (RLS-scoped) ───
export function listQuotes(): Promise<Result<Quote[]>> {
  return pget<Quote[]>(`quotes?is_deleted=eq.false&select=*&order=created_at.desc`);
}
export function getQuoteItems(quoteId: string): Promise<Result<QuoteItem[]>> {
  return pget<QuoteItem[]>(`quote_items?quote_id=eq.${enc(quoteId)}&select=*&order=position.asc`);
}
export function listQuoteRevisions(quoteId: string): Promise<Result<QuoteRevisionRequest[]>> {
  return pget<QuoteRevisionRequest[]>(`quote_revision_requests?quote_id=eq.${enc(quoteId)}&select=*&order=created_at.desc`);
}

// ─── Client actions (own + visible quote; NEVER edits price) ───
export function acceptQuote(quoteId: string): Promise<Result<boolean>> {
  return prpc<boolean>("client_accept_quote", { p_quote: quoteId });
}
export function requestQuoteRevision(quoteId: string, note: string): Promise<Result<boolean>> {
  return prpc<boolean>("client_request_quote_revision", { p_quote: quoteId, p_note: note });
}

// ─── Manager actions (can_manage_quotes: owner/manager/sales/finance) ───
export interface QuoteItemInput { title: string; description?: string; quantity: number; unit_price: number; }

export function listQuoteClients(): Promise<Result<{ client_id: string; label: string }[]>> {
  return prpc<{ client_id: string; label: string }[]>("list_quote_clients", {});
}
export function createQuote(input: {
  clientId: string; projectId?: string | null; quoteRequestId?: string | null;
  validUntil?: string | null; currency?: string; vatRate?: number; notes?: string; title?: string;
}): Promise<Result<{ id: string; quote_number: string }>> {
  return prpc<{ id: string; quote_number: string }>("create_quote", {
    p_client: input.clientId, p_project: input.projectId ?? null, p_quote_request: input.quoteRequestId ?? null,
    p_valid_until: input.validUntil ?? null, p_currency: input.currency ?? "SAR",
    p_vat_rate: input.vatRate ?? 15, p_notes: input.notes ?? null, p_title: input.title ?? null,
  });
}

// ─── Convert an existing quote_request into a formal (priced) quote ───
export interface PendingQuoteRequest {
  id: string; reference: string | null; services: string[]; email: string | null;
  city: string | null; budget_range: string | null; status: string; created_at: string; has_quote: boolean;
}
export function listPendingQuoteRequests(): Promise<Result<PendingQuoteRequest[]>> {
  return prpc<PendingQuoteRequest[]>("list_pending_quote_requests", {});
}
export function convertQuoteRequest(requestId: string): Promise<Result<{ id: string; quote_number: string; reused?: boolean }>> {
  return prpc<{ id: string; quote_number: string; reused?: boolean }>("convert_quote_request", { p_request: requestId });
}
export function setQuoteItems(quoteId: string, items: QuoteItemInput[]): Promise<Result<boolean>> {
  return prpc<boolean>("set_quote_items", { p_quote: quoteId, p_items: items });
}
export function setQuoteStatus(quoteId: string, status: string): Promise<Result<boolean>> {
  return prpc<boolean>("set_quote_status", { p_quote: quoteId, p_status: status });
}
export function setQuoteVisibility(quoteId: string, visible: boolean): Promise<Result<boolean>> {
  return prpc<boolean>("set_quote_visibility", { p_quote: quoteId, p_visible: visible });
}
