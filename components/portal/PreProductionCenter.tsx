"use client";
// ════════════════════════════════════════════════════════════════════════
// §4 Structured Pre-Production center. Items grouped by a fixed 28-section
// taxonomy; each item is a typed row (owner, profession, due, status, priority,
// visibility, approval) with structured detail for storyboard/shot-list and
// per-item comments. Staff manage; the client sees only client_visible items.
// ════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n";
import {
  listPreproItems, upsertPreproItem, deletePreproItem, approvePreproItem, listPreproComments, addPreproComment,
  PREPRO_SECTIONS, STORYBOARD_FIELDS, SHOTLIST_FIELDS, type PreproItem,
} from "@/lib/portal/preproduction";
import { pcListStaff, type StaffLite } from "@/lib/portal/projectCore";

const inp: React.CSSProperties = { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "3px", padding: "8px 10px", color: "#fff", fontSize: "12.5px", outline: "none", fontFamily: "var(--sans)", colorScheme: "dark", width: "100%" };
const ST = { todo: { ar: "قائمة", en: "To do" }, in_progress: { ar: "قيد التنفيذ", en: "In progress" }, blocked: { ar: "معطّل", en: "Blocked" }, done: { ar: "منجز", en: "Done" } } as const;
const PRIO = { low: { ar: "منخفضة", en: "Low" }, normal: { ar: "عادية", en: "Normal" }, high: { ar: "عالية", en: "High" }, urgent: { ar: "عاجلة", en: "Urgent" } } as const;

