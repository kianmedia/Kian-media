// ════════════════════════════════════════════════════════════════════════════
// tests/finance_client_denial.test.js — ★ العميل لا يرى مالًا. إطلاقًا. ★
//
// يفحص المنع في كلّ طريق يستطيع حساب عميل سلوكه:
//   (١) الدوالّ  — كلّ RPC ماليّة تُغلق قبل أن تقرأ صفًّا.
//   (٢) الجداول  — لا سياسة قراءة تربط صفًّا بـclient_id، فالوصول المباشر
//                  لـPostgREST يعيد صفرًا لا صفوفًا.
//   (٣) anon     — لا EXECUTE ولا صلاحية جدول، فالمفتاح العامّ عديم الأثر.
//   (٤) الواجهة  — التبويب غائب عن مجموعتَي client/lead، والشاشة تقول السبب.
//
// «تجربة API مباشرة» في اختبار ثابت تعني: إثبات أنّ السطح الذي يقصده المهاجم
// (جدول أو دالّة أو منحة) لا يملك أصلًا شرطًا يمكن أن يصدق لحساب عميل.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  SQL, TS, read, funcBody, section,
  TABLES, READ_FNS, WRITE_FNS, GATED_READ_FNS, PREDICATES,
} = require("./finance_helpers.js");

const NAV = read("components/portal/nav.ts");
const CENTER = read("components/portal/finance/FinanceCenter.tsx");
const PAGE = read("app/client-portal/finance/page.tsx");

test("(١) كلّ دالّة قراءة مالية تُغلق على العميل قبل قراءة صفّ", () => {
  for (const f of GATED_READ_FNS) {
    const b = funcBody(f);
    assert.match(b, /public\.finops_can_\w+\(\)/, `${f} بلا بوّابة`);
    assert.match(b, /not authorized/, `${f} لا ترفع منعًا صريحًا`);
  }
  // البوّابات الأساسية تستبعد العميل بـis_staff مباشرةً، والمشتقّة تُركَّب فوقها.
  for (const p of ["finops_can_view_finance_sensitive", "finops_can_view_collections",
    "finops_can_record_collection", "finops_can_approve_expense", "finops_can_request"]) {
    assert.match(funcBody(p), /is_staff\(\)/, `${p} لا تستبعد العميل مباشرةً`);
  }
  for (const p of ["finops_can_manage_finance", "finops_can_manage_suppliers",
    "finops_can_export_sensitive", "finops_can_export_collections"]) {
    assert.match(funcBody(p), /public\.finops_can_view_(finance_sensitive|collections)\(\)/,
      `${p} لا تُركَّب فوق بوّابة تشترط is_staff ⇒ قد تتجاوز استبعاد العميل`);
  }
});

test("(١ب) كلّ دالّة كتابة مالية مغلقة على العميل كذلك", () => {
  for (const f of WRITE_FNS) {
    const b = funcBody(f);
    assert.match(b, /not authorized/, `${f} لا ترفع منعًا`);
    // كلّ كتابة تمرّ بمُسنَد من مُسنَدات الموديول (كلّها تشترط is_staff)
    assert.match(b, /finops_can_\w+\(\)|is_owner\(\)/, `${f} بلا مُسنَد يستبعد العميل`);
  }
});

test("(٢) لا سياسة قراءة تربط صفًّا ماليًّا بالعميل — client_id لا يمنح شيئًا", () => {
  const rls = section("-- §4) RLS");
  assert.ok(!/client_id\s*=\s*auth\.uid\(\)/.test(rls),
    "توجد سياسة تمنح العميل صفوفه — الذمم والعقود داخلية ولا تُعرض لعميل");
  assert.ok(!/is_client\(\)/.test(rls) || !/using \(public\.finops_is_client/.test(rls),
    "سياسة تستعمل is_client في شرط سماح");
  // كلّ سياسة قراءة تبدأ بإحدى البوّابتين (أو بملكية صفّ الموظّف)
  const policies = rls.match(/using \([^)]*\)/g) || [];
  assert.ok(policies.length >= 5, "عدد السياسات أقلّ من المتوقّع — هل حُذفت سياسات؟");
  for (const p of policies) {
    assert.match(p, /finops_can_(view_finance_sensitive|manage_finance|approve_expense)\(\)|requested_by = auth\.uid\(\)|uploaded_by = auth\.uid\(\)|request_id|entity_type in/,
      `سياسة بشرط غير معروف قد تسمح لعميل: ${p}`);
  }
});

test("(٢ب) لا جدول ماليّ يُقرأ بلا سياسة، ولا سياسة كتابة يستطيع عميل استغلالها", () => {
  const rls = section("-- §4) RLS");
  for (const t of TABLES) {
    assert.ok(rls.includes(`'${t}'`), `${t} خارج تفعيل RLS ⇒ قابل للقراءة بلا سياسة`);
  }
  assert.match(SQL, /بلا سياسة قراءة — RLS مفعّلة بلا سياسة تحجب الجميع صامتًا/,
    "الـSELF-TEST لا يمنع جدولًا بلا سياسة");
});

