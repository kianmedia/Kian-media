// ════════════════════════════════════════════════════════════════════════════
// lib/portal/projectResources.ts — Phase 4B Resource capacity, workload & booking
// أغلفة RPC + أنواع لعقود دوال 4B (planning_resources / resource_bookings / conflicts /
// workload / dashboards). كل الكتابة عبر RPCs (SECURITY DEFINER)؛ لا كتابة مباشرة.
// ════════════════════════════════════════════════════════════════════════════
import { prpc } from "./client";

export type ResourceType = "employee" | "contractor" | "equipment" | "studio" | "vehicle" | "location" | "vendor_resource";
export type BookingType = "task" | "shooting" | "studio" | "equipment" | "vehicle" | "employee_shift" | "maintenance" | "blackout" | "other";
export type BookingStatus = "draft" | "hold" | "pending_approval" | "confirmed" | "in_use" | "completed" | "cancelled" | "rejected";
export type ConflictSeverity = "hard_conflict" | "capacity_conflict" | "availability_conflict" | "maintenance_conflict" | "custody_conflict" | "soft_warning";
export type WorkloadClass = "available" | "balanced" | "high" | "overloaded" | "unavailable";

export interface ResourceCard {
  id: string; resource_type: ResourceType; display_name: string; source_type: string | null;
  source_id: string | null; employee_user_id: string | null; capacity_units: number; is_active: boolean;
  employee?: { full_name: string; job_title: string | null; department: string | null; employment_status: string } | null;
  asset?: { asset_code: string; asset_name: string; asset_type: string; availability_status: string; condition_status: string; quantity_total: number; quantity_available: number } | null;
}

export interface BookingConflict {
  conflict_type: string; severity: ConflictSeverity; conflicting_booking_id: string | null; project_id: string | null;
  starts_at: string | null; ends_at: string | null; explanation_ar: string; explanation_en: string; can_override: boolean;
}

export interface ResourceBooking {
  id: string; resource: ResourceCard; project_id: string | null; project_name: string | null;
  task_id: string | null; task_title: string | null; shoot_session_id: string | null; booking_type: BookingType;
  starts_at: string; ends_at: string; timezone: string; quantity: number; status: BookingStatus; priority: string;
  notes: string | null; created_by: string | null; approved_by: string | null; approved_at: string | null;
  conflict_override_by: string | null; conflict_override_reason: string | null; overridden_conflicts: BookingConflict[];
  version: number; created_at: string; updated_at: string; cancelled_at: string | null;
}

export interface WorkloadSnapshot {
  user_id: string; from_date: string; to_date: string; available_hours: number; planned_hours: number;
  logged_hours: number; remaining_hours: number; utilization_percent: number | null; overload_hours: number;
  projects_count: number; active_tasks: number; overdue_tasks: number; conflict_count: number;
  classification: WorkloadClass; daily_breakdown: { date: string; working: boolean; available_hours: number; on_leave: boolean }[];
  warnings: { type: string; ar: string }[]; full_name?: string | null; job_title?: string | null;
}

export interface ResourcesDashboard {
  project_id: string; from_date: string; to_date: string;
  bookings: { id: string; resource: ResourceCard; booking_type: BookingType; starts_at: string; ends_at: string; status: BookingStatus; quantity: number; task_id: string | null; shoot_session_id: string | null; version: number; overridden: boolean }[];
  team: WorkloadSnapshot[];
  conflicts: { booking_id: string; resource: ResourceCard; conflicts: BookingConflict[] | null }[];
  unassigned_tasks: { id: string; title: string; start: string | null; end: string | null }[];
  generated_at: string;
}

export interface ResourceTimeline {
  from_date: string; to_date: string; today: string; generated_at: string;
  resources: {
    resource: ResourceCard;
    bookings: { id: string; project_id: string | null; project_name: string | null; booking_type: BookingType; starts_at: string; ends_at: string; status: BookingStatus; quantity: number; overridden: boolean }[];
    unavailability: { reason_type: string; starts_at: string; ends_at: string }[];
  }[];
}

export interface BookingResult { ok: boolean; booking: ResourceBooking; conflicts: BookingConflict[]; overridden?: boolean }

// ─── القراءة ───
export const projectResourcesDashboard = (projectId: string, from: string, to: string) =>
  prpc<ResourcesDashboard>("project_resources_dashboard", { p_project: projectId, p_from: from, p_to: to });
export const resourceTimelineSnapshot = (from: string, to: string, filters: Record<string, unknown> = {}) =>
  prpc<ResourceTimeline>("resource_timeline_snapshot", { p_from: from, p_to: to, p_filters: filters });
export const employeeWorkloadSnapshot = (userId: string, from: string, to: string) =>
  prpc<WorkloadSnapshot>("employee_workload_snapshot", { p_user: userId, p_from: from, p_to: to });
export const projectTeamWorkload = (projectId: string, from: string, to: string) =>
  prpc<{ project_id: string; members: WorkloadSnapshot[] }>("project_team_workload", { p_project: projectId, p_from: from, p_to: to });
export const resourceBookingDetail = (bookingId: string) =>
  prpc<ResourceBooking>("resource_booking_detail", { p_id: bookingId });
export const resourceConflictCenter = (filters: Record<string, unknown> = {}) =>
  prpc<{ conflicts: { booking: ResourceBooking; conflicts: BookingConflict[] }[]; from_date: string; to_date: string }>("resource_conflict_center", { p_filters: filters });
