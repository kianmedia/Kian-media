// ════════════════════════════════════════════════════════════════════════════
// lib/finance/financialSourcePolicy.ts — **عقد** سياسة المصدر الماليّ.
//
// Wave 5 · W5-2
//
// ★★ 🔴 هذا الملفّ **لا يقرّر شيئًا** ★★
//   يمثّل القرارات السبعة **كبيانات** ويفرض أنّ أيّ رقم ماليّ لا يُنتَج قبل
//   اتّخاذها. ⛔ ولا يحمل قيمة افتراضية واحدة — والغياب **يُفشل** ولا يُخمَّن.
//
// ★ لماذا الفشل المغلق (fail closed) هنا تحديدًا ★
//   المستودع يحمل **نطاقين** يحملان أرقامًا (`fin_*` و`project_*`) وتكاملَ Zoho
//   لا يخزّن الفاتورة الرسمية. فأيّ «قيمة افتراضية معقولة» — أوّل مصدر موجود،
//   أو الرجوع الصامت إلى الآخر عند الفراغ — **تصير هي القرار**: يقرأ الفريق
//   الرقم ويسعّر عليه، ثمّ يصير تغييره لاحقًا تغييرَ أرقامٍ اعتمد عليها الناس،
//   لا تعديلَ شيفرة.
//
// ⛔ ولا يُربط هذا العقد بأيّ واجهة إنتاج قبل اعتماد خالد للقرارات السبعة.
// ════════════════════════════════════════════════════════════════════════════

// ─── القرارات السبعة ────────────────────────────────────────────────────────

export type RevenueSource = "fin_revenue" | "fin_receivables" | "zoho";
export type CostSource = "fin_costs" | "project_expenses";
export type InvoiceSource = "zoho" | "fin_receivables";
export type VatSource = "stored" | "calculated";
/** ⛔ لا يوجد جدول أسعار صرف في القاعدة — فالتحويل التلقائيّ غير ممكن اليوم. */
export type CurrencyPolicy = "single_currency_only" | "reject_mixed" | "base_currency_conversion";
export type MarginPolicy = "net_of_vat" | "gross_including_vat" | "disabled";
export type ZohoPrecedence = "zoho_wins" | "database_wins" | "flag_conflict";

/**
 * السياسة الكاملة. **كل حقل مطلوب** — ولا `?` ولا `Partial` في التوقيع العامّ،
 * فلا يمكن تمرير سياسة ناقصة دون أن يعترض المترجم.
 */
export interface FinancialSourcePolicy {
  revenueSource: RevenueSource;
  costSource: CostSource;
  invoiceSource: InvoiceSource;
  vatSource: VatSource;
  currencyPolicy: CurrencyPolicy;
  marginPolicy: MarginPolicy;
  zohoPrecedence: ZohoPrecedence;
  /** مَن اعتمدها ومتى — ⛔ سياسة بلا اعتماد بشريّ ليست سياسة. */
  approvedBy: string;
  approvedAt: string;
}

export const POLICY_KEYS = [
  "revenueSource", "costSource", "invoiceSource", "vatSource",
  "currencyPolicy", "marginPolicy", "zohoPrecedence",
] as const;
export type PolicyKey = (typeof POLICY_KEYS)[number];

// ════════════════════════════════════════════════════════════════════════════
// 🔴 السياسة المعتمَدة من المالك — **بيانات لا افتراض**
//
//   OWNER APPROVED — PRODUCTION VERIFICATION PENDING (٥ أغسطس ٢٠٢٦)
//
// ⚠️ **وليست قيمة افتراضية.** لا دالّة واحدة أدناه تقرؤها تلقائيًّا: السياسة
//    تُمرَّر صراحةً في كلّ نداء. ولو غابت فالنتيجة `source_unselected` كما كانت
//    تمامًا — واختبار يُثبت ذلك.
// 🔴 ولماذا هذا الفصل مهمّ: لو صارت افتراضًا، لأنتج **نسيانُ التمرير** رقمًا
//    يبدو معتمَدًا. أمّا كثابت مُسمّى فالمستدعي يذكرها بالاسم ويتحمّل ذكرها.
// ⛔ والاعتماد يخصّ **الشيفرة**: التحقّق من البيانات الفعلية ما يزال
//    `PRODUCTION READ-ONLY VERIFICATION PENDING`.
// ════════════════════════════════════════════════════════════════════════════
export const OWNER_APPROVED_POLICY: FinancialSourcePolicy = {
  revenueSource: "fin_revenue",
  costSource: "fin_costs",
  invoiceSource: "zoho",
  vatSource: "stored",
  currencyPolicy: "reject_mixed",
  marginPolicy: "net_of_vat",
  zohoPrecedence: "flag_conflict",
  approvedBy: "khaled (owner)",
  approvedAt: "2026-08-05T00:00:00Z",
};

