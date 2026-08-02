// ════════════════════════════════════════════════════════════════════════════
// lib/consent.ts — ONE source of truth for privacy consent on public forms.
//
// Wave 0 · V2-0.1-A…G  (MASTER_BRIEF_v2.1.md §4 WAVE 0)
//
// WHY THIS FILE EXISTS
// ────────────────────
// Before Wave 0 the site carried an IMPLIED-consent sentence under the main
// contact form (components/Contact.tsx) and nothing at all on the other three.
// An implied sentence is not consent: nothing is recorded, so there is no way to
// answer "did this person agree, when, and to which wording?" months later.
//
// Four forms needed the same control, which is exactly how four slightly
// different implementations get written. G13 (existing-domain-first) says one
// domain gets one source, so the label, the version and the flag live here and
// every form imports them. There is no second place to change the wording.
//
// VERSIONING — the part that is easy to get wrong
// ───────────────────────────────────────────────
// Consent is only meaningful if you can prove WHAT was agreed to. Storing a bare
// boolean is worthless the first time the wording changes: every historical row
// silently starts claiming agreement to text the person never saw. So the stored
// record carries CONSENT_VERSION, and the rule is:
//
//   ⚠️ CHANGING THE LABEL TEXT REQUIRES BUMPING CONSENT_VERSION.
//      Never edit the wording in place. A test pins this pair together.
//
// FLAG — default OFF (G6)
// ───────────────────────
// NEXT_PUBLIC_CONSENT_CHECKBOX_ENABLED gates the whole capability. With it unset
// or "false" the four forms render and behave EXACTLY as they do today — the
// checkbox is not rendered, submission is not gated, and no consent leg is sent.
// That is the G6 contract: with the flag off, the current experience is unchanged.
//
// Turn it on only AFTER docs/consent_capture_EXTENSION_RUNME.sql is applied.
// See docs/FEATURE_FLAG_REGISTRY.md for owner, activation and rollback steps.
// ════════════════════════════════════════════════════════════════════════════

/**
 * Bump this whenever CONSENT_LABEL changes, in the same commit.
 * Stored alongside every consent row so an old row never claims agreement to
 * wording that did not exist when it was captured.
 */
export const CONSENT_VERSION = "2026-08-02.v1";

/** The privacy policy the label links to. The page already exists. */
export const PRIVACY_PATH = "/privacy-policy";

/**
 * The exact wording required by MASTER_BRIEF_v2.1.md §4 WAVE 0 (V2-0.1-G).
 * The Arabic text is normative — it is what the visitor agrees to.
 */
export const CONSENT_LABEL = {
  ar: "أوافق على سياسة الخصوصية وعلى تواصل كيان معي بخصوص طلبي",
  en: "I agree to the privacy policy and to Kian contacting me about my request",
} as const;

/** Link text inside the label, so the policy is one click away. */
export const CONSENT_LINK_TEXT = {
  ar: "سياسة الخصوصية",
  en: "privacy policy",
} as const;

/** Shown when a visitor submits without ticking the box. */
export const CONSENT_REQUIRED_MESSAGE = {
  ar: "الرجاء الموافقة على سياسة الخصوصية للمتابعة",
  en: "Please agree to the privacy policy to continue",
} as const;

/**
 * Is the consent capability switched on?
 *
 * Read through a function rather than exported as a constant so the value is
 * resolved at call time. `process.env.NEXT_PUBLIC_*` is inlined at build time by
 * Next, so the whole branch is statically eliminated when the flag is off.
 */
export function consentEnabled(): boolean {
  return process.env.NEXT_PUBLIC_CONSENT_CHECKBOX_ENABLED === "true";
}

/** What a form sends once the visitor has ticked the box. */
export interface ConsentPayload {
  consent_given: true;
  /** ISO-8601 UTC, captured in the browser at the moment of submission. */
  consent_at: string;
  consent_version: string;
}

/**
 * Build the payload for a granted consent. Returns null when the flag is off or
 * the box was not ticked, so callers can spread it unconditionally:
 *
 *     const consent = consentPayload(agreed);
 *     captureIntake({ ...fields, ...(consent ?? {}) });
 *
 * Deliberately returns null rather than `{ consent_given: false }`: a row that
 * records "consent refused" would be a claim we cannot support, because a form
 * submitted with the flag off carries no consent decision at all — it is absence
 * of data, not a recorded "no".
 */
export function consentPayload(agreed: boolean): ConsentPayload | null {
  if (!consentEnabled() || !agreed) return null;
  return {
    consent_given: true,
    consent_at: new Date().toISOString(),
    consent_version: CONSENT_VERSION,
  };
}

/**
 * Should submission be blocked? True only when the capability is on and the box
 * is unticked. With the flag off this is always false, so the existing forms
 * keep submitting exactly as before.
 */
export function consentBlocksSubmit(agreed: boolean): boolean {
  return consentEnabled() && !agreed;
}
