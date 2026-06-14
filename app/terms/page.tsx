"use client";
// Public Client Portal Terms — Arabic-first, bilingual via existing i18n flow.
import Link from "next/link";
import { I18nProvider, useI18n } from "@/lib/i18n";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

const UPDATED = "2026-06-14";
const CONTACT_EMAIL = "contact@kianmedia.com";

function Body() {
  const { t } = useI18n();
  return (
    <main style={{ background: "#050505", minHeight: "100vh" }}>
      <section className="relative overflow-hidden" style={{ paddingTop: "150px", paddingBottom: "100px" }}>
        <div className="absolute top-0 left-0 pointer-events-none" style={{ width: "50vw", height: "50vh", background: "radial-gradient(ellipse at 20% 0%, rgba(227,30,36,0.08), transparent 65%)" }} />
        <div className="max-w-3xl mx-auto px-5 sm:px-6 relative z-10">
          <div className="eyebrow mb-5">{t({ ar: "الشروط", en: "Terms" })}</div>
          <h1 className="editorial text-white" style={{ fontSize: "clamp(30px,5vw,48px)", lineHeight: 1.25, marginBottom: "10px" }}>
            {t({ ar: "شروط استخدام بوابة العملاء", en: "Client Portal Terms of Use" })}
          </h1>
          <p className="f-sans" style={{ fontSize: "12px", color: "rgba(255,255,255,0.4)", marginBottom: "36px" }}>
            {t({ ar: "آخر تحديث: ", en: "Last updated: " })}<span style={{ direction: "ltr", display: "inline-block" }}>{UPDATED}</span>
          </p>

          <P>{t({
            ar: "تنظّم هذه الشروط استخدامك لبوابة عملاء كيان الابتكار للإنتاج الفني («كيان ميديا»). باستخدامك للبوابة فإنك توافق على هذه الشروط.",
            en: "These terms govern your use of the Kian Al Ebtikar Art Production (“Kian Media”) client portal. By using the portal you agree to these terms.",
          })}</P>

          <H>{t({ ar: "استخدام البوابة", en: "Using the portal" })}</H>
          <P>{t({
            ar: "تتيح لك البوابة: إنشاء حساب، إرسال طلبات عروض الأسعار، التواصل عبر الرسائل، مشاركة الروابط والملفات، متابعة تحديثات المشاريع، واستلام الإشعارات.",
            en: "The portal lets you: create an account, submit quote requests, communicate via messages, share links and files, follow project updates, and receive notifications.",
          })}</P>

          <H>{t({ ar: "مسؤوليات المستخدم", en: "Your responsibilities" })}</H>
          <ul className="text-white/60" style={{ fontSize: "14.5px", lineHeight: 2, paddingInlineStart: "20px", listStyle: "disc" }}>
            <li>{t({ ar: "تقديم معلومات صحيحة ومحدّثة.", en: "Provide accurate, up-to-date information." })}</li>
            <li>{t({ ar: "عدم رفع أو مشاركة أي محتوى مخالف للقانون أو ينتهك حقوق الغير.", en: "Do not upload or share illegal or infringing content." })}</li>
            <li>{t({ ar: "الحفاظ على سرية بيانات الدخول الخاصة بك.", en: "Keep your login credentials confidential." })}</li>
          </ul>

          <H>{t({ ar: "عروض الأسعار والمشاريع", en: "Quotes & projects" })}</H>
          <ul className="text-white/60" style={{ fontSize: "14.5px", lineHeight: 2, paddingInlineStart: "20px", listStyle: "disc" }}>
            <li>{t({ ar: "طلبات عروض الأسعار ليست ملزمة حتى صدور عرض رسمي أو عقد معتمد.", en: "Quote requests are not binding until an official offer or signed contract is issued." })}</li>
            <li>{t({ ar: "مواعيد التسليم تخضع لاعتماد نطاق العمل وشروط الدفع.", en: "Delivery timelines are subject to confirmed scope and payment terms." })}</li>
            <li>{t({ ar: "يحق لكيان ميديا التواصل معك بناءً على الطلبات التي ترسلها عبر البوابة.", en: "Kian Media may contact you based on the requests you submit via the portal." })}</li>
          </ul>

          <H>{t({ ar: "المحتوى الذي تشاركه", en: "Content you share" })}</H>
          <P>{t({
            ar: "تبقى ملكية المواد التي تشاركها لك. تمنح كيان ميديا الإذن باستخدامها بالقدر اللازم لتنفيذ الخدمة المتفق عليها.",
            en: "You retain ownership of the materials you share. You grant Kian Media permission to use them as needed to deliver the agreed service.",
          })}</P>

          <H>{t({ ar: "الخصوصية", en: "Privacy" })}</H>
          <P>{t({
            ar: "تُعالَج بياناتك وفق ",
            en: "Your data is handled under our ",
          })}<Link href="/privacy-policy" style={{ color: "#E31E24", textDecoration: "none" }}>{t({ ar: "سياسة الخصوصية", en: "Privacy Policy" })}</Link>.</P>

          <H>{t({ ar: "تعديل الشروط", en: "Changes to these terms" })}</H>
          <P>{t({
            ar: "قد نحدّث هذه الشروط من وقت لآخر، وسيظهر تاريخ آخر تحديث أعلى الصفحة.",
            en: "We may update these terms from time to time; the last-updated date is shown at the top of this page.",
          })}</P>

          <H>{t({ ar: "التواصل", en: "Contact" })}</H>
          <P>{t({ ar: "لأي استفسار حول هذه الشروط، تواصل معنا على:", en: "For any question about these terms, contact us at:" })}</P>
          <p style={{ marginBottom: "30px" }}>
            <a href={`mailto:${CONTACT_EMAIL}`} className="f-sans" style={{ color: "#E31E24", fontSize: "15px", direction: "ltr", display: "inline-block", textDecoration: "none" }}>{CONTACT_EMAIL}</a>
          </p>

          <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: "22px" }}>
            <Link href="/privacy-policy" className="f-sans" style={{ fontSize: "12px", letterSpacing: "1px", color: "rgba(255,255,255,0.55)", textDecoration: "none" }}>
              {t({ ar: "سياسة الخصوصية ←", en: "Privacy Policy →" })}
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}

function H({ children }: { children: React.ReactNode }) {
  return <h2 className="text-white" style={{ fontSize: "19px", fontWeight: 700, marginTop: "30px", marginBottom: "10px" }}>{children}</h2>;
}
function P({ children }: { children: React.ReactNode }) {
  return <p className="text-white/60" style={{ fontSize: "14.5px", lineHeight: 1.95, marginBottom: "4px" }}>{children}</p>;
}

export default function TermsPage() {
  return (
    <I18nProvider>
      <Navbar />
      <Body />
      <Footer />
    </I18nProvider>
  );
}
