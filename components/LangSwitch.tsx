"use client";
import { useI18n } from "@/lib/i18n";

export default function LangSwitch({ compact = false }: { compact?: boolean }) {
  const { lang, setLang } = useI18n();
  const other = lang === "ar" ? "en" : "ar";
  const label = lang === "ar" ? "EN" : "AR";
  const full = lang === "ar" ? "English" : "العربية";

  return (
    <button
      onClick={() => setLang(other)}
      className="group inline-flex items-center gap-2 transition-all duration-300"
      style={{
        background: "transparent",
        border: "1px solid rgba(255,255,255,0.18)",
        padding: compact ? "7px 12px" : "9px 14px",
        fontSize: "11px",
        letterSpacing: "2px",
        color: "rgba(255,255,255,0.85)",
        fontFamily: "var(--sans)",
        fontWeight: 500,
        cursor: "pointer",
        textTransform: "uppercase",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#E31E24"; e.currentTarget.style.color = "#fff"; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.18)"; e.currentTarget.style.color = "rgba(255,255,255,0.85)"; }}
      aria-label="Toggle language"
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18" />
      </svg>
      <span style={{ fontWeight: 700 }}>{label}</span>
      {!compact && <span style={{ opacity: 0.5, fontSize: "10px" }}>· {full}</span>}
    </button>
  );
}
