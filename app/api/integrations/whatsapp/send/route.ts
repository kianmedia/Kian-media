// ════════════════════════════════════════════════════════════════════════
// POST /api/integrations/whatsapp/send   (SERVER-ONLY outbound: reply from portal)
//
// Records the outgoing reply via wa_send_message AS THE LOGGED-IN USER (RLS + role
// guard enforced by Postgres). Performs the real WhatsApp Cloud API send ONLY when:
//   • WHATSAPP_SEND_ENABLED === "true" AND credentials are present, AND
//   • the recipient is on WHATSAPP_SEND_TEST_ALLOWLIST (when that allowlist is set).
// Otherwise it is a DRY RUN (recorded, not sent) or BLOCKED (allowlist miss).
// Every attempt is audited via wa_record_send_audit. The WhatsApp token is
// server-only and never returned to the browser.
//
// CHECKPOINT (ب): keep WHATSAPP_SEND_ENABLED=false for live customers. During
// testing, set it true ONLY together with WHATSAPP_SEND_TEST_ALLOWLIST=<test number>.
// ════════════════════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { rpcAsUser } from "@/lib/server/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

const digits = (s: string) => (s || "").replace(/[^\d]/g, "");

function sendConfigured(): boolean {
  return (
    process.env.WHATSAPP_SEND_ENABLED === "true" &&
    !!process.env.WHATSAPP_PHONE_NUMBER_ID &&
    !!process.env.WHATSAPP_ACCESS_TOKEN
  );
}

/** Allowlist of digits-only phone numbers permitted for REAL sends (empty = no extra gate). */
function sendAllowlist(): string[] {
  return (process.env.WHATSAPP_SEND_TEST_ALLOWLIST || "").split(",").map((s) => digits(s)).filter(Boolean);
}

/** Recipient wa_id + contact_id for a conversation, read as the logged-in user (RLS). */
async function recipientFor(conversationId: string, bearer: string): Promise<{ to: string | null; contactId: string | null }> {
  try {
    const cv = await fetch(
      `${SUPABASE_URL}/rest/v1/whatsapp_conversations?id=eq.${encodeURIComponent(conversationId)}&select=contact_id`,
      { headers: { apikey: ANON_KEY, Authorization: `Bearer ${bearer}` }, cache: "no-store" },
    );
    const cvRows = (await cv.json()) as Array<{ contact_id?: string }>;
    const contactId = cvRows?.[0]?.contact_id ?? null;
    if (!contactId) return { to: null, contactId: null };
    const ct = await fetch(
      `${SUPABASE_URL}/rest/v1/whatsapp_contacts?id=eq.${encodeURIComponent(contactId)}&select=wa_id,phone`,
      { headers: { apikey: ANON_KEY, Authorization: `Bearer ${bearer}` }, cache: "no-store" },
    );
    const ctRows = (await ct.json()) as Array<{ wa_id?: string; phone?: string }>;
    return { to: ctRows?.[0]?.wa_id ?? ctRows?.[0]?.phone ?? null, contactId };
  } catch {
    return { to: null, contactId: null };
  }
}

// Lightweight diagnostic for the UI: whether real sending is active, plus
// PRESENCE booleans only (never the token or any secret value).
export async function GET() {
  return NextResponse.json({
    ok: true,
    send_enabled: sendConfigured(),
    flag_enabled: process.env.WHATSAPP_SEND_ENABLED === "true",
    token_present: !!process.env.WHATSAPP_ACCESS_TOKEN,
    phone_id_present: !!process.env.WHATSAPP_PHONE_NUMBER_ID,
    api_version: process.env.WHATSAPP_API_VERSION || "v21.0",
    allowlist_count: (process.env.WHATSAPP_SEND_TEST_ALLOWLIST || "").split(",").map((s) => s.trim()).filter(Boolean).length,
  }, { status: 200 });
}

export async function POST(req: Request) {
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
    const status = rec.status === 401 || rec.status === 403 ? 403 : 502;
    return NextResponse.json({ ok: false, error: rec.error }, { status });
  }
  const messageId = rec.data;

  // Resolve recipient (also used for the audit target_phone, even in dry-run).
  const { to, contactId } = await recipientFor(conversationId, bearer);

  const audit = (result: string, waId: string | null, error: string | null) =>
    rpcAsUser("wa_record_send_audit", {
      p_message: messageId, p_status: result, p_wa_message_id: waId,
      p_conversation: conversationId, p_contact: contactId, p_phone: to, p_error: error,
    }, bearer).catch(() => undefined);

  // 2) DRY RUN — recorded, nothing sent (default + the only mode used in test).
  if (!live) {
    await audit("dry_run", null, null);
    console.log(`[whatsapp/send] dry_run conversation_id=${conversationId} message_id=${messageId}`);
    return NextResponse.json({ ok: true, dry_run: true, status: "dry_run", message_id: messageId }, { status: 200 });
  }

  // 3) LIVE — but enforce the test allowlist first.
  if (!to) {
    await audit("failed", null, "recipient_not_found");
    return NextResponse.json({ ok: false, error: "recipient_not_found", status: "failed", message_id: messageId }, { status: 422 });
  }
  const allow = sendAllowlist();
  if (allow.length > 0 && !allow.includes(digits(to))) {
    await audit("blocked", null, "not_in_allowlist");
    console.warn(`[whatsapp/send] blocked (not in allowlist) conversation_id=${conversationId} message_id=${messageId}`);
    return NextResponse.json({ ok: true, dry_run: false, status: "blocked", message_id: messageId }, { status: 200 });
  }

  // 4) Real send via WhatsApp Cloud API (server-only token).
  const version = process.env.WHATSAPP_API_VERSION || "v21.0";
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID as string;
  try {
    const wa = await fetch(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body } }),
      cache: "no-store",
    });
    const waJson = (await wa.json()) as { messages?: Array<{ id?: string }>; error?: { message?: string } };
    if (!wa.ok) {
      await audit("failed", null, `cloud_api_${wa.status}`);
      console.error("[whatsapp/send] cloud API failed:", waJson?.error?.message);
      return NextResponse.json({ ok: false, error: "send_failed", status: "failed", message_id: messageId }, { status: 502 });
    }
    const waMessageId = waJson?.messages?.[0]?.id ?? null;
    await audit("sent", waMessageId, null);
    console.log(`[whatsapp/send] sent conversation_id=${conversationId} message_id=${messageId}`);
    return NextResponse.json({ ok: true, dry_run: false, status: "sent", message_id: messageId, whatsapp_message_id: waMessageId }, { status: 200 });
  } catch (e) {
    await audit("failed", null, "send_error");
    console.error("[whatsapp/send] threw:", e);
    return NextResponse.json({ ok: false, error: "send_error", status: "failed", message_id: messageId }, { status: 502 });
  }
}
