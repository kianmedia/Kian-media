// ════════════════════════════════════════════════════════════════════════════
// tests/commercial_ledger_invariants.test.js
//
// الاستحالات التي طلبها المتطلّب حرفيًّا، واحدة واحدة. كلّ اختبار هنا يسأل
// سؤالًا واحدًا: **أين** تُمنع هذه الحالة؟ وإن كان الجواب «في الواجهة» فهو فشل.
//
//   ١ رصيد متاح سالب بلا سماح بالتجاوز
//   ٢ استهلاك مزدوج
//   ٣ إعادة استعمال مفتاح تكرار
//   ٤ استهلاك من اشتراك منتهٍ
//   ٥ استهلاك رصيد عميل لحساب عميل آخر
//   ٦ تجاوز المتاح بلا اعتماد
//   ٧ سباق: استهلاكان متزامنان لا ينجحان معًا
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  SQL, funcBody, funcDecl, tableDef, LEDGER_WRITERS, ENTRY_TYPES,
} = require("./commercial_subscriptions_helpers.js");

test("١ — رصيد سالب: يُمنع على الخادم، ويُذكر السماح بالتجاوز صراحةً", () => {
  const c = funcBody("csub_consume");
  assert.match(c, /insufficient_balance/, "الاستهلاك بلا حارس رصيد");
  assert.match(c, /allow_overage/, "الاستهلاك لا يقرأ سماح الخطّة بالتجاوز");
  // الرفض لا يكتب شيئًا: الإرجاع قبل أيّ insert.
  const idx = { deny: c.indexOf("insufficient_balance"), ins: c.indexOf("insert into public.csub_ledger") };
  assert.ok(idx.deny < idx.ins, "رفض الرصيد يقع بعد الإدراج — قيد سيُكتب ثمّ يُرفض");
  // والحجز لا يفتح بابًا خلفيًّا للتجاوز.
  assert.match(funcBody("csub_reserve"), /insufficient_balance/,
    "الحجز يتجاوز الرصيد — باب خلفيّ إلى رصيد سالب");
});

test("٢ — استهلاك مزدوج: مفتاح تكرار إلزاميّ + صافي الاستهلاك لكلّ طلب خدمة", () => {
  const c = funcBody("csub_consume");
  assert.match(c, /idempotency_key_required/, "مفتاح التكرار غير إلزاميّ في الاستهلاك");
  assert.match(c, /service_request_already_consumed/, "لا حارس ضدّ استهلاك طلب الخدمة نفسه مرّتين");
  // القياس بالصافي (sum d_used) لا بوجود صفّ: بعد قيد عكسيّ يجب أن يعود الاستهلاك ممكنًا.
  assert.match(c, /sum\(l\.d_used\)/,
    "الحارس يقيس وجود صفّ لا صافي الاستهلاك — بعد التصحيح بقيد عكسيّ سيبقى الاستهلاك محظورًا خطأً");
});

test("٣ — مفتاح التكرار: فهرس فريد + بصمة حمولة + لا تسريب عبر العملاء", () => {
  assert.match(SQL, /create unique index if not exists uq_csub_ledger_idem\s+on public\.csub_ledger\(idempotency_key\)/i,
    "لا فهرس فريد على مفتاح التكرار — «الاستحالة» مجرّد فحص تطبيقيّ");
  const look = funcBody("csub_idem_lookup");
  assert.match(look, /idempotency_conflict/, "إعادة استعمال المفتاح بحمولة مختلفة تمرّ بصمت");
  assert.match(look, /idempotency_fingerprint is distinct from p_fp/,
    "لا مقارنة بصمة — المفتاح نفسه بكميّة مختلفة سيعيد نتيجة خاطئة");
  assert.match(look, /r\.client_id is distinct from p_client/,
    "المفتاح المشترك بين عميلين يعيد قيد عميل آخر — تسريب عبر مفتاح تكرار");
  // ولا يُعاد معرّف قيد عميل آخر في حالة التعارض: يُقرأ **كائن الإرجاع نفسه**
  // (من return الذي يحمل idempotency_conflict حتى نهاية جملته) لا نافذة تقريبية.
  const cIdx = look.indexOf("idempotency_conflict");
  const rStart = look.lastIndexOf("return jsonb_build_object", cIdx);
  const conflictReturn = look.slice(rStart, look.indexOf(";", cIdx) + 1);
  assert.ok(conflictReturn.includes("idempotency_conflict"), "تعذّر عزل كائن إرجاع التعارض");
  assert.ok(!/entry_id/.test(conflictReturn),
    "كائن إرجاع التعارض يكشف معرّف قيد عميل آخر");
  for (const f of LEDGER_WRITERS) {
    assert.match(funcBody(f), /idempotency_key/, `${f} بلا مفتاح تكرار`);
  }
});

