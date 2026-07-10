// ════════════════════════════════════════════════════════════════════════
// /api/integrations/hr/notify   (SERVER-ONLY)
//
// GET  → safe env diagnostic (no secrets/URLs): proves the deployed build sees
//        the email env + service key + which environment (production/preview).
// POST → fired by the browser AFTER a successful HR RPC (portal rows are
//        written by the RPCs). Relays EMAIL via the existing Apps Script
//        channel to: HR admin set (admin accounts + super_admin + manager + hr)
//        + the target employee when the event concerns them.
//        WhatsApp stays deferred (no n8n call here at all).
// Every step logs: hr_notify_created / hr_email_attempt|skipped|success|failed.
// ════════════════════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { selectAsUser, selectAsService, adminConfigured } from "@/lib/server/supabaseAdmin";
import { sendHrEmail, hrEmailEnabled, hrEmailEndpoint, hrEmailEndpointHost, hrRuntimeEnv } from "@/lib/server/hrNotify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const log = (tag: string, extra: Record<string, unknown>) => console.log(JSON.stringify({ tag, ...extra }));

const EVENTS = new Set([
  "hr_check_in", "hr_check_out", "hr_leave_new", "hr_leave_decided",
  "hr_task_new", "hr_task_started", "hr_task_submitted", "hr_task_closed",
  "hr_attendance_adjusted", "hr_note_new", "hr_task_updated", "hr_settings_updated",
  // v3: حذف/إلغاء إداري + حالة الموظف + الأجهزة
  "hr_leave_deleted", "hr_leave_updated", "hr_attendance_voided", "hr_task_deleted",
  "hr_employee_status_updated", "hr_device_user_mapped",
  "hr_device_event_imported", "hr_device_event_processed",
  // v3.1: تعديل حضور + تقويم + وثائق + مشرف ميداني
  "hr_correction_new", "hr_correction_decided", "hr_calendar_updated",
  "hr_document_added", "hr_supervisor_link_updated", "hr_supervisor_note",
  // v3.1 delivery: طلب تعديل + أدلة تسليم
  "hr_task_revision_requested", "hr_task_evidence_uploaded", "hr_task_evidence_link_added",
  // سجل فقط — لا بريد
  "hr_task_completion_photo_required", "hr_dashboard_filter_applied",
  "hr_monthly_report_generated", "hr_device_event_unmatched",
  "hr_payroll_report_generated", "hr_document_expiring",
  "hr_long_open_session_detected", "hr_audit_log_viewed", "hr_mobile_quick_action_used",
]);
// أحداث تشخيصية: تُسجَّل في اللوجز ولا تُرسل بريدًا ولا إشعارًا.
const LOG_ONLY = new Set([
  "hr_task_completion_photo_required", "hr_dashboard_filter_applied",
  "hr_monthly_report_generated", "hr_device_event_unmatched",
  "hr_payroll_report_generated", "hr_document_expiring",
  "hr_long_open_session_detected", "hr_audit_log_viewed", "hr_mobile_quick_action_used",
  "hr_task_evidence_uploaded", "hr_task_evidence_link_added",
]);
// أحداث تُرسل أيضاً لموظف محدد (قرارات تخصه أو مهام أُسندت له).
const EMPLOYEE_TARGETED = new Set([
  "hr_leave_decided", "hr_task_new", "hr_task_updated", "hr_task_closed", "hr_attendance_adjusted", "hr_note_new",
  "hr_leave_deleted", "hr_leave_updated", "hr_attendance_voided", "hr_task_deleted", "hr_employee_status_updated",
  "hr_correction_decided", "hr_document_added", "hr_supervisor_link_updated", "hr_supervisor_note",
  "hr_task_revision_requested",
]);
// أحداث الحذف/الإلغاء الإداري — سجل موحّد إضافي hr_admin_soft_delete.
const SOFT_DELETE_EVENTS = new Set(["hr_leave_deleted", "hr_attendance_voided", "hr_task_deleted"]);
// سجلات مخصّصة (tag) لكل حدث — تعكس أسماء اللوجز المطلوبة في المواصفات.
const CUSTOM_LOG: Record<string, string> = {
  hr_correction_new: "hr_correction_request_created",
  hr_correction_decided: "hr_correction_request_decided",
  hr_calendar_updated: "hr_calendar_updated",
  hr_document_added: "hr_document_added",
  hr_supervisor_link_updated: "hr_supervisor_link_updated",
  hr_employee_status_updated: "hr_employee_status_updated",
  hr_device_event_imported: "hr_device_event_imported",
  hr_device_event_processed: "hr_device_event_processed",
  hr_task_submitted: "hr_task_submitted_for_review",
  hr_task_closed: "hr_task_approved",
  hr_task_revision_requested: "hr_task_revision_requested",
};
// أحداث يطلقها الموظف بنفسه من بوابته — كل ما عداها إداري ويتطلب صلاحية إدارة HR.
// يمنع موظفًا عاديًا من إرسال إيميلات بصياغة إدارية (تغيير حالة/حذف/إسناد) لأي حساب.
const EMPLOYEE_ALLOWED = new Set([
  "hr_check_in", "hr_check_out", "hr_leave_new", "hr_task_started", "hr_task_submitted",
  "hr_task_completion_photo_required", "hr_correction_new", "hr_mobile_quick_action_used",
  "hr_task_evidence_uploaded", "hr_task_evidence_link_added",
]);

