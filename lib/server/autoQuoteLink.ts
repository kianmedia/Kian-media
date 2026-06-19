// ════════════════════════════════════════════════════════════════════════
// Kian — SERVER-ONLY rule-based auto quote-link reply. OFF by default.
//
// When an inbound WhatsApp message expresses a price/quote intent (detected by
// lib/whatsapp/intent.ts), reply ONCE with a short Arabic message + a quote-request
// link. Heavily gated:
//   • WHATSAPP_AUTO_QUOTE_LINK_ENABLED must be "true" (else no-op).
//   • WHATSAPP_AUTO_QUOTE_LINK_DRY_RUN defaults true → records an internal note, no send.
//   • WHATSAPP_AUTO_QUOTE_LINK_TEST_ALLOWLIST (digits) → only those phones receive it.
//   • Cooldown (default 6h) prevents spamming the same conversation.
// Never throws — auto-reply must not block ingest. Token is server-only, never logged.
// ════════════════════════════════════════════════════════════════════════

import { rpcAsService } from "@/lib/server/supabaseAdmin";
import { sendTextMessage, whatsappCredsPresent, digitsOnly } from "@/lib/server/whatsappCloud";

if (typeof window !== "undefined") {
  throw new Error("lib/server/autoQuoteLink must never be imported in the browser");
}

export function autoQuoteEnabled(): boolean {
  return process.env.WHATSAPP_AUTO_QUOTE_LINK_ENABLED === "true";
}
function dryRun(): boolean {
  return process.env.WHATSAPP_AUTO_QUOTE_LINK_DRY_RUN !== "false"; // fail-safe: default dry-run
}
function allowlist(): string[] {
  return (process.env.WHATSAPP_AUTO_QUOTE_LINK_TEST_ALLOWLIST || "").split(",").map((s) => digitsOnly(s)).filter(Boolean);
}
function cooldownHours(): number {
  const n = Number(process.env.WHATSAPP_AUTO_QUOTE_LINK_COOLDOWN_HOURS);
  return Number.isFinite(n) && n > 0 ? n : 6;
}
function publicBase(): string {
  return (process.env.PORTAL_PUBLIC_URL || "https://www.kianmedia.com").replace(/\/+$/, "");
}

export interface AutoQuoteInput { conversationId: string; phone: string; keyword: string; }

/** Resolve cooldown/open-quote, build the link, then dry-run/block/send + audit. Never throws. */
export async function maybeAutoSendQuoteLink(i: AutoQuoteInput): Promise<void> {
  try {
    if (!autoQuoteEnabled()) return;
    const audit = (status: string, mode: string | null, reason: string | null) =>
      rpcAsService("wa_log_quote_notify", {
        p_conversation: i.conversationId, p_quote: null, p_channel: "auto_link", p_phone: i.phone,
        p_email: null, p_keyword: i.keyword, p_mode: mode, p_status: status, p_reason: reason,
      }).catch(() => undefined);

    const chk = await rpcAsService<{ allowed?: boolean; open_quote_id?: string | null; external_request_id?: string | null }>(
      "wa_should_auto_quote", { p_conversation: i.conversationId, p_cooldown_hours: cooldownHours() });
    if (!chk.ok) { await audit("failed", null, "cooldown_check_failed"); return; }
    if (chk.data?.allowed === false) { await audit("skipped", null, "cooldown"); return; }

    const openId = chk.data?.open_quote_id || null;
    const mode = openId ? "update" : "new";
    const link = openId
      ? `${publicBase()}/quote-request?source=whatsapp&conversation=${i.conversationId}&quote=${openId}&mode=update`
      : `${publicBase()}/quote-request?source=whatsapp&conversation=${i.conversationId}&mode=new`;
    const message = `أهلًا بك في كيان، للحصول على عرض سعر دقيق فضلاً عبّئ الطلب من الرابط التالي، وسيتم تزويدك برقم طلب ومتابعته من فريقنا: ${link}`;

    // DRY RUN → internal note only (visible to staff), no customer send.
    if (dryRun()) {
      await rpcAsService("wa_record_outgoing", {
        p_conversation: i.conversationId, p_body: `[رد تلقائي — وضع تجريبي] ${message}`,
        p_direction: "internal_note", p_status: "dry_run", p_wa_message_id: null,
      }).catch(() => undefined);
      await audit("dry_run", mode, null);
      return;
    }
    if (!whatsappCredsPresent()) { await audit("skipped", mode, "no_creds"); return; }
    const list = allowlist();
    if (list.length > 0 && !list.includes(digitsOnly(i.phone))) { await audit("blocked", mode, "not_in_allowlist"); return; }

    const sent = await sendTextMessage(i.phone, message);
    if (sent.ok) {
      await rpcAsService("wa_record_outgoing", {
        p_conversation: i.conversationId, p_body: message, p_direction: "outgoing",
        p_status: "sent", p_wa_message_id: sent.waId,
      }).catch(() => undefined);
      await audit("sent", mode, null);
    } else {
      await audit("failed", mode, sent.error);
    }
  } catch (e) {
    console.error("[whatsapp/auto-quote] failed_non_blocking:", e);
  }
}
