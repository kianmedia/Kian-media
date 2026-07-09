"use client";
// ════════════════════════════════════════════════════════════════════════
// التقرير الشهري (owner/manager/hr) — تجميع من hr_admin_monthly_report:
// أيام حضور، جلسات، ساعات تقريبية، غياب (أيام عمل منقضية عدا الجمعة/السبت −
// حضور − إجازات معتمدة)، تأخير (حسب بداية الدوام + السماحية، بتوقيت الرياض)،
// إجازات معتمدة، مهام منجزة. تصدير CSV بدون أي حزمة (Blob + BOM للعربية).
// ════════════════════════════════════════════════════════════════════════
import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { hrAdminMonthlyReport, emitHrEvent, type HrEmployee, type HrMonthlyReport as HrMonthlyReportData } from "@/lib/portal/hr";

const card = "bg-stone-900 border border-stone-800 rounded-xl p-4";
const inp = "w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-200 focus:outline-none focus:ring-2 focus:ring-red-500";
const btnRed = "rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium";
const btnGhost = "rounded-lg bg-stone-800 border border-stone-700 text-stone-200 text-sm disabled:opacity-50";

const MONTHS_AR = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];

function riyadhNow(): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date()).split("-");
  return { year: Number(parts[0]), month: Number(parts[1]) };
}

