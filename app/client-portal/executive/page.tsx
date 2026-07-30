"use client";
// ════════════════════════════════════════════════════════════════════════════
// /client-portal/executive — اللوحة التنفيذية (المرحلة ٥).
//
// المسار داخليّ بالكامل: العميل والزائر لا يريانه في التنقّل، وإن فُتح برابط
// مباشر فالقاعدة ترفض كلّ استدعاء (mgmt_can_view تشترط is_staff() ومفتاح
// exec_report.view أو ملكية) وتظهر شاشة «لا تملك صلاحية» — لا شاشة فارغة ولا
// ادّعاء «ترحيلة ناقصة».
//
// المؤشّرات المالية والهوامش مقصورة على المالك ولا تُمنَح بمفتاح إطلاقًا.
// ════════════════════════════════════════════════════════════════════════════
import { useI18n } from "@/lib/i18n";
import ExecDashboard from "@/components/portal/exec/ExecDashboard";

export default function ExecutivePage() {
  const { t } = useI18n();
  return (
    <div>
      <div className="mb-6 no-print">
        <div className="eyebrow mb-3">{t({ ar: "التقارير التنفيذية", en: "Executive Reporting" })}</div>
        <h1
          className="editorial text-white"
          style={{ fontSize: "clamp(22px,4vw,32px)", lineHeight: 1.25 }}
        >
          {t({ ar: "اللوحة التنفيذية", en: "Executive Dashboard" })}
        </h1>
        <p className="f-sans text-sm mt-2" style={{ color: "rgba(255,255,255,0.5)", lineHeight: 1.8 }}>
          {t({
            ar: "قراءة واحدة عبر الاتّصالات والتشغيل والمبيعات والمالية — كلّ رقم بوقت حسابه، والمؤشّر غير المتاح يُقال «غير متاح» ولا يُعرض صفرًا.",
            en: "One read across communications, operations, sales and finance — every figure carries its computation time, and an unavailable KPI says so instead of showing a zero.",
          })}
        </p>
      </div>
      <ExecDashboard />
    </div>
  );
}
