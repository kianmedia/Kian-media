"use client";
// ════════════════════════════════════════════════════════════════════════════
// Project Core — لوحة تشغيل المشروع الواحد: دورة الحياة + الملخّص + المهام +
// الاعتمادات + سجل النشاط. كل الكتابات عبر RPCs (projectCore.ts). staff فقط.
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { usePortal } from "@/components/portal/PortalShell";
import {
  PC_STAGES, PC_STAGE_LABELS, PRIORITY_LABELS, HEALTH_LABELS, TASK_STATUS_LABELS, APPROVAL_STATUS_LABELS,
  pcEnsure, pcGetProjectCore, pcSetStage, pcSetMeta, pcListTasks, pcTaskCreate, pcTaskUpdate, pcTaskDelete,
  pcListChecklist, pcChecklistAdd, pcChecklistToggle, pcListTaskComments, pcTaskComment,
  pcListApprovals, pcApprovalRequest, pcApprovalDecide, pcListActivity, pcErr,
  type ProjectCore, type PcTask, type PcStage, type PcPriority, type PcTaskStatus,
  type TaskChecklistItem, type TaskComment, type ProjectApproval, type ProjectActivity, type PcApprovalKind,
} from "@/lib/portal/projectCore";
import { TeamTab, DeliverablesTab, CostsTab, RisksTab, MeetingsTab, ShootsTab, TimelineTab } from "./ProjectModules";

const card = "bg-stone-900 border border-stone-800 rounded-xl";
const inp = "bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-200 placeholder:text-stone-600 focus:outline-none focus:ring-2 focus:ring-red-500";
const btnRed = "rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium";
const btnGhost = "rounded-lg bg-stone-800 border border-stone-700 text-stone-200 text-sm disabled:opacity-50";
const TASK_STATES: PcTaskStatus[] = ["todo", "in_progress", "blocked", "in_review", "done", "cancelled"];
const PRIORITIES: PcPriority[] = ["low", "normal", "high", "urgent"];
const PRIO_DOT: Record<PcPriority, string> = { low: "bg-stone-500", normal: "bg-sky-500", high: "bg-amber-500", urgent: "bg-red-500" };
type TabKey = "tasks" | "team" | "deliverables" | "approvals" | "costs" | "risks" | "meetings" | "shoots" | "timeline" | "activity";
const TABS: { k: TabKey; ar: string; en: string }[] = [
  { k: "tasks", ar: "المهام", en: "Tasks" }, { k: "team", ar: "الفريق", en: "Team" },
  { k: "deliverables", ar: "المخرجات", en: "Deliverables" }, { k: "approvals", ar: "الاعتمادات", en: "Approvals" },
  { k: "costs", ar: "التكاليف", en: "Costs" }, { k: "risks", ar: "المخاطر", en: "Risks" },
  { k: "meetings", ar: "الاجتماعات", en: "Meetings" }, { k: "shoots", ar: "جلسات التصوير", en: "Shoots" },
  { k: "timeline", ar: "الجدول الزمني", en: "Timeline" }, { k: "activity", ar: "النشاط", en: "Activity" },
];

