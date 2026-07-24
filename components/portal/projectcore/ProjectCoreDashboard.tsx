"use client";
// ════════════════════════════════════════════════════════════════════════════
// Project Core — لوحة قيادة تفاعلية حقيقية: العدّادات والقائمة من نداء موحّد واحد
// (project_core_dashboard) بنفس شروط الفلترة، كل بطاقة فلتر فعلي، بحث، إنشاء مشروع،
// وكل مشروع يفتح صفحته المستقلة. staff فقط.
// ════════════════════════════════════════════════════════════════════════════
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { usePortal } from "@/components/portal/PortalShell";
import PortfolioSchedule from "./PortfolioSchedule";
import ConflictCenter from "./ConflictCenter";
import PlanningReports from "./PlanningReports";
import ExecutiveDashboard from "./ExecutiveDashboard";
import HierarchyTree from "./HierarchyTree";
import ClosureCenter from "./ClosureCenter";
import TemplateLibrary from "./TemplateLibrary";
import OperationsCenter, { type OpsPanel } from "./OperationsCenter";
import {
  pcDashboard, pcDeletedList, pcRestoreProject, PC_STAGE_LABELS, PRIORITY_LABELS, HEALTH_LABELS, pcErr,
  type DashboardResponse, type DashFilter, type DashRow, type PcStage, type PcPriority, type PcHealth, type DeletedProject,
} from "@/lib/portal/projectCore";
import CreateProjectWizard from "./CreateProjectWizard";
import FastCreateWizard from "./FastCreateWizard";
import { fastlaneQuickProjectIds } from "@/lib/portal/fastlane";
import { NotifyMonitor } from "./NotifyMonitor";

const card = "bg-stone-900 border border-stone-800 rounded-xl";
const HEALTH_CLS: Record<PcHealth, string> = { on_track: "text-emerald-400", at_risk: "text-amber-400", off_track: "text-red-400" };
const PRIO_CLS: Record<PcPriority, string> = { low: "text-stone-400", normal: "text-sky-400", high: "text-amber-400", urgent: "text-red-400" };
const money = (n: number | null | undefined) => n == null ? "—" : new Intl.NumberFormat("en-US").format(Math.round(n));

