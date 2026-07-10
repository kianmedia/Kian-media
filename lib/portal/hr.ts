// ════════════════════════════════════════════════════════════════════════
// Kian Portal — HR & Employee portal (الموارد البشرية وبوابة الموظفين).
// Reads are RLS-scoped (employee sees own rows; can_manage_hr sees all —
// hr_employee_profiles is HR-admin-read-only and the employee reads their own
// profile via the hr_my_profile RPC which strips notes_internal).
// EVERY write goes through a SECURITY DEFINER RPC — no table write grants.
//
// PRIVACY (لا تتبع مستمر): getPositionOnce() is called ONLY from an explicit
// button press (check-in / check-out / task start / task end). No watchPosition,
// no background refresh, no polling — one snapshot per explicit action.
// Mirrors docs/portal_hr_employee_portal_RUNME.sql.
// ════════════════════════════════════════════════════════════════════════
import { pget, prpc, enc, type Result } from "@/lib/portal/client";
import { getValidSession, SUPABASE_URL, SUPABASE_KEY } from "@/lib/portalAuth";

// ─── Types ───
export type EmploymentStatus = "active" | "suspended" | "left";
export type LeaveType = "annual" | "sick" | "emergency" | "unpaid" | "permission" | "late" | "early_exit";
export type LeaveStatus = "pending" | "approved" | "rejected" | "cancelled";
export type TaskStatus = "draft" | "assigned" | "in_progress" | "submitted" | "completed" | "cancelled";
export type TaskType = "photo" | "video" | "drone" | "live_stream" | "editing" | "delivery" | "meeting" | "other";
export type TaskPriority = "low" | "normal" | "high" | "urgent";
export type AttendanceStatus = "present" | "late" | "absent" | "half_day" | "manual_adjusted";

export interface HrMyProfile {
  id: string; full_name: string; email: string | null; phone: string | null;
  job_title: string | null; department: string | null; staff_role_snapshot: string | null;
  employment_status: EmploymentStatus; joined_at: string | null;
  notes_visible_to_employee: string | null;
}
export interface HrEmployee {
  id: string; user_id: string | null; full_name: string; email: string | null; phone: string | null;
  job_title: string | null; department: string | null; staff_role_snapshot: string | null;
  employment_status: EmploymentStatus; joined_at: string | null; left_at: string | null;
  notes_internal: string | null; notes_visible_to_employee: string | null;
  is_deleted: boolean; created_at: string; updated_at: string;
}
export interface HrAttendance {
  id: string; employee_id: string; user_id: string; work_date: string;
  check_in_at: string | null; check_out_at: string | null;
  check_in_lat: number | null; check_in_lng: number | null; check_in_accuracy: number | null;
  check_out_lat: number | null; check_out_lng: number | null; check_out_accuracy: number | null;
  status: AttendanceStatus; admin_adjusted_by: string | null; admin_adjustment_reason: string | null;
  is_voided?: boolean; void_reason?: string | null; source?: "app" | "device" | "admin";
  created_at: string; updated_at: string;
}
export interface HrLeave {
  id: string; employee_id: string; user_id: string; leave_type: LeaveType;
  start_date: string; end_date: string | null; start_time: string | null; end_time: string | null;
  reason: string; attachment_url: string | null; status: LeaveStatus;
  decided_by: string | null; decided_at: string | null; decision_note: string | null;
  is_deleted?: boolean; delete_reason?: string | null;
  created_at: string; updated_at: string;
}
export type EvidenceMode = "photo" | "file" | "link" | "any" | "none";
export interface HrTask {
  id: string; title: string; description: string | null; location_name: string | null;
  maps_url: string | null; city: string | null; client_name: string | null; project_name: string | null;
  task_type: TaskType; priority: TaskPriority;
  equipment_needed: string | null; special_requirements: string | null; execution_notes: string | null;
  completion_evidence_mode: EvidenceMode | null;
  expected_start_at: string | null; expected_end_at: string | null; status: TaskStatus;
  created_by: string | null; approved_by: string | null; approved_at: string | null;
  created_at: string; updated_at: string;
}
export interface HrTaskEvidence {
  id: string; task_id: string; employee_id: string; user_id: string; kind: "file" | "link";
  file_path: string | null; link_url: string | null; file_name: string | null;
  file_mime_type: string | null; file_size_bytes: number | null; is_deleted: boolean; created_at: string;
}
export const EVIDENCE_MODE_LABELS: Record<EvidenceMode, { ar: string; en: string }> = {
  photo: { ar: "صورة إلزامية",       en: "Photo required" },
  file:  { ar: "ملف إلزامي",         en: "File required" },
  link:  { ar: "رابط إلزامي",        en: "Link required" },
  any:   { ar: "أي دليل (صورة/ملف/رابط)", en: "Any evidence" },
  none:  { ar: "بدون دليل",          en: "No evidence" },
};
export interface HrSettings {
  employee_leave_requests_enabled: boolean;
  multiple_attendance_sessions_enabled: boolean;
  task_completion_photo_required: boolean;
  late_grace_minutes: number;
  default_work_start_time: string | null;
  default_work_end_time: string | null;
  show_performance_reviews_enabled: boolean;
  device_attendance_enabled: boolean;
  manual_device_import_enabled: boolean;
  // v3.1: خصومات (عرض فقط — لا خصم مالي فعلي) + تنبيه الجلسات الطويلة
  late_deduction_enabled: boolean;
  absence_deduction_enabled: boolean;
  early_exit_deduction_enabled: boolean;
  deduction_notes: string | null;
  open_session_alert_hours: number;
}
/** القيم الافتراضية الآمنة — تُستخدم قبل تشغيل SQL أو عند فشل القراءة. */
export const DEFAULT_HR_SETTINGS: HrSettings = {
  employee_leave_requests_enabled: false,
  multiple_attendance_sessions_enabled: true,
  task_completion_photo_required: true,
  late_grace_minutes: 15,
  default_work_start_time: null,
  default_work_end_time: null,
  show_performance_reviews_enabled: false,
  device_attendance_enabled: false,
  manual_device_import_enabled: true,
  late_deduction_enabled: false,
  absence_deduction_enabled: false,
  early_exit_deduction_enabled: false,
  deduction_notes: null,
  open_session_alert_hours: 10,
};

