// ════════════════════════════════════════════════════════════════════════
// POST /api/integrations/whatsapp/quote-request   (public link-back from the
// /quote-request form when ?source=whatsapp&conversation=<id>).
//
// Links a customer-submitted quote to its WhatsApp conversation/contact via the
// SECURITY DEFINER RPC wa_link_quote_request_public (service_role) — anonymous
// customers can't write tables directly. Best-effort + never throws. Does NOT
// touch the existing quote_requests portal table; writes whatsapp_quote_requests.
// ════════════════════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { rpcAsService } from "@/lib/server/supabaseAdmin";
import { sendQuoteConfirmations } from "@/lib/server/quoteConfirm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const asStr = (v: unknown) => (typeof v === "string" ? v : "");

interface LinkedQuote {
  id?: string; external_request_id?: string | null; phone?: string | null; email?: string | null;
  full_name?: string | null; company?: string | null; city?: string | null;
  preferred_date?: string | null; services?: string | null;
}

export async function POST(req: Request) {
  let b: {
    conversation_id?: unknown; full_name?: unknown; phone?: unknown; services?: unknown; city?: unknown;
    message?: unknown; reference?: unknown; budget?: unknown; company?: unknown; email?: unknown;
    lead_source?: unknown; priority?: unknown; duration?: unknown; preferred_date?: unknown;
    mode?: unknown; quote_id?: unknown;
  };
  try { b = await req.json(); } catch { return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 }); }

  const conversationId = asStr(b.conversation_id);
  if (!conversationId) return NextResponse.json({ ok: false, error: "conversation_id_required" }, { status: 400 });

  const services = Array.isArray(b.services) ? (b.services as unknown[]).map((s) => asStr(s)).filter(Boolean)
    : asStr(b.services) ? [asStr(b.services)] : [];
  // Normalise a free-text date to YYYY-MM-DD (or null) so a malformed value can't fail the insert.
  const dateStr = asStr(b.preferred_date).trim();
  const preferredDate = /^\d{4}-\d{2}-\d{2}/.test(dateStr) ? dateStr.slice(0, 10) : null;
  // Link mode: 'update' (exact quote), 'new' (force create), else 'auto' (reuse open). Validated; default auto.
  const mode = ["update", "new", "auto"].includes(asStr(b.mode)) ? asStr(b.mode) : "auto";
  const quoteIdRaw = asStr(b.quote_id).trim();
  const quoteId = mode === "update" && /^[0-9a-f-]{36}$/i.test(quoteIdRaw) ? quoteIdRaw : null;

  const r = await rpcAsService<LinkedQuote>("wa_link_quote_request_public", {
    p_conversation: conversationId,
    p_full_name: asStr(b.full_name),
    p_phone: asStr(b.phone),
    p_services: services,
    p_city: asStr(b.city),
    p_message: asStr(b.message),
    // The public quote form's Sheets reference → human-friendly request number.
    p_external_request_id: asStr(b.reference),
    p_budget_range: asStr(b.budget),
    p_company: asStr(b.company),
    p_email: asStr(b.email),
    p_lead_source: asStr(b.lead_source),
    p_priority: asStr(b.priority),
    p_duration: asStr(b.duration),
    p_preferred_date: preferredDate,
    p_mode: mode,
    p_quote_id: quoteId,
  });
  if (!r.ok) {
    // not_found_or_forbidden / bad conversation → 200 with ok:false so the public
    // form never errors out the customer; the Sheets submission still succeeded.
    return NextResponse.json({ ok: false, error: r.error }, { status: 200 });
  }
  const q = r.data || {};

  // Customer confirmation (email + WhatsApp) — both gated + non-blocking. Awaited so
  // the audit lands, but each channel swallows its own failure; never fails the form.
  try {
    await sendQuoteConfirmations({
      conversationId, quoteId: q.id || "", requestNumber: q.external_request_id || asStr(b.reference),
      fullName: q.full_name || asStr(b.full_name), email: q.email || asStr(b.email),
      phone: q.phone || asStr(b.phone), services: q.services || services.join("، "),
      city: q.city || asStr(b.city), preferredDate: q.preferred_date || preferredDate || "",
    });
  } catch { /* confirmations must never fail the customer submission */ }

  return NextResponse.json({ ok: true, id: q.id, mode }, { status: 200 });
}
