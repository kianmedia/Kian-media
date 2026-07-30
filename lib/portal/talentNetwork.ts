// ════════════════════════════════════════════════════════════════════════════
// lib/portal/talentNetwork.ts — المراحل ٩–١٢: شبكة المواهب والمستقلّين
// والمورّدين.
//
// ★ الكود يسبق الـSQL ★ كلّ نداء هنا مكتشِف للميزة: إن لم تُطبَّق الترحيلة بعد
// نُعيد `pending_migration` كي تعرض الواجهة «الميزة بانتظار تفعيل قاعدة
// البيانات» — لا انهيار، ولا بيانات وهمية، ولا صفر يقف مقام «غير مفعّل».
//
// ★ ثلاث قواعد لا تُخترق في هذه الطبقة ★
//   ١) الأجر لا يُحسب ولا يُخمَّن في المتصفّح. الخادم يعيد `rates_visible`
//      و`day_rate = null` لغير المخوَّل؛ نعرض «غير مصرّح» لا صفرًا ولا شرطة
//      تُقرأ كأنّها مجّانًا.
//   ٢) الاقتراح لا يُسند. لا توجد هنا دالّة تختار مرشّحًا تلقائيًّا؛ الاختيار
//      فعل بشريّ صريح ثمّ نداء propose منفصل.
//   ٣) 23P01 (تعارض) ليس ترحيلة ناقصة. الخلط بينهما يجعل «هذا الشخص مشغول
//      في ذلك اليوم» يظهر كأنّه عطل في قاعدة البيانات.
// ════════════════════════════════════════════════════════════════════════════
import { prpc, type Result } from "./client";
import { pgClassify, pgIsMigrationPending, type PgDiagnosis } from "./pgerror";

// ─── المفردات ──────────────────────────────────────────────────────────────
export type ProfileType =
  | "employee_candidate" | "freelancer" | "crew_member" | "production_company"
  | "equipment_vendor" | "service_vendor" | "studio" | "location_provider"
  | "transport_provider" | "accommodation_provider" | "voice_talent"
  | "creative_talent" | "other";

export const PROFILE_TYPE_AR: Record<ProfileType, string> = {
  employee_candidate: "مرشّح توظيف",
  freelancer: "مستقلّ",
  crew_member: "فرد طاقم",
  production_company: "شركة إنتاج",
  equipment_vendor: "مورّد معدّات",
  service_vendor: "مورّد خدمات",
  studio: "استوديو",
  location_provider: "مزوّد مواقع تصوير",
  transport_provider: "مزوّد نقل",
  accommodation_provider: "مزوّد إقامة",
  voice_talent: "موهبة صوتية",
  creative_talent: "موهبة إبداعية",
  other: "أخرى",
};

export type ProfileStatus = "draft" | "active" | "inactive" | "suspended" | "blocked";
export const PROFILE_STATUS_AR: Record<ProfileStatus, string> = {
  draft: "مسودّة", active: "نشط", inactive: "غير نشط",
  suspended: "موقوف مؤقّتًا", blocked: "محظور",
};

export type AvailabilityState =
  | "available" | "unavailable" | "tentative" | "booked" | "blocked" | "pending_confirmation";
export const AVAILABILITY_STATE_AR: Record<AvailabilityState, string> = {
  available: "متاح", unavailable: "غير متاح", tentative: "مبدئيّ",
  booked: "محجوز", blocked: "محجوب", pending_confirmation: "بانتظار التأكيد",
};

export type AssignmentStatus =
  | "proposed" | "pending_approval" | "approved" | "confirmed"
  | "rejected" | "cancelled" | "completed" | "closed";
export const ASSIGNMENT_STATUS_AR: Record<AssignmentStatus, string> = {
  proposed: "مُقترح", pending_approval: "بانتظار اعتماد التكلفة", approved: "معتمَد",
  confirmed: "مؤكَّد", rejected: "مرفوض", cancelled: "ملغى",
  completed: "منتهٍ", closed: "مقفل",
};

/** أسباب المنع الصلبة كما يعيدها الخادم — تُترجَم حرفيًّا، بلا تعميم. */
export const BLOCKER_AR: Record<string, string> = {
  profile_not_assignable: "الملفّ غير قابل للإسناد (موقوف أو محظور أو غير نشط).",
  required_document_invalid: "وثيقة إلزامية ناقصة أو منتهية أو غير موثَّقة.",
  job_document_invalid: "وثيقة مطلوبة لهذه المهمّة تحديدًا غير صالحة.",
  drone_permit_missing: "لا يوجد تصريح درون ساري وموثَّق، والمهمّة تتطلّبه.",
  schedule_conflict: "تعارض زمنيّ: ارتباط قائم أو نافذة غير متاحة.",
  city_not_covered: "المدينة خارج التغطية ولا استعداد للسفر.",
  travel_refused: "المهمّة تتطلّب سفرًا ولا استعداد له.",
  above_price_band: "السعر خارج النطاق المصرّح به.",
  profile_not_found: "الملفّ غير موجود.",
};
export const blockerAr = (rule: string): string =>
  BLOCKER_AR[rule] ?? `مانع غير معروف: ${rule}`;

