// ════════════════════════════════════════════════════════════════════════════
// tests/exec_readiness_basis.test.js
//
// ★ رقمٌ يصحّ حسابيًّا ويكذب دلاليًّا ★
// «الجاهزية التشغيلية» كانت تُحسب هكذا:
//     (اليوم + ٧) − (نقص طاقم + نقص معدّات + نقص تصاريح) ÷ (اليوم + ٧)
// وفيها عيبان يعملان معًا:
//   (١) البسط والمقام من نافذتين مختلفتين — عدّادات النقص في مركز التشغيل
//       محسوبة على ١٤ يومًا (الطاقم والمعدّات) و٢١ يومًا (التصاريح)، والمقام
//       ٨ أيام. المطروح يستطيع أن يتجاوز المقام.
//   (٢) المهمّة الناقصة في ثلاثة أوجه تُطرَح ثلاث مرّات.
// النتيجة العملية: ٣ مهامّ جاهزة تمامًا هذا الأسبوع، و٥ مهامّ ناقصة طاقمًا بعد
// أسبوعين ⇒ ٠٪ وتنبيه «جاهزية منخفضة» بشدّة عالية لفريق لا مشكلة فيه.
//
// هذه الاختبارات تحرس الأساس الصحيح: **متوسّط درجة الجاهزية لكلّ مهمّة في
// النافذة نفسها** — وهي درجة موجودة أصلًا داخل صفوف لوحة التشغيل.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { SQL, POSTCHECK, funcBody, selfTest } = require("./exec_helpers.js");

const OPS = fs.readFileSync(
  path.join(path.resolve(__dirname, ".."), "docs/operations_center_RUNME.sql"), "utf8");
const CONTRACT = fs.readFileSync(
  path.join(path.resolve(__dirname, ".."), "docs/EXECUTIVE_REPORTING_CONTRACT.md"), "utf8");

const compute = () => funcBody("mgmt_compute");

