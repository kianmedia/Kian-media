// ════════════════════════════════════════════════════════════════════════════
// lib/portal/financeOps.ts — Phase 4: المالية والربحية.
//
// أغلفة رقيقة فوق دوالّ finops_* (كلّها SECURITY DEFINER على الخادم). لا منطق
// صلاحيات هنا: ما تراه الواجهة تجميل، والمنع الحقيقيّ في القاعدة. هذا الموديول
// **أخطر ما في البرنامج**، والافتراض العمليّ أنّ الواجهة ستُتجاوَز؛ لذلك لا يوجد
// في هذا الملفّ سطر واحد يقرّر «هل يحقّ له؟» — يقرّرها الخادم ويردّ 42501.
//
// ★ الحالة الثلاثية بدل boolean ★
//   needs_migration → الدالّة غير موجودة (PGRST202/42883) ⇒ «بانتظار تفعيل
//                     قاعدة البيانات». المالك يدفع الكود قبل تشغيل الـSQL.
//   denied          → 42501/not authorized ⇒ «لا تملك صلاحية». لا يجوز أبدًا أن
//                     تُعرض كـ«ترحيلة ناقصة» — هذا الخلط أضاع دورة كاملة سابقًا.
//   error/ok        → الباقي.
//
// ★ الضريبة حقل مستقلّ ★
//   لا توجد في هذا الملفّ دالّة تُعيد «الإجمالي» وحده. كلّ عرض للمال يمرّ بـ
//   finMoneyParts التي تُعيد الصافي والضريبة والإجمالي **منفصلة**، وكلّ تصدير
//   يُبقي vat_amount عمودًا قائمًا بذاته. الإجمالي على الخادم عمود مولَّد، فلا
//   يمكن إرساله أصلًا: finMoneyPayload تحذف أيّ مفتاح إجماليّ قبل الإرسال.
// ════════════════════════════════════════════════════════════════════════════
import { prpc, type Result } from "./client";
import { pgClassify, pgIsMigrationPending, pgMessageAr } from "@/lib/portal/pgerror";

export const FIN_MIGRATION_AR =
  "الميزة بانتظار تفعيل قاعدة البيانات — لم يُشغَّل بعد docs/finance_profitability_RUNME.sql. لا يوجد خطأ في صلاحياتك.";

export const FIN_DENIED_AR =
  "البيانات المالية للشركة مقصورة على المالك وفريق المالية. هذا منع مقصود لا عطل.";

export type FinState<T> =
  | { state: "ok"; data: T }
  | { state: "needs_migration"; message: string }
  | { state: "denied"; message: string }
  | { state: "error"; message: string };

/** Map a raw PostgREST result into the tri-state above. Never guesses. */
function toState<T>(r: Result<unknown>): FinState<T> {
  if (!r.ok) {
    const d = pgClassify(r.error, r.status);
    if (pgIsMigrationPending(d)) return { state: "needs_migration", message: FIN_MIGRATION_AR };
    if (d.kind === "permission_denied" || /not authorized/i.test(r.error ?? "")) {
      return { state: "denied", message: FIN_DENIED_AR };
    }
    return { state: "error", message: pgMessageAr(r.error, r.status) };
  }
  const data = (r.data ?? {}) as Record<string, unknown>;
  // الخادم يعيد ok:false مع سبب مقروء لحالات العمل (لا استثناء) — تُعرض كما هي.
  if (data.ok === false) {
    return { state: "error", message: String(data.message ?? finReasonAr(String(data.reason ?? "unknown"))) };
  }
  return { state: "ok", data: data as unknown as T };
}

