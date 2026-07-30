// ════════════════════════════════════════════════════════════════════════════
// tests/ops_double_booking.test.js
// منع الحجز المزدوج: **الفاصل في القاعدة، لا في الشاشة**.
//
// هذه فحوص عقد ساكنة (لا اتّصال بقاعدة، ولا بيانات حقيقية): تُثبت أنّ آليّة
// المنع موجودة ولا يمكن الالتفاف حولها، وأنّ دلالتها صحيحة (تداخل حقيقيّ فقط،
// وليس تلاصقًا زمنيًّا). ما لا تستطيع إثباته ساكنًا — أنّ PostgreSQL نفّذ الرفض —
// يُثبَت يدويًّا في docs/OPERATIONS_MANUAL_TEST_SCRIPT.md §3.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const { SQL, funcBody, funcDecl } = require("./ops_helpers");

const GUARDS = [
  ["prodops_guard_crew", "ops_job_crew", "trg_ops_crew_no_double_booking"],
  ["prodops_guard_equipment", "ops_job_equipment", "trg_ops_equip_no_double_booking"],
  ["prodops_guard_job", "ops_jobs", "trg_ops_job_no_double_booking"],
];

test("★ المنع مُشغِّل على الجدول — لا تحذير في الواجهة ★", () => {
  for (const [fn, tbl, trg] of GUARDS) {
    assert.match(SQL, new RegExp(`create or replace function public\\.${fn}\\(\\) returns trigger`, "i"),
      `${fn} غير موجودة`);
    assert.match(
      SQL,
      new RegExp(`create trigger ${trg}\\s+before insert or update on public\\.${tbl}`, "i"),
      `${trg} ليس BEFORE INSERT OR UPDATE على ${tbl} — الالتفاف ممكن`,
    );
    assert.match(SQL, new RegExp(`drop trigger if exists ${trg}\\s+on public\\.${tbl};`, "i"),
      `${trg} غير idempotent`);
  }
});

test("تعارض الطاقم: شخص واحد لا يُسنَد لمهمّتين متداخلتين", () => {
  const b = funcBody("prodops_person_clash");
  assert.match(b, /c\.user_id = p_user/, "لا مقارنة بالشخص نفسه");
  assert.match(b, /c\.job_id <> p_job/, "يقارن المهمّة بنفسها فيرفض حجزًا سليمًا");
  assert.match(b, /tstzrange\(j\.scheduled_start, j\.scheduled_end\) && tstzrange\(p_from, p_to\)/,
    "لا فحص تداخل زمنيّ فعليّ");
  assert.match(b, /c\.status not in \('declined','no_show'\)/, "المعتذر يحجز مكانًا وهميًّا");
  assert.match(b, /j\.status in \('scheduled','confirmed','in_progress'\)/,
    "المسوّدة/الملغاة تمنع حجزًا سليمًا");
  assert.match(b, /c\.is_deleted = false/, "الصفوف المؤرشفة تمنع حجزًا سليمًا");
});

test("تعارض المعدّات: جهاز واحد لا يُحجز في مهمّتين متداخلتين", () => {
  const b = funcBody("prodops_asset_clash");
  assert.match(b, /e\.asset_id = p_asset/, "لا مقارنة بالجهاز نفسه");
  assert.match(b, /e\.job_id <> p_job/, "يقارن المهمّة بنفسها");
  assert.match(b, /e\.status in \('requested','reserved','handed_over'\)/,
    "المُعاد أو الملغى يمنع حجزًا سليمًا");
  // نافذة البند تسبق نافذة المهمّة: جهاز مطلوب ساعتين لا يحجز اليوم كلّه.
  assert.match(b, /coalesce\(e\.needed_from, j\.scheduled_start\)/, "نافذة البند مُهمَلة");
  assert.match(b, /coalesce\(e\.needed_to,\s+j\.scheduled_end\)/, "نافذة البند مُهمَلة");
});

