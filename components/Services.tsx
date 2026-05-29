"use client";
import { motion } from "framer-motion";
import { useI18n } from "@/lib/i18n";

type Svc = {
  num: string;
  icon: string;
  ar: { title: string; desc: string };
  en: { title: string; desc: string };
  premium?: boolean;
};

const SERVICES: Svc[] = [
  { num: "01", icon: "◼", ar: { title: "الإنتاج السينمائي", desc: "إنتاج كامل بمعايير سينمائية عالمية — من السيناريو والإخراج إلى التصوير والمعالجة النهائية." },
                          en: { title: "Cinematic Production", desc: "Full production at international cinematic standards — from script and direction to filming and final grading." } },
  { num: "02", icon: "◼", ar: { title: "الإعلانات التجارية", desc: "إعلانات بصرية مُصمَّمة لتُحرّك القرار الشرائي وتُعيد تعريف حضور علامتك في السوق." },
                          en: { title: "Commercial Advertisements", desc: "Visual ads engineered to drive purchase decisions and redefine your brand's market presence." } },
  { num: "03", icon: "◼", ar: { title: "الأفلام المؤسّسية", desc: "أفلام شركات تروي قصة المؤسّسة بلغة بصرية تليق بحجمها — للجهات الحكومية والشركات الكبرى." },
                          en: { title: "Corporate Films", desc: "Corporate films that tell your organization's story in a visual language worthy of its scale — for government and major corporates." } },
  { num: "04", icon: "◼", ar: { title: "الأفلام الوثائقية", desc: "إنتاج وثائقي يحفظ الإرث ويروي القصص الإنسانية — بحث، سيناريو، تصوير ميداني، ومعالجة كاملة." },
                          en: { title: "Documentary Films", desc: "Documentary production that preserves heritage and tells human stories — research, script, on-location filming, and full post." } },
  { num: "05", icon: "◼", ar: { title: "التصوير الجوي بالدرون", desc: "أطقم درون احترافية معتمدة، تُسجّل المشاريع بدقة 4K وزوايا لا يُمكن الحصول عليها بأي وسيلة أخرى." },
                          en: { title: "Drone Cinematography", desc: "Certified professional drone crews capturing projects in 4K with perspectives unobtainable any other way." } },
  { num: "06", icon: "◼", ar: { title: "تغطية الفعاليات", desc: "تغطية شاملة للمؤتمرات، الإطلاقات، والفعاليات الكبرى — من اللقطة الأولى إلى الفيديو النهائي." },
                          en: { title: "Event Coverage", desc: "Comprehensive coverage for conferences, launches, and major events — from the first shot to the final cut." } },
  { num: "07", icon: "◼", ar: { title: "البثّ المباشر متعدّد الكاميرات", desc: "بثّ مباشر بجودة تلفزيونية، تحكّم لحظي، وتوصيل احترافي للمؤتمرات والإطلاقات." },
                          en: { title: "Live Streaming & Multi-Camera", desc: "Broadcast-grade live streaming with real-time switching for conferences and launches." } },
  { num: "08", icon: "◼", ar: { title: "التصوير العقاري السينمائي", desc: "أفلام عقارية بمعايير دولية للمطوّرين والمشاريع الفاخرة — لقطات أرضية وجوية بمستوى تسويقي راقٍ." },
                          en: { title: "Real Estate Cinematic", desc: "International-grade real estate films for developers and luxury projects — ground and aerial at a premium marketing level." } },
  { num: "09", icon: "◼", ar: { title: "إعلانات المنتجات", desc: "أفلام منتجات سينمائية بإضاءة استوديو وحركة كاميرا دقيقة — لإطلاقات تستحق التميّز." },
                          en: { title: "Product Commercials", desc: "Cinematic product films with studio lighting and precise camera motion — for launches that deserve to stand out." } },
  { num: "10", icon: "◼", ar: { title: "حملات السوشيال ميديا", desc: "حملات محتوى متكاملة — ريلز، شورتس، وفيديوهات قصيرة بإيقاع سريع لرفع التفاعل وزيادة الوصول." },
                          en: { title: "Social Media Campaigns", desc: "Integrated content campaigns — reels, shorts, and short-form video at high tempo to boost engagement and reach." } },
  { num: "11", icon: "◼", ar: { title: "سرد قصص العلامات", desc: "نبني للعلامة سردًا بصريًا أصيلًا يتجاوز الإعلان — قصة تُبنى عليها العلاقة طويلة الأمد مع الجمهور." },
                          en: { title: "Brand Storytelling", desc: "We build an authentic visual narrative for the brand — a story that becomes the foundation of long-term audience relationships." } },
  { num: "12", icon: "◼", ar: { title: "الإخراج الإبداعي", desc: "رؤية إخراجية متكاملة — من المعالجة الفكرية والقصصية إلى تصميم اللقطات والمسار الصوتي." },
                          en: { title: "Creative Direction", desc: "End-to-end directorial vision — from conceptual treatment and storyboarding to shot design and soundtrack." } },
  { num: "13", icon: "◼", ar: { title: "إنتاج البودكاست", desc: "بودكاست بجودة استوديو — تصوير متعدّد الكاميرات، صوت احترافي، ومعالجة جاهزة لكل المنصات." },
                          en: { title: "Podcast Production", desc: "Studio-grade podcasts — multi-cam filming, professional audio, and platform-ready post." } },
  { num: "14", icon: "◼", ar: { title: "التصوير الفوتوغرافي", desc: "تصوير احترافي للشركات، المنتجات، والعقارات بإضاءة سينمائية ومعالجة لونية متقنة." },
                          en: { title: "Photography", desc: "Professional photography for corporates, products, and real estate with cinematic lighting and precise color." } },
  { num: "15", icon: "◼", ar: { title: "إنتاجات الجهات الحكومية والشركات", desc: "خبرة موسّعة في إنتاجات القطاع الحكومي والشركات الكبرى — تنفيذ يلتزم بمواصفات الجهة الرسمية." },
                          en: { title: "Government & Corporate Productions", desc: "Extensive experience in government and major-corporate productions — execution aligned with official specifications." } },
  // Premium specialty — last
  { num: "16", icon: "◆", premium: true,
                          ar: { title: "أفلام الأعراس الفاخرة", desc: "تخصّص متميّز — فرق إنتاج رجالية احترافية كاملة، وفرق إنتاج نسائية احترافية كاملة. سينما أعراس بمستوى عالمي." },
                          en: { title: "Luxury Wedding Cinematography", desc: "A distinguished specialty — fully professional men's production crews, and fully professional women's production crews. World-class wedding cinema." } },
];