export default function PreProductionCenter({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const { t } = useI18n();
  const [items, setItems] = useState<PreproItem[]>([]);
  const [staff, setStaff] = useState<StaffLite[]>([]);
  const [openSection, setOpenSection] = useState<string | null>("client_brief");
  const [editing, setEditing] = useState<Partial<PreproItem> | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await listPreproItems(projectId);
    setLoading(false);
    if (r.ok) { setItems(r.data); setErr(null); } else { setErr(r.error); }
  }, [projectId]);
  useEffect(() => { void load(); if (canManage) void pcListStaff().then((r) => { if (r.ok) setStaff(r.data); }); }, [load, canManage]);

  const bySection = useMemo(() => {
    const m = new Map<string, PreproItem[]>();
    for (const it of items) { const a = m.get(it.section) ?? []; a.push(it); m.set(it.section, a); }
    return m;
  }, [items]);
  const staffName = (id: string | null | undefined) => id ? (staff.find((s) => s.id === id)?.full_name ?? "—") : null;

  return (
    <div>
      <div className="f-sans" style={{ fontSize: "11px", letterSpacing: "0.5px", textTransform: "uppercase", color: "rgba(255,255,255,0.55)", marginBottom: "10px" }}>
        {t({ ar: "مركز ما قبل الإنتاج", en: "Pre-Production Center" })}
      </div>
      {loading && <p className="text-white/45" style={{ fontSize: "13px" }}>{t({ ar: "جارٍ التحميل…", en: "Loading…" })}</p>}
      {err && !loading && (
        <p className="f-sans" style={{ fontSize: "12.5px", color: "#ff8a8e", background: "rgba(227,30,36,0.08)", border: "1px solid rgba(227,30,36,0.3)", borderRadius: "3px", padding: "10px 12px", marginBottom: "8px" }}>
          {t({ ar: "تعذّر تحميل عناصر ما قبل الإنتاج: ", en: "Couldn't load pre-production items: " })}{err}
        </p>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        {PREPRO_SECTIONS.map((sec) => {
          const list = bySection.get(sec.key) ?? [];
          if (!canManage && list.length === 0) return null; // client: hide empty sections
          const open = openSection === sec.key;
          return (
            <div key={sec.key} style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: "4px", overflow: "hidden" }}>
              <button onClick={() => setOpenSection(open ? null : sec.key)} className="f-sans" style={{ width: "100%", textAlign: "start", background: "rgba(255,255,255,0.02)", border: "none", padding: "11px 14px", color: "#fff", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "13px" }}>
                <span>{open ? "▾" : "▸"} {t(sec)} <span style={{ color: "rgba(255,255,255,0.35)" }}>({list.length})</span></span>
                {canManage && open && <span onClick={(e) => { e.stopPropagation(); setEditing({ section: sec.key, status: "todo", priority: "normal" }); }} style={{ fontSize: "11px", color: "#E31E24", border: "1px solid rgba(227,30,36,0.4)", borderRadius: "3px", padding: "4px 9px" }}>+ {t({ ar: "بند", en: "Item" })}</span>}
              </button>
              {open && (
                <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: "8px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                  {list.length === 0 && <p className="text-white/40" style={{ fontSize: "12px" }}>{t({ ar: "لا بنود.", en: "No items." })}</p>}
                  {list.map((it) => <ItemRow key={it.id} item={it} canManage={canManage} staffName={staffName} onEdit={() => setEditing(it)} onChanged={load} t={t} />)}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {editing && <ItemEditor projectId={projectId} draft={editing} staff={staff} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} t={t} />}
    </div>
  );
}

type Tf = (m: { ar: string; en: string }) => string;
function ItemRow({ item, canManage, staffName, onEdit, onChanged, t }: { item: PreproItem; canManage: boolean; staffName: (id: string | null | undefined) => string | null; onEdit: () => void; onChanged: () => void; t: Tf }) {
  const [showComments, setShowComments] = useState(false);
  async function del() {
    const r = window.prompt(t({ ar: "سبب الحذف (إلزامي):", en: "Delete reason (required):" }));
    if (!r || !r.trim()) return;
    const res = await deletePreproItem(item.id, r.trim());
    if (res.ok) onChanged();
  }
  async function approve() { const r = await approvePreproItem(item.id); if (r.ok) onChanged(); }
  const stC = item.status === "done" ? "#7CFC9A" : item.status === "blocked" ? "#ff8a8e" : item.status === "in_progress" ? "rgba(255,210,138,0.9)" : "rgba(255,255,255,0.5)";
  const detail = item.detail as Record<string, string>;
  const hasDetail = item.section === "storyboard" || item.section === "shot_list";
  const fields = item.section === "storyboard" ? STORYBOARD_FIELDS : item.section === "shot_list" ? SHOTLIST_FIELDS : [];
  return (
    <div style={{ background: "rgba(0,0,0,0.25)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "3px", padding: "10px 12px" }}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap" style={{ minWidth: 0 }}>
          <span className="text-white" style={{ fontSize: "13px", fontWeight: 600 }}>{item.title}</span>
          <span className="f-sans" style={{ fontSize: "10px", color: stC }}>● {t(ST[item.status])}</span>
          {item.priority !== "normal" && <span className="f-sans" style={{ fontSize: "9px", color: item.priority === "urgent" ? "#ff8a8e" : "rgba(255,210,138,0.9)" }}>{t(PRIO[item.priority])}</span>}
          {item.client_visible && <span className="f-sans" style={{ fontSize: "9px", color: "#7CFC9A", border: "1px solid rgba(124,252,154,0.4)", borderRadius: "2px", padding: "1px 5px" }}>{t({ ar: "مرئي للعميل", en: "Client" })}</span>}
          {item.approved_at && <span className="f-sans" style={{ fontSize: "9px", color: "#7CFC9A" }}>✓ {t({ ar: "معتمد", en: "Approved" })}</span>}
        </div>
        {canManage && (
          <div className="flex gap-2 flex-wrap" style={{ fontSize: "11px" }}>
            <button onClick={onEdit} style={btn("rgba(255,255,255,0.8)")}>{t({ ar: "تعديل", en: "Edit" })}</button>
            {item.needs_approval && !item.approved_at && <button onClick={approve} style={btn("#7CFC9A")}>{t({ ar: "اعتماد", en: "Approve" })}</button>}
            <button onClick={del} style={btn("#ff9ea1")}>{t({ ar: "حذف", en: "Delete" })}</button>
          </div>
        )}
      </div>
      <div className="f-sans" style={{ fontSize: "10px", color: "rgba(255,255,255,0.4)", marginTop: "4px" }}>
        {staffName(item.owner_id) ? `${staffName(item.owner_id)} · ` : ""}{item.profession ? `${item.profession} · ` : ""}{item.due_date ? <span dir="ltr">{item.due_date}</span> : null}
      </div>
      {item.body && <div className="text-white/75" style={{ fontSize: "12.5px", marginTop: "5px", whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{item.body}</div>}
      {hasDetail && Object.keys(detail).length > 0 && (
        <div style={{ marginTop: "6px", display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(120px,1fr))", gap: "3px 10px" }}>
          {fields.filter((f) => detail[f]).map((f) => (
            <div key={f} className="f-sans" style={{ fontSize: "11px" }}><span style={{ color: "rgba(255,255,255,0.4)" }}>{f}:</span> <span className="text-white/80">{detail[f]}</span></div>
          ))}
        </div>
      )}
      <button onClick={() => setShowComments((v) => !v)} className="f-sans" style={{ marginTop: "6px", fontSize: "10.5px", color: "rgba(255,255,255,0.55)", background: "none", border: "none", cursor: "pointer", padding: 0 }}>{showComments ? "▾" : "▸"} {t({ ar: "التعليقات", en: "Comments" })}</button>
      {showComments && <Comments itemId={item.id} t={t} />}
    </div>
  );
}
const btn = (c: string): React.CSSProperties => ({ color: c, background: "none", border: `1px solid ${c}44`, borderRadius: "3px", padding: "5px 10px", cursor: "pointer", fontSize: "11px" });

function Comments({ itemId, t }: { itemId: string; t: Tf }) {
  const [rows, setRows] = useState<{ id: string; body: string; created_at: string }[]>([]);
  const [body, setBody] = useState("");
  const load = useCallback(async () => { const r = await listPreproComments(itemId); if (r.ok) setRows(r.data); }, [itemId]);
  useEffect(() => { void load(); }, [load]);
  async function send() { if (!body.trim()) return; const r = await addPreproComment(itemId, body.trim()); if (r.ok) { setBody(""); void load(); } }
  return (
    <div style={{ marginTop: "6px", display: "flex", flexDirection: "column", gap: "5px" }}>
      {rows.map((c) => <div key={c.id} className="f-sans" style={{ fontSize: "12px", color: "rgba(255,255,255,0.8)", background: "rgba(255,255,255,0.03)", borderRadius: "3px", padding: "6px 9px" }} dir="auto">{c.body}</div>)}
      <div className="flex gap-2">
        <input value={body} onChange={(e) => setBody(e.target.value)} placeholder={t({ ar: "أضف تعليقًا…", en: "Add a comment…" })} style={{ ...inp, flex: 1 }} onKeyDown={(e) => { if (e.key === "Enter") void send(); }} />
        <button onClick={send} style={btn("rgba(255,255,255,0.85)")}>{t({ ar: "إرسال", en: "Send" })}</button>
      </div>
    </div>
  );
}

function ItemEditor({ projectId, draft, staff, onClose, onSaved, t }: { projectId: string; draft: Partial<PreproItem>; staff: StaffLite[]; onClose: () => void; onSaved: () => void; t: Tf }) {
  const isStory = draft.section === "storyboard"; const isShot = draft.section === "shot_list";
  const [f, setF] = useState({
    title: draft.title ?? "", body: draft.body ?? "", owner_id: draft.owner_id ?? "", profession: draft.profession ?? "",
    due_date: draft.due_date ?? "", status: draft.status ?? "todo", priority: draft.priority ?? "normal",
    client_visible: draft.client_visible ?? false, needs_approval: draft.needs_approval ?? false,
  });
  const [detail, setDetail] = useState<Record<string, string>>((draft.detail as Record<string, string>) ?? {});
  const [busy, setBusy] = useState(false);
  const fields = isStory ? STORYBOARD_FIELDS : isShot ? SHOTLIST_FIELDS : [];
  async function save() {
    if (busy || !f.title.trim()) return; setBusy(true);
    const r = await upsertPreproItem(projectId, {
      ...(draft.id ? { id: draft.id } : {}), section: draft.section,
      title: f.title.trim(), body: f.body.trim() || null, detail: fields.length ? detail : {},
      owner_id: f.owner_id || null, profession: f.profession.trim() || null, due_date: f.due_date || null,
      status: f.status, priority: f.priority, client_visible: f.client_visible, needs_approval: f.needs_approval,
    });
    setBusy(false);
    if (r.ok) onSaved();
  }
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 130, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "16px", overflowY: "auto" }}>
      <div onClick={(e) => e.stopPropagation()} dir="rtl" style={{ width: "100%", maxWidth: "560px", background: "#0a0a0a", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "6px", padding: "16px", display: "flex", flexDirection: "column", gap: "8px", margin: "20px 0" }}>
        <div className="flex items-center justify-between"><h3 className="text-white" style={{ fontSize: "15px", fontWeight: 700 }}>{draft.id ? t({ ar: "تعديل بند", en: "Edit item" }) : t({ ar: "بند جديد", en: "New item" })}</h3><button onClick={onClose} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.6)", cursor: "pointer" }}>✕</button></div>
        <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder={t({ ar: "العنوان *", en: "Title *" })} style={inp} />
        {!isStory && !isShot && <textarea value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} rows={4} placeholder={t({ ar: "التفاصيل…", en: "Details…" })} style={{ ...inp, resize: "vertical" }} />}
        {fields.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
            {fields.map((k) => <input key={k} value={detail[k] ?? ""} onChange={(e) => setDetail({ ...detail, [k]: e.target.value })} placeholder={k} style={inp} />)}
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
          <select value={f.owner_id} onChange={(e) => setF({ ...f, owner_id: e.target.value })} style={inp}><option value="">{t({ ar: "— المسؤول —", en: "— owner —" })}</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.full_name ?? s.id.slice(0, 6)}</option>)}</select>
          <input value={f.profession} onChange={(e) => setF({ ...f, profession: e.target.value })} placeholder={t({ ar: "المهنة المسؤولة", en: "Responsible profession" })} style={inp} />
          <input type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} style={inp} />
          <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as typeof f.status })} style={inp}>{Object.entries(ST).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}</select>
          <select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as typeof f.priority })} style={inp}>{Object.entries(PRIO).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}</select>
        </div>
        <div className="flex gap-4 flex-wrap" style={{ fontSize: "12px", color: "rgba(255,255,255,0.75)" }}>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={f.client_visible} onChange={(e) => setF({ ...f, client_visible: e.target.checked })} />{t({ ar: "مرئي للعميل", en: "Client-visible" })}</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={f.needs_approval} onChange={(e) => setF({ ...f, needs_approval: e.target.checked })} />{t({ ar: "يتطلب اعتمادًا", en: "Needs approval" })}</label>
        </div>
        <button onClick={save} disabled={busy || !f.title.trim()} className="btn-red" style={{ justifyContent: "center", opacity: busy || !f.title.trim() ? 0.5 : 1 }}><span>{busy ? "…" : t({ ar: "حفظ", en: "Save" })}</span></button>
      </div>
    </div>
  );
}
