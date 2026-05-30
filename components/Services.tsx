"use client";
import { motion } from "framer-motion";
import { useI18n } from "@/lib/i18n";

type Svc = {
  key: string;
  icon: React.ReactNode;
  ar: { title: string; desc: string };
  en: { title: string; desc: string };
  premium?: boolean;
};

// Modern line icons — all 1.5px stroke, 22×22 viewBox-balanced
const I = {
  film: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="18" rx="1"/><path d="M6 3v18M18 3v18M2 8h4M2 16h4M18 8h4M18 16h4M10 3v18M14 3v18"/></svg>,
  megaphone: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z"/><path d="M14 7a5 5 0 0 1 0 10"/><path d="M18 4a9 9 0 0 1 0 16"/></svg>,
  building: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="2" width="16" height="20" rx="1"/><path d="M8 6h2M14 6h2M8 10h2M14 10h2M8 14h2M14 14h2M10 22v-4h4v4"/></svg>,
  doc: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h4"/></svg>,
  drone: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="5" cy="5" r="2.5"/><circle cx="19" cy="5" r="2.5"/><circle cx="5" cy="19" r="2.5"/><circle cx="19" cy="19" r="2.5"/><path d="M7 7l3 3M17 7l-3 3M7 17l3-3M17 17l-3-3"/><rect x="9" y="9" width="6" height="6" rx="1"/></svg>,
  calendar: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>,
  broadcast: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49M7.76 16.24a6 6 0 0 1 0-8.49M20.49 4.51a10 10 0 0 1 0 14.99M3.51 19.5a10 10 0 0 1 0-14.99"/></svg>,
  home: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9.5L12 3l9 6.5V21a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1z"/></svg>,
  product: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"/></svg>,
  share: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.59 13.51l6.83 3.98M15.41 6.51l-6.82 3.98"/></svg>,
  book: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>,
  compass: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>,
  mic: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="2" width="6" height="13" rx="3"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/></svg>,
  camera: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>,
  shield: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
  diamond: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3h12l4 6-10 13L2 9z"/><path d="M2 9h20M11 3L8 9l4 13M13 3l3 6-4 13"/></svg>,
};

const SERVICES: Svc[] = [
  { key: "cinematic",   icon: I.film,       ar: { title: "الإنتاج السينمائي", desc: "إنتاج كامل بمعايير سينمائية عالمية — من السيناريو إلى المعالجة النهائية." }, en: { title: "Cinematic Production", desc: "Full production at international cinematic standards — script to final grade." } },
  { key: "commercial",  icon: I.megaphone,  ar: { title: "الإعلانات التجارية", desc: "إعلانات بصرية تُحرّك القرار الشرائي وتعيد تعريف حضور علامتك." }, en: { title: "Commercial Ads", desc: "Visual ads engineered to drive purchase decisions and redefine brand presence." } },
  { key: "corporate",   icon: I.building,   ar: { title: "الأفلام المؤسسية", desc: "أفلام شركات تروي قصة المؤسسة بلغة بصرية تليق بحجمها." }, en: { title: "Corporate Films", desc: "Corporate films that tell your story in a visual language worthy of its scale." } },
  { key: "documentary", icon: I.doc,        ar: { title: "الأفلام الوثائقية", desc: "إنتاج وثائقي يحفظ الإرث ويروي القصص الإنسانية." }, en: { title: "Documentary Films", desc: "Documentary production that preserves heritage and tells human stories." } },
  { key: "drone",       icon: I.drone,      ar: { title: "التصوير الجوي بالدرون", desc: "أطقم درون معتمدة بدقة 4K وزوايا لا تُمكن إلا منها." }, en: { title: "Drone Cinematography", desc: "Certified drone crews capturing in 4K with perspectives no other system offers." } },
  { key: "events",      icon: I.calendar,   ar: { title: "تغطية الفعاليات", desc: "تغطية سينمائية شاملة للمؤتمرات والإطلاقات والفعاليات الكبرى." }, en: { title: "Event Coverage", desc: "Comprehensive cinematic coverage for conferences, launches, and major events." } },
  { key: "live",        icon: I.broadcast,  ar: { title: "البث المباشر متعدد الكاميرات", desc: "بثّ بجودة تلفزيونية مع تحكّم لحظي للمؤتمرات والإطلاقات." }, en: { title: "Live Streaming & Multi-Cam", desc: "Broadcast-grade live streaming with real-time switching." } },
  { key: "realestate",  icon: I.home,       ar: { title: "التصوير العقاري السينمائي", desc: "أفلام عقارية أرضية وجوية بمستوى تسويقي راقٍ." }, en: { title: "Real Estate Cinematic", desc: "Premium ground and aerial real estate films for developers." } },
  { key: "product",     icon: I.product,    ar: { title: "إعلانات المنتجات", desc: "أفلام منتجات بإضاءة استوديو وحركة كاميرا دقيقة." }, en: { title: "Product Commercials", desc: "Cinematic product films with studio lighting and precise camera motion." } },
  { key: "social",      icon: I.share,      ar: { title: "حملات السوشيال ميديا", desc: "ريلز وشورتس بإيقاع سريع لرفع التفاعل والوصول." }, en: { title: "Social Media Campaigns", desc: "Reels and shorts at high tempo to boost engagement and reach." } },
  { key: "story",       icon: I.book,       ar: { title: "سرد قصص العلامات", desc: "نبني للعلامة سردًا بصريًا أصيلًا يتجاوز الإعلان." }, en: { title: "Brand Storytelling", desc: "We build an authentic visual narrative beyond advertising." } },
  { key: "direction",   icon: I.compass,    ar: { title: "الإخراج الإبداعي", desc: "رؤية إخراجية من المعالجة إلى تصميم اللقطات والمسار الصوتي." }, en: { title: "Creative Direction", desc: "End-to-end directorial vision — treatment, shot design, soundtrack." } },
  { key: "podcast",     icon: I.mic,        ar: { title: "إنتاج البودكاست", desc: "بودكاست استوديو متعدد الكاميرات بمعالجة جاهزة لكل المنصات." }, en: { title: "Podcast Production", desc: "Studio-grade multi-cam podcasts, platform-ready post." } },
  { key: "photo",       icon: I.camera,     ar: { title: "التصوير الفوتوغرافي", desc: "تصوير احترافي للشركات والمنتجات والعقارات بإضاءة سينمائية." }, en: { title: "Photography", desc: "Professional photography for corporates, products, and real estate." } },
  { key: "gov",         icon: I.shield,     ar: { title: "إنتاجات الجهات الحكومية والشركات", desc: "خبرة موسّعة في إنتاجات القطاع الحكومي والشركات الكبرى." }, en: { title: "Government & Corporate", desc: "Extensive experience in government and major-corporate productions." } },
  { key: "wedding",     icon: I.diamond,    premium: true, ar: { title: "أفلام الأعراس الفاخرة", desc: "تخصّص متميّز — فرق إنتاج رجالية ونسائية احترافية كاملة." }, en: { title: "Luxury Wedding Cinematography", desc: "A distinguished specialty — full professional men's and women's crews." } },
];

