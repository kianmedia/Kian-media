"use client";
import { ReactNode } from "react";
import { motion } from "framer-motion";
import { I18nProvider, useI18n } from "@/lib/i18n";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import WaFloat from "@/components/WaFloat";

function Inner({ eyebrow, title, subtitle, children }:
  { eyebrow: { ar: string; en: string }; title: { ar: string; en: string }; subtitle?: { ar: string; en: string }; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <>
      <WaFloat />
      <Navbar />
      <main style={{ background: "#050505", minHeight: "100vh" }}>
        {/* Header band */}
        <section className="relative overflow-hidden" style={{ paddingTop: "160px", paddingBottom: "60px" }}>
          <div className="absolute top-0 left-0 pointer-events-none" style={{ width: "50vw", height: "50vh", background: "radial-gradient(ellipse at 20% 0%, rgba(227,30,36,0.08), transparent 65%)" }} />
          <div className="max-w-3xl mx-auto px-5 sm:px-6 text-center relative z-10">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7 }}>
              <div className="eyebrow mb-5 mx-auto">{t(eyebrow)}</div>
              <h1 className="editorial text-white" style={{ fontSize: "clamp(30px,5.5vw,52px)", lineHeight: 1.25, marginBottom: subtitle ? "16px" : "0" }}>
                {t(title)}
              </h1>
              {subtitle && (
                <p className="text-white/55" style={{ fontSize: "clamp(14px,2vw,16px)", lineHeight: 1.75, maxWidth: "560px", margin: "0 auto" }}>
                  {t(subtitle)}
                </p>
              )}
            </motion.div>
          </div>
        </section>

        {/* Body */}
        <section style={{ paddingBottom: "120px" }}>
          <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.15 }}
            className="max-w-2xl mx-auto px-5 sm:px-6">
            {children}
          </motion.div>
        </section>
      </main>
      <Footer />
    </>
  );
}

export default function FormShell(props:
  { eyebrow: { ar: string; en: string }; title: { ar: string; en: string }; subtitle?: { ar: string; en: string }; children: ReactNode }) {
  return (
    <I18nProvider>
      <Inner {...props} />
    </I18nProvider>
  );
}
