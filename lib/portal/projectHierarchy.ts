// ════════════════════════════════════════════════════════════════════════════
// lib/portal/projectHierarchy.ts — Batch 6A: هرمية المشاريع (رئيسي ⇄ فرعي).
// أغلفة RPC + أنواع. القيم في قاعدة البيانات: standalone|master|subproject،
// والواجهة تعرضها عربيًّا: مستقل/رئيسي/فرعي (لا قيم جديدة في DB).
// ════════════════════════════════════════════════════════════════════════════
import { prpc } from "./client";

export type ProjectScope = "standalone" | "master" | "subproject";

export interface SiblingRef { project_id: string; project_name: string | null }
export interface HierarchyContext {
  project_id: string; project_scope: ProjectScope;
  parent_project_id: string | null; parent_name: string | null; parent_readable: boolean;
  hierarchy_enabled: boolean; generated_at: string;
  // 6B: تنقّل الإخوة داخل الأب حسب sequence_number
  sequence_number?: number | null; sibling_count?: number; sibling_index?: number | null;
  prev_sibling?: SiblingRef | null; next_sibling?: SiblingRef | null;
}
export interface TreeRow {
  project_id: string; project_name: string | null; client_id: string | null; client_name: string | null;
  project_scope: ProjectScope; parent_project_id: string | null; sequence_number: number | null;
  core_stage: string | null; health: string | null; priority: string | null; due_date: string | null;
  progress_pct: number; manager_name: string | null; open_tasks: number;
  children_total: number; children_active: number; children_delayed: number; children_critical: number;
}
export interface ParentDashboard {
  project_id: string; rollup: HierarchyRollup;
  own_health: string | null; children_aggregate_health: string | null;
  earliest_child_due: string | null; latest_child_due: string | null;
  children_critical_risks: number; children_critical_issues: number;
  children_open_bookings: number; children_overdue_approvals: number;
  children_closure: { project_id: string; name: string | null; closure_status: string }[];
}
export interface HierarchyRollup {
  project_id: string; project_scope: ProjectScope;
  own_progress: number | null;
  children_aggregate_progress: number | null;   // null = لا فروع مرئية ⇒ «غير متاح» لا 0
  total_children: number; active_children: number; delayed_children: number;
  critical_children: number; closed_children: number; generated_at: string;
}

export interface MasterLite { id: string; project_name: string; client_id: string | null }
export const projectHierarchyMastersList = (clientId?: string | null) =>
  prpc<{ masters: MasterLite[] }>("project_hierarchy_masters_list", { p_client: clientId ?? null });
export const projectHierarchyContext = (projectId: string) => prpc<HierarchyContext>("project_hierarchy_context", { p_project: projectId });
// 6B — شجرة مصفّاة من الخادم + إعادة ترتيب ذرّية + لوحة الأب الموسّعة
export const projectHierarchyTree = (filters: Record<string, unknown> = {}) =>
  prpc<{ rows: TreeRow[]; limit: number; offset: number; returned: number; has_more: boolean }>("project_hierarchy_tree", { p_filters: filters });
export const projectHierarchyReorderSubprojects = (parentId: string, orderedIds: string[]) =>
  prpc<{ ok: boolean; parent_project_id: string; count: number }>("project_hierarchy_reorder_subprojects", { p_parent: parentId, p_ordered_ids: orderedIds });
export const projectHierarchyParentDashboard = (projectId: string) =>
  prpc<ParentDashboard>("project_hierarchy_parent_dashboard", { p_project: projectId });
export const projectHierarchyRollup = (projectId: string) => prpc<HierarchyRollup>("project_hierarchy_rollup", { p_project: projectId });
export const projectHierarchyGetFlags = () => prpc<{ hierarchy_enabled: boolean; updated_at: string }>("project_hierarchy_get_flags", {});
// يعيد boolean (توقيع Batch 1 — لا يجوز تغيير نوع الإرجاع عبر CREATE OR REPLACE).
export const projectHierarchyUpdateFlags = (enabled: boolean) => prpc<boolean>("project_hierarchy_admin_update_flags", { p_data: { hierarchy_enabled: enabled } });
export const projectHierarchyMoveSubproject = (projectId: string, newParentId: string, reason: string) =>
  prpc<{ ok: boolean; project_id: string; parent_project_id: string }>("project_hierarchy_move_subproject", { p_project: projectId, p_new_parent: newParentId, p_reason: reason });
export const projectHierarchyDetachSubproject = (projectId: string, reason: string) =>
  prpc<{ ok: boolean; project_id: string; project_scope: ProjectScope }>("project_hierarchy_detach_subproject", { p_project: projectId, p_reason: reason });
