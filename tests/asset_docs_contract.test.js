// ════════════════════════════════════════════════════════════════════════════
// tests/asset_docs_contract.test.js — الوثائق تصف ما بُني فعلًا.
//
// وثيقة تعد بما لا تفعله القاعدة أخطر من غياب الوثيقة: القارئ التالي يبني عليها.
// كلّ فحص هنا يربط جملة في وثيقة بسلوك في الـSQL.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const { DOCS, exists, read, PREDICATES, SIGNALS } = require("./asset_helpers.js");

test("الوثائق الستّ موجودة", () => {
  for (const [k, p] of Object.entries(DOCS)) {
    assert.ok(exists(p), `الوثيقة ${k} مفقودة: ${p}`);
  }
});

test("★ مصفوفة الأدوار تذكر المُسنَدات الستّة كلّها", () => {
  const src = read(DOCS.roles);
  for (const p of PREDICATES) {
    assert.ok(src.includes(p), `المصفوفة لا تذكر ${p}`);
  }
});

test("★★ المصفوفة تقول صراحةً إنّ التكلفة لا تُمنَح بمفتاح مهنة", () => {
  const src = read(DOCS.roles);
  assert.match(src, /لا مفتاح/, "المصفوفة لا تُصرّح بأنّ سطح التكلفة بلا مفتاح دقيق");
  assert.match(src, /anon/, "المصفوفة لا تُصرّح بأنّ anon لا يملك شيئًا");
});

test("★★ المصفوفة تشرح 23P01 بوصفه تعارضًا لا ترحيلة ناقصة", () => {
  const src = read(DOCS.roles);
  assert.match(src, /23P01/, "لا ذكر لرمز التعارض");
  assert.match(src, /23P01[\s\S]{0,400}(ليست|لا).{0,40}ترحيلة/,
    "الوثيقة لا تحذّر من قراءة التعارض كترحيلة ناقصة");
  assert.match(src, /42501/, "لا ذكر لرمز الصلاحية");
});

test("★ وثيقة التشغيل تُرتّب الملفّات الأربعة وتشرح رسائل التوقّف", () => {
  const src = read(DOCS.golive);
  for (const f of ["PREFLIGHT", "RUNME", "POSTCHECK", "ROLLBACK"]) {
    assert.ok(src.includes(f), `وثيقة التشغيل لا تذكر ${f}`);
  }
  assert.match(src, /authz_fixC/, "لا إرشاد لإصلاح البوّابة قبل التطبيق");
  assert.match(src, /prodops/, "لا شرح لتوقّف نصف التطبيق");
});

test("★★ وثيقة التشغيل تنشر ترتيب حزم الإيجار (السبب: جداول تُنشأ مرّتين)", () => {
  const src = read(DOCS.golive);
  assert.match(src, /custody_enterprise_05[\s\S]{0,300}rental_insurance_production|rental_insurance_production[\s\S]{0,300}custody_enterprise_05/,
    "ترتيب حزم الإيجار غير منشور — من يسبق يفرض شكل الجدول");
});

test("★★ وثيقة التشغيل تشرح الغياب الاختياريّ بصدق (null لا صفر)", () => {
  const src = read(DOCS.golive);
  assert.match(src, /بانتظار تفعيل قاعدة البيانات/, "لا ذكر لسلوك ما قبل الـSQL");
  assert.match(src, /لا صفر|null.{0,40}صراحةً|—\s*\*\*لا صفر/,
    "لا تصريح بأنّ المصدر الغائب يُعلَن null لا صفرًا");
});

test("★★ عقد QR يمنع الحقول الحسّاسة بالاسم", () => {
  const src = read(DOCS.qr);
  for (const w of ["purchase_price", "employee_user_id", "file_path", "asset_id"]) {
    assert.ok(src.includes(w), `عقد QR لا يمنع ${w} بالاسم`);
  }
  assert.match(src, /تسجيل الدخول|لا بحث مجهول/, "عقد QR لا يعلن سياسة V1");
  assert.match(src, /٦٠|60/, "عقد QR بلا حدّ معدّل معلن");
  assert.match(src, /qrcode|محلّية/, "عقد QR لا يذكر المكتبة المحلّية");
});

test("★ عقد QR يفصل الإلغاء عن إعادة الإصدار", () => {
  const src = read(DOCS.qr);
  assert.match(src, /revoke|إلغاء/i, "لا استراتيجية إلغاء");
  assert.match(src, /reissue|إعادة الإصدار/i, "لا شرح لإعادة الإصدار");
  assert.match(src, /old_token/, "لا إثبات أنّ القديم يُسجَّل ويُبطَل");
});

