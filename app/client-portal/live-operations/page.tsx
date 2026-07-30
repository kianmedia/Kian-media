"use client";
// ════════════════════════════════════════════════════════════════════════════
// /client-portal/live-operations — لوحة العمليات المباشرة (المرحلة أ).
//
// المسار داخليّ بالكامل: العميل والزائر لا يريانه في التنقّل، وإن فُتح برابط
// مباشر فالقاعدة ترفض كلّ استدعاء (liveops_can_view = موظّف فقط) وتظهر شاشة
// «لا تملك صلاحية» — لا شاشة فارغة ولا ادّعاء ترحيلة ناقصة.
//
// سطح العميل ليس هنا إطلاقًا: هو صفحة عامّة منفصلة (/live-status) تُفتح برمز،
// ويخدمها مسار خادم واحد يحمل مفتاح الخدمة في الخادم لا في المتصفّح.
// ════════════════════════════════════════════════════════════════════════════
import { useI18n } from "@/lib/i18n";
import LiveOpsCenter from "@/components/portal/liveops/LiveOpsCenter";

export default function LiveOperationsPage() {
  const { t } = useI18n();
  return (
    <div>
      <div className="mb-6">
        <div className="eyebrow mb-3">{t({ ar: "العمليات المباشرة", en: "Live Operations" })}</div>
        <h1 className="editorial text-white" style={{ fontSize: "clamp(22px,4vw,32px)", lineHeight: 1.25 }}>
          {t({ ar: "لوحة العمليات المباشرة", en: "Live Operations Dashboard" })}
        </h1>
        <p className="f-sans text-sm mt-2" style={{ color: "rgba(255,255,255,0.5)", lineHeight: 1.8 }}>
          {t({
            ar: "البثّ والفعاليات والمؤتمرات والعمل الميدانيّ متعدّد الكاميرات: الحالة، الجرد الفنّيّ، الشبكة، الرَّنداون، الحوادث، وسطح متابعة آمن للعميل. لا يوجد اتصال بأجهزة البثّ في هذه النسخة — كلّ قيمة فنّية إدخال بشريّ وتُعرَض بهذه الصفة.",
            en: "Broadcasts, events, conferences and multi-camera field work: status, technical inventory, network, rundown, incidents, and a safe client follow-up surface. No device connection in this version — every technical value is a human entry and is labelled as such.",
          })}
        </p>
      </div>
      <LiveOpsCenter />
    </div>
  );
}