test("تعارض الموقع/الاستوديو: مساحة واحدة لا تُحجز مرّتين", () => {
  const b = funcBody("prodops_location_clash");
  assert.match(b, /j\.location_id = p_loc/, "لا مقارنة بالموقع نفسه");
  assert.match(b, /j\.id <> p_job/, "يقارن المهمّة بنفسها");
  assert.match(b, /tstzrange\(j\.scheduled_start, j\.scheduled_end\) && tstzrange\(p_from, p_to\)/,
    "لا فحص تداخل زمنيّ");
});

test("دلالة التداخل نصف-مفتوحة: التلاصق ليس تعارضًا", () => {
  // tstzrange(a,b) افتراضها '[)'. مهمّة تنتهي ١٢:٠٠ وأخرى تبدأ ١٢:٠٠ ليست
  // تعارضًا — ولو استُعمل '[]' لصار كلّ يوم عملٍ متتالٍ «حجزًا مزدوجًا» كاذبًا،
  // ولتعطّل الجدول كلّه بلا سبب مفهوم.
  for (const fn of ["prodops_person_clash", "prodops_asset_clash", "prodops_location_clash"]) {
    const b = funcBody(fn);
    assert.doesNotMatch(b, /tstzrange\([^)]*,\s*'\[\]'\)/, `${fn} يستعمل مدى مغلق فيرفض التلاصق`);
    assert.doesNotMatch(b, /overlaps/i, `${fn} يستعمل OVERLAPS بدل && فتختلف حالات الحدود`);
  }
  // نموذج الدلالة المقصودة، مكتوبًا صراحةً كي لا تنجرف لاحقًا:
  const overlaps = (a1, a2, b1, b2) => a1 < b2 && b1 < a2;
  assert.equal(overlaps(10, 12, 12, 14), false, "التلاصق يجب ألّا يكون تعارضًا");
  assert.equal(overlaps(10, 13, 12, 14), true, "التداخل الجزئيّ تعارض");
  assert.equal(overlaps(10, 14, 11, 12), true, "الاحتواء تعارض");
});

test("إعادة الجدولة لا تلتفّ على الحارسين: نقل الوقت يُعيد فحص كلّ ما تحت المهمّة", () => {
  const b = funcBody("prodops_guard_job");
  assert.match(b, /prodops_location_clash/, "لا فحص للموقع عند إعادة الجدولة");
  assert.match(b, /from public\.ops_job_crew/, "لا فحص للطاقم عند إعادة الجدولة");
  assert.match(b, /from public\.ops_job_equipment/, "لا فحص للمعدّات عند إعادة الجدولة");
  assert.match(b, /new\.scheduled_start/, "لا يستعمل القيمة الجديدة");
  // ولا يُفحص ما لا معنى لفحصه (تعديل لا يمسّ الحجز)
  assert.match(b, /is not distinct from old\./, "يُعيد الفحص على كلّ تعديل مهما كان");
});

test("الحارس يفحص عند الإلغاء المنطقيّ للأرشفة أيضًا (undelete)", () => {
  for (const fn of ["prodops_guard_crew", "prodops_guard_equipment"]) {
    const b = funcBody(fn);
    // الاختصار مشروط بأن يكون الصفّ القديم غير مؤرشف: إحياء صفّ مؤرشف يُفحص.
    assert.match(b, /if tg_op = 'UPDATE' then\s*\n[\s\S]{0,200}?old\.is_deleted = false/,
      `${fn} يسمح بإحياء صفّ مؤرشف بلا فحص`);
    // ولا يُلمَس OLD خارج فرع UPDATE (يرفع خطأً يُسقط كلّ إدراج)
    assert.doesNotMatch(b, /tg_op = 'UPDATE' and[\s\S]{0,200}old\./,
      `${fn} يلمس OLD في تعبير واحد مع tg_op — غير آمن في INSERT`);
    assert.match(b, /if new\.is_deleted then return new; end if;/,
      `${fn} يفحص صفًّا يُؤرشَف — رفضٌ بلا معنى`);
  }
});

