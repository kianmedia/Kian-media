// ════════════════════════════════════════════════════════════════════════════
// lib/portal/operations.ts — Batch 7B: مركز العمليات اليومية.
// أغلفة قراءة فقط تُركّب المصادر القائمة (5B exec_visible / 5A approvals /
// 5C closure / 4B resources / 3A tasks / phase0 notifications). لا نظام موازٍ.
// ════════════════════════════════════════════════════════════════════════════
import { prpc } from "./client";

type Dict = Record<string, unknown>;
/** قيمة قد تكون "unavailable" (المصدر غير مطبّق أو بلا صلاحية) بدل صفر مضلِّل. */
export type MaybeCount = number | "unavailable";

export interface OpsViewer {
  user_id: string | null; is_management: boolean; reads_all: boolean;
  resource_view: boolean; visible_project_count: number;
}
export interface OpsSummary {
  tasks_today: number; tasks_overdue: number; tasks_blocked: number;
  tasks_unassigned: number; reviews_pending: number;
  approvals_mine: number; approvals_overdue: number;
  deliverables_client_review: number;
  shoots_today: number; shoots_next7: number;
  bookings_today: MaybeCount; resource_conflicts: MaybeCount;
  risks_critical: number; issues_critical: number;
  change_requests_pending: number; closures_pending: number;
  projects_attention: number; notifications_unread: MaybeCount;
}
export interface OpsWarning { code: string; ar: string; count: number }
export interface OperationsCenter {
  viewer: OpsViewer; summary: OpsSummary; warnings: OpsWarning[];
  today: string; generated_at: string;
}

export interface OpsTask {
  id: string; title: string; project_id: string; project_name: string | null;
  priority: string; status: string; due_date: string | null; start_date: string | null;
  overdue: boolean; bucket: "blocked" | "overdue" | "today" | "upcoming" | "later"; action_url: string;
}
export interface OpsReview { id: string; title: string; project_id: string; project_name: string | null; kind: string; due_date: string | null; action_url: string }
export interface OpsShoot { id: string; title: string; project_id: string; project_name: string | null; session_date: string | null; status: string; action_url: string }
export interface OpsBooking { id: string; project_id: string | null; project_name: string | null; resource: string | null; starts_at: string; ends_at: string; status: string; action_url: string | null }
export interface OperationsMyWork {
  tasks: OpsTask[]; task_reviews: OpsReview[]; shoot_sessions: OpsShoot[];
  resource_bookings: OpsBooking[]; approvals: Dict[];
  closure: { closure_requests?: Dict[]; acceptances?: Dict[]; reopen_requests?: Dict[] };
  today: string; generated_at: string;
}

export type OpsUrgency = "critical" | "high" | "medium" | "low";
export interface OpsAttentionItem {
  urgency: OpsUrgency; reason_code: string; reason_ar: string;
  entity_type: string; entity_id: string; project_id: string; project_name: string | null;
  due_at: string | null; age_days: number | null; action_url: string;
}
export interface OperationsAttention {
  items: OpsAttentionItem[]; total: number; limit: number; offset: number;
  has_more: boolean; today: string; generated_at: string;
}

export interface OpsEvent {
  entity_type: string; entity_id: string; project_id: string; project_name: string | null;
  title: string | null; at: string; priority: string | null; status: string | null; action_url: string;
}
export interface OperationsSchedule {
  events: OpsEvent[]; total: number; window: string; from: string; to: string;
  limit: number; offset: number; has_more: boolean; generated_at: string;
}

/** فلاتر مشتركة — تُمرَّر كما هي إلى exec_visible_projects (Server-side). */
export interface OpsFilters extends Record<string, unknown> {
  client_id?: string; manager_id?: string; owner_id?: string; sponsor_id?: string;
  core_stage?: string; priority?: string; health?: string; status?: string;
  masters_only?: boolean; subprojects_only?: boolean; overdue_only?: boolean;
  urgency?: string; reason_code?: string; entity_type?: string;
  window?: "today" | "tomorrow" | "7d" | "30d"; limit?: number; offset?: number;
}

export const operationsCommandCenter = (f: OpsFilters = {}) =>
  prpc<OperationsCenter>("operations_command_center", { p_filters: f });
export const operationsMyWork = (f: OpsFilters = {}) =>
  prpc<OperationsMyWork>("operations_my_work", { p_filters: f });
export const operationsAttentionQueue = (f: OpsFilters = {}) =>
  prpc<OperationsAttention>("operations_attention_queue", { p_filters: f });
export const operationsSchedule = (f: OpsFilters = {}) =>
  prpc<OperationsSchedule>("operations_schedule", { p_filters: f });

export const URGENCY_META: Record<OpsUrgency, { ar: string; color: string }> = {
  critical: { ar: "حرج", color: "#dc2626" }, high: { ar: "عالٍ", color: "#d97706" },
  medium: { ar: "متوسّط", color: "#0891b2" }, low: { ar: "منخفض", color: "#78716c" },
};
export const SCHED_TYPE_AR: Record<string, string> = {
  task: "مهمة", shoot_session: "جلسة تصوير", schedule_item: "حدث خطة", resource_booking: "حجز مورد",
};

export function opsErr(e: string): string {
  if (/not authorized/.test(e)) return "لا تملك صلاحية عرض مركز العمليات.";
  if (/does not exist|schema cache|PGRST/i.test(e)) return "مركز العمليات (7B) غير مطبّق في قاعدة البيانات.";
  return "تعذّر تحميل بيانات العمليات. حاول مرة أخرى.";
}
