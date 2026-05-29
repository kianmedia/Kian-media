"use client";
import { motion, AnimatePresence } from "framer-motion";
import { useState, useMemo } from "react";
import { useI18n } from "@/lib/i18n";

type Item = {
  id: number;
  ar: string;
  en: string;
  cat: string;
  yt: string;
  featured?: boolean;
};

const CATEGORIES = [
  { key: "all",         ar: "كل الأعمال",    en: "All",          icon: "✦" },
  { key: "events",      ar: "تغطية فعاليات", en: "Events",       icon: "🎪" },
  { key: "documentary", ar: "أفلام وثائقية", en: "Documentary",  icon: "🎞" },
  { key: "corporate",   ar: "أعمال الشركات", en: "Corporate",    icon: "🏢" },
  { key: "realestate",  ar: "تصوير عقاري",    en: "Real Estate",  icon: "🚁" },
  { key: "weddings",    ar: "أعراس",          en: "Weddings",     icon: "💍" },
  { key: "art",         ar: "أعمال فنية",     en: "Art & Music",  icon: "🎵" },
];

const ITEMS: Item[] = [
  { id: 1,  ar: "تصوير جوي وسينمائي للمشاريع العقارية", en: "Aerial & Cinematic Real Estate Filming", cat: "realestate", yt: "eG7K22u6xEU", featured: true },
  { id: 2,  ar: "تغطية مهرجان أفلام السعودية ١١",       en: "Saudi Film Festival 11 Coverage",        cat: "events", yt: "Tp4m2EA1C3o" },
  { id: 3,  ar: "تغطية مهرجان وندر هيلز",                en: "Wonder Hills Event Coverage",            cat: "events", yt: "We8sFkpd1b0" },
  { id: 4,  ar: "اليوم الوطني ٩٥ — شركة الزاهد",        en: "Saudi National Day 95 — Al-Zahid",       cat: "events", yt: "CpYYwiEDOJ4" },
  { id: 5,  ar: "افتتاح معهد سين للتمثيل بالخبر",       en: "Seen Acting Institute Opening — Khobar", cat: "events", yt: "v8kNCrZysEM" },
  { id: 6,  ar: "تغطية فعاليات — لقطات سينمائية",       en: "Event Coverage — Cinematic Shots",       cat: "events", yt: "Zs1yheEgEzw" },
  { id: 7,  ar: "تغطية مهرجان أفلام السعودية ١١",       en: "Saudi Film Festival 11 — Coverage",      cat: "events", yt: "voeIqpOlmqk" },
  { id: 8,  ar: "تغطية حفلات التقاعد",                  en: "Retirement Celebrations Coverage",       cat: "events", yt: "A6nsilreOHo" },
  { id: 9,  ar: "وثائقي البيت القطيفي",                 en: "Qatif House Documentary",                cat: "documentary", yt: "vPaH2dnBiFA", featured: true },
  { id: 10, ar: "وثائقي البخنق التاريخي",               en: "Al-Bakhnaq Historical Documentary",      cat: "documentary", yt: "muzsqmUzA0k" },
  { id: 11, ar: "وثائقي البيت القطيفي — ج٢",            en: "Qatif House Documentary — Part 2",       cat: "documentary", yt: "se5_3BW-9FY" },
  { id: 12, ar: "وثائقي الحوي التاريخي",                en: "Al-Huwi Historical Documentary",         cat: "documentary", yt: "4Lhm-2Gne7Q" },
  { id: 13, ar: "وثائقي الدروازة التاريخي",             en: "Al-Darwazah Historical Documentary",     cat: "documentary", yt: "totRI62nzRs" },
  { id: 14, ar: "وثائقي الدروازة — ج٢",                 en: "Al-Darwazah Documentary — Part 2",       cat: "documentary", yt: "YCCEQhRdmd8" },
  { id: 15, ar: "برومو شركة العطيشان × ريو ميديا",      en: "Al-Otaishan Promo × Rio Media",          cat: "corporate", yt: "XMjZBgROUIg" },
  { id: 16, ar: "برومو شركة ريفايفا × ألوان الحياة",    en: "Reviva Promo × Alwan Al-Hayah",          cat: "corporate", yt: "F0MTiYeWZyw" },
  { id: 17, ar: "افتتاح فرع مسكوب بالجبيل",             en: "Miskob Jubail Branch Opening",           cat: "corporate", yt: "naAnvH5DoM0" },
  { id: 18, ar: "إيفنت شركة عبدالواحد",                 en: "Abdulwahid Company Event",               cat: "corporate", yt: "DwXwknux7kw" },
  { id: 19, ar: "برومو تصوير الأعراس",                  en: "Wedding Videography Promo",              cat: "weddings", yt: "YcsbeqHlm9I", featured: true },
  { id: 20, ar: "فيديو كليب سينمائي",                   en: "Cinematic Music Video",                  cat: "art", yt: "vVeFXeJTTm0", featured: true },
];

