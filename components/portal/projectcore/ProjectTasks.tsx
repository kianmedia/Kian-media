"use client";
// ════════════════════════════════════════════════════════════════════════════
// Project Core — تبويب «المهام» (Batch 3B). عرض قائمة + Kanban (تبديل محفوظ محليًا).
// بيانات مركزية واحدة (pc_project_tasks_board — بلا N+1). تغيير الحالة يمرّ بمصفوفة
// سير العمل (canTransition + pc_task_move) مع Optimistic + Rollback. Drawer تفاصيل
// كامل: تحرير (null-clear) + أزرار سير العمل + قرارات مراجعة + روابط تشغيلية + اعتماديات.
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { currentUserId, pget, enc } from "@/lib/portal/client";
import {
  pcProjectTasksBoard, pcTaskMove, pcTaskCreate, pcTaskUpdate, pcEntityDelete, pcTaskAssign,
  pcTaskReviewAction, pcTaskSetParent, pcTaskSetDependency, pcListTaskDeps, pcListStaff, pcListShoots,
  pcListChecklist, pcChecklistAdd, pcChecklistToggle, pcTaskComment, pcListTaskComments, pcErr,
  PRIORITY_LABELS, TASK_STATUS_LABELS, TASK_STATUSES, TASK_ASSIGNMENT_ROLE_LABELS, DEP_TYPE_LABELS,
  CONSTRAINT_LABELS, pcTaskSetPlanning,
  type TaskBoardRow, type PcTask, type PcTaskStatus, type PcPriority, type StaffLite,
  type TaskAssignmentRole, type ProjectTaskProgress, type TaskChecklistItem, type TaskComment, type DependencyType,
  type SchedulingMode, type ConstraintType,
} from "@/lib/portal/projectCore";
import { canTransition, KANBAN_STATUSES, type ReviewAction } from "@/lib/project-core/taskWorkflow";
import ProjectTasksBoard, { type BoardHandlers } from "./ProjectTasksBoard";
import { listDeliverables } from "@/lib/portal/deliverables";

const card = "bg-stone-900 border border-stone-800 rounded-xl";
const inp = "bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-200 placeholder:text-stone-600 focus:outline-none focus:ring-2 focus:ring-red-500";
const btnRed = "rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium";
const btnGhost = "rounded-lg bg-stone-800 border border-stone-700 text-stone-200 text-sm disabled:opacity-50";
const PRIORITIES: PcPriority[] = ["low", "normal", "high", "urgent"];
const ROLES: TaskAssignmentRole[] = ["owner", "contributor", "reviewer", "watcher"];
const statusLabel = (s: string) => TASK_STATUS_LABELS[s as PcTaskStatus] ?? { ar: s, en: s };
const REVIEW_STATUSES = ["internal_review", "client_review"];

