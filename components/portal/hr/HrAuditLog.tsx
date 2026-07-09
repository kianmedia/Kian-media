"use client";
// ════════════════════════════════════════════════════════════════════════
// سجل العمليات (owner/manager/hr) — يعرض كل الأحداث الحساسة من hr_employee_events
// مع اسم المنفّذ والسبب. فلاتر: الموظف/النوع/التاريخ + بحث نصي. تصدير CSV.
// ════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { hrAdminAuditLog, emitHrEvent, type HrEmployee, type HrAuditRow } from "@/lib/portal/hr";

const card = "bg-stone-900 border border-stone-800 rounded-xl p-4";
const inp = "w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-200 focus:outline-none focus:ring-2 focus:ring-red-500";
const btnRed = "rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium";
const btnGhost = "rounded-lg bg-stone-800 border border-stone-700 text-stone-200 text-sm disabled:opacity-50";

// مجموعات أنواع الأحداث (event_type prefixes) للفلترة السريعة.
const TYPE_GROUPS: { key: string; ar: string; types: string[] }[] = [
  { key: "attendance", ar: "حضور", types: ["attendance_checkin", "attendance_checkout", "attendance_adjusted", "attendance_voided", "device_checkin", "device_checkout", "device_event"] },
  { key: "correction", ar: "تعديل حضور", types: ["correction_requested", "correction_decided"] },
  { key: "leave", ar: "إجازات", types: ["leave_requested", "leave_decided", "leave_deleted", "leave_updated"] },
  { key: "task", ar: "مهام", types: ["task_assigned", "task_start", "task_end", "task_closed", "task_deleted", "task_reviewed"] },
  { key: "status", ar: "حالة موظف", types: ["status_changed", "employee_deleted"] },
  { key: "document", ar: "وثائق", types: ["document_saved", "document_deleted"] },
  { key: "supervisor", ar: "إشراف", types: ["supervisor_changed", "supervisor_note"] },
  { key: "note", ar: "ملاحظات", types: ["hr_note"] },
];

export default function HrAuditLog({ employees, busy, setBusy, flash }: {
  employees: HrEmployee[]; busy: boolean; setBusy: (b: boolean) => void; flash: (m: string) => void;
}) {
  const { t, isAr } = useI18n();
  const [rows, setRows] = useState<HrAuditRow[]>([]);
  const [userId, setUserId] = useState("");
  const [group, setGroup] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");

  const load = useCallback(async (logView = false) => {
    setBusy(true);
    const types = group ? TYPE_GROUPS.find((g) => g.key === group)?.types ?? null : null;
    const r = await hrAdminAuditLog({
      userId: employees.find((e) => e.user_id === userId)?.user_id || null,
      types, from: from || null, to: to || null, search: search || null, limit: 400,
    });
    setBusy(false);
    if (!r.ok) { flash(t({ ar: "تعذّر تحميل السجل: ", en: "Load failed: " }) + r.error); return; }
    setRows(r.data.rows);
    if (logView) emitHrEvent({ event: "hr_audit_log_viewed", entity_id: "audit-log", title: "عرض سجل العمليات" });
  }, [userId, group, from, to, search, employees, setBusy, flash, t]);

  useEffect(() => { void load(true); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const fmtDT = (iso: string) => new Date(iso).toLocaleString(isAr ? "ar-SA" : "en-GB", { dateStyle: "short", timeStyle: "short" });

  function exportCsv() {
    const head = ["التاريخ", "الموظف", "النوع", "العنوان", "التفاصيل", "المنفّذ", "مرئي للموظف"];
    const lines = rows.map((r) => [
      fmtDT(r.created_at), r.employee_name, r.event_type, r.title, r.description || "", r.actor_name || "", r.visible_to_employee ? "نعم" : "لا",
    ].map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","));
    const csv = "﻿" + [head.join(","), ...lines].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "hr-audit-log.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-3">
      <section className={card}>
        <div className="grid gap-2 sm:grid-cols-3">
          <select value={userId} onChange={(e) => setUserId(e.target.value)} className={inp}>
            <option value="">{t({ ar: "— كل الموظفين —", en: "— All employees —" })}</option>
            {employees.filter((e) => e.user_id).map((e) => <option key={e.id} value={e.user_id!}>{e.full_name}</option>)}
          </select>
          <select value={group} onChange={(e) => setGroup(e.target.value)} className={inp}>
            <option value="">{t({ ar: "— كل الأنواع —", en: "— All types —" })}</option>
            {TYPE_GROUPS.map((g) => <option key={g.key} value={g.key}>{g.ar}</option>)}
          </select>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t({ ar: "بحث نصي…", en: "Search…" })} className={inp} />
          <div><label className="block text-[11px] text-stone-500 mb-1">{t({ ar: "من", en: "From" })}</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inp} dir="ltr" /></div>
          <div><label className="block text-[11px] text-stone-500 mb-1">{t({ ar: "إلى", en: "To" })}</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inp} dir="ltr" /></div>
          <div className="flex items-end gap-2">
            <button type="button" disabled={busy} onClick={() => void load()} className={`${btnRed} flex-1 py-2`}>{t({ ar: "تطبيق", en: "Apply" })}</button>
            <button type="button" onClick={exportCsv} className={`${btnGhost} px-4 py-2`}>⬇ CSV</button>
          </div>
        </div>
      </section>

      <section className={card}>
        <h3 className="text-sm font-medium text-stone-100 mb-3">{t({ ar: "العمليات", en: "Operations" })} <span className="text-stone-500 text-xs">({rows.length})</span></h3>
        {rows.length === 0 && <p className="text-stone-500 text-sm">{t({ ar: "لا عمليات مطابقة.", en: "No matching operations." })}</p>}
        <div className="space-y-1">
          {rows.map((r) => (
            <div key={r.id} className="flex items-start gap-2 flex-wrap text-[11.5px] border-t border-stone-800 py-1.5">
              <span className="font-mono text-stone-500 shrink-0" dir="ltr">{fmtDT(r.created_at)}</span>
              <span className="text-stone-200 shrink-0">{r.employee_name}</span>
              <span className="text-stone-400">{r.title}</span>
              {r.description && <span className="text-stone-600">— {r.description}</span>}
              {r.actor_name && <span className="text-sky-400/70 ms-auto">👤 {r.actor_name}</span>}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
