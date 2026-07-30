// ════════════════════════════════════════════════════════════════════════════
// lib/portal/quoting.ts — باني عروض الأسعار الذكيّ (المرحلة ٤+٥).
//
// أغلفة رقيقة فوق دوالّ sq_* (كلّها SECURITY DEFINER على الخادم). لا منطق
// صلاحيات هنا: ما تعرضه الواجهة تجميل، والمنع الحقيقيّ في القاعدة. الافتراض
// العمليّ أنّ الواجهة ستُتجاوَز، فلا سطر في هذا الملفّ يقرّر «هل يحقّ له؟».
//
// ★★ القاعدة التي كُتب هذا الملفّ من أجلها ★★
//
//   **لا يوجد في هذه الطبقة نوعٌ يجمع التكلفة بسعر البيع.**
//
//   القاعدة تفصل السطحين فصلًا بنيويًّا: `sq_quote_detail` لا تقرأ جدول تكلفة
//   أصلًا، و`sq_quote_internal_detail` للمالك وحده. لو جمعناهما هنا في واجهة
//   `Quote` واحدة بحقول اختيارية، لأعدنا بناء الثغرة في الطبقة الخطأ: أوّل
//   مكوّن يقرأ `quote.margin_pct ?? 0` سيعرض «٠٪ هامش» لموظّف مبيعات، وأوّل
//   من يضيف حقلًا إلى الواجهة سيظنّ أنّ الخادم يرسله.
//
//   ولذلك نوعان منفصلان لا يلتقيان:
//     · `QuoteDetail`         — سطح البيع. **لا حقل تكلفة فيه إطلاقًا.**
//     · `QuoteInternalDetail` — سطح المالك. يُجلب بنداء مستقلّ يردّ 42501 لغير
//                               المالك، فلا يمكن «نسيان» حجبه.
//   من أراد جمعهما في مكوّن فليطلبهما نداءين، وليرَ أنّه يفعل ذلك.
//
// ★ المال لا يُخترع ★ لا `?? 0` ولا `|| 0` على أيّ حقل مبلغ في هذا الملفّ.
//   `null` تعني «لم يُحدَّد بعد» وتُعرض نصًّا. عرضُ «٠ ريال» عن سعر لم
//   يُعتمد بعدُ كذبةٌ يتصرّف الموظّف بناءً عليها أمام العميل.
//
// ★ الضريبة حقل مستقلّ ★ `vat_rate` و`vat_amount` و`total_after_vat` أعمدة
//   قائمة بذاتها من الخادم. لا تُحسب هنا ولا تُطوى في الإجمالي.
//
// ★ الحالة الرباعية بدل boolean ★
//   needs_migration → الدالّة غير موجودة (PGRST202/42883) ⇒ «بانتظار تفعيل
//                     قاعدة البيانات». الكود يُدفع قبل الـSQL بالتصميم.
//   denied          → 42501/not authorized ⇒ «لا تملك صلاحية». لا يجوز أبدًا
//                     أن تُعرض كـ«ترحيلة ناقصة» — هذا الخلط أضاع دورة إنتاج.
//   error / ok      → الباقي، برسالة تقول سببها الحقيقيّ.
// ════════════════════════════════════════════════════════════════════════════
import { prpc, type Result } from "./client";
import { pgClassify, pgIsMigrationPending, pgMessageAr } from "@/lib/portal/pgerror";

export const SQ_MIGRATION_AR =
  "الميزة بانتظار تفعيل قاعدة البيانات — لم يُشغَّل بعد docs/smart_quoting_RUNME.sql. " +
  "لم يُعرض عليك رقم واحد لأنّ الأرقام غير متاحة بعد، لا لأنّها أصفار.";

export const SQ_DENIED_AR =
  "لا تملك صلاحية هذا السطح. أرقام التكلفة والهامش والحدّ الأدنى مقصورة على المالك بنيويًّا " +
  "ولا يوجد لها مفتاح صلاحية يُمنح.";

export type SqState<T> =
  | { state: "ok"; data: T }
  | { state: "needs_migration"; message: string }
  | { state: "denied"; message: string }
  | { state: "error"; message: string };

