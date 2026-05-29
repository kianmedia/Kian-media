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
  needsTitleReview?: boolean; // marks items where title was inferred
};

const CATEGORIES = [
  { key: "all",         ar: "كل الأعمال",     en: "All",                  icon: "✦" },
  { key: "corporate",   ar: "أعمال الشركات",  en: "Corporate",            icon: "◆" },
  { key: "commercial",  ar: "إعلانات تجارية", en: "Commercial",           icon: "◆" },
  { key: "drone",       ar: "تصوير جوي",      en: "Drone Cinematography", icon: "◆" },
  { key: "events",      ar: "تغطية فعاليات",  en: "Events",               icon: "◆" },
  { key: "realestate",  ar: "تصوير عقاري",    en: "Real Estate",          icon: "◆" },
  { key: "documentary", ar: "أفلام وثائقية",  en: "Documentary",          icon: "◆" },
  { key: "weddings",    ar: "أعراس",          en: "Weddings",             icon: "◆" },
  { key: "social",      ar: "محتوى سوشيال",   en: "Social",               icon: "◆" },
  { key: "cinematic",   ar: "إنتاج سينمائي",   en: "Cinematic",            icon: "◆" },
];

const ITEMS: Item[] = [
  // ─── Strongest cinematic / featured pieces first ───
  { id:  1, yt: "eG7K22u6xEU", cat: "realestate",  featured: true,
    ar: "تصوير جوي وسينمائي للمشاريع العقارية",   en: "Aerial & Cinematic Real Estate Filming" },
  { id:  2, yt: "vPaH2dnBiFA", cat: "documentary", featured: true,
    ar: "وثائقي البيت القطيفي",                   en: "Qatif House Documentary" },
  { id:  3, yt: "YcsbeqHlm9I", cat: "weddings",    featured: true,
    ar: "برومو تصوير الأعراس",                    en: "Wedding Videography Promo" },
  { id:  4, yt: "vVeFXeJTTm0", cat: "cinematic",   featured: true,
    ar: "فيديو كليب سينمائي",                     en: "Cinematic Music Video" },

  // ─── New videos (titles inferred — please review) ───
  { id:  5, yt: "eroGztKVLwY", cat: "cinematic",  needsTitleReview: true,
    ar: "إنتاج سينمائي — مشروع مميز",             en: "Cinematic Production — Featured" },
  { id:  6, yt: "MIs6GbXBxV4", cat: "commercial", needsTitleReview: true,
    ar: "إعلان تجاري سينمائي",                    en: "Cinematic Commercial Ad" },
  { id:  7, yt: "BlB2YGo1T3U", cat: "corporate",  needsTitleReview: true,
    ar: "فيلم مؤسسي — برومو شركة",                en: "Corporate Film — Company Promo" },
  { id:  8, yt: "IPaDI1hcupo", cat: "events",     needsTitleReview: true,
    ar: "تغطية فعالية كبرى",                      en: "Major Event Coverage" },
  { id:  9, yt: "zTf-qf0ml4c", cat: "drone",      needsTitleReview: true,
    ar: "تصوير جوي بالدرون",                      en: "Drone Cinematography" },
  { id: 10, yt: "robGTKwobn0", cat: "corporate",  needsTitleReview: true,
    ar: "إنتاج للشركات",                          en: "Corporate Production" },
  { id: 11, yt: "cUgTk6do7mA", cat: "events",     needsTitleReview: true,
    ar: "تغطية فعالية",                           en: "Event Coverage" },
  { id: 12, yt: "mGO5WGSeZTQ", cat: "commercial", needsTitleReview: true,
    ar: "إعلان منتج",                             en: "Product Commercial" },
  { id: 13, yt: "9o8HL_IZjFA", cat: "corporate",  needsTitleReview: true,
    ar: "إنتاج مؤسسي",                            en: "Corporate Production" },
  { id: 14, yt: "z7S6YWiO6xw", cat: "events",     needsTitleReview: true,
    ar: "تغطية فعالية",                           en: "Event Coverage" },
  { id: 15, yt: "2xNe8PbjmZE", cat: "commercial", needsTitleReview: true,
    ar: "حملة إعلانية",                           en: "Commercial Campaign" },
  { id: 16, yt: "u-5S5jkRk0c", cat: "social",     needsTitleReview: true,
    ar: "محتوى سوشيال ميديا",                     en: "Social Media Production" },
  { id: 17, yt: "1MFZP6WZx3E", cat: "cinematic",  needsTitleReview: true,
    ar: "إنتاج سينمائي",                          en: "Cinematic Production" },
  { id: 18, yt: "k7WQOJbUSB8", cat: "drone",      needsTitleReview: true,
    ar: "تصوير جوي سينمائي",                      en: "Aerial Cinematography" },
  { id: 19, yt: "EjOMCO9pA6E", cat: "events",     needsTitleReview: true,
    ar: "تغطية فعالية",                           en: "Event Coverage" },
  { id: 20, yt: "GIyi34PPFG8", cat: "corporate",  needsTitleReview: true,
    ar: "إنتاج مؤسسي",                            en: "Corporate Production" },
  { id: 21, yt: "WBguEl44X3o", cat: "cinematic",  needsTitleReview: true,
    ar: "إنتاج سينمائي",                          en: "Cinematic Production" },

  // ─── Existing portfolio (confirmed from old site) ───
  { id: 22, yt: "Tp4m2EA1C3o", cat: "events",
    ar: "تغطية مهرجان أفلام السعودية ١١",         en: "Saudi Film Festival 11 Coverage" },
  { id: 23, yt: "We8sFkpd1b0", cat: "events",
    ar: "تغطية مهرجان وندر هيلز",                  en: "Wonder Hills Event Coverage" },
  { id: 24, yt: "CpYYwiEDOJ4", cat: "events",
    ar: "اليوم الوطني ٩٥ — شركة الزاهد",          en: "Saudi National Day 95 — Al-Zahid" },
  { id: 25, yt: "v8kNCrZysEM", cat: "events",
    ar: "افتتاح معهد سين للتمثيل بالخبر",         en: "Seen Acting Institute Opening — Khobar" },
  { id: 26, yt: "Zs1yheEgEzw", cat: "events",
    ar: "تغطية فعاليات — لقطات سينمائية",         en: "Event Coverage — Cinematic Shots" },
  { id: 27, yt: "voeIqpOlmqk", cat: "events",
    ar: "تغطية مهرجان أفلام السعودية ١١",         en: "Saudi Film Festival 11 — Coverage" },
  { id: 28, yt: "A6nsilreOHo", cat: "events",
    ar: "تغطية حفلات التقاعد",                    en: "Retirement Celebrations Coverage" },
  { id: 29, yt: "muzsqmUzA0k", cat: "documentary",
    ar: "وثائقي البخنق التاريخي",                 en: "Al-Bakhnaq Historical Documentary" },
  { id: 30, yt: "se5_3BW-9FY", cat: "documentary",
    ar: "وثائقي البيت القطيفي — ج٢",              en: "Qatif House Documentary — Part 2" },
  { id: 31, yt: "4Lhm-2Gne7Q", cat: "documentary",
    ar: "وثائقي الحوي التاريخي",                  en: "Al-Huwi Historical Documentary" },
  { id: 32, yt: "totRI62nzRs", cat: "documentary",
    ar: "وثائقي الدروازة التاريخي",               en: "Al-Darwazah Historical Documentary" },
  { id: 33, yt: "YCCEQhRdmd8", cat: "documentary",
    ar: "وثائقي الدروازة — ج٢",                   en: "Al-Darwazah Documentary — Part 2" },
  { id: 34, yt: "XMjZBgROUIg", cat: "corporate",
    ar: "برومو شركة العطيشان × ريو ميديا",        en: "Al-Otaishan Promo × Rio Media" },
  { id: 35, yt: "F0MTiYeWZyw", cat: "corporate",
    ar: "برومو شركة ريفايفا × ألوان الحياة",      en: "Reviva Promo × Alwan Al-Hayah" },
  { id: 36, yt: "naAnvH5DoM0", cat: "corporate",
    ar: "افتتاح فرع مسكوب بالجبيل",               en: "Miskob Jubail Branch Opening" },
  { id: 37, yt: "DwXwknux7kw", cat: "corporate",
    ar: "إيفنت شركة عبدالواحد",                   en: "Abdulwahid Company Event" },
];

