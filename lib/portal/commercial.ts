// ════════════════════════════════════════════════════════════════════════════
// lib/portal/commercial.ts — «رصيدي الإنتاجي» وطلبات الإنتاج (سطح العميل).
//
// أغلفة رقيقة فوق دوالّ csub_* (كلّها SECURITY DEFINER على الخادم). لا منطق
// صلاحيات هنا: ما تعرضه الواجهة تجميل، والمنع الحقيقيّ في القاعدة. الافتراض
// العمليّ أنّ الواجهة ستُتجاوَز، ولذلك لا يوجد في هذا الملفّ سطر يقرّر «هل
// يحقّ له؟» — يقرّرها الخادم ويردّ 42501.
//
// ★★ القاعدة التي كُتب هذا الملفّ من أجلها ★★
//   **لا رقم رصيد يُخترع في هذه الطبقة.** لا `?? 0` ولا `|| 0` على أيّ حقل
//   رصيد. عميل يقرأ «٠ وحدة» بينما الحقيقة «الترحيلة لم تُطبَّق» أو «لا اشتراك»
//   أو «لم تُسجَّل حركة» سيتّصل يشكو خطأ فوترة — وسيكون محقًّا، لأنّ الشاشة
//   كذبت عليه. لذلك `balances` من نوع `CsubUnitBalance[] | null`، وكلّ وحدة
//   تحمل `has_entries`، والـnull يعني «لا أعرف» ولا يُترجم إلى صفر أبدًا.
//
// ★ الرصيد بالوحدات لا بالمال ★
//   الموديول يقيس بوحدات الإنتاج (يوم تصوير · ريل · ساعة مونتاج …) من كتالوج
//   csub_unit_types. لا يعرض هذا السطح مالًا إطلاقًا: التسعير والضريبة خلف
//   csub.view_pricing على السطح الداخليّ، ولا يمرّان من هنا.
//
// ★ الحالة الرباعية بدل boolean ★
//   needs_migration → الدالّة غير موجودة (PGRST202/42883) ⇒ «بانتظار تفعيل
//                     قاعدة البيانات». الكود يُدفع قبل تشغيل الـSQL بالتصميم.
//   denied          → 42501/not authorized ⇒ «لا تملك صلاحية». لا يجوز أبدًا أن
//                     تُعرض كـ«ترحيلة ناقصة» — هذا الخلط أضاع دورة إنتاج سابقة.
//   error / ok      → الباقي، برسالة تقول سببها الحقيقيّ.
// ════════════════════════════════════════════════════════════════════════════
import { prpc, type Result } from "./client";
import { pgClassify, pgIsMigrationPending, pgMessageAr } from "@/lib/portal/pgerror";

export const CSUB_MIGRATION_AR =
  "الميزة بانتظار تفعيل قاعدة البيانات — لم يُشغَّل بعد docs/commercial_subscriptions_RUNME.sql. " +
  "هذا ليس خطأً في حسابك ولا في رصيدك، ولا يعني أنّ رصيدك صفر.";

export const CSUB_DENIED_AR =
  "«رصيدي الإنتاجي» شاشة خاصّة بحساب العميل. حسابك لا يملك صلاحية قراءتها من هنا.";

export type CsubState<T> =
  | { state: "ok"; data: T }
  | { state: "needs_migration"; message: string }
  | { state: "denied"; message: string }
  | { state: "error"; message: string };

// ─── الأنواع ────────────────────────────────────────────────────────────────

/**
 * رصيد وحدة إنتاج واحدة. `has_entries = false` يعني أنّ الدفتر خالٍ لهذه
 * الوحدة — وهو ليس «صفر متاح»، بل «لا حركة بعد». الفرق يُعرض نصًّا لا رقمًا.
 */
export interface CsubUnitBalance {
  unit_type: string;
  label_ar: string;
  label_en: string;
  uom_ar: string;
  allocated: number;
  reserved: number;
  used: number;
  expired: number;
  available: number;
  overage_units: number;
  entries: number;
  has_entries: boolean;
  entitlement_per_period: number | null;
  is_overage: boolean;
}

