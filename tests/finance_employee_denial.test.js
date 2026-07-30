// ════════════════════════════════════════════════════════════════════════════
// tests/finance_employee_denial.test.js — ★ الموظّف يرى طلبه هو، ولا شيء غيره ★
//
// الموظّف داخل النظام (is_staff = true) فهو يجتاز البوّابة الأولى التي تمنع
// العميل. ولهذا المنع هنا **أدقّ** وأخطر: يجب أن يُثبَت أنّه لا يرى ربحية الشركة
// ولا تكاليف زملائه ولا هوامش، لا في دالّة ولا في جدول ولا في قائمة مراجع.
//
// كلّ طريق يفحصه هذا الملفّ:
//   (١) الدوالّ المالية العامّة  → تُغلق عليه (can_view يشترط مفتاحًا/دور مالية).
//   (٢) دالّته هو                → مقيّدة بـauth.uid() داخل الاستعلام لا بفلتر.
//   (٣) الجداول مباشرةً          → RLS تعيد صفرًا عدا صفوفه.
//   (٤) المراجع                  → لا مبالغ ولا ميزانيات في request_lookups.
//   (٥) الواجهة                  → سطح مختلف لا نسخة مقصوصة من المركز.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  SQL, read, funcBody, section, FINANCE_ONLY_TABLES, PROFIT_TABLES, GATED_READ_FNS,
} = require("./finance_helpers.js");

const MINE = read("components/portal/finance/FinMyRequests.tsx");
const CENTER = read("components/portal/finance/FinanceCenter.tsx");

/** الدوالّ التي يجوز للموظّف العاديّ استدعاؤها بنجاح. */
const EMPLOYEE_ALLOWED = new Set([
  "finops_access", "finops_request_lookups", "finops_my_requests",
  "finops_expense_request_submit", "finops_purchase_request_submit",
  "finops_purchase_item_upsert", "finops_attachment_add", "finops_row_delete",
]);

test("(١) كلّ دالّة مالية خارج قائمة الموظّف تشترط بوّابة لا يملكها", () => {
  for (const f of GATED_READ_FNS) {
    if (EMPLOYEE_ALLOWED.has(f)) continue;
    const b = funcBody(f);
    assert.match(b, /finops_can_(view|manage|view_profit|export)\(\)/,
      `${f} تُفتح بـcan_request ⇒ يقرؤها كلّ موظّف`);
    assert.ok(!/finops_can_request\(\)/.test(b),
      `${f} تقبل مُسنَد «رفع طلب» كبوّابة قراءة — كلّ موظّف سيراها`);
  }
});

