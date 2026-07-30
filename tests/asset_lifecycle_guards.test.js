// ════════════════════════════════════════════════════════════════════════════
// tests/asset_lifecycle_guards.test.js — ما يجب أن يكون **مستحيلًا** على الخادم.
//
// آلة الحالة والعهدة والحجز. كلّ اختبار هنا يقابل حالة قال العقد إنّها لا تحدث:
// متاح ومصروف معًا · حجز أصل مخرَّد أو مفقود · صرف أصل في الصيانة · صرف أصل
// محجوز لغيره · صرف الأصل نفسه لشخصين · إغلاق عهدة بلا فحص إرجاع · اعتماد
// الموظّف إغلاق عهدته · تحرير التاريخ بعد الإغلاق.
//
// الحراسة **على الجداول** لا داخل RPC واحدة: للـinspect_return أربعة تعاريف في
// المستودع وآخر ملفّ يُشغَّل يفوز، ولـcreate_reservation نسخة v1 مُصرَّحة تتجاوز
// أيّ ضمان يُكتب داخل v2 وحدها.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CODE, funcBody, ASSET_STATES, stripComments, SQL,
  selfTest, PREFLIGHT, POSTCHECK, ROLLBACK,
} = require("./asset_helpers.js");

// ─── آلة الحالة ─────────────────────────────────────────────────────────────

test("★ الحالات العشر كلّها مُشتقّة في civ_asset_state", () => {
  const body = funcBody("civ_asset_state");
  assert.ok(body, "دالّة الحالة غائبة");
  for (const s of ASSET_STATES) {
    assert.ok(body.includes(`'${s}'`), `الحالة ${s} غير مُشتقّة`);
  }
});

test("★★ «متاح ومصروف في آن واحد» مستحيل: الترتيب يفصل الحالتين", () => {
  const body = funcBody("civ_asset_state");
  const iOut = body.indexOf("return 'checked_out'");
  const iAvail = body.indexOf("return 'available'");
  assert.ok(iOut > -1 && iAvail > -1, "الحالتان غير مُشتقّتين");
  assert.ok(iOut < iAvail,
    "«متاح» تُحسم قبل «مصروف» — أصل عليه عهدة حيّة قد يظهر متاحًا");
  assert.match(body, /quantity_available[\s\S]{0,40}>\s*0[\s\S]{0,40}return 'available'/,
    "«متاح» لا تشترط كمّية متاحة فعليّة");
});

test("★★ الحالة النهائية أوّلًا: مخرَّد ومتقاعد ومفقود تسبق أيّ اشتقاق تشغيليّ", () => {
  const body = funcBody("civ_asset_state");
  const iDisposed = body.indexOf("'disposed'");
  const iInUse = body.indexOf("'in_use'");
  assert.ok(iDisposed > -1 && iDisposed < iInUse,
    "أصل مخرَّد قد يُشتقّ «قيد الاستخدام»");
});