export const resourceSuggestions = (projectId: string, taskId: string | null, profession: string | null, startsAt: string, endsAt: string, equipmentTypes: string[] | null = null) =>
  prpc<{ project_id: string; suggestions: { resource: ResourceCard; available: boolean; utilization_percent: string | null; profession_match: boolean; conflicts: BookingConflict[]; rank_score: number; reason_ar: string }[] }>(
    "resource_suggestions", { p_project: projectId, p_task: taskId, p_profession: profession, p_starts: startsAt, p_ends: endsAt, p_equipment_types: equipmentTypes });

export const resourceCheckConflicts = (resourceId: string, startsAt: string, endsAt: string, quantity = 1) =>
  prpc<{ conflicts: BookingConflict[] }>("resource_check_conflicts", { p_resource: resourceId, p_starts: startsAt, p_ends: endsAt, p_quantity: quantity });

// ─── Phase 4D: conflict resolutions (explainable) + alerts scan ───
export interface ConflictResolutions {
  booking_id: string; conflicts: BookingConflict[];
  resolutions: {
    alternative_resources: { resource: ResourceCard; available: boolean; kind: string; reason_ar: string; rank: number }[];
    change_time: { kind: string; reason_ar: string };
    override: { kind: string; reason_ar: string; requires: string };
    cancel: { kind: string; reason_ar: string };
  };
  note_ar: string;
}
export const resourceConflictResolutions = (bookingId: string) =>
  prpc<ConflictResolutions>("resource_conflict_resolutions", { p_booking: bookingId });
export const resourceAlertsScan = () => prpc<{ ok: boolean; alerts_emitted: number }>("resource_alerts_scan", {});

// ─── الكتابة (RPCs ذرّية) ───
export const resourceBookingCreate = (payload: Record<string, unknown>) =>
  prpc<BookingResult>("resource_booking_create", { p_payload: payload });
export const resourceBookingUpdate = (bookingId: string, patch: Record<string, unknown>, expectedVersion: number) =>
  prpc<BookingResult>("resource_booking_update", { p_id: bookingId, p_patch: patch, p_expected_version: expectedVersion });
export const resourceBookingCancel = (bookingId: string, reason: string, expectedVersion: number) =>
  prpc<{ ok: boolean; booking: ResourceBooking }>("resource_booking_cancel", { p_id: bookingId, p_reason: reason, p_expected_version: expectedVersion });
export const resourceBookingConfirm = (bookingId: string, expectedVersion: number) =>
  prpc<{ ok: boolean; booking: ResourceBooking }>("resource_booking_confirm", { p_id: bookingId, p_expected_version: expectedVersion });
export const resourceBookingBatchCreate = (payloads: Record<string, unknown>[]) =>
  prpc<{ ok: boolean; count: number; results: BookingResult[] }>("resource_booking_batch_create", { p_payloads: payloads });
export const planningResourcesSync = () => prpc<{ ok: boolean; employees_added: number; equipment_added: number }>("planning_resources_sync", {});

// ─── تسميات عربية ───
export const WORKLOAD_LABELS: Record<WorkloadClass, { ar: string; color: string }> = {
  available: { ar: "متاح", color: "#16a34a" }, balanced: { ar: "متوازن", color: "#0284c7" },
  high: { ar: "مرتفع", color: "#d97706" }, overloaded: { ar: "فوق الطاقة", color: "#dc2626" },
  unavailable: { ar: "غير متاح", color: "#78716c" },
};
export const BOOKING_STATUS_LABELS: Record<BookingStatus, { ar: string; color: string }> = {
  draft: { ar: "مسودة", color: "#78716c" }, hold: { ar: "مبدئي", color: "#0284c7" },
  pending_approval: { ar: "بانتظار الاعتماد", color: "#d97706" }, confirmed: { ar: "مؤكد", color: "#16a34a" },
  in_use: { ar: "قيد الاستخدام", color: "#7c3aed" }, completed: { ar: "منتهٍ", color: "#57534e" },
  cancelled: { ar: "ملغى", color: "#dc2626" }, rejected: { ar: "مرفوض", color: "#b91c1c" },
};
export const BOOKING_TYPE_LABELS: Record<BookingType, string> = {
  task: "مهمة", shooting: "تصوير", studio: "استوديو", equipment: "معدات", vehicle: "مركبة",
  employee_shift: "وردية", maintenance: "صيانة", blackout: "حظر", other: "أخرى",
};

/** رسائل أخطاء موارد 4B → عربية للمستخدم (لا يكشف تفاصيل PostgreSQL). */
export function resErr(e: string): string {
  if (/hard_conflict/.test(e)) return "يوجد تعارض حاد — لا يمكن الحجز دون تجاوز مُصرّح به.";
  if (/override_not_allowed/.test(e)) return "لا تملك صلاحية تجاوز التعارض.";
  if (/override_reason_required/.test(e)) return "سبب التجاوز إلزامي.";
  if (/capacity_conflict/.test(e)) return "الكمية/السعة المطلوبة غير متوفرة في هذا الوقت.";
  if (/bad_dates/.test(e)) return "تحقق من التواريخ — النهاية يجب أن تكون بعد البداية.";
  if (/bad_quantity/.test(e)) return "الكمية يجب أن تكون أكبر من صفر.";
  if (/bad_resource|resource_inactive/.test(e)) return "المورد غير صالح أو غير نشط.";
  if (/bad_link/.test(e)) return "المهمة/الجلسة لا تتبع نفس المشروع.";
  if (/stale_update/.test(e)) return "توجد نسخة أحدث — أعد التحميل ثم حاول.";
  if (/not_found/.test(e)) return "الحجز غير موجود أو محذوف.";
  if (/not authorized/.test(e)) return "لا تملك صلاحية هذا الإجراء.";
  if (/does not exist|schema cache|PGRST/i.test(e)) return "وحدة الموارد غير مطبّقة في قاعدة البيانات.";
  return "تعذّر تنفيذ الإجراء. حاول مرة أخرى.";
}
