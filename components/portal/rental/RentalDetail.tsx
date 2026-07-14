"use client";
// ════════════════════════════════════════════════════════════════════════════
// تفاصيل التأجير + كل إجراءات دورة الحياة (اعتماد/تسعير/عقد/توقيع/تسليم/إرجاع/فحص/
// رسوم/تأمين/إغلاق). كل انتقال عبر RPC خادمية (لا update مباشر). Modal علوي.
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useRef, useState } from "react";
import {
  rentalGet, rentalPrice, rentalDeposit, rentalGenerateContract, rentalSignContract,
  rentalStartHandover, rentalAddEvidence, rentalCompleteHandover, rentalRequestReturn,
  rentalStartInspection, rentalInspectItem, rentalCompleteReturn, rentalAddCharge, rentalApproveCharge,
  rentalClose, rentalCancel, rentalApprove, rentalReject, rentalRequestRevision, rentalDelete,
  rentalUpload, rentalUploadSignature, rentalItemEvidencePath, rentalOverallEvidencePath, emitRentalEvent, RENTAL_EVIDENCE_BUCKET,
  type RentalStatus,
} from "@/lib/portal/rental";
import { usePortal } from "@/components/portal/PortalShell";
import { rentalStatusAr } from "@/components/portal/rental/RentalConsole";
import { formatRiyadh, rentalErrorAr } from "@/lib/portal/rentalTime";
import { normalizeImageToJpeg } from "@/lib/portal/rentalImage";

type T = (m: { ar: string; en: string }) => string;
const inp = "w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-200 placeholder:text-stone-600 focus:outline-none focus:ring-2 focus:ring-red-500";
const btnRed = "rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium";
const btnGhost = "rounded-lg bg-stone-800 border border-stone-700 text-stone-200 text-sm disabled:opacity-50";
const box = "bg-stone-900 border border-stone-800 rounded-xl p-3";
const CONDITIONS = ["excellent", "good", "fair", "damaged"];
const RESULTS = ["available", "maintenance_required", "damaged", "missing", "quarantine"];
const CHARGE_TYPES = ["damage", "missing_item", "missing_accessory", "late_return", "misuse", "cleaning", "other"];
const money = (n: unknown) => (n == null ? "—" : Number(n).toLocaleString("ar"));

interface Detail { id: string; request_number: string; status: RentalStatus; rental_from: string | null; rental_to: string | null;
  subtotal: number; discount_total: number; additional_total: number; vat_rate: number; vat_amount: number; grand_total: number; currency: string;
  deposit_amount: number; deposit_status: string; deposit_received: number; deposit_applied: number; deposit_released: number; internal_note: string | null; customer_note: string | null;
  customer: { full_name?: string; company_name?: string; phone?: string; email?: string; party_type?: string } | null;
  items: Array<{ id: string; asset_id: string; asset_code: string; asset_name: string; quantity: number; status: string; condition_out: string | null; condition_in: string | null; serial_number: string | null }>;
  events: Array<{ from: string | null; to: string; reason: string | null; at: string }>;
  charges: Array<{ id: string; charge_type: string; description: string | null; estimate: number; approved_amount: number | null; status: string; from_deposit: number; additional_due: number }>;
  contract: { contract_number: string; status: string; signed_at: string | null; version?: number } | null;
  latest_contract: { id: string; contract_number: string; status: string; version?: number } | null;
}

