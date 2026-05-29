"use client";
import { motion } from "framer-motion";
import { useI18n } from "@/lib/i18n";

const PILLARS = [
  { num: "I",   ar: { title: "السينمائية معيارنا",        desc: "لا نُصوّر فيديو — نُنتج فيلمًا. كل لقطة مدروسة من الزاوية إلى التدرّج اللوني." }, en: { title: "Cinematic by Default", desc: "We don't shoot video — we produce cinema. Every shot is deliberate, from angle to color grade." } },
  { num: "II",  ar: { title: "إنتاج متكامل داخليًا",       desc: "من الفكرة والسيناريو إلى التصوير والمونتاج — كل المراحل تحت سقف واحد." }, en: { title: "Full In-House Production", desc: "From concept and script to filming and post — every stage under one roof." } },
  { num: "III", ar: { title: "مصمَّمة للقطاعات الكبرى",    desc: "خبرة موسّعة مع الجهات الحكومية، الشركات الكبرى، والمشاريع العقارية الفاخرة." }, en: { title: "Built for Corporate & Government", desc: "Extensive experience with government entities, major corporates, and luxury real estate." } },
  { num: "IV",  ar: { title: "كل المناطق، معيار واحد",    desc: "نُنفّذ مشاريعنا في كل مناطق المملكة بنفس الجودة السينمائية — وخارجها." }, en: { title: "All Regions, One Standard", desc: "We deliver across all regions of the Kingdom — and beyond — at the same cinematic standard." } },
  { num: "V",   ar: { title: "نروي قصة، لا نُكرّر قالبًا", desc: "كل عميل يحصل على رؤية إخراجية أصلية تليق به — لا قوالب جاهزة." }, en: { title: "Story-Driven, Not Template", desc: "Every client gets an original directorial vision that fits them — never a template." } },
  { num: "VI",  ar: { title: "تسليم تستطيع البناء عليه",  desc: "نلتزم بالمواعيد كما نلتزم بالجودة. جداول واضحة، تقارير دورية، وتسليم نهائي بالمواصفات." }, en: { title: "Delivery You Can Plan Around", desc: "We honor schedules as much as quality. Clear timelines, regular reporting, spec-true final delivery." } },
];

export default function WhyKian() {
  const { t } = useI18n();
  return (
    <section id="why" className="relative overflow-hidden" style={{ background: "#080808", paddingTop: "140px", paddingBottom: "140px" }}>
      <div className="max-w-7xl mx-auto px-6 lg:px-12">

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 mb-20" data-reveal>
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.85 }}
            className="lg:col-span-5"
          >
            <div className="eyebrow mb-6">{t({ ar: "لماذا كيان ميديا", en: "Why Kian Media" })}</div>
            <h2 className="editorial text-white" style={{ fontSize: "clamp(34px,5vw,60px)" }}>
              {t({ ar: "لا نبيع", en: "We don't sell" })} <em>{t({ ar: "فيديو", en: "video" })}</em>.
              <br />
              {t({ ar: "نبني", en: "We build" })} <em>{t({ ar: "حضور علامة", en: "brand authority" })}</em>.
            </h2>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.85, delay: 0.12 }}
            className="lg:col-span-7 lg:pt-16"
          >
            <p className="text-white/65" style={{ fontSize: "19px", lineHeight: 1.85, fontWeight: 400 }}>
              {t({
                ar: "المحتوى البصري اليوم هو لغة العلامات الرائدة. ما نُقدّمه ليس تصويرًا — بل بناء حضور بصري يعيد تعريف موقعك في السوق ويحوّل المشاهد إلى عميل.",
                en: "Visual content is the language of leading brands today. What we deliver isn't filming — it's building a visual presence that redefines your position in the market and converts viewers into clients.",
              })}
            </p>
            <span className="red-line mt-8" />
            <p className="text-white/40" style={{ fontSize: "13px", lineHeight: 1.85, fontWeight: 400 }}>
              {t({
                ar: "كل إنتاج هو فعل مقصود لبناء العلامة — مُهَندَس ليرفع كيف يرى السوق علامتك ويتذكّرها ويختارها.",
                en: "Every production is a deliberate act of brand building — engineered to elevate how the market sees, remembers, and chooses you.",
              })}
            </p>
          </motion.div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px" style={{ background: "rgba(255,255,255,0.06)" }}>
          {PILLARS.map((p, i) => (
            <motion.div
              key={p.num}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: (i % 3) * 0.07 }}
              className="group p-10 lg:p-12 transition-all duration-500"
              style={{ background: "#080808" }}
            >
              <div className="flex items-baseline gap-4 mb-6">
                <span className="f-serif italic" style={{ fontSize: "30px", color: "rgba(255,255,255,0.18)", lineHeight: 1, fontWeight: 400 }}>{p.num}</span>
                <span className="block flex-1 h-px" style={{ background: "rgba(255,255,255,0.08)" }} />
              </div>
              <h3 className="text-white mb-4" style={{ fontSize: "19px", fontWeight: 700, lineHeight: 1.35, letterSpacing: "-0.005em" }}>
                {t({ ar: p.ar.title, en: p.en.title })}
              </h3>
              <p className="text-white/50" style={{ fontSize: "14px", lineHeight: 1.85, fontWeight: 400 }}>
                {t({ ar: p.ar.desc, en: p.en.desc })}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
