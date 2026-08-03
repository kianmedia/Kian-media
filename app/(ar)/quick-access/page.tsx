"use client";
import { motion } from "framer-motion";
import { I18nProvider, useI18n } from "@/lib/i18n";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import WaFloat from "@/components/WaFloat";

const CARDS = [
  {
    href: "/quote-request",
    ar: "اطلب عرض سعر", en: "Request a Quote",
    arDesc: "احصل على عرض سعر مخصص لمشروعك", enDesc: "Get a tailored quote for your project",
    icon: <path d="M9 11H3v10h6V11zM21 3h-6v18h6V3zM15 7H9v14h6V7z" />,
  },
  {
    href: "/book-meeting",
    ar: "احجز موعد", en: "Book a Meeting",
    arDesc: "رتّب اجتماعاً أو استشارة مع فريقنا", enDesc: "Arrange a meeting or consultation",
    icon: <><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></>,
  },
  {
    href: "/upload-files",
    ar: "أرسل ملفات المشروع", en: "Submit Project Files",
    arDesc: "شارك روابط ملفاتك بسهولة", enDesc: "Share your project file links",
    icon: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M17 8l-5-5-5 5M12 3v12" /></>,
  },
];

function Inner() {
  const { t, isAr } = useI18n();
  return (
    <>
      <WaFloat />
      <Navbar />
      <main style={{ background: "#050505", minHeight: "100vh" }}>
        <section className="relative overflow-hidden" style={{ paddingTop: "160px", paddingBottom: "120px" }}>
          <div className="absolute top-0 left-0 pointer-events-none" style={{ width: "50vw", height: "50vh", background: "radial-gradient(ellipse at 20% 0%, rgba(227,30,36,0.08), transparent 65%)" }} />
          <div className="max-w-5xl mx-auto px-5 sm:px-6 relative z-10">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7 }} className="text-center mb-14">
              <div className="eyebrow mb-5 mx-auto">{t({ ar: "الوصول السريع", en: "Quick Access" })}</div>
              <h1 className="editorial text-white" style={{ fontSize: "clamp(32px,5.5vw,56px)", lineHeight: 1.2 }}>
                {t({ ar: "كيف نقدر نخدمك؟", en: "How Can We Help?" })}
              </h1>
            </motion.div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {CARDS.map((c, i) => (
                <motion.a
                  key={c.href} href={c.href}
                  initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.55, delay: 0.15 + i * 0.1, ease: [0.16, 1, 0.3, 1] }}
                  className="qa-card group"
                >
                  <div className="qa-icon">
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{c.icon}</svg>
                  </div>
                  <h3 className="text-white" style={{ fontSize: "20px", fontWeight: 700, marginBottom: "8px", fontFamily: isAr ? "var(--arabic-display)" : "var(--sans)" }}>
                    {t({ ar: c.ar, en: c.en })}
                  </h3>
                  <p className="text-white/50" style={{ fontSize: "13.5px", lineHeight: 1.6 }}>
                    {t({ ar: c.arDesc, en: c.enDesc })}
                  </p>
                  <span className="qa-arrow" style={{ transform: isAr ? "scaleX(-1)" : "none" }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
                  </span>
                </motion.a>
              ))}
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}

export default function QuickAccessPage() {
  return (
    <I18nProvider>
      <Inner />
    </I18nProvider>
  );
}
