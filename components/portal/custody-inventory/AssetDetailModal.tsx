"use client";
// ════════════════════════════════════════════════════════════════════════════
// نافذة تفاصيل الأصل + التعديل الآمن — Modal علوي واضح (لا لوحة مطويّة أسفل الجدول).
// تبويبات: التفاصيل / تعديل / تصحيح المخزون / الصور / سجل التغييرات.
// كل الكتابة عبر RPCs محمية بالقاعدة (civ_can_admin/civ_can_finance)؛ الواجهة تنسّق فقط.
// الإنفاذ الحقيقي في القاعدة — إخفاء الأزرار تجميلي.
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  civGetAssetDetails, civGetAssetChanges, civUpdateAsset, civCorrectStock, civGetAssetTimeline, civArchiveAsset,
  civListAssetFiles, civSignFiles, civUploadAssetFile, civAttachAssetFile, civAssetFilePath,
  civArchiveAssetFile, civSetPrimaryPhoto, CIV_ASSETS_BUCKET,
  type CivAssetDetails, type CivAssetChange, type CivAssetFile, type CivCategory, type CivLocation, type CivMovement,
} from "@/lib/portal/custodyInventory";

type T = (m: { ar: string; en: string }) => string;
const card = "bg-stone-900 border border-stone-800 rounded-xl p-4";
const inp = "w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-200 placeholder:text-stone-600 focus:outline-none focus:ring-2 focus:ring-red-500";
const btnRed = "rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium";
const btnGhost = "rounded-lg bg-stone-800 border border-stone-700 text-stone-200 text-sm disabled:opacity-50";
const lbl = "text-[11px] text-stone-500 mb-1";
const CONDITIONS = ["new", "excellent", "good", "fair", "damaged"];   // تشغيلية فقط — under_maintenance/lost/retired عبر دوراتها
const OWNERSHIP = ["owned", "leased", "client_owned", "other"];

type MTab = "details" | "edit" | "stock" | "images" | "changes";
const money = (n: number | null) => (n == null ? "—" : Number(n).toLocaleString("ar"));

