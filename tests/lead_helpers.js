// ════════════════════════════════════════════════════════════════════════════
// tests/lead_helpers.js — مساعدات مشتركة لاختبارات حزمة التقييم والتوزيع.
// ليس ملفّ اختبار (لا ينتهي بـ.test.js) فلا يلتقطه node --test.
//
// كلّ الفحوص هنا **ساكنة**: تقرأ ملفّات الحزمة من القرص وتتحقّق من عقودها.
// لا اتّصال بقاعدة بيانات، ولا بيانات إنتاج، ولا شبكة.
// ════════════════════════════════════════════════════════════════════════════
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const exists = (p) => fs.existsSync(path.join(ROOT, p));

const BASE = "docs/lead_scoring_routing_";
const SQL = read(`${BASE}RUNME.sql`);
const PREFLIGHT = read(`${BASE}PREFLIGHT.sql`);
const POSTCHECK = read(`${BASE}POSTCHECK.sql`);
const ROLLBACK = read(`${BASE}ROLLBACK.sql`);

const DOCS = {
  scoring: "docs/LEAD_SCORING_RULES.md",
  routing: "docs/LEAD_ROUTING_CONTRACT.md",
  contracts: "docs/COMMERCIAL_CROSS_MODULE_CONTRACTS.md",
  limits: "docs/COMMERCIAL_GROWTH_V1_LIMITATIONS.md",
};

/**
 * يجرّد المصدر من التعليقات ومن محتوى السلاسل النصّية.
 * ضروريّ لأنّ الحزمة تحمل **نصوص** استعلامات (query_to_xml، execute)، ولولا
 * التجريد لالتبس «ذكر اسم جدول داخل سلسلة» بـ«الإشارة إليه في جملة SQL».
 */
function stripCommentsAndStrings(src) {
  let out = "";
  let i = 0;
  let inLine = false;
  let inStr = false;
  let dollar = null;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (inLine) {
      if (c === "\n") { inLine = false; out += c; }
      i++; continue;
    }
    if (inStr) {
      if (c === "'") {
        if (n === "'") { i += 2; continue; }
        inStr = false;
      }
      i++; continue;
    }
    if (dollar) {
      if (src.startsWith(dollar, i)) { i += dollar.length; dollar = null; continue; }
      i++; continue;
    }
    if (c === "-" && n === "-") { inLine = true; i += 2; continue; }
    if (c === "'") { inStr = true; i++; continue; }
    const m = /^\$[a-zA-Z_]*\$/.exec(src.slice(i));
    // نُبقي أجسام الدوالّ ($$ … $$) لأنّها **كود** لا سلسلة؛ نتخطّى فقط
    // كتل DO ذات الوسوم المسمّاة حين يُطلب ذلك صراحةً.
    if (m && m[0] !== "$$") { dollar = m[0]; i += m[0].length; continue; }
    out += c;
    i++;
  }
  return out;
}

/** يجرّد التعليقات وحدها — يُبقي السلاسل. */
function stripComments(src) {
  return src.replace(/--[^\n]*/g, "");
}

/**
 * يحذف **سلسلة النمط** التي تلي عامل مطابقة (`~` `~*` `!~` `!~*`).
 *
 * ★ لماذا ★ سقطت هذه الترحيلة على الإنتاج لأنّ فحصًا بحث عن الكلمة `zoho`
 * داخل تعريف دالّة، فطابق الجملة التي تقول «ولا تنادي Zoho». والعيب نفسه
 * يتكرّر في اختبارات Node: حارسٌ يمنع `pg_net` يجب أن يذكر `pg_net` في نمطه،
 * فيدين نفسه. التمييز الصحيح ليس «أيّ سطر فيه اقتباس» بل «الرمز واقع داخل
 * مُعامل نمط لعامل مطابقة» — وذلك ذكرٌ يحمي، لا استعمال يخرق.
 */
function stripRegexOperands(src) {
  return src.replace(/([!]?~\*?)\s*\(?\s*'(?:[^'\n]|'')*'/g, "$1 ''");
}

/**
 * نصّ تعريف دالّة كاملًا: من create … إلى الوسم المقابل.
 * الوسم ليس `$$` دائمًا — بعض الدوالّ تحمل `$` في جسمها فتُقتبس بوسم مسمّى
 * (`$lsrpart$`). المرجع الخلفيّ \1 يضمن أنّ الإغلاق هو وسم الفتح نفسه.
 */
function funcSrc(name, src = SQL) {
  const re = new RegExp(
    "create\\s+or\\s+replace\\s+function\\s+public\\." + name +
      "\\s*\\([^)]*\\)[\\s\\S]*?(\\$[a-zA-Z_]*\\$)[\\s\\S]*?\\1\\s*;",
    "i",
  );
  const m = src.match(re);
  assert.ok(m, `تعذّر إيجاد تعريف الدالّة ${name}`);
  return m[0];
}

/** جسم الدالّة وحده (ما بين وسمَي الاقتباس). */
function funcBody(name, src = SQL) {
  const whole = funcSrc(name, src);
  const tag = whole.match(/(\$[a-zA-Z_]*\$)/)[1];
  const i = whole.indexOf(tag);
  const j = whole.lastIndexOf(tag);
  assert.ok(i > 0 && j > i, `جسم الدالّة ${name} غير مقروء`);
  return whole.slice(i + tag.length, j);
}

