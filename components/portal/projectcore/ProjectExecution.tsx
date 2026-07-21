"use client";
// ════════════════════════════════════════════════════════════════════════════
// Project Core — تبويب «التنفيذ» (Batch 3C). المصدر الواحد للنسبة المعروضة عبر
// project_execution_dashboard (استدعاء مركزي واحد، بلا N+1) + project_alerts.
// يعرض: النسبة الفعّالة حسب وضع التقدم، صحة المشروع (score+أسباب)، العدّادات، الساعات،
// عبء الفريق، مركز التنبيهات (فلتر+تصدير CSV)، والتحكم في وضع حساب الإنجاز.
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { csvDownload } from "@/lib/portal/csv";
import {
  projectExecutionDashboard, projectAlerts, projectCoreSetProgressMode, pcErr,
  PROGRESS_MODE_LABELS, HEALTH_STATUS_LABELS,
  type ExecutionDashboard, type ProjectAlert, type ProgressMode,
} from "@/lib/portal/projectCore";

const card = "bg-stone-900 border border-stone-800 rounded-xl";
const MODES: ProgressMode[] = ["lifecycle", "tasks", "hybrid", "manual"];
const SEV_CLS: Record<string, string> = { critical: "text-red-400", at_risk: "text-orange-400", attention: "text-amber-400", info: "text-sky-400" };

