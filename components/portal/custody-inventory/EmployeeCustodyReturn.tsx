"use client";
// إرجاع العهدة — الموظف يقدّم طلب إرجاع بصورة وحالة لكل قطعة + صورة إجمالية.
// لا يعيد المعدات للمخزون ولا يغلق العهدة إلا بعد فحص أمين العهدة/الأدمن/المالك.
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { usePortal } from "@/components/portal/PortalShell";
import {
  civGetMyAssignments, civListEvidence, civSignFiles, civUploadEvidence, civEvidencePath,
  civEmployeeSubmitReturn, civEmitEvent, CIV_EVIDENCE_BUCKET,
  type CivMyAssignment, type CivAssignmentItem, type CivEvidence,
} from "@/lib/portal/custodyInventory";

const card = "bg-stone-900 border border-stone-800 rounded-xl p-4";
const inp = "w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-200 placeholder:text-stone-600 focus:outline-none focus:ring-2 focus:ring-red-500";
const btnRed = "rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium";
const btnGhost = "rounded-lg bg-stone-800 border border-stone-700 text-stone-200 text-sm disabled:opacity-50";
const CONDS = [
  { v: "good", ar: "سليمة" }, { v: "has_notes", ar: "بها ملاحظات" }, { v: "damaged", ar: "تالفة" },
  { v: "incomplete", ar: "ناقصة" }, { v: "missing", ar: "مفقودة" },
];
type ItemForm = { quantity: string; condition: string; note: string; photos: string[] };