/** أسباب العمل التي يعيدها الخادم بلا رسالة — تُترجم هنا ولا تُخترع. */
export function finReasonAr(reason: string): string {
  switch (reason) {
    case "row_not_found":            return "السجلّ غير موجود أو محذوف.";
    case "not_pending":              return "هذا الطلب ليس في انتظار قرار.";
    case "already_decided":          return "صدر قرار في هذا الطلب فخرج من يدك.";
    case "not_approved":             return "لا يُصرَف طلب لم يُعتمد.";
    case "second_approval_required": return "هذا المبلغ يتطلّب اعتمادًا ثانيًا قبل الصرف.";
    case "second_not_required":      return "هذا الطلب لا يتطلّب اعتمادًا ثانيًا.";
    case "same_approver_forbidden":  return "المعتمِد الثاني يجب أن يكون شخصًا آخر.";
    case "self_approval_forbidden":  return "لا تعتمد طلبك بنفسك — فصل المهامّ ضابط لا شكليّة.";
    case "threshold_exceeded":       return "المبلغ يتجاوز سقف اعتمادك ويتطلّب اعتماد المالك.";
    case "exceeds_outstanding":      return "مبلغ التحصيل أكبر من المتبقّي على هذه الذمّة.";
    case "below_collected":          return "لا تُخفَّض الذمّة تحت ما حُصِّل منها فعلًا.";
    case "receivable_required":      return "الذمّة مطلوبة.";
    case "budget_required":          return "الميزانية مطلوبة.";
    case "budget_locked":            return "الميزانية مُقفَلة — فتحها بيد المالك.";
    case "po_issued":                return "أمر الشراء صادر ولا يُعدَّل. ألغِه وأصدِر أمرًا جديدًا.";
    case "po_closed":                return "أمر الشراء مغلق.";
    case "po_required":              return "أمر الشراء مطلوب.";
    case "invalid_transition":       return "انتقال حالة غير مسموح.";
    case "receive_before_issue":     return "لا يُستلَم بند قبل إصدار أمر الشراء.";
    case "supplier_required":        return "المورّد مطلوب.";
    case "request_required":         return "الطلب مطلوب.";
    case "reason_required":          return "السبب مطلوب (٣ أحرف على الأقلّ).";
    case "invalid_action":           return "إجراء غير معروف.";
    case "invalid_status":           return "حالة غير معروفة.";
    case "invalid_scope":            return "نطاق حدّ غير معروف.";
    case "invalid_commitment":       return "نوع التزام غير معروف.";
    case "invalid_quantity":         return "الكمّية يجب أن تكون أكبر من صفر.";
    case "invalid_amount":           return "مبلغ أو نسبة غير صالحة.";
    case "invalid_vat_rate":         return "نسبة الضريبة يجب أن تكون بين ٠ و١٠٠.";
    case "negative_amount":          return "المبلغ لا يكون سالبًا.";
    case "negative_vat":             return "الضريبة لا تكون سالبة.";
    case "gross_not_writable":       return "لا يُرسَل الإجمالي: الضريبة حقل مستقلّ والإجمالي يُحسب في القاعدة.";
    case "cycle_detected":           return "دورة في شجرة مراكز التكلفة — اختر أبًا آخر.";
    case "bank_ref_too_sensitive":   return "لا يُخزَّن رقم حساب بنكيّ كامل. اكتب اسم البنك وآخر أربعة أرقام فقط.";
    case "entity_required":          return "السجلّ المرتبط بالمرفق مطلوب.";
    case "file_required":            return "رابط الملفّ مطلوب.";
    case "unknown_kind":             return "نوع سجلّ غير معروف.";
    case "unknown_dataset":          return "مجموعة تصدير غير معروفة.";
    case "event_required":           return "نوع الحدث مطلوب.";
    default:                         return "تعذّر تنفيذ الطلب.";
  }
}

// ─── العقد مع القاعدة (أسماء وأنواع) ───────────────────────────────────────

export interface FinAccess {
  ok: boolean;
  authenticated: boolean;
  can_view: boolean;
  can_manage: boolean;
  can_approve: boolean;
  can_view_profit: boolean;
  can_manage_receivables: boolean;
  can_export: boolean;
  can_request: boolean;
  is_client: boolean;
  user_id: string | null;
  message: string | null;
}

export type FinCostType =
  | "crew" | "freelancer" | "travel" | "equipment_rental"
  | "production_purchase" | "logistics" | "software" | "other";
export type FinCommitment = "committed" | "actual";
export type FinExportDataset =
  | "costs" | "receivables" | "collections" | "budget_lines"
  | "expense_requests" | "purchase_orders" | "revenue";
export type FinDeleteKind =
  | "cost_center" | "category" | "supplier" | "budget" | "budget_line" | "contract"
  | "revenue" | "retainer" | "receivable" | "collection" | "milestone" | "threshold"
  | "expense_request" | "purchase_request" | "purchase_item" | "purchase_order"
  | "po_item" | "cost" | "attachment";