function Card({ s, i }: { s: Svc; i: number }) {
  const { t } = useI18n();
  return (
    <motion.div
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1], delay: (i % 4) * 0.06 }}
      className={`svc-card ${s.premium ? "is-signature" : ""}`}
    >
      {s.premium && (
        <span className="f-sans absolute top-4 right-4" style={{ fontSize: "8.5px", letterSpacing: "2.5px", color: "var(--red)", textTransform: "uppercase", padding: "3px 9px", border: "1px solid rgba(193,18,31,0.45)", fontWeight: 600, borderRadius: "2px" }}>
          Signature
        </span>
      )}
      <div className="svc-icon">{s.icon}</div>
      <h3 className="text-white" style={{ fontSize: "17px", fontWeight: 700, lineHeight: 1.35, letterSpacing: "-0.005em", marginBottom: "12px" }}>
        {t({ ar: s.ar.title, en: s.en.title })}
      </h3>
      <p className="text-white/55" style={{ fontSize: "13.5px", lineHeight: 1.75, fontWeight: 400 }}>
        {t({ ar: s.ar.desc, en: s.en.desc })}
      </p>
    </motion.div>
  );
}

export default function Services() {
  const { t } = useI18n();
  return (
    <section id="services" className="relative overflow-hidden" style={{ background: "#0B0B0B", paddingTop: "140px", paddingBottom: "140px" }}>
      <div className="sec-gradient" />
      <div className="max-w-7xl mx-auto px-6 lg:px-12 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.85 }}
          className="text-center mb-16"
          data-reveal
        >
          <div className="eyebrow mb-6 mx-auto">{t({ ar: "تخصّصاتنا", en: "Our Specialties" })}</div>
          <h2 className="editorial text-white" style={{ fontSize: "clamp(34px,5vw,58px)" }}>
            {t({ ar: "إنتاج كامل لـ", en: "A full studio for" })}{" "}
            <em>{t({ ar: "كل ما يستحق التصوير", en: "every story worth telling" })}</em>
          </h2>
          <p className="text-white/45 mt-5" style={{ fontSize: "15px", lineHeight: 1.85, maxWidth: "640px", margin: "20px auto 0" }}>
            {t({
              ar: "خدمات إنتاج إعلامية كاملة — من الفكرة إلى التسليم النهائي — مصممة للجهات التي تختار التميّز.",
              en: "End-to-end media production — from concept to final delivery — designed for organizations that choose distinction.",
            })}
          </p>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {SERVICES.map((s, i) => <Card key={s.key} s={s} i={i} />)}
        </div>
      </div>
    </section>
  );
}
