"use client";
import { motion } from "framer-motion";
import { useI18n } from "@/lib/i18n";

type Svc = {
  num: string;
  ar: { title: string; desc: string };
  en: { title: string; desc: string };
  premium?: boolean;
};

const SERVICES: Svc[] = [
  { num: "01", ar: { title: "الإنتاج السينمائي", desc: "إنتاج كامل بمعايير سينمائية عالمية — من السيناريو والإخراج إلى التصوير والمعالجة النهائية." },
                en: { title: "Cinematic Production", desc: "Full production at international cinematic standards — from script and direction to filming and final grading." } },
  { num: "02", ar: { title: "الإعلانات التجارية", desc: "إعلانات بصرية مصممة لتحرّك القرار الشرائي وتعيد تعريف حضور علامتك في السوق." },
                en: { title: "Commercial Advertisements", desc: "Visual ads engineered to drive purchase decisions and redefine your brand's market presence." } },
  { num: "03", ar: { title: "الأفلام المؤسسية", desc: "أفلام شركات تروي قصة المؤسسة بلغة بصرية تليق بحجمها — للجهات الحكومية والشركات الكبرى." },
                en: { title: "Corporate Films", desc: "Corporate films that tell your organization's story in a visual language worthy of its scale — for government and major corporates." } },
  { num: "04", ar: { title: "الأفلام الوثائقية", desc: "إنتاج وثائقي يحفظ الإرث ويروي القصص الإنسانية — بحث، سيناريو، تصوير ميداني، ومعالجة كاملة." },
                en: { title: "Documentary Films", desc: "Documentary production that preserves heritage and tells human stories — research, script, on-location filming, and full post." } },
  { num: "05", ar: { title: "التصوير الجوي بالدرون", desc: "أطقم درون احترافية معتمدة، تسجّل المشاريع بدقة 4K وزوايا لا يمكن الحصول عليها بأي وسيلة أخرى." },
                en: { title: "Drone Cinematography", desc: "Certified professional drone crews capturing projects in 4K with perspectives unobtainable any other way." } },
  { num: "06", ar: { title: "تغطية الفعاليات", desc: "تغطية شاملة للمؤتمرات، الإطلاقات، والفعاليات الكبرى — من اللقطة الأولى إلى الفيديو النهائي." },
                en: { title: "Event Coverage", desc: "Comprehensive coverage for conferences, launches, and major events — from the first shot to the final cut." } },
  { num: "07", ar: { title: "البثّ المباشر متعدد الكاميرات", desc: "بثّ مباشر بجودة تلفزيونية، تحكم لحظي، وتوصيل احترافي للمؤتمرات والإطلاقات." },
                en: { title: "Live Streaming & Multi-Camera", desc: "Broadcast-grade live streaming with real-time switching for conferences and launches." } },
  { num: "08", ar: { title: "التصوير العقاري السينمائي", desc: "أفلام عقارية بمعايير دولية للمطورين والمشاريع الفاخرة — لقطات أرضية وجوية بمستوى تسويقي راقٍ." },
                en: { title: "Real Estate Cinematic", desc: "International-grade real estate films for developers and luxury projects — ground and aerial at a premium marketing level." } },
  { num: "09", ar: { title: "إعلانات المنتجات", desc: "أفلام منتجات سينمائية بإضاءة استوديو وحركة كاميرا دقيقة — لإطلاقات تستحق التميّز." },
                en: { title: "Product Commercials", desc: "Cinematic product films with studio lighting and precise camera motion — for launches that deserve to stand out." } },
  { num: "10", ar: { title: "حملات السوشيال ميديا", desc: "حملات محتوى متكاملة — ريلز، شورتس، وفيديوهات قصيرة بإيقاع سريع لرفع التفاعل وزيادة الوصول." },
                en: { title: "Social Media Campaigns", desc: "Integrated content campaigns — reels, shorts, and short-form video at high tempo to boost engagement and reach." } },
  { num: "11", ar: { title: "سرد قصص العلامات", desc: "نبني للعلامة سردًا بصريًا أصيلًا يتجاوز الإعلان — قصة تُبنى عليها العلاقة طويلة الأمد مع الجمهور." },
                en: { title: "Brand Storytelling", desc: "We build an authentic visual narrative for the brand — a story that becomes the foundation of long-term audience relationships." } },
  { num: "12", ar: { title: "الإخراج الإبداعي", desc: "رؤية إخراجية متكاملة — من المعالجة الفكرية والقصصية إلى تصميم اللقطات والمسار الصوتي." },
                en: { title: "Creative Direction", desc: "End-to-end directorial vision — from conceptual treatment and storyboarding to shot design and soundtrack." } },
  { num: "13", ar: { title: "إنتاج البودكاست", desc: "بودكاست بجودة استوديو — تصوير متعدد الكاميرات، صوت احترافي، ومعالجة جاهزة لكل المنصات." },
                en: { title: "Podcast Production", desc: "Studio-grade podcasts — multi-cam filming, professional audio, and platform-ready post." } },
  { num: "14", ar: { title: "التصوير الفوتوغرافي", desc: "تصوير احترافي للشركات، المنتجات، والعقارات بإضاءة سينمائية ومعالجة لونية متقنة." },
                en: { title: "Photography", desc: "Professional photography for corporates, products, and real estate with cinematic lighting and precise color." } },
  { num: "15", ar: { title: "إنتاجات الجهات الحكومية والشركات", desc: "خبرة موسّعة في إنتاجات القطاع الحكومي والشركات الكبرى — تنفيذ يلتزم بمواصفات الجهة الرسمية." },
                en: { title: "Government & Corporate Productions", desc: "Extensive experience in government and major-corporate productions — execution aligned with official specifications." } },
  { num: "16", premium: true,
                ar: { title: "أفلام الأعراس الفاخرة", desc: "تخصص متميّز — فرق إنتاج رجالية احترافية كاملة، وفرق إنتاج نسائية احترافية كاملة. سينما أعراس بمستوى عالمي." },
                en: { title: "Luxury Wedding Cinematography", desc: "A distinguished specialty — fully professional men's production crews, and fully professional women's production crews. World-class wedding cinema." } },
];

