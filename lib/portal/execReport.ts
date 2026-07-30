// ════════════════════════════════════════════════════════════════════════════
// lib/portal/execReport.ts — المرحلة ٥: التقارير التنفيذية.
//
// أغلفة رقيقة فوق دوالّ mgmt_* (كلّها SECURITY DEFINER على الخادم). لا منطق
// صلاحيات هنا: ما تراه الواجهة تجميل، والمنع الحقيقيّ في القاعدة، والافتراض
// العمليّ أنّ هذه الطبقة ستُتجاوَز.
//
// ★ العقد الذي يحرسه هذا الملفّ ★
//   القاعدة لا تُعيد قيمةً لمؤشّر خارج الحالة ok. هذا الملفّ **لا يُصلح ذلك**
//   ولا يستبدل NULL بصفر في أيّ مكان: kpiValue تعيد null، وkpiText تعيد نصًّا
//   يشرح السبب. صفرٌ معروض هنا يعني صفرًا جاء من القاعدة.
//
// ★ ثلاث حالات لا تُخلَط أبدًا (كلّفنا دورة إنتاج كاملة سابقًا) ★
//   needs_migration → الدالّة غير موجودة (PGRST202/42883) ⇒ «بانتظار تفعيل
//                     قاعدة البيانات». الكود يُدفَع قبل تشغيل الـSQL بالتصميم.
//   denied          → 42501/not authorized ⇒ «لا تملك صلاحية».
//   error           → ما عدا ذلك، برسالة pgerror الأمينة.
//
// ★ الطزاجة ★
//   كلّ ردّ من mgmt_dashboard يحمل generated_at وage_seconds وis_stale. الواجهة
//   ملزَمة بعرضها. الدالّتان freshnessLabel/isStale هنا هما المصدر الوحيد لذلك.
// ════════════════════════════════════════════════════════════════════════════
import { prpc, type Result } from "./client";
import { pgClassify, pgIsMigrationPending, pgMessageAr } from "@/lib/portal/pgerror";

export type Lang = "ar" | "en";

export const EXEC_MIGRATION_AR =
  "الميزة بانتظار تفعيل قاعدة البيانات — لم يُشغَّل بعد docs/executive_reporting_RUNME.sql. لا يوجد خطأ في صلاحياتك.";
export const EXEC_MIGRATION_EN =
  "This feature is waiting for its database migration — docs/executive_reporting_RUNME.sql has not been run yet. Nothing is wrong with your permissions.";

export const EXEC_DENIED_AR =
  "اللوحة التنفيذية داخلية ومقصورة على من مُنح مفتاح exec_report.view. هذا منع مقصود لا عطل.";
export const EXEC_DENIED_EN =
  "The executive dashboard is internal and limited to holders of exec_report.view. This is a deliberate denial, not a fault.";

export type ExecState<T> =
  | { state: "ok"; data: T }
  | { state: "needs_migration"; message: string }
  | { state: "denied"; message: string }
  | { state: "error"; message: string };

/** Map a raw PostgREST result into the tri-state above. Never guesses. */
function toState<T>(r: Result<unknown>, lang: Lang): ExecState<T> {
  if (!r.ok) {
    const d = pgClassify(r.error, r.status);
    if (pgIsMigrationPending(d)) {
      return { state: "needs_migration", message: lang === "ar" ? EXEC_MIGRATION_AR : EXEC_MIGRATION_EN };
    }
    if (d.kind === "permission_denied" || /not authorized/i.test(r.error ?? "")) {
      return { state: "denied", message: lang === "ar" ? EXEC_DENIED_AR : EXEC_DENIED_EN };
    }
    return { state: "error", message: pgMessageAr(r.error, r.status) };
  }
  const data = (r.data ?? {}) as Record<string, unknown>;
  if (data.ok === false) {
    const msg = lang === "ar" ? data.message_ar : data.message_en;
    return {
      state: "error",
      message: String(msg ?? execReasonText(String(data.reason ?? data.error ?? "unknown"), lang)),
    };
  }
  return { state: "ok", data: data as unknown as T };
}

