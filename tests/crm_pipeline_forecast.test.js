// ════════════════════════════════════════════════════════════════════════════
// tests/crm_pipeline_forecast.test.js — Phase 3 · CRM USABLE V1
//
// السيناريوهات المسمّاة في هذا الملفّ:
//   • تحريك مرحلة بلا تصريح (unauthorized pipeline move)
//   • الوصول إلى الفرصة الخاصّة بك (own-opportunity access)
//   • التنبّؤ المرجَّح (weighted forecast)
//   • الفرصة الراكدة (stale opportunity)
//
// الاختبارات ثابتة (لا قاعدة ولا شبكة): تقرأ الترحيلة والواجهة كنصّ وتؤكّد أنّ
// **المنع في الخادم** لا في الشاشة. اختبارٌ يفحص إخفاء زرّ بدل فحص الدالّة
// يمرّ بينما الثغرة مفتوحة — وهذا بالضبط ما لا نريده هنا.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const { SQL, LIB, read, funcBody, funcDecl, selfTest } = require("./crm_helpers");

const UI = read("components/portal/crm/CrmCenter.tsx");

// ─── تحريك المرحلة بلا تصريح ───────────────────────────────────────────────
test("نقل الفرصة يُعاد فحصه في الخادم — الإفلات اقتراح لا قرار", () => {
  const body = funcBody("crm_opportunity_set_stage");

  // 1) بوّابة جلسة ثمّ منع صريح مبنيّ على مُسنَد التحرير لا القراءة.
  assert.match(body, /auth\.uid\(\) is null/, "بلا بوّابة جلسة");
  assert.match(
    body,
    /if not coalesce\(public\.crm_can_edit_opportunity\(p_opp\), false\) then raise exception 'not authorized'/,
    "النقل لا يفحص صلاحية تحرير هذه الفرصة بعينها",
  );

  // 2) المنع يسبق أيّ قراءة أو كتابة: لا يجوز أن يُعرف وجود الفرصة قبل التصريح.
  const authIdx = body.indexOf("crm_can_edit_opportunity");
  const selIdx = body.indexOf("from public.crm_opportunities");
  assert.ok(authIdx > -1 && selIdx > authIdx, "الفحص يأتي بعد قراءة الفرصة");

  // 3) الفحوص الأخرى ليست تجميلًا في الواجهة: كلّها هنا.
  for (const guard of ["stage_not_found", "stage_pipeline_mismatch", "not_open", "use_close"]) {
    assert.ok(body.includes(guard), `النقل بلا فحص ${guard} في الخادم`);
  }

  // 4) القفل قبل التعديل — نقلان متزامنان لا يتجاوزان أحدهما الآخر.
  assert.match(body, /for update/i, "التعديل بلا قفل صفّ");

  // 5) كلّ نقل مؤرَّخ ومُدقَّق: «من حرّك ماذا ومتى» لا يضيع.
  assert.match(body, /insert into public\.crm_stage_history/);
  assert.match(body, /crm_log\('opportunity_stage'/);
});

test("مُسنَد تحرير الفرصة أضيق من القراءة، ولا يعيد NULL", () => {
  const body = funcBody("crm_can_edit_opportunity");
  assert.match(body, /coalesce\(/i, "المُسنَد قد يعيد NULL");
  // التحرير: إدارة المبيعات أو مالك السجلّ. لا مكان لـ«مطّلع على الفريق».
  assert.ok(body.includes("crm_can_manage()"), "لا مسار إداريّ في التحرير");
  assert.ok(body.includes("owner_user_id"), "التحرير لا يتحقّق من مِلكيّة السجلّ");
  assert.ok(
    !body.includes("crm_can_view_team()"),
    "مدير فريق مطّلع صار يحرّر — الاطّلاع ليس تحريرًا",
  );
});

test("الواجهة لا تدّعي نجاحًا لم يحدث: التفاؤل يُمحى قبل قراءة الردّ", () => {
  const i = UI.indexOf("async function move(");
  assert.ok(i > -1, "لا دالّة نقل في اللوحة");
  const fn = UI.slice(i, i + 1600);

  assert.ok(fn.includes("crmOpportunitySetStage"), "النقل لا ينادي الخادم أصلًا");

  // الترتيب هو الاختبار: يجب أن يُمحى التفاؤل **قبل** التفرّع على النتيجة،
  // وإلّا بقيت البطاقة في العمود الجديد بعد رفض الخادم.
  const callIdx = fn.indexOf("await crmOpportunitySetStage");
  const clearIdx = fn.indexOf("delete n[oppId]");
  const branchIdx = fn.indexOf('r.state !== "ok"');
  assert.ok(callIdx > -1 && clearIdx > callIdx, "التفاؤل لا يُمحى بعد النداء");
  assert.ok(branchIdx > clearIdx, "البطاقة تبقى منقولة بصريًّا بعد رفض الخادم");

  // الرفض يظهر بنصّ الخادم لا برسالة مخترعة.
  assert.ok(fn.includes("setMsg({ t: r.message"), "رسالة الرفض لا تُعرض كما جاءت");
});

test("بديل اللمس يسلك المسار نفسه — لا باب خلفيّ للجوّال", () => {
  // قائمة «نقل إلى» تنادي move() نفسها؛ لو نادت الخادم بنفسها لأصبح مسارين.
  assert.ok(UI.includes('t({ ar: "نقل إلى…", en: "Move to…" })'), "لا بديل لمس للسحب");
  const selects = UI.match(/void move\(/g) ?? [];
  assert.ok(selects.length >= 2, "بديل اللمس لا يمرّ بدالّة النقل نفسها");
  // عدد نداءات الخادم للمرحلة: واحد فقط في الملفّ كلّه.
  const calls = UI.match(/crmOpportunitySetStage\(/g) ?? [];
  assert.equal(calls.length, 1, "أكثر من مسار نقل واحد في الواجهة");
});

test("مرحلتا الربح والخسارة ليستا هدف إفلات — والسبب معلَن", () => {
  assert.ok(
    UI.includes("!c.is_lost && !c.is_won"),
    "أعمدة الربح/الخسارة معروضة كأهداف إفلات",
  );
  const body = funcBody("crm_opportunity_set_stage");
  assert.ok(body.includes("use_close"), "الخادم يسمح بالربح عبر تحريك المرحلة");
});

// ─── الوصول إلى فرصتك أنت ──────────────────────────────────────────────────
test("الوصول إلى الفرصة يمرّ بمُسنَد واحد: نفسي · فريقي · الكلّ للإدارة", () => {
  const read1 = funcBody("crm_can_read_opportunity");
  assert.ok(read1.includes("crm_can_see_owner"), "قراءة الفرصة لا تمرّ بمُسنَد المِلكيّة");

  const see = funcBody("crm_can_see_owner");
  assert.ok(see.includes("crm_can_manage()"), "لا مسار إداريّ");
  assert.ok(see.includes("crm_can_view_team()"), "لا مسار فريق");
  assert.match(see, /coalesce\(/i, "المُسنَد قد يعيد NULL");

  // السياسة نفسها تُبنى على المُسنَد لا على عمود خام.
  assert.match(
    SQL,
    /create policy crm_opportunities_read on public\.crm_opportunities for select to authenticated\s*\n\s*using \(public\.crm_can_see_owner\(owner_user_id\)\)/,
    "سياسة قراءة الفرص ليست مبنيّة على المُسنَد",
  );
});

test("القوائم تُصفّى بالمُسنَد داخل الخادم لا بمعامل من العميل", () => {
  // SECURITY DEFINER يتجاوز RLS، فالتصفية يجب أن تكون صريحة داخل كلّ قائمة.
  for (const fn of ["crm_opportunities_list", "crm_pipeline_board", "crm_forecast", "crm_stale_alerts"]) {
    const body = funcBody(fn);
    assert.ok(
      body.includes("crm_visible_opportunities()"),
      `${fn} لا تُصفّي بالمصدر المرئيّ — تمرير معرّف زميل قد يُرجع صفوفه`,
    );
    assert.ok(body.includes("crm_can_view()"), `${fn} بلا بوّابة عرض`);
  }
});

// ─── التنبّؤ المرجَّح ────────────────────────────────────────────────────────
test("المرجَّح = القيمة × الاحتمال، مشتقّ لا محفوظ", () => {
  const body = funcBody("crm_forecast");
  assert.match(
    body,
    /sum\(round\(o\.estimated_value \* o\.probability \/ 100\.0, 2\)\)/,
    "المرجَّح ليس القيمة × الاحتمال",
  );
  // لا عمود weighted_value محفوظ على الجدول: العمود المحفوظ ينحرف عن مصدره.
  const tbl = SQL.slice(SQL.indexOf("create table if not exists public.crm_opportunities"));
  const cols = tbl.slice(0, tbl.indexOf(");"));
  assert.ok(
    !/^\s*weighted_value\s+numeric/m.test(cols),
    "القيمة المرجَّحة محفوظة كعمود — يجب أن تبقى مشتقّة",
  );
});

test("التنبّؤ لا يخفي الفرص بلا تاريخ إغلاق بل يعلنها في دلو مستقلّ", () => {
  const body = funcBody("crm_forecast");
  assert.ok(body.includes("'no_close_date'"), "لا دلو معلَن للفرص بلا تاريخ");
  assert.match(body, /expected_close_date is null/, "الفرص بلا تاريخ لا تُجمع أصلًا");
  // ولا تُحتسب مرّتين: شرط الأشهر مدى مغلق-مفتوح.
  assert.match(body, /expected_close_date >= m\.mon::date/);
  assert.match(body, /expected_close_date < \(m\.mon \+ interval '1 month'\)::date/);
});

test("«الملتزم» عتبة معلَنة لا رأي: احتمال ≥ 70٪، والمنهج مكتوب في الناتج", () => {
  const body = funcBody("crm_forecast");
  assert.match(body, /probability >= 70/, "الالتزام بلا عتبة صريحة");
  assert.ok(body.includes("'method'"), "الناتج بلا شرح منهج");
  assert.ok(body.includes("مرجَّح = القيمة × الاحتمال"), "المنهج المعلَن لا يطابق الحساب");
});

test("مدى الأشهر محصور — طلب 9999 شهرًا لا يُسقط الخادم", () => {
  const body = funcBody("crm_forecast");
  assert.match(body, /least\(greatest\(coalesce\(\(p_filters->>'months'\)::int, 6\), 1\), 24\)/);
});

test("التنبّؤ للقراءة فقط: STABLE ولا كتابة", () => {
  assert.match(funcDecl("crm_forecast"), /\bstable\b/i, "التنبّؤ ليس STABLE");
  const body = funcBody("crm_forecast");
  assert.ok(!/insert\s+into|update\s+public|delete\s+from/i.test(body), "التنبّؤ يكتب");
});

// ─── الفرصة الراكدة ────────────────────────────────────────────────────────
test("الركود مؤشّر مشتقّ بأسبابه الخمسة، وعتبته إعداد لا رقم سحريّ", () => {
  const body = funcBody("crm_stale_alerts");
  for (const reason of [
    "no_activity", "stage_stuck", "next_action_overdue", "no_next_action", "close_date_passed",
  ]) {
    assert.ok(body.includes(`'${reason}'`), `سبب الركود ${reason} غير محسوب`);
  }
  assert.match(body, /crm_setting_int\('stale_days', 21\)/, "عتبة الركود رقم سحريّ");
  assert.match(body, /crm_setting_int\('stale_stage_days', 30\)/, "عتبة المرحلة رقم سحريّ");
  // العتبة تُعاد في الناتج كي يعرف المستخدم على أيّ أساس صُنّفت فرصته راكدة.
  assert.ok(body.includes("'stale_days', v_stale"), "الناتج لا يعلن العتبة المستعملة");
});

test("الراكد لا يُخترع: مؤشّر مشتقّ، لا عمود is_stale يُكتب باليد", () => {
  const tbl = SQL.slice(SQL.indexOf("create table if not exists public.crm_opportunities"));
  const cols = tbl.slice(0, tbl.indexOf(");"));
  assert.ok(!/is_stale/.test(cols), "الركود محفوظ كعمود — سينحرف عن الواقع خلال يوم");
  assert.match(funcDecl("crm_stale_alerts"), /\bstable\b/i, "تنبيهات الركود ليست STABLE");
});

test("تنبيهات الركود مفتوحة فقط ومحدودة العدد — لا صفحة تُسقط الجوّال", () => {
  const body = funcBody("crm_stale_alerts");
  assert.match(body, /o\.status = 'open'/, "الركود يشمل فرصًا مغلقة");
  assert.match(body, /limit 200/, "لا حدّ لعدد الصفوف");
});

test("الواجهة تعرض العتبة وسبب كلّ تنبيه بلغتين — لا شارة غامضة", () => {
  assert.ok(UI.includes("STALE_REASON_AR"), "أسباب الركود غير معروضة");
  assert.ok(UI.includes("STALE_REASON_EN"), "أسباب الركود بلغة واحدة");
  assert.ok(UI.includes("crmLabel(STALE_REASON_AR, STALE_REASON_EN"), "الأسباب لا تُترجم بالخريطتين");
  for (const key of ["no_activity", "stage_stuck", "next_action_overdue", "no_next_action", "close_date_passed"]) {
    assert.ok(LIB.includes(`${key}:`), `السبب ${key} بلا تسمية في الواجهة`);
  }
});

test("SELF-TEST يحرس ما سبق — لا وعد في وثيقة فقط", () => {
  const st = selfTest();
  assert.ok(st.includes("crm_can_edit_opportunity(ZERO)"), "المُسنَد غير مفحوص بلا جلسة");
  assert.ok(st.includes("أعادت NULL"), "لا فحص NULL على المُسنَدات");
});

test("SAFE: static only (no DB/network)", () => {
  const self = read("tests/crm_pipeline_forecast.test.js");
  const reqs = [...self.matchAll(/require\(["']([^"']+)["']\)/g)].map((m) => m[1]);
  for (const r of reqs) {
    assert.ok(
      ["node:test", "node:assert", "node:assert/strict", "node:fs", "node:path", "./crm_helpers"].includes(r),
      `static (got ${r})`,
    );
  }
});
