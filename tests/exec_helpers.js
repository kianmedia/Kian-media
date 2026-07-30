// ════════════════════════════════════════════════════════════════════════════
// tests/exec_helpers.js — مساعدات مشتركة لاختبارات اللوحة التنفيذية.
// ليس ملفّ اختبار (لا ينتهي بـ.test.js) فلا يلتقطه node --test.
// ════════════════════════════════════════════════════════════════════════════
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const SQL = read("docs/executive_reporting_RUNME.sql");
const PREFLIGHT = read("docs/executive_reporting_PREFLIGHT.sql");
const POSTCHECK = read("docs/executive_reporting_POSTCHECK.sql");
const ROLLBACK = read("docs/executive_reporting_ROLLBACK.sql");
const TS = read("lib/portal/execReport.ts");
const ATOMS = read("components/portal/exec/ExecAtoms.tsx");
const DASH = read("components/portal/exec/ExecDashboard.tsx");
const NAV = read("components/portal/nav.ts");
const CONTRACT = read("docs/EXECUTIVE_REPORTING_CONTRACT.md");
const ACCEPTANCE = read("docs/EXECUTIVE_REPORTING_ACCEPTANCE.md");

/** جسم دالّة معرَّفة بـ$$ … $$; */
function funcBody(name, src = SQL) {
  const re = new RegExp(
    "create\\s+or\\s+replace\\s+function\\s+public\\." + name +
      "\\s*\\([^)]*\\)[\\s\\S]*?\\bas\\s*\\$\\$([\\s\\S]*?)\\$\\$\\s*;",
    "i",
  );
  const m = src.match(re);
  assert.ok(m, `تعذّر إيجاد جسم الدالّة ${name}`);
  return m[1];
}

/** رأس التصريح (حتى $$) — لقراءة volatility/security definer/search_path. */
function funcDecl(name, src = SQL) {
  const m = src.match(new RegExp(
    "create\\s+or\\s+replace\\s+function\\s+public\\." + name + "\\s*\\([^)]*\\)[\\s\\S]*?\\bas\\s*\\$\\$", "i"));
  assert.ok(m, `تعذّر إيجاد تصريح الدالّة ${name}`);
  return m[0];
}

/**
 * إزالة التعليقات قبل فحص «هل يفعل الكود كذا؟».
 * ⚠️ ضرورة لا تجميل: تعليق يقول «لا يوجد ?? 0 في هذا الملفّ» كان يُفشِل الفحص
 *    الباحث عن `?? 0` — أي أنّ توثيق القاعدة كان يكسر حارسها. الفحص يجب أن
 *    يرى الكود وحده.
 */
function stripJsComments(src) {
  return String(src)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/(\s)\/\/[^\n"'`]*$/gm, "$1");
}

/** إزالة تعليقات SQL (سطر `--`) قبل فحص «هل يفعل الكود كذا؟». */
function stripSqlComments(src) {
  return String(src).replace(/^\s*--.*$/gm, "").replace(/\s--[^\n]*$/gm, "");
}

/** الحزمة بلا كتلة SELF-TEST — للحراس الذين يبحثون عن نمط يذكره الحارس نفسه. */
function sqlWithoutSelfTest(src = SQL) {
  const i = src.indexOf("do $st$");
  return i > 0 ? src.slice(0, i) : src;
}

/** قسم من RUNME بين عنوانَي §. */
function section(marker, src = SQL) {
  const i = src.indexOf(marker);
  assert.ok(i > 0, `تعذّر إيجاد القسم ${marker}`);
  const j = src.indexOf("-- §", i + marker.length);
  return src.slice(i, j > 0 ? j : src.length);
}

/** كتلة الـSELF-TEST وحدها. */
function selfTest(src = SQL) {
  const i = src.indexOf("do $st$");
  assert.ok(i > 0, "لا توجد كتلة SELF-TEST");
  return src.slice(i, src.indexOf("commit;", i));
}

const TABLES = ["mgmt_report_cache", "mgmt_audit"];

const PREDICATES = [
  "mgmt_can_view", "mgmt_can_view_sensitive", "mgmt_can_export",
  "mgmt_is_client", "mgmt_perm",
];

/** الدوالّ التي لا تُمنَح لأحد إطلاقًا. */
const INTERNAL_FNS = [
  "mgmt_log", "mgmt_departments", "mgmt_env", "mgmt_kpi", "mgmt_classify",
  "mgmt_source_installed", "mgmt_read_jsonb", "mgmt_read_calendar",
  "mgmt_norm_filters", "mgmt_cache_key", "mgmt_compute", "mgmt_alerts_from",
];

/** الواجهة العامّة المُبوَّبة. */
const GATED_FNS = ["mgmt_sources", "mgmt_dashboard", "mgmt_refresh", "mgmt_export"];

/** المؤشّرات الثلاثة عشر. */
const KPI_KEYS = [
  "notifications_pending", "notifications_failed", "operational_readiness",
  "resource_conflicts", "upcoming_jobs", "new_leads", "pipeline_value",
  "weighted_forecast", "stalled_opportunities", "expenses", "commitments",
  "overdue_collections", "estimated_profitability",
];

/** المؤشّرات الحسّاسة — المالك وحده، ولا مفتاح لها. */
const SENSITIVE_KEYS = [
  "pipeline_value", "weighted_forecast", "expenses", "commitments",
  "overdue_collections", "estimated_profitability",
];

/** الموديولات المصدر ودوالّها وملفّات تشغيلها. */
const SOURCES = [
  { module: "communications", sig: "public.comms_health()", runme: "docs/communications_hub_RUNME.sql" },
  { module: "production", sig: "public.prodops_dashboard(jsonb)", runme: "docs/operations_center_RUNME.sql" },
  { module: "sales", sig: "public.crm_dashboard(jsonb)", runme: "docs/crm_sales_FOUNDATION_RUNME.sql" },
  { module: "finance", sig: "public.finops_dashboard(jsonb)", runme: "docs/finance_profitability_RUNME.sql" },
];

/** أسماء منصّة المشاريع المجمَّدة — لا يجوز أن تظهر في أيّ ملفّ من هذه الحزمة. */
const FROZEN_PATTERNS = [
  /\bpublic\.projects\b/i,
  /\bpublic\.project_core\b/i,
  /\bpublic\.deliverables\b/i,
  /\bpublic\.deliverable_internal\b/i,
  /\bpublic\.(project|large_project)_[a-z_]+\s*\(/i,
];

module.exports = {
  ROOT, read,
  SQL, PREFLIGHT, POSTCHECK, ROLLBACK, TS, ATOMS, DASH, NAV, CONTRACT, ACCEPTANCE,
  funcBody, funcDecl, section, selfTest, stripJsComments, stripSqlComments, sqlWithoutSelfTest,
  TABLES, PREDICATES, INTERNAL_FNS, GATED_FNS, KPI_KEYS, SENSITIVE_KEYS, SOURCES,
  FROZEN_PATTERNS,
};
