// ════════════════════════════════════════════════════════════════════════════
// tests/lead_notification_events.test.js — المرحلة ١٠: أحداث تُعرَّف ولا تُرسَل.
//
// العقد: ثلاثة عشر حدثًا · تمرّ عبر مركز الاتصالات القائم · dry_run = true ·
// مفتاح تكرار يمنع الإرسال المزدوج · والبريد والواتساب والرسائل القصيرة تبقى
// معطّلة ولا يفعّلها هذا الموديول.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  SQL, POSTCHECK, DOCS, read, funcBody, tableSrc, selfTest, EVENTS,
} = require("./lead_helpers.js");

test("الأحداث الثلاثة عشر — لا أكثر ولا أقلّ، وقائمة مغلقة", () => {
  assert.equal(EVENTS.length, 13, "قائمة العقد ليست ١٣ حدثًا");
  const keys = funcBody("lsr_event_keys");
  for (const e of EVENTS) {
    assert.ok(keys.includes(`'${e}'`), `الحدث «${e}» غير معرَّف`);
  }
  // ولا حدث بنصّ حرّ: الإدراج يرفض ما ليس في القائمة.
  const emit = funcBody("lsr_event_emit");
  assert.match(emit, /unknown_event/, "الإدراج يقبل حدثًا خارج الكتالوج");
  assert.match(emit, /= any\(public\.lsr_event_keys\(\)\)/,
    "الإدراج لا يتحقّق من القائمة المغلقة");
});

test("★ dry_run مُجبَر على صفوف الطابور ★", () => {
  const emit = funcBody("lsr_event_emit");
  assert.match(emit, /update public\.comms_outbox set dry_run = true/,
    "الإدراج لا يُجبر dry_run — لو فُعِّلت قناة يومًا لغادرت رسائل هذا الموديول");
  assert.match(emit, /correlation_id = \$1/,
    "الإجبار غير محصور بصفوف هذا الحدث");
  assert.match(emit, /'dry_run', true/, "المخرَج لا يعلن أنّه جافّ");
});

test("★ الموديول لا يفعّل قناة إرسال ★", () => {
  const emit = funcBody("lsr_event_emit");
  assert.doesNotMatch(emit, /comms_channels/,
    "★ خرق ★ الموديول يلمس جدول القنوات — التفعيل قرار مالك في مركز الاتصالات");
  // ولا في أيّ موضع من الحزمة خارج التعليق التوضيحيّ والفحص الذاتيّ.
  const setChannel = /update\s+public\.comms_channels\s+set/i;
  assert.doesNotMatch(SQL, setChannel, "الحزمة تعدّل حالة قناة إرسال");
});

test("★ مفتاح التكرار يسبق لمس الطابور ★", () => {
  const emit = funcBody("lsr_event_emit");
  const guardIdx = emit.indexOf("on conflict (idempotency_key) do nothing");
  const enqueueIdx = emit.indexOf("comms_enqueue");
  assert.ok(guardIdx > 0, "لا حارس تكرار عند الإدراج");
  assert.ok(enqueueIdx > guardIdx,
    "الطابور يُلمس قبل حارس التكرار — إعادة المحاولة ستُدرج الحدث مرّتين");
  assert.match(emit, /'duplicate', true/, "التكرار لا يُعلَن للمنادي");
  assert.match(emit, /if v_id is null then/, "لا فرع للتكرار المكتشَف");
});

test("مفتاح التكرار فريد على مستوى القاعدة لا على مستوى الكود", () => {
  assert.match(SQL, /create unique index if not exists uq_lsr_event_idem\s+on public\.lsr_event_log\(idempotency_key\)/,
    "لا فهرس فريد على مفتاح التكرار — الحارس نيّة لا بنية");
  const t = tableSrc("lsr_event_log");
  assert.match(t, /idempotency_key\s+text\s+not\s+null/,
    "مفتاح التكرار قابل لأن يكون NULL — وNULL لا يتصادم فلا يمنع شيئًا");
});

test("★ قيد بنيويّ يمنع تسجيل إرسال حقيقيّ من هذا الموديول ★", () => {
  const t = tableSrc("lsr_event_log");
  assert.match(t, /constraint lsr_event_dry_run_only\s+check\s*\(dry_run\)/i,
    "لا قيد يمنع تسجيل صفّ غير جافّ — سيصير ادّعاء الإرسال ممكنًا بلا إرسال");
});