function Card({ s, i }: { s: Svc; i: number }) {
  const { t } = useI18n();
  return (
    <motion.div
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1], delay: (i % 3) * 0.06 }}
      className="group relative p-9 lg:p-11 transition-all duration-500 hover:bg-black"
      style={{
        background: s.premium ? "linear-gradient(135deg, rgba(227,30,36,0.05) 0%, rgba(0,0,0,0) 100%)" : "#0a0a0a",
        border: "1px solid " + (s.premium ? "rgba(227,30,36,0.25)" : "rgba(255,255,255,0.06)"),
      }}
    >
      {s.premium && (
        <span className="absolute top-5 right-5 f-sans" style={{ fontSize: "9px", letterSpacing: "2.5px", color: "var(--red)", textTransform: "uppercase", padding: "3px 9px", border: "1px solid rgba(227,30,36,0.4)", fontWeight: 600 }}>
          Signature
        </span>
      )}
      {/* Number — subtle, editorial */}
      <div className="f-serif italic mb-5" style={{ fontSize: "32px", color: "rgba(255,255,255,0.18)", lineHeight: 1, fontWeight: 400 }}>
        {s.num}
      </div>
      <h3 className="text-white mb-4" style={{ fontSize: "20px", fontWeight: 700, lineHeight: 1.35, letterSpacing: "-0.005em" }}>
        {t({ ar: s.ar.title, en: s.en.title })}
      </h3>
      <span className="block w-10 h-px mb-5 transition-all duration-500 group-hover:w-16" style={{ background: "var(--red)" }} />
      <p className="text-white/55" style={{ fontSize: "14px", lineHeight: 1.85, fontWeight: 400 }}>
        {t({ ar: s.ar.desc, en: s.en.desc })}
      </p>
    </motion.div>
  );
}

export default function Services() {
  const { t } = useI18n();
  return (
    <section id="services" className="relative overflow-hidden" style={{ background: "#050505", paddingTop: "140px", paddingBottom: "140px" }}>
      <div className="max-w-7xl mx-auto px-6 lg:px-12">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.85 }}
          className="text-center mb-20"
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

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {SERVICES.map((s, i) => <Card key={s.num} s={s} i={i} />)}
        </div>
      </div>
    </section>
  );
}
