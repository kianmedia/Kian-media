"use client";
// ════════════════════════════════════════════════════════════════════════════
// components/CaseStudiesIndexClient.tsx — فهرس دراسات الحالة العامّ.
//
// يستقبل بيانات مقروءة على الخادم (بالمفتاح العامّ وخلف بوّابة القاعدة) ولا
// يقرأ شيئًا بنفسه. عربيّ/إنجليزيّ · RTL · متجاوب · بلا أيّ حقل داخليّ.
//
// ★ لا فلترة كاذبة ★ القطاعات والخدمات المعروضة مشتقّة من المنشور فعلًا، فلا
//   يظهر فلتر يؤدّي إلى صفر نتائج. والتصفية هنا محلّية على ما وصل بالفعل.
// ════════════════════════════════════════════════════════════════════════════
import { useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { useI18n } from "@/lib/i18n";
import type { PublicCaseStudyCard, PublicTaxon } from "@/lib/server/publicCaseStudies";

function pick(isAr: boolean, ar?: string | null, en?: string | null): string {
  const a = (ar ?? "").trim();
  const e = (en ?? "").trim();
  if (isAr) return a || e;
  return e || a;
}

function Card({ item, isAr }: { item: PublicCaseStudyCard; isAr: boolean }) {
  const title = pick(isAr, item.title_ar, item.title_en);
  const summary = pick(isAr, item.summary_ar, item.summary_en);
  const client = pick(isAr, item.client_label_ar, item.client_label_en);
  const hero = item.hero;
  const alt = pick(isAr, hero?.alt_ar, hero?.alt_en) || title;

  return (
    <motion.article
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.45 }}
      style={{
        border: "1px solid rgba(255,255,255,0.10)",
        borderRadius: "4px",
        overflow: "hidden",
        background: "#0B0B0B",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Link href={`/case-studies/${item.slug}`} style={{ display: "block" }}>
        <div style={{ position: "relative", aspectRatio: "16 / 9", background: "#111", overflow: "hidden" }}>
          {hero?.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={hero.url}
              alt={alt}
              loading="lazy"
              decoding="async"
              width={hero.width ?? undefined}
              height={hero.height ?? undefined}
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            />
          ) : (
            // لا صورة ⇒ مساحة صامتة، لا صورة بديلة توحي بشيء غير موجود.
            <div style={{ width: "100%", height: "100%", background: "linear-gradient(135deg,#111,#1a1a1a)" }} />
          )}
          {item.featured && (
            <span
              className="f-sans"
              style={{
                position: "absolute", top: "12px", insetInlineStart: "12px",
                background: "rgba(227,30,36,0.92)", color: "#fff",
                fontSize: "11px", letterSpacing: "0.06em", padding: "5px 10px", borderRadius: "2px",
              }}
            >
              {isAr ? "مختارة" : "Featured"}
            </span>
          )}
        </div>
      </Link>

      <div style={{ padding: "20px 20px 22px", display: "flex", flexDirection: "column", gap: "10px", flex: 1 }}>
        {client && (
          <div className="f-sans" style={{ fontSize: "12px", color: "rgba(255,255,255,0.45)", letterSpacing: "0.04em" }}>
            {client}
          </div>
        )}
        <h3 className="editorial text-white" style={{ fontSize: "19px", lineHeight: 1.45 }}>
          <Link href={`/case-studies/${item.slug}`} style={{ color: "inherit" }}>{title}</Link>
        </h3>
        {summary && (
          <p className="f-sans" style={{ fontSize: "13.5px", lineHeight: 1.9, color: "rgba(255,255,255,0.55)" }}>
            {summary.length > 190 ? summary.slice(0, 190) + "…" : summary}
          </p>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "auto", paddingTop: "10px" }}>
          {(item.sectors ?? []).slice(0, 3).map((s) => (
            <span key={`sec-${s.slug}`} className="f-sans"
              style={{ fontSize: "11px", color: "rgba(255,255,255,0.5)", border: "1px solid rgba(255,255,255,0.12)", padding: "3px 8px", borderRadius: "2px" }}>
              {isAr ? s.name_ar : s.name_en}
            </span>
          ))}
          {(item.services ?? []).slice(0, 2).map((s) => (
            <span key={`srv-${s.slug}`} className="f-sans"
              style={{ fontSize: "11px", color: "rgba(227,30,36,0.75)", border: "1px solid rgba(227,30,36,0.28)", padding: "3px 8px", borderRadius: "2px" }}>
              {isAr ? s.name_ar : s.name_en}
            </span>
          ))}
        </div>
      </div>
    </motion.article>
  );
}

