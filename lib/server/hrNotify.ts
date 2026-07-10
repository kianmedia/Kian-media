// ════════════════════════════════════════════════════════════════════════
// Kian — HR notifications email relay (SERVER-ONLY). Same proven channel as
// custody: POSTs `_type:"portal_notify"` to the existing Apps Script Web App
// (PORTAL_NOTIFY_ENDPOINT || SHEETS_ENDPOINT). No SMTP/provider keys.
//
// OBSERVABILITY (Vercel logs — never the endpoint URL/secrets):
//   hr_notify_created / hr_email_attempt / hr_email_skipped /
//   hr_email_success / hr_email_failed
// Email failure NEVER blocks the business action. WhatsApp stays deferred.
// Enabled by default — HR_EMAIL_ALERTS_ENABLED=false disables (no new env needed).
// ════════════════════════════════════════════════════════════════════════

import { SHEETS_ENDPOINT } from "@/lib/submitForm";

if (typeof window !== "undefined") {
  throw new Error("lib/server/hrNotify must never be imported in the browser");
}

export interface HrEventPayload {
  event: string;
  entity_id: string;
  title?: string;          // human line (e.g. "حضور: خالد — 08:55")
  employee_name?: string;
  urgent?: boolean;
  message?: string;        // v3.1 FIX: نص بريد مخصّص (تفاصيل المهمة) — يتجاوز الافتراضي
  subject?: string;        // عنوان بريد مخصّص — يتجاوز EVENT_SUBJECTS
}

const log = (tag: string, extra: Record<string, unknown>) =>
  console.log(JSON.stringify({ tag, ...extra }));

export function hrEmailEnabled(): boolean {
  return (process.env.HR_EMAIL_ALERTS_ENABLED ?? "").trim() !== "false";
}
export function hrEmailEndpoint(): string {
  return (process.env.PORTAL_NOTIFY_ENDPOINT || SHEETS_ENDPOINT || "").trim();
}
export function hrEmailEndpointHost(): string {
  try { return new URL(hrEmailEndpoint()).host; } catch { return ""; }
}
export function hrRuntimeEnv(): string {
  return process.env.VERCEL_ENV || process.env.NODE_ENV || "unknown";
}
function publicBase(): string {
  return (process.env.PORTAL_PUBLIC_URL || "https://www.kianmedia.com").replace(/\/+$/, "");
}

const EVENT_SUBJECTS: Record<string, string> = {
  hr_check_in:            "تسجيل حضور موظف — كيان",
  hr_check_out:           "تسجيل انصراف موظف — كيان",
  hr_leave_new:           "طلب إجازة/إذن جديد — كيان",
  hr_leave_decided:       "قرار طلب إجازة — كيان",
  hr_task_new:            "مهمة ميدانية جديدة — كيان",
  hr_task_started:        "بدء مهمة ميدانية — كيان",
  hr_task_submitted:      "تسليم مهمة ميدانية — كيان",
  hr_task_closed:         "إغلاق مهمة ميدانية — كيان",
  hr_attendance_adjusted: "تعديل إداري على حضور — كيان",
  hr_note_new:            "ملاحظة موارد بشرية جديدة — كيان",
  hr_task_updated:        "تحديث مهمة ميدانية — كيان",
  hr_settings_updated:    "تحديث إعدادات الموارد البشرية — كيان",
  hr_leave_deleted:       "حذف إداري لطلب إجازة — كيان",
  hr_leave_updated:       "تعديل إداري لطلب إجازة — كيان",
  hr_attendance_voided:   "إلغاء إداري لسجل حضور — كيان",
  hr_task_deleted:        "حذف إداري لمهمة ميدانية — كيان",
  hr_employee_status_updated: "تغيير حالة موظف — كيان",
  hr_device_user_mapped:  "ربط جهاز حضور بموظف — كيان",
  hr_device_event_imported:  "استيراد حدث جهاز حضور — كيان",
  hr_device_event_processed: "معالجة حدث جهاز حضور — كيان",
  hr_correction_new:      "طلب تعديل حضور جديد — كيان",
  hr_correction_decided:  "قرار طلب تعديل حضور — كيان",
  hr_calendar_updated:    "تحديث تقويم الموارد البشرية — كيان",
  hr_document_added:      "وثيقة موظف — كيان",
  hr_supervisor_link_updated: "تحديث الإشراف الميداني — كيان",
  hr_supervisor_note:     "ملاحظة مشرف ميداني — كيان",
};

/** POSTs the portal_notify email payload. ALWAYS logs the outcome. */
export async function sendHrEmail(input: HrEventPayload & { recipients: string[] }):
  Promise<{ sent: boolean; reason?: string }> {
  const record = input.entity_id;
  if (!hrEmailEnabled()) {
    log("hr_email_skipped", { reason: "disabled", event: input.event, record });
    return { sent: false, reason: "disabled" };
  }
  const url = hrEmailEndpoint();
  if (!url.startsWith("https://")) {
    log("hr_email_skipped", { reason: "no_endpoint", event: input.event, record, has_endpoint: false, runtime_env: hrRuntimeEnv() });
    return { sent: false, reason: "no_endpoint" };
  }
  const to = Array.from(new Set(input.recipients.filter((e) => e && e.includes("@"))));
  log("hr_email_attempt", {
    event: input.event, record, recipient_count: to.length,
    has_endpoint: true, endpoint_host: hrEmailEndpointHost(),
    email_enabled: true, runtime_env: hrRuntimeEnv(),
  });
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        _type: "portal_notify",
        To: to.join(","),                                  // فارغة ⇒ البريد الاحتياطي في السكربت
        Subject: input.subject || EVENT_SUBJECTS[input.event] || "تحديث الموارد البشرية — كيان",
        Event: input.event,
        Record: input.title ?? record,
        Party: input.employee_name ?? "",
        Urgent: input.urgent ? "URGENT" : "",
        Message: input.message || "حدث تحديث في بوابة الموظفين. افتح البوابة للتفاصيل.",
        Link: `${publicBase()}/client-portal/employee`,
      }),
      cache: "no-store",
      redirect: "follow",
    });
    if (res.ok || res.status === 302) {
      log("hr_email_success", { event: input.event, record, http_status: res.status, recipient_count: to.length });
      return { sent: true };
    }
    log("hr_email_failed", { event: input.event, record, http_status: res.status });
    return { sent: false, reason: `http_${res.status}` };
  } catch (e) {
    log("hr_email_failed", { event: input.event, record, error: String(e).slice(0, 200) });
    return { sent: false, reason: "network" };
  }
}