export default function HrMonthlyReport({ employees, busy, setBusy, flash }: {
  employees: HrEmployee[]; busy: boolean; setBusy: (b: boolean) => void; flash: (m: string) => void;
}) {
  const { t } = useI18n();
  const now = riyadhNow();
  const [year, setYear] = useState(now.year);
  const [month, setMonth] = useState(now.month);
  const [userId, setUserId] = useState("");
  const [report, setReport] = useState<HrMonthlyReportData | null>(null);

  async function run() {
    if (busy) return;
    setBusy(true);
    const r = await hrAdminMonthlyReport(year, month, userId || undefined);
    setBusy(false);
    if (!r.ok) { flash(t({ ar: "تعذّر توليد التقرير: ", en: "Report failed: " }) + r.error); return; }
    setReport(r.data);
    emitHrEvent({ event: "hr_monthly_report_generated", entity_id: `report-${year}-${month}`, title: `تقرير شهري ${month}/${year}` });
  }

  function exportCsv() {
    if (!report) return;
    const head = ["الموظف","الحالة","أيام الحضور","عدد الجلسات","إجمالي الساعات","أيام الغياب","مرات التأخير","إجازات معتمدة","أيام الإجازات","مهام منجزة"];
    const lines = report.rows.map((r) => [
      r.full_name, r.employment_status, r.present_days, r.session_count, r.total_hours,
      r.absent_days, r.late_count, r.approved_leaves, r.approved_leave_days, r.tasks_done,
    ].map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","));
    // BOM حتى تفتح الأعمدة العربية سليمة في Excel.
    const csv = "﻿" + [head.join(","), ...lines].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `hr-monthly-${report.year}-${String(report.month).padStart(2, "0")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const years = Array.from({ length: 4 }, (_, i) => now.year - i);

  return (
    <div className="space-y-3">
      <section className={card}>
        <div className="grid gap-2 grid-cols-2 sm:grid-cols-4">
          <div>
            <label className="block text-[11px] text-stone-500 mb-1">{t({ ar: "السنة", en: "Year" })}</label>
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} className={inp}>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] text-stone-500 mb-1">{t({ ar: "الشهر", en: "Month" })}</label>
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className={inp}>
              {MONTHS_AR.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] text-stone-500 mb-1">{t({ ar: "الموظف (اختياري)", en: "Employee (optional)" })}</label>
            <select value={userId} onChange={(e) => setUserId(e.target.value)} className={inp}>
              <option value="">{t({ ar: "— الكل —", en: "— All —" })}</option>
              {employees.filter((e) => e.user_id).map((e) => <option key={e.id} value={e.user_id!}>{e.full_name}</option>)}
            </select>
          </div>
          <div className="flex items-end gap-2">
            <button type="button" disabled={busy} onClick={() => void run()} className={`${btnRed} flex-1 py-2`}>
              {busy ? "…" : t({ ar: "توليد التقرير", en: "Generate" })}
            </button>
          </div>
        </div>
        <p className="text-[11px] text-stone-500 mt-2 leading-relaxed">
          {t({ ar: "المنطق: توقيت الرياض؛ أيام العمل = أيام الشهر المنقضية عدا الجمعة والسبت؛ الغياب = أيام العمل − الحضور − الإجازات المعتمدة (الأنواع اليومية)؛ التأخير يُحسب فقط عند ضبط بداية الدوام في الإعدادات.",
               en: "Riyadh time; workdays exclude Fri/Sat; absence = workdays − present − approved day-leaves; lateness needs a configured work start." })}
        </p>
      </section>

      {report && (
        <section className={card}>
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <h3 className="text-sm font-medium text-stone-100">
              {t({ ar: "تقرير", en: "Report" })} {MONTHS_AR[report.month - 1]} {report.year}
            </h3>
            <span className="text-[11px] text-stone-500">
              ({t({ ar: "أيام عمل منقضية", en: "workdays elapsed" })}: {report.workdays_elapsed})
            </span>
            <button type="button" onClick={exportCsv} className={`${btnGhost} ms-auto px-4 py-1.5 text-xs`}>
              ⬇ {t({ ar: "تصدير CSV", en: "Export CSV" })}
            </button>
          </div>
          {report.rows.length === 0 && <p className="text-stone-500 text-sm">{t({ ar: "لا بيانات لهذا الشهر.", en: "No data." })}</p>}
          <div className="overflow-x-auto">
            <table className="w-full text-xs" dir="rtl">
              <thead>
                <tr className="text-stone-500 border-b border-stone-800">
                  <th className="text-start py-2 pe-2">{t({ ar: "الموظف", en: "Employee" })}</th>
                  <th className="py-2 px-1.5">{t({ ar: "حضور", en: "Days" })}</th>
                  <th className="py-2 px-1.5">{t({ ar: "جلسات", en: "Sessions" })}</th>
                  <th className="py-2 px-1.5">{t({ ar: "ساعات", en: "Hours" })}</th>
                  <th className="py-2 px-1.5">{t({ ar: "غياب", en: "Absent" })}</th>
                  <th className="py-2 px-1.5">{t({ ar: "تأخير", en: "Late" })}</th>
                  <th className="py-2 px-1.5">{t({ ar: "إجازات", en: "Leaves" })}</th>
                  <th className="py-2 px-1.5">{t({ ar: "مهام", en: "Tasks" })}</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((r) => (
                  <tr key={r.employee_id} className="border-b border-stone-800/60 text-stone-300">
                    <td className="py-1.5 pe-2 text-stone-100">
                      {r.full_name}
                      {r.employment_status !== "active" && (
                        <span className="ms-1.5 text-[10px] text-stone-500">
                          ({r.employment_status === "suspended" ? t({ ar: "موقوف", en: "susp." }) : t({ ar: "منتهٍ", en: "left" })})
                        </span>
                      )}
                    </td>
                    <td className="text-center py-1.5 px-1.5 font-mono">{r.present_days}</td>
                    <td className="text-center py-1.5 px-1.5 font-mono">{r.session_count}</td>
                    <td className="text-center py-1.5 px-1.5 font-mono">{r.total_hours}</td>
                    <td className={`text-center py-1.5 px-1.5 font-mono ${r.absent_days > 0 ? "text-amber-400" : ""}`}>{r.absent_days}</td>
                    <td className={`text-center py-1.5 px-1.5 font-mono ${r.late_count > 0 ? "text-amber-400" : ""}`}>{r.late_count}</td>
                    <td className="text-center py-1.5 px-1.5 font-mono">{r.approved_leaves}</td>
                    <td className="text-center py-1.5 px-1.5 font-mono">{r.tasks_done}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