// ─── v3.1 types ───
export type CorrectionType = "missed_check_in" | "missed_check_out" | "wrong_time" | "field_task" | "other";
export type CorrectionStatus = "pending" | "approved" | "rejected" | "cancelled";
export interface HrCorrectionRequest {
  id: string; employee_id: string; user_id: string; request_type: CorrectionType;
  correction_date: string; proposed_time: string | null; employee_note: string | null;
  task_id: string | null; attachment_url: string | null; status: CorrectionStatus;
  decided_by: string | null; decided_at: string | null; decision_note: string | null;
  attendance_record_id: string | null; is_deleted: boolean; created_at: string; updated_at: string;
}
export type HolidayType = "public_holiday" | "company_holiday" | "special_workday" | "closed_day";
export interface HrHoliday {
  id: string; title: string; holiday_date: string; type: HolidayType;
  description: string | null; is_deleted: boolean; created_at: string; updated_at: string;
}
export interface HrCalendar { weekend_days: number[]; default_timezone: string; }
export type DocumentType = "national_id" | "iqama" | "contract" | "driving_license" | "iban" | "certificate" | "medical_insurance" | "other";
export type DocumentVisibility = "admin_only" | "employee_visible";
export interface HrDocument {
  id: string; employee_id: string; user_id: string | null; document_type: DocumentType;
  title: string; document_number: string | null; issue_date: string | null; expiry_date: string | null;
  file_url: string | null; visibility: DocumentVisibility; notes: string | null;
  // v3.1 FIX: ملف مرفوع خاص في bucket hr-docs (يُقرأ عبر signed URL فقط)
  file_path: string | null; file_name: string | null; file_mime_type: string | null; file_size_bytes: number | null;
  is_deleted: boolean; created_at: string; updated_at: string;
}
export interface HrExpiringDoc {
  id: string; employee_id: string; full_name: string; document_type: DocumentType;
  title: string; expiry_date: string; visibility: DocumentVisibility; days_left: number;
}
export interface HrSupervisorLink {
  id: string; supervisor_employee_id: string; employee_id: string; is_active: boolean; created_at: string;
}
export interface HrTeamMember {
  employee_id: string; user_id: string | null; full_name: string; job_title: string | null;
  employment_status: EmploymentStatus; checked_in_today: boolean; open_session: boolean;
}
export interface HrTeamTask {
  task_id: string; title: string; status: TaskStatus; task_type: TaskType; priority: TaskPriority;
  city: string | null; client_name: string | null; expected_start_at: string | null;
}
export interface HrAuditRow {
  id: string; employee_id: string; employee_name: string; event_type: string;
  title: string; description: string | null; visible_to_employee: boolean;
  actor_id: string | null; actor_name: string | null; created_at: string;
}
export interface HrLongOpenSession {
  record_id: string; employee_id: string; user_id: string; full_name: string;
  check_in_at: string; hours_open: number;
}
export interface HrPayrollRow {
  employee_id: string; user_id: string | null; full_name: string; employment_status: EmploymentStatus;
  expected_workdays: number; present_days: number; absent_days: number;
  late_count: number; late_minutes: number; early_exit_count: number; early_exit_minutes: number;
  total_hours: number; approved_leave_days: number; approved_corrections: number; tasks_done: number;
}
export interface HrPayrollReport {
  year: number; month: number; workdays_expected: number; generated_at: string;
  deduction_flags: { late: boolean; absence: boolean; early_exit: boolean; notes: string | null };
  rows: HrPayrollRow[];
}
export type DeviceType = "smart_lock" | "biometric" | "nfc_reader" | "qr_station" | "manual_import" | "other";
export type DeviceConnectionMode = "pending" | "manual" | "csv" | "webhook" | "api";
export type DeviceEventType = "unlock" | "check_in" | "check_out" | "unknown";
export type DeviceEventStatus = "pending" | "processed" | "ignored" | "failed";
export interface HrDevice {
  id: string; name: string; device_type: DeviceType; brand: string | null; model: string | null;
  location_name: string | null; connection_mode: DeviceConnectionMode; is_active: boolean;
  notes: string | null; is_deleted: boolean; created_at: string; updated_at: string;
}
export interface HrDeviceUser {
  id: string; device_id: string; employee_id: string; user_id: string | null;
  device_user_identifier: string; card_id: string | null; pin_label: string | null;
  fingerprint_label: string | null; is_active: boolean; created_at: string; updated_at: string;
}
export interface HrDeviceEvent {
  id: string; device_id: string; employee_id: string | null; user_id: string | null;
  device_user_identifier: string | null; event_type: DeviceEventType; event_time: string;
  note: string | null; processed_status: DeviceEventStatus; processed_at: string | null;
  attendance_record_id: string | null; error_message: string | null; created_at: string;
}
export interface HrTaskReview {
  id: string; task_id: string; employee_id: string; user_id: string;
  punctuality_rating: number | null; quality_rating: number | null; communication_rating: number | null;
  admin_review_note: string | null; reviewed_by: string | null; reviewed_at: string;
}
export interface HrMonthlyReportRow {
  employee_id: string; user_id: string | null; full_name: string; employment_status: EmploymentStatus;
  present_days: number; session_count: number; total_hours: number; absent_days: number;
  late_count: number; approved_leaves: number; approved_leave_days: number; tasks_done: number;
}
export interface HrMonthlyReport {
  year: number; month: number; workdays_elapsed: number; generated_at: string; rows: HrMonthlyReportRow[];
}
export interface HrAssignee {
  id: string; task_id: string; employee_id: string; user_id: string; status: TaskStatus | "assigned";
  started_at: string | null; ended_at: string | null;
  start_lat: number | null; start_lng: number | null; start_accuracy: number | null;
  end_lat: number | null; end_lng: number | null; end_accuracy: number | null;
  employee_note: string | null; admin_note: string | null;
  created_at: string; updated_at: string;
}
export interface HrEvent {
  id: string; employee_id: string; user_id: string | null; event_type: string;
  title: string; description: string | null; visible_to_employee: boolean;
  created_by: string | null; created_at: string;
}
export interface HrStaffOption { user_id: string; full_name: string | null; email: string | null; mobile: string | null; staff_role: string | null; }

