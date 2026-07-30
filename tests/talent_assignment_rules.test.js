// ════════════════════════════════════════════════════════════════════════════
// tests/talent_assignment_rules.test.js — الاقتراح والإسناد.
// قاعديّ لا ذكيّ · لا إسناد تلقائيّ · موانع صلبة · إعادة فحص عند التأكيد ·
// حدّ اعتماد · من يقترح لا يعتمد.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const { SQL, funcBody, funcDecl, tableDef, HARD_BLOCKERS } = require("./talent_helpers.js");

test("★ المحرّك قاعديّ ولا يُسند تلقائيًّا ★", () => {
  const body = funcBody("tvn_suggest");
  assert.match(body, /'engine', 'rule_based'/, "المحرّك لا يصرّح بأنّه قاعديّ");
  assert.match(body, /'auto_assign', false/, "لا تصريح صريح بعدم الإسناد التلقائيّ");
  assert.doesNotMatch(body, /insert into public\.tvn_assignments/i,
    "★ خرق ★ محرّك الاقتراح يكتب إسنادًا");
  assert.doesNotMatch(body, /update public\.tvn_assignments/i,
    "★ خرق ★ محرّك الاقتراح يعدّل إسنادًا");
  assert.match(funcDecl("tvn_suggest"), /\bstable\b/i,
    "دالّة الاقتراح ليست stable — يعني أنّها قد تكتب");
});

test("عوامل الاقتراح الثمانية معلنة وقابلة للتفسير", () => {
  const body = funcBody("tvn_suggest");
  for (const rule of ["profession", "city_exact", "coverage_city", "skills",
                      "available_window", "equipment_owned", "rating", "within_price_band"]) {
    assert.match(body, new RegExp(`'rule', '${rule}'`), `العامل ${rule} مفقود`);
  }
  assert.match(body, /'reasons', v_reasons/, "الأسباب غير مُرجَعة — الترتيب غير قابل للتفسير");
  assert.match(body, /'blockers', v_blockers/, "الموانع غير مُرجَعة");
});

test("المحجوبون في الذيل، والقصّ بعد الترتيب لا قبله", () => {
  const body = funcBody("tvn_suggest");
  const orderIdx = body.indexOf("order by (el ->> 'assignable')::boolean desc");
  const limitIdx = body.indexOf("limit v_limit");
  assert.ok(orderIdx > 0, "لا فرز يضع المحجوبين في الذيل");
  assert.ok(limitIdx > orderIdx, "القصّ قبل الترتيب — يُخفي الأفضل بالصدفة");
});

test("الموانع الصلبة الأربعة داخل الحارس", () => {
  const guard = funcBody("tvn_assignment_guard");
  for (const b of HARD_BLOCKERS) {
    assert.match(guard, new RegExp(`'rule', '${b}'`), `المانع ${b} غائب عن الحارس`);
  }
  assert.match(guard, /'ok', \(jsonb_array_length\(v_blk\) = 0\)/,
    "الحارس لا يُرجع حكمًا صريحًا");
});

test("الحارس يفشل مغلقًا: ملفّ مجهول أو تواريخ ناقصة = منع", () => {
  const guard = funcBody("tvn_assignment_guard");
  assert.match(guard, /profile_not_found/, "ملفّ غير موجود يمرّ");
  const conflict = funcBody("tvn_has_conflict");
  assert.match(conflict, /if p_profile is null or p_starts is null or p_ends is null then return true/,
    "غياب التواريخ يُقرأ «لا تعارض» — وهذا فتح لا منع");
  assert.match(conflict, /exception when others then return true/,
    "خطأ داخل كاشف التعارض يُترجَم إلى سماح");
});