export default function ProjectCoreDashboard() {
  const { t } = useI18n();
  const { caps } = usePortal();
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [phase, setPhase] = useState<"loading" | "error" | "ready">("loading");
  const [err, setErr] = useState("");
  const [filter, setFilter] = useState<DashFilter>("all");
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [showFast, setShowFast] = useState(false);
  // 8C: مجموعة المشاريع «السريعة» — قراءة واحدة (لا N+1)؛ فشلها يُخفي الشارة فقط.
  const [quickIds, setQuickIds] = useState<Set<string> | null>(null);
  const [onlyQuick, setOnlyQuick] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);
  const [showNotify, setShowNotify] = useState(false);
  const [showPortfolio, setShowPortfolio] = useState(false);
  const [showConflicts, setShowConflicts] = useState(false);
  const [showReports, setShowReports] = useState(false);
  const [showExecutive, setShowExecutive] = useState(false);
  const [showTree, setShowTree] = useState(false);
  const [showClosure, setShowClosure] = useState(false);
  const [showTplLib, setShowTplLib] = useState(false);
  const [showOps, setShowOps] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const flash = useCallback((m: string) => { setToast(m); window.setTimeout(() => setToast(null), 4200); }, []);

  const load = useCallback(async (f: DashFilter, s: string) => {
    setPhase("loading");
    const r = await pcDashboard({ filter: f, search: s || undefined, limit: 200 });
    if (!r.ok) { setErr(pcErr(r.error)); setPhase("error"); return; }
    setData(r.data); setPhase("ready");
    const q = await fastlaneQuickProjectIds();
    setQuickIds(q.ok ? new Set(q.data.map((x) => x.id)) : null);
  }, []);
  useEffect(() => { void load(filter, search); }, [load, filter]);   // البحث عبر زر/Enter

  const c = data?.counters;
  const rows: DashRow[] = data?.rows ?? [];
  // فلترة «السريعة» تُطبَّق على الصفحة المحمّلة فقط — الفلترة الأساسية خادمية.
  const shownRows = onlyQuick && quickIds ? rows.filter((x) => quickIds.has(x.id)) : rows;
  // بطاقات العدّادات — كلها فلاتر فعلية (k مطابق لتعريف الخادم).
  const cards: { k: DashFilter; ar: string; en: string; n: number | null; cls?: string }[] = c ? [
    { k: "all", ar: "إجمالي", en: "Total", n: c.total, cls: "text-white" },
    { k: "active", ar: "نشطة", en: "Active", n: c.active, cls: "text-emerald-400" },
    { k: "planning", ar: "تخطيط", en: "Planning", n: c.planning },
    { k: "ready", ar: "جاهزة", en: "Ready", n: c.ready },
    { k: "scheduled", ar: "مجدولة", en: "Scheduled", n: c.scheduled },
    { k: "in_production", ar: "قيد الإنتاج", en: "In Production", n: c.in_production },
    { k: "post_production", ar: "ما بعد الإنتاج", en: "Post", n: c.post_production },
    { k: "internal_review", ar: "مراجعة داخلية", en: "Internal", n: c.internal_review },
    { k: "awaiting_client", ar: "بانتظار العميل", en: "Awaiting Client", n: c.awaiting_client, cls: "text-sky-400" },
    { k: "revision", ar: "تعديلات", en: "Revision", n: c.revision, cls: "text-amber-400" },
    { k: "near_delivery", ar: "قرب التسليم", en: "Near Delivery", n: c.near_delivery, cls: "text-indigo-400" },
    { k: "overdue", ar: "متأخرة", en: "Overdue", n: c.overdue, cls: "text-red-400" },
    { k: "at_risk", ar: "معرّضة للخطر", en: "At Risk", n: c.at_risk, cls: "text-red-400" },
    { k: "closed", ar: "مغلقة", en: "Closed", n: c.closed, cls: "text-stone-400" },
    { k: "no_manager", ar: "بلا مدير", en: "No Manager", n: c.no_manager },
    { k: "no_due", ar: "بلا موعد", en: "No Due Date", n: c.no_due },
    ...(caps.canSeeFinancials ? [{ k: "negative_profit" as DashFilter, ar: "ربحية سالبة", en: "Negative Profit", n: c.negative_profit, cls: "text-red-400" }] : []),
  ] : [];
  // بطاقات معلوماتية (غير قابلة للفلترة) — تُعرض منفصلة.
  const infoCards: { ar: string; en: string; v: string; cls?: string }[] = c ? [
    { ar: "مهام متأخرة", en: "Overdue Tasks", v: String(c.overdue_tasks), cls: "text-red-400" },
    { ar: "اعتمادات معلّقة", en: "Pending Approvals", v: String(c.pending_approvals), cls: "text-amber-400" },
    { ar: "ساعات الشهر", en: "Hours (month)", v: String(c.hours_month), cls: "text-sky-400" },
    ...(caps.canSeeFinancials ? [
      { ar: "الميزانية", en: "Budget", v: money(c.total_budget) },
      { ar: "التكلفة الفعلية", en: "Actual Cost", v: money(c.actual_cost) },
      { ar: "الربحية المتوقعة", en: "Expected Profit", v: money(c.expected_profit), cls: (c.expected_profit ?? 0) < 0 ? "text-red-400" : "text-emerald-400" },
      { ar: "الربحية الفعلية", en: "Actual Profit", v: money(c.actual_profit), cls: (c.actual_profit ?? 0) < 0 ? "text-red-400" : "text-emerald-400" },
    ] : []),
  ] : [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-lg font-semibold text-white">{t({ ar: "منصّة إدارة المشاريع", en: "Project Core" })}</h2>
        <div className="flex items-center gap-2">
          <button onClick={() => void load(filter, search)} className="text-xs text-stone-400 hover:text-white">↻ {t({ ar: "تحديث", en: "Refresh" })}</button>
          {/* isAdminArea يغطّي المالك (account_type=admin ⇒ caps.isStaff=false محليًّا) مع مطابقة بوابة DB is_staff() */}
          {(caps.isStaff || caps.isAdminArea) && <button onClick={() => setShowOps(true)} className="text-xs text-white hover:bg-red-700 border border-red-700 bg-red-600/90 rounded-lg px-3 py-1.5">{t({ ar: "مركز العمليات", en: "Operations" })}</button>}
          {caps.isAdminArea && <button onClick={() => setShowTree(true)} className="text-xs text-stone-200 hover:text-white border border-violet-800/70 bg-violet-950/30 rounded-lg px-3 py-1.5">{t({ ar: "شجرة المشاريع", en: "Tree" })}</button>}
          {caps.isAdminArea && <button onClick={() => setShowExecutive(true)} className="text-xs text-stone-200 hover:text-white border border-sky-800/70 bg-sky-950/30 rounded-lg px-3 py-1.5">{t({ ar: "الإدارة التنفيذية", en: "Executive" })}</button>}
          {(caps.isAdminArea || caps.isEditor) && <button onClick={() => setShowClosure(true)} className="text-xs text-stone-200 hover:text-white border border-emerald-800/70 bg-emerald-950/30 rounded-lg px-3 py-1.5">{t({ ar: "مركز الإغلاق", en: "Closure" })}</button>}
          {caps.isAdminArea && <button onClick={() => setShowPortfolio(true)} className="text-xs text-stone-400 hover:text-white border border-stone-800 rounded-lg px-3 py-1.5">{t({ ar: "جدولة المشاريع", en: "Portfolio" })}</button>}
          {caps.isAdminArea && <button onClick={() => setShowConflicts(true)} className="text-xs text-stone-400 hover:text-white border border-stone-800 rounded-lg px-3 py-1.5">{t({ ar: "مركز التعارضات", en: "Conflicts" })}</button>}
          {caps.isAdminArea && <button onClick={() => setShowReports(true)} className="text-xs text-stone-400 hover:text-white border border-stone-800 rounded-lg px-3 py-1.5">{t({ ar: "التقارير", en: "Reports" })}</button>}
          {caps.isAdminArea && <button onClick={() => setShowNotify((v) => !v)} className="text-xs text-stone-400 hover:text-white border border-stone-800 rounded-lg px-3 py-1.5">{t({ ar: "مراقبة الإشعارات", en: "Notify Monitor" })}</button>}
          {caps.isAdminArea && <button onClick={() => setShowDeleted(true)} className="text-xs text-stone-400 hover:text-white border border-stone-800 rounded-lg px-3 py-1.5">{t({ ar: "المحذوفة/المؤرشفة", en: "Deleted/Archived" })}</button>}
          {caps.isAdminArea && <button onClick={() => setShowTplLib(true)} className="text-xs text-stone-200 hover:text-white border border-amber-800/70 bg-amber-950/20 rounded-lg px-3 py-1.5">{t({ ar: "من قالب", en: "From template" })}</button>}
          {caps.isAdminArea && <button onClick={() => setShowFast(true)} className="rounded-lg bg-teal-700 hover:bg-teal-600 text-white text-sm font-medium px-4 py-2">⚡ {t({ ar: "مشروع سريع", en: "Quick Project" })}</button>}
          {caps.isAdminArea && <button onClick={() => setShowCreate(true)} className="rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-4 py-2">+ {t({ ar: "إنشاء مشروع", en: "Create Project" })}</button>}
        </div>
      </div>

      {showNotify && caps.isAdminArea && (
        <section className={`${card} p-3`}>
          <h3 className="text-sm font-semibold text-white mb-2">{t({ ar: "مراقبة الإشعارات والبريد", en: "Notifications & Email Monitor" })}</h3>
          <NotifyMonitor flash={flash} />
        </section>
      )}
      {toast && <div className="fixed bottom-4 inset-x-4 z-[80] mx-auto max-w-sm bg-stone-800 border border-stone-700 rounded-lg px-4 py-2 text-sm text-stone-100 text-center shadow-lg">{toast}</div>}

      {/* بحث */}
      <div className="flex gap-2">
        <input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void load(filter, search); }}
          placeholder={t({ ar: "بحث: اسم المشروع / العميل / مدير المشروع…", en: "Search: project / client / manager…" })}
          className="flex-1 bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-200 placeholder:text-stone-600 focus:outline-none focus:ring-2 focus:ring-red-500" />
        <button onClick={() => void load(filter, search)} className="rounded-lg bg-stone-800 border border-stone-700 text-stone-200 text-sm px-4">{t({ ar: "بحث", en: "Search" })}</button>
        {search && <button onClick={() => { setSearch(""); void load(filter, ""); }} className="rounded-lg bg-stone-800 border border-stone-700 text-stone-400 text-sm px-3">✕</button>}
      </div>

      {phase === "error" && <div className={`${card} p-4 text-sm text-red-300`}>{err}</div>}

      {/* عدّادات-فلاتر */}
      {c && (
        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-8 gap-2">
          {cards.map((cd) => (
            <button key={cd.k} onClick={() => setFilter(cd.k as DashFilter)}
              className={`${card} p-2.5 text-right transition ${filter === cd.k ? "ring-2 ring-red-500 border-red-600" : "hover:border-stone-600"}`}>
              <div className={`text-lg font-bold ${cd.cls ?? "text-stone-200"}`}>{cd.n ?? 0}</div>
              <div className="text-[10px] text-stone-500 leading-tight">{t({ ar: cd.ar, en: cd.en })}</div>
            </button>
          ))}
        </div>
      )}
      {/* بطاقات معلوماتية */}
      {infoCards.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-7 gap-2">
          {infoCards.map((cd, i) => (
            <div key={i} className={`${card} p-2.5`}>
              <div className={`text-base font-bold ${cd.cls ?? "text-stone-300"}`}>{cd.v}</div>
              <div className="text-[10px] text-stone-500">{t({ ar: cd.ar, en: cd.en })}</div>
            </div>
          ))}
        </div>
      )}

      {/* 8C: فلتر «السريعة» — يعمل على الصفحة المحمّلة حاليًّا (الفلترة الأساسية خادمية) */}
      {quickIds && quickIds.size > 0 && (
        <div className="flex items-center gap-2 text-xs">
          <button onClick={() => setOnlyQuick((v) => !v)} aria-pressed={onlyQuick}
            className={`px-2.5 py-1 rounded-lg border ${onlyQuick ? "bg-teal-700 border-teal-600 text-white" : "bg-stone-800 border-stone-700 text-stone-300"}`}>
            ⚡ {t({ ar: "المشاريع السريعة", en: "Quick projects" })} ({rows.filter((x) => quickIds.has(x.id)).length})
          </button>
          {onlyQuick && <span className="text-[10px] text-stone-500">{t({ ar: "ضمن القائمة المعروضة", en: "within the loaded list" })}</span>}
        </div>
      )}

      {/* شريط الفلتر النشط */}
      {filter !== "all" && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-stone-400">{t({ ar: "الفلتر:", en: "Filter:" })}</span>
          <span className="px-2 py-0.5 rounded bg-red-900/40 text-red-300">{data?.total_count ?? 0} {t({ ar: "مشروع", en: "projects" })}</span>
          <button onClick={() => setFilter("all")} className="text-stone-400 hover:text-white">✕ {t({ ar: "إلغاء الفلتر", en: "Clear" })}</button>
        </div>
      )}

      {/* القائمة */}
      {phase === "loading" && !data && <p className="text-xs text-stone-500">{t({ ar: "جارٍ التحميل…", en: "Loading…" })}</p>}
      {phase === "ready" && (data?.rows.length ?? 0) === 0 && (
        <div className={`${card} p-8 text-center`}>
          <p className="text-sm text-stone-400">{t({ ar: "لا توجد مشاريع مطابقة لهذا الفلتر.", en: "No projects match this filter." })}</p>
          {caps.isAdminArea && filter === "all" && <button onClick={() => setShowCreate(true)} className="mt-3 rounded-lg bg-red-600 text-white text-sm px-4 py-2">+ {t({ ar: "إنشاء أول مشروع", en: "Create your first project" })}</button>}
        </div>
      )}
      <div className="space-y-1.5">
        {shownRows.map((p) => <ProjectRowCard key={p.id} p={p} canFin={caps.canSeeFinancials} isQuick={quickIds?.has(p.id) ?? false} />)}
      </div>
      {onlyQuick && shownRows.length === 0 && (
        <div className={`${card} p-6 text-center text-sm text-stone-400`}>{t({ ar: "لا مشاريع سريعة في القائمة المعروضة.", en: "No quick projects in the loaded list." })}</div>
      )}

      {showCreate && <CreateProjectWizard onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); void load(filter, search); }} />}
      {/* 8C: onCreated يُحدّث القائمة فقط — إغلاق النافذة هنا كان يُفكّك المعالج
          قبل أن تُرسم شاشة النجاح وتحذيرُها، فيتحوّل نجاح جزئيّ إلى نجاح تامّ صامت. */}
      {showFast && <FastCreateWizard onClose={() => setShowFast(false)} onCreated={() => { void load(filter, search); }} />}
      {showDeleted && <DeletedProjectsModal canRestore={caps.isOwner} onClose={() => setShowDeleted(false)} onRestored={() => void load(filter, search)} />}
      {showExecutive && <ExecutiveDashboard onClose={() => setShowExecutive(false)} />}
      {showTree && <HierarchyTree onClose={() => setShowTree(false)} />}
      {showOps && <OperationsCenter onClose={() => setShowOps(false)} onNavigate={(p: OpsPanel) => {
        if (p === "executive") setShowExecutive(true);
        else if (p === "closure") setShowClosure(true);
        else if (p === "conflicts") setShowConflicts(true);
        else if (p === "templates") setShowTplLib(true);
        else if (p === "create") setShowCreate(true);
      }} />}
      {showClosure && <ClosureCenter onClose={() => { setShowClosure(false); void load(filter, search); }} />}
      {showTplLib && <TemplateLibrary onClose={() => setShowTplLib(false)} onCreated={() => { setShowTplLib(false); void load(filter, search); }} />}
      {showPortfolio && <PortfolioSchedule onClose={() => setShowPortfolio(false)} />}
      {showConflicts && <ConflictCenter onClose={() => setShowConflicts(false)} />}
      {showReports && <PlanningReports onClose={() => setShowReports(false)} />}
    </div>
  );
}