export default function EmployeeCustodyReturn() {
  const { t } = useI18n();
  const { profile } = usePortal();
  const uid = profile.id;
  const [rows, setRows] = useState<CivMyAssignment[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<Record<string, CivEvidence[]>>({});
  const [signed, setSigned] = useState<Record<string, string>>({});
  const [forms, setForms] = useState<Record<string, ItemForm>>({});      // itemId -> form
  const [groupPhotos, setGroupPhotos] = useState<Record<string, string[]>>({});  // assignmentId -> paths
  const [groupNote, setGroupNote] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast(null), 4200); };

  const reload = useCallback(async () => {
    const r = await civGetMyAssignments();
    if (r.ok) setRows(((r.data as unknown as CivMyAssignment[]) ?? []).filter((a) => ["active", "partially_returned", "rejected"].includes(a.status)));
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  async function toggle(a: CivMyAssignment) {
    const n = open === a.id ? null : a.id; setOpen(n); if (!n || evidence[n]) return;
    const r = await civListEvidence(a.id);
    if (!r.ok) return;
    setEvidence((p) => ({ ...p, [a.id]: r.data }));
    const map = await civSignFiles(CIV_EVIDENCE_BUCKET, r.data.map((e) => e.file_path));
    setSigned((p) => ({ ...p, ...map }));
  }
  const defForm = (item: CivAssignmentItem): ItemForm => ({ quantity: String(item.quantity - item.quantity_returned), condition: "good", note: "", photos: [] });
  const formOf = (item: CivAssignmentItem): ItemForm => forms[item.id] ?? defForm(item);
  function setForm(item: CivAssignmentItem, patch: Partial<ItemForm>) {
    setForms((p) => ({ ...p, [item.id]: { ...(p[item.id] ?? defForm(item)), ...patch } }));
  }
  async function uploadItemPhoto(a: CivMyAssignment, item: CivAssignmentItem, file: File) {
    setBusy(true);
    const path = civEvidencePath(uid, a.id, "return_item", file.name);
    const r = await civUploadEvidence(path, file);
    setBusy(false);
    if (!r.ok) { flash(t({ ar: "تعذّر رفع الصورة: ", en: "Upload failed: " }) + r.error); return; }
    setForms((p) => { const cur = p[item.id] ?? defForm(item); return { ...p, [item.id]: { ...cur, photos: [...cur.photos, path] } }; });
  }
  async function uploadGroupPhoto(a: CivMyAssignment, file: File) {
    setBusy(true);
    const path = civEvidencePath(uid, a.id, "return_group", file.name);
    const r = await civUploadEvidence(path, file);
    setBusy(false);
    if (!r.ok) { flash(t({ ar: "تعذّر رفع الصورة: ", en: "Upload failed: " }) + r.error); return; }
    setGroupPhotos((p) => ({ ...p, [a.id]: [...(p[a.id] ?? []), path] }));
  }

  async function submit(a: CivMyAssignment) {
    const items = (a.items ?? []).filter((i) => !["returned", "missing"].includes(i.status));
    const chosen = items.filter((i) => forms[i.id]);
    if (chosen.length === 0) { flash(t({ ar: "املأ بيانات قطعة واحدة على الأقل.", en: "Fill at least one item." })); return; }
    for (const i of chosen) {
      const f = formOf(i);
      if (f.photos.length < 1) { flash(t({ ar: "صورة إرجاع إلزامية لكل قطعة.", en: "Return photo required per item." })); return; }
      if (!f.condition) { flash(t({ ar: "حدّد حالة كل قطعة.", en: "Set each item condition." })); return; }
      if (f.condition !== "good" && !f.note.trim()) { flash(t({ ar: "ملاحظة إلزامية للحالة غير السليمة.", en: "Note required for non-good." })); return; }
      const rem = i.quantity - i.quantity_returned;
      if (Number(f.quantity) <= 0 || Number(f.quantity) > rem) { flash(t({ ar: "كمية إرجاع غير صحيحة.", en: "Bad return quantity." })); return; }
    }
    if ((groupPhotos[a.id]?.length ?? 0) < 1) { flash(t({ ar: "صورة إجمالية إلزامية للمعدات المرتجعة.", en: "Group return photo required." })); return; }
    setBusy(true);
    const r = await civEmployeeSubmitReturn(a.id,
      chosen.map((i) => { const f = formOf(i); return { assignment_item_id: i.id, quantity: Number(f.quantity), condition: f.condition, note: f.note.trim() || undefined, item_photos: f.photos }; }),
      { note: groupNote[a.id]?.trim() || undefined, group_photos: groupPhotos[a.id] ?? [] });
    setBusy(false);
    if (!r.ok) { flash(t({ ar: "تعذّر إرسال الطلب: ", en: "Submit failed: " }) + r.error); return; }
    void civEmitEvent("civ_return_requested", { assignment_id: a.id, title: "طلب إرجاع عهدة " + a.assignment_number });
    setForms({}); setGroupPhotos((p) => ({ ...p, [a.id]: [] })); await reload();
    flash(t({ ar: "أُرسل طلب الإرجاع، بانتظار فحص المسؤول.", en: "Return submitted, awaiting inspection." }));
  }

  function readyFor(a: CivMyAssignment): boolean {
    const items = (a.items ?? []).filter((i) => !["returned", "missing"].includes(i.status));
    const chosen = items.filter((i) => forms[i.id]);
    if (chosen.length === 0 || (groupPhotos[a.id]?.length ?? 0) < 1) return false;
    return chosen.every((i) => {
      const f = formOf(i); const rem = i.quantity - i.quantity_returned;
      return f.photos.length >= 1 && !!f.condition && (f.condition === "good" || !!f.note.trim()) && Number(f.quantity) > 0 && Number(f.quantity) <= rem;
    });
  }

  if (rows.length === 0) return <div className={card}><p className="text-xs text-stone-500">{t({ ar: "لا توجد عهدة قابلة للإرجاع باسمك.", en: "No returnable custody." })}</p></div>;

  return (
    <div className="space-y-3">
      {rows.map((a) => (
        <section key={a.id} className={card}>
          <div className="flex items-center justify-between">
            <div>
              <span className="font-mono text-xs text-stone-400" dir="ltr">{a.assignment_number}</span>
              {a.status === "rejected" && <span className="mr-2 text-[10px] text-amber-400">{t({ ar: "رُفض سابقًا — صحّح وأعد الإرسال", en: "Rejected — correct & resubmit" })}</span>}
              <div className="text-[11px] text-stone-500">{t({ ar: "صُرفت", en: "Issued" })}: {new Date(a.issued_at).toLocaleDateString("ar")}{a.expected_return_at ? ` · ${t({ ar: "الإرجاع المتوقع", en: "due" })}: ${new Date(a.expected_return_at).toLocaleDateString("ar")}` : ""}</div>
            </div>
            <button className={`${btnGhost} px-3 py-1 text-xs`} onClick={() => void toggle(a)}>{open === a.id ? t({ ar: "إخفاء", en: "Hide" }) : t({ ar: "إرجاع", en: "Return" })}</button>
          </div>
          {open === a.id && (
            <div className="mt-3 space-y-2">
              {(a.items ?? []).filter((i) => !["returned", "missing"].includes(i.status)).map((i) => {
                const f = formOf(i);
                const issuePhotos = (evidence[a.id] ?? []).filter((e) => e.assignment_item_id === i.id && (e.evidence_stage === "issue_item" || e.evidence_stage === "issue_employee"));
                return (
                  <div key={i.id} className="bg-stone-950 border border-stone-800 rounded-lg p-2 space-y-2">
                    <div className="text-sm text-stone-200">{i.asset_name} <span className="text-stone-500 text-xs" dir="ltr">({i.asset_code})</span> × {i.quantity - i.quantity_returned}</div>
                    {issuePhotos.length > 0 && <div className="flex gap-1 flex-wrap">{issuePhotos.map((e) => signed[e.file_path] && <img key={e.id} src={signed[e.file_path]} className="w-10 h-10 object-cover rounded border border-stone-700" alt="issue" title={t({ ar: "صورة الاستلام", en: "issue photo" })} />)}</div>}
                    <div className="grid grid-cols-2 gap-2">
                      <select value={f.condition} onChange={(e) => setForm(i, { condition: e.target.value })} className={inp}>{CONDS.map((c) => <option key={c.v} value={c.v}>{c.ar}</option>)}</select>
                      <label className={`${btnGhost} px-3 py-2 text-xs cursor-pointer text-center`}>📷 {f.photos.length > 0 ? `(${f.photos.length})` : t({ ar: "صورة إرجاع", en: "photo" })}
                        <input type="file" accept="image/*" capture="environment" className="hidden" disabled={busy} onChange={(e) => { const file = e.target.files?.[0]; if (file) void uploadItemPhoto(a, i, file); e.target.value = ""; }} /></label>
                      {i.quantity - i.quantity_returned > 1 && <input type="number" min={1} max={i.quantity - i.quantity_returned} value={f.quantity} onChange={(e) => setForm(i, { quantity: e.target.value })} className={inp} placeholder={t({ ar: "الكمية", en: "Qty" })} />}
                      <input value={f.note} onChange={(e) => setForm(i, { note: e.target.value })} placeholder={f.condition === "good" ? t({ ar: "ملاحظة (اختياري)", en: "Note (optional)" }) : t({ ar: "ملاحظة إلزامية", en: "Note (required)" })} className={`${inp} col-span-2`} />
                    </div>
                  </div>
                );
              })}
              {/* المجموعة */}
              <div className="border-t border-stone-800 pt-2 space-y-2">
                <label className={`${btnGhost} px-3 py-1.5 text-xs cursor-pointer inline-flex items-center gap-1`}>📷 {(groupPhotos[a.id]?.length ?? 0) > 0 ? t({ ar: `صور إجمالية: ${groupPhotos[a.id].length}`, en: `Group: ${groupPhotos[a.id].length}` }) : t({ ar: "صورة إجمالية إلزامية", en: "Required group photo" })}
                  <input type="file" accept="image/*" capture="environment" className="hidden" disabled={busy} onChange={(e) => { const file = e.target.files?.[0]; if (file) void uploadGroupPhoto(a, file); e.target.value = ""; }} /></label>
                <input value={groupNote[a.id] ?? ""} onChange={(e) => setGroupNote((p) => ({ ...p, [a.id]: e.target.value }))} placeholder={t({ ar: "ملاحظة عامة (اختياري)", en: "General note" })} className={inp} />
                <button disabled={busy || !readyFor(a)} onClick={() => void submit(a)} className={`${btnRed} w-full py-2.5`}>{t({ ar: "إرسال طلب الإرجاع", en: "Submit return request" })}</button>
              </div>
            </div>
          )}
        </section>
      ))}
      {toast && <div className="fixed bottom-4 inset-x-4 z-50 mx-auto max-w-sm bg-stone-800 border border-stone-700 rounded-lg px-4 py-2 text-sm text-stone-100 text-center shadow-lg">{toast}</div>}
    </div>
  );
}
