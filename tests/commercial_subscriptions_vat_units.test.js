// ════════════════════════════════════════════════════════════════════════════
// tests/commercial_subscriptions_vat_units.test.js
//
// المتطلّب: «الضريبة حقل مستقلّ دائمًا، لا تُطوى أبدًا» · «العملة SAR» ·
// «وحدات متعدّدة لكلّ خطّة» · «سياسات ترحيل وانتهاء» · وخطّ أحمر البرنامج:
// **لا استنتاج للربحية** — لا يملك أيّ دور رقمين يُطرحان للوصول إلى الهامش.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  SQL, funcBody, tableDef, TABLES, UNIT_TYPES,
} = require("./commercial_subscriptions_helpers.js");

test("★ الضريبة حقل مستقلّ، والإجمالي عمود مولَّد لا يُكتب يدويًّا", () => {
  for (const t of ["csub_plans", "csub_subscriptions"]) {
    const d = tableDef(t);
    assert.match(d, /vat_rate\s+numeric\(6,3\)\s+not null default 15/, `${t}: نسبة الضريبة غير محفوظة`);
    assert.match(d, /vat_amount\s+numeric\(14,2\)\s+not null default 0/, `${t}: مبلغ الضريبة ليس حقلًا مستقلًّا`);
    assert.match(d, /price_gross\s+numeric\(14,2\) generated always as \(price_net \+ vat_amount\) stored/,
      `${t}: الإجمالي ليس مولَّدًا — يمكن كتابة إجماليّ يطوي الضريبة أو يخالفها`);
  }
  const l = tableDef("csub_ledger");
  assert.match(l, /overage_vat_rate\s+numeric\(6,3\)/, "الدفتر: نسبة ضريبة التجاوز غير محفوظة");
  assert.match(l, /overage_vat_amount\s+numeric\(14,2\)/, "الدفتر: ضريبة التجاوز ليست حقلًا مستقلًّا");
  assert.match(l, /overage_amount_gross\s+numeric\(14,2\) generated always as \(overage_amount_net \+ overage_vat_amount\) stored/,
    "الدفتر: إجمالي التجاوز ليس مولَّدًا");
});

