// ════════════════════════════════════════════════════════════════════════
// Kian — SERVER-ONLY email sender for Project Core notifications.
//
// Reuses the existing Apps Script Web App channel (same as custody/whatsapp):
// NO SMTP/provider keys in this repo — the Apps Script holds mail credentials.
//
// SAFETY:
//   • ENABLED BY DEFAULT (opt-out) — matching custody/HR on the SAME Apps Script
//     endpoint. Set PROJECT_EMAIL_ALERTS_ENABLED=false to disable. Batch 9D fix:
//     the previous opt-IN default left the ENTIRE project email channel dark
//     (custody/HR were opt-OUT enabled on the identical endpoint), so project/
//     preview emails never sent while custody emails did. No env change needed.
//   • NEVER throws — email failure must not break the queue loop.
//   • No secrets logged. WhatsApp delivery stays disabled (portal policy).
// ════════════════════════════════════════════════════════════════════════

import { SHEETS_ENDPOINT } from "@/lib/submitForm";

if (typeof window !== "undefined") {
  throw new Error("lib/server/projectNotify must never be imported in the browser");
}

export function projectEmailEnabled(): boolean {
  return (process.env.PROJECT_EMAIL_ALERTS_ENABLED ?? "").trim() !== "false";
}
function endpoint(): string {
  return process.env.PORTAL_NOTIFY_ENDPOINT || SHEETS_ENDPOINT || "";
}
function publicBase(): string {
  return (process.env.PORTAL_PUBLIC_URL || "https://www.kianmedia.com").replace(/\/+$/, "");
}
const log = (tag: string, extra: Record<string, unknown>) => console.log(JSON.stringify({ tag, ...extra }));

export interface ProjectEmailInput {
  to: string[];
  subject: string;
  body?: string | null;
  directUrl?: string | null;   // مسار نسبي داخل البوابة
  eventType?: string | null;
}

export interface ProjectEmailResult { sent: boolean; reason?: string; providerId?: string }

// Interpret the Apps Script relay response body (read AFTER following the /exec 302).
//
// ★ BATCH 11 — THE ROOT CAUSE OF "NO PORTAL EMAIL EVER ARRIVES" ★
// The Apps Script that owns the mail credentials historically contained:
//     if (String(data._type || "") !== "quote") return;   // quotes only
// Every portal notification posts _type:"portal_notify", so the script returned
// IMMEDIATELY, sent nothing, and answered HTTP 200 with an opaque (HTML/text) body.
// The previous contract here "trusted the 2xx" on an opaque body — so every portal
// delivery was marked 'sent' while NOTHING was ever emailed. That silent false
// success is why the queue/worker/resolver repairs could never fix delivery.
//
// NEW CONTRACT — positive acknowledgment is REQUIRED for portal_notify:
//   • JSON with handler:"portal_notify"  → authoritative. ok/sent decide the verdict.
//   • JSON with an explicit failure       → rejection (as before).
//   • JSON that positively affirms (ok/success/accepted === true) → accepted, so a
//     differently-written relay handler still works.
//   • Opaque / non-JSON / empty body      → handlerPresent=false → NOT sent, reason
//     "relay_handler_missing" (the un-patched script). Honest failure, never silent.
// Apply docs/apps_script_portal_notify_HANDLER.gs to the Apps Script to satisfy this.
export interface RelayVerdict {
  rejected: boolean;        // relay explicitly refused
  handlerPresent: boolean;  // relay positively acknowledged handling the payload
  reason?: string;
  providerId?: string;
  sentCount?: number;
}
export function interpretRelayResponse(text: string): RelayVerdict {
  const t = (text ?? "").trim();
  if (!t) return { rejected: false, handlerPresent: false, reason: "relay_handler_missing" };
  let obj: Record<string, unknown> | null = null;
  try { const p = JSON.parse(t); obj = p && typeof p === "object" ? (p as Record<string, unknown>) : null; } catch { obj = null; }
  // Non-JSON body = the un-patched Apps Script (it renders HTML/plain text). It did
  // NOT handle a portal_notify payload — treat as undelivered, not as success.
  if (!obj) return { rejected: false, handlerPresent: false, reason: "relay_handler_missing" };

  const pidRaw = obj.messageId ?? obj.message_id ?? obj.id ?? obj.provider_message_id;
  const providerId = typeof pidRaw === "string" && pidRaw ? pidRaw.slice(0, 120) : undefined;
  const flag = obj.ok ?? obj.success ?? obj.accepted;
  const errStr = typeof obj.error === "string" ? obj.error : (typeof obj.message === "string" && flag === false ? obj.message : "");
  const isPortalHandler = obj.handler === "portal_notify";
  const sentCount = typeof obj.sent === "number" ? obj.sent : undefined;

  if (flag === false || obj.sent === false || (errStr && errStr.length > 0)) {
    return { rejected: true, handlerPresent: isPortalHandler, reason: ("provider_rejected:" + errStr).slice(0, 120), providerId, sentCount };
  }
  if (isPortalHandler) {
    // Authoritative handler reply: delivered only when it actually mailed someone.
    if (sentCount !== undefined && sentCount <= 0) {
      return { rejected: true, handlerPresent: true, reason: "provider_rejected:no_recipients_sent", providerId, sentCount };
    }
    return { rejected: false, handlerPresent: true, providerId, sentCount };
  }
  // ★ A GENERIC {"ok":true} IS NOT PROOF OF DELIVERY. A live probe of the deployed Web
  // App shows it answers {"ok":true,"message":"Kian Media forms API is live"} — a health
  // banner, not a send receipt. Accepting any truthy `ok` would recreate the exact false
  // success this batch exists to kill. ONLY the tagged handler reply counts.
  return { rejected: false, handlerPresent: false, reason: "relay_handler_missing", providerId, sentCount };
}