test("غياب مركز الاتصالات يُعلَن ولا يُقرأ إرسالًا", () => {
  const emit = funcBody("lsr_event_emit");
  assert.match(emit, /to_regprocedure\('public\.comms_enqueue/,
    "لا اكتشاف لمركز الاتصالات");
  assert.match(emit, /comms_hub_not_installed/, "الغياب بلا سبب معلَن");
  assert.match(emit, /لا إرسال ولا ادّعاء إرسال/,
    "الرسالة لا تفرّق بين «سُجّل محليًّا» و«أُرسل»");
  assert.match(emit, /'hub_available'/, "المخرَج لا يعلن توفّر المركز");
  // وفشل الطابور لا يُسقط عملية العمل ولا يُقرأ نجاحًا.
  assert.match(emit, /hub_enqueue_failed/, "فشل الإدراج غير مصنَّف");
});

test("التسجيل في كتالوج المركز مكتشَف وببادئة لا تصطدم", () => {
  const i = SQL.indexOf("do $ev$");
  assert.ok(i > 0, "كتلة تسجيل الأحداث غائبة");
  const block = SQL.slice(i, SQL.indexOf("$ev$;", i));
  assert.match(block, /to_regclass\('public\.comms_event_catalog'\) is null then return/,
    "التسجيل لا يتخطّى بلطف عند غياب المركز");
  assert.match(block, /'commercial\.' \|\| k/,
    "الأحداث بلا بادئة — قد تصطدم بمفردات المركز القائمة");
  assert.match(block, /on conflict \(event_key\) do nothing/,
    "التسجيل غير قابل لإعادة التشغيل");
  // ولا يفعّل قناة ولا يغيّر إعدادات المركز.
  assert.doesNotMatch(block, /comms_channels/, "التسجيل يلمس القنوات");
});

test("قوالب العميل بلا أرقام مالية (حارس المحتوى المقيَّد)", () => {
  const i = SQL.indexOf("do $ev$");
  const block = SQL.slice(i, SQL.indexOf("$ev$;", i));
  assert.match(block, /audience_scope/, "لا تمييز بين نطاق العميل والنطاق الداخليّ");
  assert.match(block, /'client'/, "لا قالب لنطاق العميل");
  assert.doesNotMatch(block, /\{\{\s*(price|amount|total|vat|cost)/i,
    "قالب العميل يحقن رقمًا ماليًّا — سيصطدم بحارس المحتوى المقيَّد أو يسرّب");
});

test("الحدث المالي داخليّ فقط", () => {
  const i = SQL.indexOf("do $ev$");
  const block = SQL.slice(i, SQL.indexOf("$ev$;", i));
  assert.match(block, /v_fin := \(k = 'overage_approval_required'\)/,
    "لا تصنيف مالي للأحداث");
  // ويجب ألّا يكون الحدث المالي ضمن جمهور «both».
  const audienceBoth = block.slice(block.indexOf("v_aud := case k"),
                                   block.indexOf("v_fin :="));
  assert.doesNotMatch(audienceBoth, /overage_approval_required/,
    "حدث مالي بجمهور يشمل العميل");
});

test("الإسناد يُصدر حدثه بمفتاح تكرار حتميّ", () => {
  const assign = funcBody("lsr_assign");
  assert.match(assign, /lsr_event_emit\('lead_assigned'/, "الإسناد لا يُصدر حدثه");
  assert.match(assign, /'lead_assigned:' \|\| v_lead::text/,
    "مفتاح التكرار غير مشتقّ من الكيان — إعادة النداء ستُدرج مرّتين");
  // والحدث بعد الكتابة لا قبلها.
  assert.ok(assign.indexOf("update public.crm_leads") < assign.indexOf("lsr_event_emit"),
    "الحدث يُصدر قبل الكتابة — إشعار عن شيء قد لا يحدث");
});

test("قائمة الأحداث تعلن أنّ القنوات معطّلة", () => {
  const list = funcBody("lsr_events_list");
  assert.match(list, /'email', 'disabled'/, "لا إعلان لتعطيل البريد");
  assert.match(list, /'whatsapp', 'disabled'/, "لا إعلان لتعطيل واتساب");
  assert.match(list, /'sms', 'disabled'/, "لا إعلان لتعطيل الرسائل القصيرة");
  assert.match(list, /dry_run_only/, "لا إعلان لوضع التشغيل الجافّ");
  const access = funcBody("lsr_access");
  assert.match(access, /'delivery'/, "سطح الوصول لا يعلن حالة الإرسال للواجهة");
});

test("لا مسار إرسال حقيقيّ في الحزمة كلّها", () => {
  // نتخطّى أسطر الحراسة نفسها (تعبير نمطيّ يمنع الرمز) — وهي الوحيدة
  // المسموح لها بذكره.
  for (const [n, line] of SQL.split("\n").entries()) {
    if (/[!]?~\*\s*'\(/.test(line)) continue;
    if (/^\s*--/.test(line)) continue;
    assert.doesNotMatch(
      line, /net\.http_post|pg_net|smtp|sendgrid|twilio/i,
      `مسار إرسال حقيقيّ في السطر ${n + 1}: ${line.trim()}`,
    );
  }
});

test("الفحص الذاتيّ وPOSTCHECK يغطّيان عقد الأحداث", () => {
  const st = selfTest();
  assert.match(st, /idempotency_key/, "الفحص الذاتيّ لا يتحقّق من مفتاح التكرار");
  assert.match(st, /dry_run = true/, "الفحص الذاتيّ لا يتحقّق من إجبار dry_run");
  assert.match(st, /comms_channels/, "الفحص الذاتيّ لا يمنع لمس القنوات");
  assert.match(st, /13/, "الفحص الذاتيّ لا يتحقّق من عدد الأحداث");

  assert.match(POSTCHECK, /lsr_event_dry_run_only/, "POSTCHECK لا يفحص قيد الجفاف");
  assert.match(POSTCHECK, /uq_lsr_event_idem|idempotency_key/, "POSTCHECK لا يفحص التكرار");
});

test("التوثيق يذكر الأحداث الثلاثة عشر ويعلن أنّها لا تُرسَل", () => {
  const doc = read(DOCS.contracts);
  for (const e of EVENTS) {
    assert.ok(doc.includes(e), `العقود لا تذكر الحدث «${e}»`);
  }
  assert.match(doc, /تُدرجها.*لا تُرسل|لا تُرسل/, "العقود لا تعلن أنّ الأحداث لا تُرسَل");
  const limits = read(DOCS.limits);
  assert.match(limits, /لا شيء يُرسَل/, "وثيقة الحدود لا تبدأ بحقيقة التعطيل");
});
