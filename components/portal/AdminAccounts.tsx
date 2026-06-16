"use client";
// ════════════════════════════════════════════════════════════════════════
// Admin Account Management — list portal profiles and adjust account_status /
// account_type / client_level via the existing admin_set_account RPC (S1),
// which is is_admin()-guarded and refuses to grant admin to anyone but the two
// approved emails. The UI additionally protects those two admin rows (no edits).
// "Send message" uses adminReplySupport → a real admin message that auto-
// notifies the client (existing safe path; no email/WhatsApp/push).
// ════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { adminListProfiles, adminSetAccount, adminReplySupport, adminListProjects } from "@/lib/portal/admin";
import AccountLinking from "@/components/portal/AccountLinking";
import type { Profile, AccountStatus, AccountType, ClientLevel, Project } from "@/lib/portal/types";

const PROTECTED_EMAILS = ["kianalebtikar@gmail.com", "manager@kianmedia.com"];

const STATUS_OPTS: { v: AccountStatus; ar: string; en: string }[] = [
  { v: "active",   ar: "نشط",   en: "Active" },
  { v: "inactive", ar: "موقوف مؤقتاً", en: "Inactive" },
  { v: "blocked",  ar: "محظور", en: "Blocked" },
];
const TYPE_OPTS: { v: AccountType; ar: string; en: string }[] = [
  { v: "lead",   ar: "حساب جديد", en: "Lead" },
  { v: "client", ar: "عميل",      en: "Client" },
];
const LEVEL_OPTS: { v: ClientLevel; ar: string; en: string }[] = [
  { v: "prospect", ar: "محتمل", en: "Prospect" },
  { v: "active",   ar: "نشط",   en: "Active" },
  { v: "vip",      ar: "VIP",   en: "VIP" },
];

