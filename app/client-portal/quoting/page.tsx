"use client";
// ════════════════════════════════════════════════════════════════════════════
// /client-portal/quoting — باني عروض الأسعار الذكيّ (المرحلة ٤+٥).
//
// سطح داخليّ بحت: غائب عن مجموعتَي client/lead في سجلّ التبويبات، والقاعدة
// ترفض العميل حتى برابط مباشر (sq_can_view تشترط is_staff + مفتاح quote.*).
//
// وأرقام التكلفة والهامش والحدّ الأدنى ليست محجوبة بالواجهة بل **غير مُرسَلة**:
// دالّة sq_quote_detail لا تقرأ جدول تكلفة إطلاقًا، ولوحة المالك نداء منفصل
// يردّ 42501 لغير المالك.
//
// قبل تشغيل docs/smart_quoting_RUNME.sql تعرض الصفحة «الميزة بانتظار تفعيل
// قاعدة البيانات» ولا تعرض رقمًا واحدًا. الكود يُدفع قبل الـSQL بالتصميم،
// وعرض «٠ ريال» في تلك اللحظة كذبةٌ يتصرّف الموظّف بناءً عليها أمام عميل.
// ════════════════════════════════════════════════════════════════════════════
import { useI18n } from "@/lib/i18n";
import QuotingCenter from "@/components/portal/quoting/QuotingCenter";

export default function QuotingPage() {
  const { t } = useI18n();
  return (
    <div>
      <div className="mb-8">
        <div className="eyebrow mb-4">{t({ ar: "التسعير التجاريّ", en: "Commercial Pricing" })}</div>
        <h1 className="editorial text-white" style={{ fontSize: "clamp(24px,4vw,34px)", lineHeight: 1.25 }}>
          {t({ ar: "باني عروض الأسعار", en: "Smart Quote Builder" })}
        </h1>
        <p className="text-white/45" style={{ fontSize: "12.5px", marginTop: "8px", lineHeight: 1.7 }}>
          {t({
            ar: "الكتالوج ودفتر الأسعار بإصداراته، ومدخلات النطاق، والسعر والضريبة والدفعات — وكلّ عرض يمرّ باعتماد المالك.",
            en: "Catalog, versioned price book, scope inputs, price, VAT and milestones — every quote passes through owner approval.",
          })}
        </p>
      </div>
      <QuotingCenter />
    </div>
  );
}
