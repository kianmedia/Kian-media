"use client";
// Public Privacy Policy — Arabic-first, bilingual via existing i18n flow.
import Link from "next/link";
import { I18nProvider, useI18n } from "@/lib/i18n";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

const UPDATED = "2026-06-14";
const PRIVACY_EMAIL = "contact@kianmedia.com";

function Body() {
  const { t, isAr } = useI18n();
  return (
    <main style={{ background: "#050505", minHeight: "100vh" }}>
      <section className="relative overflow-hidden" style={{ paddingTop: "150px", paddingBottom: "100px" }}>
        <div className="absolute top-0 left-0 pointer-events-none" style={{ width: "50vw", height: "50vh", background: "radial-gradient(ellipse at 20% 0%, rgba(227,30,36,0.08), transparent 65%)" }} />
        <div className="max-w-3xl mx-auto px-5 sm:px-6 relative z-10">
          <div className="eyebrow mb-5">{t({ ar: "الخصوصية", en: "Privacy" })}</div>
          <h1 className="editorial text-white" style={{ fontSize: "clamp(30px,5vw,48px)", lineHeight: 1.25, marginBottom: "10px" }}>
            {t({ ar: "سياسة الخصوصية", en: "Privacy Policy" })}
          </h1>
          <p className="f-sans" style={{ fontSize: "12px", color: "rgba(255,255,255,0.4)", marginBottom: "36px" }}>
            {t({ ar: "آخر تحديث: ", en: "Last updated: " })}<span style={{ direction: "ltr", display: "inline-block" }}>{UPDATED}</span>
          </p>

          <Intro t={t} />

          <H>{t({ ar: "البيانات التي نجمعها", en: "What we collect" })}</H>
          <P>{t({
            ar: "عند استخدامك لموقع كيان ميديا أو بوابة العملاء قد نجمع: الاسم، البريد الإلكتروني، رقم الجوال، اسم الشركة أو الجهة، تفاصيل طلبات عروض الأسعار، الرسائل التي ترسلها لنا، الروابط والملفات التي تشاركها، بيانات مشاريعك، وبيانات الإشعارات والنشاط داخل البوابة.",
            en: "When you use the Kian Media website or client portal we may collect: name, email, mobile number, company/organization, quote-request details, messages you send us, links and files you share, your project data, and in-portal notification and activity data.",
          })}</P>

          <H>{t({ ar: "لماذا نجمع هذه البيانات", en: "Why we collect it" })}</H>
          <P>{t({
            ar: "نستخدم بياناتك من أجل: التواصل والمتابعة، إعداد عروض الأسعار، إدارة المشاريع، تقديم الدعم للعملاء، إرسال إشعارات البوابة، والاحتفاظ بالسجلات الإدارية اللازمة لتقديم خدماتنا.",
            en: "We use your data to: contact and follow up with you, prepare quotes, manage projects, provide customer support, send portal notifications, and keep the administrative records needed to deliver our services.",
          })}</P>

          <H>{t({ ar: "عدم بيع البيانات", en: "We do not sell your data" })}</H>
          <P>{t({
            ar: "لا نبيع بياناتك الشخصية لأي طرف ثالث. تُستخدم بياناتك فقط لتقديم خدماتنا والتواصل معك بخصوص طلباتك ومشاريعك.",
            en: "We do not sell your personal data to anyone. Your data is used only to provide our services and to communicate with you about your requests and projects.",
          })}</P>

          <H>{t({ ar: "مزوّدو الخدمة (أطراف ثالثة)", en: "Third-party processors" })}</H>
          <P>{t({
            ar: "نعتمد على مزوّدي خدمة موثوقين لتشغيل خدماتنا: Supabase (قاعدة البيانات والمصادقة)، وGoogle (Apps Script / Google Sheets) كنسخة احتياطية لطلبات الأسعار وإشعارات البريد، وVercel (استضافة الموقع). كما نخطط مستقبلاً لاستخدام Zoho CRM و Zoho Books لإدارة العلاقات والفوترة. تتم معالجة البيانات لدى هؤلاء المزوّدين وفق سياساتهم.",
            en: "We rely on trusted service providers to operate: Supabase (database & authentication), Google (Apps Script / Google Sheets) as a backup for quote requests and email notifications, and Vercel (website hosting). We also plan to use Zoho CRM and Zoho Books later for relationship management and invoicing. Data handled by these providers is processed under their own policies.",
          })}</P>

          <H>{t({ ar: "الاحتفاظ بالبيانات والوصول إليها", en: "Data retention & access" })}</H>
          <P>{t({
            ar: "نحتفظ ببياناتك طوال فترة تقديم الخدمة وبما يلزم للسجلات الإدارية. داخل بوابة العملاء، يطّلع كل مستخدم على بياناته فقط، ويتاح لفريق كيان ميديا الوصول الإداري اللازم لتنفيذ الخدمة.",
            en: "We retain your data for as long as we provide the service and as needed for administrative records. Inside the client portal each user sees only their own data, while the Kian Media team has the administrative access required to deliver the service.",
          })}</P>

          <H>{t({ ar: "حقوقك", en: "Your choices" })}</H>
          <P>{t({
            ar: "يمكنك تحديث بياناتك من صفحة الملف الشخصي في البوابة، أو التواصل معنا لطلب تصحيح بياناتك أو الاستفسار عنها.",
            en: "You can update your details from the portal Profile page, or contact us to request corrections to your data or ask questions about it.",
          })}</P>

          <H>{t({ ar: "التواصل بخصوص الخصوصية", en: "Privacy contact" })}</H>
          <P>{t({
            ar: "لأي استفسار يخص الخصوصية أو بياناتك، تواصل معنا على:",
            en: "For any privacy question or data request, contact us at:",
          })}</P>
          <p style={{ marginBottom: "30px" }}>
            <a href={`mailto:${PRIVACY_EMAIL}`} className="f-sans" style={{ color: "#E31E24", fontSize: "15px", direction: "ltr", display: "inline-block", textDecoration: "none" }}>{PRIVACY_EMAIL}</a>
          </p>

          <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: "22px" }}>
            <Link href="/terms" className="f-sans" style={{ fontSize: "12px", letterSpacing: "1px", color: "rgba(255,255,255,0.55)", textDecoration: "none" }}>
              {t({ ar: "شروط الاستخدام ←", en: "Terms of Use →" })}
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}

function Intro({ t }: { t: (s: { ar: string; en: string }) => string }) {
  return (
    <p className="text-white/70" style={{ fontSize: "16px", lineHeight: 1.9, marginBottom: "10px" }}>
      {t({
        ar: "تحترم كيان الابتكار للإنتاج الفني («كيان ميديا») خصوصيتك. توضّح هذه السياسة البيانات التي نجمعها عند استخدامك لموقعنا وبوابة العملاء، وكيفية استخدامها وحمايتها.",
        en: "Kian Al Ebtikar Art Production (“Kian Media”) respects your privacy. This policy explains what data we collect when you use our website and client portal, and how we use and protect it.",
      })}
    </p>
  );
}

function H({ children }: { children: React.ReactNode }) {
  return <h2 className="text-white" style={{ fontSize: "19px", fontWeight: 700, marginTop: "30px", marginBottom: "10px" }}>{children}</h2>;
}
function P({ children }: { children: React.ReactNode }) {
  return <p className="text-white/60" style={{ fontSize: "14.5px", lineHeight: 1.95 }}>{children}</p>;
}

export default function PrivacyPolicyPage() {
  return (
    <I18nProvider>
      <Navbar />
      <Body />
      <Footer />
    </I18nProvider>
  );
}
