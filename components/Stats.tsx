"use client";
import { motion } from "framer-motion";
import { useI18n } from "@/lib/i18n";
import Counter from "@/components/Counter";

/**
 * Prominent stats band — cinematic black/red, large animated numbers.
 * Reinforces credibility for B2B / government audience.
 * Self-contained; place anywhere in the homepage (e.g. after <About/> or <Portfolio/>).
 */
const STATS = [
  { to: 20,   suffix: "+", ar: "سنة خبرة",       en: "Years of Experience" },
  { to: 4000, suffix: "+", ar: "إنتاج مكتمل",     en: "Productions Delivered" },
  { to: 2000, suffix: "+", ar: "عميل",            en: "Clients Served" },
  { to: 13,   suffix: "",  ar: "منطقة في المملكة", en: "Regions Across KSA" },
];

export default function Stats() {
  const { t, isAr } = useI18n();
  return (
    <section className="relative overflow-hidden" style={{ background: "#050505", padding: "clamp(70px, 10vw, 120px) 0" }}>
      {/* subtle red glow accents */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute" style={{ top: 0, insetInlineStart: 0, width: "45vw", height: "60%", background: "radial-gradient(ellipse at 0% 0%, rgba(227,30,36,0.08), transparent 60%)" }} />
        <div className="absolute" style={{ bottom: 0, insetInlineEnd: 0, width: "40vw", height: "55%", background: "radial-gradient(ellipse at 100% 100%, rgba(227,30,36,0.06), transparent 60%)" }} />
      </div>

      <div className="max-w-6xl mx-auto px-5 sm:px-6 relative z-10">
        {/* Eyebrow + heading */}
        <motion.div
          initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          className="text-center mb-14 sm:mb-20"
        >
          <div className="eyebrow mb-5 mx-auto">{t({ ar: "بالأرقام", en: "By the Numbers" })}</div>
          <h2 className="editorial text-white" style={{ fontSize: "clamp(28px, 4.5vw, 48px)", lineHeight: 1.25 }}>
            {t({ ar: "خبرة تُقاس", en: "Experience Measured" })} <em style={{ color: "#E31E24" }}>{t({ ar: "بالإنجاز", en: "in Results" })}</em>
          </h2>
        </motion.div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 md:grid-cols-4" style={{ gap: "1px", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.07)" }}>
          {STATS.map((s, i) => (
            <motion.div
              key={s.en}
              initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1], delay: (i % 4) * 0.1 }}
              className="text-center"
              style={{ background: "#070707", padding: "clamp(28px, 4vw, 48px) clamp(12px, 2vw, 24px)" }}
            >
              <div className="f-display text-white" style={{ fontSize: "clamp(38px, 6vw, 68px)", lineHeight: 1, fontWeight: 400, marginBottom: "12px" }}>
                <Counter to={s.to} suffix={s.suffix} />
              </div>
              <div className="f-sans" style={{ fontSize: "clamp(10px, 1.4vw, 12px)", letterSpacing: isAr ? "1px" : "2.5px", color: "rgba(255,255,255,0.5)", textTransform: isAr ? "none" : "uppercase", fontWeight: 500, fontFamily: isAr ? "var(--arabic-display)" : "var(--sans)" }}>
                {t({ ar: s.ar, en: s.en })}
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
