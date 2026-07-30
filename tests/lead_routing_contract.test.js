// ════════════════════════════════════════════════════════════════════════════
// tests/lead_routing_contract.test.js — المرحلة ٧: التوزيع.
//
// العقد: مُفسَّر · حتميّ · لا عشوائية. ويمنع أربعة أشياء بالاسم:
//   ١) موظّف ينتزع عميل زميله
//   ٢) تغيير مالك بلا صلاحية
//   ٣) الالتفاف على المالك أو مدير المبيعات (تجاوز بلا سبب)
//   ٤) توزيع عميل مجهول أو ناقص بلا حالة مراجعة
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  SQL, DOCS, read, funcBody, tableSrc, selfTest,
  PREDICATES, API_FNS, INTERNAL_FNS, FORBIDDEN_GATES,
} = require("./lead_helpers.js");

test("★ لا انتزاع لعميل زميل — يدويًّا كان أو تلقائيًّا ★", () => {
  const fn = funcBody("lsr_assign");
  assert.match(fn, /cannot_take_others_lead/, "لا حارس ضدّ انتزاع عميل زميل");
  // الحارس يجب أن يسبق تفرّع الوضع (يدويّ/تلقائيّ) وإلّا التُفّ عليه بالوضع.
  const guard = fn.indexOf("cannot_take_others_lead");
  const manual = fn.indexOf("if v_mode = 'manual'");
  assert.ok(guard > 0 && manual > guard,
    "حارس الانتزاع بعد تفرّع الوضع — يمكن الالتفاف عليه باختيار وضع آخر");
  assert.match(fn, /v_prev is not null and v_prev <> auth\.uid\(\)/,
    "الحارس لا يقارن المالك السابق بصاحب الجلسة");
  assert.match(fn, /lsr_can_reassign/, "الحارس لا يستثني حامل صلاحية إعادة الإسناد");
});

test("★ تغيير مالك قائم يشترط صلاحية **وسببًا مكتوبًا** ★", () => {
  const fn = funcBody("lsr_assign");
  assert.match(fn, /reassign_not_permitted/, "تغيير المالك بلا فحص صلاحية");
  assert.match(fn, /override_reason_required/, "التجاوز بلا سبب مقبول");
  // وقيد على مستوى الجدول، لا فحص دالّة فقط.
  const t = tableSrc("lsr_assignments");
  assert.match(t, /constraint lsr_assign_override_reason\s+check/i,
    "لا قيد جدول يمنع تسجيل تجاوز بلا سبب");
});

test("★ التوزيع نفسه يحتاج صلاحية ★", () => {
  const fn = funcBody("lsr_assign");
  assert.match(fn, /routing_not_permitted/, "التوزيع بلا بوّابة");
  assert.match(fn, /lsr_can_route/, "لا فحص lead.route");
});

