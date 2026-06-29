"use client";
// ════════════════════════════════════════════════════════════════════════
// Admin Notification Delivery log (Stage 1 observability). Staff-only. Read-only.
// Shows every enqueued delivery row so routing can be verified before any external
// sender is enabled. No real email/WhatsApp is sent in Stage 1.
// ════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { listDeliveries, processPending, getDeliveryStatus, retryDelivery, EVENT_LABELS, STATUS_STYLE, type NotificationDelivery, type DeliveryStatus, type DeliveryChannel, type ProcessResult, type DeliveryStatusInfo, type ConfigIssueReason } from "@/lib/portal/deliveries";

// Mask destinations so one client's contact isn't shown in full.
const maskEmail = (e: string | null) => !e ? "" : e.replace(/^(.).*(@.*)$/, (_, a, d) => `${a}***${d}`);
const maskPhone = (p: string | null) => { const d = (p || "").replace(/[^\d]/g, ""); return d ? `••••${d.slice(-4)}` : ""; };

// Safe, human-readable copy for a config issue reason. Names the env var; never a value.
const REASON_TEXT: Record<ConfigIssueReason, { ar: string; en: string }> = {
  non_ascii_header: { ar: "يحتوي على حروف غير مدعومة في الهيدر (غير ASCII/عربية)", en: "contains non-ASCII characters (not header-safe)" },
  control_chars:    { ar: "يحتوي على رموز تحكم أو مسافات غير صالحة", en: "contains control/whitespace characters" },
  placeholder:      { ar: "ما زال يحمل قيمة افتراضية/مكان حجز", en: "still looks like a placeholder value" },
  not_http_url:     { ar: "ليس رابط http/https صالحًا", en: "is not a valid http/https URL" },
  not_numeric:      { ar: "يجب أن يكون أرقامًا فقط", en: "must be numeric digits only" },
  missing:          { ar: "غير مُعرّف", en: "is missing" },
};
const configIssueMsg = (env: string, reason: ConfigIssueReason, isAr: boolean) =>
  isAr ? `إعداد غير صالح: ${env} ${REASON_TEXT[reason].ar}` : `Invalid config: ${env} ${REASON_TEXT[reason].en}`;

// Turn a row error like "invalid_config:N8N_WHATSAPP_SEND_SECRET:non_ascii_header" into clear copy.
function friendlyRowError(raw: string | null, isAr: boolean): string | null {
  if (!raw) return null;
  const m = /^invalid_config:([^:]+):(.+)$/.exec(raw);
  if (m && (m[2] as ConfigIssueReason) in REASON_TEXT) return configIssueMsg(m[1], m[2] as ConfigIssueReason, isAr);
  if (raw.startsWith("invalid_config:")) return isAr ? `إعداد غير صالح: ${raw.split(":")[1] || ""}` : raw;
  return raw;
}

