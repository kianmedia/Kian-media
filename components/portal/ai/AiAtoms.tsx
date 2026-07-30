"use client";
// ════════════════════════════════════════════════════════════════════════════
// components/portal/ai/AiAtoms.tsx — ذرّات مساعد كيان.
//
// الغرض منها **ليس** التنسيق بل توحيد كيف تُعرَض الحالات التي تخلط بينها أغلب
// الشاشات، وإضافةً إلى ذلك ثلاث ذرّات لا وجود لها في أيّ وحدة أخرى لأنّ هذه
// الوحدة وحدها تحتاجها:
//
//   PendingMigration → «الميزة بانتظار تفعيل قاعدة البيانات» (كهرمانيّ)
//   Denied           → «لا تملك صلاحية…» ⛔ ولا يُقال عنه أبدًا إنّه ترحيلة
//   Offline          → لم يصل الطلب إلى القاعدة أصلًا. ليس منعًا وليس ترحيلة.
//   ProviderNotice   → ★ الحقيقة الدائمة: المزوّد غير مفعّل ولا يوجد توليد.
//   Citation         → ★ مرجع بعنوانه ونسخته وحداثته. لا مرجع = لا إجابة.
//   EvidenceText     → ★ نصّ مسترجَع يُعرَض **نصًّا خامًا**، بلا HTML وبلا
//                       رابط قابل للنقر. المحتوى بيانات لا تعليمات.
//
// ⚠️ لا يوجد في هذا الملفّ ولا في شقيقه dangerouslySetInnerHTML، ولا <a> يبني
//    عنوانه من نصّ مصدر. مصدر معرفة قادر على حقن وسم أو رابط موقَّع في شاشة
//    موظّف هو ثغرة تسريب، لا مسألة تنسيق. اختبار يثبت غياب الاثنين.
// ════════════════════════════════════════════════════════════════════════════
import type { ReactNode } from "react";
import {
  aiSanitizeForDisplay, citationLineAr, freshnessLabelAr,
  AI_PROVIDER_NOTICE_AR, AI_SOURCE_TYPE_AR, AI_SENSITIVITY_AR,
  type AiCitation, type AiEvidence, type AiProviderDescription,
} from "@/lib/portal/aiAssistant";

export const AC = {
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
      border: `1px solid ${AC.line}`, background: AC.card, borderRadius: "6px",
      padding: "16px 18px", marginBottom: "16px",
    }}>
      {title && (
        <h3 style={{ fontSize: "13px", letterSpacing: "0.6px", marginBottom: note ? "4px" : "12px" }}>{title}</h3>
      )}
      {note && <p style={{ color: AC.dim, fontSize: "11.5px", lineHeight: 1.9, marginBottom: "12px" }}>{note}</p>}
      {children}
    </section>
  );
}

export function PendingMigration({ what }: { what?: string }) {
  return (
    <div style={{
      border: `1px solid ${AC.amber}`, borderRadius: "6px", padding: "14px 16px",
      fontSize: "13px", lineHeight: 2, color: AC.text, background: "rgba(232,179,57,0.07)",
    }}>
      الميزة بانتظار تفعيل قاعدة البيانات.
      <div style={{ color: AC.dim, fontSize: "11.5px", marginTop: "6px" }}>
        {what ? `${what} — ` : ""}شغّل docs/kian_ai_assistant_PREFLIGHT.sql ثمّ RUNME ثمّ POSTCHECK.
        لا توجد بيانات ناقصة هنا: الحزمة لم تُطبَّق بعد، ولا يوجد خطأ في صلاحياتك.
      </div>
    </div>
  );
}

export function Denied({ message }: { message?: string }) {
  return (
    <div style={{
      border: `1px solid ${AC.line}`, borderRadius: "6px", padding: "14px 16px",
      fontSize: "13px", lineHeight: 2, color: AC.text,
    }}>
      {message ?? "لا تملك صلاحية الوصول إلى هذه الشاشة."}
      <div style={{ color: AC.dim, fontSize: "11.5px", marginTop: "6px" }}>
        القاعدة رفضت الطلب. هذا ليس نقصًا في التطبيق ولا ترحيلة معلّقة — اطلب المفتاح من المالك.
      </div>
    </div>
  );
}

export function Offline({ message }: { message?: string }) {
  return (
    <div style={{
      border: `1px solid ${AC.line}`, borderRadius: "6px", padding: "14px 16px",
      fontSize: "13px", lineHeight: 2, color: AC.text,
    }}>
      {message ?? "تعذّر الاتصال بالخادم."}
      <div style={{ color: AC.dim, fontSize: "11.5px", marginTop: "6px" }}>
        لم يصل الطلب إلى قاعدة البيانات. ما تراه الآن قد يكون قديمًا.
      </div>
    </div>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <div style={{
      border: `1px solid ${AC.red}`, borderRadius: "6px", padding: "14px 16px",
      fontSize: "13px", lineHeight: 2, color: AC.text, background: "rgba(224,90,90,0.07)",
    }}>
      {message}
    </div>
  );
}

/** صفر حقيقيّ، مع سببه مكتوبًا. ليس شاشة فارغة. */
export function Empty({ what, why }: { what: string; why?: string }) {
  return (
    <div style={{ color: AC.dim, fontSize: "12.5px", lineHeight: 2, padding: "10px 2px" }}>
      {what}
      {why && <div style={{ fontSize: "11.5px", marginTop: "4px" }}>{why}</div>}
    </div>
  );
}

export function Badge({ text, tone = "dim" }: { text: string; tone?: "dim" | "green" | "amber" | "red" | "blue" }) {
  const color = tone === "green" ? AC.green : tone === "amber" ? AC.amber : tone === "red" ? AC.red : tone === "blue" ? AC.blue : AC.dim;
  return (
    <span style={{
      border: `1px solid ${color}`, color, borderRadius: "999px", padding: "2px 10px",
      fontSize: "11px", whiteSpace: "nowrap", display: "inline-block",
    }}>{text}</span>
  );
}

