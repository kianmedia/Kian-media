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

/**
 * كلّ سلسلة حرفية على حدة — منقول عن public.lsr_sql_literals بالخوارزمية.
 * الاستعلام الديناميكيّ متعدّد الأسطر يجب أن يُقاس **كوحدة**: لو قُطّع أسطرًا
 * لبدا سطرٌ فيه بلا حصر بالعميل بينما الحصر في سطر آخر من الاستعلام نفسه.
 */
function sqlLiterals(src) {
  const out = [];
  const n = src.length;
  let i = 0;
  while (i < n) {
    const c = src[i];
    if (c === "-" && src[i + 1] === "-") {
      const p = src.indexOf("\n", i);
      i = p < 0 ? n : p + 1;
    } else if (c === "/" && src[i + 1] === "*") {
      let d = 1; i += 2;
      while (i < n && d > 0) {
        if (src.startsWith("/*", i)) { d++; i += 2; }
        else if (src.startsWith("*/", i)) { d--; i += 2; }
        else i++;
      }
    } else if (c === "'") {
      const s = ++i;
      while (i < n) {
        if (src[i] === "'") { if (src[i + 1] === "'") i += 2; else break; }
        else i++;
      }
      out.push(src.slice(s, i).replace(/''/g, "'"));
      i++;
    } else i++;
  }
  return out;
}

/**
 * مفاتيح jsonb_build_object المُصدَّرة فعلًا — منقول عن public.lsr_json_keys.
 * الوسائط الزوجية مفاتيح والفردية قيم؛ والكائن المتداخل يُلتقط في مرور لاحق
 * لأنّ المؤشّر يتقدّم وسمًا لا كائنًا — فلا يفلت مفتاحٌ مدسوس في العمق.
 * مفتاحٌ غير حرفيّ يعود «<computed>»: ما لا يُدقَّق ساكنًا يُردّ بالتصميم.
 */
/** مجموعة تشذيب lsr_key_of: ' ' || chr(9) || chr(10) || chr(13). */
const PG_KEY_TRIM = " \t\n\r";

/** btrim(string, characters) بدلالات PostgreSQL: يحذف محارف المجموعة وحدها. */
function pgBtrim(s, chars) {
  const str = s == null ? "" : String(s);
  let a = 0;
  let b = str.length;
  while (a < b && chars.includes(str[a])) a += 1;
  while (b > a && chars.includes(str[b - 1])) b -= 1;
  return str.slice(a, b);
}

