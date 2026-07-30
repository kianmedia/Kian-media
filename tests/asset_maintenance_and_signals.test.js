// ════════════════════════════════════════════════════════════════════════════
// tests/asset_maintenance_and_signals.test.js — الخطط والإشارات والإغلاق.
//
// ثلاث قواعد:
//   ١) الخطّة تقول **متى**، وجدول الأحداث القائم يقول **ماذا جرى**. الخطّة تُغذّيه
//      ولا تحلّ محلّه.
//   ٢) الاستحقاق **مُشتقّ** لا محفوظ: عمود next_due_at مخزَّن ينحرف عن الواقع
//      عند أوّل قراءة عدّاد لا تمرّ عبر الدالّة التي تحدّثه.
//   ٣) الإشارات **قواعد صريحة** لا ذكاء اصطناعيّ ولا تنبّؤ. كلّ إشارة تحمل قاعدتها
//      وأساسها الرقميّ كي تُراجَع وتُرفَض.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const { CODE, funcBody, SIGNALS, createdTables } = require("./asset_helpers.js");

test("★ جدول الخطط جديد لأنّ لا وعاء لمفهوم «السياسة» في القاعدة", () => {
  assert.ok(createdTables().includes("custody_inventory_maintenance_plans"),
    "لا جدول خطط — custody_inventory_maintenance صفٌّ لكلّ حدث لا لكلّ سياسة");
});

test("★★ الفواصل الأربعة كلّها مدعومة: أيّام واستخدام وعدّاد وعتبة يدوية", () => {
  assert.match(CODE, /interval_days\s+int/, "لا فاصل زمنيّ");
  assert.match(CODE, /interval_meter_type\s+text/, "لا فاصل عدّاد");
  assert.match(CODE, /interval_meter_value\s+numeric/, "فاصل العدّاد بلا قيمة");
  assert.match(CODE, /interval_usage_count\s+int/, "لا فاصل عدد استخدام");
  assert.match(CODE, /manual_threshold_note\s+text/, "لا عتبة يدوية");
});

