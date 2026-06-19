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
  let b: { conversation_id?: unknown; full_name?: unknown; phone?: unknown; services?: unknown; city?: unknown; message?: unknown; reference?: unknown; budget?: unknown };
  try { b = await req.json(); } catch { return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 }); }

  const conversationId = asStr(b.conversation_id);
  if (!conversationId) return NextResponse.json({ ok: false, error: "conversation_id_required" }, { status: 400 });

  const services = Array.isArray(b.services) ? (b.services as unknown[]).map((s) => asStr(s)).filter(Boolean)
    : asStr(b.services) ? [asStr(b.services)] : [];

  const r = await rpcAsService<string>("wa_link_quote_request_public", {
    p_conversation: conversationId,
    p_full_name: asStr(b.full_name),
    p_phone: asStr(b.phone),
    p_services: services,
    p_city: asStr(b.city),
    p_message: asStr(b.message),
    // The public quote form's Sheets reference → human-friendly request number.
    p_external_request_id: asStr(b.reference),
    // Budget label the customer already picked on the form (column exists; just unpopulated for link-backs).
    p_budget_range: asStr(b.budget),
  });
  if (!r.ok) {
    // not_found_or_forbidden / bad conversation → 200 with ok:false so the public
    // form never errors out the customer; the Sheets submission still succeeded.
    return NextResponse.json({ ok: false, error: r.error }, { status: 200 });
  }
  return NextResponse.json({ ok: true, id: r.data }, { status: 200 });
}