// ─── نتيجة مكتشِفة للميزة ──────────────────────────────────────────────────
export type TvnOutcome<T> =
  | { state: "ok"; data: T }
  | { state: "pending_migration"; message: string; diagnosis: PgDiagnosis }
  | { state: "denied"; message: string; diagnosis: PgDiagnosis }
  | { state: "conflict"; message: string; diagnosis: PgDiagnosis }
  | { state: "blocked"; message: string; blockers: string[] }
  | { state: "error"; message: string; diagnosis: PgDiagnosis };

const PENDING_AR = "الميزة بانتظار تفعيل قاعدة البيانات.";

/** استخراج قائمة الموانع من رسالة `assignment blocked: [...]` القادمة من الخادم. */
function parseBlockers(raw: string): string[] | null {
  if (!/assignment blocked/i.test(raw)) return null;
  const rules = Array.from(raw.matchAll(/"rule"\s*:\s*"([a-z_]+)"/g)).map((m) => m[1]);
  return rules.length > 0 ? rules : ["profile_not_assignable"];
}

/**
 * ★ 23P01 ليس ترحيلة ناقصة ★
 * المُصنِّف المشترك lib/portal/pgerror.ts لا يعرف بعد نوعًا اسمه "conflict"
 * (أنواعه المُعرَّفة لا تشمل 23P01)، ولن نوسّعه من داخل هذه الحزمة: توسيع
 * مُصنِّف مشترك يلمس كلّ موديول. فنكتشف التعارض هنا صراحةً، ونظلّ نستفيد من
 * التشخيص المشترك في كلّ شيء آخر. ⚠️ الخلط بين الاثنين يجعل «هذا الشخص مشغول
 * في ذلك اليوم» يظهر للمستخدم كأنّه عطل في قاعدة البيانات، فيبحث عن ترحيلة
 * لا وجود لها بدل أن يغيّر التاريخ.
 */
function isConflict(raw: string, d: PgDiagnosis): boolean {
  if (d.code === "23P01") return true;
  return /\b23P01\b|exclusion constraint|^conflict:/i.test(String(raw ?? ""));
}

function toOutcome<T>(r: Result<T>): TvnOutcome<T> {
  if (r.ok) return { state: "ok", data: r.data };
  const d = pgClassify(r.error, r.status);
  const blockers = parseBlockers(r.error);
  if (blockers) {
    return {
      state: "blocked",
      message: "تعذّر الإسناد: " + blockers.map(blockerAr).join(" · "),
      blockers,
    };
  }
  // التعارض يُفحَص **قبل** أيّ حكم آخر، كي لا يُبتلَع تحت "unknown".
  if (isConflict(r.error, d)) {
    return { state: "conflict", message: r.error, diagnosis: d };
  }
  if (pgIsMigrationPending(d)) {
    return { state: "pending_migration", message: PENDING_AR, diagnosis: d };
  }
  if (d.kind === "permission_denied" || d.kind === "not_authenticated") {
    return { state: "denied", message: "لا تملك صلاحية هذا الإجراء.", diagnosis: d };
  }
  return { state: "error", message: r.error, diagnosis: d };
}

const call = async <T>(fn: string, args?: Record<string, unknown>): Promise<TvnOutcome<T>> =>
  toOutcome<T>(await prpc<T>(fn, args));

// ─── القدرات ───────────────────────────────────────────────────────────────
export interface TvnAccess {
  installed: boolean;
  can_view: boolean;
  can_manage_profiles: boolean;
  can_view_rates: boolean;
  can_view_bank: boolean;
  can_verify: boolean;
  can_assign: boolean;
  can_review: boolean;
  can_approve_cost: boolean;
  hub_installed: boolean;
  vendor_bridge: boolean;
  opportunity_surface: boolean;
}

/** خريطة القدرات الحقيقية. عند غياب الترحيلة نُعيد كل شيء false بلا ادّعاء. */
export const tvnAccess = () => call<TvnAccess>("tvn_access");

export const TVN_ACCESS_CLOSED: TvnAccess = {
  installed: false, can_view: false, can_manage_profiles: false, can_view_rates: false,
  can_view_bank: false, can_verify: false, can_assign: false, can_review: false,
  can_approve_cost: false, hub_installed: false, vendor_bridge: false,
  opportunity_surface: false,
};

