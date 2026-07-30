// ════════════════════════════════════════════════════════════════════════════
// tests/commercial_owner_approval.test.js
//
// المتطلّب حرفيًّا: «لا العميل ولا موظّف المبيعات يفعّل اشتراكًا. موافقة المالك
// مطلوبة للوصول إلى active. افرض ذلك في الـRPC لا في الواجهة.»
// و: «تسوية يدوية بسبب مكتوب، وموافقة المالك على الزيادات.»
// و: «auto_renew عَلَم معلوماتيّ فقط — لا شحن ولا تجديد خارجيّ.»
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  SQL, funcBody, tableDef, SUB_STATES,
} = require("./commercial_subscriptions_helpers.js");

test("★★ اعتماد المالك ليس مفتاح صلاحية — فلا يُمنح لأحد", () => {
  const b = funcBody("csub_can_approve");
  assert.ok(!/csub_perm/.test(b),
    "csub_can_approve تمرّ بمفتاح صلاحية — «موافقة المالك» صارت منحة إدارية تُعطى مرّة وتُنسى");
  assert.match(b, /csub_is_owner_role/, "اعتماد المالك لا يشترط دور المالك");
  assert.match(b, /is_staff/, "اعتماد المالك لا يشترط أن يكون صاحب الجلسة موظّفًا");
  // ولا مفتاح بهذا المعنى في الكتالوج المبذور
  assert.ok(!/'csub\.approve'/.test(SQL.slice(0, SQL.indexOf("$perm$", SQL.indexOf("$perm$") + 6))),
    "مفتاح csub.approve مبذور في الكتالوج");
  assert.ok(!/'csub\.activate'/.test(SQL), "مفتاح csub.activate مبذور — التفعيل يُشترى بمفتاح");
});

test("★★ التفعيل: بوّابة المالك في الـRPC، والنواة غير ممنوحة لأحد", () => {
  const w = funcBody("csub_subscription_activate");
  assert.match(w, /csub_can_approve\(\)/, "التفعيل بلا بوّابة المالك");
  assert.match(w, /activation_requires_owner/, "رسالة الرفض لا تقول السبب الحقيقيّ");
  assert.ok(!/csub_perm/.test(w), "التفعيل يقبل مفتاح صلاحية بديلًا عن المالك");
  assert.ok(!/csub_can_manage/.test(w), "التفعيل يقبل مدير المبيعات — وهذا بالضبط ما مُنع");
  // النواة تفعل العمل، والغلاف وحده هو الباب.
  assert.match(w, /csub_activate_core/, "الغلاف لا يستدعي النواة");
  assert.match(SQL, /revoke all on function %s from authenticated[\s\S]*?/i, "لا نزع صلاحية للنوى");
  const revokeBlock = SQL.slice(SQL.indexOf("الدوالّ الداخلية: لا تُمنح لأحد"));
  for (const core of ["csub_activate_core(uuid,text)", "csub_renew_core(uuid,jsonb)"]) {
    assert.ok(revokeBlock.includes(core),
      `${core} غير مذكورة في قائمة النزع — نداء مباشر يلتفّ على بوّابة المالك`);
  }
});

test("★★ التجديد قرار مالك، وليس نتيجة عَلَم", () => {
  const r = funcBody("csub_subscription_renew");
  assert.match(r, /csub_can_approve\(\)/, "التجديد بلا بوّابة المالك");
  assert.match(r, /renewal_requires_owner/, "رسالة رفض التجديد غامضة");
  // ★ auto_renew لا يُقرأ في أيّ مسار يمنح رصيدًا.
  for (const f of ["csub_subscription_renew", "csub_renew_core", "csub_activate_core",
                   "csub_consume", "csub_period_close", "csub_expiry_scan"]) {
    assert.ok(!/auto_renew/.test(funcBody(f)),
      `${f} تقرأ auto_renew — العَلَم صار آلية شحن لا معلومة تعاقدية`);
  }
  // والعمود موثَّق بأنّه معلومة
  assert.match(SQL, /comment on column public\.csub_subscriptions\.auto_renew is/i,
    "auto_renew بلا تعليق يوضّح أنّه معلومة لا آلية");
  assert.match(SQL, /'renewal_is_manual'/, "لا إعداد صريح يقول إنّ التجديد يدويّ");
});

test("★ الاستئناف من التعليق يمرّ ببوّابة المالك أيضًا (فتح الاستهلاك = منح)", () => {
  const s = funcBody("csub_subscription_set_status");
  assert.match(s, /resume_requires_owner/,
    "العودة إلى active بيد مدير المبيعات — طريق جانبيّ إلى تفعيل الاستهلاك");
  assert.match(s, /invalid_transition/, "آلة الحالات تقبل أيّ انتقال");
  assert.match(s, /reason_required/, "تعليق أو إلغاء بلا سبب مكتوب");
  // ولا تحذف رصيدًا
  assert.ok(!/delete from public\.csub_ledger/.test(s), "تغيير الحالة يحذف قيودًا");
});