export const LEAVE_TYPE_LABELS: Record<LeaveType, { ar: string; en: string }> = {
  annual:     { ar: "إجازة سنوية",   en: "Annual" },
  sick:       { ar: "إجازة مرضية",   en: "Sick" },
  emergency:  { ar: "إجازة اضطرارية", en: "Emergency" },
  unpaid:     { ar: "بدون راتب",     en: "Unpaid" },
  permission: { ar: "استئذان",       en: "Permission" },
  late:       { ar: "تأخير",         en: "Late arrival" },
  early_exit: { ar: "خروج مبكر",     en: "Early exit" },
};
export const LEAVE_STATUS_LABELS: Record<LeaveStatus, { ar: string; en: string }> = {
  pending:   { ar: "قيد المراجعة", en: "Pending" },
  approved:  { ar: "معتمدة",       en: "Approved" },
  rejected:  { ar: "مرفوضة",       en: "Rejected" },
  cancelled: { ar: "ملغاة",        en: "Cancelled" },
};
export const TASK_STATUS_LABELS: Record<TaskStatus, { ar: string; en: string }> = {
  draft:       { ar: "مسودة",            en: "Draft" },
  assigned:    { ar: "مُسندة",            en: "Assigned" },
  in_progress: { ar: "قيد التنفيذ",       en: "In progress" },
  submitted:   { ar: "مُسلّمة — للاعتماد", en: "Submitted" },
  completed:   { ar: "مكتملة",           en: "Completed" },
  cancelled:   { ar: "ملغاة",            en: "Cancelled" },
};
export const TASK_TYPE_LABELS: Record<TaskType, { ar: string; en: string }> = {
  photo:       { ar: "تصوير فوتوغرافي", en: "Photo" },
  video:       { ar: "تصوير فيديو",     en: "Video" },
  drone:       { ar: "تصوير درون",      en: "Drone" },
  live_stream: { ar: "بث مباشر",        en: "Live stream" },
  editing:     { ar: "مونتاج",          en: "Editing" },
  delivery:    { ar: "تسليم",           en: "Delivery" },
  meeting:     { ar: "اجتماع",          en: "Meeting" },
  other:       { ar: "أخرى",            en: "Other" },
};
export const TASK_PRIORITY_LABELS: Record<TaskPriority, { ar: string; en: string }> = {
  low:    { ar: "منخفضة", en: "Low" },
  normal: { ar: "عادية",  en: "Normal" },
  high:   { ar: "عالية",  en: "High" },
  urgent: { ar: "عاجلة",  en: "Urgent" },
};
export const CONSENT_TEXT = {
  ar: "يتم استخدام موقعك فقط عند تنفيذ عملية الحضور أو الانصراف أو بداية/نهاية المهمة، ولا يتم تتبعك بشكل مستمر.",
  en: "Your location is used only at check-in, check-out, or task start/end — you are never tracked continuously.",
};

export const mapsLink = (lat: number | null, lng: number | null): string | null =>
  lat != null && lng != null ? `https://maps.google.com/?q=${lat},${lng}` : null;

// ─── Geolocation: ONE snapshot on explicit button press only ───
export interface GeoFix { lat: number; lng: number; accuracy: number; }
export function getPositionOnce(): Promise<Result<GeoFix>> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve({ ok: false, error: "geolocation_unsupported" }); return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ ok: true, data: { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy } }),
      (err) => resolve({ ok: false, error: err.code === 1 ? "permission_denied" : err.code === 3 ? "timeout" : "unavailable" }),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  });
}

// ─── Reads (RLS-scoped) ───
export function hrMyProfile(): Promise<Result<HrMyProfile>> {
  return prpc<HrMyProfile>("hr_my_profile", {});
}
// فلترة الملغى/المحذوف تتم في الكود لا في الاستعلام: عمودا is_voided/is_deleted
// يُنشئهما PATCH v3 — الفلترة client-side تُبقي الواجهة تعمل حتى لو فُتحت قبل تشغيله.
const notVoided = (rows: HrAttendance[]) => rows.filter((r) => r.is_voided !== true);
const notDeletedLeaves = (rows: HrLeave[]) => rows.filter((r) => r.is_deleted !== true);

export async function listMyAttendance(limit = 30): Promise<Result<HrAttendance[]>> {
  const r = await pget<HrAttendance[]>(`hr_attendance_records?select=*&order=work_date.desc,check_in_at.desc&limit=${limit}`);
  return r.ok ? { ok: true, data: notVoided(r.data) } : r;
}
/** جلسات اليوم + أمس (لالتقاط جلسة مفتوحة عبر منتصف الليل) — الأحدث أولاً، بلا الملغاة. */
export async function listMyRecentSessions(userId: string, sinceDate: string): Promise<Result<HrAttendance[]>> {
  const r = await pget<HrAttendance[]>(`hr_attendance_records?user_id=eq.${enc(userId)}&work_date=gte.${enc(sinceDate)}&select=*&order=check_in_at.desc&limit=20`);
  return r.ok ? { ok: true, data: notVoided(r.data) } : r;
}
/** الجلسة المفتوحة (حضور بلا انصراف خلال ٢٠ ساعة) — تعكس حارس SQL نفسه. */
export function findOpenSession(rows: HrAttendance[]): HrAttendance | null {
  const cutoff = Date.now() - 20 * 3600 * 1000;
  return rows.find((r) => r.check_in_at && !r.check_out_at && new Date(r.check_in_at).getTime() > cutoff) ?? null;
}
export async function listMyLeaves(): Promise<Result<HrLeave[]>> {
  const r = await pget<HrLeave[]>(`hr_leave_requests?select=*&order=created_at.desc&limit=50`);
  return r.ok ? { ok: true, data: notDeletedLeaves(r.data) } : r;
}
export function listMyAssignments(userId: string): Promise<Result<HrAssignee[]>> {
  return pget<HrAssignee[]>(`hr_field_task_assignees?user_id=eq.${enc(userId)}&select=*&order=created_at.desc&limit=50`);
}
export function listTasksByIds(ids: string[]): Promise<Result<HrTask[]>> {
  if (ids.length === 0) return Promise.resolve({ ok: true, data: [] });
  return pget<HrTask[]>(`hr_field_tasks?id=in.(${ids.map(enc).join(",")})&is_deleted=eq.false&select=*`);
}
/** HOTFIX: تفاصيل مهام الموظف مضمونة عبر RPC (يتجاوز أي هشاشة في قراءة الجدول مباشرة). */
export function hrGetMyFieldTasks(): Promise<Result<{ assignments: HrAssignee[]; tasks: HrTask[] }>> {
  return prpc<{ assignments: HrAssignee[]; tasks: HrTask[] }>("hr_get_my_field_tasks", {});
}
export interface MyTasksBundle {
  assignments: HrAssignee[]; tasks: HrTask[];
  teammates: Record<string, string[]>; supervisorName: string | null;
  attachments: Record<string, { file_path: string; file_type: string | null }[]>;
  evidence: Record<string, { id: string; kind: "file" | "link"; file_path: string | null; link_url: string | null; file_name: string | null }[]>;
}
/** مسار خادمي بمفتاح الخدمة — يتجاوز أي عائق في طبقة القراءة، مقيّد بهوية الموظف.
 *  الحل الحاسم لعطل التفاصيل (يعمل بنشر الكود وحده دون انتظار SQL). */
