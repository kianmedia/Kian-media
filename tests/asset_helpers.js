// ════════════════════════════════════════════════════════════════════════════
// tests/asset_helpers.js — مساعدات اختبارات حزمة ذكاء الأصول.
// ليس ملفّ اختبار (لا ينتهي بـ.test.js) فلا يلتقطه node --test.
//
// كلّ الفحوص هنا **ساكنة**: تقرأ ملفّات الحزمة من القرص وتتحقّق من عقودها نصًّا.
// لا اتّصال بقاعدة، ولا بيانات إنتاج، ولا شبكة — لأنّ الجداول التي تمسّها هذه
// الحزمة تحمل عهدًا حيّة، واختبار يكتب فيها أسوأ من اختبار غائب.
// ════════════════════════════════════════════════════════════════════════════
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const exists = (p) => fs.existsSync(path.join(ROOT, p));

const BASE = "docs/asset_intelligence_";
const FILES = {
  PREFLIGHT: `${BASE}PREFLIGHT.sql`,
  RUNME: `${BASE}RUNME.sql`,
  POSTCHECK: `${BASE}POSTCHECK.sql`,
  ROLLBACK: `${BASE}ROLLBACK.sql`,
};

const PREFLIGHT = read(FILES.PREFLIGHT);
const SQL = read(FILES.RUNME);
const POSTCHECK = read(FILES.POSTCHECK);
const ROLLBACK = read(FILES.ROLLBACK);

const DOCS = {
  roles: "docs/ASSET_INTELLIGENCE_ROLE_MATRIX.md",
  golive: "docs/ASSET_INTELLIGENCE_GO_LIVE.md",
  acceptance: "docs/ASSET_INTELLIGENCE_ACCEPTANCE.md",
  qr: "docs/QR_SECURITY_CONTRACT.md",
  workflow: "docs/CUSTODY_AND_MAINTENANCE_WORKFLOW.md",
  costing: "docs/ASSET_COSTING_CONTRACT.md",
};

/**
 * يجرّد المصدر من التعليقات فقط (تبقى السلاسل النصّية).
 * التعليقات في هذه الحزمة عربية ومطوّلة وتذكر أسماء كائنات للشرح، فلولا التجريد
 * لالتبس «شرحُ أنّنا لا نُنشئ asset_*» بـ«إنشاء asset_*» فعلًا.
 */
function stripComments(src) {
  let out = "";
  let i = 0;
  let inLine = false;
  let inBlock = false;
  let inStr = false;
  let dollar = null;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (inLine) { if (c === "\n") { inLine = false; out += c; } i++; continue; }
    if (inBlock) { if (c === "*" && n === "/") { inBlock = false; i += 2; continue; } i++; continue; }
    if (inStr) { out += c; if (c === "'") { if (n === "'") { out += n; i += 2; continue; } inStr = false; } i++; continue; }
    if (dollar) {
      if (src.startsWith(dollar, i)) { out += dollar; i += dollar.length; dollar = null; continue; }
      out += c; i++; continue;
    }
    if (c === "-" && n === "-") { inLine = true; i += 2; continue; }
    if (c === "/" && n === "*") { inBlock = true; i += 2; continue; }
    if (c === "'") { inStr = true; out += c; i++; continue; }
    const m = /^\$[a-zA-Z_]*\$/.exec(src.slice(i));
    if (m) { dollar = m[0]; out += m[0]; i += m[0].length; continue; }
    out += c;
    i++;
  }
  return out;
}

/** يجرّد التعليقات **ومحتوى** السلاسل — لفحص «هل يُشار إلى الجدول فعلًا؟». */
function stripCommentsAndStrings(src) {
  let out = "";
  let i = 0;
  let inLine = false;
  let inStr = false;
  let dollar = null;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (inLine) { if (c === "\n") { inLine = false; out += c; } i++; continue; }
    if (inStr) { if (c === "'") { if (n === "'") { i += 2; continue; } inStr = false; } i++; continue; }
    if (dollar) { if (src.startsWith(dollar, i)) { i += dollar.length; dollar = null; continue; } i++; continue; }
    if (c === "-" && n === "-") { inLine = true; i += 2; continue; }
    if (c === "'") { inStr = true; i++; continue; }
    const m = /^\$[a-zA-Z_]*\$/.exec(src.slice(i));
    if (m) { dollar = m[0]; i += m[0].length; continue; }
    out += c;
    i++;
  }
  return out;
}

