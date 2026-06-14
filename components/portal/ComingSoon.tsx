"use client";
// Dev-stage stub for tabs whose real content ships in S4–S9.
// Local-only: every stub must be replaced before any production cut.
import { useI18n } from "@/lib/i18n";

export default function ComingSoon({ step, ar, en }: { step: string; ar: string; en: string }) {
  const { t } = useI18n();
  return (
    <div className="text-center" style={{ padding: "70px 24px 90px", border: "1px dashed rgba(255,255,255,0.12)", borderRadius: "4px" }}>
      <h2 className="editorial text-white" style={{ fontSize: "24px", marginBottom: "10px" }}>
        {t({ ar, en })}
      </h2>
      <p className="text-white/45" style={{ fontSize: "13.5px" }}>
        {t({ ar: `هذا القسم قيد البناء (الخطوة ${step})`, en: `This section is under construction (step ${step})` })}
      </p>
    </div>
  );
}
