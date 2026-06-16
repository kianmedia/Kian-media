"use client";
// ════════════════════════════════════════════════════════════════════════
// Admin/HR Opportunities Center (مركز الفرص). owner/admin/manager/hr only
// (route-gated + RLS). List, filter (type/status/priority), search, detail panel
// with full submitted fields, status/priority update, internal notes, archive.
// All writes go through can_see_opportunities()-guarded RPCs.
// ════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { usePortal } from "@/components/portal/PortalShell";
import { adminListProfiles } from "@/lib/portal/admin";
import type { Profile } from "@/lib/portal/types";
import {
  listOpportunities, listOpportunityNotes, updateOpportunityStatus, updateOpportunityPriority,
  addOpportunityNote, archiveOpportunityRequest, assignOpportunity,
  OPPORTUNITY_TYPES, OPP_STATUS_LABELS, OPP_STATUSES, OPP_PRIORITY_LABELS, OPP_PRIORITIES,
  oppTypeLabel, oppFieldLabel,
  type OpportunityRequest, type OpportunityNote,
} from "@/lib/opportunities";

const PRIORITY_COLOR: Record<string, string> = { low: "rgba(255,255,255,0.4)", normal: "rgba(124,180,252,0.9)", high: "rgba(255,196,0,0.95)", urgent: "#ff6b6f" };

