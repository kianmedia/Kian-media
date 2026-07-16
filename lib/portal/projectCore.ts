// ════════════════════════════════════════════════════════════════════════════
// Project Core — طبقة العميل (typed) لمنصة إدارة وتشغيل المشاريع.
// كل الكتابات عبر SECURITY DEFINER RPCs؛ القراءات عبر PostgREST (RLS-scoped).
// يعتمد على docs/project_core_FINAL_RUNME.sql. لا supabase-js.
// ════════════════════════════════════════════════════════════════════════════
import { pget, prpc, ppost, ppatch, enc, currentUserId, type Result } from "@/lib/portal/client";

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
  crew: unknown[]; equipment: unknown[]; vehicles: unknown[]; shot_list: unknown[]; attendance: unknown[];
}
export interface Deliverable { id: string; project_id: string; title: string; type: string; status: string; version: number; preview_url: string | null; created_at: string }

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
  pget<Deliverable[]>(`deliverables?project_id=eq.${enc(projectId)}&is_deleted=eq.false&select=id,project_id,title,type,status,version,preview_url,created_at&order=created_at.desc`);

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
export interface DeliverableVersion { id: string; deliverable_id: string; version: number; preview_url: string | null; note: string | null; created_by: string | null; created_at: string }
export const pcListDeliverableVersions = (deliverableId: string) =>
  pget<DeliverableVersion[]>(`project_deliverable_versions?deliverable_id=eq.${enc(deliverableId)}&select=*&order=version.desc`);
export const pcDeliverableVersionAdd = (deliverableId: string, data: Record<string, unknown>) =>
  prpc<DeliverableVersion>("project_core_deliverable_version_add", { p_deliverable: deliverableId, p_data: data });

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

// تحديث حقول إصدار المخرَج (رؤية العميل / اعتماد / نهائي) — عبر RLS.
export const pcDeliverableVersionSet = (versionId: string, patch: Record<string, unknown>) =>
  ppatch<DeliverableVersion[]>(`project_deliverable_versions?id=eq.${enc(versionId)}`, patch);

// خريطة رسائل الأخطاء الشائعة → عربي.
// تنسيق تاريخ/وقت موحّد بأرقام لاتينية وترتيب DD/MM/YYYY (يتجنّب لبس 2026/16/07). دائمًا dir=ltr.
export const fmtD = (s: string | null | undefined) => s ? new Date(s).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";
export const fmtDT = (s: string | null | undefined) => s ? new Date(s).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

export function pcErr(e: string): string {
  if (/could not find|schema cache|PGRST\d|does not exist|function .* does not/i.test(e)) return "منصة المشاريع غير مطبّقة في قاعدة البيانات — شغّل project_core_FINAL_RUNME.sql.";
  if (/not authorized|permission denied/i.test(e)) return "لا تملك صلاحية هذا الإجراء.";
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
  if (/stale_update/.test(e)) return "عُدّل المشروع من مستخدم آخر — أعد التحميل ثم احفظ.";
  if (/active_custody/.test(e)) return "لا يمكن الحذف: توجد عهدة/معدات نشطة مرتبطة بالمشروع.";
  if (/already_applied/.test(e)) return "هذا القالب مطبَّق على المشروع مسبقًا.";
  if (/template_not_found/.test(e)) return "القالب غير موجود أو غير مفعّل.";
  if (/duplicate_version|duplicate key|violates unique|already exists/.test(e)) return "تعارض في الترقيم — أعد المحاولة.";
  if (/already_created/.test(e)) return "أُنشئت مهمة لهذا البند مسبقًا.";
  if (/bad_progress/.test(e)) return "نسبة التقدّم يجب أن تكون بين 0 و100.";
  if (/already_sent/.test(e)) return "أُرسلت هذه النسخة مسبقًا — أنشئ نسخة جديدة للتعديل.";
  if (/not_draft/.test(e)) return "لا يمكن تعديل نسخة مُرسَلة — أنشئ نسخة جديدة.";
  if (/incomplete_call_sheet/.test(e)) return "أكمل تاريخ التصوير والموقع قبل الإرسال.";
  if (/not_found/.test(e)) return "العنصر غير موجود.";
  if (/cross_project_dependency|self_dependency/.test(e)) return "اعتمادية غير صالحة.";
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
