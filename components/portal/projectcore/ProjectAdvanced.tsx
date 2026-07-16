"use client";
// ════════════════════════════════════════════════════════════════════════════
// Project Core — وحدات متقدّمة: المواقع، الوسوم، تطبيق القوالب.
// (التقويم وGantt انتقلا إلى ProjectSchedule.tsx بمصدر بيانات موحّد.)
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import {
  pcListLocations, pcLocationCreate, pcLocationArchive,
  pcListTags, pcTagCreate, pcListProjectTags, pcTagLink, pcErr,
  type ProjectLocation, type Tag,
} from "@/lib/portal/projectCore";

const card = "bg-stone-900 border border-stone-800 rounded-xl";
const inp = "bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-200 placeholder:text-stone-600 focus:outline-none focus:ring-2 focus:ring-red-500";
const btnRed = "rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium";

const btnGhost = "rounded-lg bg-stone-800 border border-stone-700 text-stone-200 text-sm disabled:opacity-50";
type Flash = (m: string) => void;

// (أُزيل CalendarTab/GanttTab القديمان — انظر ProjectSchedule.tsx.)
// ─── المواقع ───
export function LocationsTab({ projectId, canManage, flash }: { projectId: string; canManage: boolean; flash: Flash }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<ProjectLocation[]>([]);
  const [f, setF] = useState({ name: "", address: "", note: "" });
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { const r = await pcListLocations(projectId); if (r.ok) setRows(r.data); }, [projectId]);
  useEffect(() => { void load(); }, [load]);
  async function add() { if (busy || !f.name.trim()) return; setBusy(true); const r = await pcLocationCreate(projectId, { name: f.name.trim(), address: f.address.trim() || null, note: f.note.trim() || null }); setBusy(false); if (!r.ok) { flash(pcErr(r.error)); return; } setF({ name: "", address: "", note: "" }); await load(); }
  async function archive(l: ProjectLocation) { if (!window.confirm(t({ ar: "أرشفة الموقع؟", en: "Archive location?" }))) return; const r = await pcLocationArchive(l.id); if (!r.ok) { flash(pcErr(r.error)); return; } await load(); }
  return (
    <div className="space-y-3">
      {canManage && (
        <div className={`${card} p-3 space-y-2`}>
          <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={t({ ar: "اسم الموقع…", en: "Location name…" })} className={`${inp} w-full`} />
          <div className="flex flex-wrap gap-2">
            <input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} placeholder={t({ ar: "العنوان / رابط خرائط", en: "Address / map link" })} className={`${inp} flex-1 min-w-[140px]`} />
            <input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder={t({ ar: "تعليمات/تصاريح", en: "Notes/permits" })} className={`${inp} flex-1 min-w-[120px]`} />
            <button disabled={busy || !f.name.trim()} onClick={() => void add()} className={`${btnRed} px-4 py-2`}>{t({ ar: "إضافة", en: "Add" })}</button>
          </div>
        </div>
      )}
      {rows.length === 0 && <p className="text-xs text-stone-500">{t({ ar: "لا مواقع.", en: "No locations." })}</p>}
      {rows.map((l) => (
        <div key={l.id} className={`${card} p-3 text-xs flex items-center justify-between gap-2`}>
          <div className="min-w-0"><div className="text-stone-200">{l.name}</div>{l.address && <a href={l.address.startsWith("http") ? l.address : undefined} target="_blank" rel="noreferrer" className="text-[11px] text-sky-400 truncate block" dir="ltr">{l.address}</a>}{l.note && <div className="text-[11px] text-stone-500">{l.note}</div>}</div>
          {canManage && <button onClick={() => void archive(l)} className="text-stone-600 hover:text-red-400 shrink-0">{t({ ar: "أرشفة", en: "Archive" })}</button>}
        </div>
      ))}
    </div>
  );
}

// ─── الوسوم ───
export function TagsTab({ projectId, canManage, flash }: { projectId: string; canManage: boolean; flash: Flash }) {
  const { t } = useI18n();
  const [all, setAll] = useState<Tag[]>([]);
  const [linked, setLinked] = useState<Set<string>>(new Set());
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const [a, l] = await Promise.all([pcListTags(), pcListProjectTags(projectId)]);
    if (a.ok) setAll(a.data);
    if (l.ok) setLinked(new Set(l.data.map((x) => x.tag_id)));
  }, [projectId]);
  useEffect(() => { void load(); }, [load]);
  async function create() { if (busy || !name.trim()) return; setBusy(true); const r = await pcTagCreate(name.trim()); setBusy(false); if (!r.ok) { flash(pcErr(r.error)); return; } setName(""); await load(); }
  async function link(tag: Tag) { if (linked.has(tag.id)) return; const r = await pcTagLink(projectId, tag.id); if (!r.ok) { flash(pcErr(r.error)); return; } await load(); }
  return (
    <div className="space-y-3">
      {canManage && (
        <div className={`${card} p-3 flex gap-2`}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t({ ar: "وسم جديد…", en: "New tag…" })} className={`${inp} flex-1`} onKeyDown={(e) => { if (e.key === "Enter") void create(); }} />
          <button disabled={busy || !name.trim()} onClick={() => void create()} className={`${btnGhost} px-3`}>{t({ ar: "إنشاء", en: "Create" })}</button>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {all.map((tg) => <button key={tg.id} disabled={!canManage || linked.has(tg.id)} onClick={() => void link(tg)} className={`px-2.5 py-1 rounded-full text-[11px] border ${linked.has(tg.id) ? "border-red-600 text-white" : "border-stone-700 text-stone-400"}`} style={linked.has(tg.id) ? { background: tg.color } : {}}>{tg.name}{linked.has(tg.id) ? " ✓" : ""}</button>)}
        {all.length === 0 && <p className="text-xs text-stone-500">{t({ ar: "لا وسوم بعد.", en: "No tags yet." })}</p>}
      </div>
    </div>
  );
}