export async function fetchMyFieldTasks(): Promise<Result<MyTasksBundle>> {
  try {
    const s = await getValidSession();
    if (!s) return { ok: false, error: "not_authenticated" };
    const res = await fetch("/api/integrations/hr/my-tasks", {
      headers: { Authorization: `Bearer ${s.access_token}` }, cache: "no-store",
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, status: res.status };
    const j = (await res.json()) as { ok: boolean } & MyTasksBundle;
    if (!j.ok) return { ok: false, error: "server_error" };
    return { ok: true, data: j };
  } catch (e) { return { ok: false, error: String(e) }; }
}
/** إشعار بوابة للمشرفين الميدانيين لمسندي المهمة (يُستدعى بعد الإنشاء — فشله لا يمنع شيئًا). */
export function hrNotifyTaskSupervisors(taskId: string): Promise<Result<number>> {
  return prpc<number>("hr_notify_task_supervisors", { p_task: taskId });
}
export function listMyVisibleEvents(userId: string): Promise<Result<HrEvent[]>> {
  return pget<HrEvent[]>(`hr_employee_events?user_id=eq.${enc(userId)}&visible_to_employee=eq.true&select=*&order=created_at.desc&limit=30`);
}
// HR admin reads:
export function hrListEmployees(): Promise<Result<HrEmployee[]>> {
  return pget<HrEmployee[]>(`hr_employee_profiles?is_deleted=eq.false&select=*&order=full_name.asc&limit=300`);
}
export function hrListAttendance(fromDate: string, toDate: string, userId?: string): Promise<Result<HrAttendance[]>> {
  const extra = userId ? `&user_id=eq.${enc(userId)}` : "";
  return pget<HrAttendance[]>(`hr_attendance_records?work_date=gte.${enc(fromDate)}&work_date=lte.${enc(toDate)}${extra}&select=*&order=work_date.desc,check_in_at.desc&limit=500`);
}
export async function hrListLeaves(status?: LeaveStatus): Promise<Result<HrLeave[]>> {
  const f = status ? `&status=eq.${status}` : "";
  const r = await pget<HrLeave[]>(`hr_leave_requests?select=*${f}&order=created_at.desc&limit=200`);
  return r.ok ? { ok: true, data: notDeletedLeaves(r.data) } : r;
}
export function hrListTasks(): Promise<Result<HrTask[]>> {
  return pget<HrTask[]>(`hr_field_tasks?is_deleted=eq.false&select=*&order=created_at.desc&limit=200`);
}
export function hrListAssignees(taskId: string): Promise<Result<HrAssignee[]>> {
  return pget<HrAssignee[]>(`hr_field_task_assignees?task_id=eq.${enc(taskId)}&select=*&order=created_at.asc`);
}
export function hrListEmployeeEvents(employeeId: string): Promise<Result<HrEvent[]>> {
  return pget<HrEvent[]>(`hr_employee_events?employee_id=eq.${enc(employeeId)}&select=*&order=created_at.desc&limit=100`);
}
export function hrAdminListStaff(): Promise<Result<HrStaffOption[]>> {
  return prpc<HrStaffOption[]>("hr_admin_list_staff", {});
}

// ─── Writes (guarded RPCs only) ───
export function hrCheckIn(fix: GeoFix): Promise<Result<{ ok: boolean; record_id: string }>> {
  return prpc<{ ok: boolean; record_id: string }>("hr_check_in", {
    p_lat: fix.lat, p_lng: fix.lng, p_accuracy: fix.accuracy,
    p_user_agent: typeof navigator !== "undefined" ? navigator.userAgent : "",
  });
}
export function hrCheckOut(fix: GeoFix): Promise<Result<{ ok: boolean; record_id: string }>> {
  return prpc<{ ok: boolean; record_id: string }>("hr_check_out", {
    p_lat: fix.lat, p_lng: fix.lng, p_accuracy: fix.accuracy,
    p_user_agent: typeof navigator !== "undefined" ? navigator.userAgent : "",
  });
}
export function hrSubmitLeave(input: {
  type: LeaveType; start: string; end?: string | null; startTime?: string | null; endTime?: string | null;
  reason: string; attachment?: string | null;
}): Promise<Result<{ ok: boolean; id: string }>> {
  return prpc<{ ok: boolean; id: string }>("hr_submit_leave_request", {
    p_type: input.type, p_start: input.start, p_end: input.end ?? null,
    p_start_time: input.startTime ?? null, p_end_time: input.endTime ?? null,
    p_reason: input.reason, p_attachment: input.attachment ?? null,
  });
}
export function hrCancelMyLeave(id: string): Promise<Result<boolean>> {
  return prpc<boolean>("hr_cancel_my_leave_request", { p_id: id });
}
export function hrStartTask(taskId: string, fix: GeoFix): Promise<Result<boolean>> {
  return prpc<boolean>("hr_start_my_task", { p_task: taskId, p_lat: fix.lat, p_lng: fix.lng, p_accuracy: fix.accuracy });
}
export function hrCompleteTask(taskId: string, fix: GeoFix, note: string, photos: string[]): Promise<Result<boolean>> {
  return prpc<boolean>("hr_complete_my_task", {
    p_task: taskId, p_lat: fix.lat, p_lng: fix.lng, p_accuracy: fix.accuracy,
    p_note: note || null, p_photos: photos,
  });
}
export function hrAdminUpsertEmployee(input: {
  id?: string | null; userId?: string | null; fullName: string; email?: string; phone?: string;
  jobTitle?: string; department?: string; status?: EmploymentStatus; joined?: string | null;
  notesInternal?: string; notesVisible?: string;
}): Promise<Result<{ ok: boolean; id: string }>> {
  return prpc<{ ok: boolean; id: string }>("hr_admin_upsert_employee", {
    p_id: input.id ?? null, p_user: input.userId ?? null, p_full_name: input.fullName,
    p_email: input.email ?? null, p_phone: input.phone ?? null,
    p_job_title: input.jobTitle ?? null, p_department: input.department ?? null,
    p_status: input.status ?? null, p_joined: input.joined ?? null,
    p_notes_internal: input.notesInternal ?? null, p_notes_visible: input.notesVisible ?? null,
  });
}
export function hrAdminAdjustAttendance(recordId: string, input: {
  checkIn?: string | null; checkOut?: string | null; status?: AttendanceStatus | null; reason: string;
}): Promise<Result<boolean>> {
  return prpc<boolean>("hr_admin_adjust_attendance", {
    p_record: recordId, p_check_in: input.checkIn ?? null, p_check_out: input.checkOut ?? null,
    p_status: input.status ?? null, p_reason: input.reason,
  });
}
export function hrAdminDecideLeave(id: string, approve: boolean, note?: string): Promise<Result<boolean>> {
  return prpc<boolean>("hr_admin_decide_leave", { p_id: id, p_approve: approve, p_note: note ?? null });
}
export interface HrTaskInput {
  title: string; description?: string; location?: string; mapsUrl?: string; city?: string;
  clientName?: string; projectName?: string; taskType?: TaskType; priority?: TaskPriority;
  equipment?: string; requirements?: string; execNotes?: string; evidenceMode?: EvidenceMode;
  expectedStart?: string | null; expectedEnd?: string | null;
}
// وضع دليل التسليم لكل مهمة (يُستدعى بعد الإنشاء/التعديل — آمن للنشر: فشله لا يمنع الحفظ).
// "" = حسب الإعداد العام (يُخزّن null فلا يتغيّر سلوك المهام القديمة/الافتراضي).
export function hrAdminSetTaskEvidenceMode(taskId: string, mode: EvidenceMode | ""): Promise<Result<boolean>> {
  return prpc<boolean>("hr_admin_set_task_evidence_mode", { p_task: taskId, p_mode: mode || null });
}
export function hrAdminRequestRevision(taskId: string, note: string): Promise<Result<boolean>> {
  return prpc<boolean>("hr_admin_request_task_revision", { p_task: taskId, p_note: note });
}
// أدلة التسليم (ملف/رابط) — الصور تبقى عبر مسار الإنهاء (hrCompleteTask).
export function hrAddTaskFileEvidence(taskId: string, filePath: string, name: string, mime: string, size: number): Promise<Result<{ ok: boolean; id: string }>> {
  return prpc<{ ok: boolean; id: string }>("hr_add_task_evidence", {
    p_task: taskId, p_kind: "file", p_file_path: filePath, p_link_url: null,
    p_file_name: name, p_mime: mime, p_size: size,
  });
}
export function hrAddTaskLinkEvidence(taskId: string, url: string): Promise<Result<{ ok: boolean; id: string }>> {
  return prpc<{ ok: boolean; id: string }>("hr_add_task_evidence", {
    p_task: taskId, p_kind: "link", p_file_path: null, p_link_url: url,
    p_file_name: null, p_mime: null, p_size: null,
  });
}
export function hrRemoveMyTaskEvidence(id: string): Promise<Result<boolean>> {
  return prpc<boolean>("hr_remove_my_task_evidence", { p_id: id });
}
/** أدلة الموظف نفسه فقط — فلتر user_id ليطابق عدّ الخادم (auth.uid()) حتى لو كان المستخدم أدمن-مسندًا. */
export function listMyTaskEvidence(taskId: string, userId: string): Promise<Result<HrTaskEvidence[]>> {
  return pget<HrTaskEvidence[]>(`hr_task_evidence?task_id=eq.${enc(taskId)}&user_id=eq.${enc(userId)}&is_deleted=eq.false&select=*&order=created_at.asc&limit=50`);
}
export function hrListTaskEvidence(taskId: string): Promise<Result<HrTaskEvidence[]>> {
  return pget<HrTaskEvidence[]>(`hr_task_evidence?task_id=eq.${enc(taskId)}&is_deleted=eq.false&select=*&order=created_at.asc&limit=100`);
}
export function hrAdminCreateTask(input: HrTaskInput & { assignees: string[] }): Promise<Result<{ ok: boolean; id: string; assignees: number }>> {
  return prpc<{ ok: boolean; id: string; assignees: number }>("hr_admin_create_field_task", {
    p_title: input.title, p_description: input.description ?? null, p_location: input.location ?? null,
    p_maps_url: input.mapsUrl ?? null, p_city: input.city ?? null,
    p_client_name: input.clientName ?? null, p_project_name: input.projectName ?? null,
    p_task_type: input.taskType ?? "other", p_priority: input.priority ?? "normal",
    p_equipment: input.equipment ?? null, p_requirements: input.requirements ?? null,
    p_exec_notes: input.execNotes ?? null,
    p_expected_start: input.expectedStart ?? null, p_expected_end: input.expectedEnd ?? null,
    p_assignees: input.assignees,
  });
}
/** الحقول المرسلة قيم نهائية: undefined/فارغ ⇒ مسح الحقل في القاعدة (النموذج يرسل كل الحقول). */
export function hrAdminUpdateTask(taskId: string, input: HrTaskInput): Promise<Result<boolean>> {
  return prpc<boolean>("hr_admin_update_field_task", {
    p_task: taskId,
    p_title: input.title, p_description: input.description ?? null, p_location: input.location ?? null,
    p_maps_url: input.mapsUrl ?? null, p_city: input.city ?? null,
    p_client_name: input.clientName ?? null, p_project_name: input.projectName ?? null,
    p_task_type: input.taskType ?? null, p_priority: input.priority ?? null,
    p_equipment: input.equipment ?? null, p_requirements: input.requirements ?? null,
    p_exec_notes: input.execNotes ?? null,
    p_expected_start: input.expectedStart ?? null, p_expected_end: input.expectedEnd ?? null,
  });
}
export function hrGetSettings(): Promise<Result<HrSettings>> {
  return prpc<HrSettings>("hr_get_settings", {});
}
/** تحديث جزئي: يُرسل المفاتيح المتغيرة فقط — يعيد الإعدادات كاملة بعد الحفظ. */
export function hrAdminUpdateSettings(patch: Partial<HrSettings>): Promise<Result<HrSettings>> {
  return prpc<HrSettings>("hr_admin_update_settings", { p_patch: patch });
}
// ─── تحكم إداري v3: حذف/إلغاء آمن + حالة الموظف ───
export function hrAdminSoftDeleteLeave(id: string, reason: string): Promise<Result<boolean>> {
  return prpc<boolean>("hr_admin_soft_delete_leave_request", { p_id: id, p_reason: reason });
}
export function hrAdminUpdateLeave(id: string, input: {
  type: LeaveType; start: string; end?: string | null; startTime?: string | null; endTime?: string | null; note?: string;
}): Promise<Result<boolean>> {
  return prpc<boolean>("hr_admin_update_leave_request", {
    p_id: id, p_type: input.type, p_start: input.start, p_end: input.end ?? null,
    p_start_time: input.startTime ?? null, p_end_time: input.endTime ?? null, p_note: input.note ?? null,
  });
}
export function hrAdminVoidAttendance(recordId: string, reason: string): Promise<Result<boolean>> {
  return prpc<boolean>("hr_admin_void_attendance_record", { p_record: recordId, p_reason: reason });
}
export function hrAdminSoftDeleteTask(taskId: string, reason: string): Promise<Result<boolean>> {
  return prpc<boolean>("hr_admin_soft_delete_field_task", { p_task: taskId, p_reason: reason });
}
export function hrAdminUpdateEmployeeStatus(id: string, status: EmploymentStatus, reason: string): Promise<Result<boolean>> {
  return prpc<boolean>("hr_admin_update_employee_status", { p_id: id, p_status: status, p_reason: reason });
}
export function hrOwnerSoftDeleteEmployee(id: string, reason: string): Promise<Result<boolean>> {
  return prpc<boolean>("hr_owner_soft_delete_employee", { p_id: id, p_reason: reason });
}
// ─── تقييم الأداء (داخلي — يظهر للموظف فقط عند تفعيل الميزة) ───
export function hrAdminReviewTask(taskId: string, employeeId: string, input: {
  punctuality?: number | null; quality?: number | null; communication?: number | null; note?: string;
}): Promise<Result<boolean>> {
  return prpc<boolean>("hr_admin_review_task_assignee", {
    p_task: taskId, p_employee: employeeId,
    p_punctuality: input.punctuality ?? null, p_quality: input.quality ?? null,
    p_communication: input.communication ?? null, p_note: input.note ?? null,
  });
}
export function hrListTaskReviews(taskId: string): Promise<Result<HrTaskReview[]>> {
  return pget<HrTaskReview[]>(`hr_task_reviews?task_id=eq.${enc(taskId)}&select=*`);
}
// ─── التقرير الشهري ───
export function hrAdminMonthlyReport(year: number, month: number, userId?: string): Promise<Result<HrMonthlyReport>> {
  return prpc<HrMonthlyReport>("hr_admin_monthly_report", { p_year: year, p_month: month, p_user: userId ?? null });
}
// ─── أجهزة الحضور (قراءة عبر RLS للأدمن؛ كتابة عبر RPC فقط) ───
export function hrListDevices(): Promise<Result<HrDevice[]>> {
  return pget<HrDevice[]>(`hr_attendance_devices?is_deleted=eq.false&select=*&order=created_at.asc&limit=100`);
}
export function hrListDeviceUsers(filter?: { deviceId?: string; employeeId?: string }): Promise<Result<HrDeviceUser[]>> {
  const f = filter?.deviceId ? `&device_id=eq.${enc(filter.deviceId)}`
    : filter?.employeeId ? `&employee_id=eq.${enc(filter.employeeId)}` : "";
  return pget<HrDeviceUser[]>(`hr_attendance_device_users?select=*${f}&order=created_at.desc&limit=300`);
}
export function hrListDeviceEvents(status?: DeviceEventStatus): Promise<Result<HrDeviceEvent[]>> {
  const f = status ? `&processed_status=eq.${status}` : "";
  return pget<HrDeviceEvent[]>(`hr_attendance_device_events?select=*${f}&order=event_time.desc&limit=200`);
}
export function hrAdminUpsertDevice(input: {
  id?: string | null; name: string; type: DeviceType; brand?: string; model?: string;
  location?: string; mode: DeviceConnectionMode; active: boolean; notes?: string;
}): Promise<Result<{ ok: boolean; id: string }>> {
  return prpc<{ ok: boolean; id: string }>("hr_admin_upsert_attendance_device", {
    p_id: input.id ?? null, p_name: input.name, p_type: input.type,
    p_brand: input.brand ?? null, p_model: input.model ?? null,
    p_location: input.location ?? null, p_mode: input.mode,
    p_active: input.active, p_notes: input.notes ?? null,
  });
}
export function hrAdminMapDeviceUser(input: {
  deviceId: string; employeeId: string; identifier: string;
  cardId?: string; pinLabel?: string; fingerprintLabel?: string; active?: boolean;
}): Promise<Result<{ ok: boolean; id: string }>> {
  return prpc<{ ok: boolean; id: string }>("hr_admin_map_device_user_to_employee", {
    p_device: input.deviceId, p_employee: input.employeeId, p_identifier: input.identifier,
    p_card: input.cardId ?? null, p_pin: input.pinLabel ?? null,
    p_fingerprint: input.fingerprintLabel ?? null, p_active: input.active ?? true,
  });
}
export function hrAdminImportDeviceEvent(input: {
  deviceId: string; identifier: string; eventType: DeviceEventType; eventTime: string; note?: string;
}): Promise<Result<{ ok: boolean; id: string; matched: boolean }>> {
  return prpc<{ ok: boolean; id: string; matched: boolean }>("hr_admin_import_device_event", {
    p_device: input.deviceId, p_identifier: input.identifier,
    p_event_type: input.eventType, p_event_time: input.eventTime, p_note: input.note ?? null,
  });
}
export function hrAdminProcessDeviceEvent(eventId: string): Promise<Result<{
  ok: boolean; matched: boolean; status: string; action?: string; reason?: string; attendance_record_id?: string;
}>> {
  return prpc<{ ok: boolean; matched: boolean; status: string; action?: string; reason?: string; attendance_record_id?: string }>(
    "hr_admin_process_device_event", { p_event: eventId });
}
export function hrAdminCloseTask(taskId: string, action: "complete" | "cancel", note?: string): Promise<Result<boolean>> {
  return prpc<boolean>("hr_admin_close_task", { p_task: taskId, p_action: action, p_note: note ?? null });
}
export function hrAdminAddEmployeeEvent(employeeId: string, title: string, description?: string, visible = false): Promise<Result<boolean>> {
  return prpc<boolean>("hr_admin_add_employee_event", {
    p_employee: employeeId, p_title: title, p_description: description ?? null, p_visible: visible,
  });
}

// ════════ v3.1 — طلبات تعديل الحضور ════════
export const CORRECTION_TYPE_LABELS: Record<CorrectionType, { ar: string; en: string }> = {
  missed_check_in:  { ar: "نسيت تسجيل حضور",  en: "Missed check-in" },
  missed_check_out: { ar: "نسيت تسجيل انصراف", en: "Missed check-out" },
  wrong_time:       { ar: "وقت خاطئ",          en: "Wrong time" },
  field_task:       { ar: "كنت في مهمة ميدانية", en: "On a field task" },
  other:            { ar: "سبب آخر",           en: "Other" },
};
export const HOLIDAY_TYPE_LABELS: Record<HolidayType, { ar: string; en: string }> = {
  public_holiday:  { ar: "عطلة رسمية",   en: "Public holiday" },
  company_holiday: { ar: "عطلة الشركة",  en: "Company holiday" },
  special_workday: { ar: "يوم عمل خاص",  en: "Special workday" },
  closed_day:      { ar: "يوم إغلاق",    en: "Closed day" },
};
export const DOCUMENT_TYPE_LABELS: Record<DocumentType, { ar: string; en: string }> = {
  national_id:       { ar: "الهوية الوطنية", en: "National ID" },
  iqama:             { ar: "الإقامة",         en: "Iqama" },
  contract:          { ar: "العقد",           en: "Contract" },
  driving_license:   { ar: "رخصة القيادة",    en: "Driving license" },
  iban:              { ar: "الآيبان",         en: "IBAN" },
  certificate:       { ar: "شهادة",           en: "Certificate" },
  medical_insurance: { ar: "التأمين الطبي",   en: "Medical insurance" },
  other:             { ar: "وثيقة أخرى",      en: "Other" },
};
export function hrSubmitCorrection(input: {
  type: CorrectionType; date: string; proposedTime?: string | null; note: string; taskId?: string | null; attachment?: string | null;
}): Promise<Result<{ ok: boolean; id: string }>> {
  return prpc<{ ok: boolean; id: string }>("hr_submit_attendance_correction_request", {
    p_type: input.type, p_date: input.date, p_proposed_time: input.proposedTime ?? null,
    p_note: input.note, p_task: input.taskId ?? null, p_attachment: input.attachment ?? null,
  });
}
export function hrCancelMyCorrection(id: string): Promise<Result<boolean>> {
  return prpc<boolean>("hr_cancel_my_attendance_correction_request", { p_id: id });
}
export function hrAdminDecideCorrection(id: string, approve: boolean, note?: string): Promise<Result<boolean>> {
  return prpc<boolean>("hr_admin_decide_attendance_correction_request", { p_id: id, p_approve: approve, p_note: note ?? null });
}
async function stripDeletedCorr(r: Result<HrCorrectionRequest[]>): Promise<Result<HrCorrectionRequest[]>> {
  return r.ok ? { ok: true, data: r.data.filter((x) => x.is_deleted !== true) } : r;
}
export async function listMyCorrections(userId: string): Promise<Result<HrCorrectionRequest[]>> {
  return stripDeletedCorr(await pget<HrCorrectionRequest[]>(
    `hr_attendance_correction_requests?user_id=eq.${enc(userId)}&select=*&order=created_at.desc&limit=50`));
}
export async function hrListCorrections(status?: CorrectionStatus): Promise<Result<HrCorrectionRequest[]>> {
  const f = status ? `&status=eq.${status}` : "";
  return stripDeletedCorr(await pget<HrCorrectionRequest[]>(
    `hr_attendance_correction_requests?select=*${f}&order=created_at.desc&limit=300`));
}

// ════════ v3.1 — التقويم ════════
export function hrGetCalendar(): Promise<Result<HrCalendar>> {
  return prpc<HrCalendar>("hr_get_calendar", {});
}
export function hrAdminSetWeekendDays(days: number[]): Promise<Result<HrCalendar>> {
  return prpc<HrCalendar>("hr_admin_set_weekend_days", { p_days: days });
}
export async function hrListHolidays(): Promise<Result<HrHoliday[]>> {
  const r = await pget<HrHoliday[]>(`hr_holidays?is_deleted=eq.false&select=*&order=holiday_date.desc&limit=300`);
  return r.ok ? { ok: true, data: r.data } : r;
}
export function hrAdminUpsertHoliday(input: {
  id?: string | null; title: string; date: string; type: HolidayType; description?: string;
}): Promise<Result<{ ok: boolean; id: string }>> {
  return prpc<{ ok: boolean; id: string }>("hr_admin_upsert_holiday", {
    p_id: input.id ?? null, p_title: input.title, p_date: input.date, p_type: input.type, p_description: input.description ?? null,
  });
}
export function hrAdminDeleteHoliday(id: string, reason: string): Promise<Result<boolean>> {
  return prpc<boolean>("hr_admin_soft_delete_holiday", { p_id: id, p_reason: reason });
}

// ════════ v3.1 — تقرير الرواتب/الخصومات ════════
export function hrAdminPayrollReport(year: number, month: number, userId?: string): Promise<Result<HrPayrollReport>> {
  return prpc<HrPayrollReport>("hr_admin_payroll_report", { p_year: year, p_month: month, p_user: userId ?? null });
}

// ════════ v3.1 — وثائق الموظف ════════
export function hrListEmployeeDocuments(employeeId: string): Promise<Result<HrDocument[]>> {
  return pget<HrDocument[]>(`hr_employee_documents?employee_id=eq.${enc(employeeId)}&is_deleted=eq.false&select=*&order=created_at.desc&limit=100`);
}
export function listMyDocuments(userId: string): Promise<Result<HrDocument[]>> {
  return pget<HrDocument[]>(`hr_employee_documents?user_id=eq.${enc(userId)}&visibility=eq.employee_visible&is_deleted=eq.false&select=*&order=created_at.desc&limit=100`);
}
export function hrAdminUpsertDocument(input: {
  id?: string | null; employeeId: string; type: DocumentType; title: string; number?: string;
  issue?: string | null; expiry?: string | null; fileUrl?: string; visibility: DocumentVisibility; notes?: string;
}): Promise<Result<{ ok: boolean; id: string; created: boolean }>> {
  return prpc<{ ok: boolean; id: string; created: boolean }>("hr_admin_upsert_employee_document", {
    p_id: input.id ?? null, p_employee: input.employeeId, p_type: input.type, p_title: input.title,
    p_number: input.number ?? null, p_issue: input.issue ?? null, p_expiry: input.expiry ?? null,
    p_file_url: input.fileUrl ?? null, p_visibility: input.visibility, p_notes: input.notes ?? null,
  });
}
export function hrAdminDeleteDocument(id: string, reason: string): Promise<Result<boolean>> {
  return prpc<boolean>("hr_admin_soft_delete_employee_document", { p_id: id, p_reason: reason });
}
export function hrAdminAttachDocumentFile(id: string, path: string, name: string, mime: string, size: number): Promise<Result<boolean>> {
  return prpc<boolean>("hr_admin_attach_document_file", {
    p_id: id, p_file_path: path, p_file_name: name, p_mime: mime, p_size: size,
  });
}
export function hrAdminExpiringDocuments(days = 90): Promise<Result<{ as_of: string; window_days: number; rows: HrExpiringDoc[] }>> {
  return prpc<{ as_of: string; window_days: number; rows: HrExpiringDoc[] }>("hr_admin_list_expiring_documents", { p_days: days });
}

// ════════ v3.1 — المشرف الميداني ════════
export function hrListSupervisorLinks(): Promise<Result<HrSupervisorLink[]>> {
  return pget<HrSupervisorLink[]>(`hr_employee_supervisor_links?is_active=eq.true&select=*&limit=500`);
}
export function hrAdminSetSupervisorLink(supervisorEmployeeId: string, employeeId: string, active: boolean): Promise<Result<{ ok: boolean; id: string }>> {
  return prpc<{ ok: boolean; id: string }>("hr_admin_set_supervisor_link", {
    p_supervisor: supervisorEmployeeId, p_employee: employeeId, p_active: active,
  });
}
export function hrSupervisorMyTeam(): Promise<Result<{ rows: HrTeamMember[] }>> {
  return prpc<{ rows: HrTeamMember[] }>("hr_supervisor_my_team", {});
}
export function hrSupervisorTeamTasks(): Promise<Result<{ rows: HrTeamTask[] }>> {
  return prpc<{ rows: HrTeamTask[] }>("hr_supervisor_team_tasks", {});
}
export function hrSupervisorAddNote(employeeId: string, note: string, visible = false): Promise<Result<boolean>> {
  return prpc<boolean>("hr_supervisor_add_note", { p_employee: employeeId, p_note: note, p_visible: visible });
}

// ════════ v3.1 — سجل العمليات + الجلسات الطويلة ════════
export function hrAdminAuditLog(input: {
  userId?: string | null; types?: string[] | null; from?: string | null; to?: string | null; search?: string | null; limit?: number;
}): Promise<Result<{ rows: HrAuditRow[] }>> {
  return prpc<{ rows: HrAuditRow[] }>("hr_admin_list_audit_log", {
    p_user: input.userId ?? null, p_types: input.types ?? null,
    p_from: input.from ?? null, p_to: input.to ?? null, p_search: input.search ?? null, p_limit: input.limit ?? 300,
  });
}
export function hrAdminLongOpenSessions(): Promise<Result<{ threshold_hours: number; rows: HrLongOpenSession[] }>> {
  return prpc<{ threshold_hours: number; rows: HrLongOpenSession[] }>("hr_admin_long_open_sessions", {});
}

// ─── hr-files storage (task photos; owner-first paths; signed URLs) ───
const BUCKET = "hr-files";
export const MAX_HR_FILE_BYTES = 10 * 1024 * 1024;

async function storageFetch(path: string, init: RequestInit): Promise<Response> {
  const s = await getValidSession();
  if (!s) throw new Error("not_authenticated");
  const doFetch = (token: string) =>
    fetch(`${SUPABASE_URL}/storage/v1${path}`, {
      ...init,
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}`, ...(init.headers || {}) },
    });
  let res = await doFetch(s.access_token);
  if (res.status === 401) {
    const s2 = await getValidSession();
    if (s2) res = await doFetch(s2.access_token);
  }
  return res;
}
export function hrFilePath(userId: string, taskId: string, key: string): string {
  return `${userId}/${taskId}/${key}.jpg`;
}
export async function uploadHrFile(path: string, file: File | Blob): Promise<Result<boolean>> {
  try {
    if (file.size > MAX_HR_FILE_BYTES) return { ok: false, error: "file_too_large" };
    const type = (file as File).type || "image/jpeg";
    if (!/^image\/(jpeg|png|webp)$/.test(type)) return { ok: false, error: "invalid_file_type" };
    const res = await storageFetch(`/object/${BUCKET}/${path}`, {
      method: "POST", headers: { "Content-Type": type, "x-upsert": "true" }, body: file,
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { const j = (await res.json()) as { message?: string; error?: string }; msg = j.message || j.error || msg; } catch { /* non-JSON */ }
      return { ok: false, error: msg, status: res.status };
    }
    return { ok: true, data: true };
  } catch (e) { return { ok: false, error: String(e) }; }
}
// رفع ملف دليل تسليم (صورة أو PDF) إلى hr-files (owner-first) — للنوع file.
export const HR_TASK_FILE_MIME = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
export function hrTaskFilePath(userId: string, taskId: string, key: string, filename: string): string {
  const dot = filename.lastIndexOf(".");
  const ext = dot >= 0 ? filename.slice(dot).toLowerCase().replace(/[^.a-z0-9]/g, "") : "";
  return `${userId}/${taskId}/file-${key}${ext}`;
}
export async function uploadHrTaskFile(path: string, file: File | Blob): Promise<Result<boolean>> {
  try {
    if (file.size > MAX_HR_FILE_BYTES) return { ok: false, error: "file_too_large" };
    const type = (file as File).type || "application/octet-stream";
    if (!HR_TASK_FILE_MIME.includes(type)) return { ok: false, error: "invalid_file_type" };
    const res = await storageFetch(`/object/${BUCKET}/${path}`, {
      method: "POST", headers: { "Content-Type": type, "x-upsert": "true" }, body: file,
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { const j = (await res.json()) as { message?: string; error?: string }; msg = j.message || j.error || msg; } catch { /* non-JSON */ }
      return { ok: false, error: msg, status: res.status };
    }
    return { ok: true, data: true };
  } catch (e) { return { ok: false, error: String(e) }; }
}
export async function signHrFiles(paths: (string | null | undefined)[]): Promise<Record<string, string>> {
  const list = Array.from(new Set(paths.filter((p): p is string => !!p)));
  if (list.length === 0) return {};
  try {
    const res = await storageFetch(`/object/sign/${BUCKET}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expiresIn: 3600, paths: list }),
    });
    if (!res.ok) return {};
    const rows = (await res.json()) as { path?: string; signedURL?: string }[];
    const out: Record<string, string> = {};
    for (const r of rows) if (r.path && r.signedURL) out[r.path] = `${SUPABASE_URL}/storage/v1${r.signedURL}`;
    return out;
  } catch { return {}; }
}