export default function AssetDetailModal({ assetId, cats, locs, onClose, onChanged, t }: {
  assetId: string; cats: CivCategory[]; locs: CivLocation[];
  onClose: () => void; onChanged: () => void | Promise<unknown>; t: T;
}) {
  const [load, setLoad] = useState<"loading" | "ready" | "not_prepared" | "forbidden" | "error">("loading");
  const [errMsg, setErrMsg] = useState("");
  const [det, setDet] = useState<CivAssetDetails | null>(null);
  const [tab, setTab] = useState<MTab>("details");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast(null), 3600); };

  const catName = (id: string | null) => cats.find((c) => c.id === id)?.name ?? "—";
  const locName = (id: string | null) => locs.find((l) => l.id === id)?.name ?? "—";

  const reload = useCallback(async () => {
    setLoad("loading");
    const r = await civGetAssetDetails(assetId);
    if (!r.ok) {
      setErrMsg(r.error);
      if (/not authorized|forbidden|permission/i.test(r.error)) setLoad("forbidden");
      else if (/PGRST202|does not exist|not found in the schema|schema cache|function|not_prepared/i.test(r.error)) setLoad("not_prepared");
      else setLoad("error");
      return;
    }
    setDet(r.data); setLoad("ready");
  }, [assetId]);
  useEffect(() => { void reload(); }, [reload]);

  // إغلاق بـ Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const afterChange = async () => { await reload(); await onChanged(); };

  const SQL_FILE = "docs/custody_inventory_asset_editing_PATCH.sql";
  const TABS: { k: MTab; ar: string; en: string; gated?: boolean }[] = [
    { k: "details", ar: "التفاصيل", en: "Details" },
    { k: "edit", ar: "تعديل الأصل", en: "Edit", gated: true },
    { k: "stock", ar: "تصحيح المخزون", en: "Stock", gated: true },
    { k: "images", ar: "الصور", en: "Images" },
    { k: "changes", ar: "سجل التغييرات", en: "Changes" },
  ];
  const canEdit = !!det?.can_edit;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/70 p-3 sm:p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-3xl my-4 bg-stone-950 border border-stone-800 rounded-2xl shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        {/* رأس */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-stone-800 sticky top-0 bg-stone-950 rounded-t-2xl z-10">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-white truncate">{det?.asset_name ?? t({ ar: "تفاصيل الأصل", en: "Asset details" })}</h2>
            {det && <div className="text-[11px] text-stone-500 font-mono truncate" dir="ltr">{det.asset_code}{det.serial_number ? ` · SN ${det.serial_number}` : ""}</div>}
          </div>
          <button onClick={onClose} className={`${btnGhost} px-3 py-1.5 text-xs shrink-0`}>{t({ ar: "إغلاق", en: "Close" })} ✕</button>
        </div>

        {/* حالات التحميل/الخطأ */}
        {load === "loading" && <div className="p-8 text-center text-sm text-stone-500">{t({ ar: "جارٍ تحميل التفاصيل…", en: "Loading…" })}</div>}
        {load === "forbidden" && <div className="p-6"><div className="bg-amber-950/40 border border-amber-800/60 rounded-xl p-4 text-sm text-amber-300">{t({ ar: "لا تملك صلاحية عرض تفاصيل الأصول.", en: "You are not authorized to view asset details." })}</div></div>}
        {load === "not_prepared" && <div className="p-6"><div className="bg-amber-950/40 border border-amber-800/60 rounded-xl p-4 text-sm text-amber-300 space-y-1">
          <div>{t({ ar: "وحدة تفاصيل/تعديل الأصول غير مُجهّزة في قاعدة البيانات.", en: "Asset details/editing module is not prepared in the database." })}</div>
          <div className="font-mono text-[11px] text-amber-400/90" dir="ltr">Run: {SQL_FILE}</div>
        </div></div>}
        {load === "error" && <div className="p-6"><div className="bg-red-950/40 border border-red-900/60 rounded-xl p-4 text-sm text-red-300">{t({ ar: "تعذّر تحميل التفاصيل: ", en: "Failed to load: " })}<span dir="ltr">{errMsg}</span></div></div>}

        {load === "ready" && det && (
          <div className="p-4 space-y-4">
            {/* شريط تبويبات النافذة */}
            <div className="flex gap-1.5 flex-wrap">
              {TABS.filter((x) => !(x.gated && !canEdit)).map((x) => (
                <button key={x.k} onClick={() => setTab(x.k)} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${tab === x.k ? "bg-red-600 text-white" : "bg-stone-800 text-stone-300 border border-stone-700"}`}>{t({ ar: x.ar, en: x.en })}</button>
              ))}
            </div>

            {tab === "details" && <DetailsTab det={det} catName={catName} locName={locName} t={t} />}
            {tab === "edit" && canEdit && <EditTab det={det} cats={cats} locs={locs} busy={busy} setBusy={setBusy} flash={flash} onSaved={afterChange} onClose={onClose} t={t} />}
            {tab === "stock" && canEdit && <StockTab det={det} busy={busy} setBusy={setBusy} flash={flash} onDone={afterChange} t={t} />}
            {tab === "images" && <ImagesTab assetId={assetId} canEdit={canEdit} busy={busy} setBusy={setBusy} flash={flash} onChanged={onChanged} t={t} />}
            {tab === "changes" && <ChangesTab assetId={assetId} t={t} />}
          </div>
        )}

        {toast && <div className="sticky bottom-0 mx-3 mb-3 bg-stone-800 border border-stone-700 rounded-lg px-4 py-2 text-sm text-stone-100 text-center shadow-lg">{toast}</div>}
      </div>
    </div>
  );
}

// ─── تبويب التفاصيل ───
function DetailsTab({ det, catName, locName, t }: { det: CivAssetDetails; catName: (id: string | null) => string; locName: (id: string | null) => string; t: T }) {
  const [movs, setMovs] = useState<CivMovement[] | null>(null);
  const [timesIssued, setTimesIssued] = useState<number | null>(null);
  const [photos, setPhotos] = useState<string[]>([]);
  useEffect(() => {
    void civGetAssetTimeline(det.id).then((r) => { if (r.ok) { setMovs(Array.isArray(r.data?.movements) ? r.data.movements : []); setTimesIssued(r.data?.stats?.times_issued ?? null); } else { setMovs([]); } });
    void civListAssetFiles(det.id).then(async (r) => { if (r.ok) { const m = await civSignFiles(CIV_ASSETS_BUCKET, r.data.map((x) => x.file_path)); setPhotos(Object.values(m)); } });
  }, [det.id]);
  const rows: [string, ReactNode][] = [
    [t({ ar: "الكود", en: "Code" }), <span dir="ltr" className="font-mono">{det.asset_code}</span>],
    [t({ ar: "النوع", en: "Type" }), det.asset_type === "serialized" ? t({ ar: "متسلسل", en: "Serialized" }) : t({ ar: "كمي", en: "Quantity" })],
    [t({ ar: "الرقم التسلسلي", en: "Serial" }), det.serial_number ?? "—"],
    [t({ ar: "الباركود", en: "Barcode" }), det.barcode ?? "—"],
    [t({ ar: "التصنيف", en: "Category" }), catName(det.category_id)],
    [t({ ar: "الموقع", en: "Location" }), locName(det.warehouse_location_id)],
    [t({ ar: "العلامة/الموديل", en: "Brand/Model" }), [det.brand, det.model].filter(Boolean).join(" · ") || "—"],
    [t({ ar: "الملكية", en: "Ownership" }), det.ownership_type],
    [t({ ar: "الحالة", en: "Condition" }), det.condition_status],
    [t({ ar: "الإتاحة", en: "Availability" }), det.availability_status],
    [t({ ar: "مرات الصرف", en: "Times issued" }), timesIssued ?? "…"],
    [t({ ar: "أُضيف", en: "Created" }), `${new Date(det.created_at).toLocaleDateString("ar")}${det.created_by_name ? ` — ${det.created_by_name}` : ""}`],
    [t({ ar: "آخر تعديل", en: "Updated" }), `${new Date(det.updated_at).toLocaleDateString("ar")}${det.updated_by_name ? ` — ${det.updated_by_name}` : ""}`],
  ];
  return (
    <div className="space-y-4">
      {photos.length > 0 && <div className="flex gap-2 flex-wrap">{photos.map((u, i) => <a key={i} href={u} target="_blank" rel="noreferrer"><img src={u} className="w-20 h-20 object-cover rounded border border-stone-700 bg-white/5" alt="" /></a>)}</div>}

      {/* الكميات */}
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
        {([["الإجمالي", det.quantity_total], ["المتاح", det.quantity_available], ["المصروف", det.quantity_assigned], ["الصيانة", det.quantity_in_maintenance], ["المحجوز", det.quantity_reserved]] as [string, number][]).map(([l, v]) => (
          <div key={l} className={`${card} py-2 text-center`}><div className="text-lg font-semibold text-white">{v}</div><div className="text-[10px] text-stone-500">{l}</div></div>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
        {rows.map(([k, v], i) => <div key={i} className="flex justify-between gap-2 border-b border-stone-800/60 py-1"><span className="text-[11px] text-stone-500">{k}</span><span className="text-xs text-stone-200 text-left">{v}</span></div>)}
      </div>

      {(det.description || det.notes) && <div className="space-y-1">
        {det.description && <div><div className={lbl}>{t({ ar: "الوصف", en: "Description" })}</div><div className="text-xs text-stone-300 whitespace-pre-wrap">{det.description}</div></div>}
        {det.notes && <div><div className={lbl}>{t({ ar: "ملاحظات", en: "Notes" })}</div><div className="text-xs text-stone-300 whitespace-pre-wrap">{det.notes}</div></div>}
      </div>}

      {/* المالية (لمن لديه صلاحية) */}
      {det.can_finance && <div className={`${card} grid grid-cols-2 sm:grid-cols-3 gap-2`}>
        <Fin l={t({ ar: "سعر الشراء", en: "Purchase" })} v={money(det.purchase_price)} />
        <Fin l={t({ ar: "القيمة الحالية", en: "Value" })} v={money(det.current_value)} />
        <Fin l={t({ ar: "تاريخ الشراء", en: "Bought" })} v={det.purchase_date ?? "—"} />
        <Fin l={t({ ar: "انتهاء الضمان", en: "Warranty" })} v={det.warranty_expiry_date ?? "—"} />
        <Fin l={t({ ar: "المورّد", en: "Supplier" })} v={det.supplier_name ?? "—"} />
        <Fin l={t({ ar: "رقم الفاتورة", en: "Invoice" })} v={det.invoice_number ?? "—"} />
      </div>}

      {/* العهد النشطة */}
      <Section title={t({ ar: `العهد النشطة (${det.active_assignments.length})`, en: `Active custody (${det.active_assignments.length})` })} empty={det.active_assignments.length === 0} emptyText={t({ ar: "لا عهد نشطة.", en: "None." })}>
        {det.active_assignments.map((a, i) => (
          <div key={i} className="text-[11px] text-stone-300 flex justify-between border-t border-stone-800 py-1"><span dir="ltr" className="font-mono">{a.assignment_number}</span><span>{a.employee_name ?? a.employee_user_id.slice(0, 8)} · ×{a.quantity} · {a.status}</span></div>
        ))}
      </Section>

      {/* الحجوزات */}
      {det.reservations.length > 0 && <Section title={t({ ar: `الحجوزات (${det.reservations.length})`, en: `Reservations (${det.reservations.length})` })} empty={false}>
        {det.reservations.map((r, i) => <div key={i} className="text-[11px] text-stone-400 border-t border-stone-800 py-1">×{r.quantity} · {r.reserved_from ?? "—"} → {r.reserved_to ?? "—"}{r.note ? ` · ${r.note}` : ""}</div>)}
      </Section>}

      {/* الصيانة */}
      {det.maintenance.length > 0 && <Section title={t({ ar: `الصيانة (${det.maintenance.length})`, en: `Maintenance (${det.maintenance.length})` })} empty={false}>
        {det.maintenance.map((m, i) => <div key={i} className="text-[11px] text-stone-400 border-t border-stone-800 py-1"><span dir="ltr" className="font-mono">{m.maintenance_number}</span> · {m.status}{m.issue_description ? ` · ${m.issue_description}` : ""}</div>)}
      </Section>}

      {/* سجل الحركة */}
      <Section title={t({ ar: "سجل الحركة", en: "Movement log" })} empty={!!movs && movs.length === 0} emptyText={t({ ar: "لا حركات.", en: "No movements." })}>
        <div className="max-h-56 overflow-y-auto">
          {(movs ?? []).map((m, i) => <div key={i} className="text-[11px] text-stone-500 flex justify-between border-t border-stone-800 py-1"><span>{m.movement_type}{m.reason ? ` — ${m.reason}` : ""}{m.quantity_change != null ? ` (${m.quantity_change > 0 ? "+" : ""}${m.quantity_change})` : ""}</span><span dir="ltr">{new Date(m.created_at).toLocaleString("ar")}</span></div>)}
          {movs === null && <div className="text-[11px] text-stone-600 py-1">…</div>}
        </div>
      </Section>
    </div>
  );
}
const Fin = ({ l, v }: { l: string; v: ReactNode }) => (<div><div className={lbl}>{l}</div><div className="text-xs text-stone-200">{v}</div></div>);
// حقل إدخال مستقر (مُعرَّف على مستوى الوحدة كي لا يفقد التركيز عند كل ضغطة).
function Fld({ label, value, onChange, type = "text", ta = false }: { label: string; value: string; onChange: (v: string) => void; type?: string; ta?: boolean }) {
  return (<div><div className={lbl}>{label}</div>{ta
    ? <textarea className={inp} rows={2} value={value} onChange={(e) => onChange(e.target.value)} />
    : <input type={type} className={inp} value={value} onChange={(e) => onChange(e.target.value)} />}</div>);
}
const Section = ({ title, empty, emptyText, children }: { title: string; empty: boolean; emptyText?: string; children?: ReactNode }) => (
  <div><h3 className="text-xs font-medium text-stone-400 mb-1">{title}</h3>{empty ? <p className="text-[11px] text-stone-600">{emptyText}</p> : children}</div>
);

// ─── تبويب التعديل ───
function EditTab({ det, cats, locs, busy, setBusy, flash, onSaved, onClose, t }: {
  det: CivAssetDetails; cats: CivCategory[]; locs: CivLocation[];
  busy: boolean; setBusy: (b: boolean) => void; flash: (m: string) => void; onSaved: () => Promise<void>; onClose: () => void; t: T;
}) {
  const init = {
    asset_name: det.asset_name ?? "", category_id: det.category_id ?? "", warehouse_location_id: det.warehouse_location_id ?? "",
    brand: det.brand ?? "", model: det.model ?? "", serial_number: det.serial_number ?? "", barcode: det.barcode ?? "",
    ownership_type: det.ownership_type ?? "owned", condition_status: CONDITIONS.includes(det.condition_status) ? det.condition_status : "",
    unit: det.unit ?? "", storage_location_text: det.storage_location_text ?? "", minimum_stock_level: det.minimum_stock_level != null ? String(det.minimum_stock_level) : "",
    description: det.description ?? "", notes: det.notes ?? "",
    purchase_date: det.purchase_date ?? "", warranty_expiry_date: det.warranty_expiry_date ?? "",
    purchase_price: det.purchase_price != null ? String(det.purchase_price) : "", current_value: det.current_value != null ? String(det.current_value) : "",
    supplier_name: det.supplier_name ?? "", invoice_number: det.invoice_number ?? "",
    _reason: "",
  };
  const [f, setF] = useState<Record<string, string>>(init);
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));

  const serialChanged = det.asset_type === "serialized" && f.serial_number.trim() !== (det.serial_number ?? "");
  const finChanged = det.can_finance && (
    f.purchase_date !== (det.purchase_date ?? "") || f.warranty_expiry_date !== (det.warranty_expiry_date ?? "") ||
    f.purchase_price !== (det.purchase_price != null ? String(det.purchase_price) : "") ||
    f.current_value !== (det.current_value != null ? String(det.current_value) : "") ||
    f.supplier_name !== (det.supplier_name ?? "") || f.invoice_number !== (det.invoice_number ?? ""));
  const sensitive = serialChanged || finChanged;

  async function save() {
    if (!f.asset_name.trim()) { flash(t({ ar: "اسم الأصل مطلوب.", en: "Name required." })); return; }
    if (sensitive && !f._reason.trim()) { flash(t({ ar: "سبب التعديل مطلوب للحقول الحساسة (الرقم التسلسلي/المالية).", en: "Reason required for sensitive edits." })); return; }
    if (!window.confirm(t({ ar: "حفظ تعديلات بيانات الأصل؟", en: "Save asset changes?" }))) return;
    const data: Record<string, unknown> = {
      asset_name: f.asset_name.trim(), category_id: f.category_id, warehouse_location_id: f.warehouse_location_id,
      brand: f.brand, model: f.model, serial_number: f.serial_number, barcode: f.barcode,
      ownership_type: f.ownership_type, condition_status: f.condition_status, unit: f.unit || "قطعة",
      storage_location_text: f.storage_location_text, minimum_stock_level: f.minimum_stock_level,
      description: f.description, notes: f.notes,
    };
    if (det.can_finance) Object.assign(data, {
      purchase_date: f.purchase_date, warranty_expiry_date: f.warranty_expiry_date,
      purchase_price: f.purchase_price, current_value: f.current_value,
      supplier_name: f.supplier_name, invoice_number: f.invoice_number,
    });
    if (f._reason.trim()) data._reason = f._reason.trim();
    setBusy(true);
    const r = await civUpdateAsset(det.id, data);
    setBusy(false);
    if (!r.ok) {
      const m = /serial_in_use/.test(r.error) ? t({ ar: "الرقم التسلسلي مستخدم لأصل آخر.", en: "Serial already used by another asset." })
        : /duplicate_value/.test(r.error) ? t({ ar: "الباركود/QR مكرّر.", en: "Duplicate barcode/QR." })
        : /not authorized/.test(r.error) ? t({ ar: "غير مصرّح بالتعديل.", en: "Not authorized." })
        : t({ ar: "تعذّر الحفظ: ", en: "Save failed: " }) + r.error;
      flash(m); return;
    }
    flash(t({ ar: "حُفظت التعديلات.", en: "Saved." }));
    await onSaved();
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <Fld label={t({ ar: "اسم الأصل *", en: "Name *" })} value={f.asset_name} onChange={(v) => set("asset_name", v)} />
        <div><div className={lbl}>{t({ ar: "التصنيف", en: "Category" })}</div>
          <select className={inp} value={f.category_id} onChange={(e) => set("category_id", e.target.value)}><option value="">—</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div><div className={lbl}>{t({ ar: "الموقع", en: "Location" })}</div>
          <select className={inp} value={f.warehouse_location_id} onChange={(e) => set("warehouse_location_id", e.target.value)}><option value="">—</option>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
        <div><div className={lbl}>{t({ ar: "الملكية", en: "Ownership" })}</div>
          <select className={inp} value={f.ownership_type} onChange={(e) => set("ownership_type", e.target.value)}>{OWNERSHIP.map((o) => <option key={o} value={o}>{o}</option>)}</select></div>
        <Fld label={t({ ar: "العلامة", en: "Brand" })} value={f.brand} onChange={(v) => set("brand", v)} />
        <Fld label={t({ ar: "الموديل", en: "Model" })} value={f.model} onChange={(v) => set("model", v)} />
        {det.asset_type === "serialized"
          ? <Fld label={t({ ar: "الرقم التسلسلي", en: "Serial" })} value={f.serial_number} onChange={(v) => set("serial_number", v)} />
          : <Fld label={t({ ar: "الوحدة", en: "Unit" })} value={f.unit} onChange={(v) => set("unit", v)} />}
        <Fld label={t({ ar: "الباركود", en: "Barcode" })} value={f.barcode} onChange={(v) => set("barcode", v)} />
        <div><div className={lbl}>{t({ ar: "الحالة التشغيلية", en: "Condition" })}</div>
          {CONDITIONS.includes(det.condition_status)
            ? <select className={inp} value={f.condition_status} onChange={(e) => set("condition_status", e.target.value)}>{CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}</select>
            : <div className="text-xs text-amber-400/80 bg-stone-800 border border-stone-700 rounded-lg px-3 py-2">{det.condition_status} — {t({ ar: "تُدار عبر الصيانة/الفحص", en: "managed via maintenance/inspection" })}</div>}</div>
        <Fld label={t({ ar: "حد التنبيه للمخزون", en: "Min stock" })} value={f.minimum_stock_level} onChange={(v) => set("minimum_stock_level", v)} type="number" />
        <Fld label={t({ ar: "موقع التخزين (نص)", en: "Storage text" })} value={f.storage_location_text} onChange={(v) => set("storage_location_text", v)} />
      </div>
      <Fld label={t({ ar: "الوصف", en: "Description" })} value={f.description} onChange={(v) => set("description", v)} ta />
      <Fld label={t({ ar: "ملاحظات داخلية", en: "Internal notes" })} value={f.notes} onChange={(v) => set("notes", v)} ta />

      {det.can_finance && <div className="border-t border-stone-800 pt-3 space-y-2">
        <h3 className="text-xs font-medium text-stone-400">{t({ ar: "الحقول المالية (صلاحية مالية)", en: "Financial (finance only)" })}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Fld label={t({ ar: "تاريخ الشراء", en: "Purchase date" })} value={f.purchase_date} onChange={(v) => set("purchase_date", v)} type="date" />
          <Fld label={t({ ar: "انتهاء الضمان", en: "Warranty" })} value={f.warranty_expiry_date} onChange={(v) => set("warranty_expiry_date", v)} type="date" />
          <Fld label={t({ ar: "سعر الشراء", en: "Purchase price" })} value={f.purchase_price} onChange={(v) => set("purchase_price", v)} type="number" />
          <Fld label={t({ ar: "القيمة الحالية", en: "Current value" })} value={f.current_value} onChange={(v) => set("current_value", v)} type="number" />
          <Fld label={t({ ar: "المورّد", en: "Supplier" })} value={f.supplier_name} onChange={(v) => set("supplier_name", v)} />
          <Fld label={t({ ar: "رقم الفاتورة/المرجع", en: "Invoice ref" })} value={f.invoice_number} onChange={(v) => set("invoice_number", v)} />
        </div>
      </div>}

      {sensitive && <div><div className={lbl}>{t({ ar: "سبب التعديل (مطلوب للحقول الحساسة)", en: "Reason (required)" })}</div>
        <input className={inp} value={f._reason} onChange={(e) => set("_reason", e.target.value)} placeholder={t({ ar: "سبب تغيير الرقم التسلسلي/المالية…", en: "Reason…" })} /></div>}

      <div className="flex gap-2">
        <button disabled={busy} onClick={() => void save()} className={`${btnRed} px-5 py-2`}>{busy ? t({ ar: "جارٍ الحفظ…", en: "Saving…" }) : t({ ar: "حفظ", en: "Save" })}</button>
        <button disabled={busy} onClick={() => setF(init)} className={`${btnGhost} px-4 py-2`}>{t({ ar: "استرجاع", en: "Reset" })}</button>
      </div>

      {/* منطقة الخطر: أرشفة (soft delete) — تُمنع تلقائيًا إن كان على عهدة نشطة، ولا تحذف السجل. */}
      <div className="border-t border-red-900/50 pt-3 mt-2">
        <div className="text-[11px] text-stone-500 mb-1">{t({ ar: "أرشفة الأصل (لا تُحذف بياناته ولا سجل حركته؛ تُمنع إن كان على عهدة نشطة).", en: "Archive (soft delete; blocked if on active custody; history kept)." })}</div>
        <button disabled={busy} onClick={async () => {
          const reason = window.prompt(t({ ar: "سبب الأرشفة:", en: "Archive reason:" }));
          if (!reason || !reason.trim()) return;
          setBusy(true); const r = await civArchiveAsset(det.id, reason.trim()); setBusy(false);
          if (!r.ok) { flash(/asset_on_active_custody/.test(r.error) ? t({ ar: "لا يمكن الأرشفة — الأصل على عهدة نشطة.", en: "Blocked — asset on active custody." }) : (/not authorized/.test(r.error) ? t({ ar: "غير مصرّح.", en: "Not authorized." }) : t({ ar: "تعذّر: ", en: "Failed: " }) + r.error)); return; }
          flash(t({ ar: "أُرشف الأصل.", en: "Archived." })); await onSaved(); onClose();
        }} className={`${btnGhost} px-4 py-1.5 text-xs border-red-900 text-red-400`}>{t({ ar: "أرشفة الأصل", en: "Archive asset" })}</button>
      </div>
    </div>
  );
}

// ─── تبويب تصحيح المخزون ───
function StockTab({ det, busy, setBusy, flash, onDone, t }: {
  det: CivAssetDetails; busy: boolean; setBusy: (b: boolean) => void; flash: (m: string) => void; onDone: () => Promise<void>; t: T;
}) {
  const [mode, setMode] = useState<"delta" | "set_total">("delta");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");

  if (det.asset_type === "serialized") return (
    <div className="bg-stone-900 border border-stone-800 rounded-xl p-4 text-sm text-stone-400">
      {t({ ar: "الأصل المتسلسل كميته دائمًا 1 — لا يمكن تصحيح كميته. استخدم دورة الصيانة/الفحص لتغيّر حالته.", en: "Serialized assets are always qty 1 — use maintenance/inspection flows." })}
    </div>
  );

  const preview = () => {
    const v = Number(value);
    if (!value || Number.isNaN(v)) return null;
    if (mode === "delta") return { total: det.quantity_total + v, avail: det.quantity_available + v };
    const committed = det.quantity_total - det.quantity_available;
    return { total: v, avail: v - committed };
  };
  const p = preview();
  const invalid = p && (p.total < 0 || p.avail < 0 || p.avail > p.total || p.avail < det.quantity_reserved);

  async function apply() {
    const v = Number(value);
    if (!value || Number.isNaN(v)) { flash(t({ ar: "أدخل قيمة صحيحة.", en: "Enter a valid value." })); return; }
    if (!reason.trim()) { flash(t({ ar: "سبب التصحيح مطلوب.", en: "Reason required." })); return; }
    if (invalid) { flash(t({ ar: "القيمة ستؤدي إلى كمية غير صالحة أو تحت المصروف.", en: "Invalid or below committed." })); return; }
    if (!window.confirm(t({ ar: `تأكيد تصحيح المخزون؟ الإجمالي ${det.quantity_total}→${p?.total}، المتاح ${det.quantity_available}→${p?.avail}.`, en: "Confirm stock correction?" }))) return;
    setBusy(true);
    const r = await civCorrectStock(det.id, mode, v, reason.trim());
    setBusy(false);
    if (!r.ok) {
      const m = /reserved_shortage/.test(r.error) ? t({ ar: "لا يمكن النزول بالمتاح تحت الكمية المحجوزة — ألغِ الحجز أولًا.", en: "Cannot drop available below reserved — cancel the reservation first." })
        : /below_committed/.test(r.error) ? t({ ar: "لا يمكن النزول تحت المصروف.", en: "Cannot drop below committed." })
        : /serialized/.test(r.error) ? t({ ar: "الأصل المتسلسل غير قابل لتصحيح الكمية.", en: "Serialized not adjustable." })
        : /not authorized/.test(r.error) ? t({ ar: "غير مصرّح.", en: "Not authorized." })
        : t({ ar: "تعذّر: ", en: "Failed: " }) + r.error;
      flash(m); return;
    }
    setValue(""); setReason("");
    flash(t({ ar: "عُدّل المخزون بأمان.", en: "Stock corrected." }));
    await onDone();
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
        {([["الإجمالي", det.quantity_total], ["المتاح", det.quantity_available], ["المصروف", det.quantity_assigned], ["الصيانة", det.quantity_in_maintenance], ["المحجوز", det.quantity_reserved]] as [string, number][]).map(([l, v]) => (
          <div key={l} className={`${card} py-2 text-center`}><div className="text-lg font-semibold text-white">{v}</div><div className="text-[10px] text-stone-500">{l}</div></div>
        ))}
      </div>
      <p className="text-[11px] text-stone-500">{t({ ar: "التصحيح لا يمسّ الوحدات المصروفة/المحجوزة/في الصيانة — يعدّل المخزون المتاح فقط بأمان.", en: "Correction never touches committed units — only free stock, safely." })}</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div><div className={lbl}>{t({ ar: "الوضع", en: "Mode" })}</div>
          <select className={inp} value={mode} onChange={(e) => setMode(e.target.value as "delta" | "set_total")}>
            <option value="delta">{t({ ar: "زيادة/نقص (±)", en: "Delta (±)" })}</option>
            <option value="set_total">{t({ ar: "تعيين إجمالي جديد", en: "Set new total" })}</option>
          </select></div>
        <div><div className={lbl}>{mode === "delta" ? t({ ar: "المقدار (± عدد)", en: "Amount (±)" }) : t({ ar: "الإجمالي الجديد", en: "New total" })}</div>
          <input type="number" className={inp} value={value} onChange={(e) => setValue(e.target.value)} placeholder={mode === "delta" ? "+5 / -3" : "10"} /></div>
        <div><div className={lbl}>{t({ ar: "سبب التصحيح *", en: "Reason *" })}</div>
          <input className={inp} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t({ ar: "جرد/تلف/خطأ إدخال…", en: "Audit/damage/typo…" })} /></div>
      </div>
      {p && <div className={`text-xs ${invalid ? "text-red-400" : "text-emerald-400"}`}>
        {t({ ar: "بعد التصحيح: ", en: "After: " })}<span dir="ltr">total {p.total} · available {p.avail}</span>{invalid ? t({ ar: " — قيمة غير صالحة", en: " — invalid" }) : ""}
      </div>}
      <button disabled={busy || !!invalid} onClick={() => void apply()} className={`${btnRed} px-5 py-2`}>{busy ? t({ ar: "جارٍ…", en: "…" }) : t({ ar: "تطبيق التصحيح", en: "Apply correction" })}</button>
    </div>
  );
}

// ─── تبويب الصور ───
function ImagesTab({ assetId, canEdit, busy, setBusy, flash, onChanged, t }: {
  assetId: string; canEdit: boolean; busy: boolean; setBusy: (b: boolean) => void; flash: (m: string) => void; onChanged: () => void | Promise<unknown>; t: T;
}) {
  const [files, setFiles] = useState<CivAssetFile[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    setLoading(true);
    const r = await civListAssetFiles(assetId);
    if (r.ok) { setFiles(r.data); const m = await civSignFiles(CIV_ASSETS_BUCKET, r.data.map((x) => x.file_path)); setUrls(m); }
    setLoading(false);
  }, [assetId]);
  useEffect(() => { void reload(); }, [reload]);

  async function add(file: File) {
    setBusy(true);
    const path = civAssetFilePath(assetId, "asset_photo", file.name);
    const up = await civUploadAssetFile(path, file);
    if (up.ok) { const at = await civAttachAssetFile(assetId, "asset_photo", path, file.name, file.type, file.size); setBusy(false); if (!at.ok) { flash(t({ ar: "تعذّر ربط الصورة: ", en: "Attach failed: " }) + at.error); return; } }
    else { setBusy(false); flash(t({ ar: "تعذّر رفع الصورة: ", en: "Upload failed: " }) + up.error); return; }
    flash(t({ ar: "أُضيفت الصورة.", en: "Image added." })); await reload(); await onChanged();
  }
  async function archive(id: string) {
    if (!window.confirm(t({ ar: "أرشفة هذه الصورة؟ (لا تُحذف نهائيًا)", en: "Archive this image?" }))) return;
    setBusy(true); const r = await civArchiveAssetFile(id, "archived from asset details"); setBusy(false);
    if (!r.ok) { flash(t({ ar: "تعذّر: ", en: "Failed: " }) + r.error); return; }
    flash(t({ ar: "أُرشفت الصورة.", en: "Archived." })); await reload(); await onChanged();
  }
  async function primary(id: string) {
    setBusy(true); const r = await civSetPrimaryPhoto(id); setBusy(false);
    if (!r.ok) { flash(t({ ar: "تعذّر: ", en: "Failed: " }) + r.error); return; }
    flash(t({ ar: "عُيّنت كصورة أساسية.", en: "Set as primary." })); await reload(); await onChanged();
  }

  return (
    <div className="space-y-3">
      {canEdit && <label className={`${btnGhost} px-3 py-2 text-xs cursor-pointer inline-block`}>📷 {t({ ar: "إضافة صورة", en: "Add image" })}
        <input type="file" accept="image/*" className="hidden" disabled={busy} onChange={(e) => { const file = e.target.files?.[0]; if (file) void add(file); e.target.value = ""; }} /></label>}
      {loading ? <p className="text-xs text-stone-500">{t({ ar: "جارٍ التحميل…", en: "Loading…" })}</p>
        : files.length === 0 ? <p className="text-xs text-stone-500">{t({ ar: "لا صور بعد.", en: "No images." })}</p>
        : <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {files.map((f) => (
            <div key={f.id} className={`${card} p-2 space-y-2 ${f.is_primary ? "ring-2 ring-red-600" : ""}`}>
              {urls[f.file_path]
                ? <a href={urls[f.file_path]} target="_blank" rel="noreferrer"><img src={urls[f.file_path]} className="w-full h-28 object-cover rounded bg-white/5" alt={f.file_name ?? ""} /></a>
                : <div className="w-full h-28 rounded bg-stone-800 flex items-center justify-center text-[10px] text-stone-600">{f.file_type}</div>}
              <div className="text-[10px] text-stone-500 truncate" dir="ltr">{f.file_name ?? f.file_type}{f.is_primary ? " ★" : ""}</div>
              {canEdit && <div className="flex gap-1">
                {!f.is_primary && <button disabled={busy} onClick={() => void primary(f.id)} className={`${btnGhost} px-2 py-1 text-[10px] flex-1`}>{t({ ar: "أساسية", en: "Primary" })}</button>}
                <button disabled={busy} onClick={() => void archive(f.id)} className={`${btnGhost} px-2 py-1 text-[10px] text-red-400`}>{t({ ar: "أرشفة", en: "Archive" })}</button>
              </div>}
            </div>
          ))}
        </div>}
    </div>
  );
}

// ─── تبويب سجل التغييرات ───
function ChangesTab({ assetId, t }: { assetId: string; t: T }) {
  const [rows, setRows] = useState<CivAssetChange[] | null>(null);
  useEffect(() => { void civGetAssetChanges(assetId).then((r) => setRows(r.ok ? r.data : [])); }, [assetId]);
  const label = (a: string) => ({ update: "تعديل بيانات", stock_correction: "تصحيح مخزون", image_added: "إضافة صورة", image_archived: "أرشفة صورة", primary_image_changed: "تغيير الصورة الأساسية" } as Record<string, string>)[a] ?? a;
  if (rows === null) return <p className="text-xs text-stone-500">{t({ ar: "جارٍ التحميل…", en: "Loading…" })}</p>;
  if (rows.length === 0) return <p className="text-xs text-stone-500">{t({ ar: "لا تغييرات مسجّلة.", en: "No changes logged." })}</p>;
  return (
    <div className="space-y-2 max-h-[28rem] overflow-y-auto">
      {rows.map((c) => (
        <div key={c.id} className={`${card} p-3 space-y-1`}>
          <div className="flex justify-between items-center">
            <span className="text-xs font-medium text-stone-200">{label(c.action)}</span>
            <span className="text-[10px] text-stone-500" dir="ltr">{new Date(c.created_at).toLocaleString("ar")}</span>
          </div>
          <div className="text-[11px] text-stone-500">{c.actor_name ?? c.actor_id?.slice(0, 8) ?? "—"}{c.reason ? ` · ${c.reason}` : ""}</div>
          {Array.isArray(c.changes) && c.changes.length > 0 && <div className="space-y-0.5">
            {c.changes.map((ch, i) => <div key={i} className="text-[11px] text-stone-400" dir="auto"><span className="text-stone-500">{ch.field}:</span> <span className="line-through text-stone-600">{fmt(ch.old)}</span> → <span className="text-stone-200">{fmt(ch.new)}</span></div>)}
          </div>}
        </div>
      ))}
    </div>
  );
}
const fmt = (v: unknown) => (v == null || v === "" ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));
