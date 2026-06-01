"use client";
import { motion, AnimatePresence } from "framer-motion";
import { useState, useMemo } from "react";
import { useI18n } from "@/lib/i18n";

type CatKey =
  | "all"
  | "corporate"
  | "commercial"
  | "realestate"
  | "events"
  | "documentary"
  | "cinematic"
  | "festivals"
  | "weddings";

type Item = {
  id: number;
  yt: string;
  cats: CatKey[]; // an item can belong to multiple categories
  ar: string;
  en: string;
  vertical?: boolean; // true for 9:16 YouTube Shorts
};

// ─── Categories in the exact order from the brief ──────────────────────────
const CATEGORIES: { key: CatKey; ar: string; en: string }[] = [
  { key: "all",          ar: "كل الأعمال",                en: "All" },
  { key: "corporate",    ar: "إنتاج الشركات",             en: "Corporate Productions" },
  { key: "commercial",   ar: "الإعلانات التجارية",        en: "Commercial Ads" },
  { key: "realestate",   ar: "التصوير العقاري",           en: "Real Estate Production" },
  { key: "events",       ar: "تغطية الفعاليات",           en: "Events Coverage" },
  { key: "documentary",  ar: "الأفلام الوثائقية",         en: "Documentary Films" },
  { key: "cinematic",    ar: "الإنتاج السينمائي",         en: "Cinematic Productions" },
  { key: "festivals",    ar: "مهرجانات الأفلام",          en: "Film Festivals" },
  { key: "weddings",     ar: "الأعراس",                  en: "Weddings" },
];

// Premium per-category descriptions (varied tone, not templated)
const DESC: Record<Exclude<CatKey, "all">, { ar: string; en: string }> = {
  corporate:   { ar: "إنتاج مؤسسي بهوية بصرية متماسكة تعكس قيم الجهة ورؤيتها.",
                 en: "A corporate production with a cohesive visual identity reflecting the organization's values and vision." },
  commercial:  { ar: "إعلان بصري بإيقاع تجاري مدروس يعزّز حضور العلامة.",
                 en: "A commercial production with measured pacing crafted to elevate brand presence." },
  realestate:  { ar: "تصوير عقاري سينمائي يُبرز تفاصيل المشروع بزوايا أرضية وجوية متقنة.",
                 en: "Cinematic real estate filming revealing project detail through composed ground and aerial perspectives." },
  events:      { ar: "تغطية سينمائية متكاملة توثّق روح الحدث ولحظاته الأبرز.",
                 en: "Full cinematic event coverage capturing the spirit and the moments that matter." },
  documentary: { ar: "إنتاج وثائقي يحفظ القصة ويوثّقها بلغة بصرية أصيلة.",
                 en: "Documentary production that preserves the story with an authentic visual language." },
  cinematic:   { ar: "إنتاج سينمائي بمعالجة بصرية متقدمة وإخراج يليق بالعلامات الكبرى.",
                 en: "Cinematic production with advanced visual treatment and direction worthy of leading brands." },
  festivals:   { ar: "تغطية متخصصة لمهرجانات الأفلام السينمائية في المملكة.",
                 en: "Specialized coverage of cinematic film festivals across the Kingdom." },
  weddings:    { ar: "تصوير أعراس سينمائي فاخر — فرق رجالية ونسائية احترافية كاملة، توثّق ليلة العمر بأسلوب راقٍ.",
                 en: "Luxury cinematic wedding films — full professional crews capturing the celebration with refined artistry." },
};