function Card({ s, i }: { s: Svc; i: number }) {
  const { t } = useI18n();
  const title = t({ ar: s.ar.title, en: s.en.title });
  const desc = t({ ar: s.ar.desc, en: s.en.desc });
  return (
    <motion.div
      initial={{ opacity: 0, y: 36 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.65, ease: [0.16, 1, 0.3, 1], delay: (i % 3) * 0.06 }}
      className="group relative glass p-8 lg:p-10 transition-all duration-500"
      style={{
        borderColor: s.premium ? "rgba(227,30,36,0.35)" : "rgba(255,255,255,0.08)",
        background: s.premium ? "linear-gradient(135deg, rgba(227,30,36,0.08) 0%, rgba(0,0,0,0) 100%)" : undefined,
      }}
    >
      {s.premium && (
        <span className="absolute top-4 right-4 f-sans" style={{ fontSize: "9px", letterSpacing: "2.5px", color: "var(--red)", textTransform: "uppercase", padding: "3px 8px", border: "1px solid rgba(227,30,36,0.4)" }}>
          Signature
        </span>
      )}
      <span className="absolute top-6 left-6 num" style={{ fontSize: "64px" }}>{s.num}</span>
      <div className="mb-6" style={{ fontSize: "26px", color: s.premium ? "var(--red)" : "rgba(227,30,36,0.7)" }}>{s.icon}</div>
      <h3 className="text-white mb-3" style={{ fontSize: "20px", fontWeight: 600, lineHeight: 1.3 }}>{title}</h3>
      <span className="block w-12 h-px mb-4 transition-all duration-500 group-hover:w-20" style={{ background: "var(--red)" }} />
      <p className="text-white/55" style={{ fontSize: "14px", lineHeight: 1.8 }}>{desc}</p>
    </motion.div>
  );
}

export default function Services() {
  const { t } = useI18n();
  return (
    <section id="services" className="relative overflow-hidden" style={{ background: "#050505", paddingTop: "140px", paddingBottom: "140px" }}>
      <div className="max-w-7xl mx-auto px-6 lg:px-12">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.9 }}
          className="text-center mb-20"
          data-reveal
        >
          <div className="eyebrow mb-6 mx-auto">{t({ ar: "تخصّصاتنا", en: "Our Specialties" })}</div>
          <h2 className="editorial text-white" style={{ fontSize: "clamp(34px,5vw,58px)" }}>
            {t({ ar: "إنتاج كامل لـ", en: "A full studio for" })}{" "}
            <em>{t({ ar: "كل ما يستحق التصوير", en: "every story worth telling" })}</em>.
          </h2>
          <p className="text-white/45 mt-4" style={{ fontSize: "16px", lineHeight: 1.8, maxWidth: "640px", margin: "16px auto 0" }}>
            {t({
              ar: "خدمات إنتاج إعلامية كاملة — من الفكرة إلى التسليم النهائي — مصمَّمة للجهات التي تختار التميّز.",
              en: "End-to-end media production — from concept to final delivery — designed for organizations that choose distinction.",
            })}
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {SERVICES.map((s, i) => <Card key={s.num} s={s} i={i} />)}
        </div>
      </div>
    </section>
  );
}
