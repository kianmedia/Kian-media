"use client";
// ════════════════════════════════════════════════════════════════════════════
// بوابة المستأجر — تأجيراته فقط (أعمدة آمنة): الحالة/الأسعار/الوديعة/المعدات/العقد.
// إجراءات: توقيع العقد، طلب الإرجاع. لا ملاحظات داخلية ولا بيانات عملاء آخرين.
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import {
  rentalCustomerList, rentalCustomerGet, rentalSignContract, rentalUploadContractSignature,
  rentalCustomerCreateRequest, rentalCustomerAvailableAssets, rentalCustomerSubmit, rentalConsentText,
  rentalCustomerLookupAsset, rentalDeleteObject, rentalUploadEvidence, rentalCustomerRequestReturn, rentalCustomerItems,
  rentalCustomerInvoices, emitRentalEvent, RENTAL_EVIDENCE_BUCKET, rentalRemoveRequestEvidence,
  type RentalCustomerView, type RentalRentableAsset, type RentalCreatedItem, type RentalDamageInvoice, type RentalCustomerItem,
} from "@/lib/portal/rental";
import { rentalStatusAr } from "@/components/portal/rental/RentalConsole";
import { riyadhInputToUtcISO, validateWindow, defaultRentalWindow, endPlus24h, formatRiyadh, rentalErrorAr, rentalUploadErrorAr } from "@/lib/portal/rentalTime";
import { normalizeImageToJpeg } from "@/lib/portal/rentalImage";
import { buildRentalContractAr, buildRentalContractEn, type RentalContractDetails } from "@/lib/portal/rentalContract";

const card = "bg-stone-900 border border-stone-800 rounded-xl p-4";
const inp = "w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-200 focus:outline-none focus:ring-2 focus:ring-red-500";
const btnRed = "rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium";
const btnGhost = "rounded-lg bg-stone-800 border border-stone-700 text-stone-200 text-sm disabled:opacity-50";
const money = (n: unknown) => (n == null ? "—" : Number(n).toLocaleString("ar"));

