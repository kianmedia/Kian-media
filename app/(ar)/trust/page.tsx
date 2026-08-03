// /trust — ar. Wave 2 · V2-2.3-A/B. One renderer, one content layer.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import TrustPage from "@/components/TrustPage";
import { trustPageEnabled } from "@/content/trust";
import { canonicalFor } from "@/lib/seo";

const AR = true;    // Arabic default

export function generateMetadata(): Metadata {
  // 🔴 With the gate closed the page 404s, so it must not advertise itself.
  // Emitting a canonical or an hreflang alternate for a URL that returns 404
  // is worse than emitting none: it invites a crawler to fetch a dead page and
  // treats the whole language cluster as broken.
  if (!trustPageEnabled()) return { robots: { index: false, follow: false } };
  return {
    title: AR ? "الثقة والامتثال | كيان ميديا" : "Trust & Compliance | Kian Media",
    description: AR
      ? "أمن منصة كيان ميديا وحماية البيانات: عزل على مستوى الصف، تشفير، مصادقة ثنائية، صلاحيات مفصَّلة، والتزام بنظام حماية البيانات الشخصية."
      : "Kian Media platform security and data protection: row-level isolation, encryption, two-factor authentication, granular permissions, and a commitment to Saudi PDPL.",
    alternates: {
      canonical: canonicalFor("/trust"),
      languages: {
        ar: canonicalFor("/trust"),
        en: canonicalFor("/en/trust"),
        "x-default": canonicalFor("/trust"),
      },
    },
    openGraph: {
      title: AR ? "الثقة والامتثال | كيان ميديا" : "Trust & Compliance | Kian Media",
      url: canonicalFor("/trust"),
      type: "website",
      locale: AR ? "ar_SA" : "en_US",
    },
  };
}

export default function Page() {
  if (!trustPageEnabled()) notFound();
  return <TrustPage locale="ar" />;
}
