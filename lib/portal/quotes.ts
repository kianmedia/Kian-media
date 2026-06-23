// ════════════════════════════════════════════════════════════════════════
// Kian Portal — formal (priced) quotes. Reads are RLS-scoped: a client sees only
// their own visible quotes (public_portal_visible OR status sent/accepted); staff
// managers (can_manage_quotes) see all. Every write goes through a SECURITY DEFINER
// RPC (no table write grants); clients can Accept / Request-revision but never edit
// prices. Mirrors docs/portal_quotes_invoices_RUNME.sql.
// ════════════════════════════════════════════════════════════════════════
import { pget, prpc, enc, type Result } from "@/lib/portal/client";
import { getValidSession } from "@/lib/portalAuth";
import type { Quote, QuoteItem, QuoteRevisionRequest } from "@/lib/portal/types";

// ─── Reads (RLS-scoped) ───
export function listQuotes(): Promise<Result<Quote[]>> {
  return pget<Quote[]>(`quotes?is_deleted=eq.false&select=*&order=created_at.desc`);
}
/** Fetch a single quote by id (RLS-scoped) — used to open a linked quote that
 *  isn't in the currently-loaded list. */
export async function getQuote(quoteId: string): Promise<Result<Quote | null>> {
  const r = await pget<Quote[]>(`quotes?id=eq.${enc(quoteId)}&select=*&limit=1`);
  if (!r.ok) return r;
  return { ok: true, data: r.data[0] ?? null };
}

/** Admin/manager single-quote getter via SECURITY DEFINER RPC (same gate as the
 *  pending list), so a quote-manager can open ANY quote — incl. a draft/zero-total
 *  one that the table-RLS read path may not return. Returns the quote + its items. */
export async function getQuoteAdmin(quoteId: string): Promise<Result<{ quote: Quote; items: QuoteItem[] } | null>> {
  const r = await prpc<{ quote: Quote; items: QuoteItem[] } | null>("get_quote_admin", { p_quote: quoteId });
  if (!r.ok) return r;
  return { ok: true, data: r.data ?? null };
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
  linked_quote_id: string | null; quote_number: string | null;
  zoho_estimate_id: string | null; estimate_number: string | null; estimate_url: string | null;
}
export function listPendingQuoteRequests(): Promise<Result<PendingQuoteRequest[]>> {
  return prpc<PendingQuoteRequest[]>("list_pending_quote_requests", {});
}
export function convertQuoteRequest(requestId: string): Promise<Result<{ id: string; quote_number: string; reused?: boolean }>> {
  return prpc<{ id: string; quote_number: string; reused?: boolean }>("convert_quote_request", { p_request: requestId });
}

// ─── Zoho Books estimates (source of truth for official quotes) ─────────────
export type EstimateAdminResult =
  | { ok: true; configured: true; quoteId?: string | null; estimateNumber?: string; total?: number; zohoStatus?: string | null }
  | { ok: false; configured: boolean; reason: string };

async function postEstimateAdmin(body: Record<string, unknown>): Promise<EstimateAdminResult> {
  const s = await getValidSession();
  if (!s) return { ok: false, configured: true, reason: "not_authenticated" };
  try {
    const res = await fetch("/api/integrations/zoho/estimate-admin", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.access_token}` },
      body: JSON.stringify(body),
    });
    const d = (await res.json()) as { ok?: boolean; configured?: boolean; reason?: string; error?: string; quote_id?: string; estimate_number?: string; total?: number; zoho_status?: string | null };
    if (!d.ok) return { ok: false, configured: d.configured !== false, reason: d.reason || d.error || `HTTP ${res.status}` };
    return { ok: true, configured: true, quoteId: d.quote_id ?? null, estimateNumber: d.estimate_number, total: d.total, zohoStatus: d.zoho_status ?? null };
  } catch (e) { return { ok: false, configured: true, reason: String(e) }; }
}

/** Create a DRAFT Zoho estimate from an intake quote_request (admin). */
export function createEstimateFromRequest(requestId: string): Promise<EstimateAdminResult> {
  return postEstimateAdmin({ action: "create", quote_request_id: requestId });
}
/** Re-read an estimate from Zoho into the local mirror (admin). */
export function syncEstimate(quoteId: string, zohoEstimateId: string): Promise<EstimateAdminResult> {
  return postEstimateAdmin({ action: "sync", quote_id: quoteId, zoho_estimate_id: zohoEstimateId });
}
/** Approve a quote for client visibility (+ mark sent in Zoho if linked) (admin). */
export function approveQuote(quoteId: string, zohoEstimateId?: string | null): Promise<EstimateAdminResult> {
  return postEstimateAdmin({ action: "approve", quote_id: quoteId, zoho_estimate_id: zohoEstimateId ?? "" });
}

/** Client accept / decline (+ Zoho status sync). */
export async function respondToQuote(quoteId: string, response: "accepted" | "declined", note: string, zohoEstimateId?: string | null): Promise<Result<boolean>> {
  const s = await getValidSession();
  if (!s) return { ok: false, error: "not_authenticated", status: 401 };
  try {
    const res = await fetch("/api/integrations/zoho/estimate-respond", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.access_token}` },
      body: JSON.stringify({ quote_id: quoteId, response, note, zoho_estimate_id: zohoEstimateId ?? "" }),
    });
    const d = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok || !d.ok) return { ok: false, error: d.error || `HTTP ${res.status}`, status: res.status };
    return { ok: true, data: true };
  } catch (e) { return { ok: false, error: String(e) }; }
}

/** Best-effort: link this user's email-matched quotes to their client context. */
export function promoteByEmail(): Promise<Result<{ recognized: boolean; linked: number; has_client: boolean }>> {
  return prpc<{ recognized: boolean; linked: number; has_client: boolean }>("promote_and_link_by_email", {});
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
