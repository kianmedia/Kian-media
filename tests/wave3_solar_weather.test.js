// ════════════════════════════════════════════════════════════════════════════
// tests/wave3_solar_weather.test.js
//
// Wave 3 · V2-3.1-D (الساعة الذهبية) · V2-3.1-E (الطقس) · V2-3.1-F (الرياح)
//
// لا شبكة · لا قاعدة · لا Production. `fetchForecast` وحدها تلمس الشبكة، وهي
// غير مُختبَرة هنا عمدًا — المُختبَر بناء الرابط والتحليل والأفق والتقييم، وهي
// كلّ المنطق.
//
// ★ الأهم: الحساب الفلكي مثبَّت على قيم تقويمية منشورة، لا على مخرجاته نفسها.
// اختبار يقارن الدالّة بنفسها يمرّ دائمًا ولا يثبت شيئًا.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const ROOT = path.resolve(__dirname, "..");
const loadTs = (rel) => {
  const js = ts.transpileModule(fs.readFileSync(path.join(ROOT, rel), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const m = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function("exports", "module", "require", js)(m.exports, m, () => ({}));
  return m.exports;
};

const SOLAR = loadTs("lib/production/solar.ts");
const W = loadTs("lib/production/weather.ts");

// ─── V2-3.1-D · الحساب الفلكي ──────────────────────────────────────────────

const DAMMAM = { lat: 26.4207, lng: 50.0888 };
const utc = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
/** دقائق الفارق بين لحظتين. */
const diffMin = (a, b) => Math.abs(a.getTime() - b.getTime()) / 60000;

test("(S-1) ★★★ الشروق والغروب مطابقان لتقويم منشور ضمن ٤ دقائق ★★★", () => {
  // 🔴 قيم مرجعية للدمّام (٢٦.٤٢°ش، ٥٠.٠٩°ق) بتوقيت +٣، محسوبة بطريقة **مستقلّة**:
  // متسلسلة Spencer لميل الشمس + معادلة الزمن، وهي غير الطريقة المستخدمة في
  // `solar.ts` (عبور يوليانيّ + معادلة المركز). اتفاق الطريقتين على الانقلابين
  // والاعتدال هو التحقّق الفعليّ — لا مقارنة الدالّة بنفسها.
  //
  // ⚠️ قيم كُتبت هنا ابتداءً من الذاكرة كانت خاطئة بـ٧–١٠ دقائق، وهذا الاختبار
  // هو ما كشفها. ٤ دقائق هامش: لا تصحيح للارتفاع ولا للانكسار المحلّي.
  const cases = [
    // [التاريخ, الشروق المحلّي, الغروب المحلّي]
    [utc(2026, 6, 21), "04:47", "18:35"],   // الانقلاب الصيفي — أطول نهار
    [utc(2026, 12, 21), "06:23", "16:52"],  // الانقلاب الشتوي — أقصر نهار
    [utc(2026, 3, 20), "05:45", "17:51"],   // الاعتدال الربيعي — ~١٢ ساعة
  ];
  for (const [date, rise, set] of cases) {
    const s = SOLAR.solarDay(date, DAMMAM.lat, DAMMAM.lng);
    assert.ok(s.sunrise && s.sunset, `${date.toISOString().slice(0,10)}: بلا شروق أو غروب`);
    const gotRise = SOLAR.atZone(s.sunrise, "Asia/Riyadh", "en-GB");
    const gotSet = SOLAR.atZone(s.sunset, "Asia/Riyadh", "en-GB");
    const asMin = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
    assert.ok(Math.abs(asMin(gotRise) - asMin(rise)) <= 4,
      `${date.toISOString().slice(0,10)}: الشروق ${gotRise} والمرجع ${rise}`);
    assert.ok(Math.abs(asMin(gotSet) - asMin(set)) <= 4,
      `${date.toISOString().slice(0,10)}: الغروب ${gotSet} والمرجع ${set}`);
  }
});

test("(S-2) ★★ الاعتدال ≈ ١٢ ساعة نهارًا، والانقلابان طرفان ★★", () => {
  const dayLen = (d) => {
    const s = SOLAR.solarDay(d, DAMMAM.lat, DAMMAM.lng);
    return (s.sunset - s.sunrise) / 3_600_000;
  };
  assert.ok(Math.abs(dayLen(utc(2026, 3, 20)) - 12.1) < 0.2, "الاعتدال ليس ≈١٢ ساعة");
  assert.ok(dayLen(utc(2026, 6, 21)) > 13.5, "الانقلاب الصيفي ليس الأطول");
  assert.ok(dayLen(utc(2026, 12, 21)) < 11, "الانقلاب الشتوي ليس الأقصر");
});

test("(S-3) ★★★ «الساعة» الذهبية ليست ساعة — والقيمة المطبوعة هي الحقيقية ★★★", () => {
  const s = SOLAR.solarDay(utc(2026, 6, 21), DAMMAM.lat, DAMMAM.lng);
  for (const key of ["goldenHourMorning", "goldenHourEvening"]) {
    const w = s[key];
    assert.ok(w, `${key}: غائبة في الدمّام — مستحيل`);
    // على خطّ عرض ٢٦° النافذة ٣٥–٥٠ دقيقة، لا ٦٠. هذا سببُ وجود الوحدة أصلًا.
    assert.ok(w.minutes >= 30 && w.minutes <= 55, `${key}: ${w.minutes} دقيقة — خارج المعقول`);
    assert.ok(w.end > w.start, `${key}: النهاية قبل البداية`);
    assert.equal(w.minutes, Math.round((w.end - w.start) / 60000), `${key}: الدقائق لا تطابق المدى`);
  }
  // الصباحية تحيط بالشروق، والمسائية تحيط بالغروب.
  assert.ok(diffMin(s.goldenHourMorning.start, s.sunrise) < 40, "الذهبية الصباحية بعيدة عن الشروق");
  assert.ok(diffMin(s.goldenHourEvening.end, s.sunset) < 40, "الذهبية المسائية بعيدة عن الغروب");
});

test("(S-4) ★★ الزرقاء تسبق الذهبية صباحًا وتليها مساءً — ولا تتداخلان ★★", () => {
  const s = SOLAR.solarDay(utc(2026, 3, 20), DAMMAM.lat, DAMMAM.lng);
  assert.ok(s.blueHourMorning.end <= s.goldenHourMorning.start.getTime() + 1000,
    "الزرقاء الصباحية تتداخل مع الذهبية");
  assert.ok(s.blueHourEvening.start.getTime() + 1000 >= s.goldenHourEvening.end,
    "الزرقاء المسائية تسبق الذهبية");
});

test("(S-5) ★★ القطب: تُرجَع null ولا يُختلَق وقت ★★", () => {
  // لونجييربين، ٧٨°ش — ليل قطبيّ في ديسمبر: لا شروق أصلًا.
  const s = SOLAR.solarDay(utc(2026, 12, 21), 78.22, 15.63);
  assert.equal(s.sunrise, null, "اختُلق شروق في ليل قطبيّ");
  assert.equal(s.sunset, null, "اختُلق غروب في ليل قطبيّ");
  assert.equal(s.goldenHourMorning, null, "اختُلقت ساعة ذهبية في ليل قطبيّ");
  // ومع ذلك يبقى الظهر الشمسي معرَّفًا — فهو لحظة عبور لا لحظة ارتفاع.
  assert.ok(s.solarNoon instanceof Date && !Number.isNaN(s.solarNoon.getTime()));
});

test("(S-6) ★ التنسيق: نافذة غائبة تُقال «لا ينطبق» لا 00:00 ★", () => {
  assert.equal(SOLAR.formatWindow(null, "ar"), "لا ينطبق");
  assert.equal(SOLAR.formatWindow(null, "en"), "N/A");
  const s = SOLAR.solarDay(utc(2026, 6, 21), DAMMAM.lat, DAMMAM.lng);
  const out = SOLAR.formatWindow(s.goldenHourEvening, "ar");
  assert.match(out, /^\d{2}:\d{2} – \d{2}:\d{2} \(\d+ د\)$/, `تنسيق غير متوقَّع: ${out}`);
});

// ─── V2-3.1-E · الطقس ──────────────────────────────────────────────────────

test("(W-1) ★★★ الأفق ٤٨ ساعة — وما بعده لا يُكتب على الورقة ★★★", () => {
  const now = new Date("2026-08-03T09:00:00Z");
  assert.equal(W.withinHorizon("2026-08-03", now), true, "اليوم نفسه رُفض");
  assert.equal(W.withinHorizon("2026-08-04", now), true, "الغد رُفض");
  assert.equal(W.withinHorizon("2026-08-05", now), true, "بعد الغد (بدايته على بعد ٣٩س) رُفض");
  assert.equal(W.withinHorizon("2026-08-06", now), false, "🔴 قُبل يوم بدايته على بعد ٦٣ ساعة");
  assert.equal(W.withinHorizon("2026-08-07", now), false, "🔴 قُبلت توقّعات بعيدة تُقرأ كأنّها معلومة");
  assert.equal(W.withinHorizon("2026-08-20", now), false, "🔴 قُبل توقّع بعد أسبوعين");
  assert.equal(W.withinHorizon("not-a-date", now), false, "تاريخ فاسد لم يُرفض");
  assert.equal(W.HORIZON_HOURS, 48);
});

test("(W-2) ★★ الرابط: بلا مفتاح، وبمدى يوم واحد، وبوحدة كم/س ★★", () => {
  const url = W.forecastUrl({ lat: 26.42, lng: 50.09, date: "2026-08-04" });
  assert.ok(url.startsWith("https://api.open-meteo.com/v1/forecast?"), "نقطة نهاية غير متوقَّعة");
  assert.match(url, /wind_speed_unit=kmh/, "الوحدة ليست كم/س فالعتبات تصير خاطئة");
  assert.match(url, /start_date=2026-08-04&end_date=2026-08-04/, "المدى ليس يومًا واحدًا");
  assert.match(url, /wind_gusts_10m_max/, "الهبّات غير مطلوبة — وهي أساس التقييم");
  // ⛔ لا مفتاح ولا رمز: النقطة غير موثَّقة، فلا سرّ يتسرّب.
  assert.doesNotMatch(url, /apikey|api_key|token|key=/i, "🔴 مفتاح في الرابط");
  // بلا تعليقات: الترويسة نفسها تشرح أنّها لا تقرأ البيئة، فالبحث الخامّ يرصدها.
  const code = fs.readFileSync(path.join(ROOT, "lib/production/weather.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
  assert.doesNotMatch(code, /process\.env/, "🔴 الوحدة تقرأ متغيّر بيئة — والبرِيف يقول بلا مفتاح");
});

test("(W-3) ★★ التحليل: رمز مجهول لا يصير «صحو» ★★", () => {
  const json = {
    daily: {
      time: ["2026-08-04"], weather_code: [3], temperature_2m_max: [44.1],
      temperature_2m_min: [31.2], wind_speed_10m_max: [18.5],
      wind_gusts_10m_max: [31.0], precipitation_probability_max: [0],
    },
  };
  const f = W.parseForecast(json, "2026-08-04");
  assert.equal(f.conditionAr, "غائم");
  assert.equal(f.windGustKph, 31);
  assert.equal(f.tempMaxC, 44.1);

  // رمز خارج الجدول ⇒ «غير محدّد»، لا تخمين.
  const [ar, en] = W.wmoLabel(1234);
  assert.equal(ar, "غير محدّد");
  assert.equal(en, "Unspecified");

  // يوم غير موجود، أو حقل ناقص، أو استجابة فاسدة ⇒ null لا كائن نصف مملوء.
  assert.equal(W.parseForecast(json, "2026-08-09"), null, "أعاد يومًا غير مطلوب");
  assert.equal(W.parseForecast({}, "2026-08-04"), null);
  assert.equal(W.parseForecast(null, "2026-08-04"), null);
  assert.equal(W.parseForecast({ daily: { time: ["2026-08-04"], weather_code: [null] } }, "2026-08-04"), null,
    "رمز ناقص لم يُرفض");
  // حقل رقمي مفقود ⇒ null لذلك الحقل وحده، والباقي يمرّ.
  const partial = W.parseForecast({ daily: { time: ["2026-08-04"], weather_code: [0] } }, "2026-08-04");
  assert.equal(partial.tempMaxC, null);
  assert.equal(partial.conditionEn, "Clear");
});

// ─── V2-3.1-F · لافتة الرياح ───────────────────────────────────────────────

test("(F-1) ★★★ اللافتة تظهر ليوم درون فقط — ولا ضجيج على سطر سلامة ★★★", () => {
  const gusty = { windMaxKph: 20, windGustKph: 48 };
  assert.equal(W.assessWind(gusty, false), null, "🔴 لافتة رياح في يوم بلا تصوير جوّي");
  assert.equal(W.assessWind(null, true), null, "لافتة بلا توقّع");
  assert.ok(W.assessWind(gusty, true), "لم تظهر اللافتة في يوم درون عاصف");
});

test("(F-2) ★★★ القرار على الهبّات لا المتوسّط ★★★", () => {
  // ٢٠ كم/س متوسطًا يبدو هادئًا؛ ٤٨ هبّةً هو ما يُسقط الطائرة.
  const a = W.assessWind({ windMaxKph: 20, windGustKph: 48 }, true);
  assert.equal(a.level, "severe", "الهبّة العالية صُنّفت على المتوسّط الهادئ");
  assert.equal(a.decidedOnKph, 48);
  assert.equal(a.usedGusts, true);
  // وبلا هبّات يُستخدم المتوسّط، ويُقال إنّه المتوسّط.
  const b = W.assessWind({ windMaxKph: 37, windGustKph: null }, true);
  assert.equal(b.level, "warning");
  assert.equal(b.usedGusts, false);
  assert.match(b.messageAr, /متوسط/);
});

test("(F-3) ★★ الحدود عند العتبة نفسها تُصنَّف تصاعديًا ★★", () => {
  const at = (v) => W.assessWind({ windMaxKph: null, windGustKph: v }, true).level;
  assert.equal(at(W.WIND_BAND.caution - 0.1), "ok");
  assert.equal(at(W.WIND_BAND.caution), "caution");
  assert.equal(at(W.WIND_BAND.warning), "warning");
  assert.equal(at(W.WIND_BAND.severe), "severe");
  assert.equal(at(200), "severe");
});

test("(F-4) ★★★ اللافتة لا تُصدر حكم سلامة مطلقًا ★★★", () => {
  // لا حدّ عالميّ لرياح الدرون — الحدّ خاصيّة الطائرة. فالنصّ يحيل إلى تصنيفها
  // وإلى قرار الطيّار، ولا يقول «آمن» ولا «ممنوع».
  for (const v of [26, 36, 60]) {
    const a = W.assessWind({ windMaxKph: null, windGustKph: v }, true);
    assert.doesNotMatch(a.messageAr, /آمن|مسموح|ممنوع منعًا|احظر/,
      `${v}: حكم سلامة مطلق في النصّ العربي`);
    assert.doesNotMatch(a.messageEn, /\bsafe\b|\bunsafe\b|\bprohibited\b|\bforbidden\b/i,
      `${v}: حكم سلامة مطلق في النصّ الإنجليزي`);
  }
  const severe = W.assessWind({ windMaxKph: null, windGustKph: 60 }, true);
  assert.match(severe.messageAr, /الطائرات|الطيّار|بديل|بلا تصوير جوّي/, "لا إحالة إلى تصنيف الطائرة أو قرار الطيّار");
  assert.match(W.assessWind({ windMaxKph: null, windGustKph: 36 }, true).messageAr, /الطيّار/,
    "التحذير لا يُحيل القرار إلى الطيّار");
});
