// ════════════════════════════════════════════════════════════════════════════
// lib/portal/projectGovernance.ts — Phase 5A governance, risks, issues, decisions,
// assumptions, change control & approvals. أغلفة RPC + أنواع. الكتابة عبر RPCs فقط.
// ════════════════════════════════════════════════════════════════════════════
import { prpc } from "./client";

export type GovHealthStatus = "healthy" | "attention" | "at_risk" | "critical";
export type RiskSeverity = "low" | "medium" | "high" | "critical";

export interface GovReason { type: string; severity?: string; count?: number; ar: string }
export interface GovHealth {
  project_id: string; health_status: GovHealthStatus; health_score: number; reasons: GovReason[];
  counts: { critical_risks: number; critical_issues: number; overdue_approvals: number; pending_changes: number; stale_decisions: number; expired_assumptions: number };
}
export interface GovRisk {
  id: string; title: string; category: string; probability: number; impact: number; risk_score: number;
  severity: RiskSeverity; status: string; owner_id: string | null; client_visible: boolean;
}
export interface GovIssue { id: string; title: string; severity: RiskSeverity; status: string; due_date: string | null; owner_id: string | null }
export interface GovDecision { id: string; title: string; status: string; review_date: string | null }
export interface GovAssumption { id: string; statement: string; status: string; validation_date: string | null }
export interface GovChangeRequest { id: string; request_no: string | null; title: string; change_type: string; status: string; priority: string; schedule_impact_days: number | null }
export interface GovApproval { id: string; approval_type: string; title: string | null; status: string; due_at: string | null; required_user_id: string | null; overdue: boolean }
export interface GovRole { id: string; user_id: string; project_role: string }

export interface GovernanceDashboard {
  project_id: string; settings: Record<string, unknown>; health: GovHealth;
  stage_gate: { stage_gate_mode: string; gate_blockers: GovReason[]; blocked: boolean; can_override: boolean; note_ar: string; readiness: Record<string, unknown> };
  pending_approvals: GovApproval[]; risks: GovRisk[]; issues: GovIssue[]; decisions: GovDecision[];
  assumptions: GovAssumption[]; change_requests: GovChangeRequest[]; roles: GovRole[];
  risk_matrix: Record<string, number>; generated_at: string;
}

// ─── قراءة ───
export const projectGovernanceDashboard = (projectId: string) => prpc<GovernanceDashboard>("project_governance_dashboard", { p_project: projectId });
export const projectGovernanceHealth = (projectId: string) => prpc<GovHealth>("project_governance_health", { p_project: projectId });
export const projectStageGateCheck = (projectId: string, target?: string | null) => prpc<GovernanceDashboard["stage_gate"] & { blocked: boolean }>("project_stage_gate_check", { p_project: projectId, p_target: target ?? null });
export const projectChangeImpactPreview = (changeId: string) =>
  prpc<{ change_request_id: string; affected_tasks: { task_id: string; title: string }[]; schedule_delta_days: number | null; project_finish_before: string | null; project_finish_after: string | null; booking_conflicts: number; open_risks: number; warnings: GovReason[]; calculation_method: string }>("project_change_impact_preview", { p_change: changeId });
export const myApprovalInbox = (filters: Record<string, unknown> = {}) =>
  prpc<{ approvals: (GovApproval & { project_id: string; project_name: string | null; kind: string; requested_by: string | null; mine: boolean })[] }>("my_approval_inbox", { p_filters: filters });

