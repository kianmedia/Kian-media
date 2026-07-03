"use client";
// ════════════════════════════════════════════════════════════════════════
// Local error boundary for /client-portal/quotes.
//
// Defense-in-depth on top of the null-safe rendering in AdminQuotesInbox /
// ClientQuotes: if anything in the quote-requests view still throws during
// render, show a friendly Arabic fallback (with a retry) scoped to THIS route
// instead of bubbling to the global app/error.tsx and blanking the portal.
// Developer detail is logged in development only and never shown to end users
// in production.
// ════════════════════════════════════════════════════════════════════════
import { useEffect } from "react";

export default function QuotesError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      console.error("[quotes] render error:", error);
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
        تعذّر تحميل طلبات عروض السعر
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
        حدث خطأ غير متوقع أثناء عرض الطلبات. جرّب إعادة المحاولة، وإن استمرّت المشكلة
        تواصل مع فريق كيان ميديا.
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
