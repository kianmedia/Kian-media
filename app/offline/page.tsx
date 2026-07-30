// ════════════════════════════════════════════════════════════════════════════
// /offline — the service worker's navigation fallback.
//
// Static, public, data-free and noindex. It is precached at install time so the
// fallback exists BEFORE the first failed request, and it deliberately carries
// no account state so that a cached copy is harmless if it outlives a session.
// ════════════════════════════════════════════════════════════════════════════
import type { Metadata } from "next";
import OfflineScreen from "@/components/pwa/OfflineScreen";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "غير متصل | كيان الابتكار",
  description: "صفحة احتياطية تظهر عند انقطاع الاتصال.",
  robots: { index: false, follow: false },
};

export default function OfflinePage() {
  return <OfflineScreen />;
}
