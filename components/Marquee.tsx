"use client";
import { useI18n } from "@/lib/i18n";

const ITEMS = [
  { ar: "إنتاج سينمائي",      en: "Cinematic Production" },
  { ar: "تصوير جوي ٤K",       en: "Drone Filming 4K" },
  { ar: "بثّ مباشر",          en: "Live Streaming" },
  { ar: "مونتاج احترافي",     en: "Pro Editing" },
  { ar: "تغطية فعاليات",      en: "Event Coverage" },
  { ar: "أفلام وثائقية",      en: "Documentary" },
  { ar: "إعلانات تجارية",     en: "Commercial Ads" },
  { ar: "فيلم مؤسّسي",        en: "Corporate Film" },
];

export default function Marquee() {
  const { t } = useI18n();
  // Interleave AR + EN for a polyglot effect, doubled for seamless scroll
  const seq = ITEMS.flatMap((it) => [t(it), it.en !== t(it) ? it.en : it.ar]);

  return (
    <div style={{ background: "#E31E24", borderTop: "1px solid #A51419", borderBottom: "1px solid #A51419", overflow: "hidden" }}>
      <div className="anim-mq" style={{ padding: "12px 0" }}>
        {[...seq, ...seq].map((it, i) => (
          <span key={i} className="f-sans inline-block whitespace-nowrap px-7 text-white/90"
            style={{ fontSize: "10px", letterSpacing: "4px", textTransform: "uppercase", fontWeight: 600 }}>
            {it}<span style={{ margin: "0 16px", color: "rgba(255,255,255,0.3)" }}>◆</span>
          </span>
        ))}
      </div>
    </div>
  );
}