export type FinAttachmentEntity =
  | "expense_request" | "purchase_request" | "purchase_order" | "cost"
  | "receivable" | "collection" | "contract" | "supplier" | "budget";

export const COST_TYPE_AR: Record<FinCostType, string> = {
  crew: "طاقم", freelancer: "مستقلّ", travel: "سفر وتنقّل",
  equipment_rental: "تأجير معدّات", production_purchase: "مشتريات إنتاج",
  logistics: "لوجستيّات", software: "برمجيّات واشتراكات", other: "أخرى",
};
export const COMMITMENT_AR: Record<FinCommitment, string> = {
  committed: "التزام", actual: "فعليّ",
};
export const EXPENSE_STATUS_AR: Record<string, string> = {
  draft: "مسوّدة", submitted: "بانتظار قرار", approved: "معتمد",
  rejected: "مرفوض", paid: "مصروف", cancelled: "ملغى",
};
export const PURCHASE_STATUS_AR: Record<string, string> = {
  draft: "مسوّدة", submitted: "بانتظار قرار", approved: "معتمد",
  rejected: "مرفوض", ordered: "صدر له أمر شراء", cancelled: "ملغى",
};
export const PO_STATUS_AR: Record<string, string> = {
  draft: "مسوّدة", issued: "صادر", partially_received: "مستلَم جزئيًّا",
  received: "مستلَم", closed: "مغلق", cancelled: "ملغى",
};
export const BUDGET_STATUS_AR: Record<string, string> = {
  draft: "مسوّدة", active: "نشطة", locked: "مُقفَلة", closed: "مغلقة",
};
export const COLLECTION_STATUS_AR: Record<string, string> = {
  draft: "مسوّدة", not_due: "غير مستحقّة", due: "مستحقّة", overdue: "متأخّرة",
  partially_collected: "محصَّلة جزئيًّا", collected: "محصَّلة",
  written_off: "مشطوبة", void: "ملغاة",
};
export const AGING_AR: Record<string, string> = {
  current: "غير متأخّر", "1_30": "١–٣٠ يومًا", "31_60": "٣١–٦٠ يومًا",
  "61_90": "٦١–٩٠ يومًا", over_90: "أكثر من ٩٠ يومًا",
};
export const COLLECTION_COLOR: Record<string, string> = {
  collected: "text-emerald-300", partially_collected: "text-sky-300",
  due: "text-amber-300", overdue: "text-red-300", not_due: "text-stone-300",
  draft: "text-stone-400", written_off: "text-stone-500", void: "text-stone-500",
};

/** صفوف الأبناء تُمرَّر كما هي — الخادم مصدر أسماء الحقول، لا نعيد تشكيلها. */
export type FinRow = Record<string, unknown>;

