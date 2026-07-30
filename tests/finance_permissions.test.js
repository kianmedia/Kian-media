// ════════════════════════════════════════════════════════════════════════════
// tests/finance_permissions.test.js — مصفوفة الصلاحيات المالية كاملة.
//
// المُسنَدات لا تعيد NULL · الموديول يملك مُسنَداته (لا can_manage_projects) ·
// بوّابة الهامش أضيق من بوّابة العرض · فصل المهامّ · سقف الاعتماد في القاعدة ·
// والحدود يضبطها المالك وحده.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  SQL, funcBody, funcDecl, section,
  PREDICATES, PROFIT_TABLES, READ_FNS, WRITE_FNS,
} = require("./finance_helpers.js");

test("كلّ مُسنَد يعيد boolean صريحًا ولا يعيد NULL أبدًا", () => {
  for (const p of PREDICATES) {
    const d = funcDecl(p);
    assert.match(d, /returns boolean/i, `${p} لا تعيد boolean`);
    const b = funcBody(p);
    assert.match(b, /coalesce\(/i, `${p} قد تعيد NULL — وNULL داخل «if not» يمرّ كأنّه سماح`);
  }
  // الجسر إلى محرّك الصلاحيات: المصيدة تُفشِل ولا تُنجِح
  const bridge = funcBody("finops_perm");
  assert.match(bridge, /exception when others then\s*\n?\s*return false/i,
    "جسر الصلاحيات يفشل مفتوحًا بدل أن يفشل مغلقًا");
  assert.match(bridge, /if to_regprocedure\('public\.emp_has_permission\(uuid,text\)'\) is null then return false/,
    "غياب محرّك الصلاحيات لا يُترجَم إلى منع");
});

test("الموديول يملك مُسنَداته: لا اعتماد على can_manage_projects", () => {
  // الاستدعاء لا مجرّد ذكر الاسم: الحزمة تذكره في تعليق وفي حارس الـSELF-TEST،
  // والممنوع هو أن تُنادى الدالّة فعلًا في مُسنَد أو دالّة.
  assert.ok(!/public\.can_manage_projects\s*\(/.test(SQL),
    "الحزمة تستدعي can_manage_projects — مدير المشاريع ليس مديرًا ماليًّا");
  assert.match(SQL, /تعتمد can_manage_projects — الموديول يجب أن يملك مُسنَداته/,
    "الـSELF-TEST بلا حارس يمنع إعادة إدخال هذا الاعتماد لاحقًا");
  // ولا على أيّ مُسنَد من موديول آخر يمنح رؤية مالية بالوراثة
  for (const p of PREDICATES) {
    const b = funcBody(p);
    assert.ok(!/prodops_|comms_|crm_/.test(b), `${p} يستعير مُسنَدًا من موديول آخر`);
  }
});

test("كلّ بوّابة عرض تشترط كون المستخدم موظّفًا — العميل خارج بنيويًّا", () => {
  for (const p of ["finops_can_view_finance_sensitive", "finops_can_view_collections",
    "finops_can_record_collection", "finops_can_approve_expense", "finops_can_request"]) {
    assert.match(funcBody(p), /is_staff\(\)/, `${p} لا تشترط is_staff`);
    assert.match(funcBody(p), /auth\.uid\(\) is not null/, `${p} لا تشترط جلسة`);
  }
  assert.match(funcBody("finops_is_client"), /not coalesce\(public\.is_staff\(\), false\)/,
    "تعريف العميل ليس «ليس موظّفًا»");
});

test("★ الربحية وطرفا معادلتها خلف بوّابة المالك ★ — في الدوالّ وفي RLS معًا", () => {
  // ١) الربحية خلف البوّابة الحسّاسة
  assert.match(funcBody("finops_profitability"), /finops_can_view_finance_sensitive\(\)/,
    "الربحية تُفتح ببوّابة أوسع من بوّابة المالك");
  // ٢) وجداول طرف الإيراد وطرف التكلفة في المجموعة نفسها — لا قسمة بينهما
  const rls = section("-- §4) RLS");
  for (const t of [...PROFIT_TABLES, "fin_costs", "fin_receivables"]) {
    assert.ok(rls.includes(`'${t}'`), `${t} خارج مجموعة السياسات الحسّاسة`);
  }
  assert.match(rls, /finops_can_view_finance_sensitive\(\)\)'?,?[\s\S]{0,60}t \|\| '_read'/,
    "سياسات الجداول الحسّاسة لا تستعمل البوّابة الحسّاسة");
  // ٣) واللوحة تُصرّح بالحجب بدل إعادة أصفار
  const dash = funcBody("finops_dashboard");
  assert.match(dash, /'profit_visible', false/, "اللوحة لا تُصرّح بحجب الربحية");
  assert.match(dash, /'profit', null/, "اللوحة تُعيد ربحية صفرية بدل حجب صريح");
  // ٤) والتصدير مقسوم ببوّابتين مستقلّتين
  const exp = funcBody("finops_export");
  assert.match(exp, /finops_can_export_sensitive\(\)/, "التصدير الشامل بلا بوّابته");
  assert.match(exp, /finops_can_export_collections\(\)/,
    "تصدير التحصيل بلا مفتاح مستقلّ — الصلاحية غير مقسومة");
});

test("كتابة طرف الإيراد للمالك وحده — لا كتابة عمياء ولا كتابة بمفتاح", () => {
  for (const f of ["finops_contract_upsert", "finops_revenue_upsert", "finops_retainer_upsert",
    "finops_receivable_upsert", "finops_cost_upsert", "finops_budget_upsert"]) {
    const b = funcBody(f);
    assert.match(b, /finops_can_manage_finance\(\)/,
      `${f} تسمح بكتابة طرف من معادلة الهامش لغير المالك`);
  }
});

test("فصل المهامّ: لا اعتماد ذاتيّ، واستثناء المالك مسجَّل لا صامت", () => {
  for (const f of ["finops_expense_decide", "finops_purchase_decide"]) {
    const b = funcBody(f);
    assert.match(b, /r\.requested_by = auth\.uid\(\)/, `${f} لا تكشف الاعتماد الذاتيّ`);
    assert.match(b, /self_approval_forbidden/, `${f} لا تمنع الاعتماد الذاتيّ`);
    assert.match(b, /is_owner\(\)/, `${f} بلا استثناء مُعرَّف للمالك`);
  }
  const second = funcBody("finops_expense_second_approve");
  assert.match(second, /same_approver_forbidden/,
    "الاعتماد الثاني يقبل نفس المعتمِد — اعتماد مزدوج صوريّ");
  assert.match(second, /self_approval_forbidden/, "الاعتماد الثاني يقبل صاحب الطلب");
});

test("سقف الاعتماد مفروض في القاعدة، وغياب السياسة يعني المالك لا التساهل", () => {
  const th = funcBody("finops_threshold_for");
  assert.match(th, /if not found then/, "لا فرع لغياب سياسة الحدّ");
  assert.match(th, /'required_role','owner'/,
    "غياب حدّ مضبوط لا يشترط المالك — افتراض متساهل يسمح باعتماد أيّ مبلغ");
  for (const f of ["finops_expense_decide", "finops_purchase_decide"]) {
    assert.match(funcBody(f), /threshold_exceeded/, `${f} لا تفرض السقف`);
  }
});

test("حدود الاعتماد يضبطها المالك وحده — لا يرفع المعتمِد سقفه بنفسه", () => {
  const b = funcBody("finops_threshold_upsert");
  assert.match(b, /is_owner\(\)/, "الحدود يضبطها غير المالك");
  assert.ok(!/finops_can_manage\(\)/.test(b), "الحدود مفتوحة لمن يملك إدارة المالية");
  const del = funcBody("finops_row_delete");
  assert.match(del, /fin_approval_thresholds[\s\S]{0,200}is_owner\(\)/,
    "حذف حدّ اعتماد متاح لغير المالك");
});

test("طلب الصرف يُنسب لصاحب الجلسة ولا يُقرأ من الحمولة", () => {
  const b = funcBody("finops_expense_request_submit");
  assert.ok(!/p->>'requested_by'/.test(b),
    "الطلب يقبل هويّة مُرسِل من الحمولة — رفع طلب باسم موظّف آخر ممكن");
  assert.match(b, /requested_by[\s\S]{0,400}auth\.uid\(\)/, "الطلب لا يُنسب لصاحب الجلسة");
  assert.match(b, /v_owner <> auth\.uid\(\)/, "تعديل طلب غيرك غير ممنوع");
  const p = funcBody("finops_purchase_request_submit");
  assert.ok(!/p->>'requested_by'/.test(p), "طلب الشراء يقبل هويّة مُرسِل من الحمولة");
});

test("الالتزام يتحوّل ولا يُستنسخ — لا احتساب مزدوج في الانحراف", () => {
  const paid = funcBody("finops_expense_mark_paid");
  assert.match(paid, /update public\.fin_costs set commitment = 'actual'/,
    "تسجيل الصرف لا يحوّل الالتزام");
  assert.ok(!/insert into public\.fin_costs/.test(paid),
    "تسجيل الصرف يُنشئ صفّ تكلفة ثانيًا — احتساب مزدوج");
  const po = funcBody("finops_po_set_status");
  assert.match(po, /commitment = 'actual'/, "استلام أمر الشراء لا يحوّل الالتزام");
  assert.match(po, /status = 'void'/, "إلغاء أمر الشراء لا يُبطل التزامه");
});

test("لا صرف بلا اعتماد، ولا صرف قبل الاعتماد الثاني عند اشتراطه", () => {
  const b = funcBody("finops_expense_mark_paid");
  assert.match(b, /not_approved/, "يُصرَف طلب لم يُعتمد");
  assert.match(b, /second_approval_required/, "يُصرَف قبل الاعتماد الثاني المشروط");
});

test("الذمم: لا تحصيل يتجاوز المتبقّي، ولا تخفيض تحت المحصَّل", () => {
  assert.match(funcBody("finops_collection_record"), /exceeds_outstanding/,
    "التحصيل يتجاوز المتبقّي ⇒ رصيد سالب");
  assert.match(funcBody("finops_receivable_upsert"), /below_collected/,
    "تخفيض الذمّة تحت ما حُصِّل ممكن");
});

test("المورّد لا يقبل رقم حساب بنكيّ كامل", () => {
  const b = funcBody("finops_supplier_upsert");
  assert.match(b, /bank_ref_too_sensitive/, "المورّد يقبل IBAN كاملًا");
  assert.match(b, /\[0-9\]\{10,\}/, "لا فحص لسلسلة أرقام طويلة");
});

test("كلّ دالّة عامّة ممنوحة لـauthenticated وحدها ولا شيء يبقى بلا منح", () => {
  const grants = section("-- §8) الصلاحيات");
  for (const f of [...READ_FNS, ...WRITE_FNS]) {
    assert.ok(grants.includes(`'public.${f}(`), `${f} غير مذكورة في المنح`);
  }
  assert.match(grants, /grant execute on function %s to authenticated/i);
  // المُسنَدات تُمنح أيضًا لأنّها تُقيَّم داخل سياسات RLS بدور المُنادي
  for (const p of PREDICATES) {
    assert.ok(grants.includes(`'public.${p}(`), `المُسنَد ${p} غير ممنوح — ستفشل سياسات RLS`);
  }
});
