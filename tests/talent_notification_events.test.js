// ════════════════════════════════════════════════════════════════════════════
// tests/talent_notification_events.test.js — أحداث فقط.
// ★ لا شيء يُرسَل ★ قناة portal وحدها · لا لمس لإعدادات القنوات · منع تكرار ·
// وأحداث الأصول تُعرَّف بلا ادّعاء ملكيتها.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  SQL, POSTCHECK, LIB, funcBody, doBlock, tableDef, TALENT_EVENTS, ASSET_EVENTS,
} = require("./talent_helpers.js");

test("الأحداث السبعة عشر كلّها مُعرَّفة", () => {
  const keys = funcBody("tvn_event_keys");
  for (const e of TALENT_EVENTS) {
    assert.match(keys, new RegExp(`'${e}'`), `الحدث ${e} مفقود من قائمة الحزمة`);
  }
  const assetKeys = funcBody("tvn_asset_event_keys");
  for (const e of ASSET_EVENTS) {
    assert.match(assetKeys, new RegExp(`'${e}'`), `حدث الأصول ${e} مفقود`);
  }
});

test("★ قناة portal وحدها — لا email ولا whatsapp ولا sms ★", () => {
  const ev = doBlock("ev");
  assert.match(ev, /array\[%L\]::text\[\]/, "مصفوفة القنوات ليست قناة واحدة");
  assert.match(ev, /'internal', 'portal'/, "القناة المُمرَّرة ليست portal");
  assert.doesNotMatch(ev, /'email'/, "★ خرق ★ قناة بريد في تسجيل الأحداث");
  assert.doesNotMatch(ev, /'whatsapp'/, "★ خرق ★ قناة واتساب");
  assert.doesNotMatch(ev, /'sms'/, "★ خرق ★ قناة رسائل نصّية");
});

test("الحزمة لا تلمس إعدادات القنوات ولا تمرّر dry_run", () => {
  // الذكر الوحيد المسموح لـcomms_channel_set هو داخل حارس SELF-TEST الذي
  // يفشل إن استُدعيت. أيّ صيغة استدعاء حقيقية ممنوعة.
  assert.doesNotMatch(SQL, /(perform|select|execute)[^\n]*comms_channel_set\s*\(/i,
    "★ خرق ★ الحزمة تفعّل قناة");
  assert.match(SQL, /ilike '%comms_channel_set%'/,
    "SELF-TEST لا يحرس ضدّ لمس إعدادات القنوات");
  assert.doesNotMatch(SQL, /update public\.comms_channels/i, "الحزمة تعدّل القنوات");
  const code = SQL.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
  assert.doesNotMatch(code, /dry_run\s*=>?\s*false/i, "الحزمة تُطفئ الوضع الجافّ");
  assert.doesNotMatch(funcBody("tvn_emit"), /dry_run/, "مسار الإدراج يقرّر عن المركز");
});

test("لا مسار إرسال في الحزمة كلّها", () => {
  const code = SQL.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
  for (const bad of ["smtp", "resend", "sendgrid", "twilio", "http_post", "pg_net", "net.http"]) {
    assert.ok(!code.toLowerCase().includes(bad), `★ خرق ★ مسار إرسال محتمل: ${bad}`);
  }
  assert.doesNotMatch(code, /comms_claim|comms_settle/,
    "الحزمة تُشغّل عامل الطابور بنفسها — الإدراج ليس إرسالًا");
});

test("منع التكرار مفروض بمفتاح تفرُّد فريد لا بنيّة حسنة", () => {
  assert.match(tableDef("tvn_event_log"), /idempotency_key text not null unique/,
    "مفتاح التفرُّد ليس فريدًا");
  const emit = funcBody("tvn_emit");
  assert.match(emit, /exception when unique_violation/, "التكرار يُسقط العملية بدل تخطّيه");
  assert.match(emit, /'reason', 'duplicate'/, "التكرار لا يُبلَّغ عنه بصدق");
});

test("الإدراج يُسجَّل حتّى حين يغيب المركز، ولا يدّعي نجاحًا", () => {
  const emit = funcBody("tvn_emit");
  assert.match(emit, /to_regprocedure\('public\.comms_enqueue/, "لا اكتشاف للمركز");
  assert.match(emit, /comms hub not installed/, "غياب المركز لا يُصرَّح به");
  assert.match(emit, /v_ok := false/, "فشل الإدراج يُسجَّل كنجاح");
  assert.match(emit, /set enqueued = v_ok/, "حالة الإدراج غير محفوظة");
});

test("كلّ حدث له مُنتِج حقيقيّ في الحزمة", () => {
  const producers = {
    assignment_proposed: "tvn_assignment_propose",
    assignment_confirmed: "tvn_assignment_confirm",
    performance_review_due: "tvn_assignment_complete",
    vendor_suspended: "tvn_profile_set_status",
    availability_confirmation_required: "tvn_availability_set",
    document_expiring: "tvn_document_alerts",
    document_expired: "tvn_document_alerts",
  };
  for (const [event, fn] of Object.entries(producers)) {
    assert.match(funcBody(fn), new RegExp(`'${event}'`),
      `الحدث ${event} مُعرَّف بلا مُنتِج في ${fn} — حدث لا يقع أبدًا`);
  }
});

test("أحداث الأصول تُعرَّف بلا دهس، وبادئة منفصلة", () => {
  const ev = doBlock("ev");
  assert.match(ev, /on conflict \(event_key\) do nothing/,
    "التسجيل يدهس تعريفًا سجّلته حزمة الأصول");
  assert.match(ev, /'asset\.' \|\| k/, "أحداث الأصول بلا بادئة خاصّة بها");
  assert.match(ev, /'talent\.' \|\| k/, "أحداث الحزمة بلا بادئة");
  // ولا نُنتج حدث أصول من هنا: التعريف ليس ملكية.
  for (const e of ASSET_EVENTS) {
    assert.doesNotMatch(funcBody("tvn_emit"), new RegExp(`'${e}'`),
      `الحزمة تُنتج حدث أصول (${e}) لا تملكه`);
  }
});

test("تسجيل الكتالوج مكتشِف للميزة ولا يفشل حين يغيب المركز", () => {
  const ev = doBlock("ev");
  assert.match(ev, /if to_regclass\('public\.comms_event_catalog'\) is null then return; end if;/,
    "غياب المركز يُسقط الترحيلة");
  assert.match(ev, /if to_regclass\('public\.comms_templates'\) is not null then/,
    "القوالب تُفترض موجودة");
});

test("الطبقة البرمجية لا ترسل ولا تدّعي تسليمًا", () => {
  assert.match(LIB, /لا شيء يُرسَل|⛔/, "الطبقة لا تُصرّح بأنّ شيئًا لا يُرسَل");
  assert.doesNotMatch(LIB, /fetch\(['"`]https?:\/\//, "نداء شبكة خارجيّ من الطبقة");
  assert.match(LIB, /tvnScanAlerts/, "لا نداء للمسح");
});

test("POSTCHECK يتحقّق بنفسه من غياب قنوات الإرسال", () => {
  assert.match(POSTCHECK, /لا قناة إرسال/, "POSTCHECK لا يفحص القنوات");
  assert.match(POSTCHECK, /''email'' = any\(channels\)/, "الفحص لا يقرأ مصفوفة القنوات فعليًّا");
});
