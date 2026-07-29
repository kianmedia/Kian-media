// ════════════════════════════════════════════════════════════════════════════
// lib/portal/large-projects.ts — طبقة الوصول للبيانات لقدرات «المشاريع الكبيرة».
//
// هذه الطبقة عامّة تمامًا: لا تعرف شيئًا عن أيّ مشروع بعينه، ولا تفترض عدد مراحل
// ولا عدد مخرجات ولا أن المخرج فيديو. أيّ مشروع كيان (صغير أو ضخم) يمرّ عبرها.
//
// ─── المبدأ الحاكم: الكشف عن القدرات (Feature detection) ───
// المالك يدفع الكود أوّلًا ويشغّل SQL لاحقًا. لذلك كلّ عمود/دالة جديدة تُعامَل
// كـ«اختيارية»: نفحص وجودها مرّة واحدة، ونعمل بالأعمدة الخمسة عشر الأصلية إن غابت،
// ونعرض رسالة عربية صريحة بأن الترحيلة لم تُطبَّق بعد. لا صفحة تنهار.
//
// جدول public.deliverables اليوم (مُتحقَّق منه):
//   id · project_id · title · type · version · preview_url · vimeo_video_id
//   vimeo_review_url · watermark_required · allow_download · status · created_at
//   assignee_id · due_date        (+ is_deleted للحذف الناعم)
// كلّ ما عدا ذلك (المرحلة الفرعية، المنصّات، الأولوية، حالة الجدولة، الوحدات…)
// اختياريّ ويُكتشَف وقت التشغيل.
// ════════════════════════════════════════════════════════════════════════════

import { pget, prpc, enc, type Result } from "@/lib/portal/client";

// ─────────────────────────────────────────────────────────────────────────────
// 1) الأنواع
// ─────────────────────────────────────────────────────────────────────────────

/** حالات المخرج — قيم DB القائمة، بلا اختراع. */
export type LpDeliverableStatus =
  | "draft" | "internal_review" | "client_review"
  | "revision_requested" | "approved" | "final_delivered" | "archived";

export const LP_STATUSES: LpDeliverableStatus[] = [
  "draft", "internal_review", "client_review", "revision_requested",
  "approved", "final_delivered", "archived",
];

/** المخرجات المنتهية: لا تُحسب متأخّرة ولا تنتظر أحدًا. archived مُستبعَد من التقدّم كلّيًّا. */
export const LP_DONE_STATUSES: LpDeliverableStatus[] = ["final_delivered", "archived"];

export const LP_STATUS_LABELS: Record<string, { ar: string; en: string }> = {
  draft: { ar: "مسودّة", en: "Draft" },
  internal_review: { ar: "مراجعة داخلية", en: "Internal review" },
  client_review: { ar: "لدى العميل", en: "With client" },
  revision_requested: { ar: "طلب تعديل", en: "Revision requested" },
  approved: { ar: "معتمد", en: "Approved" },
  final_delivered: { ar: "سُلِّم نهائيًّا", en: "Final delivered" },
  archived: { ar: "مؤرشف", en: "Archived" },
};

/** لون الحالة. awaiting_schedule ليس هنا عمدًا — ليس حالة مخرج بل حالة جدولة. */
export const LP_STATUS_COLOR: Record<string, string> = {
  draft: "#78716c", internal_review: "#0891b2", client_review: "#7c3aed",
  revision_requested: "#d97706", approved: "#16a34a", final_delivered: "#059669",
  archived: "#57534e",
};

/**
 * حالة الجدولة — مفردات قاعدة البيانات حرفيًّا كما في CHECK الخاصّ بالعمود
 * (docs/project_platform_large_projects_RUNME.sql §1). لا اختراع ولا اختصار.
 * awaiting_schedule = «بانتظار الجدولة»: لا تاريخ بعد، وهذا وضع مشروع لا خطأ.
 */
export type LpScheduleStatus =
  | "awaiting_schedule" | "scheduled" | "in_progress" | "done" | "on_hold" | "cancelled";

export const LP_SCHEDULE_LABELS: Record<string, { ar: string; en: string }> = {
  awaiting_schedule: { ar: "بانتظار الجدولة", en: "Awaiting schedule" },
  scheduled: { ar: "مجدول", en: "Scheduled" },
  in_progress: { ar: "قيد التنفيذ", en: "In progress" },
  done: { ar: "منتهٍ", en: "Done" },
  on_hold: { ar: "معلَّق", en: "On hold" },
  cancelled: { ar: "ملغى", en: "Cancelled" },
};

/** الحالات التي يسري فيها التزام التاريخ. ما عداها لا يُحسب تأخّرًا أبدًا. */
export const LP_SCHEDULE_ACTIVE: string[] = ["scheduled", "in_progress"];

export type LpPriority = "low" | "normal" | "high" | "urgent";
export const LP_PRIORITIES: LpPriority[] = ["low", "normal", "high", "urgent"];
export const LP_PRIORITY_LABELS: Record<string, { ar: string; en: string }> = {
  low: { ar: "منخفضة", en: "Low" }, normal: { ar: "عادية", en: "Normal" },
  high: { ar: "عالية", en: "High" }, urgent: { ar: "عاجلة", en: "Urgent" },
};

export type LpRequirement = "shooting" | "editing" | "design" | "printing";
export const LP_REQUIREMENTS: LpRequirement[] = ["shooting", "editing", "design", "printing"];
export const LP_REQUIREMENT_LABELS: Record<LpRequirement, { ar: string; en: string }> = {
  shooting: { ar: "تصوير", en: "Shooting" }, editing: { ar: "مونتاج", en: "Editing" },
  design: { ar: "تصميم", en: "Design" }, printing: { ar: "طباعة", en: "Printing" },
};

/**
 * صفّ المخرج. الحقول الأربعة عشر الأولى مضمونة؛ ما بعدها اختياريّ (`?`) ولا يُقرأ
 * إلا بعد إثبات وجود عموده. `type` نصّ حرّ عمدًا: قائمة الأنواع ستتوسّع (طباعة، بثّ
 * مباشر، فعالية…) ولا يجوز أن تفترض الواجهة أنها فيديو/صورة.
 */
export interface LpDeliverable {
  id: string;
  project_id: string;
  title: string | null;
  type: string | null;
  version: number | null;
  status: LpDeliverableStatus | string;
  assignee_id: string | null;
  due_date: string | null;
  created_at: string | null;
  preview_url?: string | null;
  vimeo_review_url?: string | null;
  allow_download?: boolean | null;
  watermark_required?: boolean | null;
  // ── اختياريّة (تصل مع الترحيلة الإضافية) ──
  /** المرحلة التي ينتمي إليها المخرج (مشروع داخل الشجرة نفسها). */
  stage_id?: string | null;
  /** نوع المحتوى الموسَّع (جدول مرجعيّ). `type` القديم يبقى مزامَنًا بـ Trigger. */
  content_type?: string | null;
  platforms?: string[] | null;
  execution_details?: string | null;
  proposed_caption?: string | null;
  priority?: string | null;
  /** اسم العمود في القاعدة هو client_visible (not null default false). */
  client_visible?: boolean | null;
  schedule_status?: string | null;
  planned_start_date?: string | null;
  expected_units?: number | null;
  completed_units?: number | null;
  recurrence_type?: string | null;
  recurrence_config?: Record<string, unknown> | null;
  requires_shooting?: boolean | null;
  requires_editing?: boolean | null;
  requires_design?: boolean | null;
  requires_printing?: boolean | null;
  sort_order?: number | null;