// ⛔ ولا `DEFAULT_POLICY` ولا `FALLBACK_SOURCE`: وجودُ أحدهما يجعل نسيان
//    التمرير خيارًا صامتًا بدل خطأ صريح.

// ─── حالات النتيجة ──────────────────────────────────────────────────────────

export type FinancialUnavailableReason =
  | "source_unselected"
  | "source_unverified"
  | "conflicting_values"
  | "currency_mismatch"
  | "stale_external_data"
  | "missing_mapping"
  | "duplicate_cost_candidate"
  | "manual_review_required"
  | "missing_data";

export const UNAVAILABLE_REASONS_AR: Record<FinancialUnavailableReason, string> = {
  source_unselected:       "لم يُعتمد مصدر ماليّ بعد — ⛔ ولا يُعرض رقم قبل اعتماده.",
  source_unverified:       "المصدر معتمَد ولم يُتحقَّق منه على الإنتاج.",
  conflicting_values:      "المصدران يعطيان رقمين مختلفين — يلزم حسم.",
  currency_mismatch:       "أرقام بعملات مختلفة — ⛔ ولا يوجد سعر صرف معتمَد.",
  stale_external_data:     "بيانات Zoho قديمة — لا تُعرض كأنّها حالية.",
  missing_mapping:         "لا ربط بين السجلّ ومصدره.",
  duplicate_cost_candidate:"تكلفة مرشَّحة للتكرار — تحتاج مراجعة بشرية.",
  manual_review_required:  "يحتاج مراجعة بشرية.",
  missing_data:            "لا بيانات — ⛔ وليس صفرًا.",
};

/**
 * 🔴 نتيجة مالية: إمّا قيمة **بمصدرها وعملتها**، أو تعذُّر **بسببه**.
 * ⛔ ولا حالة ثالثة، ولا `value: 0` تعني «لا بيانات».
 */
export type FinancialResult =
  | { available: true; value: number; currency: string; source: string;
      basis: "stored" | "calculated"; asOf: string | null; stale: boolean }
  | { available: false; reason: FinancialUnavailableReason; detail?: string };

export const unavailable = (
  reason: FinancialUnavailableReason, detail?: string,
): FinancialResult => ({ available: false, reason, detail });

// ─── التحقّق من اكتمال السياسة ──────────────────────────────────────────────

export type PolicyValidation =
  | { ok: true; policy: FinancialSourcePolicy }
  | { ok: false; missing: PolicyKey[]; reason: "source_unselected" | "not_approved" };

const VALID: Record<PolicyKey, readonly string[]> = {
  revenueSource:   ["fin_revenue", "fin_receivables", "zoho"],
  costSource:      ["fin_costs", "project_expenses"],
  invoiceSource:   ["zoho", "fin_receivables"],
  vatSource:       ["stored", "calculated"],
  currencyPolicy:  ["single_currency_only", "reject_mixed", "base_currency_conversion"],
  marginPolicy:    ["net_of_vat", "gross_including_vat", "disabled"],
  zohoPrecedence:  ["zoho_wins", "database_wins", "flag_conflict"],
};

/**
 * يتحقّق أنّ السياسة كاملة ومعتمَدة.
 *
 * ⛔ **لا يُكمل ناقصًا ولا يصحّح قيمة غير معروفة** — كلاهما اختيارٌ ضمنيّ.
 */
export function validatePolicy(input: unknown): PolicyValidation {
  const p = (input ?? {}) as Record<string, unknown>;
  const missing: PolicyKey[] = [];
  for (const k of POLICY_KEYS) {
    const v = p[k];
    if (typeof v !== "string" || !VALID[k].includes(v)) missing.push(k);
  }
  if (missing.length > 0) return { ok: false, missing, reason: "source_unselected" };
  // 🔴 الاعتماد البشريّ جزء من السياسة لا زينة عليها.
  if (typeof p.approvedBy !== "string" || !p.approvedBy.trim()
      || typeof p.approvedAt !== "string" || !p.approvedAt.trim()) {
    return { ok: false, missing: [], reason: "not_approved" };
  }
  return { ok: true, policy: p as unknown as FinancialSourcePolicy };
}

