// ════════════════════════════════════════════════════════════════════════════
// lib/finance/financialReporting.ts — البنود المالية الأربعة في Wave 5.
//
// V2-5.5-B (الهامش) · V2-5.5-D (تقويم التدفّق) · V2-5.5-E (عدّاد التأخّر) ·
// V2-5.5-F (مسوّدة إشعار التعليق)
//
// ★ يقوم كلّه على السياسة المعتمَدة، ⛔ ولا يحمل مصدرًا افتراضيًّا ★
//   كل دالّة تستقبل `policy` صراحةً وتفشل مغلقةً بدونها. والسياسة المعتمَدة
//   ثابت مُسمّى في `financialSourcePolicy.ts` — ⛔ لا قيمة ضمنية.
//
// ★ ما لا يفعله هذا الملفّ ★
//   ⛔ لا نداء Zoho حيّ · لا إرسال إشعار · لا كتابة · لا تحويل عملة ·
//   ⛔ ولا تحويل `null` إلى صفر.
// ════════════════════════════════════════════════════════════════════════════
import {
  type FinancialResult, type FinancialSourcePolicy,
  validatePolicy, unavailable, resolveAmount, computeMargin,
  assertSingleCostSource, type AmountRow,
} from "@/lib/finance/financialSourcePolicy";

// ─── الأعلام — كلّها مطفأة، ومقارنة صارمة بـ"1" ────────────────────────────
export const financialCardsEnabled = (env: NodeJS.ProcessEnv = process.env) =>
  env.NEXT_PUBLIC_SHOW_FINANCIAL_REPORTING === "1";
export const suspensionNoticeEnabled = (env: NodeJS.ProcessEnv = process.env) =>
  env.NEXT_PUBLIC_SHOW_SUSPENSION_NOTICE === "1";

// ════════════════════════════════════════════════════════════════════════════
// V2-5.5-B · بطاقة الهامش
// ════════════════════════════════════════════════════════════════════════════

export interface MarginInput {
  revenueRows: readonly AmountRow[];
  costRows: readonly AmountRow[];
}

export interface MarginCard {
  amount: FinancialResult;      // الربح بالعملة
  percentage: FinancialResult;  // النسبة
  revenue: FinancialResult;
  cost: FinancialResult;
}

/**
 * 🔴 الترتيب مقصود: السياسة ← الازدواج ← المبالغ ← الهامش.
 *
 * وفحص الازدواج **قبل** الجمع تحديدًا، لأنّ جمع `fin_costs` و`project_expenses`
 * معًا يضاعف التكلفة ويُنتج هامشًا أقلّ من الحقيقة — رقمٌ خاطئ يبدو معقولًا.
 */
export function buildMarginCard(input: MarginInput, policy: unknown): MarginCard {
  const v = validatePolicy(policy);
  if (!v.ok) {
    const u = unavailable("source_unselected");
    return { amount: u, percentage: u, revenue: u, cost: u };
  }
  const now = new Date(0).toISOString();   // ⛔ لا ساعة هنا: القِدَم يُقاس في الطبقة الأعلى

  const dup = assertSingleCostSource(input.costRows, policy);
  if (dup) return { amount: dup, percentage: dup, revenue: dup, cost: dup };

  const revenue = resolveAmount(input.revenueRows, { policy, nowIso: now });
  const cost = resolveAmount(input.costRows, { policy, nowIso: now });

  if (!revenue.available || !cost.available) {
    const u = !revenue.available ? revenue : cost;
    return { amount: u, percentage: u, revenue, cost };
  }
  if (revenue.currency !== cost.currency) {
    const u = unavailable("currency_mismatch", `${revenue.currency}!=${cost.currency}`);
    return { amount: u, percentage: u, revenue, cost };
  }

  // مبلغ الهامش = الإيراد الصافي (بلا ضريبة) − التكلفة المعتمدة.
  const amount: FinancialResult = {
    available: true, value: Number((revenue.value - cost.value).toFixed(2)),
    currency: revenue.currency, source: `${revenue.source}-${cost.source}`,
    basis: "calculated", asOf: revenue.asOf, stale: revenue.stale || cost.stale,
  };
  return { amount, percentage: computeMargin(revenue, cost, policy), revenue, cost };
}

