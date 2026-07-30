// ════════════════════════════════════════════════════════════════════════════
// lib/portal/compliance.ts — المراحل ٢–٥: مركز المورّد والامتثال.
//
// ★ الكود يسبق الـSQL ★ كلّ نداء هنا مكتشِف للميزة: إن لم تُطبَّق الترحيلة بعد
// نُعيد `pending_migration` كي تعرض الشاشة «الميزة بانتظار تفعيل قاعدة
// البيانات» — لا انهيار، ولا بيانات وهمية، ولا صفر يقف مقام «غير مفعّل».
//
// ★ أربع قواعد لا تُخترق في هذه الطبقة ★
//   ١) **الرفع ليس توثيقًا.** لا توجد هنا دالّة ترفع وتوثّق في نداء واحد.
//      الرفع `complianceDocumentRegister` والتوثيق `complianceDocumentDecide`
//      نداءان منفصلان، والخادم يرفض أن يوثّق الرافعُ ملفَّه.
//   ٢) **الرمز يظهر مرّة واحدة.** `complianceGrantIssue` هي الموضع الوحيد الذي
//      يعود فيه الرمز الخام، ولا يُخزَّن في localStorage ولا في أيّ حالة
//      مستمرّة. مسؤولية النسخ على المستخدم، ونقولها له صراحةً.
//   ٣) **لا إرسال.** لا دالّة هنا ترسل بريدًا أو رسالة. الحالة بعد الإصدار
//      «جاهز للمشاركة اليدوية».
//   ٤) **«غير مصرّح» ليس «غير موجود».** الخادم يعيد `can_view_restricted`
//      و`scope`؛ نعرض المنع بوصفه منعًا، لا قائمة فارغة تُقرأ «لا وثائق لدينا».
// ════════════════════════════════════════════════════════════════════════════
import { prpc, type Result } from "./client";
import { pgClassify, pgIsMigrationPending, type PgDiagnosis } from "./pgerror";
import { SUPABASE_URL, SUPABASE_KEY, getValidSession } from "@/lib/portalAuth";

// ─── المفردات ──────────────────────────────────────────────────────────────

/** الحالات الثمانية. الانتهاء **مشتقّ** من تاريخ الانتهاء ولا يُخزَّن بائتًا. */
export type DocStatus =
  | "draft" | "uploaded" | "pending_verification" | "verified"
  | "rejected" | "expired" | "archived" | "revoked";

export const DOC_STATUS_AR: Record<DocStatus, string> = {
  draft: "مسودّة",
  uploaded: "مرفوعة (غير موثَّقة)",
  pending_verification: "بانتظار التوثيق",
  verified: "موثَّقة",
  rejected: "مرفوضة",
  expired: "منتهية",
  archived: "مؤرشفة",
  revoked: "ملغاة",
};

/** ⚠️ «مرفوعة» ليست «صالحة». هذا النصّ يُعرَض بجانب الحالة كي لا يُقرأ الرفع توثيقًا. */
export const DOC_STATUS_HINT_AR: Partial<Record<DocStatus, string>> = {
  uploaded: "الملفّ موجود، لكنّه لم يُوثَّق بعد — لا يُحتسب في الجاهزية ولا يُشارَك.",
  pending_verification: "بانتظار مُوثِّق غير الشخص الذي رفعها.",
  expired: "كانت موثَّقة وانتهت. تحتاج إصدارًا جديدًا.",
  revoked: "أُلغيت. كلّ رابط يحملها توقّف فورًا.",
  archived: "أُرشفت لصالح إصدار أحدث.",
};

export type Sensitivity = "public" | "internal" | "confidential" | "restricted";
export const SENSITIVITY_AR: Record<Sensitivity, string> = {
  public: "عامّة",
  internal: "داخلية",
  confidential: "سرّية",
  restricted: "مقيَّدة",
};

export type ReadinessState =
  | "ready" | "ready_with_warnings" | "incomplete" | "expired_blockers" | "not_configured";