/** يحوّل نتيجة PostgREST خامّة إلى الحالة الرباعية. لا يخمّن سببًا أبدًا. */
function toState<T>(r: Result<unknown>): SqState<T> {
  if (!r.ok) {
    const d = pgClassify(r.error, r.status);
    if (pgIsMigrationPending(d)) return { state: "needs_migration", message: SQ_MIGRATION_AR };
    if (d.kind === "permission_denied" || /not authorized/i.test(r.error ?? "")) {
      return { state: "denied", message: SQ_DENIED_AR };
    }
    return { state: "error", message: pgMessageAr(r.error, r.status) };
  }
  return { state: "ok", data: (r.data ?? null) as T };
}

/** قوائم: الصفر صفوفٍ نتيجة صحيحة (RLS قد تُرشّح بحقّ)، لا خطأ. */
function toListState<T>(r: Result<unknown>): SqState<T[]> {
  const s = toState<unknown>(r);
  if (s.state !== "ok") return s;
  return { state: "ok", data: Array.isArray(s.data) ? (s.data as T[]) : [] };
}

// ─── الحالات التسع ───────────────────────────────────────────────────────────

export type QuoteStatus =
  | "draft" | "internal_review" | "pending_owner_approval" | "approved"
  | "sent_placeholder" | "accepted" | "rejected" | "expired" | "superseded";

export type QuoteTier = "basic" | "professional" | "cinematic" | "enterprise_custom";

/**
 * ★ لا تكتب «أُرسل» ★ — sent_placeholder لا تعني أنّ رسالة غادرت. النظام لا
 * يُرسل بريدًا في هذه المرحلة، ولا مزوّد أثبت تسليمًا. النصّ هنا يطابق نصّ
 * الخادم حرفًا بحرف كي لا تتباعد الروايتان.
 */
export const QUOTE_STATUS_AR: Record<QuoteStatus, string> = {
  draft: "مسودّة",
  internal_review: "مراجعة داخلية",
  pending_owner_approval: "بانتظار اعتماد المالك",
  approved: "معتمد",
  sent_placeholder: "معتمد وجاهز للإرسال اليدوي",
  accepted: "مقبول من العميل",
  rejected: "مرفوض من العميل",
  expired: "منتهي الصلاحية",
  superseded: "مُستبدَل بنسخة أحدث",
};

export const TIER_AR: Record<QuoteTier, string> = {
  basic: "أساسي",
  professional: "احترافي",
  cinematic: "سينمائي",
  enterprise_custom: "مؤسّسي مخصّص",
};

/** تفسير الحالة للمستخدم — يُستعمل حيث يحتاج الأمر جملة لا كلمة. */
export function quoteStatusNoteAr(s: QuoteStatus): string {
  switch (s) {
    case "sent_placeholder":
      return "لم يُرسل النظام رسالة. العرض معتمد وجاهز لترسله يدويًّا إلى العميل.";
    case "pending_owner_approval":
      return "كلّ عرض يمرّ باعتماد المالك — هذا مسار ثابت لا استثناء فيه.";
    case "expired":
      return "انتهت مدّة صلاحية العرض. أنشئ نسخة جديدة بدل تعديل المنتهي.";
    case "superseded":
      return "صدرت نسخة أحدث من هذا العرض. هذه النسخة محفوظة للتاريخ ولا تُعدَّل.";
    default:
      return "";
  }
}

// ─── سطح البيع ──────────────────────────────────────────────────────────────

/**
 * ★ سطح البيع — لا حقل تكلفة هنا، ولا يجوز أن يُضاف ★
 * إن احتجتَ تكلفةً أو هامشًا فاطلب `fetchQuoteInternal` صراحةً؛ سيردّ الخادم
 * 42501 إن لم تكن مالكًا، وهو الجواب الصحيح.
 *
 * كلّ حقل مبلغ هنا `number | null`. الـnull ليست صفرًا: `authorized_price`
 * تبقى null حتى يعتمد المالك سعرًا، ولا تُملأ بسعر القائمة تجميلًا.
 */
export interface QuoteRow {
  id: string;
  code: string;
  client_id: string;
  title: string;
  tier: QuoteTier;
  status: QuoteStatus;
  status_label_ar: string;
  version_no: number;
  list_price: number | null;
  proposed_price: number | null;
  authorized_price: number | null;
  discount_pct: number | null;
  gross_before_vat: number | null;
  vat_rate: number | null;
  vat_amount: number | null;
  total_after_vat: number | null;
  valid_until: string | null;
  requires_owner_approval: boolean;
  approval_reason_public: string | null;
  created_at: string;
}