/** أسباب العمل التي يعيدها الخادم بلا رسالة — تُترجَم هنا ولا تُخترَع. */
export function execReasonText(reason: string, lang: Lang): string {
  const AR: Record<string, string> = {
    unknown_dataset: "مجموعة تصدير غير معروفة.",
    dashboard_unavailable: "تعذّر بناء اللوحة، فلا شيء يُصدَّر.",
    compute_failed: "تعذّر حساب اللوحة ولا توجد نسخة سابقة تُعرض.",
    not_authorized: "لا تملك صلاحية هذا الإجراء.",
  };
  const EN: Record<string, string> = {
    unknown_dataset: "Unknown export dataset.",
    dashboard_unavailable: "The dashboard could not be built, so there is nothing to export.",
    compute_failed: "The dashboard could not be computed and there is no earlier copy.",
    not_authorized: "You do not have permission for this action.",
  };
  const t = (lang === "ar" ? AR : EN)[reason];
  return t ?? (lang === "ar" ? "تعذّر تنفيذ الطلب." : "The request could not be completed.");
}

// ─── العقد مع القاعدة (أسماء وأنواع تُطابق mgmt_*) ─────────────────────────

export type ExecDepartment = "production" | "sales" | "finance" | "communications";

export const EXEC_DEPARTMENTS: ExecDepartment[] = ["production", "sales", "finance", "communications"];

/**
 * حالة المؤشّر. ★ الفرق بين هذه القيم هو كلّ الموضوع ★
 *   ok            رقم حقيقيّ.
 *   unavailable   الموديول غير مطبَّق — لا نعرف، ولسنا نقول «صفر».
 *   restricted    ممنوع عنك (المالك وحده، أو الموديول المصدر رفضك).
 *   no_basis      لا أساس للحساب (لا مهامّ ⇒ لا نسبة جاهزية). ليس ١٠٠٪.
 *   filtered_out  خارج مرشّح الأقسام المختار.
 *   error         عطل مُعلَن برمزه.
 */
export type ExecKpiState =
  | "ok" | "unavailable" | "restricted" | "no_basis" | "filtered_out" | "error";

export type ExecUnit = "count" | "money" | "percent";

export interface ExecKpi {
  key: string;
  department: ExecDepartment | string;
  unit: ExecUnit;
  sensitive: boolean;
  state: ExecKpiState;
  /** null في كلّ حالة غير ok. لا يُستبدَل بصفر هنا ولا في أيّ مكان. */
  value: number | null;
  count: number | null;
  detail: Record<string, unknown>;
  reason: string | null;
  message_ar: string | null;
  message_en: string | null;
  /** filtered = يحترم مرشّح التاريخ · current_state / module_default = لا يحترمه. */
  date_scope: "filtered" | "current_state" | "module_default" | string;
}

export interface ExecAlert {
  key: string;
  severity: "high" | "medium" | "low" | string;
  department: string;
  sensitive: boolean;
  title_ar: string; title_en: string;
  detail_ar: string; detail_en: string;
}

export interface ExecFilters {
  from?: string;
  to?: string;
  departments?: ExecDepartment[];
  ttl_seconds?: number;
}

export interface ExecNormFilters {
  from: string; to: string;
  departments: ExecDepartment[];
  unknown_departments: string[];
  ttl_seconds: number;
  fallback?: boolean;
  fallback_reason_ar?: string;
  fallback_reason_en?: string;
}

export interface ExecDashboard {
  ok: boolean;
  kpis: ExecKpi[];
  alerts: ExecAlert[];
  sensitive_visible: boolean;
  sensitive_message_ar: string | null;
  sensitive_message_en: string | null;
  /** ★ الطزاجة ★ — لا تُعرض أرقام بلا هذه الحقول. */
  generated_at: string | null;
  age_seconds: number | null;
  ttl_seconds: number;
  is_stale: boolean;
  from_cache: boolean;
  served_at: string;
  compute_ms?: number;
  stale_reason?: string;
  stale_sqlstate?: string;
  stale_message_ar?: string;
  stale_message_en?: string;
  filters: ExecNormFilters;
}

export interface ExecAccess {
  ok: boolean;
  authenticated: boolean;
  user_id: string | null;
  can_view: boolean;
  can_view_sensitive: boolean;
  can_export: boolean;
  is_client: boolean;
  departments?: string[];
  message_ar: string | null;
  message_en: string | null;
}

export interface ExecSource {
  module: ExecDepartment;
  installed: boolean;
  /** null = تعذّر تقييم بوّابة الموديول. لا يُقرأ كـfalse ولا كـtrue. */
  authorized: boolean | null;
  runme: string;
  note_ar: string | null;
  note_en: string | null;
}

export interface ExecSources { ok: boolean; sources: ExecSource[]; checked_at: string }

export interface ExecExport {
  ok: boolean;
  dataset: "kpis" | "alerts";
  columns: string[];
  rows: Record<string, unknown>[];
  generated_at: string | null;
  is_stale: boolean;
  age_seconds: number | null;
  filters: ExecNormFilters;
  sensitive_visible: boolean;
  note_ar: string; note_en: string;
}

