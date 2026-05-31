"use client";
import { useEffect, useState } from "react";

/**
 * Two global UX enhancers in one mountpoint:
 *  1. A thin scroll-progress bar fixed at the very top (brand red).
 *  2. A "back to top" button that fades in after scrolling down.
 *
 * Self-contained: reads window scroll, renders fixed-position elements.
 * Safe to mount once anywhere (e.g. inside Navbar) — no layout impact.
 */
export default function ScrollEnhancers() {
  const [progress, setProgress] = useState(0);
  const [showTop, setShowTop] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      const scrollTop = window.scrollY;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      const pct = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
      setProgress(pct);
      setShowTop(scrollTop > 600);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <>
      {/* Scroll progress bar */}
      <div
        aria-hidden="true"
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          height: "2px",
          width: `${progress}%`,
          background: "linear-gradient(to right, #A51419, #E31E24)",
          zIndex: 9999,
          transition: "width 0.1s linear",
          boxShadow: "0 0 8px rgba(227,30,36,0.5)",
          pointerEvents: "none",
        }}
      />

      {/* Back to top button */}
      <button
        onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        aria-label="Back to top"
        style={{
          position: "fixed",
          bottom: "92px", // sits above the WhatsApp float
          insetInlineEnd: "24px",
          width: "44px",
          height: "44px",
          borderRadius: "50%",
          background: "rgba(10,10,10,0.85)",
          border: "1px solid rgba(227,30,36,0.4)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          zIndex: 90,
          opacity: showTop ? 1 : 0,
          transform: showTop ? "translateY(0)" : "translateY(12px)",
          pointerEvents: showTop ? "auto" : "none",
          transition: "opacity 0.4s ease, transform 0.4s cubic-bezier(0.16,1,0.3,1), border-color 0.3s",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#E31E24"; e.currentTarget.style.background = "rgba(227,30,36,0.15)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(227,30,36,0.4)"; e.currentTarget.style.background = "rgba(10,10,10,0.85)"; }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 19V5M5 12l7-7 7 7" />
        </svg>
      </button>
    </>
  );
}
