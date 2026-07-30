// ════════════════════════════════════════════════════════════════════════════
// tests/finance_helpers.js — مساعدات مشتركة لاختبارات المركز المالي.
// ليس ملفّ اختبار (لا ينتهي بـ.test.js) فلا يلتقطه node --test ولا تتكرّر
// اختبارات ملفّ آخر مرّتين.
// ════════════════════════════════════════════════════════════════════════════
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const SQL = read("docs/finance_profitability_RUNME.sql");
const PREFLIGHT = read("docs/finance_profitability_PREFLIGHT.sql");
const POSTCHECK = read("docs/finance_profitability_POSTCHECK.sql");
const ROLLBACK = read("docs/finance_profitability_ROLLBACK.sql");
const TS = read("lib/portal/financeOps.ts");

/** جسم دالّة plpgsql/sql مُعرَّفة بـ$$ … $$; */
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

/** قسم من RUNME بين عنوانَي §. يُستعمل لفحص RLS/المنح وحدهما. */
function section(marker, src = SQL) {
  const i = src.indexOf(marker);
  assert.ok(i > 0, `تعذّر إيجاد القسم ${marker}`);
  const j = src.indexOf("-- §", i + marker.length);
  return src.slice(i, j > 0 ? j : src.length);
}

/** الجداول الاثنان والعشرون. */
const TABLES = [
  "fin_cost_centers", "fin_expense_categories", "fin_suppliers", "fin_budgets",
  "fin_budget_lines", "fin_contracts", "fin_revenue", "fin_retainers", "fin_receivables",
  "fin_collections", "fin_payment_milestones", "fin_approval_thresholds",
  "fin_expense_requests", "fin_expense_approvals", "fin_purchase_requests",
  "fin_purchase_request_items", "fin_purchase_orders", "fin_purchase_order_items",
  "fin_costs", "fin_attachments", "fin_audit", "fin_zoho_outbox",
];

/** جداول تحمل شكل المال الموحّد (صافٍ + نسبة + ضريبة + إجمالي مولَّد). */
const MONEY_TABLES = [
  "fin_budget_lines", "fin_contracts", "fin_revenue", "fin_retainers", "fin_receivables",
  "fin_collections", "fin_payment_milestones", "fin_expense_requests",
  "fin_purchase_requests", "fin_purchase_orders", "fin_costs",
];

/**
 * ★ الجداول الحسّاسة ★ — للمالك وحده، بلا استثناء وبلا مفتاح.
 * كلّ جدول هنا يحمل طرفًا من معادلة (إيراد − تكلفة). منح أيّ دور جدولين منها
 * = عودة الثغرة المُثبَتة، ولذلك تُختبر القائمة كوحدة واحدة لا جدولًا جدولًا.
 */
const SENSITIVE_TABLES = [
  "fin_cost_centers", "fin_expense_categories", "fin_suppliers", "fin_budgets",
  "fin_budget_lines", "fin_contracts", "fin_revenue", "fin_retainers", "fin_receivables",
  "fin_collections", "fin_payment_milestones", "fin_approval_thresholds",
  "fin_purchase_orders", "fin_purchase_order_items", "fin_costs",
];
/** الاسم القديم يبقى مرادفًا كي لا يفقد اختبار قائم معناه. */
const FINANCE_ONLY_TABLES = SENSITIVE_TABLES;

/** جداول طرف الإيراد — صارت ضمن الحسّاس نفسه في V1. */
const PROFIT_TABLES = ["fin_contracts", "fin_revenue", "fin_retainers"];

