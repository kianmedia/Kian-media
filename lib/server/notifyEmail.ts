// ════════════════════════════════════════════════════════════════════════
// Kian — SERVER-ONLY email alerts for new WhatsApp messages.
//
// Reuses the existing Apps Script Web App channel (the quote forms already POST
// there) so NO SMTP/provider keys live in this repo — the Apps Script holds mail
// credentials server-side. We POST `_type:"portal_notify", Event:"whatsapp_new"`
// with explicit recipients computed by our server (owner/admin/manager + the
// relevant department only).
//
// SAFETY:
//   • DISABLED by default. Sends only when WHATSAPP_EMAIL_ALERTS_ENABLED === "true".
//   • NEVER throws — email failure must not block WhatsApp ingest.
//   • No secrets logged.
//
// ⚠️ Delivery requires the Apps Script `doPost` to handle Event "whatsapp_new"
// (see README_DEPLOY). Until then this is a harmless best-effort POST.
// ════════════════════════════════════════════════════════════════════════

import { SHEETS_ENDPOINT } from "@/lib/submitForm";

if (typeof window !== "undefined") {
  throw new Error("lib/server/notifyEmail must never be imported in the browser");
}

export function emailAlertsEnabled(): boolean {
  return process.env.WHATSAPP_EMAIL_ALERTS_ENABLED === "true";
}

function endpoint(): string {
  return process.env.PORTAL_NOTIFY_ENDPOINT || SHEETS_ENDPOINT || "";
}

function publicBase(): string {
  return (process.env.PORTAL_PUBLIC_URL || "https://www.kianmedia.com").replace(/\/+$/, "");
}

export interface WhatsAppEmailInput {
  recipients: string[];           // owner/admin/manager + routed-department team + assignee
  contactName: string;
  phone: string;
  preview: string;
  departments: string[];
  priority?: string;
  conversationId: string;
  zohoLeadId?: string | null;
}

/** Fire-and-forget department-scoped email alert. Never throws. */
export async function sendWhatsAppAlertEmail(input: WhatsAppEmailInput): Promise<void> {
  try {
    if (!emailAlertsEnabled()) return;
    const to = Array.from(new Set(input.recipients.filter((e) => e && e.includes("@"))));
    if (to.length === 0) return;
    const url = endpoint();
    if (!url.startsWith("https://")) return;
    const link = `${publicBase()}/client-portal/admin/whatsapp?conversation=${encodeURIComponent(input.conversationId)}`;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        _type: "portal_notify",
        Event: "whatsapp_new",
        Subject: "رسالة واتساب جديدة - كيان",
        To: to.join(","),
        "Contact Name": input.contactName,
        Phone: input.phone,
        Department: input.departments.join(", "),
        Priority: input.priority ?? "",
        Preview: input.preview,
        "Zoho Lead": input.zohoLeadId ? `https://crm.zoho.sa/crm/tab/Leads/${input.zohoLeadId}` : "",
        Message: "وردت رسالة واتساب جديدة. افتح المحادثة في البوابة.",
        Link: link,
      }),
    });
  } catch {
    /* email failure must never block WhatsApp ingest */
  }
}
