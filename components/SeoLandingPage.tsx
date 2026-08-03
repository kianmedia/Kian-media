// ════════════════════════════════════════════════════════════════════════════
// components/SeoLandingPage.tsx — the ONE renderer for every SEO landing page.
//
// Wave 1 · V2-1.11
//
// Nine routes (six services, three cities) × two locales = eighteen URLs, all
// rendered by this component from content/seo-pages.ts. There is no per-page
// component and no per-page copy: a page cannot drift from its translation, and
// a change to the layout lands on all eighteen at once.
//
// A Server Component on purpose — these pages are static marketing copy with no
// interactivity, so they ship no JavaScript of their own.
//
// ⚠️ Renders NOTHING but a 404 when SHOW_SEO_PAGES is off. The gate lives in the
// route (notFound()), not here, so an off page is a real 404 rather than a blank
// 200 that a crawler would happily index as an empty page.
// ════════════════════════════════════════════════════════════════════════════
import Link from "next/link";
import type { SeoPage } from "@/content/seo-pages";
import { breadcrumbJsonLd, localBusinessJsonLd } from "@/lib/structuredData";

export default function SeoLandingPage({
  page,
  locale,
}: {
  page: SeoPage;
  locale: "ar" | "en";
}) {
  const ar = locale === "ar";
  const title = ar ? page.h1Ar : page.h1En;
  const intro = ar ? page.introAr : page.introEn;
  const points = ar ? page.pointsAr : page.pointsEn;
  const home = ar ? "/" : "/en";
  const contactHref = ar ? "/quote-request" : "/en/quote-request";

  const sectionLabel = page.kind === "service"
    ? (ar ? "الخدمات" : "Services")
    : (ar ? "المدن" : "Cities");

  return (
    <>
      {/* Structured data. Both helpers refuse to emit a field they cannot fill,
          so nothing here is padded to satisfy a schema validator. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd(page, locale)) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(localBusinessJsonLd()) }}
      />

      <main id="main" style={{ background: "#050505", color: "#fff", minHeight: "70vh" }}>
        <div style={{ maxWidth: "820px", margin: "0 auto", padding: "clamp(90px,12vw,150px) 24px 90px" }}>

          {/* Visible breadcrumb — the same trail the JSON-LD describes. A
              breadcrumb in structured data that a visitor cannot see is a
              mismatch between what we tell Google and what we show. */}
          <nav aria-label={ar ? "مسار التنقل" : "Breadcrumb"} style={{ marginBottom: "26px" }}>
            <ol style={{ display: "flex", flexWrap: "wrap", gap: "8px", listStyle: "none", padding: 0, margin: 0, fontSize: "12.5px", color: "rgba(255,255,255,0.5)" }}>
              <li><Link href={home} style={{ color: "rgba(255,255,255,0.6)" }}>{ar ? "الرئيسية" : "Home"}</Link></li>
              <li aria-hidden="true">/</li>
              <li>{sectionLabel}</li>
              <li aria-hidden="true">/</li>
              <li aria-current="page" style={{ color: "rgba(255,255,255,0.85)" }}>{title}</li>
            </ol>
          </nav>

          <h1 className="editorial" style={{ fontSize: "clamp(30px,5vw,50px)", lineHeight: 1.25, marginBottom: "20px" }}>
            {title}
          </h1>

          <p style={{ fontSize: "16.5px", lineHeight: 2, color: "rgba(255,255,255,0.72)", marginBottom: "38px" }}>
            {intro}
          </p>

          <h2 style={{ fontSize: "clamp(19px,2.6vw,24px)", marginBottom: "16px", fontWeight: 600 }}>
            {ar ? "ما يشمله العمل" : "What the work covers"}
          </h2>
          <ul style={{ listStyle: "none", padding: 0, margin: "0 0 44px", display: "grid", gap: "12px" }}>
            {points.map((p) => (
              <li key={p} style={{ display: "flex", gap: "12px", alignItems: "flex-start", fontSize: "15px", lineHeight: 1.85, color: "rgba(255,255,255,0.75)" }}>
                <span aria-hidden="true" style={{ color: "#E31E24", marginTop: "2px" }}>◆</span>
                <span>{p}</span>
              </li>
            ))}
          </ul>

          <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: "30px" }}>
            <h2 style={{ fontSize: "clamp(19px,2.6vw,24px)", marginBottom: "14px", fontWeight: 600 }}>
              {ar ? "ابدأ مشروعك" : "Start your project"}
            </h2>
            <p style={{ fontSize: "15px", lineHeight: 1.9, color: "rgba(255,255,255,0.6)", marginBottom: "20px" }}>
              {ar
                ? "أرسل تفاصيل مشروعك وسيصلك ردّ من فريق الإنتاج."
                : "Send your project details and the production team will get back to you."}
            </p>
            <Link
              href={contactHref}
              className="btn-red"
              style={{ display: "inline-flex", alignItems: "center", gap: "10px", padding: "13px 26px", textDecoration: "none" }}
            >
              {ar ? "اطلب عرض سعر" : "Request a quote"}
            </Link>
          </div>
        </div>
      </main>
    </>
  );
}
