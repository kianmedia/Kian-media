// ════════════════════════════════════════════════════════════════════════
// Kian — SERVER-ONLY customer confirmation after a WhatsApp quote submission.
//
// Two independent, gated, non-blocking channels:
//   • Email  (QUOTE_REQUEST_CUSTOMER_EMAIL_ENABLED) — via the Apps Script channel
//     (no SMTP keys here), Event "quote_received".
//   • WhatsApp (QUOTE_REQUEST_CUSTOMER_WHATSAPP_CONFIRM_ENABLED + allowlist) — a
//     free-form text inside the open 24h session window.
// The quote submission must succeed even if both confirmations fail. Audited via
// wa_log_quote_notify. Tokens server-only, never logged.
// ════════════════════════════════════════════════════════════════════════

import { SHEETS_ENDPOINT } from "@/lib/submitForm";
import { rpcAsService } from "@/lib/server/supabaseAdmin";
import { sendTextMessage, whatsappCredsPresent, digitsOnly } from "@/lib/server/whatsappCloud";

if (typeof window !== "undefined") {
  throw new Error("lib/server/quoteConfirm must never be imported in the browser");
}

export function quoteEmailConfirmEnabled(): boolean {
  return process.env.QUOTE_REQUEST_CUSTOMER_EMAIL_ENABLED === "true";
}
export function quoteWhatsappConfirmEnabled(): boolean {
  return process.env.QUOTE_REQUEST_CUSTOMER_WHATSAPP_CONFIRM_ENABLED === "true";
}
function waConfirmAllowlist(): string[] {
  return (process.env.QUOTE_REQUEST_CUSTOMER_WHATSAPP_CONFIRM_TEST_ALLOWLIST || "").split(",").map((s) => digitsOnly(s)).filter(Boolean);
}
function emailEndpoint(): string {
  return process.env.PORTAL_NOTIFY_ENDPOINT || SHEETS_ENDPOINT || "";
}

export interface QuoteConfirmInput {
  conversationId: string; quoteId: string; requestNumber: string;
  fullName: string; email: string; phone: string; services: string; city: string; preferredDate: string;
}

/** Fire both confirmations (each gated). Never throws. */
export async function sendQuoteConfirmations(i: QuoteConfirmInput): Promise<void> {
  const audit = (channel: string, status: string, reason: string | null) =>
    rpcAsService("wa_log_quote_notify", {
      p_conversation: i.conversationId, p_quote: i.quoteId, p_channel: channel, p_phone: i.phone,
      p_email: i.email, p_keyword: null, p_mode: null, p_status: status, p_reason: reason,
    }).catch(() => undefined);

  // ── Email confirmation ──────────────────────────────────────────────────
  try {
    if (!quoteEmailConfirmEnabled()) {
      await audit("email_confirm", "skipped", "disabled");
    } else if (!i.email || !i.email.includes("@")) {
      await audit("email_confirm", "skipped", "no_email");
    } else {
      const url = emailEndpoint();
      if (!url.startsWith("https://")) {
        await audit("email_confirm", "skipped", "no_endpoint");
      } else {
        const res = await fetch(url, {
          method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify({
            _type: "portal_notify", Event: "quote_received",
            Subject: "تم استلام طلب عرض السعر - كيان", To: i.email,
            "Request Number": i.requestNumber, "Customer Name": i.fullName,
            Service: i.services, City: i.city, "Expected Date": i.preferredDate,
            Message: "تم استلام طلبك وسيتم مراجعته من فريق كيان.",
          }),
        });
        await audit("email_confirm", res.ok ? "sent" : "failed", res.ok ? null : `http_${res.status}`);
      }
    }
  } catch (e) {
    await audit("email_confirm", "failed", "exception").catch(() => undefined);
    console.error("[quote-confirm] email failed_non_blocking:", e);
  }

  // ── WhatsApp confirmation ───────────────────────────────────────────────
  try {
    if (!quoteWhatsappConfirmEnabled()) { await audit("whatsapp_confirm", "skipped", "disabled"); return; }
    const phone = digitsOnly(i.phone);
    if (!phone) { await audit("whatsapp_confirm", "skipped", "no_phone"); return; }
    if (!whatsappCredsPresent()) { await audit("whatsapp_confirm", "skipped", "no_creds"); return; }
    const list = waConfirmAllowlist();
    if (list.length > 0 && !list.includes(phone)) { await audit("whatsapp_confirm", "blocked", "not_in_allowlist"); return; }
    const msg = `تم استلام طلب عرض السعر بنجاح. رقم طلبك: ${i.requestNumber || "—"}. سيقوم فريق كيان بمراجعة الطلب والتواصل معك قريبًا.`;
    const sent = await sendTextMessage(phone, msg);
    if (sent.ok) {
      await rpcAsService("wa_record_outgoing", {
        p_conversation: i.conversationId, p_body: msg, p_direction: "outgoing", p_status: "sent", p_wa_message_id: sent.waId,
      }).catch(() => undefined);
      await audit("whatsapp_confirm", "sent", null);
    } else {
      await audit("whatsapp_confirm", "failed", sent.error);
    }
  } catch (e) {
    await audit("whatsapp_confirm", "failed", "exception").catch(() => undefined);
    console.error("[quote-confirm] whatsapp failed_non_blocking:", e);
  }
}
