// ════════════════════════════════════════════════════════════════════════════
// content/nap.ts — Name, Address, Phone. ONE source.
//
// Wave 2 · V2-2.5-B  (MASTER_BRIEF_v2.1.md §4 WAVE 2)
//
// ★ THE PROBLEM THIS FIXES ★
// The same contact details were hardcoded in at least four places —
// components/Footer.tsx, components/Contact.tsx, lib/structuredData.ts and the
// WhatsApp deep links — and they had already drifted: the footer showed
// info@ only, while the contact section showed info@ AND sales@. The external
// audit flagged exactly that.
//
// NAP consistency is not cosmetic for a local business. Search engines
// corroborate a business across sources, and a phone or address that differs
// between the footer, the schema and a directory listing weakens every one of
// them. Four copies means the next edit fixes three of them.
//
// ⚠️ WHICH ADDRESS IS CANONICAL IS KHALED'S CALL (V2-2.5-A, still open).
// So this file does NOT pick one. It records the CURRENT state exactly —
// info@ as the primary, sales@ as a secondary shown on the contact section —
// so today's rendered output is unchanged. When Khaled decides, one constant
// moves and every surface follows. Logged in OVERNIGHT_DECISIONS_REQUIRED.md.
//
// ⛔ Nothing here is a secret: every value below is already published on the
// live site. The commercial-registration and VAT numbers are NOT here — this
// module reaches the browser bundle, and they are unverified. See
// content/registration.ts.
// ════════════════════════════════════════════════════════════════════════════

export const NAP = {
  /** Legal and trading names. */
  nameEn: "Kian Media Production",
  nameAr: "كيان الابتكار للإنتاج الفني",

  /** Headquarters. components/Contact.tsx establishes exactly one. */
  address: {
    cityAr: "الدمام",
    cityEn: "Dammam",
    regionAr: "المنطقة الشرقية",
    regionEn: "Eastern Province",
    countryCode: "SA",
    countryAr: "المملكة العربية السعودية",
    countryEn: "Saudi Arabia",
  },

  /**
   * Phones in E.164. `display` is the local form already shown in the footer.
   * Both numbers are published on the live site — the second one was added by
   * the change the external audit confirmed as LIVE.
   */
  phones: [
    { e164: "+966503422999", display: "0503422999", primary: true },
    { e164: "+966543553038", display: "0543553038", primary: false },
  ],

  /**
   * ⚠️ TWO addresses on purpose, pending V2-2.5-A.
   * `primary` is what the footer and the schema use — it is the one address
   * that already appeared on BOTH surfaces, so choosing it changes nothing.
   * `sales` is kept because the contact section already lists it; removing it
   * would be a content decision, not a refactor.
   */
  email: {
    primary: "info@kianmedia.com",
    sales: "sales@kianmedia.com",
  },

  /** Working days/hours, exactly as components/Contact.tsx states them. */
  hours: {
    daysAr: "طوال أيام الأسبوع",
    daysEn: "All week",
    displayAr: "من ٧:٠٠ ص إلى ١١:٤٥ م",
    displayEn: "7:00 AM – 11:45 PM",
    /** 24-hour form for schema.org. */
    opens: "07:00",
    closes: "23:45",
  },

} as const;

/**
 * ⛔ The commercial-registration and VAT numbers are deliberately NOT here.
 * This module is imported by components/Footer.tsx and components/Contact.tsx,
 * both `"use client"` — anything in it ships to the browser. The identifiers
 * are unverified, so they live in content/registration.ts, which only a Server
 * Component imports. See that file's header for the leak this fixed.
 */

/** The primary number, for the one-tap call and WhatsApp links. */
export const primaryPhone = NAP.phones.find((p) => p.primary) ?? NAP.phones[0];

/** WhatsApp deep link, built from the single source rather than a literal. */
export const waLink = (text: string): string =>
  `https://wa.me/${primaryPhone.e164.replace("+", "")}?text=${encodeURIComponent(text)}`;

/** "Dammam, Eastern Province, Saudi Arabia" — one formatting, both locales. */
export const formattedAddress = (locale: "ar" | "en" = "ar"): string =>
  locale === "ar"
    ? `${NAP.address.cityAr}، ${NAP.address.regionAr}، ${NAP.address.countryAr}`
    : `${NAP.address.cityEn}, ${NAP.address.regionEn}, ${NAP.address.countryEn}`;
