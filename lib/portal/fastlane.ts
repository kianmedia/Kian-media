// ════════════════════════════════════════════════════════════════════════════
// lib/portal/fastlane.ts — Batch 8C: المسار السريع للمشاريع الصغيرة.
// تجربة التشغيل (simple/standard/program) واللقطة السريعة — كلاهما مشتقّ من
// المصادر الرسمية. لا نظام مهام/إغلاق/Checklist موازٍ ولا أعمدة حالة Boolean.
// ════════════════════════════════════════════════════════════════════════════
import { pget, prpc } from "./client";

export type OperatingExperience = "simple" | "standard" | "program";

/** أنواع المشاريع السريعة — مفردات واجهة فوق project_core.project_type (نصّ حرّ بلا CHECK). */
export type QuickProjectType =
  | "drone_shoot" | "event_coverage" | "real_estate_shoot" | "product_photography"
  | "corporate_video" | "live_stream" | "studio_session" | "podcast_episode"
  | "social_video" | "editing_only" | "custom";

export const QUICK_TYPES: { k: QuickProjectType; ar: string; en: string; templateKey: string | null; suggestsShoot: boolean }[] = [
  { k: "drone_shoot",         ar: "تصوير درون",        en: "Drone shoot",        templateKey: "seed_drone_shoot",         suggestsShoot: true },
  { k: "event_coverage",      ar: "تغطية فعالية",       en: "Event coverage",     templateKey: "seed_event_coverage",      suggestsShoot: true },
  { k: "real_estate_shoot",   ar: "تصوير عقاري",        en: "Real estate",        templateKey: "seed_real_estate_shoot",   suggestsShoot: true },
  { k: "product_photography", ar: "تصوير منتجات",       en: "Product photography",templateKey: "seed_product_photography", suggestsShoot: true },
  { k: "corporate_video",     ar: "فيلم تعريفي",        en: "Corporate video",    templateKey: "seed_corporate_video",     suggestsShoot: true },
  { k: "live_stream",         ar: "بث مباشر",           en: "Live stream",        templateKey: "seed_live_stream",         suggestsShoot: true },
  { k: "studio_session",      ar: "جلسة استوديو",       en: "Studio session",     templateKey: "seed_studio_session",      suggestsShoot: true },
  { k: "podcast_episode",     ar: "حلقة بودكاست",       en: "Podcast episode",    templateKey: "seed_podcast_episode",     suggestsShoot: true },
  { k: "social_video",        ar: "فيديو سوشيال",       en: "Social video",       templateKey: "seed_social_video",        suggestsShoot: true },
  // مونتاج فقط: لا جلسة تصوير افتراضيًّا
  { k: "editing_only",        ar: "مونتاج فقط",         en: "Editing only",       templateKey: "seed_editing_only",        suggestsShoot: false },
  { k: "custom",              ar: "أخرى",               en: "Custom",             templateKey: null,                       suggestsShoot: false },
];
export const quickTypeLabel = (k: string | null | undefined): string =>
  QUICK_TYPES.find((x) => x.k === k)?.ar ?? "";

export const EXPERIENCE_AR: Record<OperatingExperience, string> = {
  simple: "سريع", standard: "قياسي", program: "برنامج",
};

export interface ChecklistItem {
  code: string; ar: string;
  /** null = المصدر غير متاح — لا «مكتمل» ولا «ناقص». */
  done: boolean | null;
  source: string;
}
export type NextAction =
  | "add_task" | "open_shoot" | "add_deliverable" | "open_review" | "open_client_review"
  | "upload_final" | "record_delivery" | "start_closure" | "continue_closure" | "open_tasks" | "none";

export interface QuickSnapshot {
  project_id: string; project_name: string; client_name: string | null;
  project_scope: string; operating_experience: OperatingExperience;
  core_stage: string; health: string | null;
  start_date: string | null; due_date: string | null; manager_name: string | null;
  tasks: { total: number; open: number; overdue: number };
  next_shoot: { id: string; title: string; session_date: string | null; status: string } | null;
  shoots_total: number; shoots_completed: number;
  current_deliverable: { id: string; title: string; status: string; type: string } | null;
  deliverables_total: number;
  preview_versions: number | "unavailable";
  has_final_master: boolean | null;
  deliverables_with_final: number | null;
  project_type: string | null;
  closure: { status: string | null; ready: boolean | null; readiness_percent: number | null };
  checklist: ChecklistItem[];
  next_action: NextAction;
  today: string; generated_at: string;
}

