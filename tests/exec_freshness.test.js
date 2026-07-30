// ════════════════════════════════════════════════════════════════════════════
// tests/exec_freshness.test.js
//
// ★ رقمٌ قديم لا يُعرض قطّ على أنّه حيّ ★
// الذاكرة المؤقّتة تُسرّع اللوحة، وثمنها الوحيد المقبول هو أن يُعلَن عمر الرقم
// دائمًا. هذه الاختبارات تحرس: إعلان الطزاجة، وفصل الذاكرة بين المستخدمين
// ومستويَي الحساسية، ووسم الفشل، وأن ترويسة ملفّ التصدير تحمل وقت الحساب.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  SQL, TS, ATOMS, DASH, POSTCHECK, funcBody, funcDecl, selfTest,
} = require("./exec_helpers.js");

test("جدول الذاكرة يحمل وقت الحساب وصاحبه ومستوى حساسيته", () => {
  const t = SQL.slice(SQL.indexOf("create table if not exists public.mgmt_report_cache"),
                      SQL.indexOf("create index if not exists mgmt_report_cache_user_idx"));
  for (const col of ["cache_key", "user_id", "filters", "sensitive_view", "payload",
                     "computed_at", "ttl_seconds"]) {
    assert.ok(t.includes(col), `عمود ${col} مفقود من جدول الذاكرة`);
  }
  assert.match(t, /computed_at\s+timestamptz not null/, "وقت الحساب ليس إلزاميًّا");
});

test("★ مفتاح الذاكرة يفصل بين المستخدمين ومستويَي الحساسية ★", () => {
  const body = funcBody("mgmt_cache_key");
  assert.match(body, /auth\.uid\(\)/,
    "المفتاح لا يتضمّن المستخدم — نسخة المالك قد تُقدَّم لغيره");
  assert.match(body, /p_sensitive/,
    "المفتاح لا يتضمّن مستوى الحساسية — نسخة فيها هوامش قد تُقدَّم لمن لا يراها");
  assert.match(body, /p_norm->>'from'[\s\S]{0,120}p_norm->>'departments'/,
    "المفتاح لا يتضمّن المرشّحات — مدى مختلف سيُقدَّم بأرقام مدى آخر");
});

test("سياسة الذاكرة تقصر الصفّ على صاحبه، والقراءة خلف بوّابة اللوحة", () => {
  const pol = SQL.slice(SQL.indexOf("create policy mgmt_report_cache_sel"),
                        SQL.indexOf("drop policy if exists mgmt_audit_sel"));
  assert.match(pol, /user_id = auth\.uid\(\)/, "السياسة لا تقصر الصفّ على صاحبه");
  assert.match(pol, /mgmt_can_view\(\)/, "السياسة بلا بوّابة اللوحة");
  assert.match(pol, /for select/, "السياسة ليست للقراءة فقط");
});

