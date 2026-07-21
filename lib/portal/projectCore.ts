// ════════════════════════════════════════════════════════════════════════════
// Project Core — طبقة العميل (typed) لمنصة إدارة وتشغيل المشاريع.
// كل الكتابات عبر SECURITY DEFINER RPCs؛ القراءات عبر PostgREST (RLS-scoped).
// يعتمد على docs/project_core_FINAL_RUNME.sql. لا supabase-js.
// ════════════════════════════════════════════════════════════════════════════
import { pget, prpc, ppost, ppatch, enc, currentUserId, type Result } from "@/lib/portal/client";
import { SUPABASE_URL, SUPABASE_KEY, getValidSession } from "@/lib/portalAuth";
import { LIFECYCLE_STAGES, LIFECYCLE_ORDER, type LifecycleStageKey } from "@/lib/project-core/lifecycle";

// ─── الثوابت/الأنواع ───
// المصدر الوحيد لمراحل دورة الحياة وتسمياتها = lib/project-core/lifecycle.ts.
// PC_STAGES/PC_STAGE_LABELS مجرّد إعادة اشتقاق منه (بلا تكرار للقائمة أو التسميات).
export const PC_STAGES = LIFECYCLE_ORDER;
export type PcStage = LifecycleStageKey;

export const PC_STAGE_LABELS: Record<PcStage, { ar: string; en: string }> =
  Object.fromEntries(LIFECYCLE_STAGES.map((s) => [s.key, { ar: s.ar, en: s.en }])) as Record<PcStage, { ar: string; en: string }>;

