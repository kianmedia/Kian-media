"use client";
// ════════════════════════════════════════════════════════════════════════════
// Project Core — الخطة الزمنية الموحّدة: Schedule (قائمة/جدول/خط زمني) +
// التقويم التفاعلي (شهر/أسبوع/يوم/قائمة، إنشاء بالنقر، سحب وإفلات) +
// Gantt موحّد (خطة+مهام+جلسات+اعتماديات). مصدر بيانات واحد: project_core_schedule.
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n";
import {
  pcScheduleFeed, pcScheduleUpsert, pcScheduleSetStatus, pcScheduleDelete, pcScheduleRestore, pcGetScheduleItem,
  pcScheduleDepSet, pcListScheduleDeps, pcGanttData, pcTaskUpdate, pcListStaff, pcListLocations, fmtDT, pcErr,
  SCHED_TYPE_LABELS, SCHED_STATUS_LABELS, PRIORITY_LABELS, TASK_STATUS_LABELS, SHOOT_STATUS_LABELS,
  type ScheduleItem, type ScheduleEventType, type ScheduleStatus, type GanttData, type GanttBar,
  type StaffLite, type ProjectLocation, type PcPriority,
} from "@/lib/portal/projectCore";

const card = "bg-stone-900 border border-stone-800 rounded-xl";
const inp = "bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-200 placeholder:text-stone-600 focus:outline-none focus:ring-2 focus:ring-red-500";
const btnRed = "rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium";
const btnGhost = "rounded-lg bg-stone-800 border border-stone-700 text-stone-200 text-sm disabled:opacity-50";
type Flash = (m: string) => void;
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
// تاريخ محلي YYYY-MM-DD (لا toISOString التي تزحزح اليوم لمستخدمي UTC+3).
const localDayStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const localDayOf = (s: string) => localDayStr(new Date(s));
const TYPES = Object.keys(SCHED_TYPE_LABELS) as ScheduleEventType[];
const TYPE_CLS: Record<string, string> = {
  project_phase: "bg-purple-600", milestone: "bg-amber-600", task: "bg-sky-600", shoot_session: "bg-red-600",
  meeting: "bg-indigo-600", internal_review: "bg-teal-600", client_review: "bg-cyan-600", deliverable_due: "bg-orange-600",
  final_delivery: "bg-emerald-600", equipment_preparation: "bg-lime-700", equipment_return: "bg-lime-800",
  travel: "bg-fuchsia-700", approval: "bg-rose-600", custom_event: "bg-stone-600",
};
// حالة عنصر التغذية أيًّا كان مصدره → عربي (لا English status raw).
function statusLabel(x: ScheduleItem, t: (v: { ar: string; en: string }) => string): string {
  if (x.source === "task") return t(TASK_STATUS_LABELS[x.status as keyof typeof TASK_STATUS_LABELS] ?? { ar: x.status, en: x.status });
  if (x.source === "shoot") return t(SHOOT_STATUS_LABELS[x.status] ?? { ar: x.status, en: x.status });
  return t(SCHED_STATUS_LABELS[x.status as ScheduleStatus] ?? { ar: x.status, en: x.status });
}
// طباعة منطقة محدّدة فقط (top/left/right لا inset حتى لا تُقص الصفحات المتعددة).
const PRINT_CSS = `@media print { body * { visibility: hidden !important; } #pc-sched-print, #pc-sched-print * { visibility: visible !important; } #pc-sched-print { position: absolute; top: 0; left: 0; right: 0; background: #fff !important; color: #000 !important; } #pc-sched-print .no-print { display: none !important; } }`;