export default function RentalDetail({ requestId, onClose, onChanged, t }: { requestId: string; onClose: () => void; onChanged: () => void; t: T }) {
  const [d, setD] = useState<Detail | null>(null);
  const [load, setLoad] = useState<"loading" | "ready" | "error">("loading");
  const [errMsg, setErrMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast(null), 3600); };

  const reload = useCallback(async () => {
    setLoad("loading");
    const r = await rentalGet(requestId);
    if (!r.ok) { setErrMsg(r.error); setLoad("error"); return; }
    setD(r.data as unknown as Detail); setLoad("ready");
  }, [requestId]);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, [onClose]);

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string, emit?: string) {
    setBusy(true); const r = await fn(); setBusy(false);
    if (!r.ok) { flash(rentalErrorAr(r.error)); return false; }
    if (emit) emitRentalEvent(emit, requestId);
    flash(okMsg); await reload(); onChanged(); return true;
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/70 p-3 sm:p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-3xl my-4 bg-stone-950 border border-stone-800 rounded-2xl shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-stone-800 sticky top-0 bg-stone-950 rounded-t-2xl z-10">
          <div><h2 className="text-sm font-semibold text-white" dir="ltr">{d?.request_number ?? "…"}</h2>{d && <span className="text-[11px] text-red-400">{rentalStatusAr(d.status)}</span>}</div>
          <button onClick={onClose} className={`${btnGhost} px-3 py-1.5 text-xs`}>{t({ ar: "إغلاق", en: "Close" })} ✕</button>
        </div>

        {load === "loading" && <div className="p-8 text-center text-sm text-stone-500">{t({ ar: "جارٍ التحميل…", en: "Loading…" })}</div>}
        {load === "error" && <div className="p-6"><div className="bg-red-950/40 border border-red-900/60 rounded-xl p-3 text-sm text-red-300">{t({ ar: "تعذّر: ", en: "Failed: " })}<span dir="ltr">{errMsg}</span></div></div>}

        {load === "ready" && d && (
          <div className="p-4 space-y-4">
            {/* ملخص */}
            <div className={`${box} grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs text-stone-300`}>
              <span>{t({ ar: "العميل", en: "Customer" })}: {d.customer?.company_name || d.customer?.full_name || "—"}</span>
              <span dir="ltr">{d.customer?.phone ?? ""}</span>
              <span dir="ltr">{formatRiyadh(d.rental_from)} → {formatRiyadh(d.rental_to)}</span>
              <span>{t({ ar: "الإجمالي", en: "Total" })}: {money(d.grand_total)} {d.currency}</span>
              <span>{t({ ar: "الضريبة", en: "VAT" })}: {money(d.vat_amount)} ({d.vat_rate}%)</span>
              <span>{t({ ar: "الوديعة", en: "Deposit" })}: {money(d.deposit_amount)} · {rentalStatusAr(d.deposit_status)}</span>
            </div>

            {/* البنود */}
            <div>
              <h3 className="text-xs font-medium text-stone-400 mb-1">{t({ ar: `المعدات (${d.items.length})`, en: `Items (${d.items.length})` })}</h3>
              <div className="space-y-1">{d.items.map((it) => (
                <div key={it.id} className="flex items-center justify-between bg-stone-950 border border-stone-800 rounded-lg p-2 text-xs">
                  <span className="text-stone-200">{it.asset_name} <span className="text-stone-500" dir="ltr">({it.asset_code})</span> × {it.quantity}</span>
                  <span className="text-[10px] text-stone-500">{rentalStatusAr(it.status)}{it.condition_out ? ` · خرج ${it.condition_out}` : ""}{it.condition_in ? ` · دخل ${it.condition_in}` : ""}</span>
                </div>
              ))}</div>
            </div>

            {/* شريط الإجراءات حسب الحالة */}
            <ActionBar d={d} busy={busy} setBusy={setBusy} run={run} reload={reload} flash={flash} onClose={onClose} onChanged={onChanged} t={t} />

            {/* التسعير + الوديعة (مالية) */}
            <FinancePanel d={d} run={run} t={t} />

            {/* المطالبات */}
            <ChargesPanel d={d} run={run} t={t} />

            {/* سجل الحالة */}
            <div>
              <h3 className="text-xs font-medium text-stone-400 mb-1">{t({ ar: "سجل الحالة", en: "History" })}</h3>
              <div className="max-h-40 overflow-y-auto space-y-1">{d.events.map((e, i) => (
                <div key={i} className="text-[11px] text-stone-500 flex justify-between border-t border-stone-800 py-1"><span>{rentalStatusAr(e.from ?? "")} → {rentalStatusAr(e.to)}{e.reason ? ` · ${e.reason}` : ""}</span><span dir="ltr">{formatRiyadh(e.at)}</span></div>
              ))}</div>
            </div>
          </div>
        )}
        {toast && <div className="sticky bottom-0 mx-3 mb-3 bg-stone-800 border border-stone-700 rounded-lg px-4 py-2 text-sm text-stone-100 text-center shadow-lg">{toast}</div>}
      </div>
    </div>
  );
}

