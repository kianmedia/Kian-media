"use client";
import { motion } from "framer-motion";
import { useI18n } from "@/lib/i18n";

const INDUSTRIES = [
  { icon: "◆", ar: "الجهات الحكومية",       en: "Government" },
  { icon: "◆", ar: "التطوير العقاري",       en: "Real Estate" },
  { icon: "◆", ar: "القطاع الصحي",          en: "Healthcare" },
  { icon: "◆", ar: "السيارات",              en: "Automotive" },
  { icon: "◆", ar: "القطاع الصناعي",        en: "Industrial" },
  { icon: "◆", ar: "الشركات الكبرى",        en: "Corporate" },
  { icon: "◆", ar: "الضيافة والفنادق",      en: "Hospitality" },
  { icon: "◆", ar: "الفعاليات والمعارض",    en: "Events" },
  { icon: "◆", ar: "الترفيه والإعلام",      en: "Entertainment" },
  { icon: "◆", ar: "العلامات الفاخرة",      en: "Luxury Brands" },
  { icon: "◆", ar: "المطاعم والمقاهي",      en: "Restaurants & Cafés" },
  { icon: "◆", ar: "الرياضة",                en: "Sports" },
  { icon: "◆", ar: "الإنتاج السينمائي",      en: "Cinematic Productions" },
  { icon: "◆", ar: "الحملات التجارية",      en: "Commercial Campaigns" },
  { icon: "◆", ar: "الأعراس",                en: "Weddings" },
];

export default function Industries() {
  const { t } = useI18n();
  return (
    <section className="relative overflow-hidden" style={{ background: "#0B0B0B", paddingTop: "140px", paddingBottom: "140px" }}>
      <div className="max-w-7xl mx-auto px-6 lg:px-12">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.85 }}
          className="text-center mb-16"
          data-reveal
        >
          <div className="eyebrow mb-6 mx-auto">{t({ ar: "القطاعات التي نخدمها", en: "Industries We Serve" })}</div>
          <h2 className="editorial text-white" style={{ fontSize: "clamp(34px,5vw,58px)" }}>
            {t({ ar: "نُنتج لمن", en: "We produce for those" })}{" "}
            <em>{t({ ar: "يصنعون المشهد", en: "who shape the landscape" })}</em>
          </h2>
        </motion.div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-px" style={{ background: "rgba(255,255,255,0.06)" }}>
          {INDUSTRIES.map((ind, i) => (
            <motion.div
              key={ind.en}
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.45, delay: (i % 5) * 0.05 }}
              className="group flex flex-col items-center justify-center text-center p-8 transition-all duration-500 hover:bg-black"
              style={{ background: "#080808", minHeight: "150px" }}
            >
              <div className="mb-3 transition-all duration-500" style={{ fontSize: "16px", color: "rgba(255,255,255,0.25)" }}>{ind.icon}</div>
              <h3 className="text-white mb-1.5" style={{ fontSize: "14px", fontWeight: 600, lineHeight: 1.35 }}>{t({ ar: ind.ar, en: ind.en })}</h3>
              <p className="f-sans" style={{ fontSize: "8px", letterSpacing: "2.5px", color: "rgba(255,255,255,0.35)", textTransform: "uppercase", fontWeight: 500 }}>{ind.en}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
