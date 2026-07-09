"use client";
// ════════════════════════════════════════════════════════════════════════
// وثائق موظف داخل ملفه (owner/manager/hr) — إضافة/تعديل/حذف soft بسبب. تخزين
// URL فقط (لا رفع ملف هنا — لا كسر للبنية). visibility يتحكم بظهورها للموظف.
// ════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import {
  hrListEmployeeDocuments, hrAdminUpsertDocument, hrAdminDeleteDocument, emitHrEvent,
  DOCUMENT_TYPE_LABELS, type HrDocument, type DocumentType, type DocumentVisibility, type HrEmployee,
} from "@/lib/portal/hr";

const inp = "w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-200 placeholder:text-stone-600 focus:outline-none focus:ring-2 focus:ring-red-500";
const btnRed = "rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium";
const btnGhost = "rounded-lg bg-stone-800 border border-stone-700 text-stone-200 text-sm disabled:opacity-50";
const chip = (cls: string) => `inline-block rounded-full border px-2 py-0.5 text-[10.5px] ${cls}`;

function daysLeft(expiry: string | null): number | null {
  if (!expiry) return null;
  return Math.round((new Date(expiry + "T00:00:00").getTime() - Date.now()) / 86400000);
}

export default function HrEmployeeDocuments({ employee, busy, setBusy, flash }: {
  employee: HrEmployee; busy: boolean; setBusy: (b: boolean) => void; flash: (m: string) => void;
}) {
  const { t } = useI18n();
  const [docs, setDocs] = useState<HrDocument[]>([]);
  const empty = { id: "", type: "national_id" as DocumentType, title: "", number: "", issue: "", expiry: "", fileUrl: "", visibility: "admin_only" as DocumentVisibility, notes: "" };
  const [f, setF] = useState(empty);
  const [del, setDel] = useState<{ id: string; reason: string } | null>(null);

  const reload = useCallback(async () => {
    const r = await hrListEmployeeDocuments(employee.id);
    if (r.ok) setDocs(r.data);
  }, [employee.id]);
  useEffect(() => { void reload(); }, [reload]);

  async function save() {
    if (!f.title.trim()) { flash(t({ ar: "عنوان الوثيقة مطلوب.", en: "Title required." })); return; }
    setBusy(true);
    const r = await hrAdminUpsertDocument({
      id: f.id || null, employeeId: employee.id, type: f.type, title: f.title.trim(),
      number: f.number.trim() || undefined, issue: f.issue || null, expiry: f.expiry || null,
      fileUrl: f.fileUrl.trim() || undefined, visibility: f.visibility, notes: f.notes.trim() || undefined,
    });
    setBusy(false);
    if (!r.ok) { flash(t({ ar: "تعذّر الحفظ: ", en: "Failed: " }) + r.error); return; }
    emitHrEvent({
      event: "hr_document_added", entity_id: r.data.id, title: "وثيقة: " + f.title.trim(),
      employee_name: employee.full_name, employee_user_id: f.visibility === "employee_visible" ? (employee.user_id || undefined) : undefined,
    });
    setF(empty);
    await reload();
    flash(t({ ar: "حُفظت الوثيقة.", en: "Document saved." }));
  }

  async function doDelete(d: HrDocument) {
    const reason = (del?.reason || "").trim();
    if (!reason) { flash(t({ ar: "سبب الحذف إلزامي.", en: "Reason required." })); return; }
    setBusy(true);
    const r = await hrAdminDeleteDocument(d.id, reason);
    setBusy(false);
    if (!r.ok) { flash(t({ ar: "تعذّر الحذف: ", en: "Delete failed: " }) + r.error); return; }
    setDel(null);
    await reload();
    flash(t({ ar: "حُذفت الوثيقة (حذف آمن).", en: "Document removed." }));
  }

  return (
    <div className="bg-stone-950 border border-stone-800 rounded-lg p-3 space-y-2">
      <div className="text-[11px] text-stone-400 font-medium">{t({ ar: "الوثائق", en: "Documents" })} ({docs.length})</div>
      {docs.map((d) => {
        const dl = daysLeft(d.expiry_date);
        return (
          <div key={d.id} className="flex items-center gap-2 flex-wrap text-[11px] border-t border-stone-800 pt-1.5">
            <span className={chip("bg-stone-800 text-sky-300 border-stone-700")}>{t(DOCUMENT_TYPE_LABELS[d.document_type] ?? { ar: d.document_type, en: d.document_type })}</span>
            <span className="text-stone-200">{d.title}</span>
            {d.document_number && <span className="font-mono text-stone-500" dir="ltr">{d.document_number}</span>}
            {d.expiry_date && (
              <span className={`font-mono ${dl != null && dl <= 30 ? "text-red-400" : dl != null && dl <= 90 ? "text-amber-400" : "text-stone-500"}`} dir="ltr">
                ⏳ {d.expiry_date}{dl != null ? ` (${dl}${t({ ar: "ي", en: "d" })})` : ""}
              </span>
            )}
            <span className={chip(d.visibility === "employee_visible" ? "bg-emerald-950 text-emerald-300 border-emerald-800" : "bg-stone-800 text-stone-400 border-stone-700")}>
              {d.visibility === "employee_visible" ? t({ ar: "ظاهرة للموظف", en: "Visible" }) : t({ ar: "إدارية", en: "Admin only" })}
            </span>
            {d.file_url && <a href={d.file_url} target="_blank" rel="noopener noreferrer" className="text-sky-400 underline">{t({ ar: "ملف", en: "File" })}</a>}
            <button type="button" className="text-stone-500 hover:text-red-400 underline"
              onClick={() => setF({ id: d.id, type: d.document_type, title: d.title, number: d.document_number || "", issue: d.issue_date || "", expiry: d.expiry_date || "", fileUrl: d.file_url || "", visibility: d.visibility, notes: d.notes || "" })}>
              {t({ ar: "تعديل", en: "Edit" })}
            </button>
            <button type="button" className="text-stone-500 hover:text-red-400 underline" onClick={() => setDel(del?.id === d.id ? null : { id: d.id, reason: "" })}>
              {t({ ar: "حذف", en: "Delete" })}
            </button>
            {del?.id === d.id && (
              <div className="w-full flex gap-2 flex-wrap items-center mt-1">
                <input value={del.reason} onChange={(e) => setDel({ id: d.id, reason: e.target.value })}
                  placeholder={t({ ar: "سبب الحذف (إلزامي)", en: "Reason (required)" })} className={inp + " flex-1 min-w-[140px]"} style={{ width: "auto" }} />
                <button type="button" disabled={busy} onClick={() => void doDelete(d)} className="rounded-lg bg-stone-900 border border-red-900 text-red-400 text-[11px] px-3 py-1.5 disabled:opacity-50">{t({ ar: "تأكيد", en: "Confirm" })}</button>
              </div>
            )}
          </div>
        );
      })}
      {/* نموذج إضافة/تعديل */}
      <div className="border-t border-stone-800 pt-2 grid gap-2 sm:grid-cols-2">
        <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as DocumentType })} className={inp}>
          {(Object.keys(DOCUMENT_TYPE_LABELS) as DocumentType[]).map((k) => <option key={k} value={k}>{t(DOCUMENT_TYPE_LABELS[k])}</option>)}
        </select>
        <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder={t({ ar: "عنوان الوثيقة *", en: "Title *" })} className={inp} />
        <input value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} placeholder={t({ ar: "رقم الوثيقة", en: "Number" })} dir="ltr" className={inp} />
        <input value={f.fileUrl} onChange={(e) => setF({ ...f, fileUrl: e.target.value })} placeholder={t({ ar: "رابط الملف (اختياري)", en: "File URL (optional)" })} dir="ltr" className={inp} />
        <div><label className="block text-[10px] text-stone-500 mb-0.5">{t({ ar: "الإصدار", en: "Issue" })}</label>
          <input type="date" value={f.issue} onChange={(e) => setF({ ...f, issue: e.target.value })} className={inp} dir="ltr" /></div>
        <div><label className="block text-[10px] text-stone-500 mb-0.5">{t({ ar: "الانتهاء", en: "Expiry" })}</label>
          <input type="date" value={f.expiry} onChange={(e) => setF({ ...f, expiry: e.target.value })} className={inp} dir="ltr" /></div>
        <select value={f.visibility} onChange={(e) => setF({ ...f, visibility: e.target.value as DocumentVisibility })} className={inp}>
          <option value="admin_only">{t({ ar: "إدارية فقط", en: "Admin only" })}</option>
          <option value="employee_visible">{t({ ar: "ظاهرة للموظف", en: "Employee visible" })}</option>
        </select>
        <input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder={t({ ar: "ملاحظات", en: "Notes" })} className={inp} />
      </div>
      <div className="flex gap-2">
        <button type="button" disabled={busy} onClick={() => void save()} className={`${btnRed} px-4 py-1.5 text-xs`}>{f.id ? t({ ar: "حفظ التعديل", en: "Save" }) : t({ ar: "إضافة وثيقة", en: "Add document" })}</button>
        {f.id && <button type="button" onClick={() => setF(empty)} className={`${btnGhost} px-3 py-1.5 text-xs`}>{t({ ar: "إلغاء", en: "Cancel" })}</button>}
      </div>
    </div>
  );
}
