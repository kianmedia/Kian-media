"use client";
// ════════════════════════════════════════════════════════════════════════════
// بوابة المستأجر — تأجيراته فقط (أعمدة آمنة): الحالة/الأسعار/الوديعة/المعدات/العقد.
// إجراءات: توقيع العقد، طلب الإرجاع. لا ملاحظات داخلية ولا بيانات عملاء آخرين.
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import {
  rentalCustomerList, rentalCustomerGet, rentalSignContract, rentalRequestReturn, rentalUploadSignature,
  rentalCustomerCreateRequest, rentalCustomerAvailableAssets, emitRentalEvent,
  type RentalCustomerView, type RentalRentableAsset,
} from "@/lib/portal/rental";
import { rentalStatusAr } from "@/components/portal/rental/RentalConsole";
import { riyadhInputToUtcISO, validateWindow, defaultRentalWindow, endPlus24h, formatRiyadh, rentalErrorAr } from "@/lib/portal/rentalTime";

const card = "bg-stone-900 border border-stone-800 rounded-xl p-4";
const inp = "w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-200 focus:outline-none focus:ring-2 focus:ring-red-500";
const btnRed = "rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium";
const btnGhost = "rounded-lg bg-stone-800 border border-stone-700 text-stone-200 text-sm disabled:opacity-50";
const money = (n: unknown) => (n == null ? "—" : Number(n).toLocaleString("ar"));

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
  const reload = useCallback(async () => { const r = await rentalCustomerGet(requestId); if (r.ok) setD(r.data); }, [requestId]);
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
              <span>{t({ ar: "الوديعة", en: "Deposit" })}: {money(d.deposit_amount)}</span>
              <span>{t({ ar: "حالة الوديعة", en: "Deposit status" })}: {rentalStatusAr(String(d.deposit_status ?? ""))}</span>
            </div>
            <div><div className="text-xs text-stone-400 mb-1">{t({ ar: "المعدات", en: "Equipment" })}</div>{items.map((i, k) => <div key={k} className="text-xs text-stone-300 border-t border-stone-800 py-1">{i.asset_name} × {i.quantity} <span className="text-stone-500">· {rentalStatusAr(i.status)}</span></div>)}</div>
            {status === "contract_pending_signature" && contract?.id && <RenterSign contractId={contract.id} consent={contract.consent_text} onDone={async () => { await reload(); onChanged(); flash(t({ ar: "وُقّع العقد.", en: "Signed." })); }} t={t} />}
            {(status === "active" || status === "overdue") && <button disabled={busy} onClick={async () => { const note = window.prompt(t({ ar: "ملاحظة الإرجاع (اختياري):", en: "Return note (optional):" })); setBusy(true); const r = await rentalRequestReturn(requestId, note ?? undefined); setBusy(false); if (r.ok) { emitRentalEvent("rental_return_requested", requestId); flash(t({ ar: "أُرسل طلب الإرجاع.", en: "Return requested." })); await reload(); onChanged(); } else flash(rentalErrorAr(r.error)); }} className={`${btnRed} w-full py-2 text-sm`}>{t({ ar: "طلب إرجاع", en: "Request return" })}</button>}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── إنشاء طلب تأجير ذاتي (المستأجر) — لا customer_id من المتصفح؛ الخادم يحلّه من auth.uid() ───
