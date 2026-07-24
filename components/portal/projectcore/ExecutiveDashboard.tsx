"use client";
// ════════════════════════════════════════════════════════════════════════════
// ExecutiveDashboard — Phase 5B. «لوحة الإدارة التنفيذية» على مستوى الشركة.
// بيانات حقيقية عبر executive_* RPCs (نداء واحد للنظرة العامة، بلا N+1؛ معزول per-project
// عبر pc_can_read_project في الخادم؛ مالية مقنّعة). تبويبات، Drill-down، CSV عربي، Mobile cards،
// نص الحالة (لا لون فقط). staff/الإدارة حسب الصلاحية — الزر مخفي والخادم يفرض exec_can أيضًا.
// ════════════════════════════════════════════════════════════════════════════
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { csvDownload } from "@/lib/portal/csv";
import { HEALTH_LABELS } from "@/lib/portal/projectCore";
import {
  executivePortfolioDashboard, executivePortfolioRisksIssues, executivePortfolioApprovals,
  executivePortfolioChangeControl, executiveDataQualityReport, executivePortfolioTrends,
  EXEC_STATUS, AXIS_LABELS, execErr,
  type ExecPortfolio, type ExecScorecard, type ExecStatus, type ExecReason,
} from "@/lib/portal/executive";
import { executiveProgramSla, slaErr, type ExecutiveProgramSla } from "@/lib/portal/programSla";

type Tab = "overview" | "risks" | "approvals" | "changes" | "sla" | "quality";
const card = "bg-stone-900 border border-stone-800 rounded-xl";
const TABS: { k: Tab; ar: string; en: string }[] = [
  { k: "overview", ar: "نظرة عامة", en: "Overview" }, { k: "risks", ar: "المخاطر والمشكلات", en: "Risks & Issues" },
  { k: "approvals", ar: "الاعتمادات", en: "Approvals" }, { k: "changes", ar: "طلبات التغيير", en: "Changes" },
  { k: "sla", ar: "التزامات البرامج", en: "Program SLA" },
  { k: "quality", ar: "جودة البيانات", en: "Data quality" },
];

function StatusChip({ s }: { s: ExecStatus }) {
  const m = EXEC_STATUS[s] ?? EXEC_STATUS.unavailable;
  return <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ background: m.color + "22", color: m.color }}>{m.ar}</span>;
}
const rzn = (r: ExecReason) => r.ar || r.en || r.type || r.key || "";

export default function ExecutiveDashboard({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("overview");
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-start justify-center overflow-auto p-2 sm:p-4" onClick={onClose}>
      <div className="w-full max-w-6xl bg-stone-950 border border-stone-800 rounded-2xl my-2" dir="rtl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-3 border-b border-stone-800 sticky top-0 bg-stone-950 z-10">
          <h3 className="text-sm font-semibold text-stone-100">{t({ ar: "الإدارة التنفيذية", en: "Executive Management" })}</h3>
          <button onClick={onClose} className="text-stone-400 hover:text-white text-lg" aria-label={t({ ar: "إغلاق", en: "Close" })}>✕</button>
        </div>
        <div className="flex gap-1 px-3 pt-2 border-b border-stone-800 overflow-x-auto" role="tablist">
          {TABS.map((x) => (
            <button key={x.k} role="tab" aria-selected={tab === x.k} onClick={() => setTab(x.k)}
              className={`text-[11px] px-3 py-1.5 rounded-t-lg whitespace-nowrap ${tab === x.k ? "bg-stone-800 text-white" : "text-stone-400 hover:text-white"}`}>
              {t({ ar: x.ar, en: x.en })}
            </button>
          ))}
        </div>
        <div className="p-3">
          {tab === "overview" && <Overview />}
          {tab === "risks" && <RisksTab />}
          {tab === "approvals" && <ApprovalsTab />}
          {tab === "changes" && <ChangesTab />}
          {tab === "sla" && <ProgramSlaExecTab />}
          {tab === "quality" && <QualityTab />}
        </div>
      </div>
    </div>
  );
}

