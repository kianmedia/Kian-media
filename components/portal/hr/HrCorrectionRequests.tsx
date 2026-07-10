"use client";
// ════════════════════════════════════════════════════════════════════════
// طلبات تعديل الحضور (owner/manager/hr) — قبول ⇒ ينشئ/يعدّل سجل حضور عبر RPC
// محمي؛ رفض ⇒ سبب إلزامي. كل قرار يُوثّق ويُشعر الموظف بوابةً وإيميلًا.
// ════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import {
  hrListCorrections, hrAdminDecideCorrection, emitHrEvent,
  CORRECTION_TYPE_LABELS, type HrCorrectionRequest, type HrEmployee, type CorrectionStatus,
} from "@/lib/portal/hr";

const card = "bg-stone-900 border border-stone-800 rounded-xl p-4";
const inp = "w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-200 focus:outline-none focus:ring-2 focus:ring-red-500";
const btnRed = "rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium";
const chip = (cls: string) => `inline-block rounded-full border px-2 py-0.5 text-[10.5px] ${cls}`;

const STATUS_LABELS: Record<CorrectionStatus, { ar: string; en: string }> = {
  pending:   { ar: "قيد المراجعة", en: "Pending" },
  approved:  { ar: "معتمد",        en: "Approved" },
  rejected:  { ar: "مرفوض",        en: "Rejected" },
  cancelled: { ar: "ملغى",         en: "Cancelled" },
};

export default function HrCorrectionRequests({ employees, pendingOnly, onClearFilter, busy, setBusy, flash, onChanged }: {
  employees: HrEmployee[]; pendingOnly: boolean; onClearFilter: () => void;
  busy: boolean; setBusy: (b: boolean) => void; flash: (m: string) => void; onChanged: () => void;
}) {
  const { t, isAr } = useI18n();
  const [rows, setRows] = useState<HrCorrectionRequest[]>([]);
  const [note, setNote] = useState<Record<string, string>>({});

  const reload = useCallback(async () => {
    const r = await hrListCorrections();
    if (r.ok) setRows(r.data);
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  const empName = (userId: string) => employees.find((e) => e.user_id === userId)?.full_name || userId.slice(0, 8);
  const fmtDT = (iso: string | null) => iso ? new Date(iso).toLocaleString(isAr ? "ar-SA" : "en-GB", { dateStyle: "short", timeStyle: "short" }) : "—";

  async function decide(r: HrCorrectionRequest, approve: boolean) {
    const n = (note[r.id] || "").trim();
    if (!approve && !n) { flash(t({ ar: "سبب الرفض إلزامي.", en: "Rejection reason required." })); return; }
    setBusy(true);
    const res = await hrAdminDecideCorrection(r.id, approve, n || undefined);
    setBusy(false);
    if (!res.ok) { flash(t({ ar: "تعذّر: ", en: "Failed: " }) + res.error); return; }
    emitHrEvent({
      event: "hr_correction_decided", entity_id: r.id,
      title: (approve ? "اعتماد طلب تعديل حضور — " : "رفض طلب تعديل حضور — ") + empName(r.user_id),
      employee_name: empName(r.user_id), employee_user_id: r.user_id,
    });
    setNote((p) => ({ ...p, [r.id]: "" }));
    await reload();
    onChanged();
    flash(approve ? t({ ar: "اعتُمد الطلب وحُدّث سجل الحضور.", en: "Approved & attendance updated." }) : t({ ar: "رُفض الطلب.", en: "Rejected." }));
  }

  const pending = rows.filter((r) => r.status === "pending");
  const list = pendingOnly ? pending : [...pending, ...rows.filter((r) => r.status !== "pending")];

  return (
    <div className="space-y-3">
      {pendingOnly && (
        <div className="flex items-center gap-2 flex-wrap bg-stone-900 border border-red-900/60 rounded-lg px-3 py-2">
          <span className={chip("bg-red-950 text-red-300 border-red-800")}>🔎 {t({ ar: "الطلبات المعلّقة فقط", en: "Pending only" })}</span>
          <button type="button" onClick={onClearFilter} className="ms-auto text-xs text-stone-300 underline">{t({ ar: "عرض الكل", en: "Show all" })}</button>
        </div>
      )}
      {list.length === 0 && <p className="text-stone-500 text-sm">{t({ ar: "لا توجد طلبات تعديل حضور.", en: "No correction requests." })}</p>}
      {list.map((r) => (
        <div key={r.id} className={card + " space-y-2"}>
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <span className="text-stone-100 font-medium">{empName(r.user_id)}</span>
            <span className={chip("bg-stone-800 text-sky-300 border-stone-700")}>{t(CORRECTION_TYPE_LABELS[r.request_type] ?? { ar: r.request_type, en: r.request_type })}</span>
            <span className="font-mono text-stone-500" dir="ltr">{r.correction_date}{r.proposed_time ? ` · ${r.proposed_time.slice(0, 5)}` : ""}</span>
            <span className={chip(
              r.status === "approved" ? "bg-emerald-950 text-emerald-300 border-emerald-800"
              : r.status === "rejected" ? "bg-red-950 text-red-300 border-red-800"
              : r.status === "cancelled" ? "bg-stone-800 text-stone-400 border-stone-700"
              : "bg-sky-950 text-sky-300 border-sky-800")}>
              {t(STATUS_LABELS[r.status])}
            </span>
          </div>
          {r.employee_note && <p className="text-xs text-stone-400">{r.employee_note}</p>}
          {r.decision_note && <p className="text-[11px] text-stone-500">{t({ ar: "قرار: ", en: "Decision: " })}{r.decision_note}</p>}
          {r.decided_at && <p className="text-[10.5px] text-stone-600 font-mono" dir="ltr">{fmtDT(r.decided_at)}</p>}
          {r.status === "pending" && (
            <div className="flex gap-2 flex-wrap items-center">
              <input value={note[r.id] || ""} onChange={(e) => setNote((p) => ({ ...p, [r.id]: e.target.value }))}
                placeholder={t({ ar: "ملاحظة القرار (إلزامية عند الرفض)", en: "Decision note (required to reject)" })} className={inp + " flex-1 min-w-[180px]"} style={{ width: "auto" }} />
              <button type="button" disabled={busy} onClick={() => void decide(r, true)} className={`${btnRed} px-4 py-2 text-xs`}>{t({ ar: "اعتماد", en: "Approve" })}</button>
              <button type="button" disabled={busy} onClick={() => void decide(r, false)} className="rounded-lg bg-stone-900 border border-red-900 text-red-400 text-xs px-4 py-2 disabled:opacity-50">{t({ ar: "رفض", en: "Reject" })}</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
