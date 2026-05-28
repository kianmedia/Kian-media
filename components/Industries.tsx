"use client";
import { motion } from "framer-motion";

type Ind = { icon: string; ar: string; en: string };

const INDUSTRIES: Ind[] = [
  { icon: "🏛", ar: "الجهات الحكومية", en: "Government" },
  { icon: "🏢", ar: "الشركات الكبرى", en: "Corporates" },
  { icon: "🏗", ar: "التطوير العقاري", en: "Real Estate" },
  { icon: "🏥", ar: "القطاع الصحي", en: "Healthcare" },
  { icon: "🎓", ar: "التعليم والمعاهد", en: "Education" },
  { icon: "🛍", ar: "البيع بالتجزئة", en: "Retail" },
  { icon: "🎪", ar: "الفعاليات والمعارض", en: "Events" },
  { icon: "💍", ar: "الأعراس الخاصة", en: "Weddings" },
];

const CLIENT_NAMES = [
  "شركة العتيشان", "ريفايفا", "مسكوب", "الزاهد",
  "معهد سين", "مهرجان أفلام السعودية", "وندر هيلز", "ريو ميديا",
];

export default function Industries() {
  return (
    <section className="relative overflow-hidden" style={{ background: "#080808", paddingTop: "120px", paddingBottom: "120px" }}>
      <div className="max-w-7xl mx-auto px-6 lg:px-12">

        {/* Heading */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
          className="text-center mb-16"
          data-reveal
        >
          <div className="eyebrow mb-6 mx-auto">Clients &amp; Industries</div>
          <h2 className="editorial text-white" style={{ fontSize: "clamp(34px,5vw,58px)" }}>
            Trusted by <em>industries</em> that shape the kingdom.
          </h2>
          <p className="f-arabic text-white/45 mt-4" style={{ fontSize: "16px", lineHeight: 1.7, maxWidth: "600px", margin: "16px auto 0" }}>
            من الجهات الحكومية إلى المطورين العقاريين والعلامات التجارية الكبرى — نُنتج لمن يصنعون المشهد.
          </p>
        </motion.div>

        {/* Industries grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-px mb-20" style={{ background: "rgba(255,255,255,0.08)" }}>
          {INDUSTRIES.map((ind, i) => (
            <motion.div
              key={ind.en}
              initial={{ opacity: 0, scale: 0.92 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1], delay: (i % 4) * 0.07 }}
              className="group flex flex-col items-center justify-center text-center p-8 lg:p-12 transition-all duration-500 hover:bg-black"
              style={{ background: "#080808", minHeight: "180px" }}
            >
              <div className="mb-4 transition-transform duration-500 group-hover:-translate-y-1" style={{ fontSize: "36px", filter: "grayscale(100%) brightness(1.5)" }}>{ind.icon}</div>
              <h3 className="f-arabic text-white mb-1" style={{ fontSize: "15px", fontWeight: 600 }}>{ind.ar}</h3>
              <p className="f-sans" style={{ fontSize: "9px", letterSpacing: "2.5px", color: "rgba(227,30,36,0.7)", textTransform: "uppercase" }}>{ind.en}</p>
            </motion.div>
          ))}
        </div>

        {/* Client names ticker */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 1 }}
          className="text-center"
          data-reveal
        >
          <div className="f-sans mb-8" style={{ fontSize: "10px", letterSpacing: "4px", color: "rgba(255,255,255,0.35)", textTransform: "uppercase" }}>Selected Clients</div>
          <div className="flex flex-wrap items-center justify-center gap-x-12 gap-y-4">
            {CLIENT_NAMES.map((c, i) => (
              <motion.span
                key={c}
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.06 }}
                className="f-arabic text-white/55 hover:text-white transition-colors"
                style={{ fontSize: "17px", fontWeight: 500 }}
              >
                {c}
              </motion.span>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