// ─── الاستدعاءات ───────────────────────────────────────────────────────────

export async function execAccess(lang: Lang = "ar"): Promise<ExecState<ExecAccess>> {
  return toState<ExecAccess>(await prpc<ExecAccess>("mgmt_access"), lang);
}

export async function execSources(lang: Lang = "ar"): Promise<ExecState<ExecSources>> {
  return toState<ExecSources>(await prpc<ExecSources>("mgmt_sources"), lang);
}

export async function execDashboard(
  filters: ExecFilters = {}, force = false, lang: Lang = "ar",
): Promise<ExecState<ExecDashboard>> {
  return toState<ExecDashboard>(
    await prpc<ExecDashboard>("mgmt_dashboard", { p_filters: filters, p_force_refresh: force }), lang);
}

export async function execRefresh(
  filters: ExecFilters = {}, lang: Lang = "ar",
): Promise<ExecState<ExecDashboard>> {
  return toState<ExecDashboard>(await prpc<ExecDashboard>("mgmt_refresh", { p_filters: filters }), lang);
}

export async function execExport(
  dataset: "kpis" | "alerts", filters: ExecFilters = {}, lang: Lang = "ar",
): Promise<ExecState<ExecExport>> {
  return toState<ExecExport>(
    await prpc<ExecExport>("mgmt_export", { p_dataset: dataset, p_filters: filters }), lang);
}

export async function execAuditList(
  limit = 100, lang: Lang = "ar",
): Promise<ExecState<{ ok: boolean; rows: Record<string, unknown>[] }>> {
  return toState(await prpc("mgmt_audit_list", { p_limit: limit }), lang);
}

// ─── التسميات ──────────────────────────────────────────────────────────────

export const KPI_LABEL: Record<string, { ar: string; en: string }> = {
  notifications_pending:   { ar: "إشعارات معلّقة",        en: "Pending notifications" },
  notifications_failed:    { ar: "إشعارات فاشلة",         en: "Failed notifications" },
  operational_readiness:   { ar: "الجاهزية التشغيلية",    en: "Operational readiness" },
  resource_conflicts:      { ar: "تعارضات الطاقم والمعدّات", en: "Crew & equipment conflicts" },
  upcoming_jobs:           { ar: "مهامّ قادمة",            en: "Upcoming jobs" },
  new_leads:               { ar: "عملاء محتملون جدد",     en: "New leads" },
  pipeline_value:          { ar: "قيمة الأنبوب",           en: "Pipeline value" },
  weighted_forecast:       { ar: "التوقّع المرجّح",         en: "Weighted forecast" },
  stalled_opportunities:   { ar: "فرص متعثّرة",            en: "Stalled opportunities" },
  expenses:                { ar: "المصروفات",              en: "Expenses" },
  commitments:             { ar: "الالتزامات",             en: "Commitments" },
  overdue_collections:     { ar: "تحصيلات متأخّرة",        en: "Overdue collections" },
  estimated_profitability: { ar: "ربحية تقديرية",          en: "Estimated profitability" },
};

export const DEPARTMENT_LABEL: Record<string, { ar: string; en: string }> = {
  production:     { ar: "الإنتاج والتشغيل", en: "Production & Operations" },
  sales:          { ar: "المبيعات",          en: "Sales" },
  finance:        { ar: "المالية",           en: "Finance" },
  communications: { ar: "الاتّصالات",         en: "Communications" },
  reporting:      { ar: "التقارير",           en: "Reporting" },
};

export const SEVERITY_LABEL: Record<string, { ar: string; en: string }> = {
  high:   { ar: "عالٍ",     en: "High" },
  medium: { ar: "متوسّط",   en: "Medium" },
  low:    { ar: "منخفض",   en: "Low" },
};

export const DATE_SCOPE_LABEL: Record<string, { ar: string; en: string }> = {
  filtered:       { ar: "يحترم مرشّح التاريخ", en: "Honours the date filter" },
  current_state:  { ar: "الحالة الراهنة — لا يتأثّر بمرشّح التاريخ", en: "Current state — not affected by the date filter" },
  module_default: { ar: "نافذة الموديول المصدر — لا يتأثّر بمرشّح التاريخ", en: "Source module's own window — not affected by the date filter" },
};

export function kpiLabel(key: string, lang: Lang): string {
  return KPI_LABEL[key]?.[lang] ?? key;
}
export function departmentLabel(key: string, lang: Lang): string {
  return DEPARTMENT_LABEL[key]?.[lang] ?? key;
}