export default function CaseStudiesIndexClient({
  items, sectors, services, total,
}: {
  items: PublicCaseStudyCard[];
  sectors: PublicTaxon[];
  services: PublicTaxon[];
  total: number;
}) {
  const { t, isAr } = useI18n();
  const [sector, setSector] = useState<string>("all");
  const [service, setService] = useState<string>("all");

  const filtered = useMemo(() => {
    return items.filter((it) => {
      const okSec = sector === "all" || (it.sectors ?? []).some((s) => s.slug === sector);
      const okSrv = service === "all" || (it.services ?? []).some((s) => s.slug === service);
      return okSec && okSrv;
    });
  }, [items, sector, service]);

  const chip = (active: boolean) => ({
    fontSize: "12.5px",
    padding: "8px 14px",
    borderRadius: "2px",
    border: `1px solid ${active ? "rgba(227,30,36,0.6)" : "rgba(255,255,255,0.14)"}`,
    background: active ? "rgba(227,30,36,0.12)" : "transparent",
    color: active ? "#fff" : "rgba(255,255,255,0.6)",
    cursor: "pointer",
  });

  return (
    <div className="max-w-7xl mx-auto px-6 lg:px-12" style={{ paddingTop: "130px", paddingBottom: "120px" }}>
      <div className="eyebrow mb-5">{t({ ar: "دراسات الحالة", en: "Case Studies" })}</div>
      <h1 className="editorial text-white" style={{ fontSize: "clamp(28px,5vw,46px)", lineHeight: 1.25, marginBottom: "16px" }}>
        {t({ ar: "أعمال مختارة، مروية بالتفصيل", en: "Selected work, told in full" })}
      </h1>
      <p className="f-sans" style={{ color: "rgba(255,255,255,0.55)", fontSize: "14.5px", lineHeight: 1.9, maxWidth: "760px" }}>
        {t({
          ar: "كلّ دراسة هنا منشورة بإذن صريح من صاحبها. ما لم يُؤذَن بنشره لا يظهر — ولو كان يخدم عرضنا.",
          en: "Every study here is published with its client's explicit permission. Whatever was not permitted does not appear — even where it would flatter us.",
        })}
      </p>

      {/* الفلاتر — مشتقّة من المنشور فعلًا */}
      {(sectors.length > 0 || services.length > 0) && (
        <div style={{ marginTop: "40px", display: "flex", flexDirection: "column", gap: "14px" }}>
          {sectors.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}>
              <span className="f-sans" style={{ fontSize: "12px", color: "rgba(255,255,255,0.35)", minWidth: "72px" }}>
                {t({ ar: "القطاع", en: "Sector" })}
              </span>
              <button type="button" className="f-sans" style={chip(sector === "all")} onClick={() => setSector("all")}>
                {t({ ar: "الكل", en: "All" })}
              </button>
              {sectors.map((s) => (
                <button key={s.slug} type="button" className="f-sans" style={chip(sector === s.slug)} onClick={() => setSector(s.slug)}>
                  {isAr ? s.name_ar : s.name_en}
                </button>
              ))}
            </div>
          )}
          {services.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}>
              <span className="f-sans" style={{ fontSize: "12px", color: "rgba(255,255,255,0.35)", minWidth: "72px" }}>
                {t({ ar: "الخدمة", en: "Service" })}
              </span>
              <button type="button" className="f-sans" style={chip(service === "all")} onClick={() => setService("all")}>
                {t({ ar: "الكل", en: "All" })}
              </button>
              {services.map((s) => (
                <button key={s.slug} type="button" className="f-sans" style={chip(service === s.slug)} onClick={() => setService(s.slug)}>
                  {isAr ? s.name_ar : s.name_en}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div
        style={{
          marginTop: "44px",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
          gap: "26px",
        }}
      >
        {filtered.map((it) => <Card key={it.slug} item={it} isAr={isAr} />)}
      </div>

      {filtered.length === 0 && (
        <p className="f-sans" style={{ marginTop: "40px", color: "rgba(255,255,255,0.45)", fontSize: "14px" }}>
          {t({
            ar: "لا توجد دراسة تطابق هذا الاختيار. جرّب فلترًا آخر.",
            en: "No study matches this selection. Try another filter.",
          })}
        </p>
      )}

      {total > items.length && (
        <p className="f-sans" style={{ marginTop: "28px", color: "rgba(255,255,255,0.35)", fontSize: "12.5px" }}>
          {t({
            ar: `تُعرَض ${items.length} من ${total} دراسة منشورة.`,
            en: `Showing ${items.length} of ${total} published studies.`,
          })}
        </p>
      )}

      {/* دعوتان للإجراء */}
      <div style={{ marginTop: "70px", display: "flex", flexWrap: "wrap", gap: "14px" }}>
        <Link href="/quote-request" className="btn-red"><span>{t({ ar: "اطلب عرض سعر", en: "Request a quote" })}</span></Link>
        <Link href="/book-meeting" className="btn-ghost"><span>{t({ ar: "احجز اجتماعًا", en: "Book a meeting" })}</span></Link>
      </div>
    </div>
  );
}
