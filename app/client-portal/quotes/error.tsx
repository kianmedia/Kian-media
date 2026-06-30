"use client";
// Segment error boundary for the Quotes tab. Catches any render crash (e.g. a null
// field from an RPC) and shows a friendly Arabic fallback instead of a white screen.
// The root error is NOT hidden — it is logged for diagnosis (visible in dev console
// and the browser console in production).
import { useEffect } from "react";

export default function QuotesError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Surface useful details without crashing the page.
    console.error("[quotes] render error:", error?.message, error?.digest, error);
  }, [error]);

  return (
    <div style={{ padding: "60px 24px", textAlign: "center" }}>
      <h2 style={{ color: "#fff", fontSize: 20, marginBottom: 10 }}>تعذّر تحميل طلبات السعر</h2>
      <p style={{ color: "rgba(255,255,255,0.55)", fontSize: 14, lineHeight: 1.8, maxWidth: 460, margin: "0 auto 18px" }}>
        حدث خطأ أثناء عرض هذه الصفحة. تم تسجيل التفاصيل. يمكنك إعادة المحاولة، وإذا تكرّر الخطأ تواصل مع الدعم.
      </p>
      <button
        onClick={() => reset()}
        style={{ fontSize: 13, fontWeight: 600, padding: "9px 18px", borderRadius: 8, cursor: "pointer", border: "1px solid rgba(227,30,36,0.5)", background: "rgba(227,30,36,0.14)", color: "#ff9ea1" }}
      >
        إعادة المحاولة
      </button>
    </div>
  );
}
