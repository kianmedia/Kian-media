"use client";
// ════════════════════════════════════════════════════════════════════════════
// components/portal/liveops/LiveOpsAtoms.tsx
//
// الذرّات المشتركة للوحة العمليات المباشرة. الغرض الحقيقيّ منها **ليس**
// التنسيق، بل توحيد كيف تُعرَض الحالات التي يخلط بينها أغلب الشاشات:
//
//   needs_migration → «الميزة بانتظار تفعيل قاعدة البيانات» (كهرمانيّ)
//   denied          → «لا تملك صلاحية…» ⛔ ولا يُقال عنه أبدًا إنّه ترحيلة
//   offline         → لم يصل الطلب إلى القاعدة أصلًا. ليس منعًا وليس ترحيلة.
//   empty           → صفر **حقيقيّ**، مع سبب مكتوب
//   error           → خطأ صريح بنصّه، لا صفر ولا فراغ
//
// ⚠️ الخلط بين الأوّل والثاني كلّف المالك دورة إنتاج كاملة (انظر ديباجة
//    lib/portal/pgerror.ts). لذلك الشارة هنا تأخذ الحالة صراحةً ولا تخمّنها.
//
// ⚠️ TelemetryBasis هي الذرّة الأهمّ هنا: قيمة فنّية بلا أساسها المكتوب تُقرأ
//    كقياس آليّ. لا تعرض رقمًا فنّيًّا في هذه الوحدة بلا هذه الذرّة بجانبه.
// ════════════════════════════════════════════════════════════════════════════
import type { ReactNode } from "react";
import { telemetryLabelAr, type LiveOpsHealthSource } from "@/lib/portal/liveOps";

export const LC = {
  card: "rgba(255,255,255,0.04)",
  line: "rgba(255,255,255,0.12)",
  text: "#f2f2f2",
  dim: "rgba(255,255,255,0.55)",
  accent: "#e31e24",
  amber: "#e8b339",
  green: "#4caf7d",
  red: "#e05a5a",
  blue: "#5b8def",
};

export function Card({ title, note, children }: { title?: string; note?: string; children: ReactNode }) {
  return (
    <section style={{
      border: `1px solid ${LC.line}`, background: LC.card, borderRadius: "6px",
      padding: "16px 18px", marginBottom: "16px",
    }}>
      {title && (
        <h3 style={{ fontSize: "13px", letterSpacing: "0.6px", marginBottom: note ? "4px" : "12px" }}>
          {title}
        </h3>
      )}
      {note && <p style={{ color: LC.dim, fontSize: "11.5px", lineHeight: 1.9, marginBottom: "12px" }}>{note}</p>}
      {children}
    </section>
  );
}

/** «بانتظار تفعيل قاعدة البيانات» — ولا شيء آخر يُعرَض بهذا النصّ. */
export function PendingMigration({ what }: { what?: string }) {
  return (
    <div style={{
      border: `1px solid ${LC.amber}`, borderRadius: "6px", padding: "14px 16px",
      fontSize: "13px", lineHeight: 2, color: LC.text, background: "rgba(232,179,57,0.07)",
    }}>
      الميزة بانتظار تفعيل قاعدة البيانات.
      <div style={{ color: LC.dim, fontSize: "11.5px", marginTop: "6px" }}>
        {what ? `${what} — ` : ""}شغّل docs/live_operations_dashboard_PREFLIGHT.sql ثمّ RUNME ثمّ POSTCHECK.
        لا توجد بيانات ناقصة هنا: الحزمة لم تُطبَّق بعد، ولا يوجد خطأ في صلاحياتك.
      </div>
    </div>
  );
}

/** ⛔ منع صلاحية. **ليس** ترحيلة معلّقة، و**ليس** «لا توجد بيانات». */
export function Denied({ message }: { message?: string }) {
  return (
    <div style={{
      border: `1px solid ${LC.line}`, borderRadius: "6px", padding: "14px 16px",
      fontSize: "13px", lineHeight: 2, color: LC.text,
    }}>
      {message ?? "لا تملك صلاحية الوصول إلى هذه الشاشة."}
      <div style={{ color: LC.dim, fontSize: "11.5px", marginTop: "6px" }}>
        القاعدة رفضت الطلب. هذا ليس نقصًا في التطبيق ولا ترحيلة معلّقة — اطلب المفتاح من المالك.
      </div>
    </div>
  );
}