// ─── كتابة (RPCs ذرّية) ───
export const pcProjectRoleAdd = (projectId: string, userId: string, role: string) => prpc<{ ok: boolean; id: string }>("pc_project_role_add", { p_project: projectId, p_user: userId, p_role: role });
export const pcProjectRoleRemove = (id: string) => prpc<{ ok: boolean }>("pc_project_role_remove", { p_id: id });
export const pcGovernanceSettingsUpsert = (projectId: string, data: Record<string, unknown>) => prpc<Record<string, unknown>>("pc_governance_settings_upsert", { p_project: projectId, p_data: data });
export const pcRiskUpsert = (projectId: string, data: Record<string, unknown>) => prpc<GovRisk>("pc_risk_upsert", { p_project: projectId, p_data: data });
export const pcRiskToIssue = (riskId: string) => prpc<{ ok: boolean; issue_id: string }>("pc_risk_to_issue", { p_risk: riskId });
export const pcIssueUpsert = (projectId: string, data: Record<string, unknown>) => prpc<GovIssue>("pc_issue_upsert", { p_project: projectId, p_data: data });
export const pcDecisionUpsert = (projectId: string, data: Record<string, unknown>) => prpc<GovDecision>("pc_decision_upsert", { p_project: projectId, p_data: data });
export const pcAssumptionUpsert = (projectId: string, data: Record<string, unknown>) => prpc<GovAssumption>("pc_assumption_upsert", { p_project: projectId, p_data: data });
export const pcChangeRequestUpsert = (projectId: string, data: Record<string, unknown>) => prpc<GovChangeRequest>("pc_change_request_upsert", { p_project: projectId, p_data: data });
export const projectChangeRequestApply = (changeId: string, expectedVersion: number | null) => prpc<{ ok: boolean; status: string; note_ar: string }>("project_change_request_apply", { p_change: changeId, p_expected_version: expectedVersion, p_options: {} });
export const pcGovernanceApprovalRequest = (projectId: string, data: Record<string, unknown>) => prpc<GovApproval>("pc_governance_approval_request", { p_project: projectId, p_data: data });
export const pcApprovalDecide = (approvalId: string, decision: string, note?: string) => prpc<GovApproval>("pc_approval_decide", { p_approval: approvalId, p_decision: decision, p_note: note ?? null });
export const pcApprovalCancel = (approvalId: string, reason: string) => prpc<{ ok: boolean }>("pc_approval_cancel", { p_approval: approvalId, p_reason: reason, p_expected_version: null });
export const pcApprovalReassign = (approvalId: string, newUser: string, reason: string) => prpc<{ ok: boolean }>("pc_approval_reassign", { p_approval: approvalId, p_new_user: newUser, p_reason: reason, p_expected_version: null });

// ─── تسميات ───
export const GOV_HEALTH: Record<GovHealthStatus, { ar: string; color: string }> = {
  healthy: { ar: "سليمة", color: "#16a34a" }, attention: { ar: "تحتاج انتباه", color: "#0891b2" },
  at_risk: { ar: "معرّضة للخطر", color: "#d97706" }, critical: { ar: "حرجة", color: "#dc2626" },
};
export const RISK_SEV: Record<RiskSeverity, { ar: string; color: string }> = {
  low: { ar: "منخفضة", color: "#16a34a" }, medium: { ar: "متوسطة", color: "#0284c7" },
  high: { ar: "عالية", color: "#d97706" }, critical: { ar: "حرجة", color: "#dc2626" },
};
export const PROJECT_ROLES: { k: string; ar: string }[] = [
  { k: "project_owner", ar: "مالك المشروع" }, { k: "project_manager", ar: "مدير المشروع" },
  { k: "project_coordinator", ar: "منسّق" }, { k: "team_member", ar: "عضو فريق" }, { k: "reviewer", ar: "مراجِع" },
  { k: "client_representative", ar: "ممثّل العميل" }, { k: "sponsor", ar: "راعٍ" }, { k: "approver", ar: "معتمِد" }, { k: "observer", ar: "مراقب" },
];

export function govErr(e: string): string {
  if (/self_approval_not_allowed/.test(e)) return "لا يمكنك اعتماد طلبك بنفسك.";
  if (/not_your_approval/.test(e)) return "هذا الاعتماد مُسنَد لمستخدم آخر.";
  if (/already_decided/.test(e)) return "تم البتّ في هذا الاعتماد مسبقًا.";
  if (/duplicate_pending/.test(e)) return "يوجد طلب اعتماد معلّق لنفس العنصر.";
  if (/approved_immutable/.test(e)) return "القرار المعتمد لا يُعدّل — أنشئ قرارًا يُبطِله.";
  if (/not_approved/.test(e)) return "لا يمكن التطبيق قبل اعتماد طلب التغيير.";
  if (/bad_scale/.test(e)) return "الاحتمالية والأثر بين 1 و5.";
  if (/stale_update/.test(e)) return "توجد نسخة أحدث — أعد التحميل.";
  if (/not authorized/.test(e)) return "لا تملك صلاحية هذا الإجراء.";
  if (/not_found/.test(e)) return "العنصر غير موجود.";
  if (/does not exist|schema cache|PGRST/i.test(e)) return "وحدة الحوكمة غير مطبّقة في قاعدة البيانات.";
  return "تعذّر تنفيذ الإجراء. حاول مرة أخرى.";
}