// ─── شريط الإجراءات (state-driven) ───
function ActionBar({ d, busy, setBusy, run, reload, flash, onClose, onChanged, t }: { d: Detail; busy: boolean; setBusy: (b: boolean) => void; run: (fn: () => Promise<{ ok: boolean; error?: string }>, m: string, emit?: string) => Promise<boolean>; reload: () => Promise<void>; flash: (m: string) => void; onClose: () => void; onChanged: () => void; t: T }) {
  const s = d.status;
  const { caps } = usePortal();
  const [showHandover, setShowHandover] = useState(false);
  const [showInspect, setShowInspect] = useState(false);
  // حذف الطلب (المالك/السوبر أدمن) — يُرجِع المعدات ويغلق التفاصيل ويحدّث القائمة.
  async function doDelete() {
    if (!window.confirm(t({ ar: "حذف هذا الطلب نهائيًا؟ ستُرجَع المعدات المحجوزة للمخزون. لا يمكن التراجع.", en: "Delete this request permanently? Reserved equipment returns to stock. Cannot be undone." }))) return;
    setBusy(true);
    const r = await rentalDelete(d.id);
    setBusy(false);
    if (!r.ok) { flash(rentalErrorAr(r.error)); return; }
    flash(t({ ar: "حُذف الطلب وأُرجعت المعدات.", en: "Deleted; equipment returned." }));
    onChanged(); onClose();
  }
  return (
    <div className={`${box} space-y-2`}>
      <h3 className="text-xs font-medium text-stone-400">{t({ ar: "الإجراءات", en: "Actions" })}</h3>
      <div className="flex gap-2 flex-wrap">
        {s === "pending_approval" && <>
          <button disabled={busy} onClick={async () => { const msg = window.prompt(t({ ar: "رسالة للمستأجر (اختياري):", en: "Message to renter (optional):" })) ?? undefined; await run(() => rentalApprove(d.id, msg), t({ ar: "اعتُمد الطلب.", en: "Approved." }), "rental_approved"); }} className={`${btnRed} px-4 py-1.5 text-xs`}>{t({ ar: "اعتماد", en: "Approve" })}</button>
          <button disabled={busy} onClick={async () => { const reason = window.prompt(t({ ar: "سبب الرفض (إلزامي، يُرسل للمستأجر):", en: "Reject reason (required):" })); if (reason && reason.trim()) await run(() => rentalReject(d.id, reason.trim()), t({ ar: "رُفض الطلب.", en: "Rejected." }), "rental_rejected"); }} className={`${btnGhost} px-4 py-1.5 text-xs text-red-400`}>{t({ ar: "رفض", en: "Reject" })}</button>
          <button disabled={busy} onClick={async () => { const note = window.prompt(t({ ar: "ملاحظة التعديل المطلوبة (تُرسل للمستأجر):", en: "Revision note (to renter):" })); if (note && note.trim()) await run(() => rentalRequestRevision(d.id, note.trim()), t({ ar: "أُرسل طلب التعديل.", en: "Revision requested." }), "rental_revision_requested"); }} className={`${btnGhost} px-4 py-1.5 text-xs text-amber-400`}>{t({ ar: "طلب تعديل", en: "Request revision" })}</button>
        </>}
        {(s === "approved" || s === "awaiting_customer_confirmation") && <button disabled={busy} onClick={() => run(() => rentalGenerateContract(d.id), t({ ar: "أُنشئ العقد.", en: "Contract generated." }))} className={`${btnRed} px-4 py-1.5 text-xs`}>{t({ ar: "توليد العقد", en: "Generate contract" })}</button>}
        {s === "contract_pending_signature" && d.latest_contract && <SignInline contractId={d.latest_contract.id} run={run} t={t} />}
        {(s === "scheduled" || s === "preparing" || s === "ready_for_handover") && <button disabled={busy} onClick={() => setShowHandover(true)} className={`${btnRed} px-4 py-1.5 text-xs`}>{t({ ar: "التجهيز والتسليم", en: "Handover" })}</button>}
        {(s === "active" || s === "overdue") && <button disabled={busy} onClick={() => run(() => rentalRequestReturn(d.id), t({ ar: "سُجّل طلب الإرجاع.", en: "Return requested." }), "rental_return_requested")} className={`${btnGhost} px-4 py-1.5 text-xs`}>{t({ ar: "طلب إرجاع", en: "Request return" })}</button>}
        {s === "return_requested" && <button disabled={busy} onClick={() => run(() => rentalStartInspection(d.id), t({ ar: "بدأ الفحص.", en: "Inspection started." }), "rental_return_inspection_required")} className={`${btnRed} px-4 py-1.5 text-xs`}>{t({ ar: "بدء فحص الإرجاع", en: "Start inspection" })}</button>}
        {s === "inspection_pending" && <>
          <button disabled={busy} onClick={() => setShowInspect(true)} className={`${btnRed} px-4 py-1.5 text-xs`}>{t({ ar: "فحص القطع", en: "Inspect items" })}</button>
          <button disabled={busy} onClick={() => run(() => rentalCompleteReturn(d.id), t({ ar: "اكتمل الإرجاع.", en: "Return complete." }))} className={`${btnGhost} px-4 py-1.5 text-xs`}>{t({ ar: "إنهاء الفحص", en: "Complete return" })}</button>
        </>}
        {s === "charges_pending" && <button disabled={busy} onClick={() => run(() => rentalClose(d.id), t({ ar: "أُغلق التأجير.", en: "Closed." }), "rental_closed")} className={`${btnRed} px-4 py-1.5 text-xs`}>{t({ ar: "إغلاق التأجير", en: "Close rental" })}</button>}
        {["draft", "pending_approval", "approved", "awaiting_customer_confirmation", "contract_pending_signature", "scheduled", "preparing", "ready_for_handover"].includes(s) &&
          <button disabled={busy} onClick={async () => { const reason = window.prompt(t({ ar: "سبب الإلغاء:", en: "Cancel reason:" })); if (reason && reason.trim()) await run(() => rentalCancel(d.id, reason.trim()), t({ ar: "أُلغي.", en: "Cancelled." })); }} className={`${btnGhost} px-4 py-1.5 text-xs text-stone-500`}>{t({ ar: "إلغاء", en: "Cancel" })}</button>}
        {caps.isOwner && !["active", "overdue"].includes(s) &&
          <button disabled={busy} onClick={() => void doDelete()} className={`${btnGhost} px-4 py-1.5 text-xs text-red-500 border-red-900/60`}>{t({ ar: "🗑 حذف الطلب", en: "Delete request" })}</button>}
      </div>
      {showHandover && <HandoverPanel d={d} onDone={async () => { setShowHandover(false); await reload(); }} flash={flash} t={t} />}
      {showInspect && <InspectPanel d={d} onDone={async () => { setShowInspect(false); await reload(); }} flash={flash} t={t} />}
    </div>
  );
}