// ─── hr-docs storage (وثائق الموظف الخاصة: صور + PDF؛ رفع الإدارة؛ signed URL) ───
const DOCS_BUCKET = "hr-docs";
export const MAX_HR_DOC_BYTES = 10 * 1024 * 1024;
export const HR_DOC_MIME = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
/** مفتاح فريد للمسار (متصفح فقط — لا يُستدعى في سياقات workflow). */
export function hrDocKey(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
export function hrDocPath(employeeId: string, key: string, filename: string): string {
  const dot = filename.lastIndexOf(".");
  const ext = dot >= 0 ? filename.slice(dot).toLowerCase().replace(/[^.a-z0-9]/g, "") : "";
  const base = (dot >= 0 ? filename.slice(0, dot) : filename).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40) || "file";
  return `${employeeId}/${key}/${base}${ext}`;
}
export async function uploadHrDoc(path: string, file: File | Blob): Promise<Result<boolean>> {
  try {
    if (file.size > MAX_HR_DOC_BYTES) return { ok: false, error: "file_too_large" };
    const type = (file as File).type || "application/octet-stream";
    if (!HR_DOC_MIME.includes(type)) return { ok: false, error: "invalid_file_type" };
    const res = await storageFetch(`/object/${DOCS_BUCKET}/${path}`, {
      method: "POST", headers: { "Content-Type": type, "x-upsert": "true" }, body: file,
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { const j = (await res.json()) as { message?: string; error?: string }; msg = j.message || j.error || msg; } catch { /* non-JSON */ }
      return { ok: false, error: msg, status: res.status };
    }
    return { ok: true, data: true };
  } catch (e) { return { ok: false, error: String(e) }; }
}
export async function signHrDoc(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  try {
    const res = await storageFetch(`/object/sign/${DOCS_BUCKET}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expiresIn: 3600, paths: [path] }),
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as { path?: string; signedURL?: string }[];
    const u = rows.find((r) => r.signedURL)?.signedURL;
    return u ? `${SUPABASE_URL}/storage/v1${u}` : null;
  } catch { return null; }
}

// ─── Email relay (fire-and-forget; portal rows already written by the RPCs) ───
// audience: يحصر مستلمي البريد — "employee" (المسندون فقط) / "admin" (الإدارة فقط)
// / "both" (الافتراضي). message/subject: محتوى بريد مخصّص (مثل تفاصيل المهمة).
export function emitHrEvent(event: {
  event: string; entity_id: string; title?: string; employee_name?: string;
  employee_user_id?: string; employee_user_ids?: string[]; urgent?: boolean;
  message?: string; subject?: string; audience?: "employee" | "admin" | "both";
}): void {
  void (async () => {
    try {
      const s = await getValidSession();
      if (!s) return;
      await fetch("/api/integrations/hr/notify", {
        method: "POST",
        keepalive: true,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.access_token}` },
        body: JSON.stringify(event),
      });
    } catch { /* relay failure never blocks the action — server logs carry the reason */ }
  })();
}
