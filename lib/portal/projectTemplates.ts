// ════════════════════════════════════════════════════════════════════════════
// lib/portal/projectTemplates.ts — Batch 7A: قوالب المشاريع والإعداد السريع.
// يمتدّ فوق نظام القوالب القائم (project_templates + project_core_apply_template_v2
// + أغلفة pcListTemplates/pcApplyTemplateV2 في projectCore.ts) — لا يستبدله.
// الجديد هنا فقط: المكتبة، الإصدارات، حفظ كقالب على الخادم، والإنشاء من قالب.
// ════════════════════════════════════════════════════════════════════════════
import { prpc } from "./client";

export interface TemplateCounts { tasks: number; milestones: number; deliverables: number; risks: number; meetings?: number; shoots?: number }
export interface TemplateLibraryItem {
  id: string; name: string; description: string | null; category: string | null; template_key: string | null;
  service_type: string | null; default_duration_days: number | null;
  version: number; is_active: boolean; is_seed: boolean; counts: TemplateCounts;
}
export interface TemplateLibrary { templates: TemplateLibraryItem[]; can_manage: boolean; generated_at: string }
export interface TemplateVersion {
  id: string; version: number; name: string | null; note: string | null; created_at: string;
  counts: { tasks: number; milestones: number; deliverables: number };
}
export interface SaveAsTemplateResult { ok: boolean; template_id: string; name: string; start_date_missing: boolean; counts: TemplateCounts }
export interface CreateFromTemplateResult {
  ok: boolean; project_id: string; template_id: string;
  /** رقم المسودّة الجارية وقت التطبيق — ليس إصدارًا منشورًا (النشر يلتقط N ثم يرفع إلى N+1). */
  template_draft_version: number;
  created: Record<string, unknown>;
  applied: { tasks: number; milestones: number; deliverables: number; risks: number; meetings: number; shoots: number };
}

/** بيانات إنشاء مشروع من قالب: نفس حقول project_core_create_project + القالب والوحدات. */
export interface CreateFromTemplateInput extends Record<string, unknown> {
  template_id: string;
  modules?: string[];          // null/undefined = كل الوحدات
  project_name: string;
  client_id?: string; client_name?: string; client_company?: string;
  project_scope?: string; parent_project_id?: string;
  project_type?: string; priority?: string; core_stage?: string;
  start_date?: string; due_date?: string; budget_amount?: string; description?: string;
}

export const projectTemplatesLibrary = (filters: { category?: string; search?: string; include_archived?: boolean } = {}) =>
  prpc<TemplateLibrary>("project_templates_library", { p_filters: filters });
export const projectCreateFromTemplate = (data: CreateFromTemplateInput) =>
  prpc<CreateFromTemplateResult>("project_create_from_template", { p_data: data });
export const projectSaveAsTemplate = (projectId: string, data: { name: string; description?: string; category?: string; service_type?: string; template_key?: string; default_duration_days?: number }) =>
  prpc<SaveAsTemplateResult>("project_save_as_template", { p_project: projectId, p_data: data });
export const projectTemplateVersionsList = (templateId: string) =>
  prpc<{ versions: TemplateVersion[] }>("project_template_versions_list", { p_template: templateId });
export const projectTemplatePublishVersion = (templateId: string, note?: string) =>
  prpc<{ ok: boolean; published_version: number; next_version: number }>("project_template_publish_version", { p_template: templateId, p_note: note ?? null });
export const projectTemplateRestoreVersion = (templateId: string, version: number) =>
  prpc<{ ok: boolean; restored_from: number; new_version: number }>("project_template_restore_version", { p_template: templateId, p_version: version });

export const TEMPLATE_MODULES: { k: string; ar: string; en: string }[] = [
  { k: "tasks", ar: "المهام", en: "Tasks" },
  { k: "milestones", ar: "المعالم", en: "Milestones" },
  { k: "deliverables", ar: "المخرجات", en: "Deliverables" },
  { k: "risks", ar: "المخاطر", en: "Risks" },
  { k: "meetings", ar: "الاجتماعات", en: "Meetings" },
  { k: "shoots", ar: "جلسات التصوير", en: "Shoots" },
];

export function tplErr(e: string): string {
  if (/no_modules/.test(e)) return "اختر وحدة واحدة على الأقلّ للتطبيق.";
  if (/template_required/.test(e)) return "اختر قالبًا أولًا.";
  if (/template_not_found/.test(e)) return "القالب غير موجود أو مؤرشف.";
  if (/version_not_found/.test(e)) return "الإصدار المطلوب غير موجود.";
  if (/already_applied/.test(e)) return "هذا القالب مطبَّق على المشروع مسبقًا.";
  if (/name_required/.test(e)) return "اسم القالب إلزامي.";
  if (/client_required/.test(e)) return "العميل إلزامي.";
  if (/bad_client/.test(e)) return "العميل غير صالح.";
  if (/bad_scope|bad_stage/.test(e)) return "نوع أو مرحلة المشروع غير صالحة.";
  if (/hierarchy_disabled/.test(e)) return "هرمية المشاريع غير مُفعَّلة.";
  if (/parent_required|parent_not_found|parent_must_be_master|parent_is_deleted/.test(e)) return "المشروع الرئيسي غير صالح.";
  if (/create_failed/.test(e)) return "تعذّر إنشاء المشروع.";
  if (/duplicate key|23505/.test(e)) return "يوجد قالب بنفس المفتاح.";
  if (/not authorized/.test(e)) return "لا تملك صلاحية إدارة القوالب.";
  if (/does not exist|schema cache|PGRST/i.test(e)) return "وحدة القوالب (7A) غير مطبّقة في قاعدة البيانات.";
  return "تعذّر تنفيذ الإجراء. حاول مرة أخرى.";
}
