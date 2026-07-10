"use client";
// صرف عهدة — الموظف يصرف المعدات بنفسه فورًا (عهدة نشطة مباشرة). صورة لكل قطعة + صورة مجموعة.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { usePortal } from "@/components/portal/PortalShell";
import {
  civEmployeeListAvailable, civEmployeeSelfIssue, civUploadEvidence, civSignFiles, civSelfEvidencePath,
  civEmitEvent, CIV_ASSETS_BUCKET, type CivAvailableAsset,
} from "@/lib/portal/custodyInventory";

const card = "bg-stone-900 border border-stone-800 rounded-xl p-4";
const inp = "w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-200 placeholder:text-stone-600 focus:outline-none focus:ring-2 focus:ring-red-500";
const btnRed = "rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium";
const btnGhost = "rounded-lg bg-stone-800 border border-stone-700 text-stone-200 text-sm disabled:opacity-50";
const ACK = "أقر باستلام المعدات الظاهرة بالحالة الحالية، وأتحمّل مسؤولية المحافظة عليها وإعادتها.";

interface Picked { asset: CivAvailableAsset; quantity: number }

export default function EmployeeCustodyIssue({ onIssued }: { onIssued?: () => void }) {
  const { t } = useI18n();
  const { profile } = usePortal();
  const uid = profile.id;
  const token = useMemo(() => Math.random().toString(36).slice(2) + Date.now().toString(36), []);
  const [avail, setAvail] = useState<CivAvailableAsset[]>([]);
  const [signed, setSigned] = useState<Record<string, string>>({});
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Picked[]>([]);
  const [itemPhotos, setItemPhotos] = useState<Record<string, string[]>>({});   // assetId -> paths
  const [groupPhotos, setGroupPhotos] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast(null), 4200); };

  const load = useCallback(async (query: string) => {
    const r = await civEmployeeListAvailable(query || undefined);
    if (!r.ok) return;
    setAvail(r.data);
    const paths = r.data.map((a) => a.photo_path).filter((p): p is string => !!p);
    const map = await civSignFiles(CIV_ASSETS_BUCKET, paths);
    setSigned((prev) => ({ ...prev, ...map }));
  }, []);
  useEffect(() => { void load(""); }, [load]);
  useEffect(() => { const id = window.setTimeout(() => void load(q), 300); return () => window.clearTimeout(id); }, [q, load]);

  function addAsset(a: CivAvailableAsset) {
    if (picked.find((p) => p.asset.id === a.id)) return;
    setPicked((p) => [...p, { asset: a, quantity: 1 }]);
  }
  function removeAsset(id: string) {
    setPicked((p) => p.filter((x) => x.asset.id !== id));
    setItemPhotos((p) => { const n = { ...p }; delete n[id]; return n; });
  }

  async function uploadItemPhoto(assetId: string, file: File) {
    setBusy(true);
    const path = civSelfEvidencePath(uid, token, "issue_item", file.name);
    const r = await civUploadEvidence(path, file);
    setBusy(false);
    if (!r.ok) { flash(t({ ar: "تعذّر رفع الصورة: ", en: "Upload failed: " }) + r.error); return; }
    setItemPhotos((p) => ({ ...p, [assetId]: [...(p[assetId] ?? []), path] }));
  }
  async function uploadGroupPhoto(file: File) {
    setBusy(true);
    const path = civSelfEvidencePath(uid, token, "issue_group", file.name);
    const r = await civUploadEvidence(path, file);
    setBusy(false);
    if (!r.ok) { flash(t({ ar: "تعذّر رفع الصورة: ", en: "Upload failed: " }) + r.error); return; }
    setGroupPhotos((p) => [...p, path]);
  }

  const ready = picked.length > 0 && picked.every((p) => (itemPhotos[p.asset.id]?.length ?? 0) >= 1) && groupPhotos.length >= 1 && ack;

  async function submit() {
    if (!ready) { flash(t({ ar: "أكمل الصور المطلوبة والإقرار.", en: "Complete required photos and pledge." })); return; }
    for (const p of picked) {
      if (p.asset.asset_type === "quantity_based" && (p.quantity <= 0 || p.quantity > p.asset.quantity_available)) {
        flash(t({ ar: `الكمية غير صحيحة لـ ${p.asset.asset_name}.`, en: "Bad quantity." })); return;
      }
    }
    setBusy(true);
    const r = await civEmployeeSelfIssue({
      items: picked.map((p) => ({ asset_id: p.asset.id, quantity: p.quantity, item_photos: itemPhotos[p.asset.id] ?? [] })),
      group_photos: groupPhotos, note: note.trim() || undefined,
    });
    setBusy(false);
    if (!r.ok) {
      const m = /insufficient_stock|reserved_shortage|asset_already_assigned|asset_unavailable/.test(r.error)
        ? t({ ar: "أحد الأصول لم يعد متاحًا بالكمية المطلوبة — حدّث القائمة.", en: "An asset is no longer available." })
        : t({ ar: "تعذّر صرف العهدة: ", en: "Issue failed: " }) + r.error;
      flash(m); void load(q); return;
    }
    void civEmitEvent("civ_self_issue", { assignment_id: r.data.id, title: "صرف ذاتي — عهدة " + r.data.assignment_number });
    setPicked([]); setItemPhotos({}); setGroupPhotos([]); setNote(""); setAck(false);
    flash(t({ ar: `تم صرف العهدة (${r.data.assignment_number}). أصبحت نشطة باسمك.`, en: `Custody ${r.data.assignment_number} issued & active.` }));
    onIssued?.();
    void load(q);
  }

  return (
    <div className="space-y-4">
      {/* المختارة */}
      {picked.length > 0 && (
        <section className={card}>
          <h3 className="text-sm font-medium text-white mb-3">{t({ ar: "المعدات المختارة", en: "Selected" })} ({picked.length})</h3>
          <div className="space-y-2">
            {picked.map((p) => (
              <div key={p.asset.id} className="bg-stone-950 border border-stone-800 rounded-lg p-2 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-stone-200 flex-1">{p.asset.asset_name} <span className="text-stone-500 text-xs" dir="ltr">({p.asset.asset_code})</span></span>
                  {p.asset.asset_type === "quantity_based" && (
                    <input type="number" min={1} max={p.asset.quantity_available} value={p.quantity}
                      onChange={(e) => setPicked((prev) => prev.map((x) => x.asset.id === p.asset.id ? { ...x, quantity: Number(e.target.value) } : x))} className={`${inp} w-20`} />
                  )}
                  <button onClick={() => removeAsset(p.asset.id)} className="text-red-400 text-xs">{t({ ar: "حذف", en: "Remove" })}</button>
                </div>
                <label className={`${btnGhost} px-3 py-1.5 text-xs cursor-pointer inline-flex items-center gap-1`}>
                  📷 {(itemPhotos[p.asset.id]?.length ?? 0) > 0 ? t({ ar: `صور: ${itemPhotos[p.asset.id].length}`, en: `Photos: ${itemPhotos[p.asset.id].length}` }) : t({ ar: "صورة إلزامية للقطعة", en: "Required item photo" })}
                  <input type="file" accept="image/*" capture="environment" className="hidden" disabled={busy}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadItemPhoto(p.asset.id, f); e.target.value = ""; }} />
                </label>
              </div>
            ))}
          </div>
          {/* صورة المجموعة + ملاحظة + إقرار + تأكيد */}
          <div className="mt-3 space-y-2 border-t border-stone-800 pt-3">
            <label className={`${btnGhost} px-3 py-1.5 text-xs cursor-pointer inline-flex items-center gap-1`}>
              📷 {groupPhotos.length > 0 ? t({ ar: `صور المجموعة: ${groupPhotos.length}`, en: `Group photos: ${groupPhotos.length}` }) : t({ ar: "صورة إجمالية إلزامية", en: "Required group photo" })}
              <input type="file" accept="image/*" capture="environment" className="hidden" disabled={busy}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadGroupPhoto(f); e.target.value = ""; }} />
            </label>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t({ ar: "ملاحظة عامة (اختياري)", en: "General note (optional)" })} className={inp} />
            <label className="flex items-start gap-2 text-xs text-stone-300">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5" /><span>{ACK}</span>
            </label>
            <button disabled={busy || !ready} onClick={() => void submit()} className={`${btnRed} w-full py-2.5`}>{t({ ar: "تأكيد صرف العهدة", en: "Confirm issue" })}</button>
          </div>
        </section>
      )}

      {/* المتاح */}
      <section className={card}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t({ ar: "ابحث باسم الأصل أو الرقم التسلسلي أو التصنيف", en: "Search asset/serial/category" })} className={`${inp} mb-3`} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {avail.map((a) => {
            const chosen = !!picked.find((p) => p.asset.id === a.id);
            return (
              <div key={a.id} className="flex items-center gap-3 bg-stone-950 border border-stone-800 rounded-lg p-2">
                {a.photo_path && signed[a.photo_path]
                  ? <img src={signed[a.photo_path]} alt="" className="w-12 h-12 object-cover rounded border border-stone-700" />
                  : <div className="w-12 h-12 rounded bg-stone-800 border border-stone-700 flex items-center justify-center text-stone-600 text-lg">📦</div>}
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-stone-200 truncate">{a.asset_name}</div>
                  <div className="text-[11px] text-stone-500 truncate" dir="ltr">{a.asset_code}{a.serial_number ? ` · ${a.serial_number}` : ""}</div>
                  <div className="text-[11px] text-stone-500">{a.category ?? ""}{a.location ? ` · ${a.location}` : ""} · {t({ ar: "متاح", en: "avail" })} {a.quantity_available}</div>
                </div>
                <button disabled={chosen} onClick={() => addAsset(a)} className={`${btnRed} px-3 py-1.5 text-xs`}>{chosen ? "✓" : t({ ar: "أضف", en: "Add" })}</button>
              </div>
            );
          })}
          {avail.length === 0 && <p className="text-xs text-stone-500 col-span-full py-3">{t({ ar: "لا توجد أصول متاحة.", en: "No available assets." })}</p>}
        </div>
      </section>

      {toast && <div className="fixed bottom-4 inset-x-4 z-50 mx-auto max-w-sm bg-stone-800 border border-stone-700 rounded-lg px-4 py-2 text-sm text-stone-100 text-center shadow-lg">{toast}</div>}
    </div>
  );
}
