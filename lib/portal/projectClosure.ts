// ════════════════════════════════════════════════════════════════════════════
// lib/portal/projectClosure.ts — Phase 5C: إغلاق المشروع، القبول النهائي، الدروس
// المستفادة، مراجعة ما بعد المشروع، إعادة الفتح، الأرشفة المؤسسية. أغلفة RPC + أنواع.
// الكتابة عبر RPCs ذرّية فقط. القراءة معزولة (closure_can/pc_can_read_project).
// ════════════════════════════════════════════════════════════════════════════
import { prpc } from "./client";

export type ClosureStatus =
  | "closure_not_started" | "closure_in_progress" | "closure_blocked" | "awaiting_client_acceptance"
  | "awaiting_internal_approval" | "closure_approved" | "closed" | "reopened" | "archived";

export interface ClosureBlocker {
  code: string; severity?: string; source?: string; entity_id?: string | null;
  overrideable?: boolean; count?: number; ar?: string; en?: string;
}
export interface ClosureReadiness {
  project_id: string; ready: boolean; readiness_percent: number | null;
  required_checks: { code: string; ar: string }[]; passed_checks: { code: string }[];
  blockers: ClosureBlocker[]; advisory_warnings: ClosureBlocker[];
  overrideable_blockers: ClosureBlocker[]; non_overrideable_blockers: ClosureBlocker[];
  data_quality_warnings: ClosureBlocker[];
  financial: { available: boolean; payment_cleared: boolean | null; finance_can_close: boolean | null; reason: string | null };
  open_custody: number; generated_at: string;
}
export interface ClosureRequest {
  id: string; project_id: string; request_no: string | null; status: string;
  requested_by: string | null; requested_at: string; closure_summary: string | null;
  planned_closure_date: string | null; actual_closure_date: string | null;
  approved_by: string | null; approved_at: string | null; rejection_reason: string | null;
  approval_id: string | null; version: number;
}
export interface FinalAcceptance {
  id: string; project_id: string; acceptance_type: string; status: string;
  requested_from: string | null; due_at: string | null; accepted_at: string | null;
  acceptance_comment: string | null; version: number;
}
export interface ClosureDashboard {
  project_id: string; closure_status: ClosureStatus; readiness: ClosureReadiness;
  active_request: ClosureRequest | null; acceptances: FinalAcceptance[];
  lessons_count: number; has_post_review: boolean;
  archive: { id: string; status: string; archived_at: string; retention_until: string | null; legal_hold: boolean } | null;
  reopen_requests: { id: string; status: string; requested_target_stage: string; requested_at: string }[];
  financial_visible: boolean; generated_at: string;
}

export type Dict = Record<string, unknown>;

// ─── قراءة ───
export const projectClosureDashboard = (projectId: string) => prpc<ClosureDashboard>("project_closure_dashboard", { p_project: projectId });
export const projectClosureReadiness = (projectId: string) => prpc<ClosureReadiness>("project_closure_readiness", { p_project: projectId });
export const projectClosureReport = (projectId: string) => prpc<Dict>("project_closure_report", { p_project: projectId });
export const projectLessonsRegister = (projectId: string, filters: Dict = {}) => prpc<{ lessons: Dict[] }>("project_lessons_register", { p_project: projectId, p_filters: filters });
export const projectAcceptanceCertificate = (projectId: string) => prpc<Dict>("project_acceptance_certificate", { p_project: projectId });
export const myClosureInbox = (filters: Dict = {}) => prpc<{ closure_requests: Dict[]; acceptances: Dict[]; reopen_requests: Dict[] }>("my_closure_inbox", { p_filters: filters });
export const portfolioClosureDashboard = (filters: Dict = {}) => prpc<{ distribution: Record<string, number>; in_progress_rows: { project_id: string; project_name: string | null; closure_status: ClosureStatus }[]; total: number }>("portfolio_closure_dashboard", { p_filters: filters });
export const archiveRegister = (filters: Dict = {}) => prpc<{ archives: Dict[] }>("archive_register", { p_filters: filters });

