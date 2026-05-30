"use client";
import { motion } from "framer-motion";
import { useI18n } from "@/lib/i18n";

export default function Reviews() {
  const { t } = useI18n();
  const wa = "https://wa.me/966503422999?text=" + encodeURIComponent(
    t({ ar: "أود مشاركة تجربتي مع كيان ميديا", en: "I'd like to share my experience with Kian Media" })
  );

  return (
    <section className="relative overflow-hidden" style={{ background: "#080808", paddingTop: "140px", paddingBottom: "140px" }}>
      <div className="max-w-5xl mx-auto px-6 lg:px-12">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.9 }}
          className="text-center"
          data-reveal
        >
          <div className="eyebrow mb-6 mx-auto">{t({ ar: "تقييمات العملاء", en: "Client Feedback" })}</div>
          <h2 className="editorial text-white mb-6" style={{ fontSize: "clamp(32px,4.5vw,52px)" }}>
            {t({ ar: "تجربتك تستحق", en: "Your experience deserves" })}{" "}
            <em>{t({ ar: "أن تُروى", en: "to be told" })}</em>.
          </h2>
          <p className="text-white/55 mb-12" style={{ fontSize: "16px", lineHeight: 1.9, maxWidth: "640px", margin: "0 auto 48px" }}>
            {t({
              ar: "نحن نُؤمن أن أصدق ما يُقال عن العمل، يقوله من اختبره. هذا المكان مخصّص لمشاركة العملاء — وستظهر هنا قريبًا تجارب حقيقية من شركاء عملنا.",
              en: "We believe the truest words about our work come from those who've experienced it. This space is reserved for our clients — real experiences from our partners will appear here soon.",
            })}
          </p>

          {/* Elegant empty state */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="glass-red p-12 lg:p-16 text-center relative overflow-hidden"
          >
            {/* Decorative quote marks */}
            <span className="absolute top-6 left-8 f-serif italic" style={{ fontSize: "120px", color: "rgba(193,18,31,0.15)", lineHeight: 1, fontWeight: 400 }}>“</span>
            <span className="absolute bottom-6 right-8 f-serif italic" style={{ fontSize: "120px", color: "rgba(193,18,31,0.15)", lineHeight: 1, fontWeight: 400 }}>”</span>

            <div className="relative z-10">
              <div style={{ fontSize: "28px", color: "var(--red)", marginBottom: "20px" }}>◆ ◆ ◆ ◆ ◆</div>
              <p className="f-serif italic text-white/70 mb-10" style={{ fontSize: "clamp(18px,2.2vw,24px)", lineHeight: 1.7, maxWidth: "520px", margin: "0 auto 40px" }}>
                {t({
                  ar: "هل عملت معنا من قبل؟ شاركنا تجربتك — ستظهر هنا بعد المراجعة.",
                  en: "Have you worked with us? Share your experience — it will appear here after review.",
                })}
              </p>
              <a href={wa} target="_blank" rel="noopener noreferrer" className="btn-red inline-flex">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M17.5 14.4c-.3-.1-1.7-.8-2-1-.3-.1-.5-.1-.7.1-.2.3-.7.9-.9 1.1-.2.2-.3.2-.6.1-1.6-.8-2.7-1.4-3.8-3.2-.3-.5.3-.5.8-1.5.1-.2 0-.4 0-.5 0-.1-.7-1.7-.9-2.3-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.2.2 2.1 3.2 5.1 4.5 1.9.8 2.6.9 3.5.7.6-.1 1.7-.7 1.9-1.4.2-.7.2-1.3.2-1.4-.1-.1-.3-.2-.6-.3zM12 2C6.5 2 2 6.5 2 12c0 1.7.5 3.4 1.3 4.9L2 22l5.2-1.4c1.5.8 3.1 1.2 4.8 1.2 5.5 0 10-4.5 10-10S17.5 2 12 2z" /></svg>
                <span>{t({ ar: "شارك تجربتك", en: "Share Your Experience" })}</span>
              </a>
            </div>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}