export interface FinVariance {
  found: boolean;
  budget_id?: string;
  planned_gross: number; committed_gross: number; actual_gross: number;
  consumed_gross: number; variance_gross: number;
  consumed_pct: number | null; over_budget: boolean;
  lines: FinRow[];
  reason?: string;
}
export interface FinReceivableState {
  found: boolean;
  gross: number; collected: number; outstanding: number;
  collection_status: string; is_overdue: boolean; days_overdue: number;
  aging_bucket: string;
  reason?: string;
}
export interface FinProfit {
  project_id: string | null; from: string | null; to: string | null;
  revenue_net: number; revenue_gross: number;
  direct_cost_net: number; direct_cost_gross: number;
  gross_profit_net: number; gross_margin_pct: number | null;
  overhead_rate_pct: number;
  estimated_net_profit: number; estimated_net_margin_pct: number | null;
  /** "net_of_vat" — الضريبة ليست ربحًا ولا تكلفة. */
  basis: string;
  /** دائمًا true: صافي الربح تقديريّ ولا يقوم مقام الدفاتر المحاسبية. */
  is_estimate: boolean;
  note: string;
  project_label?: string | null;
}
export interface FinDashboard {
  ok: boolean; from: string; to: string;
  counters: Record<string, number>;
  aging: Record<string, number>;
  over_budget: FinRow[];
  pending_expenses: FinRow[];
  /** false ⇒ الربحية محجوبة عن هذا المستخدم، والحقل profit يساوي null. */
  profit_visible: boolean;
  profit: FinProfit | null;
  profit_message?: string;
}
export interface FinLookups {
  ok: boolean;
  cost_centers: { id: string; code: string; name_ar: string; kind: string }[];
  categories: { id: string; key: string; name_ar: string; cost_nature: string; default_vat_rate: number }[];
  suppliers: { id: string; code: string; name: string; supplier_type: string }[];
  budgets: { id: string; code: string; title: string; status: string }[];
  thresholds: FinRow[];
}
/** مراجع مُقدِّم الطلب: أسماء فقط. لا مبالغ ولا ميزانيات ولا حدود اعتماد. */
export interface FinRequestLookups {
  ok: boolean;
  categories: { id: string; key: string; name_ar: string }[];
  cost_centers: { id: string; code: string; name_ar: string }[];
}
export interface FinMyRequests {
  ok: boolean;
  expense_requests: FinRow[];
  purchase_requests: FinRow[];
  /** "own_rows_only" — تصريح من الخادم بأنّ النطاق صفوف صاحب الجلسة وحدها. */
  scope: string;
}
export interface FinReceivables {
  ok: boolean;
  rows: FinRow[];
  totals: {
    invoiced_gross: number; collected_gross: number; outstanding_gross: number;
    overdue_gross: number; overdue_count: number;
    aging: Record<string, number>;
  };
  note: string;
}
export interface FinProfitability {
  ok: boolean;
  company: FinProfit;
  by_project: FinProfit[];
  contracts: FinRow[];
  retainers: FinRow[];
}
export interface FinExport {
  ok: boolean; dataset: string; columns: string[]; rows: FinRow[]; note: string;
}
/** تشخيص Zoho Books. connected مثبَّتة false في جسم الدالّة على الخادم. */
export interface FinZohoDiagnostic {
  ok: boolean;
  connected: false;
  integration_state: string;
  live_sync_attempted: boolean;
  credentials_read: boolean;
  outbox: { pending: number; failed: number; held: number; delivered: number; note: string };
  checks: { key: string; status: string; detail: string }[];
  message: string;
}

// ─── المال: ثلاث قيم لا قيمة واحدة ─────────────────────────────────────────

export interface FinMoneyParts { net: number; vat: number; gross: number; currency: string }

const n = (v: unknown): number => {
  const x = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(x) ? x : 0;
};

/**
 * يفكّك صفًّا ماليًّا إلى صافٍ وضريبةٍ وإجماليّ **منفصلة**. لا يوجد بديل يُعيد
 * الإجمالي وحده: عرض الإجمالي بلا ضريبته هو بالضبط ما يجعل الضريبة تختفي في
 * تقرير، ثمّ تُكتشف عند المراجعة الضريبية.
 */
export function finMoneyParts(row: FinRow | null | undefined): FinMoneyParts {
  const r = (row ?? {}) as Record<string, unknown>;
  const net = n(r.amount_net ?? r.line_net ?? r.planned_net);
  const vat = n(r.vat_amount ?? r.planned_vat);
  const grossRaw = r.amount_gross ?? r.line_gross ?? r.planned_gross;
  const gross = grossRaw === undefined || grossRaw === null ? net + vat : n(grossRaw);
  return { net, vat, gross, currency: String(r.currency ?? "SAR") };
}