export const READINESS_STATE_AR: Record<ReadinessState, string> = {
  ready: "جاهز",
  ready_with_warnings: "جاهز مع تحذيرات",
  incomplete: "ناقص",
  expired_blockers: "موانع منتهية",
  not_configured: "لم تُعدّ القواعد بعد",
};

/** ★ «لم تُعدّ القواعد» ليست «غير جاهز» ★ ولا تُعرَض صفرًا. */
export const READINESS_IS_UNKNOWN = (s: ReadinessState): boolean => s === "not_configured";

export type RequirementVerdict =
  | "met" | "missing" | "unverified" | "expired" | "wrong_language" | "wrong_version";

export const VERDICT_AR: Record<RequirementVerdict, string> = {
  met: "مستوفًى",
  missing: "ناقص",
  unverified: "غير موثَّق",
  expired: "منتهٍ",
  wrong_language: "لغة غير مطابقة",
  wrong_version: "إصدار أقدم من المطلوب",
};

export type RegistrationStatus =
  | "received" | "under_review" | "information_required" | "preparing_documents"
  | "pending_owner_approval" | "ready_for_manual_submission" | "submitted_manually"
  | "accepted" | "rejected" | "expired" | "closed";

export const REGISTRATION_STATUS_AR: Record<RegistrationStatus, string> = {
  received: "وارد",
  under_review: "قيد المراجعة",
  information_required: "بانتظار معلومات",
  preparing_documents: "تجهيز الوثائق",
  pending_owner_approval: "بانتظار اعتماد المالك",
  ready_for_manual_submission: "جاهز للتسليم اليدويّ",
  submitted_manually: "سُلّم يدويًّا",
  accepted: "مقبول",
  rejected: "مرفوض",
  expired: "منتهٍ",
  closed: "مقفل",
};

/**
 * ★★ لا ادّعاء تقديم إلكترونيّ ★★
 * «سُلّم يدويًّا» تعني أنّ موظّفًا مخوّلًا سجّل التسليم بمرجع وقناة. النظام لا
 * يقدّم شيئًا إلى أيّ بوّابة مشتريات، ولا يوجد في هذا الملفّ ولا في الخادم
 * أيّ مسار يفعل ذلك.
 */
export const SUBMISSION_TRUTH_AR =
  "النظام لا يقدّم إلكترونيًّا. «سُلّم يدويًّا» = تسجيل بشريّ بمرجع وقناة وفاعل.";

export type GrantStatus =
  | "draft" | "pending_approval" | "approved" | "active" | "expired" | "revoked" | "exhausted";

export const GRANT_STATUS_AR: Record<GrantStatus, string> = {
  draft: "مسودّة",
  pending_approval: "بانتظار الاعتماد",
  approved: "معتمَد (لم يُصدر رمز)",
  active: "جاهز للمشاركة اليدوية",
  expired: "منتهٍ",
  revoked: "ملغى",
  exhausted: "استُنفد",
};

/** أسباب رفض الاسترداد كما يعيدها الخادم — تُترجَم حرفيًّا بلا تعميم. */
export const GRANT_DENY_AR: Record<string, string> = {
  invalid_or_expired: "الرابط غير صالح أو انتهت صلاحيته.",
  download_not_allowed: "هذه الوثيقة للعرض فقط — التنزيل غير مسموح في هذه المنحة.",
  download_limit_reached: "استُنفد عدد التنزيلات المسموح به.",
  not_in_grant: "هذه الوثيقة ليست ضمن هذا الرابط.",
  document_no_longer_valid: "الوثيقة لم تعد سارية (أُلغيت أو انتهت) — الرابط توقّف عنها.",
  document_required: "لم تُحدَّد وثيقة.",
  no_file: "لا يوجد ملفّ مرفوع لهذه الوثيقة.",
};
export const grantDenyAr = (reason: string): string =>
  GRANT_DENY_AR[reason] ?? "تعذّر فتح الرابط.";