export default function ProjectExecution({ projectId, canManage, flash }: { projectId: string; canManage: boolean; flash: (m: string) => void }) {
  const { t } = useI18n();
  const [d, setD] = useState<ExecutionDashboard | null>(null);
  const [alerts, setAlerts] = useState<ProjectAlert[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [savingMode, setSavingMode] = useState(false);
  const [fSev, setFSev] = useState(""); const [fType, setFType] = useState("");

  const load = useCallback(async () => {
    const [dash, al] = await Promise.all([projectExecutionDashboard(projectId), projectAlerts(projectId)]);
    if (dash.ok) { setD(dash.data); setErr(null); } else setErr(pcErr(dash.error));
    if (al.ok) setAlerts(al.data.alerts);
  }, [projectId]);
  useEffect(() => { void load(); }, [load]);

  async function setMode(mode: ProgressMode) {
    if (savingMode || mode === d?.progress.progress_mode) return;
    setSavingMode(true);
    const r = await projectCoreSetProgressMode(projectId, mode);
    setSavingMode(false);
    if (!r.ok) { flash(pcErr(r.error)); return; }
    flash(t({ ar: "تم تحديث طريقة حساب الإنجاز.", en: "Progress mode updated." })); await load();
  }

  const filteredAlerts = useMemo(() => alerts.filter((a) => (!fSev || a.severity === fSev) && (!fType || a.type === fType)), [alerts, fSev, fType]);
  const alertTypes = useMemo(() => Array.from(new Set(alerts.map((a) => a.type))), [alerts]);
  function exportAlerts() {
    const rows: (string | number | null)[][] = [[t({ ar: "النوع", en: "Type" }), t({ ar: "الخطورة", en: "Severity" }), t({ ar: "المهمة", en: "Task" }), t({ ar: "الاستحقاق", en: "Due" })]];
    for (const a of filteredAlerts) rows.push([a.type, a.severity, a.title, a.due]);
    csvDownload(`alerts_${projectId.slice(0, 8)}`, rows);
  }

  if (err) return <div className={`${card} p-4 text-sm text-red-300`}>{err}</div>;
  if (!d) return <p className="text-xs text-stone-500">{t({ ar: "جارٍ التحميل…", en: "Loading…" })}</p>;

  const p = d.progress; const h = d.health; const hl = HEALTH_STATUS_LABELS[h.status];
  const variance = Math.round((d.hours.logged - d.hours.estimated) * 10) / 10;

  return (
    <div className="space-y-4">
      {/* النسبة الفعّالة + وضع التقدم */}
      <div className={`${card} p-4`}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-stone-500">{t({ ar: "الإنجاز الفعّال", en: "Effective progress" })}</div>
            <div className="text-3xl font-bold text-white" dir="ltr">{p.effective_progress}%</div>
            <div className="text-[11px] text-stone-500 mt-1">{t(PROGRESS_MODE_LABELS[p.progress_mode])} · <span dir="ltr">{p.calculation_method}</span></div>
          </div>
          <div className="text-[11px] text-stone-400 space-y-1 min-w-[160px]">
            <Bar label={t({ ar: "دورة الحياة", en: "Lifecycle" })} v={p.lifecycle_progress} />
            <Bar label={t({ ar: "المهام", en: "Tasks" })} v={p.task_progress} />
            <div className="text-[10px] text-stone-600">{t({ ar: "نطاق المرحلة", en: "Stage band" })}: <span dir="ltr">{p.stage_floor}–{p.stage_ceiling}%</span></div>
          </div>
        </div>
        <div className="h-2 bg-stone-800 rounded mt-3 overflow-hidden"><div className="h-full bg-emerald-600" style={{ width: `${p.effective_progress}%` }} /></div>
        {canManage && (
          <div className="mt-3 pt-3 border-t border-stone-800">
            <div className="text-[11px] text-stone-500 mb-1.5">{t({ ar: "طريقة حساب إنجاز المشروع", en: "Progress calculation method" })}</div>
            <div className="flex flex-wrap gap-1.5">
              {MODES.map((m) => (
                <button key={m} disabled={savingMode} onClick={() => void setMode(m)} title={t(PROGRESS_MODE_LABELS[m].desc)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] border ${p.progress_mode === m ? "bg-red-600 border-red-600 text-white" : "bg-stone-800 border-stone-700 text-stone-300 hover:border-stone-500"}`}>
                  {t(PROGRESS_MODE_LABELS[m])}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-stone-600 mt-1.5">{t(PROGRESS_MODE_LABELS[p.progress_mode].desc)} {p.progress_mode === "manual" && t({ ar: "(اضبط النسبة من ملخّص المشروع).", en: "(set the value in the summary)." })}</p>
          </div>
        )}
      </div>

      {/* صحة المشروع */}
      <div className={`${card} p-4`}>
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wide text-stone-500">{t({ ar: "صحة التنفيذ", en: "Execution health" })}</span>
          <span className={`text-sm font-semibold ${hl.cls}`}>● {t(hl)} · <span dir="ltr">{h.health_score}/100</span></span>
        </div>
        {h.reasons.length === 0 ? <p className="text-[11px] text-stone-500 mt-2">{t({ ar: "لا مؤشرات خطر.", en: "No risk signals." })}</p> : (
          <ul className="mt-2 space-y-1">
            {h.reasons.map((r, i) => <li key={i} className="text-[11px] flex items-center gap-1.5"><span className={SEV_CLS[r.severity] ?? "text-stone-400"}>•</span><span className="text-stone-300">{t({ ar: r.ar, en: r.en })}</span></li>)}
          </ul>
        )}
      </div>

      {/* العدّادات + الساعات */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {([["total", d.counts.total, { ar: "الإجمالي", en: "Total" }], ["in_progress", d.counts.in_progress, { ar: "قيد التنفيذ", en: "In Progress" }],
          ["review", d.counts.review, { ar: "مراجعة", en: "Review" }], ["blocked", d.counts.blocked, { ar: "متوقفة", en: "Blocked" }],
          ["overdue", d.counts.overdue, { ar: "متأخرة", en: "Overdue" }], ["due_this_week", d.counts.due_this_week, { ar: "تستحق هذا الأسبوع", en: "Due this week" }],
          ["done", d.counts.done, { ar: "مكتملة", en: "Done" }], ["todo", d.counts.todo, { ar: "للتنفيذ", en: "To do" }]] as const).map(([k, v, lbl]) => (
          <div key={k} className={`${card} p-2.5`}><div className={`text-lg font-bold ${k === "overdue" && v > 0 ? "text-red-400" : k === "blocked" && v > 0 ? "text-amber-400" : "text-stone-200"}`}>{v}</div><div className="text-[10px] text-stone-500">{t(lbl)}</div></div>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className={`${card} p-2.5`}><div className="text-base font-bold text-stone-200" dir="ltr">{d.hours.estimated}h</div><div className="text-[10px] text-stone-500">{t({ ar: "ساعات مقدّرة", en: "Estimated" })}</div></div>
        <div className={`${card} p-2.5`}><div className="text-base font-bold text-stone-200" dir="ltr">{d.hours.logged}h</div><div className="text-[10px] text-stone-500">{t({ ar: "ساعات مسجّلة", en: "Logged" })}</div></div>
        <div className={`${card} p-2.5`}><div className={`text-base font-bold ${variance > 0 ? "text-red-400" : "text-emerald-400"}`} dir="ltr">{variance > 0 ? "+" : ""}{variance}h</div><div className="text-[10px] text-stone-500">{t({ ar: "الانحراف", en: "Variance" })}</div></div>
      </div>

      {/* عبء الفريق */}
      {d.workload.length > 0 && (
        <div className={`${card} p-3`}>
          <div className="text-[11px] text-stone-500 mb-2">{t({ ar: "عبء الفريق (مهام نشطة)", en: "Team workload (active tasks)" })}</div>
          <div className="space-y-1">
            {d.workload.map((w) => (
              <div key={w.user_id} className="flex items-center gap-2 text-xs">
                <span className="flex-1 truncate text-stone-300">{w.name ?? w.user_id.slice(0, 8)}</span>
                <span className="text-stone-400" dir="ltr">{w.active}</span>
                {w.overdue > 0 && <span className="text-red-400 text-[10px]" dir="ltr">({w.overdue} {t({ ar: "متأخرة", en: "overdue" })})</span>}
                <div className="w-24 h-1.5 bg-stone-800 rounded overflow-hidden"><div className="h-full bg-sky-700" style={{ width: `${Math.min(100, w.active * 20)}%` }} /></div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* مركز التنبيهات */}
      <div className={`${card} p-3`}>
        <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
          <span className="text-[11px] text-stone-500">{t({ ar: "التنبيهات التشغيلية", en: "Operational alerts" })} ({filteredAlerts.length})</span>
          <div className="flex items-center gap-1.5">
            <select value={fSev} onChange={(e) => setFSev(e.target.value)} className="bg-stone-800 border border-stone-700 rounded px-2 py-1 text-[11px] text-stone-200" style={{ colorScheme: "dark" }}>
              <option value="">{t({ ar: "الخطورة", en: "Severity" })}</option>{["critical", "at_risk", "attention", "info"].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={fType} onChange={(e) => setFType(e.target.value)} className="bg-stone-800 border border-stone-700 rounded px-2 py-1 text-[11px] text-stone-200" style={{ colorScheme: "dark" }}>
              <option value="">{t({ ar: "النوع", en: "Type" })}</option>{alertTypes.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            {filteredAlerts.length > 0 && <button onClick={exportAlerts} className="text-[11px] text-stone-400 hover:text-white border border-stone-700 rounded px-2 py-1">CSV</button>}
          </div>
        </div>
        {filteredAlerts.length === 0 ? <p className="text-[11px] text-stone-500">{t({ ar: "لا تنبيهات.", en: "No alerts." })}</p> : (
          <div className="space-y-1">
            {filteredAlerts.slice(0, 50).map((a, i) => (
              <div key={`${a.task_id}-${i}`} className="flex items-center gap-2 text-xs bg-stone-950 border border-stone-800 rounded p-1.5">
                <span className={SEV_CLS[a.severity] ?? "text-stone-400"}>●</span>
                <span className="flex-1 truncate text-stone-300" dir="auto">{a.title}</span>
                <span className="text-[10px] text-stone-500">{t({ ar: a.ar, en: a.en })}</span>
                {a.due && <span className="text-[10px] text-stone-600" dir="ltr">{a.due}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Bar({ label, v }: { label: string; v: number }) {
  return (
    <div>
      <div className="flex justify-between"><span>{label}</span><span dir="ltr">{v}%</span></div>
      <div className="h-1 bg-stone-800 rounded overflow-hidden mt-0.5"><div className="h-full bg-stone-500" style={{ width: `${v}%` }} /></div>
    </div>
  );
}