/** إرسال بريد إشعار مشروع — لا يرمي أبدًا. يؤكّد القبول من ردّ المُرحِّل (لا HTTP 200 وحده). */
export async function sendProjectEmail(input: ProjectEmailInput): Promise<ProjectEmailResult> {
  if (!projectEmailEnabled()) return { sent: false, reason: "disabled" };
  const url = endpoint();
  if (!url.startsWith("https://")) return { sent: false, reason: "no_endpoint" };
  const to = Array.from(new Set(input.to.filter((e) => e && e.includes("@"))));
  if (to.length === 0) return { sent: false, reason: "no_recipients" };
  const link = input.directUrl ? `${publicBase()}${input.directUrl.startsWith("/") ? "" : "/"}${input.directUrl}` : publicBase();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      cache: "no-store",
      redirect: "follow",   // Apps Script /exec answers with a 302 to the real body
      body: JSON.stringify({
        _type: "portal_notify",
        To: to.join(","),
        Subject: input.subject || "تحديث من منصة كيان",
        Event: input.eventType || "project_core_notify",
        Body: input.body || "",
        Link: link,
      }),
    });
    if (!res.ok && res.status !== 302) { log("project_email_failed", { status: res.status }); return { sent: false, reason: `http_${res.status}` }; }
    // Confirm the relay actually accepted the send (not just HTTP 2xx).
    let bodyText = "";
    try { bodyText = await res.text(); } catch { bodyText = ""; }
    const conf = interpretRelayResponse(bodyText);
    if (conf.rejected) { log("project_email_rejected", { reason: conf.reason }); return { sent: false, reason: conf.reason ?? "provider_rejected" }; }
    // The relay must POSITIVELY acknowledge handling portal_notify. An opaque 200 from
    // the un-patched Apps Script means the payload was silently dropped — reporting it
    // as 'sent' is exactly the false success that hid this outage. Channel-level reason
    // (the worker defers instead of burning attempts / dead-lettering).
    if (!conf.handlerPresent) {
      log("project_email_relay_handler_missing", { hint: "apply docs/apps_script_portal_notify_HANDLER.gs to the Apps Script" });
      return { sent: false, reason: "relay_handler_missing" };
    }
    return { sent: true, providerId: conf.providerId };
  } catch (e) {
    log("project_email_error", { error: String(e).slice(0, 150) });
    return { sent: false, reason: "network_error" };
  }
}