export default function ProjectOps({ projectId, projectName, onChanged }: { projectId: string; projectName: string; onChanged?: () => void }) {
  const { t } = useI18n();
  const { caps } = usePortal();
  const canManage = caps.isAdminArea || caps.isEditor;
  const [core, setCore] = useState<ProjectCore | null>(null);
  const [tab, setTab] = useState<TabKey>("tasks");
  const [busy, setBusy] = useState(false);
  const [rev, setRev] = useState(0);   // يُبدّل مفاتيح حقول الملخّص غير المتحكَّم بها لإرجاعها لقيمة core عند أي حفظ
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast(null), 4200); };

  // pcEnsure يُنشئ صفّ project_core إن لم يوجد (Idempotent) فلا يكون شريط المراحل معطّلًا صامتًا.
  const loadCore = useCallback(async () => {
    const r = await pcEnsure(projectId);
    if (r.ok) { setCore(r.data); return; }
    const g = await pcGetProjectCore(projectId);   // fallback للقراءة فقط
    if (g.ok) setCore(g.data);
  }, [projectId]);
  useEffect(() => { void loadCore(); }, [loadCore]);

  async function setStage(stage: PcStage) {
    if (busy || !core) return;
    const curIdx = PC_STAGES.indexOf(core.core_stage), tgtIdx = PC_STAGES.indexOf(stage);
    let note: string | undefined;
    if (tgtIdx < curIdx || stage === "closed") {   // الرجوع للخلف أو الإغلاق: سبب إلزامي
      const p = window.prompt(t({ ar: "سبب الرجوع/الإغلاق (إلزامي):", en: "Reason for going back / closing (required):" }));
      if (p === null) return;
      if (!p.trim()) { flash(t({ ar: "السبب إلزامي.", en: "Reason required." })); return; }
      note = p.trim();
    }
    setBusy(true);
    const r = await pcSetStage(projectId, stage, note);
    setBusy(false);
    if (!r.ok) { flash(pcErr(r.error)); return; }
    setCore(r.data); flash(t({ ar: "تم تحديث المرحلة.", en: "Stage updated." })); onChanged?.();
  }
  async function saveMeta(patch: Record<string, unknown>) {
    if (busy) return; setBusy(true);
    const r = await pcSetMeta(projectId, patch);
    setBusy(false);
    setRev((v) => v + 1);   // أرجِع الحقول غير المتحكَّم بها لقيمة core (نجاحًا أو فشلًا)
    if (!r.ok) { flash(pcErr(r.error)); return; }
    setCore(r.data); flash(t({ ar: "تم الحفظ.", en: "Saved." })); onChanged?.();
  }

  const stageIdx = core ? PC_STAGES.indexOf(core.core_stage) : -1;

  return (
    <div className="space-y-4">
      {/* دورة الحياة */}
      <section className={`${card} p-4`}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-white">{t({ ar: "دورة حياة المشروع", en: "Project Lifecycle" })}</h3>
          <span className="text-[11px] text-stone-500 font-mono truncate max-w-[50%]" dir="auto">{projectName}</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {PC_STAGES.map((s, i) => (
            <button key={s} disabled={busy || !canManage} onClick={() => void setStage(s)}
              className={`px-2.5 py-1 rounded-lg text-[11px] border transition ${i === stageIdx ? "bg-red-600 border-red-600 text-white" : i < stageIdx ? "bg-emerald-900/30 border-emerald-800 text-emerald-300" : "bg-stone-800 border-stone-700 text-stone-400"} ${!canManage ? "cursor-default" : "hover:border-stone-500"}`}>
              {t(PC_STAGE_LABELS[s])}
            </button>
          ))}
        </div>
      </section>

      {/* الملخّص */}
      <section className={`${card} p-4`}>
        <h3 className="text-sm font-semibold text-white mb-3">{t({ ar: "ملخّص التشغيل", en: "Operations Summary" })}</h3>
        <div key={`meta-${rev}`} className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
          <label className="space-y-1"><span className="text-stone-500">{t({ ar: "الأولوية", en: "Priority" })}</span>
            <select disabled={!canManage} value={core?.priority ?? "normal"} onChange={(e) => void saveMeta({ priority: e.target.value })} className={`${inp} w-full`} style={{ colorScheme: "dark" }}>
              {PRIORITIES.map((p) => <option key={p} value={p}>{t(PRIORITY_LABELS[p])}</option>)}
            </select></label>
          <label className="space-y-1"><span className="text-stone-500">{t({ ar: "الصحة", en: "Health" })}</span>
            <select disabled={!canManage} value={core?.health ?? "on_track"} onChange={(e) => void saveMeta({ health: e.target.value })} className={`${inp} w-full`} style={{ colorScheme: "dark" }}>
              {(["on_track", "at_risk", "off_track"] as const).map((h) => <option key={h} value={h}>{t(HEALTH_LABELS[h])}</option>)}
            </select></label>
          <label className="space-y-1"><span className="text-stone-500">{t({ ar: "الموعد النهائي", en: "Due date" })}</span>
            <input type="date" disabled={!canManage} defaultValue={core?.due_date ?? ""} onBlur={(e) => e.target.value !== (core?.due_date ?? "") && void saveMeta({ due_date: e.target.value })} className={`${inp} w-full`} style={{ colorScheme: "dark" }} /></label>
          <label className="space-y-1"><span className="text-stone-500">{t({ ar: "تاريخ التسليم", en: "Delivery" })}</span>
            <input type="date" disabled={!canManage} defaultValue={core?.delivery_date ?? ""} onBlur={(e) => e.target.value !== (core?.delivery_date ?? "") && void saveMeta({ delivery_date: e.target.value })} className={`${inp} w-full`} style={{ colorScheme: "dark" }} /></label>
          {caps.canSeeFinancials && <label className="space-y-1"><span className="text-stone-500">{t({ ar: "الميزانية", en: "Budget" })}</span>
            <input type="number" min={0} disabled={!canManage} defaultValue={core?.budget_amount ?? ""} onBlur={(e) => Number(e.target.value || 0) !== (core?.budget_amount ?? 0) && void saveMeta({ budget_amount: e.target.value })} className={`${inp} w-full`} placeholder="SAR" /></label>}
          <label className="space-y-1"><span className="text-stone-500">{t({ ar: "التقدّم %", en: "Progress %" })}</span>
            <input type="number" min={0} max={100} disabled={!canManage} defaultValue={core?.progress_pct ?? 0} onBlur={(e) => Number(e.target.value || 0) !== (core?.progress_pct ?? 0) && void saveMeta({ progress_pct: e.target.value })} className={`${inp} w-full`} /></label>
        </div>
      </section>

      {/* تبويبات */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {TABS.filter((tb) => tb.k !== "costs" || caps.canSeeFinancials).map((tb) => (
          <button key={tb.k} onClick={() => setTab(tb.k)} className={`px-3 py-1.5 rounded-lg text-xs whitespace-nowrap ${tab === tb.k ? "bg-red-600 text-white" : "bg-stone-800 border border-stone-700 text-stone-300"}`}>
            {t({ ar: tb.ar, en: tb.en })}
          </button>
        ))}
      </div>

      {tab === "tasks" && <TasksTab projectId={projectId} canManage={canManage} flash={flash} />}
      {tab === "team" && <TeamTab projectId={projectId} canManage={canManage} flash={flash} />}
      {tab === "deliverables" && <DeliverablesTab projectId={projectId} />}
      {tab === "approvals" && <ApprovalsTab projectId={projectId} flash={flash} />}
      {tab === "costs" && <CostsTab projectId={projectId} flash={flash} />}
      {tab === "risks" && <RisksTab projectId={projectId} canManage={canManage} flash={flash} />}
      {tab === "meetings" && <MeetingsTab projectId={projectId} canManage={canManage} flash={flash} />}
      {tab === "shoots" && <ShootsTab projectId={projectId} canManage={canManage} flash={flash} />}
      {tab === "timeline" && <TimelineTab projectId={projectId} />}
      {tab === "activity" && <ActivityTab projectId={projectId} />}

      {toast && <div className="fixed bottom-4 inset-x-4 z-[70] mx-auto max-w-sm bg-stone-800 border border-stone-700 rounded-lg px-4 py-2 text-sm text-stone-100 text-center shadow-lg">{toast}</div>}
    </div>
  );
}

