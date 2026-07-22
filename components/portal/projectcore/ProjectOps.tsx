"use client";
// ════════════════════════════════════════════════════════════════════════════
// Project Core — لوحة تشغيل المشروع الواحد: دورة الحياة + الملخّص + المهام +
// الاعتمادات + سجل النشاط. كل الكتابات عبر RPCs (projectCore.ts). staff فقط.
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { usePortal } from "@/components/portal/PortalShell";
import {
  PC_STAGES, PC_STAGE_LABELS, PRIORITY_LABELS, HEALTH_LABELS, TASK_STATUS_LABELS, APPROVAL_STATUS_LABELS,
  fmtDT,
  pcEnsure, pcGetProjectCore, pcSetStage, pcSetMeta, pcListTasks, pcTaskCreate, pcTaskUpdate,
  pcListChecklist, pcChecklistAdd, pcChecklistToggle, pcListTaskComments, pcTaskComment,
  pcTaskSetDependency, pcListTaskDeps,
  pcListApprovals, pcApprovalRequest, pcApprovalDecide, pcListActivity, pcStageRequirements, pcErr,
  type StageReqItem,
  type ProjectCore, type PcTask, type PcStage, type PcPriority, type PcTaskStatus,
  type TaskChecklistItem, type TaskComment, type ProjectApproval, type ProjectActivity, type PcApprovalKind,
} from "@/lib/portal/projectCore";
import { TeamTab, DeliverablesTab, CostsTab, RisksTab, MeetingsTab, ShootsTab, TimelineTab } from "./ProjectModules";
import { LocationsTab, TagsTab } from "./ProjectAdvanced";
import { TemplateManagerButton } from "./ProjectTemplates";
import { ScheduleTab, UnifiedCalendarTab, UnifiedGanttTab } from "./ProjectSchedule";
import PreProductionCenter from "@/components/portal/PreProductionCenter";
import ProjectProgressBar from "@/components/portal/ProjectProgressBar";
import ProjectTasks from "./ProjectTasks";
import ProjectExecution from "./ProjectExecution";
import ProjectReports from "./ProjectReports";
import ProjectGantt from "./ProjectGantt";
import ProjectResources from "./ProjectResources";
import GovernanceTab from "./GovernanceTab";
import { TrashTab } from "./ProjectTrash";
import { ProjectPrintPack } from "./ProjectPrintPack";
import { pcEntityDelete } from "@/lib/portal/projectCore";
import { FinanceTab } from "./ProjectFinance";
import { pcProgress, pcSetProgress, pcStageAdvance, projectStageReadiness, projectActivityFeed, type ProgressInfo, type StageReadiness, type ActivityEvent } from "@/lib/portal/projectCore";

const card = "bg-stone-900 border border-stone-800 rounded-xl";
const inp = "bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-200 placeholder:text-stone-600 focus:outline-none focus:ring-2 focus:ring-red-500";
const btnRed = "rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium";
const btnGhost = "rounded-lg bg-stone-800 border border-stone-700 text-stone-200 text-sm disabled:opacity-50";
const TASK_STATES: PcTaskStatus[] = ["todo", "in_progress", "blocked", "in_review", "done", "cancelled"];
const PRIORITIES: PcPriority[] = ["low", "normal", "high", "urgent"];
const PRIO_DOT: Record<PcPriority, string> = { low: "bg-stone-500", normal: "bg-sky-500", high: "bg-amber-500", urgent: "bg-red-500" };
type TabKey = "execution" | "reports" | "planning" | "resources" | "governance" | "schedule" | "tasks" | "gantt" | "calendar" | "team" | "deliverables" | "approvals" | "finance" | "costs" | "risks" | "meetings" | "shoots" | "locations" | "tags" | "timeline" | "activity" | "trash";
const TABS: { k: TabKey; ar: string; en: string }[] = [
  { k: "execution", ar: "التنفيذ", en: "Execution" }, { k: "reports", ar: "التقارير", en: "Reports" },
  { k: "planning", ar: "المخطط الزمني", en: "Planner" },
  { k: "resources", ar: "الموارد", en: "Resources" },
  { k: "governance", ar: "الحوكمة", en: "Governance" },
  { k: "schedule", ar: "الخطة الزمنية", en: "Schedule" },
  { k: "tasks", ar: "المهام", en: "Tasks" }, { k: "gantt", ar: "المخطّط", en: "Gantt" }, { k: "calendar", ar: "التقويم", en: "Calendar" },
  { k: "team", ar: "الفريق", en: "Team" }, { k: "deliverables", ar: "المخرجات", en: "Deliverables" }, { k: "approvals", ar: "الاعتمادات", en: "Approvals" },
  { k: "finance", ar: "حسابات المشروع", en: "Accounts" }, { k: "costs", ar: "التكاليف", en: "Costs" }, { k: "risks", ar: "المخاطر", en: "Risks" },
  { k: "meetings", ar: "الاجتماعات", en: "Meetings" }, { k: "shoots", ar: "جلسات التصوير", en: "Shoots" },
  { k: "locations", ar: "المواقع", en: "Locations" }, { k: "tags", ar: "الوسوم", en: "Tags" },
  { k: "timeline", ar: "سجل المراحل", en: "Stage History" }, { k: "activity", ar: "سجل النشاط", en: "Activity Log" },
  { k: "trash", ar: "المحذوفات", en: "Trash" },
];

