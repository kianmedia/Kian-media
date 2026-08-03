"use client";
// ════════════════════════════════════════════════════════════════════════════
// /client-portal/crm — وحدة المبيعات وإدارة علاقات العملاء (Phase 3).
//
// المسار داخليّ بالكامل: العميل والزائر لا يريانه في التنقّل، وإن فُتح برابط
// مباشر فالقاعدة ترفض كلّ استدعاء (crm_can_view = موظّف + مفتاح صريح) وتظهر
// شاشة «لا تملك صلاحية» — لا شاشة فارغة ولا ادّعاء ترحيلة ناقصة.
// ════════════════════════════════════════════════════════════════════════════
import { useI18n } from "@/lib/i18n";
import CrmCenter from "@/components/portal/crm/CrmCenter";

export default function CrmPage() {
  const { t } = useI18n();
  return (
    <div>
      <div className="mb-6">
        <div className="eyebrow mb-3">{t({ ar: "المبيعات", en: "Sales" })}</div>
        <h1
          className="editorial text-white"
          style={{ fontSize: "clamp(22px,4vw,32px)", lineHeight: 1.25 }}
        >
          {t({ ar: "المبيعات وعلاقات العملاء", en: "Sales & CRM" })}
        </h1>
        <p className="f-sans text-sm mt-2" style={{ color: "rgba(255,255,255,0.5)", lineHeight: 1.8 }}>
          {t({
            ar: "العملاء المحتملون والفرص وخطّ الأنابيب والأنشطة والتنبّؤ. ربح الفرصة يُسجَّل كجاهزية لإنشاء المشروع يدويًّا.",
            en: "Leads, opportunities, pipeline, activities and forecast. A won deal is recorded as ready for MANUAL project creation.",
          })}
        </p>
      </div>
      <CrmCenter />
    </div>
  );
}
