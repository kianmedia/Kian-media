"use client";
// ════════════════════════════════════════════════════════════════════════════
// /client-portal/finance — المركز المالي (Phase 4).
//
// المسار داخليّ بالكامل: العميل والزائر لا يريانه في التنقّل، وإن فُتح برابط
// مباشر فالقاعدة ترفض كلّ استدعاء (finops_can_view_finance_sensitive يشترط is_staff() و is_owner()
// ماليًّا صريحًا) وتظهر شاشة «لا تملك صلاحية» — لا شاشة فارغة ولا ادّعاء
// «ترحيلة ناقصة». الموظّف بلا صلاحية مالية يرى طلباته هو وحدها.
// ════════════════════════════════════════════════════════════════════════════
import { useI18n } from "@/lib/i18n";
import FinanceCenter from "@/components/portal/finance/FinanceCenter";

export default function FinancePage() {
  const { t } = useI18n();
  return (
    <div>
      <div className="mb-6">
        <div className="eyebrow mb-3">{t({ ar: "المالية والربحية", en: "Finance & Profitability" })}</div>
        <h1
          className="editorial text-white"
          style={{ fontSize: "clamp(22px,4vw,32px)", lineHeight: 1.25 }}
        >
          {t({ ar: "المركز المالي", en: "Finance Centre" })}
        </h1>
        <p className="f-sans text-sm mt-2" style={{ color: "rgba(255,255,255,0.5)", lineHeight: 1.8 }}>
          {t({
            ar: "التكاليف والميزانيات والاعتمادات والذمم والربحية — الضريبة حقل مستقلّ في كلّ رقم.",
            en: "Costs, budgets, approvals, receivables and profitability — VAT is its own field everywhere.",
          })}
        </p>
      </div>
      <FinanceCenter />
    </div>
  );
}