export const projectQuickSnapshot = (projectId: string) =>
  prpc<QuickSnapshot>("project_quick_snapshot", { p_project: projectId });
export const projectOperatingExperience = (projectId: string) =>
  prpc<OperatingExperience>("project_operating_experience", { p_project: projectId });
export const projectSetOperatingExperience = (projectId: string, value: "simple" | "standard", reason?: string) =>
  prpc<{ ok: boolean; project_id: string; operating_experience: string }>("project_set_operating_experience",
    { p_project: projectId, p_value: value, p_reason: reason ?? null });

/**
 * معرّفات المشاريع ذات التجربة «سريع» لوسم القائمة.
 * قراءة واحدة (لا N+1 ولا قائمة معرّفات في الرابط) محكومة بـRLS الحاليّة على
 * `projects`. الشرط شرطٌ واحد: «سريع» = مستقلّ + operating_experience='simple'،
 * لأن الرئيسي/الفرعي لا يحمل القيمة أصلًا (الضابط يرفضها والمُشغِّل يمسحها).
 * فشلها لا يُعطّل القائمة — الشارة تختفي فقط.
 */
export const fastlaneQuickProjectIds = (limit = 1000) =>
  pget<{ id: string }[]>(
    `projects?project_scope=eq.standalone&operating_experience=eq.simple&is_deleted=eq.false&select=id&limit=${limit}`,
  );

/**
 * الإجراء التالي: نصّ عربيّ + وجهة حقيقية.
 * `tab` تبويب قائم داخل ProjectOps، و`lifecycle` يفتح شريط دورة الحياة نفسه —
 * لأن نقل المرحلة إلى «مُسلَّم» لا يتمّ من أيّ تبويب، وطلب الإغلاق يرفض
 * stage_not_delivered دونه. لا وجهة وهمية ولا زرّ بلا مقصد.
 */
export const NEXT_ACTION_META: Record<NextAction, { ar: string; tab: string | null; lifecycle?: boolean }> = {
  add_task:          { ar: "أضف أول مهمة", tab: "tasks" },
  open_shoot:        { ar: "افتح جلسة التصوير", tab: "shoots" },
  add_deliverable:   { ar: "أنشئ المخرج", tab: "deliverables" },
  open_review:       { ar: "افتح المراجعة الداخلية", tab: "deliverables" },
  open_client_review:{ ar: "تابع مراجعة العميل", tab: "deliverables" },
  upload_final:      { ar: "ارفع النسخة النهائية", tab: "deliverables" },
  record_delivery:   { ar: "انقل المرحلة إلى «مُسلَّم»", tab: null, lifecycle: true },
  start_closure:     { ar: "ابدأ الإغلاق", tab: "closure" },
  continue_closure:  { ar: "تابع إجراءات الإغلاق", tab: "closure" },
  open_tasks:        { ar: "تابع المهام المفتوحة", tab: "tasks" },
  none:              { ar: "لا إجراء مطلوب الآن", tab: null },
};

export function fastlaneErr(e: string): string {
  if (/experience_is_derived/.test(e)) return "تجربة التشغيل لهذا المشروع مشتقّة من نوعه (رئيسي/فرعي) ولا تُضبط يدويًّا.";
  if (/bad_experience/.test(e)) return "قيمة تجربة التشغيل غير صالحة.";
  if (/name_required/.test(e)) return "اسم المشروع إلزامي.";
  if (/client_required/.test(e)) return "العميل إلزامي.";
  if (/bad_client/.test(e)) return "العميل غير صالح.";
  if (/bad_stage|bad_scope/.test(e)) return "قيمة غير صالحة في بيانات المشروع.";
  if (/project_is_deleted/.test(e)) return "المشروع محذوف أو مؤرشف.";
  if (/not_found/.test(e)) return "المشروع غير موجود.";
  if (/not authorized/.test(e)) return "لا تملك صلاحية هذا الإجراء.";
  if (/does not exist|schema cache|PGRST/i.test(e)) return "المسار السريع (8C) غير مطبّق في قاعدة البيانات.";
  return "تعذّر تنفيذ الإجراء. حاول مرة أخرى.";
}
