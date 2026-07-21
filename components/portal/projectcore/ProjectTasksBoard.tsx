"use client";
// ════════════════════════════════════════════════════════════════════════════
// Kanban board (Batch 3B). @dnd-kit — mouse + touch + keyboard, RTL-correct.
// Moves are gated in the UI by the workflow matrix (canTransition) and re-validated
// server-side by pc_task_move (optimistic update + rollback handled by the parent).
// ════════════════════════════════════════════════════════════════════════════
import { useMemo, useState } from "react";
import {
  DndContext, DragOverlay, PointerSensor, TouchSensor, KeyboardSensor,
  useSensor, useSensors, closestCorners, useDroppable, type DragStartEvent, type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useI18n } from "@/lib/i18n";
import { canTransition, KANBAN_STATUSES } from "@/lib/project-core/taskWorkflow";
import { TASK_STATUS_LABELS, PRIORITY_LABELS, type TaskBoardRow, type PcTaskStatus, type PcPriority } from "@/lib/portal/projectCore";

const PRIO_DOT: Record<PcPriority, string> = { low: "bg-stone-500", normal: "bg-sky-500", high: "bg-amber-500", urgent: "bg-red-500" };
const initials = (name: string | null | undefined) => (name ?? "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";

export interface BoardHandlers {
  onMove: (taskId: string, targetStatus: string, before: string | null, after: string | null) => void | Promise<void>;
  onOpen: (id: string) => void;
  onQuickCreate: (status: PcTaskStatus, title: string) => void | Promise<void>;
  canManage: boolean;
  nameOf: (uid: string | null | undefined) => string | null;
}

export default function ProjectTasksBoard({ tasks, handlers }: { tasks: TaskBoardRow[]; handlers: BoardHandlers }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const byStatus = useMemo(() => {
    const m: Record<string, TaskBoardRow[]> = {};
    for (const s of KANBAN_STATUSES) m[s] = [];
    for (const tk of tasks) (m[tk.status] ?? (m[tk.status] = [])).push(tk);
    for (const s of KANBAN_STATUSES) m[s].sort((a, b) => a.sort_order - b.sort_order);
    return m;
  }, [tasks]);
  const active = activeId ? tasks.find((x) => x.id === activeId) ?? null : null;

  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const { active: a, over } = e;
    if (!over) return;
    const task = tasks.find((x) => x.id === a.id);
    if (!task) return;
    // over.id is either a task id (card) or a column id "col:<status>".
    const overId = String(over.id);
    let targetStatus: string; let overTask: TaskBoardRow | undefined;
    if (overId.startsWith("col:")) { targetStatus = overId.slice(4); }
    else { overTask = tasks.find((x) => x.id === overId); targetStatus = overTask?.status ?? task.status; }
    if (!canTransition(task.status, targetStatus)) return;                 // UI gate; server re-checks
    if (targetStatus === task.status && overTask?.id === task.id) return;  // no-op
    // Neighbours in the target column for ordering.
    const col = (byStatus[targetStatus] ?? []).filter((x) => x.id !== task.id);
    let idx = overTask ? col.findIndex((x) => x.id === overTask!.id) : col.length;
    if (idx < 0) idx = col.length;
    const before = col[idx - 1]?.id ?? null;   // higher sort_order neighbour
    const after = col[idx]?.id ?? null;
    void handlers.onMove(task.id, targetStatus, before, after);
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners}
      onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
      <div className="flex gap-3 overflow-x-auto pb-3" style={{ scrollSnapType: "x proximity" }}>
        {KANBAN_STATUSES.map((s) => (
          <Column key={s} status={s} tasks={byStatus[s] ?? []} handlers={handlers} />
        ))}
      </div>
      <DragOverlay dropAnimation={null}>{active ? <Card task={active} nameOf={handlers.nameOf} onOpen={() => {}} overlay /> : null}</DragOverlay>
    </DndContext>
  );
}

