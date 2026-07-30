"use client";
// ════════════════════════════════════════════════════════════════════════════
// The offline fallback screen.
//
// SAFE BY CONSTRUCTION: it renders zero user data, makes zero network calls and
// reads zero storage. That is the whole reason it can be precached — a fallback
// page that carried any account data would survive logout inside the cache.
//
// It is also the page that must state the V1 rule plainly: reads may be stale,
// and every sensitive operation is unavailable until the connection returns.
// ════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import Link from "next/link";
import { OFFLINE_NOTICE, OFFLINE_NOTICE_EN, PWA_BUILD_ID } from "@/lib/pwa/config";

export default function OfflineScreen() {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const sync = () => setOnline(typeof navigator === "undefined" ? true : navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  return (
    <main
      dir="rtl"
      lang="ar"
      style={{
        background: "#050505",
        color: "#fff",
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "32px 20px",
      }}
    >
      <div style={{ maxWidth: "560px", width: "100%", textAlign: "center" }}>
        <div
          aria-hidden
          style={{
            width: "58px",
            height: "58px",
            margin: "0 auto 26px",
            borderRadius: "50%",
            border: "1px solid rgba(227,30,36,0.45)",
            background: "rgba(227,30,36,0.10)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "24px",
          }}
        >
          ⚡
        </div>

        <h1 style={{ fontSize: "20px", fontWeight: 700, lineHeight: 1.9, marginBottom: "14px" }}>
          {OFFLINE_NOTICE}
        </h1>

        <p style={{ fontSize: "13.5px", lineHeight: 2, color: "rgba(255,255,255,0.6)", marginBottom: "10px" }}>
          يمكنك تصفّح الصفحات العامّة المحفوظة فقط. لا يمكن تنفيذ أي عملية مالية،
          ولا تعديل مشروع، ولا صرف عهدة، ولا اعتماد طلب، ولا إرسال رسالة، ولا حجز
          مورد، ولا تعديل عميل محتمل — والعمليات لا تُنفَّذ لاحقًا تلقائيًّا.
        </p>
        <p style={{ fontSize: "12px", lineHeight: 1.9, color: "rgba(255,255,255,0.4)", marginBottom: "28px" }}>
          أعد المحاولة بعد عودة الاتصال، ثم نفّذ العملية بنفسك.
        </p>

        <p
          dir="ltr"
          style={{ fontSize: "12px", lineHeight: 1.9, color: "rgba(255,255,255,0.35)", marginBottom: "28px" }}
        >
          {OFFLINE_NOTICE_EN}
        </p>

        <div style={{ display: "flex", gap: "10px", justifyContent: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              fontSize: "11px",
              letterSpacing: "2px",
              textTransform: "uppercase",
              color: "#fff",
              background: "rgba(227,30,36,0.16)",
              border: "1px solid rgba(227,30,36,0.5)",
              padding: "11px 22px",
              borderRadius: "3px",
              cursor: "pointer",
            }}
          >
            إعادة المحاولة
          </button>
          <Link
            href="/"
            style={{
              fontSize: "11px",
              letterSpacing: "2px",
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.6)",
              background: "none",
              border: "1px solid rgba(255,255,255,0.14)",
              padding: "11px 22px",
              borderRadius: "3px",
              textDecoration: "none",
              display: "inline-block",
            }}
          >
            الصفحة الرئيسية
          </Link>
        </div>

        <p style={{ marginTop: "30px", fontSize: "11px", color: "rgba(255,255,255,0.3)" }}>
          {online ? "عاد الاتصال — أعد تحميل الصفحة." : "لا يوجد اتصال بالشبكة."}
        </p>
        <p dir="ltr" style={{ marginTop: "8px", fontSize: "10.5px", color: "rgba(255,255,255,0.25)" }}>
          {PWA_BUILD_ID}
        </p>
      </div>
    </main>
  );
}
