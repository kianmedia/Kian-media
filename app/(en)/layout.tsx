// ════════════════════════════════════════════════════════════════════════════
// ROOT LAYOUT — English public mirror (/en/*).  Wave 1 · V2-1.1 (D-3)
//
// ★ THIS IS THE FIX KHALED ASKED FOR ★
// /en/* now leaves the server as <html lang="en" dir="ltr">. The previous build
// shipped lang="ar" dir="rtl" and corrected it with an inline script after
// parse, so the FIRST HTML — the only thing a JS-less crawler reads — described
// an English page as Arabic. No script is involved any more.
// ════════════════════════════════════════════════════════════════════════════
import type { Metadata } from "next";
import "../globals.css";
import RootDocument from "@/components/RootDocument";
import { seoFor } from "@/lib/seo";

export const metadata: Metadata = {
  ...seoFor("home", "en"),
  metadataBase: new URL("https://kianmedia.com"),
  robots: { index: true, follow: true },
  formatDetection: { telephone: true },
  applicationName: "Kian Media",
  appleWebApp: { capable: true, title: "Kian Media", statusBarStyle: "black-translucent" },
};

export default function EnglishRootLayout({ children }: { children: React.ReactNode }) {
  return <RootDocument lang="en" dir="ltr">{children}</RootDocument>;
}