test("رمز الرفض مميّز ومترجَم: 23P01 لا يُخلط بـ«ممنوع» ولا يُبتلع", () => {
  for (const [fn] of GUARDS) {
    const b = funcBody(fn);
    assert.match(b, /errcode = '23P01'/, `${fn} بلا رمز خطأ مميّز`);
    assert.match(b, /ops_double_booking:/, `${fn} بلا رسالة رفض واضحة`);
    assert.match(b, /الحجز المزدوج ممنوع/, `${fn} بلا رسالة عربية`);
  }
  for (const fn of ["prodops_child_upsert", "prodops_job_upsert", "prodops_job_set_status"]) {
    const b = funcBody(fn);
    assert.match(b, /exception when sqlstate '23P01' then/, `${fn} لا تترجم الرفض`);
    assert.match(b, /'reason','double_booked'/, `${fn} بلا سبب مقروء آليًّا`);
    // ولا مصيدة عامّة: «ممنوع» يجب أن يبقى ممنوعًا لا أن يُعاد كـok:false غامض
    assert.doesNotMatch(b, /exception\s+when\s+others/i, `${fn} تبتلع كلّ الأخطاء`);
  }
});

test("الحرّاس والكواشف لا تُنفَّذ من الواجهة", () => {
  const revoked = SQL.slice(SQL.indexOf("§12)"));
  for (const sig of [
    "prodops_person_clash(uuid,uuid,timestamptz,timestamptz)",
    "prodops_asset_clash(uuid,uuid,timestamptz,timestamptz)",
    "prodops_location_clash(uuid,uuid,timestamptz,timestamptz)",
    "prodops_guard_crew()", "prodops_guard_equipment()", "prodops_guard_job()",
  ]) {
    assert.ok(revoked.includes(`'public.${sig}'`), `${sig} خارج قائمة السحب الداخلية`);
  }
  // ولا تظهر في قائمة المنح لـauthenticated
  const grantBlock = revoked.slice(0, revoked.indexOf("(ب)"));
  for (const n of ["prodops_guard_crew", "prodops_person_clash"]) {
    assert.ok(!grantBlock.includes(n), `${n} مُنِح لدور الواجهة`);
  }
});

test("الحرّاس SECURITY DEFINER بمسار بحث مثبَّت", () => {
  for (const fn of ["prodops_guard_crew", "prodops_guard_equipment", "prodops_guard_job",
    "prodops_person_clash", "prodops_asset_clash", "prodops_location_clash"]) {
    const d = funcDecl(fn);
    assert.match(d, /security definer/i, `${fn} ليست SECURITY DEFINER`);
    assert.match(d, /set search_path = public/i, `${fn} بلا مسار بحث مثبَّت`);
  }
});

test("SELF-TEST يثبت وجود المنع، ولا يمرّ إن حُذف الحارس", () => {
  const st = SQL.match(/do \$st\$[\s\S]*?end \$st\$;/)[0];
  assert.match(st, /from pg_trigger g/, "لا فحص لوجود المُشغِّلات");
  assert.match(st, /trg_ops_crew_no_double_booking/, "مُشغِّل الطاقم خارج self-test");
  assert.match(st, /trg_ops_equip_no_double_booking/, "مُشغِّل المعدّات خارج self-test");
  assert.match(st, /trg_ops_job_no_double_booking/, "مُشغِّل المهمّة خارج self-test");
  assert.match(st, /مُشغِّل منع الحجز المزدوج % غائب/, "الفحص لا يرفع خطأً مفهومًا");
  assert.match(st, /prodops_person_clash\(ZERO, ZERO/, "لا تشغيل حيّ للكاشف على قاعدة فارغة");
});

test("POSTCHECK يكشف تعطيل الحارس بعد التشغيل", () => {
  const post = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "..", "docs/operations_center_POSTCHECK.sql"), "utf8");
  assert.match(post, /tgenabled/, "لا فحص لحالة تفعيل المُشغِّل — تعطيله يمرّ صامتًا");
  assert.match(post, /trg_ops_job_no_double_booking/, "المُشغِّلات خارج POSTCHECK");
  assert.match(post, /has_function_privilege\('authenticated'[\s\S]{0,120}/,
    "لا فحص لتسريب الحرّاس إلى دور الواجهة");
});
