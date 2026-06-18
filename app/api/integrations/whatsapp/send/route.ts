// ════════════════════════════════════════════════════════════════════════
// POST /api/integrations/whatsapp/send   (SERVER-ONLY outbound: reply from portal)
//
// Phase 1 — "reply from the portal reaches the customer", built SAFELY:
//   • Records the outgoing message in the conversation via the wa_send_message
//     RPC AS THE LOGGED-IN USER (RLS + role guard enforced by the database — a
//     read-only or unauthorized user is rejected by Postgres, not by this code).
//   • Performs the actual WhatsApp Cloud API send ONLY when WHATSAPP_SEND_ENABLED
//     === "true" AND credentials are present. Otherwise it is a DRY RUN: the
//     message is stored as status='dry_run' and nothing leaves the server.
//   • The WhatsApp access token is read from server env only and never returned
//     to the browser.
//
// CHECKPOINT (ب): do NOT set WHATSAPP_SEND_ENABLED=true on the LIVE number until
// the flow is reviewed — dry-run is the default and is the only mode used in test.
// ════════════════════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { rpcAsUser } from "@/lib/server/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

function sendConfigured(): boolean {
  return (
    process.env.WHATSAPP_SEND_ENABLED === "true" &&
    !!process.env.WHATSAPP_PHONE_NUMBER_ID &&
    !!process.env.WHATSAPP_ACCESS_TOKEN
  );
}

/** Read the recipient wa_id for a conversation, as the logged-in user (RLS). */
async function recipientFor(conversationId: string, bearer: string): Promise<string | null> {
  try {
    const cv = await fetch(
      `${SUPABASE_URL}/rest/v1/whatsapp_conversations?id=eq.${encodeURIComponent(conversationId)}&select=contact_id`,
      { headers: { apikey: ANON_KEY, Authorization: `Bearer ${bearer}` }, cache: "no-store" },
    );
    const cvRows = (await cv.json()) as Array<{ contact_id?: string }>;
    const contactId = cvRows?.[0]?.contact_id;
    if (!contactId) return null;
    const ct = await fetch(
      `${SUPABASE_URL}/rest/v1/whatsapp_contacts?id=eq.${encodeURIComponent(contactId)}&select=wa_id,phone`,
      { headers: { apikey: ANON_KEY, Authorization: `Bearer ${bearer}` }, cache: "no-store" },
    );
    const ctRows = (await ct.json()) as Array<{ wa_id?: string; phone?: string }>;
    return ctRows?.[0]?.wa_id ?? ctRows?.[0]?.phone ?? null;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  // Auth: the browser forwards the logged-in user's access token.
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!bearer) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  let payload: { conversation_id?: unknown; body?: unknown };
  try { payload = await req.json(); } catch { return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 }); }

  const conversationId = typeof payload.conversation_id === "string" ? payload.conversation_id : "";
  const body = typeof payload.body === "string" ? payload.body.trim() : "";
  if (!conversationId) return NextResponse.json({ ok: false, error: "conversation_id_required" }, { status: 400 });
  if (!body) return NextResponse.json({ ok: false, error: "body_required" }, { status: 400 });

  const live = sendConfigured();

  // 1) Record the outbound message (DB enforces authorization via the user's JWT).
  const rec = await rpcAsUser<string>(
    "wa_send_message",
    { p_conversation: conversationId, p_body: body, p_status: live ? "queued" : "dry_run" },
    bearer,
  );
  if (!rec.ok) {
    // 401/403 → not authorized for this conversation; surface as-is (no token leak).
    const status = rec.status === 401 || rec.status === 403 ? 403 : 502;
    return NextResponse.json({ ok: false, error: rec.error }, { status });
  }
  const messageId = rec.data;

  // 2) DRY RUN — recorded, nothing sent. (Default + the only mode used in test.)
  if (!live) {
    return NextResponse.json({ ok: true, dry_run: true, message_id: messageId }, { status: 200 });
  }

  // 3) LIVE send via WhatsApp Cloud API (server-only token).
  const to = await recipientFor(conversationId, bearer);
  if (!to) {
    await rpcAsUser("wa_mark_message_status", { p_message: messageId, p_status: "failed" }, bearer);
    return NextResponse.json({ ok: false, error: "recipient_not_found", message_id: messageId }, { status: 422 });
  }
  const version = process.env.WHATSAPP_API_VERSION || "v21.0";
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID as string;
  try {
    const wa = await fetch(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body } }),
      cache: "no-store",
    });
    const waJson = (await wa.json()) as { messages?: Array<{ id?: string }>; error?: { message?: string } };
    if (!wa.ok) {
      await rpcAsUser("wa_mark_message_status", { p_message: messageId, p_status: "failed" }, bearer);
      console.error("[whatsapp/send] cloud API failed:", waJson?.error?.message);
      return NextResponse.json({ ok: false, error: "send_failed", message_id: messageId }, { status: 502 });
    }
    const waMessageId = waJson?.messages?.[0]?.id ?? null;
    await rpcAsUser("wa_mark_message_status", { p_message: messageId, p_status: "sent", p_wa_message_id: waMessageId }, bearer);
    return NextResponse.json({ ok: true, dry_run: false, message_id: messageId, whatsapp_message_id: waMessageId }, { status: 200 });
  } catch (e) {
    await rpcAsUser("wa_mark_message_status", { p_message: messageId, p_status: "failed" }, bearer);
    console.error("[whatsapp/send] threw:", e);
    return NextResponse.json({ ok: false, error: "send_error", message_id: messageId }, { status: 502 });
  }
}
