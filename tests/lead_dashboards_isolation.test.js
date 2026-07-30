// ════════════════════════════════════════════════════════════════════════════
// tests/lead_dashboards_isolation.test.js — المرحلة ٨: اللوحات الأربع.
//
// العقد ليس «ماذا تعرض» بل **ماذا لا تعرض**:
//   • العميل        → لا سعر داخليّ ولا هامش ولا ملاحظة داخلية
//   • طابور العمليات → لا ماليّة حسّاسة إطلاقًا
//   • المبيعات      → لا تكلفة ولا أرضية ولا ربح
//   • المالك        → له وحده، وبلا مفتاح صلاحية يمكن منحه
// وفوق ذلك: **الغياب يُعلَن ولا يُقرأ صفرًا**.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  SQL, POSTCHECK, DOCS, read, funcBody: rawBody, stripComments,
} = require("./lead_helpers.js");

/**
 * جسم الدالّة **بلا تعليقات**. مقصود: التعليق الذي يشرح لماذا لا نقرأ
 * sq_quote_internal يذكر الاسم، وفحصٌ يخلط بين شرح المنع وارتكابه فحصٌ
 * يُعطَّل بعد أوّل إنذار كاذب.
 */
const funcBody = (name) => stripComments(rawBody(name));

const DASHBOARDS = [
  "lsr_dashboard_owner", "lsr_dashboard_sales",
  "lsr_dashboard_client", "lsr_dashboard_operations",
];

/** قراءة عمود فعلية = alias.column. ذكر الاسم في قائمة «المستبعَد بالتصميم»
 *  ليس قراءة، ولذلك نشترط سابقة الاسم المستعار. */
function readsColumn(body, col) {
  return new RegExp(`\\b[a-z]{1,3}\\.${col}\\b`, "i").test(body);
}

test("★ لوحة العميل لا تقرأ عمودًا داخليًّا واحدًا ★", () => {
  const body = funcBody("lsr_dashboard_client");
  for (const col of ["internal_notes", "internal_metadata", "decision_reason",
                     "internal_cost_estimate", "base_cost", "margin_pct",
                     "gross_profit", "cost_rate", "floor_at_request"]) {
    assert.ok(!readsColumn(body, col),
      `★ تسريب ★ لوحة العميل تقرأ ${col} — هذه بيانات داخلية لا تخرج للعميل أبدًا`);
  }
  // ولا تلمس جدول التكلفة إطلاقًا.
  assert.doesNotMatch(body, /sq_quote_internal/,
    "لوحة العميل تلمس جدول التكلفة الداخليّ");
});

