// ════════════════════════════════════════════════════════════════════════
// Kian — SERVER-ONLY internal WhatsApp staff alerts. OFF by default.
//
// Sends a WhatsApp TEMPLATE (`internal_alert_ar`) to staff alert numbers for a
// new customer message. Gated by WHATSAPP_INTERNAL_ALERTS_ENABLED + Meta creds,
// and (when set) restricted to WHATSAPP_INTERNAL_ALERTS_TEST_ALLOWLIST. Every
// attempt is audited (skipped/dry_run/sent/failed/blocked). NEVER throws — internal
// alerts must not block WhatsApp ingest. The token is server-only, never logged.
// ════════════════════════════════════════════════════════════════════════

import { rpcAsService } from "@/lib/server/supabaseAdmin";

if (typeof window !== "undefined") {
  throw new Error("lib/server/whatsappInternalAlert must never be imported in the browser");
}

const digits = (s: string) => (s || "").replace(/[^\d]/g, "");

export function internalAlertsEnabled(): boolean {
  return process.env.WHATSAPP_INTERNAL_ALERTS_ENABLED === "true";
}
function liveCreds(): boolean {
  return !!process.env.WHATSAPP_PHONE_NUMBER_ID && !!process.env.WHATSAPP_ACCESS_TOKEN;
}
function allowlist(): string[] {
  return (process.env.WHATSAPP_INTERNAL_ALERTS_TEST_ALLOWLIST || "").split(",").map((s) => digits(s)).filter(Boolean);
}

export interface InternalAlertInput {
  conversationId: string;
  contactId: string | null;
  departments: string[];
  customerName: string;
  customerPhone: string;
  preview: string;
  conversationLink: string;
}

async function sendTemplate(to: string, i: InternalAlertInput): Promise<{ ok: boolean; waId: string | null; error: string | null }> {
  const version = process.env.WHATSAPP_API_VERSION || "v21.0";
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID as string;
  try {
    const res = await fetch(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp", to, type: "template",
        template: {
          name: "internal_alert_ar", language: { code: "ar" },
          components: [{ type: "body", parameters: [
            { type: "text", text: i.customerName || "-" },
            { type: "text", text: i.customerPhone || "-" },
            { type: "text", text: (i.departments[0] || "unassigned") },
            { type: "text", text: (i.preview || "-").slice(0, 200) },
            { type: "text", text: i.conversationLink },
          ] }],
        },
      }),
      cache: "no-store",
    });
    const j = (await res.json()) as { messages?: Array<{ id?: string }>; error?: { message?: string } };
    if (!res.ok) return { ok: false, waId: null, error: `cloud_api_${res.status}` };
    return { ok: true, waId: j?.messages?.[0]?.id ?? null, error: null };
  } catch {
    return { ok: false, waId: null, error: "send_error" };
  }
}

/** Resolve recipients + send/dry-run/block each + audit. Never throws. */
export async function sendInternalAlerts(i: InternalAlertInput): Promise<void> {
  try {
    if (!internalAlertsEnabled()) return; // OFF by default → nothing happens
    const recipsR = await rpcAsService<Array<{ user_id?: string; phone?: string }>>(
      "wa_internal_alert_recipients", { p_conversation: i.conversationId, p_departments: i.departments },
    );
    const recipients = recipsR.ok && Array.isArray(recipsR.data) ? recipsR.data : [];
    const list = allowlist();
    const live = liveCreds();

    for (const r of recipients) {
      const phone = (r.phone || "").trim();
      if (!phone) continue;
      const audit = (status: string, error: string | null, waId: string | null) =>
        rpcAsService("wa_log_internal_alert", {
          p_conversation: i.conversationId, p_contact: i.contactId, p_user: r.user_id ?? null,
          p_phone: phone, p_status: status, p_reason: error, p_wa_message_id: waId,
        }).catch(() => undefined);

      if (!live) { await audit("skipped", "no_creds", null); continue; }
      if (list.length > 0 && !list.includes(digits(phone))) { await audit("blocked", "not_in_allowlist", null); continue; }
      const sent = await sendTemplate(phone, i);
      await audit(sent.ok ? "sent" : "failed", sent.error, sent.waId);
    }
    console.log(`[whatsapp/internal-alert] processed conversation_id=${i.conversationId} recipients=${recipients.length}`);
  } catch (e) {
    console.error("[whatsapp/internal-alert] failed_non_blocking:", e);
  }
}
