// ════════════════════════════════════════════════════════════════════════════
// tests/talent_permissions.test.js — البوّابات الستّ وحدودها.
// كلّ مُسنَد fail-closed · الأجر أضيق من الشبكة · البنك أضيق من الأجر ·
// الدوالّ الداخلية محجوبة · لا عميل داخل الشبكة.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  SQL, POSTCHECK, funcBody, funcDecl, doBlock, PREDICATES, API_FNS, INTERNAL_FNS,
} = require("./talent_helpers.js");

test("المُسنَدات الستّة موجودة بأسمائها المتّفق عليها حرفيًّا", () => {
  for (const p of ["can_view_talent_network", "can_manage_talent_profiles",
                   "can_view_vendor_rates", "can_verify_compliance",
                   "can_assign_external_resources", "can_review_resource_performance"]) {
    assert.match(SQL, new RegExp(`create or replace function public\\.${p}\\(\\) returns boolean`),
      `المُسنَد ${p} مفقود أو بتوقيع مختلف`);
  }
});

test("كلّ مُسنَد fail-closed: بلا جلسة لا يمرّ شيء", () => {
  for (const p of PREDICATES) {
    const body = funcBody(p);
    assert.match(body, /exception\s+when\s+others\s+then\s+return\s+false/i,
      `${p} لا يفشل مغلقًا عند الخطأ`);
  }
  // البوّابات الأساسية تشترط جلسة صراحةً.
  for (const p of ["tvn_perm", "tvn_is_staff", "tvn_is_owner"]) {
    assert.match(funcBody(p), /auth\.uid\(\) is null/, `${p} لا يفحص وجود جلسة`);
  }
});

test("لا بوّابة تعتمد على can_manage_projects ولا is_kian_member", () => {
  assert.doesNotMatch(SQL, /can_manage_projects/i, "بوّابة محظورة مستعملة");
  assert.doesNotMatch(SQL, /is_kian_member/i, "بوّابة محظورة مستعملة");
});

test("الأجر أضيق من الشبكة، والبنك أضيق من الأجر — بمفاتيح مستقلّة", () => {
  assert.match(funcBody("can_view_vendor_rates"), /talent\.view_rates/,
    "بوّابة الأجر بلا مفتاح خاصّ بها");
  assert.match(funcBody("tvn_can_view_bank"), /talent\.view_bank/,
    "البيانات البنكية تُشتقّ من مفتاح آخر بدل مفتاح مستقلّ");
  // ولا تُشتقّ إحداهما من الأخرى.
  assert.doesNotMatch(funcBody("tvn_can_view_bank"), /can_view_vendor_rates/,
    "إذن الأسعار يفتح حساب المصرف");
  assert.doesNotMatch(funcBody("can_view_vendor_rates"), /can_view_talent_network/,
    "من يرى الشبكة يرى الأجر");
});

test("سياسات RLS: قراءة فقط، وكلّ جدول له بوّابته الصحيحة", () => {
  const expect = {
    tvn_profiles: "can_view_talent_network",
    tvn_profile_rates: "can_view_vendor_rates",
    tvn_profile_bank: "tvn_can_view_bank",
    tvn_profile_restricted: "can_verify_compliance",
    tvn_reviews: "can_review_resource_performance",
    tvn_review_corrections: "can_review_resource_performance",
    tvn_audit: "tvn_is_owner",
  };
  for (const [table, gate] of Object.entries(expect)) {
    const re = new RegExp(`create policy \\w+ on public\\.${table} for select to authenticated[\\s\\S]{0,240}?${gate}\\(\\)`);
    assert.match(SQL, re, `سياسة ${table} لا تستند إلى ${gate}`);
  }
});

test("كتابة الأجر تحتاج البوّابتين معًا — من لا يرى الرقم لا يكتبه", () => {
  const body = funcBody("tvn_rates_set");
  assert.match(body, /can_view_vendor_rates\(\) and public\.can_manage_talent_profiles\(\)/,
    "كتابة الأجر بشرط واحد فقط");
});

test("كلّ دوالّ الواجهة تُمنَح لـauthenticated، والداخلية لا تُمنَح لأحد", () => {
  const grants = doBlock("grants");
  for (const f of API_FNS) {
    assert.match(grants, new RegExp(`'${f}\\(`), `دالّة الواجهة ${f} خارج قائمة المنح`);
  }
  assert.match(grants, /grant execute on function public\.%s to authenticated/,
    "لا منح تنفيذ للواجهة");
  for (const f of INTERNAL_FNS) {
    assert.match(grants, new RegExp(`'${f}\\(`), `الدالّة الداخلية ${f} خارج قائمة السحب`);
  }
  assert.match(grants, /revoke all on function public\.%s from authenticated/,
    "الدوالّ الداخلية غير مسحوبة من authenticated");
  assert.match(grants, /from anon/, "لا سحب صريح من anon");
  assert.match(POSTCHECK, /دوالّ داخلية/, "POSTCHECK لا يتحقّق من حجب الداخليات");
});

test("كلّ دالّة واجهة تفحص بوّابتها بنفسها قبل أيّ عمل", () => {
  const skip = new Set(["tvn_access"]);  // خريطة القدرات تعيد false ولا ترفع
  for (const f of API_FNS) {
    if (skip.has(f)) continue;
    const body = funcBody(f);
    assert.match(body, /if not \(?public\.(can_|tvn_can_|tvn_is_)/,
      `${f} بلا فحص بوّابة في مطلعها`);
    assert.match(body, /not authorized/, `${f} لا ترفض صراحةً`);
  }
});

test("★ المُقيَّم لا يرى تقييمه الداخليّ في الإصدار الأوّل ★", () => {
  const body = funcBody("tvn_reviews_for_profile");
  assert.match(body, /linked_user_id/, "لا فحص لهويّة صاحب الملفّ");
  assert.match(body, /subject_cannot_read_own_reviews/, "الرفض بلا سبب مُدقَّق");
  assert.match(body, /can_review_resource_performance\(\)/, "بلا بوّابة تقييم أصلًا");
});

test("مفاتيح الصلاحيات تُزرَع ولا تُمنَح ضمنيًّا", () => {
  const perm = doBlock("perm");
  for (const k of ["talent.view", "talent.manage_profiles", "talent.view_rates",
                   "talent.view_bank", "talent.verify_compliance", "talent.assign_external",
                   "talent.review_performance", "talent.approve_cost"]) {
    assert.match(perm, new RegExp(`'${k.replace(".", "\\.")}'`), `المفتاح ${k} غير مزروع`);
  }
  assert.match(perm, /on conflict \(key\) do nothing/, "الزرع يدهس تعريفًا قائمًا");
  // غياب محلّل الصلاحيات = منع، لا منح.
  assert.match(funcBody("tvn_perm"), /emp_has_permission\(uuid,text\)'\) is null then return false/,
    "غياب المحلّل لا يُترجَم إلى منع");
});

test("مُسنَدات القراءة stable، ودوالّ الكتابة ليست stable", () => {
  for (const p of PREDICATES) {
    assert.match(funcDecl(p), /\bstable\b/i, `${p} ليس stable — سيُعاد تقييمه لكلّ صفّ في RLS`);
  }
  for (const w of ["tvn_profile_upsert", "tvn_assignment_confirm", "tvn_review_submit"]) {
    assert.doesNotMatch(funcDecl(w), /\b(stable|immutable)\b/i, `${w} معلَّم stable وهو يكتب`);
  }
});