// ─── محرّر عنصر الخطة (Module-scope حتى لا تفقد الحقول التركيز) ───
type EditorInit = Partial<ScheduleItem> & { start_at?: string };
export function ScheduleEditor({ projectId, init, onDone, onClose, flash }: {
  projectId: string; init: EditorInit | null; onDone: () => void; onClose: () => void; flash: Flash;
}) {
  const { t } = useI18n();
  const editing = !!init?.id && init.source === "schedule";
  const st0 = init?.start_at ? new Date(init.start_at) : new Date();
  const [f, setF] = useState(() => ({
    title: init?.title ?? "",
    event_type: (init?.event_type ?? "custom_event") as ScheduleEventType,
    date: localDayStr(st0),
    time: init?.all_day ? "" : `${String(st0.getHours()).padStart(2, "0")}:${String(st0.getMinutes()).padStart(2, "0")}`,
    end_date: init?.end_at ? localDayStr(new Date(init.end_at)) : "",
    end_time: init?.end_at && !init?.all_day ? `${String(new Date(init.end_at).getHours()).padStart(2, "0")}:${String(new Date(init.end_at).getMinutes()).padStart(2, "0")}` : "",
    all_day: init?.all_day ?? true,
    status: (init?.status ?? "planned") as ScheduleStatus,
    priority: (init?.priority ?? "normal") as PcPriority,
    progress: init?.progress ?? 0,
    assigned_to: init?.assignee_id ?? "",
    participants: (init?.participants ?? []) as string[],
    location_id: init?.location_id ?? "",
    phase: init?.phase ?? "",
    is_milestone: init?.is_milestone ?? false,
    client_visible: init?.client_visible ?? false,
    description: init?.description ?? "",
    notes: init?.notes ?? "",
  }));
  const [staff, setStaff] = useState<StaffLite[]>([]);
  const [locs, setLocs] = useState<ProjectLocation[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void pcListStaff().then((r) => { if (r.ok) setStaff(r.data); });
    void pcListLocations(projectId).then((r) => { if (r.ok) setLocs(r.data); });
  }, [projectId]);

  async function save() {
    if (busy) return;
    if (!f.title.trim()) { flash(t({ ar: "العنوان إلزامي.", en: "Title required." })); return; }
    if (!f.date) { flash(t({ ar: "تاريخ البداية إلزامي.", en: "Start date required." })); return; }
    const startIso = new Date(`${f.date}T${f.all_day || !f.time ? "00:00" : f.time}`).toISOString();
    let endIso: string | null = null;
    if (f.end_date) endIso = new Date(`${f.end_date}T${f.all_day || !f.end_time ? "23:59" : f.end_time}`).toISOString();
    if (endIso && endIso < startIso) { flash(t({ ar: "النهاية قبل البداية.", en: "End before start." })); return; }
    setBusy(true);
    const r = await pcScheduleUpsert(projectId, {
      ...(editing ? { id: init!.id, expected_updated_at: init!.updated_at } : {}),
      title: f.title.trim(), event_type: f.event_type, start_at: startIso, end_at: endIso, all_day: f.all_day,
      status: f.status, priority: f.priority, progress: Math.max(0, Math.min(100, Math.round(Number(f.progress) || 0))),
      assigned_to: f.assigned_to || null, participants: f.participants,
      location_id: f.location_id || null, phase: f.phase.trim() || null,
      is_milestone: f.is_milestone, client_visible: f.client_visible,
      description: f.description.trim() || null, notes: f.notes.trim() || null,
    });
    setBusy(false);
    if (!r.ok) { flash(pcErr(r.error)); return; }
    flash(t(editing ? { ar: "تم حفظ التعديل.", en: "Saved." } : { ar: "أُنشئ العنصر في الخطة.", en: "Created." }));
    onDone(); onClose();
  }
  const toggleP = (id: string) => setF((v) => ({ ...v, participants: v.participants.includes(id) ? v.participants.filter((x) => x !== id) : [...v.participants, id] }));

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/70 p-3 sm:p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-lg my-4 bg-stone-950 border border-stone-800 rounded-2xl p-4 space-y-3" dir="rtl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">{t(editing ? { ar: "تعديل عنصر الخطة", en: "Edit item" } : { ar: "عنصر جديد في الخطة الزمنية", en: "New schedule item" })}</h3>
          <button onClick={onClose} className="text-stone-400 text-sm">✕</button>
        </div>
        <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder={t({ ar: "العنوان…", en: "Title…" })} className={`${inp} w-full`} />
        <div className="grid grid-cols-2 gap-2 text-xs">
          <label className="space-y-1"><span className="text-stone-500">{t({ ar: "النوع", en: "Type" })}</span>
            <select value={f.event_type} onChange={(e) => setF({ ...f, event_type: e.target.value as ScheduleEventType })} className={`${inp} w-full`} style={{ colorScheme: "dark" }}>
              {TYPES.map((k) => <option key={k} value={k}>{t(SCHED_TYPE_LABELS[k])}</option>)}
            </select></label>
          <label className="space-y-1"><span className="text-stone-500">{t({ ar: "الحالة", en: "Status" })}</span>
            <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as ScheduleStatus })} className={`${inp} w-full`} style={{ colorScheme: "dark" }}>
              {(Object.keys(SCHED_STATUS_LABELS) as ScheduleStatus[]).filter((s) => s !== "cancelled").map((s) => <option key={s} value={s}>{t(SCHED_STATUS_LABELS[s])}</option>)}
            </select></label>
          <label className="space-y-1"><span className="text-stone-500">{t({ ar: "تاريخ البداية", en: "Start" })}</span>
            <input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} className={`${inp} w-full`} style={{ colorScheme: "dark" }} /></label>
          <label className="space-y-1"><span className="text-stone-500">{t({ ar: "تاريخ النهاية (اختياري)", en: "End (optional)" })}</span>
            <input type="date" value={f.end_date} onChange={(e) => setF({ ...f, end_date: e.target.value })} className={`${inp} w-full`} style={{ colorScheme: "dark" }} /></label>
          {!f.all_day && (<>
            <label className="space-y-1"><span className="text-stone-500">{t({ ar: "وقت البداية", en: "Start time" })}</span>
              <input type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} className={`${inp} w-full`} style={{ colorScheme: "dark" }} /></label>
            <label className="space-y-1"><span className="text-stone-500">{t({ ar: "وقت النهاية", en: "End time" })}</span>
              <input type="time" value={f.end_time} onChange={(e) => setF({ ...f, end_time: e.target.value })} className={`${inp} w-full`} style={{ colorScheme: "dark" }} /></label>
          </>)}
          <label className="space-y-1"><span className="text-stone-500">{t({ ar: "الأولوية", en: "Priority" })}</span>
            <select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as PcPriority })} className={`${inp} w-full`} style={{ colorScheme: "dark" }}>
              {(Object.keys(PRIORITY_LABELS) as PcPriority[]).map((p) => <option key={p} value={p}>{t(PRIORITY_LABELS[p])}</option>)}
            </select></label>
          <label className="space-y-1"><span className="text-stone-500">{t({ ar: "التقدّم %", en: "Progress %" })}</span>
            <input type="number" min={0} max={100} value={f.progress} onChange={(e) => setF({ ...f, progress: Number(e.target.value) })} className={`${inp} w-full`} dir="ltr" /></label>
          <label className="space-y-1"><span className="text-stone-500">{t({ ar: "المكلَّف", en: "Assignee" })}</span>
            <select value={f.assigned_to} onChange={(e) => setF({ ...f, assigned_to: e.target.value })} className={`${inp} w-full`} style={{ colorScheme: "dark" }}>
              <option value="">{t({ ar: "— بلا —", en: "— none —" })}</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name ?? s.id.slice(0, 6)}</option>)}
            </select></label>
          <label className="space-y-1"><span className="text-stone-500">{t({ ar: "الموقع", en: "Location" })}</span>
            <select value={f.location_id} onChange={(e) => setF({ ...f, location_id: e.target.value })} className={`${inp} w-full`} style={{ colorScheme: "dark" }}>
              <option value="">{t({ ar: "— بلا —", en: "— none —" })}</option>
              {locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select></label>
          <label className="space-y-1"><span className="text-stone-500">{t({ ar: "المرحلة (نص حر)", en: "Phase" })}</span>
            <input value={f.phase} onChange={(e) => setF({ ...f, phase: e.target.value })} className={`${inp} w-full`} placeholder={t({ ar: "مثال: ما قبل الإنتاج", en: "e.g. Pre-production" })} /></label>
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-stone-300">
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={f.all_day} onChange={(e) => setF({ ...f, all_day: e.target.checked })} />{t({ ar: "يوم كامل", en: "All day" })}</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={f.is_milestone} onChange={(e) => setF({ ...f, is_milestone: e.target.checked })} />{t({ ar: "معلَم رئيسي", en: "Milestone" })}</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={f.client_visible} onChange={(e) => setF({ ...f, client_visible: e.target.checked })} />{t({ ar: "مرئي للعميل", en: "Client-visible" })}</label>
        </div>
        {staff.length > 0 && (
          <div>
            <div className="text-[11px] text-stone-500 mb-1">{t({ ar: "المشاركون", en: "Participants" })}</div>
            <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
              {staff.map((s) => (
                <button key={s.id} onClick={() => toggleP(s.id)} className={`px-2 py-0.5 rounded-full text-[10px] border ${f.participants.includes(s.id) ? "bg-red-600 border-red-600 text-white" : "border-stone-700 text-stone-400"}`}>
                  {s.full_name ?? s.id.slice(0, 6)}{f.participants.includes(s.id) ? " ✓" : ""}
                </button>
              ))}
            </div>
          </div>
        )}
        <textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder={t({ ar: "الوصف…", en: "Description…" })} rows={2} className={`${inp} w-full`} />
        <textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder={t({ ar: "ملاحظات داخلية…", en: "Internal notes…" })} rows={2} className={`${inp} w-full`} />
        <button disabled={busy} onClick={() => void save()} className={`${btnRed} w-full py-2.5`}>{busy ? "…" : t(editing ? { ar: "حفظ التعديل", en: "Save" } : { ar: "إضافة إلى الخطة", en: "Add" })}</button>
      </div>
    </div>
  );
}