export default function ProjectTasks({ projectId, canManage, flash }: { projectId: string; canManage: boolean; flash: (m: string) => void }) {
  const { t } = useI18n();
  const me = currentUserId();
  const [tasks, setTasks] = useState<TaskBoardRow[]>([]);
  const [prog, setProg] = useState<ProjectTaskProgress | null>(null);
  const [staff, setStaff] = useState<StaffLite[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "kanban">("list");
  // فلاتر
  const [q, setQ] = useState(""); const [fStatus, setFStatus] = useState(""); const [fPrio, setFPrio] = useState("");
  const [fAssignee, setFAssignee] = useState(""); const [fMine, setFMine] = useState(false); const [fOverdue, setFOverdue] = useState(false);
  const [fReview, setFReview] = useState(false); const [fClient, setFClient] = useState(false); const [fLinked, setFLinked] = useState(false);
  const [fDeps, setFDeps] = useState(false); const [fBlocked, setFBlocked] = useState(false);
  // إنشاء سريع (رأس)
  const [nTitle, setNTitle] = useState(""); const [nPrio, setNPrio] = useState<PcPriority>("normal");
  const [nDue, setNDue] = useState(""); const [nAssignee, setNAssignee] = useState(""); const [busy, setBusy] = useState(false);

  // حالة التحميل صريحة: فشل القراءة (RPC غير مطبّق/خطأ عابر) كان يظهر كلوحة فارغة
  // لا تُميَّز عن «لا مهام»، بلا خطأ ولا إعادة محاولة (8-STAB).
  const [phase, setPhase] = useState<"loading" | "error" | "ready">("loading");
  const [loadErr, setLoadErr] = useState("");
  const load = useCallback(async () => {
    setPhase("loading");
    const r = await pcProjectTasksBoard(projectId);
    if (r.ok) { setTasks(r.data.tasks); setProg(r.data.progress); setPhase("ready"); }
    else { setLoadErr(pcErr(r.error)); setPhase("error"); }
  }, [projectId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void pcListStaff().then((r) => { if (r.ok) setStaff(r.data); }); }, []);
  useEffect(() => { try { const v = localStorage.getItem(`pt_view_${projectId}`); if (v === "kanban" || v === "list") setView(v); } catch { /* ignore */ } }, [projectId]);
  const switchView = (v: "list" | "kanban") => { setView(v); try { localStorage.setItem(`pt_view_${projectId}`, v); } catch { /* ignore */ } };

  const nameOf = useCallback((uid: string | null | undefined) => {
    if (!uid) return null;
    for (const t of tasks) { const a = t.assignees.find((x) => x.user_id === uid); if (a?.name) return a.name; }
    return staff.find((s) => s.id === uid)?.full_name ?? uid.slice(0, 8);
  }, [tasks, staff]);

  const filtered = useMemo(() => {
    const isMine = (t: TaskBoardRow) => t.assignee_id === me || t.assignees.some((a) => a.user_id === me);
    const needsMyReview = (t: TaskBoardRow) => REVIEW_STATUSES.includes(t.status) && t.assignees.some((a) => a.user_id === me && a.role === "reviewer");
    return tasks.filter((t) => {
      if (q.trim() && !t.title.toLowerCase().includes(q.trim().toLowerCase())) return false;
      if (fStatus && t.status !== fStatus) return false;
      if (fPrio && t.priority !== fPrio) return false;
      if (fAssignee && !(t.assignee_id === fAssignee || t.assignees.some((a) => a.user_id === fAssignee))) return false;
      if (fMine && !isMine(t)) return false;
      if (fOverdue && !t.overdue) return false;
      if (fReview && !needsMyReview(t)) return false;
      if (fClient && !t.client_visible) return false;
      if (fLinked && !(t.deliverable_id || t.shoot_session_id || t.preproduction_item_id)) return false;
      if (fDeps && t.deps_total === 0) return false;
      if (fBlocked && !(t.status === "blocked" || t.deps_blocking > 0)) return false;
      return true;
    });
  }, [tasks, q, fStatus, fPrio, fAssignee, fMine, fOverdue, fReview, fClient, fLinked, fDeps, fBlocked, me]);

  // نقل بصري (Optimistic) ثم Rollback عند فشل الخادم.
  const doMove = useCallback(async (taskId: string, targetStatus: string, before: string | null, after: string | null) => {
    const task = tasks.find((x) => x.id === taskId);
    if (!task) return;
    let reason: string | null = null;
    if (targetStatus === "blocked") {
      reason = window.prompt(t({ ar: "سبب التعطيل (إلزامي):", en: "Block reason (required):" }));
      if (reason === null) return;
      if (!reason.trim()) { flash(t({ ar: "السبب إلزامي.", en: "Reason required." })); return; }
    }
    const snapshot = tasks;
    setTasks((prev) => prev.map((x) => x.id === taskId ? { ...x, status: targetStatus as PcTaskStatus } : x));   // optimistic
    const r = await pcTaskMove(taskId, targetStatus, { before, after, expectedVersion: task.version, reason });
    if (!r.ok) { setTasks(snapshot); flash(pcErr(r.error)); await load(); return; }
    await load();
  }, [tasks, load, flash, t]);

  const quickCreate = useCallback(async (status: PcTaskStatus, title: string) => {
    const r = await pcTaskCreate(projectId, { title, status });
    if (!r.ok) { flash(pcErr(r.error)); return; }
    await load();
  }, [projectId, load, flash]);

  async function addHeader() {
    if (busy || !nTitle.trim()) return; setBusy(true);
    const r = await pcTaskCreate(projectId, { title: nTitle.trim(), priority: nPrio, due_date: nDue || undefined, assignee_id: nAssignee || undefined });
    setBusy(false);
    if (!r.ok) { flash(pcErr(r.error)); return; }
    setNTitle(""); setNDue(""); setNAssignee(""); setNPrio("normal"); await load();
  }
  async function del(task: TaskBoardRow | PcTask) {
    const rs = window.prompt(t({ ar: `حذف «${task.title}» ومهامها الفرعية — السبب (إلزامي):`, en: "Delete reason (required):" }));
    if (rs === null) return; if (!rs.trim()) { flash(t({ ar: "السبب إلزامي.", en: "Reason required." })); return; }
    const r = await pcEntityDelete("task", task.id, rs.trim());
    if (!r.ok) { flash(pcErr(r.error)); return; }
    flash(t({ ar: "حُذفت (قابلة للاستعادة من المحذوفات).", en: "Deleted (restorable)." }));
    if (open === task.id) setOpen(null); await load();
  }

  const anyFilter = q || fStatus || fPrio || fAssignee || fMine || fOverdue || fReview || fClient || fLinked || fDeps || fBlocked;
  const clearFilters = () => { setQ(""); setFStatus(""); setFPrio(""); setFAssignee(""); setFMine(false); setFOverdue(false); setFReview(false); setFClient(false); setFLinked(false); setFDeps(false); setFBlocked(false); };
  const openTask = tasks.find((x) => x.id === open) ?? null;
  const boardHandlers: BoardHandlers = { onMove: doMove, onOpen: setOpen, onQuickCreate: quickCreate, canManage, nameOf };

  if (phase === "loading" && tasks.length === 0)
    return <p className="text-xs text-stone-500 py-8 text-center">{t({ ar: "جارٍ تحميل المهام…", en: "Loading tasks…" })}</p>;
  if (phase === "error")
    return (
      <div className={`${card} p-6 text-center space-y-2`} role="alert">
        <p className="text-sm text-red-300">{loadErr}</p>
        <button onClick={() => void load()} className={`${btnGhost} px-4 py-2`}>{t({ ar: "إعادة المحاولة", en: "Retry" })}</button>
      </div>
    );

  return (
    <div className="space-y-3">
      {/* رأس: إنجاز + تبديل العرض */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        {prog ? (
          <div className="flex items-center gap-2 text-xs text-stone-400">
            <span className="uppercase tracking-wide text-[10px] text-stone-500">{t({ ar: "إنجاز المهام", en: "Task progress" })}</span>
            <div className="w-28 h-1.5 bg-stone-800 rounded overflow-hidden"><div className="h-full bg-emerald-600" style={{ width: `${prog.pct}%` }} /></div>
            <span dir="ltr">{prog.pct}% · {prog.done}/{prog.total}{prog.overdue > 0 && <span className="text-red-400"> · {prog.overdue} {t({ ar: "متأخرة", en: "overdue" })}</span>}</span>
          </div>
        ) : <span />}
        <div className="inline-flex rounded-lg border border-stone-700 overflow-hidden">
          <button onClick={() => switchView("list")} className={`px-3 py-1.5 text-xs ${view === "list" ? "bg-stone-700 text-white" : "text-stone-400"}`}>{t({ ar: "قائمة", en: "List" })}</button>
          <button onClick={() => switchView("kanban")} className={`px-3 py-1.5 text-xs ${view === "kanban" ? "bg-stone-700 text-white" : "text-stone-400"}`}>Kanban</button>
        </div>
      </div>

      {/* إنشاء (رأس) */}
      {canManage && (
        <div className={`${card} p-3 flex flex-wrap gap-2 items-end`}>
          <input value={nTitle} onChange={(e) => setNTitle(e.target.value)} placeholder={t({ ar: "مهمة جديدة…", en: "New task…" })} className={`${inp} flex-1 min-w-[150px]`} onKeyDown={(e) => { if (e.key === "Enter") void addHeader(); }} />
          <select value={nPrio} onChange={(e) => setNPrio(e.target.value as PcPriority)} className={inp} style={{ colorScheme: "dark" }}>
            {PRIORITIES.map((p) => <option key={p} value={p}>{t(PRIORITY_LABELS[p])}</option>)}
          </select>
          <select value={nAssignee} onChange={(e) => setNAssignee(e.target.value)} className={inp} style={{ colorScheme: "dark" }}>
            <option value="">{t({ ar: "— المسؤول —", en: "— owner —" })}</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name || s.id.slice(0, 8)}</option>)}
          </select>
          <input type="date" value={nDue} onChange={(e) => setNDue(e.target.value)} className={inp} style={{ colorScheme: "dark" }} />
          <button disabled={busy || !nTitle.trim()} onClick={() => void addHeader()} className={`${btnRed} px-4 py-2`}>{t({ ar: "إضافة", en: "Add" })}</button>
        </div>
      )}

      {/* فلاتر (مشتركة بين العرضين) */}
      <div className="flex flex-wrap gap-2 items-center">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t({ ar: "بحث…", en: "Search…" })} className={`${inp} flex-1 min-w-[120px] py-1.5`} />
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className={`${inp} py-1.5`} style={{ colorScheme: "dark" }}>
          <option value="">{t({ ar: "الحالة", en: "Status" })}</option>{TASK_STATUSES.map((s) => <option key={s} value={s}>{t(statusLabel(s))}</option>)}
        </select>
        <select value={fPrio} onChange={(e) => setFPrio(e.target.value)} className={`${inp} py-1.5`} style={{ colorScheme: "dark" }}>
          <option value="">{t({ ar: "الأولوية", en: "Priority" })}</option>{PRIORITIES.map((p) => <option key={p} value={p}>{t(PRIORITY_LABELS[p])}</option>)}
        </select>
        <select value={fAssignee} onChange={(e) => setFAssignee(e.target.value)} className={`${inp} py-1.5`} style={{ colorScheme: "dark" }}>
          <option value="">{t({ ar: "المسؤول", en: "Assignee" })}</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.full_name || s.id.slice(0, 8)}</option>)}
        </select>
        {([["mine", fMine, setFMine, { ar: "مهامي", en: "Mine" }], ["review", fReview, setFReview, { ar: "تحتاج مراجعتي", en: "Needs my review" }],
          ["overdue", fOverdue, setFOverdue, { ar: "المتأخرة", en: "Overdue" }], ["client", fClient, setFClient, { ar: "مرئية للعميل", en: "Client-visible" }],
          ["linked", fLinked, setFLinked, { ar: "مرتبطة", en: "Linked" }], ["deps", fDeps, setFDeps, { ar: "لها اعتماديات", en: "Has deps" }],
          ["blocked", fBlocked, setFBlocked, { ar: "معطّلة", en: "Blocked" }]] as const).map(([k, val, set, lbl]) => (
          <button key={k} onClick={() => set((v: boolean) => !v)} className={`rounded-lg border px-2.5 py-1.5 text-[11px] ${val ? "bg-sky-900/40 border-sky-800 text-sky-300" : btnGhost}`}>{t(lbl)}</button>
        ))}
        <span className="text-[11px] text-stone-500">{filtered.length}/{tasks.length}</span>
        {anyFilter && <button onClick={clearFilters} className="text-xs text-stone-400 hover:text-white">✕ {t({ ar: "مسح", en: "Clear" })}</button>}
      </div>

      {tasks.length === 0 && <p className="text-xs text-stone-500">{t({ ar: "لا توجد مهام بعد.", en: "No tasks yet." })}</p>}
      {tasks.length > 0 && filtered.length === 0 && <p className="text-xs text-stone-500">{t({ ar: "لا مهام مطابقة للفلاتر.", en: "No tasks match the filters." })}</p>}

      {view === "kanban" ? (
        <ProjectTasksBoard tasks={filtered} handlers={boardHandlers} />
      ) : (
        <ListView tasks={filtered} allTasks={tasks} nameOf={nameOf} onOpen={setOpen} canManage={canManage} onDelete={del} t={t} />
      )}

      {openTask && (
        <TaskDrawer key={openTask.id} row={openTask} projectId={projectId} canManage={canManage} staff={staff}
          allTasks={tasks} me={me} nameOf={nameOf} flash={flash} onClose={() => setOpen(null)} onChanged={load} onMove={doMove} onDelete={del} />
      )}
    </div>
  );
}