export interface CsubClientSubscription {
  id: string;
  code: string | null;
  plan_name: string | null;
  status: "draft" | "pending_approval" | "active" | "suspended" | "expired" | "cancelled" | "completed";
  start_date: string | null;
  end_date: string | null;
  renewal_date: string | null;
  grace_period_days: number;
  auto_renew: boolean;
  /** ★ نصّ الخادم: معلومة تعاقدية لا آلية. يُعرض كما هو ولا يُعاد صياغته. */
  auto_renew_note: string;
  days_remaining: number | null;
  is_expired: boolean;
  description: string | null;
  terms: string | null;
  limitations: string | null;
  contract_reference: string | null;
  allow_overage: boolean;
  overage_requires_approval: boolean;
}

/** سطر كشف حساب — من csub_my_statement عبر الصفحة المجمّعة. */
export interface CsubStatementRow {
  entry_no: number;
  entry_type: "allocation" | "reservation" | "consumption" | "release" | "reversal" | "expiry" | "adjustment";
  unit_type: string;
  quantity: number;
  running_available: number;
  usage_date: string | null;
  description: string | null;
  service_request_ref: string | null;
  overage_units: number;
}

export type CsubRequestStatus =
  | "draft" | "submitted" | "under_review" | "credit_reserved"
  | "needs_overage_approval" | "approved" | "rejected"
  | "scheduled" | "fulfilled" | "cancelled";

export interface CsubAttachmentMeta {
  id: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  note: string | null;
}

export interface CsubServiceRequest {
  id: string;
  code: string | null;
  unit_type: string;
  unit_label_ar: string | null;
  units: number;
  credits_required: number;
  overage_estimate_units: number;
  status: CsubRequestStatus;
  city: string | null;
  location_text: string | null;
  preferred_date: string | null;
  alternative_date: string | null;
  scheduled_date: string | null;
  description: string | null;
  contact_person_name: string | null;
  contact_person_phone: string | null;
  is_urgent: boolean;
  client_notes: string | null;
  /** ما يُقال للعميل عن القرار. سبب القرار الداخليّ لا يصل إلى هنا أصلًا. */
  client_decision_note: string | null;
  submitted_at: string | null;
  created_at: string;
  attachments: CsubAttachmentMeta[];
}

/**
 * ما تعيده csub_my_credits_page(). أربع حقائق لا تُطوى في «صفر»:
 *   has_client_profile = false → لا ملفّ عميل مرتبط بالحساب.
 *   has_subscription   = false → لا اشتراك.
 *   balances = null            → اشتراك بلا وحدات مُسنَدة (balances_reason).
 *   balances[i].has_entries=false → وحدة بلا أيّ حركة في الدفتر.
 */
export interface CsubCreditsPage {
  ok: true;
  is_client: boolean;
  has_client_profile: boolean;
  has_subscription: boolean;
  reason: "no_client_profile" | "no_active_subscription" | null;
  has_units?: boolean;
  balances: CsubUnitBalance[] | null;
  balances_reason?: "no_units_on_subscription" | null;
  subscription?: CsubClientSubscription;
  statement?: CsubStatementRow[];
  requests?: CsubServiceRequest[];
}

// ─── تصنيف النتيجة ──────────────────────────────────────────────────────────

/** يحوّل نتيجة PostgREST خامّة إلى الحالة الرباعية. لا يخمّن سببًا أبدًا. */
function toState<T>(r: Result<unknown>): CsubState<T> {
  if (!r.ok) {
    const d = pgClassify(r.error, r.status);
    if (pgIsMigrationPending(d)) return { state: "needs_migration", message: CSUB_MIGRATION_AR };
    if (d.kind === "permission_denied" || /not authorized/i.test(r.error ?? "")) {
      return { state: "denied", message: CSUB_DENIED_AR };
    }
    return { state: "error", message: pgMessageAr(r.error, r.status) };
  }
  const data = (r.data ?? {}) as Record<string, unknown>;
  // الخادم يعيد ok:false مع سبب مقروء لحالات العمل (لا استثناء) — تُعرض كما هي.
  if (data.ok === false) {
    return {
      state: "error",
      message: typeof data.message === "string" && data.message
        ? data.message
        : csubReasonAr(String(data.reason ?? "unknown")),
    };
  }
  return { state: "ok", data: data as unknown as T };
}