// ─── كتابة (RPCs ذرّية) ───
export const pcClosureSettingsUpsert = (projectId: string, data: Dict) => prpc<Dict>("pc_closure_settings_upsert", { p_project: projectId, p_data: data });
export const projectClosureRequestCreate = (projectId: string, summary: string, plannedDate?: string | null, expectedProjectVersion?: number | null) =>
  prpc<ClosureRequest>("project_closure_request_create", { p_project: projectId, p_closure_summary: summary, p_planned_closure_date: plannedDate ?? null, p_expected_project_version: expectedProjectVersion ?? null });
export const projectClosureSubmit = (requestId: string, expectedVersion?: number | null) => prpc<ClosureRequest>("project_closure_submit", { p_request: requestId, p_expected_version: expectedVersion ?? null });
export const projectClosureReview = (requestId: string, action: string, comment?: string, expectedVersion?: number | null) =>
  prpc<ClosureRequest>("project_closure_review", { p_request: requestId, p_action: action, p_comment: comment ?? null, p_expected_version: expectedVersion ?? null });
export const projectClosureApprove = (requestId: string, comment?: string, expectedVersion?: number | null) => prpc<ClosureRequest>("project_closure_approve", { p_request: requestId, p_comment: comment ?? null, p_expected_version: expectedVersion ?? null });
export const projectClosureReject = (requestId: string, reason: string, expectedVersion?: number | null) => prpc<ClosureRequest>("project_closure_reject", { p_request: requestId, p_reason: reason, p_expected_version: expectedVersion ?? null });
export const projectClosureRequestChanges = (requestId: string, requiredChanges: string, expectedVersion?: number | null) => prpc<ClosureRequest>("project_closure_request_changes", { p_request: requestId, p_required_changes: requiredChanges, p_expected_version: expectedVersion ?? null });
export const projectFinalAcceptanceRequest = (projectId: string, data: Dict) => prpc<FinalAcceptance>("project_final_acceptance_request", { p_project: projectId, p_data: data });
export const projectFinalAcceptanceDecide = (acceptanceId: string, action: string, comment?: string, expectedVersion?: number | null) => prpc<FinalAcceptance>("project_final_acceptance_decide", { p_acceptance: acceptanceId, p_action: action, p_comment: comment ?? null, p_expected_version: expectedVersion ?? null });
export const projectLessonUpsert = (projectId: string, data: Dict) => prpc<Dict>("project_lesson_upsert", { p_project: projectId, p_data: data });
export const projectLessonApproveKnowledge = (lessonId: string, approve = true) => prpc<Dict>("project_lesson_approve_knowledge", { p_lesson: lessonId, p_approve: approve });
export const projectPostReviewUpsert = (projectId: string, data: Dict) => prpc<Dict>("project_post_review_upsert", { p_project: projectId, p_data: data });
export const resourceBookingCancelForProject = (projectId: string, reason: string) => prpc<{ ok: boolean; cancelled: number }>("resource_booking_cancel_for_project", { p_project: projectId, p_reason: reason });
export const projectFinalClose = (requestId: string, finalComment: string, expectedClosureVersion?: number | null, expectedProjectVersion?: number | null, overridePayload: Dict = {}) =>
  prpc<{ ok: boolean; project_id: string; core_stage: string; overridden: boolean }>("project_final_close", { p_request: requestId, p_final_comment: finalComment, p_expected_closure_version: expectedClosureVersion ?? null, p_expected_project_version: expectedProjectVersion ?? null, p_override_payload: overridePayload });
