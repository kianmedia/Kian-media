"use client";
// ════════════════════════════════════════════════════════════════════════════
// components/portal/CommunicationsHub.tsx — the INDEPENDENT admin dashboard for
// the Communications Hub.
//
// Independent on purpose: the only existing monitor lives at
// components/portal/projectcore/NotifyMonitor.tsx, inside the FROZEN project
// platform tree (tests/fixtures/project_platform_freeze.json). Nothing here
// touches it, imports it, or depends on it.
//
// HONESTY RULES BAKED INTO THIS UI
//   • A row whose dry_run is on is NEVER labelled "sent". It reads
//     «محاكاة — لم يُرسل فعليًا». Simulated and real counts are shown as two
//     separate numbers and are never added together.
//   • "waiting for the database" and "you are not allowed" are different
//     states with different words. They are never merged.
//   • Every button here is a courtesy. comms_retry / comms_cancel /
//     comms_channel_set re-check authorization in the database.
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { getValidSession } from "@/lib/portal/auth";
import { COMMS_DRY_RUN_NOTICE_AR } from "@/lib/portal/notifyEmail";
import {
  commsDashboard, commsHealth, commsRetry, commsCancel, commsChannelSet,
  commsPreview, commsCatalog, commsImportLegacy, commsRowsToCsv,
  commsStatusLabel, commsCategoryAr, COMMS_STATUS_AR, COMMS_CHANNEL_AR,
  type CommsOutboxRow, type CommsHealth, type CommsStatus, type CommsChannel,
  type CommsPreview, type CommsState,
} from "@/lib/portal/comms";

const CARD: React.CSSProperties = {
  background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)",
  borderRadius: "4px", padding: "16px",
};
const LABEL: React.CSSProperties = {
  fontSize: "9.5px", letterSpacing: "1.4px", textTransform: "uppercase", color: "rgba(255,255,255,0.45)",
};
const INPUT: React.CSSProperties = {
  background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: "3px", color: "#fff", padding: "7px 10px", fontSize: "12px", width: "100%",
};
const BTN: React.CSSProperties = {
  fontSize: "10.5px", letterSpacing: "1.2px", textTransform: "uppercase",
  color: "rgba(255,255,255,0.75)", background: "none", border: "1px solid rgba(255,255,255,0.15)",
  padding: "7px 12px", borderRadius: "3px", cursor: "pointer", whiteSpace: "nowrap",
};

const STATUSES: CommsStatus[] = ["queued", "processing", "sent", "delivered", "failed", "retrying", "dead_letter", "cancelled"];
const CHANNELS: CommsChannel[] = ["portal", "email", "whatsapp"];

function statusColor(r: CommsOutboxRow): string {
  if (r.dry_run && (r.status === "sent" || r.status === "delivered")) return "rgba(255,255,255,0.45)";
  switch (r.status) {
    case "delivered": case "sent": return "#5fd08a";
    case "dead_letter": case "failed": return "#ff8a8e";
    case "retrying": case "processing": return "#e0b955";
    case "cancelled": return "rgba(255,255,255,0.35)";
    default: return "rgba(255,255,255,0.65)";
  }
}

/** One place that turns any CommsState into an honest banner. */
function StateBanner({ s, isAr }: { s: { kind: "needs_migration" | "error"; message: string; denied?: boolean }; isAr: boolean }) {
  const migration = s.kind === "needs_migration";
  return (
    <div className="f-sans" style={{
      padding: "14px 16px", fontSize: "13px", borderRadius: "3px", lineHeight: 1.8,
      color: migration ? "#e0b955" : "#ff8a8e",
      background: migration ? "rgba(224,185,85,0.08)" : "rgba(227,30,36,0.08)",
      border: `1px solid ${migration ? "rgba(224,185,85,0.3)" : "rgba(227,30,36,0.3)"}`,
      textAlign: isAr ? "right" : "left",
    }}>
      {migration
        ? "الميزة بانتظار تفعيل قاعدة البيانات — لم يُشغَّل بعد docs/communications_hub_RUNME.sql. لا يوجد خطأ في صلاحياتك."
        : s.message}
    </div>
  );
}