test("★ الضريبة تُحسب بدالّة واحدة بتقريب صريح، ولا تُحسب في مكانين", () => {
  const v = funcBody("csub_vat");
  assert.match(v, /round\(coalesce\(p_net, 0\) \* coalesce\(p_rate, 0\) \/ 100\.0, 2\)/,
    "حساب الضريبة ليس تقريبًا صريحًا لخانتين — فروق قروش ستتراكم على كشوف الحساب");
  // كلّ كاتب للمال يمرّ بها
  for (const f of ["csub_plan_upsert", "csub_subscription_upsert"]) {
    assert.match(funcBody(f), /csub_vat\(/, `${f} تحسب الضريبة بنفسها بدل الدالّة المشتركة`);
  }
  assert.match(funcBody("csub_ledger_post"), /csub_vat\(new\.overage_amount_net/,
    "ضريبة التجاوز تُحسب خارج الدالّة المشتركة");
});

test("★ العملة SAR بقيد لا بعُرف، في الجداول المالية الثلاثة", () => {
  for (const t of ["csub_plans", "csub_subscriptions", "csub_ledger"]) {
    assert.match(tableDef(t), /currency\s+text not null default 'SAR' check \(currency = 'SAR'\)/,
      `${t}: العملة بلا قيد — عملة أخرى ستدخل ولن يُلاحظ`);
  }
  assert.match(funcBody("csub_ledger_post"), /currency_must_be_sar/,
    "مُشغِّل الترحيل لا يرفض عملة أخرى صراحةً");
});

test("★★ لا استنتاج للربحية: لا عمود تكلفة ولا هامش ولا ربح في الموديول كلّه", () => {
  for (const t of TABLES) {
    const d = tableDef(t);
    for (const bad of ["cost", "margin", "profit"]) {
      assert.ok(!new RegExp(`^\\s*\\w*${bad}\\w*\\s`, "im").test(d),
        `${t} فيه عمود ${bad} — رقمان يُطرحان يُنتجان هامشًا، وهذا خطّ أحمر`);
    }
  }
  assert.match(SQL, /column_name like '%cost%'/,
    "SELF-TEST لا يحرس ضدّ ظهور عمود تكلفة لاحقًا");
});

test("★ الرصيد لا يُحفظ في عمود — لا في جدول واحد", () => {
  for (const t of TABLES) {
    const d = tableDef(t);
    assert.ok(!/^\s*balance\s+numeric/im.test(d), `${t} فيه عمود balance — الرصيد لم يعد مشتقًّا`);
    assert.ok(!/^\s*\w*_balance\s+numeric/im.test(d), `${t} فيه عمود *_balance`);
  }
});

test("الوحدات: كتالوج مبذور بمفتاح خارجيّ، لا تعداد CHECK ينجرف", () => {
  const ut = tableDef("csub_unit_types");
  assert.match(ut, /key\s+text primary key check \(key ~ '\^\[a-z\]\[a-z0-9_\]\{2,40\}\$'\)/,
    "مفتاح نوع الوحدة بلا قيد شكل");
  for (const t of ["csub_plan_units", "csub_subscription_units", "csub_ledger"]) {
    assert.match(tableDef(t), /unit_type\s+text not null references public\.csub_unit_types\(key\)/,
      `${t}: نوع الوحدة بلا مفتاح خارجيّ إلى الكتالوج`);
  }
  for (const u of UNIT_TYPES) {
    assert.match(SQL, new RegExp(`\\('${u}',`), `النوع ${u} غير مبذور`);
  }
  // «وحدة مخصّصة» تلزمها تسمية صريحة وإلّا صارت صندوقًا أسود على الفاتورة
  for (const t of ["csub_plan_units", "csub_subscription_units"]) {
    assert.match(tableDef(t), /unit_type <> 'custom_unit' or coalesce\(btrim\(custom_unit_label\), ''\) <> ''/,
      `${t}: وحدة مخصّصة بلا تسمية إلزامية`);
  }
});

test("الخطّة قد تحمل عدّة وحدات، ولا تُفعَّل بلا وحدة واحدة", () => {
  assert.match(tableDef("csub_plan_units"), /constraint uq_csub_plan_unit unique \(plan_id, unit_type\)/,
    "لا قيد فريد على (خطّة، نوع) — سطران للوحدة نفسها يعنيان رصيدًا مضاعفًا");
  assert.match(tableDef("csub_subscription_units"), /constraint uq_csub_sub_unit unique \(subscription_id, unit_type\)/,
    "لا قيد فريد على (اشتراك، نوع) — مرساة الرصيد مزدوجة");
  assert.match(funcBody("csub_plan_set_active"), /plan_has_no_units/, "خطّة بلا وحدات تُفعَّل");
  assert.match(funcBody("csub_activate_core"), /no_units/, "اشتراك بلا وحدات يُفعَّل ويُخصَّص له لا شيء");
});

test("الترحيل والانتهاء: قواعد وحدود، وقيود لا أعمدة معدَّلة", () => {
  const pc = funcBody("csub_period_close");
  assert.match(pc, /rollover_max_periods/, "حدّ عدد فترات الترحيل غير مطبَّق");
  assert.match(pc, /least\(v_avail, coalesce\(u\.rollover_limit_units, s\.rollover_limit_units, v_avail\)\)/,
    "حدّ كميّة الترحيل غير مطبَّق");
  assert.match(pc, /'expiry'/, "الانتهاء لا يُكتب كقيد — رصيد يختفي بلا أثر");
  assert.match(pc, /already_closed/, "إغلاق الفترة غير idempotent");
  // الترحيل ليس قيدًا جديدًا: هو ما لم يُكتب له انتهاء.
  assert.match(pc, /الرصيد المرحَّل هو ما لم يُكتب له قيد انتهاء/,
    "لا توضيح لمعنى الترحيل — قارئ الكود سيبحث عن قيد allocation غير موجود");
  const es = funcBody("csub_expiry_scan");
  assert.match(es, /fixed_days/, "سياسة المدّة الثابتة غير مطبَّقة");
  assert.match(es, /max\(coalesce\(l\.usage_date, l\.occurred_at::date\)\)/,
    "انتهاء المدّة الثابتة لا يستند إلى آخر تخصيص — قد يُنهي رصيدًا حديثًا");
  assert.match(SQL, /لا على مستوى دفعات\s*\n?--\s*FIFO/,
    "لا تصريح بأنّ الانتهاء على مستوى الوحدة لا بدفعات FIFO — ادّعاء دقّة غير مملوكة");
});

test("سياسات الانتهاء الثلاث معرَّفة في كلّ مكان تُقرأ فيه", () => {
  for (const t of ["csub_plans", "csub_subscriptions"]) {
    assert.match(tableDef(t), /expiry_policy\s+text not null default 'period_end'\s*\n?\s*check \(expiry_policy in \('period_end','fixed_days','never'\)\)/,
      `${t}: سياسة الانتهاء بلا قيد قيم`);
  }
  for (const t of ["csub_plan_units", "csub_subscription_units"]) {
    assert.match(tableDef(t), /expiry_policy\s+text check \(expiry_policy in \('period_end','fixed_days','never'\)\)/,
      `${t}: تجاوز سياسة الانتهاء لكلّ وحدة غير مقيَّد`);
  }
});

test("التسعير الخاصّ بالعميل ومرجع العقد ومهلة السماح محفوظة", () => {
  const d = tableDef("csub_subscriptions");
  for (const col of ["price_is_custom", "contract_reference", "grace_period_days",
                     "renewal_date", "start_date", "end_date", "internal_notes",
                     "client_description", "terms", "limitations"]) {
    assert.ok(new RegExp(`^\\s*${col}\\s`, "m").test(d), `csub_subscriptions بلا عمود ${col}`);
  }
  assert.match(d, /constraint csub_sub_dates check \(start_date is null or end_date is null or end_date >= start_date\)/,
    "لا قيد على ترتيب التواريخ — اشتراك ينتهي قبل أن يبدأ");
});

test("إصدارات الخطّة: لقطة لا تُعدَّل، والاشتراك يُثبَّت على إصداره", () => {
  assert.match(tableDef("csub_plan_versions"), /constraint uq_csub_plan_version unique \(plan_id, version\)/,
    "إصداران بالرقم نفسه ممكنان");
  const pv = funcBody("csub_plan_publish_version");
  assert.match(pv, /- 'internal_notes'/, "لقطة الإصدار تحمل ملاحظات داخلية");
  assert.match(pv, /'units'/, "لقطة الإصدار بلا وحداتها — إصدار بلا محتوى");
  assert.match(funcBody("csub_activate_core"), /plan_version = coalesce\(v_ver, plan_version\)/,
    "الاشتراك لا يُثبَّت على إصدار الخطّة — تعديل الخطّة لاحقًا سيغيّر عقدًا قائمًا");
});
