// ════════════════════════════════════════════════════════════════════════════
// lib/production/callSheet.ts — يُثري ورقة النداء بالضوء والطقس، ولا يكسرها أبدًا.
//
// Wave 3 · V2-3.1-D/E/F/H  (MASTER_BRIEF_v2.1.md §4 WAVE 3)
//
// ★★ القاعدة الحاكمة لهذا الملفّ ★★
// «فشل الطقس لا يمنع فتح أو تعديل أو حفظ أو طباعة Call Sheet.»
//
// ولذلك **لا دالّة هنا ترمي استثناءً**، ولا واحدة تُرجع خطأً يوقف نداءً. كلّها
// تُرجع قيمة قابلة للعرض أو `null`، وكلّ حقل مستقلّ عن جاره: موقع بلا إحداثيات
// يُلغي الساعة الذهبية وحدها ويُبقي الطقس، وطقس مفقود يُلغي التحذير وحده ويُبقي
// الساعة الذهبية. الورقة تُطبع في الحالات كلّها.
//
// ★ لماذا الحساب هنا لا في القاعدة ★
// الساعة الذهبية دالّة في (خطّ العرض · خطّ الطول · التاريخ) فقط. تخزينها يخلق
// مصدر حقيقة ثانيًا يتعفّن لحظة تغيير الموقع أو التاريخ، ويحتاج مُحدِّثًا يعمل
// خلف كلّ تعديل. حسابها عند العرض يجعلها صحيحة دائمًا بلا صفّ واحد في القاعدة.
//
// ⛔ ولا شبكة هنا إطلاقًا. الجلب يتمّ في مسار خادميّ منفصل، وهذا الملفّ يقرأ ما
// وصل بالفعل. فهو قابل للاختبار كاملًا بلا mock للشبكة.
// ════════════════════════════════════════════════════════════════════════════

import { solarDay, formatWindow, type SolarWindow } from "./solar";
import { assessWind, type WindAssessment, type DayForecast } from "./weather";

/** لماذا لا تُعرض الساعة الذهبية — سبب مقروء بدل حقل فارغ صامت. */
export type SunUnavailable =
  | "no_location"        // لا موقع مرتبط بالورقة
  | "no_coordinates"     // موقع بلا lat/lng — يُملأ في سجلّ المواقع
  | "no_date"            // الورقة بلا تاريخ
  | "not_applicable";    // لا تحدث فلكيًّا (خطوط عرض قطبية)

export interface SunBlock {
  available: boolean;
  reason: SunUnavailable | null;
  sunrise: string | null;
  sunset: string | null;
  goldenMorning: string | null;
  goldenEvening: string | null;
  blueMorning: string | null;
  blueEvening: string | null;
  /** النوافذ الخامّة لمن يحتاج الحساب لا النصّ. */
  raw: { goldenMorning: SolarWindow | null; goldenEvening: SolarWindow | null } | null;
}

const NO_SUN = (reason: SunUnavailable): SunBlock => ({
  available: false, reason,
  sunrise: null, sunset: null,
  goldenMorning: null, goldenEvening: null, blueMorning: null, blueEvening: null,
  raw: null,
});

/** نصّ عربيّ لسبب الغياب. لا يقول «غير متوفّر» فحسب — يقول **لماذا**، فيُصلَح. */
export function sunReasonAr(reason: SunUnavailable): string {
  switch (reason) {
    case "no_location":     return "لا موقع مرتبط بورقة النداء.";
    case "no_coordinates":  return "الموقع بلا إحداثيات — أضف lat/lng في سجلّ المواقع.";
    case "no_date":         return "الورقة بلا تاريخ تصوير.";
    case "not_applicable":  return "لا تحدث ساعة ذهبية في هذا الموقع بهذا التاريخ.";
  }
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v
  : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v)
  : null;

/**
 * الساعة الذهبية لورقة نداء.
 *
 * `location` و`sheetDate` يأتيان كما هما من `prodops_call_sheet` — أي `unknown`
 * فعليًّا. لذلك كلّ قراءة محروسة: صفّ ناقص يُنتج سببًا مقروءًا، لا انهيارًا.
 */
