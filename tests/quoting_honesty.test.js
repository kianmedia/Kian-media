// ════════════════════════════════════════════════════════════════════════════
// tests/quoting_honesty.test.js — الشاشة لا تكذب.
//
// كلّ اختبار هنا يحرس جملة قد يتصرّف إنسان بناءً عليها:
//
//   · «أُرسل»        → يجعل الفريق يتوقّف عن المتابعة على رسالة لم تغادر.
//   · «٠ ريال»       → يجعل موظّفًا يعرض على عميل سعرًا لم يُعتمد.
//   · «ترحيلة ناقصة» عن منعِ صلاحية → يُرسل الفريق يطارد ترحيلة سليمة
//     (وقد كلّف هذا الخلط دورة إنتاج كاملة من قبل).
//   · هامشٌ محسوب بتكلفة ناقصة → يجعل المالك يعتمد سعرًا خاسرًا وهو يظنّه رابحًا.
//   · «مدى إرشاديّ» يُقرأ سعرًا نهائيًّا → التزامٌ تجاريّ لم يُقصد.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  SQL, TS, read, funcDef, funcBody, tableDef,
} = require("./quoting_helpers.js");

const ATOMS = read("components/portal/quoting/QuotingAtoms.tsx");
const BUILDER = read("components/portal/quoting/QuoteBuilder.tsx");
const OWNER = read("components/portal/quoting/OwnerPricingPanel.tsx");
const PAGE = read("app/(portal)/client-portal/quoting/page.tsx");

// ─── (١) ★ sent_placeholder لا تعني أنّ رسالة غادرت ★ ────────────────────────

test("★ الحالة تُعرض «معتمد وجاهز للإرسال اليدوي» ★", () => {
  const label = funcBody("sq_quote_status_label");
  assert.match(label, /when 'sent_placeholder'\s+then 'معتمد وجاهز للإرسال اليدوي'/,
    "الحالة لا تُعرض بالنصّ الذي نصّ عليه المتطلّب");
  // ولا كلمة «أُرسل» في أيّ نصّ **يُعرض**. الفحص على السلاسل المُخرَجة لا على
  // الشرح: جسم الدالّة يحمل تعليقًا يقول «لا كلمة أُرسل» وهو تأكيد للصواب.
  const emitted = [...label.matchAll(/then\s+'([^']*)'/g)].map((m) => m[1]);
  assert.ok(emitted.length >= 9, `عدد النصوص المعروضة ${emitted.length} — أقلّ من الحالات التسع`);
  const lying = emitted.filter((s) => s.includes("أُرسل") || s.includes("تمّ الإرسال"));
  assert.deepEqual(lying, [], "★ نصّ حالة يقول «أُرسل» — والنظام لم يرسل شيئًا");
  assert.ok(emitted.includes("معتمد وجاهز للإرسال اليدوي"), "النصّ المطلوب غير معروض");
});

test("★ الواجهة تكرّر النصّ نفسه ولا تختصره ★", () => {
  assert.match(TS, /sent_placeholder: "معتمد وجاهز للإرسال اليدوي"/,
    "الطبقة الأمامية تترجم الحالة ترجمة مختلفة عن الخادم");
  assert.ok(!/sent_placeholder[^\n]*"أُرسل"/.test(TS), "★ الواجهة تقول «أُرسل»");
  assert.match(ATOMS, /ManualSendNotice/, "لا لافتة تشرح أنّ شيئًا لم يُرسل");
  assert.match(ATOMS, /لم يُرسل النظام أيّ رسالة/, "اللافتة لا تنفي الإرسال صراحةً");
  assert.match(BUILDER, /<ManualSendNotice \/>/, "الشاشة لا تعرض اللافتة");
});

test("★ لا ادّعاء تسليم بلا إثبات مزوّد — قيد في القاعدة ★", () => {
  assert.match(SQL, /constraint sq_delivery_never_claimed check \(delivery_proven = false\)/,
    "لا قيد يمنع ادّعاء التسليم");
  const mark = funcBody("sq_quote_mark_ready_for_manual_send");
  assert.match(mark, /'delivery_proven', false/, "الدالّة لا تصرّح بعدم التسليم");
  assert.match(mark, /لم تُرسَل رسالة من النظام/, "الدالّة لا تعيد نصًّا أمينًا");
  // ولا تكتب delivery_proven إطلاقًا
  assert.ok(!/delivery_proven\s*=\s*true/.test(SQL), "★ كودٌ يدّعي تسليمًا");
});

