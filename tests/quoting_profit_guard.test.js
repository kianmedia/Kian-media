// ════════════════════════════════════════════════════════════════════════════
// tests/quoting_profit_guard.test.js
//
// ★★ هذا الملفّ هو جوهر المرحلة، لا ملحق بها ★★
//
// السابقة التي يمنع عودتها: في المركز المالي نال دورٌ واحد جدولَي (إيراد)
// و(تكلفة)، فطرح أحدهما من الآخر وحصل على الهامش **بلا** أن يملك مفتاح
// الربحية إطلاقًا. البوّابة كانت سليمة؛ الالتفاف حولها كان جمعًا ابتدائيًّا.
//
// التسعير أخطر لأنّ العرض يحمل الطرفين في مستند واحد بطبيعته. ولذلك القاعدة
// المُختبَرة هنا ليست «أخفِ عمود التكلفة» بل:
//
//   ★ لا يصل موظّف المبيعات إلى رقمين يمكن أن يُنتج تركيبُهما تكلفةً أو هامشًا. ★
//
// الاختبارات عدائية بالقصد: تبحث عن أيّ طريق — جدول، دالّة، سياسة، منح،
// تصدير، سجلّ تدقيق، مُشغّل، أو تركيب دالّتين — يوصل سطح البيع إلى طرف
// التكلفة. كلّ اختبار هنا قادر على الفشل: لا واحد ملفوف بمصيدة تُنجحه.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  SQL, SQL_CODE, TS, funcDef, funcBody, tableDef, section, sqlArray, stripSqlComments,
  TABLES, COST_TABLES, SELL_TABLES, COST_TOKENS, SALES_FNS, OWNER_FNS, INTERNAL_FNS,
} = require("./quoting_helpers.js");

// ─────────────────────────────────────────────────────────────────────────────
// (١) الطريق المباشر — هل يصل سطح البيع إلى جدول تكلفة؟
// ─────────────────────────────────────────────────────────────────────────────