/** أسباب العمل التي يعيدها الخادم بلا رسالة — تُترجم هنا ولا تُخترع. */
export function csubReasonAr(reason: string): string {
  switch (reason) {
    case "no_client_profile":
      return "لا يوجد ملفّ عميل مرتبط بحسابك بعد. تواصل معنا لربط حسابك بملفّك التجاريّ — هذه ليست مشكلة رصيد.";
    case "no_active_subscription":
      return "لا يوجد اشتراك إنتاج مفعّل على ملفّك حاليًّا. لا يعني هذا أنّ رصيدك صفر، بل أنّه لا يوجد اشتراك أصلًا.";
    case "no_units_on_subscription":
      return "اشتراكك مفعّل ولم تُسنَد إليه وحدات إنتاج بعد. لا يوجد رصيد نعرضه — وليس رصيدًا صفرًا.";
    case "subscription_not_active":  return "الاشتراك ليس مفعّلًا حاليًّا، فلا يمكن تقديم طلب عليه.";
    case "unit_type_required":       return "اختر نوع الخدمة (وحدة الإنتاج).";
    case "unit_not_in_subscription": return "نوع الوحدة هذا غير مشمول في اشتراكك.";
    case "invalid_units":            return "عدد الوحدات يجب أن يكون أكبر من صفر.";
    case "invalid_credits":          return "الرصيد المطلوب غير صالح.";
    case "preferred_date_in_past":   return "التاريخ المفضّل في الماضي.";
    case "preferred_date_required":  return "التاريخ المفضّل مطلوب قبل التقديم.";
    case "alternative_before_preferred": return "التاريخ البديل يجب ألّا يسبق التاريخ المفضّل.";
    case "contact_person_required":  return "اسم جهة الاتصال مطلوب قبل التقديم.";
    case "city_required":            return "المدينة مطلوبة قبل التقديم.";
    case "request_not_found":        return "الطلب غير موجود أو لا يخصّ حسابك.";
    case "not_editable":             return "لا يمكن تعديل هذا الطلب بعد تقديمه. أنشئ طلبًا جديدًا أو تواصل معنا.";
    case "terminal_state":           return "هذا الطلب وصل إلى حالته النهائية ولا يقبل إلغاءً.";
    case "file_name_required":       return "اسم الملفّ مطلوب.";
    case "link_not_allowed":         return "يُسجَّل اسم الملفّ فقط لا رابطه. الملفّ نفسه يُسلَّم بالقناة المتّفق عليها.";
    case "insufficient_balance":     return "الرصيد المتاح لا يكفي — يحتاج اعتماد تجاوز من كيان.";
    case "pending_approval":         return "الطلب يتجاوز الرصيد وينتظر اعتماد المالك. لم يُخصم شيء.";
    case "overage_not_approved":     return "اعتماد التجاوز لم يصدر بعد.";
    case "release_failed":           return "تعذّر فكّ الحجز. لم تُغيَّر حالة الطلب.";
    default:                         return "تعذّر تنفيذ الطلب. حاول مرّة أخرى.";
  }
}

/** نصّ الحالة بالعربية — عشر حالات، ولكلّ واحدة اسمها الصريح. */
export const CSUB_STATUS_AR: Record<CsubRequestStatus, string> = {
  draft:                  "مسوّدة",
  submitted:              "مقدَّم",
  under_review:           "قيد المراجعة",
  credit_reserved:        "حُجز الرصيد",
  needs_overage_approval: "بانتظار اعتماد تجاوز الرصيد",
  approved:               "معتمَد",
  rejected:               "مرفوض",
  scheduled:              "مجدوَل",
  fulfilled:              "منفَّذ",
  cancelled:              "ملغى",
};

export const CSUB_STATUS_TONE: Record<CsubRequestStatus, "neutral" | "warn" | "good" | "bad"> = {
  draft: "neutral", submitted: "neutral", under_review: "neutral",
  credit_reserved: "warn", needs_overage_approval: "warn",
  approved: "good", scheduled: "good", fulfilled: "good",
  rejected: "bad", cancelled: "bad",
};

export const CSUB_ENTRY_AR: Record<CsubStatementRow["entry_type"], string> = {
  allocation:  "تخصيص رصيد",
  reservation: "حجز",
  release:     "فكّ حجز",
  consumption: "استهلاك",
  reversal:    "قيد عكسيّ",
  expiry:      "انتهاء صلاحية",
  adjustment:  "تسوية",
};

/** الحالات النهائية — لا إلغاء بعدها ولا تعديل. */
export const CSUB_TERMINAL: CsubRequestStatus[] = ["fulfilled", "rejected", "cancelled"];

// ─── العرض ──────────────────────────────────────────────────────────────────

