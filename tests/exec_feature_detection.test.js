// ════════════════════════════════════════════════════════════════════════════
// tests/exec_feature_detection.test.js
//
// الكود يُدفَع قبل تشغيل الـSQL دائمًا في هذا المستودع. لذلك كلّ سطح هنا ملزَم
// بأن يكتشف غياب موديول (أو غياب حزمته هو) ويقول ذلك — لا أن ينهار، ولا أن
// يخترع رقمًا، ولا أن يخلط بين «غير مطبَّق» و«ممنوع».
// وعزل الأخطاء شرط: سقوط موديول واحد يجب ألّا يُسقط اللوحة كلّها.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  SQL, TS, DASH, ATOMS, PREFLIGHT, POSTCHECK,
  funcBody, selfTest, SOURCES,
} = require("./exec_helpers.js");

test("PREFLIGHT يعدّ كلّ مصدر ويقول ماذا يحدث إن غاب", () => {
  for (const s of SOURCES) {
    assert.ok(PREFLIGHT.includes(s.sig), `PREFLIGHT لا يفحص ${s.sig}`);
    assert.ok(PREFLIGHT.includes(s.runme), `PREFLIGHT لا يُسمّي ${s.runme}`);
  }
  assert.ok(/«غير متاح»|غير متاح/.test(PREFLIGHT),
    "PREFLIGHT لا يوضّح أنّ الغياب يظهر «غير متاح» لا صفرًا");
});

test("PREFLIGHT الصلب لا يشترط مصدرًا — الحزمة تعمل بلا موديولات وتقول ذلك", () => {
  const pre = SQL.slice(SQL.indexOf("do $pre$"), SQL.indexOf("end $pre$;"));
  // الإلزاميّ: مُسنَدات الهويّة فقط
  for (const dep of ["profiles", "is_staff()", "is_owner()", "is_admin()"]) {
    assert.ok(pre.includes(dep), `PREFLIGHT الصلب لا يفحص ${dep}`);
  }
  // الاختياريّ: المصادر — إشعار لا استثناء
  for (const s of SOURCES) {
    const i = pre.indexOf(s.sig);
    assert.ok(i > 0, `PREFLIGHT الصلب لا يكتشف ${s.sig}`);
    const after = pre.slice(i, i + 400);
    assert.ok(/raise notice/.test(after), `غياب ${s.module} يرفع استثناء بدل إشعار`);
  }
  assert.ok(/n = 4/.test(pre),
    "لا حالة صريحة لغياب كلّ المصادر — لوحة بلا مصدر يجب أن تقول ذلك لا أن تبدو صفرية");
});

test("الاكتشاف قبل القراءة في كلّ قارئ", () => {
  for (const f of ["mgmt_read_jsonb", "mgmt_read_calendar"]) {
    const body = funcBody(f);
    const iProbe = body.indexOf("mgmt_source_installed");
    const iExec = body.indexOf("execute 'select");
    assert.ok(iProbe > 0, `${f} بلا اكتشاف`);
    assert.ok(iExec > 0, `${f} لا تقرأ`);
    assert.ok(iProbe < iExec, `${f} تقرأ قبل أن تكتشف`);
    assert.match(body, /module_not_installed/, `${f} لا تُسمّي حالة الغياب`);
  }
});

test("★ عزل الأخطاء ★ — سقوط مصدر لا يُسقط اللوحة", () => {
  const body = funcBody("mgmt_read_jsonb");
  assert.match(body, /exception when others then/, "القارئ بلا عزل");
  assert.match(body, /get stacked diagnostics/, "القارئ لا يلتقط رمز الخطأ");
  assert.match(body, /mgmt_classify/, "القارئ لا يصنّف الفشل");
  // والتصنيف يفرّق فعلًا
  const cls = funcBody("mgmt_classify");
  assert.match(cls, /'restricted'/, "لا حالة منع");
  assert.match(cls, /'unavailable'/, "لا حالة غياب");
  assert.match(cls, /'error'/, "لا حالة خطأ");
  assert.match(cls, /42501/, "المنع لا يُتعرَّف عليه برمزه");
  assert.match(cls, /42883|42P01/, "غياب الكائن لا يُتعرَّف عليه برمزه");
  assert.match(cls, /not authorized/, "المنع المرفوع نصًّا (P0001) لا يُتعرَّف عليه");
});

test("comms_health تُعيد ok:false عند المنع — والمحرّك يترجمها منعًا لا نجاحًا", () => {
  // هذا فخّ حقيقيّ: مركز الاتصال لا يرفع استثناء عند المنع، بل يعيد
  // {ok:false,error:'not_authorized'}. بلا هذه الترجمة كانت الحالة ستُقرأ ok
  // ثمّ يُقرأ counts فارغًا ⇒ أصفار كاذبة.
  const body = funcBody("mgmt_compute");
  assert.match(body, /\(\(e_comms->'data'\)->>'ok'\)::boolean, false\) is not true/,
    "المحرّك لا يفحص ok الداخليّة لمركز الاتصال");
  assert.match(body, /mgmt_env\('restricted', 'not_authorized'/,
    "منع مركز الاتصال لا يُترجَم إلى حالة منع");
});