function Column({ status, tasks, handlers }: { status: PcTaskStatus; tasks: TaskBoardRow[]; handlers: BoardHandlers }) {
  const { t } = useI18n();
  const { setNodeRef } = useDroppable({ id: `col:${status}` });
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const estSum = tasks.reduce((n, x) => n + (x.estimated_hours ?? 0), 0);
  const overdue = tasks.filter((x) => x.overdue).length;
  async function quickAdd() { if (!title.trim()) return; await handlers.onQuickCreate(status, title.trim()); setTitle(""); setAdding(false); }
  return (
    <div className="shrink-0 w-[260px] bg-stone-950 border border-stone-800 rounded-xl flex flex-col max-h-[70vh]" style={{ scrollSnapAlign: "start" }}>
      <div className="px-3 py-2 border-b border-stone-800">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-stone-200">{t(TASK_STATUS_LABELS[status])}</span>
          <span className="text-[10px] text-stone-500">{tasks.length}</span>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-stone-500 mt-0.5" dir="ltr">
          {estSum > 0 && <span title={t({ ar: "إجمالي الساعات المقدرة", en: "Estimated hours" })}>⏲ {estSum}h</span>}
          {overdue > 0 && <span className="text-red-400" title={t({ ar: "متأخرة", en: "Overdue" })}>⏱ {overdue}</span>}
        </div>
      </div>
      <SortableContext id={`col:${status}`} items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className="flex-1 overflow-y-auto p-2 space-y-2 min-h-[40px]">
          {tasks.map((tk) => <SortableCard key={tk.id} task={tk} nameOf={handlers.nameOf} onOpen={handlers.onOpen} />)}
          {tasks.length === 0 && <div className="text-[10px] text-stone-600 text-center py-3">{t({ ar: "فارغ", en: "Empty" })}</div>}
        </div>
      </SortableContext>
      {handlers.canManage && (
        <div className="p-2 border-t border-stone-800">
          {adding ? (
            <div className="flex gap-1">
              <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void quickAdd(); if (e.key === "Escape") setAdding(false); }}
                placeholder={t({ ar: "عنوان…", en: "Title…" })} className="flex-1 bg-stone-800 border border-stone-700 rounded px-2 py-1 text-xs text-stone-200" />
              <button onClick={() => void quickAdd()} className="text-emerald-400 text-xs px-1">✓</button>
              <button onClick={() => setAdding(false)} className="text-stone-500 text-xs px-1">✕</button>
            </div>
          ) : (
            <button onClick={() => setAdding(true)} className="w-full text-[11px] text-stone-500 hover:text-stone-300 text-right">+ {t({ ar: "إضافة مهمة", en: "Add task" })}</button>
          )}
        </div>
      )}
    </div>
  );
}

function SortableCard({ task, nameOf, onOpen }: { task: TaskBoardRow; nameOf: (u: string | null | undefined) => string | null; onOpen: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <Card task={task} nameOf={nameOf} onOpen={onOpen} />
    </div>
  );
}

function Card({ task, nameOf, onOpen, overlay }: { task: TaskBoardRow; nameOf: (u: string | null | undefined) => string | null; onOpen: (id: string) => void; overlay?: boolean }) {
  const { t } = useI18n();
  const owner = nameOf(task.assignee_id) ?? task.assignees.find((a) => a.role === "owner")?.name ?? null;
  const others = task.assignees.filter((a) => a.role !== "owner").length;
  const blockedByDep = task.deps_blocking > 0;
  return (
    <button onClick={() => !overlay && onOpen(task.id)} aria-label={task.title}
      className={`w-full text-right bg-stone-900 border rounded-lg p-2.5 ${task.overdue ? "border-red-900/60" : "border-stone-800"} ${overlay ? "shadow-2xl rotate-1" : "hover:border-stone-600"} cursor-grab active:cursor-grabbing`}>
      <div className="flex items-start gap-1.5">
        <span className={`w-2 h-2 rounded-full shrink-0 mt-1 ${PRIO_DOT[task.priority]}`} title={t(PRIORITY_LABELS[task.priority])} />
        <span className={`text-xs flex-1 ${task.status === "done" ? "line-through text-stone-500" : "text-stone-200"}`} dir="auto">{task.title}</span>
        {task.client_visible && <span className="text-[10px] text-emerald-400" title={t({ ar: "مرئية للعميل", en: "Client-visible" })}>◐</span>}
      </div>
      {task.progress_pct > 0 && task.status !== "done" && (
        <div className="h-1 bg-stone-800 rounded mt-1.5 overflow-hidden"><div className="h-full bg-emerald-700" style={{ width: `${task.progress_pct}%` }} /></div>
      )}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1.5 text-[10px] text-stone-500">
        {task.overdue && <span className="px-1 rounded bg-red-900/50 text-red-300">{t({ ar: "متأخرة", en: "Overdue" })}</span>}
        {blockedByDep && <span className="px-1 rounded bg-amber-900/40 text-amber-300" title={t({ ar: "معطّلة باعتمادية غير مكتملة", en: "Blocked by dependency" })}>⛔ {task.deps_blocking}</span>}
        {task.blocked_reason && <span className="text-red-400" title={task.blocked_reason}>🚫</span>}
        {task.due_date && <span dir="ltr" className={task.overdue ? "text-red-400" : ""}>⏱ {task.due_date}</span>}
        {task.subtasks_total > 0 && <span title={t({ ar: "مهام فرعية", en: "Subtasks" })}>☑ {task.subtasks_done}/{task.subtasks_total}</span>}
        {task.checklist_total > 0 && <span title={t({ ar: "قائمة تحقّق", en: "Checklist" })}>✓ {task.checklist_done}/{task.checklist_total}</span>}
        {task.comments > 0 && <span title={t({ ar: "تعليقات", en: "Comments" })}>💬 {task.comments}</span>}
        {(task.deliverable_id || task.shoot_session_id || task.preproduction_item_id) && <span title={t({ ar: "مرتبطة بعنصر تشغيلي", en: "Linked" })}>🔗</span>}
      </div>
      <div className="flex items-center justify-between mt-1.5">
        {owner ? (
          <span className="inline-flex items-center gap-1 text-[10px] text-stone-400">
            <span className="w-4 h-4 rounded-full bg-stone-700 text-stone-200 flex items-center justify-center text-[8px]" title={owner}>{initials(owner)}</span>
            {others > 0 && <span>+{others}</span>}
          </span>
        ) : <span />}
      </div>
    </button>
  );
}
