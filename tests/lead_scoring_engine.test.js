// ════════════════════════════════════════════════════════════════════════════
// tests/lead_scoring_engine.test.js — المرحلة ٦: محرّك تقييم مُفسَّر.
//
// العقد: درجة ٠–١٠٠، تصنيف A/B/C/D، شرح، عوامل إيجابية وسلبية، معلومات
// ناقصة، إجراء تالٍ، وعلم مراجعة. قواعد مُصدَّرة، وتعديل يدويّ بسبب وتدقيق.
// ولا صندوق أسود.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  SQL, DOCS, read, funcBody, funcSrc, tableSrc, selfTest, FACTORS,
} = require("./lead_helpers.js");

test("المخرَج يحمل كلّ ما يجعل الدرجة قابلة للمراجعة", () => {
  const body = funcBody("lsr_score_core");
  const required = [
    "score", "grade", "grade_thresholds", "ruleset_version", "components",
    "positive_factors", "negative_factors", "missing_information",
    "recommended_next_action", "review_required", "review_reasons",
    "factors_observed", "explain",
  ];
  for (const k of required) {
    assert.ok(body.includes(`'${k}'`), `مخرَج «${k}» غائب عن lsr_score_core`);
  }
});

test("كلّ قاعدة تظهر في المكوّنات ولو لم تطابق", () => {
  const body = funcBody("lsr_score_core");
  // v_items يُبنى **خارج** شرط المطابقة: من يراجع درجة يحتاج أن يعرف ما لم
  // يطابق أيضًا، وإلّا صار «الشرح» انتقاءً لما يؤيّد النتيجة.
  const i = body.indexOf("if v_match then v_base");
  const j = body.indexOf("v_items := v_items ||");
  assert.ok(i > 0 && j > i, "بناء المكوّنات غير موجود بعد جمع النقاط");
  const between = body.slice(i, j);
  assert.doesNotMatch(between.replace(/if v_match then v_base[^\n]*\n/, ""), /^\s*if\s/m,
    "المكوّنات تُبنى داخل شرط — القواعد غير المطابقة ستختفي من الشرح");
  assert.ok(body.includes("'matched', v_match"), "المكوّن لا يعلن هل طابق");
  assert.ok(body.includes("'observed'"), "المكوّن لا يعرض القيمة المرصودة");
});

