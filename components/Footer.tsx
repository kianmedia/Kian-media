"use client";
import { useI18n } from "@/lib/i18n";

const SOCIALS = [
  { label: "Instagram", short: "IG", url: "https://www.instagram.com/kian.alebtikar" },
  { label: "YouTube",   short: "YT", url: "https://www.youtube.com/@kianalebtikar" },
  { label: "TikTok",    short: "TK", url: "https://www.tiktok.com/@kianmedia1" },
  { label: "Snapchat",  short: "SC", url: "https://www.snapchat.com/add/kianmedia" },
  { label: "LinkedIn",  short: "LI", url: "https://www.linkedin.com/company/kian-media-production" },
];

export default function Footer() {
  const { t } = useI18n();

  const COLS = [
    {
      title: t({ ar: "الصفحات", en: "Navigation" }),
      links: [
        { t: t({ ar: "الرئيسية", en: "Home" }), h: "#" },
        { t: t({ ar: "من نحن", en: "About" }), h: "#about" },
        { t: t({ ar: "خدماتنا", en: "Services" }), h: "#services" },
        { t: t({ ar: "أعمالنا", en: "Portfolio" }), h: "#portfolio" },
      ],
    },
    {
      title: t({ ar: "الخدمات", en: "Services" }),
      links: [
        { t: t({ ar: "الإنتاج السينمائي", en: "Cinematic Production" }), h: "#services" },
        { t: t({ ar: "التصوير الجوي", en: "Drone Filming" }), h: "#services" },
        { t: t({ ar: "البثّ المباشر", en: "Live Streaming" }), h: "#services" },
        { t: t({ ar: "الأعراس الفاخرة", en: "Luxury Weddings" }), h: "#services" },
        { t: t({ ar: "الفعاليات", en: "Event Coverage" }), h: "#services" },
      ],
    },
    {
      title: t({ ar: "تواصل", en: "Contact" }),
      links: [
        { t: t({ ar: "المقر: المنطقة الشرقية — الدمام", en: "HQ: Eastern Province — Dammam" }), h: "#contact" },
        { t: "+966 50 342 2999", h: "tel:+966503422999" },
        { t: "+966 54 355 3038", h: "tel:+966543553038" },
        { t: "info@kianmedia.com", h: "mailto:info@kianmedia.com" },
        { t: "sales@kianmedia.com", h: "mailto:sales@kianmedia.com" },
      ],
    },
  ];

  return (
    <footer style={{ background: "#030303", borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: "70px", paddingBottom: "32px" }}>
      <div className="max-w-7xl mx-auto px-6 lg:px-12">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-10 mb-14">
          <div>
            <div className="flex items-center gap-3 mb-5">
              <div className="relative" style={{ width: "52px", height: "52px" }}>
                <img src="/logo.png" alt="Kian Media" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
              </div>
              <div className="f-display text-white" style={{ fontSize: "20px", letterSpacing: "5px" }}>KIAN MEDIA</div>
            </div>
            <p className="text-white/40 mb-5" style={{ fontSize: "13px", lineHeight: 1.8, maxWidth: "270px" }}>
              {t({
                ar: "كيان الابتكار للإنتاج الفني — محتوى بصري سينمائي بمعايير دولية. نخدم جميع مناطق المملكة، بالإضافة إلى الإنتاجات خارج المملكة.",
                en: "Kian Al Ebtikar Art Production — cinematic visual content at international standards. Serving all regions of Saudi Arabia, plus productions beyond the Kingdom.",
              })}
            </p>
            <div className="flex gap-2 flex-wrap">
              {SOCIALS.map((s) => (
                <a
                  key={s.short}
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="f-sans flex items-center justify-center text-white/40 transition-all"
                  style={{ width: "34px", height: "34px", border: "1px solid rgba(255,255,255,0.15)", fontSize: "9px", fontWeight: 700, textDecoration: "none" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.borderColor = "#E31E24"; (e.currentTarget as HTMLAnchorElement).style.color = "#E31E24"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.borderColor = "rgba(255,255,255,0.15)"; (e.currentTarget as HTMLAnchorElement).style.color = "rgba(255,255,255,0.4)"; }}
                  aria-label={s.label}
                >
                  {s.short}
                </a>
              ))}
            </div>
          </div>

          {COLS.map((col) => (
            <div key={col.title}>
              <h4 className="f-sans mb-5" style={{ fontSize: "9px", letterSpacing: "4px", color: "rgba(255,255,255,0.7)", textTransform: "uppercase", fontWeight: 600 }}>
                {col.title}
              </h4>
              <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: "10px", padding: 0 }}>
                {col.links.map((l) => (
                  <li key={l.t}>
                    <a href={l.h} className="text-white/45 transition-colors hover:text-white" style={{ textDecoration: "none", fontSize: "13px", lineHeight: 1.5 }}>
                      {l.t}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="pt-8 flex flex-wrap items-center justify-between gap-4" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
          <p className="text-white/30" style={{ fontSize: "11px" }}>
            © {new Date().getFullYear()} Kian Al Ebtikar Art Production. {t({ ar: "جميع الحقوق محفوظة.", en: "All rights reserved." })}
          </p>
          <p className="f-sans" style={{ fontSize: "9px", letterSpacing: "3px", color: "rgba(255,255,255,0.3)", textTransform: "uppercase" }}>
            {t({ ar: "الدمام · الرياض · جدة · المدينة المنورة", en: "Dammam · Riyadh · Jeddah · Madinah" })}
          </p>
        </div>
      </div>
    </footer>
  );
}