export interface QuoteDetail {
  id: string;
  code: string;
  client_id: string;
  project_id: string | null;
  title: string;
  tier: QuoteTier;
  version_no: number;
  supersedes_id: string | null;
  price_book_version_id: string | null;
  currency: string;
  status: QuoteStatus;
  status_label_ar: string;
  list_price: number | null;
  proposed_price: number | null;
  authorized_price: number | null;
  discount_pct: number | null;
  discount_amount: number | null;
  gross_before_vat: number | null;
  vat_rate: number | null;
  vat_amount: number | null;
  total_after_vat: number | null;
  /** المدى المسموح لي بيعًا: سقفه سعر القائمة أو المعتمَد، وقاعه ذلك ناقص
   *  صلاحية خصمي أنا. **ليس** الحدّ الأدنى ولا مشتقًّا منه. */
  permitted_max: number | null;
  permitted_min: number | null;
  my_discount_allowance: number;
  range_low: number | null;
  range_high: number | null;
  range_published: boolean;
  /** مقيَّد بـfalse في القاعدة — المدى إرشاديّ ولا يصير سعرًا ملزِمًا. */
  range_is_binding: boolean;
  validity_days: number;
  valid_until: string | null;
  assumptions: string | null;
  exclusions: string | null;
  requires_owner_approval: boolean;
  approval_reason_public: string | null;
  approved_at: string | null;
  approval_status: string | null;
  approval_kind: string | null;
  approval_requested_at: string | null;
  approval_decided_at: string | null;
  approval_note: string | null;
  ready_for_manual_send_at: string | null;
  /** مقيَّد بـfalse — لا مزوّد أثبت تسليمًا، فلا يُدّعى تسليم. */
  delivery_proven: boolean;
  client_decision: "accepted" | "rejected" | null;
  client_decision_at: string | null;
  created_at: string;
  /** ثابتة لكلّ عرض بالنسبة للمستخدم نفسه ⇒ لا تحمل معلومة عن أيّ عرض بعينه.
   *  تُستعمل لإظهار لوحة المالك أو إخفائها — لا كتفويض. */
  internal_visible: boolean;
}

export interface QuoteLine {
  id: string;
  catalog_id: string | null;
  kind: string;
  label: string;
  qty: number;
  uom: string | null;
  unit_sell_rate: number;
  line_total: number;
  sort_order: number;
}

export interface QuoteMilestone {
  id: string;
  seq: number;
  label: string;
  pct: number | null;
  amount_net: number;
  vat_rate: number;
  vat_amount: number;
  amount_gross: number;
  due_rule: string;
}

export interface QuoteApproval {
  id: string;
  quote_id: string;
  quote_code: string;
  kind: string;
  requested_price: number | null;
  requested_discount_pct: number | null;
  status: "pending" | "approved" | "rejected" | "withdrawn";
  requested_at: string;
  decided_at: string | null;
  /** نصّ يكتبه المالك بيده. ما لا يكتبه لا يظهر — الطرف البنيويّ من القرار
   *  (الحدّ الأدنى وقت الطلب) لا يصل إلى هنا أبدًا. */
  decision_note: string | null;
}

export interface QuoteActivity {
  at: string;
  action: string;
  entity: string;
  actor: string | null;
}

export interface QuotingSettings {
  vat_rate: number;
  default_validity_days: number;
  my_discount_allowance: number;
  can_build: boolean;
  can_manage_catalog: boolean;
  can_export: boolean;
  internal_visible: boolean;
}

export interface QuoteDashboard {
  total: number;
  draft: number;
  internal_review: number;
  pending_approval: number;
  approved: number;
  ready_manual_send: number;
  accepted: number;
  rejected: number;
  expired: number;
  scope: "mine" | "all";
}

// ─── سطح المالك — منفصل عمدًا ────────────────────────────────────────────────

/**
 * ★ سطح المالك ★ يُجلب بنداء مستقلّ (`sq_quote_internal_detail`) يردّ 42501
 * لغير المالك. الفصل مقصود: لا يمكن أن «يُنسى» حجبُ حقل لأنّ الحقل لا يصل
 * أصلًا إلى من لا يملكه.
 *
 * `costed: false` تعني «لم يُحسب بعد» — والحقول غائبة، وليست أصفارًا.
 */
