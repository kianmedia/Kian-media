"use client";
// ════════════════════════════════════════════════════════════════════════════
// Project Core — لوحة القيادة: عدّادات التشغيل + قائمة المشاريع التشغيلية +
// فلاتر، ثم الدخول إلى لوحة تشغيل المشروع (ProjectOps). staff فقط.
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import {
  pcDashboard, pcListProjects, PC_STAGE_LABELS, PRIORITY_LABELS, HEALTH_LABELS, pcErr,
  type ProjectCoreDashboard as Dash, type OperationalProject, type PcStage, type PcPriority, type PcHealth,
} from "@/lib/portal/projectCore";
import ProjectOps from "./ProjectOps";

const card = "bg-stone-900 border border-stone-800 rounded-xl";
const HEALTH_CLS: Record<PcHealth, string> = { on_track: "text-emerald-400", at_risk: "text-amber-400", off_track: "text-red-400" };
const PRIO_CLS: Record<PcPriority, string> = { low: "text-stone-400", normal: "text-sky-400", high: "text-amber-400", urgent: "text-red-400" };

export default function ProjectCoreDashboard() {
  const { t } = useI18n();
  const [dash, setDash] = useState<Dash | null>(null);
  const [projects, setProjects] = useState<OperationalProject[]>([]);
  const [phase, setPhase] = useState<"loading" | "error" | "ready">("loading");
  const [err, setErr] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "overdue" | "awaiting_client" | "at_risk">("all");
  const [selected, setSelected] = useState<OperationalProject | null>(null);

  const load = useCallback(async () => {
    setPhase("loading");
    const [d, p] = await Promise.all([pcDashboard(), pcListProjects()]);
    if (!p.ok) { setErr(pcErr(p.error)); setPhase("error"); return; }
    if (d.ok) setDash(d.data);
    setProjects(p.data);
    setPhase("ready");
  }, []);
  useEffect(() => { void load(); }, [load]);

  const todayStr = new Date().toISOString().slice(0, 10);
  const stageOf = (p: OperationalProject): PcStage | null => p.project_core?.core_stage ?? null;
  const filtered = projects.filter((p) => {
    const c = p.project_core;
    if (filter === "all") return true;
    if (filter === "active") return !c || !["closed", "delivered"].includes(c.core_stage);
    if (filter === "overdue") return !!c?.due_date && c.due_date < todayStr && !["closed", "delivered"].includes(c.core_stage);
    if (filter === "awaiting_client") return c?.core_stage === "client_review";
    if (filter === "at_risk") return c?.health === "at_risk" || c?.health === "off_track";
    return true;
  });

  if (selected) {
    return (
      <div className="space-y-3">
        <button onClick={() => { setSelected(null); void load(); }} className="text-xs text-stone-400 hover:text-white">← {t({ ar: "رجوع للوحة القيادة", en: "Back to dashboard" })}</button>
        <ProjectOps projectId={selected.id} projectName={selected.project_name ?? selected.id} onChanged={load} />
      </div>
    );
  }

  const chips: { k: typeof filter; ar: string; en: string; n: number }[] = dash ? [
    { k: "active", ar: "نشطة", en: "Active", n: dash.active },
    { k: "overdue", ar: "متأخرة", en: "Overdue", n: dash.overdue },
    { k: "awaiting_client", ar: "بانتظار العميل", en: "Awaiting Client", n: dash.awaiting_client },
    { k: "at_risk", ar: "معرّضة للخطر", en: "At Risk", n: dash.at_risk },
  ] : [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">{t({ ar: "منصّة إدارة المشاريع", en: "Project Core" })}</h2>
        <button onClick={() => void load()} className="text-xs text-stone-400 hover:text-white">↻ {t({ ar: "تحديث", en: "Refresh" })}</button>
      </div>

      {phase === "error" && <div className={`${card} p-4 text-sm text-red-300`}>{err}</div>}

      {/* عدّادات */}
      {dash && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {[
            { ar: "نشطة", en: "Active", n: dash.active, cls: "text-emerald-400" },
            { ar: "متأخرة", en: "Overdue", n: dash.overdue, cls: "text-red-400" },
            { ar: "بانتظار العميل", en: "Awaiting Client", n: dash.awaiting_client, cls: "text-sky-400" },
            { ar: "بانتظار الفريق", en: "Awaiting Staff", n: dash.awaiting_staff, cls: "text-amber-400" },
            { ar: "قرب التسليم", en: "Near Delivery", n: dash.near_delivery, cls: "text-indigo-400" },
            { ar: "مغلقة", en: "Closed", n: dash.closed, cls: "text-stone-400" },
            { ar: "مهامي المفتوحة", en: "My Open Tasks", n: dash.my_tasks, cls: "text-white" },
            { ar: "مهام متأخرة", en: "Overdue Tasks", n: dash.overdue_tasks, cls: "text-red-400" },
            { ar: "اعتمادات معلّقة", en: "Pending Approvals", n: dash.pending_approvals, cls: "text-amber-400" },
            { ar: "ساعات (30ي)", en: "Hours (30d)", n: dash.hours_logged_30d, cls: "text-sky-400" },
            { ar: "الميزانية", en: "Budget", n: dash.total_budget, cls: "text-stone-300" },
            { ar: "التكلفة", en: "Cost", n: dash.total_cost, cls: "text-stone-300" },
          ].map((c, i) => (
            <div key={i} className={`${card} p-3`}>
              <div className={`text-xl font-bold ${c.cls}`}>{c.n}</div>
              <div className="text-[11px] text-stone-500">{t({ ar: c.ar, en: c.en })}</div>
            </div>
          ))}
        </div>
      )}

      {/* فلاتر */}
      <div className="flex flex-wrap gap-2">
        {([{ k: "all", ar: "الكل", en: "All" }, ...chips.map((c) => ({ k: c.k, ar: c.ar, en: c.en }))] as { k: typeof filter; ar: string; en: string }[]).map((f) => (
          <button key={f.k} onClick={() => setFilter(f.k)} className={`px-3 py-1.5 rounded-lg text-xs ${filter === f.k ? "bg-red-600 text-white" : "bg-stone-800 border border-stone-700 text-stone-300"}`}>{t({ ar: f.ar, en: f.en })}</button>
        ))}
      </div>

      {/* قائمة المشاريع */}
      {phase === "loading" && <p className="text-xs text-stone-500">{t({ ar: "جارٍ التحميل…", en: "Loading…" })}</p>}
      {phase === "ready" && filtered.length === 0 && <p className="text-xs text-stone-500">{t({ ar: "لا توجد مشاريع مطابقة.", en: "No matching projects." })}</p>}
      <div className="space-y-1.5">
        {filtered.map((p) => {
          const c = p.project_core;
          const stage = stageOf(p);
          const overdue = !!c?.due_date && c.due_date < todayStr && stage !== "closed" && stage !== "delivered";
          return (
            <button key={p.id} onClick={() => setSelected(p)} className={`${card} p-3 w-full text-right hover:border-stone-600 transition`}>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm text-stone-100 truncate" dir="auto">{p.project_name || p.id}</div>
                  <div className="flex items-center gap-2 mt-0.5 text-[11px]">
                    <span className="px-1.5 py-0.5 rounded bg-stone-800 text-stone-300">{stage ? t(PC_STAGE_LABELS[stage]) : t({ ar: "غير مهيّأ", en: "Not initialized" })}</span>
                    {c && <span className={PRIO_CLS[c.priority]}>{t(PRIORITY_LABELS[c.priority])}</span>}
                    {c && <span className={HEALTH_CLS[c.health]}>{t(HEALTH_LABELS[c.health])}</span>}
                    {c?.due_date && <span className={overdue ? "text-red-400" : "text-stone-500"} dir="ltr">⏱ {c.due_date}</span>}
                  </div>
                </div>
                {c && <div className="shrink-0 text-left">
                  <div className="text-xs text-stone-400">{c.progress_pct}%</div>
                  <div className="w-16 h-1.5 bg-stone-800 rounded mt-1 overflow-hidden"><div className="h-full bg-red-600" style={{ width: `${c.progress_pct}%` }} /></div>
                </div>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