// ════════════════════════════════════════════════════════════════════════════
// V2-5.5-D · تقويم التدفّق النقديّ — من فواتير Zoho المرآة
// ════════════════════════════════════════════════════════════════════════════

/**
 * صفّ فاتورة كما هو في جدول `invoices` القائم (مرآة Zoho).
 * ⛔ ولا تكامل ثانٍ: هذا الجدول هو التكامل القائم.
 */
export interface InvoiceRow {
  id: string;
  invoice_number: string | null;
  zoho_invoice_id: string | null;
  project_id: string | null;
  client_id: string | null;
  status: string | null;          // draft · sent · paid · void …
  currency: string | null;
  total: number | null;
  due_date: string | null;        // ISO — ⛔ ولا يُخترع
  is_deleted?: boolean | null;
}

export type CashFlowBucket = "expected" | "invoiced" | "overdue" | "paid";

export interface CashFlowEntry {
  invoiceId: string;
  invoiceNumber: string | null;
  bucket: CashFlowBucket;
  amount: number;
  currency: string;
  dueDate: string;
  daysOverdue: number | null;
}

export interface CashFlowCalendar {
  entries: readonly CashFlowEntry[];
  /** ⛔ لا مبالغ إجمالية عند اختلاف العملات — القيمة تعذُّر لا رقم. */
  totals: Record<CashFlowBucket, FinancialResult>;
  /** فواتير غير مربوطة بمشروع/عميل — تُعرض **منفصلة** ولا تدخل الرسميّ. */
  unmapped: readonly InvoiceRow[];
  /** فواتير بلا تاريخ استحقاق — ⛔ ولا تُعدّ متأخّرة. */
  missingDueDate: readonly InvoiceRow[];
  conflicts: readonly string[];
}

const PAID = new Set(["paid"]);
const VOIDED = new Set(["void", "voided", "cancelled", "canceled"]);
const ISSUED = new Set(["sent", "overdue", "partially_paid", "unpaid", "open"]);

/** 🔴 مربوطة = لها مشروع **أو** عميل. وغير ذلك لا يدخل الإجماليّ الرسميّ. */
export const isMapped = (i: InvoiceRow) => Boolean(i.project_id || i.client_id);

/**
 * فرق الأيّام بمنطقة زمنية **صريحة**.
 *
 * 🔴 المقارنة تقع على **بداية اليوم** في تلك المنطقة، لا على لحظة التنفيذ:
 *    فاتورة تستحقّ اليوم ليست متأخّرة، ومقارنة اللحظات تجعلها متأخّرة بعد
 *    منتصف النهار في نصف العالم.
 * ⚠️ الافتراض `Asia/Riyadh` — والمنطقة تُمرَّر صراحةً في كلّ نداء.
 */
export function daysOverdue(dueDateIso: string, nowIso: string, timeZone = "Asia/Riyadh"): number {
  const dayIn = (iso: string) => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(new Date(iso));
    const g = (t: string) => Number(parts.find((p) => p.type === t)!.value);
    return Date.UTC(g("year"), g("month") - 1, g("day"));
  };
  return Math.floor((dayIn(nowIso) - dayIn(dueDateIso)) / 86_400_000);
}

export interface CashFlowOptions {
  policy: unknown;
  nowIso: string;
  timeZone?: string;
}