// ─── Items — manually curated per the exact brief categorization ───────────
// Some items appear in multiple categories on purpose (e.g. Maaden Open Day
// is both a "Corporate Production" and an "Events Coverage").
const ITEMS: Item[] = [
  // ━━━ 1. CORPORATE PRODUCTIONS ━━━
  { id:  1, yt: "XMjZBgROUIg", cats: ["corporate"],
    ar: "برومو شركة العطيشان",                  en: "Al-Otaishan — Corporate Promo" },
  { id:  2, yt: "F0MTiYeWZyw", cats: ["corporate"],
    ar: "شركة ريفايفا",                          en: "Reviva — Brand Promo" },
  { id:  3, yt: "eG7K22u6xEU", cats: ["corporate", "realestate"],
    ar: "شركات عقارية متنوعة — تصوير جوي",       en: "Real Estate Companies — Aerial Reel" },
  { id:  4, yt: "2xNe8PbjmZE", cats: ["corporate", "events"],
    ar: "شركة معادن — اليوم المفتوح",            en: "Maaden — Open Day" },
  { id: 41, yt: "0LuP0-3FqnI", cats: ["corporate", "events", "cinematic"],
    ar: "اليوم المفتوح لشركة معادن — ٢٠٢٥",      en: "Maaden — Open Day 2025" },
  { id:  5, yt: "9o8HL_IZjFA", cats: ["corporate"],
    ar: "الموارد البشرية والتنمية الاجتماعية",  en: "Ministry of Human Resources & Social Development" },
  { id:  6, yt: "MIs6GbXBxV4", cats: ["corporate", "events"],
    ar: "اليوم المفتوح — شركة دايسر",            en: "Daycer — Open Day" },
  { id:  7, yt: "eroGztKVLwY", cats: ["corporate"],
    ar: "معرض الصناعات الدولي — البحرين",        en: "International Industries Exhibition — Bahrain" },
  { id:  8, yt: "robGTKwobn0", cats: ["corporate", "realestate"],
    ar: "شركة روانا",                            en: "Rawana Company" },
  { id:  9, yt: "k7WQOJbUSB8", cats: ["corporate"],
    ar: "منتدى الصناعات السعودي",                 en: "Saudi Industries Forum" },
  { id: 38, yt: "EjOMCO9pA6E", cats: ["corporate"],
    ar: "شركة ريفي",                              en: "Refi Company" },
  { id: 39, yt: "GIyi34PPFG8", cats: ["corporate"],
    ar: "شركة زد",                                en: "Zed Company" },

  // ━━━ 2. COMMERCIAL ADS ━━━
  { id: 10, yt: "xvzneIB-OFs", cats: ["commercial"],
    ar: "إعلانات متنوعة للمطاعم والمجمعات",      en: "Restaurants & Complexes — Commercial Reel" },
  { id: 11, yt: "naAnvH5DoM0", cats: ["commercial"],
    ar: "افتتاح مسكوب",                          en: "Miskob — Opening Commercial" },
  { id: 12, yt: "z7S6YWiO6xw", cats: ["commercial"],
    ar: "مجمع عيادات الحقيل",                    en: "Al-Hekail Medical Clinics" },
  { id: 40, yt: "uhWmJrDfT78", cats: ["commercial"],
    ar: "بوفيه عمر",                             en: "Omar Buffet" },
  { id: 42, yt: "3HCrw8toqAA", cats: ["commercial"], vertical: true,
    ar: "إعلان قصير",                            en: "Short Ad" },
  { id: 43, yt: "Rn1WYI0n-ck", cats: ["commercial"], vertical: true,
    ar: "إعلان قصير",                            en: "Short Ad" },
  { id: 44, yt: "YZIipE09lpg", cats: ["commercial"], vertical: true,
    ar: "إعلان قصير",                            en: "Short Ad" },

  // ━━━ 3. REAL ESTATE PRODUCTION ━━━
  // eG7K22u6xEU & robGTKwobn0 already added with cats: ["corporate", "realestate"] above
  { id: 13, yt: "mGO5WGSeZTQ", cats: ["realestate"],
    ar: "تصوير عمارة لشركة روانا",               en: "Rawana — Building Showcase" },
  { id: 14, yt: "cUgTk6do7mA", cats: ["realestate"],
    ar: "إنشاء مجمع فيلل — شركة الدارة",          en: "Al-Darah — Villa Complex Construction" },
  { id: 15, yt: "zTf-qf0ml4c", cats: ["realestate"],
    ar: "تدشين فيلا عرض — مشروع بيوت تيل",        en: "Beot Til — Show Villa Launch" },
  { id: 16, yt: "BlB2YGo1T3U", cats: ["realestate"],
    ar: "فيلا عرض — شركة روانا",                 en: "Rawana — Show Villa" },

  // ━━━ 4. EVENTS COVERAGE ━━━
  // 2xNe8PbjmZE & MIs6GbXBxV4 already included with corporate
  { id: 17, yt: "1MFZP6WZx3E", cats: ["events", "cinematic"],
    ar: "افتتاح المدينة العالمية بالدمام",        en: "Global City Dammam — Opening" },
  { id: 18, yt: "We8sFkpd1b0", cats: ["events", "cinematic"],
    ar: "فعالية وندر هيلز",                       en: "Wonder Hills — Event" },
  { id: 19, yt: "DwXwknux7kw", cats: ["events"],
    ar: "شركة عبدالواحد للتصوير",                 en: "Abdulwahid — Photography Event" },
  { id: 20, yt: "Zs1yheEgEzw", cats: ["events"],
    ar: "فعاليات فيلاجيو مول",                    en: "Villaggio Mall — Events" },
  { id: 21, yt: "u-5S5jkRk0c", cats: ["events"],
    ar: "تريادا ايفنت — الشرفات بارك",            en: "Triada Event — Al-Shorfat Park" },
  { id: 22, yt: "IPaDI1hcupo", cats: ["events"],
    ar: "احتفال اليوم الوطني — شركة الزاهد",      en: "Saudi National Day — Al-Zahid" },

  // ━━━ 5. DOCUMENTARY FILMS (preserved as-is) ━━━
  { id: 23, yt: "vPaH2dnBiFA", cats: ["documentary"],
    ar: "وثائقي البيت القطيفي",                  en: "Qatif House — Heritage Documentary" },
  { id: 24, yt: "muzsqmUzA0k", cats: ["documentary"],
    ar: "وثائقي البخنق التاريخي",                en: "Al-Bakhnaq — Historical Documentary" },
  { id: 25, yt: "se5_3BW-9FY", cats: ["documentary"],
    ar: "وثائقي البيت القطيفي — ج٢",             en: "Qatif House — Documentary Part 2" },
  { id: 26, yt: "4Lhm-2Gne7Q", cats: ["documentary"],
    ar: "وثائقي الحوي التاريخي",                 en: "Al-Huwi — Historical Documentary" },
  { id: 27, yt: "totRI62nzRs", cats: ["documentary"],
    ar: "وثائقي الدروازة التاريخي",              en: "Al-Darwazah — Historical Documentary" },
  { id: 28, yt: "YCCEQhRdmd8", cats: ["documentary"],
    ar: "وثائقي الدروازة — ج٢",                  en: "Al-Darwazah — Documentary Part 2" },

  // ━━━ 6. CINEMATIC PRODUCTIONS ━━━
  // 1MFZP6WZx3E & We8sFkpd1b0 already included with events
  { id: 29, yt: "vVeFXeJTTm0", cats: ["cinematic"],
    ar: "فيديو كليب البخنق",                     en: "Al-Bakhnaq — Music Video" },

  // ━━━ 7. FILM FESTIVALS ━━━
  { id: 30, yt: "Tp4m2EA1C3o", cats: ["festivals"],
    ar: "مهرجان أفلام السعودية — ٠١",            en: "Saudi Film Festival — Vol. 01" },
  { id: 31, yt: "ubj3cgC7jOs", cats: ["festivals"],
    ar: "مهرجان أفلام السعودية",                 en: "Saudi Film Festival" },
  { id: 32, yt: "voeIqpOlmqk", cats: ["festivals"],
    ar: "مهرجان أفلام السعودية",                 en: "Saudi Film Festival" },

  // ━━━ 8. WEDDINGS ━━━
  { id: 50, yt: "S6JdnS6s1Tc", cats: ["weddings"],
    ar: "تصوير عرس سينمائي",                     en: "Cinematic Wedding Film" },
  { id: 51, yt: "ngXJJd4wUAs", cats: ["weddings"],
    ar: "تصوير عرس سينمائي",                     en: "Cinematic Wedding Film" },
  { id: 52, yt: "VJjZWEwmFJU", cats: ["weddings"],
    ar: "تصوير عرس سينمائي",                     en: "Cinematic Wedding Film" },
  { id: 53, yt: "b2OuWey3qCc", cats: ["weddings"],
    ar: "تصوير عرس سينمائي",                     en: "Cinematic Wedding Film" },
  { id: 54, yt: "jul59VwBM94", cats: ["weddings"],
    ar: "تصوير عرس سينمائي",                     en: "Cinematic Wedding Film" },
  { id: 55, yt: "bOiD92ojI_4", cats: ["weddings"],
    ar: "تصوير عرس سينمائي",                     en: "Cinematic Wedding Film" },
  { id: 56, yt: "YcsbeqHlm9I", cats: ["weddings"],
    ar: "برومو تصوير الأعراس",                   en: "Wedding Cinematography Promo" },
];

