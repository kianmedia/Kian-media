// ════════════════════════════════════════════════════════════════════════════
// lib/structuredData.ts — JSON-LD builders that refuse to invent.
//
// Wave 1 · V2-1.7 / V2-1.11  (MASTER_BRIEF_v2.1.md §4 WAVE 1)
//
// ★ THE RULE THIS FILE ENFORCES ★
// A schema field is emitted ONLY when a real value backs it. Nothing is padded
// to make a validator happy. Structured data is a statement to a search engine
// about facts; a placeholder in it is not a formatting shortcut, it is a false
// statement that can cost the domain its rich results.
//
// 🔴 THIS IS NOT HYPOTHETICAL HERE. The previous root layout shipped a
// VideoObject for the showreel carrying `uploadDate: "2026-01-01"` — a date
// nobody knows to be true, invented so the schema would validate. It has been
// removed, and videoObjectJsonLd() below returns null rather than reproduce it.
//
// ★ WHY MOST WORKS ARE NOT ELIGIBLE FOR VideoObject ★
// Google requires name, description, thumbnailUrl AND uploadDate. content/
// portfolio.ts has the first three for all 46 works — but NO upload date for any
// of them, because the repository does not record one. So no work qualifies
// today. They are reported as ineligible rather than published with a guess.
// Adding a real `uploadDate` per work makes them eligible with no code change.
// ════════════════════════════════════════════════════════════════════════════

import { SITE_URL } from "@/lib/site";
import type { SeoPage } from "@/content/seo-pages";
import type { Work } from "@/content/portfolio";
import { NAP, primaryPhone } from "@/content/nap";
import { thumb, watchUrl, embedUrl } from "@/content/portfolio";

const abs = (p: string) => `${SITE_URL}${p === "/" ? "" : p}`;

// ─── LocalBusiness ──────────────────────────────────────────────────────────
//
// Every field below is already published elsewhere in this repository
// (components/Contact.tsx and components/Footer.tsx). Nothing new is asserted:
// no rating, no review count, no price range, no employee count, no awards.

export function localBusinessJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "ProfessionalService",
    "@id": `${SITE_URL}#business`,
    name: NAP.nameEn,
    alternateName: NAP.nameAr,
    url: SITE_URL,
    image: `${SITE_URL}/og-default.svg`,
    address: {
      "@type": "PostalAddress",
      addressLocality: NAP.address.cityEn,
      addressRegion: NAP.address.regionEn,
      addressCountry: NAP.address.countryCode,
    },
    areaServed: { "@type": "Country", name: "Saudi Arabia" },
    // Both published on the contact page. Not secrets. Read from content/nap.ts
    // so the schema can never drift from the footer (V2-2.5-B).
    telephone: primaryPhone.e164,
    email: NAP.email.primary,
    // Published on components/Contact.tsx: all week, 07:00–23:45.
    openingHoursSpecification: {
      "@type": "OpeningHoursSpecification",
      dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
      opens: NAP.hours.opens,
      closes: NAP.hours.closes,
    },
  };
}

// ─── BreadcrumbList ─────────────────────────────────────────────────────────

interface Crumb { name: string; path: string }

/** Generic builder — positions are 1-based, as the spec requires. */
export function breadcrumbListJsonLd(crumbs: Crumb[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      item: abs(c.path),
    })),
  };
}

/** Breadcrumb for an SEO landing page, mirroring the visible trail exactly. */
export function breadcrumbJsonLd(page: SeoPage, locale: "ar" | "en") {
  const ar = locale === "ar";
  const home = ar ? "/" : "/en";
  const sectionPath = page.kind === "service"
    ? (ar ? "/services" : "/en/services")
    : (ar ? "/cities" : "/en/cities");
  const sectionName = page.kind === "service"
    ? (ar ? "الخدمات" : "Services")
    : (ar ? "المدن" : "Cities");
  const leafPath = `${sectionPath}/${page.slug}`;

  return breadcrumbListJsonLd([
    { name: ar ? "الرئيسية" : "Home", path: home },
    { name: sectionName, path: sectionPath },
    { name: ar ? page.h1Ar : page.h1En, path: leafPath },
  ]);
}

// ─── VideoObject ────────────────────────────────────────────────────────────

/**
 * What a work must have before a VideoObject may be emitted for it.
 *
 * `uploadDate` is required by Google and is NOT derivable from a YouTube id
 * without calling the API — which this build does not do. So the gate below is
 * the honest one, and it currently excludes every work.
 */
export interface VideoFacts {
  /** ISO-8601 date the video was published. MUST be real. */
  uploadDate?: string;
  /** ISO-8601 duration, e.g. "PT2M31S". Optional, but never guessed. */
  duration?: string;
}

/** True only when a work carries every field a valid VideoObject needs. */
export function isVideoEligible(work: Work, facts?: VideoFacts): boolean {
  return Boolean(
    work.yt &&
    (work.ar || work.en) &&
    (work.dAr || work.dEn) &&
    facts?.uploadDate,
  );
}

/**
 * VideoObject for a work, or **null** when the facts are not there.
 *
 * Returning null is the point. A caller that spreads a null into a <script> tag
 * emits nothing, which is exactly right: no schema beats an invented one.
 */
export function videoObjectJsonLd(
  work: Work,
  locale: "ar" | "en" = "ar",
  facts?: VideoFacts,
): Record<string, unknown> | null {
  if (!isVideoEligible(work, facts)) return null;

  const ar = locale === "ar";
  return {
    "@context": "https://schema.org",
    "@type": "VideoObject",
    name: (ar ? work.ar : work.en) || work.ar,
    description: (ar ? work.dAr : work.dEn) || work.dAr,
    // Derived from the YouTube id — a real URL, not a placeholder.
    thumbnailUrl: thumb(work.yt, "maxres"),
    contentUrl: watchUrl(work.yt),
    embedUrl: embedUrl(work.yt),
    uploadDate: facts!.uploadDate,
    ...(facts?.duration ? { duration: facts.duration } : {}),
    publisher: {
      "@type": "Organization",
      name: "Kian Media Production",
      logo: { "@type": "ImageObject", url: `${SITE_URL}/logo.png` },
    },
  };
}

/**
 * Works that cannot carry a VideoObject yet, and why.
 * Consumed by the Wave 1 report so the gap is stated rather than silent.
 */
export function ineligibleVideos(works: Work[]): { id: number; missing: string[] }[] {
  return works
    .map((w) => {
      const missing: string[] = [];
      if (!w.yt) missing.push("yt");
      if (!w.ar && !w.en) missing.push("name");
      if (!w.dAr && !w.dEn) missing.push("description");
      missing.push("uploadDate");   // never recorded for any work today
      return { id: w.id, missing };
    })
    .filter((r) => r.missing.length > 0);
}
