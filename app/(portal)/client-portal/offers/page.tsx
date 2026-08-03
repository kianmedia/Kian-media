"use client";
// ════════════════════════════════════════════════════════════════════════
// /client-portal/offers — marketing offers (S4). Launches EMPTY: no fake
// offers. RLS filters by audience + published; if admin publishes one later
// it shows here automatically with no deploy.
// ════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { listOffers } from "@/lib/portal/leads";
import type { Offer } from "@/lib/portal/types";

export default function OffersPage() {
  const { t, isAr } = useI18n();
  const [phase, setPhase] = useState<"loading" | "ready">("loading");
  const [offers, setOffers] = useState<Offer[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const r = await listOffers();
      if (!alive) return;
      if (r.ok) setOffers(r.data);
      setPhase("ready"); // errors degrade to the empty state — offers are non-critical
    })();
    return () => { alive = false; };
  }, []);

  return (
    <div>
      <div className="mb-8">
        <div className="eyebrow mb-4">{t({ ar: "العروض", en: "Offers" })}</div>
        <h1 className="editorial text-white" style={{ fontSize: "clamp(24px,4vw,34px)", lineHeight: 1.25 }}>
          {t({ ar: "عروض كيان ميديا", en: "Kian Media Offers" })}
        </h1>
      </div>

      {phase === "loading" ? (
        <div className="f-sans" style={{ fontSize: "12px", letterSpacing: "2px", color: "rgba(255,255,255,0.4)", textTransform: "uppercase", padding: "20px 0" }}>{t({ ar: "جارٍ التحميل...", en: "Loading..." })}</div>
      ) : offers.length === 0 ? (
        <div className="text-center" style={{ padding: "70px 24px", border: "1px dashed rgba(255,255,255,0.12)", borderRadius: "4px" }}>
          <p className="text-white/55" style={{ fontSize: "15px", lineHeight: 1.85, maxWidth: "440px", margin: "0 auto" }}>
            {t({ ar: "العروض ستظهر هنا عند إرسال عرض من فريق كيان.", en: "Offers will appear here once the Kian team sends one." })}
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          {offers.map((o) => (
            <div key={o.id} className="glass-red" style={{ padding: "22px 24px", borderRadius: "4px" }}>
              <h3 className="text-white" style={{ fontSize: "18px", fontWeight: 700, marginBottom: "8px" }}>{(isAr ? o.title_ar : o.title_en) || o.title_en || o.title_ar}</h3>
              <p className="text-white/65" style={{ fontSize: "14px", lineHeight: 1.7 }}>{(isAr ? o.body_ar : o.body_en) || ""}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