function DeletedProjectsModal({ canRestore, onClose, onRestored }: { canRestore: boolean; onClose: () => void; onRestored: () => void }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<DeletedProject[]>([]);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { const r = await pcDeletedList(); if (r.ok) { setRows(r.data); setPhase("ready"); } else setPhase("error"); }, []);
  useEffect(() => { void load(); }, [load]);
  async function restore(p: DeletedProject) {
    if (busy) return;
    const reason = window.prompt(t({ ar: "سبب الاستعادة (اختياري):", en: "Restore reason (optional):" }));
    if (reason === null) return;
    setBusy(true); const r = await pcRestoreProject(p.id, reason.trim() || undefined); setBusy(false);
    if (!r.ok) { window.alert(pcErr(r.error)); return; }
    await load(); onRestored();
  }
  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/70 p-3 sm:p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-lg my-4 bg-stone-950 border border-stone-800 rounded-2xl shadow-2xl" dir="rtl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-stone-800">
          <h3 className="text-sm font-semibold text-white">{t({ ar: "المشاريع المحذوفة والمؤرشفة", en: "Deleted & Archived" })}</h3>
          <button onClick={onClose} className="text-stone-400 hover:text-white text-sm">✕</button>
        </div>
        <div className="p-4 space-y-2">
          {phase === "loading" && <p className="text-xs text-stone-500">{t({ ar: "جارٍ التحميل…", en: "Loading…" })}</p>}
          {phase === "ready" && rows.length === 0 && <p className="text-xs text-stone-500">{t({ ar: "لا توجد مشاريع محذوفة أو مؤرشفة.", en: "None." })}</p>}
          {rows.map((p) => (
            <div key={p.id} className={`${card} p-3 flex items-center justify-between gap-2`}>
              <div className="min-w-0">
                <div className="text-sm text-stone-200 truncate" dir="auto">{p.project_name || p.id.slice(0, 8)}</div>
                <div className="text-[11px] text-stone-500">
                  <span className={p.kind === "archived" ? "text-amber-400" : "text-red-400"}>{p.kind === "archived" ? t({ ar: "مؤرشف", en: "Archived" }) : t({ ar: "محذوف", en: "Deleted" })}</span>
                  {p.client_name ? ` · ${p.client_name}` : ""}{p.reason ? ` · ${p.reason}` : ""}
                </div>
              </div>
              {canRestore && <button disabled={busy} onClick={() => void restore(p)} className="text-xs rounded-lg bg-stone-800 border border-stone-700 text-emerald-300 px-3 py-1.5 shrink-0 disabled:opacity-50">{t({ ar: "استعادة", en: "Restore" })}</button>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ProjectRowCard({ p, canFin, isQuick }: { p: DashRow; canFin: boolean; isQuick: boolean }) {
  const { t } = useI18n();
  const overdue = p.days_remaining != null && p.days_remaining < 0 && p.stage !== "closed" && p.stage !== "delivered";
  return (
    <Link href={`/client-portal/project-core/${p.id}`} className={`${card} p-3 block hover:border-stone-600 transition`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm text-stone-100 truncate" dir="auto">{p.project_name || t({ ar: "بلا اسم", en: "Untitled" })}</div>
          <div className="text-[11px] text-stone-500 truncate">{p.client_name || t({ ar: "بلا عميل", en: "No client" })}{p.manager_name ? ` · ${t({ ar: "مدير", en: "PM" })}: ${p.manager_name}` : ` · ${t({ ar: "بلا مدير", en: "no PM" })}`}</div>
          <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px]">
            <span className="px-1.5 py-0.5 rounded bg-stone-800 text-stone-300">{t(PC_STAGE_LABELS[p.stage])}</span>
            {isQuick && <span className="px-1.5 py-0.5 rounded bg-teal-900/50 text-teal-300">⚡ {t({ ar: "سريع", en: "Quick" })}</span>}
            <span className={PRIO_CLS[p.priority]}>{t(PRIORITY_LABELS[p.priority])}</span>
            <span className={HEALTH_CLS[p.health]}>● {t(HEALTH_LABELS[p.health])}</span>
            {p.due_date && <span className={overdue ? "text-red-400" : "text-stone-500"} dir="ltr">⏱ {p.due_date}{p.days_remaining != null ? ` (${p.days_remaining}${t({ ar: "ي", en: "d" })})` : ""}</span>}
            {p.open_tasks > 0 && <span className="text-stone-400">{p.open_tasks} {t({ ar: "مهمة", en: "tasks" })}{p.overdue_tasks > 0 ? ` · ${p.overdue_tasks} ${t({ ar: "متأخرة", en: "overdue" })}` : ""}</span>}
            {p.pending_approvals > 0 && <span className="text-amber-400">{p.pending_approvals} {t({ ar: "اعتماد معلّق", en: "approvals" })}</span>}
            {canFin && p.profit != null && <span className={p.profit < 0 ? "text-red-400" : "text-emerald-400"} dir="ltr">{new Intl.NumberFormat("en-US").format(Math.round(p.profit))}</span>}
          </div>
        </div>
        <div className="shrink-0 text-left">
          <div className="text-xs text-stone-400" dir="ltr">{p.progress_pct}%</div>
          <div className="w-16 h-1.5 bg-stone-800 rounded mt-1 overflow-hidden"><div className="h-full bg-red-600" style={{ width: `${p.progress_pct}%` }} /></div>
        </div>
      </div>
    </Link>
  );
}