// ─── عقد التأجير كرابط يفتح النص الكامل (يعرض النص المعتمد من الإدارة إن وُجد، وإلا العقد الافتراضي) ───
function ContractDialog({ terms, details }: { terms?: string | null; details?: RentalContractDetails }) {
  const { t, isAr } = useI18n();
  const [open, setOpen] = useState(false);
  // نعتمد نص الإدارة فقط إن كان عقدًا فعليًا (طويلًا)؛ وإلا نعرض العقد الكامل المبني.
  const text = terms && terms.trim().length > 200 ? terms : isAr ? buildRentalContractAr(details) : buildRentalContractEn(details);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="text-[12px] text-red-400 hover:text-red-300 underline inline-flex items-center gap-1 whitespace-nowrap">
        <span>📄</span>{t({ ar: "عرض عقد التأجير كاملًا", en: "View full contract" })}
      </button>
      {open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/75" onClick={() => setOpen(false)}>
          <div className="bg-stone-900 border border-stone-700 rounded-xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-3 border-b border-stone-800 shrink-0">
              <div className="text-sm font-semibold text-white">{t({ ar: "عقد تأجير المعدّات", en: "Equipment Rental Contract" })}</div>
              <button onClick={() => setOpen(false)} className={`${btnGhost} px-3 py-1 text-xs`}>✕</button>
            </div>
            <div className="overflow-y-auto p-4 text-[12.5px] leading-7 text-stone-200 whitespace-pre-wrap" dir={isAr ? "rtl" : "ltr"}>{text}</div>
            <div className="p-3 border-t border-stone-800 text-center shrink-0">
              <button onClick={() => setOpen(false)} className={`${btnRed} px-6 py-1.5 text-xs`}>{t({ ar: "إغلاق", en: "Close" })}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function RenterRentalView() {
  const { t } = useI18n();
  const [rows, setRows] = useState<RentalCustomerView[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "not_prepared" | "error">("loading");
  const [errMsg, setErrMsg] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast(null), 3600); };

  const reload = useCallback(async () => {
    setState("loading");
    const r = await rentalCustomerList();
    if (!r.ok) { setErrMsg(r.error); setState(/does not exist|PGRST|schema|function/i.test(r.error) ? "not_prepared" : "error"); return; }
    setRows(r.data); setState("ready");
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">{t({ ar: "تأجيراتي", en: "My rentals" })}</h2>
        <button onClick={() => setCreating(true)} className={`${btnRed} px-4 py-1.5 text-xs`}>{t({ ar: "＋ طلب تأجير جديد", en: "+ New rental request" })}</button>
      </div>
      {creating && <RenterCreate onClose={() => setCreating(false)} onCreated={async () => { setCreating(false); await reload(); flash(t({ ar: "تم إنشاء الطلب.", en: "Request created." })); }} flash={flash} t={t} />}
      {state === "loading" && <p className="text-xs text-stone-500">{t({ ar: "جارٍ التحميل…", en: "Loading…" })}</p>}
      {state === "not_prepared" && <div className={`${card} text-sm text-amber-300`}>{t({ ar: "وحدة التأجير غير مجهزة حاليًا.", en: "Rental module not available yet." })}</div>}
      {state === "error" && <div className={`${card} text-sm text-red-300`}>{t({ ar: "تعذّر التحميل.", en: "Failed to load." })}</div>}
      {state === "ready" && rows.length === 0 && <div className={`${card} text-sm text-stone-400`}>{t({ ar: "لا تأجيرات لديك.", en: "You have no rentals." })}</div>}
      {state === "ready" && rows.map((r) => (
        <button key={r.id} onClick={() => setOpen(r.id)} className={`${card} w-full text-right flex items-center justify-between hover:border-red-700`}>
          <div><div className="text-sm text-stone-200 font-mono" dir="ltr">{r.request_number}</div><div className="text-[11px] text-stone-500">{rentalStatusAr(r.status)} · {money(r.grand_total)} {r.currency}</div></div>
          <div className="text-[11px] text-stone-400" dir="ltr">{formatRiyadh(r.rental_from, false)} → {formatRiyadh(r.rental_to, false)}</div>
        </button>
      ))}
      {open && <RenterDetail requestId={open} onClose={() => setOpen(null)} onChanged={reload} flash={flash} t={t} />}
      {toast && <div className="fixed bottom-4 inset-x-4 z-50 mx-auto max-w-sm bg-stone-800 border border-stone-700 rounded-lg px-4 py-2 text-sm text-stone-100 text-center shadow-lg">{toast}</div>}
    </div>
  );
}

function RenterDetail({ requestId, onClose, onChanged, flash, t }: { requestId: string; onClose: () => void; onChanged: () => void; flash: (m: string) => void; t: (m: { ar: string; en: string }) => string }) {
  const [d, setD] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [returning, setReturning] = useState(false);
  const [invoices, setInvoices] = useState<RentalDamageInvoice[]>([]);
  const reload = useCallback(async () => { const r = await rentalCustomerGet(requestId); if (r.ok) setD(r.data); const inv = await rentalCustomerInvoices(requestId); if (inv.ok) setInvoices(inv.data); }, [requestId]);
  useEffect(() => { void reload(); }, [reload]);
  const contract = (d?.contract ?? null) as { id?: string; contract_number?: string; status?: string; consent_text?: string } | null;
  const status = String(d?.status ?? "");
  const items = (d?.items ?? []) as Array<{ asset_name: string; quantity: number; status: string }>;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/70 p-3 sm:p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-lg my-4 bg-stone-950 border border-stone-800 rounded-2xl shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-stone-800">
          <div><h2 className="text-sm font-semibold text-white font-mono" dir="ltr">{String(d?.request_number ?? "…")}</h2><span className="text-[11px] text-red-400">{rentalStatusAr(status)}</span></div>
          <button onClick={onClose} className={`${btnGhost} px-3 py-1.5 text-xs`}>✕</button>
        </div>
        {!d ? <div className="p-8 text-center text-sm text-stone-500">…</div> : (
          <div className="p-4 space-y-3">
            <div className={`${card} grid grid-cols-2 gap-2 text-xs text-stone-300`}>
              <span>{t({ ar: "الإجمالي", en: "Total" })}: {money(d.grand_total)} {String(d.currency ?? "")}</span>
              <span>{t({ ar: "الضريبة", en: "VAT" })}: {money(d.vat_amount)}</span>
              <span>{t({ ar: "الوديعة/التأمين", en: "Deposit" })}: {Number(d.deposit_amount) > 0 ? `${money(d.deposit_amount)} ${String(d.currency ?? "SAR")}` : t({ ar: "تُحدَّد بعد المراجعة", en: "Set after review" })}</span>
              <span>{t({ ar: "حالة الوديعة", en: "Deposit status" })}: {rentalStatusAr(String(d.deposit_status ?? ""))}</span>
            </div>
            <div><div className="text-xs text-stone-400 mb-1">{t({ ar: "المعدات", en: "Equipment" })}</div>{items.map((i, k) => <div key={k} className="text-xs text-stone-300 border-t border-stone-800 py-1">{i.asset_name} × {i.quantity} <span className="text-stone-500">· {rentalStatusAr(i.status)}</span></div>)}</div>
            {invoices.length > 0 && <div className={`${card} space-y-1`}><div className="text-xs text-amber-400 mb-1">{t({ ar: "فواتير الأضرار", en: "Damage invoices" })}</div>{invoices.map((iv, k) => (
              <div key={k} className="flex items-center justify-between text-xs text-stone-300 border-t border-stone-800 py-1">
                <span className="font-mono" dir="ltr">{iv.invoice_number} · {money(iv.total)} {iv.currency} · {rentalStatusAr(iv.status)}</span>
                {iv.pdf_url ? <a href={iv.pdf_url} target="_blank" rel="noopener noreferrer" className="text-red-400">PDF</a> : null}
              </div>
            ))}</div>}
            {status === "contract_pending_signature" && contract?.id && <RenterSign requestId={requestId} contractId={contract.id} consent={contract.consent_text} flash={flash} onDone={async () => { await reload(); onChanged(); flash(t({ ar: "وُقّع العقد.", en: "Signed." })); }} t={t} />}
            {(status === "active" || status === "overdue") && !returning && <button disabled={busy} onClick={() => setReturning(true)} className={`${btnRed} w-full py-2 text-sm`}>{t({ ar: "طلب إرجاع المعدات", en: "Request return" })}</button>}
            {returning && <RenterReturn requestId={requestId} onDone={async () => { setReturning(false); emitRentalEvent("rental_return_requested", requestId); await reload(); onChanged(); flash(t({ ar: "أُرسل طلب الإرجاع.", en: "Return requested." })); }} onCancel={() => setReturning(false)} flash={flash} t={t} />}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── إنشاء طلب تأجير ذاتي (المستأجر) — لا customer_id من المتصفح؛ الخادم يحلّه من auth.uid() ───
// لوحة توقيع الإقرار (canvas → dataURL)
function ConsentPad({ onChange }: { onChange: (d: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement | null>(null); const drawing = useRef(false); const dirty = useRef(false);
  function pos(e: React.PointerEvent<HTMLCanvasElement>) { const c = ref.current!; const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  function down(e: React.PointerEvent<HTMLCanvasElement>) { drawing.current = true; const ctx = ref.current!.getContext("2d")!; const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); }
  function move(e: React.PointerEvent<HTMLCanvasElement>) { if (!drawing.current) return; const ctx = ref.current!.getContext("2d")!; const p = pos(e); ctx.lineWidth = 2; ctx.strokeStyle = "#fff"; ctx.lineTo(p.x, p.y); ctx.stroke(); dirty.current = true; }
  function end() { if (drawing.current) { drawing.current = false; onChange(dirty.current ? ref.current!.toDataURL("image/png") : null); } }
  function clear() { const c = ref.current; if (c) c.getContext("2d")!.clearRect(0, 0, c.width, c.height); dirty.current = false; onChange(null); }
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between"><span className="text-[11px] text-stone-400">توقيع المستأجر</span><button onClick={clear} className="text-[10px] text-stone-500">مسح</button></div>
      <canvas ref={ref} width={400} height={100} className="w-full bg-stone-800 border border-stone-700 rounded-lg touch-none" onPointerDown={down} onPointerMove={move} onPointerUp={end} onPointerLeave={end} />
    </div>
  );
}

type PhotoState = { status: "idle" | "uploading" | "done" | "error"; preview?: string; path?: string; err?: string };
const ID_TYPES: { v: string; ar: string }[] = [
  { v: "national_id", ar: "هوية وطنية" }, { v: "iqama", ar: "إقامة" }, { v: "cr", ar: "سجل تجاري" }, { v: "passport", ar: "جواز" }, { v: "other", ar: "أخرى" },
];

function RenterCreate({ onClose, onCreated, flash, t }: { onClose: () => void; onCreated: () => Promise<void>; flash: (m: string) => void; t: (m: { ar: string; en: string }) => string }) {
  const { isAr } = useI18n();
  const dw = useRef(defaultRentalWindow()).current;
  const [phase, setPhase] = useState<"form" | "evidence">("form");
  const [f, setF] = useState<Record<string, string>>({ rental_from: dw.from, rental_to: dw.to, id_type: "national_id" });
  const [q, setQ] = useState(""); const [barcode, setBarcode] = useState("");
  const [results, setResults] = useState<RentalRentableAsset[]>([]);
  const [searching, setSearching] = useState(false); const [searched, setSearched] = useState(false);
  const [cart, setCart] = useState<Array<{ asset_id: string; asset_name: string; quantity: number; max: number }>>([]);
  const [busy, setBusy] = useState(false); const [winErr, setWinErr] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; request_number: string; items: RentalCreatedItem[] } | null>(null);
  const [itemEv, setItemEv] = useState<Record<string, PhotoState>>({});
  const [overallEv, setOverallEv] = useState<PhotoState>({ status: "idle" });
  const [consent, setConsent] = useState<{ consent_text: string } | null>(null);
  const [sigData, setSigData] = useState<string | null>(null); const [ack, setAck] = useState(false);
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => { const e = validateWindow(f.rental_from, f.rental_to); setWinErr(e ? rentalErrorAr(e) : null); if (phase === "form") { setResults([]); setSearched(false); } }, [f.rental_from, f.rental_to, phase]);
  useEffect(() => { void rentalConsentText().then((r) => { if (r.ok) setConsent({ consent_text: r.data.consent_text }); }); }, []);
  function onFromChange(v: string) { set("rental_from", v); const fi = riyadhInputToUtcISO(v); const ti = riyadhInputToUtcISO(f.rental_to); if (fi && (!ti || new Date(ti).getTime() <= new Date(fi).getTime())) { const np = endPlus24h(v); if (np) set("rental_to", np); } }

  async function search() {
    const we = validateWindow(f.rental_from, f.rental_to); if (we) { flash(rentalErrorAr(we)); return; }
    setSearching(true);
    const r = await rentalCustomerAvailableAssets(riyadhInputToUtcISO(f.rental_from)!, riyadhInputToUtcISO(f.rental_to)!, q.trim() || undefined);
    setSearching(false); setSearched(true);
    if (r.ok) setResults(r.data); else { setResults([]); flash(rentalErrorAr(r.error)); }
  }
  async function addByBarcode() {
    const we = validateWindow(f.rental_from, f.rental_to); if (we) { flash(rentalErrorAr(we)); return; }
    const code = barcode.trim(); if (!code) { flash(rentalErrorAr("code_required")); return; }
    const r = await rentalCustomerLookupAsset(code, riyadhInputToUtcISO(f.rental_from)!, riyadhInputToUtcISO(f.rental_to)!);
    if (!r.ok) { flash(rentalErrorAr(r.error)); return; }
    if (!r.data.found || !r.data.asset_id) { flash(rentalErrorAr("asset_not_found")); return; }
    if (!r.data.is_available) { flash(t({ ar: "المعدة غير متاحة في الفترة المحددة.", en: "Not available." })); return; }
    addToCart({ asset_id: r.data.asset_id, asset_name: r.data.asset_name ?? code, asset_code: r.data.asset_code ?? code, asset_type: r.data.asset_type ?? "", serial_number: r.data.serial_number ?? null, catalog_photo_path: r.data.catalog_photo_path ?? null, photo_path: r.data.catalog_photo_path ?? null, total_quantity: r.data.total_quantity ?? 0, available_quantity: r.data.available_quantity ?? 0, is_available: true, available: true, availability_reason: null, next_available_at: null });
    setBarcode("");
  }
  function addToCart(a: RentalRentableAsset) {
    if (!a.available || a.available_quantity < 1) { flash(t({ ar: "غير متاح في الفترة المحددة.", en: "Not available." })); return; }
    setCart((c) => c.some((x) => x.asset_id === a.asset_id) ? c : [...c, { asset_id: a.asset_id, asset_name: a.asset_name, quantity: 1, max: a.available_quantity }]);
  }

  function identityMissing(): boolean {
    return !f.full_name?.trim() || !f.phone?.trim() || !f.id_type || !f.id_number_ref?.trim() || !f.address?.trim();
  }
  async function toEvidence() {
    if (busy) return;
    const we = validateWindow(f.rental_from, f.rental_to); if (we) { flash(rentalErrorAr(we)); return; }
    if (identityMissing()) { flash(rentalErrorAr("identity_incomplete")); return; }
    if (cart.length === 0) { flash(t({ ar: "أضف معدّة واحدة على الأقل.", en: "Add at least one item." })); return; }
    setBusy(true);
    const r = await rentalCustomerCreateRequest({
      full_name: f.full_name, phone: f.phone, id_type: f.id_type, id_number_ref: f.id_number_ref, address: f.address,
      rental_from: riyadhInputToUtcISO(f.rental_from), rental_to: riyadhInputToUtcISO(f.rental_to),
      delivery_location: f.delivery_location, return_location: f.return_location, customer_note: f.customer_note,
      items: cart.map((c) => ({ asset_id: c.asset_id, quantity: c.quantity })),
    });
    setBusy(false);
    if (!r.ok) { flash(rentalErrorAr(r.error)); return; }
    setCreated({ id: r.data.id, request_number: r.data.request_number, items: r.data.items ?? [] });
    setPhase("evidence");
  }
  // رفع صورة: تطبيع → Storage → إرفاق (RPC). عند فشل الإرفاق يُحذف الملف اليتيم. النجاح فقط بعد الإرفاق.
  async function doUpload(itemId: string | null, file: File) {
    if (!created) return;
    const setSt = (s: PhotoState) => { if (itemId) setItemEv((p) => ({ ...p, [itemId]: s })); else setOverallEv(s); };
    const prev = itemId ? itemEv[itemId] : overallEv;   // للتنظيف عند الاستبدال
    setSt({ status: "uploading" });
    const norm = await normalizeImageToJpeg(file);
    if (!norm.ok) { setSt({ status: "error", err: norm.error }); flash(norm.error); return; }
    // رفع مباشر بجلسة المستأجر ثم إرفاق عبر RPC. النجاح بعد الإرفاق فقط.
    const r = await rentalUploadEvidence({ rentalId: created.id, itemId, stage: "request", evidenceType: itemId ? "item_photo" : "overall_photo" }, norm.file);
    if (!r.ok) { setSt({ status: "error", err: rentalUploadErrorAr(r.error), preview: norm.previewUrl }); flash(rentalUploadErrorAr(r.error)); return; }
    setSt({ status: "done", preview: norm.previewUrl, path: r.data.path });
    // نظّف الدليل السابق عند الاستبدال (يمنع سجلًا يتيمًا وصورة قديمة في مراجعة الإدارة).
    if (prev?.path && prev.path !== r.data.path) {
      void rentalRemoveRequestEvidence(created.id, prev.path);
      void rentalDeleteObject(RENTAL_EVIDENCE_BUCKET, prev.path);
    }
    if (prev?.preview && prev.preview !== norm.previewUrl) { try { URL.revokeObjectURL(prev.preview); } catch { /* noop */ } }
    flash(itemId ? t({ ar: "أُضيفت صورة المعدة.", en: "Item photo added." }) : t({ ar: "أُضيفت الصورة الإجمالية.", en: "Overall photo added." }));
  }
  async function removePhoto(itemId: string | null) {
    if (!created) return;
    const st = itemId ? itemEv[itemId] : overallEv;
    if (st?.preview) { try { URL.revokeObjectURL(st.preview); } catch { /* noop */ } }
    if (st?.path) { await rentalRemoveRequestEvidence(created.id, st.path); void rentalDeleteObject(RENTAL_EVIDENCE_BUCKET, st.path); }
    if (itemId) setItemEv((p) => ({ ...p, [itemId]: { status: "idle" } })); else setOverallEv({ status: "idle" });
  }
  const allItemPhotos = created ? created.items.every((it) => itemEv[it.item_id]?.status === "done") : false;
  const overallDone = overallEv.status === "done";
  const anyUploading = overallEv.status === "uploading" || Object.values(itemEv).some((s) => s.status === "uploading");
  async function submit() {
    if (busy || !created || anyUploading) return;
    if (!allItemPhotos) { flash(rentalErrorAr("item_photo_required")); return; }
    if (!overallDone) { flash(rentalErrorAr("overall_photo_required")); return; }
    if (!sigData || !ack) { flash(rentalErrorAr("consent_required")); return; }
    setBusy(true);
    const sigBlob = await (await fetch(sigData)).blob();
    const sigFile = new File([sigBlob], "consent.png", { type: "image/png" });
    const sig = await rentalUploadEvidence({ rentalId: created.id, itemId: null, stage: "request", evidenceType: "signature" }, sigFile);
    if (!sig.ok) { setBusy(false); flash(rentalUploadErrorAr(sig.error)); return; }
    // نخزّن نص العقد الفعلي الذي عُرض للمستأجر (يطابق ما وقّع عليه): نص الإدارة إن كان عقدًا فعليًا،
    // وإلا العقد الكامل المبني بلغة الواجهة الحالية (كما يعرضه ContractDialog تمامًا).
    const storedTerms = consent?.consent_text && consent.consent_text.trim().length > 200
      ? consent.consent_text
      : isAr ? buildRentalContractAr(contractDetailsOf()) : buildRentalContractEn(contractDetailsOf());
    const r = await rentalCustomerSubmit(created.id, sig.data.path, storedTerms);
    setBusy(false);
    if (!r.ok) { flash(rentalErrorAr(r.error)); return; }
    emitRentalEvent("rental_request_created", created.id);
    flash(t({ ar: `أُرسل الطلب ${created.request_number}.`, en: `Sent ${created.request_number}.` }));
    await onCreated();
  }

  const cartName = (assetId: string) => cart.find((c) => c.asset_id === assetId)?.asset_name ?? assetId.slice(0, 8);
  const contractDetailsOf = (): RentalContractDetails => ({
    request_number: created?.request_number ?? null,
    renter_name: f.full_name,
    id_type: ID_TYPES.find((x) => x.v === f.id_type)?.ar ?? f.id_type,
    id_number: f.id_number_ref,
    phone: f.phone,
    address: f.address,
    rental_from: f.rental_from ? formatRiyadh(riyadhInputToUtcISO(f.rental_from) ?? "", true) : null,
    rental_to: f.rental_to ? formatRiyadh(riyadhInputToUtcISO(f.rental_to) ?? "", true) : null,
    delivery_location: f.delivery_location,
    return_location: f.return_location,
    items: created?.items.map((it) => ({ name: cartName(it.asset_id), quantity: it.quantity })) ?? [],
  });

  if (phase === "evidence" && created) {
    const contractDetails = contractDetailsOf();
    return (
      <div className={`${card} space-y-3`}>
        <div className="flex items-center justify-between"><h3 className="text-sm font-medium text-white">{t({ ar: "صور المعدات + الإقرار", en: "Photos + consent" })} <span className="font-mono text-[11px] text-stone-400" dir="ltr">{created.request_number}</span></h3><button onClick={onClose} className={`${btnGhost} px-3 py-1 text-xs`}>✕</button></div>
        <div className="text-[11px] text-stone-500">{t({ ar: "صوّر كل معدة (إلزامي، صورة واحدة على الأقل) + صورة إجمالية للمعدات، ثم وقّع الإقرار.", en: "Photo each item (≥1, required) + one overall, then sign." })}</div>
        {created.items.map((it) => { const st = itemEv[it.item_id] ?? { status: "idle" as const }; return (
          <div key={it.item_id} className="bg-stone-950 border border-stone-800 rounded-lg p-2 flex items-center gap-2 text-xs">
            {st.preview ? <img src={st.preview} alt="" className="w-11 h-11 object-cover rounded border border-stone-700" /> : <div className="w-11 h-11 rounded bg-stone-800 border border-stone-700 flex items-center justify-center text-stone-600">📷</div>}
            <div className="flex-1 min-w-0">
              <div className="text-stone-200 truncate">{cartName(it.asset_id)} × {it.quantity}</div>
              <div className="text-[10px]">
                {st.status === "done" ? <span className="text-emerald-500">✓ {t({ ar: "أُضيفت صورة", en: "1 photo" })}</span>
                  : st.status === "uploading" ? <span className="text-stone-400">⏳ {t({ ar: "جارٍ الرفع…", en: "Uploading…" })}</span>
                  : st.status === "error" ? <span className="text-red-400">{st.err ?? t({ ar: "فشل — أعد المحاولة", en: "Failed — retry" })}</span>
                  : <span className="text-amber-400">{t({ ar: "لا توجد صورة", en: "No photo" })}</span>}
              </div>
            </div>
            <label className={`${st.status === "done" ? btnGhost : btnRed} px-3 py-1.5 text-[11px] cursor-pointer whitespace-nowrap ${st.status === "uploading" ? "opacity-50 pointer-events-none" : ""}`}>📷 {st.status === "done" ? t({ ar: "استبدال", en: "Replace" }) : st.status === "error" ? t({ ar: "إعادة", en: "Retry" }) : t({ ar: "إضافة صورة", en: "Add photo" })}<input type="file" accept="image/*" capture="environment" className="hidden" disabled={st.status === "uploading"} onChange={(e) => { const file = e.target.files?.[0]; if (file) void doUpload(it.item_id, file); e.target.value = ""; }} /></label>
            {st.status === "done" && <button onClick={() => void removePhoto(it.item_id)} className="text-red-400 text-[11px]">{t({ ar: "حذف", en: "Remove" })}</button>}
          </div>
        ); })}
        <div className="bg-stone-950 border border-stone-800 rounded-lg p-2 flex items-center gap-2">
          {overallEv.preview ? <img src={overallEv.preview} alt="" className="w-11 h-11 object-cover rounded border border-stone-700" /> : <div className="w-11 h-11 rounded bg-stone-800 border border-stone-700 flex items-center justify-center text-stone-600">📷</div>}
          <div className="flex-1 min-w-0">
            <div className="text-stone-200 text-xs">{t({ ar: "صورة إجمالية للمعدات (إلزامية)", en: "Overall photo (required)" })}</div>
            <div className="text-[10px]">{overallEv.status === "done" ? <span className="text-emerald-500">✓ {t({ ar: "تم الرفع", en: "Uploaded" })}</span> : overallEv.status === "uploading" ? <span className="text-stone-400">⏳ {t({ ar: "جارٍ الرفع…", en: "Uploading…" })}</span> : overallEv.status === "error" ? <span className="text-red-400">{overallEv.err}</span> : <span className="text-amber-400">{t({ ar: "لا توجد صورة", en: "No photo" })}</span>}</div>
          </div>
          <label className={`${overallEv.status === "done" ? btnGhost : btnRed} px-3 py-1.5 text-[11px] cursor-pointer whitespace-nowrap ${overallEv.status === "uploading" ? "opacity-50 pointer-events-none" : ""}`}>📷 {overallEv.status === "done" ? t({ ar: "استبدال", en: "Replace" }) : overallEv.status === "error" ? t({ ar: "إعادة", en: "Retry" }) : t({ ar: "إضافة", en: "Add" })}<input type="file" accept="image/*" capture="environment" className="hidden" disabled={overallEv.status === "uploading"} onChange={(e) => { const file = e.target.files?.[0]; if (file) void doUpload(null, file); e.target.value = ""; }} /></label>
          {overallEv.status === "done" && <button onClick={() => void removePhoto(null)} className="text-red-400 text-[11px]">{t({ ar: "حذف", en: "Remove" })}</button>}
        </div>
        <div className="border-t border-stone-800 pt-2 space-y-2">
          <div className="flex items-center justify-between gap-2 bg-stone-950 border border-stone-800 rounded-lg p-2.5">
            <span className="text-[12px] text-stone-200 font-medium">{t({ ar: "عقد التأجير", en: "Rental contract" })}</span>
            <ContractDialog terms={consent?.consent_text} details={contractDetails} />
          </div>
          <div className="text-[11px] text-stone-400">{t({ ar: "اضغط الرابط أعلاه لقراءة العقد كاملًا. التوقيع أدناه يعني موافقتك على جميع بنوده.", en: "Open the link above to read the full contract. Signing below means you accept all its terms." })}</div>
          <ConsentPad onChange={setSigData} />
          <label className="flex items-center gap-2 text-xs text-stone-300"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />{t({ ar: "قرأتُ عقد التأجير وأوافق على جميع بنوده، وأُقرّ بصحة بياناتي.", en: "I have read and accept all terms of the rental contract, and confirm my data." })}</label>
        </div>
        <button disabled={busy || anyUploading || !allItemPhotos || !overallDone || !sigData || !ack} onClick={() => void submit()} className={`${btnRed} w-full py-2.5 text-sm flex items-center justify-center gap-2`}>{busy && <span className="inline-block w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />}{t({ ar: "توقيع وإرسال الطلب", en: "Sign & submit" })}</button>
      </div>
    );
  }

  return (
    <div className={`${card} space-y-3`}>
      <div className="flex items-center justify-between"><h3 className="text-sm font-medium text-white">{t({ ar: "طلب تأجير جديد", en: "New rental request" })}</h3><button onClick={onClose} className={`${btnGhost} px-3 py-1 text-xs`}>✕</button></div>

      {/* بيانات المستأجر (إلزامية) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-0.5"><label className="block text-[11px] text-stone-400 mb-1">{t({ ar: "الاسم الكامل *", en: "Full name *" })}</label><input className={inp} value={f.full_name ?? ""} onChange={(e) => set("full_name", e.target.value)} /></div>
        <div className="space-y-0.5"><label className="block text-[11px] text-stone-400 mb-1">{t({ ar: "الجوال *", en: "Phone *" })}</label><input className={inp} dir="ltr" value={f.phone ?? ""} onChange={(e) => set("phone", e.target.value)} /></div>
        <div className="space-y-0.5"><label className="block text-[11px] text-stone-400 mb-1">{t({ ar: "نوع الهوية *", en: "ID type *" })}</label><select className={inp} value={f.id_type} onChange={(e) => set("id_type", e.target.value)}>{ID_TYPES.map((x) => <option key={x.v} value={x.v}>{x.ar}</option>)}</select></div>
        <div className="space-y-0.5"><label className="block text-[11px] text-stone-400 mb-1">{t({ ar: "رقم الهوية *", en: "ID number *" })}</label><input className={inp} dir="ltr" value={f.id_number_ref ?? ""} onChange={(e) => set("id_number_ref", e.target.value)} /></div>
        <div className="space-y-0.5 sm:col-span-2"><label className="block text-[11px] text-stone-400 mb-1">{t({ ar: "العنوان *", en: "Address *" })}</label><input className={inp} value={f.address ?? ""} onChange={(e) => set("address", e.target.value)} /></div>
      </div>

      {/* التواريخ والمواقع */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-stone-800 pt-2">
        <div className="space-y-0.5"><label className="block text-[11px] text-stone-400 mb-1">{t({ ar: "بداية التأجير (استلام)", en: "Start" })}</label><input type="datetime-local" className={inp} value={f.rental_from ?? ""} onChange={(e) => onFromChange(e.target.value)} /></div>
        <div className="space-y-0.5"><label className="block text-[11px] text-stone-400 mb-1">{t({ ar: "نهاية التأجير (إرجاع)", en: "End" })}</label><input type="datetime-local" className={inp} value={f.rental_to ?? ""} min={f.rental_from} onChange={(e) => set("rental_to", e.target.value)} />{winErr && <span className="text-[11px] text-red-400">{winErr}</span>}</div>
        <div className="space-y-0.5"><label className="block text-[11px] text-stone-400 mb-1">{t({ ar: "موقع التسليم", en: "Delivery" })}</label><input className={inp} value={f.delivery_location ?? ""} onChange={(e) => set("delivery_location", e.target.value)} /></div>
        <div className="space-y-0.5"><label className="block text-[11px] text-stone-400 mb-1">{t({ ar: "موقع الإرجاع", en: "Return" })}</label><input className={inp} value={f.return_location ?? ""} onChange={(e) => set("return_location", e.target.value)} /></div>
      </div>
      <div className="text-[11px] text-stone-500">{t({ ar: "التوقيت بتوقيت الرياض (بالساعات). الوديعة تُحدَّد بعد مراجعة الإدارة.", en: "Asia/Riyadh time. Deposit set after review." })}</div>

      {/* اختيار المعدات: بحث أو باركود */}
      <div className="border-t border-stone-800 pt-2 space-y-2">
        <label className="block text-[11px] text-stone-400">{t({ ar: "أضف المعدات (بحث أو باركود/كود)", en: "Add equipment (search or barcode)" })}</label>
        <div className="flex gap-2"><input className={`${inp} flex-1`} placeholder={t({ ar: "باركود/QR/كود المعدة", en: "Barcode/QR/code" })} dir="ltr" value={barcode} onChange={(e) => setBarcode(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void addByBarcode(); }} /><button disabled={!!winErr} onClick={() => void addByBarcode()} className={`${btnGhost} px-3 py-2 text-xs`}>{t({ ar: "إضافة بالباركود", en: "By barcode" })}</button></div>
        <div className="flex gap-2"><input className={`${inp} flex-1`} placeholder={t({ ar: "اسم/كود المعدّة", en: "Name/code" })} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void search(); }} /><button disabled={searching || !!winErr} onClick={() => void search()} className={`${btnGhost} px-3 py-2 text-xs`}>{searching ? "…" : t({ ar: "بحث", en: "Search" })}</button></div>
        {searching && <div className="text-[11px] text-stone-500">{t({ ar: "جارٍ البحث…", en: "Searching…" })}</div>}
        {!searching && searched && results.length === 0 && <div className="text-[11px] text-amber-400">{t({ ar: "لا توجد معدات متاحة في هذه الفترة.", en: "No equipment available." })}</div>}
        {results.length > 0 && <div className="max-h-40 overflow-y-auto space-y-1">{results.map((a) => (
          <div key={a.asset_id} className="flex items-center justify-between bg-stone-950 border border-stone-800 rounded-lg p-2 text-xs">
            <span className="text-stone-200">{a.asset_name} <span className="text-stone-500" dir="ltr">({a.asset_code})</span> {a.photo_path ? "📷" : ""}<span className={`ms-2 ${a.available ? "text-emerald-500" : "text-amber-500"}`}>{a.available ? t({ ar: `متاح: ${a.available_quantity}`, en: `avail: ${a.available_quantity}` }) : t({ ar: "غير متاح", en: "n/a" })}</span></span>
            <button disabled={!a.available} onClick={() => addToCart(a)} className={`${btnGhost} px-2 py-1 text-[11px] disabled:opacity-40`}>{t({ ar: "＋ إضافة", en: "+ Add" })}</button>
          </div>
        ))}</div>}
      </div>
      {cart.length > 0 && <div className="space-y-1">{cart.map((c) => (
        <div key={c.asset_id} className="flex items-center gap-2 bg-stone-950 border border-stone-800 rounded-lg p-2 text-xs text-stone-300">
          <span className="flex-1">{c.asset_name}</span>
          <input className={`${inp} w-16`} type="number" min={1} max={c.max} value={c.quantity} onChange={(e) => { const q2 = Math.max(1, Math.min(c.max, Number(e.target.value) || 1)); setCart((cs) => cs.map((x) => x.asset_id === c.asset_id ? { ...x, quantity: q2 } : x)); }} />
          <button onClick={() => setCart((cs) => cs.filter((x) => x.asset_id !== c.asset_id))} className="text-red-400">{t({ ar: "حذف", en: "Remove" })}</button>
        </div>
      ))}</div>}
      <textarea className={inp} rows={2} placeholder={t({ ar: "ملاحظات (اختياري)", en: "Notes (optional)" })} value={f.customer_note ?? ""} onChange={(e) => set("customer_note", e.target.value)} />
      <button disabled={busy || !!winErr || cart.length === 0 || identityMissing()} onClick={() => void toEvidence()} className={`${btnRed} w-full py-2.5 text-sm`}>{t({ ar: "متابعة إلى الصور والتوقيع", en: "Continue to photos & sign" })}</button>
    </div>
  );
}

// ─── طلب إرجاع المستأجر (active/overdue فقط): حالة+صورة لكل معدة + إجمالية + توقيع ───
const RETURN_CONDS: { v: string; ar: string }[] = [
  { v: "good", ar: "سليمة" }, { v: "dirty", ar: "متسخة" }, { v: "scratched", ar: "مخدوشة" },
  { v: "broken", ar: "بها كسر" }, { v: "missing_accessory", ar: "مفقود ملحق" }, { v: "missing", ar: "مفقودة" }, { v: "other", ar: "أخرى" },
];
function RenterReturn({ requestId, onDone, onCancel, flash, t }: { requestId: string; onDone: () => Promise<void>; onCancel: () => void; flash: (m: string) => void; t: (m: { ar: string; en: string }) => string }) {
  const [items, setItems] = useState<RentalCustomerItem[]>([]);
  const [itemEv, setItemEv] = useState<Record<string, PhotoState>>({});
  const [conds, setConds] = useState<Record<string, string>>({});
  const [overallEv, setOverallEv] = useState<PhotoState>({ status: "idle" });
  const [sigData, setSigData] = useState<string | null>(null); const [ack, setAck] = useState(false);
  const [note, setNote] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => { void rentalCustomerItems(requestId).then((r) => { if (r.ok) setItems(r.data.filter((i) => ["issued", "return_requested"].includes(i.status))); }); }, [requestId]);
  async function doUpload(itemId: string | null, file: File) {
    const setSt = (s: PhotoState) => { if (itemId) setItemEv((p) => ({ ...p, [itemId]: s })); else setOverallEv(s); };
    const prev = itemId ? itemEv[itemId] : overallEv;   // للتنظيف عند الاستبدال
    setSt({ status: "uploading" });
    const norm = await normalizeImageToJpeg(file);
    if (!norm.ok) { setSt({ status: "error", err: norm.error }); flash(norm.error); return; }
    const r = await rentalUploadEvidence({ rentalId: requestId, itemId, stage: "return_request", evidenceType: itemId ? "item_photo" : "overall_photo", condition: itemId ? (conds[itemId] ?? "good") : undefined }, norm.file);
    if (!r.ok) { setSt({ status: "error", err: rentalUploadErrorAr(r.error), preview: norm.previewUrl }); flash(rentalUploadErrorAr(r.error)); return; }
    setSt({ status: "done", preview: norm.previewUrl, path: r.data.path });
    // مرحلة الإرجاع لا تملك RPC حذف؛ نحرّر معاينة الصورة السابقة عند الاستبدال (منع تسرّب ذاكرة).
    if (prev?.preview && prev.preview !== norm.previewUrl) { try { URL.revokeObjectURL(prev.preview); } catch { /* noop */ } }
  }
  const allItemPhotos = items.length > 0 && items.every((it) => itemEv[it.item_id]?.status === "done");
  const overallDone = overallEv.status === "done";
  const anyUploading = overallEv.status === "uploading" || Object.values(itemEv).some((s) => s.status === "uploading");
  async function submit() {
    if (busy || anyUploading) return;
    if (!allItemPhotos) { flash(rentalErrorAr("return_item_photo_required")); return; }
    if (!overallDone) { flash(rentalErrorAr("return_overall_photo_required")); return; }
    if (!sigData || !ack) { flash(rentalErrorAr("consent_required")); return; }
    setBusy(true);
    const blob = await (await fetch(sigData)).blob();
    const sig = await rentalUploadEvidence({ rentalId: requestId, itemId: null, stage: "return_request", evidenceType: "signature" }, new File([blob], "return-consent.png", { type: "image/png" }));
    if (!sig.ok) { setBusy(false); flash(rentalUploadErrorAr(sig.error)); return; }
    const r = await rentalCustomerRequestReturn(requestId, note.trim() || undefined);
    setBusy(false);
    if (!r.ok) { flash(rentalErrorAr(r.error)); return; }
    await onDone();
  }
  return (
    <div className={`${card} space-y-2`}>
      <div className="flex items-center justify-between"><div className="text-xs font-medium text-white">{t({ ar: "طلب إرجاع المعدات", en: "Return request" })}</div><button onClick={onCancel} className={`${btnGhost} px-2 py-0.5 text-[11px]`}>✕</button></div>
      <div className="text-[11px] text-stone-500">{t({ ar: "حدّد حالة كل معدة وصوّرها + صورة إجمالية للمرتجع، ثم وقّع. الإدارة تفحص وتغلق.", en: "Set + photo each item + one overall, then sign. Staff inspect & close." })}</div>
      {items.map((it) => { const st = itemEv[it.item_id] ?? { status: "idle" as const }; return (
        <div key={it.item_id} className="bg-stone-950 border border-stone-800 rounded-lg p-2 space-y-1.5 text-xs">
          <div className="text-stone-200">{it.asset_name} <span dir="ltr" className="text-stone-500">({it.asset_code})</span> × {it.quantity}</div>
          <div className="flex items-center gap-2 flex-wrap">
            <select className={`${inp} w-auto text-xs`} value={conds[it.item_id] ?? "good"} onChange={(e) => setConds((p) => ({ ...p, [it.item_id]: e.target.value }))}>{RETURN_CONDS.map((c) => <option key={c.v} value={c.v}>{c.ar}</option>)}</select>
            <label className={`${st.status === "done" ? btnGhost : btnRed} px-3 py-1.5 text-[11px] cursor-pointer ${st.status === "uploading" ? "opacity-50 pointer-events-none" : ""}`}>📷 {st.status === "done" ? t({ ar: "استبدال", en: "Replace" }) : t({ ar: "صورة", en: "Photo" })}<input type="file" accept="image/*" capture="environment" className="hidden" disabled={st.status === "uploading"} onChange={(e) => { const f = e.target.files?.[0]; if (f) void doUpload(it.item_id, f); e.target.value = ""; }} /></label>
            {st.status === "done" && <span className="text-[10px] text-emerald-500">✓</span>}
            {st.status === "uploading" && <span className="text-[10px] text-stone-400">⏳</span>}
            {st.status === "error" && <span className="text-[10px] text-red-400">{st.err}</span>}
          </div>
        </div>
      ); })}
      {items.length === 0 && <div className="text-[11px] text-stone-500">{t({ ar: "جارٍ تحميل المعدات…", en: "Loading items…" })}</div>}
      <div className="bg-stone-950 border border-stone-800 rounded-lg p-2 flex items-center gap-2">
        <label className={`${overallEv.status === "done" ? btnGhost : btnRed} px-3 py-1.5 text-[11px] cursor-pointer ${overallEv.status === "uploading" ? "opacity-50 pointer-events-none" : ""}`}>📷 {t({ ar: "صورة إجمالية للمرتجع (إلزامية)", en: "Overall (required)" })}<input type="file" accept="image/*" capture="environment" className="hidden" disabled={overallEv.status === "uploading"} onChange={(e) => { const f = e.target.files?.[0]; if (f) void doUpload(null, f); e.target.value = ""; }} /></label>
        {overallEv.status === "done" && <span className="text-[10px] text-emerald-500">✓</span>}
      </div>
      <textarea className={inp} rows={2} placeholder={t({ ar: "ملاحظات الإرجاع (اختياري)", en: "Return notes (optional)" })} value={note} onChange={(e) => setNote(e.target.value)} />
      <ConsentPad onChange={setSigData} />
      <label className="flex items-center gap-2 text-xs text-stone-300"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />{t({ ar: "أقر بصحة حالة المعدات المذكورة.", en: "I confirm the stated condition." })}</label>
      <button disabled={busy || anyUploading || !allItemPhotos || !overallDone || !sigData || !ack} onClick={() => void submit()} className={`${btnRed} w-full py-2 text-xs flex items-center justify-center gap-2`}>{busy && <span className="inline-block w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />}{t({ ar: "توقيع وإرسال طلب الإرجاع", en: "Sign & submit return" })}</button>
    </div>
  );
}

function RenterSign({ requestId, contractId, consent, onDone, flash, t }: { requestId: string; contractId: string; consent?: string; onDone: () => Promise<void>; flash: (m: string) => void; t: (m: { ar: string; en: string }) => string }) {
  const { isAr } = useI18n();
  const [name, setName] = useState(""); const [ack, setAck] = useState(false); const [busy, setBusy] = useState(false);
  const [terms, setTerms] = useState<string | undefined>(consent);
  const contractText = terms && terms.trim().length > 200 ? terms : isAr ? buildRentalContractAr() : buildRentalContractEn();
  const ref = useRef<HTMLCanvasElement | null>(null); const drawing = useRef(false); const dirty = useRef(false);
  useEffect(() => { if (!consent) void rentalConsentText().then((r) => { if (r.ok && r.data.consent_text) setTerms(r.data.consent_text); }); }, [consent]);
  function pos(e: React.PointerEvent<HTMLCanvasElement>) { const c = ref.current!; const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  function down(e: React.PointerEvent<HTMLCanvasElement>) { drawing.current = true; const ctx = ref.current!.getContext("2d")!; const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); }
  function move(e: React.PointerEvent<HTMLCanvasElement>) { if (!drawing.current) return; const ctx = ref.current!.getContext("2d")!; const p = pos(e); ctx.lineWidth = 2; ctx.strokeStyle = "#fff"; ctx.lineTo(p.x, p.y); ctx.stroke(); dirty.current = true; }
  function clear() { const c = ref.current; if (c) c.getContext("2d")!.clearRect(0, 0, c.width, c.height); dirty.current = false; }
  async function sign() {
    if (!name.trim() || !ack) { flash(t({ ar: "أدخل اسمك ووافق على الشروط.", en: "Enter your name and accept the terms." })); return; }
    if (!dirty.current) { flash(t({ ar: "الرجاء التوقيع في المربع.", en: "Please sign in the box." })); return; }
    setBusy(true);
    // رفع خادمي موقّع (المستأجر لا يملك كتابة مباشرة على bucket العقود).
    const up = await rentalUploadContractSignature(requestId, ref.current!.toDataURL("image/png"));
    if (!up.ok) { setBusy(false); flash(rentalUploadErrorAr(up.error)); return; }
    const r = await rentalSignContract(contractId, name.trim(), up.data.path, undefined, contractText);
    setBusy(false);
    if (r.ok) await onDone(); else flash(rentalErrorAr(r.error));
  }
  return (
    <div className={`${card} space-y-2`}>
      <div className="flex items-center justify-between gap-2 bg-stone-950 border border-stone-800 rounded-lg p-2.5">
        <span className="text-[12px] text-stone-200 font-medium">{t({ ar: "عقد التأجير", en: "Rental contract" })}</span>
        <ContractDialog terms={contractText} />
      </div>
      <div className="text-[11px] text-stone-400">{t({ ar: "اضغط الرابط أعلاه لقراءة العقد كاملًا قبل التوقيع.", en: "Open the link above to read the full contract before signing." })}</div>
      <input className={inp} placeholder={t({ ar: "اسمك الكامل", en: "Your full name" })} value={name} onChange={(e) => setName(e.target.value)} />
      <div className="flex items-center justify-between"><span className="text-[11px] text-stone-400">{t({ ar: "التوقيع", en: "Signature" })}</span><button onClick={clear} className="text-[10px] text-stone-500">{t({ ar: "مسح", en: "Clear" })}</button></div>
      <canvas ref={ref} width={400} height={110} className="w-full bg-stone-800 border border-stone-700 rounded-lg touch-none" onPointerDown={down} onPointerMove={move} onPointerUp={() => { drawing.current = false; }} onPointerLeave={() => { drawing.current = false; }} />
      <label className="flex items-center gap-2 text-xs text-stone-300"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />{t({ ar: "قرأتُ عقد التأجير وأوافق على جميع بنوده، وأُقرّ بصحة بياناتي.", en: "I have read and accept all terms of the rental contract, and confirm my data." })}</label>
      <button disabled={busy || !name.trim() || !ack} onClick={() => void sign()} className={`${btnRed} w-full py-2 text-sm flex items-center justify-center gap-2`}>{busy && <span className="inline-block w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />}{t({ ar: "توقيع العقد", en: "Sign contract" })}</button>
    </div>
  );
}
