// ════════════════════════════════════════════════════════════════════════════
// content/stats.ts — ONE source of truth for the "بالأرقام" band.
//
// Wave 1 · V2-1.2-A/B/C  (MASTER_BRIEF_v2.1.md §4 WAVE 1)
//
// ★ WHY THIS FILE EXISTS ★
// The four figures were a `STATS` array inside components/Stats.tsx, so the
// numbers a visitor is asked to trust lived inside a presentational component.
// They are now content, editable without touching React.
//
// ★ THE BUG THIS FILE IS PART OF FIXING (V2-1.2-B) ★
// components/Counter.tsx starts at useState(0), so the FIRST HTML the server
// sends reads "0+" for every figure. It animates up once JavaScript runs — but
// a crawler, a preview scraper, or anyone with JS disabled sees a company
// claiming zero productions and zero clients. The fix is to render the final
// value server-side and let the animation start FROM it, never from zero.
// `display` below is that server-rendered string.
//
// ⚠️ `years` — the only figure Khaled still has to confirm (V2-1.2-C). The
// number kept here is the one that was already live; it is NOT invented, but it
// is also not verified. See docs/overnight/OVERNIGHT_DECISIONS_REQUIRED.md.
// ════════════════════════════════════════════════════════════════════════════

export interface Stat {
  /** Stable key — used by tests and as the React key. Never re-order for meaning. */
  key: "years" | "productions" | "clients" | "regions";
  /** Target the counter animates to. */
  to: number;
  suffix: string;
  ar: string;
  en: string;
  /**
   * false when the figure is carried over but unverified. Rendered identically —
   * this flag exists so a report can say honestly which numbers are confirmed.
   */
  confirmed: boolean;
}

export const STATS: Stat[] = [
  // ⚠️ Unconfirmed: carried over from the live site, pending Khaled (V2-1.2-C).
  { key: "years",       to: 20,   suffix: "+", ar: "سنة خبرة",        en: "Years of Experience",  confirmed: false },
  // Confirmed in MASTER_BRIEF_v2.1.md §4 WAVE 1 (V2-1.2-C).
  { key: "productions", to: 4000, suffix: "+", ar: "إنتاج مكتمل",      en: "Productions Delivered", confirmed: true },
  { key: "clients",     to: 2000, suffix: "+", ar: "عميل",             en: "Clients Served",        confirmed: true },
  { key: "regions",     to: 13,   suffix: "",  ar: "منطقة في المملكة", en: "Regions Across KSA",    confirmed: true },
];

/**
 * The string the SERVER renders, and the value the animation must finish on.
 *
 * Uses `en-US` digits explicitly rather than the visitor's locale: on an Arabic
 * page `toLocaleString()` can emit Eastern Arabic numerals client-side while the
 * server emitted Western ones, and that mismatch is a React hydration error —
 * which blanks the whole band. Same string on both sides, always.
 */
export const statDisplay = (s: Stat): string => `${s.to.toLocaleString("en-US")}${s.suffix}`;
