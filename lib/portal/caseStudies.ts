// ════════════════════════════════════════════════════════════════════════════
// lib/portal/caseStudies.ts — المراحل ٦–١٠: منصّة دراسات الحالة (الطبقة
// الداخلية).
//
// ★ الكود يسبق الـSQL ★ كلّ نداء هنا مكتشِف للميزة: إن لم تُطبَّق الترحيلة بعد
// نُعيد `pending_migration` كي تعرض الشاشة «الميزة بانتظار تفعيل قاعدة
// البيانات» — لا انهيار، ولا بيانات وهمية، ولا صفر يقف مقام «غير مفعّل».
//
// ★ ثلاث قواعد لا تُخترق في هذه الطبقة ★
//   ١) لا نُقرّر هنا ما يُنشر. الموانع تأتي من الخادم (cs_publish_blockers)
//      وتُعرَض كما هي. لو حسبناها في المتصفّح لصار الفارق بين ما تعرضه الشاشة
//      وما يرفضه الخادم بابًا مفتوحًا.
//   ٢) «لا تملك صلاحية» ليست «ترحيلة ناقصة». 42501 و PGRST202 حالتان
//      مختلفتان تمامًا، والخلط بينهما يرسل المستخدم يبحث عن ترحيلة موجودة.
//   ٣) لا نبني رابط معاينة ولا نمرّر مسار تخزين. المعاينة نداء JSON مصادَق
//      عليه، ولا يوجد في النظام كلّه رمز مشاركة ولا رابط مؤقّت لمسودّة.
// ════════════════════════════════════════════════════════════════════════════
import { prpc, type Result } from "./client";
import { pgClassify, pgIsMigrationPending, type PgDiagnosis } from "./pgerror";

// ─── المفردات ──────────────────────────────────────────────────────────────
export type CaseStudyStatus =
  | "draft" | "internal_review" | "legal_review"
  | "client_permission_required" | "client_permission_received"
  | "approved" | "scheduled" | "published" | "unpublished" | "archived";

export const STATUS_AR: Record<CaseStudyStatus, string> = {
  draft: "مسودّة",
  internal_review: "مراجعة داخلية",
  legal_review: "مراجعة قانونية",
  client_permission_required: "بانتظار إذن العميل",
  client_permission_received: "الإذن مستلَم",
  approved: "معتمَدة",
  scheduled: "مجدوَلة",
  published: "منشورة",
  unpublished: "مسحوبة من النشر",
  archived: "مؤرشفة",
};

/** ترتيب المسار التحريريّ — للعرض فقط؛ الانتقالات يفرضها الخادم. */
export const STATUS_ORDER: CaseStudyStatus[] = [
  "draft", "internal_review", "legal_review", "client_permission_required",
  "client_permission_received", "approved", "scheduled", "published",
];

export type PermissionStatus =
  | "not_requested" | "requested" | "granted" | "refused" | "revoked" | "expired";

export const PERMISSION_STATUS_AR: Record<PermissionStatus, string> = {
  not_requested: "لم يُطلَب",
  requested: "مطلوب",
  granted: "ممنوح",
  refused: "مرفوض",
  revoked: "مسحوب",
  expired: "منتهٍ",
};

export type IdentityVisibility = "named" | "anonymized" | "hidden";
export const VISIBILITY_AR: Record<IdentityVisibility, string> = {
  named: "باسم العميل",
  anonymized: "مجهَّل (وصف معتمَد)",
  hidden: "بلا ذكر للعميل",
};

export type MediaKind =
  | "hero" | "gallery" | "before" | "after" | "logo" | "og_image" | "video" | "video_poster";

export const MEDIA_KIND_AR: Record<MediaKind, string> = {
  hero: "الصورة الرئيسية",
  gallery: "معرض الصور",
  before: "قبل",
  after: "بعد",
  logo: "شعار العميل",
  og_image: "صورة المشاركة (OG)",
  video: "فيديو مضمَّن",
  video_poster: "غلاف الفيديو",
};