// ─── الملفّات ──────────────────────────────────────────────────────────────
export interface TvnRating {
  ranked: boolean;
  reason?: string;
  sample?: number;
  min_sample?: number;
  overall?: number;
  reliability?: number;
  quality?: number;
  timeliness?: number;
  communication?: number;
  safety?: number;
  equipment_handling?: number;
  client_conduct?: number;
  incidents?: number;
}

/** نصّ التقييم — «لا يوجد ترتيب بعد» ليست صفرًا ولا ضعف أداء. */
export function ratingAr(r: TvnRating | null | undefined): string {
  if (!r) return "غير متاح";
  if (!r.ranked) {
    if (r.reason === "insufficient_sample") {
      return `لا ترتيب بعد (${r.sample ?? 0} من ${r.min_sample ?? 3} تقييمات مطلوبة)`;
    }
    return "غير متاح";
  }
  return `${r.overall ?? "—"} / 5 · عيّنة ${r.sample}`;
}

export interface TvnProfileRow {
  id: string;
  profile_code: string | null;
  display_name: string;
  profile_type: ProfileType;
  status: ProfileStatus;
  city: string | null;
  coverage_cities: string[];
  professions: string[];
  skills: string[];
  languages: string[];
  travel_willing: boolean;
  remote_available: boolean;
  rating: TvnRating;
  missing_required_docs: string[];
}

export const tvnProfileList = (filters: Record<string, unknown> = {}) =>
  call<{ rows: TvnProfileRow[] }>("tvn_profile_list", { p_filters: filters });

export const tvnProfileGet = (id: string) =>
  call<Record<string, unknown>>("tvn_profile_get", { p_id: id });

export const tvnProfileUpsert = (input: Record<string, unknown>) =>
  call<{ ok: boolean; id: string; created: boolean }>("tvn_profile_upsert", { p_input: input });

export const tvnProfileSetStatus = (id: string, status: ProfileStatus, reason: string) =>
  call<{ ok: boolean }>("tvn_profile_set_status", { p_id: id, p_status: status, p_reason: reason });

// ─── الأجر · بيانات بنكية · حقل مقيَّد ──────────────────────────────────────
export const tvnRatesSet = (profileId: string, input: Record<string, unknown>) =>
  call<{ ok: boolean; id: string }>("tvn_rates_set", { p_profile: profileId, p_input: input });

export const tvnBankSet = (profileId: string, input: Record<string, unknown>) =>
  call<{ ok: boolean }>("tvn_bank_set", { p_profile: profileId, p_input: input });

/**
 * الحقل المقيَّد. ★ الغرض التشغيليّ الموثَّق إلزاميّ ★ ولا يدخل هذا الحقل أيّ
 * ترشيح أو تقييم أو ترتيب تجاريّ — الخادم لا يقرأه في أيّ من تلك المسارات.
 */
export const tvnRestrictedSet = (profileId: string, gender: string | null, purpose: string) =>
  call<{ ok: boolean }>("tvn_restricted_set", {
    p_profile: profileId, p_gender: gender, p_purpose: purpose,
  });

/** عرض الأجر: null ⇒ «غير مصرّح»، لا صفر ولا فراغ يُقرأ كأنّه بلا تكلفة. */
export function rateAr(value: number | null | undefined, visible: boolean, currency = "SAR"): string {
  if (!visible) return "غير مصرّح لك بعرض الأجر";
  if (value === null || value === undefined) return "لم يُسجَّل بعد";
  return `${value} ${currency}`;
}

// ─── التوافر ───────────────────────────────────────────────────────────────
export const tvnAvailabilitySet = (input: Record<string, unknown>) =>
  call<{ ok: boolean; id: string }>("tvn_availability_set", { p_input: input });

export const tvnAvailabilityConfirm = (id: string, status: string) =>
  call<{ ok: boolean }>("tvn_availability_confirm", { p_id: id, p_status: status });

// ─── الوثائق ───────────────────────────────────────────────────────────────
export const tvnDocumentUpsert = (input: Record<string, unknown>) =>
  call<{ ok: boolean; id: string; verified: boolean }>("tvn_document_upsert", { p_input: input });

/** التوثيق فعل منفصل بفاعل مختلف عن الرافع. الرفع وحده لا يجعل الوثيقة صالحة. */
export const tvnDocumentVerify = (id: string, note?: string) =>
  call<{ ok: boolean }>("tvn_document_verify", { p_id: id, p_note: note ?? null });

