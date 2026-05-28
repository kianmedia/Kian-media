"use client";
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

const LINKS = [
  { h: "#showreel",  l: "Showreel" },
  { h: "#services",  l: "Services" },
  { h: "#portfolio", l: "Portfolio" },
  { h: "#why",       l: "Why Us" },
  { h: "#contact",   l: "Contact", cta: true },
];

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 50);
    window.addEventListener("scroll", fn, { passive: true });
    return () => window.removeEventListener("scroll", fn);
  }, []);

  const go = (e: React.MouseEvent, h: string) => {
    e.preventDefault();
    setOpen(false);
    document.querySelector(h)?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <header
      className="fixed inset-x-0 top-0 z-50 transition-all duration-400"
      style={{
        paddingTop: scrolled ? "12px" : "22px",
        paddingBottom: scrolled ? "12px" : "22px",
        background: scrolled ? "rgba(5,5,5,0.85)" : "transparent",
        backdropFilter: scrolled ? "blur(14px)" : "none",
        WebkitBackdropFilter: scrolled ? "blur(14px)" : "none",
        borderBottom: scrolled ? "1px solid rgba(227,30,36,0.12)" : "1px solid transparent",
      }}
    >
      <nav className="max-w-7xl mx-auto px-6 lg:px-12 flex items-center justify-between">

        {/* Logo */}
        <a href="#" onClick={(e) => go(e, "#")} className="flex items-center gap-3 group">
          <div className="relative w-11 h-11 overflow-hidden" style={{ background: "#000", border: "1px solid rgba(227,30,36,0.3)" }}>
            <img src="/logo.png" alt="Kian Media" style={{ width: "100%", height: "100%", objectFit: "contain", padding: "3px" }} />
          </div>
          <div className="leading-none">
            <div className="f-display tracking-[6px] text-white" style={{ fontSize: "20px" }}>KIAN</div>
            <div className="f-sans uppercase" style={{ fontSize: "7px", letterSpacing: "3px", color: "rgba(255,255,255,0.4)" }}>Media Production</div>
          </div>
        </a>

        {/* Desktop links */}
        <ul className="hidden md:flex items-center gap-8">
          {LINKS.map((l) => (
            <li key={l.h}>
              <a
                href={l.h}
                onClick={(e) => go(e, l.h)}
                className="f-sans uppercase transition-all duration-300"
                style={
                  l.cta
                    ? { fontSize: "11px", letterSpacing: "2px", fontWeight: 600, color: "#E31E24", border: "1px solid #E31E24", padding: "9px 22px" }
                    : { fontSize: "11px", letterSpacing: "2px", fontWeight: 500, color: "rgba(255,255,255,0.6)" }
                }
              >
                {l.l}
              </a>
            </li>
          ))}
        </ul>

        {/* Hamburger */}
        <button className="md:hidden flex flex-col gap-[5px] w-8 z-50" onClick={() => setOpen((o) => !o)} aria-label="menu">
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
      </nav>

      {/* Mobile drawer */}
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
                {l.l}
              </a>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