// ─── هوك تحميل موحّد (reqSeq + unmount + timeout) ───
function useLoader<T>(fn: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [phase, setPhase] = useState<"loading" | "error" | "ready">("loading");
  const [err, setErr] = useState("");
  const reqSeq = useRef(0); const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  const run = useCallback(async () => {
    const my = ++reqSeq.current; setPhase("loading"); setErr("");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const r = await Promise.race([fn(), new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error("exec_timeout")), 20000); })]);
      if (!mountedRef.current || my !== reqSeq.current) return;
      if (!r.ok) { if (process.env.NODE_ENV !== "production") console.error("[executive]", r.error); setErr(execErr(r.error)); setPhase("error"); return; }
      setData(r.data); setPhase("ready");
    } catch (e) {
      if (!mountedRef.current || my !== reqSeq.current) return;
      setErr(e instanceof Error && e.message === "exec_timeout" ? "انتهت المهلة." : execErr(String(e))); setPhase("error");
    } finally { if (timer) clearTimeout(timer); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { void run(); }, [run]);
  return { data, phase, err, reload: run };
}

function Shell({ phase, err, reload, children }: { phase: string; err: string; reload: () => void; children: React.ReactNode }) {
  const { t } = useI18n();
  if (phase === "loading") return <p className="text-xs text-stone-500 py-8 text-center">{t({ ar: "جارٍ التحميل…", en: "Loading…" })}</p>;
  if (phase === "error") return (
    <div className="py-8 text-center space-y-2">
      <p className="text-sm text-red-300">{err || t({ ar: "تعذّر التحميل.", en: "Failed to load." })}</p>
      <button onClick={reload} className="text-xs text-stone-200 bg-stone-800 border border-stone-700 rounded-lg px-4 py-2">{t({ ar: "إعادة", en: "Retry" })}</button>
    </div>
  );
  return <>{children}</>;
}

// ─── نظرة عامة ───
function Overview() {
  const { t } = useI18n();
  const { data, phase, err, reload } = useLoader<ExecPortfolio>(() => executivePortfolioDashboard({ limit: 24 }), []);
  const { data: trends } = useLoader(() => executivePortfolioTrends({ period_type: "weekly" }), []);
  return (
    <Shell phase={phase} err={err} reload={reload}>
      {data && <OverviewBody d={data} trendsNote={trends && !trends.history_available ? (trends.note_ar || "") : ""} />}
    </Shell>
  );
}

