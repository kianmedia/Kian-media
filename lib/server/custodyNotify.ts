// ════════════════════════════════════════════════════════════════════════
// Kian — custody/rental notifications (SERVER-ONLY): staged n8n webhook +
// EMAIL relay over the existing Apps Script channel.
//
// Portal notifications are written by the SQL RPCs (source of truth). This
// module adds the outbound channels per the custody brief §8:
//   • EMAIL — POSTs `_type:"portal_notify", Event:"custody_*"` to the existing
//     Apps Script Web App (same channel as lib/server/notifyEmail.ts — no SMTP
//     keys in the repo). Gated by CUSTODY_EMAIL_ALERTS_ENABLED === "true".
//     ⚠️ Delivery requires the Apps Script doPost to handle Event custody_*.
//   • n8n WEBHOOK — channel-ready fan-out (email/WhatsApp later); fail-closed
//     until N8N_NOTIFY_WEBHOOK_URL is set. WhatsApp stays disabled inside n8n
//     until Meta verification clears (activated with the notifications phase).
//
// NEVER throws. No secrets logged. Does NOT touch the existing WhatsApp code.
// Env (new, namespaced): N8N_NOTIFY_WEBHOOK_URL, N8N_NOTIFY_SECRET,
// CUSTODY_EMAIL_ALERTS_ENABLED. Reuses: PORTAL_NOTIFY_ENDPOINT / SHEETS_ENDPOINT.
// ════════════════════════════════════════════════════════════════════════

import { SHEETS_ENDPOINT } from "@/lib/submitForm";

if (typeof window !== "undefined") {
  throw new Error("lib/server/custodyNotify must never be imported in the browser");
}

export interface CustodyEventPayload {
  event: string;
  record_id: string;
  record_no?: string;
  kind?: string;                    // custody | rental
  party_name?: string;
  urgent?: boolean;
  amount?: number;
  channels?: string[];
}

// ─── n8n webhook (staged) ───
export function custodyWebhookConfigured(): boolean {
  return (process.env.N8N_NOTIFY_WEBHOOK_URL ?? "").length > 0;
}

export async function postCustodyEvent(payload: CustodyEventPayload):
  Promise<{ sent: boolean; reason?: string }> {
  const url = process.env.N8N_NOTIFY_WEBHOOK_URL ?? "";
  if (!url) return { sent: false, reason: "not_configured" };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.N8N_NOTIFY_SECRET ? { "x-kian-notify-secret": process.env.N8N_NOTIFY_SECRET } : {}),
      },
      body: JSON.stringify({ source: "kian-portal-custody", ...payload }),
      cache: "no-store",
    });
    if (!res.ok) {
      console.error(`[custody/notify] webhook HTTP ${res.status} for event=${payload.event} record=${payload.record_no || payload.record_id}`);
      return { sent: false, reason: `http_${res.status}` };
    }
    return { sent: true };
  } catch (e) {
    console.error(`[custody/notify] webhook failed for event=${payload.event}: ${String(e)}`);
    return { sent: false, reason: "network" };
  }
}

// ─── Email relay (existing Apps Script channel; no provider keys) ───
// ENABLED BY DEFAULT (set CUSTODY_EMAIL_ALERTS_ENABLED=false to switch off).
// Actual delivery requires the Apps Script doPost to handle _type=portal_notify
// (paste-ready handler: docs/custody/apps_script_custody_email_SETUP.md).
export function custodyEmailEnabled(): boolean {
  return process.env.CUSTODY_EMAIL_ALERTS_ENABLED !== "false";
}
function emailEndpoint(): string {
  return process.env.PORTAL_NOTIFY_ENDPOINT || SHEETS_ENDPOINT || "";
}
function publicBase(): string {
  return (process.env.PORTAL_PUBLIC_URL || "https://www.kianmedia.com").replace(/\/+$/, "");
}

const EVENT_SUBJECTS: Record<string, string> = {
  custody_checkout_new:       "عهدة جديدة — كيان",
  rental_request_new:         "طلب تأجير معدات جديد — كيان",
  custody_return_submitted:   "إرجاع عهدة بانتظار المراجعة — كيان",
  custody_return_shortage:    "⚠ بلاغ نقص/تلف في إرجاع عهدة — كيان",
  custody_handover_approved:  "اعتماد تسليم معدات — كيان",
  custody_closed:             "إقفال عهدة — كيان",
  custody_rejected:           "رفض طلب عهدة/تأجير — كيان",
  custody_note_new:           "ملاحظة إدارية على عهدة — كيان",
  custody_claim_pending:      "⚠ مطالبة مالية على عهدة — كيان",
  custody_claim_acknowledged: "توقيع تعهد سداد مطالبة — كيان",
};

/** Fire-and-forget email to admins/custody-officer + the party. Never throws. */
export async function sendCustodyEmail(input: CustodyEventPayload & { recipients: string[] }): Promise<void> {
  try {
    if (!custodyEmailEnabled()) return;
    const to = Array.from(new Set(input.recipients.filter((e) => e && e.includes("@"))));
    if (to.length === 0) return;
    const url = emailEndpoint();
    if (!url.startsWith("https://")) return;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        _type: "portal_notify",
        Event: input.event,
        Subject: EVENT_SUBJECTS[input.event] || "تحديث عهدة/تأجير — كيان",
        To: to.join(","),
        "Record No": input.record_no ?? "",
        Kind: input.kind === "rental" ? "تأجير خارجي" : "عهدة داخلية",
        Party: input.party_name ?? "",
        Amount: input.amount != null ? `${input.amount} SAR` : "",
        Urgent: input.urgent ? "URGENT" : "",
        Message: "حدث تحديث في نظام العهدة والتأجير. افتح البوابة للتفاصيل.",
        Link: `${publicBase()}/client-portal/equipment`,
      }),
      cache: "no-store",
    });
  } catch {
    /* email failure must never block the business action */
  }
}