/** ★ البوّابة الحسّاسة ومشتقّاتها — لا واحدة منها تُفتح بمفتاح. ★ */
const SENSITIVE_PREDICATES = [
  "finops_can_view_finance_sensitive", "finops_can_manage_finance",
  "finops_can_manage_suppliers", "finops_can_export_sensitive",
];
/** بوّابات قابلة للمنح بمفتاح — ولا تلمس أيّ جدول حسّاس. */
const GRANTABLE_PREDICATES = [
  "finops_can_view_collections", "finops_can_record_collection",
  "finops_can_approve_expense", "finops_can_export_collections",
];
const LEGACY_PREDICATES = [
  "finops_can_view", "finops_can_manage", "finops_can_approve",
  "finops_can_view_profit", "finops_can_manage_receivables", "finops_can_export",
];
const PREDICATES = [
  "finops_perm", "finops_is_finance_role", ...SENSITIVE_PREDICATES,
  ...GRANTABLE_PREDICATES, ...LEGACY_PREDICATES,
  "finops_can_request", "finops_is_client",
];
/** كلّ ما يجب أن يبقى محجوبًا عن دور التحصيل مهما تغيّر الكود. */
const COST_SIDE_TOKENS = [
  "fin_costs", "fin_budgets", "fin_budget_lines", "fin_contracts", "fin_revenue",
  "fin_retainers", "fin_suppliers", "fin_purchase_orders", "fin_purchase_order_items",
  "finops_profit_core", "finops_variance_core", "finops_contract_state",
];

/** دوالّ داخلية لا تُمنح لأحد (منحها يسرّب الهامش أو يتجاوز التدقيق). */
const INTERNAL_FNS = [
  "finops_log", "finops_project_label", "finops_next_code", "finops_money",
  "finops_threshold_for", "finops_receivable_state", "finops_contract_state",
  "finops_variance_core", "finops_profit_core",
];

const READ_FNS = [
  "finops_access", "finops_lookups", "finops_request_lookups", "finops_budgets_list",
  "finops_budget_variance", "finops_costs_list", "finops_suppliers_list",
  "finops_expense_requests_list", "finops_my_requests", "finops_purchase_list",
  "finops_receivables", "finops_collections_list", "finops_collections_summary",
  "finops_profitability", "finops_dashboard", "finops_audit_list",
  "finops_export", "finops_zoho_diagnostic",
];

const WRITE_FNS = [
  "finops_cost_center_upsert", "finops_category_upsert", "finops_supplier_upsert",
  "finops_threshold_upsert", "finops_budget_upsert", "finops_budget_line_upsert",
  "finops_contract_upsert", "finops_revenue_upsert", "finops_retainer_upsert",
  "finops_receivable_upsert", "finops_collection_record", "finops_milestone_upsert",
  "finops_cost_upsert", "finops_expense_request_submit", "finops_expense_decide",
  "finops_expense_mark_paid", "finops_expense_second_approve",
  "finops_purchase_request_submit", "finops_purchase_item_upsert", "finops_purchase_decide",
  "finops_po_upsert", "finops_po_item_upsert", "finops_po_set_status",
  "finops_attachment_add", "finops_row_delete", "finops_zoho_outbox_enqueue",
  "finops_zoho_outbox_replay",
];

/** كلّ ما تستدعيه الواجهة يجب أن يكون في هذه القائمة، والعكس. */
const PUBLIC_FNS = [...READ_FNS, ...WRITE_FNS];

/** الدوالّ التي تُغلق على غير المصرَّح قبل قراءة صفّ (عدا المِجَسّ عمدًا). */
const GATED_READ_FNS = READ_FNS.filter((f) => f !== "finops_access");

/** تعريف الجدول كما كُتب في RUNME. */
function tableDef(name, src = SQL) {
  const re = new RegExp(
    "create\\s+table\\s+if\\s+not\\s+exists\\s+public\\." + name + "\\s*\\(([\\s\\S]*?)\\n\\);", "i");
  const m = src.match(re);
  assert.ok(m, `تعذّر إيجاد تعريف الجدول ${name}`);
  return m[1];
}

module.exports = {
  ROOT, read, SQL, PREFLIGHT, POSTCHECK, ROLLBACK, TS,
  funcBody, funcDecl, section, tableDef,
  TABLES, MONEY_TABLES, FINANCE_ONLY_TABLES, SENSITIVE_TABLES, PROFIT_TABLES,
  PREDICATES, SENSITIVE_PREDICATES, GRANTABLE_PREDICATES, LEGACY_PREDICATES,
  COST_SIDE_TOKENS,
  INTERNAL_FNS, READ_FNS, WRITE_FNS, PUBLIC_FNS, GATED_READ_FNS,
};