function OverviewBody({ d, trendsNote }: { d: ExecPortfolio; trendsNote: string }) {
  const { t } = useI18n();
  const s = d.summary;
  const completion = s.total_visible > 0 ? Math.round((s.delivered_or_closed / s.total_visible) * 100) : null; // denominator=0 ⇒ null
  const cards: { ar: string; n: number | string; c?: string }[] = [
    { ar: "مشاريع نشطة", n: s.total_active, c: "#16a34a" }, { ar: "متأخرة", n: s.overdue, c: "#dc2626" },
    { ar: "قريبة التسليم", n: s.near_delivery, c: "#d97706" }, { ar: "مسلّمة/مغلقة", n: s.delivered_or_closed },
    { ar: "بلا مدير", n: s.no_manager, c: s.no_manager > 0 ? "#d97706" : undefined }, { ar: "بلا تاريخ نهاية", n: s.no_due_date, c: s.no_due_date > 0 ? "#d97706" : undefined },
    { ar: "مخاطر حرجة", n: d.risk_summary.available ? d.risk_summary.critical_risks : "—", c: "#dc2626" },
    { ar: "مشكلات حرجة", n: d.risk_summary.available ? d.risk_summary.critical_issues : "—", c: "#dc2626" },
    { ar: "اعتمادات متأخرة", n: d.approval_summary.available ? d.approval_summary.overdue : "—", c: "#d97706" },
    { ar: "تغييرات معلّقة", n: d.change_request_summary.available ? d.change_request_summary.pending_approval : "—", c: "#0891b2" },
    { ar: "نسبة الإنجاز", n: completion === null ? "غير متاح" : completion + "%" },
    { ar: "مشاريع فرعية", n: s.subprojects },
  ];
  return (
    <div className="space-y-4">
      {d.warnings.length > 0 && (
        <div className="border border-amber-900/50 bg-amber-950/20 rounded-lg p-2 space-y-0.5">
          {d.warnings.map((w, i) => <p key={i} className="text-[10px] text-amber-300">⚠ {rzn(w)}</p>)}
        </div>
      )}
      {trendsNote && <p className="text-[10px] text-stone-500">📈 {trendsNote}</p>}

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
        {cards.map((c, i) => (
          <div key={i} className={`${card} p-2.5`}>
            <div className="text-lg font-bold" style={{ color: c.c || "#e7e5e4" }}>{c.n}</div>
            <div className="text-[10px] text-stone-500">{c.ar}</div>
          </div>
        ))}
      </div>

      {/* توزيع صحّة التنفيذ (نص + عدد، لا لون فقط) */}
      <section className="space-y-1">
        <h4 className="text-xs font-semibold text-stone-300">{t({ ar: "توزيع الصحّة", en: "Health distribution" })}</h4>
        <div className="flex flex-wrap gap-2">
          {Object.entries(s.health_distribution).map(([k, n]) => (
            <span key={k} className="text-[11px] px-2 py-0.5 rounded border border-stone-800 text-stone-300">{HEALTH_LABELS[k as keyof typeof HEALTH_LABELS] ? t(HEALTH_LABELS[k as keyof typeof HEALTH_LABELS]) : (k === "unknown" ? t({ ar: "غير محدّد", en: "Unknown" }) : k)}: <b>{n}</b></span>
          ))}
          {Object.keys(s.health_distribution).length === 0 && <span className="text-[11px] text-stone-500">{t({ ar: "لا بيانات.", en: "No data." })}</span>}
        </div>
      </section>

      {/* المشاريع الحرجة/بطاقات الأداء */}
      <section className="space-y-1">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold text-stone-300">{t({ ar: "بطاقات أداء المشاريع", en: "Project scorecards" })} ({d.project_scorecards.length}{d.pagination.total > d.pagination.limit ? ` / ${d.pagination.total}` : ""})</h4>
          <button onClick={() => exportScorecards(d.project_scorecards)} className="text-[10px] text-sky-400 hover:text-sky-300">CSV</button>
        </div>
        {d.project_scorecards.length === 0 && <p className="text-[11px] text-stone-500">{t({ ar: "لا مشاريع مرئية.", en: "No visible projects." })}</p>}
        <div className="space-y-1.5">
          {d.project_scorecards.map((sc) => <ScorecardRow key={sc.project_id} sc={sc} />)}
        </div>
        {d.pagination.total > d.pagination.limit && <p className="text-[10px] text-stone-600">{t({ ar: `عُرِضت ${d.pagination.limit} من ${d.pagination.total}.`, en: `Showing ${d.pagination.limit} of ${d.pagination.total}.` })}</p>}
      </section>
    </div>
  );
}

function ScorecardRow({ sc }: { sc: ExecScorecard }) {
  const [open, setOpen] = useState(false);
  const axes = Object.entries(sc.axes) as [string, ExecScorecard["axes"]["execution"]][];
  return (
    <div className={`${card} p-2`}>
      <div className="flex items-center gap-2 flex-wrap">
        <StatusChip s={sc.overall_status} />
        <Link href={`/client-portal/project-core/${sc.project_id}`} className="text-[12px] text-stone-100 hover:text-sky-300 truncate max-w-[240px]" dir="auto">
          {sc.project_name || `${sc.project_id.slice(0, 8)}…`} {sc.is_subproject && <span className="text-[8px] text-stone-500">فرعي</span>}
        </Link>
        {sc.core_stage && <span className="text-[10px] text-stone-500">{sc.core_stage}</span>}
        {sc.effective_progress != null && <span className="text-[10px] text-stone-400">{sc.effective_progress}%</span>}
        <button onClick={() => setOpen((o) => !o)} className="text-[10px] text-stone-500 hover:text-white ms-auto">{open ? "▲" : "▼"}</button>
      </div>
      {/* المحاور: نص الحالة + الدرجة (لا لون فقط) */}
      <div className="flex flex-wrap gap-1.5 mt-1.5">
        {axes.map(([k, ax]) => (
          <span key={k} className="text-[9px] px-1.5 py-0.5 rounded border border-stone-800 text-stone-400">
            {AXIS_LABELS[k]?.ar ?? k}: <b style={{ color: (EXEC_STATUS[ax.status] ?? EXEC_STATUS.unavailable).color }}>{(EXEC_STATUS[ax.status] ?? EXEC_STATUS.unavailable).ar}</b>{ax.score != null ? ` ${ax.score}` : ""}
          </span>
        ))}
      </div>
      {open && (
        <div className="mt-2 border-t border-stone-800 pt-1.5 space-y-1">
          {axes.map(([k, ax]) => (ax.reasons && ax.reasons.length > 0) ? (
            <div key={k} className="text-[10px]">
              <span className="text-stone-400">{AXIS_LABELS[k]?.ar ?? k}:</span>
              {ax.reasons.slice(0, 4).map((r, i) => <span key={i} className="text-stone-500"> · {rzn(r)}</span>)}
            </div>
          ) : null)}
          {sc.data_quality_warnings.length > 0 && <p className="text-[10px] text-amber-400/80">⚠ {sc.data_quality_warnings.map(rzn).join(" · ")}</p>}
        </div>
      )}
    </div>
  );
}

