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
  funcSrc, sqlLiterals, emittedKeys, clientKeyAllowlist, selfTest,
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

// ════════════════════════════════════════════════════════════════════════════
// ★★ القائمة المغلقة ★★ الحارس الشكليّ (alias.column) شرط ضروريّ لا كافٍ:
// يمنع تسريب عمود **نعرف اسمه**، ولا يمنع عمودًا داخليًّا جديدًا. الكافي هو
// العكس تمامًا: نعدّ ما يخرج فعلًا، ونرفض كلّ ما ليس في القائمة. القائمة
// تُقرأ من RUNME لا تُنسخ هنا — مصدر حقيقة واحد لا نسختان تتباعدان.
// ════════════════════════════════════════════════════════════════════════════

test("★ لوحة العميل: كلّ مفتاح تُصدِره داخل القائمة المغلقة ★", () => {
  const keys = emittedKeys(funcSrc("lsr_dashboard_client"));
  const allow = clientKeyAllowlist();
  assert.ok(keys.length >= 30,
    `قارئ المفاتيح عاد بـ${keys.length} مفتاحًا — الفحص أجوف لا ناجح`);
  const outside = keys.filter((k) => !allow.includes(k));
  assert.deepEqual(outside, [],
    `★ تسريب ★ لوحة العميل تُصدِر مفاتيح خارج القائمة المغلقة: ${outside.join(", ")} — ` +
    "كلّ مفتاح جديد يُبرَّر ويُضاف صراحةً قبل أن يمرّ");
  // ولا مفتاح محسوب: ما لا يُدقَّق ساكنًا يُردّ بالتصميم لا بالإهمال.
  assert.ok(!keys.includes("<computed>"),
    "★ مفتاح JSON مبنيّ ديناميكيًّا في لوحة العميل — قائمة لا يمكن تدقيقها ليست قائمة");
});

test("★ القائمة المغلقة بلا مدخل ميت — لا تمهيد مسبق لتسريب لاحق ★", () => {
  const keys = emittedKeys(funcSrc("lsr_dashboard_client"));
  const dead = clientKeyAllowlist().filter((k) => !keys.includes(k));
  assert.deepEqual(dead, [],
    `★ القائمة تُجيز مفاتيح لا تُصدَر: ${dead.join(", ")} — قائمةٌ مُمهَّدة سلفًا ` +
    "تسمح بإصدار المفتاح غدًا بلا أن يوقظ الفحص أحدًا");
});

test("★ لا مبلغ داخليّ في القائمة المغلقة — كلّ رقم فيها سعر بيع لهذا العميل ★", () => {
  const allow = clientKeyAllowlist();
  for (const k of allow) {
    assert.doesNotMatch(k, /cost|margin|profit|floor|supplier|internal|freelanc|rate_card|markup/i,
      `★ القائمة تُجيز مفتاحًا ذا دلالة داخلية (${k}) — القائمة نفسها هي العقد`);
  }
  // ولا استثناء صامت: القائمة تُعلن ما استُبعد.
  assert.match(funcBody("lsr_dashboard_client"), /excluded_by_design/,
    "لوحة العميل لا تعلن ما استُبعد عمدًا");
});

test("★ لا إسقاط عريض في لوحة العميل — اللقطة الواسعة قائمة مفتوحة ★", () => {
  const src = funcSrc("lsr_dashboard_client");
  const body = src.replace(/--[^\n]*/g, "");
  assert.doesNotMatch(body, /\bto_jsonb\s*\(\s*[a-z_][a-z_0-9]*\s*\)/i,
    "★ to_jsonb(صفّ) في لوحة العميل — كلّ عمود حاضر أو مستقبليّ يخرج بلا قائمة");
  assert.doesNotMatch(body, /\brow_to_json\s*\(/i, "★ row_to_json في لوحة العميل");
  assert.doesNotMatch(body, /\bjsonb_agg\s*\(\s*[a-z_][a-z_0-9]*\s*(\)|order\s)/i,
    "★ jsonb_agg(صفّ) بلا مفاتيح مسمّاة في لوحة العميل");
  // القراءة الفرعية `select * from … l2` إسقاطُها الخارجيّ مسمّى، وذلك مقبول:
  // المرفوض سكبُ الصفّ **في النتيجة** لا قراءته. نثبّت أنّها ما تزال تمرّ.
  assert.match(body, /select \* from public\.csub_ledger l2/,
    "الاستعلام الفرعيّ المسمّى إسقاطُه الخارجيّ اختفى — الفحص يقيس شيئًا آخر");
});

test("★ لا استعلام في لوحة العميل بلا client_id = $1 ★", () => {
  const lits = sqlLiterals(funcSrc("lsr_dashboard_client"));
  const scoped = lits.filter((l) =>
    /\b(from|join)\s+(only\s+)?(public\.)?(csub_|crm_|sq_|fin_|comms_)/i.test(l));
  assert.ok(scoped.length >= 4,
    `استعلامات الجداول المملوكة للعميل ${scoped.length} — الفحص أجوف`);
  for (const l of scoped) {
    assert.match(l, /\bclient_id\s*=\s*\$1\b/,
      `★ قراءة عابرة للعملاء ★ استعلام بلا حصر بمعرّف العميل: ${l.slice(0, 120)}`);
  }
});

test("★ قائمة POSTCHECK مطابقة لقائمة RUNME — لا نسختان تتباعدان ★", () => {
  const i = POSTCHECK.indexOf("client_keys(k) as (values");
  assert.ok(i > 0, "القائمة المغلقة غائبة عن POSTCHECK");
  const j = POSTCHECK.indexOf(")),", i);
  assert.ok(j > i, "قائمة POSTCHECK غير مغلقة");
  const post = [...stripComments(POSTCHECK.slice(i, j)).matchAll(/'([a-z_0-9]+)'/g)].map((m) => m[1]);
  assert.deepEqual([...post].sort(), [...clientKeyAllowlist()].sort(),
    "★ انحرفت نسخة POSTCHECK عن نسخة RUNME ★ قائمتان تُسمّيان قائمة واحدة");
});

test("★ الحرّاس الثلاثة مكتوبة في الفحص الذاتيّ لا في الاختبار وحده ★", () => {
  const st = selfTest();
  assert.match(st, /v_client_keys/, "القائمة المغلقة غائبة عن الفحص الذاتيّ في RUNME");
  assert.match(st, /lsr_client_scan/, "الفحص الذاتيّ لا ينادي كاشف لوحة العميل");
  assert.match(st, /خارج القائمة المغلقة/, "الفحص الذاتيّ لا يُسقط مفتاحًا خارج القائمة");
  assert.match(st, /تمهيدٌ مسبق لتسريب لاحق/, "الفحص الذاتيّ لا يمنع المدخل الميت");
  assert.match(st, /wide_projection/, "الفحص الذاتيّ لا يمنع الإسقاط العريض");
  assert.match(st, /unscoped_query/, "الفحص الذاتيّ لا يمنع الاستعلام غير المحصور");
  // والكواشف نفسها موجودة في الحزمة.
  for (const f of ["lsr_key_of", "lsr_sql_literals", "lsr_json_keys", "lsr_client_scan"]) {
    assert.match(SQL, new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${f}\\b`, "i"),
      `الكاشف ${f} غائب عن RUNME`);
  }
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