// ─── نتيجة مكتشِفة للميزة ──────────────────────────────────────────────────
export type VccOutcome<T> =
  | { state: "ok"; data: T }
  | { state: "pending_migration"; message: string; diagnosis: PgDiagnosis }
  | { state: "denied"; message: string; diagnosis: PgDiagnosis }
  | { state: "conflict"; message: string; diagnosis: PgDiagnosis }
  | { state: "validation"; message: string }
  | { state: "error"; message: string; diagnosis: PgDiagnosis };

const PENDING_AR = "الميزة بانتظار تفعيل قاعدة البيانات.";

/**
 * ★ التعارض ليس ترحيلة ناقصة ★ و«تحقّق من المدخلات» ليس عطلًا.
 * الخادم يرفع `validation: …` و`conflict: …` بنصّ عربيّ مقروء. لو مرّرناهما
 * إلى مُصنِّف SQLSTATE لظهرا "unknown"، ولبحث المستخدم عن ترحيلة لا وجود لها
 * بدل أن يصحّح حقلًا. (نفس الدرس الذي وثّقه lib/portal/pgerror.ts.)
 */
function serverIntent(raw: string): "validation" | "conflict" | null {
  const s = String(raw ?? "");
  if (/^\s*validation:/i.test(s)) return "validation";
  if (/^\s*conflict:/i.test(s) || /\b23P01\b/.test(s)) return "conflict";
  return null;
}

function stripPrefix(raw: string): string {
  return String(raw ?? "").replace(/^\s*(validation|conflict|not found|not authorized)\s*:\s*/i, "").trim();
}

function toOutcome<T>(r: Result<T>): VccOutcome<T> {
  if (r.ok) return { state: "ok", data: r.data };
  const d = pgClassify(r.error, r.status);
  const intent = serverIntent(r.error);
  if (intent === "validation") {
    return { state: "validation", message: stripPrefix(r.error) || "مدخلات غير مقبولة." };
  }
  if (intent === "conflict") {
    return { state: "conflict", message: stripPrefix(r.error) || "تعارض في الحالة.", diagnosis: d };
  }
  if (pgIsMigrationPending(d)) {
    return { state: "pending_migration", message: PENDING_AR, diagnosis: d };
  }
  if (d.kind === "permission_denied" || d.kind === "not_authenticated"
      || /^\s*not authorized/i.test(String(r.error ?? ""))) {
    // ⚠️ منع صلاحية — **لا يُقال عنه أبدًا** إنّه ترحيلة معلّقة.
    return {
      state: "denied",
      message: stripPrefix(r.error) || "لا تملك صلاحية هذا الإجراء.",
      diagnosis: d,
    };
  }
  return { state: "error", message: r.error, diagnosis: d };
}

const call = async <T>(fn: string, args?: Record<string, unknown>): Promise<VccOutcome<T>> =>
  toOutcome<T>(await prpc<T>(fn, args));

// ─── القدرات ───────────────────────────────────────────────────────────────
export interface VccAccess {
  installed: boolean;
  can_view: boolean;
  can_manage_documents: boolean;
  can_verify_documents: boolean;
  can_issue_grants: boolean;
  can_view_restricted: boolean;
  can_manage_registration: boolean;
  can_view_request_status: boolean;
  can_view_operational: boolean;
  is_owner: boolean;
  hub_installed: boolean;
  opportunity_surface: boolean;
  storage_bucket: string;
  /** ★ ثابتة false ★ تُقرأ في الواجهة كي لا تَعِد الشاشة بما لا يحدث. */
  delivery_enabled: boolean;
  note_ar: string;
}

export const VCC_ACCESS_CLOSED: VccAccess = {
  installed: false, can_view: false, can_manage_documents: false, can_verify_documents: false,
  can_issue_grants: false, can_view_restricted: false, can_manage_registration: false,
  can_view_request_status: false, can_view_operational: false, is_owner: false,
  hub_installed: false, opportunity_surface: false, storage_bucket: "compliance-documents",
  delivery_enabled: false, note_ar: "",
};

export const complianceAccess = () => call<VccAccess>("vcc_access");

// ─── ملفّ الشركة ───────────────────────────────────────────────────────────
export interface CompanyBundle {
  profile: Record<string, unknown>;
  contacts: Array<Record<string, unknown>>;
  certifications: Array<Record<string, unknown>>;
  references: Array<Record<string, unknown>>;
  experience: Array<Record<string, unknown>>;
  drone: Array<Record<string, unknown>>;
}