  // ── حقول داخلية: مصدرها public.deliverable_internal لا public.deliverables ──
  // RLS تُصفّي الصفوف لا الأعمدة، وكل المستخدمين على دور authenticated واحد،
  // فبقاؤها على deliverables كان يعني أن العميل يقرؤها بـ select يدويّ عبر
  // PostgREST. الآن الجدول الجانبي كوادر-فقط: العميل يحصل على **صفر صفوف**،
  // فتبقى هذه الحقول undefined عنده — وكل قارئ لها يتعامل مع الغياب أصلًا.
  internal_notes?: string | null;
  external_key?: string | null;
  import_batch_id?: string | null;
  source_row_number?: number | null;
  source_file_name?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * «المجموعة داخل المرحلة» = المستوى الثالث المنطقيّ. لا عمود مخصَّص لها في
 * القاعدة (وإضافة عمود ليست من نصيب هذه الطبقة)، فتُقرأ من metadata — وهو حقل
 * jsonb قائم. غيابها يعني ببساطة ألّا مستوى ثالث، ولا يتعطّل شيء.
 */
export function lpGroupOf(d: Partial<LpDeliverable>): string | null {
  const m = d ? d.metadata : null;
  if (!m || typeof m !== "object") return null;
  const raw = m.group == null ? m.stage_group : m.group;
  const s = raw == null ? "" : String(raw).trim();
  return s === "" ? null : s;
}

/** المرحلة الفعلية للمخرج: stage_id إن وُجد، وإلّا مشروعه. */
export function lpStageIdOf(d: Partial<LpDeliverable>): string {
  return String(d?.stage_id ?? d?.project_id ?? "");
}

/** نوع المحتوى المعروض: الموسَّع إن وُجد، وإلّا النوع القديم. */
export function lpTypeOf(d: Partial<LpDeliverable>): string {
  const v = d?.content_type ?? d?.type ?? "";
  return String(v).trim();
}

/** مرحلة = مشروع فرعي (أو المشروع نفسه حين لا هرمية). */
export interface LpStage {
  project_id: string;
  name: string | null;
  is_master: boolean;
  sequence: number | null;
  status: string | null;
  core_stage: string | null;
  manager_name: string | null;
  due_date: string | null;
}

export interface LpProgress {
  /** null = لا مخرجات محتسَبة ⇒ «غير متاح»، وليس صفرًا. */
  pct: number | null;
  weight: number;
  counted: number;
  excluded: number;
  estimated: boolean;
  frozen: boolean;
  method: string;
}

export interface LpCounters {
  total: number;
  by_status: Record<string, number>;
  awaiting_schedule: number;
  overdue: number;
  due_soon: number;
  waiting_for_internal_review: number;
  waiting_for_client: number;
  revision_requested: number;
  approved: number;
  final_delivered: number;
  unassigned: number;
  recurring: number;
  hidden_from_client: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) الكشف عن القدرات
// ─────────────────────────────────────────────────────────────────────────────

/** الأعمدة الاختيارية على deliverables التي تستعملها هذه الشاشة فعليًّا. */
export const LP_OPTIONAL_COLUMNS = [
  "stage_id", "content_type", "platforms", "execution_details", "proposed_caption", "priority",
  "client_visible", "schedule_status", "planned_start_date",
  "expected_units", "completed_units", "recurrence_type", "recurrence_config",
  "requires_shooting", "requires_editing", "requires_design", "requires_printing",
  "sort_order",
] as const;
export type LpOptionalColumn = (typeof LP_OPTIONAL_COLUMNS)[number];

/**
 * الجدول الجانبي للحقول الداخلية — **ليس** أعمدة على deliverables.
 *
 * السبب بنيويّ لا تجميليّ: RLS في PostgreSQL تُصفّي الصفوف ولا تُصفّي الأعمدة،
 * وكل مستخدمي التطبيق (العميل والموظّف) يتشاركون دور Postgres واحدًا هو
 * authenticated. فأيّ عمود على deliverables يقرؤه العميل حرفيًّا بطلب واحد:
 *   GET /rest/v1/deliverables?select=internal_notes,external_key
 * الحلّ: جدول جانبي 1:1 بسياسة كوادر-فقط ⇒ العميل يحصل على مصفوفة فارغة مهما
 * كان الـ select. لذلك كل قارئ لهذه الحقول في الواجهة يتحمّل غيابها.
 *
 * أثر معلن: lpGroupOf يقرأ «المجموعة داخل المرحلة» من metadata، فهي تظهر
 * للكوادر ولا تظهر لمن لا يقرأ الجدول الجانبي — والتجميع يسقط إلى «بلا مجموعة»
 * بدل أن ينكسر. هذه الشاشة staff-only أصلًا (ProjectOps)، فالأثر العمليّ صفر.
 */
export const LP_INTERNAL_TABLE = "deliverable_internal";
export const LP_INTERNAL_COLUMNS = [
  "internal_notes", "external_key", "import_batch_id",
  "source_row_number", "source_file_name", "metadata",
] as const;
export type LpInternalColumn = (typeof LP_INTERNAL_COLUMNS)[number];
/** عدد المعرّفات في طلب `in.(...)` الواحد — يمنع عنوانًا أطول من حدّ الخادم. */
const LP_INTERNAL_CHUNK = 100;

/** الأعمدة الخمسة عشر المضمونة (phase0). تُقرأ دائمًا. */
export const LP_BASE_COLUMNS = [
  "id", "project_id", "title", "type", "version", "status", "assignee_id",
  "due_date", "created_at", "preview_url", "vimeo_review_url", "allow_download",
  "watermark_required",
] as const;

/** أسماء دوال العقد الجديد. الاسم عامّ — لا ذكر لأيّ مشروع بعينه. */
export const LP_RPC = {
  bulk: "large_project_deliverables_bulk_update",
  dashboard: "large_project_dashboard",
} as const;

export type LpErrorKind =
  | "missing_function" | "missing_column" | "missing_table"
  | "forbidden" | "auth" | "network" | "other";

/** تصنيف خطأ PostgREST/Postgres إلى سبب مفهوم — أساس كلّ كشف للقدرات. */
export function lpClassify(error: string, status?: number): LpErrorKind {
  const e = String(error || "");
  if (/PGRST202|Could not find the function|function .* does not exist/i.test(e)) return "missing_function";
  if (/PGRST204|42703|column .* does not exist|Could not find the '.*' column/i.test(e)) return "missing_column";
  if (/PGRST205|42P01|relation .* does not exist|Could not find the table/i.test(e)) return "missing_table";
  if (status === 401 || /not_authenticated|session_expired|JWT/i.test(e)) return "auth";
  if (status === 403 || /42501|permission denied|row-level security|not authorized|admin only/i.test(e)) return "forbidden";
  if (status === 0) return "network";
  return "other";
}

export interface LpCapabilities {
  /** جدول deliverables مقروء أصلًا. false ⇒ لا شيء يعمل، اعرض الخطأ. */
  reachable: boolean;
  columns: Record<string, boolean>;
  /** دالة التعديل الجماعي — بدونها تُعطَّل كلّ الإجراءات الجماعية (انظر §5). */
  bulk: boolean;
  /** لوحة مجمَّعة من الخادم (تسريع اختياريّ فقط؛ الحساب يعمل بدونها). */
  dashboardRpc: boolean;
  /**
   * الجدول الجانبي للحقول الداخلية مقروء لهذا المستخدم.
   * false عند العميل **عمدًا** (سياسة كوادر-فقط تعطيه صفر صفوف)، وكذلك قبل
   * تطبيق الترحيلة. الحالتان تعنيان الشيء نفسه للواجهة: لا حقول داخلية.
   */
  internal: boolean;
  /** أعمدة الهرمية على projects (6A). false ⇒ عرض مشروع واحد بلا مراحل. */
  hierarchy: boolean;
  missing: string[];
  checkedAt: number;
  note: string | null;
}

const ZERO_UUID = "00000000-0000-0000-0000-000000000000";
const CAP_TTL_MS = 5 * 60 * 1000;
let capCache: LpCapabilities | null = null;
let capInflight: Promise<LpCapabilities> | null = null;

/** يُستدعى بعد تطبيق الترحيلة (أو من زرّ «إعادة الفحص») لإسقاط الذاكرة المؤقتة. */
export function lpResetCapabilities(): void { capCache = null; capInflight = null; }

async function probeColumn(col: string): Promise<boolean> {
  const r = await pget<unknown[]>(`deliverables?select=id,${col}&id=eq.${ZERO_UUID}&limit=1`);
  if (r.ok) return true;
  return lpClassify(r.error, r.status) !== "missing_column";  // خطأ آخر ⇒ لا نُعلن غيابه كذبًا
}

async function detectCapabilities(): Promise<LpCapabilities> {
  const columns: Record<string, boolean> = {};
  for (const c of LP_OPTIONAL_COLUMNS) columns[c] = false;

  // (أ) محاولة واحدة بكلّ الأعمدة: تنجح فورًا بعد تطبيق الترحيلة.
  const all = LP_OPTIONAL_COLUMNS.join(",");
  const bulkProbe = probeBulkRpc();
  const hierProbe = probeHierarchy();
  const first = await pget<unknown[]>(`deliverables?select=id,${all}&id=eq.${ZERO_UUID}&limit=1`);

  let reachable = true;
  let note: string | null = null;
  if (first.ok) {
    for (const c of LP_OPTIONAL_COLUMNS) columns[c] = true;
  } else {
    const kind = lpClassify(first.error, first.status);
    if (kind === "missing_table") { reachable = false; note = "deliverables_missing"; }
    else if (kind === "missing_column") {
      // (ب) فحص متوازٍ لكلّ عمود — رحلة ذهاب وإياب واحدة، لا حلقة متسلسلة.
      const flags = await Promise.all(LP_OPTIONAL_COLUMNS.map((c) => probeColumn(c)));
      LP_OPTIONAL_COLUMNS.forEach((c, i) => { columns[c] = flags[i]; });
    } else if (kind === "auth" || kind === "forbidden") { reachable = false; note = kind; }
    else { reachable = false; note = "unreachable"; }
  }

  const [bulk, hierarchy, internal] = await Promise.all([bulkProbe, hierProbe, probeInternal()]);
  const missing = LP_OPTIONAL_COLUMNS.filter((c) => !columns[c]);
  return {
    reachable, columns, bulk, dashboardRpc: false, hierarchy, internal,
    missing: missing.slice(), checkedAt: Date.now(), note,
  };
}

/**
 * هل الجدول الجانبي مقروء؟ غيابه (PGRST205/42P01) أو نقص عمود فيه ⇒ false،
 * والواجهة تعمل بلا حقول داخلية بدل أن تسقط. أمّا 403/RLS فيُعيد صفوفًا فارغة
 * لا خطأً — وهذا بالضبط ما يراه العميل، فلا شيء يُكسر عنده.
 */
async function probeInternal(): Promise<boolean> {
  const cols = ["deliverable_id", ...LP_INTERNAL_COLUMNS].join(",");
  const r = await pget<unknown[]>(
    `${LP_INTERNAL_TABLE}?select=${cols}&deliverable_id=eq.${ZERO_UUID}&limit=1`);
  if (r.ok) return true;
  const kind = lpClassify(r.error, r.status);
  return kind !== "missing_table" && kind !== "missing_column";
}

/**
 * فحص دالة التعديل الجماعي بلا أيّ تعديل: قائمة معرّفات فارغة + p_dry_run.
 * العقد يشترط أن تكون هذه المناداة بلا أثر. أيّ عدم تطابق في التوقيع يُعيد
 * PGRST202 فيُقرأ «غائبة» — وهو الاتجاه الآمن (تعطيل، لا ادّعاء).
 */
async function probeBulkRpc(): Promise<boolean> {
  const r = await prpc<unknown>(LP_RPC.bulk, { p_ids: [], p_patch: {}, p_reason: "probe", p_dry_run: true });
  if (r.ok) return true;
  return lpClassify(r.error, r.status) !== "missing_function";
}

async function probeHierarchy(): Promise<boolean> {
  const r = await pget<unknown[]>(`projects?select=id,parent_project_id,project_scope&id=eq.${ZERO_UUID}&limit=1`);
  if (r.ok) return true;
  return lpClassify(r.error, r.status) !== "missing_column";
}

/** قدرات مُخزَّنة لخمس دقائق، ومحميّة من الطلبات المتوازية. */
export function lpCapabilities(force = false): Promise<LpCapabilities> {
  if (!force && capCache && Date.now() - capCache.checkedAt < CAP_TTL_MS) return Promise.resolve(capCache);
  if (!force && capInflight) return capInflight;
  if (force) lpResetCapabilities();
  capInflight = detectCapabilities().then((c) => { capCache = c; capInflight = null; return c; })
    .catch((e) => { capInflight = null; throw e; });
  return capInflight;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) خوارزمية التقدّم — موثَّقة هنا لأنها القرار الأهمّ في هذا الملف
// ─────────────────────────────────────────────────────────────────────────────
//
// القاعدة: التقدّم يُحسب **بالوزن على مستوى المخرجات/الوحدات**، ولا يُحسب أبدًا
// كمتوسّط بسيط لنِسَب المراحل. متوسّط النِسَب يجعل مرحلةً فيها مخرج واحد تساوي
// مرحلةً فيها ستّين مخرجًا، وهو تشويه صريح في مشروع كبير.
//
// الأرقام والقواعد أدناه مطابقة حرفيًّا لمحرّك الخادم
// (project_units_progress + deliverable_status_progress_fraction في
// docs/project_platform_large_projects_RUNME.sql §8). التطابق مقصود: رقمان
// مختلفان للنسبة نفسها على الشاشة نفسها = فقدان ثقة فوريّ.
//
//   وزن المخرج w =
//       expected_units           إذا كان معلومًا وأكبر من صفر (المخرجات المتكرّرة)
//       1                        فيما عدا ذلك  ← بديل موثَّق، ويُعلَّم estimated=true
//                                  إن كان المخرج متكرّرًا بلا عدد وحدات معروف
//       وبسقف LP_MAX_UNIT_WEIGHT: خطأ إدخال (999999) كان سيمحو بقية المخرجات.
//
//   نسبة إنجاز المخرج f =
//       1                                     approved أو final_delivered
//       completed_units / expected_units      إذا كان العددان معلومَين (محصورة [0,1])
//       max(0.5, خريطة الحالة)                وحدات منجَزة بلا هدف معلوم
//       خريطة الحالة                          فيما عدا ذلك:
//         draft 0 · revision_requested 0.50 · internal_review 0.60 · client_review 0.75
//
//   تقدّم أيّ مجموعة = Σ(w·f) ÷ Σ(w) على المخرجات المؤهَّلة وحدها.
//
// نتائج مقصودة من هذا التعريف:
//   • غير المؤهَّل = archived أو schedule_status='cancelled' ⇒ يُستبعَد من البسط
//     والمقام معًا (ليس عملًا مُنجَزًا ولا مُعلَّقًا؛ إبقاؤه يجعل النسبة تكذب للأبد).
//   • مرحلة فارغة: Σw = 0 ⇒ النتيجة null («غير متاح») لا صفر، ووزنها في تقدّم
//     المشروع صفر ⇒ لا تُنزل النسبة الكلّية ولا ترفعها. هذا هو معنى «لا تُشوِّه».
//   • تقدّم المشروع يُحسب مرّة واحدة على كلّ المخرجات، لا بتجميع نِسَب المراحل.
//   • مشروع مُغلق: النتيجة المخزَّنة وقت الإغلاق هي المعتمدة (frozen=true)؛ لا
//     نُعيد الحساب فنُغيّر رقمًا تاريخيًّا بعد الإغلاق.
//   • awaiting_schedule لا يؤثّر في التقدّم إطلاقًا — غياب التاريخ ليس تأخّرًا.

/**
 * خريطة الحالة → نسبة الإنجاز. مطابقة لـ deliverable_status_progress_fraction
 * على الخادم. مصدر وحيد، يُستعمل في الكود وفي الاختبارات.
 */
export const LP_STATUS_FRACTION: Record<string, number> = {
  draft: 0,
  revision_requested: 0.5,
  internal_review: 0.6,
  client_review: 0.75,
  approved: 1,
  final_delivered: 1,
};

/** سقف وزن الوحدة الواحدة (مطابق لـ max_unit_weight على الخادم). */
export const LP_MAX_UNIT_WEIGHT = 1000;

// #region TESTABLE — أجسام الدوال التالية JavaScript صِرف (تُستخرَج وتُنفَّذ في الاختبارات)

/**
 * «بانتظار الجدولة»: صريحة من schedule_status متى وُجد العمود، وإلّا مشتقّة من
 * غياب كلّ من due_date وplanned_start_date. لذلك تعمل الشارة والفلتر اليوم،
 * قبل الترحيلة، على الأعمدة الخمسة عشر الأصلية.
 */
export function lpIsAwaitingSchedule(d: Partial<LpDeliverable>): boolean {
  const explicit = d ? d.schedule_status : null;
  if (explicit === "awaiting_schedule") return true;
  if (explicit) return false;                 // أيّ قيمة صريحة أخرى ⇒ ليست بانتظار
  const due = d ? d.due_date : null;
  const planned = d ? d.planned_start_date : null;
  return !due && !planned;
}

/**
 * «متأخّر». القاعدة الأهمّ في الملفّ كلّه: مخرج بانتظار الجدولة **لا يُحسب
 * متأخّرًا أبدًا** — لا تاريخ ⇒ لا التزام ⇒ لا تأخّر. وكذلك المعلَّق والملغى
 * والمنتهي. مطابقة لشرط الخادم: schedule_status ∈ (scheduled,in_progress)
 * و due_date < اليوم و f < 1.
 */
export function lpIsOverdue(d: Partial<LpDeliverable>, todayISO: string): boolean {
  if (!d) return false;
  if (lpIsAwaitingSchedule(d)) return false;
  const sched = d.schedule_status;
  if (sched && sched !== "scheduled" && sched !== "in_progress") return false;
  const st = d.status;
  if (st === "approved" || st === "final_delivered" || st === "archived") return false;
  const exp = Number(d.expected_units);
  const done = Number(d.completed_units);
  if (Number.isFinite(exp) && exp > 0 && Number.isFinite(done) && done >= exp) return false;
  const due = d.due_date;
  if (!due) return false;
  return String(due).slice(0, 10) < String(todayISO).slice(0, 10);
}

/** وزن المخرج: expected_units حين يكون معلومًا وموجبًا (بسقف)، وإلّا 1. */
export function lpWeight(d: Partial<LpDeliverable>, maxWeight: number): number {
  const raw = d ? d.expected_units : null;
  const n = typeof raw === "number" ? raw : Number(raw);
  const cap = Number(maxWeight) > 0 ? Number(maxWeight) : 1000;
  if (Number.isFinite(n) && n > 0) return Math.min(cap, Math.floor(n));
  return 1;
}

/** نسبة إنجاز مخرج واحد ضمن [0,1]. */
export function lpFraction(d: Partial<LpDeliverable>, statusMap: Record<string, number>): number {
  if (!d) return 0;
  if (d.status === "final_delivered" || d.status === "approved") return 1;
  const f = statusMap[String(d.status)];
  const base = typeof f === "number" ? f : 0;
  const exp = Number(d.expected_units);
  const done = Number(d.completed_units);
  if (Number.isFinite(exp) && exp > 0 && Number.isFinite(done) && done >= 0) {
    const r = done / exp;
    return r > 1 ? 1 : r;
  }
  // وحدات منجَزة بلا هدف معلوم: لا تُخفض النسبة دون من لم يسجّل شيئًا،
  // ولا تمنح 100% بلا هدف. (القاعدة نفسها على الخادم.)
  if (Number.isFinite(done) && done > 0) return base > 0.5 ? base : 0.5;
  return base;
}

/** هل المخرج متكرّر؟ (recurrence_type غير فارغ ولا 'none'). */
export function lpIsRecurring(d: Partial<LpDeliverable>): boolean {
  const rt = d ? d.recurrence_type : null;
  if (!rt) return false;
  const s = String(rt).trim().toLowerCase();
  return s !== "" && s !== "none" && s !== "once";
}

/**
 * تقدّم مجموعة مخرجات. `opts.frozenPct` يُمرَّر للمشروع المُغلق فيُعاد كما هو.
 * لا يستدعي أيّ شبكة — دالّة نقيّة قابلة للاختبار.
 */
export function lpComputeProgress(
  rows: Partial<LpDeliverable>[],
  opts: { statusMap?: Record<string, number>; frozenPct?: number | null; closed?: boolean; maxWeight?: number } | null,
  weightOf: (d: Partial<LpDeliverable>, maxWeight: number) => number,
  fractionOf: (d: Partial<LpDeliverable>, m: Record<string, number>) => number,
  recurringOf: (d: Partial<LpDeliverable>) => boolean,
): LpProgress {
  const o = opts || {};
  const map = o.statusMap || {};
  const cap = o.maxWeight || 1000;
  const list = Array.isArray(rows) ? rows : [];
  let weight = 0;
  let acc = 0;
  let counted = 0;
  let excluded = 0;
  let estimated = false;
  for (let i = 0; i < list.length; i++) {
    const d = list[i];
    if (!d) continue;
    // غير المؤهَّل: مؤرشف أو ملغى الجدولة — يخرج من البسط والمقام معًا.
    if (d.status === "archived" || d.schedule_status === "cancelled") { excluded++; continue; }
    const w = weightOf(d, cap);
    const f = fractionOf(d, map);
    if (recurringOf(d) && !(Number(d.expected_units) > 0)) estimated = true;
    weight += w;
    acc += w * f;
    counted++;
  }
  if (o.closed && typeof o.frozenPct === "number") {
    return { pct: o.frozenPct, weight, counted, excluded, estimated, frozen: true,
      method: "closed_frozen" };
  }
  if (weight <= 0) {
    return { pct: null, weight: 0, counted, excluded, estimated, frozen: false,
      method: "no_countable_deliverables" };
  }
  return {
    pct: Math.round((acc / weight) * 100),
    weight, counted, excluded, estimated, frozen: false,
    method: estimated ? "units_weighted_estimated" : "units_weighted",
  };
}

/** عدّادات اللوحة. تمريرة واحدة فقط — O(n) مهما بلغ عدد المخرجات. */
export function lpSummarize(
  rows: Partial<LpDeliverable>[],
  todayISO: string,
  awaitingOf: (d: Partial<LpDeliverable>) => boolean,
  overdueOf: (d: Partial<LpDeliverable>, t: string) => boolean,
  recurringOf: (d: Partial<LpDeliverable>) => boolean,
): LpCounters {
  const by_status = Object.create(null);
  const list = Array.isArray(rows) ? rows : [];
  let awaiting = 0, overdue = 0, dueSoon = 0, internal = 0, client = 0, revision = 0;
  let approved = 0, delivered = 0, unassigned = 0, recurring = 0, hidden = 0;
  const soonLimit = new Date(String(todayISO).slice(0, 10) + "T00:00:00Z");
  soonLimit.setUTCDate(soonLimit.getUTCDate() + 7);
  const soonISO = soonLimit.toISOString().slice(0, 10);
  for (let i = 0; i < list.length; i++) {
    const d = list[i];
    if (!d) continue;
    const st = String(d.status || "");
    by_status[st] = (by_status[st] || 0) + 1;
    const isAwaiting = awaitingOf(d);
    if (isAwaiting) awaiting++;
    if (overdueOf(d, todayISO)) overdue++;
    else if (!isAwaiting && d.due_date && st !== "final_delivered" && st !== "archived") {
      const day = String(d.due_date).slice(0, 10);
      if (day >= String(todayISO).slice(0, 10) && day <= soonISO) dueSoon++;
    }
    if (st === "internal_review") internal++;
    if (st === "client_review") client++;
    if (st === "revision_requested") revision++;
    if (st === "approved") approved++;
    if (st === "final_delivered") delivered++;
    if (!d.assignee_id) unassigned++;
    if (recurringOf(d)) recurring++;
    if (d.client_visible === false) hidden++;
  }
  return {
    total: list.length, by_status,
    awaiting_schedule: awaiting, overdue, due_soon: dueSoon,
    waiting_for_internal_review: internal, waiting_for_client: client,
    revision_requested: revision, approved, final_delivered: delivered,
    unassigned, recurring, hidden_from_client: hidden,
  };
}

// #endregion TESTABLE

/** أغلفة مريحة (تمرّر الاعتماديات بدل أن تستوردها الأجسام القابلة للاستخراج). */
export const lpTodayISO = (): string => new Date().toISOString().slice(0, 10);
export function lpProgress(
  rows: Partial<LpDeliverable>[],
  opts?: { frozenPct?: number | null; closed?: boolean },
): LpProgress {
  return lpComputeProgress(
    rows,
    { statusMap: LP_STATUS_FRACTION, frozenPct: opts?.frozenPct ?? null,
      closed: opts?.closed ?? false, maxWeight: LP_MAX_UNIT_WEIGHT },
    lpWeight, lpFraction, lpIsRecurring,
  );
}
export function lpCounters(rows: Partial<LpDeliverable>[], todayISO?: string): LpCounters {
  return lpSummarize(rows, todayISO ?? lpTodayISO(), lpIsAwaitingSchedule, lpIsOverdue, lpIsRecurring);
}

// ─────────────────────────────────────────────────────────────────────────────
// 4) الفلاتر
// ─────────────────────────────────────────────────────────────────────────────

export const LP_UNASSIGNED = "__none__";

export interface LpFilters {
  stageIds?: string[];
  stageGroups?: string[];
  statuses?: string[];
  types?: string[];
  platforms?: string[];
  assignees?: string[];              // LP_UNASSIGNED يعني «بلا مسؤول»
  priorities?: string[];
  clientVisibility?: "any" | "visible" | "hidden";
  awaitingSchedule?: boolean;
  overdue?: boolean;
  waitingForClient?: boolean;
  recurring?: boolean;
  requires?: LpRequirement[];
  search?: string;
}

export const LP_EMPTY_FILTERS: LpFilters = {};

export function lpFiltersActive(f: LpFilters): number {
  let n = 0;
  if (f.stageIds?.length) n++;
  if (f.stageGroups?.length) n++;
  if (f.statuses?.length) n++;
  if (f.types?.length) n++;
  if (f.platforms?.length) n++;
  if (f.assignees?.length) n++;
  if (f.priorities?.length) n++;
  if (f.clientVisibility && f.clientVisibility !== "any") n++;
  if (f.awaitingSchedule) n++;
  if (f.overdue) n++;
  if (f.waitingForClient) n++;
  if (f.recurring) n++;
  if (f.requires?.length) n++;
  if (f.search?.trim()) n++;
  return n;
}

const REQ_COL: Record<LpRequirement, keyof LpDeliverable> = {
  shooting: "requires_shooting", editing: "requires_editing",
  design: "requires_design", printing: "requires_printing",
};

/** خارج جسم lpFilter عمدًا: يبقى الجسم JavaScript صِرفًا قابلًا للتنفيذ في الاختبارات. */
const lpSetOf = (a?: string[]): Set<string> | null => (a && a.length ? new Set(a) : null);

/**
 * ترشيح محلّيّ في تمريرة واحدة. المجموعات تُبنى مرّة (Set) خارج الحلقة، فلا عمل
 * تربيعيّ حتى مع مئات المخرجات وعشرات القيم المختارة.
 */
export function lpFilter(rows: LpDeliverable[], f: LpFilters, todayISO?: string): LpDeliverable[] {
  const today = todayISO ?? lpTodayISO();
  const stages = lpSetOf(f.stageIds);
  const groups = lpSetOf(f.stageGroups);
  const statuses = lpSetOf(f.statuses);
  const types = lpSetOf(f.types);
  const platforms = lpSetOf(f.platforms);
  const assignees = lpSetOf(f.assignees);
  const priorities = lpSetOf(f.priorities);
  const requires = f.requires && f.requires.length ? f.requires : null;
  const q = f.search?.trim().toLowerCase() ?? "";

  return rows.filter((d) => {
    if (stages && !stages.has(lpStageIdOf(d))) return false;
    if (groups && !groups.has(String(lpGroupOf(d) ?? ""))) return false;
    if (statuses && !statuses.has(String(d.status))) return false;
    if (types && !types.has(lpTypeOf(d))) return false;
    if (priorities && !priorities.has(String(d.priority ?? "normal"))) return false;
    if (assignees) {
      const key = d.assignee_id ?? LP_UNASSIGNED;
      if (!assignees.has(key)) return false;
    }
    if (platforms) {
      const list = Array.isArray(d.platforms) ? d.platforms : [];
      let hit = false;
      for (let i = 0; i < list.length && !hit; i++) if (platforms.has(String(list[i]))) hit = true;
      if (!hit) return false;
    }
    if (f.clientVisibility === "visible" && d.client_visible !== true) return false;
    if (f.clientVisibility === "hidden" && d.client_visible === true) return false;
    if (f.awaitingSchedule && !lpIsAwaitingSchedule(d)) return false;
    if (f.overdue && !lpIsOverdue(d, today)) return false;
    if (f.waitingForClient && d.status !== "client_review") return false;
    if (f.recurring && !lpIsRecurring(d)) return false;
    if (requires) {
      for (let i = 0; i < requires.length; i++) {
        if (d[REQ_COL[requires[i]]] !== true) return false;
      }
    }
    if (q) {
      const hay = `${d.title ?? ""} ${d.external_key ?? ""} ${lpGroupOf(d) ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 5) الإجراءات الجماعية
// ─────────────────────────────────────────────────────────────────────────────
//
// ⚠️ قرار معماريّ مقصود: **الإجراءات الجماعية معطَّلة ما لم تُطبَّق الترحيلة.**
//
// المطلوب من كلّ إجراء جماعيّ ثلاثة أمور معًا: تحقّق صلاحية على الخادم، وأثر
// تدقيق، وتقرير نجاح/فشل لكلّ عنصر. المتصفّح لا يستطيع كتابة أثر التدقيق:
// public.pc_log مسحوبة الصلاحية عن authenticated (revoke all … from authenticated
// في project_core_FINAL_RUNME.sql)، وadmin_set_deliverable لا تكتب أثرًا ولا تغطّي
// المسؤول/الأولوية/التاريخ. لذلك المسار البديل عبر PATCH مباشر كان سيُنفّذ التعديل
// **بلا أثر تدقيق** — أي إخفاء لفجوة. التعطيل الصريح مع رسالة عربية واضحة أصدق.
//
// عقد الدالة المطلوبة:
//   large_project_deliverables_bulk_update(
//     p_ids uuid[], p_patch jsonb, p_reason text, p_dry_run boolean default false)
//   → jsonb { requested, applied, failed, audited,
//             results: [{ id, ok, error }] }
//   • تتحقّق من الصلاحية لكلّ صفّ على حدة (لا تفشل الدفعة كلّها بسبب صفّ واحد)
//   • تكتب أثر تدقيق واحدًا على الأقل لكلّ عملية
//   • p_ids فارغة ⇒ عملية بلا أثر (تُستعمل للفحص فقط)

export type LpBulkAction =
  | { kind: "assign_owner"; assignee_id: string | null }
  | { kind: "set_priority"; priority: LpPriority }
  | { kind: "set_status"; status: LpDeliverableStatus }
  | { kind: "set_client_visibility"; visible: boolean }
  | { kind: "set_schedule"; due_date: string | null; planned_start_date?: string | null }
  | { kind: "clear_schedule" }
  // نقل «منخفض الخطورة»: يُحرَّك مؤشّر المرحلة (stage_id) لا انتماء المخرج
  // لمشروعه. حارس deliverables_stage_guard يرفض مرحلةً خارج شجرة المشروع.
  | { kind: "move_to_stage"; stage_id: string }
  | { kind: "set_requirements"; requires: Partial<Record<LpRequirement, boolean>> };

export type LpBulkKind = LpBulkAction["kind"];

export const LP_BULK_LABELS: Record<LpBulkKind, { ar: string; en: string }> = {
  assign_owner: { ar: "تعيين مسؤول", en: "Assign owner" },
  set_priority: { ar: "تغيير الأولوية", en: "Change priority" },
  set_status: { ar: "تغيير الحالة", en: "Change status" },
  set_client_visibility: { ar: "إظهار/إخفاء عن العميل", en: "Show / hide from client" },
  set_schedule: { ar: "ضبط الجدولة", en: "Set schedule" },
  clear_schedule: { ar: "إرجاع إلى «بانتظار الجدولة»", en: "Back to awaiting schedule" },
  move_to_stage: { ar: "نقل إلى مرحلة", en: "Move to stage" },
  set_requirements: { ar: "ضبط المتطلّبات", en: "Set requirements" },
};

/** الأعمدة التي يحتاجها كلّ إجراء. إجراء ينقصه عمود ⇒ يظهر معطَّلًا مع السبب. */
export const LP_BULK_REQUIRES: Record<LpBulkKind, LpOptionalColumn[]> = {
  assign_owner: [],                       // assignee_id عمود أصليّ
  set_priority: ["priority"],
  set_status: [],                         // status عمود أصليّ
  set_client_visibility: ["client_visible"],
  set_schedule: ["schedule_status"],      // planned_start_date اختياريّ داخل الإجراء
  clear_schedule: ["schedule_status"],
  move_to_stage: ["stage_id"],
  set_requirements: ["requires_shooting", "requires_editing", "requires_design", "requires_printing"],
};

/** حدّ «الأثر الكبير»: فوقه نطلب تأكيدًا ثانيًا صريحًا. */
export const LP_BULK_CONFIRM_THRESHOLD = 25;
/** أقصى عدد معرّفات في نداء واحد (تُقسَّم الدفعة تلقائيًّا). */
export const LP_BULK_CHUNK = 100;

/** يحوّل الإجراء إلى patch. يُصدر خطأ لو طُلب إجراء بعمود غير موجود. */
export function lpBulkPatch(a: LpBulkAction, caps: LpCapabilities): Record<string, unknown> {
  switch (a.kind) {
    case "assign_owner": return { assignee_id: a.assignee_id };
    case "set_priority": return { priority: a.priority };
    case "set_status": return { status: a.status };
    case "set_client_visibility": return { client_visible: a.visible };
    case "set_schedule": {
      // الحفظ بلا تاريخ مسموح صراحةً: تاريخ فارغ ⇒ يبقى/يعود «بانتظار الجدولة»،
      // ولا يُرفَض الطلب. التواريخ قابلة للتحرير لاحقًا في أيّ وقت.
      const p: Record<string, unknown> = { due_date: a.due_date ?? null };
      if (caps.columns.planned_start_date) p.planned_start_date = a.planned_start_date ?? null;
      if (caps.columns.schedule_status) {
        p.schedule_status = a.due_date || a.planned_start_date ? "scheduled" : "awaiting_schedule";
      }
      return p;
    }
    case "clear_schedule": {
      const p: Record<string, unknown> = { due_date: null };
      if (caps.columns.planned_start_date) p.planned_start_date = null;
      if (caps.columns.schedule_status) p.schedule_status = "awaiting_schedule";
      return p;
    }
    case "move_to_stage": return { stage_id: a.stage_id };
    case "set_requirements": {
      const p: Record<string, unknown> = {};
      for (const k of LP_REQUIREMENTS) {
        const v = a.requires[k];
        if (typeof v === "boolean") p[`requires_${k}`] = v;
      }
      return p;
    }
  }
}

export interface LpBulkItemResult { id: string; ok: boolean; error: string | null }
export interface LpBulkOutcome {
  requested: number;
  applied: number;
  failed: number;
  /** false ⇒ الخادم لم يؤكّد كتابة أثر التدقيق. يُعرض للمستخدم صراحةً. */
  audited: boolean;
  /** true ⇒ نجح النداء لكنّ الخادم لم يُرجع تفصيلًا لكلّ عنصر (لا ندّعي نجاحًا). */
  detailUnknown: boolean;
  results: LpBulkItemResult[];
}

function normalizeOutcome(raw: unknown, ids: string[]): LpBulkOutcome {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const rowsRaw = Array.isArray(o.results) ? o.results : null;
  if (!rowsRaw) {
    return { requested: ids.length, applied: 0, failed: 0, audited: o.audited === true,
      detailUnknown: true, results: [] };
  }
  const results: LpBulkItemResult[] = rowsRaw.map((r) => {
    const x = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
    return {
      id: String(x.id ?? ""),
      ok: x.ok === true,
      error: x.error == null ? null : String(x.error),
    };
  });
  const applied = results.filter((r) => r.ok).length;
  // العناصر التي لم يذكرها الخادم إطلاقًا تُحسب فاشلة «بلا ردّ» — لا تُبتلع.
  const seen = new Set(results.map((r) => r.id));
  for (const id of ids) if (!seen.has(id)) results.push({ id, ok: false, error: "no_response" });
  return {
    requested: ids.length, applied, failed: results.length - applied,
    audited: o.audited === true, detailUnknown: false, results,
  };
}

/**
 * تنفيذ إجراء جماعيّ. الصلاحية تُتحقَّق على **الخادم** لكلّ عنصر، والنتيجة تُعاد
 * مفصَّلة. لا يوجد مسار احتياطيّ يكتب مباشرةً في الجدول (انظر التعليق أعلاه).
 */
export async function lpBulkApply(
  ids: string[], action: LpBulkAction, reason: string, caps: LpCapabilities,
): Promise<Result<LpBulkOutcome>> {
  if (!caps.bulk) return { ok: false, error: "bulk_rpc_missing" };
  const clean = Array.from(new Set(ids.filter(Boolean)));
  if (clean.length === 0) return { ok: false, error: "no_selection" };
  const missing = LP_BULK_REQUIRES[action.kind].filter((c) => !caps.columns[c]);
  if (missing.length) return { ok: false, error: `missing_column:${missing[0]}` };
  if (!reason || !reason.trim()) return { ok: false, error: "reason_required" };

  const patch = lpBulkPatch(action, caps);
  if (Object.keys(patch).length === 0) return { ok: false, error: "empty_patch" };

  const merged: LpBulkOutcome = {
    requested: clean.length, applied: 0, failed: 0, audited: true, detailUnknown: false, results: [],
  };
  for (let i = 0; i < clean.length; i += LP_BULK_CHUNK) {
    const chunk = clean.slice(i, i + LP_BULK_CHUNK);
    const r = await prpc<unknown>(LP_RPC.bulk, {
      p_ids: chunk, p_patch: patch, p_reason: reason.trim(), p_dry_run: false,
    });
    if (!r.ok) {
      // فشل الدفعة كلّها: نُسجّل كلّ عناصرها فاشلة بالسبب الحقيقيّ، ولا نُخفيه.
      for (const id of chunk) merged.results.push({ id, ok: false, error: r.error });
      merged.audited = false;
      continue;
    }
    const part = normalizeOutcome(r.data, chunk);
    merged.applied += part.applied;
    merged.audited = merged.audited && part.audited;
    merged.detailUnknown = merged.detailUnknown || part.detailUnknown;
    merged.results.push(...part.results);
  }
  merged.failed = merged.results.filter((x) => !x.ok).length;
  if (merged.detailUnknown) merged.applied = 0;
  return { ok: true, data: merged };
}

// ─────────────────────────────────────────────────────────────────────────────
// 6) القراءة — لقطة المشروع الكبير
// ─────────────────────────────────────────────────────────────────────────────

export interface LpProjectRow {
  id: string; project_name: string | null; status: string | null;
  client_id: string | null; created_at: string | null; due_date?: string | null;
  parent_project_id?: string | null; project_scope?: string | null;
}

export interface LpSnapshot {
  caps: LpCapabilities;
  project: LpProjectRow;
  parent: LpProjectRow | null;
  stages: LpStage[];
  deliverables: LpDeliverable[];
  /** true ⇒ بلغنا سقف الجلب؛ الأرقام جزئية ويجب قول ذلك للمستخدم. */
  truncated: boolean;
  clientName: string | null;
  managerName: string | null;
  coreByProject: Record<string, { core_stage: string | null; progress_pct: number | null; project_type: string | null; health: string | null; due_date: string | null }>;
  /** ما تعذّر جلبه من المصادر الثانوية — يُعرض بصراحة بدل الصمت. */
  degraded: string[];
}

/** سقف الجلب. مشروع بمئات المخرجات يمرّ بلا صفحات؛ ما فوق السقف يُعلَن. */
export const LP_FETCH_LIMIT = 1000;

const CLIENT_COLS = "id,full_name,company";

async function fetchProjects(projectId: string, hierarchy: boolean): Promise<Result<LpProjectRow[]>> {
  const base = "id,project_name,status,client_id,created_at,due_date";
  const cols = hierarchy ? `${base},parent_project_id,project_scope` : base;
  const q = hierarchy
    ? `projects?or=(id.eq.${enc(projectId)},parent_project_id.eq.${enc(projectId)})&is_deleted=eq.false&select=${cols}&order=created_at.asc`
    : `projects?id=eq.${enc(projectId)}&is_deleted=eq.false&select=${cols}`;
  return pget<LpProjectRow[]>(q);
}

/**
 * تحميل لقطة كاملة. تفشل فقط إذا تعذّرت قراءة المشروع نفسه؛ كلّ مصدر ثانويّ
 * (العميل، المدير، project_core) يُحاوَل ويُسجَّل في degraded عند الفشل.
 */
interface LpInternalRow {
  deliverable_id: string;
  internal_notes?: string | null;
  external_key?: string | null;
  import_batch_id?: string | null;
  source_row_number?: number | null;
  source_file_name?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * يجلب صفوف public.deliverable_internal للمخرجات المعروضة ويدمجها في مكانها.
 * يُرجع false عند إخفاق حقيقيّ (فيُعلَن ضمن degraded)، و true حين ينجح الطلب —
 * ولو عاد فارغًا. الفراغ هو **الحالة الصحيحة** عند العميل، لا عطل.
 */
async function mergeInternal(rows: LpDeliverable[]): Promise<boolean> {
  const cols = ["deliverable_id", ...LP_INTERNAL_COLUMNS].join(",");
  const byId = new Map<string, LpDeliverable>();
  const ids: string[] = [];
  for (const d of rows) {
    const id = String(d.id);
    if (id === "" || byId.has(id)) continue;
    byId.set(id, d);
    ids.push(id);
  }
  let ok = true;
  for (let i = 0; i < ids.length; i += LP_INTERNAL_CHUNK) {
    const slice = ids.slice(i, i + LP_INTERNAL_CHUNK);
    const r = await pget<LpInternalRow[]>(
      `${LP_INTERNAL_TABLE}?deliverable_id=in.(${slice.map(enc).join(",")})&select=${cols}`);
    if (!r.ok) { ok = false; continue; }
    for (const row of r.data ?? []) {
      const d = byId.get(String(row?.deliverable_id ?? ""));
      if (!d) continue;
      d.internal_notes    = row.internal_notes    ?? null;
      d.external_key      = row.external_key      ?? null;
      d.import_batch_id   = row.import_batch_id   ?? null;
      d.source_row_number = row.source_row_number ?? null;
      d.source_file_name  = row.source_file_name  ?? null;
      d.metadata          = row.metadata          ?? null;
    }
  }
  return ok;
}

export async function lpLoadSnapshot(projectId: string): Promise<Result<LpSnapshot>> {
  const caps = await lpCapabilities();
  const degraded: string[] = [];

  let projRes = await fetchProjects(projectId, caps.hierarchy);
  if (!projRes.ok && caps.hierarchy && lpClassify(projRes.error, projRes.status) === "missing_column") {
    degraded.push("hierarchy_columns");
    projRes = await fetchProjects(projectId, false);
  }
  if (!projRes.ok) return projRes;

  const rows = projRes.data ?? [];
  const self = rows.find((p) => p.id === projectId) ?? null;
  if (!self) return { ok: false, error: "project_not_found", status: 404 };

  const children = rows.filter((p) => p.id !== projectId);
  const ids = [self.id, ...children.map((c) => c.id)];

  // ── project_core (اختياريّ) ──
  const coreByProject: LpSnapshot["coreByProject"] = {};
  const coreRes = await pget<{ project_id: string; core_stage: string | null; progress_pct: number | null; project_type: string | null; health: string | null; due_date: string | null }[]>(
    `project_core?project_id=in.(${ids.map(enc).join(",")})&select=project_id,core_stage,progress_pct,project_type,health,due_date`);
  if (coreRes.ok) {
    for (const c of coreRes.data ?? []) {
      coreByProject[c.project_id] = {
        core_stage: c.core_stage, progress_pct: c.progress_pct,
        project_type: c.project_type, health: c.health, due_date: c.due_date,
      };
    }
  } else degraded.push("project_core");

  // ── المخرجات ──
  const cols = [...LP_BASE_COLUMNS, ...LP_OPTIONAL_COLUMNS.filter((c) => caps.columns[c])].join(",");
  const dlvRes = await pget<LpDeliverable[]>(
    `deliverables?project_id=in.(${ids.map(enc).join(",")})&is_deleted=eq.false&select=${cols}&order=created_at.asc&limit=${LP_FETCH_LIMIT + 1}`);
  let deliverables: LpDeliverable[] = [];
  let truncated = false;
  if (dlvRes.ok) {
    const all = dlvRes.data ?? [];
    truncated = all.length > LP_FETCH_LIMIT;
    deliverables = truncated ? all.slice(0, LP_FETCH_LIMIT) : all;
  } else degraded.push("deliverables");

  // ── الحقول الداخلية (جدول جانبي كوادر-فقط) ──
  // العميل يحصل هنا على صفر صفوف بحكم RLS ⇒ لا شيء يُدمج ولا شيء يتعطّل.
  if (caps.internal && deliverables.length > 0) {
    const ok = await mergeInternal(deliverables);
    if (!ok) degraded.push("deliverable_internal");
  }

  // ── الأب (فتات الخبز) ──
  let parent: LpProjectRow | null = null;
  if (caps.hierarchy && self.parent_project_id) {
    const pr = await pget<LpProjectRow[]>(
      `projects?id=eq.${enc(self.parent_project_id)}&select=id,project_name,status,client_id,created_at,project_scope`);
    if (pr.ok) parent = pr.data?.[0] ?? null; else degraded.push("parent");
  }

  // ── اسم العميل + اسم المدير (أفضل جهد) ──
  let clientName: string | null = null;
  if (self.client_id) {
    const cr = await pget<{ id: string; full_name: string | null; company: string | null }[]>(
      `clients?id=eq.${enc(self.client_id)}&select=${CLIENT_COLS}`);
    if (cr.ok) {
      const c = cr.data?.[0];
      clientName = c ? (c.company || c.full_name || null) : null;
    } else degraded.push("client");
  }
  const managerName = await fetchManagerName(self.id, degraded);

  // ── المراحل: المشروع نفسه + فروعه ──
  const stages: LpStage[] = [
    {
      project_id: self.id, name: self.project_name, is_master: true, sequence: 0,
      status: self.status, core_stage: coreByProject[self.id]?.core_stage ?? null,
      manager_name: managerName, due_date: self.due_date ?? coreByProject[self.id]?.due_date ?? null,
    },
    ...children.map((c, i) => ({
      project_id: c.id, name: c.project_name, is_master: false, sequence: i + 1,
      status: c.status, core_stage: coreByProject[c.id]?.core_stage ?? null,
      manager_name: null, due_date: c.due_date ?? coreByProject[c.id]?.due_date ?? null,
    })),
  ];

  return {
    ok: true,
    data: { caps, project: self, parent, stages, deliverables, truncated, clientName, managerName, coreByProject, degraded },
  };
}

async function fetchManagerName(projectId: string, degraded: string[]): Promise<string | null> {
  const mr = await pget<{ user_id: string; role: string }[]>(
    `project_members?project_id=eq.${enc(projectId)}&is_deleted=eq.false&select=user_id,role`);
  if (!mr.ok) { degraded.push("members"); return null; }
  // أدوار العضوية تخلط الكادر بالعميل ('client_owner' موجود في project_core_FINAL).
  // استبعاد أدوار العميل أوّلًا إلزاميّ: بدونه يظهر اسم العميل كمدير للمشروع.
  const rows = (mr.data ?? []).filter((m) => !/client/i.test(m.role ?? ""));
  const pick = rows.find((m) => /manager/i.test(m.role ?? ""))
    ?? rows.find((m) => /^(kian_|project_owner|project_coordinator)/i.test(m.role ?? ""))
    ?? null;
  if (!pick) return null;   // لا مدير معروف ⇒ «غير محدَّد»، لا تخمين
  const pr = await pget<{ id: string; full_name: string | null }[]>(
    `profiles?id=eq.${enc(pick.user_id)}&select=id,full_name`);
  if (!pr.ok) { degraded.push("manager_profile"); return null; }
  return pr.data?.[0]?.full_name ?? null;
}

/** قائمة الكادر لاختيار المسؤول/الفلترة. تفشل بهدوء إلى قائمة فارغة. */
export async function lpStaffOptions(): Promise<{ id: string; full_name: string | null }[]> {
  const r = await pget<{ id: string; full_name: string | null }[]>(
    `profiles?staff_role=not.is.null&select=id,full_name&order=full_name.asc&limit=300`);
  return r.ok ? (r.data ?? []) : [];
}

// ─────────────────────────────────────────────────────────────────────────────
// 7) اشتقاقات العرض
// ─────────────────────────────────────────────────────────────────────────────

/**
 * تجميع حسب **المرحلة** (stage_id إن وُجد وإلّا project_id) في تمريرة واحدة —
 * يمنع البحث المتداخل (O(n²)) في الواجهة. الاعتماد على project_id وحده كان
 * يُسقِط كلّ المخرجات في سلّة المشروع الرئيسيّ ويُفرِغ تقدّم المراحل.
 */
export function lpGroupByStage(rows: LpDeliverable[]): Map<string, LpDeliverable[]> {
  const m = new Map<string, LpDeliverable[]>();
  for (const d of rows) {
    const k = lpStageIdOf(d);
    const arr = m.get(k);
    if (arr) arr.push(d); else m.set(k, [d]);
  }
  return m;
}

/** مجموعات المرحلة (المستوى الثالث المنطقيّ). فارغة ⇒ لا مستوى ثالث مستعمَل. */
export function lpGroupsOf(rows: LpDeliverable[]): string[] {
  const s = new Set<string>();
  for (const d of rows) {
    const g = lpGroupOf(d);
    if (g) s.add(g);
  }
  return Array.from(s).sort();
}

export function lpPlatformsOf(rows: LpDeliverable[]): string[] {
  const s = new Set<string>();
  for (const d of rows) {
    const list = Array.isArray(d.platforms) ? d.platforms : [];
    for (const p of list) { const v = String(p).trim(); if (v) s.add(v); }
  }
  return Array.from(s).sort();
}

export function lpTypesOf(rows: LpDeliverable[]): string[] {
  const s = new Set<string>();
  for (const d of rows) { const v = lpTypeOf(d); if (v) s.add(v); }
  return Array.from(s).sort();
}

export interface LpStageProgress { stage: LpStage; progress: LpProgress; counters: LpCounters }

/** تقدّم كلّ مرحلة على حدة — بالصيغة الموزونة نفسها، لا بمتوسّط النِسَب. */
export function lpStageBreakdown(stages: LpStage[], rows: LpDeliverable[], todayISO?: string): LpStageProgress[] {
  const byStage = lpGroupByStage(rows);
  const today = todayISO ?? lpTodayISO();
  return stages.map((s) => {
    const list = byStage.get(s.project_id) ?? [];
    return { stage: s, progress: lpProgress(list), counters: lpCounters(list, today) };
  });
}

/** حالة الجدولة على مستوى المشروع: مشتقّة من مخرجاته، لا عمود جديد. */
export function lpProjectScheduleStatus(rows: LpDeliverable[]): { key: LpScheduleStatus; awaiting: number; total: number } {
  let awaiting = 0;
  for (const d of rows) if (lpIsAwaitingSchedule(d)) awaiting++;
  return { key: awaiting > 0 ? "awaiting_schedule" : "scheduled", awaiting, total: rows.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// 8) رسائل عربية
// ─────────────────────────────────────────────────────────────────────────────

export function lpErr(e: string, status?: number): string {
  const k = lpClassify(e, status);
  if (/bulk_rpc_missing/.test(e)) return "الإجراءات الجماعية معطّلة: دالّة التعديل الجماعي غير مطبّقة في قاعدة البيانات بعد.";
  if (/^missing_column:/.test(e)) return `هذا الإجراء يحتاج عمودًا لم يُضَف بعد (${e.split(":")[1]}). طبّق الترحيلة أوّلًا.`;
  if (/no_selection/.test(e)) return "لم تختر أيّ مخرج.";
  if (/reason_required/.test(e)) return "السبب إلزاميّ لتسجيل أثر التدقيق.";
  if (/empty_patch/.test(e)) return "لا تغيير مطلوب.";
  if (/project_not_found/.test(e)) return "المشروع غير موجود أو لا تملك صلاحية رؤيته.";
  if (k === "missing_function") return "الترحيلة غير مطبّقة: الدالّة المطلوبة غير موجودة في قاعدة البيانات.";
  if (k === "missing_column") return "الترحيلة غير مطبّقة: عمود مطلوب غير موجود بعد.";
  if (k === "missing_table") return "الترحيلة غير مطبّقة: جدول مطلوب غير موجود بعد.";
  if (k === "forbidden") return "لا تملك صلاحية هذا الإجراء.";
  if (k === "auth") return "انتهت الجلسة — سجّل الدخول من جديد.";
  if (k === "network") return "تعذّر الاتصال. تحقّق من الشبكة وأعد المحاولة.";
  return "تعذّر تنفيذ الطلب. حاول مرة أخرى.";
}

/**
 * ملخّص عربيّ لما ينقص. يُعرض في شريط واحد أعلى الشاشة بدل رسائل متفرّقة.
 */
export function lpMigrationNotice(caps: LpCapabilities): string | null {
  if (!caps.reachable) return "تعذّر قراءة جدول المخرجات — تحقّق من الصلاحيات أو الاتصال.";
  const parts: string[] = [];
  if (caps.missing.length) parts.push(`${caps.missing.length} حقلًا إضافيًّا غير مطبّق`);
  if (!caps.bulk) parts.push("الإجراءات الجماعية معطّلة");
  if (!caps.hierarchy) parts.push("هرمية المشاريع غير مفعّلة (عرض مشروع واحد)");
  if (!parts.length) return null;
  return `الترحيلة الإضافية لم تُطبَّق بعد: ${parts.join(" · ")}. الشاشة تعمل بالحقول الأساسية فقط.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 9) قرار العمق الهرميّ — موثَّق في الكود عمدًا
// ─────────────────────────────────────────────────────────────────────────────
//
// السؤال: هل تحتمل المنصّة مستوى ثالثًا (مشروع ← فرعيّ ← فرعيّ)؟
// الجواب بعد الفحص: **لا، والكلفة عالية جدًّا.** الأدلّة من
// docs/project_hierarchy_batch6a_RUNME.sql:
//   • projects_hierarchy_guard يرفع parent_must_be_master إذا لم يكن الأب 'master'
//     ⇒ الفرع لا يصلح أبًا بنيويًّا.
//   • project_hierarchy_promote_to_master يقبل 'standalone' فقط
//     (only_standalone_can_be_promoted) ⇒ لا ترقية فرع إلى أب.
//   • القيد projects_scope_parent_ck يربط scope بوجود/غياب parent_project_id،
//     وmaster_with_children_immutable يُجمّد هوية الأب.
//   • can_access_project وما يقارب خمسين سياسة RLS، والتجميعات (rollup)،
//     والإغلاق والتنفيذيّ وSLA — كلّها مكتوبة على افتراض مستويين.
// تغيير ذلك = تعديل عميق في نموذج الصلاحيات ونصف المنصّة.
//
// حزمة docs/project_platform_large_projects_RUNME.sql §7 تقول الشيء نفسه صراحةً:
// حارس العمق فيها **دفاعيّ** لا تمكينيّ، وتنصّ على أن 6A «تفرض بنيويًّا مستويين».
//
// القرار: **لا نُسطّح البيانات ولا نفقد العلاقة الأصلية.** المستوى الثالث يُمثَّل
// كـ«مجموعة داخل المرحلة» تُقرأ من metadata (حقل jsonb قائم، بلا عمود جديد):
//     مشروع رئيسيّ  →  مرحلة (مشروع فرعيّ عبر stage_id)  →  مجموعة  →  مخرج
// المخرج يبقى مرتبطًا بمشروعه ومرحلته الحقيقيَّين في القاعدة، والمجموعة مجرّد بُعد
// تجميع داخل المرحلة. غياب المجموعات يعني ببساطة ألّا مستوى ثالث — ولا يتعطّل شيء.
export const LP_HIERARCHY_MAX_DEPTH = 2;
export const LP_THIRD_LEVEL_MODEL = "metadata.group";

// ─────────────────────────────────────────────────────────────────────────────
// 10) مُسرِّع اختياريّ: نسبة الخادم مصدرًا وحيدًا بعد تطبيق الترحيلة
// ─────────────────────────────────────────────────────────────────────────────
//
// project_units_rollup يحسب النسبة نفسها بالقواعد نفسها على كامل الشجرة. حين
// يكون متاحًا نعرض رقمه (مصدر واحد للحقيقة)، وقبل الترحيلة يعمل محرّكنا المحلّيّ.
export interface LpServerProgress {
  pct: number | null; calculation_method: string; frozen?: boolean;
  total?: number; counted?: number; overdue?: number; awaiting_schedule?: number;
}
export async function lpServerProgress(projectId: string): Promise<LpServerProgress | null> {
  const r = await prpc<LpServerProgress>("project_units_rollup", { p_project: projectId });
  if (!r.ok || !r.data || typeof r.data !== "object") return null;
  const pct = r.data.pct;
  if (pct !== null && typeof pct !== "number") return null;   // شكل غير متوقَّع ⇒ لا نثق به
  return r.data;
}
