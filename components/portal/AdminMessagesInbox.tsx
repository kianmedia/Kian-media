"use client";
// ════════════════════════════════════════════════════════════════════════
// Admin inbox inside the Messages tab. Uses ONLY the deployed RLS (no SQL):
//   • admin reads every message (own-messages-read "or is_admin()")
//   • admin replies via the admin-all policy (sender='admin', any user_id)
//   • the trg_message_created trigger notifies the client of the reply
// Display status is DERIVED (latest sender) — no status column / mark-read
// exists yet (see the S4-DB addendum for the optional persisted version).
// ════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { adminListAllMessages, adminListSenders, adminReplySupport, type SenderProfile } from "@/lib/portal/admin";
import type { MessageRow } from "@/lib/portal/types";

interface Thread {
  userId: string;
  sender?: SenderProfile;
  messages: MessageRow[];   // ascending
  latest: MessageRow;
  awaitingReply: boolean;   // latest message is from the client
}

export default function AdminMessagesInbox({ readOnly = false }: { readOnly?: boolean } = {}) {
  const { t, isAr } = useI18n();
  const [phase, setPhase] = useState<"loading" | "error" | "ready">("loading");
  const [rows, setRows] = useState<MessageRow[]>([]);
  const [senders, setSenders] = useState<Record<string, SenderProfile>>({});
  const [err, setErr] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);

  async function load() {
    const r = await adminListAllMessages();
    if (!r.ok) { setErr(r.error); setPhase("error"); return; }
    setRows(r.data);
    const ids = Array.from(new Set(r.data.map((m) => m.user_id)));
    const sp = await adminListSenders(ids);
    if (sp.ok) {
      const map: Record<string, SenderProfile> = {};
      sp.data.forEach((p) => { map[p.id] = p; });
      setSenders(map);
    }
    setPhase("ready");
  }
  useEffect(() => { void load(); }, []);

  const threads = useMemo<Thread[]>(() => {
    const byUser = new Map<string, MessageRow[]>();
    // rows are desc; build ascending per user
    for (const m of [...rows].reverse()) {
      const arr = byUser.get(m.user_id) ?? [];
      arr.push(m);
      byUser.set(m.user_id, arr);
    }
    const list: Thread[] = [];
    byUser.forEach((messages, userId) => {
      const latest = messages[messages.length - 1];
      list.push({ userId, sender: senders[userId], messages, latest, awaitingReply: latest.sender === "user" });
    });
    // newest activity first; awaiting-reply float to top
    list.sort((a, b) => {
      if (a.awaitingReply !== b.awaitingReply) return a.awaitingReply ? -1 : 1;
      return new Date(b.latest.created_at).getTime() - new Date(a.latest.created_at).getTime();
    });
    return list;
  }, [rows, senders]);

  async function onReply(userId: string) {
    const text = reply.trim();
    if (!text || sending) return;
    setSending(true);
    const r = await adminReplySupport(userId, text);
    setSending(false);
    if (!r.ok) { setErr(r.error); return; }
    setReply("");
    void load();
  }

  function senderLine(th: Thread): string {
    const s = th.sender;
    if (!s) return th.userId.slice(0, 8) + "…";
    const name = s.full_name || s.email;
    return s.company ? `${name} · ${s.company}` : name;
  }

  return (
    <div>
      <div className="mb-8">
        <div className="eyebrow mb-4">{t({ ar: "صندوق الرسائل — الإدارة", en: "Messages — Admin Inbox" })}</div>
        <h1 className="editorial text-white" style={{ fontSize: "clamp(24px,4vw,34px)", lineHeight: 1.25 }}>
          {t({ ar: "رسائل العملاء", en: "Client Messages" })}
        </h1>
        <p className="text-white/45" style={{ fontSize: "12.5px", marginTop: "8px" }}>
          {t({ ar: "الخيوط التي تنتظر رداً تظهر في الأعلى.", en: "Threads awaiting a reply appear at the top." })}
        </p>
      </div>

      {phase === "loading" && <div className="f-sans" style={{ fontSize: "12px", letterSpacing: "2px", color: "rgba(255,255,255,0.4)", textTransform: "uppercase", padding: "20px 0" }}>{t({ ar: "جارٍ التحميل...", en: "Loading..." })}</div>}
      {phase === "error" && <div className="f-sans" style={{ padding: "14px", fontSize: "13px", color: "#ff8a8e", background: "rgba(227,30,36,0.08)", border: "1px solid rgba(227,30,36,0.3)", borderRadius: "3px" }}>{err}</div>}
      {phase === "ready" && threads.length === 0 && <p className="text-white/45" style={{ fontSize: "14px" }}>{t({ ar: "لا توجد رسائل بعد.", en: "No messages yet." })}</p>}

      {phase === "ready" && threads.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {threads.map((th) => {
            const open = openId === th.userId;
            return (
              <div key={th.userId} style={{ background: "rgba(255,255,255,0.02)", border: `1px solid ${th.awaitingReply ? "rgba(227,30,36,0.3)" : "rgba(255,255,255,0.08)"}`, borderRadius: "4px", overflow: "hidden" }}>
                {/* Thread header */}
                <button onClick={() => { setOpenId(open ? null : th.userId); setReply(""); }}
                  className="f-sans" style={{ width: "100%", textAlign: isAr ? "right" : "left", padding: "15px 18px", background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="text-white" style={{ fontSize: "14px", fontWeight: 600, marginBottom: "3px" }}>{senderLine(th)}</div>
                    <div className="text-white/45" style={{ fontSize: "12px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{th.latest.body}</div>
                  </div>
                  <span style={{ fontSize: "9px", letterSpacing: "1px", textTransform: "uppercase", padding: "5px 10px", borderRadius: "2px", whiteSpace: "nowrap", color: th.awaitingReply ? "#E31E24" : "rgba(255,255,255,0.5)", background: th.awaitingReply ? "rgba(227,30,36,0.1)" : "rgba(255,255,255,0.05)", border: `1px solid ${th.awaitingReply ? "rgba(227,30,36,0.3)" : "rgba(255,255,255,0.1)"}` }}>
                    {th.awaitingReply ? t({ ar: "بانتظار الرد", en: "Awaiting Reply" }) : t({ ar: "تم الرد", en: "Replied" })}
                  </span>
                </button>

                {/* Expanded thread + reply */}
                {open && (
                  <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", padding: "16px 18px" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "14px" }}>
                      {th.messages.map((m) => {
                        const fromKian = m.sender === "admin";
                        return (
                          <div key={m.id} style={{ alignSelf: fromKian ? "flex-end" : "flex-start", maxWidth: "85%", padding: "10px 13px", borderRadius: "8px", background: fromKian ? "rgba(227,30,36,0.12)" : "rgba(255,255,255,0.04)", border: `1px solid ${fromKian ? "rgba(227,30,36,0.25)" : "rgba(255,255,255,0.08)"}` }}>
                            <div className="f-sans" style={{ fontSize: "9px", letterSpacing: "1.5px", textTransform: "uppercase", color: "rgba(255,255,255,0.4)", marginBottom: "3px" }}>
                              {fromKian ? t({ ar: "كيان (رد)", en: "Kian (reply)" }) : t({ ar: "العميل", en: "Client" })}
                            </div>
                            <div className="text-white/85" style={{ fontSize: "13.5px", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{m.body}</div>
                            <div className="f-sans" style={{ fontSize: "10px", color: "rgba(255,255,255,0.3)", marginTop: "4px", direction: "ltr", textAlign: fromKian ? "right" : "left" }}>
                              {new Date(m.created_at).toLocaleString(isAr ? "ar-SA" : "en-GB", { dateStyle: "short", timeStyle: "short" })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {readOnly ? (
                      <p className="f-sans" style={{ fontSize: "11.5px", color: "rgba(255,255,255,0.4)", lineHeight: 1.6 }}>
                        {t({ ar: "عرض فقط — الرد متاح للإدارة.", en: "View only — replying is available to admins." })}
                      </p>
                    ) : (
                      <div style={{ display: "flex", gap: "10px", alignItems: "flex-end" }}>
                        <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={2}
                          placeholder={t({ ar: "اكتب رداً للعميل...", en: "Write a reply to the client..." })}
                          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void onReply(th.userId); }}
                          style={{ flex: 1, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "3px", padding: "11px 13px", color: "#fff", fontSize: "13.5px", fontFamily: "var(--sans)", outline: "none", resize: "vertical", lineHeight: 1.6 }} />
                        <button onClick={() => onReply(th.userId)} disabled={sending || !reply.trim()} className="btn-red" style={{ justifyContent: "center", opacity: sending || !reply.trim() ? 0.5 : 1, cursor: sending || !reply.trim() ? "default" : "pointer", whiteSpace: "nowrap" }}>
                          <span>{sending ? "..." : t({ ar: "رد", en: "Reply" })}</span>
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