test("★ التأكيد يعيد الفحص كاملًا ويقفل الصفّ ★", () => {
  const confirm = funcBody("tvn_assignment_confirm");
  assert.match(confirm, /tvn_assignment_guard\(/,
    "التأكيد يثق بفحص الاقتراح — وثيقة قد تكون انتهت بين اللحظتين");
  assert.match(confirm, /for update/, "بلا قفل صفّ: تأكيدان متزامنان يمرّان معًا");
  const propose = funcBody("tvn_assignment_propose");
  assert.match(propose, /tvn_assignment_guard\(/, "الاقتراح بلا حارس");
  assert.match(propose, /for update/, "الاقتراح بلا قفل");
});

test("حدّ الاعتماد يأتي من الإعدادات لا من المُدخِل", () => {
  const body = funcBody("tvn_assignment_propose");
  assert.match(body, /select cost_approval_threshold into v_thr from public\.tvn_settings/,
    "الحدّ لا يُقرأ من الإعدادات");
  assert.doesNotMatch(body, /tvn_num\(p_input, 'threshold'\)/, "الحدّ يُمرَّر من المُدخِل");
  assert.match(body, /v_needs_approval := coalesce\(v_cost, 0\) > v_thr/, "لا احتساب للحدّ");
  assert.match(body, /pending_approval/, "لا حالة انتظار اعتماد");
});

test("التأكيد قبل الاعتماد مستحيل حين تتجاوز التكلفة الحدّ", () => {
  const confirm = funcBody("tvn_assignment_confirm");
  assert.match(confirm, /if a\.approval_required and a\.status <> 'approved' then/,
    "يمكن تأكيد إسناد مكلف بلا اعتماد");
  assert.match(confirm, /conflict:/, "الرفض لا يُصنَّف تعارضًا");
});

test("من يقترح لا يعتمد اقتراحه", () => {
  const body = funcBody("tvn_assignment_approve");
  assert.match(body, /a\.proposed_by = auth\.uid\(\)/, "لا فحص للاعتماد الذاتيّ");
  assert.match(body, /self_approval_blocked/, "الرفض بلا سبب مُدقَّق");
  assert.match(body, /tvn_can_approve_cost\(\)/, "الاعتماد بلا مفتاح مستقلّ");
});

test("الأجر لا يخرج لغير المخوَّل من محرّك الاقتراح — null لا صفر", () => {
  const body = funcBody("tvn_suggest");
  assert.match(body, /'day_rate', case when public\.can_view_vendor_rates\(\) then v_day else null end/,
    "الرقم يخرج بلا بوّابة، أو يُستبدل بصفر");
  assert.match(body, /'rate_visible', public\.can_view_vendor_rates\(\)/,
    "لا علم رؤية صريح — null بلا تفسير يُقرأ «لا سعر»");
  // الترشيح بالسعر يتمّ داخليًّا رغم ذلك.
  assert.match(body, /above_price_band/, "لا ترشيح بالنطاق السعريّ");
});

test("مرجع المشروع للقراءة فقط: لا مفتاح أجنبيّ إلى المنصّة المجمَّدة", () => {
  const def = tableDef("tvn_assignments");
  assert.match(def, /project_id\s+uuid,/, "عمود المشروع مفقود");
  assert.doesNotMatch(def, /project_id[^\n]*references/i,
    "★ خرق التجميد ★ مفتاح أجنبيّ إلى جداول منصّة المشاريع");
  assert.doesNotMatch(SQL, /references public\.(projects|project_core|deliverables)\b/,
    "الحزمة تربط نفسها بجداول المنصّة المجمَّدة");
});

test("لقطة المرشّحين تُحفَظ كي يبقى «لماذا هذا الاسم» قابلًا للجواب", () => {
  const def = tableDef("tvn_assignment_candidates");
  assert.match(def, /reasons\s+jsonb/, "الأسباب لا تُحفَظ");
  assert.match(def, /blockers\s+jsonb/, "الموانع لا تُحفَظ");
  assert.match(funcBody("tvn_assignment_propose"), /insert into public\.tvn_assignment_candidates/,
    "الاقتراح لا يُلقَط مع الإسناد");
});

test("حالات الإسناد الثماني معرَّفة، والإلغاء يحتاج سببًا", () => {
  const def = tableDef("tvn_assignments");
  for (const s of ["proposed", "pending_approval", "approved", "confirmed",
                   "rejected", "cancelled", "completed", "closed"]) {
    assert.match(def, new RegExp(`'${s}'`), `الحالة ${s} مفقودة`);
  }
  assert.match(funcBody("tvn_assignment_cancel"), /length\(btrim\(coalesce\(p_reason, ''\)\)\) < 5/,
    "الإلغاء بلا سبب");
});
