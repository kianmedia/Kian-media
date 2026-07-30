"use client";
// ════════════════════════════════════════════════════════════════════════════
// /client-portal/production-credits — «رصيدي الإنتاجي».
//
// سطح عميل بحت: الرصيد والخطّة والطلبات. القاعدة ترفض أيّ حساب موظّف حتى
// برابط مباشر (csub_my_credits تشترط csub_is_client)، فيرى الموظّف شاشة «لا
// تملك صلاحية» بنصّها الصحيح — لا شاشة فارغة ولا ادّعاء ترحيلة ناقصة.
//
// قبل تشغيل docs/commercial_subscriptions_RUNME.sql تعرض الصفحة «الميزة
// بانتظار تفعيل قاعدة البيانات» ولا تعرض رقمًا واحدًا. هذا مقصود: الكود يُدفع
// قبل الـSQL بالتصميم، وعرض «٠ رصيد» في تلك اللحظة كذبة يتصرّف العميل بناءً
// عليها.
// ════════════════════════════════════════════════════════════════════════════
import { useI18n } from "@/lib/i18n";
import ClientCredits from "@/components/portal/commercial/ClientCredits";

export default function ProductionCreditsPage() {
  const { t } = useI18n();
  return (
    <div>
      <div className="mb-8">
        <div className="eyebrow mb-4">{t({ ar: "الاشتراك التجاريّ", en: "Commercial Subscription" })}</div>
        <h1 className="editorial text-white" style={{ fontSize: "clamp(24px,4vw,34px)", lineHeight: 1.25 }}>
          {t({ ar: "رصيدي الإنتاجي", en: "My Production Credits" })}
        </h1>
        <p className="text-white/45" style={{ fontSize: "12.5px", marginTop: "8px", lineHeight: 1.7 }}>
          {t({
            ar: "خطّتك ومُددها ورصيدك وحركاته وطلبات الإنتاج — كلّ رقم هنا مسنود بحركة مسجّلة.",
            en: "Your plan, its dates, your credit balance and its movements, and your production requests.",
          })}
        </p>
      </div>
      <ClientCredits />
    </div>
  );
}
