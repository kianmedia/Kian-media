// ════════════════════════════════════════════════════════════════════════════
// ROOT LAYOUT — Arabic public site.  Wave 1 · V2-1.1 (D-3)
//
// Emits <html lang="ar" dir="rtl"> FROM THE SERVER. Route groups are invisible
// in the URL, so "/" and "/terms" are unchanged.
//
// The shell (head, fonts, analytics, JSON-LD, PWA provider) lives in
// components/RootDocument.tsx so the three roots cannot drift.
// ════════════════════════════════════════════════════════════════════════════
import type { Metadata } from "next";
import "../globals.css";
import RootDocument from "@/components/RootDocument";
import { seoFor } from "@/lib/seo";

export const metadata: Metadata = {
  ...seoFor("home", "ar"),
  keywords: [
    "Saudi video production", "Dammam media production", "drone filming Saudi Arabia",
    "corporate video production", "live streaming Saudi Arabia", "event coverage",
    "wedding videography", "كيان الابتكار", "إنتاج إعلامي السعودية", "تصوير سينمائي",
    "تصوير جوي بالدرون", "بث مباشر", "Kian Media", "إنتاج فيديوهات الشركات",
  ],
  metadataBase: new URL("https://kianmedia.com"),
  robots: { index: true, follow: true },
  formatDetection: { telephone: true },
  applicationName: "كيان | Kian",
  appleWebApp: { capable: true, title: "كيان | Kian", statusBarStyle: "black-translucent" },
};

export default function ArabicRootLayout({ children }: { children: React.ReactNode }) {
  return <RootDocument lang="ar" dir="rtl">{children}</RootDocument>;
}
