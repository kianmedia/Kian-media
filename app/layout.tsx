import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "كيان الابتكار للإنتاج الفني | Kian Media Production",
  description:
    "شركة سعودية متخصصة في الإنتاج السينمائي، التصوير الجوي بالدرون، البث المباشر، والمونتاج الاحترافي في جميع مناطق المملكة.",
  keywords: [
    "كيان الابتكار","إنتاج فني","تصوير سينمائي","تصوير جوي","بث مباشر",
    "مونتاج احترافي","Kian Media","Saudi Arabia production","drone filming KSA",
  ],
  metadataBase: new URL("https://kianmedia.com"),
  openGraph: {
    title: "كيان الابتكار للإنتاج الفني | Kian Media",
    description: "Premium cinematic production in Saudi Arabia.",
    type: "website", url: "https://kianmedia.com", locale: "ar_SA",
  },
  twitter: { card: "summary_large_image", site: "@kianalebtikar" },
  robots: { index: true, follow: true },
  alternates: { canonical: "https://kianmedia.com" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Montserrat:ital,wght@0,200;0,300;0,400;0,600;0,700;0,900;1,300;1,400&family=Noto+Naskh+Arabic:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <meta name="theme-color" content="#000000" />
        <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
      </head>
      <body style={{ background: "#000", color: "#fff" }}>{children}</body>
    </html>
  );
}
