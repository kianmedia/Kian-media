"use client";
// ════════════════════════════════════════════════════════════════════════════
// Project Core — وحدات متقدّمة: التقويم (شهر/أسبوع/يوم/Agenda)، مخطّط المهام (Gantt)،
// المواقع، الوسوم، تطبيق القوالب. كلها End-to-End عبر RPCs.
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n";
import {
  pcCalendarData, pcTaskGraph, pcTaskUpdate, pcListLocations, pcLocationCreate, pcLocationArchive,
  pcListTags, pcTagCreate, pcListProjectTags, pcTagLink, pcListTemplates, pcApplyTemplate, pcCreateTemplate, pcListTasks, pcErr,
  TASK_STATUS_LABELS,
  type CalendarData, type TaskGraph, type GraphTask, type ProjectLocation, type Tag, type ProjectTemplate,
} from "@/lib/portal/projectCore";

const card = "bg-stone-900 border border-stone-800 rounded-xl";
const inp = "bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-200 placeholder:text-stone-600 focus:outline-none focus:ring-2 focus:ring-red-500";
const btnRed = "rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium";
const btnGhost = "rounded-lg bg-stone-800 border border-stone-700 text-stone-200 text-sm disabled:opacity-50";
type Flash = (m: string) => void;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

// ─── التقويم ───
export function CalendarTab({ projectId, canManage, flash }: { projectId: string; canManage: boolean; flash: Flash }) {
  const { t } = useI18n();
  const [view, setView] = useState<"month" | "week" | "day" | "agenda">("month");
  const [anchor, setAnchor] = useState(() => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); });
  const [data, setData] = useState<CalendarData | null>(null);
  const [busy, setBusy] = useState(false);

  const range = useMemo(() => {
    if (view === "month") { const first = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1)); const gs = addDays(first, -first.getUTCDay()); return { from: iso(gs), to: iso(addDays(gs, 41)), s: first, e: gs }; }
    if (view === "week") { const wd = anchor.getUTCDay(); const s = addDays(anchor, -wd); return { from: iso(s), to: iso(addDays(s, 6)), s, e: addDays(s, 6) }; }
    if (view === "day") return { from: iso(anchor), to: iso(anchor), s: anchor, e: anchor };
    return { from: iso(addDays(anchor, -30)), to: iso(addDays(anchor, 60)), s: addDays(anchor, -30), e: addDays(anchor, 60) };
  }, [view, anchor]);

  const load = useCallback(async () => { setBusy(true); const r = await pcCalendarData(range.from, range.to, projectId); setBusy(false); if (r.ok) setData(r.data); else flash(pcErr(r.error)); }, [range.from, range.to, projectId, flash]);
  useEffect(() => { void load(); }, [load]);

  type Ev = { date: string; kind: string; title: string; cls: string; id?: string; taskDue?: boolean };
  const events: Ev[] = useMemo(() => {
    if (!data) return [];
    const out: Ev[] = [];
    for (const x of data.tasks) out.push({ date: x.date, kind: "task", title: x.title, cls: "bg-sky-600", id: x.id, taskDue: true });
    for (const x of data.meetings) out.push({ date: x.date, kind: "meeting", title: x.title, cls: "bg-indigo-600" });
    for (const x of data.shoots) out.push({ date: x.date, kind: "shoot", title: x.title, cls: "bg-red-600" });
    for (const x of data.milestones) out.push({ date: x.date, kind: x.kind, title: (x.kind === "delivery" ? "تسليم: " : "موعد: ") + (x.title ?? ""), cls: "bg-amber-600" });
    return out.filter((e) => e.date);
  }, [data]);

  async function editTaskDate(id: string) {
    const nd = window.prompt(t({ ar: "التاريخ الجديد للمهمة (YYYY-MM-DD):", en: "New task date (YYYY-MM-DD):" }));
    if (!nd) return;
    const r = await pcTaskUpdate(id, { due_date: nd });
    if (!r.ok) { flash(pcErr(r.error)); return; }
    await load();
  }

  const monthGrid = () => {
    const first = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
    const startPad = first.getUTCDay(); const gridStart = addDays(first, -startPad);
    const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
    const today = iso(new Date());
    const dow = ["أحد", "إثن", "ثلا", "أرب", "خمي", "جمع", "سبت"];
    return (
      <div>
        <div className="grid grid-cols-7 gap-1 mb-1">{dow.map((d) => <div key={d} className="text-[10px] text-stone-500 text-center">{d}</div>)}</div>
        <div className="grid grid-cols-7 gap-1">
          {days.map((d) => { const ds = iso(d); const evs = events.filter((e) => e.date === ds); const inMonth = d.getUTCMonth() === anchor.getUTCMonth();
            return (
              <div key={ds} className={`min-h-[64px] rounded p-1 border ${ds === today ? "border-red-600" : "border-stone-800"} ${inMonth ? "bg-stone-900" : "bg-stone-950/40"}`}>
                <div className={`text-[10px] ${inMonth ? "text-stone-400" : "text-stone-600"}`} dir="ltr">{d.getUTCDate()}</div>
                <div className="space-y-0.5 mt-0.5">
                  {evs.slice(0, 3).map((e, i) => (
                    <button key={i} onClick={() => canManage && e.taskDue && e.id ? void editTaskDate(e.id) : undefined} className={`w-full text-right truncate text-[9px] text-white rounded px-1 ${e.cls} ${canManage && e.taskDue ? "cursor-pointer" : "cursor-default"}`} title={e.title}>{e.title}</button>
                  ))}
                  {evs.length > 3 && <div className="text-[9px] text-stone-500">+{evs.length - 3}</div>}
                </div>
              </div>
            ); })}
        </div>
      </div>
    );
  };

  const agenda = () => {
    const list = [...events].sort((a, b) => a.date.localeCompare(b.date));
    if (list.length === 0) return <p className="text-xs text-stone-500">{t({ ar: "لا أحداث في النطاق.", en: "No events." })}</p>;
    return <div className="space-y-1">{list.map((e, i) => (
      <div key={i} className={`${card} p-2 flex items-center gap-2 text-xs`}>
        <span className={`w-2 h-2 rounded-full ${e.cls}`} /><span className="text-stone-500 w-24 shrink-0" dir="ltr">{e.date}</span>
        <span className="text-stone-200 flex-1 truncate">{e.title}</span>
        {canManage && e.taskDue && e.id && <button onClick={() => void editTaskDate(e.id!)} className="text-[10px] text-stone-500 hover:text-white">{t({ ar: "تعديل", en: "Edit" })}</button>}
      </div>
    ))}</div>;
  };

  const dowShort = ["أحد", "إثن", "ثلا", "أرب", "خمي", "جمع", "سبت"];
  const weekGrid = () => {
    const wd = anchor.getUTCDay(); const s = addDays(anchor, -wd);
    const days = Array.from({ length: 7 }, (_, i) => addDays(s, i)); const today = iso(new Date());
    return (
      <div className="grid grid-cols-7 gap-1">
        {days.map((d) => { const ds = iso(d); const evs = events.filter((e) => e.date === ds); return (
          <div key={ds} className={`min-h-[130px] rounded p-1 border ${ds === today ? "border-red-600" : "border-stone-800"} bg-stone-900`}>
            <div className="text-[10px] text-stone-400 mb-1" dir="ltr">{dowShort[d.getUTCDay()]} {d.getUTCDate()}</div>
            <div className="space-y-0.5">{evs.map((e, i) => <button key={i} onClick={() => canManage && e.taskDue && e.id ? void editTaskDate(e.id) : undefined} className={`w-full text-right truncate text-[9px] text-white rounded px-1 ${e.cls} ${canManage && e.taskDue ? "cursor-pointer" : "cursor-default"}`} title={e.title}>{e.title}</button>)}</div>
          </div>); })}
      </div>
    );
  };
  const dayView = () => {
    const ds = iso(anchor); const evs = events.filter((e) => e.date === ds).sort((a, b) => a.kind.localeCompare(b.kind));
    if (evs.length === 0) return <p className="text-xs text-stone-500">{t({ ar: "لا أحداث في هذا اليوم.", en: "No events on this day." })}</p>;
    return <div className="space-y-1">{evs.map((e, i) => (
      <div key={i} className={`${card} p-2.5 flex items-center gap-2 text-xs`}>
        <span className={`w-2.5 h-2.5 rounded-full ${e.cls}`} /><span className="text-stone-200 flex-1">{e.title}</span>
        <span className="text-[10px] text-stone-600">{e.kind === "task" ? t({ ar: "مهمة", en: "task" }) : e.kind === "meeting" ? t({ ar: "اجتماع", en: "meeting" }) : e.kind === "shoot" ? t({ ar: "تصوير", en: "shoot" }) : t({ ar: "معلم", en: "milestone" })}</span>
        {canManage && e.taskDue && e.id && <button onClick={() => void editTaskDate(e.id!)} className="text-[10px] text-stone-500 hover:text-white">{t({ ar: "تعديل", en: "Edit" })}</button>}
      </div>))}</div>;
  };
  const label = view === "month" ? `${anchor.getUTCFullYear()}/${anchor.getUTCMonth() + 1}` : view === "day" ? iso(anchor) : `${range.from} → ${range.to}`;
  const step = (n: number) => setAnchor(view === "month" ? new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + n, 1)) : addDays(anchor, (view === "week" ? 7 : view === "day" ? 1 : 30) * n));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1">{(["month", "week", "day", "agenda"] as const).map((v) => <button key={v} onClick={() => setView(v)} className={`px-2.5 py-1 rounded-lg text-[11px] ${view === v ? "bg-red-600 text-white" : "bg-stone-800 border border-stone-700 text-stone-300"}`}>{t(v === "month" ? { ar: "شهر", en: "Month" } : v === "week" ? { ar: "أسبوع", en: "Week" } : v === "day" ? { ar: "يوم", en: "Day" } : { ar: "قائمة", en: "Agenda" })}</button>)}</div>
        <div className="flex items-center gap-2">
          <button onClick={() => step(-1)} className={`${btnGhost} px-2 py-1`}>‹</button>
          <button onClick={() => setAnchor(() => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); })} className={`${btnGhost} px-2 py-1 text-[11px]`}>{t({ ar: "اليوم", en: "Today" })}</button>
          <button onClick={() => step(1)} className={`${btnGhost} px-2 py-1`}>›</button>
          <span className="text-[11px] text-stone-400" dir="ltr">{label}</span>
        </div>
      </div>
      {busy && !data ? <p className="text-xs text-stone-500">{t({ ar: "جارٍ التحميل…", en: "Loading…" })}</p> : view === "month" ? monthGrid() : view === "week" ? weekGrid() : view === "day" ? dayView() : agenda()}
    </div>
  );
}