export default function DeliveriesView() {
  const { t, isAr } = useI18n();
  const [rows, setRows] = useState<NotificationDelivery[]>([]);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [err, setErr] = useState("");
  const [filter, setFilter] = useState<"all" | DeliveryStatus>("all");
  const [chan, setChan] = useState<"all" | DeliveryChannel>("all");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [status, setStatus] = useState<DeliveryStatusInfo | null>(null);
  const [result, setResult] = useState<{ data?: ProcessResult; error?: string } | null>(null);
  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast(null), 3500); };

  const load = useCallback(async () => {
    const r = await listDeliveries(400);
    if (!r.ok) { setErr(r.error); setPhase("error"); return; }
    setRows(r.data); setPhase("ready");
  }, []);
  const loadStatus = useCallback(async () => { const s = await getDeliveryStatus(); if (s.ok) setStatus(s.data); }, []);
  useEffect(() => { void load(); void loadStatus(); }, [load, loadStatus]);

  async function runProcessor() {
    setBusy(true); setResult(null);
    const r = await processPending();
    setBusy(false);
    if (!r.ok) { setResult({ error: r.error }); return; }
    setResult({ data: r.data });
    await Promise.all([load(), loadStatus()]);  // auto-refresh the table + gating state
  }
  async function doRetry(id: string) {
    setBusy(true); const r = await retryDelivery(id); setBusy(false);
    if (!r.ok) { flash((isAr ? "تعذّر: " : "Failed: ") + r.error); return; }
    flash(t({ ar: "أُعيد إلى قائمة الانتظار.", en: "Requeued." })); await load();
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length };
    rows.forEach((r) => { c[r.status] = (c[r.status] ?? 0) + 1; });
    return c;
  }, [rows]);
  const shown = rows.filter((r) => (filter === "all" || r.status === filter) && (chan === "all" || r.channel === chan));

  // Gating warnings derived from the server status probe (booleans only; no secrets).
  const gates = useMemo(() => {
    if (!status) return [] as { sev: "block" | "warn"; ar: string; en: string }[];
    const w: { sev: "block" | "warn"; ar: string; en: string }[] = [];
    if (!status.processor_enabled) w.push({ sev: "block", ar: "المعالِج مُعطّل — لن تُعالَج أو تُرسل أي صفوف. اضبط DELIVERY_PROCESSOR_ENABLED=true في الخادم.", en: "Processor disabled — no rows are processed or sent. Set DELIVERY_PROCESSOR_ENABLED=true on the server." });
    if (status.dry_run) w.push({ sev: "warn", ar: "وضع المحاكاة مُفعّل (DELIVERY_DRY_RUN=true) — تُحاكى الإرسالات بلا إرسال فعلي. اضبطه إلى false للإرسال الحقيقي.", en: "Dry-run is ON (DELIVERY_DRY_RUN=true) — sends are simulated, not real. Set it to false for real sends." });
    if (!status.whatsapp_send) w.push({ sev: "block", ar: "إرسال واتساب مُعطّل (WHATSAPP_DELIVERY_ENABLED=false) — صفوف واتساب لن تُرسَل.", en: "WhatsApp sending disabled (WHATSAPP_DELIVERY_ENABLED=false) — WhatsApp rows won't send." });
    if (!status.whatsapp_webhook && !status.whatsapp_meta) w.push({ sev: "block", ar: "لا يوجد ناقل واتساب: N8N_WHATSAPP_SEND_WEBHOOK_URL مفقود (ولا بديل Meta).", en: "No WhatsApp transport: N8N_WHATSAPP_SEND_WEBHOOK_URL missing (and no Meta fallback configured)." });
    else if (status.whatsapp_webhook && !status.whatsapp_webhook_secret) w.push({ sev: "warn", ar: "تحذير: N8N_WHATSAPP_SEND_SECRET مفقود — قد يرفض n8n الطلب.", en: "N8N_WHATSAPP_SEND_SECRET missing — n8n may reject the request." });
    if (!status.whatsapp_allow_all) w.push({ sev: "warn", ar: "قائمة السماح مُفعّلة — تُرسل فقط الأرقام في WHATSAPP_TEST_ALLOWLIST. اضبط WHATSAPP_ALLOW_ALL=true للإنتاج.", en: "Allowlist mode — only numbers in WHATSAPP_TEST_ALLOWLIST send. Set WHATSAPP_ALLOW_ALL=true for production." });
    return w;
  }, [status]);
  const fullyLive = !!status && status.processor_enabled && !status.dry_run && status.whatsapp_send && (status.whatsapp_webhook || status.whatsapp_meta);

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
          {t({ ar: "صفوف البوابة تُرسَل فورًا. صفوف البريد/الواتساب تبقى \"قيد الانتظار\" حتى تُعالَج — اضغط «معالجة الإشعارات الآن» لإرسالها عبر المزوّد المُهيّأ. تعتمد النتيجة على إعدادات الخادم أدناه.",
               en: "Portal rows send instantly. Email/WhatsApp rows stay \"pending\" until processed — click “Process pending now” to send them via the configured provider. The outcome depends on the server settings below." })}
        </p>
      </div>

      {/* Server gating status — explains why rows do / don't actually send. */}
      {status && (gates.length > 0 ? (
        <div style={{ marginBottom: 14, padding: "12px 14px", borderRadius: 10, border: `1px solid ${gates.some((g) => g.sev === "block") ? "rgba(227,30,36,0.4)" : "rgba(245,200,66,0.4)"}`, background: gates.some((g) => g.sev === "block") ? "rgba(227,30,36,0.07)" : "rgba(245,200,66,0.07)" }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: "0.5px", color: gates.some((g) => g.sev === "block") ? "#ff9ea1" : "#f5d76e", marginBottom: 8 }}>
            {t({ ar: "حالة المُعالِج على الخادم", en: "Server processor status" })}
          </div>
          <ul style={{ margin: 0, paddingInlineStart: 18, display: "flex", flexDirection: "column", gap: 5 }}>
            {gates.map((g, i) => (
              <li key={i} style={{ fontSize: 12, lineHeight: 1.6, color: g.sev === "block" ? "rgba(255,158,161,0.95)" : "rgba(245,215,110,0.92)" }}>{t(g)}</li>
            ))}
          </ul>
        </div>
      ) : (
        <div style={{ marginBottom: 14, padding: "9px 13px", borderRadius: 10, border: "1px solid rgba(37,211,102,0.4)", background: "rgba(37,211,102,0.07)", fontSize: 12, color: "#7ee2a8" }}>
          {fullyLive
            ? t({ ar: "✓ المُعالِج مُفعّل والإرسال الحقيقي قيد التشغيل.", en: "✓ Processor enabled — real sending is live." })
            : t({ ar: "✓ المُعالِج جاهز.", en: "✓ Processor ready." })}
        </div>
      ))}

      {/* Invalid outbound config — names the exact env var + safe reason (never the value). */}
      {status?.config_issues && status.config_issues.length > 0 && (
        <div style={{ marginBottom: 14, padding: "12px 14px", borderRadius: 10, border: "1px solid rgba(227,30,36,0.45)", background: "rgba(227,30,36,0.08)" }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: "0.5px", color: "#ff9ea1", marginBottom: 8 }}>
            {t({ ar: "إعدادات إرسال واتساب غير صالحة — لن يتم الإرسال حتى تُصحَّح", en: "Invalid WhatsApp send config — sending blocked until fixed" })}
          </div>
          <ul style={{ margin: 0, paddingInlineStart: 18, display: "flex", flexDirection: "column", gap: 5 }}>
            {status.config_issues.map((iss, i) => (
              <li key={i} style={{ fontSize: 12, lineHeight: 1.6, color: "rgba(255,158,161,0.95)" }}>{configIssueMsg(iss.env, iss.reason, isAr)}</li>
            ))}
          </ul>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginTop: 8, lineHeight: 1.6 }}>
            {t({ ar: "صحّح القيمة في إعدادات البيئة (Vercel) بقيمة ASCII فقط، ثم أعد النشر واضغط «إعادة» على الصفوف الفاشلة.", en: "Set an ASCII-only value in Vercel env, redeploy, then click “Retry” on the failed rows." })}
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        {(["all", "sent", "pending", "skipped", "dry_run", "failed"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} style={{
            fontSize: 11.5, padding: "5px 11px", borderRadius: 7, cursor: "pointer",
            border: filter === f ? "1px solid rgba(227,30,36,0.6)" : "1px solid rgba(255,255,255,0.12)",
            background: filter === f ? "rgba(227,30,36,0.14)" : "transparent", color: "rgba(255,255,255,0.8)",
          }}>{f}{typeof counts[f] === "number" ? ` (${counts[f]})` : ""}</button>
        ))}
        <span style={{ marginInlineStart: "auto", display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {(["all", "portal", "email", "whatsapp"] as const).map((c) => (
            <button key={c} onClick={() => setChan(c)} style={{
              fontSize: 11, padding: "5px 10px", borderRadius: 7, cursor: "pointer",
              border: chan === c ? "1px solid rgba(99,179,237,0.6)" : "1px solid rgba(255,255,255,0.1)",
              background: chan === c ? "rgba(99,179,237,0.12)" : "transparent", color: "rgba(255,255,255,0.7)",
            }}>{c}</button>
          ))}
          <button onClick={() => void runProcessor()} disabled={busy} style={{ fontSize: 11.5, fontWeight: 600, padding: "5px 13px", borderRadius: 7, cursor: busy ? "wait" : "pointer", border: "1px solid rgba(37,211,102,0.5)", background: "rgba(37,211,102,0.14)", color: "#7ee2a8", opacity: busy ? 0.6 : 1 }}>
            {busy ? (isAr ? "جارٍ المعالجة…" : "Processing…") : t({ ar: "معالجة الإشعارات الآن", en: "Process pending now" })}
          </button>
          <button onClick={() => void load()} disabled={busy} style={{ fontSize: 11.5, padding: "5px 11px", borderRadius: 7, cursor: busy ? "wait" : "pointer", border: "1px solid rgba(255,255,255,0.12)", background: "transparent", color: "rgba(255,255,255,0.6)" }}>
            {t({ ar: "تحديث السجل", en: "Refresh log" })}
          </button>
        </span>
      </div>

      {/* Persistent result of the last "Process pending now" run. */}
      {result && (
        <div style={{ marginBottom: 14, padding: "12px 14px", borderRadius: 10, position: "relative",
          border: `1px solid ${result.error ? "rgba(227,30,36,0.4)" : result.data?.disabled ? "rgba(245,200,66,0.4)" : "rgba(37,211,102,0.4)"}`,
          background: result.error ? "rgba(227,30,36,0.07)" : result.data?.disabled ? "rgba(245,200,66,0.07)" : "rgba(37,211,102,0.07)" }}>
          <button onClick={() => setResult(null)} aria-label="close" style={{ position: "absolute", insetInlineEnd: 8, top: 6, background: "transparent", border: "none", color: "rgba(255,255,255,0.5)", cursor: "pointer", fontSize: 15, lineHeight: 1 }}>×</button>
          {result.error ? (
            <div style={{ fontSize: 12.5, color: "#ff9ea1" }}>
              <strong>{t({ ar: "تعذّرت المعالجة:", en: "Processing failed:" })}</strong>{" "}
              {result.error === "unauthorized" ? t({ ar: "غير مُصرّح (لا تملك صلاحية المعالجة).", en: "Unauthorized (you don't have permission to process)." }) : result.error}
            </div>
          ) : result.data?.disabled ? (
            <div style={{ fontSize: 12.5, color: "#f5d76e" }}>
              {t({ ar: "المُعالِج مُعطّل (DELIVERY_PROCESSOR_ENABLED=false) — لم تتم معالجة أي صف.", en: "Processor disabled (DELIVERY_PROCESSOR_ENABLED=false) — no rows were processed." })}
            </div>
          ) : (
            <div>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: "#7ee2a8", marginBottom: 8 }}>{t({ ar: "نتيجة المعالجة", en: "Processing result" })}</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {([
                  { k: "claimed", ar: "مُلتقَطة", en: "Processed", v: result.data!.claimed, c: "rgba(255,255,255,0.75)" },
                  { k: "sent", ar: "أُرسلت", en: "Sent", v: result.data!.sent, c: "#7ee2a8" },
                  { k: "failed", ar: "فشلت", en: "Failed", v: result.data!.failed, c: "#ff9ea1" },
                  { k: "skipped", ar: "متخطّاة", en: "Skipped", v: result.data!.skipped, c: "rgba(255,255,255,0.6)" },
                  { k: "dry_run", ar: "محاكاة", en: "Dry-run", v: result.data!.dry_run, c: "#90cdf4" },
                ] as const).map((m) => (
                  <span key={m.k} style={{ fontSize: 11.5, padding: "4px 10px", borderRadius: 7, border: "1px solid rgba(255,255,255,0.12)", color: m.c }}>
                    {t({ ar: m.ar, en: m.en })}: <strong>{m.v}</strong>
                  </span>
                ))}
              </div>
              {result.data!.claimed === 0 && (
                <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.55)", marginTop: 8 }}>
                  {t({ ar: "لا توجد صفوف معلّقة لمعالجتها الآن.", en: "No pending rows to process right now." })}
                </div>
              )}
              {result.data!.dry_run > 0 && (
                <div style={{ fontSize: 11.5, color: "#90cdf4", marginTop: 8 }}>
                  {t({ ar: "بعض الصفوف في وضع المحاكاة (لم تُرسَل فعليًا) — راجع حالة المُعالِج أعلاه.", en: "Some rows ran in dry-run (not actually sent) — see the processor status above." })}
                </div>
              )}
              {result.data!.failed > 0 && (
                <div style={{ fontSize: 11.5, color: "#ff9ea1", marginTop: 8 }}>
                  {(status?.config_issues?.length ?? 0) > 0
                    ? t({ ar: "فشلت صفوف بسبب إعداد غير صالح — راجع التحذير الأحمر أعلاه واسم متغيّر البيئة.", en: "Some rows failed due to invalid config — see the red warning above naming the env var." })
                    : t({ ar: "فشلت بعض الصفوف — السبب الدقيق موضّح في عمود «السبب/الخطأ» لكل صف.", en: "Some rows failed — the exact reason is shown per row in the “Reason / Error” column." })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

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
              <th style={th}>{t({ ar: "المزوّد", en: "Provider" })}</th>
              <th style={th}>{t({ ar: "السبب/الخطأ", en: "Reason / Error" })}</th>
              <th style={th}>{t({ ar: "الوقت", en: "Time" })}</th>
              <th style={th}></th>
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
                    <td style={{ ...cell, fontSize: 11, color: "rgba(255,255,255,0.55)" }}>{r.provider || "—"}{r.provider_message_id ? <span style={{ display: "block", color: "rgba(255,255,255,0.3)", fontFamily: "ui-monospace, Menlo, monospace" }}>{r.provider_message_id.slice(0, 14)}</span> : null}</td>
                    <td style={{ ...cell, color: r.error_message ? "#ff9ea1" : "rgba(255,255,255,0.5)", whiteSpace: "normal" }}>{friendlyRowError(r.error_message, isAr) || r.skip_reason || "—"}{r.retry_count > 0 ? ` · ↻${r.retry_count}` : ""}</td>
                    <td style={{ ...cell, direction: "ltr", color: "rgba(255,255,255,0.45)" }}>{new Date(r.created_at).toLocaleString(isAr ? "ar-SA" : "en-GB")}</td>
                    <td style={cell}>
                      {(r.status === "failed" || r.status === "skipped") && r.channel !== "portal" && (
                        <button onClick={() => void doRetry(r.id)} disabled={busy} style={{ fontSize: 10.5, padding: "3px 9px", borderRadius: 6, cursor: busy ? "wait" : "pointer", border: "1px solid rgba(255,255,255,0.16)", background: "transparent", color: "rgba(255,255,255,0.7)" }}>
                          {t({ ar: "إعادة", en: "Retry" })}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {toast && <div style={{ position: "fixed", insetInlineEnd: 20, bottom: 20, background: "rgba(0,0,0,0.92)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 10, padding: "10px 16px", fontSize: 12.5, color: "#fff", zIndex: 50, maxWidth: 420 }}>{toast}</div>}
    </div>
  );
}
