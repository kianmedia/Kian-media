"use client";
// ════════════════════════════════════════════════════════════════════════════
// components/CaseStudiesTeaser.tsx — قسم دراسات الحالة في الصفحة الرئيسية.
//
// ★ يظهر فقط حين تكون الميزة مفعّلة **ويوجد** محتوى منشور ★ وإلّا يعيد null
//   ولا يرسم شيئًا: لا عنوان قسم فارغ، ولا «قريبًا»، ولا صفر يُقرأ «لا أعمال».
//   وهذا أيضًا يعني أنّ الرابط إلى /case-studies لا يظهر قبل أن تصبح الصفحة
//   ذات معنى — رابط إلى صفحة «قريبًا» أسوأ من غياب الرابط.
//
// ⛔ لا يكسر شبكة الأعمال القائمة (components/Portfolio.tsx): قسم إضافيّ
//    مستقلّ، لا بديل ولا تعديل.
// ════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { useI18n } from "@/lib/i18n";

interface Taxon { slug: string; name_ar: string; name_en: string }
interface Card {
  slug: string;
  title_ar?: string | null; title_en?: string | null;
  summary_ar?: string | null; summary_en?: string | null;
  client_label_ar?: string | null; client_label_en?: string | null;
  hero?: { url?: string | null; alt_ar?: string | null; alt_en?: string | null } | null;
  sectors?: Taxon[];
}

const pick = (isAr: boolean, ar?: string | null, en?: string | null) => {
  const a = (ar ?? "").trim();
  const e = (en ?? "").trim();
  return isAr ? a || e : e || a;
};

export default function CaseStudiesTeaser() {
  const { t, isAr } = useI18n();
  const [items, setItems] = useState<Card[] | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/public/case-studies", { cache: "no-store" });
        if (!res.ok) { if (alive) setItems([]); return; }
        const j = (await res.json()) as { enabled?: boolean; items?: Card[] };
        // ★ الفشل والإطفاء يُقرآن الشيء نفسه: لا تعرض شيئًا ★
        if (alive) setItems(j?.enabled === true && Array.isArray(j.items) ? j.items.slice(0, 3) : []);
      } catch {
        if (alive) setItems([]);
      }
    })();
    return () => { alive = false; };
  }, []);

  // لم يصل شيء بعد، أو لا يوجد محتوى منشور ⇒ القسم غائب تمامًا.
  if (items === null || items.length === 0) return null;

  return (
    <section id="case-studies" className="relative overflow-hidden"
             style={{ background: "#080808", paddingTop: "120px", paddingBottom: "120px" }}>
      <div className="max-w-7xl mx-auto px-6 lg:px-12">
        <div className="eyebrow mb-5">{t({ ar: "دراسات الحالة", en: "Case Studies" })}</div>
        <h2 className="editorial text-white" style={{ fontSize: "clamp(24px,4vw,38px)", lineHeight: 1.3, marginBottom: "14px" }}>
          {t({ ar: "خلف كل عمل ", en: "Behind every film, " })}
          <em>{t({ ar: "قرار وتنفيذ", en: "a decision and an execution" })}</em>
        </h2>
        <p className="f-sans" style={{ color: "rgba(255,255,255,0.5)", fontSize: "14px", lineHeight: 1.9, maxWidth: "660px" }}>
          {t({
            ar: "دراسات منشورة بإذن أصحابها: التحدّي، والمعالجة، والتنفيذ الميدانيّ، والنتيجة.",
            en: "Published with client permission: the challenge, the approach, the field execution, the outcome.",
          })}
        </p>

        <div style={{ marginTop: "40px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "22px" }}>
          {items.map((it, i) => (
            <motion.div
              key={it.slug}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.45, delay: i * 0.06 }}
            >
              <Link href={`/case-studies/${it.slug}`}
                    style={{ display: "block", border: "1px solid rgba(255,255,255,0.10)", borderRadius: "4px", overflow: "hidden", background: "#0B0B0B" }}>
                <div style={{ aspectRatio: "16 / 9", background: "#111", overflow: "hidden" }}>
                  {it.hero?.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={it.hero.url} alt={pick(isAr, it.hero.alt_ar, it.hero.alt_en)} loading="lazy" decoding="async"
                         style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                  ) : (
                    <div style={{ width: "100%", height: "100%", background: "linear-gradient(135deg,#111,#1a1a1a)" }} />
                  )}
                </div>
                <div style={{ padding: "18px 18px 20px" }}>
                  {pick(isAr, it.client_label_ar, it.client_label_en) && (
                    <div className="f-sans" style={{ fontSize: "11.5px", color: "rgba(255,255,255,0.4)", marginBottom: "6px" }}>
                      {pick(isAr, it.client_label_ar, it.client_label_en)}
                    </div>
                  )}
                  <div className="editorial text-white" style={{ fontSize: "17px", lineHeight: 1.45 }}>
                    {pick(isAr, it.title_ar, it.title_en)}
                  </div>
                </div>
              </Link>
            </motion.div>
          ))}
        </div>

        <div style={{ marginTop: "36px" }}>
          <Link href="/case-studies" className="btn-ghost">
            <span>{t({ ar: "كل دراسات الحالة", en: "All case studies" })}</span>
          </Link>
        </div>
      </div>
    </section>
  );
}