function TasksTab({ projectId, canManage, flash }: { projectId: string; canManage: boolean; flash: (m: string) => void }) {
  const { t } = useI18n();
  const [tasks, setTasks] = useState<PcTask[]>([]);
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<PcPriority>("normal");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => { const r = await pcListTasks(projectId); if (r.ok) setTasks(r.data); }, [projectId]);
  useEffect(() => { void load(); }, [load]);

  async function add() {
    if (busy || !title.trim()) return; setBusy(true);
    const r = await pcTaskCreate(projectId, { title: title.trim(), priority, due_date: due || undefined });
    setBusy(false);
    if (!r.ok) { flash(pcErr(r.error)); return; }
    setTitle(""); setDue(""); setPriority("normal"); await load();
  }
  async function setStatus(task: PcTask, status: PcTaskStatus) {
    const r = await pcTaskUpdate(task.id, { status });
    if (!r.ok) { flash(pcErr(r.error)); return; }
    await load();
  }
  async function del(task: PcTask) {
    if (!window.confirm(t({ ar: "حذف المهمة؟", en: "Delete task?" }))) return;
    const r = await pcTaskDelete(task.id);
    if (!r.ok) { flash(pcErr(r.error)); return; }
    await load();
  }

  const groups: { k: PcTaskStatus; ar: string }[] = [
    { k: "todo", ar: "قائمة" }, { k: "in_progress", ar: "قيد التنفيذ" }, { k: "blocked", ar: "معطّلة" },
    { k: "in_review", ar: "قيد المراجعة" }, { k: "done", ar: "منجزة" }, { k: "cancelled", ar: "ملغاة" },
  ];

  return (
    <div className="space-y-3">
      {canManage && (
        <div className={`${card} p-3 flex flex-wrap gap-2 items-end`}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t({ ar: "مهمة جديدة…", en: "New task…" })} className={`${inp} flex-1 min-w-[160px]`} onKeyDown={(e) => { if (e.key === "Enter") void add(); }} />
          <select value={priority} onChange={(e) => setPriority(e.target.value as PcPriority)} className={inp} style={{ colorScheme: "dark" }}>
            {PRIORITIES.map((p) => <option key={p} value={p}>{t(PRIORITY_LABELS[p])}</option>)}
          </select>
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className={inp} style={{ colorScheme: "dark" }} />
          <button disabled={busy || !title.trim()} onClick={() => void add()} className={`${btnRed} px-4 py-2`}>{t({ ar: "إضافة", en: "Add" })}</button>
        </div>
      )}
      {tasks.length === 0 && <p className="text-xs text-stone-500">{t({ ar: "لا توجد مهام بعد.", en: "No tasks yet." })}</p>}
      {groups.map((g) => {
        const list = tasks.filter((x) => x.status === g.k);
        if (list.length === 0) return null;
        return (
          <div key={g.k}>
            <div className="text-[11px] text-stone-500 mb-1">{t({ ar: g.ar, en: TASK_STATUS_LABELS[g.k].en })} ({list.length})</div>
            <div className="space-y-1.5">
              {list.map((task) => (
                <div key={task.id} className={`${card} p-2.5`}>
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${PRIO_DOT[task.priority]}`} title={t(PRIORITY_LABELS[task.priority])} />
                    <button onClick={() => setOpen(open === task.id ? null : task.id)} className="flex-1 min-w-0 text-right">
                      <span className={`text-sm ${task.status === "done" ? "line-through text-stone-500" : "text-stone-200"}`}>{task.title}</span>
                      {task.due_date && <span className="mr-2 text-[10px] text-stone-500" dir="ltr">⏱ {task.due_date}</span>}
                    </button>
                    {canManage ? (
                      <select value={task.status} onChange={(e) => void setStatus(task, e.target.value as PcTaskStatus)} className="bg-stone-800 border border-stone-700 rounded px-1.5 py-1 text-[11px] text-stone-200" style={{ colorScheme: "dark" }}>
                        {TASK_STATES.map((s) => <option key={s} value={s}>{t(TASK_STATUS_LABELS[s])}</option>)}
                      </select>
                    ) : <span className="text-[11px] text-stone-400">{t(TASK_STATUS_LABELS[task.status])}</span>}
                    {canManage && <button onClick={() => void del(task)} className="text-stone-600 hover:text-red-400 text-xs px-1">✕</button>}
                  </div>
                  {open === task.id && <TaskDetail task={task} canManage={canManage} flash={flash} onChanged={load} />}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TaskDetail({ task, canManage, flash, onChanged }: { task: PcTask; canManage: boolean; flash: (m: string) => void; onChanged: () => Promise<void> }) {
  const { t } = useI18n();
  const [checklist, setChecklist] = useState<TaskChecklistItem[]>([]);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [newItem, setNewItem] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [c, m] = await Promise.all([pcListChecklist(task.id), pcListTaskComments(task.id)]);
    if (c.ok) setChecklist(c.data);
    if (m.ok) setComments(m.data);
  }, [task.id]);
  useEffect(() => { void load(); }, [load]);

  async function addItem() { if (!newItem.trim()) return; setBusy(true); const r = await pcChecklistAdd(task.id, newItem.trim()); setBusy(false); if (!r.ok) { flash(pcErr(r.error)); return; } setNewItem(""); await load(); }
  async function toggle(it: TaskChecklistItem) { const r = await pcChecklistToggle(it.id, !it.is_done); if (!r.ok) { flash(pcErr(r.error)); return; } await load(); }
  async function addComment() { if (!comment.trim()) return; setBusy(true); const r = await pcTaskComment(task.id, comment.trim()); setBusy(false); if (!r.ok) { flash(pcErr(r.error)); return; } setComment(""); await load(); void onChanged(); }

  return (
    <div className="mt-2 pt-2 border-t border-stone-800 space-y-3 text-xs">
      {task.description && <p className="text-stone-400">{task.description}</p>}
      <div>
        <div className="text-[11px] text-stone-500 mb-1">{t({ ar: "قائمة التحقّق", en: "Checklist" })}</div>
        <div className="space-y-1">
          {checklist.map((it) => (
            <label key={it.id} className="flex items-center gap-2 text-stone-300">
              <input type="checkbox" checked={it.is_done} disabled={!canManage} onChange={() => void toggle(it)} />
              <span className={it.is_done ? "line-through text-stone-500" : ""}>{it.label}</span>
            </label>
          ))}
          {canManage && (
            <div className="flex gap-1.5 pt-1">
              <input value={newItem} onChange={(e) => setNewItem(e.target.value)} placeholder={t({ ar: "عنصر…", en: "Item…" })} className={`${inp} flex-1 py-1`} onKeyDown={(e) => { if (e.key === "Enter") void addItem(); }} />
              <button disabled={busy} onClick={() => void addItem()} className={`${btnGhost} px-2`}>+</button>
            </div>
          )}
        </div>
      </div>
      <div>
        <div className="text-[11px] text-stone-500 mb-1">{t({ ar: "التعليقات", en: "Comments" })}</div>
        <div className="space-y-1.5">
          {comments.map((c) => <div key={c.id} className="bg-stone-950 border border-stone-800 rounded p-1.5 text-stone-300"><span dir="auto">{c.body}</span><span className="block text-[10px] text-stone-600" dir="ltr">{new Date(c.created_at).toLocaleString("ar")}</span></div>)}
          <div className="flex gap-1.5">
            <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t({ ar: "أضف تعليقًا…", en: "Add comment…" })} className={`${inp} flex-1 py-1`} onKeyDown={(e) => { if (e.key === "Enter") void addComment(); }} />
            <button disabled={busy} onClick={() => void addComment()} className={`${btnGhost} px-2`}>↵</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ApprovalsTab({ projectId, flash }: { projectId: string; flash: (m: string) => void }) {
  const { t } = useI18n();
  const { caps } = usePortal();
  const [rows, setRows] = useState<ProjectApproval[]>([]);
  const [kind, setKind] = useState<PcApprovalKind>("internal");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => { const r = await pcListApprovals(projectId); if (r.ok) setRows(r.data); }, [projectId]);
  useEffect(() => { void load(); }, [load]);

  async function request() { if (busy) return; setBusy(true); const r = await pcApprovalRequest(projectId, kind, title.trim() || undefined); setBusy(false); if (!r.ok) { flash(pcErr(r.error)); return; } setTitle(""); await load(); }
  async function decide(a: ProjectApproval, decision: "approved" | "rejected" | "revision_requested") {
    if (busy) return; setBusy(true); const r = await pcApprovalDecide(a.id, decision); setBusy(false);
    if (!r.ok) { flash(pcErr(r.error)); return; } await load();
  }
  const kindLabel = (k: PcApprovalKind) => t(k === "internal" ? { ar: "داخلي", en: "Internal" } : k === "manager" ? { ar: "مدير", en: "Manager" } : { ar: "عميل", en: "Client" });

  return (
    <div className="space-y-3">
      {caps.isAdminArea && (
        <div className={`${card} p-3 flex flex-wrap gap-2 items-end`}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t({ ar: "عنوان الاعتماد (اختياري)", en: "Approval title (optional)" })} className={`${inp} flex-1 min-w-[160px]`} />
          <select value={kind} onChange={(e) => setKind(e.target.value as PcApprovalKind)} className={inp} style={{ colorScheme: "dark" }}>
            {(["internal", "manager", "client"] as const).map((k) => <option key={k} value={k}>{kindLabel(k)}</option>)}
          </select>
          <button disabled={busy} onClick={() => void request()} className={`${btnRed} px-4 py-2`}>{t({ ar: "طلب اعتماد", en: "Request" })}</button>
        </div>
      )}
      {rows.length === 0 && <p className="text-xs text-stone-500">{t({ ar: "لا توجد اعتمادات.", en: "No approvals." })}</p>}
      {rows.map((a) => (
        <div key={a.id} className={`${card} p-3 text-xs`}>
          <div className="flex items-center justify-between gap-2">
            <div>
              <span className="text-stone-200">{a.title || kindLabel(a.kind)}</span>
              <span className="mr-2 text-[10px] text-stone-500">· {kindLabel(a.kind)}</span>
              <span className={`mr-2 px-1.5 py-0.5 rounded text-[10px] ${a.status === "approved" ? "bg-emerald-900/40 text-emerald-300" : a.status === "pending" ? "bg-amber-900/40 text-amber-300" : "bg-red-900/40 text-red-300"}`}>{t(APPROVAL_STATUS_LABELS[a.status])}</span>
            </div>
          </div>
          {a.status === "pending" && (caps.isAdminArea || (a.kind === "client" && caps.isClientSide)) && (
            <div className="flex gap-2 mt-2">
              <button disabled={busy} onClick={() => void decide(a, "approved")} className={`${btnRed} px-3 py-1`}>{t({ ar: "اعتماد", en: "Approve" })}</button>
              <button disabled={busy} onClick={() => void decide(a, "revision_requested")} className={`${btnGhost} px-3 py-1`}>{t({ ar: "طلب تعديل", en: "Revision" })}</button>
              <button disabled={busy} onClick={() => void decide(a, "rejected")} className={`${btnGhost} px-3 py-1 text-red-400 border-red-900/60`}>{t({ ar: "رفض", en: "Reject" })}</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ActivityTab({ projectId }: { projectId: string }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<ProjectActivity[]>([]);
  useEffect(() => { void pcListActivity(projectId).then((r) => { if (r.ok) setRows(r.data); }); }, [projectId]);
  const ACTIONS: Record<string, string> = {
    stage_changed: "تغيير المرحلة", meta_updated: "تحديث الملخّص", task_created: "إنشاء مهمة", task_updated: "تحديث مهمة",
    task_deleted: "حذف مهمة", task_comment: "تعليق على مهمة", time_logged: "تسجيل وقت",
    approval_requested: "طلب اعتماد", approval_approved: "اعتماد", approval_rejected: "رفض اعتماد", approval_revision_requested: "طلب تعديل",
  };
  if (rows.length === 0) return <p className="text-xs text-stone-500">{t({ ar: "لا يوجد نشاط بعد.", en: "No activity yet." })}</p>;
  return (
    <div className="space-y-1.5">
      {rows.map((a) => (
        <div key={a.id} className={`${card} p-2 text-xs flex items-center justify-between gap-2`}>
          <span className="text-stone-300">{ACTIONS[a.action] ?? a.action}</span>
          <span className="text-[10px] text-stone-600" dir="ltr">{new Date(a.created_at).toLocaleString("ar")}</span>
        </div>
      ))}
    </div>
  );
}
