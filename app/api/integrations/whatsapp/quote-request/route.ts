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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const asStr = (v: unknown) => (typeof v === "string" ? v : "");

export async function POST(req: Request) {
  let b: {
    conversation_id?: unknown; full_name?: unknown; phone?: unknown; services?: unknown; city?: unknown;
    message?: unknown; reference?: unknown; budget?: unknown; company?: unknown; email?: unknown;
    lead_source?: unknown; priority?: unknown; duration?: unknown; preferred_date?: unknown;
  };
  try { b = await req.json(); } catch { return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 }); }

  const conversationId = asStr(b.conversation_id);
  if (!conversationId) return NextResponse.json({ ok: false, error: "conversation_id_required" }, { status: 400 });

  const services = Array.isArray(b.services) ? (b.services as unknown[]).map((s) => asStr(s)).filter(Boolean)
    : asStr(b.services) ? [asStr(b.services)] : [];
  // Normalise a free-text date to YYYY-MM-DD (or null) so a malformed value can't fail the insert.
  const dateStr = asStr(b.preferred_date).trim();
  const preferredDate = /^\d{4}-\d{2}-\d{2}/.test(dateStr) ? dateStr.slice(0, 10) : null;

  const r = await rpcAsService<string>("wa_link_quote_request_public", {
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
  });
  if (!r.ok) {
    // not_found_or_forbidden / bad conversation → 200 with ok:false so the public
    // form never errors out the customer; the Sheets submission still succeeded.
    return NextResponse.json({ ok: false, error: r.error }, { status: 200 });
  }
  return NextResponse.json({ ok: true, id: r.data }, { status: 200 });
}
