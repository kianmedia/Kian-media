"use client";
// ════════════════════════════════════════════════════════════════════════════
// /client-portal/case-studies — السطح الداخليّ لدراسات الحالة.
//
// الصفحة نفسها تُعرَض بلا شرط، والتفويض وكشف الميزة يحدثان **داخل** المكوّن:
// ترحيلة غير مطبَّقة ⇒ بانر كهرمانيّ صادق، لا شاشة فارغة ولا خطأ يبدو عطلًا.
// كلّ زرّ داخلها يُعاد فحصه في القاعدة، والنشر النهائيّ للمالك وحده.
// ════════════════════════════════════════════════════════════════════════════
import { useI18n } from "@/lib/i18n";
import CaseStudiesWorkbench from "@/components/portal/CaseStudiesWorkbench";

export default function CaseStudiesInternalPage() {
  const { isAr } = useI18n();
  return (
    <div style={{ direction: isAr ? "rtl" : "ltr" }}>
      <div style={{ marginBottom: "20px" }}>
        <div className="f-sans" style={{ fontSize: "9.5px", letterSpacing: "1.6px", textTransform: "uppercase", color: "rgba(255,255,255,0.4)" }}>
          المحتوى الخارجيّ
        </div>
        <h1 className="editorial" style={{ color: "#fff", fontSize: "clamp(20px,3vw,26px)", marginTop: "6px" }}>
          دراسات الحالة
        </h1>
        <p className="f-sans" style={{ color: "rgba(255,255,255,0.5)", fontSize: "12.5px", lineHeight: 1.95, maxWidth: "760px", marginTop: "8px" }}>
          كلّ ما يُنشر هنا مكتوب أو معتمَد يدويًّا. لا يُنسَخ شيء من منصّة المشاريع تلقائيًّا، ولا يُنشر اسم عميل أو شعار أو رقم
          أو اسم موظّف بلا إذن أو موافقة موثَّقة — والقاعدة ترفض ذلك حتّى لو ضُغط الزرّ.
        </p>
      </div>
      <CaseStudiesWorkbench />
    </div>
  );
}