// ─── توقيع مضمّن (اسم + لوحة رسم canvas) ───
function SignInline({ contractId, run, t }: { contractId: string; run: (fn: () => Promise<{ ok: boolean; error?: string }>, m: string, emit?: string) => Promise<boolean>; t: T }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(""); const [ack, setAck] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  function pos(e: React.PointerEvent<HTMLCanvasElement>) { const c = canvasRef.current!; const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  function down(e: React.PointerEvent<HTMLCanvasElement>) { drawing.current = true; const ctx = canvasRef.current!.getContext("2d")!; const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); }
  function move(e: React.PointerEvent<HTMLCanvasElement>) { if (!drawing.current) return; const ctx = canvasRef.current!.getContext("2d")!; const p = pos(e); ctx.lineWidth = 2; ctx.strokeStyle = "#fff"; ctx.lineTo(p.x, p.y); ctx.stroke(); }
  function up() { drawing.current = false; }
  function clear() { const c = canvasRef.current; if (c) c.getContext("2d")!.clearRect(0, 0, c.width, c.height); }
  async function sign() {
    if (!name.trim() || !ack) return;
    const c = canvasRef.current!; const dataUrl = c.toDataURL("image/png");
    const up2 = await rentalUploadSignature(contractId, "customer", dataUrl);
    if (!up2.ok) return;
    await run(() => rentalSignContract(contractId, name.trim(), up2.data, undefined, t({ ar: "أوافق على شروط العقد.", en: "I agree." })), t({ ar: "وُقّع العقد.", en: "Signed." }));
    setOpen(false);
  }
  if (!open) return <button onClick={() => setOpen(true)} className={`${btnRed} px-4 py-1.5 text-xs`}>{t({ ar: "توقيع العقد", en: "Sign contract" })}</button>;
  return (
    <div className="w-full space-y-2">
      <div className="text-[11px] text-amber-400/80">{t({ ar: "قالب تشغيلي يحتاج مراجعة واعتمادًا قانونيًا قبل الاستخدام الخارجي النهائي.", en: "Operational template — needs legal review before external use." })}</div>
      <input className={inp} placeholder={t({ ar: "اسم الموقّع", en: "Signer name" })} value={name} onChange={(e) => setName(e.target.value)} />
      <canvas ref={canvasRef} width={320} height={100} className="w-full bg-stone-800 border border-stone-700 rounded-lg touch-none" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} />
      <label className="flex items-center gap-2 text-xs text-stone-300"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />{t({ ar: "أوافق على شروط العقد.", en: "I agree to the contract terms." })}</label>
      <div className="flex gap-2"><button onClick={clear} className={`${btnGhost} px-3 py-1 text-xs`}>{t({ ar: "مسح", en: "Clear" })}</button><button disabled={!name.trim() || !ack} onClick={() => void sign()} className={`${btnRed} px-4 py-1 text-xs`}>{t({ ar: "توقيع", en: "Sign" })}</button></div>
    </div>
  );
}