// ─── مخطّط المهام (Gantt) ───
export function GanttTab({ projectId, canManage, flash }: { projectId: string; canManage: boolean; flash: Flash }) {
  const { t } = useI18n();
  const [g, setG] = useState<TaskGraph | null>(null);
  const [zoom, setZoom] = useState<"day" | "week" | "month">("week");
  const load = useCallback(async () => { const r = await pcTaskGraph(projectId); if (r.ok) setG(r.data); else flash(pcErr(r.error)); }, [projectId, flash]);
  useEffect(() => { void load(); }, [load]);

  const dated = (g?.tasks ?? []).filter((x) => x.start_date || x.due_date);
  const bounds = useMemo(() => {
    const ds: number[] = [];
    for (const x of dated) { if (x.start_date) ds.push(Date.parse(x.start_date)); if (x.due_date) ds.push(Date.parse(x.due_date)); }
    if (ds.length === 0) return null;
    const min = new Date(Math.min(...ds)), max = new Date(Math.max(...ds));
    return { min: addDays(min, -1), max: addDays(max, 1) };
  }, [dated]);
  const pxPerDay = zoom === "day" ? 40 : zoom === "week" ? 14 : 5;
  const totalDays = bounds ? Math.max(1, Math.round((bounds.max.getTime() - bounds.min.getTime()) / 86400000)) : 1;
  const todayOffset = bounds ? (Date.now() - bounds.min.getTime()) / 86400000 : -1;
  const depsOf = (id: string) => (g?.deps ?? []).filter((d) => d.task_id === id).map((d) => d.depends_on);
  const titleOf = (id: string) => g?.tasks.find((x) => x.id === id)?.title ?? id.slice(0, 6);
  const today = iso(new Date());

  async function editDates(x: GraphTask) {
    const s = window.prompt(t({ ar: "تاريخ البداية (YYYY-MM-DD، فارغ = دون تغيير):", en: "Start date (blank = keep):" }), x.start_date ?? "");
    if (s === null) return;
    const d = window.prompt(t({ ar: "الموعد النهائي (YYYY-MM-DD، فارغ = دون تغيير):", en: "Due date (blank = keep):" }), x.due_date ?? "");
    if (d === null) return;
    const st = s.trim(), du = d.trim();
    if (st && du && du < st) { flash(t({ ar: "الموعد النهائي قبل البداية.", en: "Due before start." })); return; }
    const patch: Record<string, unknown> = {};
    if (st) patch.start_date = st;
    if (du) patch.due_date = du;
    if (Object.keys(patch).length === 0) return;
    const r = await pcTaskUpdate(x.id, patch);
    if (!r.ok) { flash(pcErr(r.error)); return; }
    await load();
  }

  if (!g) return <p className="text-xs text-stone-500">{t({ ar: "جارٍ التحميل…", en: "Loading…" })}</p>;
  if (dated.length === 0) return <p className="text-xs text-stone-500">{t({ ar: "لا مهام بتواريخ. أضف تاريخ بداية/نهاية للمهام لعرض المخطّط.", en: "No dated tasks — add start/due dates." })}</p>;

  return (
    <div className="space-y-2">
      <div className="flex gap-1 justify-end">{(["day", "week", "month"] as const).map((z) => <button key={z} onClick={() => setZoom(z)} className={`px-2 py-1 rounded text-[10px] ${zoom === z ? "bg-red-600 text-white" : "bg-stone-800 border border-stone-700 text-stone-300"}`}>{t(z === "day" ? { ar: "يوم", en: "Day" } : z === "week" ? { ar: "أسبوع", en: "Week" } : { ar: "شهر", en: "Month" })}</button>)}</div>
      <div className="overflow-x-auto">
        <div className="relative" style={{ width: totalDays * pxPerDay + 160, minWidth: "100%" }}>
          {todayOffset >= 0 && todayOffset <= totalDays && <div className="absolute top-0 bottom-0 w-px bg-red-500/60 z-10" style={{ right: 160 + todayOffset * pxPerDay }} title={today} />}
          {dated.map((x) => {
            const st = x.start_date ? Date.parse(x.start_date) : Date.parse(x.due_date!);
            const en = x.due_date ? Date.parse(x.due_date) : Date.parse(x.start_date!);
            const off = bounds ? (st - bounds.min.getTime()) / 86400000 : 0;
            const len = Math.max(1, (en - st) / 86400000 + 1);
            const late = !!x.due_date && x.due_date < today && x.status !== "done" && x.status !== "cancelled";
            const barCls = x.status === "done" ? "bg-emerald-600" : late ? "bg-red-600" : x.status === "blocked" ? "bg-amber-600" : "bg-sky-600";
            const deps = depsOf(x.id);
            return (
              <div key={x.id} className="flex items-center h-8 border-b border-stone-800/50">
                <div className="w-40 shrink-0 pl-2 text-[11px] text-stone-300 truncate" title={x.title}>{x.title}{late && <span className="text-red-400"> ⚠</span>}</div>
                <div className="relative flex-1 h-full">
                  <button onClick={() => canManage ? void editDates(x) : undefined} className={`absolute top-1.5 h-5 rounded ${barCls} ${canManage ? "cursor-pointer hover:opacity-90" : ""}`} style={{ right: off * pxPerDay, width: len * pxPerDay }} title={`${x.start_date ?? "?"} → ${x.due_date ?? "?"} · ${t(TASK_STATUS_LABELS[x.status])}${deps.length ? " · يعتمد على: " + deps.map(titleOf).join(", ") : ""}`}>
                    <div className="h-full bg-white/25 rounded-r" style={{ width: `${x.progress}%` }} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <p className="text-[10px] text-stone-600">{t({ ar: "الخط الأحمر = اليوم · ⚠ متأخرة · اضغط الشريط لتعديل التواريخ · تلميح الشريط يعرض الاعتماديات.", en: "Red line = today · ⚠ late · click a bar to edit dates." })}</p>
    </div>
  );
}

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

// ─── تطبيق قالب (زر يفتح منتقيًا مع معاينة) ───
export function ApplyTemplateButton({ projectId, onApplied, flash }: { projectId: string; onApplied: () => void; flash: Flash }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [tpls, setTpls] = useState<ProjectTemplate[]>([]);
  const [sel, setSel] = useState<ProjectTemplate | null>(null);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState("");
  useEffect(() => { if (open) void pcListTemplates().then((r) => { if (r.ok) setTpls(r.data); }); }, [open]);
  const taskCount = (tpl: ProjectTemplate) => Array.isArray((tpl.spec as { tasks?: unknown[] })?.tasks) ? ((tpl.spec as { tasks: unknown[] }).tasks).length : 0;
  async function apply() { if (busy || !sel) return; setBusy(true); const r = await pcApplyTemplate(projectId, sel.id); setBusy(false); if (!r.ok) { flash(pcErr(r.error)); return; } flash(t({ ar: `طُبِّق القالب (${r.data.tasks} مهمة).`, en: `Applied (${r.data.tasks} tasks).` })); setOpen(false); setSel(null); onApplied(); }
  // «حفظ كقالب»: يلتقط مهام المشروع الحالية (المستوى الأعلى) إلى spec ليصبح القالب قابلًا للتطبيق فعليًا.
  async function createTpl() {
    if (busy || !newName.trim()) return; setBusy(true);
    const tk = await pcListTasks(projectId);
    const tasks = tk.ok ? tk.data.filter((x) => !x.parent_task_id).map((x) => ({ title: x.title, description: x.description ?? undefined, priority: x.priority, estimated_hours: x.estimated_hours ?? undefined })) : [];
    const r = await pcCreateTemplate({ name: newName.trim(), spec: { tasks } });
    setBusy(false);
    if (!r.ok) { flash(pcErr(r.error)); return; }
    flash(t({ ar: `حُفظ القالب (${tasks.length} مهمة).`, en: `Template saved (${tasks.length} tasks).` }));
    setNewName(""); void pcListTemplates().then((x) => { if (x.ok) setTpls(x.data); });
  }
  return (
    <>
      <button onClick={() => setOpen(true)} className={`${btnGhost} px-3 py-1.5 text-xs`}>{t({ ar: "تطبيق قالب", en: "Apply Template" })}</button>
      {open && (
        <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/70 p-3 sm:p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="w-full max-w-md my-4 bg-stone-950 border border-stone-800 rounded-2xl p-4 space-y-3" dir="rtl" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between"><h3 className="text-sm font-semibold text-white">{t({ ar: "تطبيق قالب على المشروع", en: "Apply Template" })}</h3><button onClick={() => setOpen(false)} className="text-stone-400 text-sm">✕</button></div>
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {tpls.map((tpl) => <button key={tpl.id} onClick={() => setSel(tpl)} className={`${card} p-2.5 w-full text-right ${sel?.id === tpl.id ? "ring-2 ring-red-500" : ""}`}><div className="text-sm text-stone-200">{tpl.name}</div><div className="text-[11px] text-stone-500">{taskCount(tpl)} {t({ ar: "مهمة", en: "tasks" })}{tpl.description ? ` · ${tpl.description}` : ""}</div></button>)}
              {tpls.length === 0 && <p className="text-xs text-stone-500">{t({ ar: "لا قوالب. أنشئ واحدًا:", en: "No templates. Create one:" })}</p>}
            </div>
            <div className="space-y-1">
              <div className="flex gap-2">
                <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t({ ar: "احفظ مهام هذا المشروع كقالب…", en: "Save this project's tasks as a template…" })} className={`${inp} flex-1`} />
                <button disabled={busy || !newName.trim()} onClick={() => void createTpl()} className={`${btnGhost} px-3`}>{t({ ar: "حفظ كقالب", en: "Save" })}</button>
              </div>
              <p className="text-[10px] text-stone-600">{t({ ar: "يلتقط مهام المشروع الحالية ليصبح قالبًا قابلًا للتطبيق.", en: "Captures current project tasks into a reusable template." })}</p>
            </div>
            {sel && <p className="text-[11px] text-amber-400">{t({ ar: `سيُنشئ ${taskCount(sel)} مهمة على المشروع.`, en: `Will create ${taskCount(sel)} tasks.` })}</p>}
            <button disabled={busy || !sel} onClick={() => void apply()} className={`${btnRed} w-full py-2.5`}>{busy ? "…" : t({ ar: "تطبيق القالب", en: "Apply" })}</button>
          </div>
        </div>
      )}
    </>
  );
}
