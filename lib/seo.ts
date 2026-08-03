// ════════════════════════════════════════════════════════════════════════════
// lib/seo.ts — per-route metadata, from ONE builder.
//
// Wave 1 · V2-1.3-A  (MASTER_BRIEF_v2.1.md §4 WAVE 1)
//
// ★ THE BUG THIS FIXES ★
// app/layout.tsx declares `alternates: { canonical: SITE }` — a single, absolute
// canonical URL. In Next's App Router that value is INHERITED by every route that
// does not override it. So /quote-request, /terms, /privacy-policy and the rest
// all told crawlers "the canonical version of this page is the homepage".
//
// That is not a cosmetic SEO miss. A self-referencing canonical is how a search
// engine decides a URL deserves its own listing; pointing nine distinct pages at
// the homepage invites it to drop them from the index entirely.
//
// /case-studies already did this correctly with its own generateMetadata. This
// file generalises that existing, working pattern rather than inventing one —
// which is why the shape below mirrors app/case-studies/page.tsx.
//
// ★ WHY A BUILDER AND NOT NINE HAND-WRITTEN OBJECTS ★
// Nine copies drift. One builder means the canonical can never again be wrong in
// one place and right in another, and a test can assert every public route uses
// it. The per-route layouts that call it are three lines each.
//
// ⚠️ Every public page is a Client Component ("use client"), and a client
// component cannot export `metadata`. So each route gets a tiny sibling
// layout.tsx that exports metadata and renders {children}. That is the standard
// Next escape hatch and it touches none of the page logic.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from "next";
import { SITE_URL } from "@/lib/site";

/**
 * V2-1.3-B — the branded share card, 1200×630.
 *
 * A STATIC asset, not @vercel/og. Generating cards at request time adds a
 * dependency (G12) and a per-request cost for a picture that is identical on
 * every route; the square 800×800 logo it replaces was the actual defect,
 * because 1.91:1 is what every scraper crops to. Per-route generated cards stay
 * available as a later upgrade behind the same constant.
 */
export const OG_IMAGE = "/og-default.svg";

export type Locale = "ar" | "en";

export interface RouteSeo {
  /** Arabic (default-locale) path, leading slash, no trailing slash. "/" = home. */
  path: string;
  title: string;
  description: string;
  /** English copy. Present only for routes that have an /en mirror (V2-1.1). */
  titleEn?: string;
  descriptionEn?: string;
  /** Omit from search results — for utility pages with no standalone value. */
  noindex?: boolean;
}

/** "/terms" → "/en/terms"; "/" → "/en". Mirrors lib/i18n.ts withLocale(). */
export const localePath = (path: string, locale: Locale): string =>
  locale === "ar" ? path : path === "/" ? "/en" : `/en${path}`;

/** Absolute URL for a route path. The one place a canonical is assembled. */
export const canonicalFor = (path: string): string =>
  `${SITE_URL}${path === "/" ? "" : path}`;

/**
 * Build a route's Metadata.
 *
 * Deliberately sets `alternates.canonical` on EVERY route, including ones that
 * would otherwise look fine: relying on inheritance is exactly how the homepage
 * canonical leaked onto nine pages in the first place. Being explicit is the fix.
 *
 * openGraph.url is set alongside it so a share card and a crawler never disagree
 * about which URL the page is.
 */
