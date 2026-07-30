// ════════════════════════════════════════════════════════════════════════════
// tests/exec_unavailable_vs_zero.test.js
//
// ★ العقد الأهمّ في المرحلة كلّها ★
// «صفر» لا يجوز أن يعني «الموديول غير مطبَّق» ولا «ممنوع عنك» ولا «تعذّرت
// القراءة». صفرٌ يعني صفرًا. هذه الملفّات تحرس ذلك في ثلاث طبقات: نقطة
// الاختناق في القاعدة (mgmt_kpi)، والغلاف في TypeScript، والبطاقة في الواجهة.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  SQL, TS, ATOMS, DASH, funcBody, KPI_KEYS, SOURCES, selfTest, stripJsComments,
} = require("./exec_helpers.js");

test("نقطة اختناق واحدة: mgmt_kpi هي المكان الوحيد الذي تُبنى فيه القيمة", () => {
  const body = funcBody("mgmt_kpi");
  assert.match(body, /case\s+when\s+p_state\s*=\s*'ok'\s+then\s+p_value\s+else\s+null\s+end/i,
    "mgmt_kpi لا تُصفّر القيمة خارج الحالة ok");
  assert.match(body, /case\s+when\s+p_state\s*=\s*'ok'\s+then\s+p_count\s+else\s+null\s+end/i,
    "mgmt_kpi لا تُصفّر العدّاد خارج الحالة ok");
  assert.match(body, /case\s+when\s+p_state\s*=\s*'ok'\s+then\s+coalesce\(p_detail/i,
    "mgmt_kpi تُخرج تفاصيل مؤشّر غير مقروء");
  // ولا يوجد بانٍ ثانٍ لكائن المؤشّر يلتفّ حول هذه القاعدة
  const builders = SQL.match(/'key',\s*p_key\b/g) ?? [];
  assert.equal(builders.length, 1,
    "يوجد أكثر من بانٍ لكائن المؤشّر — القاعدة تُخترَق من الباب الثاني");
});

test("كلّ مؤشّر في المحرّك يمرّ بـmgmt_kpi ولا يُبنى يدويًّا", () => {
  const body = funcBody("mgmt_compute");
  for (const k of KPI_KEYS) {
    assert.ok(body.includes(`'${k}'`), `المؤشّر ${k} غير مبنيّ في المحرّك`);
  }
  // لا jsonb_build_object يبني مؤشّرًا بنفسه داخل المحرّك
  assert.ok(!/jsonb_build_object\(\s*'key'/.test(body),
    "المحرّك يبني كائن مؤشّر يدويًّا — يلتفّ حول mgmt_kpi");
});

test("القارئ يكتشف الموديول قبل قراءته، ولا يستبدل الغياب بصفر", () => {
  const body = funcBody("mgmt_read_jsonb");
  assert.match(body, /mgmt_source_installed/, "لا اكتشاف لوجود المصدر");
  assert.match(body, /module_not_installed/, "لا تمييز لحالة «غير مطبَّق»");
  assert.match(body, /not_authorized/, "لا تمييز للمنع عن الترحيلة الناقصة");
  assert.ok(!/\breturn\s+0\b/.test(body), "القارئ يعيد صفرًا عند الفشل");
  assert.ok(!/'value',\s*0/.test(body), "القارئ يحقن قيمة صفرية");
});

test("كلّ موديول مصدر يُسمّى مع ملفّ RUNME الخاصّ به في رسالة الغياب", () => {
  const body = funcBody("mgmt_read_jsonb") + funcBody("mgmt_read_calendar") + funcBody("mgmt_compute");
  for (const s of SOURCES) {
    assert.ok(body.includes(s.runme) || SQL.includes(s.runme),
      `رسالة الغياب لا تُسمّي ${s.runme}`);
  }
});

test("الجاهزية بلا مهامّ = «لا أساس» لا ١٠٠٪", () => {
  const body = funcBody("mgmt_compute");
  assert.match(body, /no_basis/, "لا حالة «لا أساس للحساب»");
  assert.match(body, /no_scheduled_jobs/, "غياب المهامّ لا يُعلَن كسبب");
  assert.ok(/ليست\s+١٠٠٪|not 100%/i.test(body),
    "لا نصّ يمنع قراءة «لا مهامّ» على أنّها جاهزية كاملة");
});

test("SELF-TEST يفحص القاعدة سلوكيًّا لا نصًّا فقط، وبفحص يستطيع أن يفشل", () => {
  const st = selfTest();
  assert.match(st, /'unavailable','module_not_installed'/,
    "لا فحص سلوكيّ لمؤشّر غير متاح");
  assert.match(st, /\(v->'value'\)\s*<>\s*'null'::jsonb/,
    "الفحص لا يتأكّد أنّ القيمة NULL فعلًا");
  assert.match(st, /صفرٌ حقيقيّ لا يخرج كصفر/,
    "لا فحص للاتّجاه المعاكس: صفرٌ حقيقيّ يجب أن يبقى صفرًا");
  // فحص لا يمكن أن يفشل ليس اختبارًا: لا مصيدة كاسحة حول الفحوص
  assert.ok(!/exception\s+when\s+others\s+then\s+null;\s*end;[\s\S]{0,40}SELF-TEST/i.test(st),
    "توجد مصيدة تبتلع فشل فحص");
});

test("طبقة TypeScript لا تستبدل NULL بصفر في أيّ مسار", () => {
  // ⚠️ التعليقات مُزالة قبل الفحص: توثيق القاعدة لا يجوز أن يكسر حارسها.
  const code = stripJsComments(TS);
  assert.ok(!/\?\?\s*0\b/.test(code), "lib/portal/execReport.ts يستبدل قيمة غائبة بصفر");
  assert.ok(!/\|\|\s*0\b/.test(code), "lib/portal/execReport.ts يستبدل قيمة غائبة بصفر");
  assert.match(TS, /export function kpiValue/, "لا قارئ موحّد للقيمة");
  const body = TS.slice(TS.indexOf("export function kpiValue"), TS.indexOf("export function findKpi"));
  assert.match(body, /return\s+typeof v === "number"[\s\S]*?:\s*null/,
    "kpiValue لا تُعيد null عند غياب الرقم");
});

test("kpiText يُعيد «—» لا رقمًا حين لا تكون الحالة ok", () => {
  const body = TS.slice(TS.indexOf("export function kpiText"), TS.indexOf("export function kpiWhyText"));
  assert.match(body, /if \(k\.state !== "ok"\) return/,
    "kpiText لا تتوقّف عند الحالات غير ok");
  assert.ok(!/return\s+["'`]0/.test(body), "kpiText تُعيد صفرًا نصيًّا");
});

test("بطاقة المؤشّر في الواجهة لا تطبع رقمًا خارج الحالة ok", () => {
  const i = ATOMS.indexOf("export function KpiCard");
  assert.ok(i > 0, "KpiCard غير موجودة");
  const body = ATOMS.slice(i, ATOMS.indexOf("export function FreshnessBar"));
  assert.match(body, /const ok = kpi\.state === "ok"/, "لا فحص للحالة قبل الطباعة");
  assert.match(body, /ok \? \(/, "الرقم يُطبع دون شرط الحالة");
  assert.match(body, /<StateBadge state=\{kpi\.state\}/, "لا شارة حالة بديلة للرقم");
  const code = stripJsComments(ATOMS);
  assert.ok(!/\?\?\s*0\b/.test(code) && !/\|\|\s*0\b/.test(code),
    "ملفّ القطع يستبدل قيمة غائبة بصفر");
});

test("المؤشّر المحجوب يبقى ظاهرًا بحالته ولا يُحذف من الشاشة", () => {
  // إخفاء المحجوب يجعل القارئ ينسى وجوده أصلًا — وهذا شكل آخر من الكذب.
  assert.ok(!/filter\(\s*\(?k\)?\s*=>\s*k\.state === "ok"\s*\)/.test(DASH),
    "الشاشة تُسقط المؤشّرات غير المقروءة بدل عرض حالتها");
  assert.match(DASH, /allOut = rows\.every\(\(r\) => r\.state === "filtered_out"\)/,
    "لا يُخفى إلّا ما استُبعد بمرشّح المستخدم نفسه");
});

test("التنبيهات لا تُبنى على مؤشّر غير مقروء، والعمى يُعلَن صراحةً", () => {
  const body = funcBody("mgmt_alerts_from");
  assert.match(body, /if \(k->>'state'\) not in \('ok','filtered_out'\)/,
    "التنبيهات تُبنى على مؤشّرات غير مقروءة");
  assert.match(body, /blind_spots/, "لا تنبيه يُعلن «مؤشّرات لا تُقرأ»");
  assert.ok(/ليس «لا مشاكل»|not "no problems"/i.test(body),
    "نصّ العمى لا يمنع قراءته كطمأنينة");
});

test("خلوّ التنبيهات لا يُعرض كـ«لا مشاكل» في الواجهة", () => {
  assert.ok(/هذا لا يعني «لا مشاكل»|says nothing about KPIs that could not be read/i.test(DASH),
    "الحالة الفارغة للتنبيهات تُقرأ كطمأنينة كاذبة");
});

test("التصدير يخرج بالحالة لا بقيمة مُختلَقة", () => {
  const body = funcBody("mgmt_export");
  assert.match(body, /'state',\s*k->>'state'/, "التصدير لا يحمل حالة المؤشّر");
  assert.match(body, /'value',\s*k->'value'/, "التصدير لا ينقل القيمة كما هي (قد يُسطِّحها)");
  assert.ok(!/coalesce\(k->'value',\s*'0'/.test(body), "التصدير يستبدل القيمة الغائبة بصفر");
  // وفي الواجهة: الخليّة الفارغة تبقى فارغة في CSV
  assert.match(TS, /if \(v === null \|\| v === undefined\) return "";/,
    "مولّد CSV يملأ الخلايا الفارغة بشيء");
});
