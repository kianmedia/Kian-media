"use client";
// ════════════════════════════════════════════════════════════════════════════
// Project Core — تبويب «المهام» (Batch 3A). يطوّر نظام المهام القائم (project_tasks)
// دون نظام موازٍ: قائمة + إنشاء + تعديل كامل + Drawer تفاصيل + حالة/أولوية/مواعيد +
// مسؤول ومشاركون (project_task_assignees) + مهام فرعية (parent_task_id) + Soft-Delete +
// فلاتر (حالة/أولوية/مسؤول/متأخرة/مهامي) + بحث + «إنجاز المهام» (project_task_progress).
// التأخير مشتقّ وقت القراءة. Kanban الكامل يأتي في Batch 3B.
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { currentUserId } from "@/lib/portal/client";
import {
  pcListTasks, pcTaskCreate, pcTaskUpdate, pcEntityDelete, pcTaskAssign, pcProjectTaskAssignees,
  projectTaskProgress, pcListStaff, pcListChecklist, pcChecklistAdd, pcChecklistToggle,
  pcTaskComment, pcListTaskComments, pcErr,
  PRIORITY_LABELS, TASK_STATUS_LABELS, TASK_STATUSES, TASK_ASSIGNMENT_ROLE_LABELS,
  type PcTask, type PcTaskStatus, type PcPriority, type StaffLite, type TaskAssignee,
  type TaskAssignmentRole, type ProjectTaskProgress, type TaskChecklistItem, type TaskComment,
} from "@/lib/portal/projectCore";

const card = "bg-stone-900 border border-stone-800 rounded-xl";
const inp = "bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-200 placeholder:text-stone-600 focus:outline-none focus:ring-2 focus:ring-red-500";
const btnRed = "rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium";
const btnGhost = "rounded-lg bg-stone-800 border border-stone-700 text-stone-200 text-sm disabled:opacity-50";
const PRIORITIES: PcPriority[] = ["low", "normal", "high", "urgent"];
const PRIO_DOT: Record<PcPriority, string> = { low: "bg-stone-500", normal: "bg-sky-500", high: "bg-amber-500", urgent: "bg-red-500" };
const ROLES: TaskAssignmentRole[] = ["owner", "contributor", "reviewer", "watcher"];
const todayISO = () => new Date().toISOString().slice(0, 10);
const isOverdue = (t: PcTask) => !!t.due_date && t.due_date < todayISO() && t.status !== "done" && t.status !== "cancelled";
const statusLabel = (s: string) => TASK_STATUS_LABELS[s as PcTaskStatus] ?? { ar: s, en: s };

