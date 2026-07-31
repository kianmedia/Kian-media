// ════════════════════════════════════════════════════════════════════════════
// tests/lead_scoring_forbidden_inputs.test.js
//
// ⛔ **الاختبار الأهمّ في الحزمة** ⛔
//
// الدرجة تجارية عن **فرصة**، لا حكم على **إنسان**. لذلك لا يجوز أن يدخل
// حسابها — لا اليوم ولا بعد سنة عبر «إضافة صغيرة» — أيّ صفة شخصية حسّاسة:
// الجنس، العمر، الجنسية، العِرق، الدين، الحالة الاجتماعية، تاريخ الميلاد.
//
// هذا الملفّ يفشل **باسم الملفّ والرمز** إن أشار أيّ جزء من محرّك التقييم إلى
// عمود كهذا. وهو الطبقة الرابعة: قبله قيد قاعدة البيانات، والفحص الذاتيّ في
// الترحيلة، وصفوف POSTCHECK.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  SQL, POSTCHECK, DOCS, read, funcBody, funcSrc, selfTest, tableSrc,
  FACTORS, FORBIDDEN, stripComments, stripRegexOperands,
} = require("./lead_helpers.js");

/** كلّ ما يشارك في حساب الدرجة. */
const SCORING_SURFACE = [
  "lsr_context", "lsr_score_core", "lsr_rule_matches", "lsr_score", "lsr_score_scan",
];

test("⛔ لا صفة شخصية حسّاسة في أيّ دالّة من دوالّ التقييم", () => {
  for (const fn of SCORING_SURFACE) {
    const body = funcBody(fn);
    for (const rx of FORBIDDEN) {
      assert.doesNotMatch(
        body, rx,
        `★ خرق العقد ★ الدالّة ${fn} تشير إلى صفة شخصية حسّاسة (${rx}). ` +
        `الدرجة عن فرصة تجارية لا عن إنسان — هذا ليس خطأ تنسيق بل خرق مبدأ.`,
      );
    }
  }
});

test("⛔ لا عمود بصفة شخصية في جدول الملفّ التجاريّ", () => {
  const cols = tableSrc("lsr_lead_profile");
  for (const rx of FORBIDDEN) {
    assert.doesNotMatch(
      cols, rx,
      `★ خرق ★ lsr_lead_profile يحمل عمودًا بصفة شخصية (${rx}). ` +
      `ما لا يُخزَّن لا يمكن أن يُقيَّم به لاحقًا — والعكس صحيح.`,
    );
  }
});

test("⛔ لا عامل ممنوع في بذور كتالوج العوامل", () => {
  // البذور هي ما سيوجد فعلًا في القاعدة بعد التشغيل.
  const i = SQL.indexOf("insert into public.lsr_factors");
  assert.ok(i > 0, "بذور كتالوج العوامل غائبة");
  const seed = SQL.slice(i, SQL.indexOf("on conflict (key) do update", i));
  for (const rx of FORBIDDEN) {
    assert.doesNotMatch(seed, rx, `★ خرق ★ عامل ممنوع في البذور (${rx})`);
  }
});

test("★ القيد البنيويّ موجود: المنع في القاعدة لا في مراجعة الكود ★", () => {
  const cols = tableSrc("lsr_factors");
  assert.match(
    cols, /constraint\s+lsr_factor_no_sensitive_attribute\s+check/i,
    "قيد lsr_factor_no_sensitive_attribute غائب — بدونه يصير المنع نيّة، " +
    "وأيّ insert لاحق يستطيع تسجيل عامل شخصيّ ثمّ استعماله في قاعدة.",
  );
  // ★ التغطية تُقاس على كلّ شرط على حدة، لا على نصّ الجدول كلّه ★
  //   القيد شرطان: أحدهما على `key` والآخر على `label_en`. لو اكتفينا بالبحث
  //   في نصّ الجدول لمرّ حذفُ «gender» من شرط `key` دون أن يفشل شيء، لأنّ
  //   الكلمة تبقى موجودة في شرط `label_en`. وشرط `key` هو الحارس الحقيقيّ:
  //   هو ما يمنع تسجيل عامل مفتاحه `gender_of_contact`. فحصٌ يمرّ بعد إسقاط
  //   الحارس الحقيقيّ ليس فحصًا.
  const constraint = cols.slice(cols.search(/constraint\s+lsr_factor_no_sensitive_attribute/i));
  const keyPred = constraint.slice(constraint.search(/\bkey\s*!~\*/), constraint.search(/\band\s+label_en\b/i));
  const labelPred = constraint.slice(constraint.search(/\blabel_en\s*!~\*/));
  assert.ok(keyPred.length > 10, "شرط المنع على `key` غير موجود — الحارس الحقيقيّ مفقود");
  assert.ok(labelPred.length > 10, "شرط المنع على `label_en` غير موجود");

  for (const tok of ["gender", "nationality", "ethnic", "race", "religio", "marital", "birth", "disab", "age"]) {
    assert.ok(
      keyPred.includes(tok),
      `شرط المنع على «key» لا يذكر «${tok}» — وهو الشرط الذي يمنع فعلًا ` +
      `تسجيل عامل بمفتاح كهذا. قيد لا يغطّي الحالة الواضحة ليس حارسًا.`,
    );
  }
  for (const tok of ["gender", "nationality", "ethnic", "religion", "marital", "birth"]) {
    assert.ok(
      labelPred.includes(tok),
      `شرط المنع على «label_en» لا يذكر «${tok}» — مفتاح محايد بعنوان صريح يمرّ`,
    );
  }
});