test("(٣) anon عديم الأثر: لا EXECUTE على دالّة ولا صلاحية على جدول", () => {
  const grants = section("-- §8) الصلاحيات");
  assert.match(grants, /revoke all on function %s from anon/i);
  assert.match(grants, /revoke all on table public\.%I from anon/i);
  assert.ok(!/to\s+anon\b/i.test(grants), "منحة صريحة لـanon في قسم الصلاحيات");
  assert.match(SQL, /anon يملك EXECUTE على/, "الـSELF-TEST لا يفحص anon للدوالّ");
  assert.match(SQL, /anon يملك صلاحية على/, "الـSELF-TEST لا يفحص anon للجداول");
});

test("(٣ب) لا service_role في كود المتصفّح ولا في الحزمة", () => {
  for (const [name, src] of [["financeOps.ts", TS], ["FinanceCenter.tsx", CENTER],
    ["page.tsx", PAGE]]) {
    assert.ok(!/service_role|SERVICE_ROLE/.test(src), `${name} يذكر service_role`);
  }
  assert.match(SQL, /دالّة في الموديول تتعامل مع بيانات اعتماد/,
    "الـSELF-TEST لا يمنع ظهور بيانات اعتماد في دوالّ الموديول");
});

test("(٤) التبويب غائب عن مجموعتَي client وlead", () => {
  const client = NAV.match(/client:\s*\[([^\]]*)\]/);
  const lead = NAV.match(/lead:\s*\[([^\]]*)\]/);
  assert.ok(client && lead, "تعذّرت قراءة مجموعتَي التنقّل");
  assert.ok(!client[1].includes("finance_ops"), "تبويب المالية ظاهر للعميل");
  assert.ok(!lead[1].includes("finance_ops"), "تبويب المالية ظاهر للزائر المحتمل");
  assert.match(NAV, /finance_ops:\s*\{\s*href: "\/client-portal\/finance"/,
    "التبويب غير مسجَّل أصلًا");
});

test("(٤ب) الشاشة تقول للعميل السبب ولا تعرض تبويبات فارغة", () => {
  assert.match(CENTER, /a\.is_client/, "الشاشة لا تفرّق حساب العميل");
  assert.match(CENTER, /if \(a\.is_client\)[\s\S]{0,200}Denied/,
    "حساب العميل لا يُوجَّه إلى شاشة المنع");
  assert.match(funcBody("finops_access"), /المركز المالي داخليّ بالكامل ولا يُتاح لحسابات العملاء/,
    "الخادم لا يعطي العميل رسالة صريحة");
  // ولا يُعرض له رقم واحد: مِجَسّ الوصول لا يحمل مبالغ
  const access = funcBody("finops_access");
  assert.ok(!/amount|gross|profit_/.test(access.replace(/can_view_profit/g, "")),
    "مِجَسّ الوصول يحمل أرقامًا مالية");
});

test("العميل لا يصل إلى الربحية بأيّ طريق — الطبقات الثلاث معًا", () => {
  // الدالّة
  assert.match(funcBody("finops_profitability"), /finops_can_view_finance_sensitive\(\)/);
  // الجداول
  const rls = section("-- §4) RLS");
  assert.match(rls, /fin_revenue/, "جدول الإيراد خارج السياسات");
  // المحرّك الداخليّ غير ممنوح لأحد
  const grants = section("-- §8) الصلاحيات");
  const internal = grants.slice(grants.indexOf("(ب)"));
  assert.ok(internal.includes("public.finops_profit_core(uuid,date,date)"),
    "محرّك الربحية ليس في كتلة السحب — قد يُستدعى مباشرةً");
});

test("مسار الصفحة نفسه لا يفترض أنّ العميل لن يفتحه", () => {
  assert.match(PAGE, /رابط مباشر|برابط/, "الصفحة لا توثّق سلوك الفتح المباشر");
  // لا حراسة في الواجهة تُقدَّم على أنّها تفويض
  assert.ok(!/account_type\s*===\s*"client"/.test(CENTER),
    "الشاشة تقرّر الصلاحية من نوع الحساب في المتصفّح بدل سؤال الخادم");
});

test("قائمة الوظائف المالية العامّة لم تتوسّع بلا اختبار", () => {
  const called = [...TS.matchAll(/prpc<[^>]*>\("(\w+)"/g)].map((m) => m[1]);
  const known = new Set([...READ_FNS, ...WRITE_FNS]);
  for (const c of called) {
    assert.ok(known.has(c), `الواجهة تستدعي ${c} وهي خارج مصفوفة الاختبارات`);
  }
  for (const p of PREDICATES) {
    assert.ok(!called.includes(p),
      `الواجهة تستدعي المُسنَد ${p} مباشرةً — الصلاحية تُقرَّر في الخادم لا تُستعلَم قطعةً قطعة`);
  }
});
