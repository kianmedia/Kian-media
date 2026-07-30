// ════════════════════════════════════════════════════════════════════════════
// tests/commercial_subscriptions_helpers.js
// مساعدات مشتركة لاختبارات المرحلة ١+٢: خطط الاشتراك ودفتر أرصدة الإنتاج.
// ليس ملفّ اختبار (لا ينتهي بـ.test.js) فلا يلتقطه node --test.
// ════════════════════════════════════════════════════════════════════════════
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const exists = (p) => fs.existsSync(path.join(ROOT, p));

const SQL = read("docs/commercial_subscriptions_RUNME.sql");
const PREFLIGHT = read("docs/commercial_subscriptions_PREFLIGHT.sql");
const POSTCHECK = read("docs/commercial_subscriptions_POSTCHECK.sql");
const ROLLBACK = read("docs/commercial_subscriptions_ROLLBACK.sql");

/** جسم دالّة معرَّفة بـ$$ … $$; */
function funcBody(name, src = SQL) {
  const m = src.match(new RegExp(
    "create\\s+or\\s+replace\\s+function\\s+public\\." + name +
      "\\s*\\([^)]*\\)[\\s\\S]*?\\bas\\s*\\$\\$([\\s\\S]*?)\\$\\$\\s*;", "i"));
  assert.ok(m, `تعذّر إيجاد جسم الدالّة ${name}`);
  return m[1];
}

/** رأس التصريح حتى $$ — لقراءة volatility / security definer / search_path. */
function funcDecl(name, src = SQL) {
  const m = src.match(new RegExp(
    "create\\s+or\\s+replace\\s+function\\s+public\\." + name +
      "\\s*\\([^)]*\\)[\\s\\S]*?\\bas\\s*\\$\\$", "i"));
  assert.ok(m, `تعذّر إيجاد تصريح الدالّة ${name}`);
  return m[0];
}

/** تعريف جدول بين create table … و«\n);». */
function tableDef(name, src = SQL) {
  const m = src.match(new RegExp(
    "create table if not exists public\\." + name + "\\s*\\(([\\s\\S]*?)\\n\\);", "i"));
  assert.ok(m, `تعذّر إيجاد تعريف الجدول ${name}`);
  return m[1];
}

/** كتلة الـSELF-TEST كاملة. */
function selfTest(src = SQL) {
  const m = src.match(/do \$st\$[\s\S]*?end \$st\$;/);
  assert.ok(m, "لا يوجد SELF-TEST في الترحيلة");
  return m[0];
}

const TABLES = [
  "csub_settings", "csub_unit_types", "csub_plans", "csub_plan_units", "csub_plan_versions",
  "csub_subscriptions", "csub_subscription_units", "csub_periods", "csub_approval_requests",
  "csub_ledger", "csub_audit",
];

/** الأنواع الثلاثة عشر المطلوبة نصًّا في المتطلّب. */
const UNIT_TYPES = [
  "filming_day", "filming_hour", "photography_session", "edited_reel", "editing_hour",
  "motion_graphics_hour", "drone_session", "drone_hour", "event_coverage",
  "podcast_episode", "design_item", "live_stream_day", "custom_unit",
];

/** حالات دورة حياة الاشتراك السبع. */
const SUB_STATES = [
  "draft", "pending_approval", "active", "suspended", "expired", "cancelled", "completed",
];

/** أنواع قيود الدفتر السبعة. */
const ENTRY_TYPES = [
  "allocation", "reservation", "consumption", "release", "reversal", "expiry", "adjustment",
];

/** المُسنَدات — كلّها boolean صريح، ولا واحد منها يعيد NULL. */
const PREDICATES = [
  "csub_perm", "csub_perm_key_exists", "csub_is_owner_role", "csub_can_approve",
  "csub_can_manage", "csub_can_view", "csub_can_consume", "csub_can_adjust",
  "csub_can_view_pricing", "csub_can_export", "csub_is_client", "csub_client_owns",
];

/** كلّ دالّة تكتب في الدفتر: قفل صفّ + مفتاح تكرار + تدقيق. */
const LEDGER_WRITERS = [
  "csub_reserve", "csub_release", "csub_consume", "csub_reverse", "csub_adjust",
];

/** كلّ دالّة كتابة عامّة: بوّابة جلسة + منع صريح + تدقيق. */
const WRITE_FNS = [
  "csub_plan_upsert", "csub_plan_unit_set", "csub_plan_publish_version", "csub_plan_set_active",
  "csub_subscription_upsert", "csub_subscription_submit", "csub_subscription_activate",
  "csub_subscription_set_status", "csub_subscription_renew", "csub_period_close",
  "csub_expiry_scan", "csub_reserve", "csub_release", "csub_consume", "csub_reverse",
  "csub_adjust", "csub_approval_decide", "csub_approval_withdraw",
];

const READ_FNS = [
  "csub_access", "csub_unit_catalog", "csub_plans_list", "csub_plan_detail",
  "csub_subscriptions_list", "csub_subscription_detail", "csub_balances", "csub_statement",
  "csub_approvals_list", "csub_audit_list", "csub_dashboard",
  "csub_my_subscriptions", "csub_my_balances", "csub_my_statement",
];

/** الدوالّ الداخلية — لا تُمنح لـauthenticated ولا لـanon. */
const INTERNAL_FNS = [
  "csub_log", "csub_notify", "csub_touch", "csub_txt", "csub_uuid", "csub_num",
  "csub_next_code", "csub_vat", "csub_cycle_months", "csub_ledger_immutable",
  "csub_ledger_post", "csub_balance_core", "csub_available_core", "csub_idem_lookup",
  "csub_fingerprint", "csub_approval_submit_core", "csub_activate_core", "csub_renew_core",
];

/** واجهة العميل — الدوالّ الثلاث التي يراها العميل وحده. */
const CLIENT_FNS = ["csub_my_subscriptions", "csub_my_balances", "csub_my_statement"];

/** أسماء منصّة المشاريع المجمَّدة التي لا يجوز أن تُكتب من هنا. */
const FROZEN_TABLES = [
  "projects", "project_core", "deliverables", "deliverable_internal",
  "project_transition_requests",
];

/** بوّابات خشنة ممنوعة في الموديولات التجارية. */
const FORBIDDEN_GATES = ["can_manage_projects", "is_kian_member"];

module.exports = {
  ROOT, read, exists, SQL, PREFLIGHT, POSTCHECK, ROLLBACK,
  funcBody, funcDecl, tableDef, selfTest,
  TABLES, UNIT_TYPES, SUB_STATES, ENTRY_TYPES, PREDICATES, LEDGER_WRITERS,
  WRITE_FNS, READ_FNS, INTERNAL_FNS, CLIENT_FNS, FROZEN_TABLES, FORBIDDEN_GATES,
};
