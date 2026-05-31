"use client";
import { useI18n } from "@/lib/i18n";

// Expanded service list — 24 items per language for dense, gapless loop
const ITEMS_AR = [
  "إنتاج سينمائي",
  "إعلانات تجارية",
  "أفلام مؤسسية",
  "تصوير جوي بالدرون",
  "بث مباشر متعدد الكاميرات",
  "تغطية فعاليات",
  "تصوير عقاري",
  "أفلام وثائقية",
  "إنتاج بودكاست",
  "تصوير فوتوغرافي",
  "حملات سوشيال ميديا",
  "إنتاج محتوى للشركات",
  "إعلانات منتجات",
  "سرد قصص العلامات",
  "إخراج إبداعي",
  "تصوير المشاريع الكبرى",
  "أفلام أعراس فاخرة",
  "إنتاجات حكومية",
  "تصوير المعارض",
  "تغطية المؤتمرات",
  "تصوير الافتتاحات",
  "محتوى ريلز وشورتس",
  "معالجة لونية احترافية",
  "موشن جرافيك",
];

const ITEMS_EN = [
  "Cinematic Production",
  "Commercial Filming",
  "Corporate Films",
  "Drone Cinematography",
  "Multi-Camera Live Streaming",
  "Event Coverage",
  "Real Estate Films",
  "Documentary Production",
  "Podcast Production",
  "Photography",
  "Social Media Campaigns",
  "Branded Content",
  "Product Commercials",
  "Brand Storytelling",
  "Creative Direction",
  "Project Cinematography",
  "Luxury Wedding Films",
  "Government Productions",
  "Exhibition Coverage",
  "Conference Coverage",
  "Opening Ceremonies",
  "Reels & Shorts",
  "Color Grading",
  "Motion Graphics",
];

export default function Marquee() {
  const { isAr } = useI18n();
  const items = isAr ? ITEMS_AR : ITEMS_EN;

  // Build ONE block that's guaranteed wider than any viewport (repeat base list
  // 2× → ~48 items per block), then duplicate the block once. The animation moves
  // exactly -50% (one full block), so the second block seamlessly takes its place —
  // the strip is NEVER empty, on any screen width.
  const block = [...items, ...items];
  const loop = [...block, ...block];

  return (
    <div
      // Force LTR on the marquee wrapper regardless of page direction.
      // This is what fixes the Arabic-mode "going backwards" feeling:
      // the animation always moves text in the same physical direction.
      dir="ltr"
      style={{
        background: "#E31E24",
        borderTop: "1px solid #A51419",
        borderBottom: "1px solid #A51419",
        overflow: "hidden",
      }}
    >
      <div className="anim-mq" style={{ padding: "16px 0" }}>
        {loop.map((item, i) => (
          <span
            key={i}
            className="inline-flex items-center whitespace-nowrap text-white"
            style={{
              fontSize: "14px",
              letterSpacing: isAr ? "0.5px" : "3px",
              fontWeight: 700,
              textTransform: isAr ? "none" : "uppercase",
              padding: "0 24px",
              fontFamily: isAr ? "var(--arabic-display)" : "var(--sans)",
              // Important: the *text itself* respects its own direction so
              // Arabic words read correctly, even though the outer container is LTR.
              direction: isAr ? "rtl" : "ltr",
            }}
          >
            {item}
            <span
              style={{
                marginInlineStart: "24px",
                color: "rgba(255,255,255,0.55)",
                fontSize: "10px",
                direction: "ltr",
              }}
            >
              ◆
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