export const companyGet = () => call<CompanyBundle>("vcc_company_get");
export const companySet = (input: Record<string, unknown>) =>
  call<{ ok: boolean }>("vcc_company_set", { p_input: input });

export const contactUpsert = (input: Record<string, unknown>) =>
  call<{ ok: boolean; id: string }>("vcc_contact_upsert", { p_input: input });
export const certificationUpsert = (input: Record<string, unknown>) =>
  call<{ ok: boolean; id: string }>("vcc_certification_upsert", { p_input: input });
export const referenceUpsert = (input: Record<string, unknown>) =>
  call<{ ok: boolean; id: string }>("vcc_reference_upsert", { p_input: input });
export const experienceUpsert = (input: Record<string, unknown>) =>
  call<{ ok: boolean; id: string }>("vcc_experience_upsert", { p_input: input });
export const droneUpsert = (input: Record<string, unknown>) =>
  call<{ ok: boolean; id: string }>("vcc_drone_upsert", { p_input: input });

// ─── الوثائق ───────────────────────────────────────────────────────────────
export interface ComplianceDocument {
  id: string;
  doc_type: string;
  label_ar: string | null;
  label_en: string | null;
  title: string | null;
  doc_language: string | null;
  issuer: string | null;
  /** null ⇒ غير مصرّح لك، لا «غير مسجَّل». */
  doc_number_masked: string | null;
  doc_version: number;
  issued_on: string | null;
  expires_on: string | null;
  days_left: number | null;
  status: DocStatus;
  stored_status: DocStatus;
  verified: boolean;
  verified_by: string | null;
  verified_at: string | null;
  verification_note: string | null;
  sensitivity: Sensitivity;
  restricted: boolean;
  is_downloadable: boolean;
  watermark_required: boolean;
  never_public: boolean;
  file_name: string | null;
  file_mime: string | null;
  file_bytes: number | null;
  checksum_sha256: string | null;
  has_file: boolean;
  internal_notes: string | null;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface DocumentListResult {
  rows: ComplianceDocument[];
  can_view_restricted: boolean;
  scope: "full" | "operational_only";
  note_ar: string | null;
}

export const documentList = (filters: Record<string, unknown> = {}) =>
  call<DocumentListResult>("vcc_document_list", { p_filters: filters });

/**
 * تسجيل وثيقة (أو إصدار جديد منها). ⛔ لا تقبل `verified` مهما أُرسل، والخادم
 * يتجاهله بنيويًّا. مرجع التخزين يُثبَّت على الـbucket الواحد في قاعدة البيانات.
 */
export const complianceDocumentRegister = (input: Record<string, unknown>) =>
  call<{ ok: boolean; id: string; verified: false; status: DocStatus; note_ar: string }>(
    "vcc_document_register", { p_input: input });

/** ★ فعل منفصل بفاعل آخر ★ الخادم يرفض أن يوثّق الرافعُ ملفَّه. */
export const complianceDocumentDecide = (
  id: string, decision: "verified" | "rejected", note: string,
) => call<{ ok: boolean; id: string; status: string }>(
  "vcc_document_decide", { p_id: id, p_decision: decision, p_note: note });

/** الأرشفة والإلغاء يُنزلان الوثيقة من دائرة الصلاحية فورًا. */
export const complianceDocumentSetStatus = (
  id: string, status: "archived" | "revoked" | "expired", reason: string,
) => call<{ ok: boolean; id: string; status: string; active_grants_now_blocked: number; note_ar: string }>(
  "vcc_document_set_status", { p_id: id, p_status: status, p_reason: reason });

/**
 * مرجع التخزين لوثيقة واحدة. الواجهة توقّعه **بهوية المستخدم** عبر
 * `createSignedUrl` تحت سياسة التخزين — لا مفتاح خدمة في المتصفّح، ولا توقيع
 * لمسار يرسله المتصل.
 */
export const complianceDocumentStorageRef = (id: string) =>
  call<{ ok: boolean; bucket: string; path: string; watermark_required: boolean; file_name: string | null }>(
    "vcc_document_storage_ref", { p_id: id });

export const COMPLIANCE_BUCKET = "compliance-documents";

/**
 * ★★ التخزين يُقرأ ويُكتب **بهوية المستخدم** ★★
 * لا مفتاح خدمة في المتصفّح، ولا مسار يُوقَّع نيابةً عن المتصل. سياسة
 * storage.objects هي التي تقرّر، وvcc_storage_readable تقرأ حساسية الصفّ نفسه
 * — فملفّ وثيقة مقيَّدة لا يُقرأ بمجرّد امتلاك «رؤية المركز»، ولا يُقرأ ملفّ
 * بلا صفّ في السجلّ إطلاقًا.
 */
async function storageFetch(path: string, init: RequestInit): Promise<Response> {
  const s = await getValidSession();
  if (!s) throw new Error("not_authenticated");
  const doFetch = (t: string) =>
    fetch(`${SUPABASE_URL}/storage/v1${path}`, {
      ...init,
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${t}`, ...(init.headers || {}) },
    });
  let res = await doFetch(s.access_token);
  if (res.status === 401) {
    const s2 = await getValidSession();
    if (s2) res = await doFetch(s2.access_token);
  }
  return res;
}

/** رفع ملفّ وثيقة. ⚠️ لا `x-upsert`: الكتابة إضافية فقط، فلا يُبدَّل ملفّ تحت وثيقة موثَّقة. */
export async function complianceUpload(path: string, file: File): Promise<Result<string>> {
  try {
    const res = await storageFetch(`/object/${COMPLIANCE_BUCKET}/${path}`, {
      method: "POST",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
    if (!res.ok) return { ok: false, error: `upload_failed_${res.status}`, status: res.status };
    return { ok: true, data: path };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/** توقيع مؤقّت للعرض الداخليّ. ★ يُطلب المرجع من الخادم أوّلًا، ثمّ يُوقَّع. ★ */
export async function complianceSign(path: string, ttlSeconds = 120): Promise<string | null> {
  try {
    const res = await storageFetch(`/object/sign/${COMPLIANCE_BUCKET}/${encodeURI(path)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expiresIn: ttlSeconds }),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { signedURL?: string };
    return j.signedURL ? `${SUPABASE_URL}/storage/v1${j.signedURL}` : null;
  } catch {
    return null;
  }
}

/** مسار رفع صالح للقيد الجدوليّ: `company/{uuid}/{filename}`. */
export function buildCompanyStoragePath(fileName: string): string {
  const safe = (fileName || "file")
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/^[^A-Za-z0-9]+/, "")
    .slice(0, 120) || "file";
  const uuid = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(16)}-0000-4000-8000-000000000000`;
  return `company/${uuid}/${safe}`;
}

// ─── الجاهزية ──────────────────────────────────────────────────────────────
export interface ReadinessRow {
  requirement_key: string;
  context: string;
  kind: "document" | "profile_field" | "capability";
  doc_type: string | null;
  profile_field: string | null;
  label_ar: string;
  label_en: string;
  is_mandatory: boolean;
  verdict: RequirementVerdict;
  /** ★ السبب مكتوب من الخادم ★ لا نُعيد صياغته في المتصفّح كي لا يتباعد الشرح عن الحكم. */
  reason_ar: string;
  document_id: string | null;
  note_ar: string | null;
}

export interface ReadinessResult {
  engine: "rule_based";
  ai_used: false;
  context: string;
  state: ReadinessState;
  requirements_total: number;
  mandatory_total: number;
  mandatory_met: number;
  mandatory_missing: number;
  mandatory_expired: number;
  warnings: number;
  warning_window_days: number;
  rows: ReadinessRow[];
  note_ar: string;
}

export const complianceReadiness = (context = "general") =>
  call<ReadinessResult>("vcc_readiness", { p_context: context });

/**
 * نصّ الجاهزية. ★ «لم تُعدّ القواعد» لا تُعرَض «٠٪» ★ — صفر في مكان «غير مُعدّ»
 * يجعل المالك يظنّ أنّ شركته غير ممتثلة بينما لم يُكتب أيّ متطلَّب بعد.
 */
export function readinessAr(r: ReadinessResult | null | undefined): string {
  if (!r) return "غير متاح";
  if (r.state === "not_configured") return "لم تُعدّ قواعد الجاهزية بعد";
  return `${READINESS_STATE_AR[r.state]} — ${r.mandatory_met} من ${r.mandatory_total} متطلَّبًا إلزاميًّا`;
}

// ─── المنح الآمنة ──────────────────────────────────────────────────────────
export interface DocumentGrant {
  id: string;
  grant_code: string | null;
  request_id: string | null;
  recipient_org: string;
  recipient_name: string;
  recipient_email: string | null;
  purpose: string;
  status: GrantStatus;
  starts_at: string;
  expires_at: string;
  max_opens: number;
  opens_used: number;
  max_downloads: number;
  downloads_used: number;
  watermark_identity: string;
  /** آخر ستّة محارف — للتمييز البصريّ فقط. البصمة الكاملة لا تخرج من القاعدة أبدًا. */
  token_hint: string | null;
  token_issued_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  revoked_at: string | null;
  revoke_reason: string | null;
  documents: number;
  created_at: string;
}

export const grantList = (filters: Record<string, unknown> = {}) =>
  call<{ rows: DocumentGrant[]; delivery_enabled: false; note_ar: string }>(
    "vcc_grant_list", { p_filters: filters });

export const grantCreate = (input: Record<string, unknown>) =>
  call<{ ok: boolean; id: string; grant_code: string; status: GrantStatus; expires_at: string; note_ar: string }>(
    "vcc_grant_create", { p_input: input });

export const grantAddDocument = (grantId: string, documentId: string, allowDownload = false) =>
  call<{ ok: boolean; id: string }>("vcc_grant_add_document", {
    p_grant: grantId, p_document: documentId, p_allow_download: allowDownload,
  });

export const grantRemoveDocument = (grantId: string, documentId: string) =>
  call<{ ok: boolean }>("vcc_grant_remove_document", { p_grant: grantId, p_document: documentId });

/** ★ الاعتماد فعل المالك ★ من يُعدّ الرابط ليس من يأذن به. */
export const grantApprove = (grantId: string, note?: string) =>
  call<{ ok: boolean; id: string; status: GrantStatus; documents: number }>(
    "vcc_grant_approve", { p_grant: grantId, p_note: note ?? null });

export interface GrantIssueResult {
  ok: boolean;
  id: string;
  status: "active";
  /** ★★ يظهر مرّة واحدة ولا يُخزَّن في أيّ مكان ★★ */
  token: string;
  token_hint: string;
  expires_at: string;
  share_state: "ready_for_manual_sharing";
  share_state_ar: string;
  note_ar: string;
}

/**
 * ★★ الإصدار — المرّة الوحيدة التي يظهر فيها الرمز ★★
 * لا تكتب القيمة العائدة في localStorage ولا في سجلّ ولا في حالة مستمرّة.
 * ⛔ ولا ترسلها: لا يوجد في هذا النظام أيّ مسار يرسل هذا الرابط، والحالة بعد
 *    الإصدار «جاهز للمشاركة اليدوية».
 */
export const grantIssue = (grantId: string) =>
  call<GrantIssueResult>("vcc_grant_issue", { p_grant: grantId });

export const grantRevoke = (grantId: string, reason: string) =>
  call<{ ok: boolean; id: string; status: "revoked"; note_ar: string }>(
    "vcc_grant_revoke", { p_grant: grantId, p_reason: reason });

export const grantAudit = (grantId: string) =>
  call<{ rows: Array<Record<string, unknown>>; note_ar: string }>(
    "vcc_grant_audit", { p_grant: grantId });

/**
 * رابط المشاركة اليدوية. ★ الرمز في **الجزء المرجعيّ** (بعد #) ★ لأنّه لا
 * يُرسَل إلى الخادم مع الطلب، فلا يظهر في سجلّات الوصول ولا في الـReferer ولا
 * في تحليلات الطرف الثالث. وضعه في query string كان سيسرّبه إلى كلّ ذلك.
 */
export function buildGrantShareLink(origin: string, token: string): string {
  const base = (origin || "").replace(/\/+$/, "");
  return `${base}/secure-document#${encodeURIComponent(token)}`;
}

