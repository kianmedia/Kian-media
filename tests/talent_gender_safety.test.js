// ════════════════════════════════════════════════════════════════════════════
// tests/talent_gender_safety.test.js
//
// ★ هذا الاختبار يفشل إن دخل الجندر أيّ مسار تقييم أو ترشيح أو ترتيب ★
//
// لماذا اختبار لا مجرّد عرف مكتوب: حقل حسّاس بلا حارس آليّ يتسرّب إلى محرّك
// الترشيح بعد أشهر، في «تحسين صغير» يبدو معقولًا وقتها. هنا يظهر الخرق فورًا
// وباسم الدالّة.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const { SQL, POSTCHECK, LIB, funcBody, selfTest, tableDef, SCORING_PATHS } =
  require("./talent_helpers.js");

test("الجندر لا يظهر في أيّ مسار ترشيح أو تقييم أو عرض عامّ", () => {
  for (const fn of SCORING_PATHS) {
    const body = funcBody(fn);
    assert.doesNotMatch(body, /gender/i,
      `★ خرق ★ ${fn} تذكر الجندر — الحقل المقيَّد ممنوع في هذا المسار`);
    assert.doesNotMatch(body, /tvn_profile_restricted/i,
      `★ خرق ★ ${fn} تقرأ الجدول المقيَّد`);
  }
});

test("الجندر يعيش في جدول واحد منفصل، لا كعمود في الملفّ", () => {
  const profiles = tableDef("tvn_profiles");
  assert.doesNotMatch(profiles, /gender/i,
    "الجندر عمود في tvn_profiles — أيّ SELECT على الملفّ يصير تسريبًا");
  const restricted = tableDef("tvn_profile_restricted");
  assert.match(restricted, /gender\s+text/, "جدول الحقل المقيَّد بلا الحقل");
});

test("الغرض التشغيليّ إلزاميّ بقيد على مستوى الجدول لا بعرف", () => {
  const def = tableDef("tvn_profile_restricted");
  assert.match(def, /gender_purpose text not null/,
    "الغرض ليس إلزاميًّا");
  assert.match(def, /check \(length\(btrim\(gender_purpose\)\) >= 20\)/,
    "الغرض يقبل نصًّا فارغًا أو رمزًا — فقد الغرض أخطر من فقد القيمة");
  assert.match(SQL, /comment on table public\.tvn_profile_restricted/,
    "الجدول بلا توثيق لغرضه داخل قاعدة البيانات نفسها");
});

test("كتابة الحقل المقيَّد خلف بوّابة الامتثال وحدها، وترفض غرضًا قصيرًا", () => {
  const body = funcBody("tvn_restricted_set");
  assert.match(body, /can_verify_compliance\(\)/, "بلا بوّابة امتثال");
  assert.match(body, /length\(btrim\(coalesce\(p_purpose, ''\)\)\) < 20/,
    "تقبل غرضًا غير موثَّق");
  assert.match(body, /tvn_log\(/, "كتابة حسّاسة بلا تدقيق");
});

test("الحقل المقيَّد محجوب بسياسة RLS خاصّة به", () => {
  assert.match(SQL, /create policy tvn_restricted_read on public\.tvn_profile_restricted[\s\S]{0,200}can_verify_compliance\(\)/,
    "سياسة الحقل المقيَّد لا تستند إلى بوّابة الامتثال");
  assert.doesNotMatch(
    SQL.slice(SQL.indexOf("create policy tvn_restricted_read"),
              SQL.indexOf("create policy tvn_restricted_read") + 220),
    /can_view_talent_network/,
    "الحقل المقيَّد يُرى بمجرّد رؤية الشبكة");
});

test("SELF-TEST وPOSTCHECK يفحصان الجندر بأنفسهما على قاعدة حيّة", () => {
  const st = selfTest();
  assert.match(st, /ilike '%gender%'/, "SELF-TEST لا يفحص تسرّب الجندر");
  assert.match(st, /ilike '%tvn_profile_restricted%'/, "SELF-TEST لا يفحص قراءة الجدول المقيَّد");
  assert.match(POSTCHECK, /ilike '%gender%'/, "POSTCHECK لا يعيد الفحص بعد التشغيل");
});

test("الطبقة البرمجية لا تعرض الجندر ولا ترسله في أيّ ترشيح", () => {
  // النداء الوحيد المسموح هو الكتابة الصريحة خلف بوّابة الامتثال.
  const mentions = (LIB.match(/gender/gi) || []).length;
  assert.ok(mentions > 0, "الطبقة لا تدعم الحقل إطلاقًا (متوقَّع نداء كتابة واحد)");
  assert.match(LIB, /tvnRestrictedSet/, "دالّة الكتابة مفقودة");
  // لا يظهر ضمن مدخلات الاقتراح.
  const suggest = LIB.slice(LIB.indexOf("export const tvnSuggest"), LIB.indexOf("export const tvnAssignmentPropose"));
  assert.doesNotMatch(suggest, /gender/i, "الجندر ضمن مسار الاقتراح في الطبقة البرمجية");
});