/** توقيع الدالّة (ما بين القوسين). */
function funcArgs(name, src = SQL) {
  const re = new RegExp(
    "create\\s+or\\s+replace\\s+function\\s+public\\." + name + "\\s*\\(([^)]*)\\)",
    "i",
  );
  const m = src.match(re);
  assert.ok(m, `تعذّر إيجاد توقيع الدالّة ${name}`);
  return m[1];
}

/** كتلة الفحص الذاتيّ في نهاية RUNME. */
function selfTest() {
  const i = SQL.indexOf("do $selftest$");
  assert.ok(i > 0, "كتلة الفحص الذاتيّ غائبة عن RUNME");
  const j = SQL.indexOf("$selftest$;", i);
  assert.ok(j > i, "كتلة الفحص الذاتيّ غير مغلقة");
  return SQL.slice(i, j);
}

/** تعريف جدول (من create table … إلى ); المقابل). */
function tableSrc(name, src = SQL) {
  const re = new RegExp(
    "create\\s+table\\s+if\\s+not\\s+exists\\s+public\\." + name + "\\s*\\(([\\s\\S]*?)\\n\\);",
    "i",
  );
  const m = src.match(re);
  assert.ok(m, `تعذّر إيجاد تعريف الجدول ${name}`);
  return m[1];
}

// ─── ثوابت العقد ────────────────────────────────────────────────────────────

const TABLES = [
  "lsr_settings", "lsr_factors", "lsr_rulesets", "lsr_rules", "lsr_lead_profile",
  "lsr_territories", "lsr_score_manual", "lsr_agents", "lsr_routing_rules",
  "lsr_assignments", "lsr_review_queue", "lsr_audit", "lsr_event_log",
];

const PREDICATES = [
  "lsr_perm", "lsr_is_owner_role", "lsr_is_sales_manager", "lsr_can_view",
  "lsr_can_manage_scoring", "lsr_can_override_score", "lsr_can_route",
  "lsr_can_reassign", "lsr_can_view_owner_dashboard", "lsr_can_view_ops_queue",
  "lsr_is_client",
];

const API_FNS = [
  "lsr_access", "lsr_score", "lsr_score_scan", "lsr_score_manual_set",
  "lsr_profile_set", "lsr_rule_upsert", "lsr_ruleset_clone", "lsr_ruleset_publish",
  "lsr_route_preview", "lsr_assign", "lsr_review_list", "lsr_review_dismiss",
  "lsr_agent_set", "lsr_routing_rule_upsert", "lsr_events_list",
  "lsr_finance_reference", "lsr_dashboard_owner", "lsr_dashboard_sales",
  "lsr_dashboard_client", "lsr_dashboard_operations",
];

const INTERNAL_FNS = [
  "lsr_score_core", "lsr_route_core", "lsr_context", "lsr_rule_matches",
  "lsr_event_emit", "lsr_log", "lsr_agent_workload",
];

/** العوامل الثمانية عشر التي يطلبها العقد بالاسم. */
const FACTORS = [
  "budget_range", "organization_type", "company_size", "service_type",
  "locations_count", "cities_count", "urgency", "desired_delivery_days",
  "data_completeness", "lead_source", "existing_client", "retainer_potential",
  "annual_value_potential", "production_complexity", "territory",
  "strategic_sector", "previous_lost_reason", "response_behaviour",
];

/** أحداث الإشعارات الثلاثة عشر. */
const EVENTS = [
  "subscription_activated", "subscription_expiring", "credits_expiring", "credits_low",
  "production_request_submitted", "production_request_approved", "production_request_rejected",
  "overage_approval_required", "quote_ready_for_review", "quote_owner_approval_required",
  "quote_accepted", "lead_assigned", "lead_followup_due",
];

/**
 * ⛔ الرموز الممنوعة كمدخلات تقييم.
 * ملاحظة على الصياغة: نستعمل حدود كلمة دقيقة كي لا تلتقط «message» ولا
 * «manage» ولا «usage» — فحص يفشل بالخطأ يُعطَّل بعد أسبوع، ثمّ لا يحمي شيئًا.
 */
const FORBIDDEN = [
  /\bgender\b/i,
  /\bnationality\b/i,
  /\bnational_origin\b/i,
  /\bethnic(ity)?\b/i,
  /\brace\b/i,
  /\breligion\b/i,
  /\bmarital(_status)?\b/i,
  /\bdate_of_birth\b/i,
  /\bbirth_date\b/i,
  /\bage_group\b/i,
  /\bage_band\b/i,
  /\bapplicant_age\b/i,
];

/** بوّابات ممنوعة في الموديولات التجارية. */
const FORBIDDEN_GATES = [/can_manage_projects/i, /is_kian_member/i];

module.exports = {
  ROOT, read, exists, SQL, PREFLIGHT, POSTCHECK, ROLLBACK, DOCS,
  stripCommentsAndStrings, stripComments, stripRegexOperands,
  funcSrc, funcBody, funcArgs, selfTest, tableSrc,
  TABLES, PREDICATES, API_FNS, INTERNAL_FNS, FACTORS, EVENTS,
  FORBIDDEN, FORBIDDEN_GATES,
};
