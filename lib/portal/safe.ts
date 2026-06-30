// ════════════════════════════════════════════════════════════════════════
// Null-safe formatters for values coming from Supabase / RPC. EVERY value from
// the API is treated as nullable — never call .slice()/.toLocaleDateString()
// directly on a value that could be null. Renders an Arabic-friendly fallback
// ("—") instead of crashing the page.
// ════════════════════════════════════════════════════════════════════════
const DEV = process.env.NODE_ENV !== "production";

/** Non-empty string or the fallback. */
export function safeText(v: unknown, fallback = "—"): string {
  if (v === null || v === undefined) return fallback;
  const s = String(v).trim();
  return s.length ? s : fallback;
}

/** First `len` chars of an id-like string; fallback if null/empty/non-string.
 *  Replaces the crash-prone `row.id.slice(0, 8)` pattern. */
export function safeShortId(v: unknown, len = 8, fallback = "—"): string {
  if (typeof v === "string" && v.length > 0) return v.slice(0, len);
  if (DEV && v !== null && v !== undefined && typeof v !== "string") {
    // Surface the root cause in dev without crashing the UI.
    console.warn("[safeShortId] expected a string id but got:", typeof v, v);
  }
  return fallback;
}

/** Locale date string, or fallback for null/empty/invalid dates. */
export function safeDate(v: unknown, locale: string | string[] = "ar-SA", fallback = "—"): string {
  if (v === null || v === undefined || v === "") return fallback;
  const d = new Date(v as string | number);
  return Number.isNaN(d.getTime()) ? fallback : d.toLocaleDateString(locale);
}

/** Email or fallback (kept simple — does not over-validate). */
export function safeEmail(v: unknown, fallback = "—"): string {
  const s = safeText(v, "");
  return s.length ? s : fallback;
}

/** Phone or fallback. */
export function safePhone(v: unknown, fallback = "—"): string {
  const s = safeText(v, "");
  return s.length ? s : fallback;
}
