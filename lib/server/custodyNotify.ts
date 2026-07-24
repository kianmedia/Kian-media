// ════════════════════════════════════════════════════════════════════════
// Kian — custody/rental notifications (SERVER-ONLY): EMAIL relay over the
// existing Apps Script channel + staged n8n webhook.
//
// OBSERVABILITY CONTRACT (Vercel logs — never logs the endpoint URL/secrets):
//   custody_email_attempt  { event, record, recipient_count, has_endpoint,
//                            endpoint_host, email_enabled, runtime_env }
//   custody_email_skipped  { reason: disabled | no_endpoint }
//   custody_email_success  { event, record, http_status }
//   custody_email_failed   { event, record, http_status | error }
//
// RULES:
//   • EMAIL is ENABLED BY DEFAULT (CUSTODY_EMAIL_ALERTS_ENABLED=false disables).
//   • Endpoint = PORTAL_NOTIFY_ENDPOINT || NEXT_PUBLIC SHEETS_ENDPOINT (trimmed).
//   • An EMPTY recipient list does NOT skip the send — the Apps Script handler
//     has its own fallback inbox; we still POST and log recipient_count=0.
//   • Email failure never blocks the business action, but it ALWAYS logs.
// ════════════════════════════════════════════════════════════════════════

import { SHEETS_ENDPOINT } from "@/lib/submitForm";
import { interpretRelayResponse } from "@/lib/server/projectNotify";

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
  reference?: string;               // rental quote request reference (REN/Q-…)
  channels?: string[];
}

const log = (tag: string, extra: Record<string, unknown>) =>
  console.log(JSON.stringify({ tag, ...extra }));

// ─── env readers (server-side, trimmed — a stray space/newline in Vercel would
//     otherwise silently fail the https:// check) ───
export function custodyEmailEnabled(): boolean {
  return (process.env.CUSTODY_EMAIL_ALERTS_ENABLED ?? "").trim() !== "false";
}
export function emailEndpoint(): string {
  return (process.env.PORTAL_NOTIFY_ENDPOINT || SHEETS_ENDPOINT || "").trim();
}
export function emailEndpointHost(): string {
  try { return new URL(emailEndpoint()).host; } catch { return ""; }
}
export function runtimeEnv(): string {
  return process.env.VERCEL_ENV || process.env.NODE_ENV || "unknown";
}
function publicBase(): string {
  return (process.env.PORTAL_PUBLIC_URL || "https://www.kianmedia.com").replace(/\/+$/, "");
}

// ─── n8n webhook (staged; unchanged behavior) ───
export function custodyWebhookConfigured(): boolean {
  return (process.env.N8N_NOTIFY_WEBHOOK_URL ?? "").trim().length > 0;
}
export async function postCustodyEvent(payload: CustodyEventPayload):
  Promise<{ sent: boolean; reason?: string }> {
  const url = (process.env.N8N_NOTIFY_WEBHOOK_URL ?? "").trim();
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
      log("custody_webhook_failed", { event: payload.event, record: payload.record_no || payload.record_id, http_status: res.status });
      return { sent: false, reason: `http_${res.status}` };
    }
    return { sent: true };
  } catch (e) {
    log("custody_webhook_failed", { event: payload.event, record: payload.record_no || payload.record_id, error: String(e).slice(0, 200) });
    return { sent: false, reason: "network" };
  }
}

// ─── Email relay ───
const EVENT_SUBJECTS: Record<string, string> = {
  custody_checkout_new:       "عهدة جديدة — كيان",
  rental_request_new:         "طلب تأجير معدات جديد — كيان",
  rental_quote_request_new:   "طلب عرض سعر تأجير معدات — كيان",
  custody_return_submitted:   "إرجاع عهدة بانتظار المراجعة — كيان",
  custody_return_shortage:    "⚠ بلاغ نقص/تلف في إرجاع عهدة — كيان",
  custody_handover_approved:  "اعتماد تسليم معدات — كيان",
  custody_closed:             "إقفال عهدة — كيان",
  custody_rejected:           "رفض طلب عهدة/تأجير — كيان",
  custody_note_new:           "ملاحظة إدارية على عهدة — كيان",
  custody_claim_pending:      "⚠ مطالبة مالية على عهدة — كيان",
  custody_claim_acknowledged: "توقيع تعهد سداد مطالبة — كيان",
};

/** POSTs the portal_notify email payload. ALWAYS logs the outcome. */
export async function sendCustodyEmail(input: CustodyEventPayload & { recipients: string[] }):
  Promise<{ sent: boolean; reason?: string }> {
  const record = input.record_no || input.reference || input.record_id;
  if (!custodyEmailEnabled()) {
    log("custody_email_skipped", { reason: "disabled", event: input.event, record });
    return { sent: false, reason: "disabled" };
  }
  const url = emailEndpoint();
  if (!url.startsWith("https://")) {
    log("custody_email_skipped", { reason: "no_endpoint", event: input.event, record, has_endpoint: false, runtime_env: runtimeEnv() });
    return { sent: false, reason: "no_endpoint" };
  }
  const to = Array.from(new Set(input.recipients.filter((e) => e && e.includes("@"))));
  log("custody_email_attempt", {
    event: input.event, record, recipient_count: to.length,
    has_endpoint: true, endpoint_host: emailEndpointHost(),
    email_enabled: true, runtime_env: runtimeEnv(),
  });
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        _type: "portal_notify",
        To: to.join(","),                                   // فارغة ⇒ سكربت Apps يستخدم بريده الاحتياطي
        Subject: EVENT_SUBJECTS[input.event] || "تحديث عهدة/تأجير — كيان",
        Event: input.event,
        Record: record ?? "",
        Kind: input.kind === "rental" ? "تأجير خارجي" : input.kind === "custody" ? "عهدة داخلية" : "",
        Party: input.party_name ?? "",
        Amount: input.amount != null ? `${input.amount} SAR` : "",
        Urgent: input.urgent ? "URGENT" : "",
        Message: "حدث تحديث في نظام العهدة والتأجير. افتح البوابة للتفاصيل.",
        Link: `${publicBase()}/client-portal/equipment`,
      }),
      cache: "no-store",
      redirect: "follow",                                    // Apps Script /exec يعيد توجيه 302
    });
    if (res.ok || res.status === 302) {
      // Batch 11 — this branch used to log custody_email_success on a bare HTTP 2xx
      // WITHOUT reading the reply, so "success" in the logs proved nothing: the relay
      // answers 200 even when it drops a portal_notify payload without emailing anyone.
      // Require the relay's tagged acknowledgment instead.
      let bodyText = "";
      try { bodyText = await res.text(); } catch { bodyText = ""; }
      const conf = interpretRelayResponse(bodyText);
      if (conf.rejected) {
        log("custody_email_failed", { event: input.event, record, reason: conf.reason });
        return { sent: false, reason: conf.reason ?? "provider_rejected" };
      }
      if (!conf.handlerPresent) {
        log("custody_email_failed", { event: input.event, record, reason: "relay_handler_missing", hint: "apply docs/apps_script_portal_notify_HANDLER.gs" });
        return { sent: false, reason: "relay_handler_missing" };
      }
      log("custody_email_success", { event: input.event, record, http_status: res.status, recipient_count: to.length, delivered: conf.sentCount ?? to.length });
      return { sent: true };
    }
    log("custody_email_failed", { event: input.event, record, http_status: res.status });
    return { sent: false, reason: `http_${res.status}` };
  } catch (e) {
    log("custody_email_failed", { event: input.event, record, error: String(e).slice(0, 200) });
    return { sent: false, reason: "network" };
  }
}