/**
 * تنسيق كمّية وحدات. ★ يقبل number فقط ★ — لا null ولا undefined، فلا توجد
 * قيمة افتراضية يمكن أن تُطبع صفرًا عن رقم مجهول. من لا يملك الرقم يعرض نصًّا.
 */
export function csubUnits(n: number, uom = "وحدة"): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return `${new Intl.NumberFormat("ar-SA", { maximumFractionDigits: 3 }).format(v)} ${uom}`;
}

export function csubDate(d: string | null | undefined): string {
  if (!d) return "—";
  try {
    return new Intl.DateTimeFormat("ar-SA", { year: "numeric", month: "long", day: "numeric" })
      .format(new Date(d));
  } catch { return String(d); }
}

// ─── الاستدعاءات ────────────────────────────────────────────────────────────

/** الصفحة كاملة في نداء واحد: الاشتراك والأرصدة والكشف والطلبات. */
export async function getMyCreditsPage(subscriptionId?: string | null): Promise<CsubState<CsubCreditsPage>> {
  return toState<CsubCreditsPage>(
    await prpc<unknown>("csub_my_credits_page", { p_subscription: subscriptionId ?? null }),
  );
}

/** كتالوج وحدات الإنتاج — لأسماء الوحدات في النموذج. */
export async function getUnitCatalog(): Promise<CsubState<{ ok: true; rows: { key: string; label_ar: string; uom_ar: string }[] }>> {
  return toState(await prpc<unknown>("csub_unit_catalog", {}));
}

export interface CsubRequestInput {
  id?: string | null;
  subscriptionId: string;
  unitType: string;
  units: number;
  creditsRequired?: number;
  city?: string;
  locationText?: string;
  preferredDate?: string;
  alternativeDate?: string;
  description?: string;
  contactPersonName?: string;
  contactPersonPhone?: string;
  isUrgent?: boolean;
  clientNotes?: string;
}

export interface CsubSubmitResult {
  ok: true;
  id: string;
  status: "draft" | "submitted";
  overage_estimate_units: number;
  available_now: number;
  /** ★ يعود من الخادم دائمًا false ★ — التقديم لا يُنشئ مشروعًا. */
  project_created: false;
}

/**
 * حفظ مسوّدة (submit=false) أو تقديم طلب (submit=true).
 * ★ تقدير التجاوز لا يُرسَل من هنا ★: الخادم يحسبه من الرصيد المتاح.
 */
export async function submitServiceRequest(
  input: CsubRequestInput, submit: boolean,
): Promise<CsubState<CsubSubmitResult>> {
  const payload: Record<string, unknown> = {
    id: input.id ?? null,
    submit,
    subscription_id: input.subscriptionId,
    unit_type: input.unitType,
    units: input.units,
    credits_required: input.creditsRequired ?? input.units,
    city: input.city ?? null,
    location_text: input.locationText ?? null,
    preferred_date: input.preferredDate || null,
    alternative_date: input.alternativeDate || null,
    description: input.description ?? null,
    contact_person_name: input.contactPersonName ?? null,
    contact_person_phone: input.contactPersonPhone ?? null,
    is_urgent: !!input.isUrgent,
    client_notes: input.clientNotes ?? null,
  };
  return toState<CsubSubmitResult>(await prpc<unknown>("csub_request_submit", { p_payload: payload }));
}

export async function cancelServiceRequest(
  requestId: string, reason?: string,
): Promise<CsubState<{ ok: true; status: string }>> {
  return toState(await prpc<unknown>("csub_request_cancel", {
    p_request: requestId, p_reason: reason ?? null,
  }));
}

/**
 * تسجيل **بيانات** مرفق — اسم ونوع وحجم وملاحظة. لا يُرفع ملفّ ولا يُخزَّن
 * رابط: القاعدة ترفض أيّ اسم يبدأ بـhttp/s3/gs/file. الملفّ نفسه يُسلَّم
 * بالقناة المتّفق عليها، وما يُحفظ هنا هو ما يسمح بالحديث عنه.
 */
export async function addAttachmentMeta(input: {
  requestId: string; fileName: string; mimeType?: string; sizeBytes?: number; note?: string;
}): Promise<CsubState<{ ok: true; id: string; metadata_only: true }>> {
  return toState(await prpc<unknown>("csub_request_attachment_add", {
    p_payload: {
      request_id: input.requestId,
      file_name: input.fileName,
      mime_type: input.mimeType ?? null,
      size_bytes: input.sizeBytes ?? null,
      note: input.note ?? null,
    },
  }));
}
