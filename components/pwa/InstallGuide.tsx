"use client";
// ════════════════════════════════════════════════════════════════════════════
// Install guidance — iOS and Android, in Arabic and English.
//
// iOS Safari never fires `beforeinstallprompt`: Apple has no programmatic
// install at all, so on iPhone/iPad the ONLY path is the manual Share →
// "Add to Home Screen" sequence. A PWA that ships an install button and no iOS
// instructions simply appears broken to every iPhone user, which in this
// company is most of them. Hence a written path per platform, always available
// and never dependent on an event that may never arrive.
// ════════════════════════════════════════════════════════════════════════════
import { PWA_BUILD_ID } from "@/lib/pwa/config";

const box: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: "4px",
  padding: "14px 16px",
  marginBottom: "12px",
  background: "rgba(255,255,255,0.02)",
};

const head: React.CSSProperties = {
  fontSize: "11px",
  letterSpacing: "1.8px",
  textTransform: "uppercase",
  color: "#E31E24",
  marginBottom: "9px",
};

const step: React.CSSProperties = {
  fontSize: "13px",
  lineHeight: 2,
  color: "rgba(255,255,255,0.75)",
};

export default function InstallGuide({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="تثبيت التطبيق"
      dir="rtl"
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 130,
        background: "rgba(0,0,0,0.72)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "20px",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: "440px", maxHeight: "84vh", overflowY: "auto",
          background: "#0a0a0a", color: "#fff",
          border: "1px solid rgba(255,255,255,0.12)", borderRadius: "5px",
          padding: "22px 20px",
        }}
      >
        <h2 style={{ fontSize: "15px", fontWeight: 700, marginBottom: "16px" }}>
          تثبيت بوابة كيان على جهازك
        </h2>

        <div style={box}>
          <div style={head}>iPhone / iPad — Safari</div>
          <ol style={{ ...step, paddingInlineStart: "18px", listStyle: "decimal" }}>
            <li>افتح البوابة في متصفّح Safari (وليس Chrome على iOS).</li>
            <li>اضغط زر «مشاركة» (Share) في شريط الأدوات.</li>
            <li>اختر «إضافة إلى الشاشة الرئيسية» (Add to Home Screen).</li>
            <li>اضغط «إضافة» — سيظهر التطبيق بأيقونة كيان.</li>
          </ol>
          <p style={{ fontSize: "11.5px", lineHeight: 1.9, color: "rgba(255,255,255,0.42)", marginTop: "8px" }}>
            لا يوجد زر تثبيت تلقائي على iOS — هذه هي الطريقة الوحيدة التي تتيحها Apple.
          </p>
        </div>

        <div style={box}>
          <div style={head}>Android — Chrome</div>
          <ol style={{ ...step, paddingInlineStart: "18px", listStyle: "decimal" }}>
            <li>اضغط زر «تثبيت» إن ظهر لك، وهو الأسرع.</li>
            <li>أو افتح قائمة المتصفّح (⋮) أعلى اليمين.</li>
            <li>اختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية».</li>
            <li>أكّد الإضافة.</li>
          </ol>
        </div>

        <div style={box}>
          <div style={head}>Desktop — Chrome / Edge</div>
          <p style={step}>
            اضغط أيقونة التثبيت في شريط العنوان، أو من القائمة اختر «تثبيت كيان».
          </p>
        </div>

        <p style={{ fontSize: "11.5px", lineHeight: 1.9, color: "rgba(255,255,255,0.42)", marginBottom: "16px" }}>
          بعد التثبيت: التصفّح دون اتصال يعرض الصفحات العامّة المحفوظة فقط. العمليات
          الحسّاسة — المالية والمشاريع والعهد والاعتمادات والرسائل والحجوزات — تتطلّب
          اتصالًا، ولا تُنفَّذ لاحقًا تلقائيًّا.
        </p>

        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              fontSize: "10.5px", letterSpacing: "1.8px", textTransform: "uppercase",
              color: "rgba(255,255,255,0.6)", background: "none",
              border: "1px solid rgba(255,255,255,0.16)", padding: "9px 18px",
              borderRadius: "3px", cursor: "pointer",
            }}
          >
            إغلاق
          </button>
          <span dir="ltr" style={{ fontSize: "10px", color: "rgba(255,255,255,0.25)" }}>
            {PWA_BUILD_ID}
          </span>
        </div>
      </div>
    </div>
  );
}
