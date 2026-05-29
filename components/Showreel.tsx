"use client";
import { motion } from "framer-motion";
import { useState } from "react";
import { useI18n } from "@/lib/i18n";

const SHOWREEL_ID = "JN5MRQuEP4M";

export default function Showreel() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <section id="showreel" className="relative overflow-hidden" style={{ background: "#050505", paddingTop: "120px", paddingBottom: "120px" }}>
      <div className="max-w-7xl mx-auto px-6 lg:px-12">

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
          className="text-center mb-16"
          data-reveal
        >
          <div className="eyebrow mb-6 mx-auto">{t({ ar: "الشورييل المميّز", en: "Featured Showreel" })}</div>
          <h2 className="editorial text-white" style={{ fontSize: "clamp(34px,5vw,58px)" }}>
            {t({ ar: "لمحة عن ما نُنتجه", en: "A glimpse into what we craft" })}
          </h2>
          <p className="text-white/45 mt-4" style={{ fontSize: "16px", lineHeight: 1.7, maxWidth: "600px", margin: "16px auto 0" }}>
            {t({
              ar: "لقطات منتقاة من إنتاجاتنا التجارية، الوثائقية، والميدانية في مختلف مناطق المملكة.",
              en: "Selected frames from our commercial, documentary, and on-location productions across the Kingdom.",
            })}
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
          className="relative group"
          data-reveal
        >
          <div className="absolute -inset-4 pointer-events-none opacity-50 group-hover:opacity-80 transition-opacity duration-700" style={{ background: "radial-gradient(ellipse at center, rgba(227,30,36,0.18), transparent 70%)", filter: "blur(40px)" }} />

          <button
            onClick={() => setOpen(true)}
            className="relative block w-full overflow-hidden"
            style={{ aspectRatio: "16/9", border: "1px solid rgba(227,30,36,0.2)", background: "#000", cursor: "pointer" }}
          >
            <img
              src={`https://i.ytimg.com/vi/${SHOWREEL_ID}/maxresdefault.jpg`}
              alt="Kian Media Showreel"
              loading="lazy"
              className="absolute inset-0 w-full h-full object-cover transition-transform duration-1000 group-hover:scale-105"
              style={{ opacity: 0.7 }}
              onError={(e) => { (e.target as HTMLImageElement).src = `https://i.ytimg.com/vi/${SHOWREEL_ID}/hqdefault.jpg`; }}
            />
            <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.2) 50%, rgba(0,0,0,0.5) 100%)" }} />

            <div className="absolute inset-0 flex items-center justify-center">
              <div className="relative">
                <span className="absolute inset-0 rounded-full animate-ping" style={{ background: "rgba(227,30,36,0.4)" }} />
                <span className="relative flex items-center justify-center transition-transform duration-500 group-hover:scale-110" style={{ width: "96px", height: "96px", borderRadius: "50%", background: "var(--red)", boxShadow: "0 20px 60px rgba(227,30,36,0.55)" }}>
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="#fff"><path d="M5 3l16 9-16 9z" /></svg>
                </span>
              </div>
            </div>

            <div className="absolute bottom-0 left-0 right-0 p-8 md:p-12 flex flex-wrap items-end justify-between gap-4">
              <div>
                <span className="f-sans" style={{ fontSize: "10px", letterSpacing: "4px", textTransform: "uppercase", color: "var(--red)" }}>Kian Media · 2026</span>
                <h3 className="f-serif text-white mt-2" style={{ fontSize: "clamp(22px,3vw,36px)", lineHeight: 1.1 }}>{t({ ar: "الشورييل الرسمي", en: "The Reel" })}</h3>
              </div>
              <div className="f-sans" style={{ fontSize: "10px", letterSpacing: "3px", color: "rgba(255,255,255,0.5)", textTransform: "uppercase" }}>
                {t({ ar: "اضغط للمشاهدة", en: "Click to watch" })}
              </div>
            </div>

            <span className="absolute top-4 left-4" style={{ width: "32px", height: "32px", borderTop: "1px solid var(--red)", borderLeft: "1px solid var(--red)" }} />
            <span className="absolute top-4 right-4" style={{ width: "32px", height: "32px", borderTop: "1px solid var(--red)", borderRight: "1px solid var(--red)" }} />
            <span className="absolute bottom-4 left-4" style={{ width: "32px", height: "32px", borderBottom: "1px solid var(--red)", borderLeft: "1px solid var(--red)" }} />
            <span className="absolute bottom-4 right-4" style={{ width: "32px", height: "32px", borderBottom: "1px solid var(--red)", borderRight: "1px solid var(--red)" }} />
          </button>
        </motion.div>
      </div>

      {open && (
        <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.95)", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: "1100px" }}>
            <button onClick={() => setOpen(false)} className="f-sans" style={{ display: "block", marginInlineStart: "auto", marginBottom: "16px", background: "none", border: "none", color: "rgba(255,255,255,0.7)", fontSize: "13px", letterSpacing: "2px", cursor: "pointer" }}>✕ CLOSE</button>
            <div className="yt" style={{ border: "1px solid rgba(227,30,36,0.3)", boxShadow: "0 30px 100px rgba(227,30,36,0.2)" }}>
              <iframe src={`https://www.youtube.com/embed/${SHOWREEL_ID}?autoplay=1&rel=0`} title="Showreel" allowFullScreen allow="autoplay; encrypted-media" />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