function exportScorecards(rows: ExecScorecard[]) {
  const header = ["project_id", "المشروع", "الحالة", "المرحلة", "الإنجاز%", "التنفيذ", "الجدول", "الموارد", "الحوكمة", "الجودة", "الجاهزية", "تاريخ التصدير"];
  const now = new Date().toISOString();
  csvDownload("executive_scorecards", [header, ...rows.map((s) => [
    s.project_id, s.project_name ?? "", EXEC_STATUS[s.overall_status]?.ar ?? s.overall_status, s.core_stage ?? "", s.effective_progress ?? "",
    EXEC_STATUS[s.axes.execution.status]?.ar ?? "", EXEC_STATUS[s.axes.schedule.status]?.ar ?? "", EXEC_STATUS[s.axes.resources.status]?.ar ?? "",
    EXEC_STATUS[s.axes.governance.status]?.ar ?? "", EXEC_STATUS[s.axes.quality.status]?.ar ?? "", EXEC_STATUS[s.axes.delivery_readiness.status]?.ar ?? "", now,
  ])]);
}

// ─── المخاطر والمشكلات ───
function RisksTab() {
  const { t } = useI18n();
  const { data, phase, err, reload } = useLoader(() => executivePortfolioRisksIssues({}), []);
  return (
    <Shell phase={phase} err={err} reload={reload}>
      {data && !data.available && <p className="text-[11px] text-stone-500">{t({ ar: "وحدة الحوكمة (5A) غير مطبّقة.", en: "Governance (5A) not applied." })}</p>}
      {data && data.available && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-stone-400">{t({ ar: "مخاطر حرجة", en: "Critical risks" })}: <b className="text-red-400">{data.critical_risks}</b> · {t({ ar: "مشكلات حرجة", en: "Critical issues" })}: <b className="text-red-400">{data.critical_issues}</b></p>
            {data.rows.length > 0 && <button onClick={() => csvExport("executive_risks_issues", data.rows)} className="text-[10px] text-sky-400">CSV</button>}
          </div>
          {data.rows.length === 0 && <p className="text-[11px] text-stone-500">{t({ ar: "لا عناصر.", en: "None." })}</p>}
          {data.rows.map((r) => (
            <div key={`${r.kind}-${r.id}`} className={`${card} p-2 flex items-center gap-2 flex-wrap text-[11px]`}>
              <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: r.severity === "critical" ? "#dc262622" : "#78716c22", color: r.severity === "critical" ? "#dc2626" : "#a8a29e" }}>{r.kind === "risk" ? "مخاطرة" : "مشكلة"} · {r.severity}</span>
              <Link href={`/client-portal/project-core/${r.project_id}`} className="text-stone-100 hover:text-sky-300 truncate max-w-[220px]" dir="auto">{r.title}</Link>
              <span className="text-stone-500 truncate max-w-[140px]">{r.project_name}</span>
              {r.risk_score != null && <span className="text-stone-500">score {r.risk_score}</span>}
              <span className="text-stone-600">{r.status}</span>
              <span className="text-stone-600 ms-auto">{r.age_days}d</span>
            </div>
          ))}
        </div>
      )}
    </Shell>
  );
}

