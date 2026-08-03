"use client";
// ════════════════════════════════════════════════════════════════════════
// /opportunities — public "Join Kian" (مركز الفرص). Outside the client portal,
// no login. Branded hero + opportunity cards; each card opens its own dynamic
// form (OpportunityForm). Submissions go through the anon submit RPC.
// ════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { I18nProvider, useI18n } from "@/lib/i18n";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import WaFloat from "@/components/WaFloat";
import OpportunityForm from "@/components/opportunities/OpportunityForm";
import { OPPORTUNITY_TYPES, type OppType } from "@/lib/opportunities";

export default function OpportunitiesPage() {
  return (
    <I18nProvider>
      <Inner />
    </I18nProvider>
  );
}

function Inner() {
  const { t, isAr } = useI18n();
  const [selected, setSelected] = useState<OppType | null>(null);

  useEffect(() => { document.title = "مركز الفرص — كيان | Kian Opportunities"; }, []);
  useEffect(() => { window.scrollTo({ top: 0, behavior: "smooth" }); }, [selected]);

  return (
    <>
      <WaFloat />
      <Navbar />
      <main style={{ background: "#050505", minHeight: "100vh" }}>
        <section className="relative overflow-hidden" style={{ paddingTop: "140px", paddingBottom: "110px" }}>
          <div className="absolute top-0 left-0 pointer-events-none" style={{ width: "60vw", height: "55vh", background: "radial-gradient(ellipse at 20% 0%, rgba(227,30,36,0.10), transparent 65%)" }} />
          <div className="relative z-10 max-w-5xl mx-auto px-5 sm:px-6">
            {selected ? (
              <OpportunityForm type={selected} onBack={() => setSelected(null)} />
            ) : (
              <>
                {/* Hero */}
                <div className="text-center mx-auto" style={{ maxWidth: "720px", marginBottom: "56px" }}>
                  <div className="eyebrow mb-5 mx-auto">{t({ ar: "مركز الفرص", en: "Opportunities Center" })}</div>
                  <h1 className="editorial text-white" style={{ fontSize: "clamp(34px,6vw,60px)", lineHeight: 1.15, marginBottom: "20px" }}>
                    {t({ ar: "انضم إلى كيان", en: "Join Kian" })}
                  </h1>
                  <p className="text-white/65" style={{ fontSize: "clamp(15px,2.2vw,18px)", lineHeight: 1.9 }}>
                    {t({
                      ar: "نفتح أبواب التعاون مع المواهب، المتدربين، المستقلين، الشركاء، والموردين الذين يشاركوننا صناعة أثر بصري أقوى.",
                      en: "We open our doors to talents, trainees, freelancers, partners, and suppliers who share our drive to create stronger visual impact.",
                    })}
                  </p>
                </div>

                <div className="text-center mb-8">
                  <div className="f-sans" style={{ fontSize: "11px", letterSpacing: "3px", color: "rgba(227,30,36,0.9)", textTransform: "uppercase", fontWeight: 600 }}>
                    {t({ ar: "اختر نوع الفرصة", en: "Choose an opportunity type" })}
                  </div>
                </div>

                {/* Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {OPPORTUNITY_TYPES.map((o) => (
                    <button key={o.key} onClick={() => setSelected(o)} className="text-start"
                      style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: "6px", padding: "22px 20px", cursor: "pointer", transition: "all 0.25s", display: "flex", flexDirection: "column", gap: "8px", minHeight: "150px" }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(227,30,36,0.5)"; e.currentTarget.style.background = "rgba(227,30,36,0.06)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.09)"; e.currentTarget.style.background = "rgba(255,255,255,0.02)"; }}>
                      <h3 className="text-white" style={{ fontSize: "17px", fontWeight: 700, lineHeight: 1.4 }}>{isAr ? o.ar : o.en}</h3>
                      <p className="text-white/50" style={{ fontSize: "13px", lineHeight: 1.7, flex: 1 }}>{isAr ? o.tagline.ar : o.tagline.en}</p>
                      <span className="f-sans inline-flex items-center gap-2" style={{ fontSize: "11px", letterSpacing: "1.5px", textTransform: "uppercase", color: "#E31E24", marginTop: "4px" }}>
                        {t({ ar: "تقديم الطلب", en: "Apply" })}
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: isAr ? "scaleX(-1)" : "none" }}><path d="M5 12h14M12 5l7 7-7 7" /></svg>
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