export interface TvnDocAlerts {
  reminder_days: number[];
  expiring: Array<Record<string, unknown>>;
  missing_required: Array<{ profile_id: string; display_name: string; missing: string[] }>;
  scanned: boolean;
  events_considered: number;
}
export const tvnDocumentAlerts = (scan = false) =>
  call<TvnDocAlerts>("tvn_document_alerts", { p_scan: scan });

// ─── الاقتراح ثمّ الإسناد ──────────────────────────────────────────────────
export interface TvnCandidate {
  profile_id: string;
  display_name: string;
  profile_type: ProfileType;
  city: string | null;
  professions: string[];
  score: number;
  reasons: Array<{ rule: string; weight: number; detail?: string }>;
  blockers: Array<{ rule: string; detail?: string }>;
  assignable: boolean;
  rating: TvnRating;
  day_rate: number | null;
  rate_visible: boolean;
}
export interface TvnSuggestion {
  engine: "rule_based";
  auto_assign: false;
  note_ar: string;
  candidates: TvnCandidate[];
}

/**
 * ★ اقتراح فقط ★ محرّك قاعديّ صريح لا نموذج. لا يوجد في هذه الطبقة أيّ مسار
 * يأخذ أعلى مرشّح ويُسنده: الاختيار فعل بشريّ، ثمّ tvnAssignmentPropose.
 */
export const tvnSuggest = (input: Record<string, unknown>) =>
  call<TvnSuggestion>("tvn_suggest", { p_input: input });

export const tvnAssignmentPropose = (input: Record<string, unknown>) =>
  call<{ ok: boolean; id: string; assignment_number: string; status: AssignmentStatus; approval_required: boolean }>(
    "tvn_assignment_propose", { p_input: input });

export const tvnAssignmentApprove = (id: string, decision: "approved" | "rejected", note?: string) =>
  call<{ ok: boolean }>("tvn_assignment_approve", { p_id: id, p_decision: decision, p_note: note ?? null });

export const tvnAssignmentConfirm = (id: string) =>
  call<{ ok: boolean; status: AssignmentStatus }>("tvn_assignment_confirm", { p_id: id });

export const tvnAssignmentCancel = (id: string, reason: string) =>
  call<{ ok: boolean }>("tvn_assignment_cancel", { p_id: id, p_reason: reason });

export const tvnAssignmentComplete = (id: string) =>
  call<{ ok: boolean; status: AssignmentStatus }>("tvn_assignment_complete", { p_id: id });

// ─── التقييمات ─────────────────────────────────────────────────────────────
export const tvnReviewSubmit = (input: Record<string, unknown>) =>
  call<{ ok: boolean; id: string }>("tvn_review_submit", { p_input: input });

export const tvnReviewClose = (id: string) =>
  call<{ ok: boolean }>("tvn_review_close", { p_id: id });

/** التصحيح يُلحَق بسبب مكتوب ولا يعدّل الصفّ المقفل. لا توجد دالّة حذف — عمدًا. */
export const tvnReviewCorrect = (id: string, field: string, newValue: string, reason: string) =>
  call<{ ok: boolean; id: string }>("tvn_review_correct", {
    p_id: id, p_field: field, p_new_value: newValue, p_reason: reason,
  });

export const tvnReviewsForProfile = (profileId: string) =>
  call<{ rows: Array<Record<string, unknown>>; rating: TvnRating }>(
    "tvn_reviews_for_profile", { p_profile: profileId });

// ─── الترقية اليدوية والجسر ────────────────────────────────────────────────
/**
 * ★ يدويّ بالكامل ★ لا استيراد تلقائيّ من سطح الفرص العامّ، ولا رسالة تُرسَل
 * إلى المتقدّم من هنا. القبول قرار بشريّ يُتَّخذ خارج النظام، وهذا النداء يسجّله.
 */
export const tvnPromoteOpportunity = (
  requestId: string, profileType: ProfileType, overrides: Record<string, unknown> = {},
) => call<{ ok: boolean; id: string; note: string }>("tvn_promote_opportunity", {
  p_request: requestId, p_profile_type: profileType, p_overrides: overrides,
});

/** يربط صفّ الشراء القائم بملفّ الشبكة — مورّد واحد لا مورّدان. */
export const tvnVendorLink = (profileId: string, vendorId: string) =>
  call<{ ok: boolean; reason?: string; note?: string }>("tvn_vendor_link", {
    p_profile: profileId, p_vendor: vendorId,
  });

/** مسح دوريّ يُدرج أحداثًا فقط. ⛔ لا شيء يُرسَل من هنا ولا من الخادم. */
export const tvnScanAlerts = () =>
  call<{ availability_considered: number; reviews_considered: number; note_ar: string }>("tvn_scan_alerts");
