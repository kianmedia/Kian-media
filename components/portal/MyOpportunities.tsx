"use client";
// ════════════════════════════════════════════════════════════════════════
// Applicant view (طلباتي): a logged-in user sees THEIR opportunity requests
// (email-matched, applicant-safe RPCs), a status timeline, the Kian message
// thread, and can message Kian. No internal notes / assignment / other applicants.
// Backed by docs/opportunity_applicant_tracking_ADDENDUM.sql.
// ════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import {
  listMyOpportunityRequests, listMyOpportunityMessages, addOpportunityMessage,
  oppTypeLabel, oppFieldLabel, APPLICANT_STATUS_LABELS, APPLICANT_TIMELINE,
  type MyOpportunityRequest, type OpportunityMessage,
} from "@/lib/opportunities";

export default function MyOpportunities() {
  const { t, isAr } = useI18n();
  const [phase, setPhase] = useState<"loading" | "error" | "ready">("loading");
  const [rows, setRows] = useState<MyOpportunityRequest[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);

  async function load() {
    const r = await listMyOpportunityRequests();
    if (!r.ok) { setPhase("error"); return; }
    setRows(r.data); setPhase("ready");
  }
  useEffect(() => { void load(); }, []);

  const open = rows.find((r) => r.id === openId) || null;

  return (
    <div>
      <div className="mb-8">
        <div className="eyebrow mb-4">{t({ ar: "فرص كيان", en: "Kian Opportunities" })}</div>
        <h1 className="editorial text-white" style={{ fontSize: "clamp(24px,4vw,34px)", lineHeight: 1.25 }}>{t({ ar: "طلباتي", en: "My Requests" })}</h1>
        <p className="text-white/45" style={{ fontSize: "12.5px", marginTop: "8px" }}>{t({ ar: "تابع حالة طلباتك وراسل فريق كيان.", en: "Track your requests and message the Kian team." })}</p>
      </div>

      {phase === "loading" && <p className="text-white/45" style={{ fontSize: "13.5px" }}>{t({ ar: "جارٍ التحميل...", en: "Loading..." })}</p>}
      {phase === "error" && <div className="f-sans" style={{ fontSize: "13px", color: "#ff8a8e" }}>{t({ ar: "تعذّر تحميل طلباتك.", en: "Couldn't load your requests." })}</div>}
      {phase === "ready" && rows.length === 0 && (
        <p className="text-white/45" style={{ fontSize: "13.5px", lineHeight: 1.8 }}>
          {t({ ar: "لا توجد طلبات مرتبطة ببريدك. تأكد من استخدام نفس البريد الذي قدمت به الطلب.", en: "No requests linked to your email. Make sure you used the same email you applied with." })}
        </p>
      )}

      {phase === "ready" && rows.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {rows.map((r) => {
            const st = APPLICANT_STATUS_LABELS[r.status] ?? { ar: r.status, en: r.status };
            return (
              <button key={r.id} onClick={() => setOpenId(r.id)} className="text-start" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "4px", padding: "16px 18px", cursor: "pointer" }}>
                <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                  <div>
                    <div className="text-white" style={{ fontSize: "15px", fontWeight: 700 }}>{isAr ? oppTypeLabel(r.opportunity_type).ar : oppTypeLabel(r.opportunity_type).en}</div>
                    <div className="f-sans" style={{ fontSize: "11px", color: "rgba(255,255,255,0.45)", marginTop: "3px" }}>
                      {r.request_number && <span style={{ direction: "ltr", unicodeBidi: "plaintext" }}>{r.request_number}</span>}
                      <span style={{ marginInlineStart: r.request_number ? "8px" : 0 }}>{new Date(r.created_at).toLocaleDateString(isAr ? "ar-SA" : "en-GB")}</span>
                    </div>
                  </div>
                  <StatusBadge status={r.status} label={isAr ? st.ar : st.en} />
                </div>
                <Timeline status={r.status} />
              </button>
            );
          })}
        </div>
      )}

      {open && <RequestModal req={open} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function StatusBadge({ status, label }: { status: string; label: string }) {
  const terminal = status === "rejected" || status === "archived";
  const accepted = status === "accepted";
  const color = terminal ? "#ff8a8e" : accepted ? "#7CFC9A" : "#E31E24";
  const bg = terminal ? "rgba(227,30,36,0.08)" : accepted ? "rgba(124,252,154,0.08)" : "rgba(227,30,36,0.1)";
  return (
    <span className="f-sans" style={{ fontSize: "10px", letterSpacing: "0.5px", textTransform: "uppercase", color, background: bg, border: `1px solid ${color}55`, padding: "6px 11px", borderRadius: "2px", whiteSpace: "nowrap" }}>{label}</span>
  );
}

function Timeline({ status }: { status: string }) {
  const { t, isAr } = useI18n();
  if (status === "rejected" || status === "archived") {
    return <p className="f-sans" style={{ fontSize: "11.5px", color: status === "rejected" ? "#ff8a8e" : "rgba(255,255,255,0.5)", marginTop: "2px" }}>{isAr ? APPLICANT_STATUS_LABELS[status].ar : APPLICANT_STATUS_LABELS[status].en}</p>;
  }
  const idx = Math.max(0, APPLICANT_TIMELINE.indexOf(status));
  return (
    <div style={{ overflowX: "auto" }}>
      <div className="flex items-start" dir="ltr" style={{ minWidth: "440px", gap: 0 }}>
        {APPLICANT_TIMELINE.map((s, i) => {
          const done = i <= idx; const last = i === APPLICANT_TIMELINE.length - 1;
          return (
            <div key={s} style={{ flex: last ? "0 0 56px" : "1 1 0%", minWidth: "56px" }}>
              <div className="flex items-center">
                <div style={{ width: "12px", height: "12px", borderRadius: "50%", flexShrink: 0, background: done ? "#E31E24" : "rgba(255,255,255,0.1)", border: `2px solid ${done ? "#E31E24" : "rgba(255,255,255,0.2)"}`, boxShadow: done ? "0 0 8px rgba(227,30,36,0.5)" : "none" }} />
                {!last && <div style={{ height: "2px", flex: 1, background: i < idx ? "#E31E24" : "rgba(255,255,255,0.1)" }} />}
              </div>
              <div className="f-sans" style={{ marginTop: "6px", paddingInlineEnd: "6px", fontSize: "8.5px", lineHeight: 1.3, color: i <= idx ? "rgba(255,255,255,0.75)" : "rgba(255,255,255,0.3)" }}>
                {isAr ? APPLICANT_STATUS_LABELS[s].ar : APPLICANT_STATUS_LABELS[s].en}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RequestModal({ req, onClose }: { req: MyOpportunityRequest; onClose: () => void }) {
  const { t, isAr } = useI18n();
  const [msgs, setMsgs] = useState<OpportunityMessage[]>([]);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function loadMsgs() { const r = await listMyOpportunityMessages(req.id); if (r.ok) setMsgs(r.data); }
  useEffect(() => { void loadMsgs(); /* eslint-disable-next-line */ }, [req.id]);

  async function send() {
    if (!body.trim()) return;
    setBusy(true); setFlash(null);
    const r = await addOpportunityMessage(req.id, body.trim());
    setBusy(false);
    if (!r.ok) { setFlash({ kind: "err", text: t({ ar: "تعذّر الإرسال: ", en: "Couldn't send: " }) + r.error }); return; }
    setBody(""); setFlash({ kind: "ok", text: t({ ar: "تم إرسال رسالتك ✓", en: "Message sent ✓" }) }); void loadMsgs();
  }

  const details = Object.entries(req.details || {}).filter(([k]) => !["source", "utm_source", "utm_medium", "utm_campaign"].includes(k));
  const st = APPLICANT_STATUS_LABELS[req.status] ?? { ar: req.status, en: req.status };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 130, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "24px", overflowY: "auto" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: "620px", background: "#0c0c0c", border: "1px solid rgba(227,30,36,0.25)", borderRadius: "6px", padding: "24px", margin: "auto" }}>
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h3 className="text-white" style={{ fontSize: "18px", fontWeight: 700 }}>{isAr ? oppTypeLabel(req.opportunity_type).ar : oppTypeLabel(req.opportunity_type).en}</h3>
            <div className="f-sans" style={{ fontSize: "11px", color: "rgba(255,255,255,0.45)", marginTop: "3px" }}>
              {req.request_number && <span style={{ direction: "ltr" }}>{req.request_number} · </span>}{new Date(req.created_at).toLocaleDateString(isAr ? "ar-SA" : "en-GB")}
            </div>
          </div>
          <button onClick={onClose} className="f-sans" style={{ background: "none", border: "none", color: "rgba(255,255,255,0.7)", fontSize: "14px", cursor: "pointer" }}>✕</button>
        </div>

        <div className="mb-4"><StatusBadge status={req.status} label={isAr ? st.ar : st.en} /></div>
        <div className="mb-5"><Timeline status={req.status} /></div>

        {req.message && (
          <div style={{ marginBottom: "14px" }}>
            <div className="f-sans" style={{ fontSize: "9.5px", letterSpacing: "1px", textTransform: "uppercase", color: "rgba(255,255,255,0.4)", marginBottom: "4px" }}>{t({ ar: "ملخّص طلبك", en: "Your summary" })}</div>
            <p className="text-white/85" style={{ fontSize: "13.5px", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{req.message}</p>
          </div>
        )}
        {details.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "16px" }}>
            {details.map(([k, v]) => (
              <div key={k} style={{ background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "3px", padding: "8px 10px" }}>
                <div className="f-sans" style={{ fontSize: "9px", letterSpacing: "0.5px", textTransform: "uppercase", color: "rgba(255,255,255,0.4)", marginBottom: "3px" }}>{isAr ? oppFieldLabel(req.opportunity_type, k).ar : oppFieldLabel(req.opportunity_type, k).en}</div>
                <div className="text-white/85" style={{ fontSize: "12.5px", lineHeight: 1.5, wordBreak: "break-word", whiteSpace: "pre-wrap" }}>{String(v)}</div>
              </div>
            ))}
          </div>
        )}

        {/* Conversation with Kian */}
        <div className="f-sans" style={{ fontSize: "9.5px", letterSpacing: "1px", textTransform: "uppercase", color: "rgba(255,255,255,0.4)", marginBottom: "8px" }}>{t({ ar: "المراسلات مع كيان", en: "Conversation with Kian" })}</div>
        {msgs.length === 0 ? (
          <p className="text-white/40" style={{ fontSize: "12.5px", marginBottom: "10px" }}>{t({ ar: "لا رسائل بعد.", en: "No messages yet." })}</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "12px" }}>
            {msgs.map((m) => {
              const mine = m.sender === "applicant";
              return (
                <div key={m.id} style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "85%", padding: "10px 13px", borderRadius: "8px", background: mine ? "rgba(227,30,36,0.12)" : "rgba(255,255,255,0.04)", border: `1px solid ${mine ? "rgba(227,30,36,0.25)" : "rgba(255,255,255,0.08)"}` }}>
                  <div className="f-sans" style={{ fontSize: "9px", letterSpacing: "1px", textTransform: "uppercase", color: "rgba(255,255,255,0.4)", marginBottom: "3px" }}>{mine ? t({ ar: "أنت", en: "You" }) : t({ ar: "كيان", en: "Kian" })}</div>
                  <div className="text-white/85" style={{ fontSize: "13px", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{m.body}</div>
                </div>
              );
            })}
          </div>
        )}
        <div className="flex gap-2 items-end">
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} maxLength={4000}
            placeholder={t({ ar: "إرسال رسالة إلى كيان بخصوص هذا الطلب...", en: "Message Kian about this request..." })}
            style={{ flex: 1, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "3px", padding: "10px 12px", color: "#fff", fontSize: "13px", fontFamily: "var(--sans)", outline: "none", resize: "vertical", lineHeight: 1.6, colorScheme: "dark" }} />
          <button onClick={() => void send()} disabled={busy || !body.trim()} className="btn-red" style={{ justifyContent: "center", opacity: busy || !body.trim() ? 0.5 : 1 }}><span>{t({ ar: "إرسال", en: "Send" })}</span></button>
        </div>
        {flash && <div className="f-sans" style={{ fontSize: "12px", marginTop: "10px", color: flash.kind === "ok" ? "#7CFC9A" : "#ff8a8e" }}>{flash.text}</div>}
      </div>
    </div>
  );
}