// ─── طلبات التسجيل كمورّد ──────────────────────────────────────────────────
export interface RegistrationRow {
  id: string;
  request_number: string | null;
  organization_name: string;
  organization_sector: string | null;
  status: RegistrationStatus;
  priority: "low" | "normal" | "high" | "urgent";
  deadline: string | null;
  days_to_deadline: number | null;
  assigned_to: string | null;
  source: string;
  portal_name: string | null;
  required_doc_types: string[];
  missing_count: number;
  owner_approved_at: string | null;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
}

export const registrationList = (filters: Record<string, unknown> = {}) =>
  call<{ rows: RegistrationRow[] }>("vcc_registration_list", { p_filters: filters });

export const registrationGet = (id: string) =>
  call<{
    request: Record<string, unknown>;
    checklist: Array<{ id: string; item_kind: string; doc_type: string | null; label: string;
                       is_mandatory: boolean; satisfied: boolean; derived: boolean;
                       satisfied_note: string | null; sort_order: number }>;
    comments: Array<Record<string, unknown>>;
    attachments: Array<Record<string, unknown>>;
    missing_or_expired_doc_types: string[];
    readiness: ReadinessResult;
    note_ar: string;
  }>("vcc_registration_get", { p_id: id });

export const registrationUpsert = (input: Record<string, unknown>) =>
  call<{ ok: boolean; id: string }>("vcc_registration_upsert", { p_input: input });

