// ════════════════════════════════════════════════════════════════════════════
// tests/crm_commission_isolation.test.js — Phase 3: الحدّان الأصعب في المتطلّب.
//
//   ١) موظّف **لا يقرأ عمولة زميله ولا نسبته** — ولا حتى بصفته مدير مبيعات.
//   ٢) موظّف **لا يحرّر هدفه هو** ولا عمولته هو.
//
// الاختباران يفحصان المنع في القاعدة، لا في الواجهة: إخفاء الزرّ ليس تصريحًا.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const { SQL, POSTCHECK, read, funcBody, selfTest } = require("./crm_helpers.js");

const PANEL = read("components/portal/crm/CrmOpportunityPanel.tsx");
const CENTER = read("components/portal/crm/CrmCenter.tsx");
const MATRIX = read("docs/CRM_ROLE_MATRIX.md");

// ─── ١) عمولة الآخرين ونِسَبهم ──────────────────────────────────────────────

test("رؤية العمولة مفتاح مستقلّ — crm.manage لا يمنحها", () => {
  const b = funcBody("crm_can_view_commission");
  assert.match(b, /crm\.view_commission/, "المُسنَد لا يستعمل مفتاحه الخاصّ");
  assert.doesNotMatch(b, /crm_can_manage\(\)/,
    "crm.manage يمنح رؤية عمولات الآخرين — فصل الصلاحيات منتهك");
  assert.doesNotMatch(b, /crm_can_view\(\)/,
    "مجرّد دخول الوحدة يمنح رؤية العمولات");
});

test("الموظّف يرى عمولته هو فقط — والمالك/الأدمن استثناء معلَن", () => {
  const b = funcBody("crm_can_view_commission");
  assert.match(b, /p_user is not null and p_user = auth\.uid\(\) then true/i,
    "الموظّف لا يرى عمولته هو");
  assert.match(b, /crm_is_owner_role\(\), false\) then true/i, "المالك/الأدمن غير مستثنى");
  assert.match(b, /not coalesce\(public\.is_staff\(\), false\) then false/i, "غير الموظّف قد يرى عمولة");
  // ولا يعيد NULL أبدًا
  assert.match(b, /coalesce\(/, "قد يعيد NULL");
});

test("سياسات RLS للعمولات مبنيّة على المُسنَد نفسه", () => {
  assert.match(SQL, /create policy crm_commission_records_read on public\.crm_commission_records for select to authenticated\s*\n\s*using \(public\.crm_can_view_commission\(user_id\)\)/i,
    "سجلّات العمولة بلا مُسنَد الرؤية");
  assert.match(SQL, /create policy crm_commission_assignments_read on public\.crm_commission_assignments for select to authenticated\s*\n\s*using \(public\.crm_can_view_commission\(user_id\)\)/i,
    "إسنادات الخطط بلا مُسنَد الرؤية");
  // نِسَب الخطط: للإدارة أو لحامل المفتاح فقط — لا لكلّ من يفتح الوحدة
  const plans = SQL.match(/create policy crm_commission_plans_read[\s\S]{0,220}?;/i);
  assert.ok(plans, "لا سياسة على خطط العمولات");
  assert.match(plans[0], /crm_can_manage_commission\(\) or public\.crm_can_view_commission\(null::uuid\)/i,
    "نِسَب الخطط مكشوفة لأوسع ممّا يجب");
  assert.doesNotMatch(plans[0], /crm_can_view\(\)/, "كلّ من يفتح الوحدة يرى نِسَب الخطط");
});

test("القائمة تُصفّي بالمُسنَد لا بالمعامل — تمرير user_id لزميلك يعيد صفرًا", () => {
  const b = funcBody("crm_commission_list");
  const guardIdx = b.indexOf("crm_can_view_commission(r.user_id)");
  const filterIdx = b.indexOf("v_user is null or r.user_id = v_user");
  assert.ok(guardIdx !== -1, "لا مُسنَد داخل الاستعلام");
  assert.ok(filterIdx !== -1, "لا فلتر اختياريّ");
  assert.ok(guardIdx < filterIdx, "الفلتر قبل المُسنَد — ترتيب يوحي بأنّ الفلتر هو الحارس");
  assert.match(b, /'sees_others', coalesce\(public\.crm_can_view_commission\(null::uuid\), false\)/i,
    "القائمة لا تصرّح للواجهة بما إذا كانت ترى عمولات الآخرين");
});

