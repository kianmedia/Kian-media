"use client";
import { motion } from "framer-motion";

type Pillar = { num: string; ar: string; en: string; desc: string };

const PILLARS: Pillar[] = [
  {
    num: "I",
    en: "Cinematic by Default",
    ar: "السينمائية معيارنا",
    desc: "لا نُصوّر فيديو — نُنتج فيلمًا. كل لقطة مدروسة من زاوية الكاميرا إلى تدرّج الألوان، بمعايير الإنتاج الدولي.",
  },
  {
    num: "II",
    en: "Full In-House Production",
    ar: "إنتاج متكامل داخليًا",
    desc: "من الفكرة والسيناريو إلى التصوير والمونتاج والتسليم النهائي — كل المراحل تحت سقف واحد. لا وسطاء، لا تأخير.",
  },
  {
    num: "III",
    en: "Built for Corporate & Government",
    ar: "مصمّمة للقطاعات الكبرى",
    desc: "خبرة موسّعة مع الجهات الحكومية، الشركات الكبرى، والمشاريع العقارية الفاخرة في جميع مناطق المملكة.",
  },
  {
    num: "IV",
    en: "13 Regions, One Standard",
    ar: "١٣ منطقة، معيار واحد",
    desc: "نُنفّذ مشاريعنا في كل مناطق المملكة بنفس الجودة السينمائية — أطقم احترافية، معدّات كاملة، وحضور ميداني سريع.",
  },
  {
    num: "V",
    en: "Story-Driven, Not Template",
    ar: "نروي قصة، لا نُكرّر قالبًا",
    desc: "كل عميل يحصل على رؤية إخراجية أصلية تليق به. لا نُعيد استخدام صيَغ جاهزة — كل مشروع له هويته البصرية الخاصة.",
  },
  {
    num: "VI",
    en: "Delivery You Can Plan Around",
    ar: "تسليم تستطيع البناء عليه",
    desc: "نلتزم بالمواعيد كما نلتزم بالجودة. جداول إنتاج واضحة، تقارير دورية، وتسليم نهائي بالمواصفات المتفق عليها.",
  },
];

export default function WhyKian() {
  return (
    <section id="why" className="relative overflow-hidden" style={{ background: "#050505", paddingTop: "120px", paddingBottom: "120px" }}>
      <div className="max-w-7xl mx-auto px-6 lg:px-12">

        {/* Top: bold editorial statement */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 mb-20" data-reveal>
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
            className="lg:col-span-5"
          >
            <div className="eyebrow mb-6">Why Kian Media</div>
            <h2 className="editorial text-white" style={{ fontSize: "clamp(36px,5vw,64px)" }}>
              We don't sell <em>video</em>.
              <br />
              We build <em>brand authority</em>.
            </h2>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1], delay: 0.15 }}
            className="lg:col-span-7 lg:pt-20"
          >
            <p className="f-arabic text-white/65" style={{ fontSize: "20px", lineHeight: 1.9 }}>
              المحتوى البصري اليوم هو لغة العلامات التجارية الرائدة. ما نُقدّمه ليس مجرد تصوير — بل بناء حضور بصري قوي يُعيد تعريف موقعك في السوق، ويُحوّل المشاهد إلى عميل، والعميل إلى شريك.
            </p>
            <span className="red-line mt-8" />
            <p className="f-sans text-white/40" style={{ fontSize: "13px", lineHeight: 1.8, letterSpacing: "0.5px" }}>
              Every production is a deliberate act of brand building — engineered to elevate how the market perceives, remembers, and chooses you.
            </p>
          </motion.div>
        </div>

        {/* Six pillars grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px" style={{ background: "rgba(255,255,255,0.08)" }}>
          {PILLARS.map((p, i) => (
            <motion.div
              key={p.num}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.65, ease: [0.16, 1, 0.3, 1], delay: (i % 3) * 0.08 }}
              className="group p-10 transition-all duration-500"
              style={{ background: "#050505" }}
            >
              {/* Roman numeral */}
              <div className="flex items-baseline gap-4 mb-6">
                <span className="f-serif italic" style={{ fontSize: "36px", color: "var(--red)", lineHeight: 1 }}>{p.num}</span>
                <span className="block flex-1 h-px" style={{ background: "rgba(255,255,255,0.1)" }} />
              </div>
              <div className="f-sans mb-2" style={{ fontSize: "10px", letterSpacing: "3px", color: "rgba(227,30,36,0.85)", textTransform: "uppercase" }}>{p.en}</div>
              <h3 className="f-arabic text-white mb-4" style={{ fontSize: "20px", fontWeight: 600, lineHeight: 1.3 }}>{p.ar}</h3>
              <p className="f-arabic text-white/50" style={{ fontSize: "14px", lineHeight: 1.8 }}>{p.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