// ─── مُدخلات القياس ─────────────────────────────────────────────────────────

export interface AmountRow {
  source: string;
  amountNet: number | null;
  vatAmount: number | null;
  amountGross: number | null;
  currency: string | null;
  asOf?: string | null;
}

export interface ResolveOptions {
  policy: unknown;
  /** الآن — يُمرَّر ولا يُقرأ من الساعة، فالاختبار حتميّ. */
  nowIso: string;
  /** عمر بيانات Zoho المقبول. */
  maxStalenessMs?: number;
}

const DEFAULT_STALENESS_MS = 24 * 3_600_000;

/** فرق مقبول للتقريب العشريّ — ⛔ ولا يُستعمل لإخفاء تناقض حقيقيّ. */
const EPSILON = 0.01;

/**
 * 🔴 يتحقّق أنّ `gross = net + vat` **داخل الصفّ الواحد** قبل استعمال أيّ منها.
 *
 * الحقول الثلاثة **مخزَّنة**، فلا شيء في القاعدة يمنع تناقضها. واستعمال `gross`
 * وهو يناقض `net + vat` يُنتج رقمًا لا يطابق أيّ مصدر — وهو أسوأ من لا رقم.
 */
export function rowIsConsistent(r: AmountRow): boolean {
  if (r.amountGross == null || r.amountNet == null) return true;  // لا تناقض يُقاس
  return Math.abs(r.amountGross - (r.amountNet + (r.vatAmount ?? 0))) <= EPSILON;
}

/**
 * يجمع صفوفًا **بعد** فرض السياسة.
 *
 * ترتيب الفحوص مقصود: السياسة ← البيانات ← العملة ← التناقض.
 * فلا يُعرض «اختلاف عملات» على من لم يعتمد مصدرًا بعد.
 */
export function resolveAmount(rows: readonly AmountRow[], opts: ResolveOptions): FinancialResult {
  const v = validatePolicy(opts.policy);
  if (!v.ok) {
    return unavailable("source_unselected",
      v.reason === "not_approved" ? "policy_not_approved" : v.missing.join(","));
  }
  const policy = v.policy;

  // ⛔ لا صفوف ⇒ **«لا بيانات»**، وليس صفرًا. والصفر رقمٌ يُتّخذ عليه قرار.
  if (rows.length === 0) return unavailable("missing_data");

  // 🔴 العملة قبل الجمع دائمًا.
  const currencies = new Set(rows.map((r) => r.currency).filter(Boolean) as string[]);
  if (currencies.size === 0) return unavailable("missing_mapping", "no_currency");
  if (currencies.size > 1) {
    if (policy.currencyPolicy === "base_currency_conversion") {
      // ⛔ لا جدول أسعار صرف في القاعدة — فالتحويل **غير ممكن**، ولا يُختلق سعر.
      return unavailable("currency_mismatch", "no_fx_table_available");
    }
    return unavailable("currency_mismatch", Array.from(currencies).sort().join(","));
  }

  const inconsistent = rows.filter((r) => !rowIsConsistent(r));
  if (inconsistent.length > 0) {
    return unavailable("conflicting_values", `inconsistent_rows=${inconsistent.length}`);
  }

  const basis: "stored" | "calculated" = policy.vatSource === "stored" ? "stored" : "calculated";
  let total = 0;
  for (const r of rows) {
    if (basis === "stored") {
      if (r.amountNet == null) return unavailable("missing_data", "net_null");
      total += r.amountNet;
    } else {
      if (r.amountGross == null || r.vatAmount == null) {
        return unavailable("missing_data", "gross_or_vat_null");
      }
      total += r.amountGross - r.vatAmount;
    }
  }

  const stamps = rows.map((r) => r.asOf).filter(Boolean) as string[];
  const asOf = stamps.length ? stamps.slice().sort().at(-1)! : null;
  const maxAge = opts.maxStalenessMs ?? DEFAULT_STALENESS_MS;
  const stale = asOf != null
    && new Date(opts.nowIso).getTime() - new Date(asOf).getTime() > maxAge;

  // ⚠️ البيانات الخارجية القديمة **لا تُعرض كأنّها حالية**.
  if (stale && policy.zohoPrecedence === "zoho_wins" && rows.some((r) => r.source === "zoho")) {
    return unavailable("stale_external_data", asOf ?? undefined);
  }

  return {
    available: true, value: Number(total.toFixed(2)),
    currency: Array.from(currencies)[0], source: rows[0].source, basis, asOf, stale,
  };
}

