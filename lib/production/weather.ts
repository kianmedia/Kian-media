// ════════════════════════════════════════════════════════════════════════════
// lib/production/weather.ts — Open-Meteo forecast for a shoot day.
//
// Wave 3 · V2-3.1-E / V2-3.1-F  (MASTER_BRIEF_v2.1.md §4 WAVE 3)
//
// ★ WHAT THE BRIEF ASKS AND WHAT IT DOES NOT ★
// "الطقس عبر Open-Meteo (بلا مفتاح) خادميًا ≤48 ساعة — `ops_job_weather` قائم،
// يُعبَّأ لا يُنشأ". So: no new table, no API key, server side only, and a
// horizon of at most 48 hours.
//
// ⚠️ THE 48-HOUR LIMIT IS A HONESTY RULE, NOT A QUOTA.
// Open-Meteo will happily return 16 days. A 10-day-out forecast printed on a
// call sheet reads as information but is close to noise, and crews plan around
// it. `withinHorizon()` refuses beyond 48h and the caller records nothing —
// leaving the field empty, which is true, instead of filling it, which is not.
//
// ★ NO KEY, AND THEREFORE NO SECRET ★
// Open-Meteo's forecast endpoint is unauthenticated. Nothing here reads
// process.env, so there is no credential to leak and no env change to deploy.
//
// This module is PURE except for `fetchForecast`. URL building, parsing,
// horizon and the wind assessment are all testable without a network.
// ════════════════════════════════════════════════════════════════════════════

export const OPEN_METEO_ENDPOINT = "https://api.open-meteo.com/v1/forecast";

/** The furthest ahead a forecast may be written onto a sheet. */
export const HORIZON_HOURS = 48;

export interface ForecastQuery {
  lat: number;
  lng: number;
  /** ISO date, YYYY-MM-DD. */
  date: string;
  timezone?: string;
}

export interface DayForecast {
  date: string;
  conditionCode: number;
  /** Arabic/English label derived from the WMO code — never invented. */
  conditionAr: string;
  conditionEn: string;
  tempMaxC: number | null;
  tempMinC: number | null;
  windMaxKph: number | null;
  windGustKph: number | null;
  precipProbMaxPct: number | null;
}

/** Is `date` close enough to `now` to be worth printing? */
export function withinHorizon(date: string, now: Date = new Date()): boolean {
  // Measured to the START of the shoot day, not its noon. A shoot beginning at
  // 06:00 on day+2 is 45 hours out and worth forecasting; anchoring on noon
  // would call it 51 and drop a forecast the crew can actually use. Noon is an
  // arbitrary point in a day that starts before dawn.
  const target = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(target)) return false;
  const hours = (target - now.getTime()) / 3_600_000;
  // A day already under way still counts — the crew is standing in it.
  return hours >= -24 && hours <= HORIZON_HOURS;
}

export function forecastUrl(q: ForecastQuery): string {
  const p = new URLSearchParams({
    latitude: String(q.lat),
    longitude: String(q.lng),
    daily: "weather_code,temperature_2m_max,temperature_2m_min,wind_speed_10m_max,wind_gusts_10m_max,precipitation_probability_max",
    wind_speed_unit: "kmh",
    timezone: q.timezone ?? "Asia/Riyadh",
    start_date: q.date,
    end_date: q.date,
  });
  return `${OPEN_METEO_ENDPOINT}?${p.toString()}`;
}

/**
 * WMO weather codes → labels.
 *
 * Only the codes Open-Meteo actually documents. An unknown code returns a
 * neutral "غير محدّد", never a guess: a call sheet that says "clear" because a
 * lookup missed is worse than one that says nothing.
 */
const WMO: Record<number, [string, string]> = {
  0: ["صحو", "Clear"],
  1: ["صحو غالبًا", "Mainly clear"],
  2: ["غائم جزئيًا", "Partly cloudy"],
  3: ["غائم", "Overcast"],
  45: ["ضباب", "Fog"],
  48: ["ضباب متجمّد", "Rime fog"],
  51: ["رذاذ خفيف", "Light drizzle"],
  53: ["رذاذ", "Drizzle"],
  55: ["رذاذ كثيف", "Dense drizzle"],
  61: ["مطر خفيف", "Slight rain"],
  63: ["مطر", "Rain"],
  65: ["مطر غزير", "Heavy rain"],
  71: ["ثلج خفيف", "Slight snow"],
  73: ["ثلج", "Snow"],
  75: ["ثلج كثيف", "Heavy snow"],
  80: ["زخّات خفيفة", "Slight showers"],
  81: ["زخّات", "Showers"],
  82: ["زخّات عنيفة", "Violent showers"],
  95: ["عاصفة رعدية", "Thunderstorm"],
  96: ["عاصفة رعدية مع بَرَد", "Thunderstorm with hail"],
  99: ["عاصفة رعدية مع بَرَد كثيف", "Thunderstorm with heavy hail"],
};

export const wmoLabel = (code: number): [string, string] => WMO[code] ?? ["غير محدّد", "Unspecified"];

