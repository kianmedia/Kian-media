"use client";
import { motion } from "framer-motion";
import { useI18n } from "@/lib/i18n";

type Platform = { name: string; handle: string; url: string; color: string; svg: JSX.Element };

const PLATFORMS: Platform[] = [
  {
    name: "YouTube",
    handle: "@kianalebtikar",
    url: "https://www.youtube.com/@kianalebtikar",
    color: "#FF0000",
    svg: (
      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M23 12s0-3.8-.5-5.6c-.3-1-1-1.8-2-2C18.7 4 12 4 12 4s-6.7 0-8.5.4c-1 .2-1.7 1-2 2C1 8.2 1 12 1 12s0 3.8.5 5.6c.3 1 1 1.8 2 2C5.3 20 12 20 12 20s6.7 0 8.5-.4c1-.2 1.7-1 2-2 .5-1.8.5-5.6.5-5.6zM10 15.5v-7l6 3.5-6 3.5z" /></svg>
    ),
  },
  {
    name: "Instagram",
    handle: "@kian.alebtikar",
    url: "https://www.instagram.com/kian.alebtikar",
    color: "#E1306C",
    svg: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="3" y="3" width="18" height="18" rx="5" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="17.5" cy="6.5" r="1" fill="currentColor" />
      </svg>
    ),
  },
  {
    name: "TikTok",
    handle: "@kianmedia1",
    url: "https://www.tiktok.com/@kianmedia1",
    color: "#fff",
    svg: (
      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.6 6.3a4.7 4.7 0 01-2.7-1.2 4.7 4.7 0 01-1.3-3.1h-3.4v14.2a2.6 2.6 0 11-2.6-2.6c.3 0 .5 0 .8.1V10.2a6 6 0 105.2 6V9.4a8 8 0 004 1.2V7.2a4.7 4.7 0 01-.0-0.9z" /></svg>
    ),
  },
  {
    name: "Snapchat",
    handle: "@kianmedia",
    url: "https://www.snapchat.com/add/kianmedia",
    color: "#FFFC00",
    svg: (
      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2c3.4 0 5.5 2.3 5.5 5.5l-.1 2.4 1.7.8s.4.2.4.6c0 .5-.6.7-1.2 1l-1 .4c.1.3.5 1.4 1.6 2.4.9.9 2 1.1 2 1.6 0 .4-.5.6-1 .8-.7.2-1.5.2-1.7.5-.2.3-.3 1-.7 1.2-.3.1-.7 0-1.2-.1-.6-.1-1.4-.3-2.2 0-.5.2-.9.6-1.5 1-.6.4-1.3.9-2.6.9s-2-.5-2.6-.9c-.6-.4-1-.8-1.5-1-.8-.3-1.6-.1-2.2 0-.5.1-.9.2-1.2.1-.4-.2-.5-.9-.7-1.2-.2-.3-1-.3-1.7-.5-.5-.2-1-.4-1-.8 0-.5 1.1-.7 2-1.6 1.1-1 1.5-2.1 1.6-2.4l-1-.4c-.6-.3-1.2-.5-1.2-1 0-.4.4-.6.4-.6L6.6 9.9l-.1-2.4C6.5 4.3 8.6 2 12 2z" /></svg>
    ),
  },
  {
    name: "LinkedIn",
    handle: "Kian Media Production",
    url: "https://www.linkedin.com/company/kian-media-production",
    color: "#0A66C2",
    svg: (
      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M4.98 3.5C4.98 4.88 3.87 6 2.5 6S0 4.88 0 3.5 1.12 1 2.5 1s2.48 1.12 2.48 2.5zM.2 8h4.59v15H.2zM8 8h4.4v2.05h.06c.61-1.16 2.1-2.38 4.32-2.38 4.62 0 5.48 3.04 5.48 7v8.33h-4.58v-7.39c0-1.76-.03-4.03-2.46-4.03-2.46 0-2.84 1.92-2.84 3.9V23H8z" /></svg>
    ),
  },
];

export default function Social() {
  const { t } = useI18n();
  return (
    <section className="relative overflow-hidden" style={{ background: "#050505", paddingTop: "140px", paddingBottom: "140px" }}>
      <div className="absolute top-0 left-0 right-0 h-px" style={{ background: "linear-gradient(to right, transparent, rgba(227,30,36,0.4), transparent)" }} />
      <div className="max-w-7xl mx-auto px-6 lg:px-12">

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.9 }}
          className="text-center mb-16"
          data-reveal
        >
          <div className="eyebrow mb-6 mx-auto">{t({ ar: "تابعنا", en: "Follow Our Work" })}</div>
          <h2 className="editorial text-white" style={{ fontSize: "clamp(30px,4.5vw,52px)" }}>
            {t({
              ar: "شاهد المزيد من إنتاجاتنا",
              en: "Watch More Productions",
            })}
            <br />
            <em>{t({
              ar: "على قناتنا في يوتيوب ومنصات التواصل",
              en: "on Our YouTube Channel & Social Platforms",
            })}</em>
          </h2>
        </motion.div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {PLATFORMS.map((p, i) => (
            <motion.a
              key={p.name}
              href={p.url}
              target="_blank"
              rel="noopener noreferrer"
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.55, delay: i * 0.07 }}
              className="group relative flex flex-col items-center justify-center text-center glass p-8 transition-all duration-500 overflow-hidden"
              style={{ minHeight: "200px" }}
            >
              {/* Color wash on hover */}
              <span className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" style={{ background: `radial-gradient(circle at center, ${p.color}22, transparent 65%)` }} />

              <div className="relative z-10 transition-all duration-500 group-hover:-translate-y-2" style={{ width: "44px", height: "44px", color: "rgba(255,255,255,0.85)" }}>
                {p.svg}
              </div>
              <div className="relative z-10 mt-5 f-sans" style={{ fontSize: "11px", letterSpacing: "3px", color: "rgba(255,255,255,0.45)", textTransform: "uppercase" }}>
                {p.name}
              </div>
              <div className="relative z-10 text-white mt-1" style={{ fontSize: "14px", fontWeight: 600 }}>
                {p.handle}
              </div>
              <div className="relative z-10 mt-3 f-sans transition-all duration-500" style={{ fontSize: "9px", letterSpacing: "2px", color: p.color === "#fff" ? "rgba(255,255,255,0.5)" : p.color, textTransform: "uppercase" }}>
                {t({ ar: "متابعة ↗", en: "Follow ↗" })}
              </div>
            </motion.a>
          ))}
        </div>
      </div>
    </section>
  );
}
