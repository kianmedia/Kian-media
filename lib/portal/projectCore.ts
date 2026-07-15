// ════════════════════════════════════════════════════════════════════════════
// Project Core — طبقة العميل (typed) لمنصة إدارة وتشغيل المشاريع.
// كل الكتابات عبر SECURITY DEFINER RPCs؛ القراءات عبر PostgREST (RLS-scoped).
// يعتمد على docs/project_core_FINAL_RUNME.sql. لا supabase-js.
// ════════════════════════════════════════════════════════════════════════════
import { pget, prpc, enc, type Result } from "@/lib/portal/client";

// ─── الثوابت/الأنواع ───
export const PC_STAGES = [
  "lead_approved", "project_created", "planning", "ready", "scheduled", "in_production",
  "post_production", "internal_review", "client_review", "revision", "approved", "delivered", "closed",
] as const;
export type PcStage = (typeof PC_STAGES)[number];

export const PC_STAGE_LABELS: Record<PcStage, { ar: string; en: string }> = {
  lead_approved:   { ar: "اعتماد العميل المحتمل", en: "Lead Approved" },
  project_created: { ar: "إنشاء المشروع",          en: "Project Created" },
  planning:        { ar: "التخطيط",                en: "Planning" },
  ready:           { ar: "جاهز",                   en: "Ready" },
  scheduled:       { ar: "مجدول",                  en: "Scheduled" },
  in_production:   { ar: "قيد الإنتاج",            en: "In Production" },
  post_production: { ar: "ما بعد الإنتاج",         en: "Post Production" },
  internal_review: { ar: "مراجعة داخلية",          en: "Internal Review" },
  client_review:   { ar: "مراجعة العميل",          en: "Client Review" },
  revision:        { ar: "تعديل",                  en: "Revision" },
  approved:        { ar: "معتمد",                  en: "Approved" },
  delivered:       { ar: "تم التسليم",             en: "Delivered" },
  closed:          { ar: "مغلق",                   en: "Closed" },
};

export type PcPriority = "low" | "normal" | "high" | "urgent";
export type PcHealth = "on_track" | "at_risk" | "off_track";
export type PcTaskStatus = "todo" | "in_progress" | "blocked" | "in_review" | "done" | "cancelled";
export type PcApprovalKind = "internal" | "manager" | "client";
export type PcApprovalStatus = "pending" | "approved" | "rejected" | "revision_requested";

export const PRIORITY_LABELS: Record<PcPriority, { ar: string; en: string }> = {
  low: { ar: "منخفضة", en: "Low" }, normal: { ar: "عادية", en: "Normal" },
  high: { ar: "عالية", en: "High" }, urgent: { ar: "عاجلة", en: "Urgent" },
};
export const HEALTH_LABELS: Record<PcHealth, { ar: string; en: string }> = {
  on_track: { ar: "على المسار", en: "On Track" }, at_risk: { ar: "معرّض للخطر", en: "At Risk" },
  off_track: { ar: "خارج المسار", en: "Off Track" },
};
export const TASK_STATUS_LABELS: Record<PcTaskStatus, { ar: string; en: string }> = {
  todo: { ar: "قائمة", en: "To Do" }, in_progress: { ar: "قيد التنفيذ", en: "In Progress" },
  blocked: { ar: "معطّلة", en: "Blocked" }, in_review: { ar: "قيد المراجعة", en: "In Review" },
  done: { ar: "منجزة", en: "Done" }, cancelled: { ar: "ملغاة", en: "Cancelled" },
};
export const APPROVAL_STATUS_LABELS: Record<PcApprovalStatus, { ar: string; en: string }> = {
  pending: { ar: "بانتظار القرار", en: "Pending" }, approved: { ar: "معتمد", en: "Approved" },
  rejected: { ar: "مرفوض", en: "Rejected" }, revision_requested: { ar: "طلب تعديل", en: "Revision Requested" },
};