function jsonKeys(src) {
  const TOK = "jsonb_build_object";
  const out = [];
  const n = src.length;
  let i = 0;
  while (i < n) {
    const c0 = src[i];
    if (c0 === "-" && src[i + 1] === "-") {
      const p = src.indexOf("\n", i);
      i = p < 0 ? n : p + 1;
      continue;
    }
    if (c0 === "/" && src[i + 1] === "*") {
      let d0 = 1; i += 2;
      while (i < n && d0 > 0) {
        if (src.startsWith("/*", i)) { d0++; i += 2; }
        else if (src.startsWith("*/", i)) { d0--; i += 2; }
        else i++;
      }
      continue;
    }
    // ‼️ تخطّي السلسلة **قبل** البحث عن الوسم: بحثٌ ساذج كان سيدخل نصّ SQL
    //    الديناميكيّ حيث المفاتيح مكتوبة ''key'' بهروب، فيقرأها بعلاماتها —
    //    مفتاحٌ لا يوجد في أيّ قائمة، أي إنذار كاذب يُسقط ترحيلة سليمة.
    if (c0 === "'") {
      i++;
      while (i < n) {
        if (src[i] === "'") { if (src[i + 1] === "'") i += 2; else { i++; break; } }
        else i++;
      }
      continue;
    }
    if (!src.startsWith(TOK, i)) { i++; continue; }
    let k = i + TOK.length;
    i = k;                      // المسح الخارجيّ يواصل داخل الوسائط.
    while (k < n && /\s/.test(src[k])) k++;
    if (k >= n || src[k] !== "(") continue;
    k++;
    let d = 1;
    let argi = 0;
    let seg = k;
    const take = (end) => {
      // ‼️ لا `.trim()` هنا. ‏`.trim()` في JavaScript يحذف مسافات Unicode أيضًا،
      //    فيصير الاختبار **أرحم** من PostgreSQL — وهي المسطرة الخطأ التي مرّرت
      //    ترحيلةً سقطت فعلًا. مجموعة التشذيب هنا هي مجموعة lsr_key_of حرفًا
      //    بحرف. النموذج الكامل لدلالات PostgreSQL في
      //    tests/lead_json_key_parser.test.js — وهو المرجع.
      const arg = pgBtrim(src.slice(seg, end), PG_KEY_TRIM);
      if (argi % 2 !== 0 || arg === "") return;
      const m = /^'([\s\S]*)'$/.exec(arg);
      out.push(m ? m[1] : "<computed>");
    };
    while (k < n && d > 0) {
      const c = src[k];
      if (c === "'") {
        k++;
        while (k < n) {
          if (src[k] === "'") { if (src[k + 1] === "'") k += 2; else { k++; break; } }
          else k++;
        }
        continue;
      } else if (c === "(") d++;
      else if (c === ")") { d--; if (d === 0) { take(k); break; } }
      else if (c === "," && d === 1) { take(k); argi++; seg = k + 1; }
      k++;
    }
  }
  return out;
}

/**
 * كلّ مفاتيح JSON التي تُصدِرها دالّة، عبر مستويات البناء الثلاثة:
 * plpgsql مباشرة · SQL ديناميكيّ داخل سلسلة · سلسلة داخل سلسلة.
 * منقول عن public.lsr_client_scan بالخوارزمية نفسها.
 */
function emittedKeys(src) {
  const out = new Set(jsonKeys(src));
  for (const l of sqlLiterals(src)) {
    for (const k of jsonKeys(l)) out.add(k);
    for (const l2 of sqlLiterals(l)) for (const k of jsonKeys(l2)) out.add(k);
  }
  return [...out];
}

/**
 * القائمة المغلقة لمفاتيح لوحة العميل — **مقروءة من RUNME** لا مكرّرة هنا.
 * السبب: مصدر حقيقة واحد. لو نُسخت القائمة في الاختبار لأمكن أن تتباعد
 * النسختان، فيمرّ مفتاح في SQL ويسقط في الاختبار (أو الأسوأ: العكس).
 */
function clientKeyAllowlist() {
  const st = selfTest();
  const i = st.indexOf("v_client_keys text[] := array[");
  assert.ok(i > 0, "قائمة مفاتيح لوحة العميل غائبة عن الفحص الذاتيّ");
  const j = st.indexOf("];", i);
  assert.ok(j > i, "قائمة مفاتيح لوحة العميل غير مغلقة");
  const keys = [...stripComments(st.slice(i, j)).matchAll(/'([a-z_0-9]+)'/g)].map((m) => m[1]);
  assert.ok(keys.length >= 30, `القائمة المغلقة قصيرة على نحو مريب (${keys.length})`);
  return keys;
}

/** كلّ دالّة معرَّفة في الحزمة: الاسم ← جسمها. أساس رسم النداءات الساكن. */
function allFuncBodies() {
  const map = new Map();
  for (const m of SQL.matchAll(/create\s+or\s+replace\s+function\s+public\.([a-z_0-9]+)\s*\(/gi)) {
    if (!map.has(m[1])) map.set(m[1], funcBody(m[1]));
  }
  return map;
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
  sqlLiterals, jsonKeys, emittedKeys, clientKeyAllowlist, allFuncBodies,
  TABLES, PREDICATES, API_FNS, INTERNAL_FNS, FACTORS, EVENTS,
  FORBIDDEN, FORBIDDEN_GATES,
};