/**
 * ★ نصوص الموانع ★ تُترجَم حرفيًّا برمزها القادم من الخادم، بلا تعميم. مانع
 * غير معروف يُعرَض برمزه صراحةً بدل أن يُخفى تحت «تعذّر النشر».
 */
export const BLOCKER_AR: Record<string, string> = {
  not_found: "دراسة الحالة غير موجودة.",
  missing_title_ar: "العنوان العامّ بالعربية مطلوب.",
  missing_title_en: "العنوان العامّ بالإنجليزية مطلوب — الصفحة ثنائية اللغة.",
  missing_summary_ar: "الملخّص بالعربية مطلوب.",
  missing_summary_en: "الملخّص بالإنجليزية مطلوب.",
  archived: "الدراسة مؤرشفة — استعِدها قبل النشر.",
  canonical_mismatch: "المسار الكنسيّ لا يطابق الـslug.",
  no_hero_media: "لا توجد صورة رئيسية معتمدة.",
  media_missing_alt: "وسائط بلا نصّ بديل بالعربية والإنجليزية.",
  media_infected: "ملفّ وسائط موسوم بأنّه مصاب — النشر ممنوع مهما كانت الإعدادات.",
  media_metadata_not_stripped: "وسائط لم تُجرَّد من بياناتها الوصفية (موقع/جهاز/تاريخ).",
  virus_scan_required_without_provider: "الفحص مطلوب في الإعدادات ولا مزوّد مضبوط.",
  media_not_scanned: "وسائط لم تُفحَص أو نتيجتها غير نظيفة.",
  media_host_not_allowed: "وسائط على مضيف خارجيّ غير مُدرَج في قائمة السماح.",
  media_too_large: "وسائط تتجاوز الحدّ الأقصى للحجم.",
  permission_refused_or_revoked: "إذن العميل مرفوض أو مسحوب.",
  permission_missing: "الدراسة تنشر معلومات عن العميل ولا إذن ساري مسجَّل.",
  named_without_permission: "اختير عرض اسم العميل بلا إذن صريح باستعمال الاسم.",
  named_without_name: "اختير عرض الاسم ولا اسم مكتوب.",
  anonymization_required: "الإذن يشترط التجهيل والدراسة تعرض الاسم.",
  logo_without_permission: "شعار العميل مرفق بلا إذن باستعمال الشعار.",
  metrics_without_permission: "نتائج مُقاسة معتمدة بلا إذن بنشر الأرقام.",
  testimonial_without_permission: "شهادة عميل مكتوبة بلا إذن بنشرها.",
  embargo_active: "حظر النشر ما زال ساريًا وتاريخ النشر أبكر منه.",
  credits_suppressed: "أسماء موظّفين بلا موافقة موثَّقة — لن تُنشر، وهذا سلوك مقصود لا عطل.",
  seo_incomplete: "حقول SEO ناقصة — سيُشتقّ البديل من العنوان والملخّص.",
  possible_financial_figure: "نصّ عامّ يحتوي ما يشبه رقمًا ماليًّا — راجعه يدويًّا.",
  blocker_engine_error: "تعذّر فحص موانع النشر — النشر ممنوع حتّى يُحلّ السبب.",
};

export const blockerAr = (code: string): string =>
  BLOCKER_AR[code] ?? `مانع غير معروف: ${code}`;

// ─── نتيجة مكتشِفة للميزة ──────────────────────────────────────────────────
export type CsOutcome<T> =
  | { state: "ok"; data: T }
  | { state: "pending_migration"; message: string; diagnosis: PgDiagnosis }
  | { state: "denied"; message: string; diagnosis: PgDiagnosis }
  | { state: "validation"; message: string; diagnosis: PgDiagnosis }
  | { state: "blocked"; message: string; blockers: CsBlocker[] }
  | { state: "error"; message: string; diagnosis: PgDiagnosis };

const PENDING_AR = "الميزة بانتظار تفعيل قاعدة البيانات.";

