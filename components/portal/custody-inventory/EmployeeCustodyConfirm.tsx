"use client";
// ════════════════════════════════════════════════════════════════════════════
// تأكيد استلام العهدة (الموظف) — للعهد بحالة pending_employee_confirmation.
// لكل قطعة: صورة استلام إلزامية (issue_employee) — تشترطها RPC التأكيد — ثم إقرار
// وتوقيع بالاسم. يستدعي civEmployeeConfirm الموجودة (لا نظام موازٍ). بعد النجاح تصبح
// العهدة active ويظهر للموظف طلب الإرجاع في تبويب «إرجاع العهدة».
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { usePortal } from "@/components/portal/PortalShell";
import {
  civGetMyAssignments, civUploadEvidence, civEvidencePath, civAttachEvidence, civEmployeeConfirm,
  type CivMyAssignment, type CivAssignmentItem,
} from "@/lib/portal/custodyInventory";

const card = "bg-stone-900 border border-stone-800 rounded-xl p-4";
const inp = "w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-200 placeholder:text-stone-600 focus:outline-none focus:ring-2 focus:ring-red-500";
const btnRed = "rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium";
const ACK = "أقر باستلام المعدات المذكورة بحالتها الموضحة، وأتحمل مسؤولية المحافظة عليها وإعادتها.";

