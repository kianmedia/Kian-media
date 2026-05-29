"use client";
import { motion } from "framer-motion";
import { useI18n } from "@/lib/i18n";

const STEPS = [
  { n: "01", ar: { title: "الاستشارة",          desc: "نستمع لرؤيتك ونضع خطة إنتاج تفصيلية تناسب أهدافك وميزانيتك." },
              en: { title: "Discovery",          desc: "We listen to your vision and build a detailed production plan aligned with your goals and budget." } },
  { n: "02", ar: { title: "التطوير الإبداعي", desc: "سيناريو، معالجة بصرية، تصميم لقطات، واختيار طاقم الإنتاج المناسب." },
              en: { title: "Creative Development", desc: "Script, visual treatment, shot design, and selection of the right production team." } },
  { n: "03", ar: { title: "التصوير",             desc: "فريقنا الاحترافي ينفّذ مرحلة التصوير بأحدث المعدات السينمائية وأطقم الدرون." },
              en: { title: "Production",         desc: "Our professional crew executes the shoot with the latest cinematic equipment and drone systems." } },
  { n: "04", ar: { title: "المونتاج والتسليم", desc: "نُعالج المادة — مونتاج، تصحيح ألوان، صوت، مؤثرات — ونُسلّم بالجودة المتفق عليها." },
              en: { title: "Post & Delivery",    desc: "We finish the material — edit, color, sound, VFX — and deliver to agreed specifications." } },
];

export default function Process() {
  const { t } = useI18n();
  return (
    <section className="relative overflow-hidden" style={{ background: "#0a0a0a", paddingTop: "140px", paddingBottom: "140px" }}>
      <div className="max-w-7xl mx-auto px-6 lg:px-12">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.85 }}
          className="text-center mb-20"
          data-reveal
        >
          <div className="eyebrow mb-6 mx-auto">{t({ ar: "كيف نعمل", en: "Our Process" })}</div>
          <h2 className="editorial text-white" style={{ fontSize: "clamp(34px,5vw,58px)" }}>
            {t({ ar: "أربع مراحل،", en: "Four stages," })}{" "}
            <em>{t({ ar: "نتيجة واحدة استثنائية", en: "one remarkable result" })}</em>
          </h2>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-px" style={{ background: "rgba(255,255,255,0.06)" }}>
          {STEPS.map((s, i) => (
            <motion.div
              key={s.n}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: i * 0.1 }}
              className="group p-10 lg:p-12 transition-all duration-500"
              style={{ background: "#0a0a0a" }}
            >
              <div className="f-serif italic mb-6" style={{ fontSize: "42px", color: "rgba(255,255,255,0.15)", lineHeight: 1, fontWeight: 400 }}>
                {s.n}
              </div>
              <h3 className="text-white mb-3" style={{ fontSize: "18px", fontWeight: 700, letterSpacing: "-0.005em" }}>{t({ ar: s.ar.title, en: s.en.title })}</h3>
              <span className="block w-10 h-px mb-4" style={{ background: "var(--red)" }} />
              <p className="text-white/55" style={{ fontSize: "14px", lineHeight: 1.85 }}>{t({ ar: s.ar.desc, en: s.en.desc })}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
