"use client";
// ════════════════════════════════════════════════════════════════════════════
// /client-portal/assistant — مساعد كيان (المرحلة C).
//
// المسار داخليّ بالكامل: العميل والزائر لا يريانه في التنقّل، وإن فُتح برابط
// مباشر فالقاعدة ترفض كلّ استدعاء (ai_can_use_internal = موظّف ضمن دور مساعد)
// وتظهر شاشة «لا تملك صلاحية» — لا شاشة فارغة ولا ادّعاء ترحيلة ناقصة.
//
// السطح العامّ ليس هنا إطلاقًا: هو صفحة منفصلة (/assistant) يخدمها مسار خادم
// واحد يحمل مفتاح الخدمة في الخادم لا في المتصفّح، ولا يصل منها إلّا المعرفة
// العامّة المعتمَدة ومسوّدة طلب تنتظر إنسانًا.
// ════════════════════════════════════════════════════════════════════════════
import { useI18n } from "@/lib/i18n";
import AiAssistantCenter from "@/components/portal/ai/AiAssistantCenter";

export default function AssistantPage() {
  const { t } = useI18n();
  return (
    <div>
      <div className="mb-6">
        <div className="eyebrow mb-3">{t({ ar: "مساعد كيان", en: "Kian Assistant" })}</div>
        <h1 className="editorial text-white" style={{ fontSize: "clamp(22px,4vw,32px)", lineHeight: 1.25 }}>
          {t({ ar: "مساعد كيان — أساس مُسنَد بالمصادر", en: "Kian Assistant — grounded foundation" })}
        </h1>
        <p className="f-sans text-sm mt-2" style={{ color: "rgba(255,255,255,0.5)", lineHeight: 1.8 }}>
          {t({
            ar: "سجلّ معرفة يمرّ باعتماد بشريّ، واسترجاع مقيَّد بصلاحيتك، وإجابات لا تُعرَض إلّا بمراجعها ونسخها وحداثتها، وتسليم بشريّ عند الحاجة. ⛔ لا يوجد نموذج لغويّ مُفعّل في هذه النسخة: لا نداء خارجيّ، ولا تنفيذ أدوات، ولا إجراء تلقائيّ — البنية جاهزة والمزوّد مطفأ.",
            en: "A human-approved knowledge registry, permission-filtered retrieval, answers shown only with their sources, versions and freshness, and human handoff. No model provider is enabled in this version: no external call, no tool execution, no autonomous action — the foundation is ready and the provider is off.",
          })}
        </p>
      </div>
      <AiAssistantCenter />
    </div>
  );
}