test("★ لا يمكن لقاعدة أن تشير إلى عامل غير مسجَّل ★", () => {
  // مفتاح أجنبيّ من lsr_rules.factor_key إلى lsr_factors.key: هذا ما يجعل
  // القائمة البيضاء **قائمة بيضاء** لا توصية.
  const cols = tableSrc("lsr_rules");
  assert.match(
    cols, /factor_key\s+text\s+not\s+null\s+references\s+public\.lsr_factors\(key\)/i,
    "lsr_rules.factor_key بلا مفتاح أجنبيّ إلى lsr_factors — القائمة البيضاء مثقوبة",
  );
});

test("الفحص الذاتيّ في الترحيلة يُسقطها عند ظهور رمز ممنوع", () => {
  const st = selfTest();
  assert.match(st, /gender|nationality/i, "الفحص الذاتيّ لا يفحص الرموز الممنوعة");
  assert.match(st, /raise exception/i, "الفحص الذاتيّ لا يُسقط الترحيلة");
  assert.match(
    st, /lsr_factors/,
    "الفحص الذاتيّ لا يفحص محتوى كتالوج العوامل — فحص التعريف وحده لا يكفي",
  );
});

test("POSTCHECK يحمل صفًّا قادرًا على الإخفاق لهذا العقد", () => {
  assert.match(POSTCHECK, /المدخلات الممنوعة/, "POSTCHECK بلا قسم للمدخلات الممنوعة");
  assert.match(
    POSTCHECK, /lsr_factor_no_sensitive_attribute/,
    "POSTCHECK لا يتحقّق من وجود القيد نفسه",
  );
  // ولا مصيدة تُنجِح دائمًا: يجب أن يوجد فرع FAIL في القسم.
  const i = POSTCHECK.indexOf("المدخلات الممنوعة");
  const section = POSTCHECK.slice(i, i + 2500);
  assert.match(section, /'FAIL'/, "قسم المدخلات الممنوعة بلا فرع FAIL — فحص لا يفشل ليس فحصًا");
});

test("العوامل الثمانية عشر كلّها تجارية، ومذكورة بالاسم في البذور والتوثيق", () => {
  const doc = read(DOCS.scoring);
  for (const f of FACTORS) {
    assert.ok(SQL.includes(`'${f}'`), `العامل ${f} غير مزروع في lsr_factors`);
    assert.ok(doc.includes(f), `العامل ${f} غير موثَّق في ${DOCS.scoring}`);
  }
});

test("لا نداء خارجيّ ولا نموذج: المحرّك قواعد صِرف", () => {
  for (const fn of SCORING_SURFACE) {
    const body = funcBody(fn);
    assert.doesNotMatch(body, /net\.http|pg_net|https?:\/\//i,
      `${fn}: نداء شبكة داخل محرّك التقييم`);
    assert.doesNotMatch(body, /openai|anthropic|gemini|llm|embedding/i,
      `${fn}: إشارة إلى نموذج خارجيّ — العقد يمنع الصندوق الأسود`);
  }
});

test("التوثيق يعلن المنع صراحةً لا ضمنًا", () => {
  const doc = read(DOCS.scoring);
  assert.match(doc, /⛔/, "وثيقة القواعد لا تُبرز المنع");
  assert.match(doc, /الجنس/, "وثيقة القواعد لا تذكر الجنس ضمن الممنوعات");
  assert.match(doc, /الجنسية/, "وثيقة القواعد لا تذكر الجنسية ضمن الممنوعات");
  const limits = read(DOCS.limits);
  assert.match(limits, /الجنس|الجنسية/, "وثيقة الحدود لا تذكر الممنوعات");
});

test("الحارس نفسه لا يلتقط كلمات بريئة (وإلّا عُطِّل بعد أسبوع)", () => {
  // فحص يفشل على «message» أو «usage» أو «manage» يُعطَّل، ثمّ لا يحمي شيئًا.
  const innocent = "message usage manage package average agent coverage";
  for (const rx of FORBIDDEN) {
    assert.doesNotMatch(innocent, rx, `الحارس ${rx} يلتقط كلمة بريئة`);
  }
  // وفي المقابل يلتقط الحالة الحقيقية.
  assert.match("l.gender", /\bgender\b/i);
  assert.match("p.nationality", /\bnationality\b/i);
  assert.match("age_group text", /\bage_group\b/i);
});

test("لا رمز ممنوع في الحزمة كلّها خارج سياق المنع نفسه", () => {
  // النصّ الوحيد المسموح بذكره فيه هو حارس أو تعليق يشرح المنع.
  const code = stripComments(SQL);
  const lines = code.split("\n");
  /** سياق الحارس قد يمتدّ على أكثر من سطر (اسم القيد ثمّ نمطه). */
  const guardContext = (n) =>
    lines.slice(Math.max(0, n - 3), n + 1).join("\n");
  for (const [n, line] of lines.entries()) {
    // أسطر الحراسة نفسها (تعبير نمطيّ يمنع الرمز) مستثناة — وهي الوحيدة
    // المسموح لها بذكره. ما عداها ذكرٌ حقيقيّ، وهو ما نبحث عنه.
    if (/lsr_factor_no_sensitive_attribute|SELF-TEST|forbidden/i.test(guardContext(n))) continue;
    // مُعامل النمط لعامل مطابقة ذكرٌ يحمي لا استعمال يخرق: الحارس الذي يمنع
    // `gender` مضطرّ إلى كتابته في نمطه.
    for (const rx of FORBIDDEN) {
      assert.doesNotMatch(
        stripRegexOperands(line), rx,
        `السطر ${n + 1} يذكر صفة شخصية خارج سياق المنع: ${line.trim()}`,
      );
    }
  }
});