export function buildCashFlowCalendar(
  invoices: readonly InvoiceRow[], opts: CashFlowOptions,
): CashFlowCalendar {
  const v = validatePolicy(opts.policy);
  const empty = (r: FinancialResult): CashFlowCalendar => ({
    entries: [], totals: { expected: r, invoiced: r, overdue: r, paid: r },
    unmapped: [], missingDueDate: [], conflicts: [],
  });
  if (!v.ok) return empty(unavailable("source_unselected"));

  // 🔴 مصدر الفاتورة معتمَد = Zoho. ولو اعتُمد غيره فهذا الحاسب لا يعمل.
  if (v.policy.invoiceSource !== "zoho") {
    return empty(unavailable("source_unverified", `invoiceSource=${v.policy.invoiceSource}`));
  }

  const live = invoices.filter((i) => !i.is_deleted && !VOIDED.has(String(i.status ?? "")));
  const unmapped = live.filter((i) => !isMapped(i));
  const mapped = live.filter(isMapped);
  const missingDueDate = mapped.filter((i) => !i.due_date);
  const conflicts: string[] = [];

  // ⚠️ فاتورة بلا مرجع Zoho رغم أنّ Zoho هو المصدر ⇒ تعارض يُعرض ولا يُحلّ.
  for (const i of mapped) {
    if (!i.zoho_invoice_id) conflicts.push(`missing_zoho_mapping:${i.id}`);
  }

  const entries: CashFlowEntry[] = [];
  for (const i of mapped) {
    if (!i.due_date) continue;                   // ⛔ لا تاريخ ⇒ لا تصنيف زمنيّ
    if (i.total == null || !i.currency) continue; // ⛔ ولا مبلغ مخمَّن
    const status = String(i.status ?? "");
    const d = daysOverdue(i.due_date, opts.nowIso, opts.timeZone);
    let bucket: CashFlowBucket;
    if (PAID.has(status)) bucket = "paid";
    else if (ISSUED.has(status)) bucket = d > 0 ? "overdue" : "invoiced";
    else bucket = "expected";   // مسوّدة — ⛔ **متوقَّعة لا محقَّقة**
    entries.push({
      invoiceId: i.id, invoiceNumber: i.invoice_number, bucket,
      amount: i.total, currency: i.currency, dueDate: i.due_date,
      daysOverdue: bucket === "overdue" ? d : null,
    });
  }

  const sum = (b: CashFlowBucket): FinancialResult => {
    const rows = entries.filter((e) => e.bucket === b);
    if (rows.length === 0) return unavailable("missing_data");
    const cur = new Set(rows.map((e) => e.currency));
    // 🔴 ولا جمع عبر عملات — ولو داخل دلو واحد.
    if (cur.size > 1) return unavailable("currency_mismatch", Array.from(cur).sort().join(","));
    return {
      available: true, value: Number(rows.reduce((a, e) => a + e.amount, 0).toFixed(2)),
      currency: Array.from(cur)[0], source: "zoho", basis: "stored",
      asOf: null, stale: false,
    };
  };

  return {
    entries, unmapped, missingDueDate, conflicts,
    totals: { expected: sum("expected"), invoiced: sum("invoiced"),
              overdue: sum("overdue"), paid: sum("paid") },
  };
}

// ════════════════════════════════════════════════════════════════════════════
// V2-5.5-E · عدّاد التأخّر
// ════════════════════════════════════════════════════════════════════════════

export interface OverdueCounter {
  /** الإجماليّ **الرسميّ** — المربوطة ذات تاريخ استحقاق حقيقيّ فقط. */
  officialCount: number;
  officialTotal: FinancialResult;
  /** ⛔ تُعرض منفصلة ولا تُضاف. */
  unmappedCount: number;
  missingDueDateCount: number;
  oldestDays: number | null;
}

