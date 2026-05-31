"use client";
import { motion } from "framer-motion";
import { useI18n } from "@/lib/i18n";
import { CLIENTS } from "@/lib/clients";

export default function Clients() {
  const { t } = useI18n();

  return (
    <section className="relative overflow-hidden" style={{ background: "#050505", paddingTop: "140px", paddingBottom: "140px" }}>
      {/* Cinematic ambient glow */}
      <div className="absolute top-1/3 left-0 pointer-events-none" style={{ width: "45vw", height: "45vh", background: "radial-gradient(circle, rgba(227,30,36,0.05), transparent 70%)" }} />
      <div className="absolute bottom-0 right-0 pointer-events-none" style={{ width: "40vw", height: "40vh", background: "radial-gradient(circle, rgba(227,30,36,0.03), transparent 70%)" }} />

      <div className="max-w-7xl mx-auto px-6 lg:px-12 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.85 }}
          className="text-center mb-16"
          data-reveal
        >
          <div className="eyebrow mb-6 mx-auto">{t({ ar: "عملاؤنا", en: "Our Clients" })}</div>
          <h2 className="editorial text-white" style={{ fontSize: "clamp(34px,5vw,58px)" }}>
            {t({ ar: "نخبة من الجهات التي", en: "A select group of organizations" })}{" "}
            <em>{t({ ar: "وثقت بإبداع كيان", en: "that trusted Kian's craft" })}</em>
          </h2>
          <p className="text-white/45 mt-5" style={{ fontSize: "15px", lineHeight: 1.85, maxWidth: "640px", margin: "20px auto 0" }}>
            {t({
              ar: "أكثر من ٢٠٠٠ عميل من القطاعات الحكومية، الشركات الكبرى، والعلامات التجارية الفاخرة — تشرّفنا بإنتاج أعمالهم.",
              en: "Over 2,000 clients across government, major corporates, and luxury brands — we're proud to have produced their work.",
            })}
          </p>
        </motion.div>

        {/* Premium name cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {CLIENTS.map((c, i) => (
            <motion.div
              key={c.slug}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.45, delay: (i % 12) * 0.03, ease: [0.16, 1, 0.3, 1] }}
              className="client-name-card group"
            >
              <span className="client-name-text">
                {t({ ar: c.ar, en: c.en })}
              </span>
            </motion.div>
          ))}
        </div>

        <p className="text-center mt-14 f-sans" style={{ fontSize: "10px", letterSpacing: "3px", color: "rgba(255,255,255,0.3)", textTransform: "uppercase" }}>
          {t({ ar: "وأكثر من ٢٠٠٠ علامة تجارية وجهة", en: "& over 2,000 brands and institutions" })}
        </p>
      </div>
    </section>
  );
}
