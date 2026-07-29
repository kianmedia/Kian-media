// ════════════════════════════════════════════════════════════════════════════
// lib/portal/import/text.ts — Arabic-safe text primitives for the import engine.
//
// RULE #1 OF THIS FILE: the ORIGINAL text is never mutated. Every helper here
// produces a *derived* comparison/slug value; the value written to the database
// is always the untouched source string (Arabic diacritics, spacing and
// punctuation preserved exactly — no mojibake, no lossy "cleanup").
//
// Normalisation exists for two purposes only:
//   1) matching a column header to a profile field (synonym lookup), and
//   2) building a DETERMINISTIC key slug (same file ⇒ same key, forever).
// ════════════════════════════════════════════════════════════════════════════

/** Zero-width + bidi control characters that Excel/Word silently inject. */
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

/** Arabic diacritics (harakat), superscript alef, and the tatweel elongation. */
const DIACRITICS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E8\u06EA-\u06ED\u0640]/g;

/** Arabic-Indic (٠-٩) and Extended Arabic-Indic (۰-۹) digits. */
const AR_DIGITS = /[\u0660-\u0669\u06F0-\u06F9]/g;

/** Strip a UTF-8 BOM and normalise line endings without touching content. */
export function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/**
 * The value we STORE: trimmed of surrounding whitespace and invisible control
 * characters only. Interior Arabic text — including diacritics — is preserved
 * byte-for-byte.
 */
export function cleanCell(v: unknown): string {
  if (v == null) return "";
  return String(v).replace(INVISIBLE, "").replace(/\r\n?/g, "\n").trim();
}

/** True when a cell carries no meaningful content. */
export function isBlank(v: unknown): boolean {
  return cleanCell(v) === "";
}

/**
 * Convert Arabic-Indic digits to ASCII. Used ONLY when a value is about to be
 * interpreted as a number or a date — never on free text that gets stored.
 */
export function toAsciiDigits(s: string): string {
  return s
    .replace(AR_DIGITS, (d) => {
      const c = d.charCodeAt(0);
      const base = c >= 0x06f0 ? 0x06f0 : 0x0660;
      return String(c - base);
    })
    .replace(/[٫٬]/g, (d) => (d === "٫" ? "." : ","));
}

/**
 * Comparison form for header/synonym matching and for key slugs.
 * Unifies the letter shapes that the same Arabic word is legitimately written
 * with (أ/إ/آ→ا, ى→ي, ه/ة kept DISTINCT on purpose: they change meaning), drops
 * diacritics/tatweel, lowercases Latin, and collapses whitespace.
 */
export function normalizeForMatch(s: string): string {
  return cleanCell(s)
    .normalize("NFC")
    .replace(DIACRITICS, "")
    .replace(/[أإآٱ]/g, "ا") // أ إ آ ٱ → ا
    .replace(/ى/g, "ي") // ى → ي
    .replace(/ی/g, "ي") // ی (farsi yeh) → ي
    .replace(/ک/g, "ك") // ک (farsi kaf) → ك
    .toLowerCase()
    .replace(/[\s\u00A0\u2000-\u200A]+/g, " ")
    .trim();
}

/** Header keys additionally drop punctuation so "نوع المحتوى:" == "نوع المحتوى". */
export function headerKey(s: string): string {
  return normalizeForMatch(s)
    .replace(/[()\[\]{}«».,;:!؟?"'`ـ_/\\|*#-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// (explicit ranges instead of \p{L}: the repo compiles to ES5, where the /u flag is unavailable)
const SLUG_DROP = /[^0-9A-Za-z\u0621-\u063A\u0641-\u064A\u0660-\u0669\u0671-\u06D3\u06F0-\u06F9]+/g;

/**
 * Deterministic, human-readable slug used inside external keys.
 * Arabic letters are KEPT (no transliteration — transliteration is lossy and
 * two different Arabic titles can collide). Long slugs are truncated with a
 * stable suffix supplied by the caller so the result stays unique.
 */
export function slugify(s: string, maxLen: number = 48): string {
  const base = normalizeForMatch(s).replace(SLUG_DROP, "-").replace(/^-+|-+$/g, "");
  if (base === "") return "";
  if (base.length <= maxLen) return base;
  return base.slice(0, maxLen).replace(/-+$/, "");
}

/** Split a multi-value cell (platforms, tags…) on the separators Excel users type. */
export function splitMulti(v: unknown): string[] {
  const s = cleanCell(v);
  if (s === "") return [];
  // NOTE: we deliberately do NOT split on the Arabic conjunction "و" — it is a
  // letter inside ordinary words and splitting on it corrupts real values.
  // REAL-FILE CASE: Arabic sheets are typed in Word-autocorrected editors, so the
  // SAME sheet writes one separator three ways — "أ + ب", "أ - ب" and "أ – ب"
  // (en dash). Splitting only on the ASCII hyphen made "إنستقرام – إكس" a single
  // platform while "المعرض + جميع المنصات" split into two. The dash class below
  // covers hyphen, en dash and em dash; still SPACED only, because an unspaced
  // dash is part of a real name.
  const parts = s.split(/[،؛,;/|\n\r\t]+|\s\+\s|\s[-–—]\s/g);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    const t = cleanCell(p).replace(/^[-•*·]+/, "").trim();
    if (t === "") continue;
    const k = normalizeForMatch(t);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

/** UTF-8 bytes of a string (TextEncoder exists in Node ≥18 and every browser). */
export function utf8Bytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/** Decode UTF-8 bytes, tolerating a BOM. Never produces mojibake for Arabic. */
export function utf8Decode(bytes: Uint8Array): string {
  return stripBom(new TextDecoder("utf-8").decode(bytes));
}