test("اللوحة تُعلن الطزاجة في كلّ مسار خروج", () => {
  const body = funcBody("mgmt_dashboard");
  for (const k of ["generated_at", "age_seconds", "is_stale", "from_cache",
                   "ttl_seconds", "served_at"]) {
    assert.ok(body.includes(k), `اللوحة لا تُعلن ${k}`);
  }
  // ثلاثة مسارات خروج ناجحة: من الذاكرة، بعد حساب، ومن ذاكرة قديمة بعد فشل.
  const returns = body.match(/return jsonb_build_object\('ok', true/g) ?? [];
  assert.ok(returns.length >= 3,
    "عدد مسارات الخروج الناجحة أقلّ من ثلاثة — أحدها بلا إعلان طزاجة");
  const withGenerated = body.match(/'generated_at'/g) ?? [];
  assert.ok(withGenerated.length >= 3, "أحد مسارات الخروج بلا طابع زمنيّ");
});

test("★ فشل إعادة الحساب يُوسَم ولا يُقدَّم القديم حيًّا ★", () => {
  const body = funcBody("mgmt_dashboard");
  assert.match(body, /'is_stale',\s*true/, "لا مسار يضع is_stale = true");
  assert.match(body, /recompute_failed/, "فشل إعادة الحساب بلا سبب معلَن");
  assert.match(body, /stale_message_ar/, "لا رسالة عربية تشرح قِدَم الأرقام");
  assert.match(body, /stale_message_en/, "لا رسالة إنجليزية تشرح قِدَم الأرقام");
  assert.ok(/لا تُقرأ على أنّها حيّة|Do not read them as live/i.test(body),
    "نصّ القِدَم لا يمنع قراءة الأرقام على أنّها حيّة");
  // وحين لا توجد نسخة سابقة: ok=false لا لوحة أصفار
  assert.match(body, /'ok', false, 'error', 'compute_failed'/,
    "الفشل بلا نسخة سابقة لا يُعلن نفسه — قد يُعرض كلوحة فارغة/صفرية");
});

test("اللوحة تكتب الذاكرة بعد الحساب فقط، وبمفتاح المستخدم", () => {
  const body = funcBody("mgmt_dashboard");
  const iCompute = body.indexOf("v_payload := public.mgmt_compute");
  const iInsert = body.indexOf("insert into public.mgmt_report_cache");
  assert.ok(iCompute > 0 && iInsert > iCompute, "الكتابة تسبق الحساب");
  assert.match(body, /values \(v_key, auth\.uid\(\)/, "الصفّ لا يُنسب لصاحب الجلسة");
  assert.match(body, /on conflict \(cache_key\) do update/, "الكتابة ليست idempotent");
  // البوّابة قبل كلّ شيء
  const iGate = body.indexOf("not authorized");
  assert.ok(iGate > 0 && iGate < iCompute, "الحساب يسبق بوّابة الصلاحية");
});

test("كنس الذاكرة مقيَّد بصاحب الصفّ — لا يمحو ذاكرة الآخرين", () => {
  // الكنس يجري بدور المالك (SECURITY DEFINER) فلا تكبحه RLS. حذفٌ بلا قيد
  // كان سيُفرِغ ذاكرة كلّ المستخدمين عند كلّ إعادة حساب.
  const body = funcBody("mgmt_dashboard");
  const i = body.indexOf("delete from public.mgmt_report_cache");
  assert.ok(i > 0, "لا كنس للذاكرة — الجدول ينمو بلا سقف");
  const stmt = body.slice(i, i + 220);
  assert.match(stmt, /user_id = auth\.uid\(\)/, "الكنس غير مقيَّد بصاحب الصفّ");
  assert.match(stmt, /cache_key <> v_key/, "الكنس قد يحذف الصفّ الذي كُتب لتوّه");
  assert.match(stmt, /computed_at < now\(\) - interval/, "الكنس بلا شرط عمر");
  assert.match(selfTest(), /كنس الذاكرة غير مقيَّد بصاحب الصفّ/,
    "الـSELF-TEST لا يحرس نطاق الكنس");
});

test("mgmt_dashboard دالّة volatile (تكتب) وmgmt_compute دالّة stable (تقرأ)", () => {
  assert.match(funcDecl("mgmt_dashboard"), /volatile/i,
    "اللوحة ليست volatile رغم أنّها تكتب الذاكرة");
  assert.match(funcDecl("mgmt_compute"), /stable/i, "المحرّك ليس stable");
});

test("التحديث اليدويّ يُجبر إعادة الحساب ويُدقَّق", () => {
  const body = funcBody("mgmt_refresh");
  assert.match(body, /mgmt_dashboard\(p_filters, true\)/, "التحديث لا يُجبر إعادة الحساب");
  assert.match(body, /mgmt_log\('refresh'/, "التحديث غير مُدقَّق");
});

test("سقف عمر الذاكرة محدود ولا يُملى من الواجهة بلا حدّ", () => {
  const body = funcBody("mgmt_norm_filters");
  assert.match(body, /least\(greatest\(coalesce\([\s\S]{0,80}300\), 0\), 3600\)/,
    "ttl_seconds بلا حدّ أعلى — واجهة تطلب يومًا كاملًا تُجمِّد الأرقام");
});

test("طبقة TypeScript تملك مصدرًا واحدًا للطزاجة", () => {
  assert.match(TS, /export function isStale/, "لا دالّة موحّدة لتقييم القِدَم");
  assert.match(TS, /export function freshnessLabel/, "لا نصّ موحّد للطزاجة");
  assert.match(TS, /export function stampLabel/, "لا طابع مطلق بجانب النسبيّ");
  const body = TS.slice(TS.indexOf("export function isStale"), TS.indexOf("export function freshnessLabel"));
  assert.match(body, /if \(d\.is_stale\) return true/,
    "isStale تتجاهل وسم الخادم وتقرّر بنفسها");
  assert.match(body, /age !== null && age > ttl/, "isStale لا تقارن العمر بالسقف");
  // غياب الطابع لا يُقرأ «حديث»
  const fl = TS.slice(TS.indexOf("export function freshnessLabel"), TS.indexOf("export function stampLabel"));
  assert.ok(/لا تُقرأ هذه الأرقام على أنّها حيّة|do not read these numbers as live/i.test(fl),
    "غياب الطابع الزمنيّ يُعرض بلا تحذير");
});

test("شريط الطزاجة مثبَّت في الواجهة ويصير تحذيرًا عند القِدَم", () => {
  assert.match(ATOMS, /export function FreshnessBar/, "لا شريط طزاجة");
  const body = ATOMS.slice(ATOMS.indexOf("export function FreshnessBar"),
                           ATOMS.indexOf("export function SectionTitle"));
  assert.match(body, /const stale = isStale\(d\)/, "الشريط لا يقيّم القِدَم");
  assert.match(body, /border-red-900/, "الشريط لا يتحوّل تحذيرًا مرئيًّا عند القِدَم");
  assert.match(body, /stampLabel\(d, L\)/, "الشريط لا يعرض الطابع المطلق");
  assert.match(DASH, /<FreshnessBar/, "اللوحة لا تعرض شريط الطزاجة");
  // وفي الطباعة أيضًا — ورقة بلا وقت حساب تصبح «رقمًا حاليًّا» بعد أسبوع
  assert.match(DASH, /function PrintHeader/, "لا ترويسة طباعة");
  const ph = DASH.slice(DASH.indexOf("function PrintHeader"), DASH.indexOf("function PrintFooter"));
  assert.match(ph, /stampLabel\(d, L\)/, "ترويسة الطباعة بلا وقت حساب");
  assert.match(ph, /isStale\(d\)/, "ترويسة الطباعة لا تُحذّر من القِدَم");
});

test("ملفّ التصدير يحمل وقت حساب الأرقام لا وقت التصدير", () => {
  const body = funcBody("mgmt_export");
  assert.match(body, /'generated_at', v->'generated_at'/, "التصدير بلا طابع حساب");
  assert.match(body, /'is_stale', v->'is_stale'/, "التصدير لا ينقل وسم القِدَم");
  assert.ok(/وقت حساب الأرقام لا وقت التصدير|not when they were exported/i.test(body),
    "التصدير لا يوضّح معنى الطابع");
  const ts = TS.slice(TS.indexOf("export function execCsvDownload"));
  assert.match(ts, /generatedAt/, "ترويسة CSV بلا وقت الحساب");
  assert.match(ts, /isStale \? /, "ترويسة CSV بلا تحذير القِدَم");
  assert.match(ts, /"﻿" \+ body/, "CSV بلا BOM — Excel سيشوّه العربية");
});

test("SELF-TEST وPOSTCHECK يحرسان عقد الطزاجة", () => {
  const st = selfTest();
  assert.match(st, /اللوحة لا تُعلن/, "الـSELF-TEST لا يفحص إعلان الطزاجة");
  assert.match(st, /مفتاح الذاكرة لا يتضمّن المستخدم/,
    "الـSELF-TEST لا يفحص فصل الذاكرة بين المستخدمين");
  assert.match(POSTCHECK, /declares_generated_at/, "POSTCHECK لا يفحص الطابع الزمنيّ");
  assert.match(POSTCHECK, /key_includes_user/, "POSTCHECK لا يفحص فصل الذاكرة");
});
