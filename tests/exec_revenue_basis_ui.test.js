// ════════════════════════════════════════════════════════════════════════════
// tests/exec_revenue_basis_ui.test.js
//
// mgmt_revenue_basis كانت مطبَّقة على الإنتاج وممنوحة لـauthenticated، ولا
// سطرَ واحد في التطبيق يناديها. خلفيّةٌ بلا واجهة ليست ميزة: المالك لم يكن
// يرى فصلَ الأسس الذي بُني له، وبندُ القبول «اقرأ وسوم الإيراد» لم يكن قابلًا
// للتنفيذ أصلًا.
//
// وهذا الحارس يمنع الانحدار في الاتّجاهين: أن تُفصَل الأسس في القاعدة ثمّ
// تُجمَع في الواجهة، وأن يُعرض غيابُ رقمٍ صفرًا.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const read = (r) => (fs.existsSync(path.join(ROOT, r)) ? fs.readFileSync(path.join(ROOT, r), "utf8") : null);
const LIB = "lib/portal/execReport.ts";
const UI = "components/portal/exec/ExecDashboard.tsx";
const SQL = "docs/executive_reporting_RUNME.sql";

test("(١) ★★ الدالّة موصولة فعلًا بالتطبيق ★★", () => {
  const lib = read(LIB), ui = read(UI);
  assert.match(lib, /prpc<ExecRevenueBasis>\("mgmt_revenue_basis"/, "لا غلاف يُنادي الدالّة");
  assert.match(lib, /p_from:\s*from,\s*p_to:\s*to/, "الوسائط لا تُمرَّر بالاسم");
  assert.match(ui, /<RevenueBasisPanel\s/, "اللوحة غير مركَّبة في الشاشة");
  assert.match(ui, /function RevenueBasisPanel/, "اللوحة غير معرَّفة");
  assert.match(ui, /execRevenueBasis\(/, "اللوحة لا تنادي الغلاف");
});

test("(٢) ★★ الأسس الأربعة معروضة منفصلةً بأسمائها ★★", () => {
  const lib = read(LIB), ui = read(UI);
  for (const k of ["contract_value_net", "invoiced_revenue_net",
                   "collected_revenue_net", "recognized_revenue_net"]) {
    assert.ok(lib.includes(k), `الحقل مفقود من الغلاف: ${k}`);
    assert.ok(ui.includes(k), `الحقل غير معروض: ${k}`);
    assert.match(lib, new RegExp(`${k}:\\s*\\{\\s*ar:`), `لا وسم عربيّ/إنجليزيّ لـ${k}`);
  }
  // ولا يُجمع أيٌّ منها في رقم واحد اسمه «إيراد»
  assert.doesNotMatch(ui, /contract_value_net\s*\+\s*|invoiced_revenue_net\s*\+/,
    "الأسس تُجمع في الواجهة — وهي مقاييس مختلفة");
});

test("(٣) ★★ الغياب يُقال «غير متاح» ولا يُعرض صفرًا ★★", () => {
  const ui = read(UI);
  assert.match(ui, /v === null[\s\S]{0,120}?غير متاح/, "القيمة الغائبة لا تُعلَن غير متاحة");
  // ⚠️ النطاق لوحة الأسس وحدها: الملفّ فيه لوحات أخرى لها قواعدها.
  const blk = ui.slice(ui.indexOf("function RevenueBasisPanel"), ui.indexOf("function SourcesPanel"));
  assert.doesNotMatch(blk, /\?\?\s*0\b|\|\|\s*0\b/, "غيابٌ يُستبدَل بصفر في اللوحة");
  assert.match(read(LIB), /revenueBasisWhy/, "لا شرح لسبب الغياب");
});

test("(٤) ★★ المعترَف به يبقى NULL ولا يُشتقّ ★★", () => {
  const lib = read(LIB);
  assert.match(lib, /no_recognition_source/, "حالة انعدام مصدر الاعتراف غير معالَجة");
  assert.match(lib, /لا يُشتقّ من المفوتَر/, "لا نصّ يمنع الاشتقاق");
  // والقاعدة نفسها ما زالت تُصدره null
  assert.match(read(SQL), /'recognized_revenue_net',\s*null/, "القاعدة لم تعد تُصدره null");
});

test("(٥) ★★ الضريبة والعملة مُعلَنتان ★★", () => {
  const lib = read(LIB), ui = read(UI);
  assert.match(lib, /vatNote/, "لا وسم ضريبة");
  assert.match(lib, /صافية قبل ضريبة القيمة المضافة/, "لا نصّ يوضّح أنّ الأرقام صافية");
  assert.match(lib, /currencyNote/, "لا وسم عملة");
  assert.match(lib, /unavailable_grouped_by_currency/, "لا معالجة لتعدّد العملات");
  assert.match(lib, /لا إجمالي موحّد/, "تعدّد العملات لا يمنع الإجمالي");
  for (const f of ["vatNote(b, L)", "currencyNote(b, L)"])
    assert.ok(ui.includes(f), `الوسم غير معروض: ${f}`);
});

test("(٦) ★ ختم الحداثة معروض ★", () => {
  assert.match(read(UI), /freshness_at/, "لا ختم حداثة في لوحة الأسس");
});

test("(٧) ★★ لا منطق صلاحيات في الواجهة: المنع في القاعدة ★★", () => {
  const ui = read(UI);
  const i = ui.indexOf("function RevenueBasisPanel");
  const blk = ui.slice(i, ui.indexOf("function SourcesPanel"));
  assert.doesNotMatch(blk, /is_owner|isOwner|can_view_sensitive/,
    "الواجهة تحكم بالصلاحية — والحكم للقاعدة وحدها");
  assert.match(blk, /StateView/, "لا معالجة موحّدة للحالات (منع/ترحيلة/خطأ)");
  // والدالّة في القاعدة ما زالت owner-only
  assert.match(read(SQL), /mgmt_can_view_sensitive\(\), false\)\s*then\s*\n?\s*return jsonb_build_object\('ok', false, 'reason', 'owner_only'/,
    "الدالّة لم تعد owner-only");
});

test("SAFE: ساكن فقط (لا شبكة ولا عمليّة ولا مفتاح خدمة)", () => {
  const src = fs.readFileSync(__filename, "utf8");
  for (const [what, re] of [["شبكة", new RegExp("\\b" + "fet" + "ch\\s*\\(")],
                            ["عمليّة", new RegExp("\\b" + "child_" + "process\\b")],
                            ["مفتاح خدمة", new RegExp("\\b" + "service_" + "role\\b")]])
    assert.doesNotMatch(src, re, `الفاحص يلمس ${what}`);
});
