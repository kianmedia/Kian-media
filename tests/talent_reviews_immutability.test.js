// ════════════════════════════════════════════════════════════════════════════
// tests/talent_reviews_immutability.test.js — التقييمات.
// لا تقييم ذاتيّ · لا تعديل بعد الإقفال · ★ لا حذف إطلاقًا ★ · التصحيح مُلحَق
// ومُدقَّق · تقييم واحد لا يحظر · لا ترتيب قبل العيّنة الدنيا.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const { SQL, funcBody, tableDef, API_FNS } = require("./talent_helpers.js");

test("حقول التقييم المطلوبة كلّها موجودة", () => {
  const def = tableDef("tvn_reviews");
  for (const c of ["quality", "attendance", "timeliness", "safety", "communication",
                   "equipment_handling", "client_conduct", "notes", "incident_reported",
                   "incident_severity", "would_rehire", "reviewer_id", "review_date"]) {
    assert.match(def, new RegExp(`\\b${c}\\b`), `حقل التقييم ${c} مفقود`);
  }
  assert.match(def, /between 1 and 5/, "الدرجات بلا نطاق");
});

test("★ لا أحد يقيّم نفسه ★", () => {
  const body = funcBody("tvn_review_submit");
  assert.match(body, /select linked_user_id into v_linked/, "لا فحص لهويّة المُقيَّم");
  assert.match(body, /v_linked = auth\.uid\(\)/, "الفحص لا يقارن بالمستخدم الحاليّ");
  assert.match(body, /self_review_blocked/, "الرفض بلا أثر مُدقَّق");
});

test("التقييم بعد إغلاق المهمّة فقط", () => {
  const body = funcBody("tvn_review_submit");
  assert.match(body, /a\.status not in \('completed','closed'\)/,
    "يمكن تقييم مهمّة لم تُغلَق بعد");
});

test("★ الحارس يمنع التعديل بعد الإقفال ويمنع الحذف دائمًا ★", () => {
  const trg = funcBody("tvn_review_immutable");
  assert.match(trg, /if tg_op = 'DELETE' then/, "الحذف غير ممنوع");
  assert.match(trg, /old\.status = 'closed'/, "التعديل بعد الإقفال مسموح");
  assert.equal((trg.match(/raise exception/g) || []).length, 2,
    "أحد المنعين بلا استثناء يوقفه");
  assert.match(SQL, /create trigger trg_tvn_review_immutable\s+before update or delete on public\.tvn_reviews/,
    "الحارس غير مربوط بـupdate و delete معًا");
  assert.match(SQL, /for each row execute function public\.tvn_review_immutable\(\)/,
    "الحارس على مستوى العبارة لا الصفّ — سيمرّ الحذف الجماعيّ");
});

test("لا توجد في الحزمة أيّ دالّة تحذف تقييمًا", () => {
  for (const f of API_FNS) {
    assert.doesNotMatch(f, /review.*delete|delete.*review/i, `دالّة حذف تقييم: ${f}`);
  }
  assert.doesNotMatch(SQL, /delete from public\.tvn_reviews/i,
    "★ خرق ★ مسار حذف تقييم داخل الترحيلة");
  assert.doesNotMatch(SQL, /delete from public\.tvn_review_corrections/i,
    "مسار حذف تصحيح — إخفاء الأثر بخطوتين");
  assert.doesNotMatch(SQL, /delete from public\.tvn_incident_flags/i,
    "مسار حذف علم حادثة");
  assert.doesNotMatch(SQL, /delete from public\.tvn_audit/i, "مسار حذف تدقيق");
});

test("التصحيح يُلحَق بسبب مكتوب ولا يمسّ الصفّ الأصليّ", () => {
  const def = tableDef("tvn_review_corrections");
  assert.match(def, /reason\s+text not null check \(length\(btrim\(reason\)\) >= 20\)/,
    "التصحيح يقبل سببًا فارغًا");
  assert.match(def, /old_value/, "القيمة القديمة لا تُحفَظ — التصحيح بلا مرجع");
  assert.match(def, /corrected_by\s+uuid not null/, "المصحِّح مجهول");

  const body = funcBody("tvn_review_correct");
  assert.match(body, /insert into public\.tvn_review_corrections/, "التصحيح لا يُلحَق");
  assert.doesNotMatch(body, /update public\.tvn_reviews\s+set (quality|attendance|notes)/,
    "★ خرق ★ التصحيح يعيد كتابة التقييم الأصليّ");
  assert.match(body, /p_field not in \(/, "أيّ حقل قابل للتصحيح، بما فيه الحالة");
});

test("★ تقييم واحد لا يحظر أحدًا تلقائيًّا ★", () => {
  const body = funcBody("tvn_review_submit");
  assert.doesNotMatch(body, /update public\.tvn_profiles[\s\S]{0,120}status\s*=/,
    "★ خرق ★ التقييم يغيّر حالة الملفّ");
  // الحادثة تُرفَع كعلَم للمراجعة البشرية فقط.
  assert.match(body, /insert into public\.tvn_incident_flags/, "الحادثة لا تُسجَّل أصلًا");
  // الحظر قرار بشريّ بسبب مكتوب.
  const status = funcBody("tvn_profile_set_status");
  assert.match(status, /length\(btrim\(coalesce\(p_reason, ''\)\)\) < 10/,
    "الحظر بلا سبب مكتوب");
  assert.match(status, /can_manage_talent_profiles\(\)/, "الحظر بلا بوّابة");
});

test("لا ترتيب قبل العيّنة الدنيا، ولا صفر مكان «غير متاح»", () => {
  const body = funcBody("tvn_rating");
  assert.match(body, /rating_min_sample/, "لا حدّ أدنى للعيّنة");
  assert.match(body, /'ranked', false, 'reason', 'insufficient_sample'/,
    "العيّنة الناقصة لا تُعلَن صراحةً");
  assert.match(body, /'sample', v_n/, "حجم العيّنة غير مُرجَع");
  assert.doesNotMatch(body, /'overall', 0\b/, "صفر يقف مقام «لا يوجد تقييم»");
  assert.match(tableDef("tvn_settings"), /rating_min_sample\s+int\s+not null default 3/,
    "الحدّ الأدنى ليس ٣");
});

test("الإقفال يمرّ مرّة واحدة ويُدقَّق، وإعادته لا تفشل", () => {
  const body = funcBody("tvn_review_close");
  assert.match(body, /if r\.status = 'closed' then/, "إعادة الإقفال ستصطدم بالحارس");
  assert.match(body, /'already', true/, "لا تصريح بأنّ الإقفال سبق");
  assert.match(body, /tvn_log\('review_close'/, "الإقفال بلا تدقيق");
});

test("تقييم واحد لكلّ مُقيِّم لكلّ مهمّة", () => {
  assert.match(tableDef("tvn_reviews"), /unique \(assignment_id, reviewer_id\)/,
    "المُقيِّم يستطيع تكرار تقييمه لرفع المتوسّط");
});
