// ════════════════════════════════════════════════════════════════════════════
// tests/finance_ui_contract.test.js — عقد الواجهة للمركز المالي.
//
// كشف الميزة (needs_migration ≠ denied) · العقد مع القاعدة اسمًا اسمًا ·
// عربيّ/RTL/Mobile · ولا صلاحية تُقرَّر في المتصفّح.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  SQL, TS, read, READ_FNS, WRITE_FNS, PUBLIC_FNS, PREDICATES,
} = require("./finance_helpers.js");

const ATOMS = read("components/portal/finance/FinAtoms.tsx");
const CENTER = read("components/portal/finance/FinanceCenter.tsx");
const FORMS = read("components/portal/finance/FinForms.tsx");
const MINE = read("components/portal/finance/FinMyRequests.tsx");
const PAGE = read("app/(portal)/client-portal/finance/page.tsx");
const ERR = read("app/(portal)/client-portal/finance/error.tsx");
const UI = [ATOMS, CENTER, FORMS, MINE, PAGE].join("\n");

test("كشف الميزة: needs_migration حالة مستقلّة عن denied — لا خلط", () => {
  assert.match(TS, /state:\s*"needs_migration"/, "لا حالة ترحيلة معلّقة");
  assert.match(TS, /state:\s*"denied"/, "لا حالة منع");
  assert.match(TS, /pgIsMigrationPending\(d\)/, "لا تصنيف عبر pgerror");
  assert.match(TS, /d\.kind === "permission_denied"[\s\S]{0,140}state:\s*"denied"/,
    "المنع يُصنَّف خطأً");
  const iMig = TS.indexOf('return { state: "needs_migration"');
  const iDen = TS.indexOf('return { state: "denied"');
  const iErr = TS.indexOf('return { state: "error", message: pgMessageAr');
  assert.ok(iMig > 0 && iDen > iMig && iErr > iDen, "ترتيب تصنيف الحالات خاطئ");
  assert.match(TS, /finance_profitability_RUNME\.sql/,
    "رسالة الترحيلة لا تسمّي الملفّ الذي يجب تشغيله");
});

test("الواجهة تعرض الحالات الثلاث بأشكال مختلفة — لا شاشة فارغة", () => {
  assert.match(ATOMS, /function MigrationPending/, "لا شاشة «بانتظار تفعيل قاعدة البيانات»");
  assert.match(ATOMS, /الميزة بانتظار تفعيل قاعدة البيانات/, "النصّ المطلوب غير موجود");
  assert.match(ATOMS, /function Denied/, "لا شاشة منع");
  assert.match(ATOMS, /function ErrorBox/, "لا شاشة خطأ");
  assert.match(ATOMS, /st\.state === "needs_migration"[\s\S]{0,80}MigrationPending/,
    "الموزّع لا يربط الحالة بالشاشة");
  assert.match(ATOMS, /st\.state === "denied"[\s\S]{0,60}Denied/, "الموزّع لا يعرض المنع");
  const mig = ATOMS.slice(ATOMS.indexOf("function MigrationPending"), ATOMS.indexOf("function Denied"));
  assert.match(mig, /ليست مشكلة في حسابك/, "شاشة الترحيلة لا تنفي مشكلة الصلاحية");
  const den = ATOMS.slice(ATOMS.indexOf("function Denied"), ATOMS.indexOf("function ErrorBox"));
  assert.ok(!/ترحيل|RUNME/.test(den), "شاشة المنع تلمّح إلى ترحيلة ناقصة");
});

test("الحجب يُقال صراحةً — لا أصفار تبدو كحقيقة", () => {
  assert.match(ATOMS, /function Masked/, "لا بطاقة «محجوب»");
  assert.match(CENTER, /d\.profit_visible[\s\S]{0,200}Masked/,
    "اللوحة لا تفرّق بين ربحية محجوبة وربحية صفرية");
  assert.match(CENTER, /profit_message/, "سبب الحجب من الخادم غير معروض");
});

