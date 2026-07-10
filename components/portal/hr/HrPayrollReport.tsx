"use client";
// ════════════════════════════════════════════════════════════════════════
// تقرير الخصومات/الرواتب الشهري (owner/manager/hr) — أرقام تشغيلية فقط، لا
// خصم مالي فعلي. يعرض التأخير/الخروج المبكر/الغياب حسب تقويم HR وإعدادات
// الدوام. تصدير CSV بلا أي حزمة (Blob + BOM). مفاتيح الخصومات عرض فقط.
// ════════════════════════════════════════════════════════════════════════
import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { hrAdminPayrollReport, emitHrEvent, type HrEmployee, type HrPayrollReport as PayrollData } from "@/lib/portal/hr";

const card = "bg-stone-900 border border-stone-800 rounded-xl p-4";
const inp = "w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-200 focus:outline-none focus:ring-2 focus:ring-red-500";
const btnRed = "rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium";
const btnGhost = "rounded-lg bg-stone-800 border border-stone-700 text-stone-200 text-sm disabled:opacity-50";
const chip = (cls: string) => `inline-block rounded-full border px-2 py-0.5 text-[10.5px] ${cls}`;

const MONTHS_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
function riyadhNow(): { year: number; month: number } {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date()).split("-");
  return { year: Number(p[0]), month: Number(p[1]) };
}

