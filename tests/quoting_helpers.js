// ════════════════════════════════════════════════════════════════════════════
// tests/quoting_helpers.js — مساعدات مشتركة لاختبارات المرحلة ٤+٥.
// ليس ملفّ اختبار (لا ينتهي بـ.test.js) فلا يلتقطه node --test.
// ════════════════════════════════════════════════════════════════════════════
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const exists = (p) => fs.existsSync(path.join(ROOT, p));

const SQL = read("docs/smart_quoting_RUNME.sql");
const PREFLIGHT = read("docs/smart_quoting_PREFLIGHT.sql");
const POSTCHECK = read("docs/smart_quoting_POSTCHECK.sql");
const ROLLBACK = read("docs/smart_quoting_ROLLBACK.sql");
const TS = read("lib/portal/quoting.ts");

/** تعريف الدالّة كاملًا (الرأس + الجسم) كما يراه pg_get_functiondef تقريبًا. */
function funcDef(name, src = SQL) {
  const m = src.match(new RegExp(
    "create\\s+or\\s+replace\\s+function\\s+public\\." + name +
      "\\s*\\([\\s\\S]*?\\bas\\s*\\$\\$([\\s\\S]*?)\\$\\$\\s*;", "i"));
  assert.ok(m, `تعذّر إيجاد الدالّة ${name}`);
  return m[0];
}

/** الجسم وحده. */
function funcBody(name, src = SQL) {
  const m = src.match(new RegExp(
    "create\\s+or\\s+replace\\s+function\\s+public\\." + name +
      "\\s*\\([\\s\\S]*?\\bas\\s*\\$\\$([\\s\\S]*?)\\$\\$\\s*;", "i"));
  assert.ok(m, `تعذّر إيجاد جسم الدالّة ${name}`);
  return m[1];
}

function hasFunc(name, src = SQL) {
  return new RegExp("create\\s+or\\s+replace\\s+function\\s+public\\." + name + "\\s*\\(", "i").test(src);
}

/** تعريف جدول بين create table … و«\n);». */
function tableDef(name, src = SQL) {
  const m = src.match(new RegExp(
    "create table if not exists public\\." + name + "\\s*\\(([\\s\\S]*?)\\n\\);", "i"));
  assert.ok(m, `تعذّر إيجاد تعريف الجدول ${name}`);
  return m[1];
}

/**
 * ★ يزيل تعليقات SQL ★
 *
 * لماذا يلزم: بعض الفحوص تسأل «هل يُشير الكود إلى X؟»، ورأس الملفّ يشرح
 * عمدًا أنّه **لا** يُشير إلى X («لا can_manage_projects كبوّابة هنا»). فحصٌ
 * يقرأ النصّ الخام يفشل على الشرح نفسه، ثمّ يُضعَّف الفحص ليمرّ — وهكذا يموت
 * اختبار حقيقيّ بسبب تعليق صادق.
 *
 * ⚠️ يُستعمل لفحوص «الكود» فقط. فحوص تعريف الدالّة تبقى على النصّ الخام:
 * التعليق داخل جسم الدالّة جزءٌ من pg_get_functiondef، أي جزءٌ ممّا يُنشر
 * فعلًا — ولذلك أبقينا الشروح الحسّاسة **خارج** الأجسام.
 *
 * يتتبّع حالة السلسلة النصّية بعلامة الاقتباس المفردة، فلا يقصّ «--» داخل نصّ.
 */
function stripSqlComments(src) {
  let out = "";
  let inStr = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      out += c;
      if (c === "'") inStr = false;
      continue;
    }
    if (c === "'") { inStr = true; out += c; continue; }
    if (c === "-" && src[i + 1] === "-") {
      const nl = src.indexOf("\n", i);
      if (nl === -1) break;
      i = nl - 1;
      out += "\n";
      continue;
    }
    out += c;
  }
  return out;
}

/** قسم من RUNME بين عنوانَي §. */
function section(marker, src = SQL) {
  const i = src.indexOf(marker);
  assert.ok(i > 0, `تعذّر إيجاد القسم ${marker}`);
  const j = src.indexOf("-- §", i + marker.length);
  return src.slice(i, j > 0 ? j : src.length);
}

/** كتلة SELF-TEST. */
function selfTest(src = SQL) {
  const m = src.match(/do \$st\$[\s\S]*?end \$st\$;/);
  assert.ok(m, "لا يوجد SELF-TEST في الترحيلة");
  return m[0];
}

/** كلّ أسماء دوالّ sq_* المعرَّفة. */
function allFuncNames(src = SQL) {
  return [...src.matchAll(/create or replace function public\.(sq_\w+)/g)].map((m) => m[1]);
}