// ترقية/خفض — بدونهما لا يمكن تحويل مشروع قائم إلى «رئيسي» ولا بناء هرمية على بيانات حيّة.
export const projectHierarchyPromoteToMaster = (projectId: string, reason: string) =>
  prpc<{ ok: boolean; project_id: string; project_scope: ProjectScope; noop?: boolean }>("project_hierarchy_promote_to_master", { p_project: projectId, p_reason: reason });
export const projectHierarchyDemoteToStandalone = (projectId: string, reason: string) =>
  prpc<{ ok: boolean; project_id: string; project_scope: ProjectScope; noop?: boolean }>("project_hierarchy_demote_to_standalone", { p_project: projectId, p_reason: reason });

// ─── تسميات الواجهة (عربية) فوق قيم DB ───
export const SCOPE_LABELS: Record<ProjectScope, { ar: string; en: string }> = {
  standalone: { ar: "مشروع مستقل", en: "Standalone" },
  master: { ar: "مشروع رئيسي", en: "Master" },
  subproject: { ar: "مشروع فرعي", en: "Subproject" },
};
export const SCOPE_COLOR: Record<ProjectScope, string> = { standalone: "#78716c", master: "#7c3aed", subproject: "#0891b2" };

export function hierErr(e: string): string {
  if (/hierarchy_disabled/.test(e)) return "الهرمية غير مفعّلة — فعّلها من الإعدادات.";
  if (/parent_required/.test(e)) return "اختر المشروع الرئيسي.";
  if (/parent_must_be_master/.test(e)) return "المشروع الأب يجب أن يكون «مشروعًا رئيسيًّا».";
  if (/parent_is_deleted/.test(e)) return "المشروع الرئيسي محذوف.";
  if (/parent_not_found/.test(e)) return "المشروع الرئيسي غير موجود.";
  if (/subproject_client_must_match_master/.test(e)) return "عميل المشروع الفرعي يجب أن يطابق عميل المشروع الرئيسي.";
  if (/circular_hierarchy/.test(e)) return "لا يمكن إنشاء دورة هرمية.";
  if (/hierarchy_too_deep/.test(e)) return "عمق الهرمية تجاوز الحد.";
  if (/master_has_live_subprojects/.test(e)) return "لا يمكن حذف/أرشفة مشروع رئيسي له مشاريع فرعية حيّة.";
  if (/master_with_children_immutable/.test(e)) return "لا يمكن تغيير نوع/عميل مشروع رئيسي له فروع حيّة.";
  if (/not_a_subproject/.test(e)) return "هذا ليس مشروعًا فرعيًّا.";
  if (/only_standalone_can_be_promoted/.test(e)) return "يمكن ترقية المشاريع المستقلة فقط.";
  if (/only_master_can_be_demoted/.test(e)) return "يمكن خفض المشاريع الرئيسية فقط.";
  if (/project_is_deleted/.test(e)) return "المشروع محذوف/مؤرشف — استعِده أولًا.";
  if (/not authorized: source_parent/.test(e)) return "لا تملك صلاحية على المشروع الرئيسي الحالي.";
  if (/parent_not_allowed_for_scope/.test(e)) return "المشروع المستقل/الرئيسي لا يقبل مشروعًا أبًا.";
  if (/reason_required/.test(e)) return "السبب إلزامي.";
  // 8A أضاف فهرسًا فريدًا على (parent_project_id, unit_number): النقل/الاستعادة قد
  // يصطدمان برقم وحدة مستخدم عند الأب الجديد فيرفعان 23505 خامًا بلا هذه الترجمة.
  if (/ux_projects_parent_unit_number|duplicate_unit_number/.test(e)) return "رقم الوحدة مستخدم عند المشروع الرئيسي الوجهة — غيّر رقم الوحدة قبل النقل.";
  if (/ux_projects_parent_seq/.test(e)) return "تعارض في ترتيب الفروع — أعد المحاولة.";
  if (/order_set_partial_visibility/.test(e)) return "لا يمكن إعادة الترتيب: توجد فروع لا تملك صلاحية رؤيتها.";
  if (/order_set_mismatch/.test(e)) return "قائمة الترتيب لا تطابق فروع هذا المشروع.";
  if (/duplicate_ids/.test(e)) return "تكرار في قائمة الترتيب.";
  if (/not_a_master/.test(e)) return "هذا ليس مشروعًا رئيسيًّا.";
  if (/empty_order/.test(e)) return "لا عناصر لإعادة ترتيبها.";
  if (/bad_scope/.test(e)) return "نوع المشروع غير صالح.";
  if (/not authorized/.test(e)) return "لا تملك صلاحية هذا الإجراء.";
  if (/does not exist|schema cache|PGRST/i.test(e)) return "هرمية المشاريع (6A) غير مطبّقة في قاعدة البيانات.";
  return "تعذّر تنفيذ الإجراء. حاول مرة أخرى.";
}