export default function CommunicationsHub() {
  const { t, isAr } = useI18n();

  const [phase, setPhase] = useState<"loading" | "ready" | "blocked">("loading");
  const [blocked, setBlocked] = useState<{ kind: "needs_migration" | "error"; message: string; denied?: boolean } | null>(null);
  const [health, setHealth] = useState<CommsHealth | null>(null);
  const [rows, setRows] = useState<CommsOutboxRow[]>([]);
  const [total, setTotal] = useState(0);
  const [isAdmin, setIsAdmin] = useState(false);
  const [flash, setFlash] = useState("");
  const [busy, setBusy] = useState(false);

  // filters
  const [fStatus, setFStatus] = useState<CommsStatus | "">("");
  const [fChannel, setFChannel] = useState<CommsChannel | "">("");
  const [fEvent, setFEvent] = useState("");
  const [fSearch, setFSearch] = useState("");
  const [page, setPage] = useState(0);
  const PAGE = 50;

  // catalogue + preview
  const [catalog, setCatalog] = useState<{ event_key: string; category: string; audience: string; label_ar: string }[]>([]);
  const [pvEvent, setPvEvent] = useState("");
  const [pvLocale, setPvLocale] = useState<"ar" | "en">("ar");
  const [pvScope, setPvScope] = useState<"internal" | "client">("internal");
  const [preview, setPreview] = useState<CommsPreview | null>(null);
  const [pvErr, setPvErr] = useState("");

  const [detail, setDetail] = useState<CommsOutboxRow | null>(null);

  const say = (m: string) => { setFlash(m); window.setTimeout(() => setFlash(""), 4000); };

  const handle = useCallback(<T,>(s: CommsState<T>): T | null => {
    if (s.state === "ok") return s.data;
    setBlocked(s.state === "needs_migration"
      ? { kind: "needs_migration", message: s.message }
      : { kind: "error", message: s.message, denied: s.denied });
    setPhase("blocked");
    return null;
  }, []);

  const load = useCallback(async () => {
    const h = await commsHealth();
    const hv = handle(h);
    if (!hv) return;
    setHealth(hv);

    const d = await commsDashboard({
      status: fStatus || null, channel: fChannel || null,
      event: fEvent || null, search: fSearch || null,
      limit: PAGE, offset: page * PAGE,
    });
    const dv = handle(d);
    if (!dv) return;
    setRows(dv.rows);
    setTotal(dv.total);
    setIsAdmin(dv.is_admin);
    setBlocked(null);
    setPhase("ready");
  }, [handle, fStatus, fChannel, fEvent, fSearch, page]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    void (async () => {
      const c = await commsCatalog();
      if (c.state === "ok") setCatalog(c.data);
    })();
  }, []);

  async function act(fn: () => Promise<CommsState<unknown>>, okMsg: string) {
    setBusy(true);
    const r = await fn();
    setBusy(false);
    if (r.state === "ok") { say(okMsg); void load(); }
    else say(r.state === "needs_migration" ? "الميزة بانتظار تفعيل قاعدة البيانات." : r.message);
  }

  /**
   * Drain the outbox now. Calls the SAME server route the scheduler would call
   * (/api/comms/process) with the admin's own session, so authorization is
   * re-checked in the database. It cannot send: the route hands every claimed
   * row to the mock provider. The message says what actually happened.
   */
  async function processNow() {
    setBusy(true);
    try {
      const sess = await getValidSession();
      if (!sess?.access_token) { say("انتهت الجلسة. سجّل الدخول من جديد."); return; }
      const res = await fetch("/api/comms/process", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sess.access_token}` },
        body: JSON.stringify({ limit: 25 }),
      });
      const b = (await res.json().catch(() => ({}))) as {
        code?: string; claimed?: number; simulated?: number; live_sent?: number; deferred?: number;
      };
      if (res.status === 401) { say("لا تملك صلاحية تشغيل المعالجة."); return; }
      if (b.code === "HUB_NOT_INSTALLED") { say("الميزة بانتظار تفعيل قاعدة البيانات."); return; }
      say(`تمت المعالجة: ${b.claimed ?? 0} صف · ${b.simulated ?? 0} محاكاة · ${b.deferred ?? 0} مؤجّل · ${b.live_sent ?? 0} إرسال فعلي — ${COMMS_DRY_RUN_NOTICE_AR}`);
      void load();
    } catch {
      say("تعذّر تشغيل المعالجة.");
    } finally {
      setBusy(false);
    }
  }

  function exportCsv() {
    const csv = commsRowsToCsv(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `kian-communications-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    say(t({ ar: "تم تنزيل الصفوف المعروضة.", en: "Exported the visible rows." }));
  }

  async function runPreview() {
    setPvErr(""); setPreview(null);
    if (!pvEvent) { setPvErr("اختر حدثًا أولًا."); return; }
    const r = await commsPreview(pvEvent, pvLocale, pvScope, {
      project_name: "مشروع تجريبي", entity_label: "عنصر تجريبي",
      actor_name: "مستخدم تجريبي", details: "معاينة بدون إرسال",
      action_url: "/client-portal",
    });
    if (r.state === "ok") setPreview(r.data);
    else setPvErr(r.state === "needs_migration" ? "الميزة بانتظار تفعيل قاعدة البيانات." : r.message);
  }

  const pages = Math.max(1, Math.ceil(total / PAGE));
  const counts = health?.counts;
  const channelRows = useMemo(
    () => CHANNELS.map((c) => ({ channel: c, ...(health?.channels?.[c] ?? { enabled: false, dry_run: true }) })),
    [health],
  );

  return (
    <div style={{ direction: isAr ? "rtl" : "ltr" }}>
      <div className="mb-8">
        <div className="eyebrow mb-4">{t({ ar: "مركز الاتصالات", en: "Communications" })}</div>
        <h1 className="editorial text-white" style={{ fontSize: "clamp(24px,4vw,34px)", lineHeight: 1.25 }}>
          {t({ ar: "لوحة الإشعارات والرسائل", en: "Notifications & Messaging" })}
        </h1>
        <p className="f-sans" style={{ fontSize: "12px", color: "rgba(255,255,255,0.45)", marginTop: "10px", lineHeight: 1.9 }}>
          {t({
            ar: "لا شيء يُرسَل فعليًا في هذه المرحلة. المزوّد وهميّ، وقناة البريد معطّلة، ومعالج Google Apps Script غير منشور.",
            en: "Nothing actually sends in this phase. The provider is a mock, the email channel is disabled, and the Apps Script handler is not deployed.",
          })}
        </p>
        <div className="f-sans" style={{
          marginTop: "12px", padding: "10px 14px", fontSize: "12.5px", lineHeight: 1.8,
          color: "#e0b955", background: "rgba(224,185,85,0.08)",
          border: "1px solid rgba(224,185,85,0.3)", borderRadius: "3px",
        }}>
          {COMMS_DRY_RUN_NOTICE_AR}
        </div>
      </div>

      {flash && (
        <div className="f-sans" style={{ marginBottom: "14px", padding: "10px 14px", fontSize: "12px", color: "#fff", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "3px" }}>{flash}</div>
      )}

      {phase === "loading" && (
        <div className="f-sans" style={{ fontSize: "12px", letterSpacing: "2px", color: "rgba(255,255,255,0.4)", textTransform: "uppercase", padding: "20px 0" }}>
          {t({ ar: "جارٍ التحميل...", en: "Loading..." })}
        </div>
      )}

      {phase === "blocked" && blocked && <StateBanner s={blocked} isAr={isAr} />}

      {phase === "ready" && (
        <>
          {/* ── QUEUE HEALTH ── */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "10px", marginBottom: "16px" }}>
            {([
              ["في الطابور", counts?.queued ?? 0, "rgba(255,255,255,0.7)"],
              ["إعادة محاولة", counts?.retrying ?? 0, "#e0b955"],
              ["محاكاة (لم تُرسل)", counts?.sent_dry_run ?? 0, "rgba(255,255,255,0.5)"],
              ["إرسال فعلي", counts?.sent_live ?? 0, "#5fd08a"],
              // منسوخة من الطابور القديم: تُعرض رمادية ومنفصلة عن «إرسال فعلي»،
              // لأنّ حالة 'sent' في الطابور القديم ليست دليل تسليم.
              ["منسوخة من القديم", counts?.mirrored_legacy ?? 0, "rgba(255,255,255,0.4)"],
              ["فشل نهائي", counts?.dead_letter ?? 0, "#ff8a8e"],
              ["أُلغيت", counts?.cancelled ?? 0, "rgba(255,255,255,0.4)"],
              ["مُنعت لحماية العميل", counts?.blocked_external_total ?? 0, "#7fb2ff"],
            ] as [string, number, string][]).map(([label, n, color]) => (
              <div key={label} style={CARD}>
                <div className="f-sans" style={LABEL}>{label}</div>
                <div style={{ fontSize: "24px", color, marginTop: "6px", fontWeight: 600 }}>{n}</div>
              </div>
            ))}
          </div>

          <div className="f-sans" style={{ fontSize: "11px", color: "rgba(255,255,255,0.4)", marginBottom: "18px", lineHeight: 1.9 }}>
            {health?.note_ar}
            {health?.legacy_email_deliveries && (
              <> {" · "}الطابور القديم (للقراءة فقط): {health.legacy_email_deliveries.pending} معلّق ·{" "}
                {health.legacy_email_deliveries.sent} مُرسل · {health.legacy_email_deliveries.failed} فاشل.</>
            )}
          </div>

          {/* ── CHANNEL FEATURE FLAGS ── */}
          <div style={{ ...CARD, marginBottom: "16px" }}>
            <div className="f-sans" style={{ ...LABEL, marginBottom: "10px" }}>
              {t({ ar: "رايات القنوات", en: "Channel flags" })}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
              {channelRows.map((c) => (
                <div key={c.channel} style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: "3px", padding: "10px 12px", minWidth: "220px" }}>
                  <div className="text-white" style={{ fontSize: "13px", fontWeight: 600, marginBottom: "4px" }}>
                    {COMMS_CHANNEL_AR[c.channel]}
                  </div>
                  <div className="f-sans" style={{ fontSize: "11px", color: c.enabled ? "#5fd08a" : "rgba(255,255,255,0.4)" }}>
                    {c.enabled ? "مُفعَّلة" : "معطّلة"} · {c.dry_run ? "وضع محاكاة" : "وضع حقيقي"}
                  </div>
                  {isAdmin && (
                    <div style={{ display: "flex", gap: "6px", marginTop: "8px" }}>
                      <button style={{ ...BTN, fontSize: "9.5px", padding: "5px 9px" }} disabled={busy}
                        onClick={() => void act(() => commsChannelSet(c.channel, !c.enabled, null, null),
                          c.enabled ? "أُوقفت القناة." : "فُعِّلت القناة.")}>
                        {c.enabled ? "إيقاف" : "تفعيل"}
                      </button>
                      <button style={{ ...BTN, fontSize: "9.5px", padding: "5px 9px" }} disabled={busy}
                        onClick={() => void act(() => commsChannelSet(c.channel, c.enabled, !c.dry_run, null),
                          c.dry_run ? "⚠ أُخرجت القناة من وضع المحاكاة — لا يزال المزوّد وهميًّا." : "أُعيدت القناة إلى وضع المحاكاة.")}>
                        {c.dry_run ? "إخراج من المحاكاة" : "إعادة للمحاكاة"}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="f-sans" style={{ fontSize: "11px", color: "rgba(255,255,255,0.35)", marginTop: "10px", lineHeight: 1.9 }}>
              إخراج قناة من وضع المحاكاة لا يجعلها تُرسل: المزوّد وهميّ ولا يُصدر إقرارًا، فتُسجَّل الرسالة «فشل: بلا إقرار من المزوّد» بدل نجاح كاذب.
            </div>
          </div>

          {/* ── FILTERS + EXPORT ── */}
          <div style={{ ...CARD, marginBottom: "16px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "10px" }}>
              <div>
                <div className="f-sans" style={LABEL}>{t({ ar: "الحالة", en: "Status" })}</div>
                <select style={INPUT} value={fStatus} onChange={(e) => { setPage(0); setFStatus(e.target.value as CommsStatus | ""); }}>
                  <option value="">{t({ ar: "الكل", en: "All" })}</option>
                  {STATUSES.map((s) => <option key={s} value={s}>{COMMS_STATUS_AR[s]}</option>)}
                </select>
              </div>
              <div>
                <div className="f-sans" style={LABEL}>{t({ ar: "القناة", en: "Channel" })}</div>
                <select style={INPUT} value={fChannel} onChange={(e) => { setPage(0); setFChannel(e.target.value as CommsChannel | ""); }}>
                  <option value="">{t({ ar: "الكل", en: "All" })}</option>
                  {CHANNELS.map((c) => <option key={c} value={c}>{COMMS_CHANNEL_AR[c]}</option>)}
                </select>
              </div>
              <div>
                <div className="f-sans" style={LABEL}>{t({ ar: "الحدث", en: "Event" })}</div>
                <select style={INPUT} value={fEvent} onChange={(e) => { setPage(0); setFEvent(e.target.value); }}>
                  <option value="">{t({ ar: "الكل", en: "All" })}</option>
                  {catalog.map((c) => <option key={c.event_key} value={c.event_key}>{c.label_ar || c.event_key}</option>)}
                </select>
              </div>
              <div>
                <div className="f-sans" style={LABEL}>{t({ ar: "بحث", en: "Search" })}</div>
                <input style={INPUT} value={fSearch} placeholder={t({ ar: "عنوان أو مستلِم…", en: "Subject or recipient…" })}
                  onChange={(e) => setFSearch(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { setPage(0); void load(); } }} />
              </div>
            </div>
            <div style={{ display: "flex", gap: "8px", marginTop: "12px", flexWrap: "wrap" }}>
              <button style={BTN} onClick={() => { setPage(0); void load(); }} disabled={busy}>{t({ ar: "تطبيق", en: "Apply" })}</button>
              <button style={BTN} onClick={() => { setFStatus(""); setFChannel(""); setFEvent(""); setFSearch(""); setPage(0); }}>{t({ ar: "مسح", en: "Clear" })}</button>
              <button style={BTN} onClick={exportCsv} disabled={rows.length === 0}>{t({ ar: "تصدير CSV", en: "Export CSV" })}</button>
              {isAdmin && (
                <button style={BTN} disabled={busy}
                  onClick={() => void act(() => commsImportLegacy(200), "تمّت مزامنة عرض الطابور القديم (قراءة فقط).")}>
                  {t({ ar: "استيراد عرض الطابور القديم", en: "Mirror legacy queue" })}
                </button>
              )}
              {isAdmin && (
                <button style={BTN} disabled={busy} onClick={() => void processNow()}>
                  {t({ ar: "معالجة الطابور الآن (محاكاة)", en: "Process queue now (simulated)" })}
                </button>
              )}
            </div>
          </div>

          {/* ── MESSAGE PREVIEW ── */}
          <div style={{ ...CARD, marginBottom: "16px" }}>
            <div className="f-sans" style={{ ...LABEL, marginBottom: "10px" }}>{t({ ar: "معاينة رسالة (بدون إرسال)", en: "Message preview (no send)" })}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "10px" }}>
              <select style={INPUT} value={pvEvent} onChange={(e) => setPvEvent(e.target.value)}>
                <option value="">{t({ ar: "اختر حدثًا", en: "Pick an event" })}</option>
                {catalog.map((c) => <option key={c.event_key} value={c.event_key}>{c.label_ar || c.event_key}</option>)}
              </select>
              <select style={INPUT} value={pvLocale} onChange={(e) => setPvLocale(e.target.value as "ar" | "en")}>
                <option value="ar">العربية</option><option value="en">English</option>
              </select>
              <select style={INPUT} value={pvScope} onChange={(e) => setPvScope(e.target.value as "internal" | "client")}>
                <option value="internal">{t({ ar: "نسخة داخلية", en: "Internal copy" })}</option>
                <option value="client">{t({ ar: "نسخة العميل", en: "Client copy" })}</option>
              </select>
              <button style={BTN} onClick={() => void runPreview()}>{t({ ar: "معاينة", en: "Preview" })}</button>
            </div>
            {pvErr && <div className="f-sans" style={{ marginTop: "10px", fontSize: "12px", color: "#ff8a8e" }}>{pvErr}</div>}
            {preview && (
              <div style={{ marginTop: "12px", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "3px", padding: "12px" }}>
                <div className="f-sans" style={{ ...LABEL, marginBottom: "6px" }}>
                  {t({ ar: "الإصدار", en: "Version" })} v{preview.version} · {preview.locale} · {preview.audience_scope}
                </div>
                <div className="text-white" style={{ fontSize: "14px", fontWeight: 600, marginBottom: "8px" }}>{preview.subject}</div>
                <pre className="f-sans" style={{ whiteSpace: "pre-wrap", fontSize: "12.5px", color: "rgba(255,255,255,0.75)", lineHeight: 1.9, margin: 0 }}>{preview.body}</pre>
                {preview.would_violate_r2 && (
                  <div className="f-sans" style={{ marginTop: "10px", fontSize: "12px", color: "#ff8a8e" }}>
                    ⚠ هذا القالب يحمل محتوى ماليًّا/داخليًّا ولن يُسلَّم لعميل — ستمنعه القاعدة R2 عند الإرسال.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── THE OUTBOX ── */}
          {rows.length === 0 ? (
            <div className="text-center" style={{ padding: "60px 24px", border: "1px dashed rgba(255,255,255,0.12)", borderRadius: "4px" }}>
              <p className="text-white/55" style={{ fontSize: "14px", lineHeight: 1.85 }}>
                {t({ ar: "لا توجد رسائل مطابقة. الطابور فارغ أو المرشّحات ضيّقة.", en: "No matching messages. The queue is empty or the filters are narrow." })}
              </p>
            </div>
          ) : (
            <div style={{ overflowX: "auto", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "4px" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "820px" }}>
                <thead>
                  <tr>
                    {["الوقت", "الحدث", "القناة", "المستلِم", "الحالة", "المحاولات", ""].map((h) => (
                      <th key={h} className="f-sans" style={{ ...LABEL, textAlign: isAr ? "right" : "left", padding: "10px 12px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                      <td className="f-sans" style={{ padding: "9px 12px", fontSize: "11px", color: "rgba(255,255,255,0.4)", direction: "ltr", whiteSpace: "nowrap" }}>
                        {new Date(r.created_at).toLocaleString("ar-SA")}
                      </td>
                      <td style={{ padding: "9px 12px", fontSize: "12.5px" }}>
                        <span className="text-white">{r.event_key}</span>
                        <span className="f-sans" style={{ display: "block", fontSize: "10px", color: "rgba(255,255,255,0.35)" }}>
                          {commsCategoryAr(r.category)}{r.recipient_is_external ? " · عميل" : " · داخلي"}
                        </span>
                      </td>
                      <td className="f-sans" style={{ padding: "9px 12px", fontSize: "11.5px", color: "rgba(255,255,255,0.6)" }}>{COMMS_CHANNEL_AR[r.channel]}</td>
                      <td className="f-sans" style={{ padding: "9px 12px", fontSize: "11.5px", color: "rgba(255,255,255,0.55)", direction: "ltr", maxWidth: "180px", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {r.recipient_address ?? "—"}
                      </td>
                      <td className="f-sans" style={{ padding: "9px 12px", fontSize: "11.5px", color: statusColor(r), whiteSpace: "nowrap" }}>
                        {commsStatusLabel(r)}
                      </td>
                      <td className="f-sans" style={{ padding: "9px 12px", fontSize: "11.5px", color: "rgba(255,255,255,0.5)", direction: "ltr" }}>{r.attempts}/{r.max_attempts}</td>
                      <td style={{ padding: "9px 12px", whiteSpace: "nowrap" }}>
                        <button style={{ ...BTN, fontSize: "9.5px", padding: "5px 9px" }} onClick={() => setDetail(r)}>{t({ ar: "تفاصيل", en: "Details" })}</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "14px", flexWrap: "wrap" }}>
            <button style={BTN} disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>{t({ ar: "السابق", en: "Prev" })}</button>
            <span className="f-sans" style={{ fontSize: "11px", color: "rgba(255,255,255,0.45)" }}>
              {t({ ar: "صفحة", en: "Page" })} {page + 1} / {pages} · {total} {t({ ar: "رسالة", en: "messages" })}
            </span>
            <button style={BTN} disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>{t({ ar: "التالي", en: "Next" })}</button>
          </div>
        </>
      )}

      {/* ── DETAIL DRAWER ── */}
      {detail && (
        <div onClick={() => setDetail(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...CARD, background: "#0d0d0d", maxWidth: "620px", width: "100%", maxHeight: "85vh", overflowY: "auto", direction: isAr ? "rtl" : "ltr" }}>
            <div className="text-white" style={{ fontSize: "15px", fontWeight: 600, marginBottom: "10px" }}>{detail.subject}</div>
            <div className="f-sans" style={{ fontSize: "12px", color: "rgba(255,255,255,0.55)", lineHeight: 2 }}>
              <div>{t({ ar: "الحدث", en: "Event" })}: {detail.event_key}</div>
              <div>{t({ ar: "الحالة", en: "Status" })}: <span style={{ color: statusColor(detail) }}>{commsStatusLabel(detail)}</span></div>
              <div>{t({ ar: "القناة", en: "Channel" })}: {COMMS_CHANNEL_AR[detail.channel]} · {detail.dry_run ? "محاكاة" : "حقيقي"}</div>
              <div>{t({ ar: "نطاق المحتوى", en: "Content scope" })}: {detail.audience_scope === "client" ? "نسخة العميل" : "نسخة داخلية"}</div>
              <div>{t({ ar: "المستلِم", en: "Recipient" })}: <span style={{ direction: "ltr", display: "inline-block" }}>{detail.recipient_address ?? "—"}</span> ({detail.recipient_role ?? "—"})</div>
              <div>{t({ ar: "المحاولات", en: "Attempts" })}: {detail.attempts}/{detail.max_attempts}</div>
              <div>{t({ ar: "المزوّد", en: "Provider" })}: {detail.provider ?? "—"} {detail.provider_message_id ? `· ${detail.provider_message_id}` : ""}</div>
              <div>{t({ ar: "قالب", en: "Template" })}: v{detail.template_version ?? "—"} · {detail.locale}</div>
              {detail.last_error && <div style={{ color: "#ff8a8e" }}>{t({ ar: "الخطأ", en: "Error" })}: {detail.error_class ?? ""} — {detail.last_error}</div>}
              {detail.cancel_reason && <div>{t({ ar: "سبب الإلغاء", en: "Cancel reason" })}: {detail.cancel_reason}</div>}
              {isAdmin && <div style={{ direction: "ltr", fontSize: "10.5px", color: "rgba(255,255,255,0.3)" }}>correlation: {detail.correlation_id}</div>}
            </div>
            <div className="f-sans" style={{ marginTop: "14px", fontSize: "11.5px", color: "#e0b955", lineHeight: 1.8 }}>
              {COMMS_DRY_RUN_NOTICE_AR}
            </div>
            <div style={{ display: "flex", gap: "8px", marginTop: "10px", flexWrap: "wrap" }}>
              {isAdmin && (detail.status === "queued" || detail.status === "retrying") && (
                <button style={BTN} disabled={busy}
                  onClick={() => { const why = window.prompt("سبب الإلغاء؟") ?? ""; void act(() => commsCancel(detail.id, why), "أُلغيت الرسالة قبل الإرسال."); setDetail(null); }}>
                  {t({ ar: "إلغاء قبل الإرسال", en: "Cancel before send" })}
                </button>
              )}
              {isAdmin && ["failed", "dead_letter", "retrying", "cancelled"].includes(detail.status) && (
                <button style={BTN} disabled={busy}
                  onClick={() => { void act(() => commsRetry(detail.id), "أُعيدت الرسالة إلى الطابور."); setDetail(null); }}>
                  {t({ ar: "إعادة المحاولة يدويًا", en: "Manual retry" })}
                </button>
              )}
              <button style={BTN} onClick={() => setDetail(null)}>{t({ ar: "إغلاق", en: "Close" })}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
