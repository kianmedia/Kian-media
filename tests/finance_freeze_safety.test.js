// ════════════════════════════════════════════════════════════════════════════
// tests/finance_freeze_safety.test.js — الموديول المالي لا يلمس المنصّة المجمَّدة.
//
// اختبار التجميد العامّ (project_platform_freeze.test.js) يفشل بالملفّ. هذا
// الملفّ يفحص الطبقة التي لا يراها ذاك: **قاعدة البيانات**. موديول ماليّ يكتب
// في projects أو يقرأ ماليات المنصّة يربط سطحًا حيًّا بسطح مُقفَل، ويكسر التجميد
// بلا أن يتغيّر ملفّ واحد من ملفّاته.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const { SQL, TS, read, funcBody, ROLLBACK } = require("./finance_helpers.js");

const FREEZE = require("./fixtures/project_platform_freeze.json");
const CENTER = read("components/portal/finance/FinanceCenter.tsx");
const FORMS = read("components/portal/finance/FinForms.tsx");
const MINE = read("components/portal/finance/FinMyRequests.tsx");

const PLATFORM_TABLES = [
  "projects", "project_core", "deliverables", "deliverable_internal",
  "project_transition_requests",
];

test("الحزمة لا تكتب في أيّ جدول من منصّة المشاريع", () => {
  for (const t of PLATFORM_TABLES) {
    for (const verb of [`insert into public.${t}`, `update public.${t}`,
      `delete from public.${t}`]) {
      assert.ok(!SQL.toLowerCase().includes(verb),
        `الحزمة تنفّذ «${verb}» — المنصّة مجمَّدة`);
    }
  }
  // ولا على العائلة كلّها project_* / large_project_*
  assert.ok(!/\b(insert into|update|delete from)\s+public\.(large_)?project_\w+/i
    .test(SQL.replace(/'[^']*'/g, "")), "الحزمة تكتب في كائن من عائلة المنصّة");
  // وحارس داخل الـSELF-TEST يمسح كلّ دوالّ finops% ويرفع لو ظهرت كتابة لاحقًا
  assert.match(SQL, /دالّة تكتب في منصّة المشاريع المجمَّدة/,
    "الـSELF-TEST بلا حارس تجميد — كتابة مستقبلية ستمرّ صامتة");
});

test("الحزمة لا تقرأ ماليات المنصّة — لا اعتماد على سطح مُقفَل", () => {
  for (const t of ["project_costs", "project_expenses", "project_phase_budgets",
    "project_revenue_schedule", "project_finance_settings"]) {
    assert.ok(!new RegExp(`from public\\.${t}\\b`).test(SQL),
      `الحزمة تقرأ ${t} — ربط الموديول بماليات المنصّة المجمَّدة`);
  }
});

test("الاتّصال الوحيد المسموح: project_id اختياريّ + قراءة الاسم للعرض", () => {
  // المفتاح الخارجيّ اختياريّ ومكتشَف ولا يمنع حذف مشروع
  assert.match(SQL, /if to_regclass\('public\.projects'\) is null/,
    "الربط بالمشروع ليس مكتشَفًا — ستُفرَض تبعية على المنصّة");
  assert.match(SQL, /references public\.%I?\(?id\)? on delete set null|references public\.projects\(id\) on delete set null/,
    "المفتاح الخارجيّ ليس on delete set null");
  // وقراءة الاسم وحدها، من عمود يُكتشف لا يُخمَّن
  const label = funcBody("finops_project_label");
  assert.match(label, /select coalesce\(nullif\(btrim\(p\.%I\)[\s\S]{0,20}\), p\.id::text\) from public\.projects p where p\.id = \$1/,
    "قراءة اسم المشروع ليست قراءة عمود واحد من صفّ واحد");
  assert.match(label, /information_schema\.columns/,
    "اسم العمود مُخمَّن لا مقروء — التخمين سبق أن أنتج 42703 وأسقط عملية");
  assert.ok(!/update|insert|delete/i.test(label), "دالّة اسم المشروع تكتب");
  assert.match(label, /exception when others then v := null/,
    "فشل قراءة الاسم يُسقط الطلب بدل أن يعود null بصدق");
});

test("لا ملفّ من ملفّات التجميد ضمن ملفّات هذا الموديول", () => {
  const mine = [
    "lib/portal/financeOps.ts",
    "components/portal/finance/FinAtoms.tsx",
    "components/portal/finance/FinanceCenter.tsx",
    "components/portal/finance/FinForms.tsx",
    "components/portal/finance/FinMyRequests.tsx",
    "app/(portal)/client-portal/finance/page.tsx",
    "app/(portal)/client-portal/finance/error.tsx",
    "docs/finance_profitability_RUNME.sql",
    "docs/finance_profitability_PREFLIGHT.sql",
    "docs/finance_profitability_POSTCHECK.sql",
    "docs/finance_profitability_ROLLBACK.sql",
  ];
  for (const f of mine) {
    for (const frozen of FREEZE.paths) {
      assert.ok(!(f === frozen || f.startsWith(`${frozen}/`)),
        `ملفّ الموديول ${f} يقع داخل مسار مجمَّد (${frozen})`);
    }
  }
});

test("الواجهة تعامل المشروع كمعرّف للعرض لا ككائن تُعدّله", () => {
  for (const [name, src] of [["FinanceCenter", CENTER], ["FinForms", FORMS],
    ["FinMyRequests", MINE], ["financeOps", TS]]) {
    for (const forbidden of ["projectCore", "large-projects", "@/lib/portal/projects",
      "transitions", "deliverables"]) {
      assert.ok(!src.includes(forbidden), `${name} يستورد سطح المنصّة (${forbidden})`);
    }
  }
  // الحقل في النماذج معرّف نصّيّ اختياريّ لا منتقٍ يقرأ المنصّة
  assert.match(FORMS, /key: "project_id", label: "معرّف المشروع \(اختياريّ\)"/,
    "حقل المشروع ليس اختياريًّا صريحًا");
  assert.match(FORMS, /لا يُعدَّل المشروع ولا تُقرأ ماليات المنصّة/,
    "النموذج لا يوثّق حدود العلاقة بالمشروع");
});

test("التراجع لا يمسّ المنصّة ويقول ذلك صراحةً", () => {
  assert.match(ROLLBACK, /منصّة المشاريع بكاملها/, "ROLLBACK لا يوضّح أنّ المنصّة لا تتأثّر");
  for (const t of PLATFORM_TABLES) {
    assert.ok(!new RegExp(`drop table[^;]*${t}`, "i").test(ROLLBACK),
      `ROLLBACK يُسقط جدول المنصّة ${t}`);
  }
});

test("لا تصادم أسماء مع المواديل القائمة (comms_ · prodops_ · ops_)", () => {
  const created = [...SQL.matchAll(/create (?:or replace function|table if not exists) public\.(\w+)/g)]
    .map((m) => m[1]);
  assert.ok(created.length >= 60, `عدد الكائنات ${created.length} أقلّ من المتوقّع`);
  for (const name of created) {
    assert.ok(/^(fin_|finops_)/.test(name),
      `الكائن ${name} خارج بادئتَي الموديول — قد يصطدم بموديول قائم`);
  }
});