// ─── قراءة المؤشّرات — بلا تجميل وبلا استبدال ─────────────────────────────

/** القيمة كما جاءت. null تبقى null: لا يوجد "?? 0" في هذا الملفّ إطلاقًا. */
export function kpiValue(k: ExecKpi | null | undefined): number | null {
  const v = k?.value;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function findKpi(d: ExecDashboard | null | undefined, key: string): ExecKpi | null {
  return d?.kpis?.find((k) => k.key === key) ?? null;
}

/** true فقط حين يحمل المؤشّر رقمًا حقيقيًّا. */
export function kpiIsNumber(k: ExecKpi | null | undefined): boolean {
  return !!k && k.state === "ok" && kpiValue(k) !== null;
}

const NUM_AR = new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 2 });
const NUM_EN = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

export function execNumber(n: number, lang: Lang): string {
  return (lang === "ar" ? NUM_AR : NUM_EN).format(n);
}

export function execMoney(n: number, lang: Lang, currency = "SAR"): string {
  return `${execNumber(n, lang)} ${currency}`;
}

/**
 * النصّ المعروض للمؤشّر. حين لا يكون ok يُعاد **سبب** لا رقم — وهذه هي النقطة
 * التي يُمنَع عندها ظهور «٠» بمعنى «غير مطبَّق».
 */
export function kpiText(k: ExecKpi | null | undefined, lang: Lang, currency = "SAR"): string {
  if (!k) return lang === "ar" ? "غير معروف" : "Unknown";
  if (k.state !== "ok") return lang === "ar" ? "—" : "—";
  const v = kpiValue(k);
  if (v === null) return lang === "ar" ? "—" : "—";
  const lower = (k.detail as { is_lower_bound?: boolean })?.is_lower_bound === true;
  const prefix = lower ? "≥ " : "";
  if (k.unit === "money") return prefix + execMoney(v, lang, currency);
  if (k.unit === "percent") return `${prefix}${execNumber(v, lang)}%`;
  return prefix + execNumber(v, lang);
}

/** الرسالة التي تشرح لماذا لا يوجد رقم. تُعرَض بدل الرقم لا بجانبه. */
export function kpiWhyText(k: ExecKpi | null | undefined, lang: Lang): string | null {
  if (!k || k.state === "ok") return null;
  const m = lang === "ar" ? k.message_ar : k.message_en;
  if (m) return m;
  const AR: Record<string, string> = {
    unavailable: "الموديول المصدر غير مطبَّق — القيمة غير معروفة، وليست صفرًا.",
    restricted: "محجوب عنك — هذا منع مقصود، والقيمة ليست صفرًا.",
    no_basis: "لا أساس للحساب في هذه النافذة.",
    filtered_out: "خارج مرشّح الأقسام المختار.",
    error: "تعذّرت القراءة.",
  };
  const EN: Record<string, string> = {
    unavailable: "The source module is not installed — the value is unknown, not zero.",
    restricted: "Withheld from you — a deliberate denial; the value is not zero.",
    no_basis: "No basis for a calculation in this window.",
    filtered_out: "Outside the selected department filter.",
    error: "The read failed.",
  };
  return (lang === "ar" ? AR : EN)[k.state] ?? null;
}

// ─── الطزاجة — مصدر واحد، ولا رقم يُعرض بدونها ────────────────────────────

export function isStale(d: ExecDashboard | null | undefined): boolean {
  if (!d) return false;
  if (d.is_stale) return true;
  const age = typeof d.age_seconds === "number" ? d.age_seconds : null;
  const ttl = typeof d.ttl_seconds === "number" ? d.ttl_seconds : 300;
  return age !== null && age > ttl;
}

/** «حُسبت قبل ٤٥ ثانية» / «computed 45s ago» — أو تصريح صريح بغياب الطابع. */
export function freshnessLabel(d: ExecDashboard | null | undefined, lang: Lang): string {
  if (!d || !d.generated_at) {
    return lang === "ar"
      ? "بلا طابع زمنيّ — لا تُقرأ هذه الأرقام على أنّها حيّة."
      : "No timestamp — do not read these numbers as live.";
  }
  const age = typeof d.age_seconds === "number" ? d.age_seconds : 0;
  const unit =
    age < 60 ? { n: Math.max(0, Math.round(age)), ar: "ثانية", en: "s" }
    : age < 3600 ? { n: Math.round(age / 60), ar: "دقيقة", en: "min" }
    : { n: Math.round(age / 3600), ar: "ساعة", en: "h" };
  return lang === "ar"
    ? `حُسبت قبل ${execNumber(unit.n, "ar")} ${unit.ar}`
    : `computed ${unit.n}${unit.en} ago`;
}

