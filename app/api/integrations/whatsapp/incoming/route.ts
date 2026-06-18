// ════════════════════════════════════════════════════════════════════════
// POST /api/integrations/whatsapp/incoming   (SERVER-ONLY ingest from n8n)
//
// n8n forwards a CLEANED payload here (NOT the raw Meta webhook). This route:
//   1. authenticates the call with the shared secret header,
//   2. validates the payload,
//   3. classifies the message (rule-based, Phase 6),
//   4. calls public.whatsapp_ingest_message(...) as the service_role
//      (atomic: upsert contact → open/new conversation → insert message →
//       bump conversation → log event → route notifications),
//   5. fires a best-effort Zoho lead sync (never blocks ingest),
//   6. returns { ok, conversation_id, contact_id }.
//
// SECURITY:
//   • Requires header  x-kian-ingest-secret: <N8N_WHATSAPP_INGEST_SECRET>.
//   • The secret + the service-role key are read from server env only and are
//     never sent to the browser.
//   • Idempotent: re-delivered webhooks (same message_id) do not duplicate, and
//     Meta status callbacks (no message body / no new message_id) never create
//     fake messages.
// ════════════════════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { rpcAsService, adminConfigured } from "@/lib/server/supabaseAdmin";
import { classifyWhatsAppMessage } from "@/lib/whatsapp/classify";
import { createOrUpdateZohoLeadFromWhatsApp } from "@/lib/server/zoho";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface IngestBody {
  wa_id?: unknown;
  phone?: unknown;
  display_name?: unknown;
  message_id?: unknown;
  message_type?: unknown;
  body?: unknown;
  timestamp?: unknown;
  raw_payload?: unknown;
}

interface IngestResult {
  ok: boolean;
  conversation_id?: string;
  contact_id?: string;
  message_inserted?: boolean;
  new_conversation?: boolean;
  duplicate?: boolean;
}

const asStr = (v: unknown): string | null =>
  typeof v === "string" ? v : typeof v === "number" ? String(v) : null;

/** Constant-time-ish comparison to avoid trivial timing leaks on the secret. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function POST(req: Request) {
  // ── 1) Authenticate ──────────────────────────────────────────────────────
  const expected = process.env.N8N_WHATSAPP_INGEST_SECRET ?? "";
  if (!expected) {
    // Fail closed: refuse to accept anything until the secret is configured.
    return NextResponse.json({ ok: false, error: "ingest_not_configured" }, { status: 500 });
  }
  const provided = req.headers.get("x-kian-ingest-secret") ?? "";
  if (!provided || !safeEqual(provided, expected)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  if (!adminConfigured()) {
    return NextResponse.json({ ok: false, error: "server_supabase_not_configured" }, { status: 500 });
  }

  // ── 2) Parse + validate payload ──────────────────────────────────────────
  let payload: IngestBody;
  try {
    payload = (await req.json()) as IngestBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const wa_id = asStr(payload.wa_id);
  if (!wa_id || wa_id.trim().length === 0) {
    return NextResponse.json({ ok: false, error: "wa_id_required" }, { status: 400 });
  }

  const message_id = asStr(payload.message_id);
  const message_type = asStr(payload.message_type) ?? "text";
  const body = asStr(payload.body);

  // Guard against Meta status callbacks slipping through: a payload with neither
  // a message id nor a body is not an actual inbound message → accept + no-op.
  if ((!message_id || message_id.trim().length === 0) && (!body || body.trim().length === 0)) {
    return NextResponse.json({ ok: true, ignored: "no_message_content" }, { status: 200 });
  }

  // ── 3) Classify (rule-based; swap for real AI later) ─────────────────────
  const cls = classifyWhatsAppMessage(body);

  // ── 4) Atomic ingest via the service-role RPC ────────────────────────────
  const rpc = await rpcAsService<IngestResult>("whatsapp_ingest_message", {
    p_wa_id: wa_id,
    p_phone: asStr(payload.phone),
    p_display_name: asStr(payload.display_name),
    p_message_id: message_id,
    p_message_type: message_type,
    p_body: body,
    p_timestamp: asStr(payload.timestamp),
    p_raw_payload: payload.raw_payload ?? null,
    p_category: cls.category,
    p_priority: cls.priority,
    p_ai_summary: cls.summary || null,
    p_ai_confidence: cls.confidence,
  });

  if (!rpc.ok) {
    console.error("[whatsapp/incoming] ingest RPC failed:", rpc.error);
    return NextResponse.json({ ok: false, error: "ingest_failed" }, { status: 502 });
  }

  const result = rpc.data;

  // ── 5) Best-effort CRM sync (NEVER blocks ingest) ────────────────────────
  if (result.conversation_id && result.contact_id && result.message_inserted) {
    try {
      const zoho = await createOrUpdateZohoLeadFromWhatsApp(
        {
          id: result.conversation_id,
          category: cls.category,
          ai_summary: cls.summary,
          // Only set Lead_Status on a brand-new conversation (stage 'new'); for an
          // existing thread, omit it so we never overwrite the sales team's stage.
          sales_stage: result.new_conversation ? "new" : undefined,
        },
        { wa_id, phone: asStr(payload.phone), display_name: asStr(payload.display_name) },
        { body },
      );
      if (zoho.ok) {
        const wb = await rpcAsService("wa_set_crm_lead", {
          p_contact_id: result.contact_id,
          p_conversation_id: result.conversation_id,
          p_crm_lead_id: zoho.crm_lead_id,
        });
        if (!wb.ok) console.error("[whatsapp/incoming] wa_set_crm_lead failed (ignored):", wb.error);
      }
    } catch (e) {
      console.error("[whatsapp/incoming] zoho sync threw (ignored):", e);
    }
  }

  // ── 6) Respond ───────────────────────────────────────────────────────────
  return NextResponse.json(
    {
      ok: true,
      conversation_id: result.conversation_id,
      contact_id: result.contact_id,
      message_inserted: result.message_inserted ?? false,
      duplicate: result.duplicate ?? false,
    },
    { status: 200 },
  );
}

// Optional: a tiny GET so a browser/n8n health check doesn't 405-noise. It never
// reveals whether the secret is set and never touches the database.
export async function GET() {
  return NextResponse.json({ ok: true, service: "whatsapp-ingest", method: "POST" }, { status: 200 });
}
