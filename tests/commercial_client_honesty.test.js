// ════════════════════════════════════════════════════════════════════════════
// tests/commercial_client_honesty.test.js
//
// ★★ اختبار واحد بجملة واحدة: لا تعرض الشاشة رقمًا لا تعرفه ★★
//
// العميل الذي يقرأ «٠ وحدة» بينما الحقيقة «الترحيلة لم تُطبَّق» أو «لا اشتراك»
// أو «لا وحدات مُسنَدة» أو «لا حركة بعد» سيتّصل يشكو خطأ فوترة — وسيكون محقًّا،
// لأنّ الشاشة كذبت عليه. هذا الملفّ يمنع الكذبة بأربعة أقفال:
//   (١) نوع البيانات: balances من نوع `CsubUnitBalance[] | null`.
//   (٢) لا قيمة افتراضية على أيّ حقل رصيد (`?? 0` / `|| 0`).
//   (٣) خمس شاشات مختلفة لخمس حقائق مختلفة، ولكلّ واحدة نصّها.
//   (٤) الخادم نفسه يعيد null ويصرّح بالسبب حين لا يعرف.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  SQL17, TS, ATOMS, CREDITS, FORM, PAGE, funcBody,
} = require("./commercial_client_helpers.js");

test("(١) النوع نفسه يمنع الرقم المجهول", () => {
  assert.match(TS, /balances:\s*CsubUnitBalance\[\] \| null/,
    "balances ليس nullable — سيُجبَر مستدعٍ على اختراع رقم");
  assert.match(TS, /balances_reason\?:\s*"no_units_on_subscription" \| null/,
    "لا سبب صريح لغياب الأرصدة");
  assert.match(TS, /has_entries:\s*boolean/, "لا تمييز لوحدة بلا حركة");
  // ودالّة التنسيق لا تقبل null فلا يمكن أن تُنتج «٠» عن مجهول.
  assert.match(TS, /export function csubUnits\(n: number/,
    "csubUnits تقبل null/undefined — وستطبع صفرًا عن رقم مجهول");
  assert.match(TS, /if \(!Number\.isFinite\(v\)\) return "—"/,
    "csubUnits لا تُظهر «—» للرقم غير الصالح");
});

test("(٢) ★ لا قيمة افتراضية صفرية على أيّ حقل رصيد ★", () => {
  const fields = ["available", "allocated", "used", "reserved", "expired", "remaining"];
  for (const [name, src] of [["commercial.ts", TS], ["ClientCredits", CREDITS],
                             ["ProductionRequestForm", FORM], ["CsubAtoms", ATOMS]]) {
    for (const f of fields) {
      assert.ok(!new RegExp(`${f}\\s*(\\?\\?|\\|\\|)\\s*0`).test(src),
        `${name}: قيمة افتراضية صفرية على ${f} — هذا هو الصفر الكاذب`);
      assert.ok(!new RegExp(`\\.${f}\\s*(\\?\\?|\\|\\|)\\s*0`).test(src),
        `${name}: قيمة افتراضية صفرية على .${f}`);
    }
    assert.ok(!/balances\s*(\?\?|\|\|)\s*\[/.test(src.replace(/balances \?\? \[\]/, "SAFE")) ||
              /const units = balances \?\? \[\]/.test(src),
      `${name}: كائن أرصدة مُختلَق عند الغياب`);
  }
  // الاستثناء الوحيد المسموح: قائمة فارغة للعرض في النموذج، وهي **لا تُنتج رقمًا**
  // لأنّ النموذج يشتقّ التقدير من الوحدة المختارة وحدها ويشترط has_entries.
  assert.match(FORM, /const units = balances \?\? \[\]/, "النموذج لا يتعامل مع غياب الوحدات");
  assert.match(FORM, /!selected\.has_entries/, "النموذج يقدّر على وحدة بلا حركة");
});

test("(٣) خمس حقائق، خمس شاشات — لا طيّ في «لا توجد بيانات»", () => {
  for (const c of ["MigrationPending", "Denied", "ErrorBox", "UnknownBalance", "Empty"]) {
    assert.ok(ATOMS.includes(`export function ${c}`), `الشاشة ${c} غير موجودة`);
  }
  const sv = ATOMS.slice(ATOMS.indexOf("export function StateView"));
  for (const s of ["needs_migration", "denied", "error"]) {
    assert.ok(sv.includes(`"${s}"`), `StateView لا تفرّق الحالة ${s}`);
  }
  const mig = ATOMS.slice(ATOMS.indexOf("export function MigrationPending"),
                          ATOMS.indexOf("export function Denied"));
  assert.match(mig, /رصيدك صفر/, "شاشة الترحيلة لا تنفي أنّ الرصيد صفر");
  assert.match(TS, /ولا يعني أنّ رصيدك صفر/, "رسالة الترحيلة لا تنفي الصفر");
  const unk = ATOMS.slice(ATOMS.indexOf("export function UnknownBalance"));
  assert.match(unk, /لا نملك رقمًا نعرضه|سيكون معلومة خاطئة/,
    "شاشة الرقم المجهول لا تشرح سبب غياب الرقم");
});

test("(٣ب) الحقائق الأربع في الواجهة بنصوص مختلفة", () => {
  assert.match(CREDITS, /!d\.has_client_profile/, "الواجهة لا تفرّق «لا ملفّ عميل»");
  assert.match(CREDITS, /لا يوجد ملفّ عميل مرتبط بحسابك/, "لا نصّ لحالة «لا ملفّ عميل»");
  assert.match(CREDITS, /!d\.has_subscription/, "الواجهة لا تفرّق «لا اشتراك»");
  assert.match(CREDITS, /لا يوجد اشتراك إنتاج مفعّل/, "لا نصّ لحالة «لا اشتراك»");
  assert.match(CREDITS, /balances === null \|\| balances\.length === 0/,
    "الواجهة لا تفرّق «لا وحدات مُسنَدة»");
  assert.match(CREDITS, /لم تُسنَد وحدات إنتاج/, "لا نصّ لحالة «لا وحدات»");
  assert.match(CREDITS, /!b\.has_entries/, "الواجهة لا تفرّق «وحدة بلا حركة»");
  assert.match(CREDITS, /لم تُسجَّل أيّ حركة على هذه الوحدة بعد/, "لا نصّ لحالة «لا حركة»");
  assert.match(TS, /لا يعني هذا أنّ رصيدك صفر/, "نصّ «لا اشتراك» لا ينفي الصفر");
  assert.match(TS, /وليس رصيدًا صفرًا/, "نصّ «لا وحدات» لا ينفي الصفر");
});

test("(٤) الخادم يعيد null ويصرّح بالسبب حين لا يعرف", () => {
  const body = funcBody("csub_my_credits_page", SQL17);
  assert.match(body, /'no_client_profile'[\s\S]{0,200}'balances', null/,
    "حالة «لا ملفّ عميل» تعيد أرصدة");
  assert.match(body, /'no_active_subscription'[\s\S]{0,200}'balances', null/,
    "حالة «لا اشتراك» تعيد أرصدة");
  assert.match(body, /'balances', case when jsonb_array_length\(coalesce\(v_bal, '\[\]'::jsonb\)\) > 0\s*\n?\s*then v_bal else null end/,
    "الخادم يعيد مصفوفة فارغة بدل null عند غياب الوحدات");
  assert.match(body, /'balances_reason'[\s\S]{0,140}no_units_on_subscription/,
    "لا سبب صريح لغياب الأرصدة");
  assert.match(body, /'has_entries', \(b\.entries > 0\)/,
    "الوحدة بلا تمييز بين «لا حركة» و«صفر متاح»");
  assert.match(SQL17, /لا يفرّق الحالة % عن رصيد صفر/, "الـSELF-TEST لا يحرس هذه الفروق");
});

test("(٥) التجاوز يُقال كتجاوز — لا يُقصّ إلى صفر", () => {
  const body = funcBody("csub_my_credits_page", SQL17);
  assert.match(body, /'is_overage', \(b\.available < 0\)/, "لا علم للتجاوز على مستوى الوحدة");
  assert.ok(!/Math\.max\(0,\s*Number\(b\.available\)/.test(CREDITS),
    "الواجهة تقصّ المتاح السالب إلى صفر — فتُخفي تجاوزًا معتمَدًا");
  assert.match(CREDITS, /b\.is_overage/, "الواجهة لا تعرض حالة التجاوز");
  assert.match(CREDITS, /المتاح سالب/, "الواجهة لا تشرح المتاح السالب");
});

test("(٦) النموذج لا يقدّر تجاوزًا على رصيد مجهول", () => {
  assert.match(FORM, /if \(!selected \|\| !selected\.has_entries \|\| !creditsValid\) return null/,
    "النموذج يحسب تقديرًا على وحدة بلا حركة");
  assert.match(FORM, /لا يمكن تقدير التجاوز|رصيدك المتاح عليها غير معروف/,
    "النموذج لا يقول إنّ التقدير غير ممكن");
  assert.ok(!/selected\?\.available\s*(\?\?|\|\|)\s*0/.test(FORM), "النموذج يفترض متاحًا صفرًا");
});

test("(٧) الصفحة تصرّح بحالتها قبل تطبيق الـSQL", () => {
  assert.match(TS, /commercial_subscriptions_RUNME\.sql/,
    "رسالة الترحيلة لا تسمّي الملفّ الذي يجب تشغيله");
  assert.match(PAGE, /بانتظار تفعيل قاعدة البيانات/, "الصفحة لا توثّق حالة ما قبل التفعيل");
  assert.match(PAGE, /ولا تعرض رقمًا واحدًا/, "الصفحة لا تصرّح بأنّها لا تعرض أرقامًا قبل التفعيل");
});

test("(٨) التصنيف يفرّق المنع عن الترحيلة عن الشبكة — لا خلط", () => {
  assert.match(TS, /pgIsMigrationPending/, "لا استعمال للمصنّف الموحَّد");
  const toState = TS.slice(TS.indexOf("function toState"), TS.indexOf("export function csubReasonAr"));
  assert.ok(toState.includes("needs_migration") && toState.includes("denied"), "حالتان ناقصتان");
  assert.match(toState, /permission_denied/, "المنع غير مُصنَّف");
  const denied = TS.slice(TS.indexOf("CSUB_DENIED_AR"), TS.indexOf("export type CsubState"));
  assert.ok(!/ترحيل/.test(denied), "رسالة المنع تتحدّث عن الترحيلة");
  const mig = TS.slice(TS.indexOf("CSUB_MIGRATION_AR"), TS.indexOf("CSUB_DENIED_AR"));
  assert.match(mig, /ليس خطأً في حسابك/, "رسالة الترحيلة لا تنفي أن يكون السبب صلاحية");
});

test("(٩) RTL والجوّال: اتّجاه صريح ومساحة لمس كافية", () => {
  assert.match(ATOMS, /min-h-\[44px\]/, "لا مساحة لمس ≥44px");
  for (const [name, src] of [["CsubAtoms", ATOMS], ["ClientCredits", CREDITS],
                             ["ProductionRequestForm", FORM]]) {
    assert.ok(src.includes('dir="rtl"'), `${name} بلا اتّجاه RTL صريح`);
  }
  assert.match(ATOMS, /overflow-x-auto/, "لا حاوية تمرير للجداول");
  assert.match(CREDITS, /ScrollBox/, "كشف الحركات بلا حاوية تمرير");
  assert.match(CREDITS, /min-w-\[/, "كشف الحركات بلا عرض أدنى — سينضغط على الجوّال");
});

test("(١٠) سطح العميل بالوحدات لا بالمال — ولا ضريبة تُطوى", () => {
  for (const [name, src] of [["ClientCredits", CREDITS], ["ProductionRequestForm", FORM]]) {
    assert.ok(!/SAR|ريال/.test(src),
      `${name} يعرض مالًا — سطح رصيد العميل بالوحدات لا بالمال`);
  }
  assert.match(TS, /الرصيد بالوحدات لا بالمال/, "الطبقة لا توثّق أنّ القياس بالوحدات");
  // والخادم لا يرسل مالًا أصلًا إلى هذه الشاشة.
  const body = funcBody("csub_my_credits_page", SQL17);
  for (const f of ["price_net", "vat_amount", "price_gross", "currency"]) {
    assert.ok(!body.includes(f), `سطح العميل يرسل الحقل الماليّ ${f}`);
  }
});

test("(١١) نصّ التجديد التلقائيّ يُعرض كما يرسله الخادم — لا وعد بأتمتة", () => {
  assert.match(TS, /auto_renew_note/, "لا حقل لنصّ التجديد");
  assert.match(TS, /معلومة تعاقدية لا آلية/, "الطبقة لا توثّق أنّ التجديد ليس آليًّا");
  assert.match(CREDITS, /auto_renew_note/, "الواجهة لا تعرض نصّ الخادم");
  assert.ok(!/سيتمّ التجديد تلقائيًّا|سيُجدَّد تلقائيًّا/.test(CREDITS),
    "الواجهة تعد بتجديد آليّ لا وجود له");
});