export function buildOverdueCounter(
  invoices: readonly InvoiceRow[], opts: CashFlowOptions,
): OverdueCounter {
  const cal = buildCashFlowCalendar(invoices, opts);
  const overdue = cal.entries.filter((e) => e.bucket === "overdue");
  return {
    officialCount: overdue.length,
    officialTotal: cal.totals.overdue,
    unmappedCount: cal.unmapped.length,
    missingDueDateCount: cal.missingDueDate.length,
    oldestDays: overdue.length
      ? Math.max(...overdue.map((e) => e.daysOverdue ?? 0)) : null,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// V2-5.5-F · مسوّدة إشعار التعليق المتبادل
// ════════════════════════════════════════════════════════════════════════════

export type NoticeRefusal =
  | "flag_off" | "policy_missing" | "invoice_unmapped" | "missing_invoice_number"
  | "missing_customer" | "missing_amount" | "missing_currency"
  | "missing_due_date" | "not_overdue" | "invoice_paid";

export type NoticeDraft =
  | { ok: true; subject: string; body: string; requiresHumanApproval: true }
  | { ok: false; refusal: NoticeRefusal };

export interface NoticeInput {
  invoice: InvoiceRow;
  customerName: string | null;
  nowIso: string;
  timeZone?: string;
}

/**
 * 🔴 يفشل **مغلقًا** عند نقص أيّ حقل — ⛔ ولا يطبع تقديرًا.
 *
 * ولماذا الصرامة هنا أشدّ من أيّ مكان: هذا مستند شبه قانونيّ يُرسَل إلى عميل.
 * ورقمٌ مخمَّن فيه — مبلغ أو رقم فاتورة أو مدّة تأخّر — ليس خطأ عرض، بل
 * **ادّعاء موثَّق** يصعب سحبه.
 * ⛔ ولا يُرسل شيء: `requiresHumanApproval` دائمًا، والإرسال قرار بشريّ.
 */
export function buildSuspensionNoticeDraft(
  input: NoticeInput, policy: unknown, env: NodeJS.ProcessEnv = process.env,
): NoticeDraft {
  if (!suspensionNoticeEnabled(env)) return { ok: false, refusal: "flag_off" };
  const v = validatePolicy(policy);
  if (!v.ok) return { ok: false, refusal: "policy_missing" };

  const i = input.invoice;
  // ⛔ الفاتورة غير المربوطة لا تُبنى عليها مطالبة.
  if (!isMapped(i) || !i.zoho_invoice_id) return { ok: false, refusal: "invoice_unmapped" };
  if (!i.invoice_number) return { ok: false, refusal: "missing_invoice_number" };
  if (!input.customerName || !input.customerName.trim()) return { ok: false, refusal: "missing_customer" };
  if (i.total == null) return { ok: false, refusal: "missing_amount" };
  if (!i.currency) return { ok: false, refusal: "missing_currency" };
  if (!i.due_date) return { ok: false, refusal: "missing_due_date" };
  if (PAID.has(String(i.status ?? ""))) return { ok: false, refusal: "invoice_paid" };

  const days = daysOverdue(i.due_date, input.nowIso, input.timeZone);
  if (days <= 0) return { ok: false, refusal: "not_overdue" };

  const subject = `إشعار بشأن الفاتورة رقم ${i.invoice_number}`;
  const body = [
    `السادة/ ${input.customerName.trim()}،`,
    "",
    `نشير إلى الفاتورة رقم ${i.invoice_number} بمبلغ ${i.total} ${i.currency}،`,
    `والمستحقّة بتاريخ ${i.due_date}، وقد مضى على تاريخ استحقاقها ${days} يومًا.`,
    "",
    "ووفقًا لبند التعليق المتبادل في الاتفاقية المُوقَّعة بيننا، فإنّ استمرار",
    "التأخّر في السداد يمنحنا الحقّ في تعليق تنفيذ الأعمال حتّى تسويته.",
    "",
    "ونأمل تسوية المبلغ أو موافاتنا بما يفيد، تفاديًا لأيّ تعليق.",
    "",
    "وتفضّلوا بقبول فائق الاحترام،",
    "كيان الابتكار للإنتاج الإعلامي",
  ].join("\n");

  return { ok: true, subject, body, requiresHumanApproval: true };
}