export default function ProjectOps({ projectId, projectName, onChanged, initialTab }: { projectId: string; projectName: string; onChanged?: () => void; initialTab?: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const { caps, profile } = usePortal();
  const canManage = caps.isAdminArea || caps.isEditor;
  const isFinance = caps.isOwner || profile.staff_role === "finance";   // عزل الحسابات
  // التبويبات المرئية لهذا المستخدم — deep-link لتبويب غير مسموح يسقط إلى «المهام» بدل منطقة فارغة.
  const visibleTabs = TABS.filter((tb) => (tb.k !== "costs" || caps.canSeeFinancials) && (tb.k !== "finance" || isFinance) && (tb.k !== "trash" || canManage));
  const [core, setCore] = useState<ProjectCore | null>(null);
  const [tab, setTab] = useState<TabKey>((visibleTabs.some((x) => x.k === initialTab) ? initialTab : "tasks") as TabKey);
  const [busy, setBusy] = useState(false);
  const [rev, setRev] = useState(0);   // يُبدّل مفاتيح حقول الملخّص غير المتحكَّم بها لإرجاعها لقيمة core عند أي حفظ
  const [reqPrompt, setReqPrompt] = useState<{ stage: PcStage; items: StageReqItem[] } | null>(null);
  const [readyPrompt, setReadyPrompt] = useState<{ stage: PcStage; note: string | null; readiness: StageReadiness } | null>(null);
  const [printPack, setPrintPack] = useState(false);
  const [prog, setProg] = useState<ProgressInfo | null>(null);
  const [progRefresh, setProgRefresh] = useState(0);   // bump to refetch the unified ProjectProgressBar
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
    setProg(r.data); setProgRefresh((x) => x + 1); void loadCore(); flash(t({ ar: "تم تحديث التقدّم.", en: "Progress updated." }));
  }
  const [toast, setToast] = useState<string | null>(null);
  // هوية ثابتة — flash داخل deps للـload في التبويبات؛ هوية متغيّرة تسبّب حلقة إعادة جلب.
  const flash = useCallback((m: string) => { setToast(m); window.setTimeout(() => setToast(null), 4200); }, []);

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
    // جاهزية المرحلة (استرشادية): يمرّ الانتقال عبر project_stage_advance الذي يفحص الجاهزية
    // ويفرض تجاوزها بصلاحية + سبب + Audit خادميًا — لا يعتمد على الواجهة وحدها.
    const r = await pcStageAdvance(projectId, stage, note, null);
    setBusy(false);
    if (!r.ok) {
      if (/stage_not_ready/.test(r.error)) {
        const rd = await projectStageReadiness(projectId);
        if (rd.ok) { setReadyPrompt({ stage, note: note ?? null, readiness: rd.data }); return; }
      }
      flash(pcErr(r.error)); return;
    }
    applyStageResult(r.data);
  }
  function applyStageResult(data: ProjectCore) {
    setCore(data); setProgRefresh((x) => x + 1); void loadProg();
    router.refresh();   // إبطال Router Cache فتظهر المرحلة/النسبة الجديدة في القائمة فورًا
    flash(t({ ar: "تم تحديث المرحلة.", en: "Stage updated." })); onChanged?.();
  }
  async function overrideStageReadiness() {
    if (!readyPrompt) return;
    const reason = window.prompt(t({ ar: "سبب تجاوز جاهزية المرحلة (إلزامي):", en: "Override reason (required):" }));
    if (reason === null) return;
    if (!reason.trim()) { flash(t({ ar: "السبب إلزامي.", en: "Reason required." })); return; }
    setBusy(true);
    const r = await pcStageAdvance(projectId, readyPrompt.stage, readyPrompt.note, reason.trim());
    setBusy(false); setReadyPrompt(null);
    if (!r.ok) { flash(pcErr(r.error)); return; }
    applyStageResult(r.data);
  }
  async function saveMeta(patch: Record<string, unknown>) {
    if (busy) return; setBusy(true);
    const r = await pcSetMeta(projectId, patch);
    setBusy(false);
    setRev((v) => v + 1);   // أرجِع الحقول غير المتحكَّم بها لقيمة core (نجاحًا أو فشلًا)
    if (!r.ok) { flash(pcErr(r.error)); return; }
    setCore(r.data);
    router.refresh();   // نفس سبب مزامنة القائمة: البطاقة تعرض الأولوية/الموعد/الصحّة أيضًا
    flash(t({ ar: "تم الحفظ.", en: "Saved." })); onChanged?.();
  }

  const stageIdx = core ? PC_STAGES.indexOf(core.core_stage) : -1;

  return (
    <div className="space-y-4">
      {/* دورة الحياة */}
      <section className={`${card} p-4`}>
        <div className="flex items-center justify-between mb-3 gap-2">
          <h3 className="text-sm font-semibold text-white shrink-0">{t({ ar: "دورة حياة المشروع", en: "Project Lifecycle" })}</h3>
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => setPrintPack(true)} className={`${btnGhost} px-3 py-1.5 text-xs`}>{t({ ar: "طباعة حزمة المشروع", en: "Print Pack" })}</button>
            {caps.isAdminArea && <TemplateManagerButton projectId={projectId} flash={flash} onApplied={() => { void loadProg(); onChanged?.(); }} />}
          </div>
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
        {/* ONE authoritative progress value (P0-3) — project_progress(), identical
            to what the client sees; the admin override (project_core.progress_manual)
            is honored inside that same function, so both surfaces always agree. */}
        <div className="mt-3 border-t border-stone-800 pt-3">
          <ProjectProgressBar projectId={projectId} refreshSignal={progRefresh} />
          {canManage && (
            <button onClick={() => void overrideProgress()} className="text-[11px] text-sky-400 hover:text-sky-300 mt-2">
              {prog?.manual != null ? t({ ar: "تعديل/إلغاء التجاوز اليدوي", en: "Edit/clear manual override" }) : t({ ar: "تجاوز يدوي (مدير)", en: "Manual override" })}
            </button>
          )}
        </div>
      </section>

      {/* تبويبات */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {visibleTabs.map((tb) => (
          <button key={tb.k} onClick={() => setTab(tb.k)} className={`px-3 py-1.5 rounded-lg text-xs whitespace-nowrap ${tab === tb.k ? "bg-red-600 text-white" : "bg-stone-800 border border-stone-700 text-stone-300"}`}>
            {t({ ar: tb.ar, en: tb.en })}
          </button>
        ))}
      </div>

      {tab === "schedule" && <ScheduleTab projectId={projectId} canManage={canManage} flash={flash} gotoTab={(k) => setTab(k as TabKey)} />}
      {tab === "execution" && <ProjectExecution projectId={projectId} canManage={canManage} flash={flash} />}
      {tab === "reports" && <ProjectReports projectId={projectId} canManage={canManage} flash={flash} />}
      {tab === "planning" && <ProjectGantt projectId={projectId} canManage={canManage} flash={flash} />}
      {tab === "resources" && <ProjectResources projectId={projectId} canManage={canManage} flash={flash} />}
      {tab === "governance" && <GovernanceTab projectId={projectId} canManage={canManage} flash={flash} />}
      {tab === "tasks" && <ProjectTasks projectId={projectId} canManage={canManage} flash={flash} />}
      {tab === "gantt" && (
        <div className="space-y-6">
          {/* Structured pre-production center (§4) lives in the planning ("المخطّط")
              tab; the legacy unified Gantt/plan stays below it. */}
          <PreProductionCenter projectId={projectId} canManage={canManage} projectName={projectName} />
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: "16px" }}>
            <UnifiedGanttTab projectId={projectId} canManage={canManage} flash={flash} gotoTab={(k) => setTab(k as TabKey)} />
          </div>
        </div>
      )}
      {tab === "calendar" && <UnifiedCalendarTab projectId={projectId} canManage={canManage} flash={flash} gotoTab={(k) => setTab(k as TabKey)} />}
      {tab === "locations" && <LocationsTab projectId={projectId} canManage={canManage} flash={flash} />}
      {tab === "tags" && <TagsTab projectId={projectId} canManage={canManage} flash={flash} />}
      {tab === "team" && <TeamTab projectId={projectId} canManage={canManage} flash={flash} />}
      {tab === "deliverables" && <DeliverablesTab projectId={projectId} canManage={canManage} flash={flash} />}
      {tab === "approvals" && <ApprovalsTab projectId={projectId} flash={flash} />}
      {tab === "finance" && isFinance && <FinanceTab projectId={projectId} flash={flash} />}
      {tab === "costs" && <CostsTab projectId={projectId} canManage={canManage} flash={flash} />}
      {tab === "risks" && <RisksTab projectId={projectId} canManage={canManage} flash={flash} />}
      {tab === "meetings" && <MeetingsTab projectId={projectId} canManage={canManage} flash={flash} />}
      {tab === "shoots" && <ShootsTab projectId={projectId} canManage={canManage} flash={flash} />}
      {tab === "timeline" && <TimelineTab projectId={projectId} />}
      {tab === "activity" && <ActivityTab projectId={projectId} />}
      {tab === "trash" && canManage && <TrashTab projectId={projectId} flash={flash} />}

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
      {readyPrompt && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4" onMouseDown={() => setReadyPrompt(null)}>
          <div className="w-full max-w-sm max-h-[85vh] overflow-y-auto bg-stone-950 border border-stone-800 rounded-2xl p-4" dir="rtl" onMouseDown={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-white mb-1">{t({ ar: "المرحلة غير جاهزة", en: "Stage not ready" })} · «{t(PC_STAGE_LABELS[readyPrompt.stage])}»</h3>
            <p className="text-[11px] text-amber-300 mb-3">{t({ ar: readyPrompt.readiness.warning_ar ?? "يوجد عمل غير مكتمل.", en: readyPrompt.readiness.warning_en ?? "There is unfinished work." })}</p>
            <ul className="space-y-1 mb-4 text-[11px] text-stone-400">
              <li>{t({ ar: "مهام مفتوحة", en: "Open" })}: {readyPrompt.readiness.open_tasks}</li>
              <li className={readyPrompt.readiness.overdue_tasks > 0 ? "text-red-400" : ""}>{t({ ar: "متأخرة", en: "Overdue" })}: {readyPrompt.readiness.overdue_tasks}</li>
              <li className={readyPrompt.readiness.blocked_tasks > 0 ? "text-amber-400" : ""}>{t({ ar: "متوقفة", en: "Blocked" })}: {readyPrompt.readiness.blocked_tasks}</li>
              <li>{t({ ar: "بانتظار المراجعة", en: "Awaiting review" })}: {readyPrompt.readiness.awaiting_review}</li>
            </ul>
            <p className="text-[10px] text-stone-600 mb-3">{t({ ar: "المتابعة تتطلب صلاحية التجاوز وسببًا يُسجَّل في التدقيق.", en: "Override needs the capability + a logged reason." })}</p>
            <div className="flex gap-2">
              <button disabled={busy} onClick={() => void overrideStageReadiness()} className={`${btnRed} px-3 py-2 flex-1`}>{t({ ar: "تجاوز ومتابعة", en: "Override & continue" })}</button>
              <button onClick={() => setReadyPrompt(null)} className={`${btnGhost} px-3 py-2`}>{t({ ar: "إلغاء", en: "Cancel" })}</button>
            </div>
          </div>
        </div>
      )}
      {printPack && <ProjectPrintPack projectId={projectId} projectName={projectName} onClose={() => setPrintPack(false)} />}
      {toast && <div className="fixed bottom-4 inset-x-4 z-[80] mx-auto max-w-sm bg-stone-800 border border-stone-700 rounded-lg px-4 py-2 text-sm text-stone-100 text-center shadow-lg">{toast}</div>}
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

