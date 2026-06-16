"use client";
// ════════════════════════════════════════════════════════════════════════
// Small, elegant homepage announcement for the Opportunities Center. Appears
// after a short delay, dismissible, and remembers dismissal in localStorage for
// 7 days so repeat visitors aren't nagged. Lightweight (no deps, no polling).
// ════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";

const KEY = "kian_opp_promo_dismissed_at";
const SUPPRESS_DAYS = 7;

export default function OpportunityPromo() {
  const { t, isAr } = useI18n();
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const at = parseInt(raw, 10);
        if (!Number.isNaN(at) && Date.now() - at < SUPPRESS_DAYS * 86400000) return; // still suppressed
      }
    } catch { /* ignore */ }
    const id = window.setTimeout(() => setShow(true), 3000);
    return () => window.clearTimeout(id);
  }, []);

  function dismiss() {
    setShow(false);
    try { localStorage.setItem(KEY, String(Date.now())); } catch { /* ignore */ }
  }

  if (!show) return null;

  return (
    <div
      role="dialog" aria-label={isAr ? "مركز الفرص" : "Opportunities Center"}
      style={{
        position: "fixed", zIndex: 90, bottom: "20px", insetInlineEnd: "20px",
        width: "calc(100vw - 40px)", maxWidth: "340px",
        background: "#0c0c0c", border: "1px solid rgba(227,30,36,0.4)", borderRadius: "10px",
        boxShadow: "0 18px 50px rgba(0,0,0,0.6), 0 0 0 1px rgba(227,30,36,0.12)",
        padding: "18px 18px 16px", animation: "kianPromoIn 0.4s ease both",
      }}
    >
      <style>{`@keyframes kianPromoIn{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}`}</style>
      <button onClick={dismiss} aria-label={isAr ? "إغلاق" : "Close"}
        style={{ position: "absolute", top: "10px", insetInlineEnd: "10px", background: "none", border: "none", color: "rgba(255,255,255,0.55)", fontSize: "16px", lineHeight: 1, cursor: "pointer", padding: "4px" }}>✕</button>

      <div className="f-sans" style={{ fontSize: "9.5px", letterSpacing: "2px", textTransform: "uppercase", color: "#E31E24", fontWeight: 600, marginBottom: "8px" }}>
        {t({ ar: "مركز الفرص مفتوح الآن", en: "Opportunities Center is open" })}
      </div>
      <p className="text-white/80" style={{ fontSize: "13.5px", lineHeight: 1.7, marginBottom: "14px", paddingInlineEnd: "14px" }}>
        {t({
          ar: "انضم إلى كيان عبر فرص التوظيف، التدريب، التعاون، المستقلين، والموردين.",
          en: "Join Kian through jobs, training, collaboration, freelancer, and supplier opportunities.",
        })}
      </p>
      <div className="flex items-center gap-2">
        <a href="/opportunities" onClick={dismiss} className="btn-red" style={{ flex: 1, justifyContent: "center", padding: "10px 14px", fontSize: "13px" }}>
          <span>{t({ ar: "استكشف الفرص", en: "Explore Opportunities" })}</span>
        </a>
        <button onClick={dismiss} className="f-sans" style={{ fontSize: "12px", color: "rgba(255,255,255,0.5)", background: "none", border: "1px solid rgba(255,255,255,0.15)", padding: "10px 12px", borderRadius: "3px", cursor: "pointer", whiteSpace: "nowrap" }}>
          {t({ ar: "لاحقاً", en: "Later" })}
        </button>
      </div>
    </div>
  );
}