test("★ التسوية اليدوية: سبب إلزاميّ، والزيادة باعتماد المالك، ولا يُكتب قيد قبله", () => {
  const a = funcBody("csub_adjust");
  assert.match(a, /reason_required/, "تسوية بلا سبب مكتوب");
  assert.match(a, /csub_can_approve\(\)/, "الزيادة اليدوية بلا اعتماد مالك");
  assert.match(a, /v_qty > 0/, "لا تفريق بين زيادة ونقص");
  const pend = a.indexOf("'pending_approval'");
  const ins = a.indexOf("insert into public.csub_ledger");
  assert.ok(pend > 0 && pend < ins, "طلب الاعتماد بعد الإدراج — الرصيد يُمنح ثمّ يُطلب إذنه");
  // والنقص الذي يُعجِّز الرصيد يمرّ بالبوّابة نفسها
  assert.match(a, /v_avail \+ v_qty < 0 and not v_sub\.allow_overage/,
    "خصم يجعل الرصيد سالبًا يمرّ بلا اعتماد — خرق لقاعدة «لا رصيد سالب»");
});

test("★ العكس المُعجِّز يُرفع إلى المالك بدل أن يُمنع أو يمرّ بصمت", () => {
  const r = funcBody("csub_reverse");
  assert.match(r, /pending_approval/,
    "عكس يجعل الرصيد سالبًا إمّا يُمنع (فيكذب الدفتر) أو يمرّ (فيخرق القاعدة) — لا طريق ثالث");
  assert.match(r, /csub_can_approve\(\)/, "المالك نفسه يُمنع من التصحيح");
  assert.match(r, /allow_overage/, "لا يُراعى سماح الخطّة بالتجاوز");
});

test("طلبات الاعتماد: الطلب المعلَّق ليس رصيدًا، والقرار لا يُكرَّر", () => {
  const d = funcBody("csub_approval_decide");
  assert.match(d, /csub_can_approve\(\)/, "القرار بيد غير المالك");
  assert.match(d, /already_decided/, "يمكن اعتماد الطلب نفسه مرّتين");
  assert.match(d, /csub_activate_core/, "الاعتماد لا يُطبّق عبر النواة المشتركة — منطق مكرّر سينحرف");
  assert.match(d, /csub_renew_core/, "اعتماد التجديد لا يُطبّق عبر النواة المشتركة");
  assert.match(d, /apply_error/, "فشل التطبيق بعد الاعتماد يُبتلَع");
  // الرفض يُعيد الاشتراك إلى draft لا يتركه معلَّقًا للأبد
  assert.match(d, /status = 'draft'[\s\S]{0,120}pending_approval/,
    "رفض التفعيل يترك الاشتراك معلَّقًا بلا مخرج");
  // والطلب المعلَّق لا يُقرأ في أيّ حساب رصيد
  assert.ok(!/csub_approval_requests/.test(funcBody("csub_balance_core")),
    "حساب الرصيد يقرأ طلبات معلَّقة — نيّة تُحسب كرصيد");
});

test("سياسة قراءة طلبات الاعتماد تفرّق المالك عن مقدّم الطلب", () => {
  assert.match(SQL, /create policy csub_approval_requests_read on public\.csub_approval_requests for select to authenticated\s*\n?\s*using \(public\.csub_can_approve\(\) or \(public\.csub_can_view\(\) and requested_by = auth\.uid\(\)\)\)/i,
    "سياسة طلبات الاعتماد تكشف طلبات الآخرين (وهي تحمل كميّات ومبالغ)");
});

test("دورة حياة الاشتراك: الحالات السبع، وأوّلها draft لا active", () => {
  const def = tableDef("csub_subscriptions");
  for (const s of SUB_STATES) {
    assert.ok(def.includes(`'${s}'`), `الحالة ${s} غير مسموح بها`);
  }
  assert.match(def, /status\s+text not null default 'draft'/,
    "الاشتراك يُنشأ بحالة غير draft — قد يُنشأ مفعّلًا");
  const up = funcBody("csub_subscription_upsert");
  assert.match(up, /'draft'/, "الإنشاء لا يجبر الحالة على draft");
  assert.ok(!/status\s*=\s*coalesce\(public\.csub_txt\(p, 'status'\)/.test(up),
    "الحالة تُقبل من الحمولة — طريق مباشر إلى active بلا اعتماد");
  const sub = funcBody("csub_subscription_submit");
  assert.match(sub, /pending_approval/, "الإرسال للاعتماد لا يغيّر الحالة");
  assert.match(sub, /csub_approval_submit_core\('activation'/, "الإرسال لا يُنشئ طلب اعتماد فعليًّا");
});