export function routeMetadata(seo: RouteSeo, locale: Locale = "ar"): Metadata {
  const url = canonicalFor(localePath(seo.path, locale));
  const en = locale === "en";
  const title = en ? (seo.titleEn ?? seo.title) : seo.title;
  const description = en ? (seo.descriptionEn ?? seo.description) : seo.description;

  // hreflang. Emitted ONLY for routes that actually have an English mirror —
  // advertising an alternate that 404s is worse than advertising none, because
  // a crawler treats a broken alternate as a signal the whole cluster is wrong.
  const bilingual = Boolean(seo.titleEn);
  const languages = bilingual
    ? {
        ar: canonicalFor(seo.path),
        en: canonicalFor(localePath(seo.path, "en")),
        // Arabic is the default: it serves anyone whose language we do not target.
        "x-default": canonicalFor(seo.path),
      }
    : undefined;

  return {
    title,
    description,
    alternates: { canonical: url, ...(languages ? { languages } : {}) },
    openGraph: {
      title,
      description,
      url,
      type: "website",
      locale: en ? "en_US" : "ar_SA",
      ...(bilingual ? { alternateLocale: en ? ["ar_SA"] : ["en_US"] } : {}),
      siteName: "Kian Media",
      // V2-1.3-B — one branded 1200×630 card for every route. Absolute, because
      // a relative OG image is not resolved by most scrapers.
      images: [{ url: `${SITE_URL}${OG_IMAGE}`, width: 1200, height: 630, alt: "Kian Media Production" }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [`${SITE_URL}${OG_IMAGE}`],
    },
    ...(seo.noindex ? { robots: { index: false, follow: true } } : {}),
  };
}

// ─── The public routes and their copy ───────────────────────────────────────
// Arabic-first: the site is Arabic-first RTL (G10), and these strings are what a
// search engine shows. Each title is distinct — nine pages sharing one title is
// the same defect as nine pages sharing one canonical.

export const ROUTE_SEO: Record<string, RouteSeo> = {
  home: {
    path: "/",
    title: "كيان ميديا للإنتاج الفني | إنتاج فيديو سينمائي في السعودية",
    description:
      "إنتاج فيديو سينمائي احترافي في المملكة: أفلام مؤسسية، إعلانات تجارية، تصوير جوي بالدرون، بث مباشر، تغطية فعاليات، أفلام وثائقية وأعراس.",
    titleEn: "Kian Media Production | Cinematic Video Production in Saudi Arabia",
    descriptionEn:
      "Premium cinematic video production in Saudi Arabia: corporate films, commercials, aerial drone filming, live streaming, event coverage, documentaries and wedding films.",
  },
  "quote-request": {
    path: "/quote-request",
    titleEn: "Request a Quote | Kian Media Production",
    descriptionEn:
      "Request a quote for a video production project: corporate films, commercials, aerial drone filming, live streaming and event coverage. Reply within 24 hours.",
    title: "اطلب عرض سعر | كيان ميديا للإنتاج الفني",
    description:
      "اطلب عرض سعر لمشروع إنتاج فيديو: أفلام مؤسسية، إعلانات، تصوير جوي بالدرون، بث مباشر، تغطية فعاليات. رد خلال ٢٤ ساعة.",
  },
  "book-meeting": {
    path: "/book-meeting",
    titleEn: "Book a Meeting | Kian Media Production",
    descriptionEn:
      "Book a meeting with the Kian Media team to discuss your project — in person or remotely, at a time that suits you.",
    title: "احجز موعدًا | كيان ميديا للإنتاج الفني",
    description:
      "احجز اجتماعًا مع فريق كيان ميديا لمناقشة مشروعك — حضوريًا أو عن بُعد، في الوقت الذي يناسبك.",
  },
  "upload-files": {
    path: "/upload-files",
    titleEn: "Send Your Project Files | Kian Media",
    descriptionEn:
      "Share your project file links easily via Google Drive, WeTransfer or Dropbox so the production team can reach them directly.",
    title: "أرسل ملفات مشروعك | كيان ميديا",
    description:
      "شارك روابط ملفات مشروعك بسهولة عبر Google Drive أو WeTransfer أو Dropbox ليصل فريق الإنتاج إليها مباشرة.",
  },
  opportunities: {
    path: "/opportunities",
    titleEn: "Opportunities & Careers | Kian Media Production",
    descriptionEn:
      "Join the Kian Media network — opportunities for cinematographers, editors, production crews and freelancers across Saudi Arabia.",
    title: "الفرص والتوظيف | كيان ميديا للإنتاج الفني",
    description:
      "انضم إلى شبكة كيان ميديا — فرص للمصورين والمونتيرين وفرق الإنتاج والمستقلين في المملكة العربية السعودية.",
  },
  "privacy-policy": {
    path: "/privacy-policy",
    titleEn: "Privacy Policy | Kian Media",
    descriptionEn:
      "How Kian Media collects, uses and protects your data, and your rights to access, correct and delete it.",
    title: "سياسة الخصوصية | كيان ميديا",
    description:
      "كيف تجمع كيان ميديا بياناتك وتستخدمها وتحميها، وحقوقك في الوصول إليها وتصحيحها وحذفها.",
  },
  trust: {
    path: "/trust",
    title: "الثقة والامتثال | كيان ميديا",
    description:
      "أمن منصة كيان ميديا وحماية البيانات: عزل على مستوى الصف، تشفير، مصادقة ثنائية، صلاحيات مفصَّلة، والتزام بنظام حماية البيانات الشخصية.",
    titleEn: "Trust & Compliance | Kian Media",
    descriptionEn:
      "Kian Media platform security and data protection: row-level isolation, encryption, two-factor authentication, granular permissions, and a commitment to Saudi PDPL.",
  },
  terms: {
    path: "/terms",
    titleEn: "Terms of Use | Kian Media",
    descriptionEn:
      "The terms and conditions governing use of the Kian Media website and services, including liability limits and intellectual-property rights over published work.",
    title: "شروط الاستخدام | كيان ميديا",
    description:
      "الشروط والأحكام التي تحكم استخدام موقع كيان ميديا وخدماتها، وحدود المسؤولية وحقوق الملكية الفكرية للأعمال المنشورة.",
  },
  // ─── Utility pages: reachable by link, but with no standalone search value ──
  // noindex, follow — the page should not be listed, but links out of it still
  // pass. Both still get a self-referencing canonical: noindex governs listing,
  // canonical governs identity, and they are independent.
  "live-status": {
    path: "/live-status",
    title: "حالة البث المباشر | كيان ميديا",
    description:
      "صفحة متابعة حالة البث المباشر لفعالية جارية — الحالة الفنية والتحديثات لحظة بلحظة.",
    noindex: true,
  },
  "quick-access": {
    path: "/quick-access",
    title: "وصول سريع | كيان ميديا",
    description: "روابط سريعة لطلب عرض سعر أو حجز موعد أو إرسال ملفات المشروع.",
    noindex: true,
  },
  assistant: {
    path: "/assistant",
    title: "مساعد كيان | كيان ميديا",
    description: "مساعد كيان للإجابة عن الأسئلة الشائعة حول خدمات الإنتاج.",
    noindex: true,
  },
};

/** Convenience for a route layout: `export const metadata = seoFor("terms");` */
export const seoFor = (key: keyof typeof ROUTE_SEO, locale: Locale = "ar"): Metadata =>
  routeMetadata(ROUTE_SEO[key], locale);

/** Routes that have an /en mirror — the single list sitemap and tests read. */
export const BILINGUAL_ROUTES: string[] = Object.values(ROUTE_SEO)
  .filter((r) => Boolean(r.titleEn))
  .map((r) => r.path);
