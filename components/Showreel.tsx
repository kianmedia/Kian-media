"use client";
import { motion } from "framer-motion";
import { useState } from "react";
import { useI18n } from "@/lib/i18n";

const SHOWREEL_ID = "JN5MRQuEP4M";

export default function Showreel() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <section id="showreel" className="relative overflow-hidden" style={{ background: "#050505", paddingTop: "100px", paddingBottom: "100px" }}>
      <div className="max-w-7xl mx-auto px-6 lg:px-12">

        {/* Compact heading — no excess spacing */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.85, ease: [0.16, 1, 0.3, 1] }}
          className="text-center mb-10"
          data-reveal
        >
          <div className="eyebrow mb-5 mx-auto">{t({ ar: "الشورييل", en: "The Showreel" })}</div>
          <h2 className="editorial text-white" style={{ fontSize: "clamp(32px,4.8vw,56px)" }}>
            {t({ ar: "لمحة عمّا", en: "A glimpse of" })} <em>{t({ ar: "ننتجه", en: "what we craft" })}</em>
          </h2>
        </motion.div>

        {/* Cinematic video card — directly attached to heading */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
          className="relative group max-w-6xl mx-auto"
          data-reveal
        >
          {/* Subtle ambient glow — much reduced */}
          <div className="absolute -inset-2 pointer-events-none opacity-30 group-hover:opacity-50 transition-opacity duration-700"
               style={{ background: "radial-gradient(ellipse at center, rgba(227,30,36,0.12), transparent 70%)", filter: "blur(30px)" }} />

          <button
            onClick={() => setOpen(true)}
            className="relative block w-full overflow-hidden group/card"
            style={{ aspectRatio: "16/9", border: "1px solid rgba(255,255,255,0.08)", background: "#000", cursor: "pointer" }}
            aria-label="Play showreel"
          >
            {/* High-quality thumbnail with fallback chain */}
            <ShowreelThumb id={SHOWREEL_ID} />

            {/* Cinematic overlay — refined */}
            <div className="absolute inset-0 transition-opacity duration-700 group-hover/card:opacity-90"
                 style={{ background: "linear-gradient(to top, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.1) 45%, rgba(0,0,0,0.45) 100%)" }} />

            {/* Smaller, premium play button */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="relative">
                <span className="absolute inset-0 rounded-full" style={{ background: "rgba(227,30,36,0.3)", animation: "pulseRing 2.5s ease-out infinite" }} />
                <span className="relative flex items-center justify-center transition-transform duration-500 group-hover/card:scale-110"
                      style={{ width: "68px", height: "68px", borderRadius: "50%", background: "var(--red)", boxShadow: "0 12px 32px rgba(227,30,36,0.4)" }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="#fff" style={{ marginLeft: "3px" }}><path d="M5 3l16 9-16 9z" /></svg>
                </span>
              </div>
            </div>

            {/* Bottom caption — restrained */}
            <div className="absolute bottom-0 left-0 right-0 p-6 md:p-10 flex flex-wrap items-end justify-between gap-3">
              <div>
                <span className="f-sans block mb-1.5" style={{ fontSize: "9px", letterSpacing: "3.5px", textTransform: "uppercase", color: "rgba(255,255,255,0.55)" }}>
                  Kian Media · {new Date().getFullYear()}
                </span>
                <h3 className="text-white" style={{ fontSize: "clamp(18px,2.4vw,28px)", lineHeight: 1.15, fontWeight: 600 }}>
                  {t({ ar: "الشورييل الرسمي", en: "Official Showreel" })}
                </h3>
              </div>
              <div className="f-sans" style={{ fontSize: "10px", letterSpacing: "3px", color: "rgba(255,255,255,0.5)", textTransform: "uppercase" }}>
                {t({ ar: "اضغط للمشاهدة", en: "Click to watch" })}
              </div>
            </div>

            {/* Refined corner brackets — single side only */}
            <span className="absolute top-3 left-3" style={{ width: "20px", height: "20px", borderTop: "1px solid rgba(255,255,255,0.4)", borderLeft: "1px solid rgba(255,255,255,0.4)" }} />
            <span className="absolute bottom-3 right-3" style={{ width: "20px", height: "20px", borderBottom: "1px solid rgba(255,255,255,0.4)", borderRight: "1px solid rgba(255,255,255,0.4)" }} />
          </button>
        </motion.div>
      </div>

      <style jsx>{`
        @keyframes pulseRing {
          0% { transform: scale(1); opacity: 0.6; }
          100% { transform: scale(1.6); opacity: 0; }
        }
      `}</style>

      {/* Modal */}
      {open && (
        <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.96)", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: "1100px" }}>
            <button onClick={() => setOpen(false)} className="f-sans" style={{ display: "block", marginInlineStart: "auto", marginBottom: "16px", background: "none", border: "none", color: "rgba(255,255,255,0.7)", fontSize: "12px", letterSpacing: "2px", cursor: "pointer" }}>✕ CLOSE</button>
            <div className="yt" style={{ border: "1px solid rgba(255,255,255,0.1)" }}>
              <iframe src={`https://www.youtube.com/embed/${SHOWREEL_ID}?autoplay=1&rel=0`} title="Showreel" allowFullScreen allow="autoplay; encrypted-media" />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// Thumbnail with smart fallback — detects YouTube's 120×90 gray placeholder
// (returned with 200 OK when maxresdefault doesn't exist, so onError won't fire)
function ShowreelThumb({ id }: { id: string }) {
  const [src, setSrc] = useState(`https://img.youtube.com/vi/${id}/maxresdefault.jpg`);
  const [loaded, setLoaded] = useState(false);
  const isMaxres = src.includes("maxresdefault");

  const onLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    if (isMaxres && img.naturalWidth <= 120) {
      setSrc(`https://img.youtube.com/vi/${id}/hqdefault.jpg`);
      return;
    }
    setLoaded(true);
  };

  const onError = () => {
    if (isMaxres) setSrc(`https://img.youtube.com/vi/${id}/hqdefault.jpg`);
  };

  return (
    <>
      <div
        className="absolute inset-0 transition-opacity duration-500"
        style={{
          background: "linear-gradient(135deg, #0d0d0d 0%, #050505 100%)",
          opacity: loaded ? 0 : 1,
        }}
      />
      <img
        src={src}
        alt="Kian Media Showreel"
        loading="eager"
        decoding="async"
        onLoad={onLoad}
        onError={onError}
        className="absolute inset-0 w-full h-full object-cover transition-transform duration-1000 group-hover:scale-[1.03]"
        style={{ opacity: loaded ? 0.85 : 0 }}
      />
    </>
  );
}
