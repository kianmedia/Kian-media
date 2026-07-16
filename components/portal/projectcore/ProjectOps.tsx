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
  pcTaskSetDependency, pcListTaskDeps,
  pcListApprovals, pcApprovalRequest, pcApprovalDecide, pcListActivity, pcStageRequirements, pcErr,
  type StageReqItem,
  type ProjectCore, type PcTask, type PcStage, type PcPriority, type PcTaskStatus,
  type TaskChecklistItem, type TaskComment, type ProjectApproval, type ProjectActivity, type PcApprovalKind,
} from "@/lib/portal/projectCore";
import { TeamTab, DeliverablesTab, CostsTab, RisksTab, MeetingsTab, ShootsTab, TimelineTab } from "./ProjectModules";
import { CalendarTab, GanttTab, LocationsTab, TagsTab, ApplyTemplateButton } from "./ProjectAdvanced";
import { pcProgress, pcSetProgress, type ProgressInfo } from "@/lib/portal/projectCore";

const card = "bg-stone-900 border border-stone-800 rounded-xl";
const inp = "bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-200 placeholder:text-stone-600 focus:outline-none focus:ring-2 focus:ring-red-500";
const btnRed = "rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium";
const btnGhost = "rounded-lg bg-stone-800 border border-stone-700 text-stone-200 text-sm disabled:opacity-50";
const TASK_STATES: PcTaskStatus[] = ["todo", "in_progress", "blocked", "in_review", "done", "cancelled"];
const PRIORITIES: PcPriority[] = ["low", "normal", "high", "urgent"];
const PRIO_DOT: Record<PcPriority, string> = { low: "bg-stone-500", normal: "bg-sky-500", high: "bg-amber-500", urgent: "bg-red-500" };
type TabKey = "tasks" | "gantt" | "calendar" | "team" | "deliverables" | "approvals" | "costs" | "risks" | "meetings" | "shoots" | "locations" | "tags" | "timeline" | "activity";
const TABS: { k: TabKey; ar: string; en: string }[] = [
  { k: "tasks", ar: "المهام", en: "Tasks" }, { k: "gantt", ar: "المخطّط", en: "Gantt" }, { k: "calendar", ar: "التقويم", en: "Calendar" },
  { k: "team", ar: "الفريق", en: "Team" }, { k: "deliverables", ar: "المخرجات", en: "Deliverables" }, { k: "approvals", ar: "الاعتمادات", en: "Approvals" },
  { k: "costs", ar: "التكاليف", en: "Costs" }, { k: "risks", ar: "المخاطر", en: "Risks" },
  { k: "meetings", ar: "الاجتماعات", en: "Meetings" }, { k: "shoots", ar: "جلسات التصوير", en: "Shoots" },
  { k: "locations", ar: "المواقع", en: "Locations" }, { k: "tags", ar: "الوسوم", en: "Tags" },
  { k: "timeline", ar: "الجدول الزمني", en: "Timeline" }, { k: "activity", ar: "النشاط", en: "Activity" },
];

