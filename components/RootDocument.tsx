// ════════════════════════════════════════════════════════════════════════════
// components/RootDocument.tsx — the ONE HTML document shell.
//
// Wave 1 · V2-1.1 (D-3) — server-rendered <html lang|dir>.
//
// ★ WHY THIS FILE EXISTS ★
// Next renders exactly one <html>, from the root layout. To emit
// lang="en" dir="ltr" for /en and lang="ar" dir="rtl" for the Arabic tree, the
// two trees need SEPARATE root layouts — and Next only allows that when the
// top-level app/layout.tsx is removed and every page route sits inside a route
// group that has its own root layout.
//
// Three root layouts now exist: app/(ar), app/(en) and app/(portal). Without
// this component each would carry its own copy of the head, the fonts, the
// analytics snippet, the JSON-LD and the PWA provider — three copies that would
// drift. They all render this instead, and differ only in `lang`/`dir` and their
// own `metadata` export.
//
// ⚠️ The previous approach (an inline script that corrected documentElement
// after parse) was rejected: it left the FIRST HTML tagged Arabic for an English
// page, which is what a JS-less crawler reads. This is server-rendered, so the
// attribute is correct in the very first byte and no script is involved.
// ════════════════════════════════════════════════════════════════════════════
import Script from "next/script";
import PwaProvider from "@/components/pwa/PwaProvider";

const GA_ID = "G-2XZ60NZSSV";
const SITE = "https://kianmedia.com";


// ─── Structured data: LocalBusiness + Organization ──────────────────────────
const businessSchema = {
  "@context": "https://schema.org",
  "@type": "ProfessionalService",
  "@id": SITE,
  name: "Kian Media Production",
  alternateName: "كيان الابتكار للإنتاج الفني",
  description: "Premium cinematic video production, drone filming, live streaming, event coverage, corporate films, commercials, and wedding films across Saudi Arabia.",
  url: SITE,
  logo: `${SITE}/logo.png`,
  image: `${SITE}/logo.png`,
  telephone: "+966503422999",
  priceRange: "$$$",
  areaServed: [
    { "@type": "Country", name: "Saudi Arabia" },
    { "@type": "City", name: "Dammam" },
    { "@type": "City", name: "Riyadh" },
    { "@type": "City", name: "Jeddah" },
    { "@type": "City", name: "Madinah" },
  ],
  address: {
    "@type": "PostalAddress",
    addressRegion: "Eastern Province",
    addressLocality: "Dammam",
    addressCountry: "SA",
  },
  sameAs: [
    "https://www.youtube.com/@kianalebtikar",
    "https://www.instagram.com/kian.alebtikar",
    "https://www.tiktok.com/@kianmedia1",
    "https://www.snapchat.com/add/kianmedia",
    "https://www.linkedin.com/company/kian-media-production",
  ],
  openingHoursSpecification: {
    "@type": "OpeningHoursSpecification",
    dayOfWeek: ["Saturday","Sunday","Monday","Tuesday","Wednesday","Thursday","Friday"],
    opens: "07:00",
    closes: "23:45",
  },
  makesOffer: [
    { "@type": "Offer", itemOffered: { "@type": "Service", name: "Cinematic Production" } },
    { "@type": "Offer", itemOffered: { "@type": "Service", name: "Corporate Films" } },
    { "@type": "Offer", itemOffered: { "@type": "Service", name: "Commercial Advertisements" } },
    { "@type": "Offer", itemOffered: { "@type": "Service", name: "Documentary Films" } },
    { "@type": "Offer", itemOffered: { "@type": "Service", name: "Drone Cinematography" } },
    { "@type": "Offer", itemOffered: { "@type": "Service", name: "Event Coverage" } },
    { "@type": "Offer", itemOffered: { "@type": "Service", name: "Live Streaming" } },
    { "@type": "Offer", itemOffered: { "@type": "Service", name: "Luxury Wedding Cinematography" } },
  ],
};

// Featured showreel as a VideoObject (helps Google show video rich results)
const videoSchema = {
  "@context": "https://schema.org",
  "@type": "VideoObject",
  name: "Kian Media — Official Showreel",
  description: "A cinematic glimpse of Kian Media's production work across Saudi Arabia.",
  thumbnailUrl: "https://img.youtube.com/vi/JN5MRQuEP4M/maxresdefault.jpg",
  uploadDate: "2026-01-01",
  contentUrl: "https://www.youtube.com/watch?v=JN5MRQuEP4M",
  embedUrl: "https://www.youtube.com/embed/JN5MRQuEP4M",
  publisher: {
    "@type": "Organization",
    name: "Kian Media Production",
    logo: { "@type": "ImageObject", url: `${SITE}/logo.png` },
  },
};

export default function RootDocument({
  lang,
  dir,
  children,
}: {
  lang: "ar" | "en";
  dir: "rtl" | "ltr";
  children: React.ReactNode;
}) {
  return (
    <html lang={lang} dir={dir}>
      {/* eslint-disable-next-line @next/next/no-head-element --
          The rule assumes <head> only ever appears in app/layout.tsx. This file
          IS the document shell for the three root layouts created in D-3
          ((ar), (en), (portal)) — extracted precisely so the head, fonts,
          analytics and JSON-LD exist once instead of in three copies that would
          drift. Moving <head> back into the layouts would trade one lint
          warning for three divergent copies of the document. */}
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* Preconnect to YouTube thumbnail host for faster portfolio image loads */}
        <link rel="preconnect" href="https://img.youtube.com" />
        <link rel="dns-prefetch" href="https://img.youtube.com" />
        {/* D-14 — Tajawal STAYS. Khaled declined the Almarai swap for Wave 1:
            changing the Arabic face is a design change (G11), not an
            optimisation, and display=swap was already in place.

            What was optimised is the WEIGHT LIST — conservatively. Only two
            weights were dropped, both provably unused: Tajawal 900 and Inter
            Tight 200. Cormorant was left INTACT: a first pass trimmed it too,
            until a grep showed weight 700 used 74 times and 600 used 105 times
            across the codebase. Proving which of those land on the serif rather
            than the sans is not something to guess at, and a silently
            synthesised bold is a visible design regression — so the serif keeps
            every weight it had. `display=swap` is unchanged, so text is
            never invisible while a face loads. */}
        <link
          href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400;1,500&family=Inter+Tight:wght@300;400;500;600;700&family=Tajawal:wght@300;400;500;700;800&display=swap"
          rel="stylesheet"
        />
        <meta name="theme-color" content="#000000" />
        <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />

        {/* Structured data — invisible to visitors, read by Google */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(businessSchema) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(videoSchema) }}
        />
      </head>
      <body style={{ background: "#050505", color: "#fff" }}>
        {/* Google Analytics 4 — gtag.js (App Router via next/script) */}
        <Script
          src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
          strategy="afterInteractive"
        />
        <Script id="ga4-init" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', '${GA_ID}');
          `}
        </Script>
        {children}

        {/* PWA runtime: registration, update indicator, offline notice, install
            prompt. Mounted last and rendering only fixed overlays, so it cannot
            shift or intercept any existing page content. */}
        <PwaProvider />
      </body>
    </html>
  );
}