// ─── الاعتمادات ───
function ApprovalsTab() {
  const { t } = useI18n();
  const { data, phase, err, reload } = useLoader(() => executivePortfolioApprovals({}), []);
  return (
    <Shell phase={phase} err={err} reload={reload}>
      {data && !data.available && <p className="text-[11px] text-stone-500">{t({ ar: "وحدة الحوكمة (5A) غير مطبّقة.", en: "Governance (5A) not applied." })}</p>}
      {data && data.available && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-stone-400">{t({ ar: "معلّقة", en: "Pending" })}: <b>{data.pending}</b> · {t({ ar: "متأخرة", en: "Overdue" })}: <b className="text-amber-400">{data.overdue}</b></p>
            {data.rows.length > 0 && <button onClick={() => csvExport("executive_approvals", data.rows)} className="text-[10px] text-sky-400">CSV</button>}
          </div>
          {data.rows.length === 0 && <p className="text-[11px] text-stone-500">{t({ ar: "لا اعتمادات.", en: "None." })}</p>}
          {data.rows.map((a) => (
            <div key={a.id} className={`${card} p-2 flex items-center gap-2 flex-wrap text-[11px]`}>
              {a.overdue && <span className="text-red-400 text-[9px]">{t({ ar: "متأخر", en: "overdue" })}</span>}
              <Link href={`/client-portal/project-core/${a.project_id}`} className="text-stone-100 hover:text-sky-300 truncate max-w-[200px]" dir="auto">{a.title ?? a.approval_type}</Link>
              <span className="text-stone-500">{a.approval_type} · {a.kind}</span>
              <span className="text-stone-500 truncate max-w-[130px]">{a.project_name}</span>
              <span className="text-stone-600">{a.status}</span>
            </div>
          ))}
        </div>
      )}
    </Shell>
  );
}

// ─── طلبات التغيير ───
function ChangesTab() {
  const { t } = useI18n();
  const { data, phase, err, reload } = useLoader(() => executivePortfolioChangeControl({}), []);
  return (
    <Shell phase={phase} err={err} reload={reload}>
      {data && !data.available && <p className="text-[11px] text-stone-500">{t({ ar: "وحدة الحوكمة (5A) غير مطبّقة.", en: "Governance (5A) not applied." })}</p>}
      {data && data.available && (
        <div className="space-y-2">
          <div className="flex items-center justify-between flex-wrap gap-1">
            <p className="text-[11px] text-stone-400">
              {t({ ar: "مفتوحة", en: "Open" })}: <b>{data.open}</b> · {t({ ar: "بانتظار الاعتماد", en: "Pending" })}: <b>{data.pending_approval}</b> · {t({ ar: "قيد التنفيذ", en: "Implementing" })}: <b>{data.implementing}</b> · {t({ ar: "أثر الجدول", en: "Sched impact" })}: <b>{data.schedule_impact_total}d</b>
            </p>
            {data.rows.length > 0 && <button onClick={() => csvExport("executive_changes", data.rows)} className="text-[10px] text-sky-400">CSV</button>}
          </div>
          {data.rows.length === 0 && <p className="text-[11px] text-stone-500">{t({ ar: "لا طلبات.", en: "None." })}</p>}
          {data.rows.map((c) => (
            <div key={c.id} className={`${card} p-2 flex items-center gap-2 flex-wrap text-[11px]`}>
              <span className="text-stone-500">{c.request_no}</span>
              <Link href={`/client-portal/project-core/${c.project_id}`} className="text-stone-100 hover:text-sky-300 truncate max-w-[200px]" dir="auto">{c.project_name}</Link>
              <span className="text-stone-500">{c.change_type} · {c.priority}</span>
              <span className="text-stone-600">{c.status}</span>
              {c.schedule_impact_days != null && <span className="text-amber-400/80">{c.schedule_impact_days}d</span>}
              <span className="text-stone-600 ms-auto">{c.age_days}d</span>
            </div>
          ))}
          <p className="text-[9px] text-stone-600">{t({ ar: "الأثر المالي مرجع فقط — لا يُجمَّع كقيمة مالية.", en: "Financial impact is reference-only." })}</p>
        </div>
      )}
    </Shell>
  );
}

