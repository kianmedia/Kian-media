"use client";
// ════════════════════════════════════════════════════════════════════════
// Admin Notification Delivery log (Stage 1 observability). Staff-only. Read-only.
// Shows every enqueued delivery row so routing can be verified before any external
// sender is enabled. No real email/WhatsApp is sent in Stage 1.
// ════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { listDeliveries, EVENT_LABELS, STATUS_STYLE, type NotificationDelivery, type DeliveryStatus } from "@/lib/portal/deliveries";

// Mask destinations so one client's contact isn't shown in full.
const maskEmail = (e: string | null) => !e ? "" : e.replace(/^(.).*(@.*)$/, (_, a, d) => `${a}***${d}`);
const maskPhone = (p: string | null) => { const d = (p || "").replace(/[^\d]/g, ""); return d ? `••••${d.slice(-4)}` : ""; };

export default function DeliveriesView() {
  const { t, isAr } = useI18n();
  const [rows, setRows] = useState<NotificationDelivery[]>([]);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [err, setErr] = useState("");
  const [filter, setFilter] = useState<"all" | DeliveryStatus>("all");

  const load = useCallback(async () => {
    const r = await listDeliveries(400);
    if (!r.ok) { setErr(r.error); setPhase("error"); return; }
    setRows(r.data); setPhase("ready");
  }, []);
  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length };
    rows.forEach((r) => { c[r.status] = (c[r.status] ?? 0) + 1; });
    return c;
  }, [rows]);
  const shown = filter === "all" ? rows : rows.filter((r) => r.status === filter);

  const cell: React.CSSProperties = { padding: "8px 10px", fontSize: 12, color: "rgba(255,255,255,0.82)", borderBottom: "1px solid rgba(255,255,255,0.05)", whiteSpace: "nowrap" };
  const th: React.CSSProperties = { padding: "8px 10px", fontSize: 10, letterSpacing: "1px", textTransform: "uppercase", color: "rgba(255,255,255,0.4)", textAlign: isAr ? "right" : "left", borderBottom: "1px solid rgba(255,255,255,0.1)" };
  const chip = (s: DeliveryStatus) => { const st = STATUS_STYLE[s]; return { background: st.bg, color: st.fg, fontSize: 10.5, fontWeight: 600, padding: "2px 8px", borderRadius: 6, textTransform: "uppercase" as const }; };

  return (
    <div>
      <div className="mb-6">
        <div className="eyebrow mb-3">{t({ ar: "تسليم الإشعارات", en: "Notification Delivery" })}</div>
        <h1 className="editorial text-white" style={{ fontSize: "clamp(22px,4vw,30px)", lineHeight: 1.25 }}>
          {t({ ar: "سجل التسليم", en: "Delivery Log" })}
        </h1>
        <p className="text-white/45" style={{ fontSize: 12.5, marginTop: 8, lineHeight: 1.7, maxWidth: 640 }}>
          {t({ ar: "المرحلة 1: تسجيل ومراقبة فقط. لا يتم إرسال بريد إلكتروني أو واتساب فعلي بعد. صفوف البوابة = أُرسلت؛ البريد/الواتساب = قيد الانتظار أو متخطّى (سبب).",
               en: "Stage 1: logging & observability only. No real email/WhatsApp is sent yet. Portal rows = sent; email/WhatsApp = pending or skipped (with reason)." })}
        </p>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        {(["all", "sent", "pending", "skipped", "dry_run", "failed"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} style={{
            fontSize: 11.5, padding: "5px 11px", borderRadius: 7, cursor: "pointer",
            border: filter === f ? "1px solid rgba(227,30,36,0.6)" : "1px solid rgba(255,255,255,0.12)",
            background: filter === f ? "rgba(227,30,36,0.14)" : "transparent", color: "rgba(255,255,255,0.8)",
          }}>{f}{typeof counts[f] === "number" ? ` (${counts[f]})` : ""}</button>
        ))}
        <button onClick={() => void load()} style={{ fontSize: 11.5, padding: "5px 11px", borderRadius: 7, cursor: "pointer", border: "1px solid rgba(255,255,255,0.12)", background: "transparent", color: "rgba(255,255,255,0.6)", marginInlineStart: "auto" }}>
          {t({ ar: "تحديث", en: "Refresh" })}
        </button>
      </div>

      {phase === "loading" && <p className="text-white/45" style={{ fontSize: 13 }}>{t({ ar: "جارٍ التحميل...", en: "Loading..." })}</p>}
      {phase === "error" && <div style={{ padding: "12px 14px", fontSize: 13, color: "#ff9ea1", background: "rgba(227,30,36,0.08)", border: "1px solid rgba(227,30,36,0.3)", borderRadius: 8 }}>{err}</div>}
      {phase === "ready" && shown.length === 0 && <p className="text-white/45" style={{ fontSize: 13.5 }}>{t({ ar: "لا توجد صفوف تسليم بعد. نفّذ حدثًا (طلب/تقدير/نشر) لرؤية الصفوف.", en: "No delivery rows yet. Trigger an event (request/estimate/publish) to see rows." })}</p>}

      {phase === "ready" && shown.length > 0 && (
        <div style={{ overflowX: "auto", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
            <thead><tr>
              <th style={th}>{t({ ar: "الحدث", en: "Event" })}</th>
              <th style={th}>{t({ ar: "المستلم", en: "Recipient" })}</th>
              <th style={th}>{t({ ar: "القناة", en: "Channel" })}</th>
              <th style={th}>{t({ ar: "الوجهة", en: "Destination" })}</th>
              <th style={th}>{t({ ar: "الحالة", en: "Status" })}</th>
              <th style={th}>{t({ ar: "السبب/الخطأ", en: "Reason / Error" })}</th>
              <th style={th}>{t({ ar: "الوقت", en: "Time" })}</th>
            </tr></thead>
            <tbody>
              {shown.map((r) => {
                const ev = EVENT_LABELS[r.event_type] ?? { ar: r.event_type, en: r.event_type };
                const dest = r.channel === "email" ? maskEmail(r.destination_email) : r.channel === "whatsapp" ? maskPhone(r.destination_phone) : "—";
                return (
                  <tr key={r.id}>
                    <td style={cell}>{t(ev)}</td>
                    <td style={{ ...cell, textTransform: "uppercase" as const, fontSize: 11, color: "rgba(255,255,255,0.6)" }}>{r.recipient_role}</td>
                    <td style={cell}>{r.channel}</td>
                    <td style={{ ...cell, direction: "ltr", fontFamily: "ui-monospace, Menlo, monospace" }}>{dest || "—"}</td>
                    <td style={cell}><span style={chip(r.status)}>{r.status}</span></td>
                    <td style={{ ...cell, color: r.error_message ? "#ff9ea1" : "rgba(255,255,255,0.5)", whiteSpace: "normal" }}>{r.error_message || r.skip_reason || "—"}{r.retry_count > 0 ? ` · ↻${r.retry_count}` : ""}</td>
                    <td style={{ ...cell, direction: "ltr", color: "rgba(255,255,255,0.45)" }}>{new Date(r.created_at).toLocaleString(isAr ? "ar-SA" : "en-GB")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