const CODE = stripComments(SQL);

/** جسم دالّة واحدة من الـRUNME (بعد تجريد التعليقات). */
function funcBody(name) {
  // النهاية `$fn$;` قد تكون على السطر نفسه (`end $fn$;`) أو وحدها — الاثنان
  // مستعملان في الحزمة، فاشتراط بداية السطر كان يُرجع null بصمت لأغلب الدوالّ
  // ويجعل كلّ اختبار مبنيّ عليها ينجح وهو لم يقرأ شيئًا.
  const re = new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\(([\\s\\S]*?)\\$fn\\$;`,
    "i",
  );
  const m = re.exec(CODE);
  return m ? m[0] : null;
}

/** كتلة SELF-TEST من الـRUNME. */
function selfTest() {
  const m = /do \$st\$([\s\S]*?)end \$st\$;/i.exec(CODE);
  return m ? m[1] : "";
}

/** الجداول التي تُنشئها الحزمة فعلًا (create table). */
function createdTables() {
  return [...CODE.matchAll(/create\s+table\s+if\s+not\s+exists\s+public\.([a-z0-9_]+)/gi)].map((m) => m[1]);
}

/** الدوالّ التي تُنشئها الحزمة فعلًا. */
function createdFunctions() {
  return [...CODE.matchAll(/create\s+or\s+replace\s+function\s+public\.([a-z0-9_]+)\s*\(/gi)].map((m) => m[1]);
}

// المُسنَدات الستّة المطلوبة بالاسم في العقد.
const PREDICATES = [
  "civ_can_view_assets",
  "civ_can_manage_assets",
  "civ_can_issue_custody",
  "civ_can_close_custody",
  "civ_can_manage_maintenance",
  "civ_can_view_asset_sensitive_costs",
];

// البوّابات القائمة — **يُشار إليها ولا تُعاد كتابتها أبدًا**.
const UNTOUCHABLE_GATES = [
  "civ_can_manage",
  "civ_can_finance",
  "civ_can_delete_asset",
  "civ_can_admin",
  "civ_is_employee",
  "civ_set_avail",
  "civ_gen_no",
];

// الجداول القائمة التي أُعيد استخدامها بدل استنساخها.
const REUSED_TABLES = [
  "custody_inventory_assets",
  "custody_inventory_movements",
  "custody_inventory_assignments",
  "custody_inventory_assignment_items",
  "custody_inventory_evidence",
  "custody_inventory_reservations",
  "custody_inventory_maintenance",
  "custody_condition_reports",
  "custody_qr_events",
];

// ما أُنشئ جديدًا — ولا شيء غيره.
const NEW_TABLES = [
  "custody_inventory_maintenance_plans",
  "custody_inventory_meter_readings",
];

// الحالات العشر لآلة الحالة.
const ASSET_STATES = [
  "available", "reserved", "checked_out", "in_use", "returned_pending_inspection",
  "maintenance", "damaged", "missing", "retired", "disposed",
];

// أنواع العدّادات المطلوبة في دفتر الاستخدام.
const METER_TYPES = [
  "usage_hours", "sessions", "shutter_count", "battery_cycles",
  "flight_hours", "recording_hours", "distance_km", "custom",
];

// الإشارات الإحدى عشرة — قواعد صريحة لا تنبّؤ.
const SIGNALS = [
  "service_due_soon", "service_overdue", "high_fault_frequency", "excessive_downtime",
  "repeated_damage", "warranty_expiring", "inspection_overdue", "high_usage",
  "low_utilization", "replacement_review",
];

module.exports = {
  ROOT, read, exists, FILES, DOCS,
  SQL, PREFLIGHT, POSTCHECK, ROLLBACK, CODE,
  stripComments, stripCommentsAndStrings,
  funcBody, selfTest, createdTables, createdFunctions,
  PREDICATES, UNTOUCHABLE_GATES, REUSED_TABLES, NEW_TABLES,
  ASSET_STATES, METER_TYPES, SIGNALS,
};