function RenterCreate({ onClose, onCreated, flash, t }: { onClose: () => void; onCreated: () => Promise<void>; flash: (m: string) => void; t: (m: { ar: string; en: string }) => string }) {
  const dw = useRef(defaultRentalWindow()).current;
  const [f, setF] = useState<Record<string, string>>({ rental_from: dw.from, rental_to: dw.to });
  const [q, setQ] = useState("");
  const [results, setResults] = useState<RentalRentableAsset[]>([]);
  const [searching, setSearching] = useState(false);
  const [cart, setCart] = useState<Array<{ asset_id: string; asset_name: string; quantity: number; max: number }>>([]);
  const [busy, setBusy] = useState(false);
  const [winErr, setWinErr] = useState<string | null>(null);
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
  useEffect(() => { const e = validateWindow(f.rental_from, f.rental_to); setWinErr(e ? rentalErrorAr(e) : null); setResults([]); }, [f.rental_from, f.rental_to]);
  function onFromChange(v: string) { set("rental_from", v); const fi = riyadhInputToUtcISO(v); const ti = riyadhInputToUtcISO(f.rental_to); if (fi && (!ti || new Date(ti).getTime() <= new Date(fi).getTime())) { const np = endPlus24h(v); if (np) set("rental_to", np); } }
  async function search() {
    const we = validateWindow(f.rental_from, f.rental_to); if (we) { flash(rentalErrorAr(we)); return; }
    setSearching(true);
    const r = await rentalCustomerAvailableAssets(riyadhInputToUtcISO(f.rental_from)!, riyadhInputToUtcISO(f.rental_to)!, q.trim() || undefined);
    setSearching(false);
    if (r.ok) setResults(r.data); else flash(rentalErrorAr(r.error));
  }
  function addToCart(a: RentalRentableAsset) {
    if (!a.available || a.available_quantity < 1) { flash(t({ ar: "غير متاح في الفترة المحددة.", en: "Not available." })); return; }
    setCart((c) => c.some((x) => x.asset_id === a.asset_id) ? c : [...c, { asset_id: a.asset_id, asset_name: a.asset_name, quantity: 1, max: a.available_quantity }]);
  }
  async function save(submit: boolean) {
    if (busy) return;
    const we = validateWindow(f.rental_from, f.rental_to); if (we) { flash(rentalErrorAr(we)); return; }
    if (submit && cart.length === 0) { flash(t({ ar: "أضف معدّة واحدة على الأقل.", en: "Add at least one item." })); return; }
    setBusy(true);
    const r = await rentalCustomerCreateRequest({
      rental_from: riyadhInputToUtcISO(f.rental_from), rental_to: riyadhInputToUtcISO(f.rental_to),
      delivery_location: f.delivery_location, return_location: f.return_location, customer_note: f.customer_note,
      items: cart.map((c) => ({ asset_id: c.asset_id, quantity: c.quantity })), submit,
    });
    setBusy(false);
    if (!r.ok) { flash(rentalErrorAr(r.error)); return; }
    if (submit) emitRentalEvent("rental_request_created", r.data.id);
    flash(submit ? t({ ar: `أُرسل الطلب ${r.data.request_number}.`, en: `Sent ${r.data.request_number}.` }) : t({ ar: "حُفظت المسودة.", en: "Draft saved." }));
    await onCreated();
  }
  return (
    <div className={`${card} space-y-3`}>
      <div className="flex items-center justify-between"><h3 className="text-sm font-medium text-white">{t({ ar: "طلب تأجير جديد", en: "New rental request" })}</h3><button onClick={onClose} className={`${btnGhost} px-3 py-1 text-xs`}>✕</button></div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-0.5"><label className="block text-[11px] text-stone-400 mb-1">{t({ ar: "بداية التأجير (استلام)", en: "Start" })}</label><input type="datetime-local" className={inp} value={f.rental_from ?? ""} onChange={(e) => onFromChange(e.target.value)} /></div>
        <div className="space-y-0.5"><label className="block text-[11px] text-stone-400 mb-1">{t({ ar: "نهاية التأجير (إرجاع)", en: "End" })}</label><input type="datetime-local" className={inp} value={f.rental_to ?? ""} min={f.rental_from} onChange={(e) => set("rental_to", e.target.value)} />{winErr && <span className="text-[11px] text-red-400">{winErr}</span>}</div>
        <div className="space-y-0.5"><label className="block text-[11px] text-stone-400 mb-1">{t({ ar: "موقع التسليم", en: "Delivery location" })}</label><input className={inp} value={f.delivery_location ?? ""} onChange={(e) => set("delivery_location", e.target.value)} /></div>
        <div className="space-y-0.5"><label className="block text-[11px] text-stone-400 mb-1">{t({ ar: "موقع الإرجاع", en: "Return location" })}</label><input className={inp} value={f.return_location ?? ""} onChange={(e) => set("return_location", e.target.value)} /></div>
      </div>
      <div className="text-[11px] text-stone-500">{t({ ar: "التوقيت بتوقيت الرياض. النهاية بعد البداية.", en: "Asia/Riyadh time. End after start." })}</div>
      <div className="border-t border-stone-800 pt-2 space-y-2">
        <label className="block text-[11px] text-stone-400">{t({ ar: "ابحث عن المعدّات المتاحة للفترة", en: "Search available equipment" })}</label>
        <div className="flex gap-2"><input className={`${inp} flex-1`} placeholder={t({ ar: "اسم/كود المعدّة", en: "Name/code" })} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void search(); }} /><button disabled={searching || !!winErr} onClick={() => void search()} className={`${btnGhost} px-3 py-2 text-xs`}>{searching ? "…" : t({ ar: "بحث", en: "Search" })}</button></div>
        {results.length > 0 && <div className="max-h-48 overflow-y-auto space-y-1">{results.map((a) => (
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
      <div className="flex gap-2">
        <button disabled={busy || !!winErr} onClick={() => void save(false)} className={`${btnGhost} flex-1 py-2 text-xs`}>{t({ ar: "حفظ مسودة", en: "Save draft" })}</button>
        <button disabled={busy || !!winErr || cart.length === 0} onClick={() => void save(true)} className={`${btnRed} flex-1 py-2 text-xs`}>{t({ ar: "إرسال الطلب", en: "Submit" })}</button>
      </div>
    </div>
  );
}

function RenterSign({ contractId, consent, onDone, t }: { contractId: string; consent?: string; onDone: () => Promise<void>; t: (m: { ar: string; en: string }) => string }) {
  const [name, setName] = useState(""); const [ack, setAck] = useState(false); const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLCanvasElement | null>(null); const drawing = useRef(false);
  function pos(e: React.PointerEvent<HTMLCanvasElement>) { const c = ref.current!; const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  function down(e: React.PointerEvent<HTMLCanvasElement>) { drawing.current = true; const ctx = ref.current!.getContext("2d")!; const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); }
  function move(e: React.PointerEvent<HTMLCanvasElement>) { if (!drawing.current) return; const ctx = ref.current!.getContext("2d")!; const p = pos(e); ctx.lineWidth = 2; ctx.strokeStyle = "#fff"; ctx.lineTo(p.x, p.y); ctx.stroke(); }
  async function sign() {
    if (!name.trim() || !ack) return;
    setBusy(true);
    const up = await rentalUploadSignature(contractId, "customer", ref.current!.toDataURL("image/png"));
    if (!up.ok) { setBusy(false); return; }
    const r = await rentalSignContract(contractId, name.trim(), up.data, undefined, t({ ar: "أوافق على شروط العقد.", en: "I agree." }));
    setBusy(false);
    if (r.ok) await onDone();
  }
  return (
    <div className={`${card} space-y-2`}>
      <div className="text-[11px] text-amber-400/80">{t({ ar: "قالب تشغيلي يحتاج مراجعة واعتمادًا قانونيًا قبل الاستخدام الخارجي النهائي.", en: "Operational template — legal review required." })}</div>
      {consent && <div className="text-[11px] text-stone-400 max-h-24 overflow-y-auto whitespace-pre-wrap">{consent}</div>}
      <input className={inp} placeholder={t({ ar: "اسمك", en: "Your name" })} value={name} onChange={(e) => setName(e.target.value)} />
      <canvas ref={ref} width={400} height={110} className="w-full bg-stone-800 border border-stone-700 rounded-lg touch-none" onPointerDown={down} onPointerMove={move} onPointerUp={() => { drawing.current = false; }} onPointerLeave={() => { drawing.current = false; }} />
      <label className="flex items-center gap-2 text-xs text-stone-300"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />{t({ ar: "أوافق على شروط العقد.", en: "I agree to the contract terms." })}</label>
      <button disabled={busy || !name.trim() || !ack} onClick={() => void sign()} className={`${btnRed} w-full py-2 text-sm`}>{t({ ar: "توقيع العقد", en: "Sign contract" })}</button>
    </div>
  );
}
