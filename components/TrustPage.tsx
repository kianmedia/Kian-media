// ════════════════════════════════════════════════════════════════════════════
// components/TrustPage.tsx — the /trust page, both locales, one renderer.
//
// Wave 2 · V2-2.3-A/B
//
// Renders ONLY claims whose status is "live" (content/trust.ts). A claim that is
// not yet true is structurally present in the data and simply never reaches the
// page, so this page cannot get ahead of what the platform actually does.
//
// Server Component: static copy, no interactivity, no JavaScript shipped.
// ════════════════════════════════════════════════════════════════════════════
import Link from "next/link";
import { liveTrustClaims } from "@/content/trust";
import { NAP, formattedAddress } from "@/content/nap";
import { REGISTRATION, registrationVerified } from "@/content/registration";
import { breadcrumbListJsonLd, localBusinessJsonLd } from "@/lib/structuredData";

export default function TrustPage({ locale }: { locale: "ar" | "en" }) {
  const ar = locale === "ar";
  const claims = liveTrustClaims();
  const home = ar ? "/" : "/en";
  const trustPath = ar ? "/trust" : "/en/trust";

  const crumbs = breadcrumbListJsonLd([
    { name: ar ? "الرئيسية" : "Home", path: home },
    { name: ar ? "الثقة والامتثال" : "Trust & Compliance", path: trustPath },
  ]);

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(crumbs) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(localBusinessJsonLd()) }} />

      <main id="main" style={{ background: "#050505", color: "#fff", minHeight: "70vh" }}>
        <div style={{ maxWidth: "860px", margin: "0 auto", padding: "clamp(90px,12vw,150px) 24px 90px" }}>

          <nav aria-label={ar ? "مسار التنقل" : "Breadcrumb"} style={{ marginBottom: "26px" }}>
            <ol style={{ display: "flex", gap: "8px", listStyle: "none", padding: 0, margin: 0, fontSize: "12.5px", color: "rgba(255,255,255,0.5)" }}>
              <li><Link href={home} style={{ color: "rgba(255,255,255,0.6)" }}>{ar ? "الرئيسية" : "Home"}</Link></li>
              <li aria-hidden="true">/</li>
              <li aria-current="page" style={{ color: "rgba(255,255,255,0.85)" }}>{ar ? "الثقة والامتثال" : "Trust & Compliance"}</li>
            </ol>
          </nav>

          <h1 className="editorial" style={{ fontSize: "clamp(30px,5vw,50px)", lineHeight: 1.25, marginBottom: "18px" }}>
            {ar ? "الثقة والامتثال" : "Trust & Compliance"}
          </h1>
          <p style={{ fontSize: "16.5px", lineHeight: 2, color: "rgba(255,255,255,0.72)", marginBottom: "12px" }}>
            {ar
              ? "هذه الصفحة موجّهة لفرق المشتريات وتقنية المعلومات. تصف ما هو قائم فعلًا في منصتنا اليوم."
              : "This page is written for procurement and IT teams. It describes what is in place on our platform today."}
          </p>
          {/* The honesty rule, said out loud rather than only enforced in code. */}
          <p style={{ fontSize: "13.5px", lineHeight: 1.9, color: "rgba(255,255,255,0.45)", marginBottom: "44px" }}>
            {ar
              ? "لا تُدرَج هنا أي ممارسة قيد الإنشاء. ما يظهر أدناه مطبَّق."
              : "Nothing in progress is listed here. What appears below is implemented."}
          </p>

          <h2 style={{ fontSize: "clamp(20px,2.8vw,26px)", fontWeight: 600, marginBottom: "22px" }}>
            {ar ? "أمن المنصة وحماية البيانات" : "Platform security & data protection"}
          </h2>

          <ul style={{ listStyle: "none", padding: 0, margin: "0 0 52px", display: "grid", gap: "22px" }}>
            {claims.map((c) => (
              <li key={c.id} style={{ borderInlineStart: "2px solid rgba(227,30,36,0.55)", paddingInlineStart: "18px" }}>
                <h3 style={{ fontSize: "16.5px", fontWeight: 600, marginBottom: "7px" }}>
                  {ar ? c.titleAr : c.titleEn}
                </h3>
                <p style={{ fontSize: "14.5px", lineHeight: 1.9, color: "rgba(255,255,255,0.66)" }}>
                  {ar ? c.bodyAr : c.bodyEn}
                </p>
              </li>
            ))}
          </ul>

          <h2 style={{ fontSize: "clamp(20px,2.8vw,26px)", fontWeight: 600, marginBottom: "18px" }}>
            {ar ? "بيانات المنشأة" : "Company details"}
          </h2>
          <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "12px 22px", fontSize: "14.5px", margin: "0 0 48px" }}>
            <dt style={{ color: "rgba(255,255,255,0.45)" }}>{ar ? "الاسم" : "Name"}</dt>
            <dd style={{ margin: 0 }}>{ar ? NAP.nameAr : NAP.nameEn}</dd>
            <dt style={{ color: "rgba(255,255,255,0.45)" }}>{ar ? "المقر" : "Headquarters"}</dt>
            <dd style={{ margin: 0 }}>{formattedAddress(locale)}</dd>
            {/* 🔴 Legal identifiers appear ONLY when they have been checked
                against the actual certificates (content/registration.ts →
                REGISTRATION_VERIFIED). A wrong CR or VAT on a procurement page
                is a misrepresentation of legal identity that a buyer may rely
                on, so "we have the number" is not sufficient to publish it.
                Status while false: PENDING OFFICIAL DOCUMENT VERIFICATION. */}
            {registrationVerified() && (
              <>
                <dt style={{ color: "rgba(255,255,255,0.45)" }}>{ar ? "السجل التجاري" : "Commercial Registration"}</dt>
                <dd style={{ margin: 0 }} dir="ltr">{REGISTRATION.commercialRegistration}</dd>
                <dt style={{ color: "rgba(255,255,255,0.45)" }}>{ar ? "الرقم الضريبي" : "VAT Number"}</dt>
                <dd style={{ margin: 0 }} dir="ltr">{REGISTRATION.vat}</dd>
              </>
            )}
            <dt style={{ color: "rgba(255,255,255,0.45)" }}>{ar ? "البريد" : "Email"}</dt>
            <dd style={{ margin: 0 }} dir="ltr">
              <a href={`mailto:${NAP.email.primary}`} style={{ color: "#E31E24" }}>{NAP.email.primary}</a>
            </dd>
          </dl>

          <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: "28px" }}>
            <p style={{ fontSize: "14.5px", lineHeight: 1.9, color: "rgba(255,255,255,0.6)" }}>
              {ar ? "لأسئلة المشتريات أو تقنية المعلومات، أو لطلب معلومات إضافية: " : "For procurement or IT questions, or to request further information: "}
              <a href={`mailto:${NAP.email.primary}`} style={{ color: "#E31E24" }}>{NAP.email.primary}</a>
              {" · "}
              <Link href={ar ? "/privacy-policy" : "/en/privacy-policy"} style={{ color: "#E31E24" }}>
                {ar ? "سياسة الخصوصية" : "Privacy policy"}
              </Link>
            </p>
          </div>
        </div>
      </main>
    </>
  );
}