test("٤ — اشتراك منتهٍ: الحالة والتواريخ ومهلة السماح، ثلاثتها", () => {
  const c = funcBody("csub_consume");
  assert.match(c, /v_sub\.status <> 'active'/, "الاستهلاك لا يفحص حالة الاشتراك");
  assert.match(c, /subscription_expired/, "الاستهلاك لا يفحص انتهاء المدّة");
  assert.match(c, /grace_period_days/, "الانتهاء يُحسب بلا مهلة سماح — سيرفض استهلاكًا مشروعًا");
  assert.match(c, /usage_before_start/, "استهلاك بتاريخ سابق لبدء الاشتراك يمرّ");
  // والمسح الزمنيّ يقلب الحالة فعلًا لا يكتفي بالتاريخ
  assert.match(funcBody("csub_expiry_scan"), /status = 'expired'/,
    "المسح الزمنيّ لا يقلب حالة الاشتراك المنتهي");
});

test("٥ — عزل العميل: مُشتقّ من الاشتراك في مُشغِّل، لا مأخوذ من المُنادي", () => {
  const post = funcBody("csub_ledger_post");
  assert.match(post, /select s\.client_id into v_client from public\.csub_subscriptions/,
    "العميل لا يُقرأ من الاشتراك");
  assert.match(post, /ledger_client_mismatch/, "قيد بعميل مخالف لصاحب الاشتراك يمرّ");
  assert.match(post, /unit_not_in_subscription/, "قيد بوحدة ليست في الاشتراك يمرّ");
  // العميل لا يتغيّر على اشتراك قائم — تغييره نقل رصيد.
  assert.match(funcBody("csub_subscription_upsert"), /client_is_immutable/,
    "يمكن نقل اشتراك من عميل إلى آخر — نقل رصيد بلا قيد");
  // ولا دالّة كتابة تقبل client_id من الحمولة عند القيد.
  for (const f of LEDGER_WRITERS) {
    const b = funcBody(f);
    assert.ok(!/csub_uuid\(p,\s*'client_id'\)/.test(b),
      `${f} تقبل client_id من الحمولة — الطريق المباشر إلى رصيد عميل آخر`);
  }
});

test("٦ — التجاوز: اعتماد مالك، ولا يُكتب قيد قبل القرار، ويُستهلك الإذن مرّة", () => {
  const c = funcBody("csub_consume");
  assert.match(c, /overage_requires_approval/, "التجاوز لا يقرأ اشتراط الاعتماد");
  assert.match(c, /pending_approval/, "التجاوز غير المعتمَد لا يُنتج طلب اعتماد");
  const pend = c.indexOf("'pending_approval'");
  const ins = c.indexOf("insert into public.csub_ledger");
  assert.ok(pend > 0 && pend < ins, "طلب الاعتماد يقع بعد إدراج القيد — التجاوز يُنفَّذ ثمّ يُطلب إذنه");
  assert.match(c, /consumed_entry_id is null/, "إذن التجاوز قابل لإعادة الاستعمال");
  assert.match(c, /consumed_entry_id = v_entry/, "إذن التجاوز لا يُوسَم بعد استعماله");
  assert.match(c, /overage_approval_already_used/, "سباق على الإذن نفسه قد ينجح مرّتين");
  // الاعتماد نفسه لا يُنشئ رصيدًا: هو إذن لا قيد.
  assert.match(funcBody("csub_approval_decide"), /applies_nothing/,
    "اعتماد التجاوز يكتب قيدًا — الاعتماد إذن لا منحة");
});