test("لا مزوّد بريد ولا رسالة تغادر من هذا الموديول", () => {
  for (const tok of ["resend", "sendgrid", "smtp", "mailgun", "postmark",
                     "email_outbox", "notify_email", "send_email"]) {
    assert.ok(!SQL.toLowerCase().includes(tok), `★ الموديول يتّصل بمزوّد بريد (${tok})`);
  }
  // الإشعار داخل التطبيق فقط، ومكتشَف، ويبتلع الفشل
  const n = funcBody("sq_notify");
  assert.match(n, /to_regclass\('public\.notifications'\) is null/, "الإشعار غير مكتشَف");
  assert.match(n, /exception when others then/, "فشل الإشعار قد يُسقط قرارًا صحيحًا");
});

// ─── (٢) ★ لا رقم يُخترع ★ ───────────────────────────────────────────────────

test("★ الضريبة NULL تبقى NULL — عرضٌ بلا سعر لا يُعرض بضريبة صفر ★", () => {
  const def = tableDef("sq_quotes");
  assert.match(def,
    /vat_amount\s+numeric\(14,2\) generated always as \(\s*case when gross_before_vat is null then null/,
    "★ الضريبة تُحسب صفرًا حين لا سعر — وصفرٌ هنا كذبة");
  assert.match(def,
    /total_after_vat\s+numeric\(14,2\) generated always as \(\s*case when gross_before_vat is null then null/,
    "★ الإجمالي يُحسب صفرًا حين لا سعر");
});

test("★ الضريبة حقل مستقلّ دائمًا، لا مطويّة في الإجمالي ★", () => {
  const q = tableDef("sq_quotes");
  assert.match(q, /vat_rate\s+numeric\(6,4\)/, "نسبة الضريبة ليست حقلًا مستقلًّا");
  assert.match(q, /vat_amount\s+numeric\(14,2\)/, "مبلغ الضريبة ليس حقلًا مستقلًّا");
  assert.match(q, /gross_before_vat\s+numeric\(14,2\)/, "لا حقل للإجمالي قبل الضريبة");
  // وفي الدفعات كذلك
  const m = tableDef("sq_quote_milestones");
  assert.match(m, /vat_rate\s+numeric\(6,4\)/, "الدفعة بلا نسبة ضريبة");
  assert.match(m, /vat_amount\s+numeric\(14,2\) generated/, "الدفعة بلا مبلغ ضريبة مستقلّ");
  assert.match(m, /amount_gross\s+numeric\(14,2\) generated/, "الدفعة بلا إجمالي");
  // والواجهة تعرض الثلاثة
  assert.match(ATOMS, /export function VatBreakdown/, "لا مكوّن يعرض الضريبة منفصلة");
  assert.match(ATOMS, /الإجمالي قبل الضريبة/, "لا سطر للإجمالي قبل الضريبة");
  assert.match(ATOMS, /ضريبة القيمة المضافة/, "لا سطر للضريبة");
  assert.match(ATOMS, /الإجمالي بعد الضريبة/, "لا سطر للإجمالي بعدها");
});

test("★ Money لا تعرض صفرًا عن رقم غير معروف ★", () => {
  assert.match(ATOMS, /export function Money/, "لا مكوّن مال");
  // من رأس الدالّة حتى رأس الدالّة التالية — لا حتى أوّل «\n}»، فذاك يقفل
  // نوعَ الوسائط المفكّكة لا جسم المكوّن.
  const start = ATOMS.indexOf("export function Money");
  const next = ATOMS.indexOf("export function Pct");
  assert.ok(start > 0 && next > start, "تعذّر عزل مكوّن المال");
  const body = ATOMS.slice(start, next);
  assert.ok(!/\?\?\s*0/.test(body), "★ Money تخترع صفرًا");
  // يميّز الغياب بالحالتين معًا: null (لم يُحدَّد) و undefined (لم يصل الحقل).
  assert.match(body, /value !== null/, "Money لا تفحص null");
  assert.match(body, /value !== undefined/, "Money لا تفحص undefined");
  assert.match(body, /Number\.isNaN\(value\)/, "Money تعرض NaN رقمًا");
  assert.match(body, /unknownText/, "Money بلا نصّ بديل");
});

test("★ سعر لم يعتمده المالك يُقرأ «لم يُعتمد» لا صفرًا ★", () => {
  assert.match(BUILDER, /unknownText="لم يعتمد المالك سعرًا بعد"/,
    "السعر المعتمَد غير المحدَّد لا يُشرح");
  assert.match(BUILDER, /unknownText="لم يُقترح بعد"/, "السعر المقترَح غير المحدَّد لا يُشرح");
  // والقاعدة لا تملأ المعتمَد تجميلًا
  const decide = funcBody("sq_approval_decide");
  assert.ok(!/authorized_price = coalesce\(.*list_price/.test(decide),
    "★ السعر المعتمَد يُملأ بسعر القائمة تلقائيًّا — «لم يُعتمد» صارت «معتمد»");
});

// ─── (٣) ★ ترحيلة ناقصة ≠ منع صلاحية ★ ──────────────────────────────────────

test("★ الحالات الأربع متمايزة ولا تُطوى ★", () => {
  assert.match(TS, /state: "needs_migration"/, "لا حالة ترحيلة ناقصة");
  assert.match(TS, /state: "denied"/, "لا حالة منع صلاحية");
  assert.match(TS, /state: "error"/, "لا حالة خطأ");
  assert.match(TS, /state: "ok"/, "لا حالة نجاح");
  // والتصنيف يستعمل المصنّف الرسميّ لا تخمينًا
  assert.match(TS, /pgIsMigrationPending\(d\)/, "لا يستعمل المصنّف الرسميّ للترحيلة");
  assert.match(TS, /d\.kind === "permission_denied"/, "لا يميّز منع الصلاحية");
  // ★ الترتيب حاسم: المنع يُفحص بعد الترحيلة، ولا يُطوى فيها
  const order = TS.indexOf("pgIsMigrationPending");
  const denied = TS.indexOf('d.kind === "permission_denied"');
  assert.ok(order > 0 && denied > order, "ترتيب التصنيف مقلوب");
});

test("★ لا رسالة تدّعي ترحيلة ناقصة عن منعِ صلاحية ★", () => {
  assert.match(TS, /export const SQ_MIGRATION_AR/, "لا نصّ للترحيلة الناقصة");
  assert.match(TS, /export const SQ_DENIED_AR/, "لا نصّ لمنع الصلاحية");
  const mig = TS.match(/SQ_MIGRATION_AR =\s*([\s\S]*?);/)[1];
  const den = TS.match(/SQ_DENIED_AR =\s*([\s\S]*?);/)[1];
  assert.ok(!/صلاحية/.test(mig), "نصّ الترحيلة يذكر الصلاحية — خلطٌ للسببين");
  assert.ok(!/ترحيل/.test(den), "★ نصّ المنع يذكر الترحيل — هذا الخلط أضاع دورة إنتاج");
  assert.match(mig, /smart_quoting_RUNME\.sql/, "نصّ الترحيلة لا يسمّي الملفّ الواجب تشغيله");
});

test("الواجهة تعرض أربع شاشات لا شاشة واحدة", () => {
  for (const c of ["MigrationPending", "Denied", "ErrorBox", "Empty"]) {
    assert.match(ATOMS, new RegExp(`export function ${c}`), `الشاشة ${c} مفقودة`);
  }
  assert.match(ATOMS, /export function StateView/, "لا غلاف موحّد للحالة الرباعية");
  assert.match(ATOMS, /لم يُعرض عليك رقم واحد لأنّ الأرقام غير متاحة بعد/,
    "شاشة الترحيلة لا تنفي أن تكون الأرقام أصفارًا");
});

// ─── (٤) ★ تكلفة ناقصة تُقرأ هامشًا عاليًا ★ ─────────────────────────────────

test("★ بندٌ بلا سعر تكلفة يُعدّ ويُعلَن — لا يُحتسب صفرًا بصمت ★", () => {
  const b = funcBody("sq_quote_recompute");
  assert.match(b, /count\(\*\) filter \(where cr\.cost_rate is null\)/,
    "البنود غير المسعّرة لا تُعدّ");
  assert.match(b, /'uncosted_lines', v_uncosted/, "العدد لا يُسجَّل في التفصيل");
  assert.match(b, /'cost_complete', \(v_uncosted = 0\)/, "لا علامة لاكتمال التكلفة");
  assert.match(b, /'cost_complete', \(v_uncosted = 0\)\)/, "العلامة لا تُعاد للمستدعي");
});

test("★ الواجهة تحذّر أنّ الهامش يبدو أعلى ممّا هو ★", () => {
  assert.match(OWNER, /cost_complete === false/, "لوحة المالك لا تفحص اكتمال التكلفة");
  assert.match(OWNER, /تقدّر التكلفة أقلّ من حقيقتها/,
    "التحذير لا يشرح أثر النقص على الهامش");
  assert.match(OWNER, /incomplete_costing|cost_complete/, "لا ربط بالمؤشّر");
});

test("لوحة المالك تقول «لم يُحسب» ولا تعرض أصفارًا", () => {
  const detail = funcBody("sq_quote_internal_detail");
  assert.match(detail, /'costed', false/, "لا تمييز بين «لم يُحسب» و«صفر»");
  assert.match(detail, /القيم غائبة، وليست أصفارًا/, "لا تصريح بأنّ الغياب ليس صفرًا");
  assert.match(TS, /costed: false/, "النوع لا يميّز «لم يُحسب»");
});

// ─── (٥) ★ المدى إرشاديّ لا ملزِم ★ ──────────────────────────────────────────

test("★ المدى العلنيّ يقول عن نفسه إنّه غير ملزِم ★", () => {
  const b = funcBody("sq_public_range");
  assert.match(b, /غير ملزِم/, "المدى لا يصرّح بعدم إلزامه");
  assert.match(b, /السعر النهائيّ يصدر في عرض سعر معتمد/,
    "المدى لا يوجّه إلى مصدر السعر النهائيّ");
  assert.match(b, /'is_binding', q\.range_is_binding/, "المدى لا يُصرّح بحالة الإلزام");
});

test("★ مدى غير منشور يُقال «غير منشور» لا صفرًا ★", () => {
  const b = funcBody("sq_public_range");
  assert.match(b, /'published', false, 'range_low', null, 'range_high', null/,
    "★ مدى غير منشور يُعاد بأصفار — تُقرأ سعرًا");
  assert.match(b, /هذا ليس سعرًا صفريًّا/, "لا نفي صريح لقراءة الغياب صفرًا");
});

test("المدى قبل الضريبة ويقولها", () => {
  const b = funcBody("sq_public_range");
  assert.match(b, /'vat_rate', q\.vat_rate/, "المدى بلا نسبة ضريبة");
  assert.match(b, /المدى قبل ضريبة القيمة المضافة/, "المدى لا يوضّح موقعه من الضريبة");
});

// ─── (٦) الصفحة والتبويب ────────────────────────────────────────────────────

test("الصفحة تشرح أنّ الأرقام غير مُرسَلة لا مخفيّة", () => {
  assert.match(PAGE, /غير مُرسَلة/, "الصفحة لا توضّح أنّ الحجب بنيويّ");
  assert.match(PAGE, /42501/, "الصفحة لا تذكر جواب المنع الحقيقيّ");
});

test("تبويب التسعير غائب عن مجموعتَي العميل والزائر", () => {
  const nav = read("components/portal/nav.ts");
  const client = nav.match(/client:\s*\[([^\]]*)\]/)[1];
  const lead = nav.match(/lead:\s*\[([^\]]*)\]/)[1];
  assert.ok(!client.includes('"quoting"'), "★ تبويب التسعير معروض للعميل");
  assert.ok(!lead.includes('"quoting"'), "★ تبويب التسعير معروض للزائر");
  // وموجود لمن يبني العروض
  const sales = nav.match(/sales:\s*\[([^\]]*)\]/)[1];
  assert.ok(sales.includes('"quoting"'), "تبويب التسعير غائب عن المبيعات");
});