/** الشبكة لم تصل إلى القاعدة. ليس منعًا وليس ترحيلة. */
export function Offline({ message }: { message?: string }) {
  return (
    <div style={{
      border: `1px solid ${LC.line}`, borderRadius: "6px", padding: "14px 16px",
      fontSize: "13px", lineHeight: 2, color: LC.text,
    }}>
      {message ?? "تعذّر الاتصال بالخادم."}
      <div style={{ color: LC.dim, fontSize: "11.5px", marginTop: "6px" }}>
        لم يصل الطلب إلى قاعدة البيانات. ما تراه الآن قد يكون قديمًا — لا تتّخذ قرار بثّ بناءً عليه.
      </div>
    </div>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <div style={{
      border: `1px solid ${LC.red}`, borderRadius: "6px", padding: "14px 16px",
      fontSize: "13px", lineHeight: 2, color: LC.text, background: "rgba(224,90,90,0.07)",
    }}>
      {message}
    </div>
  );
}

/** صفر حقيقيّ، مع سببه مكتوبًا. ليس شاشة فارغة. */
export function Empty({ what, why }: { what: string; why?: string }) {
  return (
    <div style={{ color: LC.dim, fontSize: "12.5px", lineHeight: 1.95, padding: "10px 0" }}>
      {what}
      {why && <div style={{ fontSize: "11.5px", marginTop: "4px" }}>{why}</div>}
    </div>
  );
}

export function Badge({ text, tone = "dim" }: { text: string; tone?: "dim" | "green" | "amber" | "red" | "blue" }) {
  const color = tone === "green" ? LC.green : tone === "amber" ? LC.amber
    : tone === "red" ? LC.red : tone === "blue" ? LC.blue : LC.dim;
  return (
    <span style={{
      display: "inline-block", padding: "3px 9px", borderRadius: "999px",
      border: `1px solid ${color}`, color, fontSize: "11px", whiteSpace: "nowrap",
    }}>
      {text}
    </span>
  );
}

/**
 * ★★ الذرّة التي تمنع الكذبة الأساسية في لوحات البثّ ★★
 * كلّ قيمة فنّية في هذه الوحدة إدخال بشريّ. عرضها بلا هذا السطر يجعلها تُقرأ
 * كقياس آليّ. لا يوجد فرع هنا يقول «مباشر» أو «موثَّق» ما لم تقله القاعدة.
 */
export function TelemetryBasis({ source, at }: { source: LiveOpsHealthSource | null; at?: string | null }) {
  return (
    <div style={{ color: LC.dim, fontSize: "11px", lineHeight: 1.8, marginTop: "6px" }}>
      {telemetryLabelAr(source)}
      {at ? ` — آخر تحديث: ${new Date(at).toLocaleString("ar-SA-u-nu-latn")}` : " — لا يوجد تحديث مسجَّل"}
    </div>
  );
}

/** قيمة قد تكون غير مُدخَلة: «غير معروف» لا صفر. */
export function Val({ v, unit }: { v: number | null | undefined; unit?: string }) {
  if (v === null || v === undefined) {
    return <span style={{ color: LC.dim }}>غير معروف</span>;
  }
  return <span style={{ fontVariantNumeric: "tabular-nums" }}>{v}{unit ? ` ${unit}` : ""}</span>;
}

export function Btn({
  children, onClick, tone = "plain", disabled, title,
}: {
  children: ReactNode; onClick?: () => void;
  tone?: "plain" | "primary" | "danger"; disabled?: boolean; title?: string;
}) {
  const border = tone === "danger" ? LC.red : tone === "primary" ? LC.accent : LC.line;
  return (
    <button
      type="button" onClick={onClick} disabled={disabled} title={title}
      style={{
        border: `1px solid ${border}`, background: "transparent",
        color: disabled ? LC.dim : LC.text, borderRadius: "4px",
        padding: "6px 12px", fontSize: "12px", cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
      }}
    >
      {children}
    </button>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label style={{ display: "block", marginBottom: "10px" }}>
      <div style={{ color: LC.dim, fontSize: "11px", marginBottom: "4px" }}>{label}</div>
      {children}
      {hint && <div style={{ color: LC.dim, fontSize: "10.5px", marginTop: "3px", lineHeight: 1.8 }}>{hint}</div>}
    </label>
  );
}

export const inputStyle: React.CSSProperties = {
  width: "100%", background: "rgba(0,0,0,0.25)", color: LC.text,
  border: `1px solid ${LC.line}`, borderRadius: "4px", padding: "7px 10px", fontSize: "12.5px",
};