function Card({ item, idx, onOpen }: { item: Item; idx: number; onOpen: (yt: string) => void }) {
  const { t } = useI18n();
  const meta = CATEGORIES.find((c) => c.key === item.cat);
  return (
    <motion.button
      layout
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1], delay: (idx % 3) * 0.05 }}
      onClick={() => onOpen(item.yt)}
      className="group relative block w-full overflow-hidden"
      style={{ aspectRatio: "16/10", border: "1px solid rgba(227,30,36,0.1)", background: "#070707", cursor: "pointer" }}
    >
      <img
        src={`https://i.ytimg.com/vi/${item.yt}/hqdefault.jpg`}
        alt={t({ ar: item.ar, en: item.en })}
        loading="lazy"
        className="absolute inset-0 w-full h-full object-cover transition-all duration-700 group-hover:scale-110"
        style={{ opacity: 0.5 }}
      />
      <div className="absolute inset-0 transition-opacity duration-500" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.4) 50%, rgba(0,0,0,0.1) 100%)" }} />
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500" style={{ background: "linear-gradient(to top, rgba(227,30,36,0.22), transparent 60%)" }} />

      <div className="absolute inset-0 flex items-center justify-center">
        <span className="flex items-center justify-center transition-all duration-400 group-hover:scale-110" style={{ width: "58px", height: "58px", borderRadius: "50%", background: "rgba(227,30,36,0.9)", boxShadow: "0 8px 32px rgba(227,30,36,0.5)" }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff"><path d="M5 3l16 9-16 9z" /></svg>
        </span>
      </div>

      <div className="absolute bottom-0 right-0 left-0 p-5">
        <span className="f-sans inline-block mb-2" style={{ fontSize: "8px", letterSpacing: "2.5px", color: "rgba(227,30,36,0.95)", textTransform: "uppercase", padding: "3px 8px", border: "1px solid rgba(227,30,36,0.3)", background: "rgba(227,30,36,0.08)" }}>
          {meta?.icon} {t({ ar: meta?.ar || "", en: meta?.en || "" })}
        </span>
        <h3 className="text-white" style={{ fontSize: "15px", fontWeight: 600, lineHeight: 1.3 }}>{t({ ar: item.ar, en: item.en })}</h3>
      </div>

      <span className="absolute top-0 right-0 transition-all duration-500 group-hover:w-12 group-hover:h-12" style={{ width: "0", height: "0", borderTop: "2px solid #E31E24", borderRight: "2px solid #E31E24" }} />
    </motion.button>
  );
}

