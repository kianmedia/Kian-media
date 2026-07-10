"use client";
// عهدتي المسجلة — واجهة الموظف لنظام مخزون الأصول والعهد.
// الاستلام والإرجاع يتطلبان صورة واحدة على الأقل لكل قطعة (تُفرض في القاعدة والواجهة).
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { usePortal } from "@/components/portal/PortalShell";
import {
  civGetMyAssignments, civListEvidence, civSignFiles, civUploadEvidence, civAttachEvidence,
  civEvidencePath, civEmployeeConfirm, civRequestReturn, civEmitEvent, CIV_EVIDENCE_BUCKET,
  type CivAssignment, type CivAssignmentItem, type CivEvidence,
} from "@/lib/portal/custodyInventory";

const card = "bg-stone-900 border border-stone-800 rounded-xl p-4";
const inp = "w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-200 placeholder:text-stone-600 focus:outline-none focus:ring-2 focus:ring-red-500";
const btnRed = "rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium";
const btnGhost = "rounded-lg bg-stone-800 border border-stone-700 text-stone-200 text-sm disabled:opacity-50";
const ACK_TEXT = "أقر باستلام المعدات الموضحة بالحالة الظاهرة، وأتحمل مسؤولية المحافظة عليها وإعادتها.";
const RETURN_CONDITIONS = [
  { v: "as_issued", ar: "كما استلمتها" }, { v: "minor_damage", ar: "تلف بسيط" },
  { v: "major_damage", ar: "تلف واضح" }, { v: "missing", ar: "مفقودة" }, { v: "needs_maintenance", ar: "تحتاج صيانة" },
];

type A = CivAssignment & { items?: CivAssignmentItem[] };

