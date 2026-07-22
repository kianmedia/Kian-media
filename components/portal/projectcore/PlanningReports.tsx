"use client";
// ════════════════════════════════════════════════════════════════════════════
// PlanningReports — Phase 4D §8/§9. تقارير التخطيط والموارد + تصدير CSV.
// يعيد استخدام RPCs المبوّبة القائمة (project_schedule_health / project_team_workload /
// resource_timeline_snapshot / portfolio_schedule_dashboard) وcsvDownload (UTF-8 BOM، عربي،
// Asia/Riyadh). لأن البيانات تأتي من RPCs مبوّبة (pc_can_read_project)، فالتصدير يحترم الصلاحيات
// حكمًا ولا يُصدّر مشاريع غير مصرّح بها. لا مالية ولا تفاصيل HR حسّاسة. لا مكتبة Excel جديدة.
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { csvDownload } from "@/lib/portal/csv";
import { projectScheduleHealth, portfolioScheduleDashboard } from "@/lib/portal/projectCore";
import { resourceTimelineSnapshot, projectTeamWorkload } from "@/lib/portal/projectResources";

type ReportKey = "schedule" | "resources" | "equipment" | "portfolio";
const todayISO = () => new Date().toISOString().slice(0, 10);
const addD = (iso: string, n: number) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export default function PlanningReports({ projectId, onClose }: { projectId?: string; onClose: () => void }) {
  const { t } = useI18n();
  const [rep, setRep] = useState<ReportKey>(projectId ? "schedule" : "portfolio");
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(addD(todayISO(), 30));
  const [rows, setRows] = useState<{ headers: string[]; data: (string | number)[][] } | null>(null);
  const [phase, setPhase] = useState<"loading" | "error" | "ready">("loading");
  const [err, setErr] = useState("");
  const reqSeq = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  const load = useCallback(async () => {
    const my = ++reqSeq.current;
    setPhase("loading"); setErr(""); setRows(null);
    try {
      let out: { headers: string[]; data: (string | number)[][] } | null = null;
      if (rep === "portfolio") {
        const r = await portfolioScheduleDashboard({});
        if (!r.ok) throw new Error(r.error);
        out = { headers: ["المشروع", "المرحلة", "الصحة", "الجدول", "التسليم", "التقدم%", "مهام مفتوحة", "تعارضات", "متأخرة"],
          data: r.data.projects.map((p) => [p.name ?? "—", p.core_stage, p.health, p.schedule?.schedule_status ?? "—", p.due_date ?? "—", p.progress_pct, p.open_tasks, p.schedule?.booking_conflicts ?? 0, p.schedule?.overdue_tasks ?? 0]) };
      } else if (rep === "schedule" && projectId) {
        const r = await projectScheduleHealth(projectId);
        if (!r.ok) throw new Error(r.error);
        const s = r.data;
        out = { headers: ["المؤشر", "القيمة"], data: [
          ["حالة الجدول", s.schedule_status], ["التوقع النهائي", s.project_finish_forecast ?? "—"],
          ["مهام بلا تواريخ", s.tasks_without_dates], ["مهام بلا مدة", s.tasks_without_duration],
          ["تجاوز خط الأساس", s.baseline_slippage], ["مهام متأخرة", s.overdue_tasks],
          ["آلية بلا جدولة", s.unscheduled_auto_tasks], ["تعارضات حجز", s.booking_conflicts],
          ["المسار الحرج قابل للحساب", s.critical_path_computable ? "نعم" : "لا"], ["مدة المسار الحرج (يوم عمل)", s.critical_total_duration],
        ] };
      } else if (rep === "resources" && projectId) {
        const r = await projectTeamWorkload(projectId, from, to);
        if (!r.ok) throw new Error(r.error);
        out = { headers: ["الموظف", "الدور", "متاح(س)", "مخطّط(س)", "مسجّل(س)", "استغلال%", "زائد(س)", "مشاريع", "مهام", "متأخرة", "تعارضات", "التصنيف"],
          data: r.data.members.map((w) => [w.full_name ?? "—", w.job_title ?? "—", w.available_hours, w.planned_hours, w.logged_hours, w.utilization_percent ?? "—", w.overload_hours, w.projects_count, w.active_tasks, w.overdue_tasks, w.conflict_count, w.classification]) };
      } else if (rep === "equipment") {
        const r = await resourceTimelineSnapshot(from, to, projectId ? { project_id: projectId, resource_type: "equipment" } : { resource_type: "equipment" });
        if (!r.ok) throw new Error(r.error);
        out = { headers: ["المعدة", "الكود", "الحالة", "عدد الحجوزات", "عدم توفر"],
          data: r.data.resources.map((rr) => [rr.resource.display_name, rr.resource.asset?.asset_code ?? "—", rr.resource.asset?.availability_status ?? "—", rr.bookings.length, rr.unavailability.length]) };
      }
      if (!mountedRef.current || my !== reqSeq.current) return;
      setRows(out); setPhase("ready");
    } catch (e) {
      if (!mountedRef.current || my !== reqSeq.current) return;
      setErr(/not authorized/.test(String(e)) ? t({ ar: "لا تملك صلاحية عرض هذا التقرير.", en: "Not authorized." }) : t({ ar: "تعذّر تحميل التقرير.", en: "Couldn't load report." }));
      setPhase("error");
    }
  }, [rep, projectId, from, to, t]);
  useEffect(() => { void load(); }, [load]);

  function exportCsv() {
    if (!rows) return;
    const name = `تقرير_${rep}_${todayISO()}`;
    csvDownload(name, [rows.headers, ...rows.data.map((r) => r.map((c) => String(c)))]);
  }

  const REPORTS: { k: ReportKey; ar: string; needsProject?: boolean }[] = [
    { k: "portfolio", ar: "محفظة المشاريع" },
    { k: "schedule", ar: "الجدول الزمني", needsProject: true },
    { k: "resources", ar: "استخدام الموارد", needsProject: true },
    { k: "equipment", ar: "المعدات" },
  ];
  const visible = REPORTS.filter((r) => !r.needsProject || projectId);

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-start justify-center overflow-auto p-3 sm:p-4" onClick={onClose}>
      <div className="bg-stone-950 border border-stone-800 rounded-2xl w-full max-w-4xl my-3" dir="rtl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-stone-800">
          <h3 className="text-sm font-semibold text-stone-100">{t({ ar: "تقارير التخطيط والموارد", en: "Planning & Resource Reports" })}</h3>
          <button onClick={onClose} className="text-stone-400 hover:text-white text-sm" aria-label="close">✕</button>
        </div>
        <div className="p-4 space-y-3">
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <div className="inline-flex rounded-lg border border-stone-700 overflow-hidden flex-wrap">
              {visible.map((r) => <button key={r.k} onClick={() => setRep(r.k)} className={`px-2.5 py-1 text-[11px] ${rep === r.k ? "bg-stone-700 text-white" : "text-stone-400"}`}>{r.ar}</button>)}
            </div>
            {(rep === "resources" || rep === "equipment") && <>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="bg-stone-900 border border-stone-700 rounded px-2 py-1 text-stone-200" style={{ colorScheme: "dark" }} />
              <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="bg-stone-900 border border-stone-700 rounded px-2 py-1 text-stone-200" style={{ colorScheme: "dark" }} />
            </>}
            <button disabled={!rows || rows.data.length === 0} onClick={exportCsv} className="ms-auto text-green-300 border border-green-800 rounded px-3 py-1 disabled:opacity-40">{t({ ar: "تصدير CSV", en: "Export CSV" })}</button>
          </div>

          {phase === "loading" && <p className="text-xs text-stone-500 py-8 text-center">{t({ ar: "جارٍ التحميل…", en: "Loading…" })}</p>}
          {phase === "error" && <div className="py-8 text-center space-y-2"><p className="text-sm text-red-300">{err}</p><button onClick={() => void load()} className="text-xs bg-stone-800 border border-stone-700 rounded-lg px-4 py-2 text-stone-200">{t({ ar: "إعادة المحاولة", en: "Retry" })}</button></div>}
          {phase === "ready" && rows && rows.data.length === 0 && <p className="text-xs text-stone-500 py-8 text-center">{t({ ar: "لا بيانات في هذا التقرير/الفترة.", en: "No data." })}</p>}
          {phase === "ready" && rows && rows.data.length > 0 && (
            <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
              <table className="w-full text-[11px] border-collapse">
                <thead className="sticky top-0 bg-stone-950"><tr>{rows.headers.map((h, i) => <th key={i} className="text-start font-medium px-2 py-1.5 border-b border-stone-800 text-stone-400 whitespace-nowrap">{h}</th>)}</tr></thead>
                <tbody>{rows.data.map((row, ri) => <tr key={ri} className="border-b border-stone-900">{row.map((c, ci) => <td key={ci} className="px-2 py-1.5 text-stone-300 whitespace-nowrap" dir="auto">{String(c)}</td>)}</tr>)}</tbody>
              </table>
            </div>
          )}
          <p className="text-[9px] text-stone-600">{t({ ar: "بيانات حية عبر RPCs مبوّدة — التصدير يحترم صلاحياتك ولا يشمل بيانات مالية أو HR حسّاسة.", en: "Live gated data; export respects your permissions." })}</p>
        </div>
      </div>
    </div>
  );
}