export type QuoteInternalDetail =
  | { costed: false; quote_id: string; note_ar: string }
  | {
      costed: true;
      quote_id: string;
      code: string;
      title: string;
      tier: QuoteTier;
      status: QuoteStatus;
      list_price: number | null;
      proposed_price: number | null;
      authorized_price: number | null;
      gross_before_vat: number | null;
      vat_rate: number | null;
      vat_amount: number | null;
      total_after_vat: number | null;
      base_cost: number | null;
      surcharge_cost: number | null;
      contingency_pct: number | null;
      contingency_amount: number | null;
      external_supplier_cost: number | null;
      internal_cost_estimate: number | null;
      target_margin_pct: number | null;
      min_margin_pct: number | null;
      recommended_price: number | null;
      min_price: number | null;
      gross_profit: number | null;
      margin_pct: number | null;
      overhead_alloc_pct: number | null;
      est_net_profit: number | null;
      below_floor: boolean;
      /** عدد محاولات التسعير تحت الحدّ الأدنى من غير المالك. الكشف الذي
       *  يعوّض ما لا يُمنع بنيويًّا (القناة البشرية). */
      floor_probe_count: number;
      cost_breakdown: Record<string, unknown>;
      formula_snapshot: Record<string, unknown>;
      computed_at: string | null;
    };

export interface QuoteInternalRow {
  id: string;
  code: string;
  client_id: string;
  title: string;
  tier: QuoteTier;
  status: QuoteStatus;
  gross_before_vat: number | null;
  internal_cost_estimate: number | null;
  min_price: number | null;
  recommended_price: number | null;
  gross_profit: number | null;
  margin_pct: number | null;
  est_net_profit: number | null;
  below_floor: boolean | null;
  floor_probe_count: number | null;
  /** false يعني أنّ بنودًا بلا سعر تكلفة دخلت الحساب. تكلفة ناقصة تُقرأ
   *  هامشًا عاليًا — وهي كذبة يتصرّف المالك بناءً عليها. */
  cost_complete: boolean;
}

export interface OwnerDashboard {
  quotes_total: number;
  pending_approval: number;
  below_floor: number;
  uncosted: number;
  incomplete_costing: number;
  probe_alerts: number;
  accepted_value: number;
  accepted_profit: number;
  avg_margin_pct: number | null;
}

export interface OwnerApprovalRow {
  id: string;
  quote_id: string;
  quote_code: string;
  client_id: string;
  kind: string;
  requested_price: number | null;
  requested_discount_pct: number | null;
  reason: string | null;
  status: string;
  requested_by: string;
  requested_at: string;
  floor_at_request: number | null;
  internal_reason_code: string | null;
  below_floor: boolean | null;
  margin_pct: number | null;
  internal_cost_estimate: number | null;
}

// ─── الكتالوج ودفتر الأسعار ─────────────────────────────────────────────────

export interface CatalogItem {
  id: string; code: string; name_ar: string; name_en: string; category: string;
  uom_ar: string; uom_en: string; is_active: boolean; sort_order: number;
}

export interface PriceBook {
  id: string; code: string; name_ar: string; name_en: string; status: string;
  currency: string; versions: number; published_versions: number; latest_version: number;
}

export interface PriceBookVersion {
  id: string; version_no: number; status: "draft" | "published" | "superseded";
  effective_from: string | null; effective_to: string | null;
  published_at: string | null; entries: number; notes: string | null;
}

export interface PriceBookEntry {
  id: string; catalog_id: string; code: string; name_ar: string;
  tier: QuoteTier; sell_rate: number; min_qty: number; uom: string | null;
}

export interface PublicRange {
  published: boolean;
  code?: string; title?: string; tier?: QuoteTier; currency?: string;
  range_low: number | null; range_high: number | null;
  vat_rate?: number; vat_note_ar?: string; valid_until?: string | null;
  /** دائمًا false — والقاعدة تفرضه بقيد CHECK لا بالاتّفاق. */
  is_binding?: boolean;
  note_ar: string;
}

// ════════════════════════════════════════════════════════════════════════════
// النداءات — كلّها رقيقة. لا واحدة منها تُقرّر صلاحية ولا تحسب مالًا.
// ════════════════════════════════════════════════════════════════════════════

export async function fetchQuotingSettings(): Promise<SqState<QuotingSettings>> {
  return toState<QuotingSettings>(await prpc<unknown>("sq_ui_settings", {}));
}

export async function fetchTiers(): Promise<SqState<{ code: QuoteTier; label_ar: string; label_en: string; sort_order: number }[]>> {
  return toListState(await prpc<unknown>("sq_tiers", {}));
}