test("★ كلّ جدول تكلفة محروس ببوّابة المالك، وبها وحدها ★", () => {
  const rls = section("-- §6) RLS");
  for (const t of COST_TABLES) {
    // الحراسة تجري في حلقة foreach على مصفوفة جداول التكلفة
    assert.ok(
      new RegExp(`'${t}'`).test(rls),
      `${t} غير مذكور في قسم RLS إطلاقًا`,
    );
  }
  // مصفوفة جداول التكلفة في §6 تُحرَس بـsq_can_view_cost حصرًا
  const costLoop = rls.slice(rls.indexOf("★ جداول التكلفة"));
  const costArrayEnd = costLoop.indexOf("end loop;");
  const costBlock = costLoop.slice(0, costArrayEnd + 10);
  assert.match(costBlock, /sq_can_view_cost\(\)/, "جداول التكلفة لا تُحرَس ببوّابة المالك");
  assert.ok(!/sq_can_view\(\)/.test(costBlock),
    "★ الثغرة عادت ★ — جدول تكلفة يُحرَس ببوّابة سطح البيع");
  assert.ok(!/sq_perm\s*\(/.test(costBlock),
    "★ جدول تكلفة يُفتح بمفتاح صلاحية خام في السياسة");
  assert.ok(!/auth\.uid\(\)/.test(costBlock),
    "★ شرط ملكية على جدول تكلفة ⇒ مُنشئ الصفّ يقرأ تكلفته");
});

test("جدول العروض لا يحمل عمود تكلفة واحدًا — فلا شيء فيه ليتسرّب", () => {
  const def = tableDef("sq_quotes");
  for (const tok of ["cost", "margin", "min_price", "gross_profit", "est_net_profit",
                     "recommended_price", "contingency", "overhead"]) {
    assert.ok(!def.includes(tok),
      `★ sq_quotes يحمل «${tok}» — الفصل البنيويّ انكسر، ولو ارتخت سياسة يومًا لتسرّب`);
  }
  // وبالمقابل: الأرقام الداخلية موجودة فعلًا في الجدول المنفصل
  const internal = tableDef("sq_quote_internal");
  for (const tok of ["min_price", "gross_profit", "margin_pct", "internal_cost_estimate",
                     "recommended_price", "est_net_profit"]) {
    assert.ok(internal.includes(tok), `sq_quote_internal لا يحمل ${tok} — أين ذهب؟`);
  }
});

test("جداول سطح البيع خالية من أعمدة التكلفة", () => {
  for (const t of SELL_TABLES) {
    const def = tableDef(t);
    for (const tok of ["cost_rate", "supplier_rate", "crew_rate", "min_price",
                       "margin", "gross_profit"]) {
      assert.ok(!def.includes(tok), `★ ${t} يحمل ${tok} — طرف تكلفة في سطح بيع`);
    }
  }
});

test("بنود البيع وأسعار التكلفة جدولان منفصلان — لا صفّ يجمع الرقمين", () => {
  const sell = tableDef("sq_price_book_entries");
  const cost = tableDef("sq_cost_rates");
  assert.ok(sell.includes("sell_rate"), "جدول البيع بلا سعر بيع");
  assert.ok(!sell.includes("cost_rate"),
    "★ سعر التكلفة داخل جدول بنود البيع ⇒ قراءةٌ واحدة تكشف الهامش بقسمة");
  assert.ok(cost.includes("cost_rate"), "جدول التكلفة بلا سعر تكلفة");
  assert.ok(!cost.includes("sell_rate"),
    "★ سعر البيع داخل جدول التكلفة ⇒ صفّ واحد يحمل طرفَي المعادلة");
});

// ─────────────────────────────────────────────────────────────────────────────
// (٢) الطريق غير المباشر — دالّة تعيد ما لا يجوز
// ─────────────────────────────────────────────────────────────────────────────

test("★★ لا رمز تكلفة في أيّ دالّة سطح بيع — ولا مرّة واحدة ★★", () => {
  const leaks = [];
  for (const f of SALES_FNS) {
    const d = funcDef(f);
    for (const tok of COST_TOKENS) {
      if (d.toLowerCase().includes(tok)) leaks.push(`${f} ← ${tok}`);
    }
  }
  assert.deepEqual(leaks, [],
    "★ تسريب مُثبَت: دالّة سطح بيع تقرأ طرف التكلفة\n  " + leaks.join("\n  "));
});

test("قائمة دوالّ سطح البيع تغطّي كلّ ما هو ممنوح فعلًا — لا فحص فارغ", () => {
  // حارس ضدّ تفريغ الاختبار: لو قُلّصت SALES_FNS لصار الاختبار أعلاه يمرّ بلا معنى.
  const api = sqlArray("v_api");
  const covered = new Set([...SALES_FNS, ...OWNER_FNS]);
  const uncovered = api.filter((f) => !covered.has(f));
  assert.deepEqual(uncovered, [],
    "★ دوالّ ممنوحة لـauthenticated لا تنتمي إلى أيّ من السطحين — غير مفحوصة:\n  " +
    uncovered.join("\n  "));
  assert.ok(SALES_FNS.length >= 35, "قائمة سطح البيع قصيرة على نحو مريب");
});

test("★ كلّ دالّة ممنوحة إمّا نظيفة من التكلفة وإمّا محروسة ببوّابة المالك ★", () => {
  // هذا هو الفحص الذي يغلق «تركيب دوالّ»: لا توجد فئة ثالثة.
  const api = sqlArray("v_api");
  const bad = [];
  for (const f of api) {
    const d = funcDef(f);
    const dirty = COST_TOKENS.some((t) => d.toLowerCase().includes(t));
    const gated = /sq_can_view_cost\(\)/.test(d) || /sq_can_approve\(\)/.test(d);
    // sq_can_view_cost تظهر في sq_ui_settings و sq_quote_detail كقيمة boolean
    // فقط، وهما نظيفتان من الرموز — فالشرط أدناه يبقى ذا معنى.
    if (dirty && !gated) bad.push(f);
  }
  assert.deepEqual(bad, [],
    "★ دالّة تقرأ التكلفة بلا بوّابة المالك:\n  " + bad.join("\n  "));
});

test("كلّ دالّة سطح مالك تبدأ ببوّابة وترفع منعًا صريحًا", () => {
  for (const f of OWNER_FNS) {
    const b = funcBody(f);
    assert.match(b, /sq_can_view_cost\(\)|sq_can_approve\(\)/,
      `${f} بلا بوّابة المالك`);
    assert.match(b, /raise exception 'not authorized'/,
      `${f} لا ترفع منعًا صريحًا — الصمت يُقرأ نجاحًا`);
  }
});

test("لا select * في أيّ دالّة سطح بيع", () => {
  for (const f of SALES_FNS) {
    assert.ok(!/select \*/i.test(funcDef(f)),
      `${f} تستعمل select * — أوّل عمود يُضاف غدًا يتسرّب تلقائيًّا`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// (٣) ★ الطرح ★ — هل يجمع الموظّف رقمين فيحصل على الثالث؟
// ─────────────────────────────────────────────────────────────────────────────

test("★ الأرقام التي يراها الموظّف كلّها من طرف البيع — لا مشتقّ من تكلفة ★", () => {
  const d = funcDef("sq_quote_detail");
  // الأرقام المسموحة صراحةً في المتطلّب + ما يشتقّه الموظّف بنفسه من بنوده
  const allowed = [
    "list_price", "proposed_price", "authorized_price", "discount_pct", "discount_amount",
    "gross_before_vat", "vat_rate", "vat_amount", "total_after_vat",
    "permitted_max", "permitted_min", "my_discount_allowance",
    "range_low", "range_high",
  ];
  for (const k of allowed) {
    assert.ok(d.includes(k), `${k} غائب عن تفصيل العرض — الشاشة لن تعمل`);
  }
  // ولا واحد من أرقام التكلفة
  for (const k of ["min_price", "recommended_price", "margin_pct", "gross_profit",
                   "internal_cost_estimate", "est_net_profit"]) {
    assert.ok(!d.includes(k), `★ ${k} في تفصيل العرض — طرفٌ من المعادلة تسرّب`);
  }
});

test("★ سعر القائمة مجموع بنود يجمعها الموظّف بنفسه — لا رقم داخليّ متنكّر ★", () => {
  // list_price = Σ line_total، وline_total = qty × unit_sell_rate (سعر منشور).
  // فهو ليس معلومة جديدة: إخفاؤه مسرحيّة، وكشفه لا يضيف شيئًا.
  const line = tableDef("sq_quote_lines");
  assert.match(line, /line_total\s+numeric\(14,2\) generated always as \(round\(qty \* unit_sell_rate, 2\)\) stored/,
    "إجمالي البند ليس حاصل ضرب الكمّية في سعر البيع");
  const setter = funcBody("sq_quote_line_set");
  assert.match(setter, /coalesce\(sum\(line_total\), 0\)/,
    "سعر القائمة لا يُحسب من مجموع البنود");
});

test("★ السعر المقترَح (المشتقّ من التكلفة) في الجدول الداخليّ لا في العروض ★", () => {
  // لو عُرض للموظّف ثمّ تسرّبت نسبة الهامش يومًا لانكشفت التكلفة بقسمة واحدة.
  assert.ok(!tableDef("sq_quotes").includes("recommended_price"),
    "★ السعر المقترَح في جدول العروض — قابل للعكس متى عُرفت النسبة");
  assert.ok(tableDef("sq_quote_internal").includes("recommended_price"),
    "السعر المقترَح ليس في الجدول الداخليّ");
});

test("★ التكميم يكسر العكس الحسابيّ ★", () => {
  const b = funcBody("sq_quote_recompute");
  assert.match(b, /sq_quantize_up\(v_cost \/ \(1 - v_target\), v_quantum\)/,
    "السعر المقترَح غير مكمَّم — عكسُه يعطي التكلفة رقمًا لا مجالًا");
  assert.match(b, /sq_quantize_up\(v_cost \/ \(1 - v_min\),\s+v_quantum\)/,
    "الأرضية غير مكمَّمة");
  const q = funcBody("sq_quantize_up");
  assert.match(q, /ceil\(p \/ p_step\) \* p_step/, "التكميم ليس تدويرًا لأعلى فعليًّا");
  assert.match(SQL, /\('sell_quantum',\s*'500'/, "خطوة التكميم غير مبذورة");
});

// ─────────────────────────────────────────────────────────────────────────────
// (٤) ★ صلاحية الخصم ★ — الطريق الأخبث: سقفٌ مشتقّ من الأرضية يكشفها تمامًا
// ─────────────────────────────────────────────────────────────────────────────

test("★ سقف الخصم سياسة معلَنة، لا يُشتقّ من الأرضية ولا يدلّ عليها ★", () => {
  const b = funcBody("sq_my_discount_allowance");
  assert.match(b, /discount_allowance/, "السقف لا يُقرأ من سُلّم السياسة");
  for (const tok of COST_TOKENS) {
    assert.ok(!b.toLowerCase().includes(tok),
      `★ سقف الخصم مشتقّ من ${tok} ⇒ السعر × (١ − السقف) = الأرضية بالضبط`);
  }
  // السُلّم قيم ثابتة مبذورة، لا استعلام على جدول تكلفة
  assert.match(SQL, /'discount_allowance',\s*\n?\s*'\{"default":0\.0,"quote\.discount_l1":0\.05,"quote\.discount_l2":0\.10\}'/,
    "سُلّم الخصم غير مبذور بقيم ثابتة");
});

test("المدى المسموح للموظّف مبنيّ على سعر البيع وسقفه هو — لا على الأرضية", () => {
  const d = funcBody("sq_quote_detail");
  assert.match(d, /v_max := coalesce\(q\.authorized_price, q\.list_price\)/,
    "سقف المدى ليس سعر البيع المعتمَد أو سعر القائمة");
  assert.match(d, /round\(v_max \* \(1 - v_allow\), 2\)/,
    "قاع المدى ليس السقف ناقص صلاحية الخصم");
  assert.ok(!d.includes("min_price"), "★ المدى المسموح يقرأ الأرضية");
});

// ─────────────────────────────────────────────────────────────────────────────
// (٥) ★ المدى العلنيّ ★ — «لو كان الطرف يكشف الأرضية فلا تعرضه»
// ─────────────────────────────────────────────────────────────────────────────

test("★ نشر المدى لا يقرأ الأرضية ولا أيّ رقم داخليّ ★", () => {
  const d = funcDef("sq_publish_range");
  for (const tok of COST_TOKENS) {
    assert.ok(!d.toLowerCase().includes(tok),
      `★ نشر المدى يقرأ ${tok} — الطرف المنشور يحمل أثر الأرضية`);
  }
  assert.match(d, /coalesce\(q\.authorized_price, q\.list_price\)/,
    "المدى لا يُحسب من سعر البيع");
});

test("★ المدى مُدوَّر إلى خطوة خشنة ويُرفض إن ضاق ★", () => {
  const b = funcBody("sq_publish_range");
  assert.match(b, /sq_quantize_down\(v_base \* \(1 - v_band\), v_step\)/, "الطرف الأدنى غير مُدوَّر");
  assert.match(b, /sq_quantize_up\s*\(v_base \* \(1 \+ v_band\), v_step\)/, "الطرف الأعلى غير مُدوَّر");
  assert.match(b, /v_high - v_low < v_step/,
    "لا يُرفض المدى الضيّق — ومدًى بعرض أقلّ من خطوة سعرٌ نهائيّ متنكّر");
  assert.match(b, /v_band < 0\.05 or v_band > 0\.40/, "عرض المدى بلا حدّين");
});

test("★ المدى لا يصير ملزِمًا — قيد في القاعدة لا وعدٌ في التعليق ★", () => {
  assert.match(SQL, /constraint sq_range_never_binding check \(range_is_binding = false\)/,
    "لا قيد يمنع جعل المدى سعرًا ملزِمًا");
  const pub = funcBody("sq_public_range");
  assert.match(pub, /غير ملزِم/, "المدى المعروض لا يقول إنّه غير ملزِم");
});

test("★ المدى العلنيّ لا يحمل خصمًا ولا إجماليًّا ولا حالة داخلية ★", () => {
  const b = funcBody("sq_public_range");
  for (const tok of ["discount", "total_after_vat", "gross_before_vat",
                     "authorized_price", "list_price", "proposed_price"]) {
    assert.ok(!b.includes(tok),
      `★ المدى العلنيّ يكشف ${tok} — العميل يرى خصمًا داخليًّا أو سعرًا قاطعًا`);
  }
  assert.match(b, /range_low/, "المدى بلا طرف أدنى");
});

// ─────────────────────────────────────────────────────────────────────────────
// (٦) ★ لا عرّاف ★ — البحث الثنائيّ عن الأرضية عبر سلوك النظام
// ─────────────────────────────────────────────────────────────────────────────

test("★ التسعير لا يعرف الأرضية فلا يستطيع أن يشي بها ★", () => {
  const d = funcDef("sq_quote_price_set");
  assert.ok(!d.includes("min_price"),
    "★ التسعير يقرأ الأرضية ⇒ رفضُه أو قبولُه جوابٌ ثنائيّ يُبحث فيه");
  assert.match(d, /sq_my_discount_allowance\(\)/, "التسعير بلا حدّ سياسة");
  // الرفض الوحيد المسموح: سياسة الخصم — رقم يعرفه الموظّف عن نفسه سلفًا
  assert.match(d, /يتجاوز صلاحيتك/, "لا رسالة رفض سياسية واضحة");
});

test("★ مسار الاعتماد ثابت — فلا يحمل معلومة ★", () => {
  assert.match(SQL, /constraint sq_quotes_approval_always check \(requires_owner_approval\)/,
    "★ لا قيد يمنع جعل الاعتماد شرطيًّا — والشرطيّ يُبحث فيه ثنائيًّا عن الأرضية");
  const submit = funcBody("sq_quote_submit");
  assert.match(submit, /status = 'pending_owner_approval'/, "الرفع لا يذهب إلى اعتماد المالك");
  // السبب المعروض سياسة فقط
  assert.ok(!/min_price|below_floor|cost/i.test(submit.split("v_reason :=")[1]?.split(";")[0] ?? ""),
    "★ السبب المعروض للمبيعات مشتقّ من رقم داخليّ");
});

test("★ حارس التحسّس يعدّ ولا ينطق — ولا يرفع استثناءً أبدًا ★", () => {
  const d = funcDef("sq_floor_probe_guard");
  assert.match(d, /floor_probe_count/, "الحارس لا يعدّ المحاولات");
  assert.ok(!/raise exception/i.test(d),
    "★ الحارس يرفع استثناءً ⇒ صار هو نفسه العرّاف: نجاحٌ عند سعر وفشلٌ عند آخر");
  assert.match(d, /return null;/, "الحارس يعيد قيمة إلى المستدعي");
  assert.match(d, /exception when others then/, "خطأ داخل الحارس قد يصل إلى المستدعي");
  // ويعدّ فقط حين يكون الفاعل غير مالك — المالك يرى الأرضية أصلًا
  assert.match(d, /not coalesce\(public\.sq_can_view_cost\(\), false\)/,
    "الحارس يعدّ محاولات المالك نفسه فيضجّ بلا معنى");
});

test("★ ختم الأرضية على طلب الاعتماد يجري في مُشغّل لا في دالّة مبيعات ★", () => {
  const trg = funcDef("sq_approval_stamp_floor");
  assert.match(trg, /min_price/, "المُشغّل لا يختم الأرضية — المالك سيقرّر وهو لا يرى");
  assert.ok(!/raise exception/i.test(trg), "★ المُشغّل يرفع استثناءً — يكشف وجود الأرضية بفشل عمليّة");
  // وبالمقابل: دالّة الرفع نفسها نظيفة (مُغطّاة أعلاه ضمن SALES_FNS)
  assert.ok(!funcDef("sq_quote_submit").includes("min_price"),
    "★ دالّة الرفع تقرأ الأرضية");
});

// ─────────────────────────────────────────────────────────────────────────────
// (٧) الأدوار الأخرى — التحصيل، التشغيل، العميل
// ─────────────────────────────────────────────────────────────────────────────

test("★ لا مفتاح صلاحية للتكلفة ولا للهامش ولا للاعتماد ★", () => {
  // على الكود لا على الشرح: رأس §1 يشرح عمدًا أنّ هذه المفاتيح **غير**
  // موجودة، ففحصُ النصّ الخام يفشل على الجملة التي تؤكّد الصواب.
  const perms = stripSqlComments(section("-- §1) مفاتيح الصلاحيات"));
  for (const bad of ["quote.view_cost", "quote.view_margin", "quote.approve",
                     "quote.view_internal", "quote.cost", "quote.profit"]) {
    assert.ok(!perms.includes(bad),
      `★ ${bad} مفتاح قابل للمنح ⇒ «للمالك وحده» تصير منحة تُعطى مرّة وتُنسى`);
  }
  // والمفاتيح الموجودة كلّها سطح بيع
  for (const ok of ["quote.view", "quote.build", "quote.catalog_manage", "quote.export",
                    "quote.discount_l1", "quote.discount_l2"]) {
    assert.ok(perms.includes(ok), `المفتاح ${ok} غير مبذور`);
  }
});

test("★ بوّابتا التكلفة والاعتماد للمالك حرفيًّا ★", () => {
  for (const f of ["sq_can_view_cost", "sq_can_approve"]) {
    const b = funcBody(f);
    assert.match(b, /is_owner\(\)/, `${f} لا تشترط المالك`);
    assert.match(b, /is_staff\(\)/, `${f} لا تستبعد العميل`);
    assert.ok(!/sq_perm/.test(b), `★ ${f} تُفتح بمفتاح — صارت منحة`);
    assert.ok(!/is_admin/.test(b), `★ ${f} توسّعت إلى الدور الإداريّ`);
    assert.ok(!/staff_role/.test(b), `★ ${f} تُفتح بدور وظيفيّ`);
    assert.match(b, /coalesce\(/, `${f} قد تُرجع NULL — وNULL في RLS ليس منعًا`);
  }
});

test("★ التحصيل لا يستنتج ربحية — لا بوّابة مالية تفتح شيئًا هنا ★", () => {
  // الثغرة المالية كانت: دورٌ يجمع الإيراد والتكلفة. التسعير لا يستعير أيّ
  // بوّابة من المركز المالي، فلا يرث سعتها ولا يوسّعها.
  for (const tok of ["finops_", "fin_can_", "can_view_collections", "can_record_collection"]) {
    assert.ok(!SQL_CODE.includes(tok),
      `★ التسعير يستعير بوّابة مالية (${tok}) — من يملكها هناك يرث التكلفة هنا`);
  }
});

test("التشغيل والمشاريع لا يفتحان شيئًا في التسعير", () => {
  // على الكود لا على الشرح — §2 يشرح عمدًا أنّها ليست بوّابات هنا.
  for (const tok of ["prodops_", "can_manage_projects", "is_kian_member"]) {
    assert.ok(!SQL_CODE.includes(tok),
      `★ بوّابة من موديول آخر (${tok}) تفتح التسعير — دائرة الانفجار اتّسعت`);
  }
});

test("★ الموديول لا يكتب في منصّة المشاريع المجمَّدة ★", () => {
  for (const w of [/insert\s+into\s+public\.projects/i, /update\s+public\.projects/i,
                   /delete\s+from\s+public\.projects/i, /insert\s+into\s+public\.project_core/i,
                   /update\s+public\.project_core/i, /insert\s+into\s+public\.deliverables/i]) {
    assert.ok(!w.test(SQL_CODE), `★ كتابة في منصّة المشاريع المجمَّدة: ${w}`);
  }
  // ومرجع المشروع موجود فعلًا وللقراءة فقط
  assert.match(tableDef("sq_quotes"), /project_id\s+uuid/, "لا مرجع مشروع إطلاقًا");
  assert.match(SQL, /on delete set null/i, "حذف مشروع قد يحذف عرضًا تجاريًّا");
});

test("★ العميل لا يصل إلى أيّ سطح داخليّ ★", () => {
  // كلّ بوّابة موظّف تشترط is_staff أوّلًا
  for (const f of ["sq_can_view", "sq_can_build", "sq_can_manage_catalog", "sq_can_export"]) {
    assert.match(funcBody(f), /is_staff\(\)/, `${f} لا تستبعد العميل`);
  }
  // ومسار العميل الوحيد هو المدى، ومحكوم بملكيته للعرض
  const pub = funcBody("sq_public_range");
  assert.match(pub, /sq_client_owns_quote\(p_quote\)/,
    "المدى مفتوح لأيّ عميل بأيّ مُعرِّف عرض — تخمين UUID يكشف مدى عميل آخر");
  assert.match(funcBody("sq_client_owns_quote"), /my_client_id/,
    "ملكية العميل لا تُتحقّق من هُويّته");
});

// ─────────────────────────────────────────────────────────────────────────────
// (٨) الأبواب الخلفية — منح، تصدير، تدقيق، مساعدات
// ─────────────────────────────────────────────────────────────────────────────

test("★ لا جدول ممنوح لأيّ دور — PostgREST لا يقرأ عمودًا لم نكتبه ★", () => {
  const g = section("-- §14) المنح");
  for (const t of TABLES) {
    assert.ok(new RegExp(`'${t}'`).test(g), `${t} غير مذكور في قسم المنح`);
  }
  assert.match(g, /revoke all on table public\.%I from authenticated/,
    "الجداول ليست محجوبة عن authenticated");
  assert.match(g, /revoke all on table public\.%I from anon/, "الجداول ليست محجوبة عن anon");
  assert.ok(!/grant select on table/i.test(g), "★ منح قراءة مباشر على جدول");
  assert.ok(!/grant .* to anon/i.test(g), "★ منح لـanon");
});

test("المساعدات الداخلية غير ممنوحة — لا باب خلفيّ على معاملات المعادلة", () => {
  const api = sqlArray("v_api");
  for (const f of INTERNAL_FNS) {
    assert.ok(!api.includes(f),
      `★ ${f} ممنوحة للواجهة — sq_setting_num وحدها تكشف نسب الطوارئ والمصاريف العامّة`);
  }
});

test("★ التصدير يعيد استعمال سطح البيع ولا يبني استعلامًا ثانيًا ★", () => {
  const b = funcBody("sq_export_quote");
  assert.match(b, /public\.sq_quote_detail\(p_quote\)/, "التصدير لا يستعمل تفصيل العرض");
  assert.match(b, /public\.sq_quote_lines_list\(p_quote\)/, "التصدير لا يستعمل قائمة البنود");
  assert.ok(!/from public\.sq_quotes\b/.test(b),
    "★ التصدير يستعلم الجدول مباشرةً — مسار ثانٍ يُنسى عند تشديد الأصل");
  assert.match(b, /sq_can_export\(\)/, "التصدير بلا بوّابة");
});

test("★ سجلّ التدقيق للمالك، والنشاط الظاهر بلا حمولة وبقائمة بيضاء ★", () => {
  assert.match(funcBody("sq_audit_list"), /sq_can_view_cost\(\)/, "سجلّ التدقيق ليس للمالك");
  const act = funcDef("sq_quote_activity");
  assert.ok(!act.includes("payload"),
    "★ النشاط الظاهر يحمل الحمولة — وقد تحوي أرقام تكلفة");
  assert.match(act, /a\.action in \(/,
    "★ النشاط يُرشّح بقائمة سوداء — أوّل حدث داخليّ يُضاف غدًا يظهر تلقائيًّا");
  assert.ok(!/not in \(/.test(act), "★ قائمة سوداء بدل بيضاء");
});

test("★ طلبات اعتمادي لا تحمل الأرضية ولا سبب القرار البنيويّ ★", () => {
  const d = funcDef("sq_my_approvals");
  assert.ok(!d.includes("floor_at_request"), "★ الأرضية وقت الطلب تصل إلى مقدّم الطلب");
  assert.ok(!d.includes("internal_reason_code"), "★ سبب القرار البنيويّ يصل إلى مقدّم الطلب");
  assert.match(d, /a\.decision_note/, "ملاحظة المالك لا تصل — القناة البشرية مقطوعة بلا داعٍ");
  // وبالمقابل، سطح المالك يحملهما
  const own = funcDef("sq_approvals_list_internal");
  assert.match(own, /floor_at_request/, "المالك يقرّر بلا أن يرى الأرضية");
});

test("★ تكلفة المورّد يكتبها المالك وحده ★", () => {
  // لو كتبها بانِ العرض لعرف أحد طرفَي المعادلة، ولاستخرج النسبة من السعر
  // المقترَح، ثمّ عكسها على كلّ عرض آخر في النظام. ثغرة بمدخَل واحد.
  assert.match(funcBody("sq_quote_supplier_cost_set"), /sq_can_view_cost\(\)/,
    "تكلفة المورّد تُكتب بلا بوّابة المالك");
  const inputs = tableDef("sq_quote_inputs");
  assert.ok(inputs.includes("external_supplier_required"), "حاجة المورّد غير مسجَّلة");
  assert.ok(!inputs.includes("external_supplier_cost"),
    "★ مبلغ تكلفة المورّد في جدول مدخلات يكتبه المبيعات");
});

test("★ نسخ أسعار التكلفة عند فتح نسخة يجري في مُشغّل لا في دالّة مبيعات ★", () => {
  assert.ok(!funcDef("sq_price_book_version_open").toLowerCase().includes("cost_rate"),
    "★ دالّة يستدعيها مدير الكتالوج تقرأ أسعار التكلفة");
  assert.match(funcDef("sq_pbv_seed"), /sq_cost_rates/,
    "المُشغّل لا ينسخ أسعار التكلفة — النسخة الجديدة ستكون بلا تكلفة");
});

// ─────────────────────────────────────────────────────────────────────────────
// (٩) الطبقة الأمامية — لا تُعيد بناء الثغرة في مكان آخر
// ─────────────────────────────────────────────────────────────────────────────

test("★ نوع سطح البيع في TypeScript بلا حقل تكلفة ★", () => {
  const m = TS.match(/export interface QuoteDetail \{([\s\S]*?)\n\}/);
  assert.ok(m, "QuoteDetail غير معرَّف");
  for (const tok of ["min_price", "margin", "cost", "gross_profit", "recommended_price"]) {
    assert.ok(!m[1].includes(tok),
      `★ QuoteDetail يحمل ${tok} — أوّل مكوّن سيقرؤه ويعرضه لموظّف مبيعات`);
  }
  // وسطح المالك نوع منفصل
  assert.match(TS, /export type QuoteInternalDetail\s*=/,
    "لا نوع منفصل لسطح المالك — الدمج يعيد بناء الثغرة في الطبقة الأمامية");
});

test("★ لا اختراع لرقم ماليّ في الطبقة الأمامية ★", () => {
  // `?? 0` على مبلغ يجعل الشاشة تقول «٠ ريال» عن سعر لم يُعتمد بعد.
  const bad = [...TS.matchAll(/(price|amount|total|profit|cost|vat)\w*\s*\?\?\s*0\b/gi)].map((x) => x[0]);
  assert.deepEqual(bad, [], "★ اختراع صفر ماليّ: " + bad.join("، "));
  assert.match(TS, /export function sar\(v: number \| null \| undefined/,
    "منسّق المال لا يقبل null صراحةً");
});

test("لوحة المالك وحدها تستدعي نداءات التكلفة", () => {
  const builder = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "..", "components/portal/quoting/QuoteBuilder.tsx"), "utf8");
  for (const fn of ["fetchQuoteInternal", "recomputeQuote", "setSupplierCost", "fetchCostRates"]) {
    assert.ok(!builder.includes(fn),
      `★ QuoteBuilder يستدعي ${fn} — سطح البيع يطلب التكلفة`);
  }
  const owner = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "..", "components/portal/quoting/OwnerPricingPanel.tsx"), "utf8");
  assert.match(owner, /fetchQuoteInternal/, "لوحة المالك لا تجلب الأرقام الداخلية");
});