test("تفاصيل الفرصة تُخفي العمولة بصدق: null + سبب، لا شاشة فارغة", () => {
  const b = funcBody("crm_opportunity_detail");
  assert.match(b, /'commission', case when coalesce\(public\.crm_can_view_commission\(o\.owner_user_id\), false\)/i,
    "العمولة تخرج بلا فحص صلاحية");
  assert.match(b, /else null end/i, "لا قيمة null صريحة عند المنع");
  assert.match(b, /'commission_visible'/, "الواجهة لا تعرف سبب الغياب");
  assert.match(PANEL, /commission_visible/, "الواجهة لا تفرّق بين «لا عمولة» و«لا صلاحية»");
  assert.match(PANEL, /خارج صلاحيتك/, "الواجهة لا تشرح المنع للمستخدم");
});

test("التصدير ليس بابًا خلفيًّا للعمولات", () => {
  const b = funcBody("crm_export");
  assert.doesNotMatch(b, /rate_pct|commission_records|crm_commission/i,
    "التصدير يلمس بيانات العمولة");
  assert.match(b, /'commission_included', false/, "التصدير لا يصرّح بخلوّه من العمولات");
  assert.match(CENTER, /أعمدة عمولة/, "الواجهة لا تُعلن ذلك للمستخدم");
});

test("لا يعتمد أحد عمولته بنفسه ولا يُسنِد لنفسه خطّة", () => {
  assert.match(funcBody("crm_commission_assign"), /self_commission_denied/,
    "يمكن إسناد خطّة عمولة للنفس");
  assert.match(funcBody("crm_commission_set_status"), /self_commission_denied/,
    "يمكن اعتماد عمولة النفس");
  for (const f of ["crm_commission_assign", "crm_commission_set_status"]) {
    assert.match(funcBody(f), /crm_is_owner_role\(\), false\)/,
      `${f}: استثناء المالك غير معلَن`);
    assert.match(funcBody(f), /crm_can_manage_commission\(\), false\) then raise exception 'not authorized'/i,
      `${f}: بلا بوّابة إدارة العمولات`);
  }
});

test("حساب العمولة صريح ومحدود بسقفه — لا صرف ولا نظام ماليّ", () => {
  const b = funcBody("crm_commission_recalc_core");
  assert.match(b, /greatest\(coalesce\(o\.estimated_value, 0\) - coalesce\(pl\.threshold_value, 0\), 0\)/i,
    "الأساس ليس (القيمة − العتبة) بحدّ أدنى صفر");
  assert.match(b, /least\(v_amt, pl\.cap_value\)/i, "السقف غير مطبَّق");
  assert.match(b, /'draft'/, "السجلّ لا يبدأ مسوّدة");
  assert.match(b, /status = case when crm_commission_records\.status = 'approved'/i,
    "إعادة الحساب تُسقط اعتمادًا سابقًا صامتًا");
  // ولا كتابة في أيّ نظام ماليّ
  assert.doesNotMatch(b, /invoices|payments|payroll|zoho/i, "الحساب يلمس نظامًا ماليًّا");
});

// ─── ٢) الأهداف: لا تحرير ذاتيّ ─────────────────────────────────────────────

test("الموظّف لا يحرّر هدفه ولا يحذفه — والمنع في الخادم", () => {
  for (const f of ["crm_target_upsert", "crm_target_delete"]) {
    const b = funcBody(f);
    assert.match(b, /crm_can_manage_targets\(\), false\) then raise exception 'not authorized'/i,
      `${f}: بلا بوّابة إدارة الأهداف`);
    assert.match(b, /= auth\.uid\(\) and not coalesce\(public\.crm_is_owner_role\(\), false\)/i,
      `${f}: لا يمنع تحرير الهدف الذاتيّ`);
    assert.match(b, /self_target_denied/, `${f}: بلا سبب صريح للرفض`);
  }
});