test("★ الانتقالات المسموحة مُعلَنة للشاشة (تكفّ عن التخمين)", () => {
  const body = funcBody("civ_allowed_transitions");
  assert.ok(body, "خريطة الانتقالات غائبة");
  for (const e of ["asset", "assignment", "reservation"]) {
    assert.ok(body.includes(`'${e}'`), `لا انتقالات لكيان ${e}`);
  }
  assert.match(body, /'disposed'\s*then\s*'\[\]'/, "المخرَّد ينتقل إلى شيء — التخريد نهائيّ");
  assert.match(body, /coalesce\(/, "قد تعيد NULL بدل مصفوفة فارغة");
});

test("★ الحالة مُشتقّة لا مخزّنة (لا عمود ينحرف عن الواقع)", () => {
  const code = stripComments(SQL);
  assert.doesNotMatch(code, /add column if not exists\s+(asset_state|lifecycle_state)\b/i,
    "الحالة مخزّنة كعمود");
});

// ─── العهدة ────────────────────────────────────────────────────────────────

test("★★★ لا أحد يعتمد إغلاق عهدته بنفسه — حارس على الجدول", () => {
  const body = funcBody("civ_guard_assignment_closure");
  assert.ok(body, "الحارس غائب");
  assert.match(body, /new\.status = 'returned'/, "الحارس لا يمسك لحظة الإغلاق");
  assert.match(body, /auth\.uid\(\) = new\.employee_user_id/, "الحارس لا يقارن الفاعل بصاحب العهدة");
  assert.match(body, /coalesce\(/, "المقارنة قد تعيد NULL فيُتخطّى الحارس");
  assert.match(CODE, /create trigger trg_civ_guard_assignment_closure[\s\S]{0,160}custody_inventory_assignments/i,
    "الحارس ليس مركّبًا على جدول العهدة");
});

test("★★ الحارس على **الجدول** لا داخل RPC واحدة", () => {
  // للـinspect_return أربعة تعاريف في المستودع وآخر ملفّ يُشغَّل يفوز؛ المُشغِّل
  // يمسك المسارات الأربعة معًا.
  assert.match(CODE, /before update on public\.custody_inventory_assignments/i,
    "لا مُشغِّل قبل التحديث على جدول العهدة");
});

test("★★ تاريخ العهدة المغلقة لا يُحرَّر بصمت", () => {
  const body = funcBody("civ_guard_assignment_history");
  assert.match(body, /old\.status in \('returned','cancelled','rejected'\)/,
    "الحارس لا يعرف متى تُغلق العهدة");
  for (const f of ["ack_snapshot", "ack_name", "ack_ip", "issued_at", "employee_user_id"]) {
    assert.ok(body.includes(f), `حقل الإقرار ${f} قابل للتحرير بعد الإغلاق`);
  }
});

test("★★ التصحيح بعد الإغلاق **حدث** مُدقَّق لا تعديل صامت", () => {
  const body = funcBody("custody_inv_post_closure_correction");
  assert.match(body, /assignment_not_closed/, "يُسمح بالتصحيح قبل الإغلاق فيلتبس بالتعديل العاديّ");
  assert.match(body, /manual_correction/, "التصحيح لا يكتب حركة في الدفتر");
  assert.match(body, /custody_audit/, "التصحيح بلا تدقيق");
  assert.match(body, /civ_self_correction_denied/, "الموظّف يصحّح عهدته بنفسه");
  assert.match(body, /length\(btrim\(coalesce\(p_reason,''\)\)\) < 10/, "تصحيح بلا سبب مكتوب");
});

test("★★ مسار الدليل الأصليّ لا يُعاد كتابته (تبقى «قبل/بعد»)", () => {
  const body = funcBody("civ_guard_evidence_path");
  assert.match(body, /new\.file_path is distinct from old\.file_path/, "المسار قابل للتبديل");
  assert.match(CODE, /create trigger trg_civ_guard_evidence_path[\s\S]{0,160}custody_inventory_evidence/i,
    "الحارس ليس على جدول الأدلّة");
});

test("★★ لا تخريد لأصل على عهدة حيّة، والحارس لا ينهار إلى NULL", () => {
  const body = funcBody("civ_guard_asset_disposal");
  assert.match(body, /disposal_date is not null and old\.disposal_date is null/, "لا يمسك لحظة التخريد");
  assert.match(body, /status in \('pending','active','return_requested','disputed'\)/,
    "لا يعرف ما هي العهدة الحيّة");
  assert.match(body, /v_disposing := coalesce/, "قد يُتخطّى بصمت عند NULL");
  assert.match(body, /v_retiring\s*:= coalesce/, "قد يُتخطّى بصمت عند NULL");
});

test("★ حارس التخريد مضبوط: الأصل الكمّيّ يجوز تقاعد بعض وحداته", () => {
  // الحظر الأعمى كان سيكسر إغلاق الصيانة القائم الذي يتقاعد جزءًا من الكمّية.
  const body = funcBody("civ_guard_asset_disposal");
  assert.match(body, /new\.asset_type = 'serialized'/,
    "الحارس يمنع تقاعد وحدة من أصل كمّيّ — يكسر مسارًا سليمًا قائمًا");
});

// ─── الحجز ─────────────────────────────────────────────────────────────────

test("★★★ الحجز محروس على الجدول — v1 المُصرَّحة لا تتجاوزه", () => {
  // custody_inv_admin_create_reservation (v1) مُصرَّحة لـauthenticated ولا تفحص
  // أيّ حجز آخر. ضمانٌ يُكتب داخل v2 وحدها يبقى قابلًا للتجاوز بنداء v1.
  assert.match(CODE,
    /create trigger trg_civ_guard_reservation\s+before insert or update on public\.custody_inventory_reservations/i,
    "الحارس ليس على الجدول — v2 وحدها لا تكفي");
  assert.doesNotMatch(CODE, /create or replace function public\.custody_inv_admin_create_reservation\s*\(/i,
    "الحزمة تُعيد تعريف v1 في مكانها (تحذير التدقيق الصريح)");
});

test("★★★ تعارض الحجز يرفع 23P01 — تعارضٌ لا ترحيلة ناقصة", () => {
  const guard = funcBody("civ_guard_reservation");
  assert.match(guard, /errcode = '23P01'/, "التعارض بلا رمز مميّز فيُقرأ «ترحيلة ناقصة»");
  assert.match(guard, /hint = v_code/, "التعارض بلا تلميح يشرح مصدره");
  const v2 = funcBody("custody_inv_admin_create_reservation_v2");
  assert.match(v2, /errcode = '23P01'/, "v2 ترفع رمزًا مختلفًا عن الحارس");
});

test("★★ حالة الأصل تمنع الحجز: مخرَّد ومتقاعد ومفقود وفي الصيانة", () => {
  const body = funcBody("civ_reservation_conflict");
  for (const [state, needle] of [
    ["مخرَّد", "state:disposed"], ["متقاعد", "state:retired"],
    ["مفقود", "state:missing"], ["في الصيانة", "state:maintenance"],
  ]) {
    assert.ok(body.includes(needle), `حجز أصل ${state} ممكن`);
  }
  // رفض «الحالة» يجب أن يصل بالواجهة برمز غير رمز التعارض: الأوّل «لا يصلح
  // هذا الأصل أصلًا»، والثاني «الأصل صالح لكنّ النافذة مزدحمة». خلطهما يجعل
  // المستخدم يجرّب نافذة أخرى لأصل مخرَّد.
  for (const fn of ["civ_guard_reservation", "custody_inv_admin_create_reservation_v2"]) {
    assert.match(funcBody(fn), /errcode = '23514'/, `${fn}: رفض الحالة يُخلط برفض التعارض`);
  }
});

test("★★★ reserved_from محترَم فعلًا — حجز الشهر القادم لا يمنع اليوم", () => {
  const body = funcBody("civ_reservation_conflict");
  // النافذتان تُبنَيان بالبانية الآمنة (civ_window) بدل tstzrange الخام، والمعنى
  // نفسه: التقاطع يُحسب بالنافذتين معًا فلا يزاحم حجزُ الشهر القادم حجزَ اليوم.
  assert.match(
    body,
    /civ_window\(r\.reserved_from, r\.reserved_to\)\s*&&\s*(public\.)?civ_window\(p_from, p_to\)/,
    "التقاطع لا يُحسب بالنافذتين — هذا هو عطل التدقيق §7-٢ بعينه",
  );
});

test("★★ التداخل يُحسب بالكمّية لا بالوجود: مجموع الحجوزات + العهدة ≤ الإجمالي", () => {
  const body = funcBody("civ_reservation_conflict");
  assert.match(body, /sum\(r\.quantity\)/, "الحجوزات المتداخلة لا تُجمع");
  assert.match(body, /sum\(i\.quantity - i\.quantity_returned\)/, "العهدة الحيّة لا تُخصم");
  assert.match(body, /> coalesce\(ast\.quantity_total,\s*0\)/, "لا مقارنة بالإجمالي");
});

test("★★ العهدة الحيّة تزاحم الحجز، والصرف لصاحب الحجز نفسه لا يزاحمه", () => {
  const body = funcBody("civ_reservation_conflict");
  assert.match(body, /p_employee is null or a\.employee_user_id is distinct from p_employee/,
    "صاحب الحجز يُزاحم نفسه");
});

test("★★ عهدة بلا موعد عودة نافذة مفتوحة — لا تُحجَز لأحد", () => {
  const body = funcBody("civ_reservation_conflict");
  // expected_return_at فارغ ⇒ civ_window تُمرّر NULL إلى tstzrange كما هو، فتبقى
  // النافذة مفتوحة إلى ما لا نهاية وتزاحم فعلًا. (التبديل مشروط بوجود الحدّين،
  // فلا يحوّل الطرف المفتوح إلى نطاق فارغ — وهذا ما يحرسه اختبار البانية.)
  assert.match(body, /civ_window\(a\.issued_at, a\.expected_return_at\)/,
    "نافذة العهدة غير محسوبة — الكاميرا المصروفة بلا موعد قد تُحجَز");
});

test("★★★ لا مصيدة شاملة تحوّل «تعارض» إلى «لا تعارض»", () => {
  const body = funcBody("civ_reservation_conflict");
  assert.doesNotMatch(body, /exception\s+when\s+others\s+then\s+return\s+null/i,
    "ابتلاع الخطأ يجعل المحرّك يدّعي خلوّ الأصل — أسوأ من غياب المحرّك");
});

test("★★ يستهلك عقد prodops القائم ولا يخترع قاعدة تعارض ثانية", () => {
  const body = funcBody("civ_reservation_conflict");
  assert.match(body, /prodops_asset_clash/, "لا استشارة لعقد prodops");
  assert.match(body, /to_regprocedure\('public\.prodops_asset_clash/,
    "الاستدعاء غير مكتشَف — ينهار حين تغيب prodops");
  assert.match(body, /'equipment:'/, "شكل الـhint يخالف عقد prodops");
});

test("★ التقويم يُصرّح بما يراه المحرّك وما لا يراه", () => {
  // ثلاثة تقاويم على المعدّة نفسها (§9.3): ادّعاء الشمول أخطر من الاعتراف بالحدّ.
  const body = funcBody("custody_inv_reservation_calendar");
  assert.match(body, /'coverage'/, "التقويم لا يُعلن تغطيته");
  assert.match(body, /'planning_bookings',\s*false/, "التقويم يدّعي تغطية حجوزات التخطيط");
});

test("★★ الإتمام والانقضاء يحوّلان الحالة ولا يحذفان الصفّ", () => {
  const ful = funcBody("custody_inv_fulfil_reservation");
  assert.match(ful, /status = 'fulfilled'/, "الحالة fulfilled ما زالت بلا كاتب");
  assert.match(ful, /assignment_does_not_cover_asset/,
    "يمكن ربط الحجز بصرف لا يحوي الأصل أصلًا");
  const exp = funcBody("custody_inv_expire_reservations");
  assert.match(exp, /set status = 'expired'/, "الانقضاء لا يحوّل الحالة");
  assert.doesNotMatch(exp, /delete from/i, "الانقضاء يحذف الأثر");
});

test("★ الإلغاء لا يُحرَس (إغلاق صفّ متعارض قائم يبقى ممكنًا)", () => {
  const body = funcBody("civ_guard_reservation");
  assert.match(body, /if new\.status <> 'active' then return new/,
    "الحارس يمنع إلغاء حجز متعارض قائم — يقفل الصفّ إلى الأبد");
});

// ─── النافذة الزمنيّة المقلوبة — 22000 يقتل الحارس نفسه ─────────────────────
// tstzrange(lo, hi) ترفع 22000 حين hi < lo. والحزمة **تتعمّد** إبقاء صفوف مقلوبة:
// civ_resv_window_chk أُضيف NOT VALID، والبوّاب يوقف على الحجز النشط المقلوب فقط
// (فلا يُعاد كتابة تاريخ ملغى إرضاءً لقيد جديد). أي أنّ وجود الصفّ المقلوب وعدٌ
// صريح — فقراءته الخام عطلٌ مضمون لا احتمال.
// الأثر لو عاد الشكل الخام: تقويم الحجز يقرأ كلّ الحالات (لا يصفّي status) فيسقط
// على أوّل حجز ملغى مقلوب؛ ومحرّك التعارض يقرأ نافذة العهدة، فصفّ عهدة
// بـexpected_return_at أقدم من issued_at (سجلّ ورقيّ مُرحَّل، أو سنة مطبوعة خطأً)
// يجعل **كلّ** حجز على ذلك الأصل يفشل برمز لا يصنّفه lib/portal/pgerror.ts.

test("★★★ بانية النافذة الآمنة موجودة وتحفظ دلالة NULL", () => {
  const body = funcBody("civ_window");
  assert.ok(body, "civ_window غائبة — النوافذ الزمنيّة بلا حماية من 22000");
  // التبديل مشروط بوجود الحدّين: NULL يعني «مفتوح» ويجب أن يبقى مفتوحًا.
  assert.match(body, /p_lo is not null and p_hi is not null and p_hi < p_lo/,
    "شرط التبديل لا يتحقّق من وجود الحدّين — NULL سيُعامَل كقيمة");
  assert.match(body, /tstzrange\(p_hi, p_lo\)/, "الحدّ المقلوب لا يُطبَّع");
  assert.match(body, /tstzrange\(p_lo, p_hi\)/, "المسار الطبيعي مفقود");
  // least/greatest تتجاهل NULL فتحوّل حجزًا مفتوح الطرف إلى نطاق فارغ.
  assert.doesNotMatch(body, /least\(|greatest\(/i,
    "least/greatest تتجاهلان NULL ⇒ نافذة مفتوحة تصير فارغة ولا تتقاطع مع شيء");
});

test("★★★ لا مستهلك حسّاس يقرأ نافذة حيّة بـtstzrange الخام", () => {
  const consumers = [
    "civ_reservation_conflict",
    "custody_inv_reservation_calendar",
    "civ_asset_state",
    "custody_inv_asset_utilization",
  ];
  for (const fn of consumers) {
    const body = funcBody(fn);
    assert.ok(body, `${fn} غائبة`);
    assert.match(body, /civ_window\(/,
      `${fn} لا تمرّ بالبانية الآمنة`);
    // أيّ tstzrange خام متبقٍّ على أعمدة الجداول الحيّة = الثغرة نفسها عائدة.
    const raw = body.match(/tstzrange\(/g) || [];
    assert.equal(raw.length, 0,
      `${fn} ما زالت تحوي ${raw.length} نداء tstzrange خام — صفّ مقلوب سيرفع 22000`);
  }
});

test("★★ الفحص الذاتي وPOSTCHECK يحرسان عودة tstzrange الخام", () => {
  assert.match(selfTest(), /civ_window/,
    "الفحص الذاتي لا يتحقّق من البانية الآمنة");
  assert.match(POSTCHECK, /civ_window/,
    "POSTCHECK لا يتحقّق من البانية الآمنة");
});

test("★★ PREFLIGHT لا ينهار هو نفسه على الصفّ المقلوب قبل رسالته الواضحة", () => {
  // استعلام التداخل يسبق كتلة البوّابة في الملفّ، فلو قرأ الحدّ الخام لأُجهض
  // الفحص بـ22000 غامض بدل تعليمات التصحيح العربيّة.
  const overlap = /existing_overlapping_active_reservations[\s\S]*?;/.exec(PREFLIGHT);
  assert.ok(overlap, "استعلام التداخل غائب من PREFLIGHT");
  assert.match(overlap[0], /case when[\s\S]*?reserved_to < r1\.reserved_from/,
    "استعلام التداخل ما زال على الحدّ الخام");
  assert.doesNotMatch(overlap[0], /least\(|greatest\(/i,
    "least/greatest تُفقد النوافذ المفتوحة فيطمئن المشغّل إلى عدّ ناقص");
  // ويقيس المقلوب في الجدولين اللذين لا يوقف عليهما، للعلم لا للإفشال.
  assert.match(PREFLIGHT, /inverted_custody_windows_informational/,
    "نوافذ العهدة المقلوبة لا تُقاس");
  assert.match(PREFLIGHT, /inverted_maintenance_windows_informational/,
    "نوافذ الصيانة المقلوبة لا تُقاس");
});

test("★ ROLLBACK يحذف البانية ولا يدّعي أنّ الترتيب يحميه", () => {
  assert.match(ROLLBACK, /drop function if exists public\.civ_window\(timestamptz,timestamptz\)/,
    "ROLLBACK يترك البانية خلفه");
  assert.match(ROLLBACK, /توثيقيًّا/,
    "ROLLBACK يوحي بأنّ ترتيب الحذف يفرضه المحرّك — وهو لا يفعل لأجسام الدوالّ");
});
