// SEO landing route — city pages, en locale.  Wave 1 · V2-1.11
//
// 🔒 notFound() when SHOW_SEO_PAGES is off, so an inactive page is a real 404 and
// never a blank 200 a crawler could index. One renderer, one content layer:
// components/SeoLandingPage.tsx + content/seo-pages.ts.
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import SeoLandingPage from "@/components/SeoLandingPage";
import { seoPageBySlug, seoPagesOfKind, seoPagesEnabled, seoPagePath } from "@/content/seo-pages";
import { canonicalFor } from "@/lib/seo";

type Params = { params: { slug: string } };

// Prerender the known slugs only while the feature is on. With the flag off this
// returns [], so nothing is built and nothing can be reached.
export function generateStaticParams() {
  if (!seoPagesEnabled()) return [];
  return seoPagesOfKind("city").map((p) => ({ slug: p.slug }));
}

export function generateMetadata({ params }: Params): Metadata {
  const page = seoPageBySlug("city", params.slug);
  if (!page || !seoPagesEnabled()) return { robots: { index: false, follow: false } };
  const ar = false;   // this route is the English mirror
  return {
    title: ar ? page.titleAr : page.titleEn,
    description: ar ? page.descriptionAr : page.descriptionEn,
    alternates: {
      canonical: canonicalFor(seoPagePath(page, "en")),
      languages: {
        ar: canonicalFor(seoPagePath(page, "ar")),
        en: canonicalFor(seoPagePath(page, "en")),
        "x-default": canonicalFor(seoPagePath(page, "ar")),
      },
    },
    openGraph: {
      title: ar ? page.titleAr : page.titleEn,
      description: ar ? page.descriptionAr : page.descriptionEn,
      url: canonicalFor(seoPagePath(page, "en")),
      type: "website",
      locale: ar ? "ar_SA" : "en_US",
    },
  };
}

export default function Page({ params }: Params) {
  if (!seoPagesEnabled()) notFound();
  const page = seoPageBySlug("city", params.slug);
  if (!page) notFound();
  return <SeoLandingPage page={page} locale="en" />;
}