// ─── لوحة توقيع قابلة لإعادة الاستخدام (canvas → dataURL) ───
function SigCanvas({ label, onChange }: { label: string; onChange: (dataUrl: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement | null>(null); const drawing = useRef(false); const dirty = useRef(false);
  function pos(e: React.PointerEvent<HTMLCanvasElement>) { const c = ref.current!; const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  function down(e: React.PointerEvent<HTMLCanvasElement>) { drawing.current = true; const ctx = ref.current!.getContext("2d")!; const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); }
  function move(e: React.PointerEvent<HTMLCanvasElement>) { if (!drawing.current) return; const ctx = ref.current!.getContext("2d")!; const p = pos(e); ctx.lineWidth = 2; ctx.strokeStyle = "#fff"; ctx.lineTo(p.x, p.y); ctx.stroke(); dirty.current = true; }
  function end() { if (drawing.current) { drawing.current = false; onChange(dirty.current ? ref.current!.toDataURL("image/png") : null); } }
  function clear() { const c = ref.current; if (c) c.getContext("2d")!.clearRect(0, 0, c.width, c.height); dirty.current = false; onChange(null); }
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between"><span className="text-[11px] text-stone-400">{label}</span><button onClick={clear} className="text-[10px] text-stone-500">مسح</button></div>
      <canvas ref={ref} width={320} height={90} className="w-full bg-stone-800 border border-stone-700 rounded-lg touch-none" onPointerDown={down} onPointerMove={move} onPointerUp={end} onPointerLeave={end} />
    </div>
  );
}

// ─── التجهيز والتسليم ───
function HandoverPanel({ d, onDone, flash, t }: { d: Detail; onDone: () => Promise<void>; flash: (m: string) => void; t: T }) {
  const [conds, setConds] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [overallDone, setOverallDone] = useState(false);
  const [custSig, setCustSig] = useState<string | null>(null);
  const [staffSig, setStaffSig] = useState<string | null>(null);
  useEffect(() => { void rentalStartHandover(d.id); }, [d.id]);
  async function addItemPhoto(itemId: string, file: File, condition: string) {
    setBusy(true);
    const norm = await normalizeImageToJpeg(file); if (!norm.ok) { flash(norm.error); setBusy(false); return; }
    const path = rentalItemEvidencePath(d.id, "handover", itemId, norm.file.name);
    const up = await rentalUpload(RENTAL_EVIDENCE_BUCKET, path, norm.file);
    if (up.ok) { const r = await rentalAddEvidence(d.id, itemId, "handover", up.data, condition); if (!r.ok) flash(rentalErrorAr(r.error)); else flash(t({ ar: "أُضيفت صورة القطعة.", en: "Item photo added." })); }
    else flash(t({ ar: "تعذّر الرفع.", en: "Upload failed." }));
    setBusy(false);
  }
  async function addOverallPhoto(file: File) {
    setBusy(true);
    const norm = await normalizeImageToJpeg(file); if (!norm.ok) { flash(norm.error); setBusy(false); return; }
    const path = rentalOverallEvidencePath(d.id, "handover", norm.file.name);
    const up = await rentalUpload(RENTAL_EVIDENCE_BUCKET, path, norm.file);
    if (up.ok) { const r = await rentalAddEvidence(d.id, null, "handover", up.data); if (r.ok) { setOverallDone(true); flash(t({ ar: "أُضيفت الصورة الإجمالية.", en: "Overall photo added." })); } else flash(rentalErrorAr(r.error)); }
    else flash(t({ ar: "تعذّر الرفع.", en: "Upload failed." }));
    setBusy(false);
  }
  async function complete() {
    if (!custSig || !staffSig) { flash(t({ ar: "توقيع المستأجر وموظف كيان مطلوبان.", en: "Both signatures required." })); return; }
    setBusy(true);
    const cu = await rentalUploadSignature(d.id, "customer", custSig);
    const su = await rentalUploadSignature(d.id, "staff", staffSig);
    if (!cu.ok || !su.ok) { setBusy(false); flash(t({ ar: "تعذّر رفع التواقيع.", en: "Signature upload failed." })); return; }
    const r = await rentalCompleteHandover(d.id, cu.data, su.data); setBusy(false);
    if (!r.ok) { flash(rentalErrorAr(r.error)); return; }
    emitRentalEvent("rental_activated", d.id);
    flash(t({ ar: "تم التسليم وتفعيل التأجير.", en: "Handover complete — activated." })); await onDone();
  }
  return (
    <div className="mt-2 border-t border-stone-800 pt-2 space-y-2">
      <div className="text-[11px] text-stone-500">{t({ ar: "صوّر كل قطعة + صورة إجمالية واحدة، وحدّد الحالة، ثم التوقيعان.", en: "Photo each item + one overall, set condition, then both signatures." })}</div>
      {d.items.map((it) => (
        <div key={it.id} className="bg-stone-950 border border-stone-800 rounded-lg p-2 space-y-1.5">
          <div className="text-xs text-stone-200">{it.asset_name} <span dir="ltr" className="text-stone-500">({it.asset_code})</span> × {it.quantity}</div>
          <div className="flex gap-2 items-center flex-wrap">
            <select className={`${inp} w-auto text-xs`} value={conds[it.id] ?? "good"} onChange={(e) => setConds((p) => ({ ...p, [it.id]: e.target.value }))}>{CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}</select>
            <label className={`${btnGhost} px-3 py-1.5 text-xs cursor-pointer`}>📷 {t({ ar: "صورة القطعة", en: "Item photo" })}<input type="file" accept="image/*" capture="environment" className="hidden" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) void addItemPhoto(it.id, f, conds[it.id] ?? "good"); e.target.value = ""; }} /></label>
            {it.condition_out && <span className="text-[10px] text-emerald-500/80">✓ {it.condition_out}</span>}
          </div>
        </div>
      ))}
      <div className="bg-stone-950 border border-stone-800 rounded-lg p-2 flex items-center gap-2">
        <label className={`${btnRed} px-3 py-1.5 text-xs cursor-pointer`}>📷 {t({ ar: "صورة إجمالية للطلب (إلزامية)", en: "Overall photo (required)" })}<input type="file" accept="image/*" capture="environment" className="hidden" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) void addOverallPhoto(f); e.target.value = ""; }} /></label>
        {overallDone && <span className="text-[10px] text-emerald-500">✓ {t({ ar: "أُضيفت", en: "added" })}</span>}
      </div>
      <SigCanvas label={t({ ar: "توقيع المستأجر", en: "Customer signature" })} onChange={setCustSig} />
      <SigCanvas label={t({ ar: "توقيع موظف كيان", en: "Kian staff signature" })} onChange={setStaffSig} />
      <button disabled={busy || !custSig || !staffSig} onClick={() => void complete()} className={`${btnRed} w-full py-2 text-xs`}>{t({ ar: "إتمام التسليم وتفعيل التأجير", en: "Complete handover & activate" })}</button>
    </div>
  );
}