export default function AdminOpportunities() {
  const { t, isAr } = useI18n();
  const { caps } = usePortal();
  const [phase, setPhase] = useState<"loading" | "error" | "ready">("loading");
  const [rows, setRows] = useState<OpportunityRequest[]>([]);
  const [staff, setStaff] = useState<Profile[]>([]);
  const [fType, setFType] = useState(""); const [fStatus, setFStatus] = useState(""); const [fPriority, setFPriority] = useState("");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  // Assignable staff list — only account_type=admin can read all profiles (RLS).
  useEffect(() => {
    if (!caps.canWriteAdmin) return;
    let alive = true;
    (async () => {
      const r = await adminListProfiles();
      if (alive && r.ok) setStaff(r.data.filter((p) => p.account_type === "admin" || p.staff_role));
    })();
    return () => { alive = false; };
  }, [caps.canWriteAdmin]);

  async function load() {
    setPhase("loading");
    const r = await listOpportunities({ type: fType || undefined, status: fStatus || undefined, priority: fPriority || undefined, search: search || undefined });
    if (!r.ok) { setPhase("error"); return; }
    setRows(r.data); setPhase("ready");
  }
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [fType, fStatus, fPriority]);

  const selectStyle: React.CSSProperties = { background: "rgba(255,255,255,0.04)", color: "#fff", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "3px", padding: "9px 11px", fontSize: "12.5px", colorScheme: "dark", outline: "none" };
  const open = rows.find((r) => r.id === openId) || null;

  return (
    <div>
      <div className="mb-7">
        <div className="eyebrow mb-4">{t({ ar: "مركز الفرص", en: "Opportunities Center" })}</div>
        <h1 className="editorial text-white" style={{ fontSize: "clamp(24px,4vw,34px)", lineHeight: 1.25 }}>{t({ ar: "طلبات الانضمام والتعاون", en: "Join & Collaboration Requests" })}</h1>
        <p className="text-white/45" style={{ fontSize: "12.5px", marginTop: "8px" }}>{t({ ar: "إدارة طلبات التوظيف والتدريب والتعاون والمواهب والشراكات.", en: "Manage job, training, collaboration, talent, and partnership requests." })}</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        <select value={fType} onChange={(e) => setFType(e.target.value)} style={selectStyle}>
          <option value="" style={{ background: "#0a0a0a" }}>{t({ ar: "كل الأنواع", en: "All types" })}</option>
          {OPPORTUNITY_TYPES.map((o) => <option key={o.key} value={o.key} style={{ background: "#0a0a0a" }}>{isAr ? o.ar : o.en}</option>)}
        </select>
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} style={selectStyle}>
          <option value="" style={{ background: "#0a0a0a" }}>{t({ ar: "كل الحالات", en: "All statuses" })}</option>
          {OPP_STATUSES.map((s) => <option key={s} value={s} style={{ background: "#0a0a0a" }}>{isAr ? OPP_STATUS_LABELS[s].ar : OPP_STATUS_LABELS[s].en}</option>)}
        </select>
        <select value={fPriority} onChange={(e) => setFPriority(e.target.value)} style={selectStyle}>
          <option value="" style={{ background: "#0a0a0a" }}>{t({ ar: "كل الأولويات", en: "All priorities" })}</option>
          {OPP_PRIORITIES.map((p) => <option key={p} value={p} style={{ background: "#0a0a0a" }}>{isAr ? OPP_PRIORITY_LABELS[p].ar : OPP_PRIORITY_LABELS[p].en}</option>)}
        </select>
        <div className="flex items-center gap-2">
          <input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void load(); }}
            placeholder={t({ ar: "بحث بالاسم/البريد/الجوال/الرقم", en: "Search name/email/phone/number" })}
            style={{ ...selectStyle, width: "240px" }} />
          <button onClick={() => void load()} className="f-sans" style={{ fontSize: "11px", letterSpacing: "0.5px", color: "rgba(255,255,255,0.8)", background: "none", border: "1px solid rgba(255,255,255,0.18)", padding: "9px 13px", borderRadius: "3px", cursor: "pointer" }}>{t({ ar: "بحث", en: "Search" })}</button>
        </div>
      </div>

      {phase === "loading" && <p className="text-white/45" style={{ fontSize: "13.5px" }}>{t({ ar: "جارٍ التحميل...", en: "Loading..." })}</p>}
      {phase === "error" && (
        <div className="f-sans" style={{ padding: "14px 16px", fontSize: "13px", color: "#ff8a8e", background: "rgba(227,30,36,0.08)", border: "1px solid rgba(227,30,36,0.3)", borderRadius: "3px", lineHeight: 1.7 }}>
          {t({ ar: "تعذّر تحميل الطلبات. إذا لم يتم تفعيل مركز الفرص بعد، فشغّل docs/opportunities_center_RUNME.sql في Supabase.", en: "Couldn't load requests. If the Opportunities Center isn't enabled yet, run docs/opportunities_center_RUNME.sql in Supabase." })}
        </div>
      )}
      {phase === "ready" && rows.length === 0 && <p className="text-white/45" style={{ fontSize: "13.5px" }}>{t({ ar: "لا توجد طلبات مطابقة.", en: "No matching requests." })}</p>}

      {phase === "ready" && rows.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {rows.map((r) => {
            const st = OPP_STATUS_LABELS[r.status] ?? { ar: r.status, en: r.status };
            return (
              <button key={r.id} onClick={() => setOpenId(r.id)} className="text-start" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "4px", padding: "14px 16px", cursor: "pointer" }}>
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div style={{ minWidth: 0 }}>
                    <div className="text-white" style={{ fontSize: "14.5px", fontWeight: 600 }}>{r.full_name}
                      <span className="f-sans" style={{ fontSize: "10px", letterSpacing: "0.5px", textTransform: "uppercase", color: "rgba(255,255,255,0.45)", marginInlineStart: "10px" }}>{isAr ? oppTypeLabel(r.opportunity_type).ar : oppTypeLabel(r.opportunity_type).en}</span>
                    </div>
                    <div className="f-sans" style={{ fontSize: "11.5px", color: "rgba(255,255,255,0.45)", marginTop: "3px", direction: "ltr", unicodeBidi: "plaintext", textAlign: isAr ? "right" : "left" }}>
                      {[r.email, r.phone, r.city].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="f-sans" style={{ fontSize: "9px", letterSpacing: "0.5px", textTransform: "uppercase", color: PRIORITY_COLOR[r.priority] }}>{isAr ? OPP_PRIORITY_LABELS[r.priority]?.ar : OPP_PRIORITY_LABELS[r.priority]?.en}</span>
                    <span className="f-sans" style={{ fontSize: "10px", letterSpacing: "0.5px", textTransform: "uppercase", color: "#E31E24", background: "rgba(227,30,36,0.1)", border: "1px solid rgba(227,30,36,0.3)", padding: "5px 10px", borderRadius: "2px" }}>{isAr ? st.ar : st.en}</span>
                    {r.request_number && <span className="f-sans" style={{ fontSize: "10px", color: "rgba(255,255,255,0.4)", direction: "ltr" }}>{r.request_number}</span>}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {open && <DetailModal req={open} staff={staff} canAssign={caps.canWriteAdmin} onClose={() => setOpenId(null)} onChanged={load} />}
    </div>
  );
}

function DetailModal({ req, staff, canAssign, onClose, onChanged }: { req: OpportunityRequest; staff: Profile[]; canAssign: boolean; onClose: () => void; onChanged: () => void }) {
  const { t, isAr } = useI18n();
  const [status, setStatus] = useState(req.status);
  const [priority, setPriority] = useState(req.priority);
  const [assignee, setAssignee] = useState(req.assigned_to ?? "");
  const [notes, setNotes] = useState<OpportunityNote[]>([]);
  const [noteBody, setNoteBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function loadNotes() { const r = await listOpportunityNotes(req.id); if (r.ok) setNotes(r.data); }
  useEffect(() => { void loadNotes(); /* eslint-disable-next-line */ }, [req.id]);

  async function saveStatus(s: string) {
    setStatus(s); setBusy(true); setFlash(null);
    const r = await updateOpportunityStatus(req.id, s);
    setBusy(false);
    if (!r.ok || !r.data) { setFlash({ kind: "err", text: t({ ar: "تعذّر تحديث الحالة", en: "Status update failed" }) }); return; }
    setFlash({ kind: "ok", text: t({ ar: "تم تحديث الحالة ✓", en: "Status updated ✓" }) }); onChanged();
  }
  async function savePriority(p: string) {
    setPriority(p); setBusy(true); setFlash(null);
    const r = await updateOpportunityPriority(req.id, p);
    setBusy(false);
    if (!r.ok || !r.data) { setFlash({ kind: "err", text: t({ ar: "تعذّر تحديث الأولوية", en: "Priority update failed" }) }); return; }
    setFlash({ kind: "ok", text: t({ ar: "تم تحديث الأولوية ✓", en: "Priority updated ✓" }) }); onChanged();
  }
  async function saveAssignee(uid: string) {
    setAssignee(uid); setBusy(true); setFlash(null);
    const r = await assignOpportunity(req.id, uid || null);
    setBusy(false);
    if (!r.ok || !r.data) { setFlash({ kind: "err", text: t({ ar: "تعذّر التكليف", en: "Assign failed" }) }); return; }
    setFlash({ kind: "ok", text: t({ ar: "تم التكليف ✓", en: "Assigned ✓" }) }); onChanged();
  }
  async function addNote() {
    if (!noteBody.trim()) return;
    setBusy(true); setFlash(null);
    const r = await addOpportunityNote(req.id, noteBody.trim());
    setBusy(false);
    if (!r.ok) { setFlash({ kind: "err", text: t({ ar: "تعذّر إضافة الملاحظة", en: "Add note failed" }) }); return; }
    setNoteBody(""); setFlash({ kind: "ok", text: t({ ar: "تمت الإضافة ✓", en: "Note added ✓" }) }); void loadNotes();
  }
  async function archive() {
    setBusy(true); setFlash(null);
    const r = await archiveOpportunityRequest(req.id);
    setBusy(false);
    if (!r.ok || !r.data) { setFlash({ kind: "err", text: t({ ar: "تعذّر الأرشفة", en: "Archive failed" }) }); return; }
    onChanged(); onClose();
  }

  const sel: React.CSSProperties = { background: "rgba(255,255,255,0.04)", color: "#fff", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "3px", padding: "9px 11px", fontSize: "12.5px", colorScheme: "dark", outline: "none" };
  const details = Object.entries(req.details || {});

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 130, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "24px", overflowY: "auto" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: "640px", background: "#0c0c0c", border: "1px solid rgba(227,30,36,0.25)", borderRadius: "6px", padding: "24px", margin: "auto" }}>
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h3 className="text-white" style={{ fontSize: "19px", fontWeight: 700 }}>{req.full_name}</h3>
            <div className="f-sans" style={{ fontSize: "11.5px", color: "rgba(255,255,255,0.5)", marginTop: "3px" }}>
              {isAr ? oppTypeLabel(req.opportunity_type).ar : oppTypeLabel(req.opportunity_type).en}
              {req.request_number && <span style={{ direction: "ltr", marginInlineStart: "8px" }}>· {req.request_number}</span>}
              <span style={{ direction: "ltr", marginInlineStart: "8px" }}>· {new Date(req.created_at).toLocaleDateString(isAr ? "ar-SA" : "en-GB")}</span>
            </div>
          </div>
          <button onClick={onClose} className="f-sans" style={{ background: "none", border: "none", color: "rgba(255,255,255,0.7)", fontSize: "12px", letterSpacing: "2px", cursor: "pointer" }}>✕</button>
        </div>

        {/* Contact */}
        <div className="f-sans" style={{ fontSize: "12.5px", color: "rgba(255,255,255,0.75)", lineHeight: 1.9, direction: "ltr", unicodeBidi: "plaintext", textAlign: isAr ? "right" : "left", marginBottom: "14px" }}>
          {req.email && <div>✉︎ {req.email}</div>}
          {req.phone && <div>☎︎ {req.phone}</div>}
          {req.city && <div>◍ {req.city}</div>}
        </div>

        {req.message && (
          <div style={{ marginBottom: "14px" }}>
            <div className="f-sans" style={{ fontSize: "9.5px", letterSpacing: "1px", textTransform: "uppercase", color: "rgba(255,255,255,0.4)", marginBottom: "4px" }}>{t({ ar: "نبذة", en: "Summary" })}</div>
            <p className="text-white/85" style={{ fontSize: "13.5px", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{req.message}</p>
          </div>
        )}

        {/* All submitted type-specific fields */}
        {details.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "16px" }}>
            {details.map(([k, v]) => (
              <div key={k} style={{ background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "3px", padding: "9px 11px" }}>
                <div className="f-sans" style={{ fontSize: "9.5px", letterSpacing: "0.5px", textTransform: "uppercase", color: "rgba(255,255,255,0.4)", marginBottom: "3px" }}>{isAr ? oppFieldLabel(req.opportunity_type, k).ar : oppFieldLabel(req.opportunity_type, k).en}</div>
                <div className="text-white/85" style={{ fontSize: "13px", lineHeight: 1.6, wordBreak: "break-word", whiteSpace: "pre-wrap" }}>{String(v)}</div>
              </div>
            ))}
          </div>
        )}

        {/* Status + priority */}
        <div className="flex flex-wrap items-end gap-3" style={{ marginBottom: "16px" }}>
          <div>
            <div className="f-sans" style={{ fontSize: "9px", letterSpacing: "1px", textTransform: "uppercase", color: "rgba(255,255,255,0.4)", marginBottom: "5px" }}>{t({ ar: "الحالة", en: "Status" })}</div>
            <select value={status} disabled={busy} onChange={(e) => void saveStatus(e.target.value)} style={{ ...sel, border: "1px solid rgba(227,30,36,0.4)" }}>
              {OPP_STATUSES.map((s) => <option key={s} value={s} style={{ background: "#0a0a0a" }}>{isAr ? OPP_STATUS_LABELS[s].ar : OPP_STATUS_LABELS[s].en}</option>)}
            </select>
          </div>
          <div>
            <div className="f-sans" style={{ fontSize: "9px", letterSpacing: "1px", textTransform: "uppercase", color: "rgba(255,255,255,0.4)", marginBottom: "5px" }}>{t({ ar: "الأولوية", en: "Priority" })}</div>
            <select value={priority} disabled={busy} onChange={(e) => void savePriority(e.target.value)} style={sel}>
              {OPP_PRIORITIES.map((p) => <option key={p} value={p} style={{ background: "#0a0a0a" }}>{isAr ? OPP_PRIORITY_LABELS[p].ar : OPP_PRIORITY_LABELS[p].en}</option>)}
            </select>
          </div>
          {canAssign && (
            <div>
              <div className="f-sans" style={{ fontSize: "9px", letterSpacing: "1px", textTransform: "uppercase", color: "rgba(255,255,255,0.4)", marginBottom: "5px" }}>{t({ ar: "التكليف إلى", en: "Assigned to" })}</div>
              <select value={assignee} disabled={busy} onChange={(e) => void saveAssignee(e.target.value)} style={sel}>
                <option value="" style={{ background: "#0a0a0a" }}>{t({ ar: "غير مكلّف", en: "Unassigned" })}</option>
                {staff.map((s) => <option key={s.id} value={s.id} style={{ background: "#0a0a0a" }}>{s.full_name || s.email}</option>)}
              </select>
            </div>
          )}
          <button onClick={() => void archive()} disabled={busy} className="f-sans" style={{ fontSize: "10.5px", color: "#ff8a8e", background: "none", border: "1px solid rgba(227,30,36,0.35)", padding: "9px 13px", borderRadius: "3px", cursor: busy ? "wait" : "pointer" }}>{t({ ar: "أرشفة", en: "Archive" })}</button>
        </div>

        {/* Internal notes */}
        <div className="f-sans" style={{ fontSize: "9.5px", letterSpacing: "1px", textTransform: "uppercase", color: "rgba(255,255,255,0.4)", marginBottom: "8px" }}>{t({ ar: "ملاحظات داخلية", en: "Internal Notes" })}</div>
        {notes.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "10px" }}>
            {notes.map((n) => (
              <div key={n.id} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "3px", padding: "8px 10px" }}>
                <p className="text-white/85" style={{ fontSize: "12.5px", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{n.body}</p>
                <span className="f-sans" style={{ fontSize: "9.5px", color: "rgba(255,255,255,0.35)", direction: "ltr" }}>{new Date(n.created_at).toLocaleDateString(isAr ? "ar-SA" : "en-GB")}</span>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2 items-end">
          <textarea value={noteBody} onChange={(e) => setNoteBody(e.target.value)} rows={2} maxLength={4000}
            placeholder={t({ ar: "أضف ملاحظة داخلية...", en: "Add an internal note..." })}
            style={{ flex: 1, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "3px", padding: "9px 11px", color: "#fff", fontSize: "12.5px", fontFamily: "var(--sans)", outline: "none", resize: "vertical", lineHeight: 1.6, colorScheme: "dark" }} />
          <button onClick={() => void addNote()} disabled={busy || !noteBody.trim()} className="btn-red" style={{ justifyContent: "center", opacity: busy || !noteBody.trim() ? 0.5 : 1 }}><span>{t({ ar: "إضافة", en: "Add" })}</span></button>
        </div>
        {flash && <div className="f-sans" style={{ fontSize: "12px", marginTop: "10px", color: flash.kind === "ok" ? "#7CFC9A" : "#ff8a8e" }}>{flash.text}</div>}
      </div>
    </div>
  );
}
