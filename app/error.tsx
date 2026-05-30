"use client";
import { useEffect } from "react";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error("Page error:", error); }, [error]);
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#000", color: "#fff", textAlign: "center", padding: "24px", fontFamily: "sans-serif" }}>
      <h1 style={{ fontSize: "28px", marginBottom: "12px" }}>حدث خطأ في تحميل الصفحة</h1>
      <p style={{ color: "rgba(255,255,255,.5)", marginBottom: "20px", maxWidth: "480px", direction: "ltr", fontSize: "13px" }}>
        {error?.message || "Unknown error"}
      </p>
      <button onClick={() => reset()} style={{ background: "#C1121F", color: "#fff", border: "none", padding: "12px 28px", cursor: "pointer", fontSize: "14px" }}>
        إعادة المحاولة
      </button>
    </div>
  );
}
