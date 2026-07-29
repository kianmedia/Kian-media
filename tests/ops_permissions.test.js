// ════════════════════════════════════════════════════════════════════════════
// tests/ops_permissions.test.js — Phase 2 (مركز التشغيل): مصفوفة الصلاحيات.
//
// المالك كلّ شيء · مدير التشغيل بمفتاح صريح · فرد الطاقم مهامّه هو ويؤكّد حضوره
// ويحرّر تقريره هو · المونتير عمله هو · العميل لا شيء.
// كلّ تأكيد هنا يقرأ الشيفرة الفعلية، فلا يمرّ اختبار على نيّة.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const { read, SQL, funcBody, WRITE_FNS } = require("./ops_helpers.js");


test("الموديول يملك مُسنَداته: لا اعتماد على can_manage_projects في أيّ مُسنَد", () => {
  for (const f of ["prodops_can_view", "prodops_can_manage", "prodops_can_read_job", "prodops_can_edit_job"]) {
    assert.doesNotMatch(
      funcBody(f), /can_manage_projects/i,
      `${f} تعتمد can_manage_projects — الموديول التشغيليّ لا يُعلَّق على صلاحية المشاريع`,
    );
  }
  // ولا في أيّ موضع من الحزمة كلّها — عدا حارس الـself-test الذي يمنعها،
  // والتعليق الذي يشرح المنع. أيّ ذكر آخر = استدعاء حقيقيّ.
  const offenders = SQL.split("\n")
    .map((l, i) => [i + 1, l])
    .filter(([, l]) => /can_manage_projects/i.test(l))
    .filter(([, l]) => !/^\s*--/.test(l)
      && !/ilike\s*'%can_manage_projects%'/i.test(l)
      && !/raise\s+exception\s+'OPS SELF-TEST/i.test(l));
  assert.deepEqual(offenders, [], "الحزمة تستدعي can_manage_projects فعليًّا");
});

test("مدير التشغيل بمفتاح صريح: المالك/الأدمن أو operations.manage — لا ثالث", () => {
  const b = funcBody("prodops_can_manage");
  assert.match(b, /is_owner\(\)/, "المالك غير مشمول");
  assert.match(b, /is_admin\(\)/, "الأدمن غير مشمول");
  assert.match(b, /prodops_perm\('operations\.manage'\)/, "المفتاح الصريح غائب");
  // المفتاح موجود فعلًا في بذر الكتالوج (لا مفتاح وهميّ)
  assert.match(SQL, /'operations\.manage'\s*,\s*'sensitive'/, "المفتاح ليس في الكتالوج أو ليس حسّاسًا");
});

test("جسر محرّك الصلاحيات fail-closed: غيابه يمنع ولا يسمح", () => {
  const b = funcBody("prodops_perm");
  assert.match(b, /to_regprocedure\('public\.emp_has_permission\(uuid,text\)'\)\s+is\s+null\s+then\s+return\s+false/i,
    "غياب المحرّك لا يُعيد false");
  assert.match(b, /exception\s+when\s+others\s+then\s*\n?\s*return\s+false/i,
    "المصيدة لا تُفشِل — يجب أن تُغلق لا أن تفتح");
  assert.doesNotMatch(b, /return\s+true\s*;\s*\n?\s*(end|exception)/i, "مسار يعيد true بلا شرط");
});

test("فرد الطاقم: يؤكّد حضوره هو فقط — الشرط user_id = auth.uid() لا فلتر واجهة", () => {
  const b = funcBody("prodops_confirm_attendance");
  assert.match(b, /user_id\s*=\s*auth\.uid\(\)/, "التأكيد غير مقيّد بصاحب الجلسة");
  assert.match(b, /p_status\s+not\s+in\s*\('confirmed','declined','attended'\)/,
    "قائمة حالات الحضور غير محصورة");
  // لا يمكن أن يمرّر معرّف شخص آخر
  assert.doesNotMatch(b, /p_user|p_crew_id|p_member/i, "الدالّة تقبل هويّة شخص آخر");
});

test("التقرير اليوميّ شهادة كاتبه: لا أحد يحرّر تقرير غيره — ولا المدير", () => {
  const b = funcBody("prodops_daily_report_upsert");
  assert.match(b, /v_owner\s*<>\s*auth\.uid\(\)\s+then\s+raise\s+exception\s+'not authorized'/i,
    "تحرير تقرير غيرك ممكن");
  assert.match(b, /prepared_by\s*=\s*auth\.uid\(\)/, "التقرير لا يُنسب لكاتبه");
  assert.match(b, /already_submitted/, "التقرير المُرسَل يُعاد كتابته صامتًا");
});

test("المونتير: يحرّك تسليمه هو (أو المدير) — لا غيره", () => {
  const b = funcBody("prodops_post_handoff_progress");
  assert.match(b, /v_to\s*=\s*auth\.uid\(\)\s*or\s*coalesce\(public\.prodops_can_manage\(\)/i,
    "التسليم غير مقيّد بالمُسنَد إليه");
  assert.match(b, /not authorized/, "لا رفض صريح");
});

test("قراءة المهمّة: مدير كلّ شيء · موظّف مهامّه · غير الموظّف لا شيء", () => {
  const b = funcBody("prodops_can_read_job");
  assert.match(b, /auth\.uid\(\)\s+is\s+null[\s\S]{0,40}then\s+false/i, "بلا جلسة لا تُرفض");
  assert.match(b, /prodops_can_manage\(\)[\s\S]{0,30}then\s+true/i, "المدير غير مشمول");
  assert.match(b, /not\s+coalesce\(public\.is_staff\(\),\s*false\)\s+then\s+false/i,
    "غير الموظّف لا يُرفض صراحةً");
  assert.match(b, /prodops_is_crew\(p_job\)/, "الطاقم غير مشمول");
  assert.match(b, /prodops_is_post_assignee\(p_job\)/, "المونتير المُسنَد غير مشمول");
});

test("تعديل المهمّة للمدير وحده — والحذف يتطلّب سببًا مكتوبًا", () => {
  const b = funcBody("prodops_can_edit_job");
  assert.match(b, /prodops_can_manage\(\)/, "التعديل ليس مقصورًا على المدير");
  assert.doesNotMatch(b, /prodops_is_crew|is_staff/, "الطاقم يستطيع تعديل المهمّة");
  const del = funcBody("prodops_job_delete");
  assert.match(del, /length\(btrim\(coalesce\(p_reason,\s*''\)\)\)\s*<\s*3\s+then\s+raise\s+exception\s+'reason_required'/i,
    "الحذف بلا سبب");
});

test("كلّ دالّة كتابة: بوّابة جلسة + رفض صريح + SECURITY DEFINER + search_path", () => {
  for (const f of WRITE_FNS) {
    const b = funcBody(f);
    assert.match(b, /auth\.uid\(\)\s+is\s+null\s+then\s+raise\s+exception\s+'not authorized'/i,
      `${f}: بلا بوّابة جلسة`);
    const decl = SQL.match(new RegExp("create\\s+or\\s+replace\\s+function\\s+public\\." + f + "\\s*\\([^)]*\\)[\\s\\S]*?\\bas\\s*\\$\\$", "i"));
    assert.ok(decl, `${f}: تعذّر قراءة التصريح`);
    assert.match(decl[0], /security definer/i, `${f}: ليست SECURITY DEFINER`);
    assert.match(decl[0], /set search_path\s*=\s*public/i, `${f}: بلا search_path مثبَّت`);
  }
});

test("لا كتابة تتجاوز الـRPC: صفر سياسة غير SELECT، وصفر GRANT كتابة على الجداول", () => {
  assert.doesNotMatch(SQL, /create policy[\s\S]{0,120}for\s+(insert|update|delete|all)\b/i,
    "توجد سياسة كتابة مباشرة");
  assert.doesNotMatch(SQL, /grant\s+(insert|update|delete|all)\s+on\s+table/i,
    "منح كتابة مباشرة على جدول");
  assert.match(SQL, /grant select on table public\.%I to authenticated/i,
    "لا منح قراءة صريح (الجداول ستبقى غير مقروءة أو مفتوحة بلا قصد)");
});

test("تبويب مركز التشغيل داخليّ: لا يظهر لعميل ولا لزائر", () => {
  const nav = read("components/portal/nav.ts");
  assert.match(nav, /operations:\s*\{\s*href:\s*"\/client-portal\/operations"/, "التبويب غير مسجَّل");
  const set = (role) => {
    const m = nav.match(new RegExp("^\\s*" + role + ":\\s*\\[(.*)\\],", "m"));
    assert.ok(m, `مجموعة ${role} غير موجودة`);
    return m[1];
  };
  assert.doesNotMatch(set("client"), /"operations"/, "العميل يرى مركز التشغيل");
  assert.doesNotMatch(set("lead"), /"operations"/, "الزائر يرى مركز التشغيل");
  for (const r of ["admin", "super_admin", "manager", "editor", "photographer", "custody_officer"]) {
    assert.match(set(r), /"operations"/, `${r} لا يرى مركز التشغيل`);
  }
});