export async function fetchQuotes(opts?: {
  status?: QuoteStatus | null; clientId?: string | null; limit?: number; offset?: number;
}): Promise<SqState<QuoteRow[]>> {
  return toListState<QuoteRow>(await prpc<unknown>("sq_quotes_list", {
    p_status: opts?.status ?? null,
    p_client: opts?.clientId ?? null,
    p_limit: opts?.limit ?? 50,
    p_offset: opts?.offset ?? 0,
  }));
}

export async function fetchQuote(quoteId: string): Promise<SqState<QuoteDetail>> {
  return toState<QuoteDetail>(await prpc<unknown>("sq_quote_detail", { p_quote: quoteId }));
}

export async function fetchQuoteLines(quoteId: string): Promise<SqState<QuoteLine[]>> {
  return toListState<QuoteLine>(await prpc<unknown>("sq_quote_lines_list", { p_quote: quoteId }));
}

export async function fetchQuoteMilestones(quoteId: string): Promise<SqState<QuoteMilestone[]>> {
  return toListState<QuoteMilestone>(await prpc<unknown>("sq_quote_milestones_list", { p_quote: quoteId }));
}

export async function fetchQuoteInputs(quoteId: string): Promise<SqState<Record<string, unknown>>> {
  return toState<Record<string, unknown>>(await prpc<unknown>("sq_quote_inputs_get", { p_quote: quoteId }));
}

export async function fetchQuoteActivity(quoteId: string, limit = 50): Promise<SqState<QuoteActivity[]>> {
  return toListState<QuoteActivity>(await prpc<unknown>("sq_quote_activity", {
    p_quote: quoteId, p_limit: limit,
  }));
}

export async function fetchMyApprovals(status?: string | null): Promise<SqState<QuoteApproval[]>> {
  return toListState<QuoteApproval>(await prpc<unknown>("sq_my_approvals", { p_status: status ?? null }));
}

export async function fetchQuoteDashboard(): Promise<SqState<QuoteDashboard>> {
  return toState<QuoteDashboard>(await prpc<unknown>("sq_dashboard", {}));
}

export async function createQuote(input: {
  clientId: string; title: string; tier?: QuoteTier;
  priceBookVersionId?: string | null; projectId?: string | null; validityDays?: number | null;
}): Promise<SqState<string>> {
  return toState<string>(await prpc<unknown>("sq_quote_create", {
    p_client: input.clientId,
    p_title: input.title,
    p_tier: input.tier ?? "professional",
    p_price_book_version: input.priceBookVersionId ?? null,
    // ★ مرجع للقراءة فقط ★ الموديول لا يُنشئ مشروعًا ولا يعدّله ولا يغيّر مرحلته.
    p_project: input.projectId ?? null,
    p_validity_days: input.validityDays ?? null,
  }));
}

export async function setQuoteInputs(quoteId: string, inputs: Record<string, unknown>): Promise<SqState<boolean>> {
  return toState<boolean>(await prpc<unknown>("sq_quote_inputs_set", {
    p_quote: quoteId, p_inputs: inputs,
  }));
}

export async function setQuoteLine(input: {
  quoteId: string; lineId?: string | null; catalogId?: string | null; label?: string | null;
  qty: number; kind?: string; unitSellRate?: number | null; uom?: string | null; sortOrder?: number;
}): Promise<SqState<string>> {
  return toState<string>(await prpc<unknown>("sq_quote_line_set", {
    p_quote: input.quoteId,
    p_line: input.lineId ?? null,
    p_catalog: input.catalogId ?? null,
    p_label: input.label ?? null,
    p_qty: input.qty,
    p_kind: input.kind ?? "service",
    p_unit_sell_rate: input.unitSellRate ?? null,
    p_uom: input.uom ?? null,
    p_sort: input.sortOrder ?? 100,
  }));
}

export async function deleteQuoteLine(lineId: string): Promise<SqState<boolean>> {
  return toState<boolean>(await prpc<unknown>("sq_quote_line_delete", { p_line: lineId }));
}

export async function setQuoteTerms(input: {
  quoteId: string; assumptions?: string | null; exclusions?: string | null; validityDays?: number | null;
}): Promise<SqState<boolean>> {
  return toState<boolean>(await prpc<unknown>("sq_quote_terms_set", {
    p_quote: input.quoteId,
    p_assumptions: input.assumptions ?? null,
    p_exclusions: input.exclusions ?? null,
    p_validity_days: input.validityDays ?? null,
  }));
}