export default function AdminAccounts() {
  const { t, isAr } = useI18n();
  const [phase, setPhase] = useState<"loading" | "error" | "ready">("loading");
  const [rows, setRows] = useState<Profile[]>([]);
  const [err, setErr] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ id: string; kind: "ok" | "err"; text: string } | null>(null);
  const [msgFor, setMsgFor] = useState<Profile | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [linkFor, setLinkFor] = useState<string | null>(null); // expanded linking panel

  async function load() {
    const r = await adminListProfiles();
    if (!r.ok) { setErr(r.error); setPhase("error"); return; }
    setRows(r.data);
    setPhase("ready");
  }
  async function loadProjects() {
    const r = await adminListProjects();
    if (r.ok) setProjects(r.data);
  }
  useEffect(() => { void load(); void loadProjects(); }, []);

  async function patch(p: Profile, fields: { status?: AccountStatus; type?: AccountType; level?: ClientLevel }) {
    setSavingId(p.id); setFlash(null);
    const r = await adminSetAccount({ userId: p.id, ...fields });
    setSavingId(null);
    if (!r.ok || !r.data) {
      setFlash({ id: p.id, kind: "err", text: t({ ar: "تعذّر الحفظ: ", en: "Save failed: " }) + (r.ok ? "no row" : r.error) });
      return;
    }
    setRows((prev) => prev.map((x) => x.id === p.id ? {
      ...x,
      account_status: fields.status ?? x.account_status,
      account_type: fields.type ?? x.account_type,
      client_level: fields.level ?? x.client_level,
    } : x));
    setFlash({ id: p.id, kind: "ok", text: t({ ar: "تم الحفظ ✓", en: "Saved ✓" }) });
  }

  return (
    <div>
      <div className="mb-8">
        <div className="eyebrow mb-4">{t({ ar: "إدارة العملاء والحسابات", en: "Account Management" })}</div>
        <h1 className="editorial text-white" style={{ fontSize: "clamp(24px,4vw,34px)", lineHeight: 1.25 }}>
          {t({ ar: "حسابات البوابة", en: "Portal Accounts" })}
        </h1>
        <p className="text-white/45" style={{ fontSize: "12.5px", marginTop: "8px" }}>
          {t({ ar: "تعديل حالة الحساب والنوع والمستوى. حسابات الإدارة محمية.", en: "Adjust account status, type, and level. Admin accounts are protected." })}
        </p>
      </div>

      {phase === "loading" && <div className="f-sans" style={{ fontSize: "12px", letterSpacing: "2px", color: "rgba(255,255,255,0.4)", textTransform: "uppercase", padding: "20px 0" }}>{t({ ar: "جارٍ التحميل...", en: "Loading..." })}</div>}
      {phase === "error" && <div className="f-sans" style={{ padding: "14px", fontSize: "13px", color: "#ff8a8e", background: "rgba(227,30,36,0.08)", border: "1px solid rgba(227,30,36,0.3)", borderRadius: "3px" }}>{err}</div>}
      {phase === "ready" && rows.length === 0 && <p className="text-white/45" style={{ fontSize: "14px" }}>{t({ ar: "لا توجد حسابات.", en: "No accounts." })}</p>}

      {phase === "ready" && rows.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {rows.map((p) => {
            const isAdmin = p.account_type === "admin";
            const protectedRow = isAdmin || PROTECTED_EMAILS.includes((p.email || "").toLowerCase());
            return (
              <div key={p.id} style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "4px", padding: "16px 18px" }}>
                <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                  <div style={{ minWidth: 0 }}>
                    <div className="text-white" style={{ fontSize: "14.5px", fontWeight: 600 }}>{p.full_name || (isAr ? "بدون اسم" : "No name")}</div>
                    <div className="f-sans" style={{ fontSize: "12px", color: "rgba(255,255,255,0.45)", direction: "ltr", textAlign: isAr ? "right" : "left" }}>{p.email}{p.company ? ` · ${p.company}` : ""}</div>
                  </div>
                  {protectedRow && (
                    <span className="f-sans" style={{ fontSize: "9px", letterSpacing: "1px", textTransform: "uppercase", color: "rgba(255,210,138,0.85)", background: "rgba(255,166,0,0.08)", border: "1px solid rgba(255,166,0,0.3)", padding: "4px 9px", borderRadius: "2px" }}>
                      {t({ ar: "محمي", en: "Protected" })}
                    </span>
                  )}
                </div>

                {protectedRow ? (
                  <div className="f-sans" style={{ fontSize: "12px", color: "rgba(255,255,255,0.5)" }}>
                    {t({ ar: "حساب إدارة — لا يمكن تعديله من البوابة.", en: "Admin account — not editable from the portal." })}
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap items-end gap-3">
                      <Ctrl label={t({ ar: "الحالة", en: "Status" })}>
                        <Select value={p.account_status} disabled={savingId === p.id} onChange={(v) => patch(p, { status: v as AccountStatus })}
                          opts={STATUS_OPTS.map((o) => ({ value: o.v, label: isAr ? o.ar : o.en }))} />
                      </Ctrl>
                      <Ctrl label={t({ ar: "النوع", en: "Type" })}>
                        <Select value={p.account_type} disabled={savingId === p.id} onChange={(v) => patch(p, { type: v as AccountType })}
                          opts={TYPE_OPTS.map((o) => ({ value: o.v, label: isAr ? o.ar : o.en }))} />
                      </Ctrl>
                      <Ctrl label={t({ ar: "المستوى", en: "Level" })}>
                        <Select value={p.client_level} disabled={savingId === p.id} onChange={(v) => patch(p, { level: v as ClientLevel })}
                          opts={LEVEL_OPTS.map((o) => ({ value: o.v, label: isAr ? o.ar : o.en }))} />
                      </Ctrl>
                      <button onClick={() => setMsgFor(p)} className="f-sans"
                        style={{ fontSize: "11px", letterSpacing: "1px", textTransform: "uppercase", color: "rgba(255,255,255,0.7)", background: "none", border: "1px solid rgba(255,255,255,0.15)", padding: "9px 14px", borderRadius: "3px", cursor: "pointer" }}>
                        {t({ ar: "رسالة", en: "Message" })}
                      </button>
                      <button onClick={() => setLinkFor((cur) => (cur === p.id ? null : p.id))} className="f-sans"
                        style={{ fontSize: "11px", letterSpacing: "1px", textTransform: "uppercase", color: linkFor === p.id ? "#fff" : "rgba(255,255,255,0.7)", background: linkFor === p.id ? "rgba(227,30,36,0.14)" : "none", border: `1px solid ${linkFor === p.id ? "rgba(227,30,36,0.5)" : "rgba(255,255,255,0.15)"}`, padding: "9px 14px", borderRadius: "3px", cursor: "pointer" }}>
                        {t({ ar: "ربط بالمشاريع", en: "Projects" })}
                      </button>
                    </div>
                    {linkFor === p.id && (
                      <AccountLinking
                        account={p}
                        projects={projects}
                        isClient={p.account_type === "client"}
                        convertBusy={savingId === p.id}
                        onConvert={() => patch(p, { type: "client" })}
                        onProjectsChanged={() => void loadProjects()}
                      />
                    )}
                  </>
                )}
                {savingId === p.id && <div className="f-sans" style={{ fontSize: "11px", color: "rgba(255,255,255,0.4)", marginTop: "8px" }}>{t({ ar: "جارٍ الحفظ...", en: "Saving..." })}</div>}
                {flash && flash.id === p.id && <div className="f-sans" style={{ fontSize: "12px", marginTop: "8px", color: flash.kind === "ok" ? "#7CFC9A" : "#ff8a8e" }}>{flash.text}</div>}
              </div>
            );
          })}
        </div>
      )}

      {msgFor && <MessageModal profile={msgFor} onClose={() => setMsgFor(null)} />}
    </div>
  );
}

