// ════════════════════════════════════════════════════════════════════════
// Null-safe display helpers.
//
// Supabase/PostgREST rows and RPC results routinely carry NULLs even where a
// TypeScript type claims a non-null string (e.g. quote_requests.user_id is
// null for guest / public-form / WhatsApp submissions that never linked to an
// auth user). Calling .slice()/.map()/new Date() on those values throws
// "Cannot read properties of null" and crashes the whole route.
//
// Treat every rendered field as possibly-null and pass it through one of these
// helpers. They never throw and fall back to an em dash (or a caller-supplied
// fallback) for missing data.
// ════════════════════════════════════════════════════════════════════════

export const EM_DASH = "—";

/** Trimmed string, or `fallback` when null/undefined/blank/non-string. */
export function safeText(value: unknown, fallback: string = EM_DASH): string {
  if (value == null) return fallback;
  const s = String(value).trim();
  return s === "" ? fallback : s;
}

/**
 * First `len` characters of an id (UUID, reference, etc.) with a trailing
 * ellipsis when truncated, or `fallback` when the value is missing. Safe
 * replacement for the crash-prone `id.slice(0, 8)` pattern.
 */
export function safeShortId(value: unknown, len: number = 8, fallback: string = EM_DASH): string {
  if (value == null) return fallback;
  const s = String(value).trim();
  if (s === "") return fallback;
  return s.length > len ? `${s.slice(0, len)}…` : s;
}

/** Email or `fallback`. (Caller keeps LTR via its own styling.) */
export function safeEmail(value: unknown, fallback: string = EM_DASH): string {
  return safeText(value, fallback);
}

/** Phone number or `fallback`. */
export function safePhone(value: unknown, fallback: string = EM_DASH): string {
  return safeText(value, fallback);
}

/**
 * Locale-formatted date (or date-time) or `fallback` — never throws on a null,
 * empty, or unparseable value. `new Date(null)` silently yields the epoch and
 * `new Date("garbage")` yields an Invalid Date, so both are guarded here.
 */
export function safeDate(
  value: unknown,
  locale: string = "en-GB",
  opts?: { withTime?: boolean; fallback?: string },
): string {
  const fallback = opts?.fallback ?? EM_DASH;
  if (value == null || value === "") return fallback;
  const d = new Date(value as string | number | Date);
  if (Number.isNaN(d.getTime())) return fallback;
  return opts?.withTime ? d.toLocaleString(locale) : d.toLocaleDateString(locale);
}

/** The value when it is a real array, else an empty array — safe to .map()/.join(). */
export function safeArray<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}