test("mgmt_sources يقول ما هو مطبَّق وما يرفضك ويسمّي ملفّ التشغيل", () => {
  const body = funcBody("mgmt_sources");
  for (const s of SOURCES) {
    assert.ok(body.includes(s.runme), `mgmt_sources لا يُسمّي ${s.runme}`);
  }
  assert.match(body, /'installed'/, "لا حقل تثبيت");
  assert.match(body, /'authorized'/, "لا حقل تصريح");
  assert.match(body, /v_auth := null/, "تعذّر تقييم البوّابة لا يُعلَن كـnull");
  assert.ok(/غير مطبَّق — شغّل/.test(body), "رسالة الغياب لا تقول ماذا يُشغَّل");
  assert.ok(/منع لا عطل|a denial, not a fault/i.test(body),
    "رسالة المنع لا تفرّق نفسها عن العطل");
});

test("authorized = null ليس false ولا true في العقد وفي الواجهة", () => {
  assert.match(TS, /authorized: boolean \| null/, "عقد TypeScript يطوي الحالة الثالثة");
  assert.match(DASH, /src\.authorized === false/, "الواجهة تعامل null معاملة false");
  assert.match(DASH, /src\.authorized === null/, "الواجهة لا تعرض الحالة الثالثة");
});

test("الواجهة تكتشف غياب حزمة اللوحة نفسها وتعرض «بانتظار التفعيل»", () => {
  assert.match(DASH, /access\.st\.state === "needs_migration"/,
    "الشاشة لا تكتشف غياب دوالّ mgmt_*");
  assert.match(TS, /docs\/executive_reporting_RUNME\.sql/,
    "رسالة الترحيلة لا تُسمّي ملفّ التشغيل");
  assert.match(ATOMS, /PREFLIGHT ← RUNME ← POSTCHECK|PREFLIGHT → RUNME → POSTCHECK/,
    "شاشة الترحيلة لا تقول ترتيب التشغيل");
});

test("لوحة المصادر متاحة للمستخدم لا مخفيّة في السجلّات", () => {
  assert.match(DASH, /function SourcesPanel/, "لا لوحة لحالة المصادر");
  assert.match(DASH, /حالة المصادر|Source status/, "لا زرّ يفتحها");
  assert.match(DASH, /\{src\.runme\}/, "اسم ملفّ التشغيل لا يُعرض للمستخدم");
});

test("SELF-TEST يحرس الاكتشاف والتصنيف بفحوص سلوكية", () => {
  const st = selfTest();
  assert.match(st, /mgmt_classify\('42501','permission denied'\) <> 'restricted'/,
    "الـSELF-TEST لا يفحص تصنيف المنع");
  assert.match(st, /mgmt_classify\('42883'[\s\S]{0,60}<> 'unavailable'/,
    "الـSELF-TEST لا يفحص تصنيف الغياب");
  assert.match(st, /mgmt_classify\('22012'[\s\S]{0,60}<> 'error'/,
    "الـSELF-TEST لا يفحص أنّ الخطأ العامّ يبقى خطأً");
  assert.match(st, /القارئ لا يكتشف وجود المصدر/, "الـSELF-TEST لا يفحص الاكتشاف");
});

test("POSTCHECK يعرض حالة المصادر كما ستراها اللوحة", () => {
  for (const s of SOURCES) {
    assert.ok(POSTCHECK.includes(s.sig), `POSTCHECK لا يفحص ${s.sig}`);
  }
  assert.ok(/لن تُعرض صفرًا|never zero/i.test(POSTCHECK),
    "POSTCHECK لا يوضّح أنّ الغياب لا يُعرض صفرًا");
});

test("لا مسار في الواجهة ينهار حين تكون البيانات غائبة", () => {
  // قوائم اختيارية تُقرأ دائمًا بـ?? [] أو ?. — لا فهرسة عمياء
  assert.match(DASH, /d\.alerts \?\? \[\]/, "قائمة التنبيهات تُقرأ بلا حارس");
  assert.match(DASH, /\(d\.kpis \?\? \[\]\)/, "قائمة المؤشّرات تُقرأ بلا حارس");
  assert.match(DASH, /d\.filters\?\./, "المرشّحات تُقرأ بلا حارس");
  assert.match(ATOMS, /export function Empty/, "لا حالة فراغ صريحة");
});

test("مهلة على كلّ تحميل — دوران أبديّ يُقرأ كعطل", () => {
  assert.match(ATOMS, /exec_timeout/, "لا مهلة على التحميل");
  assert.match(ATOMS, /timeoutMs = 25000/, "المهلة غير محدَّدة");
  assert.match(ATOMS, /seq\.current/, "لا تسلسل للطلبات — ردّ قديم قد يفوز");
  assert.match(ATOMS, /mounted\.current/, "لا حارس Unmount");
});
