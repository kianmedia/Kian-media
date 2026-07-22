// ════════════════════════════════════════════════════════════════════════════
// lib/portal/executive.ts — Phase 5B: لوحة الإدارة التنفيذية، KPIs، Scorecards،
// توقّع/جاهزية التسليم، عروض المحفظة (مخاطر/اعتمادات/تغييرات/حوكمة/جودة بيانات)،
// الاتجاهات. أغلفة RPC + أنواع. القراءة عبر RPCs معزولة per-project (pc_can_read_project).
// ════════════════════════════════════════════════════════════════════════════
import { prpc } from "./client";

export type ExecStatus = "healthy" | "attention" | "at_risk" | "critical" | "unavailable";
export type Confidence = "high" | "medium" | "low" | "unavailable";

export interface ExecReason { type?: string; key?: string; ar?: string; en?: string; severity?: string; count?: number }
export interface ExecAxis {
  status: ExecStatus; score: number | null; reasons: ExecReason[];
  counts?: Record<string, number>; available?: boolean; finish_forecast?: string | null; last_calculated_at?: string | null;
}
export interface ExecScorecard {
  project_id: string; project_name: string | null; client_id: string | null; overall_status: ExecStatus;
  axes: { execution: ExecAxis; schedule: ExecAxis; resources: ExecAxis; governance: ExecAxis; quality: ExecAxis; delivery_readiness: ExecAxis };
  effective_progress: number | null; core_stage: string | null; is_subproject: boolean;
  data_quality_warnings: ExecReason[]; generated_at: string;
}
export interface ExecSummary {
  total_active: number; total_visible: number; delivered_or_closed: number; overdue: number; near_delivery: number;
  no_manager: number; no_due_date: number; health_distribution: Record<string, number>; subprojects: number;
}
export interface ExecPortfolio {
  summary: ExecSummary; project_scorecards: ExecScorecard[];
  risk_summary: { available: boolean; critical_risks: number; critical_issues: number };
  approval_summary: { available: boolean; pending: number; overdue: number };
  change_request_summary: { available: boolean; open: number; pending_approval: number; implementing: number; schedule_impact_total: number };
  governance_summary: { available: boolean; critical_risk_projects: number; critical_issue_projects: number; overdue_approval_projects: number };
  financial_visible: boolean; pagination: { limit: number; offset: number; total: number };
  warnings: ExecReason[]; generated_at: string;
}
export interface ExecForecast {
  project_id: string; contractual_or_planned_due_date: string | null; current_forecast_date: string | null;
  variance_days: number | null; confidence: Confidence; forecast_reasons: ExecReason[]; blockers: ExecReason[]; open_tasks: number;
}
export interface ExecReadiness {
  project_id: string; ready: boolean; readiness_percent: number | null; checks_passed: number; checks_total: number;
  blockers: ExecReason[]; advisory_warnings: ExecReason[]; required_overrides: ExecReason[];
}
export interface ExecRiskIssueRow {
  kind: "risk" | "issue"; id: string; project_id: string; project_name: string | null; client_id: string | null;
  title: string; severity: string; risk_score: number | null; status: string; owner_id: string | null;
  due_date: string | null; client_visible: boolean; age_days: number;
}
export interface ExecApprovalRow {
  id: string; project_id: string; project_name: string | null; approval_type: string; kind: string; title: string | null;
  status: string; requested_by: string | null; required_user_id: string | null; due_at: string | null; sequence_order: number; overdue: boolean;
}
export interface ExecChangeRow {
  id: string; request_no: string | null; project_id: string; project_name: string | null; change_type: string; priority: string;
  status: string; requested_by: string | null; schedule_impact_days: number | null; financial_impact_reference: string | null; age_days: number;
}
export interface ExecKpiDef {
  key: string; category: string; label_ar: string; label_en: string; description: string | null; formula_description: string | null;
  unit: string; aggregation_method: string; numerator: string | null; denominator: string | null; data_source: string | null;
  limitations: string | null; required_permissions: string[]; is_active: boolean; sort_order: number;
}

