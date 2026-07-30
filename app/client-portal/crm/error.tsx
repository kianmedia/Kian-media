"use client";
// ════════════════════════════════════════════════════════════════════════════
// حدّ خطأ محلّيّ لمسار /client-portal/crm — خطأ عرض داخل وحدة المبيعات يُظهر
// بديلًا عربيًّا مقصورًا على هذا المسار بدل تفريغ البوابة كلّها.
// ════════════════════════════════════════════════════════════════════════════
import { useEffect } from "react";

export default function CrmError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      console.error("[crm] render error:", error);
    }
  }, [error]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: "48px 24px",
        minHeight: "40vh",
      }}
    >
      <h2 className="editorial text-white" style={{ fontSize: "22px", marginBottom: "10px" }}>
        تعذّر تحميل وحدة المبيعات
      </h2>
      <p
        className="f-sans"
        style={{
          color: "rgba(255,255,255,0.55)",
          fontSize: "14px",
          lineHeight: 1.7,
          maxWidth: "440px",
          marginBottom: "22px",
        }}
      >
        حدث خطأ غير متوقّع أثناء عرض الصفحة. جرّب إعادة المحاولة، وإن استمرّت المشكلة
        تواصل مع فريق كيان.
      </p>
      <button onClick={() => reset()} className="btn-red" style={{ justifyContent: "center" }}>
        <span>إعادة المحاولة</span>
      </button>
      {process.env.NODE_ENV !== "production" && error?.message && (
        <p
          className="f-sans"
          style={{
            marginTop: "18px",
            fontSize: "11px",
            color: "rgba(255,255,255,0.4)",
            direction: "ltr",
            maxWidth: "480px",
          }}
        >
          {error.message}
        </p>
      )}
    </div>
  );
}
