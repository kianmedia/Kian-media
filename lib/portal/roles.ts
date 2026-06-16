// ════════════════════════════════════════════════════════════════════════
// Kian Portal — role/capability helper. Single source of truth for UI gating,
// mirroring the DB helpers (is_owner/can_manage_*/can_edit_project/...). The DB
// (RLS + SECURITY DEFINER RPCs) is the REAL enforcement; this only decides what
// the UI shows/enables. account_type='admin' = the protected owner emails.
//
// IMPORTANT: a user with staff_role = null behaves EXACTLY as before (client /
// lead / admin), so staff branches are dormant until the owner assigns a role.
// ════════════════════════════════════════════════════════════════════════
import type { Profile, StaffRole, ProjectMemberRole } from "@/lib/portal/types";

export type ViewRole = "admin" | "client" | "lead" | StaffRole;

export function viewRole(p: Pick<Profile, "account_type" | "staff_role">): ViewRole {
  if (p.account_type === "admin") return "admin";          // owner anchor (protected emails)
  if (p.staff_role) return p.staff_role;                   // staff tier
  return p.account_type as ViewRole;                       // client | lead
}

export interface Caps {
  view: ViewRole;
  isOwner: boolean;          // owner: account_type=admin OR super_admin
  isAdminArea: boolean;      // sees the admin dashboard/area (owner/super_admin/manager)
  canWriteAdmin: boolean;    // existing admin_* RPCs are is_admin() = account_type='admin' ONLY
  canManageStaff: boolean;   // admin_set_staff_role = is_owner (account_type=admin OR super_admin)
  canFinalDeliver: boolean;  // final_delivered: owner/admin/manager only — NEVER editor
  isEditor: boolean;
  isSupport: boolean;
  isSales: boolean;
  isHr: boolean;
  isReadonly: boolean;
  isStaff: boolean;          // any staff tier (not plain client/lead and not account_type=admin)
  isClientSide: boolean;     // plain client/lead
  // RLS-mirroring read helpers (which admin-style lists a viewer may READ):
  canSeeFinancials: boolean; // quotes/offers/pricing — owner/manager/sales (DB can_see_financials)
  canSupportComms: boolean;  // client messages — owner/manager/support (DB can_support)
  staffReadsAll: boolean;    // all projects/files — owner/manager/support/readonly
  canSeeInvoices: boolean;   // invoices/Zoho — owner/manager/finance (DB can_see_invoices, after addendum)
}

export function caps(p: Pick<Profile, "account_type" | "staff_role">): Caps {
  const view = viewRole(p);
  const isOwner = view === "admin" || view === "super_admin";
  const isAdminArea = isOwner || view === "manager";
  const isStaff = !["admin", "client", "lead"].includes(view);
  return {
    view,
    isOwner,
    isAdminArea,
    // The pre-existing admin RPCs (admin_set_account, admin_*_project_member,
    // admin_*_deliverable, etc.) are guarded by is_admin() = account_type='admin'.
    canWriteAdmin: p.account_type === "admin",
    canManageStaff: isOwner,                 // matches DB can_manage_staff()=is_owner()
    canFinalDeliver: isAdminArea,            // matches DB can_final_deliver()=owner/manager
    isEditor: view === "editor",
    isSupport: view === "support",
    isSales: view === "sales",
    isHr: view === "hr",
    isReadonly: view === "readonly",
    isStaff,
    isClientSide: view === "client" || view === "lead",
    canSeeFinancials: isOwner || view === "manager" || view === "sales",
    canSupportComms: isOwner || view === "manager" || view === "support",
    staffReadsAll: isOwner || ["manager", "support", "readonly"].includes(view),
    canSeeInvoices: isOwner || view === "manager" || view === "finance",
  };
}

/** Arabic/English label for a staff role (display — includes finance so an
 *  already-assigned finance user renders correctly). */
export const STAFF_ROLE_LABELS: Record<string, { ar: string; en: string }> = {
  super_admin: { ar: "مالك", en: "Super Admin" },
  manager:     { ar: "مدير", en: "Manager" },
  support:     { ar: "دعم العملاء", en: "Support" },
  editor:      { ar: "مونتير", en: "Editor" },
  sales:       { ar: "مبيعات", en: "Sales" },
  hr:          { ar: "الموارد البشرية", en: "HR" },
  readonly:    { ar: "مشاهدة فقط", en: "Read-only" },
  finance:     { ar: "المالية", en: "Finance" },
};

/**
 * Roles SELECTABLE in the Staff role dropdown right now. Must match what the
 * deployed DB accepts (profiles.staff_role CHECK + admin_set_staff_role). finance
 * is intentionally EXCLUDED until docs/staff_assignment_notifications_finance_ADDENDUM.sql
 * is run (the DB rejects it today); add "finance" here once that addendum is live.
 */
export const STAFF_ROLE_OPTIONS: StaffRole[] =
  ["super_admin", "manager", "support", "editor", "sales", "hr", "readonly"];

/**
 * Project-assignment roles (project_members.role) staff are assigned with.
 * MUST stay within the DB-allowed set (project_members.role CHECK +
 * admin_add_project_member allow-list): kian_admin/manager/editor/photographer/
 * viewer. NOTE: kian_support / kian_sales are NOT yet valid DB roles — to scope
 * support/sales staff to projects, first extend the CHECK + RPC allow-list, then
 * add them here. The array is typed to ProjectMemberRole so an invalid value
 * fails the build.
 */
export const PROJECT_STAFF_ROLES: { key: ProjectMemberRole; ar: string; en: string }[] = [
  { key: "kian_manager",      ar: "مدير المشروع",  en: "Manager" },
  { key: "kian_editor",       ar: "مونتير",        en: "Editor" },
  { key: "kian_photographer", ar: "مصوّر",         en: "Photographer" },
  { key: "kian_viewer",       ar: "مشاهدة",        en: "Viewer" },
];
