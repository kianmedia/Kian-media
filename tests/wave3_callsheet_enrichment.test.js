// ════════════════════════════════════════════════════════════════════════════
// tests/wave3_callsheet_enrichment.test.js
//
// Wave 3 · ربط الضوء والطقس بورقة النداء.
//
// ★★ العقد المركزيّ المُختبَر هنا ★★
// «فشل الطقس لا يمنع فتح أو تعديل أو حفظ أو طباعة Call Sheet.»
// أي: **لا مدخل يُسقط الإثراء**. (E-1) يمرّ عشرات الأشكال الفاسدة ويشترط أن
// تعود قيمة قابلة للعرض في كلّ مرّة.
//
// لا شبكة · لا قاعدة · لا Production · لا mock لمزوّد — الوحدة لا تلمس الشبكة
// أصلًا، وهذا هو التصميم لا اختصار الاختبار.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const ROOT = path.resolve(__dirname, "..");
const read = (r) => fs.readFileSync(path.join(ROOT, r), "utf8");

const MODS = new Map();
function loadTs(rel) {
  if (MODS.has(rel)) return MODS.get(rel);
  const js = ts.transpileModule(read(rel), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const m = { exports: {} };
  MODS.set(rel, m.exports);
  const req = (id) => {
    if (id === "./solar") return loadTs("lib/production/solar.ts");
    if (id === "./weather") return loadTs("lib/production/weather.ts");
    return {};
  };
  // eslint-disable-next-line no-new-func
  new Function("exports", "module", "require", js)(m.exports, m, req);
  MODS.set(rel, m.exports);
  return m.exports;
}
const CS = loadTs("lib/production/callSheet.ts");

const DAMMAM_LOC = { lat: 26.4207, lng: 50.0888, name: "استوديو الدمّام" };
const GOOD = {
  sheet: { sheet_date: "2026-06-21", is_drone_day: false },
  location: DAMMAM_LOC,
  weather: { condition: "صحو", temp_c: 44, wind_kph: 18, wind_gust_kph: 30, source: "open_meteo" },
};

// ─── العقد المركزيّ ────────────────────────────────────────────────────────

test("(E-1) ★★★ لا مدخل مهما فسد يُسقط الإثراء — الورقة تُطبع دائمًا ★★★", () => {
  const junk = [
    null, undefined, {}, { sheet: null, location: null, weather: null },
    { sheet: {}, location: {}, weather: {} },
    { sheet: { sheet_date: "" } },
    { sheet: { sheet_date: "not-a-date" }, location: DAMMAM_LOC },
    { sheet: { sheet_date: "2026-13-45" }, location: DAMMAM_LOC },
    { sheet: { sheet_date: 20260621 }, location: DAMMAM_LOC },
    { location: { lat: "abc", lng: "def" }, sheet: { sheet_date: "2026-06-21" } },
    { location: { lat: null, lng: null }, sheet: { sheet_date: "2026-06-21" } },
    { location: { lat: 999, lng: 999 }, sheet: { sheet_date: "2026-06-21" } },
    { location: DAMMAM_LOC, sheet: { sheet_date: "2026-06-21" }, weather: "not-an-object" },
    { location: [], sheet: [], weather: [] },
    { sheet: { sheet_date: "2026-06-21", is_drone_day: "yes" }, location: DAMMAM_LOC, weather: {} },
    { location: { lat: 78.22, lng: 15.63 }, sheet: { sheet_date: "2026-12-21" } }, // ليل قطبيّ
  ];
  for (const [i, input] of junk.entries()) {
    let r;
    assert.doesNotThrow(() => { r = CS.enrichCallSheet(input); }, `المدخل #${i} رمى استثناءً`);
    assert.ok(r && typeof r === "object", `#${i}: لا نتيجة`);
    assert.ok(r.sun && typeof r.sun.available === "boolean", `#${i}: كتلة الضوء ناقصة`);
    assert.ok(r.weather && typeof r.weather.available === "boolean", `#${i}: كتلة الطقس ناقصة`);
    // كلّ حقل غير متاح يحمل سببًا مقروءًا، لا فراغًا صامتًا.
    if (!r.sun.available) {
      assert.ok(r.sun.reason, `#${i}: الضوء غير متاح بلا سبب`);
      assert.ok(CS.sunReasonAr(r.sun.reason).length > 10, `#${i}: السبب بلا نصّ عربيّ`);
    }
  }
});

test("(E-2) ★★★ الأقسام مستقلّة: سقوط أحدها لا يُخفي الآخر ★★★", () => {
  // طقس مفقود ⇒ الضوء يبقى.
  const noW = CS.enrichCallSheet({ sheet: GOOD.sheet, location: DAMMAM_LOC, weather: null });
  assert.equal(noW.sun.available, true, "🔴 غياب الطقس أخفى الساعة الذهبية");
  assert.equal(noW.weather.available, false);

  // موقع بلا إحداثيات ⇒ الطقس المسجَّل يبقى معروضًا.
  const noLoc = CS.enrichCallSheet({ sheet: GOOD.sheet, location: { name: "x" }, weather: GOOD.weather });
  assert.equal(noLoc.sun.available, false);
  assert.equal(noLoc.sun.reason, "no_coordinates");
  assert.equal(noLoc.weather.available, true, "🔴 غياب الإحداثيات أخفى الطقس");
});

// ─── الضوء ─────────────────────────────────────────────────────────────────

test("(E-3) ★★ الساعة الذهبية تُعرض بنافذتها الحقيقية لا بساعة ★★", () => {
  const r = CS.enrichCallSheet(GOOD);
  assert.equal(r.sun.available, true);
  assert.match(r.sun.goldenEvening, /^\d{2}:\d{2} – \d{2}:\d{2} \(\d+ د\)$/);
  const mins = Number(r.sun.goldenEvening.match(/\((\d+) د\)/)[1]);
  assert.ok(mins >= 30 && mins <= 55, `النافذة ${mins} دقيقة — لا تطابق خطّ العرض`);
  assert.ok(r.sun.raw.goldenEvening.start instanceof Date);
});

test("(E-4) ★★ أسباب الغياب مميَّزة، ولكلٍّ نصّ يقول ما يُصلَح ★★", () => {
  const cases = [
    [{ sheet: { sheet_date: "2026-06-21" }, location: null }, "no_location"],
    [{ sheet: { sheet_date: "2026-06-21" }, location: { name: "x" } }, "no_coordinates"],
    [{ sheet: {}, location: DAMMAM_LOC }, "no_date"],
    [{ sheet: { sheet_date: "2026-12-21" }, location: { lat: 78.22, lng: 15.63 } }, "not_applicable"],
  ];
  const seen = new Set();
  for (const [input, expected] of cases) {
    const r = CS.enrichCallSheet(input);
    assert.equal(r.sun.reason, expected, `السبب المتوقَّع ${expected}`);
    const txt = CS.sunReasonAr(expected);
    assert.ok(!seen.has(txt), `نصّ مكرَّر للسبب ${expected} — لا يميّز ما يُصلَح`);
    seen.add(txt);
  }
  assert.match(CS.sunReasonAr("no_coordinates"), /lat|إحداثيات/, "لا يقول ما الحقل الناقص");
});

// ─── الطقس ─────────────────────────────────────────────────────────────────

test("(E-5) ★★ صفّ طقس بلا محتوى ليس طقسًا ★★", () => {
  for (const row of [{}, { source: "open_meteo" }, { note: "" }, { condition: "   " }]) {
    assert.equal(CS.weatherFor(row).available, false, `🔴 صفّ فارغ عُرض كطقس: ${JSON.stringify(row)}`);
  }
  assert.equal(CS.weatherFor({ temp_c: 30 }).available, true, "حقل رقميّ وحده يكفي");
  // نصّ رقميّ من PostgREST (numeric يعود سلسلةً) يُقبل ولا يُهمَل.
  assert.equal(CS.weatherFor({ wind_kph: "18.5" }).windKph, 18.5);
});

test("(E-6) ★★★ التوقّع القديم يُعلَن قديمًا، ولا يُخفى ولا يُدّعى طازجًا ★★★", () => {
  const now = new Date("2026-08-03T12:00:00Z");
  const fresh = CS.weatherFor({ condition: "صحو", fetched_at: "2026-08-03T09:00:00Z" }, now);
  assert.equal(fresh.stale, false, "٣ ساعات عُدّت قديمة");
  const old = CS.weatherFor({ condition: "صحو", fetched_at: "2026-08-01T09:00:00Z" }, now);
  assert.equal(old.stale, true, "🔴 توقّع عمره يومان عُرض كأنّه طازج");
  assert.equal(old.available, true, "القديم يُعرض مع تنبيه — لا يُخفى");
  // تاريخ فاسد ⇒ لا ادّعاء في أيّ اتجاه.
  assert.equal(CS.weatherFor({ condition: "صحو", fetched_at: "غير-تاريخ" }, now).stale, false);
  assert.equal(CS.STALE_AFTER_HOURS, 12);
});

// ─── التحذير الإرشادي ──────────────────────────────────────────────────────

test("(E-7) ★★★ التحذير إرشاديّ — وليس تصريح طيران ★★★", () => {
  const r = CS.enrichCallSheet({
    sheet: { sheet_date: "2026-06-21", is_drone_day: true },
    location: DAMMAM_LOC,
    weather: { condition: "رياح", wind_kph: 20, wind_gust_kph: 52 },
  });
  assert.ok(r.drone, "لم يظهر تحذير في يوم درون عاصف");
  assert.equal(r.drone.level, "severe");
  assert.equal(r.drone.decidedOnKph, 52, "القرار لم يُتّخذ على الهبّات");
  // 🔴 التنويه إلزاميّ ويقول صراحةً إنّه ليس تصريحًا.
  assert.match(r.drone.disclaimerAr, /ليس تصريح طيران/);
  assert.match(r.drone.disclaimerAr, /التصاريح النظامية|حدّ الطائرة/);
  assert.match(r.drone.disclaimerEn, /not a flight authorisation/i);
  for (const t of [r.drone.messageAr, r.drone.disclaimerAr]) {
    assert.doesNotMatch(t, /مصرَّح|يُسمح بالطيران|آمن للطيران/, "🔴 صيغة تُقرأ كتصريح");
  }
});

test("(E-8) ★★ لا تحذير في يوم بلا تصوير جوّي — والعلم صريح لا مُستنتَج ★★", () => {
  const windy = { condition: "رياح", wind_kph: 20, wind_gust_kph: 60 };
  assert.equal(CS.enrichCallSheet({ sheet: { sheet_date: "2026-06-21" }, location: DAMMAM_LOC, weather: windy }).drone, null,
    "🔴 تحذير على يوم لم يُعلَن يوم درون");
  // قيمة غير `true` تمامًا لا تفعّل التحذير — لا استنتاج من نصّ.
  for (const v of ["true", 1, "yes", {}]) {
    assert.equal(
      CS.enrichCallSheet({ sheet: { sheet_date: "2026-06-21", is_drone_day: v }, location: DAMMAM_LOC, weather: windy }).drone,
      null, `🔴 القيمة ${JSON.stringify(v)} فعّلت التحذير`);
  }
  // وبلا طقس لا تحذير: لا يُخترع تقييم من العدم.
  assert.equal(CS.enrichCallSheet({ sheet: { sheet_date: "2026-06-21", is_drone_day: true }, location: DAMMAM_LOC, weather: null }).drone, null);
});

// ─── التاريخ البديل ────────────────────────────────────────────────────────

test("(E-9) ★★★ التاريخ البديل إعلان نيّة ولا يحجز موردًا ★★★", () => {
  const r = CS.enrichCallSheet({
    sheet: { sheet_date: "2026-06-21", backup_date: "2026-06-25" },
    location: DAMMAM_LOC,
  });
  assert.ok(r.backup, "لم تُعرض كتلة التاريخ البديل");
  assert.equal(r.backup.date, "2026-06-25");
  // 🔴 التنويه إلزاميّ: يوم بديل يحجز صامتًا يُجمّد معدّات ليوم قد لا يأتي.
  assert.match(r.backup.noticeAr, /لا يحجز/);
  assert.match(r.backup.noticeAr, /طاقم|معدّات/);
  assert.equal(CS.enrichCallSheet({ sheet: { sheet_date: "2026-06-21" } }).backup, null);
  assert.equal(CS.enrichCallSheet({ sheet: { sheet_date: "2026-06-21", backup_date: "  " } }).backup, null);
});

// ─── العلم والعزل ──────────────────────────────────────────────────────────

test("(E-10) ★★★ الوحدة لا تلمس الشبكة إطلاقًا ★★★", () => {
  const src = read("lib/production/callSheet.ts");
  for (const re of [/\bfetch\s*\(/, /XMLHttpRequest/, /axios/, /process\.env/]) {
    assert.doesNotMatch(src, re, "🔴 طبقة الإثراء تلمس الشبكة أو البيئة — فتصير قادرة على تعطيل ورقة");
  }
});

test("(E-11) ★★★ العلم مطفأ افتراضًا، والواجهة القديمة تبقى حرفيًّا ★★★", () => {
  const KEY = "NEXT_PUBLIC_SHOW_OPS_SUN_WEATHER";
  const prev = process.env[KEY];
  try {
    const comp = read("components/portal/operations/OpsSunWeather.tsx");
    assert.match(comp, new RegExp(`process\\.env\\.${KEY} === "true"`),
      "العلم ليس مقارنةً صارمة بـ\"true\"");
    // المسار الخادميّ خلف العلم نفسه — ولا يُقرّ بوجوده وهو مطفأ.
    const route = read("app/api/portal/ops/weather/route.ts");
    assert.match(route, new RegExp(`${KEY} === "true"`), "المسار بلا حارس علم");
    assert.match(route, /if \(!enabled\(\)\) return bad\("not_found", 404\)/,
      "🔴 المسار المعطَّل يُرجع 403 لا 404 — فيُقرّ بوجوده");
    // الطباعة: العلم مطفأ ⇒ القسم القديم كما هو.
    const print = read("components/portal/operations/OpsCallSheetPrint.tsx");
    assert.match(print, /!opsSunWeatherEnabled\(\)\s*\?/, "الطباعة لا تحرس القسم بالعلم");
    assert.match(print, /لا إدخال طقس\./, "🔴 النصّ القديم اختفى مع أنّ العلم مطفأ");
  } finally {
    if (prev === undefined) delete process.env[KEY]; else process.env[KEY] = prev;
  }
});

test("(E-12) ★★ المسار الخادميّ: لا Service Key، ولا نصّ قاعدة يُعاد للعميل ★★", () => {
  const route = read("app/api/portal/ops/weather/route.ts");
  // 🔴 الكتابة بصلاحية المستخدم. Service Key هنا يعني تجاوز prodops_can_manage.
  assert.doesNotMatch(route, /SERVICE_ROLE|SERVICE_KEY/,
    "🔴 مفتاح خدمة في مسار كتابة — يتجاوز حارس الصلاحية في القاعدة");
  assert.match(route, /Authorization: `Bearer \$\{token\}`/, "لا تمرير لتوكن المستخدم");
  assert.match(route, /prodops_weather_record/, "لا يستدعي الدالّة المعتمدة");
  // ولا يُعاد نصّ خطأ القاعدة للعميل.
  assert.doesNotMatch(route, /json\(\{[^}]*error:\s*text/, "🔴 نصّ القاعدة يُعاد للعميل");
  assert.match(route, /record_failed/, "لا رسالة معتمة عند فشل التسجيل");
  // والأفق مفروض هنا أيضًا لا في الواجهة وحدها.
  assert.match(route, /withinHorizon\(date\)/, "الأفق غير مفروض في المسار");
});