// إجراء موحّد على عنصر خطة: إكمال/إلغاء/حذف/استعادة/نسخ — يستخدمه List وCalendar.
function useSchedActions(reload: () => void, flash: Flash, t: (v: { ar: string; en: string }) => string) {
  return {
    complete: async (x: ScheduleItem) => {
      const r = await pcScheduleSetStatus(x.id, "done");
      if (!r.ok) { flash(pcErr(r.error)); return; } reload();
    },
    cancel: async (x: ScheduleItem) => {
      const rs = window.prompt(t({ ar: "سبب الإلغاء (إلزامي):", en: "Cancel reason (required):" }));
      if (rs === null) return; if (!rs.trim()) { flash(t({ ar: "السبب إلزامي.", en: "Reason required." })); return; }
      const r = await pcScheduleSetStatus(x.id, "cancelled", rs.trim());
      if (!r.ok) { flash(pcErr(r.error)); return; } reload();
    },
    del: async (x: ScheduleItem) => {
      const rs = window.prompt(t({ ar: `حذف «${x.title}» — سبب الحذف (إلزامي):`, en: "Delete reason (required):" }));
      if (rs === null) return; if (!rs.trim()) { flash(t({ ar: "السبب إلزامي.", en: "Reason required." })); return; }
      const r = await pcScheduleDelete(x.id, rs.trim());
      if (!r.ok) { flash(pcErr(r.error)); return; } flash(t({ ar: "حُذف (استعادة من عرض المحذوف).", en: "Deleted (restorable)." })); reload();
    },
    restore: async (x: ScheduleItem) => {
      const r = await pcScheduleRestore(x.id);
      if (!r.ok) { flash(pcErr(r.error)); return; } flash(t({ ar: "استُعيد العنصر.", en: "Restored." })); reload();
    },
  };
}