export default function HrPayrollReport({ employees, busy, setBusy, flash }: {
  employees: HrEmployee[]; busy: boolean; setBusy: (b: boolean) => void; flash: (m: string) => void;
}) {
  const { t } = useI18n();
  const now = riyadhNow();
  const [year, setYear] = useState(now.year);
  const [month, setMonth] = useState(now.month);
  const [userId, setUserId] = useState("");
  const [report, setReport] = useState<PayrollData | null>(null);

  async function run() {
    if (busy) return;
    setBusy(true);
    const r = await hrAdminPayrollReport(year, month, userId || undefined);
    setBusy(false);
    if (!r.ok) { flash(t({ ar: "تعذّر توليد التقرير: ", en: "Report failed: " }) + r.error); return; }
    setReport(r.data);
    emitHrEvent({ event: "hr_payroll_report_generated", entity_id: `payroll-${year}-${month}`, title: `تقرير خصومات ${month}/${year}` });
  }

  function exportCsv() {
    if (!report) return;
    const head = ["الموظف", "أيام العمل المتوقعة", "أيام الحضور", "أيام الغياب", "عدد التأخير", "دقائق التأخير",
      "عدد الخروج المبكر", "دقائق الخروج المبكر", "إجمالي الساعات", "أيام الإجازات المعتمدة", "طلبات تعديل معتمدة", "المهام المنجزة"];
    const lines = report.rows.map((r) => [
      r.full_name, r.expected_workdays, r.present_days, r.absent_days, r.late_count, r.late_minutes,
      r.early_exit_count, r.early_exit_minutes, r.total_hours, r.approved_leave_days, r.approved_corrections, r.tasks_done,
    ].map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","));
    const csv = "﻿" + [head.join(","), ...lines].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `hr-payroll-${report.year}-${String(report.month).padStart(2, "0")}.csv`;
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
          <div className="flex items-end">
            <button type="button" disabled={busy} onClick={() => void run()} className={`${btnRed} w-full py-2`}>{busy ? "…" : t({ ar: "توليد", en: "Generate" })}</button>
          </div>
        </div>
      </section>

      {report && (
        <section className={card}>
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <h3 className="text-sm font-medium text-stone-100">{t({ ar: "خصومات", en: "Deductions" })} {MONTHS_AR[report.month - 1]} {report.year}</h3>
            <span className="text-[11px] text-stone-500">({t({ ar: "أيام عمل متوقعة", en: "expected workdays" })}: {report.workdays_expected})</span>
            <button type="button" onClick={exportCsv} className={`${btnGhost} ms-auto px-4 py-1.5 text-xs`}>⬇ {t({ ar: "تصدير CSV", en: "Export CSV" })}</button>
          </div>
          <div className="flex gap-1.5 flex-wrap mb-3">
            <span className={chip(report.deduction_flags.late ? "bg-amber-950 text-amber-300 border-amber-800" : "bg-stone-800 text-stone-500 border-stone-700")}>
              {t({ ar: "خصم التأخير", en: "Late deduction" })}: {report.deduction_flags.late ? t({ ar: "مفعّل", en: "on" }) : t({ ar: "موقوف", en: "off" })}
            </span>
            <span className={chip(report.deduction_flags.absence ? "bg-amber-950 text-amber-300 border-amber-800" : "bg-stone-800 text-stone-500 border-stone-700")}>
              {t({ ar: "خصم الغياب", en: "Absence" })}: {report.deduction_flags.absence ? t({ ar: "مفعّل", en: "on" }) : t({ ar: "موقوف", en: "off" })}
            </span>
            <span className={chip(report.deduction_flags.early_exit ? "bg-amber-950 text-amber-300 border-amber-800" : "bg-stone-800 text-stone-500 border-stone-700")}>
              {t({ ar: "خصم الخروج المبكر", en: "Early exit" })}: {report.deduction_flags.early_exit ? t({ ar: "مفعّل", en: "on" }) : t({ ar: "موقوف", en: "off" })}
            </span>
          </div>
          {report.rows.length === 0 && <p className="text-stone-500 text-sm">{t({ ar: "لا بيانات لهذا الشهر.", en: "No data." })}</p>}
          <div className="overflow-x-auto">
            <table className="w-full text-xs" dir="rtl">
              <thead>
                <tr className="text-stone-500 border-b border-stone-800">
                  <th className="text-start py-2 pe-2">{t({ ar: "الموظف", en: "Employee" })}</th>
                  <th className="py-2 px-1.5">{t({ ar: "متوقع", en: "Exp." })}</th>
                  <th className="py-2 px-1.5">{t({ ar: "حضور", en: "Present" })}</th>
                  <th className="py-2 px-1.5">{t({ ar: "غياب", en: "Absent" })}</th>
                  <th className="py-2 px-1.5">{t({ ar: "تأخير", en: "Late" })}</th>
                  <th className="py-2 px-1.5">{t({ ar: "د.تأخير", en: "Late min" })}</th>
                  <th className="py-2 px-1.5">{t({ ar: "خروج مبكر", en: "Early" })}</th>
                  <th className="py-2 px-1.5">{t({ ar: "د.مبكر", en: "Early min" })}</th>
                  <th className="py-2 px-1.5">{t({ ar: "ساعات", en: "Hours" })}</th>
                  <th className="py-2 px-1.5">{t({ ar: "إجازات", en: "Leaves" })}</th>
                  <th className="py-2 px-1.5">{t({ ar: "مهام", en: "Tasks" })}</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((r) => (
                  <tr key={r.employee_id} className="border-b border-stone-800/60 text-stone-300">
                    <td className="py-1.5 pe-2 text-stone-100">{r.full_name}</td>
                    <td className="text-center py-1.5 px-1.5 font-mono">{r.expected_workdays}</td>
                    <td className="text-center py-1.5 px-1.5 font-mono">{r.present_days}</td>
                    <td className={`text-center py-1.5 px-1.5 font-mono ${r.absent_days > 0 ? "text-amber-400" : ""}`}>{r.absent_days}</td>
                    <td className={`text-center py-1.5 px-1.5 font-mono ${r.late_count > 0 ? "text-amber-400" : ""}`}>{r.late_count}</td>
                    <td className="text-center py-1.5 px-1.5 font-mono">{r.late_minutes}</td>
                    <td className={`text-center py-1.5 px-1.5 font-mono ${r.early_exit_count > 0 ? "text-amber-400" : ""}`}>{r.early_exit_count}</td>
                    <td className="text-center py-1.5 px-1.5 font-mono">{r.early_exit_minutes}</td>
                    <td className="text-center py-1.5 px-1.5 font-mono">{r.total_hours}</td>
                    <td className="text-center py-1.5 px-1.5 font-mono">{r.approved_leave_days}</td>
                    <td className="text-center py-1.5 px-1.5 font-mono">{r.tasks_done}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-stone-500 mt-3 leading-relaxed">
            {t({ ar: "الأرقام تقديرية تشغيلية ولا تُطبّق خصمًا ماليًا — تعتمد على بيانات الحضور المسجّلة وتقويم الموارد البشرية وإعدادات الدوام.",
                 en: "Operational estimates only — no monetary deduction is applied. Based on recorded attendance, the HR calendar, and work-hour settings." })}
            {report.deduction_flags.notes ? " — " + report.deduction_flags.notes : ""}
          </p>
        </section>
      )}
    </div>
  );
}