// ─── فحص الإرجاع ───
function InspectPanel({ d, onDone, flash, t }: { d: Detail; onDone: () => Promise<void>; flash: (m: string) => void; t: T }) {
  const [busy, setBusy] = useState(false);
  const [overallDone, setOverallDone] = useState(false);
  const items = d.items.filter((i) => ["issued", "return_requested"].includes(i.status));
  const [sel, setSel] = useState<Record<string, { result: string; condition: string; note: string }>>({});
  async function addItemPhoto(itemId: string, file: File, condition: string) {
    setBusy(true);
    const norm = await normalizeImageToJpeg(file); if (!norm.ok) { flash(norm.error); setBusy(false); return; }
    const path = rentalItemEvidencePath(d.id, "return", itemId, norm.file.name);
    const up = await rentalUpload(RENTAL_EVIDENCE_BUCKET, path, norm.file);
    if (up.ok) { const r = await rentalAddEvidence(d.id, itemId, "return_inspection", up.data, condition); if (!r.ok) flash(rentalErrorAr(r.error)); else flash(t({ ar: "أُضيفت صورة الإرجاع.", en: "Return photo added." })); }
    else flash(t({ ar: "تعذّر الرفع.", en: "Upload failed." }));
    setBusy(false);
  }
  async function addOverallPhoto(file: File) {
    setBusy(true);
    const norm = await normalizeImageToJpeg(file); if (!norm.ok) { flash(norm.error); setBusy(false); return; }
    const path = rentalOverallEvidencePath(d.id, "return", norm.file.name);
    const up = await rentalUpload(RENTAL_EVIDENCE_BUCKET, path, norm.file);
    if (up.ok) { const r = await rentalAddEvidence(d.id, null, "return_inspection", up.data); if (r.ok) { setOverallDone(true); flash(t({ ar: "أُضيفت الصورة الإجمالية للإرجاع.", en: "Overall return photo added." })); } else flash(rentalErrorAr(r.error)); }
    else flash(t({ ar: "تعذّر الرفع.", en: "Upload failed." }));
    setBusy(false);
  }
  async function inspect(itemId: string, qty: number) {
    const v = sel[itemId] ?? { result: "available", condition: "good", note: "" };
    setBusy(true); const r = await rentalInspectItem(itemId, v.result, v.condition, qty, v.note); setBusy(false);
    if (!r.ok) { flash(rentalErrorAr(r.error)); return; }
    flash(t({ ar: "سُجّل الفحص.", en: "Inspected." })); await onDone();
  }
  return (
    <div className="mt-2 border-t border-stone-800 pt-2 space-y-2">
      <div className="text-[11px] text-stone-500">{t({ ar: "صوّر كل قطعة بعد الإرجاع + صورة إجمالية للمرتجع، وسجّل الفحص. لا يُغلق الإرجاع بلا صورة إجمالية.", en: "Photo each returned item + one overall; return can't complete without the overall photo." })}</div>
      {items.length === 0 ? <p className="text-xs text-stone-500">{t({ ar: "لا قطع بانتظار الفحص.", en: "No items to inspect." })}</p> : items.map((it) => (
        <div key={it.id} className="bg-stone-950 border border-stone-800 rounded-lg p-2 space-y-1.5">
          <div className="text-xs text-stone-200">{it.asset_name} <span dir="ltr" className="text-stone-500">({it.asset_code})</span> × {it.quantity}</div>
          <div className="grid grid-cols-2 gap-2">
            <select className={`${inp} text-xs`} value={sel[it.id]?.result ?? "available"} onChange={(e) => setSel((p) => ({ ...p, [it.id]: { ...(p[it.id] ?? { condition: "good", note: "" }), result: e.target.value } }))}>{RESULTS.map((r) => <option key={r} value={r}>{r}</option>)}</select>
            <select className={`${inp} text-xs`} value={sel[it.id]?.condition ?? "good"} onChange={(e) => setSel((p) => ({ ...p, [it.id]: { ...(p[it.id] ?? { result: "available", note: "" }), condition: e.target.value } }))}>{CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}</select>
          </div>
          <div className="flex gap-2 items-center flex-wrap">
            <label className={`${btnGhost} px-3 py-1.5 text-xs cursor-pointer`}>📷 {t({ ar: "صورة بعد الإرجاع", en: "Return photo" })}<input type="file" accept="image/*" capture="environment" className="hidden" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) void addItemPhoto(it.id, f, sel[it.id]?.condition ?? "good"); e.target.value = ""; }} /></label>
            <button disabled={busy} onClick={() => void inspect(it.id, it.quantity)} className={`${btnRed} px-3 py-1 text-xs`}>{t({ ar: "تسجيل فحص القطعة", en: "Record" })}</button>
          </div>
        </div>
      ))}
      <div className="bg-stone-950 border border-stone-800 rounded-lg p-2 flex items-center gap-2">
        <label className={`${btnRed} px-3 py-1.5 text-xs cursor-pointer`}>📷 {t({ ar: "صورة إجمالية للمرتجع (إلزامية)", en: "Overall return photo (required)" })}<input type="file" accept="image/*" capture="environment" className="hidden" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) void addOverallPhoto(f); e.target.value = ""; }} /></label>
        {overallDone && <span className="text-[10px] text-emerald-500">✓ {t({ ar: "أُضيفت", en: "added" })}</span>}
      </div>
    </div>
  );
}

