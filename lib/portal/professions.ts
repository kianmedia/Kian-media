// ════════════════════════════════════════════════════════════════════════
// §5 Profession model + scoped employee dashboard — client wrappers.
// Every write goes through a SECURITY DEFINER RPC that re-checks authority
// server-side; these wrappers are convenience only, never the security boundary.
// ════════════════════════════════════════════════════════════════════════
import { pget, prpc, type Result } from "./client";

export interface Profession {
  id: string;
  key: string;
  name_ar: string;
  name_en: string;
  description: string | null;
  is_active: boolean;
  sort_order: number;
  perm_view_all_tasks: boolean;
  perm_manage_preproduction: boolean;
  perm_manage_shoots: boolean;
  perm_manage_custody: boolean;
}
export interface EmployeeProfessions {
  id: string;
  full_name: string | null;
  staff_role: string | null;
  account_status: string | null;
  profession_ids: string[];
  /** Set once employee_professions_primary_PATCH.sql is applied; undefined before. */
  primary_profession_id?: string | null;
}

export const PERMISSION_KEYS = [
  { key: "perm_view_all_tasks", ar: "رؤية كل المهام", en: "View all tasks" },
  { key: "perm_manage_preproduction", ar: "إدارة ما قبل الإنتاج", en: "Manage pre-production" },
  { key: "perm_manage_shoots", ar: "إدارة جلسات التصوير", en: "Manage shoots" },
  { key: "perm_manage_custody", ar: "إدارة العهد", en: "Manage custody" },
] as const;

// ── catalog (readable by any authenticated user via RLS) ──
export const listProfessions = () =>
  pget<Profession[]>(
    `professions?select=id,key,name_ar,name_en,description,is_active,sort_order,perm_view_all_tasks,perm_manage_preproduction,perm_manage_shoots,perm_manage_custody&order=sort_order.asc,name_ar.asc`,
  );

export const upsertProfession = (data: Partial<Profession>) =>
  prpc<string>("admin_upsert_profession", { p_data: data });

export const listEmployeesProfessions = () =>
  prpc<EmployeeProfessions[]>("admin_list_employees_professions", {});

export const setEmployeeProfessions = (userId: string, professionIds: string[]) =>
  prpc<null>("admin_set_employee_professions", { p_user: userId, p_profession_ids: professionIds });

export const updateTaskStatus = (taskId: string, status: string, progress?: number) =>
  prpc<null>("emp_update_task_status", { p_task: taskId, p_status: status, p_progress: progress ?? null });

// ── scoped employee dashboard ──
export interface DashTask {
  id: string; title: string; project_id: string; project_name: string;
  status: string; priority?: string; due_date?: string | null; profession?: string | null;
}
export interface DashShoot {
  id: string; title: string; project_id: string; project_name: string;
  session_date: string | null; call_time: string | null; location: string | null; status: string;
}
export interface DashFile { id: string; task_id: string; task_title: string; file_name: string | null; file_url: string; created_at: string }
export interface DashComment { id: string; task_id: string; task_title: string; project_id: string; body: string; author_name: string | null; created_at: string }
export interface DashCustody { id: string; assignment_number: string; status: string; expected_return_at: string | null }
export interface EmployeeDashboard {
  my_tasks: DashTask[];
  profession_tasks: DashTask[];
  due_today: DashTask[];
  overdue: DashTask[];
  upcoming_shoots: DashShoot[];
  files_i_need: DashFile[];
  comments_requiring_action: DashComment[];
  custody_actions: DashCustody[];
}
export const getEmployeeDashboard = (): Promise<Result<EmployeeDashboard>> =>
  prpc<EmployeeDashboard>("employee_dashboard", {});