export interface CsBlocker {
  code: string;
  severity: "blocker" | "warning";
  detail_ar?: string;
  count?: number;
}

/** استخراج قائمة الموانع من رسالة الخادم عند رفض النشر. */
function parseBlockers(raw: string): CsBlocker[] | null {
  if (!/النشر ممنوع|الجدولة ممنوعة|cs_guard_publish/i.test(raw)) return null;
  const codes = Array.from(raw.matchAll(/"code"\s*:\s*"([a-z_]+)"/g)).map((m) => m[1]);
  if (codes.length === 0) return [{ code: "blocker_engine_error", severity: "blocker" }];
  return codes.map((code) => ({ code, severity: "blocker" as const }));
}

function toOutcome<T>(r: Result<T>): CsOutcome<T> {
  if (r.ok) return { state: "ok", data: r.data };
  const raw = String(r.error ?? "");
  const d = pgClassify(raw, r.status);

  // الموانع تُفحَص قبل أيّ حكم آخر كي لا تُبتلع تحت "unknown".
  const blockers = parseBlockers(raw);
  if (blockers) {
    return {
      state: "blocked",
      message: "تعذّر النشر: " + blockers.map((b) => blockerAr(b.code)).join(" · "),
      blockers,
    };
  }
  if (pgIsMigrationPending(d)) {
    return { state: "pending_migration", message: PENDING_AR, diagnosis: d };
  }
  // ★ «لا تملك صلاحية» ليست ترحيلة ناقصة ★
  if (d.kind === "permission_denied" || d.kind === "not_authenticated" || /not_authorized/i.test(raw)) {
    return { state: "denied", message: "لا تملك صلاحية هذا الإجراء.", diagnosis: d };
  }
  if (/^validation:|validation:/i.test(raw)) {
    return { state: "validation", message: raw.replace(/^.*?validation:\s*/i, ""), diagnosis: d };
  }
  if (/not_found:/i.test(raw)) {
    return { state: "validation", message: raw.replace(/^.*?not_found:\s*/i, ""), diagnosis: d };
  }
  return { state: "error", message: raw, diagnosis: d };
}

const call = async <T>(fn: string, args?: Record<string, unknown>): Promise<CsOutcome<T>> =>
  toOutcome<T>(await prpc<T>(fn, args));

// ─── القدرات ───────────────────────────────────────────────────────────────
export interface CsAccess {
  installed: boolean;
  can_view: boolean;
  can_edit: boolean;
  can_review: boolean;
  can_publish: boolean;
  public_enabled: boolean;
  require_permission_for_publish: boolean;
  require_metadata_stripped: boolean;
  require_virus_scan: boolean;
  virus_scan_provider: string | null;
  media_allowed_hosts: string[];
  max_media_bytes: number;
  published_count: number;
}

/** كلّ شيء false عند غياب الترحيلة — بلا ادّعاء قدرة غير موجودة. */
export const CS_ACCESS_CLOSED: CsAccess = {
  installed: false, can_view: false, can_edit: false, can_review: false, can_publish: false,
  public_enabled: false, require_permission_for_publish: true, require_metadata_stripped: true,
  require_virus_scan: false, virus_scan_provider: null, media_allowed_hosts: [],
  max_media_bytes: 8_000_000, published_count: 0,
};

export const csAccess = () => call<CsAccess>("cs_access");

// ─── الأنواع ───────────────────────────────────────────────────────────────
export interface CsListRow {
  id: string;
  code: string | null;
  internal_title: string;
  slug: string;
  public_title_ar: string | null;
  public_title_en: string | null;
  status: CaseStudyStatus;
  featured: boolean;
  archived: boolean;
  publish_at: string | null;
  current_version: number;
  has_unapproved_changes: boolean;
  is_public_now: boolean;
  client_identity_visibility: IdentityVisibility;
  permission_status: PermissionStatus;
  updated_at: string;
}