// ─── عرض القائمة (هرمي: المهام الفرعية متداخلة) ───
function ListView({ tasks, allTasks, nameOf, onOpen, canManage, onDelete, t }: {
  tasks: TaskBoardRow[]; allTasks: TaskBoardRow[]; nameOf: (u: string | null | undefined) => string | null;
  onOpen: (id: string) => void; canManage: boolean; onDelete: (t: TaskBoardRow) => void; t: (s: { ar: string; en: string }) => string;
}) {
  const show = useMemo(() => {
    const byId = new Map(allTasks.map((x) => [x.id, x]));
    const s = new Set<string>();
    for (const x of tasks) { s.add(x.id); let p = x.parent_task_id, g = 0; while (p && byId.has(p) && g++ < 20) { s.add(p); p = byId.get(p)!.parent_task_id; } }
    return s;
  }, [tasks, allTasks]);
  const childrenOf = useMemo(() => {
    const m = new Map<string | null, TaskBoardRow[]>();
    for (const x of allTasks) {
      if (!show.has(x.id)) continue;
      const key = x.parent_task_id && show.has(x.parent_task_id) ? x.parent_task_id : null;
      (m.get(key) ?? m.set(key, []).get(key)!).push(x);
    }
    Array.from(m.values()).forEach((arr) => arr.sort((a: TaskBoardRow, b: TaskBoardRow) => a.sort_order - b.sort_order));
    return m;
  }, [allTasks, show]);
  const roots = childrenOf.get(null) ?? [];
  return <div className="space-y-1.5">{roots.map((tk) => <Row key={tk.id} task={tk} depth={0} childrenOf={childrenOf} nameOf={nameOf} onOpen={onOpen} canManage={canManage} onDelete={onDelete} t={t} />)}</div>;
}
function Row({ task, depth, childrenOf, nameOf, onOpen, canManage, onDelete, t }: {
  task: TaskBoardRow; depth: number; childrenOf: Map<string | null, TaskBoardRow[]>; nameOf: (u: string | null | undefined) => string | null;
  onOpen: (id: string) => void; canManage: boolean; onDelete: (t: TaskBoardRow) => void; t: (s: { ar: string; en: string }) => string;
}) {
  const kids = childrenOf.get(task.id) ?? [];
  const owner = nameOf(task.assignee_id);
  return (
    <>
      <div className={`${card} p-2.5`} style={{ marginInlineStart: depth * 18 }}>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full shrink-0 ${{ low: "bg-stone-500", normal: "bg-sky-500", high: "bg-amber-500", urgent: "bg-red-500" }[task.priority]}`} />
          <button onClick={() => onOpen(task.id)} className="flex-1 min-w-0 text-right">
            <span className={`text-sm ${task.status === "done" ? "line-through text-stone-500" : "text-stone-200"}`} dir="auto">{task.title}</span>
            <span className="mr-2 text-[10px] px-1.5 py-0.5 rounded bg-stone-800 text-stone-400">{t(statusLabel(task.status))}</span>
            {task.overdue && <span className="mr-1 text-[10px] px-1.5 py-0.5 rounded bg-red-900/50 text-red-300">{t({ ar: "متأخرة", en: "Overdue" })}</span>}
            {task.deps_blocking > 0 && <span className="mr-1 text-[10px] text-amber-300" title={t({ ar: "معطّلة باعتمادية", en: "Blocked by dep" })}>⛔</span>}
            {task.due_date && <span className={`mr-2 text-[10px] ${task.overdue ? "text-red-400" : "text-stone-500"}`} dir="ltr">⏱ {task.due_date}</span>}
            {task.subtasks_total > 0 && <span className="mr-2 text-[10px] text-stone-500">☑ {task.subtasks_done}/{task.subtasks_total}</span>}
            {owner && <span className="mr-2 text-[10px] text-stone-500">👤 {owner}</span>}
            {task.client_visible && <span className="mr-1 text-[10px] text-emerald-400">◐</span>}
          </button>
          {canManage && <button onClick={() => onDelete(task)} className="text-stone-600 hover:text-red-400 text-xs px-1">✕</button>}
        </div>
      </div>
      {kids.map((k) => <Row key={k.id} task={k} depth={depth + 1} childrenOf={childrenOf} nameOf={nameOf} onOpen={onOpen} canManage={canManage} onDelete={onDelete} t={t} />)}
    </>
  );
}

// ─── Drawer التفاصيل ───
function TaskDrawer({ row, projectId, canManage, staff, allTasks, me, nameOf, flash, onClose, onChanged, onMove, onDelete }: {
  row: TaskBoardRow; projectId: string; canManage: boolean; staff: StaffLite[]; allTasks: TaskBoardRow[]; me: string | null;
  nameOf: (u: string | null | undefined) => string | null; flash: (m: string) => void; onClose: () => void; onChanged: () => Promise<void>;
  onMove: (id: string, s: string, b: string | null, a: string | null) => Promise<void>; onDelete: (t: TaskBoardRow) => void;
}) {
  const { t } = useI18n();
  const [full, setFull] = useState<PcTask | null>(null);
  const [f, setF] = useState({ title: row.title, description: "", priority: row.priority as string, start_date: row.start_date ?? "", due_date: row.due_date ?? "", progress_pct: row.progress_pct, client_visible: row.client_visible, estimated_hours: "" as string });
  const [busy, setBusy] = useState(false);
  const [checklist, setChecklist] = useState<TaskChecklistItem[]>([]); const [comments, setComments] = useState<TaskComment[]>([]);
  const [deps, setDeps] = useState<{ id: string; type: string }[]>([]); const [revDeps, setRevDeps] = useState<string[]>([]);
  const [depType, setDepType] = useState<DependencyType>("finish_to_start");
  const [newItem, setNewItem] = useState(""); const [comment, setComment] = useState(""); const [subTitle, setSubTitle] = useState("");
  const [addUser, setAddUser] = useState(""); const [addRole, setAddRole] = useState<TaskAssignmentRole>("contributor");
  const [depPick, setDepPick] = useState("");
  const [dlvs, setDlvs] = useState<{ id: string; title: string }[]>([]); const [shoots, setShoots] = useState<{ id: string; title: string | null }[]>([]);
  const [preprod, setPreprod] = useState<{ id: string; title: string }[]>([]);

  const load = useCallback(async () => {
    const [fu, c, m, d, rd] = await Promise.all([
      pget<PcTask[]>(`project_tasks?id=eq.${enc(row.id)}&select=*`), pcListChecklist(row.id), pcListTaskComments(row.id),
      pcListTaskDeps(row.id), pget<{ task_id: string }[]>(`task_dependencies?depends_on_task_id=eq.${enc(row.id)}&select=task_id`),
    ]);
    if (fu.ok && fu.data[0]) { const x = fu.data[0]; setFull(x); setF((p) => ({ ...p, description: x.description ?? "", estimated_hours: x.estimated_hours != null ? String(x.estimated_hours) : "" })); }
    if (c.ok) setChecklist(c.data); if (m.ok) setComments(m.data);
    if (d.ok) setDeps(d.data.map((x) => ({ id: x.depends_on_task_id, type: x.dep_type }))); if (rd.ok) setRevDeps(rd.data.map((x) => x.task_id));
  }, [row.id]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void (async () => {
    const [dl, sh, pp] = await Promise.all([
      listDeliverables(projectId), pcListShoots(projectId),
      pget<{ id: string; title: string }[]>(`preproduction_items?project_id=eq.${enc(projectId)}&is_deleted=eq.false&select=id,title&order=created_at.asc`),
    ]);
    if (dl.ok) setDlvs(dl.data.map((x) => ({ id: x.id, title: x.title })));
    if (sh.ok) setShoots(sh.data.map((x) => ({ id: x.id, title: (x as { title?: string | null }).title ?? null })));
    if (pp.ok) setPreprod(pp.data);
  })(); }, [projectId]);

  const assignees = row.assignees;
  const subtasks = allTasks.filter((x) => x.parent_task_id === row.id);
  const siblings = allTasks.filter((x) => x.id !== row.id);

  async function save() {
    if (busy) return; setBusy(true);
    const r = await pcTaskUpdate(row.id, {
      title: f.title.trim() || undefined, description: f.description, priority: f.priority,
      start_date: f.start_date || null, due_date: f.due_date || null, progress_pct: String(f.progress_pct),
      client_visible: f.client_visible, estimated_hours: f.estimated_hours === "" ? null : f.estimated_hours,
      expected_version: row.version,
    });
    setBusy(false);
    if (!r.ok) { flash(pcErr(r.error)); return; }
    flash(t({ ar: "حُفظت.", en: "Saved." })); await onChanged();
  }
  async function move(to: string) { await onMove(row.id, to, null, null); }
  async function review(action: ReviewAction) {
    const needComment = action === "request_changes";
    const c = needComment ? window.prompt(t({ ar: "سبب طلب التعديل:", en: "Change request note:" })) : window.prompt(t({ ar: "تعليق (اختياري):", en: "Comment (optional):" }));
    if (needComment && (c === null || !c.trim())) return;
    const r = await pcTaskReviewAction(row.id, action, c || null, row.version);
    if (!r.ok) { flash(pcErr(r.error)); return; }
    flash(t({ ar: "تم.", en: "Done." })); await onChanged();
  }
  async function assign(u: string, role: TaskAssignmentRole, on: boolean) { const r = await pcTaskAssign(row.id, u, role, on); if (!r.ok) { flash(pcErr(r.error)); return; } setAddUser(""); await onChanged(); }
  async function addSub() { if (!subTitle.trim()) return; const r = await pcTaskCreate(projectId, { title: subTitle.trim(), parent_task_id: row.id }); if (!r.ok) { flash(pcErr(r.error)); return; } setSubTitle(""); await onChanged(); }
  async function setDep(id: string, on: boolean, type: DependencyType = "finish_to_start") { const r = await pcTaskSetDependency(row.id, id, on, type); if (!r.ok) { flash(pcErr(r.error)); return; } setDepPick(""); await onChanged(); await load(); }
  async function setLink(field: "deliverable_id" | "shoot_session_id" | "preproduction_item_id" | "core_stage", value: string | null) {
    const r = await pcTaskUpdate(row.id, { [field]: value });
    if (!r.ok) { flash(pcErr(r.error)); return; } await onChanged(); await load();
  }
  async function setPlan(data: Parameters<typeof pcTaskSetPlanning>[1]) {
    const r = await pcTaskSetPlanning(row.id, data);
    if (!r.ok) { flash(pcErr(r.error)); return; } await onChanged(); await load();
  }
  async function addItem() { if (!newItem.trim()) return; const r = await pcChecklistAdd(row.id, newItem.trim()); if (!r.ok) { flash(pcErr(r.error)); return; } setNewItem(""); await load(); }
  async function toggle(it: TaskChecklistItem) { const r = await pcChecklistToggle(it.id, !it.is_done); if (!r.ok) { flash(pcErr(r.error)); return; } await load(); }
  async function addComment() { if (!comment.trim()) return; const r = await pcTaskComment(row.id, comment.trim()); if (!r.ok) { flash(pcErr(r.error)); return; } setComment(""); await load(); await onChanged(); }

  const ro = !canManage;
  const allowed = KANBAN_STATUSES.filter((s) => s !== row.status && canTransition(row.status, s));
  const inReview = REVIEW_STATUSES.includes(row.status);

  return (
    <div className="fixed inset-0 z-[75] flex justify-end bg-black/70" onMouseDown={onClose}>
      <div className="w-full sm:max-w-md h-full overflow-y-auto bg-stone-950 border-s border-stone-800 shadow-2xl" dir="rtl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-stone-800 sticky top-0 bg-stone-950 z-10">
          <h3 className="text-sm font-semibold text-white">{t({ ar: "تفاصيل المهمة", en: "Task details" })} · <span className="text-stone-400">{t(statusLabel(row.status))}</span></h3>
          <div className="flex items-center gap-2">
            {canManage && <button onClick={() => onDelete(row)} className="text-stone-600 hover:text-red-400 text-xs">{t({ ar: "حذف", en: "Delete" })}</button>}
            <button onClick={onClose} className="text-stone-400 hover:text-white text-sm">✕</button>
          </div>
        </div>
        <div className="p-4 space-y-4 text-sm">
          {row.blocked_reason && <div className="text-[11px] text-red-300 bg-red-900/20 border border-red-900/40 rounded p-2">🚫 {t({ ar: "سبب التعطيل", en: "Blocked" })}: {row.blocked_reason}</div>}

          {/* سير العمل: أزرار انتقال مسموحة + قرارات مراجعة */}
          {canManage && (
            <div className="space-y-2">
              <div className="text-[11px] text-stone-500">{t({ ar: "نقل الحالة", en: "Move status" })}</div>
              <div className="flex flex-wrap gap-1.5">
                {allowed.map((s) => <button key={s} onClick={() => void move(s)} className={`${btnGhost} px-2 py-1 text-[11px]`}>{t(statusLabel(s))}</button>)}
                {allowed.length === 0 && <span className="text-[11px] text-stone-600">{t({ ar: "لا انتقالات متاحة.", en: "No transitions." })}</span>}
              </div>
              {inReview && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {row.status === "internal_review" && <button onClick={() => void review("approve_internal")} className={`${btnGhost} px-2 py-1 text-[11px] text-emerald-300`}>{t({ ar: "اعتماد داخلي", en: "Approve" })}</button>}
                  {row.status === "internal_review" && row.client_visible && <button onClick={() => void review("send_to_client")} className={`${btnGhost} px-2 py-1 text-[11px]`}>{t({ ar: "إرسال للعميل", en: "To client" })}</button>}
                  {row.status === "client_review" && <button onClick={() => void review("approve_client")} className={`${btnGhost} px-2 py-1 text-[11px] text-emerald-300`}>{t({ ar: "اعتماد العميل", en: "Client approve" })}</button>}
                  <button onClick={() => void review("request_changes")} className={`${btnGhost} px-2 py-1 text-[11px] text-amber-300`}>{t({ ar: "طلب تعديل", en: "Request changes" })}</button>
                </div>
              )}
            </div>
          )}

          <div><label className="text-[11px] text-stone-500">{t({ ar: "العنوان", en: "Title" })}</label><input value={f.title} disabled={ro} onChange={(e) => setF({ ...f, title: e.target.value })} className={`${inp} w-full mt-1`} dir="auto" /></div>
          <div><label className="text-[11px] text-stone-500">{t({ ar: "الوصف", en: "Description" })}</label><textarea value={f.description} disabled={ro} onChange={(e) => setF({ ...f, description: e.target.value })} rows={3} className={`${inp} w-full mt-1`} dir="auto" style={{ resize: "vertical" }} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="text-[11px] text-stone-500">{t({ ar: "الأولوية", en: "Priority" })}</label>
              <select value={f.priority} disabled={ro} onChange={(e) => setF({ ...f, priority: e.target.value })} className={`${inp} w-full mt-1`} style={{ colorScheme: "dark" }}>{PRIORITIES.map((p) => <option key={p} value={p}>{t(PRIORITY_LABELS[p])}</option>)}</select></div>
            <div><label className="text-[11px] text-stone-500">{t({ ar: "الساعات المقدرة", en: "Est. hours" })}</label><input type="number" min={0} step={0.5} value={f.estimated_hours} disabled={ro} onChange={(e) => setF({ ...f, estimated_hours: e.target.value })} className={`${inp} w-full mt-1`} dir="ltr" /></div>
            <div><label className="text-[11px] text-stone-500">{t({ ar: "البداية", en: "Start" })}</label><input type="date" value={f.start_date} disabled={ro} onChange={(e) => setF({ ...f, start_date: e.target.value })} className={`${inp} w-full mt-1`} style={{ colorScheme: "dark" }} /></div>
            <div><label className="text-[11px] text-stone-500">{t({ ar: "الاستحقاق", en: "Due" })}</label><input type="date" value={f.due_date} disabled={ro} onChange={(e) => setF({ ...f, due_date: e.target.value })} className={`${inp} w-full mt-1`} style={{ colorScheme: "dark" }} /></div>
          </div>
          <div><label className="text-[11px] text-stone-500">{t({ ar: "نسبة الإنجاز", en: "Progress" })}: <span dir="ltr">{row.status === "done" ? 100 : f.progress_pct}%</span></label>
            <input type="range" min={0} max={100} step={5} value={row.status === "done" ? 100 : f.progress_pct} disabled={ro || row.status === "done"} onChange={(e) => setF({ ...f, progress_pct: Number(e.target.value) })} className="w-full mt-1" /></div>
          <label className="flex items-center gap-2 text-xs text-stone-300"><input type="checkbox" checked={f.client_visible} disabled={ro} onChange={(e) => setF({ ...f, client_visible: e.target.checked })} />{t({ ar: "مرئية للعميل", en: "Visible to client" })}</label>
          {canManage && <button disabled={busy} onClick={() => void save()} className={`${btnRed} px-4 py-2 w-full`}>{t({ ar: "حفظ", en: "Save" })}</button>}

          {/* الروابط التشغيلية */}
          {canManage && (
            <div className="border-t border-stone-800 pt-3 space-y-2">
              <div className="text-[11px] text-stone-500">{t({ ar: "روابط تشغيلية", en: "Operational links" })}</div>
              <LinkSelect label={{ ar: "مخرج", en: "Deliverable" }} value={full?.deliverable_id ?? null} options={dlvs.map((x) => ({ id: x.id, label: x.title }))} onChange={(v) => void setLink("deliverable_id", v)} />
              <LinkSelect label={{ ar: "جلسة تصوير", en: "Shoot" }} value={full?.shoot_session_id ?? null} options={shoots.map((x) => ({ id: x.id, label: x.title || x.id.slice(0, 8) }))} onChange={(v) => void setLink("shoot_session_id", v)} />
              <LinkSelect label={{ ar: "عنصر تحضير", en: "Pre-production" }} value={full?.preproduction_item_id ?? null} options={preprod.map((x) => ({ id: x.id, label: x.title }))} onChange={(v) => void setLink("preproduction_item_id", v)} />
              <LinkSelect label={{ ar: "وسم المرحلة (core_stage)", en: "Stage tag" }} value={full?.core_stage ?? null} options={TASK_STATUSES_MAP} onChange={(v) => void setLink("core_stage", v)} />
            </div>
          )}

          {/* التخطيط الزمني (Gantt) */}
          {canManage && (
            <div className="border-t border-stone-800 pt-3 space-y-2">
              <div className="text-[11px] text-stone-500">{t({ ar: "التخطيط الزمني", en: "Scheduling" })}</div>
              <label className="flex items-center gap-2 text-xs text-stone-300"><input type="checkbox" checked={!!full?.is_milestone} onChange={(e) => void setPlan({ is_milestone: e.target.checked })} />{t({ ar: "معلَم (Milestone)", en: "Milestone" })}</label>
              <div className="grid grid-cols-2 gap-2">
                <div><span className="text-[10px] text-stone-500">{t({ ar: "وضع الجدولة", en: "Mode" })}</span>
                  <select value={full?.scheduling_mode ?? "manual"} onChange={(e) => void setPlan({ scheduling_mode: e.target.value as SchedulingMode })} className={`${inp} w-full py-1 mt-0.5`} style={{ colorScheme: "dark" }}>
                    <option value="manual">{t({ ar: "يدوي", en: "Manual" })}</option><option value="auto">{t({ ar: "آلي", en: "Auto" })}</option>
                  </select></div>
                <div><span className="text-[10px] text-stone-500">{t({ ar: "المدة (أيام عمل)", en: "Duration (wd)" })}</span>
                  <input type="number" min={0} defaultValue={full?.duration_days ?? ""} onBlur={(e) => void setPlan({ duration_days: e.target.value === "" ? null : e.target.value })} className={`${inp} w-full py-1 mt-0.5`} dir="ltr" /></div>
                <div><span className="text-[10px] text-stone-500">{t({ ar: "القيد", en: "Constraint" })}</span>
                  <select value={full?.constraint_type ?? "as_soon_as_possible"} onChange={(e) => void setPlan({ constraint_type: e.target.value as ConstraintType })} className={`${inp} w-full py-1 mt-0.5`} style={{ colorScheme: "dark" }}>
                    {(Object.keys(CONSTRAINT_LABELS) as ConstraintType[]).map((c) => <option key={c} value={c}>{t(CONSTRAINT_LABELS[c])}</option>)}
                  </select></div>
                <div><span className="text-[10px] text-stone-500">{t({ ar: "تاريخ القيد", en: "Constraint date" })}</span>
                  <input type="date" defaultValue={full?.constraint_date ?? ""} onBlur={(e) => void setPlan({ constraint_date: e.target.value || null })} className={`${inp} w-full py-1 mt-0.5`} style={{ colorScheme: "dark" }} /></div>
              </div>
            </div>
          )}

          {/* الاعتماديات (اتجاهان + حالة) */}
          <div className="border-t border-stone-800 pt-3">
            <div className="text-[11px] text-stone-500 mb-1.5">{t({ ar: "تعتمد على", en: "Depends on" })}</div>
            <div className="space-y-1">
              {deps.map((dp) => { const d = allTasks.find((x) => x.id === dp.id); const met = d ? (dp.type.startsWith("finish") ? d.status === "done" : !["backlog", "todo"].includes(d.status)) : false; return (
                <div key={dp.id} className="flex items-center gap-2 text-xs text-stone-300">
                  <span className={met ? "text-emerald-400" : "text-amber-400"} title={met ? t({ ar: "الشرط مستوفى", en: "Condition met" }) : t({ ar: "الشرط غير مستوفى", en: "Not met" })}>{met ? "✓" : "⏳"}</span>
                  <span className="flex-1 truncate">{d?.title ?? dp.id.slice(0, 8)}</span>
                  <span className="text-[9px] px-1 rounded bg-stone-800 text-stone-500" title={t(DEP_TYPE_LABELS[dp.type as DependencyType] ?? { ar: dp.type, en: dp.type })}>{t(DEP_TYPE_LABELS[dp.type as DependencyType] ?? { ar: dp.type, en: dp.type })}</span>
                  {d && <span className="text-[10px] text-stone-500">{t(statusLabel(d.status))}</span>}
                  {canManage && <button onClick={() => void setDep(dp.id, false)} className="text-stone-600 hover:text-red-400">✕</button>}
                </div>
              ); })}
              {deps.length === 0 && <span className="text-[11px] text-stone-600">{t({ ar: "لا شيء.", en: "None." })}</span>}
              {canManage && (
                <div className="flex gap-1.5 pt-1 flex-wrap">
                  <select value={depPick} onChange={(e) => setDepPick(e.target.value)} className={`${inp} flex-1 min-w-[120px] py-1`} style={{ colorScheme: "dark" }}>
                    <option value="">{t({ ar: "— أضف —", en: "— add —" })}</option>{siblings.filter((s) => !deps.some((dp) => dp.id === s.id)).map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
                  </select>
                  <select value={depType} onChange={(e) => setDepType(e.target.value as DependencyType)} className={`${inp} py-1`} style={{ colorScheme: "dark" }} title={t({ ar: "نوع الاعتمادية", en: "Dependency type" })}>
                    {(["finish_to_start", "start_to_start", "finish_to_finish", "start_to_finish"] as DependencyType[]).map((dt) => <option key={dt} value={dt}>{t(DEP_TYPE_LABELS[dt])}</option>)}
                  </select>
                  <button disabled={!depPick} onClick={() => depPick && void setDep(depPick, true, depType)} className={`${btnGhost} px-2`}>+</button>
                </div>
              )}
            </div>
            {revDeps.length > 0 && <div className="text-[10px] text-stone-500 mt-2">{t({ ar: "يعتمد عليها", en: "Depended on by" })}: {revDeps.length}</div>}
          </div>

          {/* المشاركون */}
          <div className="border-t border-stone-800 pt-3">
            <div className="text-[11px] text-stone-500 mb-1.5">{t({ ar: "المسؤول والمشاركون", en: "Assignees" })}</div>
            {assignees.length === 0 && <span className="text-[11px] text-stone-600">{t({ ar: "لا مشاركين.", en: "None." })}</span>}
            {assignees.map((a) => (
              <div key={`${a.user_id}-${a.role}`} className="flex items-center gap-2 text-xs text-stone-300"><span className="flex-1 truncate">{a.name ?? a.user_id.slice(0, 8)}</span><span className="text-[10px] px-1.5 py-0.5 rounded bg-stone-800 text-stone-400">{t(TASK_ASSIGNMENT_ROLE_LABELS[a.role])}</span>{canManage && <button onClick={() => void assign(a.user_id, a.role, false)} className="text-stone-600 hover:text-red-400">✕</button>}</div>
            ))}
            {canManage && (
              <div className="flex gap-1.5 pt-2">
                <select value={addUser} onChange={(e) => setAddUser(e.target.value)} className={`${inp} flex-1 py-1`} style={{ colorScheme: "dark" }}><option value="">{t({ ar: "— موظف —", en: "— staff —" })}</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.full_name || s.id.slice(0, 8)}</option>)}</select>
                <select value={addRole} onChange={(e) => setAddRole(e.target.value as TaskAssignmentRole)} className={`${inp} py-1`} style={{ colorScheme: "dark" }}>{ROLES.map((r) => <option key={r} value={r}>{t(TASK_ASSIGNMENT_ROLE_LABELS[r])}</option>)}</select>
                <button disabled={!addUser} onClick={() => addUser && void assign(addUser, addRole, true)} className={`${btnGhost} px-2`}>+</button>
              </div>
            )}
          </div>

          {/* المهام الفرعية */}
          <div className="border-t border-stone-800 pt-3">
            <div className="text-[11px] text-stone-500 mb-1.5">{t({ ar: "المهام الفرعية", en: "Subtasks" })} ({subtasks.length})</div>
            {subtasks.map((s) => <div key={s.id} className="flex items-center gap-2 text-xs text-stone-300"><span className={`flex-1 truncate ${s.status === "done" ? "line-through text-stone-500" : ""}`} dir="auto">{s.title}</span><span className="text-[10px] text-stone-500">{t(statusLabel(s.status))}</span></div>)}
            {canManage && <div className="flex gap-1.5 pt-2"><input value={subTitle} onChange={(e) => setSubTitle(e.target.value)} placeholder={t({ ar: "مهمة فرعية…", en: "Subtask…" })} className={`${inp} flex-1 py-1`} onKeyDown={(e) => { if (e.key === "Enter") void addSub(); }} /><button disabled={!subTitle.trim()} onClick={() => void addSub()} className={`${btnGhost} px-2`}>+</button></div>}
          </div>

          {/* قائمة التحقّق */}
          <div className="border-t border-stone-800 pt-3">
            <div className="text-[11px] text-stone-500 mb-1.5">{t({ ar: "قائمة التحقّق", en: "Checklist" })}</div>
            {checklist.map((it) => <label key={it.id} className="flex items-center gap-2 text-xs text-stone-300"><input type="checkbox" checked={it.is_done} disabled={!canManage} onChange={() => void toggle(it)} /><span className={it.is_done ? "line-through text-stone-500" : ""} dir="auto">{it.label}</span></label>)}
            {canManage && <div className="flex gap-1.5 pt-1"><input value={newItem} onChange={(e) => setNewItem(e.target.value)} placeholder={t({ ar: "عنصر…", en: "Item…" })} className={`${inp} flex-1 py-1`} onKeyDown={(e) => { if (e.key === "Enter") void addItem(); }} /><button onClick={() => void addItem()} className={`${btnGhost} px-2`}>+</button></div>}
          </div>

          {/* التعليقات */}
          <div className="border-t border-stone-800 pt-3">
            <div className="text-[11px] text-stone-500 mb-1.5">{t({ ar: "التعليقات", en: "Comments" })}</div>
            {comments.map((c) => <div key={c.id} className="bg-stone-900 border border-stone-800 rounded p-1.5 text-xs text-stone-300 mb-1"><span dir="auto">{c.body}</span></div>)}
            <div className="flex gap-1.5"><input value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t({ ar: "أضف تعليقًا…", en: "Add comment…" })} className={`${inp} flex-1 py-1`} onKeyDown={(e) => { if (e.key === "Enter") void addComment(); }} /><button onClick={() => void addComment()} className={`${btnGhost} px-2`}>↵</button></div>
          </div>
        </div>
      </div>
    </div>
  );
}

const TASK_STATUSES_MAP = ["lead_approved", "project_created", "planning", "ready", "scheduled", "in_production", "post_production", "internal_review", "client_review", "revision", "approved", "delivered", "closed"].map((k) => ({ id: k, label: k }));

function LinkSelect({ label, value, options, onChange }: { label: { ar: string; en: string }; value: string | null; options: { id: string; label: string }[]; onChange: (v: string | null) => void }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-stone-500 w-24 shrink-0">{t(label)}</span>
      <select value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} className={`${inp} flex-1 py-1`} style={{ colorScheme: "dark" }}>
        <option value="">{t({ ar: "— بلا —", en: "— none —" })}</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
    </div>
  );
}