/**
 * ★ لا عرّاف ★ الخادم لا يعرف الحدّ الأدنى في هذا المسار ولا يرفض بسببه.
 * الرفض الوحيد الممكن سياسيّ: «تجاوزتَ صلاحية خصمك» — وهو رقم يعرفه الموظّف
 * عن نفسه سلفًا، فلا يضيف رفضُه معلومة جديدة عن أيّ رقم داخليّ.
 */
export async function setQuotePrice(quoteId: string, proposedPrice: number): Promise<SqState<{
  quote_id: string; proposed_price: number; list_price: number;
  discount_pct: number; discount_amount: number; my_allowance_pct: number;
  vat_rate: number; vat_amount: number; total_after_vat: number;
}>> {
  return toState(await prpc<unknown>("sq_quote_price_set", {
    p_quote: quoteId, p_proposed_price: proposedPrice,
  }));
}

export async function setQuoteMilestones(
  quoteId: string,
  milestones: { label: string; pct?: number; amount_net?: number; due_rule?: string }[],
): Promise<SqState<number>> {
  return toState<number>(await prpc<unknown>("sq_quote_milestones_set", {
    p_quote: quoteId, p_milestones: milestones,
  }));
}

export async function submitQuote(quoteId: string, note?: string | null): Promise<SqState<string>> {
  return toState<string>(await prpc<unknown>("sq_quote_submit", {
    p_quote: quoteId, p_note: note ?? null,
  }));
}

export async function newQuoteVersion(quoteId: string, note?: string | null): Promise<SqState<string>> {
  return toState<string>(await prpc<unknown>("sq_quote_new_version", {
    p_quote: quoteId, p_note: note ?? null,
  }));
}

/**
 * ★ لا يُرسل هذا النداء بريدًا ولا رسالة ★ يُعلّم العرض «معتمد وجاهز للإرسال
 * اليدوي». الخادم يعيد `delivery_proven: false` صراحةً، ونصًّا عربيًّا يقول
 * إنّ شيئًا لم يغادر. اعرضه كما هو ولا تختصره إلى «أُرسل».
 */
export async function markReadyForManualSend(quoteId: string): Promise<SqState<{
  quote_id: string; status: "sent_placeholder"; status_label_ar: string;
  delivery_proven: false; honest_note_ar: string;
}>> {
  return toState(await prpc<unknown>("sq_quote_mark_ready_for_manual_send", { p_quote: quoteId }));
}

export async function recordClientDecision(
  quoteId: string, decision: "accepted" | "rejected", note?: string | null,
): Promise<SqState<boolean>> {
  return toState<boolean>(await prpc<unknown>("sq_quote_record_client_decision", {
    p_quote: quoteId, p_decision: decision, p_note: note ?? null,
  }));
}

export async function withdrawApproval(approvalId: string): Promise<SqState<boolean>> {
  return toState<boolean>(await prpc<unknown>("sq_approval_withdraw", { p_id: approvalId }));
}

export async function exportQuote(quoteId: string): Promise<SqState<{
  quote: QuoteDetail; lines: QuoteLine[]; milestones: QuoteMilestone[];
  exported_at: string; note_ar: string;
}>> {
  return toState(await prpc<unknown>("sq_export_quote", { p_quote: quoteId }));
}

export async function runExpiryScan(): Promise<SqState<number>> {
  return toState<number>(await prpc<unknown>("sq_expiry_scan", {}));
}

// ─── الكتالوج ودفتر الأسعار ─────────────────────────────────────────────────

export async function fetchCatalog(includeInactive = false): Promise<SqState<CatalogItem[]>> {
  return toListState<CatalogItem>(await prpc<unknown>("sq_catalog_list", {
    p_include_inactive: includeInactive,
  }));
}

export async function upsertCatalogItem(input: {
  code: string; nameAr: string; nameEn?: string; category?: string;
  uomAr?: string; uomEn?: string; sortOrder?: number; notes?: string | null;
}): Promise<SqState<string>> {
  return toState<string>(await prpc<unknown>("sq_catalog_item_upsert", {
    p_code: input.code, p_name_ar: input.nameAr, p_name_en: input.nameEn ?? input.nameAr,
    p_category: input.category ?? "production", p_uom_ar: input.uomAr ?? "وحدة",
    p_uom_en: input.uomEn ?? "unit", p_sort: input.sortOrder ?? 100, p_notes: input.notes ?? null,
  }));
}

