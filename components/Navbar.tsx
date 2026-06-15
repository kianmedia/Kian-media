"use client";
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useI18n } from "@/lib/i18n";
import LangSwitch from "@/components/LangSwitch";

const LINKS = [
  { h: "#about",     ar: "من نحن",       en: "About" },
  { h: "#services",  ar: "الخدمات",      en: "Services" },
  { h: "#portfolio", ar: "أعمالنا",      en: "Portfolio" },
  { h: "#why",       ar: "لماذا كيان",    en: "Why Us" },
  { h: "#contact",   ar: "تواصل",        en: "Contact", cta: true },
];

// Project-start dropdown items (new isolated routes)
const START_ITEMS = [
  { href: "/quote-request", ar: "اطلب عرض سعر",        en: "Request a Quote" },
  { href: "/book-meeting",  ar: "احجز موعد",           en: "Book a Meeting" },
  { href: "/upload-files",  ar: "إرسال ملفات المشروع", en: "Submit Project Files" },
];

export default function Navbar() {
  const { t } = useI18n();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [startOpen, setStartOpen] = useState(false);

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 50);
    window.addEventListener("scroll", fn, { passive: true });
    return () => window.removeEventListener("scroll", fn);
  }, []);

  const go = (e: React.MouseEvent, h: string) => {
    setOpen(false);
    // If the target section exists on the current page, smooth-scroll to it.
    // Otherwise (e.g. on /quote-request), let the browser navigate to the
    // homepage with the hash so links never become dead.
    const el = typeof document !== "undefined" ? document.querySelector(h) : null;
    if (el) {
      e.preventDefault();
      el.scrollIntoView({ behavior: "smooth" });
    } else {
      e.preventDefault();
      window.location.href = "/" + h; // -> "/#about" etc.
    }
  };

  return (
    <header
      className="fixed inset-x-0 top-0 z-50 transition-all duration-400"
      style={{
        paddingTop: scrolled ? "12px" : "20px",
        paddingBottom: scrolled ? "12px" : "20px",
        background: scrolled ? "rgba(5,5,5,0.85)" : "transparent",
        backdropFilter: scrolled ? "blur(14px)" : "none",
        WebkitBackdropFilter: scrolled ? "blur(14px)" : "none",
        borderBottom: scrolled ? "1px solid rgba(227,30,36,0.12)" : "1px solid transparent",
      }}
    >
      <nav className="max-w-7xl mx-auto px-6 lg:px-12 flex items-center justify-between">

        {/* Logo */}
        <a
          href="/"
          onClick={(e) => {
            setOpen(false);
            // On the homepage, just scroll to top. Elsewhere, let it navigate home.
            if (window.location.pathname === "/") {
              e.preventDefault();
              window.scrollTo({ top: 0, behavior: "smooth" });
            }
          }}
          className="flex items-center gap-3 group transition-opacity hover:opacity-80"
          style={{ cursor: "pointer", textDecoration: "none" }}
          aria-label="Back to homepage"
        >
          <div className="relative w-11 h-11 overflow-hidden" style={{ background: "transparent" }}>
            <img src="/logo.png" alt="Kian Media" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
          </div>
          <div className="leading-none">
            <div className="f-display tracking-[6px] text-white" style={{ fontSize: "20px" }}>KIAN</div>
            <div className="f-sans uppercase" style={{ fontSize: "7px", letterSpacing: "3px", color: "rgba(255,255,255,0.4)" }}>Media Production</div>
          </div>
        </a>

        {/* Desktop links */}
        <ul className="hidden md:flex items-center gap-6">
          {LINKS.map((l) => (
            <li key={l.h}>
              <a
                href={l.h}
                onClick={(e) => go(e, l.h)}
                className="f-sans uppercase transition-all duration-300 hover:text-white"
                style={
                  l.cta
                    ? { fontSize: "11px", letterSpacing: "2px", fontWeight: 600, color: "#E31E24", border: "1px solid #E31E24", padding: "9px 22px" }
                    : { fontSize: "11px", letterSpacing: "2px", fontWeight: 500, color: "rgba(255,255,255,0.6)" }
                }
              >
                {t({ ar: l.ar, en: l.en })}
              </a>
            </li>
          ))}
          {/* "ابدأ مشروعك" dropdown — links to new isolated routes */}
          <li
            className="relative"
            onMouseEnter={() => setStartOpen(true)}
            onMouseLeave={() => setStartOpen(false)}
          >
            <button
              className="f-sans uppercase transition-all duration-300 inline-flex items-center gap-1.5"
              style={{ fontSize: "11px", letterSpacing: "2px", fontWeight: 600, color: "#fff", background: "#E31E24", padding: "9px 18px", border: "1px solid #E31E24", cursor: "pointer" }}
              aria-haspopup="true"
              aria-expanded={startOpen}
            >
              {t({ ar: "ابدأ مشروعك", en: "Start a Project" })}
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ transform: startOpen ? "rotate(180deg)" : "none", transition: "transform 0.3s" }}><path d="M6 9l6 6 6-6" /></svg>
            </button>
            <AnimatePresence>
              {startOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
                  transition={{ duration: 0.22 }}
                  className="absolute"
                  style={{ top: "calc(100% + 8px)", insetInlineEnd: 0, minWidth: "210px", background: "rgba(10,10,10,0.97)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)", border: "1px solid rgba(227,30,36,0.2)", borderRadius: "4px", overflow: "hidden", boxShadow: "0 20px 50px -20px rgba(0,0,0,0.7)" }}
                >
                  {START_ITEMS.map((s) => (
                    <a
                      key={s.href} href={s.href}
                      className="block f-sans transition-colors duration-300"
                      style={{ fontSize: "12px", letterSpacing: "0.5px", fontWeight: 500, color: "rgba(255,255,255,0.75)", padding: "13px 18px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(227,30,36,0.12)"; e.currentTarget.style.color = "#fff"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "rgba(255,255,255,0.75)"; }}
                    >
                      {t({ ar: s.ar, en: s.en })}
                    </a>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </li>
          {/* Client Portal entry (real route, not a hash link) */}
          <li>
            <a
              href="/client-portal"
              className="f-sans uppercase transition-all duration-300 inline-flex items-center gap-1.5"
              style={{ fontSize: "11px", letterSpacing: "2px", fontWeight: 600, color: "rgba(255,255,255,0.85)", border: "1px solid rgba(255,255,255,0.25)", padding: "9px 16px" }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#E31E24"; e.currentTarget.style.color = "#fff"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.25)"; e.currentTarget.style.color = "rgba(255,255,255,0.85)"; }}
              aria-label={t({ ar: "بوابة العملاء", en: "Client Portal" })}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3" /></svg>
              {t({ ar: "بوابة العملاء", en: "Client Portal" })}
            </a>
          </li>
          <li><LangSwitch compact /></li>
        </ul>

        {/* Mobile: lang + hamburger */}
        <div className="md:hidden flex items-center gap-3">
          <LangSwitch compact />
          <button className="flex flex-col gap-[5px] w-8 z-50" onClick={() => setOpen((o) => !o)} aria-label="menu">
            {[0, 1, 2].map((i) => (
              <motion.span
                key={i}
                className="block h-[1.5px] bg-white origin-center"
                animate={open
                  ? i === 0 ? { rotate: 45, y: 6.5 } : i === 1 ? { opacity: 0 } : { rotate: -45, y: -6.5 }
                  : { rotate: 0, y: 0, opacity: 1 }}
                style={{ width: i === 1 ? (!open ? "75%" : "100%") : "100%" }}
                transition={{ duration: 0.22 }}
              />
            ))}
          </button>
        </div>
      </nav>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.28 }}
            className="md:hidden"
            style={{ background: "rgba(0,0,0,0.98)", borderTop: "1px solid rgba(227,30,36,0.2)" }}
          >
            {LINKS.map((l) => (
              <a
                key={l.h} href={l.h} onClick={(e) => go(e, l.h)}
                className="flex items-center px-6 py-4 f-sans uppercase transition-colors"
                style={{ fontSize: "13px", letterSpacing: "3px", color: l.cta ? "#E31E24" : "rgba(255,255,255,0.6)", borderBottom: "1px solid rgba(255,255,255,0.04)" }}
              >
                {t({ ar: l.ar, en: l.en })}
              </a>
            ))}
            {/* "ابدأ مشروعك" — project-start links (mobile) */}
            <div style={{ padding: "14px 24px 6px", fontSize: "10px", letterSpacing: "3px", color: "rgba(227,30,36,0.9)", textTransform: "uppercase", fontWeight: 700 }}>
              {t({ ar: "ابدأ مشروعك", en: "Start a Project" })}
            </div>
            {START_ITEMS.map((s) => (
              <a
                key={s.href} href={s.href}
                className="flex items-center px-6 py-4 f-sans"
                style={{ fontSize: "13px", letterSpacing: "1px", color: "rgba(255,255,255,0.72)", borderBottom: "1px solid rgba(255,255,255,0.04)" }}
              >
                {t({ ar: s.ar, en: s.en })}
              </a>
            ))}
            {/* Client Portal entry (mobile) */}
            <a
              href="/client-portal"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-6 py-4 f-sans uppercase"
              style={{ fontSize: "13px", letterSpacing: "2px", fontWeight: 600, color: "#fff", borderTop: "1px solid rgba(227,30,36,0.2)", background: "rgba(227,30,36,0.06)" }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3" /></svg>
              {t({ ar: "بوابة العملاء", en: "Client Portal" })}
            </a>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
