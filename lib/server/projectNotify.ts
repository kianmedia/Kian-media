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
// Batch 9E — we must NOT mark 'sent' merely because fetch didn't throw / HTTP was 2xx.
// Contract: the relay returns JSON on a structured reply. If it is parseable JSON with
// an explicit failure (ok/success/accepted === false, or a non-empty error), that is a
// REJECTION even on HTTP 200. If the body is opaque/non-JSON/empty (the relay's normal
// fire-and-forget shape that demonstrably delivers), we trust the 2xx and treat it as
// sent — requiring a positive flag would break the working opaque-success path.
export function interpretRelayResponse(text: string): { rejected: boolean; reason?: string; providerId?: string } {
  const t = (text ?? "").trim();
  if (!t) return { rejected: false };
  let obj: Record<string, unknown> | null = null;
  try { const p = JSON.parse(t); obj = p && typeof p === "object" ? (p as Record<string, unknown>) : null; } catch { obj = null; }
  if (!obj) return { rejected: false };   // non-JSON body → trust the HTTP 2xx
  const pidRaw = obj.messageId ?? obj.message_id ?? obj.id ?? obj.provider_message_id;
  const providerId = typeof pidRaw === "string" && pidRaw ? pidRaw.slice(0, 120) : undefined;
  const flag = obj.ok ?? obj.success ?? obj.accepted ?? obj.sent;
  const errStr = typeof obj.error === "string" ? obj.error : (typeof obj.message === "string" && flag === false ? obj.message : "");
  if (flag === false || (errStr && errStr.length > 0)) {
    return { rejected: true, reason: ("provider_rejected:" + errStr).slice(0, 120), providerId };
  }
  return { rejected: false, providerId };
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
    return { sent: true, providerId: conf.providerId };
  } catch (e) {
    log("project_email_error", { error: String(e).slice(0, 150) });
    return { sent: false, reason: "network_error" };
  }
}
