// ════════════════════════════════════════════════════════════════════════════
// /case-studies/[slug] — صفحة دراسة الحالة العامّة (مكوّن خادم).
//
// ★ لا وجود بلا نشر ★ الـslug غير المنشور — أو المسحوب، أو المحظور بحظر نشر،
//   أو الذي سُحب إذنه — يعطي 404 وليس صفحة فارغة ولا رسالة «غير متاح». الفرق
//   مهمّ: «غير متاح» تؤكّد أنّ الشيء موجود، والوجود نفسه قد يكون سرًّا.
//
// ★ يعمل والـSQL غير مطبَّق ★ غياب الترحيلة يعني ببساطة 404: لا انهيار، ولا
//   محتوى وهميّ، ولا صفحة تُفهرَس ثمّ تختفي.
// ════════════════════════════════════════════════════════════════════════════
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { I18nProvider } from "@/lib/i18n";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import WaFloat from "@/components/WaFloat";
import CaseStudyDetailClient from "@/components/CaseStudyDetailClient";
import { publicCaseStudy, safeText, safeImageUrl } from "@/lib/server/publicCaseStudies";
import { SITE_URL } from "@/lib/site";

export const revalidate = 300;
/** لا توليد ثابت مسبق: النشر قرار يتغيّر، والقائمة تُقرأ عند الطلب. */
export const dynamicParams = true;

type Params = { params: { slug: string } };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { found, study } = await publicCaseStudy(params.slug);
  if (!found || !study) {
    return { title: "دراسة الحالة غير متاحة | كيان الابتكار", robots: { index: false, follow: false } };
  }
  const seo = study.seo ?? {};
  const title = safeText(seo.title_ar || study.title_ar || seo.title_en || study.title_en, 110);
  const description = safeText(seo.description_ar || study.summary_ar || seo.description_en || study.summary_en, 300);
  const ogTitle = safeText(seo.og_title_ar || title, 110);
  const ogDescription = safeText(seo.og_description_ar || description, 300);
  const canonicalPath =
    typeof seo.canonical_path === "string" && /^\/case-studies\/[a-z0-9-]+$/.test(seo.canonical_path)
      ? seo.canonical_path
      : `/case-studies/${study.slug}`;
  const ogImage = safeImageUrl(study.hero?.url) ?? "/logo.png";

  return {
    title: `${title} | كيان الابتكار للإنتاج الفني`,
    description,
    alternates: { canonical: `${SITE_URL}${canonicalPath}` },
    robots: { index: true, follow: true },
    openGraph: {
      title: ogTitle,
      description: ogDescription,
      url: `${SITE_URL}${canonicalPath}`,
      type: "article",
      locale: "ar_SA",
      siteName: "Kian Media",
      images: [{ url: ogImage.startsWith("http") ? ogImage : `${SITE_URL}${ogImage}` }],
    },
    twitter: {
      card: "summary_large_image",
      title: ogTitle,
      description: ogDescription,
      images: [ogImage.startsWith("http") ? ogImage : `${SITE_URL}${ogImage}`],
    },
  };
}

export default async function CaseStudyPage({ params }: Params) {
  const { found, study, related } = await publicCaseStudy(params.slug);
  if (!found || !study) notFound();

  const seo = study.seo ?? {};
  const canonicalPath =
    typeof seo.canonical_path === "string" && /^\/case-studies\/[a-z0-9-]+$/.test(seo.canonical_path)
      ? seo.canonical_path
      : `/case-studies/${study.slug}`;

  // ★ بيانات منظَّمة من الحقول العامّة وحدها ★ لا اسم عميل غير مُقنَّع، ولا رقم
  //   غير مأذون به: كلّها وصلت مُقنَّعة من الخادم أصلًا، ولا نضيف هنا حقلًا جديدًا.
  const articleSchema = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: safeText(study.title_ar || study.title_en, 110),
    description: safeText(study.summary_ar || study.summary_en, 300),
    inLanguage: "ar",
    mainEntityOfPage: { "@type": "WebPage", "@id": `${SITE_URL}${canonicalPath}` },
    url: `${SITE_URL}${canonicalPath}`,
    datePublished: study.published_at ?? undefined,
    dateModified: study.updated_at ?? study.published_at ?? undefined,
    image: safeImageUrl(study.hero?.url) ?? undefined,
    author: { "@type": "Organization", name: "Kian Media Production", url: SITE_URL },
    publisher: {
      "@type": "Organization",
      name: "Kian Media Production",
      url: SITE_URL,
      logo: { "@type": "ImageObject", url: `${SITE_URL}/logo.png` },
    },
  };

  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "الرئيسية", item: SITE_URL },
      { "@type": "ListItem", position: 2, name: "دراسات الحالة", item: `${SITE_URL}/case-studies` },
      { "@type": "ListItem", position: 3, name: safeText(study.title_ar || study.title_en, 110), item: `${SITE_URL}${canonicalPath}` },
    ],
  };

  return (
    <I18nProvider>
      <WaFloat />
      <Navbar />
      <main style={{ background: "#050505", minHeight: "100vh" }}>
        <CaseStudyDetailClient study={study} related={related} />
      </main>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleSchema).replace(/</g, "\\u003c") }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema).replace(/</g, "\\u003c") }}
      />
      <Footer />
    </I18nProvider>
  );
}