test("٧ — السباق: قفل صفّ بترتيب ثابت، والرصيد يُحسب بعد القفل", () => {
  for (const f of LEDGER_WRITERS) {
    assert.match(funcBody(f), /for update/i, `${f} تكتب في الدفتر بلا قفل صفّ`);
  }
  const c = funcBody("csub_consume");
  const lockSub = c.indexOf("from public.csub_subscriptions");
  const lockUnit = c.indexOf("from public.csub_subscription_units");
  const balance = c.indexOf("csub_available_core(v_sub.id, v_unit)");
  assert.ok(lockSub > 0 && lockUnit > lockSub,
    "ترتيب القفل غير ثابت (الاشتراك ثمّ الوحدة) — احتمال جمود بين معاملتين");
  assert.ok(balance > lockUnit,
    "الرصيد يُحسب قبل قفل صفّ الوحدة — استهلاكان متزامنان قد يقرآن الرصيد نفسه وينجحان معًا");
  // القفل على مرساة ثابتة لا على صفوف الدفتر (التي تتكاثر).
  assert.match(c, /from public\.csub_subscription_units[\s\S]{0,200}for update/i,
    "لا قفل على صفّ وحدة الاشتراك — مرساة الرصيد غير محميّة");
});

test("القيود البنيوية: إشارات الكميّات والتجاوز والعملة", () => {
  const def = tableDef("csub_ledger");
  assert.match(def, /csub_ledger_quantity_sign/, "لا قيد على إشارة الكميّة");
  assert.match(def, /entry_type in \('reversal','adjustment'\) or quantity > 0/,
    "كميّة سالبة مسموحة في نوع لا يحتملها");
  assert.match(def, /csub_ledger_reversal_link/, "قيد عكسيّ بلا مرجع، أو مرجع بلا نوع عكسيّ");
  assert.match(def, /currency = 'SAR'/, "الدفتر يقبل عملة غير الريال");
  for (const e of ENTRY_TYPES) {
    assert.ok(def.includes(`'${e}'`), `نوع القيد ${e} غير مسموح في القيد`);
  }
});

test("الرصيد مشتقّ: جمع أعمدة الترحيل، والمتاح تعريفه صريح", () => {
  const bal = funcBody("csub_balance_core");
  assert.match(bal, /sum\(l\.d_allocated\)[\s\S]*sum\(l\.d_reserved\)[\s\S]*sum\(l\.d_used\)[\s\S]*sum\(l\.d_expired\)/,
    "الرصيد لا يُجمع من أعمدة الترحيل الأربعة");
  assert.match(bal, /d_allocated\), 0\) - coalesce\(sum\(l\.d_reserved\), 0\)\s*\n?\s*- coalesce\(sum\(l\.d_used\), 0\) - coalesce\(sum\(l\.d_expired\), 0\)/,
    "المتاح ليس allocated − reserved − used − expired");
  assert.match(funcDecl("csub_balance_core"), /\bstable\b/i,
    "دالّة الرصيد ليست STABLE — لا شيء يمنعها من الكتابة");
  // ولا عمود رصيد محفوظ في أيّ جدول
  assert.ok(!/\n\s+balance\s+numeric/i.test(SQL), "عمود رصيد محفوظ — الرصيد لم يعد مشتقًّا");
});

test("الحجز: المتبقّي يُحسب من الدفتر لا من عمود، ولا يُفكّ أكثر ممّا حُجز", () => {
  const post = funcBody("csub_ledger_post");
  assert.match(post, /reservation_exhausted/, "يمكن فكّ حجز أكثر من المحجوز");
  assert.match(post, /where l\.id = r\.id or l\.reservation_entry_id = r\.id/,
    "المتبقّي من الحجز لا يجمع القيود المنسوبة إليه — الفكّ المزدوج ممكن");
  assert.match(post, /r\.entry_type = 'reservation' then r\.id/,
    "عكس الحجز لا يُنسب إلى الحجز — المتبقّي سيبقى محجوزًا بعد إلغائه");
});