test("★★ سير العمل يعدّد المستحيلات مع حارسها", () => {
  const src = read(DOCS.workflow);
  for (const g of [
    "trg_civ_guard_assignment_closure", "trg_civ_guard_assignment_history",
    "trg_civ_guard_evidence_path", "trg_civ_guard_asset_disposal",
    "trg_civ_guard_reservation",
  ]) {
    assert.ok(src.includes(g), `سير العمل لا يربط المستحيل بحارسه ${g}`);
  }
});

test("★★ سير العمل يشرح لماذا الحارس على الجدول لا داخل الدالّة", () => {
  const src = read(DOCS.workflow);
  assert.match(src, /أربعة تعاريف|آخر ملفّ يُشغَّل يفوز/,
    "لا شرح لسبب وضع الحرّاس على الجداول");
});

test("★★ سير العمل يعلن أنّ المخزون يعود عند الفحص لا عند التسليم", () => {
  const src = read(DOCS.workflow);
  assert.match(src, /لا يعود عند تسليم|عند الفحص/,
    "قاعدة عودة المخزون غير معلنة — أخطر سوء فهم في الوحدة");
});

test("★ سير العمل يُدرج الإشارات كقواعد بأساسها الرقميّ", () => {
  const src = read(DOCS.workflow);
  for (const s of SIGNALS) {
    assert.ok(src.includes(s), `سير العمل لا يوثّق الإشارة ${s}`);
  }
  assert.match(src, /ليست ذكاءً اصطناعيًّا|قواعد لا تنبّؤ/,
    "الوثيقة لا تنفي عن الإشارات صفة التنبّؤ");
});

test("★ سير العمل يعلن حدود تغطية محرّك التعارض", () => {
  const src = read(DOCS.workflow);
  assert.match(src, /planning_bookings/, "لا إعلان لحدّ التغطية");
  assert.match(src, /planning_bookings[\s\S]{0,200}(خارج التغطية|❌)/,
    "التغطية تُقدَّم كشاملة وهي ليست كذلك");
});

test("★★★ عقد التكلفة يمنع استنتاج الربح صراحةً", () => {
  const src = read(DOCS.costing);
  assert.match(src, /لا استنتاج ربح/, "العقد لا يمنع استنتاج الربح");
  for (const t of ["fin_", "invoices", "zoho"]) {
    assert.ok(src.includes(t), `العقد لا يسمّي ${t} ضمن الممنوع`);
  }
  assert.match(src, /finance_tables/, "العقد لا يذكر تصريح المصادر في الردّ");
});

test("★★★ عقد التكلفة يمنع الصفر مقام «غير مفعّل»", () => {
  const src = read(DOCS.costing);
  assert.match(src, /لا صفر/, "العقد لا يمنع الصفر الكاذب");
  assert.match(src, /source_available/, "العقد لا يذكر إعلان توفّر المصدر");
});

test("★★ عقد التكلفة يفصل السطح التشغيليّ عن المالكيّ", () => {
  const src = read(DOCS.costing);
  assert.ok(src.includes("custody_inv_asset_utilization"), "لا ذكر للسطح التشغيليّ");
  assert.ok(src.includes("custody_inv_asset_cost_summary"), "لا ذكر للسطح المالكيّ");
  assert.match(src, /contains_financials/, "لا إعلان لخلوّ السطح التشغيليّ من المال");
});

test("★ عقد التكلفة يذكر ما لا يفعله", () => {
  const src = read(DOCS.costing);
  assert.match(src, /ما لا يفعله/, "العقد بلا قسم حدود — يُقرأ كوعد شامل");
});

test("★★ وثيقة القبول تغطّي سيناريوهات الحجز السبعة", () => {
  const src = read(DOCS.acceptance);
  for (const s of ["متداخل", "23P01", "23514", "expired", "إلغاء"]) {
    assert.ok(src.includes(s), `القبول لا يغطّي ${s}`);
  }
  assert.match(src, /ب١٠|ب٩/, "قائمة الحجز أقصر من المطلوب");
});

test("★★ وثيقة القبول تحذّر من التنفيذ بدور postgres", () => {
  const src = read(DOCS.acceptance);
  assert.match(src, /auth\.uid\(\) = NULL|بدور `postgres`/,
    "القبول لا يحذّر من أنّ المحرّر لا يشبه الواقع");
});

test("★ وثيقة القبول تذكر ما ليس ضمن النطاق", () => {
  const src = read(DOCS.acceptance);
  assert.match(src, /ما ليس ضمن/, "القبول بلا حدود معلنة");
  assert.match(src, /planning_bookings/, "القبول لا يذكر الحدّ المعروف للتغطية");
});