/** GET — تشخيص آمن للبيئة المنشورة. */
export async function GET() {
  return NextResponse.json({
    ok: true,
    runtime_env: hrRuntimeEnv(),
    email_enabled: hrEmailEnabled(),
    has_endpoint: hrEmailEndpoint().startsWith("https://"),
    endpoint_host: hrEmailEndpointHost(),
    service_key_present: adminConfigured(),
  }, { status: 200 });
}

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!bearer) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  let b: Record<string, unknown>;
  try { b = (await req.json()) as Record<string, unknown>; } catch { return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 }); }

  const event = str(b.event);
  const entityId = str(b.entity_id);
  if (!EVENTS.has(event) || !entityId) return NextResponse.json({ ok: false, error: "invalid_event" }, { status: 400 });

  // إثبات هوية المرسل (JWT يتحقق في PostgREST؛ سياسة profiles = صفّه فقط) —
  // ويجب أن يكون موظفًا/أدمن: يمنع أي عميل من إطلاق إيميلات HR مزيفة.
  const me = await selectAsUser<{ id: string; email: string | null; full_name: string | null; staff_role: string | null; account_type: string }[]>(
    `profiles?select=id,email,full_name,staff_role,account_type&limit=1`, bearer);
  if (!me.ok || !me.data[0]) {
    log("hr_email_skipped", { reason: "auth_failed", event_type: event, entity_id: entityId });
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!me.data[0].staff_role && me.data[0].account_type !== "admin") {
    log("hr_email_skipped", { reason: "caller_not_staff", event_type: event, entity_id: entityId });
    return NextResponse.json({ ok: false, error: "staff_only" }, { status: 403 });
  }
  // الأحداث الإدارية: للمالك/super_admin/manager/hr فقط — الموظف العادي يطلق أحداثه الذاتية فقط.
  const callerIsHrAdmin = me.data[0].account_type === "admin"
    || ["super_admin", "manager", "hr"].includes(me.data[0].staff_role ?? "");
  if (!EMPLOYEE_ALLOWED.has(event) && !callerIsHrAdmin) {
    log("hr_email_skipped", { reason: "caller_not_hr_admin", event_type: event, entity_id: entityId, by: me.data[0].id });
    return NextResponse.json({ ok: false, error: "hr_admin_only" }, { status: 403 });
  }

  log("hr_notify_created", {
    event_type: event, entity_id: entityId,
    email_enabled: hrEmailEnabled(), has_endpoint: hrEmailEndpoint().startsWith("https://"),
    service_key_present: adminConfigured(), runtime_env: hrRuntimeEnv(),
  });
  // جلسات الحضور المتعددة (v2): أثر واضح لكل فتح/إغلاق جلسة في سجلات Vercel.
  if (event === "hr_check_in") log("hr_attendance_session_opened", { entity_id: entityId, by: me.data[0].id });
  if (event === "hr_check_out") log("hr_attendance_session_closed", { entity_id: entityId, by: me.data[0].id });
  if (event === "hr_settings_updated") log("hr_settings_updated", { entity_id: entityId, by: me.data[0].id, title: str(b.title) });
  // v3: سجلات تشغيلية موحّدة.
  if (SOFT_DELETE_EVENTS.has(event)) log("hr_admin_soft_delete", { event_type: event, entity_id: entityId, by: me.data[0].id });
  if (CUSTOM_LOG[event]) log(CUSTOM_LOG[event], { entity_id: entityId, by: me.data[0].id, title: str(b.title) });
  if (event === "hr_note_new") log("hr_employee_timeline_event_created", { entity_id: entityId, by: me.data[0].id });
  if (LOG_ONLY.has(event)) {
    log(event, { entity_id: entityId, by: me.data[0].id, title: str(b.title) });
    return NextResponse.json({ ok: true, email: { sent: false, reason: "log_only" }, recipient_count: 0 }, { status: 200 });
  }

  // audience: يحصر مستلمي البريد — "employee" (المسندون فقط) / "admin" (الإدارة فقط) / "both".
  const audience = str(b.audience) || "both";
  const isTaskEvent = event === "hr_task_new" || event === "hr_task_updated";
  if (isTaskEvent) log("hr_task_notify_created", { event, entity_id: entityId, audience, by: me.data[0].id, service_key_present: adminConfigured() });
  if (event === "hr_task_new") {
    log("hr_task_assignment_started", { entity_id: entityId, audience, by: me.data[0].id });
    log("hr_task_portal_notify_created", { entity_id: entityId, audience, by: me.data[0].id });
  }

  // المستلمون: مجموعة إدارة HR + الموظف المستهدف إن وُجد (قراءة فقط بمفتاح الخدمة).
  const recipients: string[] = [];
  let adminCount = 0, employeeCount = 0;
  if (hrEmailEnabled()) {
    if (audience !== "employee") {
      const staff = await selectAsService<{ email: string | null }[]>(
        `profiles?select=email&account_status=eq.active&or=(account_type.eq.admin,staff_role.in.(super_admin,manager,hr))`);
      if (staff.ok) staff.data.forEach((p) => { if (p.email) { recipients.push(p.email); adminCount++; } });
      else log("hr_email_recipients_partial", { reason: "staff_query_failed", detail: staff.error, service_key_present: adminConfigured(), event });
    }

    // موظف مستهدف واحد أو قائمة (مسندو المهام) — استعلام واحد in.(...)
    if (audience !== "admin") {
      const targets: string[] = [];
      const one = str(b.employee_user_id);
      if (one) targets.push(one);
      if (Array.isArray(b.employee_user_ids)) {
        (b.employee_user_ids as unknown[]).forEach((x) => { const s = str(x); if (s) targets.push(s); });
      }
      if (targets.length > 0 && EMPLOYEE_TARGETED.has(event)) {
        const inList = Array.from(new Set(targets)).map((x) => encodeURIComponent(x)).join(",");
        const target = await selectAsService<{ email: string | null }[]>(
          `profiles?select=email&id=in.(${inList})`);
        if (target.ok) target.data.forEach((p) => { if (p.email) { recipients.push(p.email); employeeCount++; } });
        else log("hr_email_recipients_partial", { reason: "target_query_failed", detail: target.error, event });
      }
    }
  }

  // سجل واضح لتشخيص إشعارات المهام: من طُلبوا وكم تم حلّه فعليًا.
  if (isTaskEvent) {
    log("hr_task_assigned", { event, entity_id: entityId, audience, employee_ids: Array.isArray(b.employee_user_ids) ? (b.employee_user_ids as unknown[]).length : (str(b.employee_user_id) ? 1 : 0) });
    log("hr_task_recipients_resolved", { event, entity_id: entityId, audience, admin_count: adminCount, employee_count: employeeCount, total: recipients.length, email_enabled: hrEmailEnabled(), service_key_present: adminConfigured() });
  }

  // بريد موجّه لجمهور محدّد (employee/admin) بلا مستلمين قابلين للحل ⇒ لا نُرسل
  // (وإلا ذهب البريد الموجّه للموظف إلى صندوق الإدارة الاحتياطي بعنوان خاطئ).
  if (recipients.length === 0 && audience !== "both") {
    if (isTaskEvent) log("hr_task_email_skipped", { event, entity_id: entityId, audience, reason: "no_recipients" });
    return NextResponse.json({ ok: true, email: { sent: false, reason: "no_recipients" }, recipient_count: 0 }, { status: 200 });
  }
  if (isTaskEvent) log("hr_task_email_attempt", { event, entity_id: entityId, audience, recipient_count: recipients.length });

  const email = await sendHrEmail({
    event, entity_id: entityId,
    title: str(b.title) || undefined,
    employee_name: str(b.employee_name) || me.data[0].full_name || me.data[0].email || "",
    urgent: b.urgent === true,
    message: str(b.message) || undefined,
    subject: str(b.subject) || undefined,
    recipients,
  });

  if (isTaskEvent) {
    log(email.sent ? "hr_task_email_success" : "hr_task_email_failed",
      { event, entity_id: entityId, audience, recipient_count: recipients.length, reason: email.reason });
  }

  return NextResponse.json({ ok: true, email, recipient_count: recipients.length }, { status: 200 });
}
