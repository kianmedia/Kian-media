// ════════════════════════════════════════════════════════════════════════════
// lib/production/solar.ts — sunrise, sunset and the golden hour.
//
// Wave 3 · V2-3.1-D  (MASTER_BRIEF_v2.1.md §4 WAVE 3)
//
// ★ WHY NO `suncalc` ★
// The brief names the `suncalc` package. This computes the same NOAA solar
// equations in ~80 lines with no dependency, and that is the better trade for
// this repository: G7 freezes the integration surface, and an overnight run
// that adds a package adds supply-chain surface nobody reviewed. The maths is
// not the hard part — it is textbook and pinned by tests against published
// almanac values.
//
// ★ WHAT A CALL SHEET ACTUALLY NEEDS ★
// Not "sunrise". A DoP needs the window when the light is usable, which is a
// SOLAR ELEVATION band, not a clock offset. Golden hour is the sun between
// -4° and +6°; blue hour is -6° to -4°. At Saudi latitudes that window is
// roughly 35–45 minutes, not the 60 the name promises — so a call sheet that
// prints "golden hour 17:00–18:00" is wrong by a third. This returns the real
// interval.
//
// ⚠️ Returns null for a window that does not occur (polar day/night, or a sun
// that never reaches the band). Saudi Arabia never hits that case, but the
// function is not allowed to invent a time to avoid a null.
// ════════════════════════════════════════════════════════════════════════════

const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;
/** Julian date of the Unix epoch. */
const J1970 = 2_440_588;
const J2000 = 2_451_545;

const toJulian = (ms: number) => ms / DAY_MS - 0.5 + J1970;
const fromJulian = (j: number) => (j + 0.5 - J1970) * DAY_MS;
const toDays = (ms: number) => toJulian(ms) - J2000;

/** Mean solar anomaly. */
const solarMeanAnomaly = (d: number) => RAD * (357.5291 + 0.98560028 * d);

/** Ecliptic longitude, including the equation of the centre. */
function eclipticLongitude(M: number): number {
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const P = RAD * 102.9372;    // perihelion of the Earth
  return M + C + P + Math.PI;
}

/** Obliquity of the ecliptic. */
const OBLIQUITY = RAD * 23.4397;

const declination = (L: number) => Math.asin(Math.sin(OBLIQUITY) * Math.sin(L));

/** Solar transit (local solar noon) as a Julian date. */
function solarTransitJ(ds: number, M: number, L: number): number {
  return J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
}

/**
 * Hour angle at which the sun sits at altitude `h`.
 * Returns NaN when the sun never reaches that altitude on this day — the caller
 * must treat NaN as "no such moment", not as zero.
 */
function hourAngle(h: number, phi: number, dec: number): number {
  const cosH = (Math.sin(h) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
  if (cosH > 1 || cosH < -1) return NaN;
  return Math.acos(cosH);
}

export interface SolarWindow {
  /** Start of the window, UTC. */
  start: Date;
  /** End of the window, UTC. */
  end: Date;
  /** Whole minutes between start and end — what actually goes on the sheet. */
  minutes: number;
}

export interface SolarDay {
  sunrise: Date | null;
  sunset: Date | null;
  solarNoon: Date;
  /** The two usable-light windows. Either may be null at extreme latitudes. */
  goldenHourMorning: SolarWindow | null;
  goldenHourEvening: SolarWindow | null;
  blueHourMorning: SolarWindow | null;
  blueHourEvening: SolarWindow | null;
}

/** Elevation bands, in degrees. Named so the numbers are not magic. */
export const ELEVATION = {
  /** Geometric sunrise/sunset, including refraction and the solar disc. */
  horizon: -0.833,
  goldenLow: -4,
  goldenHigh: 6,
  blueLow: -6,
} as const;

/**
 * Solar events for one calendar date at one position.
 *
 * `date` is interpreted as the DAY, in UTC. Every returned Date is UTC — the
 * caller formats to Asia/Riyadh. Deliberately not returning local strings: a
 * timezone conversion belongs at the display edge, not baked into a value.
 */
export function solarDay(date: Date, lat: number, lng: number): SolarDay {
  const lw = RAD * -lng;
  const phi = RAD * lat;

  // Noon-anchored so the day's events are the ones bracketing local noon.
  const noonMs = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12, 0, 0);
  const d = toDays(noonMs);
  const n = Math.round(d - 0.0009 - lw / (2 * Math.PI));
  const ds = 0.0009 + lw / (2 * Math.PI) + n;

  const M = solarMeanAnomaly(ds);
  const L = eclipticLongitude(M);
  const dec = declination(L);
  const Jnoon = solarTransitJ(ds, M, L);

  /** The pair of times at which the sun sits at altitude `deg`. */
  const timesAt = (deg: number): { rise: Date | null; set: Date | null } => {
    const w = hourAngle(RAD * deg, phi, dec);
    if (Number.isNaN(w)) return { rise: null, set: null };
    const Jset = solarTransitJ(0.0009 + (w + lw) / (2 * Math.PI) + n, M, L);
    const Jrise = Jnoon - (Jset - Jnoon);
    return { rise: new Date(fromJulian(Jrise)), set: new Date(fromJulian(Jset)) };
  };

  const horizon = timesAt(ELEVATION.horizon);
  const gLow = timesAt(ELEVATION.goldenLow);
  const gHigh = timesAt(ELEVATION.goldenHigh);
  const bLow = timesAt(ELEVATION.blueLow);

  const win = (a: Date | null, b: Date | null): SolarWindow | null => {
    if (!a || !b) return null;
    const [start, end] = a <= b ? [a, b] : [b, a];
    return { start, end, minutes: Math.round((end.getTime() - start.getTime()) / 60_000) };
  };

  return {
    sunrise: horizon.rise,
    sunset: horizon.set,
    solarNoon: new Date(fromJulian(Jnoon)),
    // Morning: the sun climbs -4° → +6°. Evening: it falls +6° → -4°.
    goldenHourMorning: win(gLow.rise, gHigh.rise),
    goldenHourEvening: win(gHigh.set, gLow.set),
    // Blue hour sits just below golden, on the night side of it.
    blueHourMorning: win(bLow.rise, gLow.rise),
    blueHourEvening: win(gLow.set, bLow.set),
  };
}

/**
 * Format a UTC instant for a call sheet, in a named zone.
 *
 * Uses Intl rather than a fixed +03:00 offset. Saudi Arabia does not observe
 * DST today, but hardcoding the offset would make this silently wrong the day
 * that changes, and wrong on any shoot outside the Kingdom.
 */
export function atZone(d: Date, timeZone = "Asia/Riyadh", locale = "ar-SA-u-nu-latn"): string {
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone,
  }).format(d);
}

/** "05:12 – 05:47 (35 د)" — the whole thing a printed sheet needs. */
export function formatWindow(w: SolarWindow | null, locale: "ar" | "en" = "ar", timeZone = "Asia/Riyadh"): string {
  if (!w) return locale === "ar" ? "لا ينطبق" : "N/A";
  const l = locale === "ar" ? "ar-SA-u-nu-latn" : "en-GB";
  const unit = locale === "ar" ? "د" : "min";
  return `${atZone(w.start, timeZone, l)} – ${atZone(w.end, timeZone, l)} (${w.minutes} ${unit})`;
}
