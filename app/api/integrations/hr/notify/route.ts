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
import { selectAsUser, selectAsService, rpcAsUser, authAdminEmails, adminConfigured } from "@/lib/server/supabaseAdmin";
import { canManageHr } from "@/lib/server/hrAuth";
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
  // الأحداث الإدارية: القرار من can_manage_hr() في القاعدة (نفس assertHrAdmin — لا تكرار
  // لمنطق الأدوار). عطل التحقق المؤقت يُرجع 503 (لا 403) فلا يظهر كرفض صلاحية.
  if (!EMPLOYEE_ALLOWED.has(event)) {
    const cm = await canManageHr(bearer);
    if (!cm.ok) {
      log("hr_email_skipped", { reason: "auth_check_failed", event_type: event, entity_id: entityId, status: cm.status });
      return NextResponse.json({ ok: false, error: "auth_check_failed" }, { status: cm.status === 401 ? 401 : 503 });
    }
    if (!cm.can) {
      log("hr_email_skipped", { reason: "caller_not_hr_admin", event_type: event, entity_id: entityId, by: me.data[0].id });
      return NextResponse.json({ ok: false, error: "hr_admin_only" }, { status: 403 });
    }
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

  // ════════ توزيع إشعار الإسناد (موظفون/إدارة/مشرفون) — رسائل مفصولة بلا تكرار ════
  // HOTFIX: يحلّ المستلمين الثلاثة من القاعدة (RPC) لا من حالة الواجهة، ويرسل ثلاث
  // رسائل مفصولة الجمهور مع إزالة تكرار البريد. fallback قبل تشغيل الـ HOTFIX SQL.
  if (isTaskEvent) {
    log("hr_task_assignment_dispatch_started", { event, entity_id: entityId, by: me.data[0].id, service_key_present: adminConfigured() });
    log("hr_task_assignment_event_received", { event, entity_id: entityId, has_employee_ids: Array.isArray(b.employee_user_ids) });
    type Rec = { user_id?: string; email?: string | null; full_name?: string | null };
    let employees: Rec[] = [], admins: Rec[] = [], supervisors: Rec[] = [];
    const rec = await rpcAsUser<{ employees: Rec[]; admins: Rec[]; supervisors: Rec[] }>(
      "hr_task_assignment_recipients", { p_task: entityId }, bearer);
    if (rec.ok && rec.data) {
      employees = rec.data.employees || []; admins = rec.data.admins || []; supervisors = rec.data.supervisors || [];
    } else {
      // fallback: الإدارة عبر استعلام الأدوار + الموظفون عبر employee_user_ids من الواجهة
      // (بلا بريد — يُحلّ لاحقًا من auth.users). قبل تشغيل الـ HOTFIX SQL.
      log("hr_task_recipients_fallback", { reason: rec.error, event, entity_id: entityId });
      if (adminConfigured()) {
        const staff = await selectAsService<Rec[]>(
          `profiles?select=id,email,full_name&account_status=eq.active&or=(account_type.eq.admin,staff_role.in.(super_admin,manager,hr))`);
        if (staff.ok) admins = staff.data.map((x) => ({ user_id: (x as { id?: string }).id, email: x.email, full_name: x.full_name }));
      }
      const ids: string[] = [];
      const one = str(b.employee_user_id); if (one) ids.push(one);
      if (Array.isArray(b.employee_user_ids)) (b.employee_user_ids as unknown[]).forEach((x) => { const s = str(x); if (s) ids.push(s); });
      employees = Array.from(new Set(ids)).map((id) => ({ user_id: id }));
    }
    const valid = (e?: string | null): e is string => !!e && e.includes("@");
    const uniq = (arr: string[]) => Array.from(new Set(arr));
    // بريد الموظف من auth.users أولًا (موظفو الميدان بلا بريد في profiles غالبًا) —
    // نملأ أي بريد ناقص لكل الجماهير عبر Auth Admin API (خادم فقط، لا يُكشف).
    const needAuth = uniq([...employees, ...supervisors, ...admins].filter((r) => r.user_id && !valid(r.email)).map((r) => r.user_id as string));
    const authMap = needAuth.length ? await authAdminEmails(needAuth) : {};
    // توحيد البريد لأحرف صغيرة قبل إزالة التكرار: auth.users يخزّنه صغيرًا بينما
    // profiles قد يكون مختلطًا — فلا يتلقّى شخص واحد رسالتَي جمهورين.
    const emailOf = (r: Rec): string | undefined => {
      const e = valid(r.email) ? r.email : (r.user_id ? authMap[r.user_id] : undefined);
      return valid(e) ? e.toLowerCase() : undefined;
    };
    const empEmails = uniq(employees.map(emailOf).filter(valid));
    const supEmails = uniq(supervisors.map(emailOf).filter(valid)).filter((e) => !empEmails.includes(e));
    const adminEmails = uniq(admins.map(emailOf).filter(valid)).filter((e) => !empEmails.includes(e) && !supEmails.includes(e));
    // مصدر بريد الموظف: من auth.users أم profiles (للإثبات) — دون تسجيل البريد نفسه.
    const empFromRecord = employees.filter((r) => valid(r.email)).length;
    const empFromAuth = employees.filter((r) => !valid(r.email) && r.user_id && !!authMap[r.user_id]).length;
    const employeeEmailSource = empFromAuth > 0 ? (empFromRecord > 0 ? "auth+profile" : "auth") : "profile";
    log("TASK_ASSIGNMENT_EMAIL", {
      event, entity_id: entityId,
      employee_email_source: employeeEmailSource, employee_email_found: empEmails.length > 0,
      employee_count: empEmails.length, admin_count: adminEmails.length, supervisor_count: supEmails.length,
      service_key_present: adminConfigured(), endpoint_present: hrEmailEndpoint().startsWith("https://"),
    });
    log("hr_task_assignment_employee_email_resolved", { event, entity_id: entityId, assigned_user_count: employees.length, employee_email_count: empEmails.length, auth_lookup_count: needAuth.length });
    // إشعارات البوابة تُنشأ في القاعدة: المسندون + الإدارة عبر RPC الإنشاء، والمشرفون
    // عبر hr_notify_task_supervisors (تُستدعى من الواجهة). نسجّل الأعداد المتوقّعة.
    log("hr_task_assignment_portal_created", { event, entity_id: entityId, employee_portal_count: employees.length, admin_portal_count: admins.length, supervisor_portal_count: supervisors.length });
    log("hr_task_assignment_recipients_resolved", {
      event, entity_id: entityId,
      assigned_user_count: employees.length, employee_email_count: empEmails.length,
      admin_email_count: adminEmails.length, supervisor_email_count: supEmails.length,
      deduplicated_email_count: empEmails.length + supEmails.length + adminEmails.length,
      service_key_present: adminConfigured(), endpoint_present: hrEmailEndpoint().startsWith("https://"),
    });

    const details = str(b.message) || str(b.title) || "";
    const link = "\n\n" ; // الرابط يُضاف داخل sendHrEmail
    const sends: { audience: string; res: { sent: boolean; reason?: string } }[] = [];
    if (empEmails.length) {
      log("hr_task_assignment_email_attempt", { event, entity_id: entityId, audience: "employee", recipient_count: empEmails.length });
      const r1 = await sendHrEmail({ event, entity_id: entityId, subject: "تم إسناد مهمة جديدة لك — كيان",
        title: str(b.title) || undefined, message: "تم إسناد مهمة ميدانية جديدة لك:\n" + details + link + "افتح بوابة الموظف لبدء المهمة.", recipients: empEmails });
      sends.push({ audience: "employee", res: r1 });
      log(r1.sent ? "hr_task_assignment_email_success" : "hr_task_assignment_email_failed", { event, entity_id: entityId, audience: "employee", recipient_count: empEmails.length, reason: r1.reason });
    } else {
      log("hr_task_assignment_email_skipped", { event, entity_id: entityId, audience: "employee", reason: "no_employee_email" });
    }
    if (supEmails.length) {
      log("hr_task_assignment_email_attempt", { event, entity_id: entityId, audience: "supervisor", recipient_count: supEmails.length });
      const r2 = await sendHrEmail({ event, entity_id: entityId, subject: "تم إسناد مهمة جديدة لأحد أفراد فريقك — كيان",
        title: str(b.title) || undefined, message: "أُسندت مهمة ميدانية لأحد أفراد فريقك:\n" + details + link + "افتح لوحة مهام الفريق.", recipients: supEmails });
      sends.push({ audience: "supervisor", res: r2 });
      log(r2.sent ? "hr_task_assignment_email_success" : "hr_task_assignment_email_failed", { event, entity_id: entityId, audience: "supervisor", recipient_count: supEmails.length, reason: r2.reason });
    }
    if (adminEmails.length) {
      log("hr_task_assignment_email_attempt", { event, entity_id: entityId, audience: "admin", recipient_count: adminEmails.length });
      const r3 = await sendHrEmail({ event, entity_id: entityId, subject: "تم إنشاء وإسناد مهمة جديدة — كيان",
        title: str(b.title) || undefined, message: "أُنشئت مهمة ميدانية وأُسندت:\n" + details + link + "افتح لوحة الموارد البشرية.", recipients: adminEmails });
      sends.push({ audience: "admin", res: r3 });
      log(r3.sent ? "hr_task_assignment_email_success" : "hr_task_assignment_email_failed", { event, entity_id: entityId, audience: "admin", recipient_count: adminEmails.length, reason: r3.reason });
    }
    log("hr_task_assignment_dispatch_completed", { event, entity_id: entityId, audiences_sent: sends.filter((s) => s.res.sent).map((s) => s.audience), total_recipients: empEmails.length + supEmails.length + adminEmails.length });
    return NextResponse.json({ ok: true, dispatch: { employee: empEmails.length, supervisor: supEmails.length, admin: adminEmails.length } }, { status: 200 });
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