export async function setCatalogItemActive(id: string, active: boolean): Promise<SqState<boolean>> {
  return toState<boolean>(await prpc<unknown>("sq_catalog_item_set_active", { p_id: id, p_active: active }));
}

export async function fetchPriceBooks(): Promise<SqState<PriceBook[]>> {
  return toListState<PriceBook>(await prpc<unknown>("sq_price_books_list", {}));
}

export async function upsertPriceBook(input: {
  id?: string | null; nameAr: string; nameEn?: string; notes?: string | null;
}): Promise<SqState<string>> {
  return toState<string>(await prpc<unknown>("sq_price_book_upsert", {
    p_id: input.id ?? null, p_name_ar: input.nameAr,
    p_name_en: input.nameEn ?? input.nameAr, p_notes: input.notes ?? null,
  }));
}

export async function fetchPriceBookVersions(bookId: string): Promise<SqState<PriceBookVersion[]>> {
  return toListState<PriceBookVersion>(await prpc<unknown>("sq_price_book_versions_list", { p_book: bookId }));
}

/** فتح نسخة جديدة ينسخ بنود النسخة المنشورة (بيعًا وتكلفةً) عبر مُشغّل في
 *  القاعدة. لا قيمة تكلفة تعود إلى الواجهة من هذا النداء. */
export async function openPriceBookVersion(
  bookId: string, effectiveFrom?: string | null, notes?: string | null,
): Promise<SqState<string>> {
  return toState<string>(await prpc<unknown>("sq_price_book_version_open", {
    p_book: bookId, p_effective_from: effectiveFrom ?? null, p_notes: notes ?? null,
  }));
}

export async function publishPriceBookVersion(versionId: string): Promise<SqState<boolean>> {
  return toState<boolean>(await prpc<unknown>("sq_price_book_version_publish", { p_version: versionId }));
}

export async function fetchPriceBookEntries(versionId: string): Promise<SqState<PriceBookEntry[]>> {
  return toListState<PriceBookEntry>(await prpc<unknown>("sq_price_book_entries_list", { p_version: versionId }));
}

export async function setPriceBookEntry(input: {
  versionId: string; catalogId: string; tier: QuoteTier;
  sellRate: number; minQty?: number; uom?: string | null;
}): Promise<SqState<string>> {
  return toState<string>(await prpc<unknown>("sq_price_book_entry_set", {
    p_version: input.versionId, p_catalog: input.catalogId, p_tier: input.tier,
    p_sell_rate: input.sellRate, p_min_qty: input.minQty ?? 0, p_uom: input.uom ?? null,
  }));
}

// ─── المدى الإرشاديّ العلنيّ ──────────────────────────────────────────────────

export async function fetchPublicRange(quoteId: string): Promise<SqState<PublicRange>> {
  return toState<PublicRange>(await prpc<unknown>("sq_public_range", { p_quote: quoteId }));
}

/** نشر المدى للمالك. يُحسب من سعر البيع وحده ويُدوَّر إلى مضاعفات خشنة —
 *  الخادم يرفض مدًى أضيق من خطوة التدوير لأنّه سعر نهائيّ متنكّر. */
export async function publishRange(quoteId: string, bandPct?: number | null): Promise<SqState<{
  quote_id: string; range_low: number; range_high: number;
  step: number; band_pct: number; is_binding: false; note_ar: string;
}>> {
  return toState(await prpc<unknown>("sq_publish_range", {
    p_quote: quoteId, p_band_pct: bandPct ?? null,
  }));
}

export async function unpublishRange(quoteId: string): Promise<SqState<boolean>> {
  return toState<boolean>(await prpc<unknown>("sq_unpublish_range", { p_quote: quoteId }));
}

// ─── سطح المالك — نداءات منفصلة تردّ 42501 لغير المالك ───────────────────────

export async function fetchQuoteInternal(quoteId: string): Promise<SqState<QuoteInternalDetail>> {
  return toState<QuoteInternalDetail>(await prpc<unknown>("sq_quote_internal_detail", { p_quote: quoteId }));
}

export async function fetchQuotesInternal(status?: QuoteStatus | null, limit = 100): Promise<SqState<QuoteInternalRow[]>> {
  return toListState<QuoteInternalRow>(await prpc<unknown>("sq_quotes_list_internal", {
    p_status: status ?? null, p_limit: limit,
  }));
}