export default function EmployeeCustodyConfirm({ onChanged }: { onChanged?: () => void } = {}) {
  const { t } = useI18n();
  const { profile } = usePortal();
  const uid = profile.id;
  const [rows, setRows] = useState<CivMyAssignment[]>([]);
  const [photos, setPhotos] = useState<Record<string, number>>({});      // itemId -> uploaded count
  const [ackName, setAckName] = useState<Record<string, string>>({});     // assignmentId -> name
  const [ackOn, setAckOn] = useState<Record<string, boolean>>({});
  const [note, setNote] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast(null), 4200); };

  const reload = useCallback(async () => {
    const r = await civGetMyAssignments();
    if (r.ok) setRows(((r.data as unknown as CivMyAssignment[]) ?? []).filter((a) => a.status === "pending_employee_confirmation"));
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  async function uploadReceipt(a: CivMyAssignment, item: CivAssignmentItem, file: File) {
    setBusy(true);
    const path = civEvidencePath(uid, a.id, "issue_employee", file.name);
    const up = await civUploadEvidence(path, file);
    if (!up.ok) { setBusy(false); flash(t({ ar: "تعذّر رفع الصورة: ", en: "Upload failed: " }) + up.error); return; }
    const at = await civAttachEvidence({ assignment_id: a.id, assignment_item_id: item.id, stage: "issue_employee", path, name: file.name, mime: file.type || "image/jpeg", size: file.size });
    setBusy(false);
    if (!at.ok) { flash(t({ ar: "تعذّر ربط الصورة: ", en: "Attach failed: " }) + at.error); return; }
    setPhotos((p) => ({ ...p, [item.id]: (p[item.id] ?? 0) + 1 }));
    flash(t({ ar: "أُضيفت صورة الاستلام.", en: "Receipt photo added." }));
  }

  function ready(a: CivMyAssignment): boolean {
    const items = a.items ?? [];
    if (items.length === 0) return false;
    if (!items.every((i) => (photos[i.id] ?? 0) >= 1)) return false;
    return !!ackOn[a.id] && !!(ackName[a.id] ?? profile.full_name ?? "").trim();
  }

  async function confirm(a: CivMyAssignment) {
    if (busy || !ready(a)) return;
    setBusy(true);
    const r = await civEmployeeConfirm(a.id, ACK, (ackName[a.id] ?? profile.full_name ?? "").trim(), note[a.id]?.trim() || undefined);
    setBusy(false);
    if (!r.ok) {
      flash(/evidence_required/.test(r.error) ? t({ ar: "صورة استلام إلزامية لكل قطعة.", en: "Receipt photo required per item." })
        : /not_pending/.test(r.error) ? t({ ar: "العهدة لم تعد بانتظار التأكيد.", en: "No longer pending." })
        : /could not find|schema|PGRST/i.test(r.error) ? t({ ar: "خدمة التأكيد غير مطبّقة في قاعدة البيانات.", en: "Confirm RPC not applied." })
        : t({ ar: "تعذّر التأكيد. أعد المحاولة.", en: "Confirm failed." }));
      return;
    }
    flash(t({ ar: "تم تأكيد استلام العهدة. يمكنك طلب الإرجاع لاحقًا.", en: "Custody confirmed. You can request return later." }));
    await reload();
    onChanged?.();
  }

  if (rows.length === 0)
    return <div className={card}><p className="text-xs text-stone-500">{t({ ar: "لا توجد عهد بانتظار تأكيد استلامك.", en: "No custody awaiting your confirmation." })}</p></div>;

  return (
    <div className="space-y-3">
      {rows.map((a) => (
        <section key={a.id} className={card}>
          <div className="flex items-center justify-between mb-2">
            <div>
              <span className="font-mono text-xs text-stone-400" dir="ltr">{a.assignment_number}</span>
              <div className="text-[11px] text-amber-400">{t({ ar: "بانتظار تأكيد استلامك — صوّر كل قطعة ثم أقرّ.", en: "Awaiting your confirmation — photo each item then acknowledge." })}</div>
            </div>
          </div>
          <div className="space-y-2">
            {(a.items ?? []).map((i) => (
              <div key={i.id} className="bg-stone-950 border border-stone-800 rounded-lg p-2 flex items-center gap-2 text-xs">
                <div className="flex-1 min-w-0">
                  <div className="text-stone-200">{i.asset_name} <span className="text-stone-500" dir="ltr">({i.asset_code})</span> × {i.quantity}</div>
                  <div className="text-[10px]">{(photos[i.id] ?? 0) > 0 ? <span className="text-emerald-500">✓ {t({ ar: "صورة الاستلام مضافة", en: "receipt photo added" })}</span> : <span className="text-amber-400">{t({ ar: "صورة استلام إلزامية", en: "receipt photo required" })}</span>}</div>
                </div>
                <label className={`rounded-lg ${(photos[i.id] ?? 0) > 0 ? "bg-stone-800 border border-stone-700" : "bg-red-600"} px-3 py-1.5 text-[11px] text-white cursor-pointer whitespace-nowrap ${busy ? "opacity-50 pointer-events-none" : ""}`}>
                  📷 {(photos[i.id] ?? 0) > 0 ? t({ ar: "إضافة أخرى", en: "Add more" }) : t({ ar: "صورة الاستلام", en: "Receipt photo" })}
                  <input type="file" accept="image/*" capture="environment" className="hidden" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadReceipt(a, i, f); e.target.value = ""; }} />
                </label>
              </div>
            ))}
          </div>
          <div className="border-t border-stone-800 mt-3 pt-3 space-y-2">
            <div className="text-[11px] text-stone-400">{ACK}</div>
            <input value={ackName[a.id] ?? profile.full_name ?? ""} onChange={(e) => setAckName((p) => ({ ...p, [a.id]: e.target.value }))} placeholder={t({ ar: "اسمك (توقيع)", en: "Your name (signature)" })} className={inp} />
            <input value={note[a.id] ?? ""} onChange={(e) => setNote((p) => ({ ...p, [a.id]: e.target.value }))} placeholder={t({ ar: "ملاحظة (اختياري)", en: "Note (optional)" })} className={inp} />
            <label className="flex items-center gap-2 text-xs text-stone-300">
              <input type="checkbox" checked={!!ackOn[a.id]} onChange={(e) => setAckOn((p) => ({ ...p, [a.id]: e.target.checked }))} />
              {t({ ar: "أقر باستلام العهدة وأوافق على الإقرار أعلاه.", en: "I acknowledge receiving the custody and accept the statement above." })}
            </label>
            <button disabled={busy || !ready(a)} onClick={() => void confirm(a)} className={`${btnRed} w-full py-2.5`}>{t({ ar: "تأكيد استلام العهدة", en: "Confirm receipt" })}</button>
          </div>
        </section>
      ))}
      {toast && <div className="fixed bottom-4 inset-x-4 z-50 mx-auto max-w-sm bg-stone-800 border border-stone-700 rounded-lg px-4 py-2 text-sm text-stone-100 text-center shadow-lg">{toast}</div>}
    </div>
  );
}