export default function ProjectTasks({ projectId, canManage, flash }: { projectId: string; canManage: boolean; flash: (m: string) => void }) {
  const { t } = useI18n();
  const me = currentUserId();
  const [tasks, setTasks] = useState<PcTask[]>([]);
  const [assignees, setAssignees] = useState<TaskAssignee[]>([]);
  const [staff, setStaff] = useState<StaffLite[]>([]);
  const [prog, setProg] = useState<ProjectTaskProgress | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  // إنشاء
  const [nTitle, setNTitle] = useState(""); const [nPrio, setNPrio] = useState<PcPriority>("normal");
  const [nStart, setNStart] = useState(""); const [nDue, setNDue] = useState(""); const [nAssignee, setNAssignee] = useState("");
  const [busy, setBusy] = useState(false);
  // فلاتر
  const [q, setQ] = useState(""); const [fStatus, setFStatus] = useState<string>(""); const [fPrio, setFPrio] = useState<string>("");
  const [fAssignee, setFAssignee] = useState<string>(""); const [fOverdue, setFOverdue] = useState(false); const [fMine, setFMine] = useState(false);

  const load = useCallback(async () => {
    const [tk, as, pg] = await Promise.all([pcListTasks(projectId), pcProjectTaskAssignees(projectId), projectTaskProgress(projectId)]);
    if (tk.ok) setTasks(tk.data);
    if (as.ok) setAssignees(as.data);
    if (pg.ok) setProg(pg.data);
  }, [projectId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void pcListStaff().then((r) => { if (r.ok) setStaff(r.data); }); }, []);

  const nameOf = useCallback((uid: string | null | undefined) => {
    if (!uid) return null;
    return assignees.find((a) => a.user_id === uid)?.name ?? staff.find((s) => s.id === uid)?.full_name ?? uid.slice(0, 8);
  }, [assignees, staff]);
  const assigneesOf = useCallback((taskId: string) => assignees.filter((a) => a.task_id === taskId), [assignees]);

  async function add() {
    if (busy || !nTitle.trim()) return; setBusy(true);
    const r = await pcTaskCreate(projectId, {
      title: nTitle.trim(), priority: nPrio,
      start_date: nStart || undefined, due_date: nDue || undefined, assignee_id: nAssignee || undefined,
    });
    setBusy(false);
    if (!r.ok) { flash(pcErr(r.error)); return; }
    setNTitle(""); setNStart(""); setNDue(""); setNAssignee(""); setNPrio("normal"); await load();
  }
  async function del(task: PcTask) {
    const rs = window.prompt(t({ ar: `حذف «${task.title}» ومهامها الفرعية — سبب الحذف (إلزامي):`, en: "Delete reason (required):" }));
    if (rs === null) return;
    if (!rs.trim()) { flash(t({ ar: "السبب إلزامي.", en: "Reason required." })); return; }
    const r = await pcEntityDelete("task", task.id, rs.trim());
    if (!r.ok) { flash(pcErr(r.error)); return; }
    flash(t({ ar: "حُذفت المهمة (قابلة للاستعادة من «المحذوفات»).", en: "Deleted (restorable from Trash)." }));
    if (open === task.id) setOpen(null);
    await load();
  }

  // فلترة + إظهار الأسلاف حتى لا تختفي المهمة الفرعية المطابقة تحت أب غير مطابق.
  const idsToShow = useMemo(() => {
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const matches = (t: PcTask) => {
      if (q.trim() && !t.title.toLowerCase().includes(q.trim().toLowerCase())) return false;
      if (fStatus && t.status !== fStatus) return false;
      if (fPrio && t.priority !== fPrio) return false;
      if (fOverdue && !isOverdue(t)) return false;
      if (fMine && !(t.assignee_id === me || assigneesOf(t.id).some((a) => a.user_id === me))) return false;
      if (fAssignee && !(t.assignee_id === fAssignee || assigneesOf(t.id).some((a) => a.user_id === fAssignee))) return false;
      return true;
    };
    const show = new Set<string>();
    for (const t of tasks) {
      if (!matches(t)) continue;
      show.add(t.id);
      let p = t.parent_task_id; let guard = 0;
      while (p && byId.has(p) && guard++ < 20) { show.add(p); p = byId.get(p)!.parent_task_id; }
    }
    return show;
  }, [tasks, q, fStatus, fPrio, fOverdue, fMine, fAssignee, me, assigneesOf]);

  const childrenOf = useMemo(() => {
    const m = new Map<string | null, PcTask[]>();
    for (const t of tasks) {
      if (!idsToShow.has(t.id)) continue;
      const key = t.parent_task_id && idsToShow.has(t.parent_task_id) ? t.parent_task_id : null;
      (m.get(key) ?? m.set(key, []).get(key)!).push(t);
    }
    return m;
  }, [tasks, idsToShow]);

  const roots = childrenOf.get(null) ?? [];
  const openTask = tasks.find((x) => x.id === open) ?? null;
  const anyFilter = q || fStatus || fPrio || fAssignee || fOverdue || fMine;

  return (
    <div className="space-y-3">
      {/* إنجاز المهام (مستقل عن نسبة المشروع) */}
      {prog && (
        <div className={`${card} p-3`}>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] uppercase tracking-wide text-stone-500">{t({ ar: "إنجاز المهام", en: "Task progress" })}</span>
            <span className="text-xs text-stone-300" dir="ltr">{prog.pct}% · {prog.done}/{prog.total}{prog.overdue > 0 && <span className="text-red-400"> · {prog.overdue} {t({ ar: "متأخرة", en: "overdue" })}</span>}</span>
          </div>
          <div className="h-1.5 bg-stone-800 rounded overflow-hidden"><div className="h-full bg-emerald-600" style={{ width: `${prog.pct}%` }} /></div>
        </div>
      )}

      {/* إنشاء مهمة */}
      {canManage && (
        <div className={`${card} p-3 flex flex-wrap gap-2 items-end`}>
          <input value={nTitle} onChange={(e) => setNTitle(e.target.value)} placeholder={t({ ar: "مهمة جديدة…", en: "New task…" })} className={`${inp} flex-1 min-w-[150px]`} onKeyDown={(e) => { if (e.key === "Enter") void add(); }} />
          <select value={nPrio} onChange={(e) => setNPrio(e.target.value as PcPriority)} className={inp} style={{ colorScheme: "dark" }} title={t({ ar: "الأولوية", en: "Priority" })}>
            {PRIORITIES.map((p) => <option key={p} value={p}>{t(PRIORITY_LABELS[p])}</option>)}
          </select>
          <select value={nAssignee} onChange={(e) => setNAssignee(e.target.value)} className={inp} style={{ colorScheme: "dark" }} title={t({ ar: "المسؤول", en: "Owner" })}>
            <option value="">{t({ ar: "— المسؤول —", en: "— owner —" })}</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name || s.id.slice(0, 8)}</option>)}
          </select>
          <input type="date" value={nStart} onChange={(e) => setNStart(e.target.value)} className={inp} style={{ colorScheme: "dark" }} title={t({ ar: "البداية", en: "Start" })} />
          <input type="date" value={nDue} onChange={(e) => setNDue(e.target.value)} className={inp} style={{ colorScheme: "dark" }} title={t({ ar: "الاستحقاق", en: "Due" })} />
          <button disabled={busy || !nTitle.trim()} onClick={() => void add()} className={`${btnRed} px-4 py-2`}>{t({ ar: "إضافة", en: "Add" })}</button>
        </div>
      )}

      {/* فلاتر + بحث */}
      <div className="flex flex-wrap gap-2 items-center">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t({ ar: "بحث باسم المهمة…", en: "Search tasks…" })} className={`${inp} flex-1 min-w-[140px] py-1.5`} />
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className={`${inp} py-1.5`} style={{ colorScheme: "dark" }}>
          <option value="">{t({ ar: "كل الحالات", en: "All statuses" })}</option>
          {TASK_STATUSES.map((s) => <option key={s} value={s}>{t(statusLabel(s))}</option>)}
        </select>
        <select value={fPrio} onChange={(e) => setFPrio(e.target.value)} className={`${inp} py-1.5`} style={{ colorScheme: "dark" }}>
          <option value="">{t({ ar: "كل الأولويات", en: "All priorities" })}</option>
          {PRIORITIES.map((p) => <option key={p} value={p}>{t(PRIORITY_LABELS[p])}</option>)}
        </select>
        <select value={fAssignee} onChange={(e) => setFAssignee(e.target.value)} className={`${inp} py-1.5`} style={{ colorScheme: "dark" }}>
          <option value="">{t({ ar: "كل المسؤولين", en: "All assignees" })}</option>
          {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name || s.id.slice(0, 8)}</option>)}
        </select>
        <button onClick={() => setFOverdue((v) => !v)} className={`${fOverdue ? "bg-red-900/40 border-red-800 text-red-300" : btnGhost} rounded-lg border px-3 py-1.5 text-xs`}>{t({ ar: "المتأخرة", en: "Overdue" })}</button>
        <button onClick={() => setFMine((v) => !v)} className={`${fMine ? "bg-sky-900/40 border-sky-800 text-sky-300" : btnGhost} rounded-lg border px-3 py-1.5 text-xs`}>{t({ ar: "مهامي", en: "Mine" })}</button>
        {anyFilter && <button onClick={() => { setQ(""); setFStatus(""); setFPrio(""); setFAssignee(""); setFOverdue(false); setFMine(false); }} className="text-xs text-stone-400 hover:text-white">✕ {t({ ar: "مسح", en: "Clear" })}</button>}
      </div>

      {/* القائمة (هرمية: المهام الفرعية متداخلة) */}
      {tasks.length === 0 && <p className="text-xs text-stone-500">{t({ ar: "لا توجد مهام بعد.", en: "No tasks yet." })}</p>}
      {tasks.length > 0 && roots.length === 0 && <p className="text-xs text-stone-500">{t({ ar: "لا مهام مطابقة للفلاتر.", en: "No tasks match the filters." })}</p>}
      <div className="space-y-1.5">
        {roots.map((tk) => <TaskRow key={tk.id} task={tk} depth={0} childrenOf={childrenOf} assigneesOf={assigneesOf} nameOf={nameOf} onOpen={setOpen} canManage={canManage} onDelete={del} t={t} />)}
      </div>

      {openTask && (
        <TaskDrawer key={openTask.id} task={openTask} projectId={projectId} canManage={canManage} staff={staff}
          assignees={assigneesOf(openTask.id)} subtasks={tasks.filter((x) => x.parent_task_id === openTask.id)}
          allTasks={tasks} nameOf={nameOf} flash={flash} onClose={() => setOpen(null)} onChanged={load} />
      )}
    </div>
  );
}