/** الطابع الزمنيّ المطلق — يُعرض دائمًا بجوار النسبيّ حتى لا يُقرأ «الآن». */
export function stampLabel(d: ExecDashboard | null | undefined, lang: Lang): string {
  if (!d?.generated_at) return lang === "ar" ? "—" : "—";
  try {
    return new Date(d.generated_at).toLocaleString(lang === "ar" ? "ar-EG" : "en-GB");
  } catch {
    return d.generated_at;
  }
}

// ─── التصدير — CSV يفتحه Excel بالعربية دون تشويه ─────────────────────────

type Cell = string | number | null | undefined;
const esc = (v: Cell): string => {
  const s = v == null ? "" : String(v);
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * صفوف التصدير كما بناها الخادم. ★ لا تُملأ الخلايا الفارغة بصفر ★: المؤشّر
 * المحجوب يخرج بحالته ونصّ سببه، فلا يتحوّل في ملفّ Excel إلى «٠».
 */
export function execRowsToCsv(
  columns: string[], rows: Record<string, unknown>[], lang: Lang,
): string {
  const header = columns.map((c) => EXPORT_COL_LABEL[c]?.[lang] ?? c);
  const body = rows.map((r) =>
    columns.map((c) => {
      const v = r[c];
      if (v === null || v === undefined) return "";
      if (typeof v === "boolean") return v ? (lang === "ar" ? "نعم" : "yes") : (lang === "ar" ? "لا" : "no");
      return String(v);
    }),
  );
  return [header, ...body].map((r) => r.map(esc).join(",")).join("\r\n");
}

export const EXPORT_COL_LABEL: Record<string, { ar: string; en: string }> = {
  key:         { ar: "المفتاح",      en: "key" },
  department:  { ar: "القسم",        en: "department" },
  unit:        { ar: "الوحدة",       en: "unit" },
  sensitive:   { ar: "حسّاس",         en: "sensitive" },
  state:       { ar: "الحالة",        en: "state" },
  value:       { ar: "القيمة",        en: "value" },
  count:       { ar: "العدد",         en: "count" },
  date_scope:  { ar: "نطاق التاريخ",  en: "date scope" },
  reason:      { ar: "السبب",         en: "reason" },
  message_ar:  { ar: "الشرح",         en: "explanation (ar)" },
  severity:    { ar: "الشدّة",         en: "severity" },
  title_ar:    { ar: "العنوان",       en: "title (ar)" },
  detail_ar:   { ar: "التفصيل",       en: "detail (ar)" },
  title_en:    { ar: "العنوان (EN)",  en: "title" },
  detail_en:   { ar: "التفصيل (EN)",  en: "detail" },
};

/**
 * تنزيل CSV بترميز UTF-8 مع BOM كي يفتحه Excel بالعربية صحيحةً.
 * ★ ترويسة الطزاجة تُكتب داخل الملفّ ★: ملفّ يخرج من هنا بلا وقت حسابه يصبح
 * بعد أسبوع «رقمًا حاليًّا» في عرض تقديميّ. هذا ما يمنعه السطران الأوّلان.
 */
export function execCsvDownload(
  fileName: string, csvBody: string, meta: { generatedAt: string | null; isStale: boolean; filters?: ExecNormFilters }, lang: Lang,
): void {
  const head = lang === "ar"
    ? [
        `# تقرير كيان التنفيذيّ — وقت حساب الأرقام: ${meta.generatedAt ?? "غير معروف"}`,
        `# ${meta.isStale ? "⚠️ أرقام قديمة (stale) — لا تُقرأ على أنّها حيّة" : "أرقام طازجة وقت التصدير"}`,
        meta.filters ? `# المدى: ${meta.filters.from} ← ${meta.filters.to} · الأقسام: ${meta.filters.departments.join(" ")}` : "",
      ]
    : [
        `# Kian executive report — numbers computed at: ${meta.generatedAt ?? "unknown"}`,
        `# ${meta.isStale ? "WARNING: stale numbers — do not read as live" : "Fresh at export time"}`,
        meta.filters ? `# Range: ${meta.filters.from} to ${meta.filters.to} · Departments: ${meta.filters.departments.join(" ")}` : "",
      ];
  const body = [...head.filter(Boolean), "", csvBody].join("\r\n");
  const blob = new Blob(["﻿" + body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName.endsWith(".csv") ? fileName : `${fileName}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
