// ════════════════════════════════════════════════════════════════════════
// Kian — render a notification_deliveries row into channel-specific content.
// Email: professional Arabic subject/body (+ portal link). WhatsApp: maps the
// event to an APPROVED Meta template name (from env) + ordered variables.
// Client-facing WhatsApp with no mapped template → caller skips no_approved_template.
// SERVER-ONLY (reads env template names + portal url).
// ════════════════════════════════════════════════════════════════════════
if (typeof window !== "undefined") throw new Error("lib/server/deliveryRender is server-only");

export interface DeliveryRow {
  event_type: string;
  entity_type: string | null;
  entity_id: string | null;
  recipient_role: string;
  channel: string;
  destination_email: string | null;
  destination_phone: string | null;
}

const PORTAL = (process.env.PORTAL_PUBLIC_URL || process.env.NEXT_PUBLIC_SITE_URL || "https://www.kianmedia.com").replace(/\/+$/, "");

/** Where a recipient should land in the portal for an event. */
function portalPath(event: string, role: string): string {
  if (role !== "client") {
    if (event.startsWith("estimate") || event.includes("quote") || event === "new_quote_request") return "/client-portal/quotes";
    if (event.includes("invoice")) return "/client-portal/invoices";
    if (event.includes("project") || event.includes("deliverable")) return "/client-portal/projects";
    if (event === "client_message") return "/client-portal/messages";
    if (event === "client_file_upload" || event === "files_received") return "/client-portal/files";
    return "/client-portal";
  }
  if (event.startsWith("estimate") || event === "new_quote_request") return "/client-portal/quotes";
  if (event.includes("invoice")) return "/client-portal/invoices";
  if (event.includes("project") || event.includes("deliverable")) return "/client-portal/projects";
  return "/client-portal";
}
export function portalUrl(event: string, role: string): string { return `${PORTAL}${portalPath(event, role)}`; }

// ── Email copy (Arabic). Client = clean/non-technical; staff = actionable. ──
const CLIENT_EMAIL: Record<string, { subject: string; body: string }> = {
  estimate_published:      { subject: "عرض السعر جاهز للمراجعة — كيان ميديا", body: "تم إصدار عرض سعر رسمي خاص بك. يمكنك مراجعته واعتماده أو طلب تعديل من بوابة العملاء." },
  official_invoice_issued: { subject: "فاتورتك جاهزة — كيان ميديا", body: "تم إصدار فاتورتك الرسمية. يمكنك استعراضها وتحميلها من بوابة العملاء." },
  project_status_changed:  { subject: "تحديث على مشروعك — كيان ميديا", body: "تم تحديث حالة مشروعك. يمكنك متابعة التفاصيل من بوابة العملاء." },
  deliverable_ready:       { subject: "ملف جاهز للمراجعة — كيان ميديا", body: "أصبح أحد ملفات مشروعك جاهزًا لمراجعتك. يمكنك معاينته من بوابة العملاء." },
  deliverable_final:       { subject: "التسليم النهائي جاهز — كيان ميديا", body: "تم تجهيز التسليم النهائي لمشروعك. يمكنك تحميله من بوابة العملاء." },
  new_quote_request:       { subject: "تم استلام طلبك — كيان ميديا", body: "شكرًا لتواصلك مع كيان ميديا. تم استلام طلبك وسيتابع فريقنا معك قريبًا." },
  booking_request:         { subject: "تم استلام طلب الحجز — كيان ميديا", body: "شكرًا لك. تم استلام طلب الاجتماع/المكالمة وسيتواصل معك فريقنا لتأكيد الموعد." },
  files_received:          { subject: "تم استلام ملفاتك — كيان ميديا", body: "تم استلام الملفات التي شاركتها. سيراجعها فريقنا ويتابع معك." },
  contact_request:         { subject: "تم استلام رسالتك — كيان ميديا", body: "شكرًا لتواصلك. تم استلام رسالتك وسيرد عليك فريقنا قريبًا." },
  new_account_signup:      { subject: "مرحبًا بك في بوابة كيان ميديا", body: "تم إنشاء حسابك بنجاح. يمكنك الآن متابعة طلباتك ومشاريعك وعروض الأسعار من بوابة العملاء." },
};
const STAFF_EMAIL: Record<string, string> = {
  new_quote_request: "طلب عرض سعر جديد من الموقع", booking_request: "طلب حجز/اجتماع جديد",
  contact_request: "رسالة تواصل جديدة من الموقع", files_received: "تم استلام ملفات من زائر",
  client_message: "رسالة جديدة من عميل في البوابة", client_file_upload: "رفع عميل ملفات/روابط",
  estimate_created: "تم إنشاء تقدير في Zoho Books", estimate_synced: "تمت مزامنة تقدير من Zoho",
  client_approved: "وافق العميل على عرض السعر", client_rejected: "رفض العميل عرض السعر",
  client_requested_revision: "طلب العميل تعديل عرض السعر", draft_invoice_created: "تم إنشاء مسودة فاتورة",
  official_invoice_issued: "تم إصدار فاتورة رسمية", project_created: "تم إنشاء مشروع جديد",
  opportunity_received: "طلب جديد في مركز الفرص", new_account_signup: "تسجيل حساب جديد في البوابة",
};