// ─── التسعير + الوديعة (مالية — الخادم يفرض الصلاحية) ───
function FinancePanel({ d, run, t }: { d: Detail; run: (fn: () => Promise<{ ok: boolean; error?: string }>, m: string, emit?: string) => Promise<boolean>; t: T }) {
  const [p, setP] = useState({ subtotal: String(d.subtotal || ""), discount_total: String(d.discount_total || ""), additional_total: String(d.additional_total || ""), vat_rate: String(d.vat_rate ?? 15), deposit_amount: String(d.deposit_amount || "") });
  const [depAmt, setDepAmt] = useState("");
  if (["closed", "cancelled"].includes(d.status)) return null;
  return (
    <div className={`${box} space-y-2`}>
      <h3 className="text-xs font-medium text-stone-400">{t({ ar: "التسعير والوديعة (صلاحية مالية)", en: "Pricing & deposit (finance)" })}</h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {(["subtotal", "discount_total", "additional_total", "vat_rate", "deposit_amount"] as const).map((k) => (
          <input key={k} className={inp} type="number" placeholder={k} value={p[k]} onChange={(e) => setP((s) => ({ ...s, [k]: e.target.value }))} />
        ))}
        <button onClick={() => run(() => rentalPrice(d.id, { subtotal: Number(p.subtotal) || 0, discount_total: Number(p.discount_total) || 0, additional_total: Number(p.additional_total) || 0, vat_rate: Number(p.vat_rate) || 0, deposit_amount: Number(p.deposit_amount) || 0 }), t({ ar: "حُفظ التسعير.", en: "Priced." }))} className={`${btnRed} px-3 py-2 text-xs`}>{t({ ar: "حفظ التسعير", en: "Save pricing" })}</button>
      </div>
      <p className="text-[10px] text-stone-500">{t({ ar: "يتم إضافة ضريبة القيمة المضافة إلى الفاتورة النهائية.", en: "VAT is added to the final invoice." })}</p>
      <div className="flex gap-2 flex-wrap items-center border-t border-stone-800 pt-2">
        <input className={`${inp} w-32`} type="number" placeholder={t({ ar: "مبلغ", en: "Amount" })} value={depAmt} onChange={(e) => setDepAmt(e.target.value)} />
        <button onClick={() => run(() => rentalDeposit(d.id, "receive", Number(depAmt) || 0), t({ ar: "سُجّل استلام الوديعة.", en: "Deposit received." }))} className={`${btnGhost} px-3 py-1.5 text-xs`}>{t({ ar: "استلام وديعة", en: "Receive" })}</button>
        <button onClick={() => run(() => rentalDeposit(d.id, "release", Number(depAmt) || 0), t({ ar: "رُدّت الوديعة.", en: "Released." }))} className={`${btnGhost} px-3 py-1.5 text-xs`}>{t({ ar: "رد الوديعة", en: "Release" })}</button>
        <button onClick={() => run(() => rentalDeposit(d.id, "forfeit", 0), t({ ar: "صودرت الوديعة.", en: "Forfeited." }))} className={`${btnGhost} px-3 py-1.5 text-xs text-red-400`}>{t({ ar: "مصادرة", en: "Forfeit" })}</button>
        <span className="text-[11px] text-stone-500">{t({ ar: "مستلم", en: "held" })}: {money(d.deposit_received)} · {t({ ar: "مخصوم", en: "applied" })}: {money(d.deposit_applied)} · {t({ ar: "مردود", en: "released" })}: {money(d.deposit_released)}</span>
      </div>
    </div>
  );
}

