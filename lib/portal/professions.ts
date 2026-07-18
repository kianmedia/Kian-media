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

export interface DeleteProfessionResult { deleted: boolean; requires_confirm?: boolean; hard?: boolean; archived?: boolean; employees?: number; tasks?: number }
export const deleteProfession = (id: string, confirm = false) =>
  prpc<DeleteProfessionResult>("admin_delete_profession", { p_id: id, p_confirm: confirm });

export interface EffectiveAccess {
  user_id: string; system_role: string | null; account_type: string | null;
  active_profession_ids: string[]; active_profession_keys: string[];
  capabilities: { view_all_tasks: boolean; manage_preproduction: boolean; manage_shoots: boolean; manage_custody: boolean };
  // Granular (permission catalog v2) — present once permission_catalog_RUNME.sql is applied:
  profession_permissions?: Record<string, string[]>;
  allows?: string[]; denies?: string[]; effective_permissions?: string[];
  custody: { can_manage: boolean; can_delete_asset: boolean } | null;
}
/** Server-side proof of effective access (UNION of all professions). Self, or any user for admin/manager. */
export const empEffectiveAccess = (userId?: string) =>
  prpc<EffectiveAccess>("emp_effective_access", userId ? { p_user: userId } : {});

// ── Granular permission catalog (v2) ──
export interface Permission { id: string; key: string; label_ar: string; label_en: string; category: string; sensitivity: "normal" | "sensitive" | "system_only"; enabled: boolean; sort_order: number }
export const listPermissions = () => prpc<Permission[]>("admin_list_permissions", {});
export const listProfessionPermissionKeys = (professionId: string) => prpc<string[]>("admin_list_profession_permission_keys", { p_profession: professionId });
export const setProfessionPermission = (professionId: string, key: string, granted: boolean) =>
  prpc<null>("admin_set_profession_permission", { p_profession: professionId, p_key: key, p_granted: granted });
export const bulkSetProfessionPermissions = (professionId: string, keys: string[], granted: boolean) =>
  prpc<null>("admin_bulk_set_profession_permissions", { p_profession: professionId, p_keys: keys, p_granted: granted });
export const copyProfessionPermissions = (from: string, to: string) =>
  prpc<null>("admin_copy_profession_permissions", { p_from: from, p_to: to });
export const applyProfessionTemplate = (professionId: string, template: string) =>
  prpc<null>("admin_apply_profession_template", { p_profession: professionId, p_template: template });
export const setEmployeeOverride = (userId: string, key: string, effect: "allow" | "deny" | null, reason?: string) =>
  prpc<null>("admin_set_employee_override", { p_user: userId, p_key: key, p_effect: effect, p_reason: reason ?? null });

export const PERMISSION_CATEGORIES: { key: string; ar: string; en: string }[] = [
  { key: "projects_tasks", ar: "المشاريع والمهام", en: "Projects & Tasks" },
  { key: "preproduction", ar: "ما قبل الإنتاج", en: "Pre-Production" },
  { key: "production", ar: "الإنتاج والتصوير", en: "Production & Shooting" },
  { key: "deliverables", ar: "المخرجات والمونتاج", en: "Deliverables & Editing" },
  { key: "custody", ar: "العهدة والأصول", en: "Custody & Assets" },
  { key: "clients", ar: "التواصل مع العميل", en: "Client Communication" },
  { key: "files", ar: "الملفات", en: "Files" },
  { key: "notifications", ar: "الإشعارات", en: "Notifications" },
  { key: "finance", ar: "المالية (حسّاسة)", en: "Finance (sensitive)" },
  { key: "system", ar: "صلاحيات النظام (غير قابلة للمنح)", en: "System-only (not grantable)" },
];
export const PROFESSION_TEMPLATES: { key: string; ar: string; en: string }[] = [
  { key: "photographer", ar: "مصوّر فوتوغرافي", en: "Photographer" },
  { key: "videographer", ar: "مصوّر فيديو", en: "Videographer" },
  { key: "editor", ar: "مونتير", en: "Editor" },
  { key: "motion_graphics", ar: "موشن جرافيكس", en: "Motion Graphics" },
  { key: "custody_manager", ar: "أمين عهدة", en: "Custody Manager" },
  { key: "project_manager", ar: "مدير مشروع", en: "Project Manager" },
  { key: "finance", ar: "مالية", en: "Finance" },
  { key: "logistics", ar: "لوجستيات", en: "Logistics" },
];

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
