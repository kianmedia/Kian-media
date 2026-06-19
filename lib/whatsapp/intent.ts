// ════════════════════════════════════════════════════════════════════════
// Kian — rule-based intent detection for WhatsApp (NO AI). Used to auto-offer a
// quote-request link when a customer asks about price/cost/quote.
// ════════════════════════════════════════════════════════════════════════

// Arabic + English price/quote/cost keywords. Order matters only for which
// keyword is reported as the trigger (first match wins).
const PRICE_KEYWORDS: string[] = [
  "كم التكلفة", "كم تكلفة", "عرض سعر", "طلب عرض", "كم السعر", "بكم", "السعر", "تكلفة", "باقة", "باقات", "اسعار", "أسعار",
  "pricing", "price", "quote", "cost", "how much",
];

/** Returns the matched keyword if the text expresses a price/quote intent, else null.
 *  Arabic-aware: strips tatweel + common diacritics so "السِّعر" matches "السعر". */
export function detectPriceIntent(text: string | null | undefined): string | null {
  if (!text) return null;
  const norm = text
    .replace(/[ـ]/g, "")               // tatweel
    .replace(/[ً-ْ]/g, "")        // harakat
    .toLowerCase();
  for (const kw of PRICE_KEYWORDS) {
    if (norm.includes(kw.toLowerCase())) return kw;
  }
  return null;
}
