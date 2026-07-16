// ════════════════════════════════════════════════════════════════════════
// Kian — SERVER-ONLY email sender for Project Core notifications.
//
// Reuses the existing Apps Script Web App channel (same as custody/whatsapp):
// NO SMTP/provider keys in this repo — the Apps Script holds mail credentials.
//
// SAFETY:
//   • DISABLED by default. Sends only when PROJECT_EMAIL_ALERTS_ENABLED === "true".
//   • NEVER throws — email failure must not break the queue loop.
//   • No secrets logged. WhatsApp delivery stays disabled (portal policy).
// ════════════════════════════════════════════════════════════════════════

import { SHEETS_ENDPOINT } from "@/lib/submitForm";

if (typeof window !== "undefined") {
  throw new Error("lib/server/projectNotify must never be imported in the browser");
}

export function projectEmailEnabled(): boolean {
  return process.env.PROJECT_EMAIL_ALERTS_ENABLED === "true";
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

/** إرسال بريد إشعار مشروع — لا يرمي أبدًا. */
export async function sendProjectEmail(input: ProjectEmailInput): Promise<{ sent: boolean; reason?: string }> {
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
      body: JSON.stringify({
        _type: "portal_notify",
        To: to.join(","),
        Subject: input.subject || "تحديث من منصة كيان",
        Event: input.eventType || "project_core_notify",
        Body: input.body || "",
        Link: link,
      }),
    });
    if (!res.ok) { log("project_email_failed", { status: res.status }); return { sent: false, reason: `http_${res.status}` }; }
    return { sent: true };
  } catch (e) {
    log("project_email_error", { error: String(e).slice(0, 150) });
    return { sent: false, reason: "network_error" };
  }
}
