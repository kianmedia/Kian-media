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

  const wa = "https://wa.me/966503422999?text=" + encodeURIComponent(
    t({ ar: "السلام عليكم، أود الاستفسار عن خدمات كيان ميديا", en: "Hello, I'd like to inquire about Kian Media's services." })
  );

  const COLS = [
    {
      title: t({ ar: "الصفحات", en: "Navigation" }),
      links: [
        { t: t({ ar: "الرئيسية", en: "Home" }), h: "#" },
        { t: t({ ar: "من نحن", en: "About" }), h: "#about" },
        { t: t({ ar: "خدماتنا", en: "Services" }), h: "#services" },
        { t: t({ ar: "أعمالنا", en: "Portfolio" }), h: "#portfolio" },
        { t: t({ ar: "لماذا كيان", en: "Why Us" }), h: "#why" },
      ],
    },
    {
      title: t({ ar: "الخدمات", en: "Services" }),
      links: [
        { t: t({ ar: "الإنتاج السينمائي", en: "Cinematic Production" }), h: "#services" },
        { t: t({ ar: "الأفلام المؤسسية", en: "Corporate Films" }), h: "#services" },
        { t: t({ ar: "التصوير العقاري والجوي", en: "Real Estate & Aerial" }), h: "#services" },
        { t: t({ ar: "البث المباشر", en: "Live Streaming" }), h: "#services" },
        { t: t({ ar: "الأعراس الفاخرة", en: "Luxury Weddings" }), h: "#services" },
      ],
    },
    {
      title: t({ ar: "تواصل", en: "Contact" }),
      links: [
        { t: t({ ar: "المقر: الدمام", en: "HQ: Dammam" }), h: "#contact" },
        { t: "0503422999", h: "tel:+966503422999", ltr: true },
        { t: "0543553038", h: "tel:+966543553038", ltr: true },
        { t: "info@kianmedia.com", h: "mailto:info@kianmedia.com" },
        { t: t({ ar: "كل أيام الأسبوع · ٧ ص — ١١:٤٥ م", en: "All week · 7 AM – 11:45 PM" }), h: "#contact" },
      ],
    },
  ];

  return (
    <footer style={{ background: "#030303" }}>

      {/* ─── CTA Hero Block above footer ─── */}
      <div style={{ background: "#0a0a0a", borderTop: "1px solid rgba(227,30,36,0.2)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <div className="max-w-7xl mx-auto px-6 lg:px-12 py-20 lg:py-28 text-center">
          <div className="eyebrow mb-6 mx-auto">{t({ ar: "نبدأ مشروعك", en: "Start Your Project" })}</div>
          <h2 className="editorial text-white mb-6" style={{ fontSize: "clamp(30px,4.5vw,52px)" }}>
            {t({ ar: "مشروعك القادم يبدأ", en: "Your next project starts" })}{" "}
            <em>{t({ ar: "بمحادثة", en: "with a conversation" })}</em>
          </h2>
          <p className="text-white/55 mb-10" style={{ fontSize: "15px", lineHeight: 1.85, maxWidth: "560px", margin: "0 auto 40px" }}>
            {t({
              ar: "أرسل لنا تفاصيل مشروعك على واتساب وسيتواصل معك فريقنا خلال ٤ ساعات في أيام العمل.",
              en: "Send us your project details on WhatsApp and our team will reach out within 4 hours on business days.",
            })}
          </p>
          <a href={wa} target="_blank" rel="noopener noreferrer" className="btn-wa" style={{ fontSize: "14px", padding: "18px 36px" }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M17.5 14.4c-.3-.1-1.7-.8-2-1-.3-.1-.5-.1-.7.1-.2.3-.7.9-.9 1.1-.2.2-.3.2-.6.1-1.6-.8-2.7-1.4-3.8-3.2-.3-.5.3-.5.8-1.5.1-.2 0-.4 0-.5 0-.1-.7-1.7-.9-2.3-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.2.2 2.1 3.2 5.1 4.5 1.9.8 2.6.9 3.5.7.6-.1 1.7-.7 1.9-1.4.2-.7.2-1.3.2-1.4-.1-.1-.3-.2-.6-.3zM12 2C6.5 2 2 6.5 2 12c0 1.7.5 3.4 1.3 4.9L2 22l5.2-1.4c1.5.8 3.1 1.2 4.8 1.2 5.5 0 10-4.5 10-10S17.5 2 12 2z" /></svg>
            <span>{t({ ar: "تواصل عبر واتساب", en: "Message us on WhatsApp" })}</span>
          </a>
        </div>
      </div>

      {/* ─── Main footer ─── */}
      <div className="max-w-7xl mx-auto px-6 lg:px-12 pt-16 pb-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-10 mb-12">
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
                    <a href={l.h} onClick={(e) => {
                      // Hash links only work on the homepage. If the section
                      // isn't on the current page, navigate to home + hash.
                      if (l.h.indexOf("#") === 0 && typeof document !== "undefined") {
                        const sel = l.h === "#" ? null : document.querySelector(l.h);
                        if (l.h === "#") {
                          if (window.location.pathname === "/") { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); }
                          else { e.preventDefault(); window.location.href = "/"; }
                        } else if (sel) {
                          e.preventDefault(); sel.scrollIntoView({ behavior: "smooth" });
                        } else {
                          e.preventDefault(); window.location.href = "/" + l.h;
                        }
                      }
                    }} className={"text-white/45 transition-colors hover:text-white" + ((l as { ltr?: boolean }).ltr ? " phone-ltr" : "")} style={{ textDecoration: "none", fontSize: "13px", lineHeight: 1.5 }}>
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
          <div className="flex items-center gap-3">
            <a href="/privacy-policy" className="text-white/40 transition-colors hover:text-white" style={{ fontSize: "11px", textDecoration: "none" }}>
              {t({ ar: "سياسة الخصوصية", en: "Privacy Policy" })}
            </a>
            <span style={{ color: "rgba(255,255,255,0.2)" }}>·</span>
            <a href="/terms" className="text-white/40 transition-colors hover:text-white" style={{ fontSize: "11px", textDecoration: "none" }}>
              {t({ ar: "شروط الاستخدام", en: "Terms" })}
            </a>
          </div>
        </div>
        <p className="f-sans text-center" style={{ marginTop: "18px", fontSize: "9px", letterSpacing: "3px", color: "rgba(255,255,255,0.25)", textTransform: "uppercase" }}>
          {t({ ar: "الدمام · الرياض · جدة · المدينة المنورة", en: "Dammam · Riyadh · Jeddah · Madinah" })}
        </p>
      </div>
    </footer>
  );
}