export default function MyRegisteredCustody() {
  const { t } = useI18n();
  const { profile } = usePortal();
  const uid = profile.id;
  const [rows, setRows] = useState<A[]>([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast(null), 3800); };
  const [open, setOpen] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<Record<string, CivEvidence[]>>({});
  const [signed, setSigned] = useState<Record<string, string>>({});
  // صور الموظف المرفوعة لكل بند (issue_employee / return_employee) — لتفعيل الأزرار.
  const [itemPhotos, setItemPhotos] = useState<Record<string, number>>({});
  const [ack, setAck] = useState(false);
  const [ackName, setAckName] = useState(profile.full_name ?? "");
  // نموذج الإرجاع لكل بند.
  const [ret, setRet] = useState<Record<string, { qty: string; condition: string; note: string }>>({});

  const reload = useCallback(async () => {
    const r = await civGetMyAssignments();
    if (r.ok) setRows((r.data as unknown as A[]) ?? []);
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  async function loadEvidence(aid: string) {
    const r = await civListEvidence(aid);
    if (!r.ok) return;
    setEvidence((p) => ({ ...p, [aid]: r.data }));
    const paths = r.data.map((e) => e.file_path);
    const map = await civSignFiles(CIV_EVIDENCE_BUCKET, paths);
    setSigned((p) => ({ ...p, ...map }));
    const counts: Record<string, number> = {};
    for (const e of r.data) if (e.assignment_item_id) { const k = `${e.assignment_item_id}:${e.evidence_stage}`; counts[k] = (counts[k] ?? 0) + 1; }
    setItemPhotos((p) => ({ ...p, ...counts }));
  }
  function toggle(aid: string) { const n = open === aid ? null : aid; setOpen(n); if (n && !evidence[n]) void loadEvidence(n); }

  async function uploadItemPhoto(a: A, item: CivAssignmentItem, stage: "issue_employee" | "return_employee", file: File) {
    setBusy(true);
    const path = civEvidencePath(uid, a.id, stage, file.name);
    const up = await civUploadEvidence(path, file);
    if (!up.ok) { setBusy(false); flash(t({ ar: "تعذّر رفع الصورة: ", en: "Upload failed: " }) + up.error); return; }
    const at = await civAttachEvidence({ assignment_id: a.id, assignment_item_id: item.id, stage, path, name: file.name, mime: file.type, size: file.size });
    setBusy(false);
    if (!at.ok) { flash(t({ ar: "تعذّر ربط الصورة.", en: "Attach failed." })); return; }
    setItemPhotos((p) => ({ ...p, [`${item.id}:${stage}`]: (p[`${item.id}:${stage}`] ?? 0) + 1 }));
    flash(t({ ar: "أُضيفت الصورة.", en: "Photo added." }));
  }

  async function confirmReceipt(a: A) {
    const items = a.items ?? [];
    if (items.some((i) => (itemPhotos[`${i.id}:issue_employee`] ?? 0) < 1)) { flash(t({ ar: "ارفع صورة واحدة على الأقل لكل قطعة.", en: "Upload ≥1 photo per item." })); return; }
    if (!ack) { flash(t({ ar: "يجب الموافقة على الإقرار.", en: "You must accept the pledge." })); return; }
    if (!ackName.trim()) { flash(t({ ar: "اكتب اسمك في الإقرار.", en: "Enter your name." })); return; }
    setBusy(true);
    const r = await civEmployeeConfirm(a.id, ACK_TEXT, ackName.trim());
    setBusy(false);
    if (!r.ok) { flash((r.error.includes("evidence") ? t({ ar: "صورة لكل قطعة مطلوبة.", en: "Photo per item required." }) : t({ ar: "تعذّر التأكيد: ", en: "Failed: " }) + r.error)); return; }
    void civEmitEvent("civ_employee_confirmed", { assignment_id: a.id, title: "تأكيد استلام العهدة " + a.assignment_number });
    setAck(false); await reload(); flash(t({ ar: "تم تأكيد استلام العهدة.", en: "Custody confirmed." }));
  }

  async function submitReturn(a: A) {
    const items = a.items ?? [];
    const chosen = items.filter((i) => ret[i.id]);
    if (chosen.length === 0) { flash(t({ ar: "اختر قطعة واحدة على الأقل للإرجاع.", en: "Pick ≥1 item." })); return; }
    if (chosen.some((i) => (itemPhotos[`${i.id}:return_employee`] ?? 0) < 1)) { flash(t({ ar: "صورة إرجاع واحدة على الأقل لكل قطعة.", en: "≥1 return photo per item." })); return; }
    setBusy(true);
    const payload = chosen.map((i) => ({ assignment_item_id: i.id, quantity: Number(ret[i.id].qty) || undefined, condition: ret[i.id].condition, note: ret[i.id].note }));
    const r = await civRequestReturn(a.id, payload);
    setBusy(false);
    if (!r.ok) { flash((r.error.includes("evidence") ? t({ ar: "صورة إرجاع لكل قطعة مطلوبة.", en: "Return photo per item required." }) : t({ ar: "تعذّر الطلب: ", en: "Failed: " }) + r.error)); return; }
    void civEmitEvent("civ_return_requested", { assignment_id: a.id, title: "طلب إرجاع عهدة " + a.assignment_number });
    setRet({}); await reload(); flash(t({ ar: "أُرسل طلب الإرجاع للفحص.", en: "Return request sent." }));
  }

  const pending = rows.filter((r) => r.status === "pending_employee_confirmation");
  const active = rows.filter((r) => r.status === "active" || r.status === "partially_returned");
  const inReturn = rows.filter((r) => r.status === "return_requested" || r.status === "under_inspection");
  const history = rows.filter((r) => ["returned", "rejected", "cancelled"].includes(r.status));

  const itemPhotoInput = (a: A, item: CivAssignmentItem, stage: "issue_employee" | "return_employee") => (
    <label className={`${btnGhost} px-3 py-1.5 text-xs cursor-pointer inline-flex items-center gap-1`}>
      📷 {(itemPhotos[`${item.id}:${stage}`] ?? 0) > 0 ? t({ ar: `صور: ${itemPhotos[`${item.id}:${stage}`]}`, en: `Photos: ${itemPhotos[`${item.id}:${stage}`]}` }) : t({ ar: "أضف صورة", en: "Add photo" })}
      <input type="file" accept="image/*" capture="environment" className="hidden" disabled={busy}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadItemPhoto(a, item, stage, f); e.target.value = ""; }} />
    </label>
  );

  return (
    <div className="space-y-6">
      {/* بانتظار تأكيد الاستلام */}
      <section className={card}>
        <h2 className="text-base font-medium text-stone-100 mb-3">{t({ ar: "بانتظار تأكيد الاستلام", en: "Awaiting your confirmation" })}</h2>
        {pending.length === 0 ? <p className="text-xs text-stone-500">{t({ ar: "لا شيء بانتظارك.", en: "Nothing pending." })}</p> : pending.map((a) => (
          <div key={a.id} className="border border-stone-800 rounded-lg p-3 mb-3">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs text-stone-400" dir="ltr">{a.assignment_number}</span>
              <button className={`${btnGhost} px-3 py-1 text-xs`} onClick={() => toggle(a.id)}>{open === a.id ? t({ ar: "إخفاء", en: "Hide" }) : t({ ar: "التفاصيل", en: "Details" })}</button>
            </div>
            {a.purpose && <p className="text-xs text-stone-400 mt-1">{a.purpose}</p>}
            {open === a.id && (
              <div className="mt-3 space-y-2">
                {(a.items ?? []).map((i) => (
                  <div key={i.id} className="flex items-center justify-between gap-2 bg-stone-950 border border-stone-800 rounded-lg p-2">
                    <div className="text-sm text-stone-200">{i.asset_name} <span className="text-stone-500 text-xs" dir="ltr">({i.asset_code})</span> × {i.quantity}
                      {i.condition_at_issue && <span className="text-stone-500 text-[11px]"> — {i.condition_at_issue}</span>}</div>
                    {itemPhotoInput(a, i, "issue_employee")}
                  </div>
                ))}
                {/* صور أمين العهدة عند الصرف */}
                {(evidence[a.id] ?? []).filter((e) => e.evidence_stage === "issue_admin").length > 0 && (
                  <div className="flex gap-2 flex-wrap pt-1">
                    {(evidence[a.id] ?? []).filter((e) => e.evidence_stage === "issue_admin").map((e) => signed[e.file_path] && (
                      <a key={e.id} href={signed[e.file_path]} target="_blank" rel="noreferrer"><img src={signed[e.file_path]} alt="" className="w-14 h-14 object-cover rounded border border-stone-700" /></a>
                    ))}
                  </div>
                )}
                <label className="flex items-start gap-2 text-xs text-stone-300 pt-2">
                  <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5" />
                  <span>{ACK_TEXT}</span>
                </label>
                <input value={ackName} onChange={(e) => setAckName(e.target.value)} placeholder={t({ ar: "اكتب اسمك للإقرار", en: "Your name" })} className={inp} />
                <button disabled={busy} onClick={() => void confirmReceipt(a)} className={`${btnRed} w-full py-2.5`}>{t({ ar: "تأكيد استلام العهدة", en: "Confirm receipt" })}</button>
              </div>
            )}
          </div>
        ))}
      </section>

      {/* العهد النشطة + طلب إرجاع */}
      <section className={card}>
        <h2 className="text-base font-medium text-stone-100 mb-3">{t({ ar: "عهدي النشطة", en: "My active custody" })}</h2>
        {active.length === 0 ? <p className="text-xs text-stone-500">{t({ ar: "لا عهدة نشطة.", en: "No active custody." })}</p> : active.map((a) => (
          <div key={a.id} className="border border-stone-800 rounded-lg p-3 mb-3">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs text-stone-400" dir="ltr">{a.assignment_number}</span>
              <button className={`${btnGhost} px-3 py-1 text-xs`} onClick={() => toggle(a.id)}>{open === a.id ? t({ ar: "إخفاء", en: "Hide" }) : t({ ar: "طلب إرجاع", en: "Return" })}</button>
            </div>
            {a.expected_return_at && <p className="text-[11px] text-amber-400/80 mt-1">{t({ ar: "الإرجاع المتوقع: ", en: "Due: " })}{new Date(a.expected_return_at).toLocaleDateString("ar")}</p>}
            {open === a.id && (
              <div className="mt-3 space-y-2">
                {(a.items ?? []).filter((i) => !["returned", "missing"].includes(i.status)).map((i) => {
                  const r = ret[i.id];
                  return (
                    <div key={i.id} className="bg-stone-950 border border-stone-800 rounded-lg p-2 space-y-2">
                      <label className="flex items-center gap-2 text-sm text-stone-200">
                        <input type="checkbox" checked={!!r} onChange={(e) => setRet((p) => { const n = { ...p }; if (e.target.checked) n[i.id] = { qty: String(i.quantity - i.quantity_returned), condition: "as_issued", note: "" }; else delete n[i.id]; return n; })} />
                        {i.asset_name} <span className="text-stone-500 text-xs" dir="ltr">({i.asset_code})</span>
                      </label>
                      {r && (
                        <div className="grid grid-cols-2 gap-2 pl-6">
                          <input value={r.qty} onChange={(e) => setRet((p) => ({ ...p, [i.id]: { ...r, qty: e.target.value } }))} placeholder={t({ ar: "الكمية", en: "Qty" })} className={inp} />
                          <select value={r.condition} onChange={(e) => setRet((p) => ({ ...p, [i.id]: { ...r, condition: e.target.value } }))} className={inp}>
                            {RETURN_CONDITIONS.map((c) => <option key={c.v} value={c.v}>{c.ar}</option>)}
                          </select>
                          <input value={r.note} onChange={(e) => setRet((p) => ({ ...p, [i.id]: { ...r, note: e.target.value } }))} placeholder={t({ ar: "ملاحظة", en: "Note" })} className={`${inp} col-span-2`} />
                          <div className="col-span-2">{itemPhotoInput(a, i, "return_employee")}</div>
                        </div>
                      )}
                    </div>
                  );
                })}
                <button disabled={busy} onClick={() => void submitReturn(a)} className={`${btnRed} w-full py-2.5`}>{t({ ar: "إرسال طلب الإرجاع", en: "Submit return request" })}</button>
              </div>
            )}
          </div>
        ))}
      </section>

      {/* بانتظار الفحص */}
      {inReturn.length > 0 && (
        <section className={card}>
          <h2 className="text-base font-medium text-stone-100 mb-3">{t({ ar: "طلبات إرجاع قيد الفحص", en: "Returns under inspection" })}</h2>
          {inReturn.map((a) => <div key={a.id} className="text-xs font-mono text-stone-400 py-1" dir="ltr">{a.assignment_number} — {a.status}</div>)}
        </section>
      )}

      {/* السجل */}
      {history.length > 0 && (
        <section className={card}>
          <h2 className="text-base font-medium text-stone-100 mb-3">{t({ ar: "عهدي السابقة", en: "Past custody" })}</h2>
          {history.map((a) => <div key={a.id} className="text-xs font-mono text-stone-500 py-1 flex justify-between"><span dir="ltr">{a.assignment_number}</span><span>{a.status}</span></div>)}
        </section>
      )}

      {toast && <div className="fixed bottom-4 inset-x-4 z-50 mx-auto max-w-sm bg-stone-800 border border-stone-700 rounded-lg px-4 py-2 text-sm text-stone-100 text-center shadow-lg">{toast}</div>}
    </div>
  );
}
