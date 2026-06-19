// ════════════════════════════════════════════════════════════════════════
// POST /api/integrations/whatsapp/books-estimate   (SERVER-ONLY)
//
// Creates a DRAFT Zoho Books estimate for a WhatsApp quote request. Heavily gated:
//   • ZOHO_BOOKS_ESTIMATES_ENABLED must be "true" (else soft no-op, status "disabled").
//   • The caller must pass wa_can_create_books_estimate() (owner/admin/finance/manager)
//     — enforced in the DB as the user (sales is prepare-only → 403).
//   • The quote row is read AS THE USER (RLS) to confirm visibility.
//   • The estimate is created DRAFT-ONLY; it is NEVER sent/emailed and NO invoice
//     is ever created. Result is written back via a service_role RPC.
// Every attempt is audited. Tokens stay server-only; nothing secret is logged.
// ════════════════════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { rpcAsUser, rpcAsService, selectAsUser } from "@/lib/server/supabaseAdmin";
import { booksFeatureEnabled, booksConfigured, createDraftEstimate, type BooksEstimateLine } from "@/lib/server/zohoBooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const asStr = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const asNum = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : 0);

/** Best-effort decode of the JWT 'sub' (user id) — the bearer is already validated
 *  against Supabase by the permission RPC below, so this is only used for attribution. */
function jwtSub(bearer: string): string | null {
  try {
    const payload = bearer.split(".")[1];
    if (!payload) return null;
    const json = JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    return typeof json.sub === "string" ? json.sub : null;
  } catch { return null; }
}

interface QuoteRow {
  id: string; whatsapp_conversation_id: string; full_name: string | null; company: string | null;
  email: string | null; phone: string | null; services: string[] | null; budget_range: string | null;
  city: string | null; message: string | null; external_request_id: string | null;
}

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!bearer) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  let b: { quote_id?: unknown; line_items?: unknown; vat_percent?: unknown; discount_percent?: unknown; notes?: unknown; terms?: unknown };
  try { b = await req.json(); } catch { return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 }); }
  const quoteId = asStr(b.quote_id);
  if (!quoteId) return NextResponse.json({ ok: false, error: "quote_id_required" }, { status: 400 });
  const actor = jwtSub(bearer);

  const audit = (action: string, status: string, reason: string | null, http: number, conv?: string) =>
    rpcAsService("wa_log_books_estimate", {
      p_quote_id: quoteId, p_conversation: conv ?? null, p_actor: actor,
      p_action: action, p_status: status, p_reason: reason, p_http: http,
    }).catch(() => undefined);

  // Gate 1: feature flag (fail-closed → soft no-op so the UI can show "locked").
  if (!booksFeatureEnabled() || !booksConfigured()) {
    await audit("skipped", "disabled", booksFeatureEnabled() ? "not_configured" : "feature_disabled", 200);
    return NextResponse.json({ ok: false, status: "disabled", error: "books_estimates_disabled" }, { status: 200 });
  }

  // Gate 2: create permission (owner/admin/finance/manager) — enforced in DB as the user.
  const perm = await rpcAsUser<boolean>("wa_can_create_books_estimate", {}, bearer);
  if (!perm.ok) return NextResponse.json({ ok: false, error: perm.error }, { status: perm.status || 502 });
  if (perm.data !== true) {
    await audit("blocked", "forbidden", "not_permitted", 403);
    return NextResponse.json({ ok: false, status: "forbidden", error: "not_permitted_to_create_estimate" }, { status: 403 });
  }

  // Read the quote row AS THE USER (RLS) — confirms visibility + gives customer data.
  const rowR = await selectAsUser<QuoteRow[]>(
    `whatsapp_quote_requests?id=eq.${encodeURIComponent(quoteId)}&select=id,whatsapp_conversation_id,full_name,company,email,phone,services,budget_range,city,message,external_request_id&limit=1`,
    bearer,
  );
  if (!rowR.ok) return NextResponse.json({ ok: false, error: rowR.error }, { status: rowR.status || 502 });
  const row = rowR.data?.[0];
  if (!row) {
    await audit("blocked", "not_found", "row_not_visible", 404);
    return NextResponse.json({ ok: false, status: "not_found", error: "quote_not_found_or_forbidden" }, { status: 404 });
  }

  // Build line items: prefer client-supplied (review modal), else derive from services.
  const clientLines = Array.isArray(b.line_items) ? (b.line_items as unknown[]) : [];
  let lineItems: BooksEstimateLine[] = clientLines.map((l) => {
    const o = (l ?? {}) as Record<string, unknown>;
    return { name: asStr(o.name), description: asStr(o.description) || undefined, quantity: asNum(o.quantity) || 1, rate: asNum(o.rate) };
  }).filter((l) => l.name);
  if (lineItems.length === 0) {
    lineItems = (row.services ?? []).filter(Boolean).map((s) => ({ name: s, quantity: 1, rate: 0 }));
  }
  if (lineItems.length === 0) {
    await audit("failed", "no_line_items", "empty", 400, row.whatsapp_conversation_id);
    return NextResponse.json({ ok: false, status: "no_line_items", error: "no_line_items" }, { status: 400 });
  }

  try {
    const est = await createDraftEstimate({
      customerName: row.full_name || "WhatsApp Lead", company: row.company || undefined,
      email: row.email || undefined, phone: row.phone || undefined,
      lineItems, vatPercent: asNum(b.vat_percent), discountPercent: asNum(b.discount_percent),
      notes: asStr(b.notes) || row.message || undefined, terms: asStr(b.terms) || undefined,
      referenceNumber: row.external_request_id || undefined,
    });
    // Write the estimate back onto the quote row (service_role) + audit.
    await rpcAsService("wa_set_books_estimate", {
      p_quote_id: quoteId, p_estimate_id: est.estimateId, p_estimate_number: est.estimateNumber,
      p_estimate_url: est.url, p_estimate_status: est.status, p_estimate_total: est.total,
      p_estimate_currency: est.currency, p_actor: actor,
    });
    console.log(`[whatsapp/books-estimate] draft_created quote=${quoteId} estimate=${est.estimateId} status=${est.status}`);
    return NextResponse.json({
      ok: true, status: "created", estimate_id: est.estimateId, estimate_number: est.estimateNumber,
      estimate_url: est.url, estimate_status: est.status, estimate_total: est.total, estimate_currency: est.currency,
    }, { status: 200 });
  } catch (e) {
    const reason = String((e as Error)?.message ?? e);
    await audit("failed", "error", reason, 502, row.whatsapp_conversation_id);
    console.error("[whatsapp/books-estimate] failed:", reason);
    return NextResponse.json({ ok: false, status: "failed", error: "estimate_create_failed" }, { status: 502 });
  }
}
