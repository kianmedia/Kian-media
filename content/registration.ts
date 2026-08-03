// ════════════════════════════════════════════════════════════════════════════
// content/registration.ts — legal identifiers. SERVER-ONLY, BY CONSTRUCTION.
//
// Wave 2 release hardening
//
// ★ WHY THIS IS NOT IN content/nap.ts ★
// It was, and that was a leak. content/nap.ts is imported by components/
// Footer.tsx and components/Contact.tsx, both `"use client"` — so the whole
// object, `registration` included, was bundled into a browser chunk that the
// HOMEPAGE downloads. The numbers were shipping to every visitor while the
// /trust page that was supposed to gate them had not even been enabled.
//
// Verified in the build output: .next/static/chunks/8911-*.js contained both
// identifiers, loaded by /(ar)/page among eighteen others.
//
// Gating the RENDER does not fix that. A `verified &&` check decides what the
// HTML shows; it does nothing about what the JavaScript bundle contains. The
// only reliable fix is that the values are never reachable from a client
// module — which is what this file is for. Its single consumer is
// components/TrustPage.tsx, a Server Component.
//
// tests/trust_release_gate_phase2.test.js greps the built client chunks for
// these literals, so a future import from a `"use client"` file fails the suite
// rather than quietly re-shipping them.
// ════════════════════════════════════════════════════════════════════════════

/**
 * 🔴 THE GATE. Status: **PENDING OFFICIAL DOCUMENT VERIFICATION**.
 *
 * Declared as a plain `boolean` rather than being inferred: as a literal `false`
 * TypeScript treats every `=== true` as unreachable, which would turn flipping
 * this into a type error instead of a one-word change.
 *
 * Flip to true ONLY after the numbers below have been compared against the
 * actual commercial-registration and VAT certificates. Their presence in
 * MASTER_BRIEF_v2.1.md is not verification — a number written in a brief is a
 * number someone typed.
 */
const REGISTRATION_VERIFIED: boolean = false;

/**
 * Carried from MASTER_BRIEF_v2.1.md §4 WAVE 2. Stored, not published.
 *
 * On a procurement page a wrong CR or VAT is worse than none: it is a
 * misrepresentation of legal identity that a buyer may act on.
 */
export const REGISTRATION = {
  commercialRegistration: "1009179096",
  vat: "311047382900003",
} as const;

/**
 * May the identifiers be shown?
 *
 * An explicit flag, not a truthiness check on the strings — "the number exists"
 * and "the number is confirmed correct" are different claims, and only the
 * second one may reach a buyer.
 */
export const registrationVerified = (): boolean => REGISTRATION_VERIFIED;