export const projectReopenRequestCreate = (projectId: string, reason: string, targetStage: string) => prpc<Dict>("project_reopen_request_create", { p_project: projectId, p_reason: reason, p_requested_target_stage: targetStage });
export const projectReopenApprove = (reopenId: string, comment?: string, expectedVersion?: number | null) => prpc<{ ok: boolean; core_stage: string }>("project_reopen_approve", { p_reopen: reopenId, p_comment: comment ?? null, p_expected_version: expectedVersion ?? null });
export const projectArchiveCreate = (projectId: string, data: Dict) => prpc<Dict>("project_archive_create", { p_project: projectId, p_data: data });
export const projectArchiveRestore = (archiveId: string, reason: string) => prpc<Dict>("project_archive_restore", { p_archive: archiveId, p_reason: reason });
export const projectArchiveSetLegalHold = (archiveId: string, hold: boolean, reason?: string) => prpc<Dict>("project_archive_set_legal_hold", { p_archive: archiveId, p_hold: hold, p_reason: reason ?? null });

// ─── تسميات ───
export const CLOSURE_STATUS: Record<ClosureStatus, { ar: string; color: string }> = {
  closure_not_started: { ar: "لم يبدأ", color: "#78716c" }, closure_in_progress: { ar: "قيد الإغلاق", color: "#0891b2" },
  closure_blocked: { ar: "محجوب", color: "#dc2626" }, awaiting_client_acceptance: { ar: "بانتظار قبول العميل", color: "#d97706" },
  awaiting_internal_approval: { ar: "بانتظار الاعتماد", color: "#d97706" }, closure_approved: { ar: "معتمد للإغلاق", color: "#16a34a" },
  closed: { ar: "مغلق", color: "#16a34a" }, reopened: { ar: "أُعيد فتحه", color: "#7c3aed" }, archived: { ar: "مؤرشف", color: "#57534e" },
};
export const LESSON_CATEGORIES: string[] = ["planning", "production", "post_production", "client_management", "resources", "equipment", "quality", "scheduling", "communication", "governance", "risk", "supplier", "technical", "other"];
export const REOPEN_STAGES: string[] = ["revision", "post_production", "client_review", "delivered"];

export function closureErr(e: string): string {
  if (/not authorized: financial_override/.test(e)) return "التجاوز المالي يتطلّب صلاحية مالية.";
  if (/not authorized: override/.test(e)) return "تجاوز الحواجز يتطلّب صلاحية Override.";
  if (/not authorized/.test(e)) return "لا تملك صلاحية هذا الإجراء.";
  if (/duplicate_active_request/.test(e)) return "يوجد طلب إغلاق نشط بالفعل.";
  if (/stage_not_delivered/.test(e)) return "يجب أن تكون المرحلة «مُسلَّم» قبل الإغلاق.";
  if (/non_overrideable_blockers/.test(e)) return "توجد حواجز غير قابلة للتجاوز — عالِجها أولًا.";
  if (/override_reason_required|reason_required/.test(e)) return "السبب إلزامي.";
  if (/override_reason_required/.test(e)) return "سبب التجاوز إلزامي.";
  if (/not_approved/.test(e)) return "لا يمكن الإغلاق قبل اعتماد طلب الإغلاق.";
  if (/self_approval_not_allowed/.test(e)) return "لا يمكنك اعتماد طلبك بنفسك.";
  if (/already_decided/.test(e)) return "تم البتّ مسبقًا.";
  if (/stale_update/.test(e)) return "توجد نسخة أحدث — أعد التحميل.";
  if (/not_closed/.test(e)) return "المشروع ليس مغلقًا.";
  if (/legal_hold/.test(e)) return "المشروع تحت حجز قانوني — لا يمكن الاستعادة/الحذف.";
  if (/bad_state|bad_action|bad_target_stage|bad_type/.test(e)) return "إجراء غير صالح في الحالة الحالية.";
  if (/not_found/.test(e)) return "العنصر غير موجود.";
  if (/does not exist|schema cache|PGRST/i.test(e)) return "وحدة الإغلاق (5C) غير مطبّقة في قاعدة البيانات.";
  return "تعذّر تنفيذ الإجراء. حاول مرة أخرى.";
}
