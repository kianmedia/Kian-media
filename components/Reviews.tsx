"use client";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useI18n } from "@/lib/i18n";
import { fetchPublicTestimonials, type PublicTestimonial } from "@/lib/portal/testimonials";

function Stars({ n }: { n: number }) {
  const full = Math.max(0, Math.min(5, Math.round(n)));
  return (
    <div style={{ fontSize: "15px", letterSpacing: "3px", color: "var(--red)", marginBottom: "18px" }} aria-label={`${full}/5`}>
      {"★".repeat(full)}
      <span style={{ color: "rgba(255,255,255,0.18)" }}>{"★".repeat(5 - full)}</span>
    </div>
  );
}

function TestimonialCard({ item, i, isAr }: { item: PublicTestimonial; i: number; isAr: boolean }) {
  const meta = [item.client_title, item.company].filter(Boolean).join(isAr ? " · " : " · ");
  return (
    <motion.figure
      initial={{ opacity: 0, y: 26 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1], delay: (i % 3) * 0.08 }}
      className="glass-red text-start relative overflow-hidden"
      style={{ padding: "34px 30px", display: "flex", flexDirection: "column", height: "100%" }}
    >
      <span className="f-serif italic" style={{ position: "absolute", top: "10px", insetInlineStart: "20px", fontSize: "84px", lineHeight: 1, color: "rgba(193,18,31,0.14)" }}>“</span>
      <div className="relative z-10" style={{ display: "flex", flexDirection: "column", flex: 1 }}>
        {item.rating ? <Stars n={item.rating} /> : <div style={{ height: "6px" }} />}
        <blockquote className="f-serif italic text-white/80" style={{ fontSize: "clamp(15px,1.7vw,18px)", lineHeight: 1.85, marginBottom: "22px", flex: 1 }}>
          {item.body}
        </blockquote>
        <figcaption style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: "16px" }}>
          <div className="f-sans text-white" style={{ fontSize: "14.5px", fontWeight: 600, fontFamily: isAr ? "var(--arabic-display)" : "var(--sans)" }}>
            {item.client_name}
          </div>
          {meta && <div className="text-white/45" style={{ fontSize: "12.5px", marginTop: "3px" }}>{meta}</div>}
        </figcaption>
      </div>
    </motion.figure>
  );
}

export default function Reviews() {
  const { t, isAr } = useI18n();
  const [items, setItems] = useState<PublicTestimonial[]>([]);
  const wa = "https://wa.me/966503422999?text=" + encodeURIComponent(
    t({ ar: "أود مشاركة تجربتي مع كيان ميديا", en: "I'd like to share my experience with Kian Media" })
  );

  // Load approved testimonials (flag-gated server-side; empty when disabled).
  // Any failure degrades to the elegant empty state below — zero regression.
  useEffect(() => {
    let alive = true;
    (async () => {
      const r = await fetchPublicTestimonials(12);
      if (alive && r.enabled && r.items.length > 0) setItems(r.items);
    })();
    return () => { alive = false; };
  }, []);

  const hasItems = items.length > 0;

  return (
    <section className="relative overflow-hidden" style={{ background: "#080808", paddingTop: "140px", paddingBottom: "140px" }}>
      <div className="max-w-6xl mx-auto px-6 lg:px-12">
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
            {hasItems
              ? t({
                  ar: "أصدق ما يُقال عن العمل، يقوله من اختبره. هذه كلمات شركائنا عن تجربتهم مع كيان.",
                  en: "The truest words about our work come from those who've lived it — here's what our partners say.",
                })
              : t({
                  ar: "نحن نُؤمن أن أصدق ما يُقال عن العمل، يقوله من اختبره. هذا المكان مخصّص لمشاركة العملاء — وستظهر هنا قريبًا تجارب حقيقية من شركاء عملنا.",
                  en: "We believe the truest words about our work come from those who've experienced it. This space is reserved for our clients — real experiences from our partners will appear here soon.",
                })}
          </p>
        </motion.div>

        {hasItems ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3" style={{ gap: "20px" }}>
              {items.map((it, i) => <TestimonialCard key={it.id} item={it} i={i} isAr={isAr} />)}
            </div>
            <div className="text-center" style={{ marginTop: "48px" }}>
              <a href="/share-experience" className="btn-red inline-flex">
                <span>{t({ ar: "شارك تجربتك", en: "Share Your Experience" })}</span>
              </a>
            </div>
          </>
        ) : (
          /* Elegant empty state — preserved exactly as the graceful fallback */
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="glass-red p-12 lg:p-16 text-center relative overflow-hidden max-w-5xl mx-auto"
          >
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
              <div className="flex items-center justify-center gap-3 flex-wrap">
                <a href="/share-experience" className="btn-red inline-flex">
                  <span>{t({ ar: "شارك تجربتك", en: "Share Your Experience" })}</span>
                </a>
                <a href={wa} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-white/60 hover:text-white transition-colors" style={{ fontSize: "13px" }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M17.5 14.4c-.3-.1-1.7-.8-2-1-.3-.1-.5-.1-.7.1-.2.3-.7.9-.9 1.1-.2.2-.3.2-.6.1-1.6-.8-2.7-1.4-3.8-3.2-.3-.5.3-.5.8-1.5.1-.2 0-.4 0-.5 0-.1-.7-1.7-.9-2.3-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.2.2 2.1 3.2 5.1 4.5 1.9.8 2.6.9 3.5.7.6-.1 1.7-.7 1.9-1.4.2-.7.2-1.3.2-1.4-.1-.1-.3-.2-.6-.3zM12 2C6.5 2 2 6.5 2 12c0 1.7.5 3.4 1.3 4.9L2 22l5.2-1.4c1.5.8 3.1 1.2 4.8 1.2 5.5 0 10-4.5 10-10S17.5 2 12 2z" /></svg>
                  <span>{t({ ar: "أو عبر واتساب", en: "or via WhatsApp" })}</span>
                </a>
              </div>
            </div>
          </motion.div>
        )}
      </div>
    </section>
  );
}