export default function ProjectOps({ projectId, projectName, onChanged, initialTab }: { projectId: string; projectName: string; onChanged?: () => void; initialTab?: string }) {
  const { t } = useI18n();
  const { caps } = usePortal();
  const canManage = caps.isAdminArea || caps.isEditor;
  const [core, setCore] = useState<ProjectCore | null>(null);
  const [tab, setTab] = useState<TabKey>((TABS.some((x) => x.k === initialTab) ? initialTab : "tasks") as TabKey);
  const [busy, setBusy] = useState(false);
  const [rev, setRev] = useState(0);   // يُبدّل مفاتيح حقول الملخّص غير المتحكَّم بها لإرجاعها لقيمة core عند أي حفظ
  const [reqPrompt, setReqPrompt] = useState<{ stage: PcStage; items: StageReqItem[] } | null>(null);
  const [prog, setProg] = useState<ProgressInfo | null>(null);
  const loadProg = useCallback(async () => { const r = await pcProgress(projectId); if (r.ok) setProg(r.data); }, [projectId]);
  useEffect(() => { void loadProg(); }, [loadProg]);
  async function overrideProgress() {
    const pct = window.prompt(t({ ar: "نسبة التقدّم اليدوية 0-100 (فارغ = إلغاء التجاوز والعودة للتلقائي):", en: "Manual progress 0-100 (blank = clear override):" }), String(prog?.manual ?? ""));
    if (pct === null) return;
    const val = pct.trim() === "" ? null : Math.round(Number(pct));
    if (val !== null && (isNaN(val) || val < 0 || val > 100)) { flash(t({ ar: "قيمة غير صحيحة (0-100).", en: "Invalid value (0-100)." })); return; }
    let reason: string | undefined;
    if (val !== null) { const rs = window.prompt(t({ ar: "سبب التجاوز (إلزامي):", en: "Override reason (required):" })); if (rs === null) return; if (!rs.trim()) { flash(t({ ar: "السبب إلزامي.", en: "Reason required." })); return; } reason = rs.trim(); }
    const r = await pcSetProgress(projectId, val, reason);
    if (!r.ok) { flash(pcErr(r.error)); return; }
    setProg(r.data); void loadCore(); flash(t({ ar: "تم تحديث التقدّم.", en: "Progress updated." }));
  }
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

  // انتقال للأمام: افحص المتطلبات أولًا وأظهر الناقص (مع خيار المتابعة). للخلف/الإغلاق: سبب إلزامي.
  async function setStage(stage: PcStage) {
    if (busy || !core) return;
    const curIdx = PC_STAGES.indexOf(core.core_stage), tgtIdx = PC_STAGES.indexOf(stage);
    if (tgtIdx === curIdx) return;   // الضغط على المرحلة الحالية: لا شيء
    if (tgtIdx > curIdx) {
      setBusy(true);
      const req = await pcStageRequirements(projectId, stage);
      setBusy(false);
      if (req.ok && !req.data.ok) { setReqPrompt({ stage, items: req.data.missing }); return; }
    }
    await proceedStage(stage, curIdx, tgtIdx);
  }
  async function proceedStage(stage: PcStage, curIdx: number, tgtIdx: number) {
    let note: string | undefined;
    if (tgtIdx < curIdx || stage === "closed") {
      const p = window.prompt(t({ ar: "سبب الرجوع/الإغلاق (إلزامي):", en: "Reason for going back / closing (required):" }));
      if (p === null) return;
      if (!p.trim()) { flash(t({ ar: "السبب إلزامي.", en: "Reason required." })); return; }
      note = p.trim();
    }
    setReqPrompt(null); setBusy(true);
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
        <div className="flex items-center justify-between mb-3 gap-2">
          <h3 className="text-sm font-semibold text-white shrink-0">{t({ ar: "دورة حياة المشروع", en: "Project Lifecycle" })}</h3>
          {canManage && <ApplyTemplateButton projectId={projectId} flash={flash} onApplied={() => { flash(t({ ar: "طُبِّق القالب — راجع تبويب المهام.", en: "Template applied — see Tasks." })); void loadProg(); }} />}
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
        </div>
        {prog && (
          <div className="mt-3 border-t border-stone-800 pt-3">
            <div className="flex items-center justify-between mb-1 flex-wrap gap-1">
              <span className="text-[11px] text-stone-500">{t({ ar: "التقدّم", en: "Progress" })}: <span className="text-stone-200 font-semibold">{prog.final}%</span>{prog.manual != null && <span className="text-amber-400"> ({t({ ar: "يدوي", en: "manual" })})</span>} · {t({ ar: "تلقائي", en: "auto" })} {prog.auto}%</span>
              {canManage && <button onClick={() => void overrideProgress()} className="text-[11px] text-sky-400 hover:text-sky-300">{prog.manual != null ? t({ ar: "تعديل/إلغاء التجاوز", en: "Edit/clear override" }) : t({ ar: "تجاوز يدوي", en: "Override" })}</button>}
            </div>
            <div className="h-2 bg-stone-800 rounded overflow-hidden"><div className="h-full bg-red-600" style={{ width: `${prog.final}%` }} /></div>
          </div>
        )}
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
      {tab === "gantt" && <GanttTab projectId={projectId} canManage={canManage} flash={flash} />}
      {tab === "calendar" && <CalendarTab projectId={projectId} canManage={canManage} flash={flash} />}
      {tab === "locations" && <LocationsTab projectId={projectId} canManage={canManage} flash={flash} />}
      {tab === "tags" && <TagsTab projectId={projectId} canManage={canManage} flash={flash} />}
      {tab === "team" && <TeamTab projectId={projectId} canManage={canManage} flash={flash} />}
      {tab === "deliverables" && <DeliverablesTab projectId={projectId} canManage={canManage} flash={flash} />}
      {tab === "approvals" && <ApprovalsTab projectId={projectId} flash={flash} />}
      {tab === "costs" && <CostsTab projectId={projectId} flash={flash} />}
      {tab === "risks" && <RisksTab projectId={projectId} canManage={canManage} flash={flash} />}
      {tab === "meetings" && <MeetingsTab projectId={projectId} canManage={canManage} flash={flash} />}
      {tab === "shoots" && <ShootsTab projectId={projectId} canManage={canManage} flash={flash} />}
      {tab === "timeline" && <TimelineTab projectId={projectId} />}
      {tab === "activity" && <ActivityTab projectId={projectId} />}

      {reqPrompt && core && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4" onMouseDown={() => setReqPrompt(null)}>
          <div className="w-full max-w-sm max-h-[85vh] overflow-y-auto bg-stone-950 border border-stone-800 rounded-2xl p-4" dir="rtl" onMouseDown={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-white mb-1">{t({ ar: "متطلبات ناقصة للانتقال إلى", en: "Missing requirements for" })} «{t(PC_STAGE_LABELS[reqPrompt.stage])}»</h3>
            <p className="text-[11px] text-stone-500 mb-3">{t({ ar: "أكمل ما يلي أو تابع مع العلم أن بعض القيود يفرضها النظام.", en: "Complete these, or continue (some rules are enforced by the system)." })}</p>
            <ul className="space-y-1.5 mb-4">
              {reqPrompt.items.map((it) => <li key={it.key} className="flex items-center gap-2 text-xs text-amber-300"><span className="text-amber-500">•</span>{t({ ar: it.ar, en: it.en })}</li>)}
            </ul>
            <div className="flex gap-2">
              {canManage && <button disabled={busy} onClick={() => void proceedStage(reqPrompt.stage, PC_STAGES.indexOf(core.core_stage), PC_STAGES.indexOf(reqPrompt.stage))} className={`${btnRed} px-3 py-2 flex-1`}>{t({ ar: "متابعة رغم ذلك", en: "Continue anyway" })}</button>}
              <button onClick={() => setReqPrompt(null)} className={`${btnGhost} px-3 py-2`}>{t({ ar: "إلغاء", en: "Cancel" })}</button>
            </div>
          </div>
        </div>
      )}
      {toast && <div className="fixed bottom-4 inset-x-4 z-[80] mx-auto max-w-sm bg-stone-800 border border-stone-700 rounded-lg px-4 py-2 text-sm text-stone-100 text-center shadow-lg">{toast}</div>}
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
  const [deps, setDeps] = useState<string[]>([]);
  const [siblings, setSiblings] = useState<PcTask[]>([]);
  const [depPick, setDepPick] = useState("");
  const [newItem, setNewItem] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [c, m, d, s] = await Promise.all([pcListChecklist(task.id), pcListTaskComments(task.id), pcListTaskDeps(task.id), pcListTasks(task.project_id)]);
    if (c.ok) setChecklist(c.data);
    if (m.ok) setComments(m.data);
    if (d.ok) setDeps(d.data.map((x) => x.depends_on_task_id));
    if (s.ok) setSiblings(s.data.filter((x) => x.id !== task.id));
  }, [task.id, task.project_id]);
  async function toggleDep(depId: string, on: boolean) { const r = await pcTaskSetDependency(task.id, depId, on); if (!r.ok) { flash(pcErr(r.error)); return; } setDepPick(""); await load(); }
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
        <div className="text-[11px] text-stone-500 mb-1">{t({ ar: "الاعتماديات (يعتمد على)", en: "Dependencies (depends on)" })}</div>
        <div className="space-y-1">
          {deps.map((id) => { const dt = siblings.find((s) => s.id === id); return (
            <div key={id} className="flex items-center gap-2 text-stone-300"><span className="flex-1 truncate">{dt?.title ?? id.slice(0, 6)}{dt && dt.status !== "done" && dt.status !== "cancelled" && <span className="text-amber-400"> ⏳</span>}</span>{canManage && <button onClick={() => void toggleDep(id, false)} className="text-stone-600 hover:text-red-400">✕</button>}</div>
          ); })}
          {deps.length === 0 && <span className="text-stone-600">{t({ ar: "لا اعتماديات.", en: "None." })}</span>}
          {canManage && siblings.length > 0 && (
            <div className="flex gap-1.5 pt-1">
              <select value={depPick} onChange={(e) => setDepPick(e.target.value)} className={`${inp} flex-1 py-1`} style={{ colorScheme: "dark" }}>
                <option value="">{t({ ar: "— أضف اعتمادية —", en: "— add dependency —" })}</option>
                {siblings.filter((s) => !deps.includes(s.id)).map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
              </select>
              <button disabled={!depPick} onClick={() => depPick && void toggleDep(depPick, true)} className={`${btnGhost} px-2`}>+</button>
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