export type PcPriority = "low" | "normal" | "high" | "urgent";
export type PcHealth = "on_track" | "at_risk" | "off_track";
// دورة حالة المهمة (Batch 3A). 'done' = «مكتملة» (قيمة الإكمال المعتمدة). 'in_review'
// مُرحَّلة تاريخيًا → 'internal_review' في القاعدة؛ تبقى في النوع كأمان عرض للصفوف القديمة.
export type PcTaskStatus = "backlog" | "todo" | "in_progress" | "internal_review" | "client_review" | "blocked" | "done" | "cancelled" | "in_review";
export const TASK_STATUSES: PcTaskStatus[] = ["backlog", "todo", "in_progress", "internal_review", "client_review", "blocked", "done", "cancelled"];
export type TaskAssignmentRole = "owner" | "contributor" | "reviewer" | "watcher";
export interface TaskAssignee { task_id: string; user_id: string; role: TaskAssignmentRole; name: string | null }
export interface ProjectTaskProgress { total: number; active: number; done: number; overdue: number; pct: number }
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
  backlog: { ar: "قائمة الانتظار", en: "Backlog" }, todo: { ar: "للتنفيذ", en: "To Do" },
  in_progress: { ar: "قيد التنفيذ", en: "In Progress" },
  internal_review: { ar: "مراجعة داخلية", en: "Internal Review" },
  client_review: { ar: "مراجعة العميل", en: "Client Review" },
  blocked: { ar: "معطّلة", en: "Blocked" }, done: { ar: "مكتملة", en: "Completed" },
  cancelled: { ar: "ملغاة", en: "Cancelled" }, in_review: { ar: "مراجعة داخلية", en: "Internal Review" },
};
export const TASK_ASSIGNMENT_ROLE_LABELS: Record<TaskAssignmentRole, { ar: string; en: string }> = {
  owner: { ar: "المسؤول", en: "Owner" }, contributor: { ar: "مشارك", en: "Contributor" },
  reviewer: { ar: "مراجِع", en: "Reviewer" }, watcher: { ar: "مراقب", en: "Watcher" },
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
  client_visible?: boolean; deliverable_id?: string | null; shoot_session_id?: string | null;
  preproduction_item_id?: string | null; core_stage?: string | null;
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
export interface DashCounters {
  total: number; active: number; planning: number; ready: number; scheduled: number; in_production: number;
  post_production: number; internal_review: number; awaiting_client: number; revision: number; near_delivery: number;
  overdue: number; at_risk: number; closed: number; no_manager: number; no_due: number;
  overdue_tasks: number; pending_approvals: number; hours_month: number;
  total_budget: number | null; actual_cost: number | null; expected_profit: number | null; actual_profit: number | null;
  negative_profit: number | null;
}
export interface DashRow {
  id: string; project_name: string | null; status: string | null; client_id: string | null;
  stage: PcStage; priority: PcPriority; health: PcHealth; progress_pct: number;
  due_date: string | null; delivery_date: string | null; project_type: string | null;
  budget_amount: number | null; estimated_cost: number | null; actual_cost: number | null; profit: number | null;
  client_name: string | null; manager_name: string | null; manager_id: string | null;
  team_count: number; open_tasks: number; overdue_tasks: number; pending_approvals: number;
  last_activity_at: string | null; days_remaining: number | null;
}
export interface DashboardResponse { counters: DashCounters; total_count: number; rows: DashRow[] }
export type DashFilter = "all" | "active" | "planning" | "ready" | "scheduled" | "in_production" | "post_production"
  | "internal_review" | "awaiting_client" | "revision" | "near_delivery" | "overdue" | "at_risk" | "closed"
  | "no_manager" | "no_due" | "negative_profit";

// وحدات المشروع
export interface ProjectMemberRow { id: string; project_id: string; user_id: string; role: string; created_at: string; is_deleted: boolean }
export interface ProjectCost { id: string; project_id: string; category: string; description: string | null; amount: number; currency: string; cost_date: string; created_at: string }
export interface ProjectRisk { id: string; project_id: string; title: string; description: string | null; severity: string; likelihood: string; status: string; mitigation: string | null; created_at: string }
export interface ProjectMeeting { id: string; project_id: string; title: string; scheduled_at: string | null; duration_minutes: number | null; location: string | null; meeting_url: string | null; notes: string | null; created_at: string }
export interface ShootSession {
  id: string; project_id: string; title: string; session_date: string | null; call_time: string | null; location: string | null;
  client_contact: string | null; permits: string | null; safety_notes: string | null; weather_note: string | null;
  status: string; completion_report: string | null; created_at: string;
  start_time?: string | null; wrap_time?: string | null; cancel_reason?: string | null;
  crew: unknown[]; equipment: unknown[]; vehicles: unknown[]; shot_list: unknown[]; attendance: unknown[];
}
export interface Deliverable {
  id: string; project_id: string; title: string; type: string; status: string; version: number; preview_url: string | null; created_at: string;
  assignee_id?: string | null; due_date?: string | null; watermark_required?: boolean; allow_download?: boolean;
}

// project_core non-financial columns. The money columns (budget_amount /
// estimated_cost / actual_cost) are REVOKEd from the client role and served only
// through pc_project_financials(), so they are never in a plain project_core
// select — see docs/project_core_financials_phaseA_RUNME.sql (RPC, pre-deploy)
// and docs/project_core_financials_phaseB_lockdown_RUNME.sql (revoke, post-deploy).
const PC_CORE_COLS =
  "project_id,core_stage,priority,health,start_date,due_date,delivery_date,currency,progress_pct,project_type,created_at,updated_at,updated_by";

// ─── القراءات ───
export async function pcListProjects(): Promise<Result<OperationalProject[]>> {
  const r = await pget<(Omit<OperationalProject, "project_core"> & { project_core: ProjectCore | ProjectCore[] | null })[]>(
    `projects?select=id,project_name,status,client_id,notes,shooting_date,created_at,project_core(${PC_CORE_COLS})&is_deleted=eq.false&order=created_at.desc&limit=500`);
  if (!r.ok) return r;
  // PostgREST قد يُعيد المورد المضمّن كمصفوفة (1:1) — نُطبّعه إلى كائن أو null.
  const data: OperationalProject[] = r.data.map((p) => ({
    ...p, project_core: Array.isArray(p.project_core) ? (p.project_core[0] ?? null) : p.project_core,
  }));
  return { ok: true, data };
}
// The financial columns come only from the finance-gated RPC (NULLs for anyone
// without can_manage_projects()/can_see_financials()), merged onto the base row.
export const pcGetProjectCore = async (projectId: string): Promise<Result<ProjectCore | null>> => {
  const r = await pget<ProjectCore[]>(`project_core?project_id=eq.${enc(projectId)}&select=${PC_CORE_COLS}`);
  if (!r.ok) return r;
  const base = r.data[0] ?? null;
  if (!base) return { ok: true, data: null };
  const f = await prpc<{ budget_amount: number | null; estimated_cost: number | null; actual_cost: number | null }[]>(
    "pc_project_financials", { p_project: projectId });
  const fin = f.ok ? f.data[0] : undefined;
  return { ok: true, data: { ...base, budget_amount: fin?.budget_amount ?? null, estimated_cost: fin?.estimated_cost ?? null, actual_cost: fin?.actual_cost ?? null } };
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
export const pcTaskSetDependency = (taskId: string, dependsOn: string, on = true, depType = "finish_to_start") =>
  prpc<boolean>("pc_task_set_dependency", { p_task: taskId, p_depends_on: dependsOn, p_on: on, p_dep_type: depType });

// ─── Batch 3B: Kanban board / move / review ───
export interface TaskBoardRow {
  id: string; title: string; status: PcTaskStatus; priority: PcPriority;
  assignee_id: string | null; parent_task_id: string | null;
  start_date: string | null; due_date: string | null; progress_pct: number;
  estimated_hours: number | null; sort_order: number; version: number;
  client_visible: boolean; core_stage: string | null;
  deliverable_id: string | null; shoot_session_id: string | null; preproduction_item_id: string | null;
  blocked_reason: string | null; overdue: boolean;
  assignees: { user_id: string; role: TaskAssignmentRole; name: string | null }[];
  comments: number; checklist_total: number; checklist_done: number;
  subtasks_total: number; subtasks_done: number; deps_total: number; deps_blocking: number;
}
export interface TaskBoard { tasks: TaskBoardRow[]; progress: ProjectTaskProgress }
export const pcProjectTasksBoard = (projectId: string) =>
  prpc<TaskBoard>("pc_project_tasks_board", { p_project: projectId });
export const pcTaskMove = (taskId: string, targetStatus: string, opts?: { before?: string | null; after?: string | null; expectedVersion?: number | null; reason?: string | null }) =>
  prpc<PcTask>("pc_task_move", {
    p_task: taskId, p_target_status: targetStatus,
    p_before: opts?.before ?? null, p_after: opts?.after ?? null,
    p_expected_version: opts?.expectedVersion ?? null, p_reason: opts?.reason ?? null,
  });
export const pcTaskReviewAction = (taskId: string, action: string, comment?: string | null, expectedVersion?: number | null) =>
  prpc<PcTask>("pc_task_review_action", { p_task: taskId, p_action: action, p_comment: comment ?? null, p_expected_version: expectedVersion ?? null });

// ─── Batch 3C: execution progress / health / dashboard / alerts / mode ───
export type ProgressMode = "lifecycle" | "tasks" | "hybrid" | "manual";
export interface ProgressSnapshot {
  progress_mode: ProgressMode; lifecycle_progress: number; task_progress: number; effective_progress: number;
  auto_pct: number; core_stage: string | null; stage_floor: number; stage_ceiling: number;
  calculation_method: string; overridden: boolean; eligible_tasks: number; completed_tasks: number;
  overdue_tasks: number; blocked_tasks: number; total_tasks: number; task_method: string;
}
export type HealthStatus = "healthy" | "attention" | "at_risk" | "critical";
export interface ExecutionHealth {
  status: HealthStatus; health_score: number;
  reasons: { key: string; severity: string; ar: string; en: string }[];
  active_tasks: number; overdue_tasks: number; blocked_tasks: number; awaiting_review: number; hours_overrun: number; idle_days: number;
}
export interface ExecutionDashboard {
  progress: ProgressSnapshot; health: ExecutionHealth;
  counts: { total: number; todo: number; in_progress: number; review: number; blocked: number; done: number; overdue: number; due_this_week: number };
  hours: { estimated: number; logged: number; actual_manual: number };
  workload: { user_id: string; name: string | null; active: number; overdue: number }[];
  last_activity_at: string | null;
}
export interface ProjectAlert { type: string; severity: string; task_id: string; title: string; assignee_id: string | null; due: string | null; ar: string; en: string }
export interface StageReadiness { open_tasks: number; overdue_tasks: number; blocked_tasks: number; awaiting_review: number; ready: boolean; warning_ar: string | null; warning_en: string | null }

export const projectProgressSnapshot = (projectId: string) => prpc<ProgressSnapshot>("project_progress_snapshot", { p_project: projectId });
export const projectExecutionDashboard = (projectId: string) => prpc<ExecutionDashboard>("project_execution_dashboard", { p_project: projectId });
export const projectAlerts = (projectId: string) => prpc<{ project_id: string; alerts: ProjectAlert[] }>("project_alerts", { p_project: projectId });
export const projectStageReadiness = (projectId: string) => prpc<StageReadiness>("project_stage_readiness", { p_project: projectId });
export const projectCoreSetProgressMode = (projectId: string, mode: ProgressMode, reason?: string) =>
  prpc<ProjectCore>("project_core_set_progress_mode", { p_project: projectId, p_mode: mode, p_reason: reason ?? null });
export const PROGRESS_MODE_LABELS: Record<ProgressMode, { ar: string; en: string; desc: { ar: string; en: string } }> = {
  lifecycle: { ar: "دورة حياة المشروع", en: "Lifecycle", desc: { ar: "النسبة من مرحلة دورة الحياة (السلوك الحالي).", en: "From the lifecycle stage." } },
  tasks: { ar: "تقدم المهام", en: "Tasks", desc: { ar: "النسبة من تقدم المهام المؤهّلة فقط.", en: "From eligible task progress only." } },
  hybrid: { ar: "هجين", en: "Hybrid", desc: { ar: "المرحلة تحدد النطاق، والمهام تحدد التقدّم داخله.", en: "Stage sets the band; tasks fill it." } },
  manual: { ar: "يدوي", en: "Manual", desc: { ar: "نسبة يدوية يضبطها المخوّل.", en: "Manually set." } },
};
export const HEALTH_STATUS_LABELS: Record<HealthStatus, { ar: string; en: string; cls: string }> = {
  healthy: { ar: "سليم", en: "Healthy", cls: "text-emerald-400" }, attention: { ar: "يحتاج انتباهًا", en: "Attention", cls: "text-amber-400" },
  at_risk: { ar: "معرّض للخطر", en: "At Risk", cls: "text-orange-400" }, critical: { ar: "حرج", en: "Critical", cls: "text-red-400" },
};

// ─── Batch 3A: assignees / subtasks / task-based progress ───
export const pcTaskAssign = (taskId: string, userId: string, role: TaskAssignmentRole, on = true) =>
  prpc<{ ok: boolean }>("pc_task_assign", { p_task: taskId, p_user: userId, p_role: role, p_on: on });
export const pcTaskSetParent = (taskId: string, parentId: string | null) =>
  prpc<PcTask>("pc_task_set_parent", { p_task: taskId, p_parent: parentId });
export const pcProjectTaskAssignees = (projectId: string) =>
  prpc<TaskAssignee[]>("pc_project_task_assignees", { p_project: projectId });
export const projectTaskProgress = (projectId: string) =>
  prpc<ProjectTaskProgress>("project_task_progress", { p_project: projectId });

export const pcTimeLog = (projectId: string, taskId: string | null, minutes: number, forDate?: string, note?: string) =>
  prpc<unknown>("pc_time_log", { p_project: projectId, p_task: taskId, p_minutes: minutes, p_for_date: forDate ?? null, p_note: note ?? null });

export const pcApprovalRequest = (projectId: string, kind: PcApprovalKind, title?: string, deliverableId?: string, note?: string) =>
  prpc<ProjectApproval>("pc_approval_request", { p_project: projectId, p_kind: kind, p_title: title ?? null, p_deliverable: deliverableId ?? null, p_note: note ?? null });
export const pcApprovalDecide = (approvalId: string, decision: Exclude<PcApprovalStatus, "pending">, note?: string) =>
  prpc<ProjectApproval>("pc_approval_decide", { p_approval: approvalId, p_decision: decision, p_note: note ?? null });

export const pcDashboard = (opts?: { filter?: DashFilter; search?: string; manager?: string; client?: string; from?: string; to?: string; limit?: number; offset?: number }) =>
  prpc<DashboardResponse>("project_core_dashboard", {
    p_filter: opts?.filter ?? "all", p_search: opts?.search?.trim() || null,
    p_manager: opts?.manager ?? null, p_client: opts?.client ?? null,
    p_from: opts?.from ?? null, p_to: opts?.to ?? null,
    p_limit: opts?.limit ?? 100, p_offset: opts?.offset ?? 0,
  });
export const pcCalendar = (from: string, to: string, projectId?: string) =>
  prpc<{ tasks: unknown[]; meetings: unknown[]; shoots: unknown[] }>("project_core_calendar", { p_from: from, p_to: to, p_project: projectId ?? null });
export const pcCreateProject = (data: Record<string, unknown>) =>
  prpc<{ ok: boolean; project_id: string; stage: string }>("project_core_create_project", { p_data: data });

// ─── وحدات المشروع (قراءات + كتابات) ───
export const pcListMembers = (projectId: string) =>
  pget<ProjectMemberRow[]>(`project_members?project_id=eq.${enc(projectId)}&is_deleted=eq.false&select=id,project_id,user_id,role,created_at,is_deleted&order=created_at.asc`);
export const pcMemberAdd = (projectId: string, userId: string, role: string) =>
  prpc<boolean>("pc_member_add", { p_project: projectId, p_user: userId, p_role: role });
export const pcMemberRemove = (projectId: string, userId: string) =>
  prpc<boolean>("pc_member_remove", { p_project: projectId, p_user: userId });

export const pcListCosts = (projectId: string) =>
  pget<ProjectCost[]>(`project_costs?project_id=eq.${enc(projectId)}&is_deleted=eq.false&select=*&order=cost_date.desc`);
export const pcCostAdd = (projectId: string, data: Record<string, unknown>) => prpc<ProjectCost>("pc_cost_add", { p_project: projectId, p_data: data });
export const pcCostDelete = (costId: string) => prpc<boolean>("pc_cost_delete", { p_cost: costId });

export const pcListRisks = (projectId: string) =>
  pget<ProjectRisk[]>(`project_risks?project_id=eq.${enc(projectId)}&is_deleted=eq.false&select=*&order=created_at.desc`);
export const pcRiskUpsert = (projectId: string, data: Record<string, unknown>) => prpc<ProjectRisk>("pc_risk_upsert", { p_project: projectId, p_data: data });

export const pcListMeetings = (projectId: string) =>
  pget<ProjectMeeting[]>(`project_meetings?project_id=eq.${enc(projectId)}&is_deleted=eq.false&select=*&order=scheduled_at.desc.nullslast`);
export const pcMeetingUpsert = (projectId: string, data: Record<string, unknown>) => prpc<ProjectMeeting>("pc_meeting_upsert", { p_project: projectId, p_data: data });

export const pcListShoots = (projectId: string) =>
  pget<ShootSession[]>(`project_shoot_sessions?project_id=eq.${enc(projectId)}&is_deleted=eq.false&select=*&order=session_date.desc.nullslast`);
export const pcShootUpsert = (projectId: string, data: Record<string, unknown>) => prpc<ShootSession>("pc_shoot_upsert", { p_project: projectId, p_data: data });

export const pcListDeliverables = (projectId: string) =>
  pget<Deliverable[]>(`deliverables?project_id=eq.${enc(projectId)}&is_deleted=eq.false&select=id,project_id,title,type,status,version,preview_url,created_at,assignee_id,due_date,watermark_required,allow_download&order=created_at.desc`);

export interface ClientLite { id: string; full_name: string | null; company: string | null }
export const pcListClients = () =>
  pget<ClientLite[]>(`clients?is_deleted=eq.false&select=id,full_name,company&order=created_at.desc&limit=300`);
export interface StaffLite { id: string; full_name: string | null; staff_role: string | null }
export const pcListStaff = () =>
  pget<StaffLite[]>(`profiles?staff_role=not.is.null&select=id,full_name,staff_role&order=full_name.asc`);
// ─── تعديل/حذف/أرشفة/استعادة المشروع + متطلبات المرحلة (project_core_FINAL_COMPLETION_RUNME.sql) ───
export const pcUpdateProject = (projectId: string, expectedUpdatedAt: string | null, patch: Record<string, unknown>, reason?: string) =>
  prpc<ProjectCore>("project_core_update_project", { p_project_id: projectId, p_expected_updated_at: expectedUpdatedAt, p_patch: patch, p_reason: reason ?? null });
export const pcSoftDeleteProject = (projectId: string, reason: string) =>
  prpc<{ ok: boolean; status?: string }>("project_core_soft_delete_project", { p_project_id: projectId, p_reason: reason });
export const pcArchiveProject = (projectId: string, reason: string) =>
  prpc<{ ok: boolean; status?: string }>("project_core_archive_project", { p_project_id: projectId, p_reason: reason });
export const pcRestoreProject = (projectId: string, reason?: string) =>
  prpc<{ ok: boolean; status?: string }>("project_core_restore_project", { p_project_id: projectId, p_reason: reason ?? null });
export interface DeletedProject { id: string; project_name: string | null; client_name: string | null; kind: "deleted" | "archived"; reason: string | null; at: string | null }
export const pcDeletedList = () => prpc<DeletedProject[]>("project_core_deleted_list");
export interface StageReqItem { key: string; ar: string; en: string }
export interface StageRequirements { ok: boolean; missing: StageReqItem[] }
export const pcStageRequirements = (projectId: string, target: string) =>
  prpc<StageRequirements>("project_core_stage_requirements", { p_project_id: projectId, p_target: target });

// ─── التقدّم التلقائي ───
export interface ProgressInfo { auto: number; manual: number | null; final: number }
export const pcProgress = (projectId: string) => prpc<ProgressInfo>("project_core_progress", { p_project: projectId });
export const pcSetProgress = (projectId: string, pct: number | null, reason?: string) =>
  prpc<ProgressInfo>("project_core_set_progress", { p_project: projectId, p_pct: pct, p_reason: reason ?? null });

// ─── التقويم (مُثرّى) ───
export interface CalTask { id: string; project_id: string; title: string; date: string; status: string; priority: string }
export interface CalMeeting { id: string; project_id: string; title: string; date: string; at: string }
export interface CalShoot { id: string; project_id: string; title: string; date: string; call_time: string | null; status: string }
export interface CalMilestone { project_id: string; title: string | null; date: string; kind: "due" | "delivery" }
export interface CalendarData { tasks: CalTask[]; meetings: CalMeeting[]; shoots: CalShoot[]; milestones: CalMilestone[] }
export const pcCalendarData = (from: string, to: string, projectId?: string) =>
  prpc<CalendarData>("project_core_calendar", { p_from: from, p_to: to, p_project: projectId ?? null });

// ─── مخطّط المهام (Gantt) ───
export interface GraphTask { id: string; title: string; status: PcTaskStatus; priority: PcPriority; start_date: string | null; due_date: string | null; progress: number; assignee_id: string | null; parent_task_id: string | null }
export interface GraphDep { task_id: string; depends_on: string }
export interface TaskGraph { tasks: GraphTask[]; deps: GraphDep[] }
export const pcTaskGraph = (projectId: string) => prpc<TaskGraph>("project_core_task_graph", { p_project: projectId });
export const pcListTaskDeps = (taskId: string) =>
  pget<{ task_id: string; depends_on_task_id: string }[]>(`task_dependencies?task_id=eq.${enc(taskId)}&select=task_id,depends_on_task_id`);

// ─── القوالب ───
export interface ProjectTemplate { id: string; name: string; description: string | null; spec: Record<string, unknown>; is_active: boolean; created_at: string }
export const pcListTemplates = () => pget<ProjectTemplate[]>(`project_templates?is_active=eq.true&select=*&order=name.asc`);
export const pcCreateTemplate = (v: { name: string; description?: string; spec?: Record<string, unknown> }) =>
  ppost<ProjectTemplate[]>("project_templates", { name: v.name, description: v.description ?? null, spec: v.spec ?? {}, created_by: currentUserId() });
export const pcUpdateTemplate = (id: string, patch: Record<string, unknown>) =>
  ppatch<ProjectTemplate[]>(`project_templates?id=eq.${enc(id)}`, patch);
export const pcArchiveTemplate = (id: string) => ppatch<ProjectTemplate[]>(`project_templates?id=eq.${enc(id)}`, { is_active: false });
export const pcApplyTemplate = (projectId: string, templateId: string) =>
  prpc<{ ok: boolean; tasks: number }>("project_core_apply_template", { p_project: projectId, p_template: templateId });

// ─── إصدارات المخرجات ───
export interface DeliverableVersion {
  id: string; deliverable_id: string; version: number; preview_url: string | null; note: string | null;
  created_by: string | null; created_at: string;
  file_path?: string | null; client_visible?: boolean; approved_at?: string | null; approved_by?: string | null;
  is_final?: boolean; superseded?: boolean;
}
export const pcListDeliverableVersions = (deliverableId: string) =>
  pget<DeliverableVersion[]>(`project_deliverable_versions?deliverable_id=eq.${enc(deliverableId)}&select=*&order=version.desc`);
export const pcDeliverableVersionAdd = (deliverableId: string, data: Record<string, unknown>) =>
  prpc<DeliverableVersion>("project_core_deliverable_version_add", { p_deliverable: deliverableId, p_data: data });

// ─── Batch 6: دورة حياة المخرَج + القوالب v2 ───
export const pcDeliverableUpsert = (projectId: string, data: Record<string, unknown>) =>
  prpc<Deliverable>("pc_deliverable_upsert", { p_project: projectId, p_data: data });
export type DlvReviewAction = "send_client" | "unshare" | "approve" | "reject" | "revision" | "final" | "archive";
export const pcDeliverableReview = (versionId: string, action: DlvReviewAction, note?: string, force = false) =>
  prpc<{ ok: boolean; action: string; version: number }>("pc_deliverable_review", { p_version: versionId, p_action: action, p_note: note ?? null, p_force: force });
export const pcDeliverableComment = (deliverableId: string, body: string, timecode?: number) =>
  prpc<{ ok: boolean; id: string }>("pc_deliverable_comment", { p_deliverable: deliverableId, p_body: body, p_timecode: timecode ?? null });
export interface InternalComment { id: string; deliverable_id: string | null; author_id: string; body: string; timecode_seconds: number | null; created_at: string }
export const pcListDeliverableComments = (deliverableId: string) =>
  pget<InternalComment[]>(`internal_comments?deliverable_id=eq.${enc(deliverableId)}&select=id,deliverable_id,author_id,body,timecode_seconds,created_at&order=created_at.desc&limit=100`);
export interface TemplateApplyResult { ok: boolean; application_id: string; tasks: number; milestones: number; deliverables: number; risks: number; meetings: number; shoots: number }
export const pcApplyTemplateV2 = (projectId: string, templateId: string, modules?: string[], start?: string) =>
  prpc<TemplateApplyResult>("project_core_apply_template_v2", { p_project: projectId, p_template: templateId, p_modules: modules ?? null, p_start: start ?? null });
export const pcListAllTemplates = () => pget<ProjectTemplate[]>(`project_templates?select=*&order=name.asc`);

// ─── Batch 8: Zoho Books (finance/admin) ───
export interface ZohoStatus {
  settings: { organization_id: string | null; organization_name: string | null; sync_paused: boolean;
    last_test_at: string | null; last_test_ok: boolean | null; last_test_error: string | null; last_sync_at: string | null } | null;
  jobs: Record<string, number>;
  mappings_count: number;
  account_mappings: { kind: string; local_key: string; zoho_id: string; zoho_name: string | null }[];
  unprocessed_webhooks: number;
}
export interface ZohoReconRow {
  id: string; description?: string; name?: string; amount: number; collected?: number; status: string;
  supplier?: string | null; zoho_type?: string | null; zoho_id: string | null; sync_status: string | null;
  last_error: string | null; last_synced_at?: string | null; remote?: Record<string, unknown> | null;
}
export interface ZohoRecon {
  expenses: ZohoReconRow[]; revenue: ZohoReconRow[];
  jobs_open: { id: string; operation: string; status: string; attempts: number; note: string | null; created_at: string }[];
  unprocessed_webhooks: number;
}
export const pcZohoStatus = () => prpc<ZohoStatus>("zoho_status");
export const pcZohoMappingSet = (kind: string, localKey: string, zohoId: string, zohoName?: string) =>
  prpc<boolean>("zoho_mapping_set", { p_kind: kind, p_local_key: localKey, p_zoho_id: zohoId, p_zoho_name: zohoName ?? null });
export const pcZohoPause = (paused: boolean) => prpc<boolean>("zoho_sync_pause", { p_paused: paused });
export const pcZohoJobRetry = (id: string) => prpc<boolean>("zoho_job_retry", { p_id: id });
export const pcZohoSyncProjectNow = (projectId: string) => prpc<{ ok: boolean; enqueued: number }>("zoho_sync_project_now", { p_project: projectId });
export const pcZohoReconciliation = (projectId?: string) => prpc<ZohoRecon>("zoho_reconciliation", { p_project: projectId ?? null });
export const ZOHO_SYNC_LABELS: Record<string, { ar: string; en: string }> = {
  not_configured: { ar: "غير مربوط", en: "Not linked" }, ready: { ar: "جاهز", en: "Ready" },
  pending: { ar: "قيد المزامنة", en: "Pending" }, processing: { ar: "قيد المزامنة", en: "Processing" },
  synced: { ar: "تمت المزامنة", en: "Synced" }, done: { ar: "تمت المزامنة", en: "Done" },
  failed: { ar: "فشل", en: "Failed" }, conflict: { ar: "تعارض", en: "Conflict" },
  needs_review: { ar: "يحتاج مراجعة", en: "Needs review" }, paused: { ar: "متوقف", en: "Paused" },
  dry_run_ok: { ar: "تجربة ناجحة (Dry-Run)", en: "Dry-run OK" }, cancelled: { ar: "ملغى", en: "Cancelled" },
};

// ─── Batch 7: مراقبة الإشعارات والبريد (للإدارة) ───
export interface EmailDeliveryRow {
  id: string; status: "pending" | "processing" | "sent" | "failed" | "skipped" | "bounced";
  attempts: number; subject: string; recipient_email: string | null; recipient_name: string | null;
  event_type: string | null; severity: string | null; direct_url: string | null;
  last_error: string | null; next_attempt_at: string | null; sent_at: string | null; created_at: string;
}
export interface NotifyMonitorData { items: EmailDeliveryRow[]; counts: Record<string, number> | null }
export const pcNotifyMonitor = (limit = 100) => prpc<NotifyMonitorData>("pc_notify_monitor", { p_limit: limit });
export const pcEmailRetry = (id: string) => prpc<boolean>("pc_email_retry", { p_id: id });
export const pcEmailCancel = (id: string) => prpc<boolean>("pc_email_cancel", { p_id: id });
export const EMAIL_STATUS_LABELS: Record<string, { ar: string; en: string }> = {
  pending: { ar: "بانتظار الإرسال", en: "Pending" }, processing: { ar: "قيد الإرسال", en: "Processing" },
  sent: { ar: "أُرسل", en: "Sent" }, failed: { ar: "فشل", en: "Failed" },
  skipped: { ar: "تُخطّي", en: "Skipped" }, bounced: { ar: "ارتدّ", en: "Bounced" },
};

// ─── ملفات المخرجات: Storage خاص (staff فقط) + Signed URLs مؤقتة ───
export const PC_DLV_BUCKET = "project-deliverables";
const pcSafeName = (n: string) => n.replace(/[^\w.\-]+/g, "_").slice(-80);
async function pcStorageFetch(path: string, init: RequestInit): Promise<Response> {
  const s = await getValidSession();
  if (!s) throw new Error("not_authenticated");
  const doFetch = (token: string) => fetch(`${SUPABASE_URL}/storage/v1${path}`, {
    ...init, headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  });
  let res = await doFetch(s.access_token);
  if (res.status === 401) { const s2 = await getValidSession(); if (s2) res = await doFetch(s2.access_token); }
  return res;
}
export async function pcDeliverableUpload(projectId: string, deliverableId: string, file: File): Promise<Result<{ path: string }>> {
  if (file.size > 100 * 1024 * 1024) return { ok: false, error: "الملف أكبر من 100MB" };
  const path = `${projectId}/${deliverableId}/${Date.now()}_${pcSafeName(file.name)}`;
  try {
    const res = await pcStorageFetch(`/object/${PC_DLV_BUCKET}/${path}`, {
      method: "POST", headers: { "x-upsert": "true", "Content-Type": file.type || "application/octet-stream" }, body: file,
    });
    if (!res.ok) return { ok: false, error: `upload_failed_${res.status}`, status: res.status };
    return { ok: true, data: { path } };
  } catch { return { ok: false, error: "network_error" }; }
}
export async function pcSignDeliverableFiles(paths: string[]): Promise<Record<string, string>> {
  const uniq = Array.from(new Set(paths.filter(Boolean)));
  if (uniq.length === 0) return {};
  try {
    const res = await pcStorageFetch(`/object/sign/${PC_DLV_BUCKET}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expiresIn: 3600, paths: uniq }),
    });
    if (!res.ok) return {};
    const arr = (await res.json()) as { path?: string; signedURL?: string }[];
    const out: Record<string, string> = {};
    for (const r of arr) if (r.path && r.signedURL) out[r.path] = `${SUPABASE_URL}/storage/v1${r.signedURL}`;
    return out;
  } catch { return {}; }
}

// ─── تحويل بند اجتماع إلى مهمة ───
export const pcMeetingToTask = (meetingId: string, title: string, assignee?: string, due?: string) =>
  prpc<PcTask>("project_core_meeting_to_task", { p_meeting: meetingId, p_title: title, p_assignee: assignee ?? null, p_due: due ?? null });

// ─── المواقع ───
export interface ProjectLocation { id: string; project_id: string; name: string; address: string | null; lat: number | null; lng: number | null; note: string | null; created_at: string }
export const pcListLocations = (projectId: string) =>
  pget<ProjectLocation[]>(`project_locations?project_id=eq.${enc(projectId)}&is_deleted=eq.false&select=*&order=created_at.desc`);
export const pcLocationCreate = (projectId: string, v: Record<string, unknown>) =>
  ppost<ProjectLocation[]>("project_locations", { project_id: projectId, ...v });
export const pcLocationArchive = (id: string) => ppatch<ProjectLocation[]>(`project_locations?id=eq.${enc(id)}`, { is_deleted: true });

// ─── الوسوم ───
export interface Tag { id: string; name: string; color: string }
export const pcListTags = () => pget<Tag[]>(`project_tags?select=id,name,color&order=name.asc`);
export const pcTagCreate = (name: string, color?: string) => ppost<Tag[]>("project_tags", { name, color: color ?? "#6b7280" });
export const pcListProjectTags = (projectId: string) =>
  pget<{ tag_id: string; project_id: string }[]>(`project_tag_map?project_id=eq.${enc(projectId)}&select=tag_id,project_id`);
export const pcTagLink = (projectId: string, tagId: string) => ppost<unknown>("project_tag_map", { project_id: projectId, tag_id: tagId });

// ─── Call Sheets ───
export interface CallSheet {
  id: string; project_id: string; shoot_session_id: string; version_number: number; title: string | null;
  shoot_date: string | null; call_time: string | null; wrap_time: string | null;
  location_name: string | null; address: string | null; map_url: string | null;
  client_contact: string | null; client_mobile: string | null;
  crew: unknown[]; equipment: unknown[]; vehicles: unknown[]; permits: string | null; safety_notes: string | null;
  weather_notes: string | null; schedule: unknown[]; shot_list: unknown[]; contacts: unknown[]; general_notes: string | null;
  status: "draft" | "sent"; created_at: string; sent_at: string | null;
}
export const pcListCallSheets = (shootId: string) =>
  pget<CallSheet[]>(`project_call_sheets?shoot_session_id=eq.${enc(shootId)}&is_deleted=eq.false&select=*&order=version_number.desc`);
export const pcCallSheetSave = (shootId: string, data: Record<string, unknown>) =>
  prpc<CallSheet>("project_core_call_sheet_save", { p_shoot: shootId, p_data: data });
export const pcCallSheetSend = (callSheetId: string) =>
  prpc<{ ok: boolean; status: string; version: number }>("project_core_call_sheet_send", { p_call_sheet: callSheetId });
// للرابط العميق ?entity=call_sheet&id= — يحدّد الجلسة الحاضنة.
export const pcGetCallSheetMeta = async (id: string): Promise<Result<{ id: string; shoot_session_id: string } | null>> => {
  const r = await pget<{ id: string; shoot_session_id: string }[]>(`project_call_sheets?id=eq.${enc(id)}&select=id,shoot_session_id`);
  return r.ok ? { ok: true, data: r.data[0] ?? null } : r;
};
export const pcCallSheetSendTo = (callSheetId: string, users: string[]) =>
  prpc<{ ok: boolean; sent_to: number; version: number }>("project_core_call_sheet_send_to", { p_call_sheet: callSheetId, p_users: users });

// (أُزيل pcDeliverableVersionSet — كتابة النسخ عبر RPCs المحروسة فقط؛ لا PATCH مباشر.)

// خريطة رسائل الأخطاء الشائعة → عربي.
// ─── Batch 5: الحسابات المالية (finance-only) ───
export interface FinanceSettings {
  project_id: string; accountant_id: string | null; currency: string; contract_value_excl_vat: number; discount: number;
  vat_rate: number; approved_budget: number; estimated_remaining_cost: number; target_margin_pct: number;
  warn_threshold_pct: number; critical_threshold_pct: number; approve_limit_accountant: number; approve_limit_admin: number;
}
export interface ProjectExpense {
  id: string; project_id: string; phase: string | null; category: string; description: string | null; supplier: string | null;
  quantity: number; unit_cost: number; amount_excl_vat: number; vat_amount: number; amount_incl_vat: number;
  kind: string; billable: boolean; payment_status: string; status: string; currency: string; expense_date: string;
  due_date: string | null; paid_date: string | null; receipt_url: string | null; notes: string | null;
  entered_by: string | null; approved_by: string | null; reject_reason: string | null; created_at: string;
}
export interface PhaseBudget { id: string; project_id: string; phase: string; allocated: number; note: string | null }
export interface RevenueRow {
  id: string; project_id: string; name: string; pct: number | null; amount_excl_vat: number; vat_amount: number;
  amount_incl_vat: number; due_date: string | null; collected_date: string | null; collected_amount: number; status: string; notes: string | null;
}
export interface FinAlert { id: string; project_id: string; level: "info" | "warning" | "critical"; kind: string; phase: string | null; message: string; amount: number | null; pct: number | null; created_at: string }
export interface FinanceSummary {
  currency: string; net_revenue: number; contract_incl_vat: number; approved_budget: number; actual_cost: number;
  committed_cost: number; forecast_cost: number; remaining_budget: number; budget_used_pct: number; collected: number;
  receivable: number; actual_profit: number; projected_profit: number; actual_margin_pct: number; projected_margin_pct: number;
  budget_variance: number; target_margin_pct: number; pending_expenses: number; open_alerts: number; accountant_id: string | null; projected_loss: boolean;
}
export const EXPENSE_STATUS_LABELS: Record<string, { ar: string; en: string }> = {
  draft: { ar: "مسودّة", en: "Draft" }, submitted: { ar: "مقدَّم", en: "Submitted" }, under_review: { ar: "قيد المراجعة", en: "Review" },
  approved: { ar: "معتمد", en: "Approved" }, rejected: { ar: "مرفوض", en: "Rejected" }, scheduled_for_payment: { ar: "مجدول للدفع", en: "Scheduled" },
  partially_paid: { ar: "مدفوع جزئيًا", en: "Partial" }, paid: { ar: "مدفوع", en: "Paid" }, refunded: { ar: "مسترد", en: "Refunded" }, voided: { ar: "ملغى", en: "Voided" },
};
export const pcFinanceSummary = (projectId: string) => prpc<FinanceSummary>("pc_finance_summary", { p_project: projectId });
export const pcFinanceSettings = async (projectId: string): Promise<Result<FinanceSettings | null>> => {
  const r = await pget<FinanceSettings[]>(`project_finance_settings?project_id=eq.${enc(projectId)}&select=*`);
  return r.ok ? { ok: true, data: r.data[0] ?? null } : r;
};
export const pcFinanceSettingsSet = (projectId: string, data: Record<string, unknown>) => prpc<FinanceSettings>("pc_finance_settings_set", { p_project: projectId, p_data: data });
export const pcFinanceAssignAccountant = (projectId: string, userId: string | null) => prpc<{ ok: boolean }>("pc_finance_assign_accountant", { p_project: projectId, p_user: userId });
export const pcListFinanceStaff = () => pget<StaffLite[]>(`profiles?staff_role=eq.finance&account_status=eq.active&select=id,full_name,staff_role&order=full_name.asc`);
export const pcListExpenses = (projectId: string) => pget<ProjectExpense[]>(`project_expenses?project_id=eq.${enc(projectId)}&is_deleted=eq.false&select=*&order=expense_date.desc,created_at.desc`);
export const pcExpenseCreate = (projectId: string, data: Record<string, unknown>) => prpc<ProjectExpense>("pc_expense_create", { p_project: projectId, p_data: data });
export const pcExpenseTransition = (expenseId: string, action: string, reason?: string, override = false) => prpc<ProjectExpense>("pc_expense_transition", { p_expense: expenseId, p_action: action, p_reason: reason ?? null, p_override: override });
export const pcExpenseDelete = (expenseId: string, reason: string) => prpc<boolean>("pc_expense_delete", { p_expense: expenseId, p_reason: reason });
export const pcExpenseRefund = (expenseId: string, reason: string) => prpc<ProjectExpense>("pc_expense_refund", { p_expense: expenseId, p_reason: reason });
export const pcListPhaseBudgets = (projectId: string) => pget<PhaseBudget[]>(`project_phase_budgets?project_id=eq.${enc(projectId)}&select=*&order=created_at.asc`);
export const pcPhaseBudgetUpsert = (projectId: string, phase: string, allocated: number, note?: string) => prpc<PhaseBudget>("pc_phase_budget_upsert", { p_project: projectId, p_phase: phase, p_allocated: allocated, p_note: note ?? null });
export const pcListRevenue = (projectId: string) => pget<RevenueRow[]>(`project_revenue_schedule?project_id=eq.${enc(projectId)}&is_deleted=eq.false&select=*&order=due_date.asc.nullslast`);
export const pcRevenueUpsert = (projectId: string, data: Record<string, unknown>) => prpc<RevenueRow>("pc_revenue_upsert", { p_project: projectId, p_data: data });
export const pcListFinAlerts = (projectId: string) => pget<FinAlert[]>(`project_financial_alerts?project_id=eq.${enc(projectId)}&resolved_at=is.null&select=*&order=level.desc`);
export const pcFinAlertsRecompute = (projectId: string) => prpc<number>("pc_finance_alerts_recompute", { p_project: projectId });

// ─── Batch 5: الإغلاق المالي والتقارير (finance فقط) ───
export interface ClosureItem { key: string; ar: string; ok: boolean; critical: boolean; count?: number; amount?: number }
export interface ClosureChecklist { items: ClosureItem[]; critical_count: number; can_close: boolean; closed: boolean }
export interface FinanceReport {
  summary: FinanceSummary; checklist: ClosureChecklist;
  by_category: { category: string; count: number; cost: number | null; committed: number | null }[];
  by_supplier: { supplier: string; count: number; cost: number }[];
  by_phase: { phase: string; allocated: number; spent: number }[];
  revenue: { name: string; due_date: string | null; amount_incl_vat: number; collected: number; outstanding: number; status: string; overdue: boolean }[];
  cashflow_monthly: { month: string; paid_out: number; collected_in: number }[];
  closed_snapshot: Record<string, unknown> | null; generated_at: string;
}
export const pcFinanceClosureChecklist = (projectId: string) => prpc<ClosureChecklist>("pc_finance_closure_checklist", { p_project: projectId });
export const pcFinanceClose = (projectId: string, override = false, reason?: string) =>
  prpc<{ ok: boolean; closed_at: string }>("pc_finance_close", { p_project: projectId, p_override: override, p_reason: reason ?? null });
export const pcFinanceReopen = (projectId: string, reason: string) => prpc<{ ok: boolean }>("pc_finance_reopen", { p_project: projectId, p_reason: reason });
export const pcFinanceReport = (projectId: string) => prpc<FinanceReport>("pc_finance_report", { p_project: projectId });

// ─── Batch 1: الخطة الزمنية الموحّدة (Schedule + Calendar + Gantt من مصدر واحد) ───
export type ScheduleEventType =
  | "project_phase" | "milestone" | "task" | "shoot_session" | "meeting" | "internal_review" | "client_review"
  | "deliverable_due" | "final_delivery" | "equipment_preparation" | "equipment_return" | "travel" | "approval" | "custom_event";
export type ScheduleStatus = "planned" | "confirmed" | "in_progress" | "done" | "cancelled";
export const SCHED_TYPE_LABELS: Record<ScheduleEventType, { ar: string; en: string }> = {
  project_phase: { ar: "مرحلة مشروع", en: "Phase" }, milestone: { ar: "معلَم", en: "Milestone" },
  task: { ar: "مهمة", en: "Task" }, shoot_session: { ar: "جلسة تصوير", en: "Shoot" },
  meeting: { ar: "اجتماع", en: "Meeting" }, internal_review: { ar: "مراجعة داخلية", en: "Internal Review" },
  client_review: { ar: "مراجعة العميل", en: "Client Review" }, deliverable_due: { ar: "استحقاق مخرَج", en: "Deliverable Due" },
  final_delivery: { ar: "تسليم نهائي", en: "Final Delivery" }, equipment_preparation: { ar: "تجهيز معدات", en: "Equip. Prep" },
  equipment_return: { ar: "إرجاع معدات", en: "Equip. Return" }, travel: { ar: "انتقال/سفر", en: "Travel" },
  approval: { ar: "اعتماد", en: "Approval" }, custom_event: { ar: "حدث مخصّص", en: "Custom" },
};
export const SCHED_STATUS_LABELS: Record<ScheduleStatus, { ar: string; en: string }> = {
  planned: { ar: "مخطّط", en: "Planned" }, confirmed: { ar: "مؤكّد", en: "Confirmed" },
  in_progress: { ar: "جارٍ", en: "In Progress" }, done: { ar: "منجز", en: "Done" }, cancelled: { ar: "ملغى", en: "Cancelled" },
};
export interface ScheduleItem {
  id: string; source: "schedule" | "task" | "meeting" | "shoot" | "project";
  event_type: ScheduleEventType; title: string; description?: string | null;
  start_at: string; end_at: string | null; all_day: boolean; status: string; priority: string; progress: number;
  assignee_id: string | null; participants?: string[]; is_milestone: boolean; client_visible: boolean;
  phase?: string | null; location_id?: string | null; shoot_session_id?: string | null; task_id?: string | null;
  meeting_id?: string | null; deliverable_id?: string | null; reminder_at?: string | null; notes?: string | null;
  cancel_reason?: string | null; deleted: boolean; delete_reason?: string | null; updated_at: string; location_text?: string | null;
}
export const pcScheduleFeed = (projectId: string, opts?: { from?: string; to?: string; types?: string[]; assignee?: string; deleted?: boolean }) =>
  prpc<{ items: ScheduleItem[] }>("project_core_schedule", {
    p_project: projectId, p_from: opts?.from ?? null, p_to: opts?.to ?? null,
    p_types: opts?.types ?? null, p_assignee: opts?.assignee ?? null, p_deleted: opts?.deleted ?? false,
  });
export const pcScheduleUpsert = (projectId: string, data: Record<string, unknown>) =>
  prpc<{ id: string; updated_at: string }>("pc_schedule_upsert", { p_project: projectId, p_data: data });
// قراءة عنصر خطة واحد كاملًا (لفتح المحرّر من Gantt دون فقدان الحقول غير المعروضة).
export const pcGetScheduleItem = async (id: string): Promise<Result<ScheduleItem | null>> => {
  const r = await pget<(Record<string, unknown> & { assigned_to: string | null; is_deleted: boolean })[]>(
    `project_schedule_items?id=eq.${enc(id)}&select=*`);
  if (!r.ok) return r;
  const row = r.data[0];
  if (!row) return { ok: true, data: null };
  return { ok: true, data: { ...row, source: "schedule", assignee_id: row.assigned_to, deleted: row.is_deleted } as unknown as ScheduleItem };
};
export const pcScheduleSetStatus = (itemId: string, status: ScheduleStatus, reason?: string) =>
  prpc<{ id: string }>("pc_schedule_set_status", { p_item: itemId, p_status: status, p_reason: reason ?? null });
export const pcScheduleDelete = (itemId: string, reason: string) =>
  prpc<boolean>("pc_schedule_delete", { p_item: itemId, p_reason: reason });
export const pcScheduleRestore = (itemId: string) => prpc<{ id: string }>("pc_schedule_restore", { p_item: itemId });
export const pcScheduleDepSet = (itemId: string, dependsOn: string, on = true) =>
  prpc<boolean>("pc_schedule_dependency_set", { p_item: itemId, p_depends_on: dependsOn, p_on: on });
export const pcListScheduleDeps = (projectId: string) =>
  pget<{ item_id: string; depends_on_item_id: string }[]>(
    `project_schedule_dependencies?select=item_id,depends_on_item_id,project_schedule_items!project_schedule_dependencies_item_id_fkey!inner(project_id)&project_schedule_items.project_id=eq.${enc(projectId)}`);
// ─── Batch 2: الحذف الناعم الشامل + الاستعادة + مركز المحذوفات ───
export type TrashEntity = "task" | "comment" | "meeting" | "risk" | "location" | "cost" | "shoot"
  | "deliverable" | "call_sheet" | "revenue" | "expense" | "schedule" | "member";
export const ENTITY_LABELS: Record<TrashEntity, { ar: string; en: string }> = {
  task: { ar: "مهمة", en: "Task" }, comment: { ar: "تعليق", en: "Comment" }, meeting: { ar: "اجتماع", en: "Meeting" },
  risk: { ar: "خطر", en: "Risk" }, location: { ar: "موقع", en: "Location" }, cost: { ar: "تكلفة", en: "Cost" },
  shoot: { ar: "جلسة تصوير", en: "Shoot" }, deliverable: { ar: "مخرَج", en: "Deliverable" },
  call_sheet: { ar: "Call Sheet", en: "Call Sheet" }, revenue: { ar: "دفعة إيراد", en: "Revenue" },
  expense: { ar: "مصروف", en: "Expense" }, schedule: { ar: "عنصر خطة", en: "Schedule" }, member: { ar: "عضو فريق", en: "Member" },
};
export interface TrashRow {
  entity: TrashEntity; id: string; title: string | null; project_id: string; project_name: string | null;
  deleted_at: string | null; deleted_by: string | null; deleted_by_name: string | null; reason: string | null;
}
export const pcEntityDelete = (entity: TrashEntity, id: string, reason: string) =>
  prpc<{ ok: boolean; title?: string }>("pc_entity_delete", { p_type: entity, p_id: id, p_reason: reason });
export const pcEntityRestore = (entity: TrashEntity, id: string) =>
  prpc<{ ok: boolean; title?: string }>("pc_entity_restore", { p_type: entity, p_id: id });
export const pcTrashList = (projectId?: string) =>
  prpc<{ items: TrashRow[] }>("project_core_trash", { p_project: projectId ?? null });

export interface GanttBar {
  id: string; raw_id: string; source: "schedule" | "task" | "shoot"; kind: string; title: string;
  start: string; end: string; progress: number; status: string; assignee_id: string | null;
  milestone: boolean; phase: string | null; updated_at: string;
}
export interface GanttData { bars: GanttBar[]; deps: { from: string; to: string }[]; project: { due_date: string | null; delivery_date: string | null; start_date: string | null } | null }
export const pcGanttData = (projectId: string) => prpc<GanttData>("project_core_gantt", { p_project: projectId });

// ─── Batch 4: جسر معدات جلسات التصوير ↔ نظام العهدة القائم ───
export interface EquipAsset {
  id: string; code: string; name: string; serial: string | null; type: "serialized" | "quantity_based";
  unit: string; condition: string; availability: string; total: number; available: number; reserved_now: number;
}
export interface EquipAvailability {
  total: number; available_now: number; reserved_window: number; free_window: number;
  condition: string; availability: string; blocked: boolean;
}
export interface EquipReservation {
  id: string; asset_id: string; code: string; name: string; qty: number;
  from: string | null; to: string | null; status: string; employee_id: string | null; employee_name: string | null;
  note: string | null; approved_at: string | null; assignment_id: string | null;
  assignment_no: string | null; assignment_status: string | null;
}
export const pcEquipSearch = (q: string) => prpc<{ items: EquipAsset[] }>("pc_equipment_search", { p_q: q });
export const pcEquipAvailability = (assetId: string, from: string, to: string) =>
  prpc<EquipAvailability>("pc_equipment_availability", { p_asset: assetId, p_from: from, p_to: to });
export const pcShootEquipList = (shootId: string) => prpc<{ items: EquipReservation[] }>("pc_shoot_equipment_list", { p_shoot: shootId });
export const pcShootReserve = (shootId: string, assetId: string, qty: number, from?: string, to?: string, employee?: string, note?: string) =>
  prpc<{ ok: boolean; id: string }>("pc_shoot_reserve_equipment", {
    p_shoot: shootId, p_asset: assetId, p_qty: qty, p_from: from ?? null, p_to: to ?? null,
    p_employee: employee ?? null, p_note: note ?? null,
  });
export const pcReservationCancel = (id: string, reason: string) => prpc<boolean>("pc_reservation_cancel", { p_id: id, p_reason: reason });
export const pcReservationApprove = (id: string) => prpc<boolean>("pc_reservation_approve", { p_id: id });
export const pcReservationToCustody = (id: string) =>
  prpc<{ ok: boolean; id: string; assignment_number: string }>("pc_reservation_to_custody", { p_id: id });
export const CUSTODY_ASSIGN_LABELS: Record<string, { ar: string; en: string }> = {
  draft: { ar: "مسودّة", en: "Draft" }, pending_employee_confirmation: { ar: "بانتظار تأكيد الموظف", en: "Pending confirm" },
  active: { ar: "عهدة نشطة", en: "Active" }, return_requested: { ar: "طلب إرجاع", en: "Return requested" },
  under_inspection: { ar: "قيد الفحص", en: "Inspection" }, partially_returned: { ar: "إرجاع جزئي", en: "Partial return" },
  returned: { ar: "مُرجَعة", en: "Returned" }, rejected: { ar: "مرفوضة", en: "Rejected" },
  disputed: { ar: "نزاع", en: "Disputed" }, cancelled: { ar: "ملغاة", en: "Cancelled" },
};
export const RESV_STATUS_LABELS: Record<string, { ar: string; en: string }> = {
  active: { ar: "حجز نشط", en: "Active" }, fulfilled: { ar: "صُرفت عهدة", en: "Fulfilled" },
  cancelled: { ar: "ملغى", en: "Cancelled" }, expired: { ar: "منتهٍ", en: "Expired" },
};

// تنسيق تاريخ/وقت موحّد بأرقام لاتينية وترتيب DD/MM/YYYY (يتجنّب لبس 2026/16/07). دائمًا dir=ltr.
export const fmtD = (s: string | null | undefined) => s ? new Date(s).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";
export const fmtDT = (s: string | null | undefined) => s ? new Date(s).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

export function pcErr(e: string): string {
  if (/could not find|schema cache|PGRST\d|does not exist|function .* does not/i.test(e)) return "منصة المشاريع غير مطبّقة في قاعدة البيانات — شغّل project_core_FINAL_RUNME.sql.";
  if (/not authorized|permission denied|row-level security/i.test(e)) return "لا تملك صلاحية هذا الإجراء.";
  if (/already_decided/.test(e)) return "تم البتّ في هذا الاعتماد مسبقًا.";
  if (/title_required/.test(e)) return "العنوان إلزامي.";
  if (/body_required/.test(e)) return "النص إلزامي.";
  if (/bad_stage/.test(e)) return "مرحلة غير صالحة.";
  if (/bad_minutes/.test(e)) return "مدة غير صحيحة.";
  if (/reason_required/.test(e)) return "السبب إلزامي للرجوع للخلف أو الإغلاق.";
  if (/no_stage_skip/.test(e)) return "لا يمكن تجاوز أكثر من مرحلة — انتقل خطوة بخطوة (أو المالك فقط).";
  if (/need_manager/.test(e)) return "يجب تعيين مدير مشروع قبل هذه المرحلة.";
  if (/need_due_date/.test(e)) return "يجب تحديد موعد نهائي قبل هذه المرحلة.";
  if (/name_required/.test(e)) return "اسم المشروع إلزامي.";
  if (/client_required|bad_client/.test(e)) return "اختر عميلًا صحيحًا للمشروع.";
  if (/stale_update/.test(e)) return "عُدّلت المهمة من مستخدم آخر — أُعيد التحميل، حاول مجددًا.";
  if (/transition_not_allowed/.test(e)) return "انتقال حالة غير مسموح وفق سير العمل.";
  if (/subtasks_incomplete/.test(e)) return "لا يمكن الإكمال: توجد مهام فرعية غير مكتملة (يلزم صلاحية تجاوز).";
  if (/dependencies_incomplete/.test(e)) return "لا يمكن البدء/الإكمال: توجد اعتماديات غير مكتملة.";
  if (/block_reason_required/.test(e)) return "سبب التعطيل إلزامي.";
  if (/dependency_cycle|cycle_detected/.test(e)) return "لا يمكن إنشاء حلقة اعتماديات/مهام فرعية.";
  if (/cross_project_dependency/.test(e)) return "لا يمكن الربط بين مشروعين مختلفين.";
  if (/self_dependency|self_parent/.test(e)) return "لا يمكن ربط المهمة بنفسها.";
  if (/not_client_visible/.test(e)) return "المهمة ليست مرئية للعميل.";
  if (/use_review_action/.test(e)) return "استخدم أزرار المراجعة لاعتماد المهمة.";
  if (/bad_state|bad_action/.test(e)) return "الإجراء غير متاح لحالة المهمة الحالية.";
  if (/bad_parent|bad_role|bad_dep_type/.test(e)) return "قيمة غير صالحة.";
  if (/active_custody/.test(e)) return "لا يمكن الحذف: توجد عهدة/معدات نشطة مرتبطة بالمشروع.";
  if (/already_applied/.test(e)) return "هذا القالب مطبَّق على المشروع مسبقًا.";
  if (/template_not_found/.test(e)) return "القالب غير موجود أو غير مفعّل.";
  if (/duplicate_version|duplicate key|violates unique|already exists/.test(e)) return "تعارض في الترقيم — أعد المحاولة.";
  if (/already_created/.test(e)) return "أُنشئت مهمة لهذا البند مسبقًا.";
  if (/bad_progress/.test(e)) return "نسبة التقدّم يجب أن تكون بين 0 و100.";
  if (/already_sent/.test(e)) return "أُرسلت هذه النسخة مسبقًا — أنشئ نسخة جديدة للتعديل.";
  if (/not_draft/.test(e)) return "لا يمكن تعديل نسخة مُرسَلة — أنشئ نسخة جديدة.";
  if (/incomplete_call_sheet/.test(e)) return "أكمل تاريخ التصوير والموقع قبل الإرسال.";
  if (/not_finance_user/.test(e)) return "محاسب المشروع يجب أن يكون من قسم المالية.";
  if (/approval_limit/.test(e)) return "المبلغ يتجاوز حدّ اعتمادك — يحتاج صلاحية أعلى.";
  if (/over_budget/.test(e)) return "الاعتماد يتجاوز ميزانية المشروع — يحتاج تجاوزًا من المالك.";
  if (/override_required/.test(e)) return "تجاوز الميزانية يتطلّب سببًا وتأكيدًا من المالك.";
  if (/cannot_void_paid/.test(e)) return "لا يمكن إلغاء مصروف مدفوع — استخدم استردادًا.";
  if (/cannot_delete_approved/.test(e)) return "لا يمكن حذف مصروف معتمد/مدفوع (المالك فقط).";
  if (/bad_state/.test(e)) return "حالة المصروف لا تسمح بهذا الإجراء.";
  if (/phase_required/.test(e)) return "اسم المرحلة إلزامي.";
  if (/not_found/.test(e)) return "العنصر غير موجود.";
  if (/cross_project_dependency|self_dependency/.test(e)) return "اعتمادية غير صالحة.";
  if (/circular_dependency/.test(e)) return "لا يمكن إنشاء اعتمادية دائرية.";
  if (/start_required/.test(e)) return "تاريخ البداية إلزامي.";
  if (/bad_dates/.test(e)) return "تاريخ النهاية قبل البداية.";
  if (/bad_timezone/.test(e)) return "منطقة زمنية غير معروفة.";
  if (/must_cancel_first/.test(e)) return "الجلسة بدأت أو اكتملت — ألغِها رسميًا أولًا ولا تُحذف.";
  if (/archive_instead/.test(e)) return "مخرَج معتمد/مُسلَّم لا يُحذف — استخدم الأرشفة.";
  if (/sent_locked/.test(e)) return "نسخة مُرسلة سجلّ تشغيلي — لا تُحذف.";
  if (/cannot_delete_collected/.test(e)) return "دفعة حُصِّل منها مبلغ — قيد مالي لا يُحذف.";
  if (/bad_entity_type/.test(e)) return "نوع عنصر غير مدعوم.";
  if (/recipients_required/.test(e)) return "اختر مستلمًا موظفًا واحدًا على الأقل.";
  if (/custody_system_missing/.test(e)) return "نظام العهدة والمخزون غير مطبَّق في قاعدة البيانات.";
  if (/over_reserved/.test(e)) return "الكمية المطلوبة تتجاوز المتاح في هذه الفترة (حجوزات متداخلة).";
  if (/duplicate_reservation/.test(e)) return "يوجد حجز نشط لهذا الأصل على نفس الجلسة.";
  if (/asset_unavailable/.test(e)) return "الأصل غير متاح (تالف/مفقود/في الصيانة).";
  if (/insufficient_stock/.test(e)) return "الكمية غير متوفرة في المخزون.";
  if (/reserved_shortage/.test(e)) return "الصرف يكسر حجوزات نشطة لموظفين آخرين.";
  if (/asset_already_assigned/.test(e)) return "الأصل مُسلَّم بالفعل في عهدة نشطة.";
  if (/employee_required/.test(e)) return "حدّد الموظف المستلم أولًا.";
  if (/equipment_out/.test(e)) return "توجد معدات غير مرجعة مرتبطة بالجلسة — أكمل دورة الإرجاع أولًا.";
  if (/bad_window/.test(e)) return "حدّد فترة حجز صحيحة (النهاية بعد البداية).";
  if (/bad_quantity/.test(e)) return "كمية غير صحيحة.";
  if (/custody_already_issued/.test(e)) return "صُرفت عهدة لهذا الحجز مسبقًا.";
  if (/project_closed/.test(e)) return "حسابات المشروع مُغلقة — أي تعديل يتطلب استردادًا/إلغاءً أو إعادة فتح من المالك.";
  if (/closure_blocked/.test(e)) return "لا يمكن الإغلاق مع بنود حرجة مفتوحة — عالجها أو استخدم تجاوز المالك بسبب.";
  if (/already_closed/.test(e)) return "الحسابات مُغلقة بالفعل.";
  if (/not_closed/.test(e)) return "الحسابات ليست مُغلقة.";
  if (/budget_managed_by_finance/.test(e)) return "الميزانية تُدار من تبويب «حسابات المشروع» — عدّلها هناك.";
  if (/old_version/.test(e)) return "توجد نسخة أحدث — أكّد اعتماد النسخة الأقدم صراحة.";
  if (/no_approved_version/.test(e)) return "لا تسليم نهائيًا بلا نسخة معتمدة فعّالة.";
  if (/already_final/.test(e)) return "المخرَج مُسلَّم نهائيًا — لا تعديل ولا نسخ جديدة.";
  if (/bad_link/.test(e)) return "العنصر المرتبط لا ينتمي لهذا المشروع.";
  if (/item_deleted/.test(e)) return "العنصر محذوف — استعده أولًا.";
  return "تعذّر تنفيذ الإجراء. حاول مرة أخرى.";
}

export const SEVERITY_LABELS: Record<string, { ar: string; en: string }> = {
  low: { ar: "منخفض", en: "Low" }, medium: { ar: "متوسط", en: "Medium" }, high: { ar: "عالٍ", en: "High" }, critical: { ar: "حرج", en: "Critical" },
};
export const RISK_STATUS_LABELS: Record<string, { ar: string; en: string }> = {
  open: { ar: "مفتوح", en: "Open" }, mitigating: { ar: "قيد المعالجة", en: "Mitigating" }, closed: { ar: "مغلق", en: "Closed" }, accepted: { ar: "مقبول", en: "Accepted" },
};
export const SHOOT_STATUS_LABELS: Record<string, { ar: string; en: string }> = {
  planned: { ar: "مخطّطة", en: "Planned" }, confirmed: { ar: "مؤكّدة", en: "Confirmed" }, in_progress: { ar: "جارية", en: "In Progress" }, completed: { ar: "مكتملة", en: "Completed" }, cancelled: { ar: "ملغاة", en: "Cancelled" },
};
export const DLV_LABEL: Record<string, { ar: string; en: string }> = {
  draft: { ar: "مسودة", en: "Draft" }, internal_review: { ar: "مراجعة داخلية", en: "Internal Review" },
  client_review: { ar: "مراجعة العميل", en: "Client Review" }, revision_requested: { ar: "طلب تعديل", en: "Revision" },
  approved: { ar: "معتمد", en: "Approved" }, final_delivered: { ar: "تسليم نهائي", en: "Final Delivered" }, archived: { ar: "مؤرشف", en: "Archived" },
};
