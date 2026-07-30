// ════════════════════════════════════════════════════════════════════════════
// tests/commercial_client_workflow.test.js — الحالات العشر، والرصيد، و★ لا مشروع ★.
//
// أهمّ اختبار في الملفّ هو الأخير: لا التقديم ولا الاعتماد يُنشئ مشروعًا، ولا
// تكتب المرحلة ٣ حرفًا في منصّة المشاريع المجمّدة. البقية سير عمل.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  SQL17, TS, CREDITS, FORM, funcBody, PHASE3_FNS, STATES,
} = require("./commercial_client_helpers.js");

test("الحالات العشر كلّها في قيد الجدول، ولا حالة زائدة", () => {
  const m = SQL17.match(/status\s+text not null default 'draft' check \(status in\s*\n?\s*\(([\s\S]*?)\)\)/);
  assert.ok(m, "لا قيد على حالات الطلب");
  const declared = m[1].split(",").map((s) => s.trim().replace(/'/g, "")).filter(Boolean);
  assert.deepEqual(declared.slice().sort(), STATES.slice().sort(), "قائمة الحالات لا تطابق العقد");
  assert.equal(declared.length, 10, "عدد الحالات ليس عشرة");
});

test("الحالات العشر معروضة للعميل بالعربية ولها ألوان", () => {
  for (const s of STATES) {
    assert.ok(new RegExp(`${s}:\\s*"`).test(TS), `الحالة ${s} بلا نصّ عربيّ في CSUB_STATUS_AR`);
    assert.ok(new RegExp(`${s}:\\s*"(neutral|warn|good|bad)"`).test(TS),
      `الحالة ${s} بلا لون في CSUB_STATUS_TONE`);
  }
  assert.match(TS, /CSUB_TERMINAL/, "لا قائمة صريحة للحالات النهائية");
});

test("كلّ انتقال له مصدر واحد محدَّد — لا قفزة من أيّ حالة", () => {
  const b = funcBody("csub_request_transition", SQL17);
  const expect = [
    ["review", "r.status <> 'submitted'"],
    ["reserve", "r.status <> 'under_review'"],
    ["schedule", "r.status <> 'approved'"],
    ["fulfil", "r.status <> 'scheduled'"],
  ];
  for (const [action, guard] of expect) {
    const i = b.indexOf(`a = '${action}'`);
    assert.ok(i > 0, `الفعل ${action} غير موجود`);
    assert.ok(b.slice(i, i + 400).includes(guard), `الفعل ${action} بلا حارس حالة المصدر (${guard})`);
  }
  const ai = b.indexOf("a = 'approve'");
  const approve = b.slice(ai, ai + 1100);
  assert.ok(approve.includes("r.status = 'credit_reserved'"), "الاعتماد لا يعرف مصدره الأوّل");
  assert.ok(approve.includes("r.status = 'needs_overage_approval'"), "الاعتماد لا يعرف مصدره الثاني");
  assert.ok(approve.includes("invalid_transition"), "الاعتماد يقبل مصدرًا غير معروف");
  assert.ok(b.includes("invalid_action"), "فعل غير معروف يمرّ بلا رفض");
});

test("الحجز يمرّ بدالّة الأساس، وفشله يدلّ على مسار التجاوز", () => {
  const b = funcBody("csub_request_transition", SQL17);
  const i = b.indexOf("a = 'reserve'");
  const chunk = b.slice(i, b.indexOf("a = 'need_overage'"));
  assert.ok(chunk.length > 400 && i > 0, "تعذّر عزل فرع الحجز");
  assert.ok(chunk.includes("public.csub_reserve("), "الحجز لا يمرّ بدالّة الأساس");
  assert.ok(chunk.includes("credits_required_missing"), "الحجز يمرّ برصيد مطلوب صفر");
  assert.ok(chunk.includes("insufficient_balance"), "الحجز لا يتعامل مع نقص الرصيد");
  assert.ok(chunk.includes("need_overage"), "الحجز لا يدلّ على المسار الصحيح عند النقص");
  assert.ok(chunk.includes("reservation_entry_id ="), "الحجز لا يحفظ معرّف القيد للربط لاحقًا");
});

test("طلب التجاوز يمرّ باعتماد المالك القائم، ولا يُنشئ بوّابة جديدة", () => {
  const b = funcBody("csub_request_transition", SQL17);
  const i = b.indexOf("a = 'need_overage'");
  const chunk = b.slice(i, i + 1200);
  assert.ok(chunk.includes("csub_approval_submit_core('overage'"), "لا استعمال لآليّة الاعتماد القائمة");
  assert.ok(chunk.includes("csub_available_core"), "التجاوز لا يُحسب من الرصيد المتاح");
  assert.ok(chunk.includes("no_overage"), "يُطلب اعتماد تجاوز حيث لا تجاوز");
  assert.ok(chunk.includes("approval_request_id = v_appr"), "معرّف الاعتماد لا يُحفظ على الطلب");
});

test("الإلغاء والرفض يُفرجان عن الحجز عبر دالّة الأساس", () => {
  const b = funcBody("csub_request_transition", SQL17);
  for (const action of ["reject", "cancel"]) {
    const i = b.indexOf(`a = '${action}'`);
    const chunk = b.slice(i, i + 900);
    assert.ok(chunk.includes("public.csub_release("), `الفعل ${action} لا يُفرج عن الحجز`);
    assert.ok(chunk.includes("r.reservation_entry_id"), `الفعل ${action} يُفرج عن حجز غير حجز الطلب`);
  }
  const c = funcBody("csub_request_cancel", SQL17);
  assert.ok(c.includes("public.csub_release("), "إلغاء العميل لا يُفرج عن الحجز");
  assert.ok(c.includes("reservation_exhausted"),
    "إلغاء العميل يفشل إن كان الحجز مستهلَكًا سلفًا بدل أن يمضي");
});

test("التنفيذ يستهلك عبر دالّة الأساس ويربط الحجز والاعتماد", () => {
  const b = funcBody("csub_request_transition", SQL17);
  const i = b.indexOf("a = 'fulfil'");
  const chunk = b.slice(i, i + 1800);
  assert.ok(chunk.includes("public.csub_consume("), "التنفيذ لا يمرّ بدالّة الأساس");
  assert.ok(chunk.includes("'reservation_entry_id', r.reservation_entry_id"), "الاستهلاك بلا ربط بالحجز");
  assert.ok(chunk.includes("'approval_request_id', r.approval_request_id"), "الاستهلاك بلا ربط بالاعتماد");
  assert.ok(chunk.includes("'service_request_id', r.id"), "الاستهلاك بلا ربط بالطلب — يفتح استهلاكًا مزدوجًا");
  // ★ الاستهلاك المعلَّق يُعيد الطلب إلى حالته الصادقة ★
  assert.ok(chunk.includes("pending_approval"), "الاستهلاك المعلَّق لا يُعالَج");
  assert.ok(chunk.includes("'status', 'needs_overage_approval'"),
    "الاستهلاك المعلَّق لا يُعيد الطلب إلى حالة انتظار الاعتماد");
});

test("الرصيد مشتقّ من الدفتر — لا عمود رصيد على طلب الخدمة", () => {
  const tableBlock = SQL17.slice(SQL17.indexOf("§17.1"), SQL17.indexOf("§17.2"));
  for (const bad of ["balance", "available", "allocated", "remaining"]) {
    assert.ok(!new RegExp(`\\b${bad}\\s+numeric`, "i").test(tableBlock),
      `طلب الخدمة يحمل عمود رصيد (${bad}) — سينحرف عن الدفتر ثمّ يُصدَّق`);
  }
  const page = funcBody("csub_my_credits_page", SQL17);
  assert.match(page, /csub_balance_core/, "سطح العميل لا يقرأ الرصيد من محرّك الدفتر");
});

test("تقدير التجاوز يُحسب في الخادم لا في المتصفّح", () => {
  const s = funcBody("csub_request_submit", SQL17);
  assert.match(s, /v_avail := public\.csub_available_core/, "الخادم لا يقرأ المتاح");
  assert.match(s, /v_over\s*:=\s*greatest\(0, v_credits - v_avail\)/, "الخادم لا يحسب تقدير التجاوز");
  // ولا يُرسل من الواجهة إطلاقًا.
  const payload = TS.slice(TS.indexOf("const payload"), TS.indexOf("csub_request_submit"));
  assert.ok(!/overage/.test(payload), "الواجهة ترسل تقدير التجاوز — الخادم يجب أن يحسبه");
  assert.match(FORM, /الرقم الملزِم يُحسب في الخادم/, "النموذج لا يوضّح أنّ التقدير تقديريّ");
});

test("الطلب لا يُقدَّم على وحدة خارج الاشتراك ولا على اشتراك غير مفعّل", () => {
  const s = funcBody("csub_request_submit", SQL17);
  assert.match(s, /unit_not_in_subscription/, "يُقبل طلب على وحدة غير مشمولة");
  assert.match(s, /subscription_not_active/, "يُقبل طلب على اشتراك غير مفعّل");
  assert.match(s, /preferred_date_in_past/, "يُقبل تاريخ في الماضي");
  assert.match(s, /not_editable/, "تُعدَّل طلبات بعد تقديمها");
});

test("المرفقات بيانات وصفية فقط — لا ملفّ ولا رابط، والقاعدة تمنع", () => {
  const tableBlock = SQL17.slice(SQL17.indexOf("§17.1"), SQL17.indexOf("§17.2"));
  assert.ok(!/\burl\b|storage_path|bucket/i.test(tableBlock), "جدول المرفقات يحمل رابطًا أو مسار تخزين");
  assert.match(tableBlock, /check \(file_name !~\* '\^\(https\?\|s3\|gs\|file\)/,
    "لا قيد يمنع تسجيل رابط في مكان الاسم");
  const fn = funcBody("csub_request_attachment_add", SQL17);
  assert.match(fn, /link_not_allowed/, "الدالّة تقبل رابطًا");
  assert.match(fn, /metadata_only/, "الدالّة لا تصرّح بأنّها بيانات فقط");
  assert.match(FORM, /لا يُرفع ملفّ من هذه الشاشة ولا يُحفظ رابط/, "النموذج لا يوضّح ذلك للعميل");
});

// ─── ★★ العقد الأهمّ ★★ ─────────────────────────────────────────────────────

test("★ لا التقديم ولا الاعتماد يُنشئ مشروعًا ★", () => {
  const submit = funcBody("csub_request_submit", SQL17);
  assert.match(submit, /'project_created', false/, "التقديم لا يصرّح بأنّه لم يُنشئ مشروعًا");
  const t = funcBody("csub_request_transition", SQL17);
  assert.match(t, /'project_created', false/, "الاعتماد لا يصرّح بأنّه لم يُنشئ مشروعًا");
  assert.match(t, /ready_for_manual_project_creation/, "الاعتماد لا يُظهر «جاهز لإنشاء مشروع يدويًّا»");
  assert.match(t, /خطوة يدويّة منفصلة/, "الاعتماد لا يشرح الخطوة اليدويّة");
  // وتُقال للعميل على الشاشة قبل الإرسال وبعد الاعتماد.
  assert.match(FORM, /لا يُنشئ مشروعًا/, "النموذج لا يقول للعميل إنّ التقديم لا يُنشئ مشروعًا");
  assert.match(CREDITS, /إنشاء المشروع خطوة يدويّة/, "الشاشة لا تقول ذلك بعد الاعتماد");
});

test("★ المرحلة ٣ لا تكتب حرفًا في منصّة المشاريع المجمّدة ★", () => {
  const body = SQL17.replace(/--[^\n]*/g, "");
  for (const t of ["projects", "project_core", "deliverables", "deliverable_internal",
                   "project_transition_requests"]) {
    const re = new RegExp(`(insert\\s+into|update|delete\\s+from)\\s+public\\.${t}\\b`, "i");
    assert.ok(!re.test(body), `§17 تكتب في public.${t} — المنصّة مجمّدة`);
  }
  // القراءة الوحيدة المسموحة: التحقّق من وجود المعرّف قبل حفظه كمرجع.
  const link = funcBody("csub_request_link_project", SQL17);
  assert.match(link, /select exists \(select 1 from public\.projects where id = \$1\)/,
    "الربط اليدويّ لا يتحقّق من وجود المشروع");
  assert.match(link, /project_created', false/, "الربط لا يصرّح بأنّه لم يُنشئ مشروعًا");
  assert.match(link, /project_not_found/, "الربط لا يتعامل مع معرّف غير موجود");
  assert.match(link, /projects_table_missing/, "الربط ينهار إن لم يكن جدول المشاريع موجودًا");
  assert.match(link, /not_approved/, "يُربط مشروع بطلب لم يُعتمد");
  // ولا مفتاح أجنبيّ نحو المنصّة: مرجع لا ملكية.
  const tableBlock = SQL17.slice(SQL17.indexOf("§17.1"), SQL17.indexOf("§17.2"));
  assert.ok(!/project_id[\s\S]{0,60}references public\.projects/.test(tableBlock),
    "مرجع المشروع بمفتاح أجنبيّ — الأساس يتعمّد تركه بلا FK");
  // وحارس عائليّ في الـSELF-TEST.
  assert.match(SQL17, /تكتب في منصّة المشاريع المجمّدة/, "الـSELF-TEST لا يفحص ذلك");
});

test("★ لا قناة إرسال جديدة في المرحلة ٣ ★", () => {
  const body = SQL17.replace(/--[^\n]*/g, "");
  assert.ok(!/public\.notify\s*\(/.test(body), "§17 تستدعي قناة الإشعار الخامّ مباشرةً");
  // الإشعار الوحيد المسموح هو ما يصدر من آليّة الاعتماد القائمة (csub_notify
  // داخل csub_approval_submit_core)، ولا تضيف §17 قناة ثانية.
  for (const f of PHASE3_FNS) {
    assert.ok(!/csub_notify\(/.test(funcBody(f, SQL17)),
      `${f} تستدعي قناة إشعار مباشرةً بدل المرور بآليّة الأساس`);
  }
});
