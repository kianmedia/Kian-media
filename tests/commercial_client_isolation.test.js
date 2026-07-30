// ════════════════════════════════════════════════════════════════════════════
// tests/commercial_client_isolation.test.js — ★ من يرى ماذا، ومن لا يرى أبدًا ★
//
//   (١) العميل  — طلباته هو واشتراكه هو، بلا حقل داخليّ، وبلا وصول جدوليّ
//                 أصلًا فالتفاف PostgREST بلا أثر.
//   (٢) التشغيل — الطلب بحقوله التنفيذية. الجدول **بلا مال إطلاقًا**، فالفصل
//                 بنيويّ لا عرضيّ: لا يوجد رقم ماليّ ليُحجَب.
//   (٣) الإدارة — الملاحظات الداخلية وسبب القرار لمن يدير الموديول وحده.
//   (٤) الموظّف — لا يعدّل رصيد عميل مباشرةً بأيّ طريق.
//   (٥) المالك  — وحده يعتمد التجاوز، عبر آليّة الاعتماد القائمة.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  SQL, SQL17, TS, NAV, CREDITS, funcBody,
  PHASE3_FNS, PHASE3_TABLES, INTERNAL_FIELDS,
} = require("./commercial_client_helpers.js");

// ─── (١) العميل ─────────────────────────────────────────────────────────────

test("(١) ★ لا سياسة RLS تمنح العميل وصولًا جدوليًّا إلى جداول المرحلة ٣ ★", () => {
  const rls = SQL17.slice(SQL17.indexOf("§17.2"), SQL17.indexOf("§17.3"));
  assert.ok(!/my_client_id/.test(rls),
    "سياسة تربط صفًّا بالعميل — سيقرأ internal_notes وdecision_reason عبر PostgREST مباشرةً");
  assert.ok(!/csub_is_client/.test(rls), "سياسة تسمح لصاحب صفة العميل بقراءة جدول");
  for (const t of PHASE3_TABLES) {
    const re = new RegExp(`create policy ${t}_read[\\s\\S]{0,200}using \\(public\\.csub_can_view\\(\\)\\)`);
    assert.match(rls, re, `${t} بسياسة قراءة غير مقصورة على موظّف مُصرَّح`);
  }
  assert.match(SQL17, /سياسة تمنح العميل وصولًا جدوليًّا/,
    "الـSELF-TEST لا يمنع إضافة سياسة عميل لاحقًا");
});

test("(١ب) ★ سطح العميل لا يقرأ حقلًا داخليًّا — الإسقاط من المصدر ★", () => {
  const body = funcBody("csub_my_credits_page", SQL17);
  for (const f of INTERNAL_FIELDS) {
    assert.ok(!body.includes(f), `csub_my_credits_page تقرأ الحقل الداخليّ ${f}`);
  }
  // وما يصل العميل عن القرار هو ملاحظة العميل لا سببه الداخليّ.
  assert.ok(body.includes("client_decision_note"), "سطح العميل لا يعرض ملاحظة القرار الموجّهة للعميل");
  // ولا سجلّ تدقيق ولا هويّة فاعل.
  assert.ok(!/actor_id/.test(body), "سطح العميل يكشف هويّة الفاعل الداخليّ");
});

test("(١ج) العميل يرى صفوفه هو فقط", () => {
  const body = funcBody("csub_my_credits_page", SQL17);
  assert.match(body, /v_client := public\.my_client_id\(\)/, "لا اشتقاق لملفّ العميل من الجلسة");
  assert.match(body, /client_id = v_client/, "قراءة صفوف بلا تقييد بملفّ العميل");
  assert.match(body, /csub_is_client\(\)/, "سطح العميل لا يتحقّق من أنّ المُنادي عميل");
  for (const fn of ["csub_request_submit", "csub_request_cancel"]) {
    const b = funcBody(fn, SQL17);
    assert.match(b, /csub_is_client\(\)/, `${fn} بلا تحقّق من صفة العميل`);
    assert.match(b, /client_id = v_client/, `${fn} لا تتحقّق من ملكية الصفّ`);
  }
  // والمرفق يتحقّق من الملكية قبل أن يكتب.
  assert.match(funcBody("csub_request_attachment_add", SQL17), /r\.client_id <> v_client/,
    "إضافة مرفق بلا تحقّق من ملكية الطلب");
});

