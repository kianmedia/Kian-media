"use client";
import { useI18n } from "@/lib/i18n";

// Premium service ticker — duplicated content, larger type, denser, smooth loop
const ITEMS_AR = [
  "إنتاج سينمائي",
  "إعلانات تجارية",
  "أفلام مؤسسية",
  "تصوير درون",
  "بث مباشر متعدد الكاميرات",
  "تغطية فعاليات",
  "تصوير عقاري",
  "وثائقيات",
  "بودكاست",
  "تصوير فوتوغرافي",
  "حملات سوشيال ميديا",
  "إنتاج محتوى للشركات",
];

const ITEMS_EN = [
  "Commercial Filming",
  "Corporate Films",
  "Drone Cinematography",
  "Live Streaming",
  "Event Coverage",
  "Documentary Production",
  "Real Estate Films",
  "Social Media Reels",
  "Wedding Films",
  "Brand Storytelling",
  "Product Commercials",
  "Photography",
];

export default function Marquee() {
  const { isAr } = useI18n();
  const items = isAr ? ITEMS_AR : ITEMS_EN;
  // Quadruple for very dense, gapless loop
  const loop = [...items, ...items, ...items, ...items];

  return (
    <div style={{ background: "#C1121F", borderTop: "1px solid #A51419", borderBottom: "1px solid #A51419", overflow: "hidden" }}>
      <div className="anim-mq" style={{ padding: "16px 0", gap: 0 }}>
        {loop.map((item, i) => (
          <span
            key={i}
            className="inline-flex items-center whitespace-nowrap text-white"
            style={{
              fontSize: "14px",
              letterSpacing: isAr ? "0.5px" : "3px",
              fontWeight: 700,
              textTransform: isAr ? "none" : "uppercase",
              padding: "0 28px",
              fontFamily: isAr ? "var(--arabic-display)" : "var(--sans)",
            }}
          >
            {item}
            <span style={{ marginInlineStart: "28px", color: "rgba(255,255,255,0.5)", fontSize: "10px" }}>◆</span>
          </span>
        ))}
      </div>
    </div>
  );
}