export function renderEmail(row: DeliveryRow): { subject: string; html: string; text: string } {
  const url = portalUrl(row.event_type, row.recipient_role);
  const ref = row.entity_id ? row.entity_id.slice(0, 8) : "";
  let subject: string, intro: string;
  if (row.recipient_role === "client") {
    const c = CLIENT_EMAIL[row.event_type] || { subject: "إشعار من كيان ميديا", body: "لديك تحديث جديد في بوابة العملاء." };
    subject = c.subject; intro = c.body;
  } else {
    subject = `[كيان] ${STAFF_EMAIL[row.event_type] || row.event_type}`;
    intro = `${STAFF_EMAIL[row.event_type] || row.event_type}${ref ? ` — مرجع: ${ref}` : ""}. افتح لوحة الإدارة للمتابعة.`;
  }
  const btn = row.recipient_role === "client" ? "فتح بوابة العملاء" : "فتح اللوحة";
  const text = `${intro}\n\n${url}\n\nكيان ميديا`;
  const html = `<!doctype html><html dir="rtl" lang="ar"><body style="margin:0;background:#0b0b0c;font-family:Tahoma,Arial,sans-serif;color:#fff">`
    + `<div style="max-width:560px;margin:0 auto;padding:28px 22px">`
    + `<div style="font-size:18px;font-weight:700;color:#E31E24;margin-bottom:14px">كيان ميديا</div>`
    + `<p style="font-size:15px;line-height:1.9;color:#e8e8ea">${intro}</p>`
    + (ref ? `<p style="font-size:12px;color:#9a9aa0">المرجع: ${ref}</p>` : "")
    + `<a href="${url}" style="display:inline-block;margin-top:14px;background:#E31E24;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-size:14px">${btn}</a>`
    + `<p style="font-size:11px;color:#6b6b70;margin-top:24px">هذه رسالة آلية من بوابة كيان ميديا.</p>`
    + `</div></body></html>`;
  return { subject, html, text };
}

// ── WhatsApp template mapping (approved Meta templates, names from env). ──
const T = (k: string, d: string) => process.env[k] || d;
export function whatsappTemplate(row: DeliveryRow): { name: string; variables: string[] } | null {
  const ref = row.entity_id ? row.entity_id.slice(0, 8) : "";
  if (row.recipient_role === "client") {
    switch (row.event_type) {
      case "estimate_published":      return { name: T("WHATSAPP_TEMPLATE_QUOTE_READY_AR", "quote_ready_ar"), variables: [ref] };
      case "booking_request":         return { name: T("WHATSAPP_TEMPLATE_BOOKING_RECEIVED_AR", "booking_received_ar"), variables: [ref] };
      case "files_received":          return { name: T("WHATSAPP_TEMPLATE_FILES_RECEIVED_AR", "files_received_ar"), variables: [ref] };
      case "official_invoice_issued": return { name: T("WHATSAPP_TEMPLATE_INVOICE_ISSUED_AR", "invoice_issued_ar"), variables: [ref] };
      // New client confirmations. Gated on the env var being set: until you create &
      // approve the Meta template and set its name, these cleanly skip (no_approved_template)
      // instead of failing — so enabling them is a config step, never a code change.
      case "new_quote_request":       return process.env.WHATSAPP_TEMPLATE_QUOTE_REQUEST_RECEIVED_AR ? { name: process.env.WHATSAPP_TEMPLATE_QUOTE_REQUEST_RECEIVED_AR, variables: [ref] } : null;
      case "new_account_signup":      return process.env.WHATSAPP_TEMPLATE_WELCOME_AR ? { name: process.env.WHATSAPP_TEMPLATE_WELCOME_AR, variables: [ref] } : null;
      default: return null; // no approved client template for this event → skip no_approved_template
    }
  }
  // Staff: a single internal-alert template carries the event label + reference.
  return { name: T("WHATSAPP_TEMPLATE_CLIENT_ACTION_INTERNAL_AR", "client_action_internal_ar"),
           variables: [STAFF_EMAIL[row.event_type] || row.event_type, ref] };
}