test("★ الجاهزية متوسّط درجات المهامّ، لا طرح عدّادات من نافذة أخرى ★", () => {
  const b = compute();
  assert.match(b, /avg\(nullif\(x->>'readiness'/,
    "الجاهزية لا تُحسب من درجة المهمّة الموجودة في صفوف لوحة التشغيل");
  assert.match(b, /'basis',\s*'avg_job_readiness_score'/,
    "المؤشّر لا يُصرّح بأساس حسابه، فلا يستطيع القارئ تدقيقه");
});

test("★ الصيغة الملغاة لم تعد موجودة ★ — لا طرح عدّاد نافذة ١٤/٢١ يومًا", () => {
  const b = compute();
  for (const c of ["missing_crew", "missing_equipment", "missing_permits"]) {
    assert.ok(!new RegExp(`\\(d->>'${c}'\\)::bigint`).test(b),
      `${c} ما زال يُقرأ كعدد ويُطرَح — البسط من نافذة والمقام من أخرى`);
  }
  assert.ok(!/greatest\(v_c - \(/.test(b),
    "الطرح القديم ما زال قائمًا");
});

test("العدّادات تبقى معروضة، ومعها تصريح بأنّها من نافذة أخرى", () => {
  const b = compute();
  // إخفاؤها كان سيخسر معلومة صحيحة؛ عرضها بلا تصريح كان سيوحي بأنّها الأساس.
  assert.match(b, /'missing_crew',\s*d->'missing_crew'/, "عدّادات النقص اختفت من التفصيل");
  assert.match(b, /counters_window_note_ar/, "لا تصريح بأنّ العدّادات من نافذة أخرى");
  assert.match(b, /counters_window_note_en/, "التصريح بالعربية وحدها");
});

test("★ غياب الأساس يُقال، ولا يُعرض صفرًا ولا ١٠٠٪ ★", () => {
  const b = compute();
  // لا مهامّ إطلاقًا
  assert.match(b, /'no_basis','no_scheduled_jobs'/, "لا مهامّ ⇒ يجب no_basis لا ١٠٠٪");
  // مهامّ بلا درجات: حالة جديدة لم تكن موجودة في الصيغة القديمة
  assert.match(b, /'no_basis','readiness_not_reported'/,
    "مهامّ بلا درجة جاهزية تُقرأ ٠٪ — «لا نعرف» ليست «صفر»");
  const seg = b.slice(b.indexOf("readiness_not_reported"));
  assert.ok(/ليست صفرًا|not a zero/i.test(seg.slice(0, 600)),
    "الرسالة لا تنفي قراءة الصفر صراحةً");
});

test("المقام والبسط يُبنيان من الصفوف نفسها (today + next_7_days)", () => {
  const b = compute();
  const seg = b.slice(b.indexOf("avg_job_readiness_score") - 1600,
                      b.indexOf("avg_job_readiness_score"));
  assert.match(seg, /jsonb_array_elements\(coalesce\(\(e_ops->'data'\)->'today'/,
    "صفوف اليوم ليست جزءًا من الأساس");
  assert.match(seg, /jsonb_array_elements\(coalesce\(\(e_ops->'data'\)->'next_7_days'/,
    "صفوف الأيّام السبعة ليست جزءًا من الأساس");
  assert.match(seg, /union all/i, "الصفّان لا يُجمعان في مجموعة واحدة");
});

test("مركز التشغيل ما زال يُصدّر درجة جاهزية في صفوف اللوحة — العقد قائم", () => {
  // لو حُذف هذا الحقل من المصدر لانهار الأساس بصمت. الاختبار يربط الطرفين.
  const dash = OPS.slice(OPS.indexOf("create or replace function public.prodops_dashboard"));
  assert.match(dash, /'readiness',\s*\(public\.prodops_readiness_core\(j\.id\)->>'score'\)::int/,
    "صفوف prodops_dashboard لم تعد تحمل readiness — أساس الجاهزية في اللوحة انهار");
  // والدرجة ذات معنى: فحوص مطلوبة ثابتة لا صفر دائمًا
  const core = OPS.slice(OPS.indexOf("create or replace function public.prodops_readiness_core"));
  assert.match(core, /case when v_req = 0 then 0 else floor/,
    "صيغة الدرجة تغيّرت — راجع أساس الجاهزية في اللوحة");
});

test("الاختبار الذاتيّ في SQL يحرس الأساس ويستطيع أن يفشل", () => {
  const st = selfTest();
  assert.match(st, /avg_job_readiness_score/, "الاختبار الذاتيّ لا يتحقّق من الأساس الجديد");
  assert.match(st, /missing_crew/, "الاختبار الذاتيّ لا يمنع عودة الصيغة الملغاة");
  assert.match(st, /readiness_not_reported/, "الاختبار الذاتيّ لا يحرس حالة «لا درجات»");
});

test("POSTCHECK يعرض الأساس على المشغّل بنتيجة متوقّعة صريحة", () => {
  assert.match(POSTCHECK, /uses_job_scores/, "POSTCHECK لا يُظهر أساس الجاهزية");
  assert.match(POSTCHECK, /subtracts_foreign_window/, "POSTCHECK لا يكشف عودة الطرح القديم");
});

test("العقد المكتوب يشرح العيب لا يكتفي بذكر الصيغة الجديدة", () => {
  assert.match(CONTRACT, /avg_job_readiness_score/, "العقد لا يذكر الأساس");
  assert.ok(/١٤|14/.test(CONTRACT) && /٢١|21/.test(CONTRACT),
    "العقد لا يذكر نوافذ العدّادات (١٤/٢١ يومًا) — سبب العيب");
  assert.match(CONTRACT, /readiness_not_reported/, "العقد لا يوثّق حالة «لا درجات»");
});

test("SAFE: ساكن فقط (لا قاعدة ولا شبكة)", () => {
  assert.ok(SQL.length > 0 && OPS.length > 0);
});