/** مصفوفة نصّية من كتلة plpgsql، مثل v_api := array[ 'a','b' ]. */
function sqlArray(varName, src = SQL) {
  const m = src.match(new RegExp(varName + "\\s+text\\[\\]\\s*:=\\s*array\\[([\\s\\S]*?)\\];", "i"));
  assert.ok(m, `تعذّر إيجاد المصفوفة ${varName}`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

// ─────────────────────────────────────────────────────────────────────────────
// ★ القوائم التي تقوم عليها المرحلة ★
// ─────────────────────────────────────────────────────────────────────────────

/** الجداول الأربعة عشر. */
const TABLES = [
  "sq_settings", "sq_service_catalog", "sq_price_books", "sq_price_book_versions",
  "sq_price_book_entries", "sq_cost_rates", "sq_pricing_rules", "sq_quotes",
  "sq_quote_internal", "sq_quote_inputs", "sq_quote_lines", "sq_quote_milestones",
  "sq_approval_requests", "sq_audit",
];

/**
 * ★ جداول التكلفة ★ كلّ واحد منها يحمل طرفًا يكشف الربحية. للمالك وحده،
 * بلا مفتاح وبلا استثناء. منح أيّ دور جدولين منها = عودة الثغرة المالية.
 */
const COST_TABLES = [
  "sq_settings", "sq_cost_rates", "sq_pricing_rules", "sq_quote_internal",
  "sq_approval_requests", "sq_audit",
];

/** جداول سطح البيع — لا عمود تكلفة في أيّ منها. */
const SELL_TABLES = [
  "sq_service_catalog", "sq_price_books", "sq_price_book_versions",
  "sq_price_book_entries", "sq_quotes", "sq_quote_inputs",
  "sq_quote_lines", "sq_quote_milestones",
];

/**
 * ★ رموز التكلفة ★ ظهور أيّ منها في دالّة سطح بيع = تسريب مُثبَت.
 * القائمة دقيقة عمدًا: «cost» وحدها كانت ستطابق sq_can_view_cost فتجعل
 * الاختبار يفشل دائمًا، والاختبار الذي يفشل دائمًا يُعطَّل ثمّ يُنسى.
 */
const COST_TOKENS = [
  "sq_quote_internal", "sq_cost_rates", "sq_pricing_rules", "min_price", "cost_rate",
  "supplier_rate", "crew_rate", "internal_cost_estimate", "base_cost", "surcharge_cost",
  "contingency", "overhead", "gross_profit", "margin_pct", "est_net_profit", "below_floor",
  "floor_at_request", "internal_reason_code", "external_supplier_cost", "cost_breakdown",
  "formula_snapshot", "recommended_price", "target_margin", "min_margin",
];

/** دوالّ سطح البيع — لا رمز تكلفة في أيّ منها. */
const SALES_FNS = [
  "sq_quotes_list", "sq_quote_detail", "sq_quote_lines_list", "sq_quote_milestones_list",
  "sq_quote_inputs_get", "sq_quote_inputs_set", "sq_my_approvals", "sq_approval_withdraw",
  "sq_quote_activity", "sq_dashboard", "sq_export_quote", "sq_ui_settings",
  "sq_my_discount_allowance", "sq_my_discount_allowance_info",
  "sq_quote_price_set", "sq_quote_submit", "sq_quote_create", "sq_quote_terms_set",
  "sq_quote_line_set", "sq_quote_line_delete", "sq_quote_milestones_set",
  "sq_quote_new_version", "sq_quote_record_client_decision", "sq_expiry_scan",
  "sq_quote_mark_ready_for_manual_send", "sq_quote_status_label", "sq_quote_visible",
  "sq_catalog_list", "sq_catalog_item_upsert", "sq_catalog_item_set_active",
  "sq_price_books_list", "sq_price_book_upsert", "sq_price_book_versions_list",
  "sq_price_book_version_open", "sq_price_book_entry_set", "sq_price_book_entries_list",
  "sq_price_book_version_publish", "sq_tiers",
  "sq_public_range", "sq_publish_range", "sq_unpublish_range",
];

/** دوالّ سطح المالك — كلّ واحدة تبدأ ببوّابة التكلفة أو الاعتماد. */
const OWNER_FNS = [
  "sq_pricing_rule_upsert", "sq_pricing_rule_set_active", "sq_pricing_rules_list",
  "sq_cost_rate_set", "sq_cost_rates_list", "sq_quote_supplier_cost_set",
  "sq_quote_recompute", "sq_quote_internal_detail", "sq_quotes_list_internal",
  "sq_approvals_list_internal", "sq_approval_decide", "sq_audit_list",
  "sq_owner_dashboard", "sq_settings_set",
];

/** المساعدات الداخلية — ممنوعة على الواجهة. */
const INTERNAL_FNS = [
  "sq_setting_num", "sq_setting_json", "sq_perm", "sq_perm_key_exists", "sq_log",
  "sq_notify", "sq_can_view_cost", "sq_can_approve", "sq_quote_visible",
  "sq_my_discount_allowance", "sq_next_quote_code", "sq_next_price_book_code",
];

/** الحالات التسع. */
const STATES = [
  "draft", "internal_review", "pending_owner_approval", "approved",
  "sent_placeholder", "accepted", "rejected", "expired", "superseded",
];

/** الفئات الأربع. */
const TIERS = ["basic", "professional", "cinematic", "enterprise_custom"];

/** مدخلات النطاق المطلوبة نصًّا في المتطلّب. */
const REQUIRED_INPUTS = [
  "shooting_days", "shooting_hours", "locations_count", "cities", "travel_required",
  "accommodation_nights", "crew_size", "cameras_count", "lighting_setup", "audio_setup",
  "drone", "fpv_drone", "live_streaming", "editing_hours", "motion_graphics_secs",
  "voice_over", "scriptwriting", "storyboard", "versions_count", "formats",
  "delivery_speed", "weekend_work", "night_work", "permits_required",
  "equipment_rental_required", "external_supplier_required",
];

module.exports = {
  ROOT, read, exists,
  SQL, PREFLIGHT, POSTCHECK, ROLLBACK, TS,
  funcDef, funcBody, hasFunc, tableDef, section, selfTest, allFuncNames, sqlArray,
  stripSqlComments, SQL_CODE: stripSqlComments(SQL),
  TABLES, COST_TABLES, SELL_TABLES, COST_TOKENS,
  SALES_FNS, OWNER_FNS, INTERNAL_FNS, STATES, TIERS, REQUIRED_INPUTS,
};