export function sunFor(
  location: Record<string, unknown> | null | undefined,
  sheetDate: string | null | undefined,
  timeZone = "Asia/Riyadh",
): SunBlock {
  if (!sheetDate || typeof sheetDate !== "string") return NO_SUN("no_date");
  if (!location) return NO_SUN("no_location");

  const lat = num(location.lat);
  const lng = num(location.lng);
  if (lat === null || lng === null) return NO_SUN("no_coordinates");

  const day = new Date(`${sheetDate}T00:00:00Z`);
  if (Number.isNaN(day.getTime())) return NO_SUN("no_date");

  let s: ReturnType<typeof solarDay>;
  try {
    s = solarDay(day, lat, lng);
  } catch {
    // 🔴 لا يُفترض أن يحدث، لكنّ ورقة نداء لا تسقط بسبب حساب فلكيّ.
    return NO_SUN("not_applicable");
  }
  if (!s.sunrise || !s.sunset) return NO_SUN("not_applicable");

  const f = (w: SolarWindow | null) => (w ? formatWindow(w, "ar", timeZone) : null);
  const t = (d: Date | null) =>
    d ? new Intl.DateTimeFormat("ar-SA-u-nu-latn", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone }).format(d) : null;

  return {
    available: true, reason: null,
    sunrise: t(s.sunrise), sunset: t(s.sunset),
    goldenMorning: f(s.goldenHourMorning), goldenEvening: f(s.goldenHourEvening),
    blueMorning: f(s.blueHourMorning), blueEvening: f(s.blueHourEvening),
    raw: { goldenMorning: s.goldenHourMorning, goldenEvening: s.goldenHourEvening },
  };
}

// ─── الطقس كما وصل من القاعدة ───────────────────────────────────────────────

/** عمر التوقّع الذي بعده يُعدّ قديمًا ويُعلَن كذلك بدل أن يُعرض كأنّه طازج. */
export const STALE_AFTER_HOURS = 12;

export interface WeatherBlock {
  available: boolean;
  /** 'manual' · 'placeholder' · 'open_meteo' — المصدر معلن دائمًا. */
  source: string | null;
  condition: string | null;
  tempC: number | null;
  windKph: number | null;
  gustKph: number | null;
  precipPct: number | null;
  fetchedAt: string | null;
  /** توقّع أقدم من STALE_AFTER_HOURS — يُعرض مع تنبيه، لا يُخفى ولا يُدّعى. */
  stale: boolean;
  note: string | null;
}

const NO_WEATHER: WeatherBlock = {
  available: false, source: null, condition: null, tempC: null, windKph: null,
  gustKph: null, precipPct: null, fetchedAt: null, stale: false, note: null,
};

export function weatherFor(
  row: Record<string, unknown> | null | undefined,
  now: Date = new Date(),
): WeatherBlock {
  if (!row) return NO_WEATHER;
  const fetchedAt = typeof row.fetched_at === "string" ? row.fetched_at : null;
  let stale = false;
  if (fetchedAt) {
    const ms = Date.parse(fetchedAt);
    // تاريخ فاسد ⇒ لا نَدّعي طزاجةً ولا قِدَمًا.
    if (!Number.isNaN(ms)) stale = (now.getTime() - ms) / 3_600_000 > STALE_AFTER_HOURS;
  }
  const condition = typeof row.condition === "string" && row.condition.trim() !== "" ? row.condition : null;
  const source = typeof row.source === "string" ? row.source : null;

  return {
    // صفّ موجود بلا محتوى ليس طقسًا — لا يُعرض بلوك فارغ.
    available: Boolean(condition || num(row.temp_c) !== null || num(row.wind_kph) !== null),
    source, condition,
    tempC: num(row.temp_c), windKph: num(row.wind_kph),
    gustKph: num(row.wind_gust_kph), precipPct: num(row.precip_pct),
    fetchedAt, stale,
    note: typeof row.note === "string" && row.note.trim() !== "" ? row.note : null,
  };
}