export interface CsPermissionRecord {
  case_study_id: string;
  permission_status: PermissionStatus;
  permission_reference: string | null;
  permission_document_note: string | null;
  permission_contact_name: string | null;
  permission_granted_at: string | null;
  permission_expires_at: string | null;
  permitted_logo: boolean;
  permitted_project_name: boolean;
  permitted_metrics: boolean;
  permitted_testimonial: boolean;
  confidentiality_restrictions: string | null;
  anonymization_required: boolean;
  embargo_until: string | null;
}

export interface CsMediaRow {
  id: string;
  case_study_id: string;
  asset_kind: MediaKind;
  public_url: string | null;
  video_provider: "youtube" | "vimeo" | null;
  video_id: string | null;
  alt_ar: string | null;
  alt_en: string | null;
  caption_ar: string | null;
  caption_en: string | null;
  width: number | null;
  height: number | null;
  bytes: number | null;
  content_type: string | null;
  safe_filename: string | null;
  metadata_stripped: boolean;
  virus_scan_status: "not_scanned" | "pending" | "clean" | "infected" | "unavailable";
  pair_key: string | null;
  sort_order: number;
}

export interface CsMetricRow {
  id: string; case_study_id: string;
  label_ar: string | null; label_en: string | null;
  value_text: string; unit_ar: string | null; unit_en: string | null;
  source_note: string | null; approved: boolean; sort_order: number;
}

export interface CsCreditRow {
  id: string; case_study_id: string;
  role_ar: string | null; role_en: string | null;
  person_display_name: string; is_employee: boolean;
  consent_public: boolean; consent_reference: string | null; sort_order: number;
}

export interface CsDetail {
  study: Record<string, unknown>;
  permission: CsPermissionRecord | null;
  permission_summary: Partial<CsPermissionRecord> | null;
  media: CsMediaRow[];
  metrics: CsMetricRow[];
  credits: CsCreditRow[];
  sectors: string[];
  services: string[];
  is_public_now: boolean;
}

export interface CsChecklist {
  completeness: {
    total_fields: number; ar_filled: number; en_filled: number;
    ar_pct: number; en_pct: number;
    fields: { field: string; ar: boolean; en: boolean }[];
  };
  seo_preview: Record<string, string | null>;
  permission_checklist: { key: string; ok?: boolean; value?: unknown }[];
  confidentiality_checklist: { key: string; ok?: boolean; value?: unknown; note?: string; suppressed?: number }[];
  blockers: CsBlocker[];
  can_publish: boolean;
}

export interface CsVersionRow {
  id: string; version_number: number; change_summary: string;
  is_approved: boolean; is_published: boolean; rolled_back_from: number | null;
  created_by: string | null; created_at: string;
  approved_at: string | null; published_at: string | null;
}

export interface CsLookups {
  sectors: { id: string; slug: string; name_ar: string; name_en: string; active: boolean }[];
  services: { id: string; slug: string; name_ar: string; name_en: string; active: boolean }[];
  statuses: CaseStudyStatus[];
  permission_statuses: PermissionStatus[];
  media_kinds: MediaKind[];
  visibility: IdentityVisibility[];
}

// ─── القراءة ───────────────────────────────────────────────────────────────
export const csLookups = () => call<CsLookups>("cs_lookups");
export const csList = (params: Record<string, unknown> = {}) =>
  call<CsListRow[]>("cs_list", { p_params: params });
export const csGet = (id: string) => call<CsDetail>("cs_get", { p_id: id });
export const csChecklist = (id: string) => call<CsChecklist>("cs_checklist", { p_id: id });
export const csVersions = (id: string) => call<CsVersionRow[]>("cs_versions_list", { p_id: id });
export const csAuditList = (params: Record<string, unknown> = {}) =>
  call<Record<string, unknown>[]>("cs_audit_list", { p_params: params });

/**
 * المعاينة الداخلية: الإسقاط العامّ نفسه، مبنيًّا من المحتوى الحيّ وبنفس دالّة
 * التقنيع على الخادم. لا رابط، ولا رمز، ولا شيء يمكن إرساله لطرف خارجيّ.
 */