// Thumbnail with smart fallback — detects YouTube's 120×90 gray placeholder
// (returned with 200 OK when maxresdefault doesn't exist, so onError won't fire)
function Thumb({ yt, alt }: { yt: string; alt: string }) {
  const [src, setSrc] = useState(`https://img.youtube.com/vi/${yt}/maxresdefault.jpg`);
  const [loaded, setLoaded] = useState(false);
  const isMaxres = src.includes("maxresdefault");

  const onLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    // YouTube's "no maxres" placeholder is 120×90 (sometimes 480×360 for sddefault).
    // If maxres returned a tiny placeholder, fall back to hqdefault (always exists).
    if (isMaxres && img.naturalWidth <= 120) {
      setSrc(`https://img.youtube.com/vi/${yt}/hqdefault.jpg`);
      return;
    }
    setLoaded(true);
  };

  const onError = () => {
    if (isMaxres) setSrc(`https://img.youtube.com/vi/${yt}/hqdefault.jpg`);
  };

  return (
    <>
      {/* Cinematic dark placeholder while loading */}
      <div
        className="absolute inset-0 transition-opacity duration-500"
        style={{
          background: "linear-gradient(135deg, #0d0d0d 0%, #050505 100%)",
          opacity: loaded ? 0 : 1,
        }}
      />
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        onLoad={onLoad}
        onError={onError}
        className="absolute inset-0 w-full h-full object-cover transition-all duration-700 group-hover:scale-105"
        style={{ opacity: loaded ? 0.55 : 0 }}
      />
    </>
  );
}

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
      style={{ aspectRatio: "16/10", border: "1px solid rgba(255,255,255,0.06)", background: "#070707", cursor: "pointer" }}
      aria-label={t({ ar: item.ar, en: item.en })}
    >
      <Thumb yt={item.yt} alt={t({ ar: item.ar, en: item.en })} />

      {/* Cinematic dark overlay */}
      <div className="absolute inset-0 transition-opacity duration-500" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.35) 55%, rgba(0,0,0,0.1) 100%)" }} />
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500" style={{ background: "linear-gradient(to top, rgba(227,30,36,0.18), transparent 60%)" }} />

      {/* Play button — smaller, premium */}
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="flex items-center justify-center transition-all duration-400 group-hover:scale-110" style={{ width: "52px", height: "52px", borderRadius: "50%", background: "rgba(227,30,36,0.92)", boxShadow: "0 8px 28px rgba(227,30,36,0.4)" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="#fff" style={{ marginLeft: "2px" }}><path d="M5 3l16 9-16 9z" /></svg>
        </span>
      </div>

      {/* Caption */}
      <div className="absolute bottom-0 left-0 right-0 p-5">
        <span className="f-sans inline-flex items-center gap-1.5 mb-2.5" style={{ fontSize: "8px", letterSpacing: "2.5px", color: "rgba(227,30,36,0.95)", textTransform: "uppercase", padding: "3px 9px", border: "1px solid rgba(227,30,36,0.3)", background: "rgba(227,30,36,0.06)", fontWeight: 600 }}>
          {meta?.icon} {t({ ar: meta?.ar || "", en: meta?.en || "" })}
        </span>
        <h3 className="text-white" style={{ fontSize: "14.5px", fontWeight: 600, lineHeight: 1.4, letterSpacing: "-0.005em" }}>{t({ ar: item.ar, en: item.en })}</h3>
        <div className="f-sans mt-2.5 inline-flex items-center gap-1.5 transition-all duration-300 group-hover:gap-2.5" style={{ fontSize: "9px", letterSpacing: "2.5px", color: "rgba(255,255,255,0.5)", textTransform: "uppercase", fontWeight: 600 }}>
          {t({ ar: "مشاهدة العمل", en: "Watch Project" })}
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
        </div>
      </div>

      {/* Corner accent */}
      <span className="absolute top-0 right-0 transition-all duration-500 group-hover:w-10 group-hover:h-10" style={{ width: "0", height: "0", borderTop: "1.5px solid #E31E24", borderRight: "1.5px solid #E31E24" }} />
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
      <div className="absolute top-1/4 left-0 pointer-events-none" style={{ width: "40vw", height: "40vh", background: "radial-gradient(circle, rgba(227,30,36,0.04), transparent 70%)" }} />

      <div className="max-w-7xl mx-auto px-6 lg:px-12 relative z-10">
        <div className="mb-12 text-center" data-reveal>
          <div className="eyebrow mb-5 mx-auto">{t({ ar: "أعمالنا", en: "Portfolio" })}</div>
          <h2 className="editorial text-white" style={{ fontSize: "clamp(34px,5vw,58px)" }}>
            {t({ ar: "أعمال", en: "Work" })}{" "}
            <em>{t({ ar: "مختارة", en: "selected" })}</em>
            {" "}
            {t({ ar: "من إنتاجاتنا السينمائية", en: "from our cinematic productions" })}
          </h2>
          <p className="text-white/45 mt-5" style={{ fontSize: "14px", lineHeight: 1.85, maxWidth: "640px", margin: "20px auto 0" }}>
            {t({
              ar: "أكثر من ٤٠٠٠ إنتاج عبر مناطق المملكة وخارجها. فيما يلي مختارات من أعمالنا الأخيرة.",
              en: "Over 4,000 productions across the Kingdom and beyond. A curated selection of our recent work.",
            })}
          </p>
        </div>

        {/* Category tabs */}
        <div className="flex flex-wrap gap-2 justify-center mb-10" data-reveal>
          {CATEGORIES.map((c) => {
            const on = active === c.key;
            const n = counts[c.key] || 0;
            if (n === 0) return null;
            return (
              <button
                key={c.key}
                onClick={() => setActive(c.key)}
                className="f-sans inline-flex items-center gap-2 transition-all duration-300"
                style={{
                  fontSize: "10.5px", letterSpacing: "1.8px", padding: "9px 16px", fontWeight: 600,
                  border: "1px solid " + (on ? "#E31E24" : "rgba(255,255,255,0.1)"),
                  background: on ? "rgba(227,30,36,0.12)" : "transparent",
                  color: on ? "#fff" : "rgba(255,255,255,0.5)",
                  cursor: "pointer",
                  textTransform: "uppercase",
                }}
              >
                {t({ ar: c.ar, en: c.en })}
                <span style={{ fontSize: "9px", opacity: 0.6, background: on ? "rgba(227,30,36,0.35)" : "rgba(255,255,255,0.08)", padding: "1px 6px", borderRadius: "10px", fontWeight: 600 }}>{n}</span>
              </button>
            );
          })}
        </div>

        <motion.div layout className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <AnimatePresence mode="popLayout">
            {shown.map((item, idx) => <Card key={item.id} item={item} idx={idx} onOpen={setOpen} />)}
          </AnimatePresence>
        </motion.div>

        <div className="text-center mt-16" data-reveal>
          <a href="https://www.youtube.com/@kianalebtikar" target="_blank" rel="noopener noreferrer" className="btn-ghost inline-flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M23 12s0-3.8-.5-5.6c-.3-1-1-1.8-2-2C18.7 4 12 4 12 4s-6.7 0-8.5.4c-1 .2-1.7 1-2 2C1 8.2 1 12 1 12s0 3.8.5 5.6c.3 1 1 1.8 2 2C5.3 20 12 20 12 20s6.7 0 8.5-.4c1-.2 1.7-1 2-2 .5-1.8.5-5.6.5-5.6zM10 15.5v-7l6 3.5-6 3.5z" /></svg>
            {t({ ar: "شاهد المزيد على يوتيوب", en: "Watch More on YouTube" })}
          </a>
        </div>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(null)} style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,0.95)", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
            <motion.div initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.92, opacity: 0 }} onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: "1000px" }}>
              <button onClick={() => setOpen(null)} className="f-sans" style={{ display: "block", marginInlineStart: "auto", marginBottom: "12px", background: "none", border: "none", color: "rgba(255,255,255,0.7)", fontSize: "12px", letterSpacing: "2px", cursor: "pointer" }}>✕ CLOSE</button>
              <div className="yt" style={{ border: "1px solid rgba(255,255,255,0.1)" }}>
                <iframe src={`https://www.youtube.com/embed/${open}?autoplay=1&rel=0&controls=1`} title="Kian Media" allowFullScreen allow="autoplay; encrypted-media; picture-in-picture" />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