test("★ الأخذ الذاتيّ استثناء ضيّق ومغلق افتراضيًّا ★", () => {
  const fn = funcBody("lsr_assign");
  assert.match(fn, /v_self_claim\s*:=\s*\(v_prev is null and v_target = auth\.uid\(\)\)/,
    "الأخذ الذاتيّ لا يشترط أن يكون العميل بلا مالك وأن يكون الهدف هو الفاعل");
  assert.match(fn, /allow_self_claim/, "الأخذ الذاتيّ بلا إعداد يحكمه");
  assert.match(SQL, /\('allow_self_claim',\s*'false'::jsonb/,
    "إعداد الأخذ الذاتيّ ليس مغلقًا افتراضيًّا");
});

test("★ العميل المجهول أو الناقص لا يُوزَّع — بل يُوقَف للمراجعة ★", () => {
  const fn = funcBody("lsr_assign");
  assert.match(fn, /lsr_review_queue/, "لا طابور مراجعة");
  assert.match(fn, /'assigned', false/, "المخرَج لا يقول صراحةً إنّه لم يُسنَد");
  assert.match(fn, /'review_required', true/, "المخرَج لا يعلن سبب التوقّف");

  const core = funcBody("lsr_route_core");
  assert.match(core, /review_required/, "نواة التوزيع لا تُرجع علم المراجعة");

  // وفهرس فريد جزئيّ يمنع فتح صفّي مراجعة لعميل واحد.
  assert.match(SQL, /create unique index if not exists uq_lsr_review_open[\s\S]{0,200}where state = 'pending'/,
    "لا فهرس فريد جزئيّ على طابور المراجعة");
});

test("★ حتميّ: لا عشوائية في القرار ★", () => {
  const core = funcBody("lsr_route_core");
  assert.doesNotMatch(core, /\brandom\s*\(/i, "عشوائية في محرّك التوزيع");
  assert.doesNotMatch(core, /tablesample/i, "اختيار عشوائيّ للصفوف");
  assert.doesNotMatch(core, /order by\s+newid|order by\s+gen_random/i, "ترتيب غير مستقرّ");
  // الحاسم النهائيّ معرّف المستخدم: بلا ذلك يتغيّر القرار عند التعادل.
  assert.match(core, /a\.user_id::text/,
    "لا فاصل نهائيّ للتعادل — القرار يصير غير قابل لإعادة الإنتاج");
  assert.match(core, /order by user_id/i, "المرور على المندوبين بترتيب غير مستقرّ");
});

test("ترتيب المرشّحين رباعيّ ومعلَن: تخصّص · حِمل · أولوية · معرّف", () => {
  const core = funcBody("lsr_route_core");
  assert.match(core, /v_spec/, "لا مطابقة تخصّص");
  assert.match(core, /lsr_agent_workload/, "لا قياس حِمل");
  assert.match(core, /a\.priority/, "لا أولوية معلنة");
  assert.match(core, /lpad\(/, "الترتيب النصّيّ بلا تبطين — أرقام مختلفة الطول ترتّب خطأً");
});

test("كلّ مرشّح مستبعَد يظهر بسبب استبعاده", () => {
  const core = funcBody("lsr_route_core");
  assert.match(core, /'eligible', false/, "الاستبعاد صامت");
  assert.match(core, /بلغ سعته/, "لا سبب عند بلوغ السعة");
  assert.match(core, /خارج التخصّص/, "لا سبب عند عدم مطابقة التخصّص");
  assert.match(core, /'candidates'/, "قائمة المرشّحين لا تُعاد");
});

test("ملكية الحساب القائم تسبق القواعد، ومن مصدر قائم فعلًا", () => {
  const core = funcBody("lsr_route_core");
  assert.match(core, /crm_companies/, "ملكية الحساب لا تُقرأ من CRM");
  assert.match(core, /owner_user_id/, "لا قراءة لمالك الحساب");
  assert.match(core, /existing_account_owner_unavailable/,
    "مالك الحساب غير المتاح يُستبدَل صامتًا بدل أن يُعلن");
  // ولا نخترع عمودًا: account_manager_id لا وجود له في هذه القاعدة.
  assert.doesNotMatch(SQL, /account_manager_id/,
    "★ مفردة مخترَعة ★ العمود غير موجود في قاعدة البيانات");
});

test("بلا تقييم لا توزيع", () => {
  const core = funcBody("lsr_route_core");
  assert.match(core, /scoring_unavailable|s ->> 'ok'/,
    "التوزيع يمضي ولو تعذّر التقييم — قرار مبنيّ على صفر مُختلَق");
});

test("★ كلّ حقول عقد الإسناد تُكتب فعلًا ★", () => {
  const t = tableSrc("lsr_assignments");
  for (const c of ["assigned_to", "assigned_at", "routing_rule", "routing_reason",
                   "overridden_by", "override_reason", "previous_owner"]) {
    assert.ok(t.includes(c), `عمود العقد «${c}» غائب عن lsr_assignments`);
  }
  const fn = funcBody("lsr_assign");
  for (const c of ["previous_owner", "routing_rule", "routing_reason",
                   "overridden_by", "override_reason", "candidates"]) {
    assert.ok(fn.includes(c), `الحقل «${c}» لا يُكتب في lsr_assign`);
  }
});

test("مصدر واحد للملكية: crm_leads.owner_user_id", () => {
  const fn = funcBody("lsr_assign");
  assert.match(fn, /update public\.crm_leads[\s\S]{0,200}owner_user_id = v_target/,
    "الإسناد لا يكتب عمود الملكية القائم");
  // ولا عمود ملكية موازٍ في جدولنا.
  const t = tableSrc("lsr_assignments");
  assert.doesNotMatch(t, /is_current_owner|current_owner\b/,
    "مصدر ملكية موازٍ — مصدران يتباعدان بصمت");
});

test("الإسناد يترك أثر تدقيق، وحتّى الرفض يُسجَّل", () => {
  const fn = funcBody("lsr_assign");
  assert.match(fn, /lsr_log\('assign'/, "الإسناد بلا أثر تدقيق");
  assert.match(fn, /lsr_log\('assign_denied'/, "الرفض لا يُسجَّل — المحاولة الفاشلة معلومة أمنية");
  assert.match(fn, /lsr_log\('assign_review'/, "التوقّف للمراجعة لا يُسجَّل");
});

test("عضوية سجلّ المندوبين لا تمنح صلاحية", () => {
  for (const p of PREDICATES) {
    const body = funcBody(p);
    assert.doesNotMatch(body, /lsr_agents/,
      `★ خلط خطير ★ المُسنَد ${p} يقرأ سجلّ المندوبين — العضوية التشغيلية ليست صلاحية`);
  }
});

test("لا بوّابة ممنوعة في أيّ مُسنَد أو دالّة", () => {
  // نفحص **أجسام الدوالّ** لا الملفّ كلّه: الملفّ يذكر الاسمين في تعليق
  // العقد وفي الفحص الذاتيّ الذي يمنعهما — وذاك ذكرٌ يحمي لا يخرق.
  const bodies = [...PREDICATES, ...API_FNS, ...INTERNAL_FNS]
    .map((f) => [f, funcBody(f)]);
  for (const [name, body] of bodies) {
    for (const rx of FORBIDDEN_GATES) {
      assert.doesNotMatch(body, rx,
        `بوّابة ممنوعة (${rx}) داخل الدالّة ${name} — هذا موديول تجاريّ لا موديول مشاريع`);
    }
  }
  // وفي المقابل: الفحص الذاتيّ **يجب** أن يذكرهما كي يمنعهما.
  assert.match(selfTest(), /can_manage_projects/,
    "الفحص الذاتيّ لا يمنع البوّابة الممنوعة");
});

test("المُسنَدات كلّها fail-closed ولا تعيد NULL", () => {
  for (const p of PREDICATES) {
    const body = funcBody(p);
    assert.match(body, /coalesce\(/i, `المُسنَد ${p} قد يعيد NULL — وNULL ليس منعًا`);
    if (p !== "lsr_perm") {
      assert.match(body, /auth\.uid\(\) is not null/,
        `المُسنَد ${p} لا يشترط جلسة`);
    }
  }
  // جسر الصلاحيات: المصيدة تُفشِل ولا تُنجِح.
  const perm = funcBody("lsr_perm");
  assert.match(perm, /exception when others then\s*\n?\s*return false/i,
    "جسر الصلاحيات fail-open عند الخطأ");
});

test("طابور المراجعة يُغلق بقرار لا بصمت", () => {
  const fn = funcBody("lsr_review_dismiss");
  assert.match(fn, /note_required/, "يمكن صرف صفّ مراجعة بلا ملاحظة");
  assert.match(fn, /lsr_can_route/, "الصرف بلا صلاحية");
  assert.match(fn, /lsr_log\(/, "الصرف بلا أثر تدقيق");
});

test("الفحص الذاتيّ يغطّي حُرّاس التوزيع والحتمية", () => {
  const st = selfTest();
  assert.match(st, /cannot_take_others_lead/, "الفحص الذاتيّ لا يتحقّق من حارس الانتزاع");
  assert.match(st, /random/, "الفحص الذاتيّ لا يتحقّق من غياب العشوائية");
});

test("وثيقة عقد التوزيع تشرح الترتيب والممنوعات", () => {
  const doc = read(DOCS.routing);
  for (const k of ["cannot_take_others_lead", "override_reason", "lsr_agents",
                   "lead.route", "lead.reassign"]) {
    assert.ok(doc.includes(k), `وثيقة التوزيع لا تذكر «${k}»`);
  }
  assert.match(doc, /حتميّ/, "الوثيقة لا تعلن الحتمية");
  assert.match(doc, /صفر مندوبين/, "الوثيقة لا تحذّر من حالة «لا مندوبين»");
});