// ─── Thumbnail with smart fallback ────────────────────────────────────────
function Thumb({ yt, alt }: { yt: string; alt: string }) {
  const [src, setSrc] = useState(`https://img.youtube.com/vi/${yt}/maxresdefault.jpg`);
  const [loaded, setLoaded] = useState(false);
  const isMaxres = src.includes("maxresdefault");

  const onLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
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
      <div className="absolute inset-0 transition-opacity duration-500"
           style={{ background: "linear-gradient(135deg, #0d0d0d 0%, #050505 100%)", opacity: loaded ? 0 : 1 }} />
      <img
        src={src} alt={alt}
        loading="lazy" decoding="async"
        onLoad={onLoad} onError={onError}
        className="absolute inset-0 w-full h-full object-cover transition-all duration-700 group-hover:scale-105"
        style={{ opacity: loaded ? 0.55 : 0 }}
      />
    </>
  );
}

// ─── Card ──────────────────────────────────────────────────────────────────
function Card({ item, idx, activeCat, onOpen }: { item: Item; idx: number; activeCat: CatKey; onOpen: (yt: string) => void }) {
  const { t } = useI18n();
  // When "all" is active, show the item's primary (first) category.
  // When a specific tab is active, show that category badge.
  const shownCat: Exclude<CatKey, "all"> =
    activeCat !== "all" && item.cats.includes(activeCat)
      ? (activeCat as Exclude<CatKey, "all">)
      : (item.cats[0] as Exclude<CatKey, "all">);
  const meta = CATEGORIES.find((c) => c.key === shownCat);
  const d = DESC[shownCat];

  return (
    <motion.button
      layout
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1], delay: (idx % 3) * 0.05 }}
      onClick={() => onOpen(item.yt)}
      className="group relative block w-full overflow-hidden text-start"
      style={{ aspectRatio: "16/11", border: "1px solid rgba(255,255,255,0.06)", background: "#070707", cursor: "pointer" }}
      aria-label={t({ ar: item.ar, en: item.en })}
    >
      <Thumb yt={item.yt} alt={t({ ar: item.ar, en: item.en })} />

      <div className="absolute inset-0 transition-opacity duration-500" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.94) 0%, rgba(0,0,0,0.4) 55%, rgba(0,0,0,0.1) 100%)" }} />
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500" style={{ background: "linear-gradient(to top, rgba(227,30,36,0.16), transparent 60%)" }} />
      <span className="pf-card-glow" />

      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <span className="flex items-center justify-center transition-all duration-400 group-hover:scale-110"
              style={{ width: "52px", height: "52px", borderRadius: "50%", background: "rgba(227,30,36,0.92)", boxShadow: "0 8px 28px rgba(227,30,36,0.4)" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="#fff" style={{ marginLeft: "2px" }}><path d="M5 3l16 9-16 9z" /></svg>
        </span>
      </div>

      <div className="absolute bottom-0 left-0 right-0 p-5 pointer-events-none">
        <span className="f-sans inline-flex items-center gap-1.5 mb-2.5"
              style={{ fontSize: "8px", letterSpacing: "2.5px", color: "rgba(227,30,36,0.95)", textTransform: "uppercase",
                       padding: "3px 9px", border: "1px solid rgba(227,30,36,0.3)", background: "rgba(227,30,36,0.06)", fontWeight: 600 }}>
          ◆ {t({ ar: meta?.ar || "", en: meta?.en || "" })}
        </span>
        <h3 className="text-white" style={{ fontSize: "14.5px", fontWeight: 600, lineHeight: 1.4, letterSpacing: "-0.005em" }}>
          {t({ ar: item.ar, en: item.en })}
        </h3>
        {d && (
          <p className="text-white/55 mt-1.5 line-clamp-2" style={{ fontSize: "12px", lineHeight: 1.55 }}>
            {t({ ar: d.ar, en: d.en })}
          </p>
        )}
        <div className="f-sans mt-3 inline-flex items-center gap-1.5 transition-all duration-300 group-hover:gap-2.5"
             style={{ fontSize: "9px", letterSpacing: "2.5px", color: "rgba(255,255,255,0.5)", textTransform: "uppercase", fontWeight: 600 }}>
          {t({ ar: "مشاهدة العمل", en: "Watch Project" })}
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
        </div>
      </div>

      <span className="absolute top-0 right-0 transition-all duration-500 group-hover:w-10 group-hover:h-10"
            style={{ width: "0", height: "0", borderTop: "1.5px solid #E31E24", borderRight: "1.5px solid #E31E24" }} />
    </motion.button>
  );
}

