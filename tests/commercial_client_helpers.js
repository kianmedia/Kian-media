// ════════════════════════════════════════════════════════════════════════════
// tests/commercial_client_helpers.js — مساعدات مشتركة لاختبارات سطح العميل.
// ليس ملفّ اختبار (لا ينتهي بـ.test.js) فلا يلتقطه node --test.
//
// المرحلة ٣ تعيش داخل §17 من حزمة الاشتراكات نفسها — لا حزمة ثانية. لذلك كلّ
// الفحوص هنا تقرأ الملفّ المشترك وتستخرج منه القسم، ولا تفترض ملفًّا مستقلًّا.
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

const TS = read("lib/portal/commercial.ts");
const ATOMS = read("components/portal/commercial/CsubAtoms.tsx");
const CREDITS = read("components/portal/commercial/ClientCredits.tsx");
const FORM = read("components/portal/commercial/ProductionRequestForm.tsx");
const PAGE = read("app/(portal)/client-portal/production-credits/page.tsx");
const NAV = read("components/portal/nav.ts");

/** قسم §17 وحده — ما أضافته المرحلة ٣ إلى الحزمة المشتركة. */
function phase3() {
  const i = SQL.indexOf("-- §17) المرحلة ٣");
  assert.ok(i > 0, "قسم §17 (المرحلة ٣) غير موجود في الحزمة المشتركة");
  return SQL.slice(i);
}
const SQL17 = phase3();

/** جسم دالّة معرَّفة بـ$$ … $$; داخل مصدر معطى. */
function funcBody(name, src = SQL) {
  const re = new RegExp(
    "create\\s+or\\s+replace\\s+function\\s+public\\." + name +
      "\\s*\\(([\\s\\S]*?)\\)\\s*\\n?returns[\\s\\S]*?\\bas\\s*\\$\\$([\\s\\S]*?)\\$\\$\\s*;",
    "i",
  );
  const m = src.match(re);
  assert.ok(m, `تعذّر إيجاد جسم الدالّة ${name}`);
  return m[2];
}

/** قائمة مَعالِم الدالّة كنصّ — لفحص التوقيع (مثلًا: لا numeric). */
function funcArgs(name, src = SQL) {
  const re = new RegExp(
    "create\\s+or\\s+replace\\s+function\\s+public\\." + name + "\\s*\\(([\\s\\S]*?)\\)\\s*\\n?returns",
    "i",
  );
  const m = src.match(re);
  assert.ok(m, `تعذّر إيجاد توقيع الدالّة ${name}`);
  return m[1];
}

/** الدوالّ التي تضيفها المرحلة ٣ وحدها. */
const PHASE3_FNS = [
  "csub_my_credits_page", "csub_request_submit", "csub_request_cancel",
  "csub_request_attachment_add", "csub_request_transition", "csub_request_set_credits",
  "csub_request_link_project", "csub_service_requests_list",
];

/** جدولا المرحلة ٣. */
const PHASE3_TABLES = ["csub_service_requests", "csub_service_request_attachments"];

/** دوالّ الأساس (المرحلة ١+٢) التي تبني عليها المرحلة ٣ ولا تستنسخها. */
const FOUNDATION_FNS = [
  "csub_reserve", "csub_release", "csub_consume",
  "csub_approval_submit_core", "csub_available_core", "csub_balance_core",
  "csub_my_statement", "csub_is_client", "csub_can_manage", "csub_can_consume",
];

/** الحالات العشر — ترتيب سير العمل لا الأبجدية. */
const STATES = [
  "draft", "submitted", "under_review", "credit_reserved", "needs_overage_approval",
  "approved", "rejected", "scheduled", "fulfilled", "cancelled",
];

/** الحقول الداخلية التي لا يجوز أن تصل إلى العميل بأيّ طريق. */
const INTERNAL_FIELDS = [
  "internal_notes", "internal_metadata", "decision_reason",
  "price_net", "vat_amount", "price_gross", "csub_audit",
];

module.exports = {
  ROOT, read, exists,
  SQL, SQL17, PREFLIGHT, POSTCHECK, ROLLBACK,
  TS, ATOMS, CREDITS, FORM, PAGE, NAV,
  funcBody, funcArgs,
  PHASE3_FNS, PHASE3_TABLES, FOUNDATION_FNS, STATES, INTERNAL_FIELDS,
};