function Ctrl({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="f-sans" style={{ fontSize: "9px", letterSpacing: "1px", textTransform: "uppercase", color: "rgba(255,255,255,0.4)", marginBottom: "5px" }}>{label}</div>
      {children}
    </div>
  );
}

function Select({ value, opts, onChange, disabled }: { value: string; opts: { value: string; label: string }[]; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="f-sans"
      style={{ background: "rgba(255,255,255,0.04)", color: "#fff", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "3px", padding: "8px 10px", fontSize: "12.5px", cursor: disabled ? "wait" : "pointer", colorScheme: "dark", outline: "none" }}>
      {opts.map((o) => <option key={o.value} value={o.value} style={{ background: "#0a0a0a" }}>{o.label}</option>)}
    </select>
  );
}

function MessageModal({ profile, onClose }: { profile: Profile; onClose: () => void }) {
  const { t, isAr } = useI18n();
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<"ok" | "err" | null>(null);

  async function send() {
    const text = body.trim();
    if (text.length < 1 || text.length > 4000) return;
    setSending(true);
    const r = await adminReplySupport(profile.id, text);
    setSending(false);
    setDone(r.ok ? "ok" : "err");
    if (r.ok) setBody("");
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 120, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: "440px", background: "#0c0c0c", border: "1px solid rgba(227,30,36,0.25)", borderRadius: "6px", padding: "24px" }}>
        <h3 className="text-white" style={{ fontSize: "17px", fontWeight: 700, marginBottom: "4px" }}>{t({ ar: "إرسال رسالة للعميل", en: "Send Message to Client" })}</h3>
        <p className="f-sans" style={{ fontSize: "12px", color: "rgba(255,255,255,0.45)", direction: "ltr", textAlign: isAr ? "right" : "left", marginBottom: "14px" }}>{profile.email}</p>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} maxLength={4000}
          placeholder={t({ ar: "اكتب رسالة قصيرة... ستظهر للعميل في محادثته مع إشعار.", en: "Write a short message... it appears in the client's thread with a notification." })}
          style={{ width: "100%", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "3px", padding: "12px 14px", color: "#fff", fontSize: "13.5px", fontFamily: "var(--sans)", outline: "none", resize: "vertical", lineHeight: 1.6, colorScheme: "dark" }} />
        {done === "ok" && <div className="f-sans" style={{ fontSize: "12.5px", color: "#7CFC9A", marginTop: "10px" }}>{t({ ar: "تم الإرسال ✓", en: "Sent ✓" })}</div>}
        {done === "err" && <div className="f-sans" style={{ fontSize: "12.5px", color: "#ff8a8e", marginTop: "10px" }}>{t({ ar: "تعذّر الإرسال.", en: "Send failed." })}</div>}
        <div className="flex gap-3" style={{ marginTop: "16px" }}>
          <button onClick={send} disabled={sending || !body.trim()} className="btn-red" style={{ flex: 1, justifyContent: "center", opacity: sending || !body.trim() ? 0.5 : 1, cursor: sending || !body.trim() ? "default" : "pointer" }}>
            <span>{sending ? "..." : t({ ar: "إرسال", en: "Send" })}</span>
          </button>
          <button onClick={onClose} className="btn-ghost" style={{ justifyContent: "center" }}><span>{t({ ar: "إغلاق", en: "Close" })}</span></button>
        </div>
      </div>
    </div>
  );
}