export const csPreview = (id: string) =>
  call<{ is_preview: true; is_public_now: boolean; projection: unknown }>("cs_preview", { p_id: id });

// ─── الكتابة ───────────────────────────────────────────────────────────────
export const csUpsert = (input: Record<string, unknown>) => call<string>("cs_upsert", { p_input: input });
export const csSetTaxonomy = (id: string, sectors: string[], services: string[]) =>
  call<boolean>("cs_set_taxonomy", { p_id: id, p_sectors: sectors, p_services: services });

export const csMediaUpsert = (input: Record<string, unknown>) => call<string>("cs_media_upsert", { p_input: input });
export const csMediaDelete = (id: string, reason: string) =>
  call<boolean>("cs_media_delete", { p_id: id, p_reason: reason });

export const csMetricUpsert = (input: Record<string, unknown>) => call<string>("cs_metric_upsert", { p_input: input });
export const csMetricDelete = (id: string, reason: string) =>
  call<boolean>("cs_metric_delete", { p_id: id, p_reason: reason });

export const csCreditUpsert = (input: Record<string, unknown>) => call<string>("cs_credit_upsert", { p_input: input });
export const csCreditDelete = (id: string, reason: string) =>
  call<boolean>("cs_credit_delete", { p_id: id, p_reason: reason });

export const csPermissionSet = (id: string, input: Record<string, unknown>) =>
  call<boolean>("cs_permission_set", { p_id: id, p_input: input });

// ─── آلة الحالات ───────────────────────────────────────────────────────────
export const csSubmit = (id: string, summary: string) => call<boolean>("cs_submit", { p_id: id, p_summary: summary });
export const csReviewDecide = (id: string, decision: "advance" | "return", note: string) =>
  call<boolean>("cs_review_decide", { p_id: id, p_decision: decision, p_note: note });
export const csLegalDecide = (id: string, decision: "approve" | "need_permission" | "return", note: string) =>
  call<boolean>("cs_legal_decide", { p_id: id, p_decision: decision, p_note: note });
export const csPermissionConfirm = (id: string, note: string) =>
  call<boolean>("cs_permission_confirm", { p_id: id, p_note: note });
export const csApprove = (id: string, note: string) => call<boolean>("cs_approve", { p_id: id, p_note: note });

/** ★ المالك وحده ★ الأربعة أدناه ترفض بـnot_authorized لأيّ دور آخر. */
export const csPublish = (id: string, note: string) => call<boolean>("cs_publish", { p_id: id, p_note: note });
export const csSchedule = (id: string, at: string, note: string) =>
  call<boolean>("cs_schedule", { p_id: id, p_at: at, p_note: note });
export const csUnpublish = (id: string, reason: string) => call<boolean>("cs_unpublish", { p_id: id, p_reason: reason });
export const csArchive = (id: string, reason: string) => call<boolean>("cs_archive", { p_id: id, p_reason: reason });
export const csRestore = (id: string, note: string) => call<boolean>("cs_restore", { p_id: id, p_note: note });
export const csSettingsSet = (input: Record<string, unknown>) => call<boolean>("cs_settings_set", { p_input: input });

/** التراجع يُنشئ نسخة جديدة — لا يحذف نسخة ولا يعيد النشر تلقائيًّا. */
export const csRollback = (id: string, version: number, summary: string) =>
  call<string>("cs_rollback", { p_id: id, p_version: version, p_summary: summary });

export const csTaxonomyUpsert = (kind: "sector" | "service", input: Record<string, unknown>) =>
  call<string>("cs_taxonomy_upsert", { p_kind: kind, p_input: input });

export const csPublishDue = () => call<{ normalised: number; failed: number }>("cs_publish_due");
export const csExportCsv = (params: Record<string, unknown> = {}) =>
  call<string>("cs_export_csv", { p_params: params });

// ─── مساعدات عرض ───────────────────────────────────────────────────────────
export const hardBlockers = (b: CsBlocker[] | undefined | null): CsBlocker[] =>
  (b ?? []).filter((x) => x.severity === "blocker");
