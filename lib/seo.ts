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

export interface RouteSeo {
  /** Absolute path, leading slash, no trailing slash. "/" for the homepage. */
  path: string;
  title: string;
  description: string;
  /** Omit from search results — for utility pages with no standalone value. */
  noindex?: boolean;
}

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
export function routeMetadata(seo: RouteSeo): Metadata {
  const url = canonicalFor(seo.path);
  return {
    title: seo.title,
    description: seo.description,
    alternates: { canonical: url },
    openGraph: {
      title: seo.title,
      description: seo.description,
      url,
      type: "website",
      locale: "ar_SA",
      siteName: "Kian Media",
    },
    twitter: {
      card: "summary_large_image",
      title: seo.title,
      description: seo.description,
    },
    ...(seo.noindex ? { robots: { index: false, follow: true } } : {}),
  };
}

// ─── The public routes and their copy ───────────────────────────────────────
// Arabic-first: the site is Arabic-first RTL (G10), and these strings are what a
// search engine shows. Each title is distinct — nine pages sharing one title is
// the same defect as nine pages sharing one canonical.

export const ROUTE_SEO: Record<string, RouteSeo> = {
  "quote-request": {
    path: "/quote-request",
    title: "اطلب عرض سعر | كيان ميديا للإنتاج الفني",
    description:
      "اطلب عرض سعر لمشروع إنتاج فيديو: أفلام مؤسسية، إعلانات، تصوير جوي بالدرون، بث مباشر، تغطية فعاليات. رد خلال ٢٤ ساعة.",
  },
  "book-meeting": {
    path: "/book-meeting",
    title: "احجز موعدًا | كيان ميديا للإنتاج الفني",
    description:
      "احجز اجتماعًا مع فريق كيان ميديا لمناقشة مشروعك — حضوريًا أو عن بُعد، في الوقت الذي يناسبك.",
  },
  "upload-files": {
    path: "/upload-files",
    title: "أرسل ملفات مشروعك | كيان ميديا",
    description:
      "شارك روابط ملفات مشروعك بسهولة عبر Google Drive أو WeTransfer أو Dropbox ليصل فريق الإنتاج إليها مباشرة.",
  },
  opportunities: {
    path: "/opportunities",
    title: "الفرص والتوظيف | كيان ميديا للإنتاج الفني",
    description:
      "انضم إلى شبكة كيان ميديا — فرص للمصورين والمونتيرين وفرق الإنتاج والمستقلين في المملكة العربية السعودية.",
  },
  "privacy-policy": {
    path: "/privacy-policy",
    title: "سياسة الخصوصية | كيان ميديا",
    description:
      "كيف تجمع كيان ميديا بياناتك وتستخدمها وتحميها، وحقوقك في الوصول إليها وتصحيحها وحذفها.",
  },
  terms: {
    path: "/terms",
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
export const seoFor = (key: keyof typeof ROUTE_SEO): Metadata =>
  routeMetadata(ROUTE_SEO[key]);
