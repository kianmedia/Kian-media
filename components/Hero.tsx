"use client";
import { motion } from "framer-motion";
import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import Counter from "@/components/Counter";

const SHOWREEL_ID = "JN5MRQuEP4M";

const f = (d = 0) => ({
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.95, ease: [0.16, 1, 0.3, 1], delay: d } },
});

export default function Hero() {
  const { t, isAr } = useI18n();
  const [reel, setReel] = useState(false);
  const wa = "https://wa.me/966503422999?text=" + encodeURIComponent(
    isAr
      ? "السلام عليكم، أود طلب عرض سعر لخدمات الإنتاج من كيان ميديا"
      : "Hello, I would like to request a production proposal from Kian Media."
  );
  const go = (h: string) => document.querySelector(h)?.scrollIntoView({ behavior: "smooth" });

  return (
    <section className="relative min-h-screen w-full flex items-center justify-center overflow-hidden" style={{ background: "#050505" }}>
      {/* Cinematic background — reduced glow, more editorial */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute inset-0" style={{ background: "linear-gradient(170deg, #050505 0%, #0a0606 50%, #050505 100%)" }} />
        <div className="absolute top-0 left-0 w-[55vw] h-[60vh]" style={{ background: "radial-gradient(ellipse at 20% 20%, rgba(227,30,36,0.10) 0%, transparent 65%)" }} />
        <div className="absolute bottom-0 right-0 w-[45vw] h-[45vh]" style={{ background: "radial-gradient(ellipse at 80% 80%, rgba(227,30,36,0.05) 0%, transparent 65%)" }} />
        <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,0.6) 100%)" }} />
      </div>

      {/* Film strips — subtle */}
      {[false, true].map((right) => (
        <div key={String(right)} className={`hidden md:block absolute top-0 bottom-0 w-5 overflow-hidden pointer-events-none ${right ? "right-4" : "left-4"}`} style={{ opacity: 0.06 }}>
          <div className={right ? "anim-fu" : "anim-fd"} style={{ display: "flex", flexDirection: "column" }}>
            {Array.from({ length: 44 }).map((_, i) => (
              <div key={i} style={{ width: "14px", height: "10px", margin: "3px auto", border: "1px solid rgba(255,255,255,0.5)", flexShrink: 0 }} />
            ))}
          </div>
        </div>
      ))}

      <div className="relative z-10 text-center px-5 sm:px-6 max-w-5xl mx-auto py-24 sm:py-32 w-full" data-reveal>
        {/* Eyebrow tag */}
        <motion.div variants={f(0.05)} initial="hidden" animate="show" className="flex items-center justify-center gap-3 sm:gap-5 mb-10 px-4 flex-wrap">
          <span className="hidden sm:block" style={{ width: "clamp(28px,8vw,64px)", height: "1px", flexShrink: 0, background: "linear-gradient(to right, transparent, rgba(255,255,255,0.6))" }} />
          <span
            className="f-sans"
            style={{
              fontSize: "clamp(12px, 3.4vw, 19px)",
              letterSpacing: isAr ? "1.5px" : "3px",
              color: "#fff",
              textTransform: isAr ? "none" : "uppercase",
              fontWeight: 700,
              fontFamily: isAr ? "var(--arabic-display)" : "var(--sans)",
              textShadow: "0 1px 14px rgba(0,0,0,0.65)",
              whiteSpace: "normal",
              textAlign: "center",
              maxWidth: "calc(100vw - 80px)",
            }}
          >
            {t({ ar: "كيان ميديا · المملكة العربية السعودية", en: "Kian Media · Saudi Arabia" })}
          </span>
          <span className="hidden sm:block" style={{ width: "clamp(28px,8vw,64px)", height: "1px", flexShrink: 0, background: "linear-gradient(to left, transparent, rgba(255,255,255,0.6))" }} />
        </motion.div>

        {/* Logo — refined glow (less intense) */}
        <motion.div variants={f(0.15)} initial="hidden" animate="show" className="flex justify-center mb-12">
          <div style={{ width: "clamp(140px,16vw,200px)", height: "clamp(140px,16vw,200px)", filter: "drop-shadow(0 0 38px rgba(227,30,36,0.34))" }}>
            <img src="/logo.png" alt="Kian Media" className="logo-img" />
          </div>
        </motion.div>

        {/* Headline — straight, bold, premium */}
        {isAr ? (
          <motion.h1
            variants={f(0.3)} initial="hidden" animate="show"
            className="editorial text-white mb-6"
            style={{
              fontSize: "clamp(26px, 7vw, 64px)",
              lineHeight: 1.4,
              fontWeight: 700,
              fontStyle: "normal",
              letterSpacing: "-0.01em",
              maxWidth: "100%",
              overflowWrap: "break-word",
              wordBreak: "break-word",
            }}
          >
            إنتاج إعلامي سينمائي
            <br />
            <span style={{ color: "#E31E24", fontStyle: "normal", fontWeight: 800 }}>
              للجهات التي لا تقبل الظهور العادي
            </span>
          </motion.h1>
        ) : (
          <motion.h1
            variants={f(0.3)} initial="hidden" animate="show"
            className="editorial text-white mb-6"
            style={{ fontSize: "clamp(30px, 7.5vw, 82px)", lineHeight: 1.1, maxWidth: "100%", overflowWrap: "break-word", wordBreak: "break-word" }}
          >
            Cinematic Media Production
            <br />
            for Brands That Refuse to <em>Look Ordinary</em>
          </motion.h1>
        )}

        {/* Supporting line — clean editorial */}
        <motion.p
          variants={f(0.45)} initial="hidden" animate="show"
          className="text-white/65 mx-auto mb-10"
          style={{
            fontSize: "clamp(14px, 3.8vw, 19px)",
            fontWeight: isAr ? 400 : 300,
            lineHeight: 1.75,
            maxWidth: "min(640px, 100%)",
            letterSpacing: isAr ? "0" : "0.005em",
          }}
        >
          {t({
            ar: "شركة إنتاج سعودية متخصصة في صناعة المحتوى البصري السينمائي — من الفكرة إلى التسليم النهائي، في جميع مناطق المملكة وخارجها.",
            en: "A Saudi production house specialized in cinematic visual content — from concept to final delivery, across all regions of the Kingdom and beyond.",
          })}
        </motion.p>

        {/* Service line — refined */}
        <motion.p
          variants={f(0.58)} initial="hidden" animate="show"
          className="f-sans uppercase mb-14"
          style={{ fontSize: "clamp(8px, 2vw, 12px)", letterSpacing: "2.5px", color: "rgba(255,255,255,0.32)", fontWeight: 400, maxWidth: "100%", overflowWrap: "break-word" }}
        >
          Corporate · Commercial · Drone · Live · Documentary · Events
        </motion.p>

        {/* CTAs */}
        <motion.div variants={f(0.7)} initial="hidden" animate="show" id="hero-ctas" className="flex flex-col sm:flex-row flex-wrap gap-3 justify-center items-center mb-16 w-full">
          <button onClick={() => go("#portfolio")} className="btn-red">
            <span>{t({ ar: "شاهد أعمالنا", en: "View Our Work" })}</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: isAr ? "scaleX(-1)" : "none" }}><path d="M5 12h14M12 5l7 7-7 7" /></svg>
          </button>
          <a href="/quote-request" className="btn-ghost">
            <span>{t({ ar: "اطلب عرض سعر", en: "Request a Quote" })}</span>
          </a>
          <a href={wa} target="_blank" rel="noopener noreferrer" className="btn-wa">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.5 14.4c-.3-.1-1.7-.8-2-1-.3-.1-.5-.1-.7.1-.2.3-.7.9-.9 1.1-.2.2-.3.2-.6.1-1.6-.8-2.7-1.4-3.8-3.2-.3-.5.3-.5.8-1.5.1-.2 0-.4 0-.5 0-.1-.7-1.7-.9-2.3-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.2.2 2.1 3.2 5.1 4.5 1.9.8 2.6.9 3.5.7.6-.1 1.7-.7 1.9-1.4.2-.7.2-1.3.2-1.4-.1-.1-.3-.2-.6-.3zM12 2C6.5 2 2 6.5 2 12c0 1.7.5 3.4 1.3 4.9L2 22l5.2-1.4c1.5.8 3.1 1.2 4.8 1.2 5.5 0 10-4.5 10-10S17.5 2 12 2z" /></svg>
            <span>{t({ ar: "واتساب", en: "WhatsApp" })}</span>
          </a>
        </motion.div>

        {/* Stats — hairline grid (original Netflix-editorial style) */}
        <motion.div variants={f(0.84)} initial="hidden" animate="show" className="grid grid-cols-2 md:grid-cols-4 gap-px max-w-3xl mx-auto w-full" style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.08)" }}>
          <div className="text-center py-6 px-4" style={{ background: "rgba(0,0,0,0.88)" }}>
            <div className="f-display text-white" style={{ fontSize: "clamp(28px,3.6vw,42px)", lineHeight: 1, fontWeight: 400 }}>
              <Counter to={2000} suffix="+" />
            </div>
            <div className="f-sans mt-2.5" style={{ fontSize: "9px", letterSpacing: "2.5px", color: "rgba(255,255,255,0.45)", textTransform: "uppercase", fontWeight: 500 }}>{t({ ar: "عميل", en: "Clients" })}</div>
          </div>
          <div className="text-center py-6 px-4" style={{ background: "rgba(0,0,0,0.88)" }}>
            <div className="f-display text-white" style={{ fontSize: "clamp(28px,3.6vw,42px)", lineHeight: 1, fontWeight: 400 }}>
              <Counter to={4000} suffix="+" />
            </div>
            <div className="f-sans mt-2.5" style={{ fontSize: "9px", letterSpacing: "2.5px", color: "rgba(255,255,255,0.45)", textTransform: "uppercase", fontWeight: 500 }}>{t({ ar: "إنتاج مكتمل", en: "Productions" })}</div>
          </div>
          <div className="text-center py-6 px-4" style={{ background: "rgba(0,0,0,0.88)" }}>
            <div className="f-display text-white" style={{ fontSize: "clamp(28px,3.6vw,42px)", lineHeight: 1, fontWeight: 400 }}>
              <Counter to={10} suffix="+" />
            </div>
            <div className="f-sans mt-2.5" style={{ fontSize: "9px", letterSpacing: "2.5px", color: "rgba(255,255,255,0.45)", textTransform: "uppercase", fontWeight: 500 }}>{t({ ar: "سنوات خبرة", en: "Years" })}</div>
          </div>
          <div className="text-center py-6 px-4" style={{ background: "rgba(0,0,0,0.88)" }}>
            <div className="text-white" style={{ fontSize: "clamp(18px,2.3vw,24px)", lineHeight: 1.1, fontWeight: 700, fontFamily: isAr ? "var(--arabic-display)" : "var(--display)", letterSpacing: isAr ? "0" : "1px" }}>
              {t({ ar: "كل المناطق", en: "ALL REGIONS" })}
            </div>
            <div className="f-sans mt-2.5" style={{ fontSize: "9px", letterSpacing: "2.5px", color: "rgba(255,255,255,0.45)", textTransform: "uppercase", fontWeight: 500 }}>{t({ ar: "السعودية وخارجها", en: "Saudi & Beyond" })}</div>
          </div>
        </motion.div>
      </div>

      {/* Showreel modal (kept for direct trigger if needed elsewhere) */}
      {reel && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} onClick={() => setReel(false)}
          style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.96)", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: "1100px" }}>
            <button onClick={() => setReel(false)} className="f-sans" style={{ display: "block", marginInlineStart: "auto", marginBottom: "16px", background: "none", border: "none", color: "rgba(255,255,255,0.7)", fontSize: "12px", letterSpacing: "2px", cursor: "pointer" }}>✕ CLOSE</button>
            <div className="yt" style={{ border: "1px solid rgba(255,255,255,0.1)" }}>
              <iframe src={`https://www.youtube.com/embed/${SHOWREEL_ID}?autoplay=1&rel=0`} title="Showreel" allowFullScreen allow="autoplay; encrypted-media; picture-in-picture" />
            </div>
          </div>
        </motion.div>
      )}

      {/* Scroll cue */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 z-10 pointer-events-none">
        <span className="f-sans" style={{ fontSize: "8px", letterSpacing: "4px", textTransform: "uppercase", color: "rgba(255,255,255,0.25)" }}>Scroll</span>
        <div style={{ width: "1px", height: "44px", background: "linear-gradient(to bottom, rgba(255,255,255,0.4), transparent)" }} className="animate-pulse" />
      </div>
    </section>
  );
}