// ─── الهامش ─────────────────────────────────────────────────────────────────

/**
 * 🔴 الهامش يحتاج **إيرادًا وتكلفة معتمدَين بنفس العملة**.
 *
 * ⛔ ولا يُحسب من طرف واحد: «إيراد بلا تكلفة» ليس هامشًا بنسبة 100%، بل
 *    **لا هامش**. وهذا بالضبط ما جعل `avg_margin_pct` تُعيد `null` بحقّ.
 */
export function computeMargin(
  revenue: FinancialResult, cost: FinancialResult, policy: unknown,
): FinancialResult {
  const v = validatePolicy(policy);
  if (!v.ok) return unavailable("source_unselected");
  if (v.policy.marginPolicy === "disabled") return unavailable("source_unselected", "margin_disabled");

  if (!revenue.available) return unavailable(revenue.reason, `revenue:${revenue.detail ?? ""}`);
  if (!cost.available) return unavailable(cost.reason, `cost:${cost.detail ?? ""}`);
  if (revenue.currency !== cost.currency) {
    return unavailable("currency_mismatch", `${revenue.currency}!=${cost.currency}`);
  }
  // ⛔ إيراد صفر ⇒ النسبة غير معرَّفة رياضيًّا — ولا تُعرض 0% ولا 100%.
  if (revenue.value === 0) return unavailable("missing_data", "revenue_zero");

  const pct = ((revenue.value - cost.value) / revenue.value) * 100;
  return {
    available: true, value: Number(pct.toFixed(2)), currency: revenue.currency,
    source: `${revenue.source}-${cost.source}`, basis: "calculated",
    asOf: revenue.asOf, stale: revenue.stale || cost.stale,
  };
}

/**
 * 🔴 يمنع الازدواج الحسابيّ بين نطاقَي التكلفة.
 *
 * المشروع الواحد قد يحمل تكاليف في `fin_costs` **و**`project_expenses`.
 * وجمع الاثنين يضاعف الرقم؛ واختيار أحدهما صامتًا هو القرار الذي لم يُتَّخذ بعد.
 */
export function assertSingleCostSource(
  rows: readonly AmountRow[], policy: unknown,
): FinancialResult | null {
  const v = validatePolicy(policy);
  if (!v.ok) return unavailable("source_unselected");
  const sources = new Set(rows.map((r) => r.source));
  const financial = Array.from(sources).filter((s) => s === "fin_costs" || s === "project_expenses");
  if (financial.length > 1) {
    return unavailable("duplicate_cost_candidate", financial.sort().join("+"));
  }
  if (financial.length === 1 && financial[0] !== v.policy.costSource) {
    // ⛔ ولا يُقبل مصدر لم تعتمده السياسة — ولو كان الوحيد المتاح.
    return unavailable("source_unverified", `got=${financial[0]} policy=${v.policy.costSource}`);
  }
  return null;
}

// ─── عقد التصدير ────────────────────────────────────────────────────────────

export type ExportRefusal =
  | { allowed: false; reason: FinancialUnavailableReason; detail?: string }
  | { allowed: true; policy: FinancialSourcePolicy };

/** ⛔ لا تصدير ماليّ بلا سياسة معتمَدة — الملفّ المُصدَّر يعيش أطول من أيّ تحذير. */
export function assertExportAllowed(policy: unknown): ExportRefusal {
  const v = validatePolicy(policy);
  if (!v.ok) {
    return { allowed: false, reason: "source_unselected",
             detail: v.reason === "not_approved" ? "policy_not_approved" : v.missing.join(",") };
  }
  return { allowed: true, policy: v.policy };
}

// ─── العلم ──────────────────────────────────────────────────────────────────
//
// 🔴 مقارنة صارمة بـ"1": الغياب أو الفراغ أو أيّ قيمة أخرى ⇒ **مطفأ**.
// ⛔ ولا يكفي رفعه: بلا سياسة معتمَدة تبقى كل نتيجة `unavailable`.
export function financialReportingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NEXT_PUBLIC_SHOW_FINANCIAL_REPORTING === "1";
}