test("(١د) العميل لا يحرّك حالة طلب إلى ما بعد التقديم", () => {
  const t = funcBody("csub_request_transition", SQL17);
  assert.match(t, /csub_can_manage\(\)[\s\S]{0,80}csub_can_consume\(\)/,
    "آلة الحالات مفتوحة لغير الموظّف");
  assert.ok(!/csub_is_client/.test(t), "آلة الحالات تعترف بالعميل كفاعل");
  // أفعال العميل: التقديم والإلغاء فقط، وكلاهما دالّة مستقلّة بحارسها.
  assert.match(funcBody("csub_request_cancel", SQL17), /terminal_state/,
    "إلغاء العميل يقبل طلبًا وصل حالته النهائية");
});

test("(١هـ) التبويب غائب عن كلّ مجموعة موظّف — لا إرسال إلى شاشة منع", () => {
  assert.match(NAV, /production_credits:/, "التبويب غير مسجَّل");
  const sets = NAV.slice(NAV.indexOf("const SETS"));
  const clientLine = sets.match(/client:\s*\[[^\]]*\]/);
  assert.ok(clientLine && clientLine[0].includes("production_credits"), "العميل لا يرى التبويب");
  for (const role of ["admin", "super_admin", "manager", "sales", "finance", "editor",
                      "support", "hr", "readonly", "org_admin", "lead"]) {
    const line = sets.match(new RegExp(`${role}:\\s*\\[[^\\]]*\\]`));
    assert.ok(line, `الدور ${role} غير موجود في SETS`);
    assert.ok(!line[0].includes("production_credits"),
      `الدور ${role} يرى تبويب «رصيدي الإنتاجي» — والقاعدة سترفضه`);
  }
});

// ─── (٢) التشغيل و(٣) الإدارة ───────────────────────────────────────────────

test("(٢) ★ السطح التشغيليّ بلا مال — بنيويًّا لا عرضًا ★", () => {
  // لا عمود ماليّ في جدولَي المرحلة ٣ أصلًا.
  const tableBlock = SQL17.slice(SQL17.indexOf("§17.1"), SQL17.indexOf("§17.2"));
  for (const bad of ["price", "amount", "vat", "cost", "margin", "profit", "currency"]) {
    assert.ok(!new RegExp(`\\b\\w*${bad}\\w*\\s+numeric`, "i").test(tableBlock),
      `عمود ماليّ (${bad}) في طلبات الخدمة — السطح التشغيليّ يجب أن يبقى بلا مال`);
  }
  const list = funcBody("csub_service_requests_list", SQL17);
  assert.match(list, /'finance_visible', false/, "قائمة الطلبات لا تصرّح بغياب المال");
  assert.match(SQL17, /عمود ماليّ في طلبات الخدمة/, "الـSELF-TEST لا يحرس غياب المال");
});

test("(٣) الملاحظات الداخلية وسبب القرار لمن يدير الموديول وحده", () => {
  const list = funcBody("csub_service_requests_list", SQL17);
  assert.match(list, /'internal_notes', case when v_manage then r\.internal_notes else null end/,
    "الملاحظات الداخلية تخرج لكلّ من يملك csub.view");
  assert.match(list, /'decision_reason', case when v_manage then r\.decision_reason else null end/,
    "سبب القرار الداخليّ يخرج لكلّ من يملك csub.view");
  assert.match(list, /csub_can_view\(\)/, "قائمة الطلبات بلا بوّابة");
});

// ─── (٤) الموظّف والرصيد ────────────────────────────────────────────────────