/**
 * الانتقال بين الحالات. ⛔ `submitted_manually` تتطلّب مرجعًا وقناة — والخادم
 * يرفض بقيد جدوليّ لو نقصت، فلا يمكن للواجهة أن تدّعي تسليمًا لم يحدث.
 */
export const registrationTransition = (
  id: string, status: RegistrationStatus, input: Record<string, unknown> = {},
) => call<{ ok: boolean; id: string; status: RegistrationStatus; note_ar: string | null }>(
  "vcc_registration_transition", { p_id: id, p_status: status, p_input: input });

export const checklistUpsert = (input: Record<string, unknown>) =>
  call<{ ok: boolean; id: string }>("vcc_checklist_upsert", { p_input: input });

export const registrationComment = (requestId: string, body: string) =>
  call<{ ok: boolean; id: string }>("vcc_registration_comment", { p_request: requestId, p_body: body });

export const registrationAttach = (input: Record<string, unknown>) =>
  call<{ ok: boolean; id: string }>("vcc_registration_attach", { p_input: input });

/** ★ نافذة المبيعات: حالة فقط ★ خمسة حقول، ولا وثيقة ولا بنك ولا مرفق. */
export const registrationStatusBoard = () =>
  call<{
    rows: Array<{ request_number: string | null; organization_name: string;
                  status: RegistrationStatus; priority: string; deadline: string | null }>;
    scope: "status_only";
    note_ar: string;
  }>("vcc_registration_status_board");

// ─── المسح الدوريّ ─────────────────────────────────────────────────────────
/**
 * ⛔ لا شيء يُرسَل من هنا. `emit = true` يُدرج أحداثًا في مركز الاتصالات، وكلّ
 * قنواته dry_run. «أُدرج حدث» ليست «وصل إشعار»، والشاشة تقول ذلك حرفيًّا.
 */
export const complianceScan = (emit = false) =>
  call<{
    reminder_days: number[];
    expiring: Array<Record<string, unknown>>;
    readiness: ReadinessResult;
    emitted: boolean;
    documents_considered: number;
    grants_considered: number;
    registrations_considered: number;
    expired_documents_flipped: number;
    note_ar: string;
  }>("vcc_scan_compliance", { p_emit: emit });
