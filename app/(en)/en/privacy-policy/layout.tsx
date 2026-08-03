// English metadata for /en/privacy-policy — same builder, locale "en" (V2-1.1-C).
import type { Metadata } from "next";
import { seoFor } from "@/lib/seo";

export const metadata: Metadata = seoFor("privacy-policy", "en");

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
