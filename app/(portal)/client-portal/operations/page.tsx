"use client";
// ════════════════════════════════════════════════════════════════════════════
// /client-portal/operations — مركز التشغيل والإنتاج (Phase 2).
//
// المسار داخليّ بالكامل: العميل والزائر لا يريانه في التنقّل، وإن فُتح برابط
// مباشر فالقاعدة ترفض كلّ استدعاء (prodops_can_view = موظّف فقط) وتظهر شاشة
// «لا تملك صلاحية» — لا شاشة فارغة ولا ادّعاء ترحيلة ناقصة.
// ════════════════════════════════════════════════════════════════════════════
import { useI18n } from "@/lib/i18n";
import OpsCenter from "@/components/portal/operations/OpsCenter";

export default function OperationsPage() {
  const { t } = useI18n();
  return (
    <div>
      <div className="mb-6">
        <div className="eyebrow mb-3">{t({ ar: "التشغيل والإنتاج", en: "Production Operations" })}</div>
        <h1
          className="editorial text-white"
          style={{ fontSize: "clamp(22px,4vw,32px)", lineHeight: 1.25 }}
        >
          {t({ ar: "مركز التشغيل والإنتاج", en: "Production Operations Centre" })}
        </h1>
        <p className="f-sans text-sm mt-2" style={{ color: "rgba(255,255,255,0.5)", lineHeight: 1.8 }}>
          {t({
            ar: "أوامر العمل الميدانية: الطاقم والمعدّات والموقع والتصاريح والسلامة والمادّة المصوّرة.",
            en: "Field work orders: crew, equipment, location, permits, safety and footage.",
          })}
        </p>
      </div>
      <OpsCenter />
    </div>
  );
}
