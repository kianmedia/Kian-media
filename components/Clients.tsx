"use client";
import { motion } from "framer-motion";
import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { CLIENTS, type Client } from "@/lib/clients";

/**
 * One client cell — shows logo if available; falls back to client name
 * either if hasLogo is false, or if the logo fails to load at runtime.
 */
function ClientCell({ c, i }: { c: Client; i: number }) {
  const { t } = useI18n();
  // Start by trusting the hasLogo flag from data
  const [showLogo, setShowLogo] = useState<boolean>(!!c.hasLogo);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.4, delay: (i % 12) * 0.025 }}
      className="group flex items-center justify-center text-center transition-all duration-500 hover:bg-black"
      style={{ background: "#080808", minHeight: "120px", padding: "20px" }}
      title={t({ ar: c.ar, en: c.en })}
    >
      {showLogo ? (
        <img
          src={`/clients/${c.slug}.png`}
          alt={t({ ar: c.ar, en: c.en })}
          loading="lazy"
          decoding="async"
          onError={() => setShowLogo(false)}
          className="transition-all duration-500 group-hover:scale-105"
          style={{
            maxWidth: "100%",
            maxHeight: "70px",
            width: "auto",
            height: "auto",
            objectFit: "contain",
            // Slightly desaturated by default; full color on hover
            filter: "grayscale(0.2) brightness(0.95)",
            opacity: 0.85,
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLImageElement).style.filter = "grayscale(0) brightness(1)";
            (e.currentTarget as HTMLImageElement).style.opacity = "1";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLImageElement).style.filter = "grayscale(0.2) brightness(0.95)";
            (e.currentTarget as HTMLImageElement).style.opacity = "0.85";
          }}
        />
      ) : (
        <span
          className="text-white/45 group-hover:text-white transition-colors duration-500"
          style={{ fontSize: "13px", fontWeight: 500, lineHeight: 1.4, letterSpacing: "0.3px" }}
        >
          {t({ ar: c.ar, en: c.en })}
        </span>
      )}
    </motion.div>
  );
}

export default function Clients() {
  const { t } = useI18n();
  return (
    <section className="relative overflow-hidden" style={{ background: "#050505", paddingTop: "140px", paddingBottom: "140px" }}>
      <div className="max-w-7xl mx-auto px-6 lg:px-12">
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

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-px" style={{ background: "rgba(255,255,255,0.06)" }}>
          {CLIENTS.map((c, i) => <ClientCell key={c.slug} c={c} i={i} />)}
        </div>

        <p className="text-center mt-12 f-sans" style={{ fontSize: "10px", letterSpacing: "3px", color: "rgba(255,255,255,0.3)", textTransform: "uppercase" }}>
          {t({ ar: "وأكثر من ٢٠٠٠ علامة تجارية وجهة", en: "& over 2,000 brands and institutions" })}
        </p>
      </div>
    </section>
  );
}