export interface ProjectCore {
  project_id: string; core_stage: PcStage; priority: PcPriority; health: PcHealth;
  start_date: string | null; due_date: string | null; delivery_date: string | null;
  budget_amount: number | null; estimated_cost: number | null; actual_cost: number | null;
  currency: string; progress_pct: number; project_type: string | null;
  created_at: string; updated_at: string; updated_by: string | null;
}
export interface OperationalProject {
  id: string; project_name: string | null; status: string | null; client_id: string | null;
  notes: string | null; shooting_date: string | null; created_at: string;
  project_core: ProjectCore | null;
}
export interface PcTask {
  id: string; project_id: string; parent_task_id: string | null; title: string; description: string | null;
  status: PcTaskStatus; priority: PcPriority; assignee_id: string | null;
  start_date: string | null; due_date: string | null; estimated_hours: number | null; actual_hours: number | null;
  progress_pct: number; labels: string[]; sort_order: number; recurring: string | null;
  created_by: string | null; completed_at: string | null; created_at: string; updated_at: string;
}
export interface TaskChecklistItem { id: string; task_id: string; label: string; is_done: boolean; sort_order: number; done_at: string | null }
export interface TaskComment { id: string; task_id: string; author_id: string | null; body: string; created_at: string }
export interface ProjectActivity { id: string; project_id: string; actor_id: string | null; action: string; entity_type: string | null; entity_id: string | null; detail: Record<string, unknown>; created_at: string }
export interface ProjectApproval {
  id: string; project_id: string; deliverable_id: string | null; kind: PcApprovalKind; status: PcApprovalStatus;
  title: string | null; note: string | null; decision_note: string | null;
  requested_by: string | null; decided_by: string | null; decided_at: string | null; created_at: string;
}
export interface StatusHistoryRow { id: string; project_id: string; from_stage: string | null; to_stage: string; note: string | null; changed_by: string | null; created_at: string }
export interface ProjectCoreDashboard {
  active: number; overdue: number; awaiting_client: number; awaiting_staff: number; near_delivery: number;
  closed: number; at_risk: number; total_budget: number; total_cost: number;
  open_tasks: number; my_tasks: number; overdue_tasks: number; pending_approvals: number; hours_logged_30d: number;
}

// ─── القراءات ───
export async function pcListProjects(): Promise<Result<OperationalProject[]>> {
  const r = await pget<(Omit<OperationalProject, "project_core"> & { project_core: ProjectCore | ProjectCore[] | null })[]>(
    `projects?select=id,project_name,status,client_id,notes,shooting_date,created_at,project_core(*)&is_deleted=eq.false&order=created_at.desc&limit=500`);
  if (!r.ok) return r;
  // PostgREST قد يُعيد المورد المضمّن كمصفوفة (1:1) — نُطبّعه إلى كائن أو null.
  const data: OperationalProject[] = r.data.map((p) => ({
    ...p, project_core: Array.isArray(p.project_core) ? (p.project_core[0] ?? null) : p.project_core,
  }));
  return { ok: true, data };
}
export const pcGetProjectCore = async (projectId: string): Promise<Result<ProjectCore | null>> => {
  const r = await pget<ProjectCore[]>(`project_core?project_id=eq.${enc(projectId)}&select=*`);
  return r.ok ? { ok: true, data: r.data[0] ?? null } : r;
};
export const pcListTasks = (projectId: string) =>
  pget<PcTask[]>(`project_tasks?project_id=eq.${enc(projectId)}&is_deleted=eq.false&select=*&order=sort_order.asc,created_at.asc`);
export const pcListChecklist = (taskId: string) =>
  pget<TaskChecklistItem[]>(`project_task_checklists?task_id=eq.${enc(taskId)}&select=*&order=sort_order.asc`);
export const pcListTaskComments = (taskId: string) =>
  pget<TaskComment[]>(`task_comments?task_id=eq.${enc(taskId)}&is_deleted=eq.false&select=*&order=created_at.asc`);
export const pcListActivity = (projectId: string, limit = 60) =>
  pget<ProjectActivity[]>(`project_activity?project_id=eq.${enc(projectId)}&select=*&order=created_at.desc&limit=${limit}`);
export const pcListApprovals = (projectId: string) =>
  pget<ProjectApproval[]>(`project_approvals?project_id=eq.${enc(projectId)}&select=*&order=created_at.desc`);
export const pcListStatusHistory = (projectId: string) =>
  pget<StatusHistoryRow[]>(`project_status_history?project_id=eq.${enc(projectId)}&select=*&order=created_at.desc`);

