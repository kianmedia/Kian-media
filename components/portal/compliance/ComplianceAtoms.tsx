"use client";
// ════════════════════════════════════════════════════════════════════════════
// components/portal/compliance/ComplianceAtoms.tsx
//
// الذرّات المشتركة لمركز الامتثال. الغرض الحقيقيّ منها **ليس** التنسيق، بل
// توحيد كيف تُعرَض الحالات الأربع التي يخلط بينها أغلب الشاشات:
//
//   pending_migration → «الميزة بانتظار تفعيل قاعدة البيانات» (كهرمانيّ)
//   denied            → «لا تملك صلاحية…» ⛔ ولا يُقال عنه أبدًا إنّه ترحيلة
//   empty             → صفر **حقيقيّ**، مع سبب مكتوب
//   error             → خطأ صريح بنصّه، لا صفر ولا فراغ
//
// ⚠️ الخلط بين الأوّل والثاني كلّف المالك دورة إنتاج كاملة (انظر ديباجة
//    lib/portal/pgerror.ts). لذلك الشارة هنا تأخذ الحالة صراحةً ولا تخمّنها.
// ════════════════════════════════════════════════════════════════════════════
import type { ReactNode } from "react";

export const CC = {
  card: "rgba(255,255,255,0.04)",
  line: "rgba(255,255,255,0.12)",
  text: "#f2f2f2",
  dim: "rgba(255,255,255,0.55)",
  accent: "#e31e24",
  amber: "#e8b339",
  green: "#4caf7d",
  red: "#e05a5a",
};

export function Card({ title, note, children }: { title?: string; note?: string; children: ReactNode }) {
  return (
    <section
      style={{
        border: `1px solid ${CC.line}`, background: CC.card, borderRadius: "6px",
        padding: "16px 18px", marginBottom: "16px",
      }}
    >
      {title && <h3 style={{ fontSize: "13px", letterSpacing: "0.6px", marginBottom: note ? "4px" : "12px" }}>{title}</h3>}
      {note && <p style={{ color: CC.dim, fontSize: "11.5px", lineHeight: 1.9, marginBottom: "12px" }}>{note}</p>}
      {children}
    </section>
  );
}

/** «بانتظار تفعيل قاعدة البيانات» — ولا شيء آخر يُعرَض بهذا النصّ. */
export function PendingMigration({ what }: { what?: string }) {
  return (
    <div
      style={{
        border: `1px solid ${CC.amber}`, borderRadius: "6px", padding: "14px 16px",
        fontSize: "13px", lineHeight: 2, color: CC.text, background: "rgba(232,179,57,0.07)",
      }}
    >
      الميزة بانتظار تفعيل قاعدة البيانات.
      <div style={{ color: CC.dim, fontSize: "11.5px", marginTop: "6px" }}>
        {what ? `${what} — ` : ""}شغّل docs/vendor_compliance_center_PREFLIGHT.sql ثمّ RUNME ثمّ POSTCHECK.
        لا توجد بيانات ناقصة هنا: الحزمة لم تُطبَّق بعد.
      </div>
    </div>
  );
}

/** ⛔ منع صلاحية. **ليس** ترحيلة معلّقة، و**ليس** «لا توجد بيانات». */
export function Denied({ message }: { message?: string }) {
  return (
    <div
      style={{
        border: `1px solid ${CC.line}`, borderRadius: "6px", padding: "14px 16px",
        fontSize: "13px", lineHeight: 2, color: CC.text,
      }}
    >
      {message || "لا تملك صلاحية عرض هذا القسم."}
      <div style={{ color: CC.dim, fontSize: "11.5px", marginTop: "6px" }}>
        هذا منع صلاحية، لا نقص بيانات ولا عطل. اطلب المفتاح المناسب من المالك.
      </div>
    </div>
  );
}

/** صفر صادق: يشرح **لماذا** لا يوجد شيء. */
export function EmptyState({ text, why }: { text: string; why?: string }) {
  return (
    <div style={{ color: CC.dim, fontSize: "12.5px", lineHeight: 2, padding: "10px 0" }}>
      {text}
      {why && <div style={{ fontSize: "11.5px", marginTop: "4px" }}>{why}</div>}
    </div>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <div
      style={{
        border: `1px solid ${CC.red}`, borderRadius: "6px", padding: "14px 16px",
        fontSize: "12.5px", lineHeight: 2, color: CC.text, wordBreak: "break-word",
      }}
    >
      {message}
    </div>
  );
}

export function Badge({ text, tone = "dim" }: { text: string; tone?: "dim" | "good" | "warn" | "bad" }) {
  const color = tone === "good" ? CC.green : tone === "warn" ? CC.amber : tone === "bad" ? CC.red : CC.dim;
  return (
    <span
      style={{
        border: `1px solid ${color}`, color, borderRadius: "3px", padding: "2px 8px",
        fontSize: "10.5px", whiteSpace: "nowrap", display: "inline-block",
      }}
    >
      {text}
    </span>
  );
}

export function Btn({
  children, onClick, disabled, tone = "plain", type = "button",
}: {
  children: ReactNode; onClick?: () => void; disabled?: boolean;
  tone?: "plain" | "primary" | "danger"; type?: "button" | "submit";
}) {
  const border = tone === "primary" ? CC.accent : tone === "danger" ? CC.red : CC.line;
  const bg = tone === "primary" ? "rgba(227,30,36,0.12)" : "none";
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        border: `1px solid ${border}`, background: bg, color: CC.text, borderRadius: "4px",
        padding: "7px 13px", fontSize: "11.5px", cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1, whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

export function Field({
  label, value, onChange, placeholder, type = "text", hint,
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; hint?: string;
}) {
  return (
    <label style={{ display: "block", marginBottom: "10px" }}>
      <span style={{ display: "block", color: CC.dim, fontSize: "11px", marginBottom: "4px" }}>{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: "100%", border: `1px solid ${CC.line}`, background: "rgba(0,0,0,0.25)",
          color: CC.text, borderRadius: "4px", padding: "8px 10px", fontSize: "12.5px",
        }}
      />
      {hint && <span style={{ display: "block", color: CC.dim, fontSize: "10.5px", marginTop: "3px" }}>{hint}</span>}
    </label>
  );
}

/**
 * يحوّل نتيجة الطبقة (VccOutcome) إلى عنصر عرض. ★ لا يبتلع أيّ حالة ★:
 * كلّ حالة لها شكلها الخاصّ، ولا حالة تُقرأ كأنّها حالة أخرى.
 */
export function OutcomeView({
  state, message, what,
}: {
  state: "pending_migration" | "denied" | "conflict" | "validation" | "error";
  message: string;
  what?: string;
}) {
  if (state === "pending_migration") return <PendingMigration what={what} />;
  if (state === "denied") return <Denied message={message} />;
  if (state === "validation" || state === "conflict") {
    return (
      <div
        style={{
          border: `1px solid ${CC.amber}`, borderRadius: "6px", padding: "12px 14px",
          fontSize: "12.5px", lineHeight: 2,
        }}
      >
        {message}
      </div>
    );
  }
  return <ErrorBox message={message} />;
}

export function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("ar-SA-u-nu-latn", { year: "numeric", month: "2-digit", day: "2-digit" });
  } catch {
    return String(d);
  }
}
