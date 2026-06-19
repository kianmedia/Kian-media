// ════════════════════════════════════════════════════════════════════════
// POST /api/integrations/whatsapp/start-conversation   (SERVER-ONLY)
//
// Staff-initiated outbound chat with a (possibly new) number. WhatsApp requires
// an APPROVED TEMPLATE for numbers outside the 24h window, so this always sends a
// template. Heavily gated:
//   • WHATSAPP_START_CONVERSATION_ENABLED must be "true" (else the feature is locked).
//   • The template is actually sent only when WHATSAPP_TEMPLATE_SEND_ENABLED="true"
//     AND creds present AND (when set) the number is on WHATSAPP_TEMPLATE_TEST_ALLOWLIST.
//   • Otherwise it is a DRY RUN (contact+conversation created, template recorded, not sent).
// Authorization (triager-only) + contact/conversation creation are enforced by the
// wa_start_conversation RPC (user JWT). Every attempt is audited. Token server-only.
// ════════════════════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { rpcAsUser } from "@/lib/server/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const digits = (s: string) => (s || "").replace(/[^\d]/g, "");
const templateLive = () =>
  process.env.WHATSAPP_TEMPLATE_SEND_ENABLED === "true" && !!process.env.WHATSAPP_PHONE_NUMBER_ID && !!process.env.WHATSAPP_ACCESS_TOKEN;
const templateAllowlist = () =>
  (process.env.WHATSAPP_TEMPLATE_TEST_ALLOWLIST || "").split(",").map((s) => digits(s)).filter(Boolean);

interface StartBody {
  phone?: unknown; name?: unknown; company?: unknown; department?: unknown;
  reason?: unknown; template?: unknown; variables?: unknown; preview?: unknown;
}
const asStr = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!bearer) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  if (process.env.WHATSAPP_START_CONVERSATION_ENABLED !== "true") {
    return NextResponse.json({ ok: false, error: "feature_disabled" }, { status: 403 });
  }

  let b: StartBody;
  try { b = await req.json(); } catch { return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 }); }
  const waId = digits(asStr(b.phone));
  if (!waId || waId.length < 6) return NextResponse.json({ ok: false, error: "phone_required" }, { status: 400 });
  const template = asStr(b.template) || "welcome_followup_ar";
  const variables = Array.isArray(b.variables) ? (b.variables as unknown[]).map((v) => asStr(v)) : [];
  const preview = asStr(b.preview) || `[template:${template}]`;

  const live = templateLive();

  // 1) Create/attach contact + conversation + record the template message (RPC authorizes triager).
  const rec = await rpcAsUser<{ conversation_id?: string; contact_id?: string; message_id?: string }>(
    "wa_start_conversation",
    {
      p_wa_id: waId, p_phone: asStr(b.phone), p_name: asStr(b.name), p_company: asStr(b.company),
      p_department: asStr(b.department), p_reason: asStr(b.reason), p_template: template,
      p_preview: preview, p_status: live ? "queued" : "dry_run",
    },
    bearer,
  );
  if (!rec.ok) {
    const status = rec.status === 401 || rec.status === 403 ? 403 : 502;
    return NextResponse.json({ ok: false, error: rec.error }, { status });
  }
  const ids = rec.data;
  const audit = (resultStatus: string, error: string | null, waMsgId: string | null) =>
    rpcAsUser("wa_log_template_audit", {
      p_conversation: ids.conversation_id, p_contact: ids.contact_id, p_phone: waId,
      p_template: template, p_status: resultStatus, p_reason: error, p_message: ids.message_id, p_wa_message_id: waMsgId,
    }, bearer).catch(() => undefined);

  // 2) DRY RUN — created + recorded, nothing sent.
  if (!live) {
    await audit("dry_run", null, null);
    return NextResponse.json({ ok: true, status: "dry_run", ...ids }, { status: 200 });
  }

  // 3) Allowlist gate.
  const allow = templateAllowlist();
  if (allow.length > 0 && !allow.includes(waId)) {
    await audit("blocked", "not_in_allowlist", null);
    return NextResponse.json({ ok: true, status: "blocked", ...ids }, { status: 200 });
  }

  // 4) Send the approved template via WhatsApp Cloud API.
  const version = process.env.WHATSAPP_API_VERSION || "v21.0";
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID as string;
  try {
    const params = variables.map((text) => ({ type: "text", text }));
    const wa = await fetch(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp", to: waId, type: "template",
        template: { name: template, language: { code: "ar" }, ...(params.length ? { components: [{ type: "body", parameters: params }] } : {}) },
      }),
      cache: "no-store",
    });
    const j = (await wa.json()) as { messages?: Array<{ id?: string }>; error?: { message?: string } };
    if (!wa.ok) {
      await audit("failed", `cloud_api_${wa.status}`, null);
      console.error("[whatsapp/start-conversation] cloud API failed:", j?.error?.message);
      return NextResponse.json({ ok: false, error: "send_failed", status: "failed", ...ids }, { status: 502 });
    }
    const waMsgId = j?.messages?.[0]?.id ?? null;
    await audit("sent", null, waMsgId);
    return NextResponse.json({ ok: true, status: "sent", whatsapp_message_id: waMsgId, ...ids }, { status: 200 });
  } catch (e) {
    await audit("failed", "send_error", null);
    console.error("[whatsapp/start-conversation] threw:", e);
    return NextResponse.json({ ok: false, error: "send_error", status: "failed", ...ids }, { status: 502 });
  }
}
