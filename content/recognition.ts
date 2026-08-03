// ════════════════════════════════════════════════════════════════════════════
// content/recognition.ts — press, awards and festival coverage.
//
// Wave 2 · V2-2.4-A
//
// 🔴 THE LIST IS EMPTY, ON PURPOSE.
// The brief asks for press/awards/festival slots on "لماذا كيان". The slots are
// built; the content is not, because this repository records NO award, NO press
// mention and NO festival credit that could be published without inventing one.
// An awards section is a credential claim — the one class of content where a
// plausible-looking placeholder is worst.
//
// The renderer returns null while the list is empty, so the section simply does
// not appear rather than showing an empty "Awards" heading, which would read as
// "this company has none".
//
// Filling this array is a content task for Khaled: each entry needs a real
// title, a real source and ideally a verifiable link.
// ════════════════════════════════════════════════════════════════════════════

export interface Recognition {
  id: string;
  /** e.g. "مهرجان أفلام السعودية" — the awarding or publishing body. */
  sourceAr: string;
  sourceEn: string;
  /** What it was for. */
  titleAr: string;
  titleEn: string;
  /** ISO year or date. MUST be real — never a placeholder. */
  year: string;
  /** Public URL corroborating it, when one exists. */
  url?: string;
}

/**
 * ⚠️ EMPTY BY DESIGN — see the header. Do not seed this with examples,
 * "coming soon" entries, or sample data: every consumer treats an entry here as
 * a published credential.
 */
export const RECOGNITION: Recognition[] = [];

export const hasRecognition = (): boolean => RECOGNITION.length > 0;
