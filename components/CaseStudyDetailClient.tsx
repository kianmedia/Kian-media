"use client";
// ════════════════════════════════════════════════════════════════════════════
// components/CaseStudyDetailClient.tsx — صفحة دراسة الحالة العامّة.
//
// كلّ ما يُعرَض هنا وصل مُقنَّعًا من الخادم: الاسم والشعار والأرقام والشهادة
// وأسماء الأشخاص كلّها مرّت ببوّابة الإذن والموافقة الحيّة. هذا المكوّن **لا
// يقرّر** ما يُعرَض — إن لم يصل الحقل فهو غير مأذون به، ونحن لا نخترعه.
//
// ★ الغائب يغيب بصمت ★ لا «غير متاح» ولا شرطة مكان الرقم: قسم بلا محتوى
//   لا يُرسَم أصلًا. القارئ العامّ ليس مَن يُبلَّغ بأنّ شيئًا حُجب عنه.
// ════════════════════════════════════════════════════════════════════════════
import Link from "next/link";
import { motion } from "framer-motion";
import { useI18n } from "@/lib/i18n";
import type { PublicCaseStudy, PublicCaseStudyCard, PublicMedia } from "@/lib/server/publicCaseStudies";
import { safeEmbedUrl } from "@/lib/server/publicCaseStudies";

function pick(isAr: boolean, ar?: string | null, en?: string | null): string {
  const a = (ar ?? "").trim();
  const e = (en ?? "").trim();
  return isAr ? a || e : e || a;
}

function Section({ title, body }: { title: string; body: string }) {
  if (!body) return null;   // الغائب يغيب بصمت
  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.4 }}
      style={{ marginTop: "46px" }}
    >
      <h2 className="editorial text-white" style={{ fontSize: "21px", marginBottom: "12px", lineHeight: 1.4 }}>{title}</h2>
      <p className="f-sans" style={{ fontSize: "14.5px", lineHeight: 2.05, color: "rgba(255,255,255,0.62)", whiteSpace: "pre-line" }}>
        {body}
      </p>
    </motion.section>
  );
}

