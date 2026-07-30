// ════════════════════════════════════════════════════════════════════════════
// tests/talent_ui_contract.test.js — عقد الطبقة البرمجية.
// الكود يسبق الـSQL · «بانتظار التفعيل» ليست انهيارًا · 23P01 ليس ترحيلة
// ناقصة · لا بيانات وهمية · لا إسناد تلقائيّ من الواجهة.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const { LIB, exists, API_FNS } = require("./talent_helpers.js");

test("الطبقة موجودة وتستعمل عميل البوّابة والمُصنِّف المشترك", () => {
  assert.ok(exists("lib/portal/talentNetwork.ts"), "ملفّ الطبقة مفقود");
  assert.match(LIB, /import \{ prpc, type Result \} from "\.\/client"/, "لا عميل موحّد");
  assert.match(LIB, /from "\.\/pgerror"/, "لا تصنيف أخطاء مشترك");
  assert.doesNotMatch(LIB, /service_role|SUPABASE_SERVICE/, "مفتاح خدمة في المتصفّح");
});

test("★ اكتشاف الميزة: الترحيلة الناقصة تُعرَض ولا تنهار ★", () => {
  assert.match(LIB, /pgIsMigrationPending\(d\)/, "لا اكتشاف لترحيلة معلّقة");
  assert.match(LIB, /الميزة بانتظار تفعيل قاعدة البيانات/, "لا رسالة انتظار تفعيل");
  assert.match(LIB, /state: "pending_migration"/, "لا حالة صريحة للانتظار");
  // خريطة قدرات مغلقة جاهزة كي لا تفترض الواجهة صلاحيات عند الغياب.
  assert.match(LIB, /TVN_ACCESS_CLOSED/, "لا خريطة قدرات مغلقة افتراضيًّا");
  assert.match(LIB, /installed: false, can_view: false/, "الخريطة المغلقة ليست مغلقة فعلًا");
});

test("★ 23P01 تعارض لا ترحيلة ناقصة ★", () => {
  assert.match(LIB, /function isConflict/, "لا كاشف تعارض");
  assert.match(LIB, /d\.code === "23P01"/, "الرمز 23P01 غير مفحوص");
  assert.match(LIB, /state: "conflict"/, "لا حالة تعارض منفصلة");
  // الترتيب يهمّ: التعارض يُفحَص قبل حكم الترحيلة.
  assert.ok(LIB.indexOf("if (isConflict(") < LIB.indexOf("if (pgIsMigrationPending("),
    "التعارض يُفحَص بعد الترحيلة — سيُبتلَع تحت حكم آخر");
  // ولا نوسّع المُصنِّف المشترك من هنا.
  assert.match(LIB, /لا يعرف بعد نوعًا اسمه "conflict"/,
    "الطبقة لا تصرّح بحدود المُصنِّف المشترك");
});

test("الموانع تُترجَم حرفيًّا ولا تُعمَّم إلى «حدث خطأ»", () => {
  for (const b of ["profile_not_assignable", "required_document_invalid",
                   "drone_permit_missing", "schedule_conflict", "above_price_band"]) {
    assert.match(LIB, new RegExp(`${b}:`), `المانع ${b} بلا ترجمة`);
  }
  assert.match(LIB, /state: "blocked"/, "المنع يُخلَط بالخطأ");
  assert.match(LIB, /مانع غير معروف: \$\{rule\}/, "مانع جديد سيُبتلَع صامتًا");
});

test("كلّ دوالّ الواجهة مغطّاة في الطبقة", () => {
  for (const f of API_FNS) {
    assert.match(LIB, new RegExp(`"${f}"`), `الدالّة ${f} بلا غلاف في الطبقة`);
  }
});

test("★ لا مسار في الطبقة يُسند تلقائيًّا ★", () => {
  assert.doesNotMatch(LIB, /candidates\[0\]/, "الطبقة تختار أعلى مرشّح بنفسها");
  assert.doesNotMatch(LIB, /autoAssign|assignBest|pickBest/i, "مسار إسناد تلقائيّ");
  const suggest = LIB.slice(LIB.indexOf("export const tvnSuggest"));
  const proposeIdx = suggest.indexOf("tvnAssignmentPropose");
  assert.ok(proposeIdx > 0, "دالّة الاقتراح غير منفصلة عن الإسناد");
  assert.match(LIB, /auto_assign: false/, "نوع النتيجة لا يثبّت عدم الإسناد التلقائيّ");
});

test("«لا ترتيب بعد» تُعرَض كما هي، ولا تُحوَّل إلى رقم", () => {
  const fn = LIB.slice(LIB.indexOf("export function ratingAr"), LIB.indexOf("export interface TvnProfileRow"));
  assert.match(fn, /insufficient_sample/, "العيّنة الناقصة غير مُعالَجة");
  assert.match(fn, /لا ترتيب بعد/, "لا نصّ صريح لغياب الترتيب");
  assert.doesNotMatch(fn, /return "0"|\|\| 0\b/, "صفر مكان «لا يوجد تقييم»");
});

test("الطبقة تصرّح بأنّ الترقية يدوية ولا تُرسل شيئًا", () => {
  const idx = LIB.indexOf("export const tvnPromoteOpportunity");
  const around = LIB.slice(Math.max(0, idx - 400), idx + 300);
  assert.match(around, /يدويّ بالكامل/, "لا تصريح بيدوية الترقية");
  assert.match(around, /لا رسالة تُرسَل/, "لا تصريح بعدم الإرسال للمتقدّم");
});

test("لا تحويلات وهمية: الطبقة لا تخترع صفوفًا عند الفشل", () => {
  assert.doesNotMatch(LIB, /catch\s*\([^)]*\)\s*\{\s*return\s*\[\]/,
    "خطأ يُترجَم إلى قائمة فارغة — الفشل يُقرأ «لا يوجد»");
  assert.doesNotMatch(LIB, /mock|dummy|fake|placeholderRows/i, "بيانات وهمية في الطبقة");
});