// ─── Section heading shown between groups when "All" tab is active ────────
function GroupHeader({ catKey }: { catKey: Exclude<CatKey, "all"> }) {
  const { t } = useI18n();
  const meta = CATEGORIES.find((c) => c.key === catKey);
  if (!meta) return null;
  return (
    <div className="col-span-full mt-10 first:mt-0 mb-1" data-reveal>
      <div className="flex items-center gap-4 mb-2">
        <span style={{ width: "28px", height: "1px", background: "var(--red)" }} />
        <span className="f-sans" style={{ fontSize: "10px", letterSpacing: "3.5px", color: "rgba(227,30,36,0.95)", textTransform: "uppercase", fontWeight: 700 }}>
          {meta.en}
        </span>
      </div>
      <h3 className="editorial text-white" style={{ fontSize: "clamp(22px,2.6vw,30px)", fontWeight: 600 }}>
        {t({ ar: meta.ar, en: meta.en })}
      </h3>
    </div>
  );
}

export default function Portfolio() {
  const { t } = useI18n();
  const [active, setActive] = useState<CatKey>("all");
  const [open, setOpen] = useState<string | null>(null);

  // Count unique items per category (multi-cat items count under each of their cats)
  const counts = useMemo(() => {
    // For "all" tab, dedup so the same video isn't shown twice in the grid.
    const allUnique = new Set(ITEMS.map((i) => i.yt)).size;
    const c: Record<string, number> = { all: allUnique };
    for (const it of ITEMS) {
      for (const cat of it.cats) c[cat] = (c[cat] || 0) + 1;
    }
    return c;
  }, []);

  // Build the items to show, in the brief's category order
  const groupedAll = useMemo(() => {
    const groups: { cat: Exclude<CatKey, "all">; items: Item[] }[] = [];
    const seen = new Set<string>();
    const order: Exclude<CatKey, "all">[] = ["corporate", "commercial", "realestate", "events", "documentary", "cinematic", "festivals", "weddings"];
    for (const cat of order) {
      const its = ITEMS.filter((i) => i.cats.includes(cat) && !seen.has(i.yt));
      its.forEach((i) => seen.add(i.yt));
      if (its.length) groups.push({ cat, items: its });
    }
    return groups;
  }, []);

  const filteredItems = useMemo(() => {
    if (active === "all") return null;
    return ITEMS.filter((i) => i.cats.includes(active));
  }, [active]);

  return (
    <section id="portfolio" className="relative overflow-hidden" style={{ background: "#000", paddingTop: "140px", paddingBottom: "140px" }}>
      <div className="absolute top-1/4 left-0 pointer-events-none" style={{ width: "40vw", height: "40vh", background: "radial-gradient(circle, rgba(227,30,36,0.04), transparent 70%)" }} />

      <div className="max-w-7xl mx-auto px-6 lg:px-12 relative z-10">
        <div className="mb-12 text-center" data-reveal>
          <div className="eyebrow mb-5 mx-auto">{t({ ar: "أعمالنا", en: "Our Work" })}</div>
          <h2 className="editorial text-white" style={{ fontSize: "clamp(34px,5vw,58px)" }}>
            {t({ ar: "أعمال", en: "Work" })}{" "}
            <em>{t({ ar: "مختارة", en: "selected" })}</em>{" "}
            {t({ ar: "من إنتاجاتنا السينمائية", en: "from our cinematic productions" })}
          </h2>
          <p className="text-white/45 mt-5" style={{ fontSize: "14px", lineHeight: 1.85, maxWidth: "640px", margin: "20px auto 0" }}>
            {t({
              ar: "أكثر من ٤٠٠٠ إنتاج عبر مناطق المملكة وخارجها. فيما يلي مختارات منظّمة من أعمالنا.",
              en: "Over 4,000 productions across the Kingdom and beyond. A curated, organized selection of our work.",
            })}
          </p>
        </div>

        {/* Category tabs — in exact brief order */}
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
                  cursor: "pointer", textTransform: "uppercase",
                }}
              >
                {t({ ar: c.ar, en: c.en })}
                <span style={{ fontSize: "9px", opacity: 0.6, background: on ? "rgba(227,30,36,0.35)" : "rgba(255,255,255,0.08)", padding: "1px 6px", borderRadius: "10px", fontWeight: 600 }}>
                  {n}
                </span>
              </button>
            );
          })}
        </div>

        {/* Grid */}
        <motion.div layout className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <AnimatePresence mode="popLayout">
            {active === "all" ? (
              // Group mode: section headers between categories
              groupedAll.flatMap((g, gi) => [
                <GroupHeader key={`h-${g.cat}`} catKey={g.cat} />,
                ...g.items.map((item, idx) => (
                  <Card key={`a-${item.id}`} item={item} idx={idx + gi} activeCat={active} onOpen={setOpen} />
                )),
              ])
            ) : (
              filteredItems!.map((item, idx) => (
                <Card key={`f-${item.id}`} item={item} idx={idx} activeCat={active} onOpen={setOpen} />
              ))
            )}
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
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(null)}
            style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,0.95)", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
            <motion.div initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.92, opacity: 0 }} onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: "1000px" }}>
              <button onClick={() => setOpen(null)} className="f-sans"
                style={{ display: "block", marginInlineStart: "auto", marginBottom: "12px", background: "none", border: "none", color: "rgba(255,255,255,0.7)", fontSize: "12px", letterSpacing: "2px", cursor: "pointer" }}>
                ✕ CLOSE
              </button>
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