export default function Portfolio() {
  const { t } = useI18n();
  const [active, setActive] = useState("all");
  const [open, setOpen] = useState<string | null>(null);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: ITEMS.length };
    for (const it of ITEMS) c[it.cat] = (c[it.cat] || 0) + 1;
    return c;
  }, []);

  const shown = active === "all" ? ITEMS : ITEMS.filter((i) => i.cat === active);

  return (
    <section id="portfolio" className="relative overflow-hidden" style={{ background: "#000", paddingTop: "140px", paddingBottom: "140px" }}>
      <div className="absolute top-1/4 left-0 pointer-events-none" style={{ width: "40vw", height: "40vh", background: "radial-gradient(circle, rgba(227,30,36,0.05), transparent 70%)" }} />

      <div className="max-w-7xl mx-auto px-6 lg:px-12 relative z-10">
        <div className="mb-10 text-center" data-reveal>
          <div className="eyebrow mb-5 mx-auto">{t({ ar: "أعمالنا", en: "Portfolio" })}</div>
          <h2 className="editorial text-white" style={{ fontSize: "clamp(34px,5vw,58px)" }}>
            {t({ ar: "جزء من", en: "A glimpse of" })}{" "}
            <em>{t({ ar: "أعمالنا", en: "our work" })}</em>
            {" "}
            {t({ ar: "السينمائية", en: "in cinematic production" })}.
          </h2>
        </div>

        <div className="flex flex-wrap gap-2 justify-center mb-10" data-reveal>
          {CATEGORIES.map((c) => {
            const on = active === c.key;
            const n = counts[c.key] || 0;
            if (n === 0) return null;
            return (
              <button
                key={c.key}
                onClick={() => setActive(c.key)}
                className="f-sans flex items-center gap-2 transition-all duration-300"
                style={{
                  fontSize: "11px", letterSpacing: "1.5px", padding: "9px 16px",
                  border: "1px solid " + (on ? "#E31E24" : "rgba(255,255,255,0.12)"),
                  background: on ? "rgba(227,30,36,0.14)" : "transparent",
                  color: on ? "#fff" : "rgba(255,255,255,0.5)",
                  cursor: "pointer",
                }}
              >
                <span style={{ fontSize: "12px" }}>{c.icon}</span>
                {t({ ar: c.ar, en: c.en })}
                <span className="f-sans" style={{ fontSize: "9px", opacity: 0.6, background: on ? "rgba(227,30,36,0.4)" : "rgba(255,255,255,0.1)", padding: "1px 6px", borderRadius: "10px" }}>{n}</span>
              </button>
            );
          })}
        </div>

        <motion.div layout className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <AnimatePresence mode="popLayout">
            {shown.map((item, idx) => <Card key={item.id} item={item} idx={idx} onOpen={setOpen} />)}
          </AnimatePresence>
        </motion.div>

        <div className="text-center mt-14" data-reveal>
          <a href="https://www.youtube.com/@kianalebtikar" target="_blank" rel="noopener noreferrer" className="btn-ghost inline-flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M23 12s0-3.8-.5-5.6c-.3-1-1-1.8-2-2C18.7 4 12 4 12 4s-6.7 0-8.5.4c-1 .2-1.7 1-2 2C1 8.2 1 12 1 12s0 3.8.5 5.6c.3 1 1 1.8 2 2C5.3 20 12 20 12 20s6.7 0 8.5-.4c1-.2 1.7-1 2-2 .5-1.8.5-5.6.5-5.6zM10 15.5v-7l6 3.5-6 3.5z" /></svg>
            {t({ ar: "شاهد المزيد على يوتيوب", en: "Watch More on YouTube" })}
          </a>
        </div>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(null)} style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,0.93)", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
            <motion.div initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.92, opacity: 0 }} onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: "920px" }}>
              <button onClick={() => setOpen(null)} className="f-sans" style={{ display: "block", marginInlineStart: "auto", marginBottom: "12px", background: "none", border: "none", color: "rgba(255,255,255,0.6)", fontSize: "13px", letterSpacing: "2px", cursor: "pointer" }}>✕ CLOSE</button>
              <div className="yt" style={{ border: "1px solid rgba(227,30,36,0.3)", boxShadow: "0 28px 80px rgba(227,30,36,0.2)" }}>
                <iframe src={`https://www.youtube.com/embed/${open}?autoplay=1&rel=0&controls=1`} title="Kian Media" allowFullScreen allow="autoplay; encrypted-media; picture-in-picture" />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
