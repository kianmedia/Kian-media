"use client";
import { motion } from "framer-motion";
import { useI18n } from "@/lib/i18n";

const PILLARS = [
  {
    ar: { title: "الإبداع السينمائي", desc: "نُخرج كل مشروع بعقلية المخرج لا المصوّر — لقطات مدروسة، إضاءة مقصودة، وسرد بصري يبني الانطباع." },
    en: { title: "Cinematic Craft", desc: "Every project is approached with a director's mindset — composed frames, intentional lighting, and a visual narrative that builds perception." },
  },
  {
    ar: { title: "تقنيات الإنتاج", desc: "كاميرات سينما متقدمة، أطقم درون احترافية، وأنظمة بثّ مباشر متعددة الكاميرات بمستوى الاستوديوهات الكبرى." },
    en: { title: "Production Technology", desc: "Advanced cinema cameras, professional drone systems, and multi-camera live production — at studio-grade level." },
  },
  {
    ar: { title: "الهوية البصرية", desc: "نُترجم هوية كل علامة تجارية إلى لغة بصرية متماسكة — من تدرّجات الألوان إلى الموسيقى التصويرية." },
    en: { title: "Visual Identity", desc: "We translate each brand into a coherent visual language — from color grading to the original soundtrack." },
  },
  {
    ar: { title: "تنفيذ احترافي", desc: "جداول إنتاج مدروسة، تواصل واضح، وتسليم في الموعد المتفق عليه — التزام مهني نقدّمه لكل عميل." },
    en: { title: "Professional Delivery", desc: "Disciplined schedules, clear communication, and on-time delivery — the operational standard we bring to every client." },
  },
];

export default function About() {
  const { t } = useI18n();

  return (
    <section id="about" className="relative overflow-hidden" style={{ background: "#050505", paddingTop: "140px", paddingBottom: "140px" }}>
      <div className="max-w-7xl mx-auto px-6 lg:px-12">

        {/* Editorial split */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-14 mb-28" data-reveal>
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.85 }}
            className="lg:col-span-5"
          >
            <div className="eyebrow mb-6">{t({ ar: "من نحن", en: "About Kian Media" })}</div>
            <h2 className="editorial text-white" style={{ fontSize: "clamp(36px,5vw,64px)" }}>
              {t({ ar: "نُنتج", en: "We produce" })} <em>{t({ ar: "أفلامًا", en: "cinema" })}</em>
              <br />
              {t({ ar: "لا فيديوهات.", en: "not video." })}
            </h2>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.85, delay: 0.12 }}
            className="lg:col-span-7 lg:pt-16 space-y-7"
          >
            {/* Opening line — updated per brief */}
            <p className="text-white/75" style={{ fontSize: "20px", lineHeight: 1.85, fontWeight: 400 }}>
              {t({
                ar: "كيان الابتكار للإنتاج الفني — شركة إنتاج سعودية متخصصة في صناعة المحتوى البصري السينمائي.",
                en: "Kian Al Ebtikar Art Production — a Saudi production house specialized in cinematic visual content.",
              })}
            </p>

            <span className="red-line" />

            <p className="text-white/55" style={{ fontSize: "16px", lineHeight: 1.9 }}>
              {t({
                ar: "نُنتج للشركات الكبرى، الجهات الحكومية، المطوّرين العقاريين، والعلامات التجارية التي تختار أن تظهر بمستوى مختلف. خبرتنا تمتدّ في الإنتاج السينمائي والإعلامي عبر جميع مناطق المملكة — من الإعلانات التجارية إلى الأفلام الوثائقية، ومن البثّ المباشر للفعاليات الكبرى إلى الأفلام المؤسّسية والإنتاج الفاخر للأعراس.",
                en: "We produce for major corporates, government entities, real estate developers, and brands that choose to appear at a different standard. Our experience spans cinematic and media production across all regions of Saudi Arabia — from commercial ads to documentaries, live broadcasting of major events, corporate films, and luxury wedding productions.",
              })}
            </p>

            {/* Headquarters & coverage block */}
            <div className="pt-2" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-6">
                <div>
                  <div className="f-sans mb-2" style={{ fontSize: "9px", letterSpacing: "3px", color: "rgba(227,30,36,0.85)", textTransform: "uppercase", fontWeight: 600 }}>
                    {t({ ar: "المقر الرئيسي", en: "Main Headquarters" })}
                  </div>
                  <div className="text-white" style={{ fontSize: "16px", fontWeight: 600 }}>
                    {t({ ar: "المنطقة الشرقية — الدمام", en: "Eastern Province — Dammam" })}
                  </div>
                </div>
                <div>
                  <div className="f-sans mb-2" style={{ fontSize: "9px", letterSpacing: "3px", color: "rgba(227,30,36,0.85)", textTransform: "uppercase", fontWeight: 600 }}>
                    {t({ ar: "حضور إقليمي", en: "Regional Presence" })}
                  </div>
                  <div className="text-white" style={{ fontSize: "16px", fontWeight: 500 }}>
                    {t({ ar: "الرياض · جدة · المدينة المنورة", en: "Riyadh · Jeddah · Madinah" })}
                  </div>
                </div>
              </div>

              <p className="text-white/55 mt-6" style={{ fontSize: "15px", lineHeight: 1.85, fontWeight: 400 }}>
                {t({
                  ar: "نخدم جميع مناطق المملكة العربية السعودية، بالإضافة إلى المشاريع والإنتاجات خارج المملكة.",
                  en: "We serve all regions of Saudi Arabia, in addition to projects and productions beyond the Kingdom.",
                })}
              </p>
            </div>
          </motion.div>
        </div>

        {/* Four pillars — refined typography, more spacious */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-px" style={{ background: "rgba(255,255,255,0.06)" }}>
          {PILLARS.map((p, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.65, delay: (i % 4) * 0.08 }}
              className="group p-10 lg:p-12 transition-all duration-500"
              style={{ background: "#050505" }}
            >
              {/* Roman numeral marker */}
              <div className="mb-6 flex items-baseline gap-3">
                <span className="f-serif italic" style={{ fontSize: "20px", color: "rgba(227,30,36,0.75)", lineHeight: 1, fontWeight: 400 }}>
                  {["I", "II", "III", "IV"][i]}
                </span>
                <span className="block flex-1 h-px" style={{ background: "rgba(255,255,255,0.08)" }} />
              </div>
              <h3 className="text-white mb-4" style={{ fontSize: "19px", fontWeight: 700, lineHeight: 1.35, letterSpacing: "-0.005em" }}>
                {t({ ar: p.ar.title, en: p.en.title })}
              </h3>
              <p className="text-white/55" style={{ fontSize: "14px", lineHeight: 1.85, fontWeight: 400 }}>
                {t({ ar: p.ar.desc, en: p.en.desc })}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