// ─── التحذير الإرشادي للدرون ────────────────────────────────────────────────

export interface DroneAdvisory extends WindAssessment {
  /** 🔴 يُعرض حرفيًّا مع كلّ تحذير. ليس تزيينًا. */
  disclaimerAr: string;
  disclaimerEn: string;
}

/**
 * 🔴 **إرشاديّ، وليس تصريح طيران.**
 * لا يُصدر إذنًا ولا منعًا: لا حدّ رياح عالميًّا للدرون — الحدّ خاصيّة الطائرة،
 * والتصريح شأن نظاميّ خارج هذا النظام تمامًا. النصّ يحيل إلى تصنيف الطائرة وإلى
 * قرار الطيّار، والتنويه يُطبع معه دائمًا.
 */
export function droneAdvisory(w: WeatherBlock, isDroneDay: boolean): DroneAdvisory | null {
  if (!isDroneDay || !w.available) return null;
  const a = assessWind(
    { windMaxKph: w.windKph, windGustKph: w.gustKph } as Pick<DayForecast, "windMaxKph" | "windGustKph">,
    true,
  );
  if (!a) return null;
  return {
    ...a,
    disclaimerAr: "إرشاديّ فقط — ليس تصريح طيران، ولا يُغني عن حدّ الطائرة ولا عن التصاريح النظامية.",
    disclaimerEn: "Advisory only — not a flight authorisation, and no substitute for the aircraft's limit or regulatory permits.",
  };
}

// ─── V2-3.1-H · التاريخ البديل ──────────────────────────────────────────────

export interface BackupDateBlock {
  date: string | null;
  labelAr: string;
  /** 🔴 يُطبع مع التاريخ البديل دائمًا. */
  noticeAr: string;
}

/**
 * التاريخ البديل — **إعلان نيّة لا حجز**.
 *
 * 🔴 لا يحجز طاقمًا ولا معدّة ولا موقعًا، ولا يدخل حارس التعارض `23P01`. يوم
 * بديل يحجز الموارد صامتًا يُجمّد معدّات ليوم قد لا يأتي، ويُنتج تعارضات وهمية
 * على الأيام الحقيقية. التحويل إليه فعل صريح يُنشئ ورقة نداء جديدة بتاريخه.
 */
export function backupDateBlock(sheet: Record<string, unknown> | null | undefined): BackupDateBlock | null {
  const d = sheet && typeof sheet.backup_date === "string" && sheet.backup_date.trim() !== ""
    ? sheet.backup_date : null;
  if (!d) return null;
  return {
    date: d,
    labelAr: "تاريخ بديل",
    noticeAr: "إعلان نيّة — لا يحجز طاقمًا ولا معدّات ولا موقعًا. التحويل إليه يحتاج ورقة نداء بتاريخه.",
  };
}

// ─── التجميع ────────────────────────────────────────────────────────────────

export interface CallSheetEnrichment {
  sun: SunBlock;
  weather: WeatherBlock;
  drone: DroneAdvisory | null;
  backup: BackupDateBlock | null;
}

/**
 * كلّ ما تضيفه Wave 3 إلى ورقة نداء، من بيانات وصلت بالفعل.
 * لا شبكة · لا استثناء · وكلّ حقل مستقلّ عن جاره.
 */
export function enrichCallSheet(
  data: {
    sheet?: Record<string, unknown> | null;
    location?: Record<string, unknown> | null;
    weather?: Record<string, unknown> | null;
  } | null | undefined,
  now: Date = new Date(),
  timeZone = "Asia/Riyadh",
): CallSheetEnrichment {
  const sheet = data?.sheet ?? null;
  const sheetDate =
    sheet && typeof sheet.sheet_date === "string" ? sheet.sheet_date : null;
  const isDroneDay = sheet?.is_drone_day === true;

  const weather = weatherFor(data?.weather, now);
  return {
    sun: sunFor(data?.location, sheetDate, timeZone),
    weather,
    drone: droneAdvisory(weather, isDroneDay),
    backup: backupDateBlock(sheet),
  };
}
