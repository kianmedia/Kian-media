"use client";
import { motion } from "framer-motion";
import { useI18n } from "@/lib/i18n";

const PILLARS = [
  { num: "I",   ar: { title: "السينمائية معيارنا",         desc: "لا نُصوّر فيديو — نُنتج فيلمًا. كل لقطة مدروسة من الزاوية إلى التدرّج اللوني." }, en: { title: "Cinematic by Default", desc: "We don't shoot video — we produce cinema. Every shot is deliberate, from angle to color grade." } },
  { num: "II",  ar: { title: "إنتاج متكامل داخليًا",        desc: "من الفكرة والسيناريو إلى التصوير والمونتاج — كل المراحل تحت سقف واحد." }, en: { title: "Full In-House Production", desc: "From concept and script to filming and post — every stage under one roof." } },
  { num: "III", ar: { title: "مصمَّمة للقطاعات الكبرى",     desc: "خبرة موسّعة مع الجهات الحكومية، الشركات الكبرى، والمشاريع العقارية الفاخرة." }, en: { title: "Built for Corporate & Government", desc: "Extensive experience with government entities, major corporates, and luxury real estate." } },
  { num: "IV",  ar: { title: "كل المناطق، معيار واحد",     desc: "نُنفّذ مشاريعنا في كل مناطق المملكة بنفس الجودة السينمائية." }, en: { title: "All Regions, One Standard", desc: "We deliver projects across all regions of the Kingdom — at the same cinematic standard." } },
  { num: "V",   ar: { title: "نروي قصة، لا نُكرّر قالبًا",  desc: "كل عميل يحصل على رؤية إخراجية أصلية تليق به — لا قوالب جاهزة." }, en: { title: "Story-Driven, Not Template", desc: "Every client gets an original directorial vision that fits them — never a template." } },
  { num: "VI",  ar: { title: "تسليم تستطيع البناء عليه",   desc: "نلتزم بالمواعيد كما نلتزم بالجودة. جداول واضحة، تقارير دورية، وتسليم نهائي بالمواصفات." }, en: { title: "Delivery You Can Plan Around", desc: "We honor schedules as much as quality. Clear timelines, regular reporting, spec-true final delivery." } },
];

export default function WhyKian() {
  const { t } = useI18n();
  return (
    <section id="why" className="relative overflow-hidden" style={{ background: "#050505", paddingTop: "140px", paddingBottom: "140px" }}>
      <div className="max-w-7xl mx-auto px-6 lg:px-12">

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 mb-20" data-reveal>
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.9 }}
            className="lg:col-span-5"
          >
            <div className="eyebrow mb-6">{t({ ar: "لماذا كيان ميديا", en: "Why Kian Media" })}</div>
            <h2 className="editorial text-white" style={{ fontSize: "clamp(36px,5vw,64px)" }}>
              {t({ ar: "لا نبيع", en: "We don't sell" })} <em>{t({ ar: "فيديو", en: "video" })}</em>.
              <br />
              {t({ ar: "نبني", en: "We build" })} <em>{t({ ar: "حضور علامة", en: "brand authority" })}</em>.
            </h2>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.9, delay: 0.15 }}
            className="lg:col-span-7 lg:pt-16"
          >
            <p className="text-white/65" style={{ fontSize: "19px", lineHeight: 1.9 }}>
              {t({
                ar: "المحتوى البصري اليوم هو لغة العلامات الرائدة. ما نُقدّمه ليس تصويرًا — بل بناء حضور بصري يُعيد تعريف موقعك في السوق ويُحوّل المشاهد إلى عميل.",
                en: "Today's visual content is the language of leading brands. What we deliver is not filming — it's building a visual presence that redefines your position in the market and converts viewers into clients.",
              })}
            </p>
            <span className="red-line mt-8" />
            <p className="f-sans text-white/40" style={{ fontSize: "13px", lineHeight: 1.8 }}>
              {t({
                ar: "كل إنتاج هو فعل مقصود لبناء العلامة — مُهَندَس ليرفع كيف يرى السوق علامتك ويتذكّرها ويختارها.",
                en: "Every production is a deliberate act of brand building — engineered to elevate how the market sees, remembers, and chooses you.",
              })}
            </p>
          </motion.div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px" style={{ background: "rgba(255,255,255,0.08)" }}>
          {PILLARS.map((p, i) => (
            <motion.div
              key={p.num}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.65, delay: (i % 3) * 0.08 }}
              className="group p-10 transition-all duration-500"
              style={{ background: "#050505" }}
            >
              <div className="flex items-baseline gap-4 mb-6">
                <span className="f-serif italic" style={{ fontSize: "36px", color: "var(--red)", lineHeight: 1 }}>{p.num}</span>
                <span className="block flex-1 h-px" style={{ background: "rgba(255,255,255,0.1)" }} />
              </div>
              <h3 className="text-white mb-4" style={{ fontSize: "20px", fontWeight: 600, lineHeight: 1.3 }}>{t({ ar: p.ar.title, en: p.en.title })}</h3>
              <p className="text-white/50" style={{ fontSize: "14px", lineHeight: 1.8 }}>{t({ ar: p.ar.desc, en: p.en.desc })}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
