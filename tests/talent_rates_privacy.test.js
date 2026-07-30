// ════════════════════════════════════════════════════════════════════════════
// tests/talent_rates_privacy.test.js — الأجر والبيانات البنكية.
// ★ null لا صفر ★ الفصل بنيويّ لا اجتهاديّ · التدقيق لا يحفظ الأرقام ·
// طاقم العمل والعميل خارج كلّ مسار.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const { SQL, LIB, funcBody, tableDef, selfTest } = require("./talent_helpers.js");

test("الأجر في جدول منفصل، لا كعمود في الملفّ", () => {
  const profiles = tableDef("tvn_profiles");
  for (const c of ["day_rate", "hourly_rate", "overtime_rate", "half_day_rate"]) {
    assert.doesNotMatch(profiles, new RegExp(`\\b${c}\\b`),
      `★ خرق ★ ${c} عمود في tvn_profiles — أيّ SELECT على الملفّ تسريب للأجر`);
  }
  const rates = tableDef("tvn_profile_rates");
  for (const c of ["day_rate", "half_day_rate", "hourly_rate", "overtime_rate", "min_hours"]) {
    assert.match(rates, new RegExp(`\\b${c}\\b`), `حقل الأجر ${c} مفقود`);
  }
  assert.match(rates, /valid_from/, "لا سريان للسعر — تعديله يمحو تاريخه");
});

test("★ غير المخوَّل يرى null مع علم رؤية صريح، لا صفرًا ★", () => {
  const body = funcBody("tvn_profile_get");
  assert.match(body, /if public\.can_view_vendor_rates\(\) then/,
    "الأجر يُجمَع قبل فحص البوّابة");
  assert.match(body, /'rates', v_rates, 'rates_visible', public\.can_view_vendor_rates\(\)/,
    "لا علم رؤية صريح");
  assert.doesNotMatch(body, /'rates', coalesce\(v_rates, '\[\]'/,
    "المصفوفة الفارغة تُقرأ «لا أسعار» بدل «غير مصرّح»");
  assert.match(body, /'bank_visible',\s+public\.tvn_can_view_bank\(\)/, "لا علم رؤية للبنك");
});

test("الملاحظات الداخلية تُحجَب عن غير المدير", () => {
  const body = funcBody("tvn_profile_get");
  assert.match(body, /to_jsonb\(p\) - 'internal_notes'/, "الملاحظات تخرج مع الملفّ كاملًا");
  assert.match(body, /when public\.can_manage_talent_profiles\(\) then p\.internal_notes else null end/,
    "الملاحظات تعود لغير المخوَّل");
});

test("★ سجلّ التدقيق لا يحفظ قيم الأجر ★", () => {
  const body = funcBody("tvn_rates_set");
  // نداء التدقيق الناجح هو الأخير؛ الأوّل هو تسجيل المحاولة المرفوضة.
  const logCall = body.slice(body.lastIndexOf("perform public.tvn_log('rates_set'"));
  for (const f of ["day_rate", "hourly_rate", "overtime_rate"]) {
    assert.doesNotMatch(logCall, new RegExp(`tvn_num\\(p_input, '${f}'\\)`),
      `★ خرق ★ التدقيق يحفظ قيمة ${f} — من يقرأ التدقيق ليس بالضرورة مخوَّلًا لرؤيتها`);
  }
  assert.match(logCall, /fields_set/, "التدقيق لا يسجّل حتّى أسماء الحقول المعدَّلة");
});

test("سياسة الأجر أضيق من سياسة الشبكة — ويفحصها SELF-TEST بنفسه", () => {
  const idx = SQL.indexOf("create policy tvn_rates_read");
  const policy = SQL.slice(idx, idx + 220);
  assert.match(policy, /can_view_vendor_rates\(\)/, "سياسة الأجر ببوّابة خاطئة");
  assert.doesNotMatch(policy, /can_view_talent_network/, "سياسة الأجر تتّسع لكلّ من يرى الشبكة");
  const st = selfTest();
  assert.match(st, /سياسة الأجر لا تستند إلى can_view_vendor_rates/,
    "SELF-TEST لا يحرس سياسة الأجر");
  assert.match(st, /سياسة الأجر تتّسع لكلّ من يرى الشبكة/,
    "SELF-TEST لا يمنع اتّساع سياسة الأجر لاحقًا");
});

test("البيانات البنكية وصفية، مقفلة بمفتاح مستقلّ، ولا تُوثَّق ذاتيًّا", () => {
  const def = tableDef("tvn_profile_bank");
  assert.match(def, /check \(verified = false or \(verified_by is not null and verified_at is not null\)\)/,
    "توثيق بنكيّ بلا موثِّق");
  assert.doesNotMatch(def, /account_number|full_iban/i, "رقم حساب كامل في الجدول");
  assert.match(funcBody("tvn_bank_set"), /tvn_can_view_bank\(\)/, "الكتابة بلا بوّابة بنكية");
  assert.match(funcBody("tvn_bank_set"), /v_last4 !~ '\^\[0-9\]\{1,4\}\$'/,
    "الدالّة تقبل أكثر من أربعة أرقام");
});

test("الطبقة البرمجية لا تعرض صفرًا مكان «غير مصرّح»", () => {
  assert.match(LIB, /export function rateAr/, "لا دالّة عرض للأجر");
  const fn = LIB.slice(LIB.indexOf("export function rateAr"), LIB.indexOf("export function rateAr") + 400);
  assert.match(fn, /if \(!visible\) return "غير مصرّح لك بعرض الأجر"/,
    "الطبقة لا تميّز «غير مصرّح» عن «صفر»");
  assert.match(fn, /return "لم يُسجَّل بعد"/, "غياب السعر يُعرَض رقمًا");
  assert.doesNotMatch(fn, /\?\?\s*0\b/, "صفر افتراضيّ مكان القيمة الغائبة");
});

test("الطبقة تعرّف الأجر nullable ولا تفترض وجوده", () => {
  assert.match(LIB, /day_rate: number \| null/, "نوع الأجر غير قابل للغياب");
  assert.match(LIB, /rate_visible: boolean/, "لا علم رؤية في النوع");
  assert.match(LIB, /can_view_rates: boolean/, "خريطة القدرات بلا إذن الأجر");
});
