"use client";
import { motion } from "framer-motion";
import { useI18n } from "@/lib/i18n";

const PILLARS = [
  {
    icon: "◆",
    ar: { title: "إبداع سينمائي", desc: "نُخرج كل مشروع بعقلية المُخرج لا المُصوّر — لقطات مدروسة، إضاءة مقصودة، وسرد بصري يبني الانطباع." },
    en: { title: "Cinematic Craft", desc: "We approach every project with a director's mindset — composed frames, intentional lighting, and a visual narrative that builds perception." },
  },
  {
    icon: "◆",
    ar: { title: "تقنيات الإنتاج", desc: "كاميرات سينما متقدّمة، أطقم درون احترافية، وأنظمة بثّ مباشر متعدّدة الكاميرات — تقنيات على مستوى الاستوديوهات الكبرى." },
    en: { title: "Production Tech", desc: "Advanced cinema cameras, professional drone systems, and multi-camera live production — studio-grade tech, on-location." },
  },
  {
    icon: "◆",
    ar: { title: "الهوية البصرية", desc: "نُترجم هوية كل علامة تجارية إلى لغة بصرية متماسكة — من تدرّجات الألوان إلى الموسيقى التصويرية." },
    en: { title: "Visual Identity", desc: "We translate each brand into a coherent visual language — from color grading to the final soundtrack." },
  },
  {
    icon: "◆",
    ar: { title: "تنفيذ احترافي", desc: "جداول إنتاج مدروسة، تواصل واضح، وتسليم في الموعد المتفق عليه — التزام مهني نقدّمه لكل عميل بلا استثناء." },
    en: { title: "Professional Delivery", desc: "Disciplined schedules, clear communication, and on-time delivery — the operational standard we bring to every client." },
  },
];

export default function About() {
  const { t } = useI18n();

  return (
    <section id="about" className="relative overflow-hidden" style={{ background: "#050505", paddingTop: "140px", paddingBottom: "140px" }}>
      <div className="absolute top-32 right-0 w-40 h-px" style={{ background: "linear-gradient(to left, var(--red), transparent)" }} />

      <div className="max-w-7xl mx-auto px-6 lg:px-12">

        {/* Top split: editorial statement */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 mb-24" data-reveal>
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
            className="lg:col-span-5"
          >
            <div className="eyebrow mb-6">{t({ ar: "من نحن", en: "About Kian Media" })}</div>
            <h2 className="editorial text-white" style={{ fontSize: "clamp(38px,5.5vw,70px)" }}>
              {t({ ar: "نُنتج", en: "We produce" })}
              {" "}
              <em>{t({ ar: "أفلامًا", en: "cinema" })}</em>
              {" — "}
              <br />
              {t({ ar: "لا فيديوهات.", en: "not video." })}
            </h2>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1], delay: 0.15 }}
            className="lg:col-span-7 lg:pt-16 space-y-6"
          >
            <p className="text-white/70" style={{ fontSize: "19px", lineHeight: 1.9 }}>
              {t({
                ar: "كيان الابتكار للإنتاج الفني — بيت إنتاج سعودي متخصّص في صناعة المحتوى البصري السينمائي. نُنتج للشركات الكبرى، الجهات الحكومية، المطوّرين العقاريين، والعلامات التجارية التي تختار أن تظهر بمستوى مختلف.",
                en: "Kian Media — a Saudi production house specialized in cinematic visual content. We produce for major corporates, government entities, real estate developers, and brands that choose to appear at a different standard.",
              })}
            </p>
            <span className="red-line" />
            <p className="text-white/55" style={{ fontSize: "16px", lineHeight: 1.9 }}>
              {t({
                ar: "تمتدّ خبرتنا أكثر من عقدين في الإنتاج السينمائي والإعلامي. نُغطّي كل مناطق المملكة، من الإعلانات التجارية إلى الأفلام الوثائقية، ومن البثّ المباشر للفعاليات الكبرى إلى الأفلام المؤسّسية والإنتاج الفاخر للأعراس.",
                en: "Our experience spans over two decades in cinematic and media production. We work across all regions of Saudi Arabia — from commercial ads to documentaries, from live broadcasting of major events to corporate films and luxury wedding productions.",
              })}
            </p>
            <p className="text-white/45 italic" style={{ fontSize: "15px", lineHeight: 1.9, fontFamily: "var(--serif)" }}>
              {t({
                ar: "نحن لا نقدّم خدمة تصوير — نُقدّم رؤية بصرية متكاملة تليق بالعلامات التي ترفض الظهور العادي.",
                en: "We don't deliver a filming service — we deliver a complete visual vision worthy of brands that refuse to look ordinary.",
              })}
            </p>
          </motion.div>
        </div>

        {/* Four pillars */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-px" style={{ background: "rgba(255,255,255,0.08)" }}>
          {PILLARS.map((p, i) => {
            const c = t({ ar: p.ar.title, en: p.en.title });
            const d = t({ ar: p.ar.desc, en: p.en.desc });
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.65, delay: (i % 4) * 0.08 }}
                className="group p-8 lg:p-10 transition-all duration-500"
                style={{ background: "#050505" }}
              >
                <span className="block mb-4 transition-colors duration-500 group-hover:text-red-500" style={{ fontSize: "22px", color: "rgba(227,30,36,0.7)" }}>{p.icon}</span>
                <h3 className="text-white mb-3" style={{ fontSize: "18px", fontWeight: 600, lineHeight: 1.3 }}>{c}</h3>
                <p className="text-white/55" style={{ fontSize: "14px", lineHeight: 1.8 }}>{d}</p>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