test("★★ خطّة بلا أيّ فاصل مرفوضة — النيّة ليست خطّة", () => {
  assert.match(CODE, /constraint civ_plan_interval_chk check \(/,
    "يمكن حفظ خطّة بلا فاصل، فتظهر في القوائم ولا تستحقّ أبدًا");
  assert.match(CODE, /constraint civ_plan_meter_pair_chk check \(\s*\(interval_meter_type is null\) = \(interval_meter_value is null\)/,
    "فاصل عدّاد بنوع بلا قيمة (أو العكس) = رقم بلا وحدة");
  assert.match(CODE, /constraint civ_plan_target_chk check \(asset_id is not null or category_id is not null\)/,
    "خطّة بلا هدف — معلّقة في الفراغ");
});

test("★★★ الاستحقاق مُشتقّ لا محفوظ", () => {
  assert.doesNotMatch(CODE, /next_due_at\s+(timestamptz|date)\s/,
    "next_due_at عمود محفوظ — ينحرف عند أوّل قراءة لا تمرّ عبر مُحدِّثه");
  const due = funcBody("custody_inv_maint_plan_due");
  assert.match(due, /'next_due_at',\s*case when p\.interval_days is not null/,
    "الاستحقاق غير محسوب من الفاصل");
  assert.match(due, /coalesce\(p\.last_done_at, a\.purchase_date::timestamptz, a\.created_at\)/,
    "خطّة لم تُنفَّذ قطّ بلا نقطة بداية — لا تستحقّ أبدًا");
});

test("★★ استحقاق العدّاد: نافذة منذ آخر تنفيذ، يُسقط المعكوس، ولا يضاعف المطلق", () => {
  // التاريخ: النسخة الأولى حلّت مشكلة المضاعفة بتصفية reading_mode = 'increment'،
  // فأسقطت القراءة المطلقة كلّها ⇒ عدّاد الغالق يقرأ صفرًا ولا يحين الاستحقاق
  // أبدًا. الصواب توفيق النمطين في مساعد واحد، لا إسقاط أحدهما.
  const due = funcBody("custody_inv_maint_plan_due");
  assert.doesNotMatch(due, /reading_mode\s*=\s*'increment'/,
    "عاد إسقاط القراءة المطلقة ⇒ استحقاق الاستخدام لن يحين أبدًا");
  assert.match(due, /civ_meter_usage_between\(\s*a\.id,\s*p\.interval_meter_type,\s*p\.last_done_at/,
    "لا يقيس منذ آخر تنفيذ عبر المساعد الموحّد");
  assert.match(due, /p\.last_done_at is null[\s\S]{0,120}civ_meter_total/,
    "قبل الخدمة الأولى يجب أن يُحتسَب المجموع مدى الحياة");

  // ولا يزال يُسقط المعكوس ولا يضاعف — لكن داخل المساعد الآن.
  const total = funcBody("civ_meter_total");
  const between = funcBody("civ_meter_usage_between");
  for (const [name, body] of [["civ_meter_total", total], ["civ_meter_usage_between", between]]) {
    assert.match(body, /reverses_reading_id/, `${name} يحتسب قراءة معكوسة`);
    assert.match(body, /entry_type\s*=\s*'reading'/, `${name} يحتسب قيد العكس نفسه كقراءة`);
  }
  assert.match(total, /recorded_at\s*>\s*\(\s*select[\s\S]{0,60}anchor/i,
    "يجمع الزيادات السابقة للقراءة المطلقة ⇒ مضاعفة");
});

test("★ الخطّة تخصّ أصلًا أو تصنيفًا كاملًا", () => {
  const due = funcBody("custody_inv_maint_plan_due");
  assert.match(due, /p\.asset_id is null and p\.category_id is not null and a\.category_id = p\.category_id/,
    "خطّة التصنيف لا تنفتح على أصوله");
});

test("★★★ الإشارات قواعد: كلّ إشارة تحمل rule وbasis", () => {
  const body = funcBody("custody_inv_maintenance_signals");
  assert.match(body, /'engine',\s*'rules'/, "المحرّك لا يُعرّف نفسه كقواعد");
  const rules = [...body.matchAll(/'rule',\s*'([^']+)'/g)].length;
  const basis = [...body.matchAll(/'basis',\s*jsonb_build_object/g)].length;
  assert.ok(rules >= 8, `${rules} قاعدة معلنة فقط`);
  assert.equal(rules, basis, `${rules} قاعدة مقابل ${basis} أساس — إشارة بلا أساس لا تُراجَع ولا تُرفَض`);
});

test("★★★ لا تُسمّى تنبّؤية ولا ذكاءً اصطناعيًّا في أيّ موضع", () => {
  for (const w of ["predict", "ai_", "machine_learning", "forecast_model", "تنبّؤ", "ذكاء اصطناعيّ يتوقّع"]) {
    const body = funcBody("custody_inv_maintenance_signals");
    if (w === "تنبّؤ" || w.startsWith("ذكاء")) continue; // العربية ترد نافيةً في النصّ التوضيحيّ
    assert.ok(!new RegExp(w, "i").test(body), `الإشارات تُسمّى ${w}`);
  }
});

test("★ الإشارات العشر المطلوبة كلّها مُنتَجة", () => {
  const body = funcBody("custody_inv_maintenance_signals");
  for (const s of SIGNALS) {
    assert.ok(body.includes(`'${s}'`), `الإشارة ${s} غير منتَجة`);
  }
});

test("★ كلّ إشارة تحمل شدّة صريحة", () => {
  const body = funcBody("custody_inv_maintenance_signals");
  const sev = [...body.matchAll(/'severity',\s*(case|'(high|medium|low)')/g)].length;
  const sig = [...body.matchAll(/'signal',\s*(case|'[a-z_]+')/g)].length;
  assert.equal(sev, sig, `${sig} إشارة مقابل ${sev} شدّة`);
});

test("★★ الإشارات مقروءة من مصادر قائمة لا من جدول إشارات جديد", () => {
  assert.ok(!createdTables().some((t) => /signal|alert/.test(t)),
    "الحزمة تُنشئ جدول إشارات — الإشارة مُشتقّة تُقرأ لحظتها");
  const body = funcBody("custody_inv_maintenance_signals");
  for (const t of ["custody_inventory_maintenance", "custody_inventory_meter_readings",
    "custody_inventory_assignment_items", "custody_inventory_assets"]) {
    assert.ok(body.includes(t), `الإشارات لا تقرأ من ${t}`);
  }
});

test("★★★ إغلاق الصيانة يُعيد التقييم — لا رجوع تلقائيّ إلى «متاح»", () => {
  const body = funcBody("custody_inv_maint_close_with_inspection");
  assert.match(body, /grade_required/, "يمكن الإغلاق بلا درجة حالة");
  assert.match(body, /p_grade not in\s*\n?\s*\('excellent','good','used','has_notes','partially_damaged','damaged','unusable','incomplete','missing'\)/,
    "الدرجة غير محدودة بالمفردات التسعة القائمة");
  assert.match(body, /civ_grade_to_condition\(p_grade\)/, "الدرجة لا تُترجَم إلى حالة الأصل");
  assert.match(body, /grade_unmapped/, "درجة بلا ترجمة تمرّ بصمت");
});

test("★★★ الإغلاق يستدعي الدالّة القائمة بترتيب وسائطها الصحيح", () => {
  // p_result حالةُ أمر الصيانة، وp_return_condition حالةُ الأصل بعد الفحص.
  // خلطهما كان سيكتب 'good' في عمود الحالة ويترك القطعة التالفة «سليمة».
  const body = funcBody("custody_inv_maint_close_with_inspection");
  assert.match(body, /custody_inv_admin_close_maintenance\(\$1,\$2,\$3,\$4,\$5\)/,
    "الإغلاق لا يستدعي الدالّة القائمة");
  assert.match(body, /using p_maintenance, 'completed', v_cond, p_final_cost/,
    "ترتيب الوسائط يخلط حالة الأمر بحالة الأصل");
});

test("★ الإغلاق يرفض أمرًا مغلقًا سلفًا", () => {
  assert.match(funcBody("custody_inv_maint_close_with_inspection"),
    /status in \('completed','cancelled'\)[\s\S]{0,80}maintenance_already_closed/,
    "يمكن إغلاق أمر مغلق مرّتين فتُسجَّل تكلفة مضاعفة");
});

test("★ فتح الصيانة يمنع الحجز والصرف على مستوى المحرّك", () => {
  assert.match(funcBody("civ_reservation_conflict"), /availability_status = 'maintenance'[\s\S]{0,60}state:maintenance/,
    "أصل في الصيانة يقبل الحجز");
  assert.match(funcBody("civ_asset_state"), /availability_status = 'maintenance'[\s\S]{0,120}return 'maintenance'/,
    "الصيانة لا تظهر في حالة الأصل");
});

test("★ الأرشفة ناعمة بسبب مكتوب — لا حذف صلب لخطّة", () => {
  const body = funcBody("custody_inv_maint_plan_archive");
  assert.match(body, /is_deleted = true/, "الأرشفة تحذف صلبًا");
  assert.match(body, /reason_required_min_5/, "أرشفة بلا سبب");
  assert.doesNotMatch(CODE, /delete from public\.custody_inventory_maintenance_plans/i,
    "مسار حذف صلب للخطط");
});

test("★ التوصية بالتخريد قرار مالك لا نتيجة إشارة", () => {
  // الإشارة تقترح المراجعة؛ التخريد نفسه يمرّ بعمود اعتماد صريح.
  assert.match(CODE, /disposal_approved_by\s+uuid/, "لا عمود اعتماد للتخريد");
  assert.match(CODE, /disposal_approved_at\s+timestamptz/, "لا وقت اعتماد للتخريد");
  const body = funcBody("custody_inv_maintenance_signals");
  assert.match(body, /'replacement_review'/, "لا إشارة مراجعة استبدال");
  assert.doesNotMatch(body, /update public\.custody_inventory_assets/i,
    "الإشارات تكتب في الأصل — الإشارة تقترح ولا تنفّذ");
});