// ─── الكتابات (RPCs) ───
export const pcEnsure = (projectId: string) => prpc<ProjectCore>("project_core_ensure", { p_project: projectId });
export const pcSetStage = (projectId: string, stage: PcStage, note?: string) =>
  prpc<ProjectCore>("project_core_set_stage", { p_project: projectId, p_stage: stage, p_note: note ?? null });
export const pcSetMeta = (projectId: string, data: Record<string, unknown>) =>
  prpc<ProjectCore>("project_core_set_meta", { p_project: projectId, p_data: data });

export const pcTaskCreate = (projectId: string, data: Record<string, unknown>) =>
  prpc<PcTask>("pc_task_create", { p_project: projectId, p_data: data });
export const pcTaskUpdate = (taskId: string, data: Record<string, unknown>) =>
  prpc<PcTask>("pc_task_update", { p_task: taskId, p_data: data });
export const pcTaskDelete = (taskId: string) => prpc<boolean>("pc_task_delete", { p_task: taskId });
export const pcTaskComment = (taskId: string, body: string) => prpc<TaskComment>("pc_task_comment", { p_task: taskId, p_body: body });
export const pcChecklistAdd = (taskId: string, label: string) => prpc<TaskChecklistItem>("pc_task_checklist_add", { p_task: taskId, p_label: label });
export const pcChecklistToggle = (itemId: string, done: boolean) => prpc<boolean>("pc_task_checklist_toggle", { p_item: itemId, p_done: done });
export const pcTaskFollow = (taskId: string, follow = true) => prpc<boolean>("pc_task_follow", { p_task: taskId, p_follow: follow });
export const pcTaskSetDependency = (taskId: string, dependsOn: string, on = true) =>
  prpc<boolean>("pc_task_set_dependency", { p_task: taskId, p_depends_on: dependsOn, p_on: on });

export const pcTimeLog = (projectId: string, taskId: string | null, minutes: number, forDate?: string, note?: string) =>
  prpc<unknown>("pc_time_log", { p_project: projectId, p_task: taskId, p_minutes: minutes, p_for_date: forDate ?? null, p_note: note ?? null });

export const pcApprovalRequest = (projectId: string, kind: PcApprovalKind, title?: string, deliverableId?: string, note?: string) =>
  prpc<ProjectApproval>("pc_approval_request", { p_project: projectId, p_kind: kind, p_title: title ?? null, p_deliverable: deliverableId ?? null, p_note: note ?? null });
export const pcApprovalDecide = (approvalId: string, decision: Exclude<PcApprovalStatus, "pending">, note?: string) =>
  prpc<ProjectApproval>("pc_approval_decide", { p_approval: approvalId, p_decision: decision, p_note: note ?? null });

export const pcDashboard = () => prpc<ProjectCoreDashboard>("project_core_dashboard");
export const pcCalendar = (from: string, to: string, projectId?: string) =>
  prpc<{ tasks: unknown[]; meetings: unknown[]; shoots: unknown[] }>("project_core_calendar", { p_from: from, p_to: to, p_project: projectId ?? null });

// خريطة رسائل الأخطاء الشائعة → عربي.
export function pcErr(e: string): string {
  if (/could not find|schema cache|PGRST\d|does not exist|function .* does not/i.test(e)) return "منصة المشاريع غير مطبّقة في قاعدة البيانات — شغّل project_core_FINAL_RUNME.sql.";
  if (/not authorized|permission denied/i.test(e)) return "لا تملك صلاحية هذا الإجراء.";
  if (/already_decided/.test(e)) return "تم البتّ في هذا الاعتماد مسبقًا.";
  if (/title_required/.test(e)) return "العنوان إلزامي.";
  if (/body_required/.test(e)) return "النص إلزامي.";
  if (/bad_stage/.test(e)) return "مرحلة غير صالحة.";
  if (/bad_minutes/.test(e)) return "مدة غير صحيحة.";
  if (/not_found/.test(e)) return "العنصر غير موجود.";
  if (/cross_project_dependency|self_dependency/.test(e)) return "اعتمادية غير صالحة.";
  return "تعذّر تنفيذ الإجراء. حاول مرة أخرى.";
}
