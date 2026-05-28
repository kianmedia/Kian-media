"use client";
import { motion } from "framer-motion";

type Svc = { num: string; ar: string; en: string; desc: string; icon: string };

const SERVICES: Svc[] = [
  {
    num: "01",
    ar: "أفلام الشركات",
    en: "Corporate Films",
    desc: "نُنتج أفلامًا مؤسسية تروي قصة علامتك التجارية بلغة بصرية تليق بحجمها — للجهات الحكومية، الشركات الكبرى، والمشاريع التي تسعى للقيادة.",
    icon: "🏛",
  },
  {
    num: "02",
    ar: "الإعلانات التجارية",
    en: "Commercial Ads",
    desc: "إعلانات سينمائية مدروسة من السيناريو إلى التسليم النهائي — مصممة لتُحرّك القرار وتُعيد تعريف حضور علامتك في السوق السعودي والخليجي.",
    icon: "🎬",
  },
  {
    num: "03",
    ar: "التصوير الجوي بالدرون",
    en: "Drone Cinematography",
    desc: "أطقم درون احترافية معتمدة، تُسجّل المشاريع العقارية والصناعية والسياحية بدقة 4K — منظور لا يُمكن الحصول عليه بأي وسيلة أخرى.",
    icon: "🚁",
  },
  {
    num: "04",
    ar: "البث المباشر متعدد الكاميرات",
    en: "Live Streaming & Multi-Camera",
    desc: "بث مباشر بتقنية متعددة الكاميرات للمؤتمرات، الإطلاقات، والفعاليات الكبرى — مع تحكم لحظي وجودة بثّ تليفزيونية.",
    icon: "📡",
  },
  {
    num: "05",
    ar: "تغطية الفعاليات",
    en: "Event Coverage",
    desc: "تغطية شاملة للحفلات، المؤتمرات، والإطلاقات في جميع مناطق المملكة — من اللحظة الأولى إلى الفيديو الترويجي والتقرير الإعلامي الكامل.",
    icon: "🎪",
  },
  {
    num: "06",
    ar: "تصوير العقارات والمشاريع",
    en: "Real Estate Filming",
    desc: "أفلام عقارية بمعايير دولية للمطورين والمشاريع الكبرى — لقطات أرضية وجوية، جولات سينمائية، وموادّ تسويقية موجّهة لشريحة عملاء فاخرة.",
    icon: "🏗",
  },
  {
    num: "07",
    ar: "الأفلام الوثائقية",
    en: "Documentary Production",
    desc: "إنتاج أفلام وثائقية تحفظ الإرث وتروي القصص الإنسانية — من البحث والسيناريو إلى التصوير الميداني والمعالجة النهائية.",
    icon: "📽",
  },
  {
    num: "08",
    ar: "أفلام الأعراس",
    en: "Wedding Films",
    desc: "أفلام أعراس بأسلوب سينمائي راقٍ، تُسجّل اللحظة كما تستحق أن تُتذكَّر — تصوير ميداني، مونتاج إخراجي، ومسارات صوتية أصلية.",
    icon: "💍",
  },
  {
    num: "09",
    ar: "محتوى السوشيال ميديا",
    en: "Social Media Reels",
    desc: "ريلز قصيرة بمستوى إنتاج سينمائي — مصممة لـ Instagram و TikTok بإيقاع سريع ومحتوى يجذب الجمهور المستهدف ويرفع معدّل التفاعل.",
    icon: "📱",
  },
  {
    num: "10",
    ar: "التصوير الفوتوغرافي",
    en: "Photography",
    desc: "تصوير فوتوغرافي احترافي للشركات، المنتجات، والعقارات — صور بإضاءة سينمائية ومعالجة لونية متقنة، جاهزة للحملات الإعلانية.",
    icon: "📸",
  },
];

function Card({ s, i }: { s: Svc; i: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 36 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: (i % 3) * 0.08 }}
      className="group relative glass p-8 lg:p-10 transition-all duration-500 hover:border-red-500/40"
      style={{ borderColor: "rgba(255,255,255,0.08)" }}
    >
      {/* Number watermark */}
      <span className="absolute top-6 left-6 num" style={{ fontSize: "64px" }}>{s.num}</span>

      {/* Icon */}
      <div className="mb-6 transition-transform duration-500 group-hover:-translate-y-1" style={{ fontSize: "32px" }}>{s.icon}</div>

      {/* English title */}
      <div className="f-sans mb-2" style={{ fontSize: "10px", letterSpacing: "3px", color: "rgba(227,30,36,0.85)", textTransform: "uppercase" }}>{s.en}</div>

      {/* Arabic title */}
      <h3 className="f-arabic text-white mb-4" style={{ fontSize: "22px", fontWeight: 600, lineHeight: 1.3 }}>{s.ar}</h3>

      <span className="block w-12 h-px mb-4 transition-all duration-500 group-hover:w-20" style={{ background: "var(--red)" }} />

      <p className="f-arabic text-white/55" style={{ fontSize: "14px", lineHeight: 1.8 }}>{s.desc}</p>
    </motion.div>
  );
}

export default function Services() {
  return (
    <section id="services" className="relative overflow-hidden" style={{ background: "#050505", paddingTop: "120px", paddingBottom: "120px" }}>
      {/* Decorative red lines */}
      <div className="absolute top-32 left-0 w-32 h-px" style={{ background: "linear-gradient(to right, var(--red), transparent)" }} />
      <div className="absolute bottom-32 right-0 w-32 h-px" style={{ background: "linear-gradient(to left, var(--red), transparent)" }} />

      <div className="max-w-7xl mx-auto px-6 lg:px-12">
        {/* Heading */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
          className="text-center mb-20"
          data-reveal
        >
          <div className="eyebrow mb-6 mx-auto">Our Services</div>
          <h2 className="editorial text-white" style={{ fontSize: "clamp(34px,5vw,58px)" }}>
            Built for brands that <em>command attention</em>.
          </h2>
          <p className="f-arabic text-white/45 mt-4" style={{ fontSize: "16px", lineHeight: 1.8, maxWidth: "640px", margin: "16px auto 0" }}>
            خدمات إنتاج إعلامية كاملة — من الفكرة إلى التسليم النهائي — مصممة للجهات التي تختار التميّز.
          </p>
        </motion.div>

        {/* Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {SERVICES.map((s, i) => <Card key={s.num} s={s} i={i} />)}
        </div>
      </div>
    </section>
  );
}