const ACTIVITY_LABELS: Record<string, string> = {
  stage_changed: "تغيير المرحلة", stage_readiness_override: "تجاوز جاهزية المرحلة", progress_mode_changed: "تغيير طريقة حساب الإنجاز",
  meta_updated: "تحديث الملخّص", task_created: "إنشاء مهمة", task_updated: "تعديل مهمة", task_moved: "نقل مهمة (حالة/ترتيب)",
  task_review: "مراجعة مهمة", task_assigned: "تعيين على مهمة", task_unassigned: "إزالة مشارك", task_deleted: "حذف مهمة",
  task_comment: "تعليق", task_dep_added: "إضافة اعتمادية", task_dep_removed: "إزالة اعتمادية", time_logged: "تسجيل وقت",
  approval_requested: "طلب اعتماد", approval_approved: "اعتماد", approval_rejected: "رفض اعتماد", approval_revision_requested: "طلب تعديل", project_created: "إنشاء المشروع",
};
function activityDesc(a: ActivityEvent): string {
  const d = (a.detail ?? {}) as Record<string, unknown>;
  const s = (v: unknown) => (v == null ? "" : String(v));
  const base = ACTIVITY_LABELS[a.action] ?? a.action;
  switch (a.action) {
    case "stage_changed": return `تغيّرت المرحلة من «${s(d.from)}» إلى «${s(d.to)}»`;
    case "stage_readiness_override": return `تجاوز جاهزية المرحلة إلى «${s(d.to)}»${d.reason ? ` — ${s(d.reason)}` : ""}`;
    case "progress_mode_changed": return `تغيّرت طريقة حساب الإنجاز من «${s(d.from)}» إلى «${s(d.to)}»`;
    case "task_created": return `أُنشئت مهمة${d.title ? `: ${s(d.title)}` : ""}`;
    case "task_moved": return `نُقلت مهمة من «${s(d.from)}» إلى «${s(d.to)}»`;
    case "task_review": return `مراجعة مهمة (${s(d.action)}): «${s(d.from)}» ← «${s(d.to)}»`;
    case "task_dep_added": return `أُضيفت اعتمادية (${s(d.type) || "finish_to_start"})`;
    case "task_dep_removed": return "أُزيلت اعتمادية";
    default: return base;
  }
}
function ActivityTab({ projectId }: { projectId: string }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<ActivityEvent[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [fAction, setFAction] = useState("");
  const [loading, setLoading] = useState(true);
  const load = useCallback(async (before?: string | null, append = false) => {
    setLoading(true);
    const r = await projectActivityFeed(projectId, { before: before ?? null, action: fAction || null, limit: 30 });
    setLoading(false);
    if (!r.ok) return;
    setRows((prev) => append ? [...prev, ...r.data.events] : r.data.events);
    setHasMore(r.data.has_more);
  }, [projectId, fAction]);
  useEffect(() => { void load(null, false); }, [load]);
  const actions = Object.keys(ACTIVITY_LABELS);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <select value={fAction} onChange={(e) => setFAction(e.target.value)} className="bg-stone-800 border border-stone-700 rounded px-2 py-1 text-[11px] text-stone-200" style={{ colorScheme: "dark" }}>
          <option value="">{t({ ar: "كل الأحداث", en: "All events" })}</option>
          {actions.map((a) => <option key={a} value={a}>{ACTIVITY_LABELS[a]}</option>)}
        </select>
      </div>
      {loading && rows.length === 0 && <p className="text-xs text-stone-500">{t({ ar: "جارٍ التحميل…", en: "Loading…" })}</p>}
      {!loading && rows.length === 0 && <p className="text-xs text-stone-500">{t({ ar: "لا يوجد نشاط.", en: "No activity." })}</p>}
      <div className="space-y-1.5">
        {rows.map((a) => (
          <div key={a.id} className={`${card} p-2 text-xs`}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-stone-300" dir="auto">{activityDesc(a)}</span>
              <span className="text-[10px] text-stone-600 shrink-0" dir="ltr">{fmtDT(a.created_at)}</span>
            </div>
            {a.actor && <div className="text-[10px] text-stone-500 mt-0.5">{t({ ar: "بواسطة", en: "by" })} {a.actor}</div>}
          </div>
        ))}
      </div>
      {hasMore && <button disabled={loading} onClick={() => void load(rows[rows.length - 1]?.created_at, true)} className="w-full text-xs text-stone-400 hover:text-white border border-stone-800 rounded-lg py-2">{t({ ar: "تحميل المزيد", en: "Load more" })}</button>}
    </div>
  );
}
