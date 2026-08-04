"use client";
// ════════════════════════════════════════════════════════════════════════════
// /client-portal/delivery-rights — حقوق العرض التسويقيّ وروابط التسليم.
//
// Wave 5 · V2-5.2 · V2-5.3
//
// 🔴 مسار مستقلّ **عمدًا**: منصّة المشاريع مجمَّدة بقرار اعتماد مالك، ويفرض
//    التجميدَ اختبار آليّ. فبدل حقن لوحة في شاشاتها، تعيش الميزة في مسارها
//    وتتحدّث إلى القاعدة عبر RPCs جديدة. لا ملفّ من المنصّة يُمسّ.
//
// ⛔ العلم مطفأ ⇒ الصفحة تُرجع «غير متاح» ولا تستدعي شيئًا، والتبويب غائب أصلًا.
// ════════════════════════════════════════════════════════════════════════════
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { deliveryRightsEnabled } from "@/lib/portal/projectCore";
import DeliveryRightsPanel from "@/components/portal/delivery/DeliveryRightsPanel";

function Inner() {
  const params = useSearchParams();
  const projectId = params.get("p") ?? "";
  const deliverableId = params.get("d");

  if (!deliveryRightsEnabled()) {
    return <p className="text-[12.5px] text-stone-400">هذه الميزة غير مُفعَّلة.</p>;
  }
  if (!projectId) {
    // حالة فارغة تقول ما يُفعل، لا «لا نتائج».
    return (
      <p className="text-[12.5px] text-stone-400">
        افتح هذه الصفحة من مشروع محدَّد — الرابط يحتاج معرّف المشروع (<span dir="ltr">?p=…</span>).
      </p>
    );
  }
  return <DeliveryRightsPanel projectId={projectId} deliverableId={deliverableId} />;
}

export default function DeliveryRightsPage() {
  return (
    <div>
      <div className="mb-5">
        <div className="eyebrow mb-2">التسليم والحقوق</div>
        <h1 className="editorial text-white" style={{ fontSize: "clamp(20px,3.5vw,28px)", lineHeight: 1.25 }}>
          حقوق العرض وروابط التسليم
        </h1>
      </div>
      {/* useSearchParams يوجب حدًّا للتعليق في App Router. */}
      <Suspense fallback={<p className="text-[12px] text-stone-500">جارٍ التحميل…</p>}>
        <Inner />
      </Suspense>
    </div>
  );
}
