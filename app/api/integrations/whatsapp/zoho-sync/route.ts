// ════════════════════════════════════════════════════════════════════════
// POST /api/integrations/whatsapp/zoho-sync   (SERVER-ONLY: push a lead to Zoho)
//
// Staff-triggered upsert of a conversation's contact into Zoho CRM, reflecting the
// CURRENT sales_stage → Lead_Status. Authorization is enforced by the DATABASE:
// the conversation is read with the user's JWT, so RLS hides conversations the
// user may not see (→ 403). The Zoho refresh token + the service-role key are
// server-only and never returned to the browser. Non-fatal by design: a Zoho
// failure returns ok:false with a reason, never throws.
// ════════════════════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { rpcAsService } from "@/lib/server/supabaseAdmin";
import { createOrUpdateZohoLeadFromWhatsApp, zohoConfigured } from "@/lib/server/zoho";
import { buildZohoDescription, type SummaryMessage } from "@/lib/whatsapp/summary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

async function getRows<T>(path: string, bearer: string): Promise<T[] | null> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${bearer}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as T[];
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!bearer) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  let payload: { conversation_id?: unknown };
  try { payload = await req.json(); } catch { return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 }); }
  const conversationId = typeof payload.conversation_id === "string" ? payload.conversation_id : "";
  if (!conversationId) return NextResponse.json({ ok: false, error: "conversation_id_required" }, { status: 400 });

  // Soft no-op when Zoho isn't configured (so the caller/stage-change can ignore it).
  if (!zohoConfigured()) return NextResponse.json({ ok: false, error: "zoho_not_configured" }, { status: 200 });

  // Read the conversation AS THE USER → RLS authorizes. Empty ⇒ not allowed.
  const convs = await getRows<{ contact_id?: string; category?: string; ai_summary?: string | null; sales_stage?: string; last_message_preview?: string | null; crm_lead_id?: string | null }>(
    `whatsapp_conversations?id=eq.${encodeURIComponent(conversationId)}&select=contact_id,category,ai_summary,sales_stage,last_message_preview,crm_lead_id`,
    bearer,
  );
  const conv = convs?.[0];
  if (!conv?.contact_id) return NextResponse.json({ ok: false, error: "not_found_or_forbidden" }, { status: 403 });

  const cts = await getRows<{ wa_id?: string; phone?: string | null; display_name?: string | null }>(
    `whatsapp_contacts?id=eq.${encodeURIComponent(conv.contact_id)}&select=wa_id,phone,display_name`,
    bearer,
  );
  const ct = cts?.[0];
  if (!ct?.wa_id) return NextResponse.json({ ok: false, error: "contact_not_found" }, { status: 404 });

  // Build the structured Arabic Description from the FULL recent conversation.
  const msgs = await getRows<SummaryMessage>(
    `whatsapp_messages?conversation_id=eq.${encodeURIComponent(conversationId)}&select=body,direction,created_at&order=created_at.desc&limit=50`,
    bearer,
  );
  const base = (process.env.PORTAL_PUBLIC_URL || "https://www.kianmedia.com").replace(/\/+$/, "");
  const description = buildZohoDescription({
    displayName: ct.display_name ?? null,
    phone: ct.phone ?? null,
    waId: ct.wa_id,
    salesStage: conv.sales_stage,
    conversationLink: `${base}/client-portal/admin/whatsapp?conversation=${conversationId}`,
    messages: msgs ?? [],
  });

  const zoho = await createOrUpdateZohoLeadFromWhatsApp(
    { id: conversationId, category: conv.category ?? "unknown", ai_summary: conv.ai_summary ?? null, sales_stage: conv.sales_stage, description, crm_lead_id: conv.crm_lead_id ?? null },
    { wa_id: ct.wa_id, phone: ct.phone ?? null, display_name: ct.display_name ?? null },
    { body: conv.last_message_preview ?? null },
  );
  if (!zoho.ok) {
    const reason = "reason" in zoho ? zoho.reason : zoho.error;
    return NextResponse.json({ ok: false, error: reason }, { status: 200 });
  }

  const wb = await rpcAsService("wa_set_crm_lead", {
    p_contact_id: conv.contact_id,
    p_conversation_id: conversationId,
    p_crm_lead_id: zoho.crm_lead_id,
  });
  return NextResponse.json({ ok: true, crm_lead_id: zoho.crm_lead_id, action: zoho.action, write_back: wb.ok }, { status: 200 });
}