export const warnings = (b: CsBlocker[] | undefined | null): CsBlocker[] =>
  (b ?? []).filter((x) => x.severity === "warning");

/**
 * نصّ حالة الظهور العامّ. ★ صدق ★ «معتمَدة» ليست «منشورة»، و«منشورة» بموعد
 * مستقبليّ ليست «ظاهرة الآن». الخلط بينها يجعل المالك يظنّ أنّ شيئًا على
 * الهواء وهو ليس كذلك، أو العكس — وهو الأخطر.
 */
export function visibilityAr(row: Pick<CsListRow, "status" | "is_public_now" | "publish_at">): string {
  if (row.is_public_now) return "ظاهرة للعامّة الآن";
  if (row.status === "scheduled") {
    return row.publish_at ? `مجدوَلة للظهور في ${row.publish_at.slice(0, 10)}` : "مجدوَلة بلا موعد";
  }
  if (row.status === "published") return "منشورة لكنّها غير ظاهرة (تحقّق من الموعد أو حظر النشر أو الإذن)";
  if (row.status === "unpublished") return "مسحوبة من النشر";
  if (row.status === "archived") return "مؤرشفة";
  return "غير منشورة";
}

// ─── Wave 6 · V2-6.8 · مولّد المسوّدات وطابورها ─────────────────────────────
//
// ⛔ لا منصّة ثانية: نفس `call` ونفس دورة الحالات القائمة. العلم مطفأ ⇒ لا استدعاء.

/** هل تُعرض إضافات V2-6.8؟ الافتراض **مطفأ**. */
export const caseStudyDraftsEnabled = (): boolean =>
  process.env.NEXT_PUBLIC_SHOW_CASE_STUDY_DRAFTS === "true";

export interface CsDraftRow {
  id: string;
  slug: string;
  internal_title: string;
  status: string;
  generation_method: string | null;
  generated_at: string | null;
  /** مفاتيح المصدر فقط — ⛔ لا قيم ولا أسماء أشخاص. */
  source_provenance: Record<string, unknown>;
  has_unapproved_changes: boolean;
  exported_at: string | null;
  /** مشتقّ: **معتمَدة ≠ منشورة**، والتصدير يشترط الاعتماد. */
  exportable: boolean;
  is_published: boolean;
}

/**
 * يُنشئ **مسوّدة** بقالب. ⛔ لا نشر تلقائيّ ولا نصّ مخترَع: كلّ حقل عامّ يبقى
 * فارغًا ليكتبه إنسان (PENDING KHALED CONTENT REVIEW).
 */
export const csGenerateDraft = (projectId: string | null, internalTitle: string, slug?: string) =>
  call<{ ok: boolean; id?: string; slug?: string; reason?: string; auto_published: boolean }>(
    "cs_generate_draft", { p_project: projectId, p_internal_title: internalTitle, p_slug: slug ?? null });

export const csDraftQueue = (status: string | null = null) =>
  call<{ ok: boolean; rows: CsDraftRow[] }>("cs_draft_queue", { p_status: status });

/** يسجّل أنّ التصدير حدث. ⛔ القاعدة **تسجّل** ولا تُصدّر — التصدير سكربت. */
export const csMarkExported = (id: string, target: string) =>
  call<{ ok: boolean; reason?: string; status?: string }>(
    "cs_mark_exported", { p_id: id, p_target: target });

/** مفردات الحالات — من دورة المنصّة القائمة، لا مفردة جديدة. */
export const CS_STATUS_AR: Record<string, string> = {
  draft: "مسوّدة",
  internal_review: "مراجعة داخلية",
  legal_review: "مراجعة قانونية",
  client_permission_required: "بانتظار إذن العميل",
  client_permission_received: "وصل إذن العميل",
  approved: "معتمَدة",
  scheduled: "مجدولة",
  published: "منشورة",
  unpublished: "مسحوبة",
  archived: "مؤرشَفة",
};