test("الموظّف يرى هدفه ولا يُفتح له تحريره — والقائمة تقول ذلك صراحةً", () => {
  const b = funcBody("crm_targets_list");
  assert.match(b, /crm_can_see_owner\(t\.owner_user_id\)/i, "قائمة الأهداف بلا مُسنَد رؤية");
  assert.match(b, /'can_edit'[\s\S]{0,200}t\.owner_user_id <> auth\.uid\(\) or coalesce\(public\.crm_is_owner_role\(\), false\)/i,
    "القائمة تعِد الموظّف بتحرير هدفه");
  assert.match(SQL, /create policy crm_targets_read on public\.crm_targets for select to authenticated\s*\n\s*using \(public\.crm_can_see_owner\(owner_user_id\)\)/i,
    "سياسة الأهداف بلا مُسنَد رؤية");
  assert.match(CENTER, /لا تُحرَّر أهدافك بنفسك|هدفك يضعه المالك/,
    "الواجهة لا تشرح لماذا الهدف غير قابل للتحرير");
});

test("الإنجاز مشتقّ من الفرص المربوحة لا من عمود يُكتب باليد", () => {
  const b = funcBody("crm_targets_list");
  assert.match(b, /'achieved_value', coalesce\(\(select sum\(o\.estimated_value\)[\s\S]{0,240}o\.status = 'won'/i,
    "الإنجاز ليس مشتقًّا من الفرص المربوحة");
  const t = SQL.match(/create table if not exists public\.crm_targets \(([\s\S]*?)\n\);/);
  assert.ok(t, "تعذّر إيجاد جدول الأهداف");
  assert.doesNotMatch(t[1], /achieved_value|achieved_count/i,
    "الإنجاز محفوظ كعمود — سينحرف عن الواقع");
});

// ─── ٣) الحراسة الآلية ─────────────────────────────────────────────────────

test("SELF-TEST وPOSTCHECK يحرسان الحدَّين — لا وعدًا في وثيقة فقط", () => {
  const st = selfTest();
  assert.match(st, /crm\.view_commission/, "self-test لا يفحص مفتاح العمولة");
  assert.match(st, /فصل الصلاحيات منتهك/, "self-test لا يفحص أنّ crm.manage لا يمنح العمولة");
  assert.match(st, /يمكن إسناد خطّة عمولة للنفس/, "self-test لا يفحص منع الإسناد الذاتيّ");
  assert.match(st, /يمكن اعتماد عمولة النفس/, "self-test لا يفحص منع الاعتماد الذاتيّ");
  assert.match(st, /الموظّف يستطيع تحرير هدفه/, "self-test لا يفحص منع تحرير الهدف الذاتيّ");
  assert.match(st, /الموظّف يستطيع حذف هدفه/, "self-test لا يفحص منع حذف الهدف الذاتيّ");

  assert.match(POSTCHECK, /uses_own_key/, "POSTCHECK لا يفحص مفتاح العمولة");
  assert.match(POSTCHECK, /leaks_via_manage/, "POSTCHECK لا يفحص التسرّب عبر crm.manage");
  assert.match(POSTCHECK, /target_self_blocked/, "POSTCHECK لا يفحص منع الهدف الذاتيّ");
  assert.match(POSTCHECK, /approve_self_blocked/, "POSTCHECK لا يفحص منع الاعتماد الذاتيّ");
});

test("مصفوفة الأدوار توثّق الحدَّين بلا تلطيف", () => {
  assert.match(MATRIX, /crm\.manage\*{0,2} \*{0,2}لا\*{0,2} يمنح|لا\*{0,2} يمنح `crm\.view_commission`/,
    "المصفوفة لا تنصّ على فصل العمولة عن الإدارة");
  assert.match(MATRIX, /self_target_denied/, "المصفوفة لا تذكر منع الهدف الذاتيّ");
  assert.match(MATRIX, /self_commission_denied/, "المصفوفة لا تذكر منع العمولة الذاتية");
  assert.match(MATRIX, /عمولته هو فقط/, "المصفوفة لا توضّح ما يراه الموظّف");
});