function Figure({ m, isAr }: { m: PublicMedia; isAr: boolean }) {
  const alt = pick(isAr, m.alt_ar, m.alt_en);
  const caption = pick(isAr, m.caption_ar, m.caption_en);
  if (!m.url) return null;
  return (
    <figure style={{ margin: 0 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={m.url}
        alt={alt}
        loading="lazy"
        decoding="async"
        width={m.width ?? undefined}
        height={m.height ?? undefined}
        style={{ width: "100%", height: "auto", display: "block", borderRadius: "3px", border: "1px solid rgba(255,255,255,0.08)" }}
      />
      {caption && (
        <figcaption className="f-sans" style={{ fontSize: "12px", color: "rgba(255,255,255,0.4)", marginTop: "8px", lineHeight: 1.7 }}>
          {caption}
        </figcaption>
      )}
    </figure>
  );
}

export default function CaseStudyDetailClient({
  study, related,
}: {
  study: PublicCaseStudy;
  related: PublicCaseStudyCard[];
}) {
  const { t, isAr } = useI18n();
  const b = study.body ?? {};
  const media = study.media ?? [];

  const title = pick(isAr, study.title_ar, study.title_en);
  const summary = pick(isAr, study.summary_ar, study.summary_en);
  const client = pick(isAr, study.client_label_ar, study.client_label_en);

  const hero = media.find((m) => m.kind === "hero") ?? study.hero ?? null;
  const gallery = media.filter((m) => m.kind === "gallery");
  const videos = media.filter((m) => m.kind === "video");
  const befores = media.filter((m) => m.kind === "before");
  const afters = media.filter((m) => m.kind === "after");
  const logo = media.find((m) => m.kind === "logo") ?? null;

  // أزواج «قبل/بعد» تُبنى بمفتاح الزوج؛ ما لا زوج له يُعرَض ضمن المعرض.
  const pairs = befores
    .map((bf) => ({ before: bf, after: afters.find((af) => af.pair_key && af.pair_key === bf.pair_key) ?? null }))
    .filter((p) => p.after !== null);

  const metrics = study.metrics ?? [];
  const credits = study.credits ?? [];
  const testimonial = study.testimonial ?? null;
  const testimonialText = pick(isAr, testimonial?.ar, testimonial?.en);

  const crew =
    study.crew_size_min != null && study.crew_size_max != null
      ? `${study.crew_size_min}–${study.crew_size_max}`
      : study.crew_size_min != null
        ? `${study.crew_size_min}+`
        : null;

  const facts: { label: string; value: string }[] = [];
  if (client) facts.push({ label: t({ ar: "الجهة", en: "Client" }), value: client });
  if ((study.sectors ?? []).length > 0) {
    facts.push({
      label: t({ ar: "القطاع", en: "Sector" }),
      value: (study.sectors ?? []).map((s) => (isAr ? s.name_ar : s.name_en)).join(" · "),
    });
  }
  if ((study.services ?? []).length > 0) {
    facts.push({
      label: t({ ar: "الخدمات", en: "Services" }),
      value: (study.services ?? []).map((s) => (isAr ? s.name_ar : s.name_en)).join(" · "),
    });
  }
  if ((study.locations ?? []).length > 0) {
    facts.push({ label: t({ ar: "المواقع", en: "Locations" }), value: (study.locations ?? []).join(" · ") });
  }
  if (crew) facts.push({ label: t({ ar: "حجم الطاقم", en: "Crew size" }), value: crew });
  if (study.project_start || study.project_end) {
    facts.push({
      label: t({ ar: "الفترة", en: "Period" }),
      value: [study.project_start, study.project_end].filter(Boolean).join(" → "),
    });
  }

  return (
    <div className="max-w-5xl mx-auto px-6 lg:px-12" style={{ paddingTop: "130px", paddingBottom: "120px" }}>
      <nav className="f-sans" style={{ fontSize: "12.5px", color: "rgba(255,255,255,0.38)", marginBottom: "22px" }}>
        <Link href="/" style={{ color: "inherit" }}>{t({ ar: "الرئيسية", en: "Home" })}</Link>
        <span style={{ margin: "0 8px" }}>/</span>
        <Link href="/case-studies" style={{ color: "inherit" }}>{t({ ar: "دراسات الحالة", en: "Case Studies" })}</Link>
      </nav>

      {client && (
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "14px" }}>
          {logo?.url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo.url} alt={pick(isAr, logo.alt_ar, logo.alt_en)} loading="lazy"
                 style={{ height: "34px", width: "auto", opacity: 0.9 }} />
          )}
          <div className="f-sans" style={{ fontSize: "13px", color: "rgba(255,255,255,0.5)", letterSpacing: "0.04em" }}>
            {client}
          </div>
        </div>
      )}

      <h1 className="editorial text-white" style={{ fontSize: "clamp(26px,4.6vw,42px)", lineHeight: 1.28, marginBottom: "16px" }}>
        {title}
      </h1>

      {summary && (
        <p className="f-sans" style={{ fontSize: "15.5px", lineHeight: 2, color: "rgba(255,255,255,0.68)", maxWidth: "760px" }}>
          {summary}
        </p>
      )}

      {hero?.url && (
        <div style={{ marginTop: "36px" }}>
          <Figure m={hero} isAr={isAr} />
        </div>
      )}

      {facts.length > 0 && (
        <dl
          style={{
            marginTop: "38px", display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: "18px", borderTop: "1px solid rgba(255,255,255,0.08)",
            borderBottom: "1px solid rgba(255,255,255,0.08)", padding: "22px 0",
          }}
        >
          {facts.map((f) => (
            <div key={f.label}>
              <dt className="f-sans" style={{ fontSize: "11.5px", color: "rgba(255,255,255,0.35)", letterSpacing: "0.05em", marginBottom: "6px" }}>
                {f.label}
              </dt>
              <dd className="f-sans" style={{ fontSize: "13.5px", color: "rgba(255,255,255,0.72)", lineHeight: 1.7, margin: 0 }}>
                {f.value}
              </dd>
            </div>
          ))}
        </dl>
      )}

      <Section title={t({ ar: "التحدّي", en: "The challenge" })} body={pick(isAr, b.challenge_ar, b.challenge_en)} />
      <Section title={t({ ar: "الأهداف", en: "Objectives" })} body={pick(isAr, b.objectives_ar, b.objectives_en)} />
      <Section title={t({ ar: "المعالجة الإبداعية", en: "Creative approach" })} body={pick(isAr, b.creative_approach_ar, b.creative_approach_en)} />
      <Section title={t({ ar: "منهج الإنتاج", en: "Production approach" })} body={pick(isAr, b.production_approach_ar, b.production_approach_en)} />
      <Section title={t({ ar: "التعقيد التشغيليّ", en: "Operational complexity" })} body={pick(isAr, b.operational_complexity_ar, b.operational_complexity_en)} />
      <Section title={t({ ar: "المعدّات", en: "Equipment" })} body={pick(isAr, b.equipment_summary_ar, b.equipment_summary_en)} />
      <Section title={t({ ar: "السلامة والامتثال", en: "Safety & compliance" })} body={pick(isAr, b.safety_compliance_ar, b.safety_compliance_en)} />
      <Section title={t({ ar: "الجدول الزمنيّ", en: "Timeline" })} body={pick(isAr, b.timeline_summary_ar, b.timeline_summary_en)} />
      <Section title={t({ ar: "المخرجات", en: "Deliverables" })} body={pick(isAr, b.deliverables_summary_ar, b.deliverables_summary_en)} />
      <Section title={t({ ar: "ما واجهناه", en: "What we ran into" })} body={pick(isAr, b.challenges_faced_ar, b.challenges_faced_en)} />
      <Section title={t({ ar: "كيف عالجناه", en: "How we solved it" })} body={pick(isAr, b.solution_ar, b.solution_en)} />
      <Section title={t({ ar: "النتائج", en: "Results" })} body={pick(isAr, b.results_ar, b.results_en)} />

      {/* الأرقام — تظهر فقط حين اعتُمدت **و** أُذِن بنشرها */}
      {metrics.length > 0 && (
        <section style={{ marginTop: "50px" }}>
          <h2 className="editorial text-white" style={{ fontSize: "21px", marginBottom: "18px" }}>
            {t({ ar: "نتائج مُقاسة", en: "Measured outcomes" })}
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "16px" }}>
            {metrics.map((m, i) => (
              <div key={`${m.value_text}-${i}`}
                   style={{ border: "1px solid rgba(255,255,255,0.10)", borderRadius: "3px", padding: "20px 18px", background: "#0B0B0B" }}>
                <div className="editorial" style={{ fontSize: "27px", color: "#fff", lineHeight: 1.2 }}>
                  {m.value_text}
                  {pick(isAr, m.unit_ar, m.unit_en) && (
                    <span className="f-sans" style={{ fontSize: "13px", color: "rgba(255,255,255,0.45)", marginInlineStart: "6px" }}>
                      {pick(isAr, m.unit_ar, m.unit_en)}
                    </span>
                  )}
                </div>
                <div className="f-sans" style={{ fontSize: "12.5px", color: "rgba(255,255,255,0.45)", marginTop: "8px", lineHeight: 1.7 }}>
                  {pick(isAr, m.label_ar, m.label_en)}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* قبل / بعد */}
      {pairs.length > 0 && (
        <section style={{ marginTop: "50px" }}>
          <h2 className="editorial text-white" style={{ fontSize: "21px", marginBottom: "18px" }}>
            {t({ ar: "قبل وبعد", en: "Before & after" })}
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "26px" }}>
            {pairs.map((p, i) => (
              <div key={`pair-${p.before.pair_key ?? i}`} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "14px" }}>
                <div>
                  <div className="f-sans" style={{ fontSize: "11.5px", color: "rgba(255,255,255,0.35)", marginBottom: "8px" }}>
                    {t({ ar: "قبل", en: "Before" })}
                  </div>
                  <Figure m={p.before} isAr={isAr} />
                </div>
                <div>
                  <div className="f-sans" style={{ fontSize: "11.5px", color: "rgba(227,30,36,0.75)", marginBottom: "8px" }}>
                    {t({ ar: "بعد", en: "After" })}
                  </div>
                  {p.after && <Figure m={p.after} isAr={isAr} />}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* الفيديو — مزوّد ومعرّف فقط، ولا عنوان iframe حرّ */}
      {videos.length > 0 && (
        <section style={{ marginTop: "50px", display: "flex", flexDirection: "column", gap: "24px" }}>
          {videos.map((v, i) => {
            const src = safeEmbedUrl(v.video_provider, v.video_id);
            if (!src) return null;
            return (
              <div key={`v-${v.video_id ?? i}`}>
                <div style={{ position: "relative", paddingTop: "56.25%", borderRadius: "3px", overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)" }}>
                  <iframe
                    src={src}
                    title={pick(isAr, v.video_title_ar, v.video_title_en) || title}
                    loading="lazy"
                    allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    referrerPolicy="strict-origin-when-cross-origin"
                    style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
                  />
                </div>
              </div>
            );
          })}
        </section>
      )}

      {/* المعرض */}
      {gallery.length > 0 && (
        <section style={{ marginTop: "50px" }}>
          <h2 className="editorial text-white" style={{ fontSize: "21px", marginBottom: "18px" }}>
            {t({ ar: "من الإنتاج", en: "From the production" })}
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "16px" }}>
            {gallery.map((m, i) => <Figure key={`g-${i}`} m={m} isAr={isAr} />)}
          </div>
        </section>
      )}

      {/* شهادة العميل — تصل فقط إن أُذِن بنشرها */}
      {testimonialText && (
        <blockquote
          style={{
            marginTop: "54px", padding: "28px 26px", background: "#0B0B0B",
            borderInlineStart: "2px solid rgba(227,30,36,0.6)", borderRadius: "2px",
          }}
        >
          <p className="editorial" style={{ fontSize: "18px", lineHeight: 1.85, color: "rgba(255,255,255,0.85)", margin: 0 }}>
            {testimonialText}
          </p>
          {(testimonial?.author || testimonial?.author_title) && (
            <footer className="f-sans" style={{ fontSize: "12.5px", color: "rgba(255,255,255,0.45)", marginTop: "14px" }}>
              {[testimonial?.author, testimonial?.author_title].filter(Boolean).join(" — ")}
            </footer>
          )}
        </blockquote>
      )}

      {/* الاعتمادات — لا اسم بلا موافقة موثَّقة، والفلترة تتمّ على الخادم */}
      {credits.length > 0 && (
        <section style={{ marginTop: "50px" }}>
          <h2 className="editorial text-white" style={{ fontSize: "21px", marginBottom: "14px" }}>
            {t({ ar: "فريق العمل", en: "Credits" })}
          </h2>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "10px" }}>
            {credits.map((c, i) => (
              <li key={`c-${i}`} className="f-sans" style={{ fontSize: "13px", color: "rgba(255,255,255,0.6)", lineHeight: 1.8 }}>
                <span style={{ color: "rgba(255,255,255,0.35)" }}>{pick(isAr, c.role_ar, c.role_en)}</span>
                <span style={{ margin: "0 6px" }}>—</span>
                <span>{c.name}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ذات صلة */}
      {related.length > 0 && (
        <section style={{ marginTop: "62px", borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: "34px" }}>
          <h2 className="editorial text-white" style={{ fontSize: "19px", marginBottom: "18px" }}>
            {t({ ar: "دراسات ذات صلة", en: "Related studies" })}
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: "16px" }}>
            {related.map((r) => (
              <Link key={r.slug} href={`/case-studies/${r.slug}`}
                    style={{ border: "1px solid rgba(255,255,255,0.10)", borderRadius: "3px", padding: "16px", display: "block" }}>
                <div className="f-sans" style={{ fontSize: "11.5px", color: "rgba(255,255,255,0.35)", marginBottom: "6px" }}>
                  {pick(isAr, r.client_label_ar, r.client_label_en)}
                </div>
                <div className="editorial text-white" style={{ fontSize: "15px", lineHeight: 1.5 }}>
                  {pick(isAr, r.title_ar, r.title_en)}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <div style={{ marginTop: "64px", display: "flex", flexWrap: "wrap", gap: "14px" }}>
        <Link href="/quote-request" className="btn-red"><span>{t({ ar: "اطلب عرض سعر لمشروع مشابه", en: "Request a quote for similar work" })}</span></Link>
        <Link href="/book-meeting" className="btn-ghost"><span>{t({ ar: "احجز اجتماعًا", en: "Book a meeting" })}</span></Link>
        <Link href="/case-studies" className="btn-ghost"><span>{t({ ar: "كل دراسات الحالة", en: "All case studies" })}</span></Link>
      </div>
    </div>
  );
}
