"use client";
// Client/lead support thread — insert-only (sender='user'); admin replies appear here.
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { usePortal } from "@/components/portal/PortalShell";
import { listMyMessages, sendMessage } from "@/lib/portal/leads";
import type { MessageRow } from "@/lib/portal/types";

export default function ClientMessages() {
  const { t, isAr } = useI18n();
  const { readOnly } = usePortal();
  const [phase, setPhase] = useState<"loading" | "error" | "ready">("loading");
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [err, setErr] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  async function load(scroll = false) {
    const r = await listMyMessages();
    if (!r.ok) { setErr(r.error); setPhase("error"); return; }
    setMessages(r.data);
    setPhase("ready");
    if (scroll) setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 60);
  }
  useEffect(() => { void load(); }, []);

  async function onSend() {
    const text = body.trim();
    if (!text || sending) return;
    setSending(true);
    const r = await sendMessage(text);
    setSending(false);
    if (!r.ok) { setErr(r.error); return; }
    setBody("");
    void load(true);
  }

  return (
    <div>
      <div className="mb-8">
        <div className="eyebrow mb-4">{t({ ar: "الرسائل", en: "Messages" })}</div>
        <h1 className="editorial text-white" style={{ fontSize: "clamp(24px,4vw,34px)", lineHeight: 1.25 }}>
          {t({ ar: "تواصل مع كيان ميديا", en: "Message Kian Media" })}
        </h1>
      </div>

      <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "4px", padding: "20px", minHeight: "220px", marginBottom: "16px" }}>
        {phase === "loading" && <div className="f-sans" style={{ fontSize: "12px", letterSpacing: "2px", color: "rgba(255,255,255,0.4)", textTransform: "uppercase" }}>{t({ ar: "جارٍ التحميل...", en: "Loading..." })}</div>}
        {phase === "error" && <div className="f-sans" style={{ fontSize: "13px", color: "#ff8a8e" }}>{t({ ar: "تعذّر التحميل: ", en: "Couldn't load: " })}{err}</div>}
        {phase === "ready" && messages.length === 0 && (
          <p className="text-white/45 text-center" style={{ fontSize: "14px", padding: "40px 0", lineHeight: 1.7 }}>
            {t({ ar: "ابدأ المحادثة — اكتب رسالتك بالأسفل وسيرد عليك فريق كيان ميديا.", en: "Start the conversation — write your message below and the Kian Media team will reply." })}
          </p>
        )}
        {phase === "ready" && messages.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {messages.map((m) => {
              const mine = m.sender === "user";
              return (
                <div key={m.id} style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "85%", padding: "11px 14px", borderRadius: "8px", background: mine ? "rgba(227,30,36,0.12)" : "rgba(255,255,255,0.04)", border: `1px solid ${mine ? "rgba(227,30,36,0.25)" : "rgba(255,255,255,0.08)"}` }}>
                  <div className="f-sans" style={{ fontSize: "9px", letterSpacing: "1.5px", textTransform: "uppercase", color: "rgba(255,255,255,0.4)", marginBottom: "4px" }}>
                    {mine ? t({ ar: "أنت", en: "You" }) : t({ ar: "كيان ميديا", en: "Kian Media" })}
                  </div>
                  <div className="text-white/85" style={{ fontSize: "14px", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{m.body}</div>
                  <div className="f-sans" style={{ fontSize: "10px", color: "rgba(255,255,255,0.3)", marginTop: "5px", direction: "ltr", textAlign: mine ? "right" : "left" }}>
                    {new Date(m.created_at).toLocaleString(isAr ? "ar-SA" : "en-GB", { dateStyle: "short", timeStyle: "short" })}
                  </div>
                </div>
              );
            })}
            <div ref={endRef} />
          </div>
        )}
      </div>

      {readOnly ? (
        <div className="f-sans" style={{ padding: "14px 16px", fontSize: "13px", color: "#ffd28a", background: "rgba(255,166,0,0.08)", border: "1px solid rgba(255,166,0,0.3)", borderRadius: "3px" }}>
          {t({ ar: "حسابك في وضع القراءة فقط — لا يمكن إرسال رسائل حالياً.", en: "Your account is read-only — messages can't be sent right now." })}
        </div>
      ) : (
        <div style={{ display: "flex", gap: "10px", alignItems: "flex-end" }}>
          <textarea
            value={body} onChange={(e) => setBody(e.target.value)} rows={2}
            placeholder={t({ ar: "اكتب رسالتك...", en: "Write your message..." })}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void onSend(); }}
            style={{ flex: 1, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "3px", padding: "12px 14px", color: "#fff", fontSize: "14px", fontFamily: "var(--sans)", outline: "none", resize: "vertical", lineHeight: 1.6 }}
          />
          <button onClick={onSend} disabled={sending || !body.trim()} className="btn-red" style={{ justifyContent: "center", opacity: sending || !body.trim() ? 0.5 : 1, cursor: sending || !body.trim() ? "default" : "pointer", whiteSpace: "nowrap" }}>
            <span>{sending ? "..." : t({ ar: "إرسال", en: "Send" })}</span>
          </button>
        </div>
      )}
    </div>
  );
}
