"use client";
// ════════════════════════════════════════════════════════════════════════════
// Project Core — تبويب «التقارير» (Phase 3 closure). تقارير تشغيلية (لا تقييم عقابي):
// تقرير المشروع + تقرير الفريق (لمن يملك الصلاحية) + تصدير CSV يحترم الفلاتر والصلاحيات
// (RPCs مُقيَّدة خادميًا). لا بيانات مالية.
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { csvDownload } from "@/lib/portal/csv";
import { projectExecutionReport, teamExecutionReport, pcErr } from "@/lib/portal/projectCore";

const card = "bg-stone-900 border border-stone-800 rounded-xl";
const inp = "bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-200";
const num = (v: unknown) => (typeof v === "number" ? v : v == null ? "—" : String(v));

export default function ProjectReports({ projectId, canManage, flash }: { projectId: string; canManage: boolean; flash: (m: string) => void }) {
  const { t } = useI18n();
  const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [rep, setRep] = useState<Record<string, unknown> | null>(null);
  const [team, setTeam] = useState<{ user_id: string; name: string | null; assigned: number; done: number; overdue: number; blocked: number; review: number; active_projects: number; est_hours: number; logged_hours: number }[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    const [r, tm] = await Promise.all([
      projectExecutionReport(projectId, from || undefined, to || undefined),
      canManage ? teamExecutionReport(projectId) : Promise.resolve({ ok: true as const, data: { members: [] } }),
    ]);
    setBusy(false);
    if (r.ok) setRep(r.data); else flash(pcErr(r.error));
    if (tm.ok) setTeam(tm.data.members);
  }, [projectId, from, to, canManage, flash]);
  useEffect(() => { void load(); }, [load]);

  function exportProject() {
    if (!rep) return;
    const rows: (string | number)[][] = [[t({ ar: "المؤشر", en: "Metric" }), t({ ar: "القيمة", en: "Value" })]];
    const keys: [string, { ar: string; en: string }][] = [
      ["total", { ar: "إجمالي المهام", en: "Total tasks" }], ["done", { ar: "مكتملة", en: "Done" }], ["overdue", { ar: "متأخرة", en: "Overdue" }],
      ["blocked", { ar: "متوقفة", en: "Blocked" }], ["review", { ar: "قيد المراجعة", en: "Review" }], ["completion_rate", { ar: "معدل الإكمال %", en: "Completion %" }],
      ["on_time_rate", { ar: "الالتزام بالمواعيد %", en: "On-time %" }], ["avg_completion_days", { ar: "متوسط الإنجاز (يوم)", en: "Avg days" }],
      ["reopened", { ar: "معاد فتحها", en: "Reopened" }], ["change_requests", { ar: "طلبات تعديل", en: "Change requests" }],
      ["est_hours", { ar: "ساعات مقدّرة", en: "Estimated h" }], ["logged_hours", { ar: "ساعات مسجّلة", en: "Logged h" }],
    ];
    for (const [k, lbl] of keys) rows.push([t(lbl), num(rep[k]) as string | number]);
    csvDownload(`project_report_${projectId.slice(0, 8)}_${to || "now"}`, rows);
  }
  function exportTeam() {
    const rows: (string | number | null)[][] = [[t({ ar: "العضو", en: "Member" }), t({ ar: "مسندة", en: "Assigned" }), t({ ar: "مكتملة", en: "Done" }), t({ ar: "متأخرة", en: "Overdue" }), t({ ar: "متوقفة", en: "Blocked" }), t({ ar: "مراجعة", en: "Review" }), t({ ar: "مشاريع", en: "Projects" }), t({ ar: "ساعات مقدّرة", en: "Est h" }), t({ ar: "ساعات مسجّلة", en: "Logged h" })]];
    for (const m of team) rows.push([m.name, m.assigned, m.done, m.overdue, m.blocked, m.review, m.active_projects, m.est_hours, m.logged_hours]);
    csvDownload(`team_report_${projectId.slice(0, 8)}`, rows);
  }

  const M = ({ k, ar, en, warn }: { k: string; ar: string; en: string; warn?: boolean }) => (
    <div className={`${card} p-2.5`}><div className={`text-lg font-bold ${warn && Number(rep?.[k]) > 0 ? "text-red-400" : "text-stone-200"}`}>{num(rep?.[k])}</div><div className="text-[10px] text-stone-500">{t({ ar, en })}</div></div>
  );

  return (
    <div className="space-y-4">
      {/* فلاتر الفترة */}
      <div className="flex flex-wrap gap-2 items-end">
        <div><label className="text-[10px] text-stone-500 block">{t({ ar: "من", en: "From" })}</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={`${inp} py-1.5`} style={{ colorScheme: "dark" }} /></div>
        <div><label className="text-[10px] text-stone-500 block">{t({ ar: "إلى", en: "To" })}</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={`${inp} py-1.5`} style={{ colorScheme: "dark" }} /></div>
        <button disabled={busy} onClick={() => void load()} className="rounded-lg bg-stone-800 border border-stone-700 text-stone-200 text-xs px-3 py-1.5">{t({ ar: "تحديث", en: "Refresh" })}</button>
      </div>

      {/* تقرير المشروع */}
      {rep && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wide text-stone-500">{t({ ar: "تقرير المشروع", en: "Project report" })}</span>
            <button onClick={exportProject} className="text-[11px] text-stone-400 hover:text-white border border-stone-700 rounded px-2 py-1">CSV</button>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            <M k="completion_rate" ar="معدل الإكمال %" en="Completion %" />
            <M k="on_time_rate" ar="الالتزام %" en="On-time %" />
            <M k="done" ar="مكتملة" en="Done" />
            <M k="overdue" ar="متأخرة" en="Overdue" warn />
            <M k="blocked" ar="متوقفة" en="Blocked" warn />
            <M k="review" ar="مراجعة" en="Review" />
            <M k="reopened" ar="معاد فتحها" en="Reopened" />
            <M k="change_requests" ar="طلبات تعديل" en="Change req." />
            <M k="avg_completion_days" ar="متوسط الإنجاز (يوم)" en="Avg days" />
            <M k="est_hours" ar="ساعات مقدّرة" en="Est h" />
            <M k="logged_hours" ar="ساعات مسجّلة" en="Logged h" />
          </div>
          {Array.isArray(rep.blocked_reasons) && (rep.blocked_reasons as unknown[]).length > 0 && (
            <div className={`${card} p-3`}>
              <div className="text-[11px] text-stone-500 mb-1">{t({ ar: "أسباب التعطيل", en: "Blocked reasons" })}</div>
              {(rep.blocked_reasons as { task: string; reason: string }[]).map((b, i) => <div key={i} className="text-[11px] text-stone-400 truncate">• {b.task}: <span className="text-amber-300">{b.reason}</span></div>)}
            </div>
          )}
        </div>
      )}

      {/* تقرير الفريق */}
      {canManage && team.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wide text-stone-500">{t({ ar: "تقرير الفريق (تشغيلي)", en: "Team report" })}</span>
            <button onClick={exportTeam} className="text-[11px] text-stone-400 hover:text-white border border-stone-700 rounded px-2 py-1">CSV</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[520px]">
              <thead><tr className="text-stone-500 text-[10px] text-right"><th className="p-1.5">{t({ ar: "العضو", en: "Member" })}</th><th className="p-1.5">{t({ ar: "مسندة", en: "Assigned" })}</th><th className="p-1.5">{t({ ar: "مكتملة", en: "Done" })}</th><th className="p-1.5">{t({ ar: "متأخرة", en: "Overdue" })}</th><th className="p-1.5">{t({ ar: "متوقفة", en: "Blocked" })}</th><th className="p-1.5">{t({ ar: "مراجعة", en: "Review" })}</th><th className="p-1.5">{t({ ar: "ساعات م/مس", en: "Est/Log h" })}</th></tr></thead>
              <tbody>{team.map((m) => <tr key={m.user_id} className="border-t border-stone-800 text-stone-300"><td className="p-1.5 truncate max-w-[120px]">{m.name ?? m.user_id.slice(0, 8)}</td><td className="p-1.5">{m.assigned}</td><td className="p-1.5 text-emerald-400">{m.done}</td><td className={`p-1.5 ${m.overdue > 0 ? "text-red-400" : ""}`}>{m.overdue}</td><td className={`p-1.5 ${m.blocked > 0 ? "text-amber-400" : ""}`}>{m.blocked}</td><td className="p-1.5">{m.review}</td><td className="p-1.5" dir="ltr">{m.est_hours}/{m.logged_hours}</td></tr>)}</tbody>
            </table>
          </div>
          <p className="text-[10px] text-stone-600">{t({ ar: "تقرير تشغيلي لتوزيع العمل — ليس تقييمًا للأداء.", en: "Operational workload — not a performance evaluation." })}</p>
        </div>
      )}
    </div>
  );
}