test("العقد مع القاعدة: كلّ دالّة تستدعيها الواجهة موجودة وممنوحة، والعكس", () => {
  const called = [...TS.matchAll(/prpc<[^>]*>\("(\w+)"/g)].map((m) => m[1]);
  assert.ok(called.length >= 40, `عدد الاستدعاءات ${called.length} أقلّ من المتوقّع`);
  for (const fn of called) {
    assert.match(SQL, new RegExp(`create or replace function public\\.${fn}\\s*\\(`, "i"),
      `الواجهة تستدعي ${fn} وهي غير معرَّفة في الحزمة`);
    assert.ok(SQL.includes(`'public.${fn}(`), `${fn} غير ممنوحة لـauthenticated`);
  }
  for (const fn of PUBLIC_FNS) {
    assert.ok(called.includes(fn), `${fn} معرَّفة وممنوحة لكنّها بلا مستهلك — سطح ميّت`);
  }
});

test("العقد مع القاعدة: أسماء المعاملات مطابقة (p_payload/p_filters/…)", () => {
  const pairs = [...TS.matchAll(/prpc<[^>]*>\("(\w+)",\s*\{([^}]*)\}/g)];
  assert.ok(pairs.length >= 40, "تعذّرت قراءة المعاملات");
  for (const [, fn, args] of pairs) {
    const names = [...args.matchAll(/\b(p_\w+)\s*:/g)].map((m) => m[1]);
    const decl = SQL.match(new RegExp(`create or replace function public\\.${fn}\\s*\\(([^)]*)\\)`, "i"));
    assert.ok(decl, `تعذّر إيجاد تصريح ${fn}`);
    for (const nme of names) {
      assert.ok(decl[1].includes(nme), `${fn}: المعامل ${nme} غير موجود في التصريح`);
    }
  }
});

test("لا صلاحية تُقرَّر في المتصفّح — الواجهة تسأل الخادم ولا تشتقّ", () => {
  for (const p of PREDICATES) {
    assert.ok(!UI.includes(`${p}(`), `الواجهة تستدعي المُسنَد ${p} مباشرةً`);
  }
  // لا اشتقاق من نوع الحساب أو الدور في المتصفّح
  assert.ok(!/staff_role\s*===|account_type\s*===/.test(UI),
    "الواجهة تقرّر الصلاحية من الملفّ الشخصيّ بدل سؤال finops_access");
  assert.match(CENTER, /finAccess\(\)/, "الشاشة لا تسأل الخادم عن قدرات المستخدم");
  // وإخفاء الزرّ ليس حماية: الحفظ يُرسَل والخادم يردّ
  assert.match(FORMS, /لا يفحص صلاحية ولا يخفي زرًّا بوصفه حماية/,
    "النموذج لا يوثّق أنّ الإخفاء ليس تفويضًا");
});

test("عربيّ · RTL · Mobile-first في كلّ ملفّ واجهة", () => {
  for (const [name, src] of [["FinAtoms", ATOMS], ["FinanceCenter", CENTER],
    ["FinForms", FORMS], ["FinMyRequests", MINE]]) {
    assert.match(src, /[؀-ۿ]/, `${name} بلا نصّ عربيّ`);
    assert.match(src, /dir="rtl"/, `${name} بلا اتّجاه RTL صريح في جداوله/حواراته`);
  }
  assert.match(ATOMS, /min-h-\[44px\]/, "مساحة اللمس أقلّ من 44px");
  assert.match(ATOMS, /overflow-x-auto/, "الجداول لا تمرّر أفقيًّا على الجوّال");
  assert.match(FORMS, /items-end sm:items-center/, "الحوار ليس ورقة سفلية على الجوّال");
  assert.match(CENTER, /grid-cols-2 md:grid-cols-4/, "البطاقات لا تتكيّف مع الشاشة الصغيرة");
});

test("لا دوران أبديّ: مهلة + تسلسل طلبات + حارس Unmount", () => {
  assert.match(ATOMS, /timeoutMs = 20000/, "لا مهلة للطلب");
  assert.match(ATOMS, /my !== seq\.current/, "لا تسلسل — طلب قديم قد يغلب الأحدث");
  assert.match(ATOMS, /mounted\.current/, "لا حارس Unmount");
  assert.match(ATOMS, /تأخّر الطلب أكثر من المتوقّع/, "المهلة تُعرض كخطأ غامض");
});

test("رسائل الخادم تُنقَل كما هي ولا يُعاد تأليفها في الواجهة", () => {
  assert.match(TS, /String\(data\.message \?\? finReasonAr/,
    "الواجهة لا تُفضّل رسالة الخادم على ترجمتها المحلّية");
  // ولكلّ سبب عمل في الحزمة ترجمة عربية
  const reasons = new Set([...SQL.matchAll(/'reason'\s*,\s*'(\w+)'/g)].map((m) => m[1]));
  assert.ok(reasons.size >= 8, `عدد أسباب العمل ${reasons.size} أقلّ من المتوقّع`);
  for (const r of reasons) {
    assert.ok(TS.includes(`case "${r}":`), `السبب ${r} بلا ترجمة عربية في financeOps.ts`);
  }
});

test("الصفحة وحدّ الخطأ: عربيّ، وبلا تسريب أرقام مالية في السجلّ", () => {
  assert.match(PAGE, /FinanceCenter/, "الصفحة لا تركّب المركز");
  assert.match(PAGE, /المركز المالي/, "عنوان الصفحة غير عربيّ");
  assert.match(ERR, /تعذّر تحميل المركز المالي/, "لا حدّ خطأ محلّيّ عربيّ");
  assert.match(ERR, /process\.env\.NODE_ENV !== "production"/,
    "حدّ الخطأ يطبع تفاصيل في الإنتاج");
});

test("التصدير من الواجهة: مجموعات الخادم نفسها لا قائمة موازية", () => {
  const uiSets = [...CENTER.matchAll(/key: "(\w+)", ar:/g)].map((m) => m[1]);
  const serverSets = funcExportDatasets();
  for (const d of uiSets.filter((k) => serverSets.includes(k))) {
    assert.ok(serverSets.includes(d), `مجموعة تصدير ${d} غير معروفة للخادم`);
  }
  const COLLECTIONS_UI = read("components/portal/finance/FinCollections.tsx");
  for (const d of serverSets) {
    assert.ok(CENTER.includes(`"${d}"`) || COLLECTIONS_UI.includes(`"${d}"`),
      `مجموعة ${d} معرَّفة في الخادم وغائبة عن الواجهة`);
  }
  assert.match(TS, /finExportCsv/, "لا بناء CSV");
  assert.match(CENTER, /URL\.createObjectURL/, "لا تنزيل فعليّ للملفّ");
});

/** مجموعات التصدير المسموحة كما كتبها الخادم. */
function funcExportDatasets() {
  const m = SQL.match(/p_dataset not in\s*\n?\s*\(([^)]*)\)/);
  assert.ok(m, "تعذّرت قراءة قائمة مجموعات التصدير من الخادم");
  return m[1].split(",").map((s) => s.trim().replace(/'/g, ""));
}

test("★ كلّ خيار في النماذج مقبول في قيد الجدول ★ — لا 23514 عند أوّل حفظ", () => {
  // خريطة: مواصفة النموذج ← الحقل ← الجدول ← العمود. أيّ خيار خارج قيد CHECK
  // يعني خطأ قاعدة بيانات في وجه المستخدم بعد ملء النموذج كاملًا.
  const MAP = [
    ["cost_center", "kind", "fin_cost_centers", "kind"],
    ["category", "cost_nature", "fin_expense_categories", "cost_nature"],
    ["supplier", "supplier_type", "fin_suppliers", "supplier_type"],
    ["budget", "scope", "fin_budgets", "scope"],
    ["budget", "status", "fin_budgets", "status"],
    ["cost", "cost_type", "fin_costs", "cost_type"],
    ["cost", "commitment", "fin_costs", "commitment"],
    ["contract", "status", "fin_contracts", "status"],
    ["revenue", "revenue_type", "fin_revenue", "revenue_type"],
    ["revenue", "status", "fin_revenue", "status"],
    ["retainer", "status", "fin_retainers", "status"],
    ["receivable", "status", "fin_receivables", "status"],
    ["collection", "method", "fin_collections", "method"],
    ["milestone", "status", "fin_payment_milestones", "status"],
    ["threshold", "scope", "fin_approval_thresholds", "scope"],
    ["threshold", "required_role", "fin_approval_thresholds", "required_role"],
  ];
  for (const [spec, field, table, column] of MAP) {
    const allowed = checkValues(table, column);
    const options = specOptions(spec, field);
    assert.ok(options.length > 0, `لا خيارات للحقل ${field} في نموذج ${spec}`);
    for (const o of options) {
      assert.ok(allowed.includes(o),
        `نموذج ${spec}: الخيار «${o}» للحقل ${field} مرفوض في قيد ${table}.${column} (المسموح: ${allowed.join("|")})`);
    }
  }
});

/** قيم قيد CHECK لعمود، كما كُتبت في تعريف الجدول. */
function checkValues(table, column) {
  const { tableDef } = require("./finance_helpers.js");
  const def = tableDef(table);
  const re = new RegExp(`check \\(${column} in \\(([^)]*)\\)\\)`);
  const m = def.match(re);
  assert.ok(m, `تعذّر إيجاد قيد CHECK للعمود ${table}.${column}`);
  return m[1].split(",").map((s) => s.trim().replace(/'/g, ""));
}

/** قيم خيارات حقل داخل مواصفة نموذج. */
function specOptions(spec, field) {
  const i = FORMS.indexOf(`  ${spec}: {`);
  assert.ok(i > 0, `تعذّر إيجاد مواصفة النموذج ${spec}`);
  const block = FORMS.slice(i, FORMS.indexOf("\n  },", i));
  const j = block.indexOf(`{ key: "${field}"`);
  assert.ok(j > 0, `الحقل ${field} غير موجود في نموذج ${spec}`);
  const tail = block.slice(j, block.indexOf("] }", j));
  return [...tail.matchAll(/\{ value: "([^"]*)"/g)].map((m) => m[1]);
}

test("شاشة الموظّف مركَّبة داخل المركز وخارجه معًا بلا ازدواج منطق", () => {
  assert.match(CENTER, /import FinMyRequests from "\.\/FinMyRequests"/,
    "المركز لا يعيد استعمال شاشة الموظّف");
  assert.ok(!/finMyRequests\(/.test(CENTER),
    "المركز يكرّر استدعاء قائمة الموظّف بدل تركيب الشاشة");
});