export type ExecFilters = Record<string, unknown>;

// ─── قراءة ───
export const executivePortfolioDashboard = (filters: ExecFilters = {}) => prpc<ExecPortfolio>("executive_portfolio_dashboard", { p_filters: filters });
export const executiveProjectScorecard = (projectId: string) => prpc<ExecScorecard>("executive_project_scorecard", { p_project: projectId });
export const executiveDeliveryForecast = (projectId: string) => prpc<ExecForecast>("executive_delivery_forecast", { p_project: projectId });
export const executiveDeliveryReadiness = (projectId: string) => prpc<ExecReadiness>("executive_delivery_readiness", { p_project: projectId });
export const executivePortfolioRisksIssues = (filters: ExecFilters = {}) => prpc<{ available: boolean; rows: ExecRiskIssueRow[]; critical_risks: number; critical_issues: number }>("executive_portfolio_risks_issues", { p_filters: filters });
export const executivePortfolioApprovals = (filters: ExecFilters = {}) => prpc<{ available: boolean; rows: ExecApprovalRow[]; pending: number; overdue: number }>("executive_portfolio_approvals", { p_filters: filters });
export const executivePortfolioChangeControl = (filters: ExecFilters = {}) => prpc<{ available: boolean; rows: ExecChangeRow[]; open: number; pending_approval: number; implementing: number; schedule_impact_total: number }>("executive_portfolio_change_control", { p_filters: filters });
export const executiveGovernanceExceptions = (filters: ExecFilters = {}) => prpc<{ available: boolean; rows: { project_id: string; project_name: string | null; governance_status: ExecStatus; critical_risks: number; critical_issues: number; overdue_approvals: number; pending_changes: number }[]; distribution: Record<string, number> }>("executive_governance_exceptions", { p_filters: filters });
export const executiveDataQualityReport = (filters: ExecFilters = {}) => prpc<{ rows: { project_id: string; project_name: string | null; issues: string[] }[]; count: number }>("executive_data_quality_report", { p_filters: filters });
export const executivePortfolioTrends = (filters: ExecFilters = {}) => prpc<{ period_type: string; series: { snapshot_date: string; kpi_key: string; value: number | null; sample_size: number | null }[]; distinct_periods: number; history_available: boolean; note_ar: string | null }>("executive_portfolio_trends", { p_filters: filters });

// ─── تسميات ───
export const EXEC_STATUS: Record<ExecStatus, { ar: string; color: string }> = {
  healthy: { ar: "سليمة", color: "#16a34a" }, attention: { ar: "تحتاج انتباه", color: "#0891b2" },
  at_risk: { ar: "معرّضة للخطر", color: "#d97706" }, critical: { ar: "حرجة", color: "#dc2626" },
  unavailable: { ar: "غير متاح", color: "#78716c" },
};
export const CONFIDENCE: Record<Confidence, { ar: string; color: string }> = {
  high: { ar: "عالية", color: "#16a34a" }, medium: { ar: "متوسطة", color: "#d97706" },
  low: { ar: "منخفضة", color: "#dc2626" }, unavailable: { ar: "غير متاح", color: "#78716c" },
};
export const AXIS_LABELS: Record<string, { ar: string; en: string }> = {
  execution: { ar: "التنفيذ", en: "Execution" }, schedule: { ar: "الجدول", en: "Schedule" },
  resources: { ar: "الموارد", en: "Resources" }, governance: { ar: "الحوكمة", en: "Governance" },
  quality: { ar: "الجودة", en: "Quality" }, delivery_readiness: { ar: "جاهزية التسليم", en: "Delivery readiness" },
};

export function execErr(e: string): string {
  if (/not authorized/.test(e)) return "لا تملك صلاحية عرض اللوحة التنفيذية.";
  if (/does not exist|schema cache|PGRST/i.test(e)) return "الوحدة التنفيذية (5B) غير مطبّقة في قاعدة البيانات.";
  return "تعذّر تحميل البيانات التنفيذية. حاول مرة أخرى.";
}
