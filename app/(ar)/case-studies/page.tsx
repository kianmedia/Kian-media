// ════════════════════════════════════════════════════════════════════════════
// /case-studies — فهرس دراسات الحالة العامّ (مكوّن خادم).
//
// ★ يعمل والـSQL غير مطبَّق ★ إن لم تُطبَّق الترحيلة، أو كان المفتاح العامّ
//   مطفأً، أو لم يوجد محتوى منشور، تُعرَض شاشة «قريبًا» **آمنة وصادقة**:
//   لا رقم، ولا بطاقة وهمية، ولا صفر يُقرأ «لا أعمال لدينا» — والصفحة تُوسَم
//   noindex كي لا تدخل نتائج البحث صفحة بلا محتوى.
//
// ★ لا تكسر المحفظة القائمة ★ شبكة الأعمال في الصفحة الرئيسية
//   (components/Portfolio.tsx) لم تُمسّ. هذه صفحة إضافية لا بديلة.
// ════════════════════════════════════════════════════════════════════════════
import type { Metadata } from "next";
import Link from "next/link";
import { I18nProvider } from "@/lib/i18n";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import WaFloat from "@/components/WaFloat";
import CaseStudiesIndexClient from "@/components/CaseStudiesIndexClient";
import { publicCaseStudyIndex } from "@/lib/server/publicCaseStudies";
import { SITE_URL } from "@/lib/site";

export const revalidate = 300;

export async function generateMetadata(): Promise<Metadata> {
  const data = await publicCaseStudyIndex({});
  const live = data.enabled && data.items.length > 0;
  return {
    title: "دراسات الحالة | كيان الابتكار للإنتاج الفني",
    description:
      "دراسات حالة من إنتاجات كيان في السعودية — التحدّي والمعالجة الإبداعية والتنفيذ والنتائج، منشورة بإذن أصحابها.",
    alternates: { canonical: `${SITE_URL}/case-studies` },
    // صفحة بلا محتوى لا تُفهرَس. الفهرسة تُطلَب حين يوجد ما يُعرَض.
    robots: live ? { index: true, follow: true } : { index: false, follow: true },
    openGraph: {
      title: "دراسات الحالة | Kian Media",
      description: "Selected Kian productions — challenge, approach, execution and outcomes, published with client permission.",
      url: `${SITE_URL}/case-studies`,
      type: "website",
      locale: "ar_SA",
      siteName: "Kian Media",
    },
  };
}

function ComingSoon() {
  return (
    <div className="max-w-7xl mx-auto px-6 lg:px-12" style={{ paddingTop: "150px", paddingBottom: "140px" }}>
      <div className="eyebrow mb-5">دراسات الحالة</div>
      <h1 className="editorial text-white" style={{ fontSize: "clamp(26px,4.5vw,40px)", lineHeight: 1.3, marginBottom: "16px" }}>
        قريبًا — دراسات حالة مختارة
      </h1>
      <p className="f-sans" style={{ color: "rgba(255,255,255,0.55)", fontSize: "14.5px", lineHeight: 1.95, maxWidth: "680px" }}>
        نُعِدّ حاليًّا دراسات حالة تفصيلية لعدد من إنتاجاتنا. لا نَنشر عملًا قبل إذن صريح من صاحبه،
        ولهذا يستغرق الأمر وقتًا أطول ممّا لو نشرنا كلّ شيء. إلى أن تصبح جاهزة، تجد أعمالنا في
        المعرض على الصفحة الرئيسية.
      </p>
      <div style={{ marginTop: "40px", display: "flex", flexWrap: "wrap", gap: "14px" }}>
        <Link href="/#portfolio" className="btn-ghost"><span>معرض الأعمال</span></Link>
        <Link href="/quote-request" className="btn-red"><span>اطلب عرض سعر</span></Link>
        <Link href="/book-meeting" className="btn-ghost"><span>احجز اجتماعًا</span></Link>
      </div>
    </div>
  );
}

export default async function CaseStudiesPage() {
  const data = await publicCaseStudyIndex({});
  const live = data.enabled && data.items.length > 0;

  const collectionSchema = live
    ? {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: "دراسات الحالة — كيان الابتكار للإنتاج الفني",
        url: `${SITE_URL}/case-studies`,
        isPartOf: { "@type": "WebSite", name: "Kian Media", url: SITE_URL },
        hasPart: data.items.slice(0, 24).map((it) => ({
          "@type": "Article",
          headline: (it.title_ar || it.title_en || it.slug).slice(0, 110),
          url: `${SITE_URL}/case-studies/${it.slug}`,
        })),
      }
    : null;

  return (
    <I18nProvider>
      <WaFloat />
      <Navbar />
      <main style={{ background: "#050505", minHeight: "100vh" }}>
        {live ? (
          <CaseStudiesIndexClient
            items={data.items}
            sectors={data.sectors}
            services={data.services}
            total={data.total}
          />
        ) : (
          <ComingSoon />
        )}
      </main>
      {collectionSchema && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(collectionSchema).replace(/</g, "\\u003c") }}
        />
      )}
      <Footer />
    </I18nProvider>
  );
}
