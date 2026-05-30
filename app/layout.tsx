import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

const GA_ID = "G-2XZ60NZSSV";

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
  metadataBase: new URL("https://kianmedia.com"),
  openGraph: {
    title: "Kian Media Production | Cinematic Video Production in Saudi Arabia",
    description: "Premium cinematic video production, drone filming, live streaming, event coverage, corporate films, commercials, and wedding films in Saudi Arabia.",
    type: "website", url: "https://kianmedia.com", locale: "ar_SA", siteName: "Kian Media",
  },
  twitter: { card: "summary_large_image", site: "@kianalebtikar",
    title: "Kian Media Production", description: "Cinematic video production in Saudi Arabia." },
  robots: { index: true, follow: true },
  alternates: { canonical: "https://kianmedia.com" },
  formatDetection: { telephone: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400;1,500&family=Inter+Tight:wght@200;300;400;500;600;700&family=Tajawal:wght@300;400;500;700;800;900&display=swap"
          rel="stylesheet"
        />
        <meta name="theme-color" content="#000000" />
        <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
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