// ─── تبويب الخطة الزمنية ───
export function ScheduleTab({ projectId, canManage, flash, gotoTab }: { projectId: string; canManage: boolean; flash: Flash; gotoTab?: (tab: string) => void }) {
  const { t } = useI18n();
  const [items, setItems] = useState<ScheduleItem[]>([]);
  const [view, setView] = useState<"list" | "table" | "timeline">("list");
  const [q, setQ] = useState("");
  const [fType, setFType] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [showDeleted, setShowDeleted] = useState(false);
  const [editor, setEditor] = useState<EditorInit | null | false>(false);
  const [limit, setLimit] = useState(40);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [deps, setDeps] = useState<{ item_id: string; depends_on_item_id: string }[]>([]);
  const [depFor, setDepFor] = useState<ScheduleItem | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    const [r, d] = await Promise.all([pcScheduleFeed(projectId, { deleted: showDeleted }), pcListScheduleDeps(projectId)]);
    setLoading(false);
    if (!r.ok) { setErr(pcErr(r.error)); return; }
    setItems(r.data.items);
    if (d.ok) setDeps(d.data);
  }, [projectId, showDeleted]);
  useEffect(() => { void load(); }, [load]);
  const act = useSchedActions(() => void load(), flash, t);

  const filtered = useMemo(() => items.filter((x) =>
    (!q || x.title.toLowerCase().includes(q.toLowerCase())) &&
    (!fType || x.event_type === fType) &&
    (!fStatus || x.status === fStatus)
  ), [items, q, fType, fStatus]);
  const shown = filtered.slice(0, limit);
  const depTitles = useCallback((id: string) => deps.filter((d) => d.item_id === id).map((d) => items.find((x) => x.id === d.depends_on_item_id)?.title ?? "…"), [deps, items]);

  const rowActions = (x: ScheduleItem) => x.source !== "schedule" ? (
    gotoTab ? <button onClick={() => gotoTab(x.source === "task" ? "tasks" : x.source === "meeting" ? "meetings" : x.source === "shoot" ? "shoots" : "tasks")} className="text-[10px] text-sky-400 hover:text-sky-300 shrink-0">{t({ ar: "فتح في تبويبه ←", en: "Open tab" })}</button> : null
  ) : x.deleted ? (
    canManage ? <button onClick={() => void act.restore(x)} className="text-[10px] text-emerald-400 shrink-0">{t({ ar: "استعادة", en: "Restore" })}</button> : null
  ) : canManage ? (
    <div className="flex gap-1.5 shrink-0 text-[10px]">
      <button onClick={() => setEditor(x)} className="text-sky-400 hover:text-sky-300">{t({ ar: "تعديل", en: "Edit" })}</button>
      <button onClick={() => setEditor({ ...x, id: undefined, title: x.title + " (نسخة)" } as EditorInit)} className="text-stone-400 hover:text-white">{t({ ar: "نسخ", en: "Copy" })}</button>
      <button onClick={() => setDepFor(x)} className="text-stone-400 hover:text-white">{t({ ar: "اعتماديات", en: "Deps" })}</button>
      {x.status !== "done" && <button onClick={() => void act.complete(x)} className="text-emerald-400">{t({ ar: "إكمال", en: "Done" })}</button>}
      {x.status !== "cancelled" && <button onClick={() => void act.cancel(x)} className="text-amber-400">{t({ ar: "إلغاء", en: "Cancel" })}</button>}
      <button onClick={() => void act.del(x)} className="text-red-400">{t({ ar: "حذف", en: "Delete" })}</button>
    </div>
  ) : null;

  const chip = (x: ScheduleItem) => (
    <span className={`px-1.5 py-0.5 rounded text-[9px] text-white ${TYPE_CLS[x.event_type] ?? "bg-stone-600"}`}>{t(SCHED_TYPE_LABELS[x.event_type] ?? { ar: x.event_type, en: x.event_type })}</span>
  );

  return (
    <div className="space-y-3" id="pc-sched-print">
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />
      <div className="flex flex-wrap items-center gap-2 no-print">
        <div className="flex gap-1">
          {(["list", "table", "timeline"] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} className={`px-2.5 py-1 rounded-lg text-[11px] ${view === v ? "bg-red-600 text-white" : "bg-stone-800 border border-stone-700 text-stone-300"}`}>
              {t(v === "list" ? { ar: "قائمة", en: "List" } : v === "table" ? { ar: "جدول", en: "Table" } : { ar: "خط زمني", en: "Timeline" })}
            </button>
          ))}
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t({ ar: "بحث…", en: "Search…" })} className={`${inp} flex-1 min-w-[120px] py-1`} />
        <select value={fType} onChange={(e) => setFType(e.target.value)} className={`${inp} py-1 text-[11px]`} style={{ colorScheme: "dark" }}>
          <option value="">{t({ ar: "كل الأنواع", en: "All types" })}</option>
          {TYPES.map((k) => <option key={k} value={k}>{t(SCHED_TYPE_LABELS[k])}</option>)}
        </select>
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className={`${inp} py-1 text-[11px]`} style={{ colorScheme: "dark" }}>
          <option value="">{t({ ar: "كل الحالات", en: "All statuses" })}</option>
          {(Object.keys(SCHED_STATUS_LABELS) as ScheduleStatus[]).map((s) => <option key={s} value={s}>{t(SCHED_STATUS_LABELS[s])}</option>)}
        </select>
        {canManage && <label className="flex items-center gap-1 text-[11px] text-stone-400"><input type="checkbox" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} />{t({ ar: "المحذوف", en: "Deleted" })}</label>}
        <button onClick={() => window.print()} className={`${btnGhost} px-2.5 py-1 text-[11px]`}>{t({ ar: "طباعة", en: "Print" })}</button>
        {canManage && <button onClick={() => setEditor(null)} className={`${btnRed} px-3 py-1.5 text-xs`}>{t({ ar: "+ عنصر جديد", en: "+ New" })}</button>}
      </div>

      {loading && <p className="text-xs text-stone-500">{t({ ar: "جارٍ التحميل…", en: "Loading…" })}</p>}
      {err && <div className={`${card} p-3 text-xs text-red-400`}>{err}<button onClick={() => void load()} className="mr-2 text-sky-400">{t({ ar: "إعادة المحاولة", en: "Retry" })}</button></div>}
      {!loading && !err && filtered.length === 0 && <p className="text-xs text-stone-500">{t({ ar: "لا عناصر مطابقة في الخطة الزمنية.", en: "No matching items." })}</p>}

      {view === "list" && shown.map((x) => (
        <div key={`${x.source}:${x.id}`} className={`${card} p-2.5 text-xs ${x.deleted ? "opacity-60 border-red-900/40" : ""}`}>
          <div className="flex items-center gap-2 flex-wrap">
            {chip(x)}
            {x.is_milestone && <span className="text-amber-400" title={t({ ar: "معلَم", en: "Milestone" })}>◆</span>}
            <span className={`text-stone-200 flex-1 min-w-0 truncate ${x.status === "done" ? "line-through text-stone-500" : ""}`}>{x.title}</span>
            <span className="text-[10px] text-stone-500" dir="ltr">{x.all_day ? fmtDT(x.start_at).slice(0, 10) : fmtDT(x.start_at)}{x.end_at ? ` ← ${fmtDT(x.end_at).slice(0, 10)}` : ""}</span>
            <span className="text-[10px] text-stone-400">{statusLabel(x, t)}</span>
            {rowActions(x)}
          </div>
          {(x.deleted || x.cancel_reason || depTitles(x.id).length > 0) && (
            <div className="mt-1 text-[10px] text-stone-500">
              {x.deleted && <span className="text-red-400">{t({ ar: "محذوف", en: "Deleted" })}: {x.delete_reason ?? "—"} · </span>}
              {x.cancel_reason && <span className="text-amber-400">{t({ ar: "سبب الإلغاء", en: "Cancelled" })}: {x.cancel_reason} · </span>}
              {depTitles(x.id).length > 0 && <span>{t({ ar: "يعتمد على", en: "Depends on" })}: {depTitles(x.id).join("، ")}</span>}
            </div>
          )}
        </div>
      ))}

      {view === "table" && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-stone-500 text-right border-b border-stone-800">
              <th className="p-2">{t({ ar: "النوع", en: "Type" })}</th><th className="p-2">{t({ ar: "العنوان", en: "Title" })}</th>
              <th className="p-2">{t({ ar: "البداية", en: "Start" })}</th><th className="p-2">{t({ ar: "النهاية", en: "End" })}</th>
              <th className="p-2">{t({ ar: "الحالة", en: "Status" })}</th><th className="p-2">{t({ ar: "التقدّم", en: "Prog." })}</th><th className="p-2 no-print" />
            </tr></thead>
            <tbody>
              {shown.map((x) => (
                <tr key={`${x.source}:${x.id}`} className={`border-b border-stone-800/50 ${x.deleted ? "opacity-60" : ""}`}>
                  <td className="p-2">{chip(x)}</td>
                  <td className="p-2 text-stone-200">{x.is_milestone ? "◆ " : ""}{x.title}</td>
                  <td className="p-2 text-stone-400" dir="ltr">{fmtDT(x.start_at)}</td>
                  <td className="p-2 text-stone-400" dir="ltr">{x.end_at ? fmtDT(x.end_at) : "—"}</td>
                  <td className="p-2 text-stone-300">{statusLabel(x, t)}</td>
                  <td className="p-2 text-stone-400" dir="ltr">{x.progress}%</td>
                  <td className="p-2 no-print">{rowActions(x)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view === "timeline" && (
        <div className="relative pr-4 space-y-2">
          <div className="absolute right-1.5 top-0 bottom-0 w-px bg-stone-800" />
          {shown.map((x) => (
            <div key={`${x.source}:${x.id}`} className="relative">
              <span className={`absolute -right-2.5 top-2 w-3 h-3 rounded-full border-2 border-stone-950 ${TYPE_CLS[x.event_type] ?? "bg-stone-600"}`} />
              <div className={`${card} p-2.5 text-xs mr-3 ${x.deleted ? "opacity-60" : ""}`}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] text-stone-500" dir="ltr">{fmtDT(x.start_at)}</span>
                  {chip(x)}
                  <span className="text-stone-200 flex-1 truncate">{x.is_milestone ? "◆ " : ""}{x.title}</span>
                  <span className="text-[10px] text-stone-400">{statusLabel(x, t)}</span>
                  {rowActions(x)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {filtered.length > limit && (
        <button onClick={() => setLimit((v) => v + 40)} className={`${btnGhost} w-full py-2 text-xs no-print`}>
          {t({ ar: `عرض المزيد (${filtered.length - limit})`, en: `Load more (${filtered.length - limit})` })}
        </button>
      )}

      {editor !== false && <ScheduleEditor projectId={projectId} init={editor} onDone={() => void load()} onClose={() => setEditor(false)} flash={flash} />}
      {depFor && (
        <DepsModal item={depFor} all={items.filter((x) => x.source === "schedule" && !x.deleted && x.id !== depFor.id)}
          deps={deps.filter((d) => d.item_id === depFor.id).map((d) => d.depends_on_item_id)}
          onClose={() => setDepFor(null)} onChanged={() => void load()} flash={flash} />
      )}
    </div>
  );
}

function DepsModal({ item, all, deps, onClose, onChanged, flash }: {
  item: ScheduleItem; all: ScheduleItem[]; deps: string[]; onClose: () => void; onChanged: () => void; flash: Flash;
}) {
  const { t } = useI18n();
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  async function set(dep: string, on: boolean) {
    if (busy) return; setBusy(true);
    const r = await pcScheduleDepSet(item.id, dep, on);
    setBusy(false);
    if (!r.ok) { flash(pcErr(r.error)); return; }
    setPick(""); onChanged();
  }
  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/70 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-sm bg-stone-950 border border-stone-800 rounded-2xl p-4 space-y-3" dir="rtl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between"><h3 className="text-sm font-semibold text-white">{t({ ar: "اعتماديات", en: "Dependencies" })} «{item.title}»</h3><button onClick={onClose} className="text-stone-400">✕</button></div>
        <div className="space-y-1 text-xs">
          {deps.map((id) => {
            const d = all.find((x) => x.id === id);
            return <div key={id} className="flex items-center gap-2 text-stone-300"><span className="flex-1 truncate">{d?.title ?? id.slice(0, 6)}</span><button disabled={busy} onClick={() => void set(id, false)} className="text-stone-600 hover:text-red-400">✕</button></div>;
          })}
          {deps.length === 0 && <span className="text-stone-600">{t({ ar: "لا اعتماديات.", en: "None." })}</span>}
        </div>
        <div className="flex gap-1.5">
          <select value={pick} onChange={(e) => setPick(e.target.value)} className={`${inp} flex-1 py-1 text-xs`} style={{ colorScheme: "dark" }}>
            <option value="">{t({ ar: "— أضف اعتمادية —", en: "— add —" })}</option>
            {all.filter((x) => !deps.includes(x.id)).map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
          </select>
          <button disabled={busy || !pick} onClick={() => pick && void set(pick, true)} className={`${btnGhost} px-2`}>+</button>
        </div>
      </div>
    </div>
  );
}

// ─── التقويم التفاعلي الموحّد ───
export function UnifiedCalendarTab({ projectId, canManage, flash, gotoTab }: { projectId: string; canManage: boolean; flash: Flash; gotoTab?: (tab: string) => void }) {
  const { t } = useI18n();
  const [view, setView] = useState<"month" | "week" | "day" | "agenda">("month");
  const [anchor, setAnchor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); });
  const [items, setItems] = useState<ScheduleItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [fType, setFType] = useState("");
  const [editor, setEditor] = useState<EditorInit | null | false>(false);
  const [drag, setDrag] = useState<ScheduleItem | null>(null);

  const range = useMemo(() => {
    if (view === "month") { const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1); const gs = addDays(first, -first.getDay()); return { from: gs, to: addDays(gs, 42) }; }
    if (view === "week") { const s = addDays(anchor, -anchor.getDay()); return { from: s, to: addDays(s, 7) }; }
    if (view === "day") return { from: anchor, to: addDays(anchor, 1) };
    return { from: addDays(anchor, -30), to: addDays(anchor, 61) };
  }, [view, anchor]);

  const load = useCallback(async () => {
    setBusy(true);
    const r = await pcScheduleFeed(projectId, { from: range.from.toISOString(), to: range.to.toISOString(), types: fType ? [fType] : undefined });
    setBusy(false);
    if (r.ok) setItems(r.data.items); else flash(pcErr(r.error));
  }, [projectId, range.from, range.to, fType, flash]);
  useEffect(() => { void load(); }, [load]);
  const act = useSchedActions(() => void load(), flash, t);

  const byDay = useMemo(() => {
    const m = new Map<string, ScheduleItem[]>();
    for (const x of items) { const k = localDayOf(x.start_at); const a = m.get(k) ?? []; a.push(x); m.set(k, a); }
    return m;
  }, [items]);
  const todayKey = localDayStr(new Date());

  function openEvent(x: ScheduleItem) {
    if (x.source === "schedule") { if (canManage) setEditor(x); return; }
    if (x.source === "task" && canManage) {
      const nd = window.prompt(t({ ar: "الموعد الجديد للمهمة (YYYY-MM-DD):", en: "New task date:" }), localDayOf(x.start_at));
      if (!nd) return;
      void pcTaskUpdate(x.id, { due_date: nd }).then((r) => { if (!r.ok) flash(pcErr(r.error)); else void load(); });
      return;
    }
    if (gotoTab) gotoTab(x.source === "meeting" ? "meetings" : x.source === "shoot" ? "shoots" : "tasks");
  }
  function createAt(dayKey: string, hour?: number) {
    if (!canManage) return;
    const dt = new Date(`${dayKey}T${hour != null ? String(hour).padStart(2, "0") : "09"}:00`);
    setEditor({ start_at: dt.toISOString(), all_day: hour == null } as EditorInit);
  }
  async function dropOn(dayKey: string) {
    if (!drag || drag.source !== "schedule") { setDrag(null); return; }
    const old = new Date(drag.start_at);
    const nd = new Date(`${dayKey}T${String(old.getHours()).padStart(2, "0")}:${String(old.getMinutes()).padStart(2, "0")}`);
    const durMs = drag.end_at ? new Date(drag.end_at).getTime() - old.getTime() : null;
    const r = await pcScheduleUpsert(projectId, {
      id: drag.id, expected_updated_at: drag.updated_at, title: drag.title,
      start_at: nd.toISOString(), end_at: durMs != null ? new Date(nd.getTime() + durMs).toISOString() : null,
    });
    setDrag(null);
    if (!r.ok) { flash(pcErr(r.error)); return; }
    void load();
  }

  const evChip = (x: ScheduleItem, i: number) => (
    <button key={`${x.source}:${x.id}:${i}`} draggable={canManage && x.source === "schedule"}
      onDragStart={() => setDrag(x)} onDragEnd={() => setDrag(null)}
      onClick={() => openEvent(x)}
      className={`w-full text-right truncate text-[9px] text-white rounded px-1 ${TYPE_CLS[x.event_type] ?? "bg-stone-600"} ${x.status === "cancelled" ? "opacity-40 line-through" : ""} cursor-pointer`}
      title={`${x.title} · ${statusLabel(x, t)}${x.source === "schedule" && canManage ? " · اسحب لتغيير اليوم" : ""}`}>
      {x.is_milestone ? "◆ " : ""}{x.title}
    </button>
  );
  const dow = ["أحد", "إثن", "ثلا", "أرب", "خمي", "جمع", "سبت"];

  const monthGrid = () => {
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const gridStart = addDays(first, -first.getDay());
    const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
    return (
      <div>
        <div className="grid grid-cols-7 gap-1 mb-1">{dow.map((d) => <div key={d} className="text-[10px] text-stone-500 text-center">{d}</div>)}</div>
        <div className="grid grid-cols-7 gap-1">
          {days.map((d) => {
            const k = localDayStr(d); const evs = byDay.get(k) ?? []; const inMonth = d.getMonth() === anchor.getMonth();
            return (
              <div key={k} onDragOver={(e) => { if (drag) e.preventDefault(); }} onDrop={() => void dropOn(k)}
                onClick={(e) => { if (e.target === e.currentTarget && canManage) createAt(k); }}
                className={`min-h-[64px] rounded p-1 border ${k === todayKey ? "border-red-600" : "border-stone-800"} ${inMonth ? "bg-stone-900" : "bg-stone-950/40"} ${canManage ? "cursor-pointer" : ""} ${drag ? "border-dashed border-sky-600" : ""}`}
                title={canManage ? t({ ar: "اضغط لإنشاء موعد", en: "Click to create" }) : undefined}>
                <div className={`text-[10px] pointer-events-none ${inMonth ? "text-stone-400" : "text-stone-600"}`} dir="ltr">{d.getDate()}</div>
                <div className="space-y-0.5 mt-0.5">
                  {evs.slice(0, 3).map(evChip)}
                  {evs.length > 3 && <div className="text-[9px] text-stone-500">+{evs.length - 3}</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const weekGrid = () => {
    const s = addDays(anchor, -anchor.getDay());
    const days = Array.from({ length: 7 }, (_, i) => addDays(s, i));
    return (
      <div className="grid grid-cols-7 gap-1">
        {days.map((d) => {
          const k = localDayStr(d); const evs = byDay.get(k) ?? [];
          return (
            <div key={k} onDragOver={(e) => { if (drag) e.preventDefault(); }} onDrop={() => void dropOn(k)}
              onClick={(e) => { if (e.target === e.currentTarget && canManage) createAt(k); }}
              className={`min-h-[130px] rounded p-1 border ${k === todayKey ? "border-red-600" : "border-stone-800"} bg-stone-900 ${canManage ? "cursor-pointer" : ""}`}>
              <div className="text-[10px] text-stone-400 mb-1 pointer-events-none" dir="ltr">{dow[d.getDay()]} {d.getDate()}</div>
              <div className="space-y-0.5">{evs.map(evChip)}</div>
            </div>
          );
        })}
      </div>
    );
  };

  const dayView = () => {
    const k = localDayStr(anchor);
    const evs = (byDay.get(k) ?? []).sort((a, b) => a.start_at.localeCompare(b.start_at));
    const hours = Array.from({ length: 15 }, (_, i) => i + 7); // 07:00 → 21:00
    return (
      <div className="space-y-1">
        {evs.filter((x) => x.all_day).map((x, i) => (
          <div key={i} className={`${card} p-2 flex items-center gap-2 text-xs`}>
            <span className={`px-1.5 py-0.5 rounded text-[9px] text-white ${TYPE_CLS[x.event_type]}`}>{t(SCHED_TYPE_LABELS[x.event_type] ?? { ar: "", en: "" })}</span>
            <button onClick={() => openEvent(x)} className="text-stone-200 flex-1 text-right truncate">{x.title}</button>
            <span className="text-[10px] text-stone-500">{t({ ar: "يوم كامل", en: "All day" })}</span>
          </div>
        ))}
        <div className="border border-stone-800 rounded-lg overflow-hidden">
          {hours.map((h) => {
            const hourEvs = evs.filter((x) => !x.all_day && new Date(x.start_at).getHours() === h);
            return (
              <div key={h} className="flex border-b border-stone-800/50 last:border-0 min-h-[34px]">
                <div className="w-14 shrink-0 text-[10px] text-stone-500 p-1.5 border-l border-stone-800/50" dir="ltr">{String(h).padStart(2, "0")}:00</div>
                <div className="flex-1 p-1 space-y-0.5 cursor-pointer" onClick={(e) => { if (e.target === e.currentTarget) createAt(k, h); }}
                  title={canManage ? t({ ar: "اضغط لإنشاء موعد بهذه الساعة", en: "Click to create at this hour" }) : undefined}>
                  {hourEvs.map((x, i) => (
                    <button key={i} onClick={() => openEvent(x)} className={`block w-full text-right truncate text-[10px] text-white rounded px-1.5 py-0.5 ${TYPE_CLS[x.event_type]}`}>
                      {x.title} · <span dir="ltr">{new Date(x.start_at).toTimeString().slice(0, 5)}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const agenda = () => {
    const list = [...items].sort((a, b) => a.start_at.localeCompare(b.start_at));
    if (list.length === 0) return <p className="text-xs text-stone-500">{t({ ar: "لا أحداث في النطاق.", en: "No events." })}</p>;
    return <div className="space-y-1">{list.map((x, i) => (
      <div key={i} className={`${card} p-2 flex items-center gap-2 text-xs`}>
        <span className={`w-2 h-2 rounded-full shrink-0 ${TYPE_CLS[x.event_type] ?? "bg-stone-600"}`} />
        <span className="text-stone-500 w-28 shrink-0" dir="ltr">{x.all_day ? fmtDT(x.start_at).slice(0, 10) : fmtDT(x.start_at)}</span>
        <button onClick={() => openEvent(x)} className="text-stone-200 flex-1 truncate text-right">{x.is_milestone ? "◆ " : ""}{x.title}</button>
        <span className="text-[10px] text-stone-500">{statusLabel(x, t)}</span>
        {canManage && x.source === "schedule" && !x.deleted && x.status !== "cancelled" && (
          <button onClick={() => void act.cancel(x)} className="text-[10px] text-amber-400 no-print">{t({ ar: "إلغاء", en: "Cancel" })}</button>
        )}
      </div>
    ))}</div>;
  };

  const label = view === "month" ? `${anchor.getFullYear()}/${String(anchor.getMonth() + 1).padStart(2, "0")}` : view === "day" ? localDayStr(anchor) : `${localDayStr(range.from)} → ${localDayStr(addDays(range.to, -1))}`;
  const step = (n: number) => setAnchor(view === "month" ? new Date(anchor.getFullYear(), anchor.getMonth() + n, 1) : addDays(anchor, (view === "week" ? 7 : view === "day" ? 1 : 30) * n));

  return (
    <div className="space-y-3" id="pc-sched-print">
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />
      <div className="flex flex-wrap items-center justify-between gap-2 no-print">
        <div className="flex gap-1">{(["month", "week", "day", "agenda"] as const).map((v) => (
          <button key={v} onClick={() => setView(v)} className={`px-2.5 py-1 rounded-lg text-[11px] ${view === v ? "bg-red-600 text-white" : "bg-stone-800 border border-stone-700 text-stone-300"}`}>
            {t(v === "month" ? { ar: "شهر", en: "Month" } : v === "week" ? { ar: "أسبوع", en: "Week" } : v === "day" ? { ar: "يوم", en: "Day" } : { ar: "قائمة", en: "Agenda" })}
          </button>
        ))}</div>
        <div className="flex items-center gap-2 flex-wrap">
          <select value={fType} onChange={(e) => setFType(e.target.value)} className={`${inp} py-1 text-[11px]`} style={{ colorScheme: "dark" }}>
            <option value="">{t({ ar: "كل الأنواع", en: "All types" })}</option>
            {TYPES.map((k) => <option key={k} value={k}>{t(SCHED_TYPE_LABELS[k])}</option>)}
          </select>
          <button onClick={() => step(-1)} className={`${btnGhost} px-2 py-1`}>‹</button>
          <button onClick={() => { const d = new Date(); setAnchor(new Date(d.getFullYear(), d.getMonth(), d.getDate())); }} className={`${btnGhost} px-2 py-1 text-[11px]`}>{t({ ar: "اليوم", en: "Today" })}</button>
          <button onClick={() => step(1)} className={`${btnGhost} px-2 py-1`}>›</button>
          <span className="text-[11px] text-stone-400" dir="ltr">{label}</span>
          <button onClick={() => window.print()} className={`${btnGhost} px-2.5 py-1 text-[11px]`}>{t({ ar: "طباعة", en: "Print" })}</button>
          {canManage && <button onClick={() => setEditor(null)} className={`${btnRed} px-3 py-1 text-[11px]`}>{t({ ar: "+ موعد", en: "+ New" })}</button>}
        </div>
      </div>
      {busy && items.length === 0 ? <p className="text-xs text-stone-500">{t({ ar: "جارٍ التحميل…", en: "Loading…" })}</p>
        : view === "month" ? monthGrid() : view === "week" ? weekGrid() : view === "day" ? dayView() : agenda()}
      {canManage && <p className="text-[10px] text-stone-600 no-print">{t({ ar: "اضغط على يوم/ساعة فارغة للإنشاء · اسحب حدث الخطة إلى يوم آخر لنقله · اضغط الحدث للتعديل.", en: "Click empty day/hour to create · drag schedule events to move · click to edit." })}</p>}
      {editor !== false && <ScheduleEditor projectId={projectId} init={editor} onDone={() => void load()} onClose={() => setEditor(false)} flash={flash} />}
    </div>
  );
}

// ─── Gantt الموحّد ───
export function UnifiedGanttTab({ projectId, canManage, flash, gotoTab }: { projectId: string; canManage: boolean; flash: Flash; gotoTab?: (tab: string) => void }) {
  const { t } = useI18n();
  const [g, setG] = useState<GanttData | null>(null);
  const [zoom, setZoom] = useState<"day" | "week" | "month">("week");
  const [editor, setEditor] = useState<EditorInit | null | false>(false);
  const load = useCallback(async () => { const r = await pcGanttData(projectId); if (r.ok) setG(r.data); else flash(pcErr(r.error)); }, [projectId, flash]);
  useEffect(() => { void load(); }, [load]);

  const bars = useMemo(() => (g?.bars ?? []).filter((b) => b.start), [g]);
  const bounds = useMemo(() => {
    const ds: number[] = [];
    for (const b of bars) { ds.push(Date.parse(b.start)); ds.push(Date.parse(b.end || b.start)); }
    if (g?.project?.due_date) ds.push(Date.parse(g.project.due_date));
    if (ds.length === 0) return null;
    return { min: addDays(new Date(Math.min(...ds)), -1), max: addDays(new Date(Math.max(...ds)), 2) };
  }, [bars, g]);
  // المسار الحرج: أطول سلسلة اعتماديات (topological longest path).
  const critical = useMemo(() => {
    const deps = g?.deps ?? []; if (deps.length === 0) return new Set<string>();
    const dur = new Map(bars.map((b) => [b.id, Math.max(1, (Date.parse(b.end || b.start) - Date.parse(b.start)) / 86400000 + 1)]));
    const memo = new Map<string, { len: number; path: string[] }>();
    const next = (id: string) => deps.filter((d) => d.from === id).map((d) => d.to);
    const longest = (id: string, seen: Set<string>): { len: number; path: string[] } => {
      if (memo.has(id)) return memo.get(id)!;
      if (seen.has(id)) return { len: 0, path: [] };
      seen.add(id);
      let best = { len: dur.get(id) ?? 1, path: [id] };
      for (const n of next(id)) {
        const r = longest(n, seen);
        if ((dur.get(id) ?? 1) + r.len > best.len) best = { len: (dur.get(id) ?? 1) + r.len, path: [id, ...r.path] };
      }
      seen.delete(id); memo.set(id, best); return best;
    };
    let bestPath: string[] = [];
    let bestLen = 0;
    for (const b of bars) { const r = longest(b.id, new Set()); if (r.len > bestLen) { bestLen = r.len; bestPath = r.path; } }
    return new Set(bestPath.length > 1 ? bestPath : []);
  }, [g, bars]);

  const pxPerDay = zoom === "day" ? 40 : zoom === "week" ? 14 : 5;
  const totalDays = bounds ? Math.max(1, Math.round((bounds.max.getTime() - bounds.min.getTime()) / 86400000)) : 1;
  const todayOffset = bounds ? (Date.now() - bounds.min.getTime()) / 86400000 : -1;
  const today = localDayStr(new Date());
  const titleOf = (id: string) => bars.find((b) => b.id === id)?.title ?? "…";

  function openBar(b: GanttBar) {
    if (b.source === "schedule") {
      if (!canManage) return;
      // اجلب الصف كاملًا حتى لا يمسح الحفظ الحقول غير المعروضة في Gantt.
      void pcGetScheduleItem(b.raw_id).then((r) => {
        if (!r.ok) { flash(pcErr(r.error)); return; }
        if (!r.data) { flash(t({ ar: "العنصر غير موجود.", en: "Not found." })); return; }
        setEditor(r.data as EditorInit);
      });
      return;
    }
    if (b.source === "task" && canManage) {
      const s = window.prompt(t({ ar: "تاريخ البداية (YYYY-MM-DD، فارغ = دون تغيير):", en: "Start (blank=keep):" }), b.start);
      if (s === null) return;
      const d = window.prompt(t({ ar: "الموعد النهائي (YYYY-MM-DD، فارغ = دون تغيير):", en: "Due (blank=keep):" }), b.end);
      if (d === null) return;
      const patch: Record<string, unknown> = {};
      if (s.trim()) patch.start_date = s.trim();
      if (d.trim()) patch.due_date = d.trim();
      if (s.trim() && d.trim() && d.trim() < s.trim()) { flash(t({ ar: "النهاية قبل البداية.", en: "End before start." })); return; }
      if (Object.keys(patch).length === 0) return;
      void pcTaskUpdate(b.raw_id, patch).then((r) => { if (!r.ok) flash(pcErr(r.error)); else void load(); });
      return;
    }
    if (b.source === "shoot" && gotoTab) gotoTab("shoots");
  }

  if (!g) return <p className="text-xs text-stone-500">{t({ ar: "جارٍ التحميل…", en: "Loading…" })}</p>;
  if (bars.length === 0) return <p className="text-xs text-stone-500">{t({ ar: "لا عناصر بتواريخ — أضف عناصر للخطة أو تواريخ للمهام.", en: "No dated items yet." })}</p>;

  return (
    <div className="space-y-2" id="pc-sched-print">
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />
      {/* Phase 4C closure: هذا المخطّط الموحّد (مهام + عناصر الخطة + جلسات) عرضٌ توافقي قديم.
          نظام جدولة المهام الرسمي الحديث هو «المخطط الزمني» (Planner / Gantt V2) المبني على
          project_tasks. عناصر الخطة (project_schedule_items) تبقى طبقة التقويم/الأحداث المستقلة. */}
      {gotoTab && (
        <div className="no-print text-[10px] text-stone-500 border border-stone-800 rounded-lg px-3 py-1.5 flex items-center gap-2 flex-wrap">
          <span>{t({ ar: "عرض موحّد (توافقي). لجدولة المهام الرسمية استخدم:", en: "Legacy unified view. For task scheduling use:" })}</span>
          <button onClick={() => gotoTab("planning")} className="text-sky-300 hover:text-sky-200 underline">{t({ ar: "المخطط الزمني (Planner)", en: "Planner" })}</button>
        </div>
      )}
      <div className="flex items-center justify-between flex-wrap gap-2 no-print">
        <div className="flex gap-1">{(["day", "week", "month"] as const).map((z) => (
          <button key={z} onClick={() => setZoom(z)} className={`px-2 py-1 rounded text-[10px] ${zoom === z ? "bg-red-600 text-white" : "bg-stone-800 border border-stone-700 text-stone-300"}`}>
            {t(z === "day" ? { ar: "يوم", en: "Day" } : z === "week" ? { ar: "أسبوع", en: "Week" } : { ar: "شهر", en: "Month" })}
          </button>
        ))}</div>
        <button onClick={() => window.print()} className={`${btnGhost} px-2.5 py-1 text-[11px]`}>{t({ ar: "طباعة / PDF", en: "Print / PDF" })}</button>
      </div>
      <div className="overflow-x-auto">
        <div className="relative" style={{ width: totalDays * pxPerDay + 176, minWidth: "100%" }}>
          {todayOffset >= 0 && todayOffset <= totalDays && (
            <div className="absolute top-0 bottom-0 w-px bg-red-500/60 z-10" style={{ right: 176 + todayOffset * pxPerDay }} title={today} />
          )}
          {g.project?.due_date && bounds && (
            <div className="absolute top-0 bottom-0 w-px bg-amber-500/50 z-10" style={{ right: 176 + ((Date.parse(g.project.due_date) - bounds.min.getTime()) / 86400000) * pxPerDay }} title={t({ ar: "الموعد النهائي للمشروع", en: "Project due" })} />
          )}
          {bars.map((b) => {
            const st = Date.parse(b.start), en = Date.parse(b.end || b.start);
            const off = bounds ? (st - bounds.min.getTime()) / 86400000 : 0;
            const len = Math.max(1, (en - st) / 86400000 + 1);
            const late = !!b.end && b.end < today && !["done", "completed", "cancelled"].includes(b.status);
            const crit = critical.has(b.id);
            const barCls = ["done", "completed"].includes(b.status) ? "bg-emerald-600" : late ? "bg-red-600" : b.status === "blocked" ? "bg-amber-600" : TYPE_CLS[b.kind] ?? "bg-sky-600";
            const depNames = (g.deps ?? []).filter((d) => d.to === b.id).map((d) => titleOf(d.from));
            return (
              <div key={b.id} className="flex items-center h-8 border-b border-stone-800/50">
                <div className="w-44 shrink-0 pl-2 text-[11px] text-stone-300 truncate flex items-center gap-1" title={b.title}>
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${TYPE_CLS[b.kind] ?? "bg-stone-600"}`} />
                  <span className="truncate">{b.title}</span>
                  {late && <span className="text-red-400 shrink-0" title={t({ ar: "متأخر", en: "Late" })}>⚠</span>}
                  {crit && <span className="text-amber-400 shrink-0" title={t({ ar: "على المسار الحرج", en: "Critical path" })}>★</span>}
                </div>
                <div className="relative flex-1 h-full">
                  {b.milestone ? (
                    <button onClick={() => openBar(b)} className="absolute top-2 w-4 h-4 rotate-45 bg-amber-500 rounded-[3px]" style={{ right: off * pxPerDay }} title={`${b.title} · ${b.start}`} />
                  ) : (
                    <button onClick={() => openBar(b)} className={`absolute top-1.5 h-5 rounded ${barCls} ${crit ? "ring-1 ring-amber-400" : ""} cursor-pointer hover:opacity-90`}
                      style={{ right: off * pxPerDay, width: len * pxPerDay }}
                      title={`${b.start} → ${b.end || b.start}${depNames.length ? " · " + t({ ar: "يعتمد على", en: "deps" }) + ": " + depNames.join("، ") : ""}`}>
                      <div className="h-full bg-white/25 rounded-r" style={{ width: `${b.progress}%` }} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <p className="text-[10px] text-stone-600 no-print">{t({ ar: "الخط الأحمر = اليوم · الأصفر = الموعد النهائي · ⚠ متأخر · ★ المسار الحرج · ◆ معلَم · اضغط الشريط للتعديل.", en: "Red = today · amber = due · ⚠ late · ★ critical path · click a bar to edit." })}</p>
      {editor !== false && <ScheduleEditor projectId={projectId} init={editor} onDone={() => void load()} onClose={() => setEditor(false)} flash={flash} />}
    </div>
  );
}
