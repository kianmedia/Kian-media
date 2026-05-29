"use client";
import { motion } from "framer-motion";
import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import Counter from "@/components/Counter";

const SHOWREEL_ID = "JN5MRQuEP4M";

const f = (d = 0) => ({
  hidden: { opacity: 0, y: 30 },
  show: { opacity: 1, y: 0, transition: { duration: 1, ease: [0.16, 1, 0.3, 1], delay: d } },
});

export default function Hero() {
  const { t, isAr } = useI18n();
  const [reel, setReel] = useState(false);
  const wa = "https://wa.me/966503422999?text=" + encodeURIComponent(
    isAr
      ? "السلام عليكم، أود طلب عرض إنتاج إعلامي من كيان ميديا"
      : "Hello, I would like to request a production proposal from Kian Media."
  );
  const go = (h: string) => document.querySelector(h)?.scrollIntoView({ behavior: "smooth" });

  return (
    <section className="relative min-h-screen w-full flex items-center justify-center overflow-hidden" style={{ background: "#050505" }}>
      {/* Cinematic background */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute inset-0" style={{ background: "linear-gradient(165deg, #050505 0%, #0d0606 40%, #050505 100%)" }} />
        <div className="absolute top-0 left-0 w-[65vw] h-[70vh]" style={{ background: "radial-gradient(ellipse at 18% 20%, rgba(227,30,36,0.18) 0%, transparent 60%)" }} />
        <div className="absolute bottom-0 right-0 w-[55vw] h-[55vh]" style={{ background: "radial-gradient(ellipse at 82% 80%, rgba(227,30,36,0.08) 0%, transparent 60%)" }} />
        <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.55) 100%)" }} />
      </div>

      {/* Film strips */}
      {[false, true].map((right) => (
        <div key={String(right)} className={`absolute top-0 bottom-0 w-5 overflow-hidden pointer-events-none ${right ? "right-4" : "left-4"}`} style={{ opacity: 0.08 }}>
          <div className={right ? "anim-fu" : "anim-fd"} style={{ display: "flex", flexDirection: "column" }}>
            {Array.from({ length: 44 }).map((_, i) => (
              <div key={i} style={{ width: "14px", height: "10px", margin: "3px auto", border: "1px solid rgba(255,255,255,0.5)", flexShrink: 0 }} />
            ))}
          </div>
        </div>
      ))}

      <div className="relative z-10 text-center px-6 max-w-6xl mx-auto py-32" data-reveal>
        {/* Tag */}
        <motion.div variants={f(0.05)} initial="hidden" animate="show" className="flex items-center justify-center gap-4 mb-10">
          <span style={{ width: "44px", height: "1px", background: "rgba(227,30,36,0.6)" }} />
          <span className="f-sans" style={{ fontSize: "11px", letterSpacing: "5px", color: "rgba(255,255,255,0.55)", textTransform: "uppercase" }}>
            {t({ ar: "Kian Media · Saudi Arabia", en: "Kian Media · Saudi Arabia" })}
          </span>
          <span style={{ width: "44px", height: "1px", background: "rgba(227,30,36,0.6)" }} />
        </motion.div>

        {/* Logo */}
        <motion.div variants={f(0.15)} initial="hidden" animate="show" className="flex justify-center mb-10">
          <div style={{ width: "clamp(95px,12vw,135px)", height: "clamp(95px,12vw,135px)", filter: "drop-shadow(0 0 60px rgba(227,30,36,0.55)) drop-shadow(0 0 140px rgba(227,30,36,0.25))" }}>
            <img src="/logo.png" alt="Kian Media" className="logo-img" />
          </div>
        </motion.div>

        {/* Headline (switches with language) */}
        {isAr ? (
          <motion.h1
            variants={f(0.28)} initial="hidden" animate="show"
            className="editorial f-arabic text-white mb-4"
            style={{ fontSize: "clamp(34px, 5.5vw, 72px)", lineHeight: 1.25, fontWeight: 600 }}
          >
            إنتاج إعلامي سينمائي
            <br />
            <span style={{ color: "#E31E24", fontStyle: "italic" }}>للجهات التي لا تقبل الظهور العادي</span>
          </motion.h1>
        ) : (
          <motion.h1
            variants={f(0.28)} initial="hidden" animate="show"
            className="editorial text-white mb-4"
            style={{ fontSize: "clamp(38px, 6.5vw, 88px)" }}
          >
            Cinematic Media Production
            <br />
            for Brands That Refuse to <em>Look Ordinary</em>
          </motion.h1>
        )}

        {/* Secondary line */}
        <motion.h2
          variants={f(0.42)} initial="hidden" animate="show"
          className="text-white/70 mb-8"
          style={{
            fontSize: "clamp(15px, 1.9vw, 22px)",
            fontWeight: isAr ? 500 : 300,
            lineHeight: 1.6,
            fontFamily: isAr ? "var(--sans)" : "var(--serif)",
            fontStyle: isAr ? "normal" : "italic",
          }}
        >
          {t({
            ar: "شركة كيان الابتكار للإنتاج الفني — إنتاج سينمائي كامل من السيناريو إلى التسليم",
            en: "Full cinematic production — from script to delivery — across all regions of Saudi Arabia",
          })}
        </motion.h2>

        {/* Service line */}
        <motion.p
          variants={f(0.55)} initial="hidden" animate="show"
          className="f-sans uppercase mb-12"
          style={{ fontSize: "clamp(10px, 1.4vw, 13px)", letterSpacing: "6px", color: "rgba(255,255,255,0.4)", fontWeight: 300 }}
        >
          Corporate · Commercial · Drone · Live · Documentary · Events
        </motion.p>

        {/* CTAs */}
        <motion.div variants={f(0.68)} initial="hidden" animate="show" className="flex flex-wrap gap-3 justify-center mb-16">
          <button onClick={() => go("#portfolio")} className="btn-red">
            <span>{t({ ar: "شاهد أعمالنا", en: "View Our Work" })}</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: isAr ? "scaleX(-1)" : "none" }}><path d="M5 12h14M12 5l7 7-7 7" /></svg>
          </button>
          <button onClick={() => go("#contact")} className="btn-ghost">
            <span>{t({ ar: "اطلب عرض إنتاج", en: "Request a Proposal" })}</span>
          </button>
          <a href={wa} target="_blank" rel="noopener noreferrer" className="btn-wa">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.5 14.4c-.3-.1-1.7-.8-2-1-.3-.1-.5-.1-.7.1-.2.3-.7.9-.9 1.1-.2.2-.3.2-.6.1-1.6-.8-2.7-1.4-3.8-3.2-.3-.5.3-.5.8-1.5.1-.2 0-.4 0-.5 0-.1-.7-1.7-.9-2.3-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.2.2 2.1 3.2 5.1 4.5 1.9.8 2.6.9 3.5.7.6-.1 1.7-.7 1.9-1.4.2-.7.2-1.3.2-1.4-.1-.1-.3-.2-.6-.3zM12 2C6.5 2 2 6.5 2 12c0 1.7.5 3.4 1.3 4.9L2 22l5.2-1.4c1.5.8 3.1 1.2 4.8 1.2 5.5 0 10-4.5 10-10S17.5 2 12 2z" /></svg>
            <span>{t({ ar: "واتساب", en: "WhatsApp Us" })}</span>
          </a>
        </motion.div>

        {/* Stats — updated numbers with animated counters */}
        <motion.div variants={f(0.82)} initial="hidden" animate="show" className="grid grid-cols-2 md:grid-cols-4 gap-px max-w-3xl mx-auto" style={{ background: "rgba(227,30,36,0.15)", border: "1px solid rgba(227,30,36,0.15)" }}>
          <div className="text-center py-6 px-4" style={{ background: "rgba(0,0,0,0.88)" }}>
            <div className="f-display" style={{ fontSize: "clamp(26px,3.5vw,40px)", color: "#fff", lineHeight: 1 }}>
              <Counter to={2000} suffix="+" />
            </div>
            <div className="f-sans mt-2" style={{ fontSize: "8px", letterSpacing: "2.5px", color: "rgba(255,255,255,0.5)", textTransform: "uppercase" }}>{t({ ar: "عميل", en: "Clients" })}</div>
          </div>
          <div className="text-center py-6 px-4" style={{ background: "rgba(0,0,0,0.88)" }}>
            <div className="f-display" style={{ fontSize: "clamp(26px,3.5vw,40px)", color: "#fff", lineHeight: 1 }}>
              <Counter to={4000} suffix="+" />
            </div>
            <div className="f-sans mt-2" style={{ fontSize: "8px", letterSpacing: "2.5px", color: "rgba(255,255,255,0.5)", textTransform: "uppercase" }}>{t({ ar: "إنتاج مكتمل", en: "Productions" })}</div>
          </div>
          <div className="text-center py-6 px-4" style={{ background: "rgba(0,0,0,0.88)" }}>
            <div className="f-display" style={{ fontSize: "clamp(26px,3.5vw,40px)", color: "#fff", lineHeight: 1 }}>
              <Counter to={20} suffix="+" />
            </div>
            <div className="f-sans mt-2" style={{ fontSize: "8px", letterSpacing: "2.5px", color: "rgba(255,255,255,0.5)", textTransform: "uppercase" }}>{t({ ar: "سنة خبرة", en: "Years" })}</div>
          </div>
          <div className="text-center py-6 px-4" style={{ background: "rgba(0,0,0,0.88)" }}>
            <div className="f-display" style={{ fontSize: "clamp(20px,2.6vw,28px)", color: "#fff", lineHeight: 1.1 }}>
              {t({ ar: "كل المناطق", en: "All Regions" })}
            </div>
            <div className="f-sans mt-2" style={{ fontSize: "8px", letterSpacing: "2.5px", color: "rgba(255,255,255,0.5)", textTransform: "uppercase" }}>{t({ ar: "السعودية", en: "Saudi Arabia" })}</div>
          </div>
        </motion.div>

        {/* Watch reel */}
        <motion.button
          variants={f(0.95)} initial="hidden" animate="show"
          onClick={() => setReel(true)}
          className="mt-12 inline-flex items-center gap-3 group"
          style={{ background: "none", border: "none", color: "rgba(255,255,255,0.7)", cursor: "pointer" }}
        >
          <span className="flex items-center justify-center transition-transform group-hover:scale-110" style={{ width: "44px", height: "44px", borderRadius: "50%", border: "1px solid rgba(227,30,36,0.5)", background: "rgba(227,30,36,0.08)" }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="#E31E24"><path d="M5 3l16 9-16 9z" /></svg>
          </span>
          <span className="f-sans" style={{ fontSize: "11px", letterSpacing: "3px", textTransform: "uppercase" }}>{t({ ar: "شاهد الشورييل", en: "Watch our Showreel" })}</span>
        </motion.button>

        {reel && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            onClick={() => setReel(false)}
            style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.94)", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}
          >
            <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: "1000px" }}>
              <button onClick={() => setReel(false)} className="f-sans" style={{ display: "block", marginInlineStart: "auto", marginBottom: "16px", background: "none", border: "none", color: "rgba(255,255,255,0.7)", fontSize: "13px", letterSpacing: "2px", cursor: "pointer" }}>✕ CLOSE</button>
              <div className="yt" style={{ border: "1px solid rgba(227,30,36,0.3)", boxShadow: "0 30px 100px rgba(227,30,36,0.18)" }}>
                <iframe src={`https://www.youtube.com/embed/${SHOWREEL_ID}?autoplay=1&rel=0`} title="Kian Media Showreel" allowFullScreen allow="autoplay; encrypted-media; picture-in-picture" />
              </div>
            </div>
          </motion.div>
        )}
      </div>

      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 z-10 pointer-events-none">
        <span className="f-sans" style={{ fontSize: "8px", letterSpacing: "4px", textTransform: "uppercase", color: "rgba(255,255,255,0.25)" }}>Scroll</span>
        <div style={{ width: "1px", height: "44px", background: "linear-gradient(to bottom, rgba(227,30,36,0.6), transparent)" }} className="animate-pulse" />
      </div>
    </section>
  );
}