/** Parse one day out of an Open-Meteo response. Returns null on any surprise. */
export function parseForecast(json: unknown, date: string): DayForecast | null {
  const d = (json as { daily?: Record<string, unknown[]> })?.daily;
  if (!d || !Array.isArray(d.time)) return null;
  const i = (d.time as string[]).indexOf(date);
  if (i < 0) return null;

  const num = (k: string): number | null => {
    const v = Array.isArray(d[k]) ? (d[k] as unknown[])[i] : null;
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  const code = num("weather_code");
  if (code === null) return null;
  const [ar, en] = wmoLabel(code);

  return {
    date,
    conditionCode: code,
    conditionAr: ar,
    conditionEn: en,
    tempMaxC: num("temperature_2m_max"),
    tempMinC: num("temperature_2m_min"),
    windMaxKph: num("wind_speed_10m_max"),
    windGustKph: num("wind_gusts_10m_max"),
    precipProbMaxPct: num("precipitation_probability_max"),
  };
}

/**
 * Server-side fetch. No key, no cookies, no credentials.
 * Returns null on any failure — a missing forecast is an empty field, not an
 * error the crew has to interpret.
 */
export async function fetchForecast(q: ForecastQuery, signal?: AbortSignal): Promise<DayForecast | null> {
  if (!withinHorizon(q.date)) return null;
  try {
    const res = await fetch(forecastUrl(q), { signal, cache: "no-store" });
    if (!res.ok) return null;
    return parseForecast(await res.json(), q.date);
  } catch {
    return null;
  }
}

// ─── V2-3.1-F · the drone wind banner ───────────────────────────────────────

/**
 * 🔴 THESE THRESHOLDS ARE ADVISORY AND SAY SO.
 *
 * There is no universal drone wind limit — it is a property of the aircraft.
 * A DJI Mavic 3 is rated to 12 m/s (~43 kph); a light FPV rig is unhappy well
 * below that. So this does NOT assert "safe" or "unsafe". It flags the sheet
 * for a decision by the pilot, against the aircraft's OWN rating, and the
 * banner text says exactly that.
 *
 * Gusts, not the mean, decide the band: a 20 kph average with 45 kph gusts is
 * what actually puts an aircraft into the trees.
 */
export const WIND_BAND = {
  /** Worth noticing on the sheet. */
  caution: 25,
  /** Most compact aircraft are near their limit here. */
  warning: 35,
  /** At or past the rating of typical prosumer aircraft. */
  severe: 45,
} as const;

export type WindLevel = "ok" | "caution" | "warning" | "severe";

export interface WindAssessment {
  level: WindLevel;
  /** The number the decision was made on — gusts when known. */
  decidedOnKph: number | null;
  usedGusts: boolean;
  messageAr: string;
  messageEn: string;
}

/**
 * Assess a shoot day for drone work.
 *
 * `isDroneDay` is required rather than inferred: a wind banner on a day with no
 * aerial work is noise, and noise on a safety line teaches crews to skip it.
 */
export function assessWind(f: Pick<DayForecast, "windMaxKph" | "windGustKph"> | null, isDroneDay: boolean): WindAssessment | null {
  if (!isDroneDay || !f) return null;
  const gust = f.windGustKph;
  const mean = f.windMaxKph;
  const v = gust ?? mean;
  if (v === null) return null;

  const level: WindLevel =
    v >= WIND_BAND.severe ? "severe" :
    v >= WIND_BAND.warning ? "warning" :
    v >= WIND_BAND.caution ? "caution" : "ok";

  const kph = Math.round(v);
  const basisAr = gust !== null ? "هبّات" : "متوسط";
  const basisEn = gust !== null ? "gusts" : "average";

  const TEXT: Record<WindLevel, [string, string]> = {
    ok: [
      `رياح ${kph} كم/س (${basisAr}) — ضمن المعتاد.`,
      `Wind ${kph} km/h (${basisEn}) — unremarkable.`,
    ],
    caution: [
      `⚠️ رياح ${kph} كم/س (${basisAr}). راجع حدّ الطائرة قبل الإقلاع.`,
      `⚠️ Wind ${kph} km/h (${basisEn}). Check the aircraft's rated limit before flight.`,
    ],
    warning: [
      `⚠️ رياح ${kph} كم/س (${basisAr}) — عند حدّ كثير من الطائرات المدمجة أو فوقه. قرار الطيّار، وجهّز بديلًا أرضيًا.`,
      `⚠️ Wind ${kph} km/h (${basisEn}) — at or above the rating of many compact aircraft. Pilot's call; prepare a ground alternative.`,
    ],
    severe: [
      `🔴 رياح ${kph} كم/س (${basisAr}) — عند حدّ الطائرات الاحترافية المعتادة أو فوقه. خطّط ليوم التصوير بلا تصوير جوّي.`,
      `🔴 Wind ${kph} km/h (${basisEn}) — at or above the rating of typical prosumer aircraft. Plan the day without aerials.`,
    ],
  };
  const [messageAr, messageEn] = TEXT[level];
  return { level, decidedOnKph: v, usedGusts: gust !== null, messageAr, messageEn };
}
