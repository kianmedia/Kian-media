import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

const GA_ID = "G-2XZ60NZSSV";
const SITE = "https://kianmedia.com";

export const metadata: Metadata = {
  title: "Kian Media Production | Cinematic Video Production in Saudi Arabia",
  description:
    "Premium cinematic video production, drone filming, live streaming, event coverage, corporate films, commercials, and wedding films in Saudi Arabia.",
  keywords: [
    "Saudi video production","Dammam media production","drone filming Saudi Arabia",
    "corporate video production","live streaming Saudi Arabia","event coverage",
    "wedding videography","كيان الابتكار","إنتاج إعلامي السعودية","تصوير سينمائي",
    "تصوير جوي بالدرون","بث مباشر","Kian Media","إنتاج فيديوهات الشركات",
  ],
  metadataBase: new URL(SITE),
  openGraph: {
    title: "Kian Media Production | Cinematic Video Production in Saudi Arabia",
    description: "Premium cinematic video production, drone filming, live streaming, event coverage, corporate films, commercials, and wedding films in Saudi Arabia.",
    type: "website",
    url: SITE,
    locale: "ar_SA",
    siteName: "Kian Media",
    images: [
      {
        url: "/logo.png",
        width: 800,
        height: 800,
        alt: "Kian Media Production",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    site: "@kianalebtikar",
    title: "Kian Media Production",
    description: "Cinematic video production in Saudi Arabia.",
    images: ["/logo.png"],
  },
  robots: { index: true, follow: true },
  alternates: { canonical: SITE },
  formatDetection: { telephone: true },
};

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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* Preconnect to YouTube thumbnail host for faster portfolio image loads */}
        <link rel="preconnect" href="https://img.youtube.com" />
        <link rel="dns-prefetch" href="https://img.youtube.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400;1,500&family=Inter+Tight:wght@200;300;400;500;600;700&family=Tajawal:wght@300;400;500;700;800;900&display=swap"
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
      </body>
    </html>
  );
}