export async function fetchOwnerDashboard(): Promise<SqState<OwnerDashboard>> {
  return toState<OwnerDashboard>(await prpc<unknown>("sq_owner_dashboard", {}));
}

export async function fetchOwnerApprovals(status: string | null = "pending"): Promise<SqState<OwnerApprovalRow[]>> {
  return toListState<OwnerApprovalRow>(await prpc<unknown>("sq_approvals_list_internal", { p_status: status }));
}

export async function decideApproval(input: {
  approvalId: string; decision: "approved" | "rejected";
  authorizedPrice?: number | null; note?: string | null;
}): Promise<SqState<Record<string, unknown>>> {
  return toState<Record<string, unknown>>(await prpc<unknown>("sq_approval_decide", {
    p_id: input.approvalId, p_decision: input.decision,
    p_authorized_price: input.authorizedPrice ?? null, p_note: input.note ?? null,
  }));
}

export async function recomputeQuote(quoteId: string): Promise<SqState<Record<string, unknown>>> {
  return toState<Record<string, unknown>>(await prpc<unknown>("sq_quote_recompute", { p_quote: quoteId }));
}

export async function setSupplierCost(
  quoteId: string, amount: number, contingencyPct?: number | null,
): Promise<SqState<boolean>> {
  return toState<boolean>(await prpc<unknown>("sq_quote_supplier_cost_set", {
    p_quote: quoteId, p_amount: amount, p_contingency_pct: contingencyPct ?? null,
  }));
}

export async function fetchPricingRules(): Promise<SqState<Record<string, unknown>[]>> {
  return toListState<Record<string, unknown>>(await prpc<unknown>("sq_pricing_rules_list", {}));
}

export async function upsertPricingRule(input: {
  ruleCode: string; kind: string; value: number; tier?: QuoteTier | null;
  conditionKey?: string | null; labelAr?: string | null; sortOrder?: number; notes?: string | null;
}): Promise<SqState<string>> {
  return toState<string>(await prpc<unknown>("sq_pricing_rule_upsert", {
    p_rule_code: input.ruleCode, p_kind: input.kind, p_value: input.value,
    p_tier: input.tier ?? null, p_condition_key: input.conditionKey ?? null,
    p_label_ar: input.labelAr ?? null, p_sort: input.sortOrder ?? 100, p_notes: input.notes ?? null,
  }));
}

export async function fetchCostRates(versionId: string): Promise<SqState<Record<string, unknown>[]>> {
  return toListState<Record<string, unknown>>(await prpc<unknown>("sq_cost_rates_list", { p_version: versionId }));
}

export async function setCostRate(input: {
  versionId: string; catalogId: string; tier: QuoteTier; costRate: number;
  supplierRate?: number | null; crewRate?: number | null; supplierName?: string | null;
}): Promise<SqState<string>> {
  return toState<string>(await prpc<unknown>("sq_cost_rate_set", {
    p_version: input.versionId, p_catalog: input.catalogId, p_tier: input.tier,
    p_cost_rate: input.costRate, p_supplier_rate: input.supplierRate ?? null,
    p_crew_rate: input.crewRate ?? null, p_supplier_name: input.supplierName ?? null,
  }));
}

// ─── عرض الأرقام ─────────────────────────────────────────────────────────────

/**
 * ★ لا يُخترع رقم ★ `null` تعني «غير محدَّد» وتُعرض نصًّا، لا صفرًا. هذه
 * الدالّة **لا تقبل** بديلًا رقميًّا افتراضيًّا عمدًا: أوّل `?? 0` يضعه أحدهم
 * هنا سيجعل الشاشة تقول «٠ ريال» عن سعرٍ لم يُعتمد بعد.
 */
export function sar(v: number | null | undefined, unknownText = "غير محدَّد"): string {
  if (v === null || v === undefined || Number.isNaN(v)) return unknownText;
  return new Intl.NumberFormat("ar-SA", {
    style: "decimal", minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(v) + " ر.س";
}

export function pct(v: number | null | undefined, unknownText = "غير محدَّد"): string {
  if (v === null || v === undefined || Number.isNaN(v)) return unknownText;
  return new Intl.NumberFormat("ar-SA", {
    style: "decimal", minimumFractionDigits: 1, maximumFractionDigits: 2,
  }).format(v * 100) + "٪";
}