function TaskRow({ task, depth, childrenOf, assigneesOf, nameOf, onOpen, canManage, onDelete, t }: {
  task: PcTask; depth: number; childrenOf: Map<string | null, PcTask[]>;
  assigneesOf: (id: string) => TaskAssignee[]; nameOf: (uid: string | null | undefined) => string | null;
  onOpen: (id: string) => void; canManage: boolean; onDelete: (t: PcTask) => void; t: (s: { ar: string; en: string }) => string;
}) {
  const kids = childrenOf.get(task.id) ?? [];
  const overdue = isOverdue(task);
  const owner = nameOf(task.assignee_id) ?? (assigneesOf(task.id).find((a) => a.role === "owner")?.name ?? null);
  const extra = assigneesOf(task.id).filter((a) => a.role !== "owner").length;
  return (
    <>
      <div className={`${card} p-2.5`} style={{ marginInlineStart: depth * 18 }}>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full shrink-0 ${PRIO_DOT[task.priority]}`} title={task.priority} />
          <button onClick={() => onOpen(task.id)} className="flex-1 min-w-0 text-right">
            <span className={`text-sm ${task.status === "done" ? "line-through text-stone-500" : "text-stone-200"}`} dir="auto">{task.title}</span>
            <span className="mr-2 text-[10px] px-1.5 py-0.5 rounded bg-stone-800 text-stone-400">{t(statusLabel(task.status))}</span>
            {overdue && <span className="mr-1 text-[10px] px-1.5 py-0.5 rounded bg-red-900/50 text-red-300">{t({ ar: "متأخرة", en: "Overdue" })}</span>}
            {task.due_date && <span className={`mr-2 text-[10px] ${overdue ? "text-red-400" : "text-stone-500"}`} dir="ltr">⏱ {task.due_date}</span>}
            {owner && <span className="mr-2 text-[10px] text-stone-500">👤 {owner}{extra > 0 ? ` +${extra}` : ""}</span>}
            {task.client_visible && <span className="mr-1 text-[10px] text-emerald-400" title={t({ ar: "مرئية للعميل", en: "Client-visible" })}>◐</span>}
          </button>
          {canManage && <button onClick={() => onDelete(task)} className="text-stone-600 hover:text-red-400 text-xs px-1" title={t({ ar: "حذف", en: "Delete" })}>✕</button>}
        </div>
      </div>
      {kids.map((k) => <TaskRow key={k.id} task={k} depth={depth + 1} childrenOf={childrenOf} assigneesOf={assigneesOf} nameOf={nameOf} onOpen={onOpen} canManage={canManage} onDelete={onDelete} t={t} />)}
    </>
  );
}

function TaskDrawer({ task, projectId, canManage, staff, assignees, subtasks, allTasks, nameOf, flash, onClose, onChanged }: {
  task: PcTask; projectId: string; canManage: boolean; staff: StaffLite[]; assignees: TaskAssignee[];
  subtasks: PcTask[]; allTasks: PcTask[]; nameOf: (uid: string | null | undefined) => string | null;
  flash: (m: string) => void; onClose: () => void; onChanged: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [f, setF] = useState({
    title: task.title, description: task.description ?? "", status: task.status as string, priority: task.priority as string,
    start_date: task.start_date ?? "", due_date: task.due_date ?? "", progress_pct: task.progress_pct, client_visible: !!task.client_visible,
  });
  const [busy, setBusy] = useState(false);
  const [checklist, setChecklist] = useState<TaskChecklistItem[]>([]);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [newItem, setNewItem] = useState(""); const [comment, setComment] = useState("");
  const [subTitle, setSubTitle] = useState("");
  const [addUser, setAddUser] = useState(""); const [addRole, setAddRole] = useState<TaskAssignmentRole>("contributor");

  const load = useCallback(async () => {
    const [c, m] = await Promise.all([pcListChecklist(task.id), pcListTaskComments(task.id)]);
    if (c.ok) setChecklist(c.data);
    if (m.ok) setComments(m.data);
  }, [task.id]);
  useEffect(() => { void load(); }, [load]);

  async function save() {
    if (busy) return; setBusy(true);
    const r = await pcTaskUpdate(task.id, {
      title: f.title.trim() || undefined, description: f.description, status: f.status, priority: f.priority,
      start_date: f.start_date || undefined, due_date: f.due_date || undefined,
      progress_pct: String(f.progress_pct), client_visible: f.client_visible,
      expected_updated_at: task.updated_at,
    });
    setBusy(false);
    if (!r.ok) { flash(pcErr(r.error)); return; }
    flash(t({ ar: "حُفظت المهمة.", en: "Task saved." })); await onChanged();
  }
  async function assign(userId: string, role: TaskAssignmentRole, on: boolean) {
    const r = await pcTaskAssign(task.id, userId, role, on);
    if (!r.ok) { flash(pcErr(r.error)); return; }
    setAddUser(""); await onChanged();
  }
  async function addSub() {
    if (!subTitle.trim()) return; setBusy(true);
    const r = await pcTaskCreate(projectId, { title: subTitle.trim(), parent_task_id: task.id });
    setBusy(false);
    if (!r.ok) { flash(pcErr(r.error)); return; }
    setSubTitle(""); await onChanged();
  }
  async function addItem() { if (!newItem.trim()) return; const r = await pcChecklistAdd(task.id, newItem.trim()); if (!r.ok) { flash(pcErr(r.error)); return; } setNewItem(""); await load(); }
  async function toggle(it: TaskChecklistItem) { const r = await pcChecklistToggle(it.id, !it.is_done); if (!r.ok) { flash(pcErr(r.error)); return; } await load(); }
  async function addComment() { if (!comment.trim()) return; const r = await pcTaskComment(task.id, comment.trim()); if (!r.ok) { flash(pcErr(r.error)); return; } setComment(""); await load(); }

  const link = (label: { ar: string; en: string }, id?: string | null) => id ? <div className="text-[11px] text-stone-400">{t(label)}: <span dir="ltr">{id.slice(0, 8)}</span></div> : null;
  const ro = !canManage;

  return (
    <div className="fixed inset-0 z-[75] flex justify-end bg-black/70" onMouseDown={onClose}>
      <div className="w-full sm:max-w-md h-full overflow-y-auto bg-stone-950 border-s border-stone-800 shadow-2xl" dir="rtl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-stone-800 sticky top-0 bg-stone-950 z-10">
          <h3 className="text-sm font-semibold text-white">{t({ ar: "تفاصيل المهمة", en: "Task details" })}{isOverdue(task) && <span className="mr-2 text-[10px] px-1.5 py-0.5 rounded bg-red-900/50 text-red-300">{t({ ar: "متأخرة", en: "Overdue" })}</span>}</h3>
          <button onClick={onClose} className="text-stone-400 hover:text-white text-sm">✕</button>
        </div>
        <div className="p-4 space-y-4 text-sm">
          <div>
            <label className="text-[11px] text-stone-500">{t({ ar: "العنوان", en: "Title" })}</label>
            <input value={f.title} disabled={ro} onChange={(e) => setF({ ...f, title: e.target.value })} className={`${inp} w-full mt-1`} dir="auto" />
          </div>
          <div>
            <label className="text-[11px] text-stone-500">{t({ ar: "الوصف", en: "Description" })}</label>
            <textarea value={f.description} disabled={ro} onChange={(e) => setF({ ...f, description: e.target.value })} rows={3} className={`${inp} w-full mt-1`} dir="auto" style={{ resize: "vertical" }} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="text-[11px] text-stone-500">{t({ ar: "الحالة", en: "Status" })}</label>
              <select value={f.status} disabled={ro} onChange={(e) => setF({ ...f, status: e.target.value })} className={`${inp} w-full mt-1`} style={{ colorScheme: "dark" }}>
                {TASK_STATUSES.map((s) => <option key={s} value={s}>{t(statusLabel(s))}</option>)}
              </select></div>
            <div><label className="text-[11px] text-stone-500">{t({ ar: "الأولوية", en: "Priority" })}</label>
              <select value={f.priority} disabled={ro} onChange={(e) => setF({ ...f, priority: e.target.value })} className={`${inp} w-full mt-1`} style={{ colorScheme: "dark" }}>
                {PRIORITIES.map((p) => <option key={p} value={p}>{t(PRIORITY_LABELS[p])}</option>)}
              </select></div>
            <div><label className="text-[11px] text-stone-500">{t({ ar: "البداية", en: "Start" })}</label>
              <input type="date" value={f.start_date} disabled={ro} onChange={(e) => setF({ ...f, start_date: e.target.value })} className={`${inp} w-full mt-1`} style={{ colorScheme: "dark" }} /></div>
            <div><label className="text-[11px] text-stone-500">{t({ ar: "الاستحقاق", en: "Due" })}</label>
              <input type="date" value={f.due_date} disabled={ro} onChange={(e) => setF({ ...f, due_date: e.target.value })} className={`${inp} w-full mt-1`} style={{ colorScheme: "dark" }} /></div>
          </div>
          <div>
            <label className="text-[11px] text-stone-500">{t({ ar: "نسبة الإنجاز", en: "Progress" })}: <span dir="ltr">{f.status === "done" ? 100 : f.progress_pct}%</span></label>
            <input type="range" min={0} max={100} step={5} value={f.status === "done" ? 100 : f.progress_pct} disabled={ro || f.status === "done"} onChange={(e) => setF({ ...f, progress_pct: Number(e.target.value) })} className="w-full mt-1" />
          </div>
          <label className="flex items-center gap-2 text-xs text-stone-300">
            <input type="checkbox" checked={f.client_visible} disabled={ro} onChange={(e) => setF({ ...f, client_visible: e.target.checked })} />
            {t({ ar: "مرئية للعميل", en: "Visible to client" })}
          </label>
          {(task.estimated_hours != null || task.actual_hours != null) && (
            <div className="text-[11px] text-stone-400" dir="ltr">⏲ est {task.estimated_hours ?? "—"}h · act {task.actual_hours ?? "—"}h</div>
          )}
          {link({ ar: "مخرج", en: "Deliverable" }, task.deliverable_id)}
          {link({ ar: "جلسة تصوير", en: "Shoot" }, task.shoot_session_id)}
          {link({ ar: "عنصر تحضير", en: "Pre-production" }, task.preproduction_item_id)}
          {canManage && <button disabled={busy} onClick={() => void save()} className={`${btnRed} px-4 py-2 w-full`}>{t({ ar: "حفظ", en: "Save" })}</button>}

          {/* المسؤول والمشاركون */}
          <div className="border-t border-stone-800 pt-3">
            <div className="text-[11px] text-stone-500 mb-1.5">{t({ ar: "المسؤول والمشاركون", en: "Assignees" })}</div>
            <div className="space-y-1">
              {assignees.length === 0 && <span className="text-[11px] text-stone-600">{t({ ar: "لا مشاركين.", en: "None." })}</span>}
              {assignees.map((a) => (
                <div key={`${a.user_id}-${a.role}`} className="flex items-center gap-2 text-xs text-stone-300">
                  <span className="flex-1 truncate">{a.name ?? a.user_id.slice(0, 8)}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-stone-800 text-stone-400">{t(TASK_ASSIGNMENT_ROLE_LABELS[a.role])}</span>
                  {canManage && <button onClick={() => void assign(a.user_id, a.role, false)} className="text-stone-600 hover:text-red-400">✕</button>}
                </div>
              ))}
            </div>
            {canManage && (
              <div className="flex gap-1.5 pt-2">
                <select value={addUser} onChange={(e) => setAddUser(e.target.value)} className={`${inp} flex-1 py-1`} style={{ colorScheme: "dark" }}>
                  <option value="">{t({ ar: "— موظف —", en: "— staff —" })}</option>
                  {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name || s.id.slice(0, 8)}</option>)}
                </select>
                <select value={addRole} onChange={(e) => setAddRole(e.target.value as TaskAssignmentRole)} className={`${inp} py-1`} style={{ colorScheme: "dark" }}>
                  {ROLES.map((r) => <option key={r} value={r}>{t(TASK_ASSIGNMENT_ROLE_LABELS[r])}</option>)}
                </select>
                <button disabled={!addUser} onClick={() => addUser && void assign(addUser, addRole, true)} className={`${btnGhost} px-2`}>+</button>
              </div>
            )}
          </div>

          {/* المهام الفرعية */}
          <div className="border-t border-stone-800 pt-3">
            <div className="text-[11px] text-stone-500 mb-1.5">{t({ ar: "المهام الفرعية", en: "Subtasks" })} ({subtasks.length})</div>
            <div className="space-y-1">
              {subtasks.map((s) => (
                <div key={s.id} className="flex items-center gap-2 text-xs text-stone-300">
                  <span className={`w-1.5 h-1.5 rounded-full ${PRIO_DOT[s.priority]}`} />
                  <span className={`flex-1 truncate ${s.status === "done" ? "line-through text-stone-500" : ""}`} dir="auto">{s.title}</span>
                  <span className="text-[10px] text-stone-500">{t(statusLabel(s.status))}</span>
                </div>
              ))}
            </div>
            {canManage && (
              <div className="flex gap-1.5 pt-2">
                <input value={subTitle} onChange={(e) => setSubTitle(e.target.value)} placeholder={t({ ar: "مهمة فرعية…", en: "Subtask…" })} className={`${inp} flex-1 py-1`} onKeyDown={(e) => { if (e.key === "Enter") void addSub(); }} />
                <button disabled={busy || !subTitle.trim()} onClick={() => void addSub()} className={`${btnGhost} px-2`}>+</button>
              </div>
            )}
          </div>

          {/* قائمة التحقّق */}
          <div className="border-t border-stone-800 pt-3">
            <div className="text-[11px] text-stone-500 mb-1.5">{t({ ar: "قائمة التحقّق", en: "Checklist" })}</div>
            <div className="space-y-1">
              {checklist.map((it) => (
                <label key={it.id} className="flex items-center gap-2 text-xs text-stone-300">
                  <input type="checkbox" checked={it.is_done} disabled={!canManage} onChange={() => void toggle(it)} />
                  <span className={it.is_done ? "line-through text-stone-500" : ""} dir="auto">{it.label}</span>
                </label>
              ))}
              {canManage && (
                <div className="flex gap-1.5 pt-1">
                  <input value={newItem} onChange={(e) => setNewItem(e.target.value)} placeholder={t({ ar: "عنصر…", en: "Item…" })} className={`${inp} flex-1 py-1`} onKeyDown={(e) => { if (e.key === "Enter") void addItem(); }} />
                  <button onClick={() => void addItem()} className={`${btnGhost} px-2`}>+</button>
                </div>
              )}
            </div>
          </div>

          {/* التعليقات */}
          <div className="border-t border-stone-800 pt-3">
            <div className="text-[11px] text-stone-500 mb-1.5">{t({ ar: "التعليقات", en: "Comments" })}</div>
            <div className="space-y-1.5">
              {comments.map((c) => <div key={c.id} className="bg-stone-900 border border-stone-800 rounded p-1.5 text-xs text-stone-300"><span dir="auto">{c.body}</span></div>)}
              <div className="flex gap-1.5">
                <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t({ ar: "أضف تعليقًا…", en: "Add comment…" })} className={`${inp} flex-1 py-1`} onKeyDown={(e) => { if (e.key === "Enter") void addComment(); }} />
                <button onClick={() => void addComment()} className={`${btnGhost} px-2`}>↵</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