// ─── المطالبات/الرسوم ───
function ChargesPanel({ d, run, t }: { d: Detail; run: (fn: () => Promise<{ ok: boolean; error?: string }>, m: string, emit?: string) => Promise<boolean>; t: T }) {
  const [nc, setNc] = useState({ item_id: "", type: "damage", desc: "", estimate: "" });
  if (!["active", "overdue", "return_requested", "inspection_pending", "charges_pending"].includes(d.status) && d.charges.length === 0) return null;
  return (
    <div className={`${box} space-y-2`}>
      <h3 className="text-xs font-medium text-stone-400">{t({ ar: "التلف والرسوم والمطالبات", en: "Charges & claims" })}</h3>
      {d.charges.map((c) => (
        <div key={c.id} className="flex items-center justify-between bg-stone-950 border border-stone-800 rounded-lg p-2 text-xs">
          <span className="text-stone-300">{c.charge_type}{c.description ? ` — ${c.description}` : ""} · {t({ ar: "تقدير", en: "est" })} {money(c.estimate)}{c.approved_amount != null ? ` · ${t({ ar: "معتمد", en: "appr" })} ${money(c.approved_amount)}` : ""}{c.status === "approved" ? ` · ${t({ ar: "من الوديعة", en: "deposit" })} ${money(c.from_deposit)}${c.additional_due > 0 ? ` · ${t({ ar: "فاتورة فرق", en: "invoice" })} ${money(c.additional_due)}` : ""}` : ""}</span>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-stone-500">{c.status}</span>
            {c.status === "reported" && <>
              <button onClick={() => { const ap = window.prompt(t({ ar: "القيمة المعتمدة:", en: "Approved amount:" })); const fd = window.prompt(t({ ar: "الخصم من الوديعة:", en: "From deposit:" }), "0"); if (ap != null) run(() => rentalApproveCharge(c.id, Number(ap) || 0, Number(fd) || 0, 0, false), t({ ar: "اعتُمد.", en: "Approved." })); }} className={`${btnGhost} px-2 py-0.5 text-[10px] text-emerald-400`}>{t({ ar: "اعتماد", en: "Approve" })}</button>
              <button onClick={() => run(() => rentalApproveCharge(c.id, 0, 0, 0, true), t({ ar: "رُفض.", en: "Rejected." }))} className={`${btnGhost} px-2 py-0.5 text-[10px] text-red-400`}>{t({ ar: "رفض", en: "Reject" })}</button>
            </>}
          </div>
        </div>
      ))}
      {["active", "overdue", "return_requested", "inspection_pending", "charges_pending"].includes(d.status) && (
        <div className="flex gap-2 flex-wrap items-center border-t border-stone-800 pt-2">
          <select className={`${inp} w-auto text-xs`} value={nc.item_id} onChange={(e) => setNc({ ...nc, item_id: e.target.value })}><option value="">{t({ ar: "عام", en: "General" })}</option>{d.items.map((i) => <option key={i.id} value={i.id}>{i.asset_name}</option>)}</select>
          <select className={`${inp} w-auto text-xs`} value={nc.type} onChange={(e) => setNc({ ...nc, type: e.target.value })}>{CHARGE_TYPES.map((c) => <option key={c} value={c}>{c}</option>)}</select>
          <input className={`${inp} flex-1 min-w-[120px] text-xs`} placeholder={t({ ar: "الوصف", en: "Description" })} value={nc.desc} onChange={(e) => setNc({ ...nc, desc: e.target.value })} />
          <input className={`${inp} w-24 text-xs`} type="number" placeholder={t({ ar: "تقدير", en: "Estimate" })} value={nc.estimate} onChange={(e) => setNc({ ...nc, estimate: e.target.value })} />
          <button onClick={() => run(() => rentalAddCharge(d.id, nc.item_id || null, nc.type as never, nc.desc, Number(nc.estimate) || 0).then((r) => { if (r.ok) setNc({ item_id: "", type: "damage", desc: "", estimate: "" }); return r; }), t({ ar: "سُجّلت المطالبة.", en: "Charge added." }))} className={`${btnRed} px-3 py-1.5 text-xs`}>{t({ ar: "تسجيل", en: "Add" })}</button>
        </div>
      )}
    </div>
  );
}