/** تنسيق مبلغ واحد بالأرقام اللاتينية (أوضح في الجداول المالية) + العملة. */
export function finAmount(v: unknown, currency = "SAR"): string {
  const x = n(v);
  return `${x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

/** نسبة مئوية أو «—» — لا صفر كاذب حين لا يوجد مقام. */
export function finPct(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  const x = n(v);
  return `${x.toLocaleString("en-US", { maximumFractionDigits: 1 })}٪`;
}

export function finDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("ar-SA-u-nu-latn",
      { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Riyadh" });
  } catch { return String(iso).slice(0, 10); }
}
export function finDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("ar-SA-u-nu-latn",
      { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
        timeZone: "Asia/Riyadh" });
  } catch { return String(iso); }
}
/** YYYY-MM-DD بتوقيت الرياض — لقيم <input type="date">. */
export function finIsoDay(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

/**
 * ينظّف حمولة قبل الإرسال: يحذف الحقول الفارغة، و**يحذف أيّ مفتاح إجماليّ**.
 * الخادم يرفض الإجماليّ برسالة gross_not_writable؛ حذفه هنا يمنع خطأ مستخدم
 * لا يفهم سببه، ولا يُخفي القاعدة: الاختبار يتحقّق من الرفض على الخادم أيضًا.
 */
export function finMoneyPayload(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (k === "amount_gross" || k === "total" || k === "amount_total" || k === "grand_total") continue;
    if (v === undefined || v === null || v === "") continue;
    out[k] = v;
  }
  return out;
}

/**
 * يبني CSV من نتيجة finops_export. عمود الضريبة يبقى عمودًا مستقلًّا كما جاء
 * من الخادم؛ لا يُدمج ولا يُحذف. BOM في المقدّمة كي يفتح Excel العربية سليمة.
 */
export function finExportCsv(x: FinExport): string {
  const cols = Array.isArray(x.columns) ? x.columns : [];
  const esc = (v: unknown): string => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = cols.map(esc).join(",");
  const body = (x.rows ?? []).map((r) => cols.map((c) => esc((r as FinRow)[c])).join(",")).join("\n");
  return `﻿${head}\n${body}`;
}

// ─── القراءة ────────────────────────────────────────────────────────────────

export const finAccess = () =>
  prpc<FinAccess>("finops_access", {}).then((r) => toState<FinAccess>(r));

export const finLookups = () =>
  prpc<unknown>("finops_lookups", {}).then((r) => toState<FinLookups>(r));

export const finRequestLookups = () =>
  prpc<unknown>("finops_request_lookups", {}).then((r) => toState<FinRequestLookups>(r));

export const finBudgetsList = (filters: Record<string, unknown> = {}) =>
  prpc<unknown>("finops_budgets_list", { p_filters: filters })
    .then((r) => toState<{ ok: boolean; rows: FinRow[] }>(r));

export const finBudgetVariance = (budgetId: string) =>
  prpc<unknown>("finops_budget_variance", { p_budget: budgetId })
    .then((r) => toState<{ ok: boolean; variance: FinVariance }>(r));

export const finCostsList = (filters: Record<string, unknown> = {}) =>
  prpc<unknown>("finops_costs_list", { p_filters: filters })
    .then((r) => toState<{ ok: boolean; rows: FinRow[] }>(r));

export const finSuppliersList = (filters: Record<string, unknown> = {}) =>
  prpc<unknown>("finops_suppliers_list", { p_filters: filters })
    .then((r) => toState<{ ok: boolean; rows: FinRow[] }>(r));

export const finExpenseRequestsList = (filters: Record<string, unknown> = {}) =>
  prpc<unknown>("finops_expense_requests_list", { p_filters: filters })
    .then((r) => toState<{ ok: boolean; rows: FinRow[] }>(r));

/** قائمة الموظّف — الخادم يقيّدها بـrequested_by = auth.uid()، لا فلتر من هنا. */
export const finMyRequests = (filters: Record<string, unknown> = {}) =>
  prpc<unknown>("finops_my_requests", { p_filters: filters }).then((r) => toState<FinMyRequests>(r));

export const finPurchaseList = (filters: Record<string, unknown> = {}) =>
  prpc<unknown>("finops_purchase_list", { p_filters: filters })
    .then((r) => toState<{ ok: boolean; requests: FinRow[]; purchase_orders: FinRow[] }>(r));

export const finReceivables = (filters: Record<string, unknown> = {}) =>
  prpc<unknown>("finops_receivables", { p_filters: filters }).then((r) => toState<FinReceivables>(r));

/** ★ أضيق بوّابة ★ — يُرفض على الخادم بلا finance_ops.view_profit. */
export const finProfitability = (filters: Record<string, unknown> = {}) =>
  prpc<unknown>("finops_profitability", { p_filters: filters }).then((r) => toState<FinProfitability>(r));

export const finDashboard = (filters: Record<string, unknown> = {}) =>
  prpc<unknown>("finops_dashboard", { p_filters: filters }).then((r) => toState<FinDashboard>(r));

export const finAuditList = (filters: Record<string, unknown> = {}) =>
  prpc<unknown>("finops_audit_list", { p_filters: filters })
    .then((r) => toState<{ ok: boolean; rows: FinRow[] }>(r));

export const finExport = (dataset: FinExportDataset, filters: Record<string, unknown> = {}) =>
  prpc<unknown>("finops_export", { p_dataset: dataset, p_filters: filters })
    .then((r) => toState<FinExport>(r));

export const finZohoDiagnostic = () =>
  prpc<unknown>("finops_zoho_diagnostic", {}).then((r) => toState<FinZohoDiagnostic>(r));

// ─── الكتابة ────────────────────────────────────────────────────────────────

type Ok = { ok: boolean; id: string };

export const finCostCenterUpsert = (payload: Record<string, unknown>) =>
  prpc<unknown>("finops_cost_center_upsert", { p_payload: finMoneyPayload(payload) })
    .then((r) => toState<Ok>(r));

export const finCategoryUpsert = (payload: Record<string, unknown>) =>
  prpc<unknown>("finops_category_upsert", { p_payload: finMoneyPayload(payload) })
    .then((r) => toState<Ok>(r));

export const finSupplierUpsert = (payload: Record<string, unknown>) =>
  prpc<unknown>("finops_supplier_upsert", { p_payload: finMoneyPayload(payload) })
    .then((r) => toState<Ok>(r));

/** حدود الاعتماد: المالك وحده — والخادم يفرضها، لا إخفاء الزرّ. */
export const finThresholdUpsert = (payload: Record<string, unknown>) =>
  prpc<unknown>("finops_threshold_upsert", { p_payload: finMoneyPayload(payload) })
    .then((r) => toState<Ok>(r));

export const finBudgetUpsert = (payload: Record<string, unknown>) =>
  prpc<unknown>("finops_budget_upsert", { p_payload: finMoneyPayload(payload) })
    .then((r) => toState<Ok>(r));

export const finBudgetLineUpsert = (payload: Record<string, unknown>) =>
  prpc<unknown>("finops_budget_line_upsert", { p_payload: finMoneyPayload(payload) })
    .then((r) => toState<Ok & { money: FinRow }>(r));

export const finContractUpsert = (payload: Record<string, unknown>) =>
  prpc<unknown>("finops_contract_upsert", { p_payload: finMoneyPayload(payload) })
    .then((r) => toState<Ok & { money: FinRow; state: FinRow }>(r));

export const finRevenueUpsert = (payload: Record<string, unknown>) =>
  prpc<unknown>("finops_revenue_upsert", { p_payload: finMoneyPayload(payload) })
    .then((r) => toState<Ok & { money: FinRow }>(r));

export const finRetainerUpsert = (payload: Record<string, unknown>) =>
  prpc<unknown>("finops_retainer_upsert", { p_payload: finMoneyPayload(payload) })
    .then((r) => toState<Ok & { money: FinRow }>(r));

export const finReceivableUpsert = (payload: Record<string, unknown>) =>
  prpc<unknown>("finops_receivable_upsert", { p_payload: finMoneyPayload(payload) })
    .then((r) => toState<Ok & { money: FinRow; state: FinReceivableState }>(r));

export const finCollectionRecord = (payload: Record<string, unknown>) =>
  prpc<unknown>("finops_collection_record", { p_payload: finMoneyPayload(payload) })
    .then((r) => toState<Ok & { state: FinReceivableState }>(r));

export const finMilestoneUpsert = (payload: Record<string, unknown>) =>
  prpc<unknown>("finops_milestone_upsert", { p_payload: finMoneyPayload(payload) })
    .then((r) => toState<Ok & { money: FinRow }>(r));

export const finCostUpsert = (payload: Record<string, unknown>) =>
  prpc<unknown>("finops_cost_upsert", { p_payload: finMoneyPayload(payload) })
    .then((r) => toState<Ok & { money: FinRow }>(r));

/** طلب الصرف — الخادم ينسبه لصاحب الجلسة ولا يقرأ هويّة من الحمولة. */
export const finExpenseRequestSubmit = (payload: Record<string, unknown>) =>
  prpc<unknown>("finops_expense_request_submit", { p_payload: finMoneyPayload(payload) })
    .then((r) => toState<Ok & { status: string; money: FinRow }>(r));

export const finExpenseDecide = (
  id: string, action: "approved" | "rejected" | "returned", note?: string,
) =>
  prpc<unknown>("finops_expense_decide", { p_id: id, p_action: action, p_note: note ?? null })
    .then((r) => toState<{ ok: boolean; id: string; action: string; cost_id: string | null; threshold: FinRow }>(r));

export const finExpenseMarkPaid = (id: string, paidOn?: string) =>
  prpc<unknown>("finops_expense_mark_paid", { p_id: id, p_paid_on: paidOn ?? null })
    .then((r) => toState<{ ok: boolean; id: string; cost_id: string | null }>(r));

export const finExpenseSecondApprove = (id: string, note?: string) =>
  prpc<unknown>("finops_expense_second_approve", { p_id: id, p_note: note ?? null })
    .then((r) => toState<{ ok: boolean; id: string }>(r));

export const finPurchaseRequestSubmit = (payload: Record<string, unknown>) =>
  prpc<unknown>("finops_purchase_request_submit", { p_payload: finMoneyPayload(payload) })
    .then((r) => toState<Ok & { status: string; money: FinRow }>(r));

export const finPurchaseItemUpsert = (payload: Record<string, unknown>) =>
  prpc<unknown>("finops_purchase_item_upsert", { p_payload: finMoneyPayload(payload) })
    .then((r) => toState<{ ok: boolean; id: string; request_id: string }>(r));

export const finPurchaseDecide = (id: string, action: "approved" | "rejected", note?: string) =>
  prpc<unknown>("finops_purchase_decide", { p_id: id, p_action: action, p_note: note ?? null })
    .then((r) => toState<{ ok: boolean; id: string; action: string; threshold: FinRow }>(r));

export const finPoUpsert = (payload: Record<string, unknown>) =>
  prpc<unknown>("finops_po_upsert", { p_payload: finMoneyPayload(payload) })
    .then((r) => toState<Ok & { money: FinRow }>(r));

export const finPoItemUpsert = (payload: Record<string, unknown>) =>
  prpc<unknown>("finops_po_item_upsert", { p_payload: finMoneyPayload(payload) })
    .then((r) => toState<{ ok: boolean; id: string; po_id: string }>(r));

export const finPoSetStatus = (
  id: string,
  status: "issued" | "partially_received" | "received" | "closed" | "cancelled",
  note?: string,
) =>
  prpc<unknown>("finops_po_set_status", { p_id: id, p_status: status, p_note: note ?? null })
    .then((r) => toState<{ ok: boolean; id: string; status: string; cost_id: string | null }>(r));

export const finAttachmentAdd = (payload: Record<string, unknown>) =>
  prpc<unknown>("finops_attachment_add", { p_payload: finMoneyPayload(payload) })
    .then((r) => toState<Ok>(r));

export const finRowDelete = (kind: FinDeleteKind, id: string, reason: string) =>
  prpc<unknown>("finops_row_delete", { p_kind: kind, p_id: id, p_reason: reason })
    .then((r) => toState<{ ok: boolean; id: string; kind: string }>(r));

/**
 * صندوق صادر Zoho Books. ★ لا يُرسل شيئًا ★: الصفّ يُحفَظ بحالة held ويعود
 * الردّ ومعه sent=false. لا عامل يقرأ هذا الصندوق، ولا بيانات اعتماد تُقرأ.
 * التفاصيل: docs/ZOHO_BOOKS_INTEGRATION_CONTRACT.md.
 */
export const finZohoEnqueue = (payload: Record<string, unknown>) =>
  prpc<unknown>("finops_zoho_outbox_enqueue", { p_payload: payload })
    .then((r) => toState<{ ok: boolean; id: string; status: string; sent: false; message: string }>(r));

export const finZohoReplay = (id: string, note?: string) =>
  prpc<unknown>("finops_zoho_outbox_replay", { p_id: id, p_note: note ?? null })
    .then((r) => toState<{ ok: boolean; id: string; status: string; sent: false; message: string }>(r));