test("(٤) ★ لا موظّف يعدّل رصيد عميل مباشرةً من المرحلة ٣ ★", () => {
  const body = SQL17.replace(/--[^\n]*/g, "");
  assert.ok(!/insert\s+into\s+public\.csub_ledger/i.test(body), "كتابة مباشرة في الدفتر");
  // والحركة الوحيدة تمرّ بدوالّ الأساس التي تقفل وتحسب بعد القفل.
  const t = funcBody("csub_request_transition", SQL17);
  assert.match(t, /public\.csub_reserve\(/, "الحجز لا يمرّ بدالّة الأساس");
  assert.match(t, /public\.csub_consume\(/, "الاستهلاك لا يمرّ بدالّة الأساس");
  assert.match(t, /public\.csub_release\(/, "فكّ الحجز لا يمرّ بدالّة الأساس");
});

test("(٤ب) المبالغ تُقرأ من الطلب لا من مُدخَل الموظّف", () => {
  const t = funcBody("csub_request_transition", SQL17);
  assert.match(t, /'quantity', r\.credits_required/, "الحجز/الاستهلاك لا يقرأ المبلغ من الطلب");
  // وتصحيح الرصيد المطلوب دالّة منفصلة، بحالة محدودة وتدقيق.
  const sc = funcBody("csub_request_set_credits", SQL17);
  assert.match(sc, /csub_can_manage\(\)/, "تصحيح الرصيد المطلوب بلا بوّابة");
  assert.match(sc, /status not in \('submitted','under_review','needs_overage_approval'\)/,
    "تصحيح الرصيد المطلوب متاح بعد الحجز — يفتح فجوة بين المحجوز والمطلوب");
  assert.match(sc, /csub_log\('service_request_set_credits'/, "التصحيح غير مُدقَّق");
});

test("(٤ج) فشل الحركة لا يغيّر الحالة — لا حالة تتقدّم بلا قيد", () => {
  const t = funcBody("csub_request_transition", SQL17);
  // الحجز الفاشل يعود بسببه قبل أيّ تحديث حالة.
  assert.match(t, /return jsonb_build_object\('ok', false, 'reason', coalesce\(v_res->>'reason', 'reserve_failed'\)/,
    "الحجز الفاشل لا يُعيد سببه");
  assert.match(t, /'next_action'[\s\S]{0,120}need_overage/,
    "الحجز الفاشل لا يدلّ على الخطوة الصحيحة");
  assert.match(t, /'release_failed'/, "فشل فكّ الحجز يمرّ صامتًا وتتغيّر الحالة");
});

// ─── (٥) المالك ─────────────────────────────────────────────────────────────

test("(٥) ★ اعتماد التجاوز قرار المالك — والمرحلة ٣ لا تفتح له بابًا ★", () => {
  const t = funcBody("csub_request_transition", SQL17);
  // لا بوّابة اعتماد جديدة: الحُكم صفّ الاعتماد القائم.
  assert.match(t, /v_ap\.status <> 'approved'/, "لا فحص لحالة صفّ الاعتماد");
  assert.match(t, /overage_not_approved/, "الطلب يتقدّم بلا قرار مالك");
  assert.match(t, /csub_approval_submit_core\('overage'/,
    "طلب التجاوز لا يمرّ بآليّة الاعتماد القائمة");
  // والمرحلة ٣ لا تُقرّر اعتمادًا بنفسها.
  const body = SQL17.replace(/--[^\n]*/g, "");
  assert.ok(!/update\s+public\.csub_approval_requests\s+set\s+status/i.test(body),
    "§17 تُقرّر اعتمادًا بنفسها بدل csub_approval_decide");
  // وبوّابة المالك في الأساس ما زالت بلا مفتاح صلاحية.
  assert.ok(!/csub_perm/.test(funcBody("csub_can_approve", SQL)),
    "بوّابة اعتماد المالك صارت تُشترى بمفتاح صلاحية");
});

test("(٦) لا بوّابة تستعمل can_manage_projects أو is_kian_member", () => {
  for (const forbidden of ["can_manage_projects", "is_kian_member"]) {
    assert.ok(!SQL17.includes(forbidden),
      `§17 تستعمل ${forbidden} كبوّابة — الموديول التجاريّ لا يشتقّ صلاحيته من المشاريع`);
  }
});

test("(٧) لا مفتاح صلاحية جديد — المرحلة ٣ تستعمل مفاتيح الأساس", () => {
  const invented = SQL17.match(/'csub\.[a-z_]+'/g) || [];
  const known = ["'csub.view'", "'csub.manage'", "'csub.consume'", "'csub.adjust'",
                 "'csub.view_pricing'", "'csub.export'"];
  for (const k of invented) {
    assert.ok(known.includes(k), `مفتاح صلاحية جديد في §17: ${k} — لا تُخترع مفردات صلاحيات`);
  }
});

test("(٨) كلّ دالّة عامّة في §17 تُغلق قبل أن تقرأ صفًّا", () => {
  for (const f of PHASE3_FNS) {
    const b = funcBody(f, SQL17);
    assert.match(b, /if auth\.uid\(\) is null then raise exception 'not authorized'/,
      `${f} لا تتحقّق من وجود جلسة أوّلًا`);
    assert.match(b, /csub_can_\w+\(\)|csub_is_client\(\)/, `${f} بلا بوّابة`);
  }
});

test("(٩) طبقة TS لا تقرّر صلاحية — القرار في الخادم", () => {
  assert.ok(!/if\s*\(\s*caps\./.test(TS), "منطق صلاحيات في طبقة الاستدعاء");
  assert.match(TS, /المنع الحقيقيّ في القاعدة/, "الملفّ لا يوثّق أنّ الإنفاذ في القاعدة");
  assert.match(TS, /state: "denied"/, "لا حالة منع مستقلّة");
  assert.match(TS, /state: "needs_migration"/, "لا حالة ترحيلة مستقلّة");
  assert.ok(CREDITS.includes("UnknownBalance"), "الواجهة بلا شاشة «رقم غير معروف»");
});
