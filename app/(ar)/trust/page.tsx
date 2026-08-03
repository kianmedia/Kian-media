// /trust — ar. Wave 2 · V2-2.3-A/B. One renderer, one content layer.
import type { Metadata } from "next";
import TrustPage from "@/components/TrustPage";
import { canonicalFor } from "@/lib/seo";

const AR = true;    // Arabic default

export const metadata: Metadata = {
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

export default function Page() {
  return <TrustPage locale="ar" />;
}