// ─── جودة البيانات ───
function QualityTab() {
  const { t } = useI18n();
  const { data, phase, err, reload } = useLoader(() => executiveDataQualityReport({}), []);
  return (
    <Shell phase={phase} err={err} reload={reload}>
      {data && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-stone-400">{t({ ar: "مشاريع بها ملاحظات جودة", en: "Projects with data-quality issues" })}: <b>{data.count}</b></p>
            {data.rows.length > 0 && <button onClick={() => csvExport("executive_data_quality", data.rows.map((r) => ({ project_id: r.project_id, project_name: r.project_name, issues: (r.issues || []).join(" | ") })))} className="text-[10px] text-sky-400">CSV</button>}
          </div>
          {data.rows.length === 0 && <p className="text-[11px] text-emerald-400">{t({ ar: "لا ملاحظات — البيانات مكتملة.", en: "No issues." })}</p>}
          {data.rows.map((r) => (
            <div key={r.project_id} className={`${card} p-2 flex items-center gap-2 flex-wrap text-[11px]`}>
              <Link href={`/client-portal/project-core/${r.project_id}`} className="text-stone-100 hover:text-sky-300 truncate max-w-[220px]" dir="auto">{r.project_name}</Link>
              {(r.issues || []).map((iss, i) => <span key={i} className="text-[9px] px-1.5 py-0.5 rounded bg-amber-950/40 text-amber-300">{iss}</span>)}
            </div>
          ))}
          <p className="text-[9px] text-stone-600">{t({ ar: "لا إصلاح تلقائي — افتح المشروع لمعالجة الملاحظة.", en: "No auto-fix — open the project to resolve." })}</p>
        </div>
      )}
    </Shell>
  );
}

function csvExport(name: string, rows: readonly object[]) {
  if (!rows.length) return;
  const objs = rows as readonly Record<string, unknown>[];
  const keys = Object.keys(objs[0]);
  csvDownload(name, [[...keys, "exported_at"], ...objs.map((r) => [...keys.map((k) => { const v = r[k]; return v == null ? "" : typeof v === "boolean" ? String(v) : (v as string | number); }), new Date().toISOString()])]);
}

// ════════════════ 8D: قسم معلوماتيّ — لا يدخل في أيّ Score تنفيذيّ ════════════════
function ProgramSlaExecTab() {
  const { t } = useI18n();
  const [d, setD] = useState<ExecutiveProgramSla | null>(null);
  const [phase, setPhase] = useState<"loading" | "error" | "ready">("loading");
  const [err, setErr] = useState("");
  const seq = useRef(0); const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const load = useCallback(async () => {
    const my = ++seq.current; setPhase("loading"); setErr("");
    const r = await executiveProgramSla({});
    if (!alive.current || my !== seq.current) return;
    if (!r.ok) { setErr(slaErr(r.error)); setPhase("error"); return; }
    setD(r.data); setPhase("ready");
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (phase === "loading") return <p className="text-xs text-stone-500 py-8 text-center">{t({ ar: "جارٍ التحميل…", en: "Loading…" })}</p>;
  if (phase === "error") return (
    <div className="py-8 text-center space-y-2" role="alert">
      <p className="text-sm text-red-300">{err}</p>
      <button onClick={() => void load()} className="text-xs text-stone-200 bg-stone-800 border border-stone-700 rounded-lg px-4 py-2">{t({ ar: "إعادة المحاولة", en: "Retry" })}</button>
    </div>
  );
  if (!d) return null;
  const cards: { ar: string; v: string; c?: string }[] = [
    { ar: "برامج ضمن الهدف", v: String(d.programs_on_target), c: "#16a34a" },
    { ar: "برامج بتحذير", v: String(d.programs_warning), c: "#d97706" },
    { ar: "برامج مخروقة", v: String(d.programs_breached), c: "#dc2626" },
    { ar: "برامج بلا بيانات SLA", v: String(d.programs_missing_sla_data), c: "#78716c" },
    { ar: "نسبة التسليم في الموعد",
      v: d.on_time_delivery_rate == null ? "غير متاح" : `${d.on_time_delivery_rate}٪`,
      c: d.on_time_delivery_rate == null ? "#78716c" : "#0ea5e9" },
    { ar: "وحدات سُلِّمت هذا الشهر", v: String(d.units_delivered_this_month) },
    { ar: "بانتظار إجراء العميل", v: String(d.client_pending_actions), c: "#0ea5e9" },
    { ar: "إجمالي البرامج", v: String(d.programs_total) },
  ];
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {cards.map((c, i) => (
          <div key={i} className={`${card} p-2.5`}>
            <div className="text-lg font-bold" style={{ color: c.c ?? "#e7e5e4" }}>{c.v}</div>
            <div className="text-[10px] text-stone-500 leading-tight">{c.ar}</div>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-stone-600">
        {d.score_note} · {t({ ar: "حجم عيّنة التسليم في الموعد", en: "on-time sample" })}: {d.on_time_sample_size} ·
        {" "}{t({ ar: "الشهر من", en: "month from" })} <span dir="ltr">{d.month_from}</span>
      </p>
    </div>
  );
}