test("★ لوحة العميل محصورة بهُويّة العميل ★", () => {
  const body = funcBody("lsr_dashboard_client");
  assert.match(body, /my_client_id/, "لا حصر بهُويّة العميل — قراءة لبيانات عملاء آخرين");
  // كلّ استعلام يمرّر معرّف العميل.
  const execs = body.match(/execute\s+'/g) || [];
  const usings = body.match(/using v_client/g) || [];
  assert.ok(usings.length >= execs.length - 1,
    `استعلامات لوحة العميل (${execs.length}) أكثر من تمريرات معرّف العميل (${usings.length})`);
  assert.match(body, /not_a_client_account/,
    "حساب غير عميل لا يُرفض صراحةً");
});

test("لوحة العميل تعرض أرقامه هو: الضريبة حقل مستقلّ", () => {
  const body = funcBody("lsr_dashboard_client");
  for (const k of ["price_net", "vat_rate", "vat_amount", "price_gross"]) {
    assert.ok(body.includes(k), `حقل «${k}» غائب — الضريبة يجب أن تُعرض مستقلّة دائمًا`);
  }
});

test("★ طابور العمليات بلا ماليّة حسّاسة ★", () => {
  const body = funcBody("lsr_dashboard_operations");
  for (const col of ["price_net", "vat_amount", "price_gross", "overage_amount_net",
                     "overage_amount_gross", "overage_unit_price_net"]) {
    assert.ok(!readsColumn(body, col),
      `★ تسريب ★ طابور العمليات يقرأ ${col} — الطابور تشغيليّ لا ماليّ`);
  }
  // الرصيد المحجوز بالوحدات لا بالمال.
  assert.match(body, /credits_reserved_units/,
    "الرصيد المحجوز غير معلَن بالوحدات");
  assert.match(body, /scheduling_status/, "حالة الجدولة غائبة عن الطابور");
});

test("★ لوحة المبيعات بلا تكلفة ولا هامش ولا أرضية ★", () => {
  const body = funcBody("lsr_dashboard_sales");
  assert.doesNotMatch(body, /sq_quote_internal/, "لوحة المبيعات تلمس جدول التكلفة");
  for (const col of ["base_cost", "margin_pct", "gross_profit", "floor_at_request",
                     "internal_cost_estimate", "recommended_price"]) {
    assert.ok(!readsColumn(body, col), `★ تسريب ★ لوحة المبيعات تقرأ ${col}`);
  }
  assert.match(body, /excluded_by_design/,
    "اللوحة لا تعلن ما استُبعد عمدًا — الإعلان جزء من العقد");
});

test("لوحة المبيعات محصورة بصاحبها، والمدير يرى فريقه", () => {
  const body = funcBody("lsr_dashboard_sales");
  assert.match(body, /lsr_is_sales_manager/, "لا تمييز بين المندوب والمدير");
  assert.match(body, /v_mgr or l\.owner_user_id = v_me/,
    "المندوب يرى عملاء غيره");
  assert.match(body, /'scope'/, "اللوحة لا تعلن نطاقها");
});

test("★ لوحة المالك للمالك وحده — وبلا مفتاح يمكن منحه ★", () => {
  const gate = funcBody("lsr_can_view_owner_dashboard");
  assert.match(gate, /is_owner|is_admin|lsr_is_owner_role/, "البوّابة لا تعتمد دور المالك");
  assert.doesNotMatch(gate, /lsr_perm/,
    "★ خرق ★ لوحة المالك خلف مفتاح صلاحية — لو كانت مفتاحًا لأمكن منحها، " +
    "ولانتهت القيمة التعاقدية السنوية إلى منحة إدارية");
  const body = funcBody("lsr_dashboard_owner");
  assert.match(body, /lsr_can_view_owner_dashboard/, "اللوحة لا تفحص بوّابتها");
  assert.match(body, /not authorized/, "اللوحة لا ترفض صراحةً");
});

test("★ الغياب يُعلَن ولا يُقرأ صفرًا ★", () => {
  for (const d of DASHBOARDS) {
    const body = funcBody(d);
    assert.ok(
      body.includes("module_not_enabled") || body.includes("identity_not_enabled")
      || body.includes("'available'"),
      `${d}: لا إعلان لحالة التوفّر — الغياب سيُقرأ صفرًا`,
    );
  }
  // ولا لوحة تُرجع صفرًا حين يغيب الموديول.
  const owner = funcBody("lsr_dashboard_owner");
  assert.match(owner, /'available', v_has_csub/,
    "لوحة المالك لا تربط الأقسام بحالة توفّر الموديول");
  assert.match(owner, /honesty_note/, "لا ملاحظة صدق تشرح معنى «غير مفعّل»");

  const client = funcBody("lsr_dashboard_client");
  assert.match(client, /لا رصيد يُعرض|ولا يُقرأ الغياب صفرًا/,
    "لوحة العميل لا تشرح الفرق بين «صفر» و«غير مفعّل»");
});

test("كلّ قراءة لموديول اختياريّ مكتشَفة وقت التشغيل", () => {
  for (const d of DASHBOARDS) {
    const body = funcBody(d);
    if (/csub_|sq_|fin_/.test(body)) {
      assert.match(body, /to_regclass\(/,
        `${d}: يقرأ موديولًا اختياريًّا بلا اكتشاف — سيفشل بـ42P01 بدل أن يعلن`);
      // والقراءة عبر execute كي لا تُحلّ أسماء غائبة وقت الإنشاء.
      assert.match(body, /execute\s+'/,
        `${d}: يذكر جدول موديول اختياريّ في جملة ثابتة`);
    }
  }
});

test("كلّ لوحة مبوَّبة بصلاحية", () => {
  for (const d of DASHBOARDS) {
    const body = funcBody(d);
    assert.match(body, /not authorized|my_client_id/,
      `${d}: بلا فحص صلاحية`);
  }
});

test("POSTCHECK يفحص التسريب بصفوف قادرة على الإخفاق", () => {
  for (const k of ["lsr_dashboard_client", "lsr_dashboard_operations", "lsr_dashboard_sales"]) {
    assert.ok(POSTCHECK.includes(k), `POSTCHECK لا يفحص ${k}`);
  }
  assert.match(POSTCHECK, /تسريب/, "POSTCHECK بلا فحص تسريب");
  assert.match(POSTCHECK, /module_not_enabled/, "POSTCHECK لا يفحص صدق الغياب");
});

test("التوثيق يعلن ما لا يظهر لكلّ دور", () => {
  const doc = read(DOCS.contracts);
  assert.match(doc, /الغياب يُعلَن ولا يُقرأ صفرًا/, "العقود لا تذكر قاعدة الغياب");
  assert.match(doc, /sq_quote_internal/, "العقود لا تذكر استبعاد جدول التكلفة");
  const limits = read(DOCS.limits);
  assert.match(limits, /لوحة العميل بلا أرقام داخلية|طابور العمليات بلا مبالغ/,
    "وثيقة الحدود لا تذكر حدود اللوحات");
});