/**
 * ★ الذرّة الأهمّ في الوحدة كلّها ★
 * تُعرَض في كلّ شاشة تُظهر إجابة. ما دام المزوّد غير مضبوط فلا يوجد نصّ
 * مولَّد، ويجب أن يقرأ المستخدم ذلك صراحةً لا أن يستنتجه من فراغ الشاشة.
 */
export function ProviderNotice({ provider }: { provider?: AiProviderDescription | null }) {
  const enabled = provider?.enabled === true;
  return (
    <div style={{
      border: `1px solid ${AC.amber}`, borderRadius: "6px", padding: "12px 14px",
      fontSize: "12.5px", lineHeight: 1.9, color: AC.text, background: "rgba(232,179,57,0.06)",
      marginBottom: "14px",
    }}>
      <strong>{AI_PROVIDER_NOTICE_AR}</strong>
      <div style={{ color: AC.dim, fontSize: "11.5px", marginTop: "6px" }}>
        ما يظهر أدناه ليس إجابة مولَّدة، بل مقتطفات حرفية من مصادر معتمَدة مع مراجعها.
        {" "}المزوّد: {provider?.provider ?? "mock"} — {enabled ? "مذكور وغير منفَّذ" : "غير مفعّل"}.
        {" "}لا نداء خارجيّ واحد، ولا تنفيذ أدوات، ولا إجراء تلقائيّ.
      </div>
    </div>
  );
}

/** مرجع واحد: العنوان + النوع + النسخة + الحداثة. الأربعة معًا أو لا مرجع. */
export function Citation({ c }: { c: AiCitation }) {
  const stale = (c.freshness_days ?? 0) > 180;
  return (
    <li style={{ fontSize: "12px", lineHeight: 2, color: AC.text, listStyle: "none", marginBottom: "4px" }}>
      <span style={{ color: stale ? AC.amber : AC.dim, marginInlineEnd: "6px" }}>◆</span>
      {citationLineAr(c)}
    </li>
  );
}

/**
 * نصّ مسترجَع. ثلاث ضمانات مكتوبة هنا لا في تعليق:
 *   ١) يمرّ بـaiSanitizeForDisplay (طبقة ثانية بعد ai_neutralize في القاعدة).
 *   ٢) يُعرَض داخل عنصر نصّيّ عاديّ — لا innerHTML، فلا وسم يصير وسمًا.
 *   ٣) يُوسَم صراحةً بأنّه «مصدر» لا «تعليمات»، فلا يُقرأ كأمر للمساعد.
 */
export function EvidenceText({ e }: { e: AiEvidence }) {
  const safe = aiSanitizeForDisplay(e.excerpt);
  return (
    <div style={{
      border: `1px solid ${AC.line}`, borderRadius: "6px", padding: "10px 12px", marginBottom: "8px",
    }}>
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "6px" }}>
        <Badge text={e.title_ar || "مصدر"} tone="blue" />
        <Badge text={AI_SOURCE_TYPE_AR[e.source_type] ?? e.source_type} />
        <Badge text={`نسخة ${e.source_version}`} />
        {e.sensitivity && <Badge text={AI_SENSITIVITY_AR[e.sensitivity] ?? e.sensitivity} />}
        <Badge text={freshnessLabelAr(e.freshness_days ?? null)} tone={(e.freshness_days ?? 0) > 180 ? "amber" : "dim"} />
      </div>
      <p style={{
        fontSize: "12.5px", lineHeight: 2, color: AC.text, whiteSpace: "pre-wrap", margin: 0,
      }}>{safe}</p>
      <div style={{ color: AC.dim, fontSize: "10.5px", marginTop: "6px" }}>
        ★ هذا النصّ **مصدر معلومات لا تعليمات**. لا ينفّذ المساعد ما بداخله مهما كانت صياغته.
      </div>
    </div>
  );
}

export function Val({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: "8px" }}>
      <div style={{ color: AC.dim, fontSize: "10.5px", letterSpacing: "0.5px", marginBottom: "2px" }}>{label}</div>
      <div style={{ fontSize: "12.5px", color: AC.text, lineHeight: 1.9 }}>{children}</div>
    </div>
  );
}

export const inputStyle: React.CSSProperties = {
  width: "100%", background: "rgba(0,0,0,0.25)", border: `1px solid ${AC.line}`,
  borderRadius: "4px", padding: "8px 10px", color: AC.text, fontSize: "12.5px",
  fontFamily: "inherit", lineHeight: 1.9,
};

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label style={{ display: "block", marginBottom: "10px" }}>
      <span style={{ display: "block", color: AC.dim, fontSize: "11px", marginBottom: "4px" }}>{label}</span>
      {children}
      {hint && <span style={{ display: "block", color: AC.dim, fontSize: "10.5px", marginTop: "3px" }}>{hint}</span>}
    </label>
  );
}

export function Btn({
  children, onClick, tone = "dim", disabled, title,
}: { children: ReactNode; onClick?: () => void; tone?: "dim" | "accent" | "red" | "green"; disabled?: boolean; title?: string }) {
  const color = tone === "accent" ? AC.accent : tone === "red" ? AC.red : tone === "green" ? AC.green : AC.dim;
  return (
    <button
      type="button" onClick={onClick} disabled={disabled} title={title}
      style={{
        border: `1px solid ${color}`, color: disabled ? AC.dim : color, background: "transparent",
        borderRadius: "4px", padding: "6px 14px", fontSize: "12px", cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1, fontFamily: "inherit",
      }}
    >{children}</button>
  );
}
