"use client";
import { motion } from "framer-motion";
import { useI18n } from "@/lib/i18n";
import { CLIENTS } from "@/lib/clients";

export default function Clients() {
  const { t } = useI18n();

  return (
    <section className="relative overflow-hidden" style={{ background: "#0B0B0B", paddingTop: "140px", paddingBottom: "140px" }}>
      <div className="sec-gradient" />
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
            {t({ ar: "علامات وجهات", en: "Brands & institutions" })}{" "}
            <em>{t({ ar: "نفخر بإنتاجها", en: "we're proud to have produced for" })}</em>
          </h2>
          <p className="text-white/45 mt-5" style={{ fontSize: "15px", lineHeight: 1.85, maxWidth: "640px", margin: "20px auto 0" }}>
            {t({
              ar: "أكثر من ٢٠٠٠ عميل من القطاعات الحكومية، الشركات الكبرى، والعلامات التجارية الفاخرة.",
              en: "Over 2,000 clients across government, major corporates, and luxury brands.",
            })}
          </p>
        </motion.div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {CLIENTS.map((c, i) => (
            <motion.div
              key={c.slug}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: (i % 15) * 0.025 }}
              className="client-cell group"
            >
              <span className="text-white/55 group-hover:text-white transition-colors duration-400" style={{ fontSize: "13px", fontWeight: 500, lineHeight: 1.4, letterSpacing: "0.2px" }}>
                {t({ ar: c.ar, en: c.en })}
              </span>
            </motion.div>
          ))}
        </div>

        <p className="text-center mt-12 f-sans" style={{ fontSize: "10px", letterSpacing: "3px", color: "rgba(255,255,255,0.3)", textTransform: "uppercase" }}>
          {t({ ar: "وأكثر من ٢٠٠٠ علامة تجارية وجهة", en: "& over 2,000 brands and institutions" })}
        </p>
      </div>
    </section>
  );
}
