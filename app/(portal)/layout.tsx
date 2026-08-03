// ════════════════════════════════════════════════════════════════════════════
// ROOT LAYOUT — client portal + admin.  Wave 1 · V2-1.1 (D-3)
//
// ⚠️ THE PORTAL DID NOT MOVE IN ANY WAY A USER OR THE CODE CAN SEE.
// A route group is invisible in the URL: /client-portal/... and /admin/... are
// byte-identical to before, every import uses the "@/" alias, and the portal's
// own app/(portal)/client-portal/layout.tsx is untouched and still nests here.
//
// The directory moved ONLY because Next requires that, once there are multiple
// root layouts, EVERY page route lives inside a route group. Without this the
// portal would have no root layout at all. Output here is identical to the
// previous single root: same lang, same dir, same shell.
// ════════════════════════════════════════════════════════════════════════════
import type { Metadata } from "next";
import "../globals.css";
import RootDocument from "@/components/RootDocument";

export const metadata: Metadata = {
  title: "بوابة العملاء | كيان ميديا",
  description: "بوابة عملاء كيان ميديا.",
  metadataBase: new URL("https://kianmedia.com"),
  // The portal must never be indexed. next.config.js also sends
  // X-Robots-Tag: noindex for /client-portal/* — belt and braces.
  robots: { index: false, follow: false },
  applicationName: "كيان | Kian",
  appleWebApp: { capable: true, title: "كيان | Kian", statusBarStyle: "black-translucent" },
};

export default function PortalRootLayout({ children }: { children: React.ReactNode }) {
  return <RootDocument lang="ar" dir="rtl">{children}</RootDocument>;
}