test("الدرجة محصورة بين ٠ و١٠٠، والمعادلة معلَنة", () => {
  const body = funcBody("lsr_score_core");
  assert.match(body, /greatest\(0,\s*least\(100,/i, "الدرجة غير محصورة بين ٠ و١٠٠");
  assert.match(body, /v_base\s*\+\s*v_manual/, "التعديل اليدويّ لا يدخل المعادلة المعلنة");
  assert.match(body, /explain/, "لا جملة شرح في المخرَج");
});

test("التصنيف A/B/C/D بعتبات من الإعدادات لا من الكود", () => {
  const body = funcBody("lsr_score_core");
  for (const g of ["'A'", "'B'", "'C'", "'D'"]) {
    assert.ok(body.includes(g), `التصنيف ${g} غير موجود`);
  }
  for (const k of ["grade_a_min", "grade_b_min", "grade_c_min"]) {
    assert.ok(body.includes(k), `العتبة ${k} ليست من الإعدادات`);
    assert.ok(SQL.includes(`('${k}'`), `العتبة ${k} غير مزروعة في lsr_settings`);
  }
  assert.ok(body.includes("'grade_thresholds'"),
    "العتبات لا تُعاد في المخرَج — يُراجَع الحكم لا يُصدَّق");
});

test("العوامل الثمانية عشر مسجَّلة وفعّالة، وكلّها تُقرأ في السياق", () => {
  const seedIdx = SQL.indexOf("insert into public.lsr_factors");
  assert.ok(seedIdx > 0, "بذور العوامل غائبة");
  const ctx = funcBody("lsr_context");
  for (const f of FACTORS) {
    assert.ok(SQL.includes(`('${f}',`), `العامل ${f} غير مزروع`);
    assert.ok(ctx.includes(`'${f}'`), `العامل ${f} لا يُحسب في lsr_context`);
  }
  assert.equal(FACTORS.length, 18, "عدد العوامل في العقد ليس ١٨");
});

test("العوامل المشتقّة مشتقّة فعلًا لا مُدخَلة", () => {
  const ctx = funcBody("lsr_context");
  assert.match(ctx, /crm_activities/, "سلوك الاستجابة لا يُشتقّ من الأنشطة");
  assert.match(ctx, /v_completeness/, "اكتمال البيانات غير محسوب");
  assert.match(ctx, /lsr_territories/, "الإقليم لا يُشتقّ من خريطة المدن عند غيابه");
  // «عميل حاليّ» بمرجع صريح لا بمطابقة اسم — المطابقة النصّية تُنتج ادّعاءً.
  assert.match(ctx, /existing_client_id is not null/,
    "«عميل حاليّ» لا يعتمد على مرجع صريح");
  assert.doesNotMatch(ctx, /name_norm\s*=\s*|ilike/i,
    "«عميل حاليّ» يُستنتج بمطابقة أسماء — هذا ادّعاء لا معلومة");
});

test("المعلومات الناقصة تُذكر بأسمائها لا بعددها", () => {
  const body = funcBody("lsr_score_core");
  assert.match(body, /required_for_score/, "لا تمييز للعوامل المطلوبة");
  assert.match(body, /'label_ar', f\.label_ar/, "المعلومة الناقصة بلا اسم مقروء");
});

test("علم المراجعة مُعلَّل، ويُرفع للمجهول وللناقص وللتجاوز", () => {
  const body = funcBody("lsr_score_core");
  for (const r of ["anonymous_no_contact_channel", "incomplete_data",
                   "missing_required_factors", "manual_override_active"]) {
    assert.ok(body.includes(r), `سبب المراجعة «${r}» غير موجود`);
  }
  assert.ok(body.includes("'review_reasons'"), "أسباب المراجعة لا تُعاد");
});

test("الإجراء التالي قاعدة معلنة لا اجتهاد", () => {
  const body = funcBody("lsr_score_core");
  for (const a of ["collect_contact_channel", "complete_qualification", "assign_now",
                   "contact_within_24h", "schedule_discovery", "nurture", "low_priority"]) {
    assert.ok(body.includes(a), `الإجراء «${a}» غير معرَّف`);
  }
});

// ─── الإصدارية ──────────────────────────────────────────────────────────────

test("★ كلّ قاعدة مُصدَّرة، والمنشور لا يُعدَّل ★", () => {
  const rules = tableSrc("lsr_rules");
  assert.match(rules, /ruleset_version\s+int\s+not\s+null\s+references\s+public\.lsr_rulesets/i,
    "القواعد غير مرتبطة بإصدار");
  assert.match(SQL, /create trigger lsr_rules_frozen_trg/i,
    "لا مُشغِّل يمنع تعديل مجموعة منشورة");
  const frozen = funcBody("lsr_rules_frozen");
  assert.match(frozen, /raise exception/i, "المُشغِّل لا يرفض فعلًا");
  assert.match(frozen, /'draft'/, "المُشغِّل لا يميّز المسوّدة من المنشور");
  // ويشمل الحذف أيضًا، وإلّا أُفرغت مجموعة منشورة بالحذف بدل التعديل.
  assert.match(SQL, /before insert or update or delete on public\.lsr_rules/i,
    "المُشغِّل لا يغطّي الحذف — يمكن إفراغ مجموعة منشورة");
});

test("النشر قرار صريح: استنساخ ثمّ تحرير ثمّ نشر", () => {
  const clone = funcBody("lsr_ruleset_clone");
  const upsert = funcBody("lsr_rule_upsert");
  const publish = funcBody("lsr_ruleset_publish");
  assert.match(upsert, /no_draft_ruleset/, "التحرير لا يشترط وجود مسوّدة");
  assert.match(upsert, /status = 'draft'/, "التحرير قد يصيب مجموعة منشورة");
  assert.match(clone, /'draft'/, "الاستنساخ لا يُنشئ مسوّدة");
  assert.match(publish, /empty_ruleset/,
    "يمكن نشر مجموعة بلا قواعد — وذلك يعطي صفرًا لكلّ عميل، وهو كذب لا تقييم");
  assert.match(publish, /retired/, "المجموعة السابقة لا تُتقاعد عند النشر");
  assert.match(funcBody("lsr_score_core"), /status = 'published'/,
    "التقييم لا يقرأ المنشور تحديدًا");
});

test("بلا مجموعة منشورة لا تُخترع درجة", () => {
  const body = funcBody("lsr_score_core");
  assert.match(body, /no_published_ruleset/,
    "غياب القواعد يُنتج درجة بدل امتناع — الصفر المُختلَق أسوأ من الامتناع");
});

// ─── التعديل اليدويّ ────────────────────────────────────────────────────────

test("★ التعديل اليدويّ يشترط سببًا — بقيد جدول لا بفحص واجهة ★", () => {
  const t = tableSrc("lsr_score_manual");
  assert.match(t, /constraint lsr_manual_adjust_reason\s+check/i, "قيد سبب التعديل غائب");
  assert.match(t, /constraint lsr_manual_override_reason\s+check/i, "قيد سبب التجاوز غائب");

  const fn = funcBody("lsr_score_manual_set");
  assert.match(fn, /adjust_reason_required/, "الدالّة تقبل تعديلًا بلا سبب");
  assert.match(fn, /override_reason_required/, "الدالّة تقبل تجاوزًا بلا سبب");
});

test("★ التعديل اليدويّ يكتب أثر تدقيق يحمل قبل/بعد ★", () => {
  const fn = funcBody("lsr_score_manual_set");
  assert.match(fn, /lsr_log\(/, "لا قيد تدقيق عند تعديل الدرجة");
  assert.match(fn, /score_before/, "الأثر لا يحمل الدرجة قبل التعديل");
  assert.match(fn, /score_after/, "الأثر لا يحمل الدرجة بعده");
  assert.match(fn, /lsr_can_override_score/, "التعديل بلا بوّابة صلاحية مستقلّة");
});

test("التجاوز يُعرض مع سببه ويرفع علم المراجعة", () => {
  const body = funcBody("lsr_score_core");
  assert.match(body, /'override', v_override/, "التجاوز لا يظهر في المخرَج");
  assert.match(body, /manual_override_active/, "التجاوز لا يرفع علم المراجعة");
});

// ─── المسح الجماعيّ ─────────────────────────────────────────────────────────

test("المسح الجماعيّ يعلن أنّه مقصوص", () => {
  const scan = funcBody("lsr_score_scan");
  assert.match(scan, /'truncated'/, "المسح لا يعلن القصّ");
  assert.match(scan, /score_scan_limit/, "بلا سقف معلن");
  assert.match(scan, /لم يُقيَّم|غير مؤهّل/,
    "لا تفسير للفرق بين «لم يُقيَّم» و«غير مؤهّل»");
});

test("التوثيق يطابق المحرّك في العتبات والمعادلة", () => {
  const doc = read(DOCS.scoring);
  assert.match(doc, /٧٥|75/, "وثيقة القواعد لا تذكر عتبة A");
  assert.match(doc, /lsr_rules/, "وثيقة القواعد لا تشير إلى مصدر الحقيقة");
  assert.match(doc, /المصدر الوحيد للحقيقة هو قاعدة البيانات/,
    "الوثيقة لا تعلن أنّ القاعدة هي المرجع لا هي");
});

test("الفحص الذاتيّ يغطّي عدد العوامل وعدد القواعد", () => {
  const st = selfTest();
  assert.match(st, /18/, "الفحص الذاتيّ لا يتحقّق من عدد العوامل");
  assert.match(st, /lsr_rulesets/, "الفحص الذاتيّ لا يتحقّق من المجموعة المنشورة");
});