test("(١ب) can_request لا يفتح شيئًا من بيانات الشركة", () => {
  const b = funcBody("finops_can_request");
  assert.match(b, /is_staff\(\)/, "المُسنَد لا يشترط كون المستخدم موظّفًا");
  // من يستعمله: فقط دوالّ الطلب الشخصيّ ومراجعه
  const users = [];
  for (const m of SQL.matchAll(/create or replace function public\.(finops_\w+)\s*\([\s\S]*?\$\$([\s\S]*?)\$\$\s*;/g)) {
    if (/finops_can_request\(\)/.test(m[2]) && m[1] !== "finops_access") users.push(m[1]);
  }
  for (const u of users) {
    assert.ok(EMPLOYEE_ALLOWED.has(u),
      `${u} تستعمل can_request كبوّابة وهي خارج سطح الموظّف المسموح`);
  }
});

test("(٢) قائمة الموظّف مقيّدة داخل الاستعلام — لا فلتر يأتي من الواجهة", () => {
  const b = funcBody("finops_my_requests");
  const occurrences = (b.match(/requested_by = auth\.uid\(\)/g) || []).length;
  assert.ok(occurrences >= 2,
    "قيد صاحب الجلسة غير مطبَّق على الطلبين معًا (صرف وشراء)");
  assert.ok(!/p_filters->>'user|requested_by'\s*,/.test(b),
    "القائمة تقبل هويّة من الحمولة");
  assert.match(b, /'scope', 'own_rows_only'/,
    "الخادم لا يصرّح بنطاق البيانات المُعاد");
});

test("(٢ب) ★ قائمة الموظّف لا تلمس ميزانية ولا إيرادًا ولا ربحية ★", () => {
  const b = funcBody("finops_my_requests");
  for (const forbidden of ["fin_budget", "fin_revenue", "fin_contracts", "fin_retainers",
    "fin_costs", "fin_receivables", "fin_collections", "fin_approval_thresholds",
    "finops_profit", "finops_variance", "finops_threshold_for"]) {
    assert.ok(!b.includes(forbidden),
      `قائمة الموظّف تقرأ ${forbidden} — تسريب بيانات شركة في شاشة شخصية`);
  }
  // ولا حتى عدّاد مجمَّع
  assert.ok(!/sum\(|count\(/i.test(b), "قائمة الموظّف تحمل تجميعًا — رقم شركة مقنَّع");
  assert.match(SQL, /قائمة الموظّف تقرأ ميزانية أو إيرادًا أو ربحية/,
    "الـSELF-TEST بلا حارس يمنع إضافة ذلك لاحقًا");
});

test("(٣) الجداول مباشرةً: صفر صفوف للموظّف عدا صفوفه", () => {
  const rls = section("-- §4) RLS");
  // (أ) جداول المركز: سياستها can_view وحدها ⇒ لا شرط يصدق لموظّف عاديّ
  for (const t of FINANCE_ONLY_TABLES) {
    assert.ok(rls.includes(`'${t}'`), `${t} خارج مجموعة سياسات المركز`);
  }
  // القطع من تعليق المجموعة داخل do$rls$ لا من فهرس الشرح في رأس القسم
  const iA = rls.indexOf("(أ) بيانات المركز المالي");
  const iB = rls.indexOf("(ب) ★");
  assert.ok(iA > 0 && iB > iA, "تعذّر عزل كتلة سياسات المركز");
  const centerBlock = rls.slice(iA, iB);
  assert.match(centerBlock, /using \(public\.finops_can_view\(\)\)/,
    "سياسة جداول المركز ليست can_view وحدها");
  assert.ok(!/requested_by|uploaded_by|auth\.uid\(\)/.test(centerBlock),
    "سياسة جداول المركز تحمل شرط ملكية ⇒ تسرّب صفوفًا لموظّف");
  // (ج) طلبات الموظّف: صفّه هو فقط
  assert.match(rls, /fin_expense_requests_read[\s\S]{0,200}requested_by = auth\.uid\(\)/);
  assert.match(rls, /fin_purchase_requests_read[\s\S]{0,200}requested_by = auth\.uid\(\)/);
  // سجلّ التدقيق: إدارة فقط، لا حتى can_view
  assert.match(rls, /fin_audit_read[\s\S]{0,160}finops_can_manage\(\)/);
});

test("(٣ب) الموظّف لا يرى صفوف اعتماد غيره ولا بنود طلب غيره", () => {
  const rls = section("-- §4) RLS");
  assert.match(rls, /fin_expense_approvals_read[\s\S]{0,300}r\.requested_by = auth\.uid\(\)/,
    "سجلّ الاعتمادات مفتوح لكلّ موظّف");
  assert.match(rls, /fin_purchase_request_items_read[\s\S]{0,300}r\.requested_by = auth\.uid\(\)/,
    "بنود طلبات الشراء مفتوحة لكلّ موظّف");
});

test("(٤) مراجع الموظّف بلا مبالغ ولا ميزانيات ولا حدود اعتماد", () => {
  const b = funcBody("finops_request_lookups");
  for (const forbidden of ["amount", "default_vat_rate", "fin_budgets", "fin_suppliers",
    "fin_approval_thresholds", "min_amount", "max_amount", "required_role"]) {
    assert.ok(!b.includes(forbidden), `مراجع الموظّف تكشف ${forbidden}`);
  }
  // مقابل مراجع المالية التي تحملها فعلًا — الفرق مقصود لا مصادفة
  const full = funcBody("finops_lookups");
  assert.match(full, /fin_approval_thresholds/, "مراجع المالية بلا حدود اعتماد");
  assert.match(full, /fin_budgets/, "مراجع المالية بلا ميزانيات");
});

test("(٥) الواجهة تعطي الموظّف سطحًا مختلفًا لا نسخة مقصوصة", () => {
  assert.match(CENTER, /if \(!a\.can_view\)[\s\S]{0,400}FinMyRequests/,
    "الموظّف بلا can_view لا يُوجَّه إلى شاشته الخاصّة");
  // شاشة الموظّف لا تستدعي أيّ دالّة مركز
  for (const forbidden of ["finDashboard", "finCostsList", "finBudgetsList", "finReceivables",
    "finProfitability", "finLookups", "finAuditList", "finExport", "finSuppliersList",
    "finExpenseRequestsList", "finPurchaseList"]) {
    assert.ok(!MINE.includes(forbidden),
      `شاشة الموظّف تستدعي ${forbidden} — سطح المركز يتسرّب إليها`);
  }
  assert.match(MINE, /finMyRequests|finRequestLookups/, "شاشة الموظّف لا تقرأ شيئًا");
  assert.match(MINE, /own_rows_only|scope/, "الشاشة لا تعرض نطاق البيانات المصرَّح به");
});

test("(٥ب) شاشة الموظّف لا تعرض رقمًا لا يخصّه ولا تشرح المنع كعطل", () => {
  assert.match(MINE, /مقصورة على المالك وفريق المالية/,
    "الشاشة لا تفسّر سبب غياب بيانات الشركة");
  assert.ok(!/الميزانية|الهامش|الربحية|انحراف/.test(MINE.replace(/مقصورة[^<]*/g, "")),
    "شاشة الموظّف تعرض مفردات مالية للشركة");
});

test("رفع طلب باسم موظّف آخر مستحيل، وتعديل طلب غيره مرفوض", () => {
  for (const f of ["finops_expense_request_submit", "finops_purchase_request_submit"]) {
    const b = funcBody(f);
    assert.ok(!/p->>'requested_by'/.test(b), `${f} تقبل هويّة من الحمولة`);
    assert.match(b, /if v_owner <> auth\.uid\(\) then raise exception 'not authorized'/,
      `${f} تسمح بتعديل طلب موظّف آخر`);
  }
  // وحتى المرفق: الموظّف يرفق على طلبه هو فقط
  const att = funcBody("finops_attachment_add");
  assert.match(att, /requested_by = auth\.uid\(\)/, "المرفق يُقبل على طلب غيره");
  // والحذف: صفّه هو، وقبل صدور القرار فقط
  const del = funcBody("finops_row_delete");
  assert.match(del, /v_owner <> auth\.uid\(\) or v_status not in \('draft','submitted'\)/,
    "الموظّف يحذف طلبًا بُتّ فيه — طمس أثر");
});

test("الموظّف لا يستطيع لمس أيّ جدول غير طلباته حتى عبر الحذف الموحّد", () => {
  const del = funcBody("finops_row_delete");
  const i = del.indexOf("if not coalesce(public.finops_can_manage(), false) then");
  assert.ok(i > 0, "لا فرع لغير الإدارة في الحذف");
  const jEnd = del.indexOf("-- حدود الاعتماد يحذفها المالك", i);
  assert.ok(jEnd > i, "تعذّر عزل فرع غير الإدارة في الحذف");
  const nonManager = del.slice(i, jEnd);
  for (const t of [...FINANCE_ONLY_TABLES, ...PROFIT_TABLES]) {
    assert.ok(!nonManager.includes(t),
      `فرع غير الإدارة يذكر ${t} — الموظّف يستطيع حذف صفّ شركة`);
  }
  assert.match(nonManager, /else\s*\n?\s*raise exception 'not authorized'/,
    "فرع غير الإدارة بلا منع افتراضيّ — نوع جديد سيمرّ");
});
