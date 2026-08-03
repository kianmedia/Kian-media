// Wave 1 · V2-1.3-A — per-route metadata + self-referencing canonical.
// The page itself is a Client Component and cannot export `metadata`, so this
// sibling layout carries it. Copy lives in lib/seo.ts (one builder, no drift).
import type { Metadata } from "next";
import { seoFor } from "@/lib/seo";

export const metadata: Metadata = seoFor("privacy-policy");

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
