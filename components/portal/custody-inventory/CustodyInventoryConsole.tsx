"use client";
// مخزون الأصول والعهد — لوحة الإدارة/أمين العهدة. تبويبات: لوحة، أصول، تصنيفات،
// مواقع، صرف، عهد وإرجاع، صيانة، جرد، تقارير، إعدادات. كل الكتابة عبر RPCs محمية.
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { pget } from "@/lib/portal/client";
import CustodyEnterpriseSettings from "@/components/portal/custody-inventory/CustodyEnterpriseSettings";
import CustodyQrLabels from "@/components/portal/custody-inventory/CustodyQrLabels";
import {
  civGetDashboard, civListAssets, civListCategories, civListLocations, civCreateAsset,
  civArchiveAsset, civAdjustStock, civTransferAsset, civUploadAssetFile, civAttachAssetFile, civAssetFilePath,
  civListAssetFiles, civSignFiles, civGetAssetTimeline, civUpsertCategory, civArchiveCategory, civUpsertLocation,
  civArchiveLocation, civCreateAssignment, civListAssignments, civListAssignmentItems, civListEvidence,
  civEvidencePath, civUploadEvidence, civAttachEvidence, civInspectReturn, civOpenMaintenance, civCloseMaintenance,
  civListMaintenance, civStartAudit, civListAudits, civListAuditItems, civCountAuditItem, civApproveAudit,
  civGetReport, civGetSettings, civUpdateSettings, civEmitEvent, DEFAULT_CIV_SETTINGS,
  CIV_ASSETS_BUCKET, CIV_EVIDENCE_BUCKET,
  type CivAsset, type CivCategory, type CivLocation, type CivDashboard, type CivAssignment,
  type CivAssignmentItem, type CivIssueItem, type CivInspectItem, type CivSettings, type CivInspectResult,
} from "@/lib/portal/custodyInventory";

const card = "bg-stone-900 border border-stone-800 rounded-xl p-4";
const inp = "w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-200 placeholder:text-stone-600 focus:outline-none focus:ring-2 focus:ring-red-500";
const btnRed = "rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium";
const btnGhost = "rounded-lg bg-stone-800 border border-stone-700 text-stone-200 text-sm disabled:opacity-50";
const th = "text-right text-[11px] text-stone-500 font-medium px-2 py-1.5";
const td = "text-right text-xs text-stone-300 px-2 py-1.5 border-t border-stone-800";

type Tab = "dashboard" | "assets" | "qr" | "categories" | "locations" | "issue" | "custody" | "maintenance" | "audits" | "reports" | "settings" | "enterprise";
const TABS: { k: Tab; ar: string }[] = [
  { k: "dashboard", ar: "لوحة" }, { k: "assets", ar: "الأصول" }, { k: "qr", ar: "QR والملصقات" }, { k: "categories", ar: "التصنيفات" },
  { k: "locations", ar: "المواقع" }, { k: "issue", ar: "صرف عهدة" }, { k: "custody", ar: "العهد والإرجاع" },
  { k: "maintenance", ar: "الصيانة" }, { k: "audits", ar: "الجرد" }, { k: "reports", ar: "التقارير" },
  { k: "enterprise", ar: "مزايا المنصّة" }, { k: "settings", ar: "الإعدادات" },
];
interface Staff { id: string; full_name: string | null; email: string; staff_role: string | null }

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const keys = Object.keys(rows[0]);
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [keys.join(","), ...rows.map((r) => keys.map((k) => esc(r[k])).join(","))].join("\n");
}
function downloadCsv(name: string, rows: Record<string, unknown>[]) {
  const blob = new Blob(["﻿" + toCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob); const a = document.createElement("a");
  a.href = url; a.download = `${name}.csv`; a.click(); URL.revokeObjectURL(url);
}

export default function CustodyInventoryConsole() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("dashboard");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast(null), 3800); };
  const err = (r: { error: string }, fallback: string) => flash(fallback + r.error);

  const [dash, setDash] = useState<CivDashboard | null>(null);
  const [assets, setAssets] = useState<CivAsset[]>([]);
  const [cats, setCats] = useState<CivCategory[]>([]);
  const [locs, setLocs] = useState<CivLocation[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [assignments, setAssignments] = useState<CivAssignment[]>([]);
  const [settings, setSettings] = useState<CivSettings>(DEFAULT_CIV_SETTINGS);
  const [q, setQ] = useState("");

  const loadRefs = useCallback(async () => {
    const [c, l] = await Promise.all([civListCategories(), civListLocations()]);
    if (c.ok) setCats(c.data); if (l.ok) setLocs(l.data);
  }, []);
  const loadStaff = useCallback(async () => {
    const r = await pget<Staff[]>(`profiles?account_status=eq.active&or=(account_type.eq.admin,staff_role.not.is.null)&select=id,full_name,email,staff_role&order=full_name.asc`);
    if (r.ok) setStaff(r.data);
  }, []);

  useEffect(() => {
    void loadRefs();
    if (tab === "dashboard") void civGetDashboard().then((r) => { if (r.ok) setDash(r.data); });
    if (tab === "assets") void civListAssets(q ? { q } : undefined).then((r) => { if (r.ok) setAssets(r.data); });
    if (tab === "issue") { void loadStaff(); void civListAssets().then((r) => { if (r.ok) setAssets(r.data); }); }
    if (tab === "custody") void civListAssignments().then((r) => { if (r.ok) setAssignments(r.data); });
    if (tab === "settings") void civGetSettings().then((r) => setSettings(r.ok ? { ...DEFAULT_CIV_SETTINGS, ...r.data } : DEFAULT_CIV_SETTINGS));
  }, [tab, q, loadRefs, loadStaff]);

  const catName = (id: string | null) => cats.find((c) => c.id === id)?.name ?? "—";
  const locName = (id: string | null) => locs.find((l) => l.id === id)?.name ?? "—";
  const empName = (uid: string) => staff.find((s) => s.id === uid)?.full_name ?? uid.slice(0, 8);

  return (
    <div className="space-y-4">
      {/* شريط التبويبات */}
      <div className="flex gap-1.5 flex-wrap">
        {TABS.map((x) => (
          <button key={x.k} onClick={() => setTab(x.k)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium ${tab === x.k ? "bg-red-600 text-white" : "bg-stone-800 text-stone-300 border border-stone-700"}`}>
            {x.ar}
          </button>
        ))}
      </div>

      {tab === "dashboard" && <DashboardTab dash={dash} onGo={(k) => setTab(k)} t={t} />}
      {tab === "assets" && <AssetsTab {...{ assets, cats, locs, q, setQ, busy, setBusy, flash, err, t, reload: () => civListAssets(q ? { q } : undefined).then((r) => { if (r.ok) setAssets(r.data); }), catName, locName }} />}
      {tab === "categories" && <CategoriesTab {...{ cats, busy, setBusy, flash, err, t, reload: loadRefs }} />}
      {tab === "locations" && <LocationsTab {...{ locs, busy, setBusy, flash, err, t, reload: loadRefs }} />}
      {tab === "issue" && <IssueTab {...{ assets, staff, busy, setBusy, flash, err, t, onDone: () => setTab("custody") }} />}
      {tab === "custody" && <CustodyTab {...{ assignments, busy, setBusy, flash, err, t, empName, locs, reload: () => civListAssignments().then((r) => { if (r.ok) setAssignments(r.data); }) }} />}
      {tab === "maintenance" && <MaintenanceTab {...{ assets, busy, setBusy, flash, err, t }} />}
      {tab === "audits" && <AuditsTab {...{ locs, busy, setBusy, flash, err, t }} />}
      {tab === "reports" && <ReportsTab {...{ busy, setBusy, flash, err, t }} />}
      {tab === "qr" && <CustodyQrLabels />}
      {tab === "enterprise" && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-white">{t({ ar: "مزايا المنصّة المؤسسية — Enterprise Features", en: "Enterprise Features" })}</h3>
          <CustodyEnterpriseSettings />
        </div>
      )}
      {tab === "settings" && <SettingsTab {...{ settings, setSettings, busy, setBusy, flash, err, t }} />}

      {toast && <div className="fixed bottom-4 inset-x-4 z-50 mx-auto max-w-md bg-stone-800 border border-stone-700 rounded-lg px-4 py-2 text-sm text-stone-100 text-center shadow-lg">{toast}</div>}
    </div>
  );
}

// ─── لوحة المؤشرات ───
function DashboardTab({ dash, onGo, t }: { dash: CivDashboard | null; onGo: (k: Tab) => void; t: (m: { ar: string; en: string }) => string }) {
  const cards: { label: string; value: number | string; go?: Tab }[] = dash ? [
    { label: "إجمالي الأصول", value: dash.total_assets, go: "assets" },
    { label: "قيمة الأصول", value: Math.round(dash.total_value).toLocaleString("ar") },
    { label: "متاح", value: dash.available, go: "assets" },
    { label: "على عهد الموظفين", value: dash.assigned, go: "custody" },
    { label: "محجوز", value: dash.reserved },
    { label: "في الصيانة", value: dash.maintenance, go: "maintenance" },
    { label: "تالف", value: dash.damaged },
    { label: "مفقود", value: dash.lost },
    { label: "عهد نشطة", value: dash.active_assignments, go: "custody" },
    { label: "عهد متأخرة", value: dash.overdue, go: "custody" },
    { label: "إرجاع بانتظار الفحص", value: dash.pending_returns, go: "custody" },
    { label: "بانتظار تأكيد الموظف", value: dash.pending_confirm, go: "custody" },
    { label: "ضمانات تنتهي قريبًا", value: dash.warranty_soon },
    { label: "فروقات جرد مفتوحة", value: dash.audit_variances, go: "audits" },
  ] : [];
  if (!dash) return <div className={card}><p className="text-xs text-stone-500">{t({ ar: "جارٍ التحميل…", en: "Loading…" })}</p></div>;
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {cards.map((c) => (
        <button key={c.label} onClick={() => c.go && onGo(c.go)} className={`${card} text-right ${c.go ? "hover:border-red-700" : ""}`}>
          <div className="text-2xl font-semibold text-white">{c.value}</div>
          <div className="text-[11px] text-stone-400 mt-1">{c.label}</div>
        </button>
      ))}
    </div>
  );
}

// ─── الأصول ───
type Common = { busy: boolean; setBusy: (b: boolean) => void; flash: (m: string) => void; err: (r: { error: string }, f: string) => void; t: (m: { ar: string; en: string }) => string };
function AssetsTab({ assets, cats, locs, q, setQ, busy, setBusy, flash, err, t, reload, catName, locName }: Common & {
  assets: CivAsset[]; cats: CivCategory[]; locs: CivLocation[]; q: string; setQ: (v: string) => void;
  reload: () => Promise<unknown>; catName: (id: string | null) => string; locName: (id: string | null) => string;
}) {
  const [show, setShow] = useState(false);
  const [f, setF] = useState<Record<string, string>>({ asset_type: "serialized", ownership_type: "owned", condition_status: "good", quantity_total: "1" });
  const [pendingPhoto, setPendingPhoto] = useState<File | null>(null);
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
  const [detail, setDetail] = useState<string | null>(null);

  async function create() {
    if (!f.asset_name?.trim()) { flash(t({ ar: "اسم الأصل مطلوب.", en: "Name required." })); return; }
    setBusy(true);
    const r = await civCreateAsset({
      asset_name: f.asset_name.trim(), asset_code: f.asset_code || undefined, barcode: f.barcode || undefined,
      category_id: f.category_id || null, brand: f.brand, model: f.model, serial_number: f.serial_number,
      ownership_type: f.ownership_type, asset_type: f.asset_type as CivAsset["asset_type"],
      quantity_total: Number(f.quantity_total) || 1, unit: f.unit || undefined,
      purchase_price: f.purchase_price ? Number(f.purchase_price) : undefined,
      current_value: f.current_value ? Number(f.current_value) : undefined,
      purchase_date: f.purchase_date || undefined, warranty_expiry_date: f.warranty_expiry_date || undefined,
      supplier_name: f.supplier_name, invoice_number: f.invoice_number,
      warehouse_location_id: f.warehouse_location_id || null, condition_status: f.condition_status as CivAsset["condition_status"], notes: f.notes,
    });
    if (!r.ok) { setBusy(false); return err(r, t({ ar: "تعذّر إنشاء الأصل: ", en: "Failed: " })); }
    if (pendingPhoto) {
      const path = civAssetFilePath(r.data.id, "asset_photo", pendingPhoto.name);
      const up = await civUploadAssetFile(path, pendingPhoto);
      if (up.ok) await civAttachAssetFile(r.data.id, "asset_photo", path, pendingPhoto.name, pendingPhoto.type, pendingPhoto.size);
    } else { flash(t({ ar: "تنبيه: يُفضّل إضافة صورة للأصل.", en: "Tip: add an asset photo." })); }
    void civEmitEvent("civ_asset_created", { title: "أصل جديد: " + f.asset_name.trim() });
    setBusy(false); setShow(false); setF({ asset_type: "serialized", ownership_type: "owned", condition_status: "good", quantity_total: "1" }); setPendingPhoto(null);
    await reload(); flash(t({ ar: `أُضيف الأصل (${r.data.asset_code}).`, en: "Asset added." }));
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t({ ar: "بحث بالاسم/الكود/الباركود/التسلسلي", en: "Search" })} className={inp} />
        <button onClick={() => setShow(!show)} className={`${btnRed} px-4 py-2 whitespace-nowrap`}>{show ? t({ ar: "إغلاق", en: "Close" }) : t({ ar: "+ أصل", en: "+ Asset" })}</button>
      </div>
      {show && (
        <div className={`${card} grid grid-cols-2 md:grid-cols-3 gap-2`}>
          <input placeholder="اسم الأصل *" className={inp} value={f.asset_name ?? ""} onChange={(e) => set("asset_name", e.target.value)} />
          <input placeholder="الكود (تلقائي إن فُرّغ)" className={inp} value={f.asset_code ?? ""} onChange={(e) => set("asset_code", e.target.value)} />
          <input placeholder="باركود" className={inp} value={f.barcode ?? ""} onChange={(e) => set("barcode", e.target.value)} />
          <select className={inp} value={f.category_id ?? ""} onChange={(e) => set("category_id", e.target.value)}><option value="">التصنيف</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <input placeholder="العلامة" className={inp} value={f.brand ?? ""} onChange={(e) => set("brand", e.target.value)} />
          <input placeholder="الموديل" className={inp} value={f.model ?? ""} onChange={(e) => set("model", e.target.value)} />
          <select className={inp} value={f.asset_type} onChange={(e) => set("asset_type", e.target.value)}><option value="serialized">متسلسل (قطعة برقم)</option><option value="quantity_based">كمي</option></select>
          {f.asset_type === "serialized" ? <input placeholder="الرقم التسلسلي" className={inp} value={f.serial_number ?? ""} onChange={(e) => set("serial_number", e.target.value)} />
            : <input placeholder="الكمية الإجمالية" className={inp} value={f.quantity_total} onChange={(e) => set("quantity_total", e.target.value)} />}
          <select className={inp} value={f.ownership_type} onChange={(e) => set("ownership_type", e.target.value)}><option value="owned">مملوك</option><option value="leased">مستأجر</option><option value="client_owned">ملك عميل</option><option value="other">أخرى</option></select>
          <select className={inp} value={f.warehouse_location_id ?? ""} onChange={(e) => set("warehouse_location_id", e.target.value)}><option value="">الموقع</option>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
          <select className={inp} value={f.condition_status} onChange={(e) => set("condition_status", e.target.value)}>{["new", "excellent", "good", "fair", "damaged"].map((c) => <option key={c} value={c}>{c}</option>)}</select>
          <input placeholder="سعر الشراء" className={inp} value={f.purchase_price ?? ""} onChange={(e) => set("purchase_price", e.target.value)} />
          <input placeholder="القيمة الحالية" className={inp} value={f.current_value ?? ""} onChange={(e) => set("current_value", e.target.value)} />
          <input type="date" title="تاريخ الشراء" className={inp} value={f.purchase_date ?? ""} onChange={(e) => set("purchase_date", e.target.value)} />
          <input type="date" title="انتهاء الضمان" className={inp} value={f.warranty_expiry_date ?? ""} onChange={(e) => set("warranty_expiry_date", e.target.value)} />
          <input placeholder="ملاحظات" className={`${inp} col-span-2`} value={f.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
          <label className={`${btnGhost} px-3 py-2 text-xs cursor-pointer text-center`}>📷 {pendingPhoto ? pendingPhoto.name.slice(0, 16) : "صورة الأصل"}
            <input type="file" accept="image/*" className="hidden" onChange={(e) => setPendingPhoto(e.target.files?.[0] ?? null)} /></label>
          <button disabled={busy} onClick={() => void create()} className={`${btnRed} py-2 col-span-2 md:col-span-3`}>{t({ ar: "حفظ الأصل", en: "Save asset" })}</button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px]">
          <thead><tr><th className={th}>الكود</th><th className={th}>الاسم</th><th className={th}>التصنيف</th><th className={th}>النوع</th><th className={th}>متاح/إجمالي</th><th className={th}>الحالة</th><th className={th}>الموقع</th><th className={th}></th></tr></thead>
          <tbody>{assets.map((a) => (
            <tr key={a.id}>
              <td className={`${td} font-mono`} dir="ltr">{a.asset_code}</td><td className={td}>{a.asset_name}</td>
              <td className={td}>{catName(a.category_id)}</td><td className={td}>{a.asset_type === "serialized" ? "متسلسل" : "كمي"}</td>
              <td className={td}>{a.quantity_available}/{a.quantity_total}</td>
              <td className={td}><span className="text-[10px]">{a.availability_status}</span></td><td className={td}>{locName(a.warehouse_location_id)}</td>
              <td className={td}><button onClick={() => setDetail(detail === a.id ? null : a.id)} className={`${btnGhost} px-2 py-1 text-[11px]`}>تفاصيل</button></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {detail && <AssetDetail assetId={detail} asset={assets.find((a) => a.id === detail)!} locs={locs} onClose={() => setDetail(null)} onChanged={reload} {...{ busy, setBusy, flash, err, t }} />}
    </div>
  );
}

function AssetDetail({ assetId, asset, locs, onClose, onChanged, busy, setBusy, flash, err, t }: Common & {
  assetId: string; asset: CivAsset; locs: CivLocation[]; onClose: () => void; onChanged: () => Promise<unknown>;
}) {
  const [tl, setTl] = useState<{ movements: { created_at: string; movement_type: string; reason: string | null }[]; stats: { times_issued: number } } | null>(null);
  const [photos, setPhotos] = useState<string[]>([]);
  const [adj, setAdj] = useState({ total: String(asset.quantity_total), avail: String(asset.quantity_available), reason: "" });
  const [reason, setReason] = useState("");
  useEffect(() => {
    void civGetAssetTimeline(assetId).then((r) => { if (r.ok) setTl(r.data); });
    void civListAssetFiles(assetId).then(async (r) => { if (r.ok) { const m = await civSignFiles(CIV_ASSETS_BUCKET, r.data.map((x) => x.file_path)); setPhotos(Object.values(m)); } });
  }, [assetId]);
  return (
    <div className={`${card} space-y-3`}>
      <div className="flex justify-between items-center"><h3 className="text-sm font-medium text-white">{asset.asset_name} <span className="font-mono text-xs text-stone-500" dir="ltr">{asset.asset_code}</span></h3>
        <button onClick={onClose} className={`${btnGhost} px-2 py-1 text-xs`}>إغلاق</button></div>
      {photos.length > 0 && <div className="flex gap-2 flex-wrap">{photos.map((u, i) => <a key={i} href={u} target="_blank" rel="noreferrer"><img src={u} className="w-16 h-16 object-cover rounded border border-stone-700" alt="" /></a>)}</div>}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs text-stone-400">
        <span>الحالة: {asset.condition_status}</span><span>الإتاحة: {asset.availability_status}</span><span>مرات الصرف: {tl?.stats.times_issued ?? "…"}</span>
        {asset.warranty_expiry_date && <span>الضمان: {asset.warranty_expiry_date}</span>}
      </div>
      {/* تعديل مخزون */}
      <div className="grid grid-cols-3 gap-2">
        <input className={inp} value={adj.total} onChange={(e) => setAdj({ ...adj, total: e.target.value })} placeholder="الإجمالي" />
        <input className={inp} value={adj.avail} onChange={(e) => setAdj({ ...adj, avail: e.target.value })} placeholder="المتاح" />
        <input className={inp} value={adj.reason} onChange={(e) => setAdj({ ...adj, reason: e.target.value })} placeholder="سبب التصحيح *" />
      </div>
      <div className="flex gap-2 flex-wrap">
        <button disabled={busy} onClick={async () => { if (!adj.reason.trim()) return flash("سبب التصحيح مطلوب."); setBusy(true); const r = await civAdjustStock(assetId, Number(adj.total), Number(adj.avail), adj.reason.trim()); setBusy(false); if (!r.ok) return err(r, "تعذّر: "); await onChanged(); flash("عُدّل المخزون."); }} className={`${btnRed} px-3 py-1.5 text-xs`}>تصحيح المخزون</button>
        <select className={`${inp} w-auto`} onChange={async (e) => { const to = e.target.value; if (!to) return; setBusy(true); const r = await civTransferAsset(assetId, to, "نقل موقع"); setBusy(false); if (!r.ok) return err(r, "تعذّر: "); await onChanged(); flash("نُقل الموقع."); }}>
          <option value="">نقل إلى موقع…</option>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <input className={`${inp} w-40`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="سبب الأرشفة" />
        <button disabled={busy} onClick={async () => { if (!reason.trim()) return flash("سبب الأرشفة مطلوب."); setBusy(true); const r = await civArchiveAsset(assetId, reason.trim()); setBusy(false); if (!r.ok) return err(r, "تعذّر: "); await onChanged(); onClose(); flash("أُرشف الأصل."); }} className={`${btnGhost} px-3 py-1.5 text-xs border-red-900 text-red-400`}>أرشفة</button>
      </div>
      {/* Timeline */}
      <div className="max-h-48 overflow-y-auto space-y-1">
        {(tl?.movements ?? []).map((m, i) => <div key={i} className="text-[11px] text-stone-500 flex justify-between border-t border-stone-800 py-1"><span>{m.movement_type}{m.reason ? ` — ${m.reason}` : ""}</span><span dir="ltr">{new Date(m.created_at).toLocaleString("ar")}</span></div>)}
      </div>
    </div>
  );
}

// ─── التصنيفات ───
function CategoriesTab({ cats, busy, setBusy, flash, err, t, reload }: Common & { cats: CivCategory[]; reload: () => Promise<unknown> }) {
  const [name, setName] = useState("");
  return (
    <div className={`${card} space-y-2`}>
      <div className="flex gap-2"><input className={inp} value={name} onChange={(e) => setName(e.target.value)} placeholder="اسم تصنيف جديد" />
        <button disabled={busy} onClick={async () => { if (!name.trim()) return; setBusy(true); const r = await civUpsertCategory(null, name.trim(), cats.length); setBusy(false); if (!r.ok) return err(r, "تعذّر: "); setName(""); await reload(); flash("أُضيف التصنيف."); }} className={`${btnRed} px-4 py-2 whitespace-nowrap`}>إضافة</button></div>
      {cats.map((c) => <div key={c.id} className="flex justify-between items-center border-t border-stone-800 py-1.5"><span className="text-sm text-stone-200">{c.name}</span>
        <button disabled={busy} onClick={async () => { const reason = prompt("سبب الأرشفة:"); if (!reason) return; setBusy(true); const r = await civArchiveCategory(c.id, reason); setBusy(false); if (!r.ok) return err(r, "تعذّر: "); await reload(); }} className="text-red-400 text-xs">أرشفة</button></div>)}
    </div>
  );
}

// ─── المواقع ───
function LocationsTab({ locs, busy, setBusy, flash, err, t, reload }: Common & { locs: CivLocation[]; reload: () => Promise<unknown> }) {
  const [f, setF] = useState({ name: "", type: "warehouse", city: "" });
  return (
    <div className={`${card} space-y-2`}>
      <div className="grid grid-cols-3 gap-2">
        <input className={inp} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="اسم الموقع" />
        <select className={inp} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{["warehouse", "studio", "office", "vehicle", "external_site", "maintenance_center", "other"].map((x) => <option key={x} value={x}>{x}</option>)}</select>
        <input className={inp} value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} placeholder="المدينة" />
      </div>
      <button disabled={busy} onClick={async () => { if (!f.name.trim()) return; setBusy(true); const r = await civUpsertLocation({ name: f.name.trim(), type: f.type, city: f.city }); setBusy(false); if (!r.ok) return err(r, "تعذّر: "); setF({ name: "", type: "warehouse", city: "" }); await reload(); flash("أُضيف الموقع."); }} className={`${btnRed} px-4 py-2`}>إضافة موقع</button>
      {locs.map((l) => <div key={l.id} className="flex justify-between items-center border-t border-stone-800 py-1.5"><span className="text-sm text-stone-200">{l.name} <span className="text-stone-500 text-[11px]">({l.location_type})</span></span>
        <button disabled={busy} onClick={async () => { const reason = prompt("سبب الأرشفة:"); if (!reason) return; setBusy(true); const r = await civArchiveLocation(l.id, reason); setBusy(false); if (!r.ok) return err(r, "تعذّر: "); await reload(); }} className="text-red-400 text-xs">أرشفة</button></div>)}
    </div>
  );
}

// ─── صرف عهدة ───
function IssueTab({ assets, staff, busy, setBusy, flash, err, t, onDone }: Common & { assets: CivAsset[]; staff: Staff[]; onDone: () => void }) {
  const [emp, setEmp] = useState("");
  const [type, setType] = useState("permanent");
  const [purpose, setPurpose] = useState("");
  const [due, setDue] = useState("");
  const [items, setItems] = useState<CivIssueItem[]>([]);
  const [pick, setPick] = useState("");
  const avail = assets.filter((a) => !["maintenance", "lost", "retired"].includes(a.availability_status) && a.quantity_available > 0 && !items.find((i) => i.asset_id === a.id));
  async function submit() {
    if (!emp) return flash("اختر الموظف.");
    if (items.length === 0) return flash("أضف قطعة واحدة على الأقل.");
    setBusy(true);
    const r = await civCreateAssignment({ employee_user_id: emp, assignment_type: type, purpose, expected_return_at: due || null, items });
    setBusy(false);
    if (!r.ok) return err(r, "تعذّر الصرف: ");
    void civEmitEvent("civ_assignment_created", { assignment_id: r.data.id, title: "صرف عهدة " + r.data.assignment_number });
    setEmp(""); setItems([]); setPurpose(""); setDue(""); flash(`صُرفت العهدة (${r.data.assignment_number}). بانتظار تأكيد الموظف.`); onDone();
  }
  return (
    <div className={`${card} space-y-3`}>
      <div className="grid grid-cols-2 gap-2">
        <select className={inp} value={emp} onChange={(e) => setEmp(e.target.value)}><option value="">اختر الموظف *</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.full_name ?? s.email}</option>)}</select>
        <select className={inp} value={type} onChange={(e) => setType(e.target.value)}>{["permanent", "temporary", "project", "field_task", "replacement"].map((x) => <option key={x} value={x}>{x}</option>)}</select>
        <input className={inp} value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="الغرض" />
        <input type="datetime-local" className={inp} value={due} onChange={(e) => setDue(e.target.value)} title="الإرجاع المتوقع" />
      </div>
      <div className="flex gap-2">
        <select className={inp} value={pick} onChange={(e) => setPick(e.target.value)}><option value="">أضف أصلًا…</option>{avail.map((a) => <option key={a.id} value={a.id}>{a.asset_name} ({a.asset_code}) — متاح {a.quantity_available}</option>)}</select>
        <button className={`${btnGhost} px-4 py-2 whitespace-nowrap`} onClick={() => { if (pick) { setItems([...items, { asset_id: pick, quantity: 1 }]); setPick(""); } }}>+ أضف</button>
      </div>
      {items.map((it, idx) => { const a = assets.find((x) => x.id === it.asset_id); return (
        <div key={it.asset_id} className="flex items-center gap-2 bg-stone-950 border border-stone-800 rounded-lg p-2">
          <span className="text-sm text-stone-200 flex-1">{a?.asset_name} <span className="text-stone-500 text-xs" dir="ltr">({a?.asset_code})</span></span>
          {a?.asset_type === "quantity_based" && <input className={`${inp} w-20`} type="number" min={1} value={it.quantity ?? 1} onChange={(e) => setItems(items.map((x, i) => i === idx ? { ...x, quantity: Number(e.target.value) } : x))} />}
          <button className="text-red-400 text-xs" onClick={() => setItems(items.filter((_, i) => i !== idx))}>حذف</button>
        </div>
      ); })}
      <button disabled={busy} onClick={() => void submit()} className={`${btnRed} w-full py-2.5`}>صرف العهدة وإرسال طلب التأكيد</button>
    </div>
  );
}

// ─── العهد والإرجاع (الفحص) ───
function CustodyTab({ assignments, busy, setBusy, flash, err, t, empName, locs, reload }: Common & {
  assignments: CivAssignment[]; empName: (uid: string) => string; locs: CivLocation[]; reload: () => Promise<unknown>;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [items, setItems] = useState<Record<string, CivAssignmentItem[]>>({});
  const [ev, setEv] = useState<Record<string, { path: string; url: string; stage: string; item: string | null }[]>>({});
  const [insp, setInsp] = useState<Record<string, CivInspectItem>>({});
  const [photoCount, setPhotoCount] = useState<Record<string, number>>({});

  async function toggle(a: CivAssignment) {
    const n = open === a.id ? null : a.id; setOpen(n); if (!n) return;
    const [it, evs] = await Promise.all([civListAssignmentItems(a.id), civListEvidence(a.id)]);
    if (it.ok) setItems((p) => ({ ...p, [a.id]: it.data }));
    if (evs.ok) {
      const map = await civSignFiles(CIV_EVIDENCE_BUCKET, evs.data.map((e) => e.file_path));
      setEv((p) => ({ ...p, [a.id]: evs.data.map((e) => ({ path: e.file_path, url: map[e.file_path] ?? "", stage: e.evidence_stage, item: e.assignment_item_id })) }));
      const c: Record<string, number> = {}; for (const e of evs.data) if (e.evidence_stage === "return_inspection" && e.assignment_item_id) c[e.assignment_item_id] = (c[e.assignment_item_id] ?? 0) + 1;
      setPhotoCount((p) => ({ ...p, ...c }));
    }
  }
  async function uploadInspection(a: CivAssignment, itemId: string, file: File) {
    setBusy(true);
    const path = civEvidencePath(a.employee_user_id, a.id, "return_inspection", file.name);
    const up = await civUploadEvidence(path, file);
    if (up.ok) await civAttachEvidence({ assignment_id: a.id, assignment_item_id: itemId, stage: "return_inspection", path, name: file.name, mime: file.type, size: file.size });
    setBusy(false);
    if (up.ok) { setPhotoCount((p) => ({ ...p, [itemId]: (p[itemId] ?? 0) + 1 })); flash("أُضيفت صورة الفحص."); } else err(up, "تعذّر رفع الصورة: ");
  }
  async function submitInspect(a: CivAssignment) {
    const its = (items[a.id] ?? []).filter((i) => i.status === "return_requested");
    const chosen = its.filter((i) => insp[i.id]);
    if (chosen.length === 0) return flash("اختر نتيجة لكل بند مُرجَع.");
    if (chosen.some((i) => (photoCount[i.id] ?? 0) < 1)) return flash("صورة فحص واحدة على الأقل لكل بند.");
    setBusy(true);
    const payload: CivInspectItem[] = chosen.map((i) => insp[i.id]);
    const r = await civInspectReturn(a.id, payload);
    setBusy(false);
    if (!r.ok) return err(r, "تعذّر الفحص: ");
    void civEmitEvent(r.data.status === "rejected" ? "civ_return_rejected" : "civ_return_accepted", { assignment_id: a.id, title: "فحص إرجاع عهدة " + a.assignment_number });
    setInsp({}); await reload();
    flash(r.data.closed ? "تم الفحص وأُغلقت العهدة." : r.data.status === "rejected" ? "رُفض الإرجاع وأُعيد للموظف." : "تم الفحص — إرجاع جزئي.");
  }

  const RESULTS: { v: CivInspectResult; ar: string }[] = [
    { v: "accepted_good", ar: "قبول سليم" }, { v: "accepted_damaged", ar: "قبول متضرر" }, { v: "maintenance_required", ar: "صيانة" },
    { v: "missing", ar: "مفقود" }, { v: "rejected_return", ar: "رفض الإرجاع" }, { v: "partial_return", ar: "إرجاع جزئي" },
  ];
  const pending = assignments.filter((a) => a.status === "return_requested");
  const others = assignments.filter((a) => a.status !== "return_requested");
  const row = (a: CivAssignment, canInspect: boolean) => (
    <div key={a.id} className="border border-stone-800 rounded-lg p-3 mb-2">
      <div className="flex justify-between items-center">
        <div><span className="font-mono text-xs text-stone-400" dir="ltr">{a.assignment_number}</span> <span className="text-xs text-stone-300">— {empName(a.employee_user_id)}</span> <span className="text-[10px] text-stone-500">{a.status}</span></div>
        <button className={`${btnGhost} px-3 py-1 text-xs`} onClick={() => void toggle(a)}>{open === a.id ? "إخفاء" : (canInspect ? "فحص الإرجاع" : "التفاصيل")}</button>
      </div>
      {open === a.id && (
        <div className="mt-3 space-y-2">
          {(items[a.id] ?? []).map((i) => (
            <div key={i.id} className="bg-stone-950 border border-stone-800 rounded-lg p-2 space-y-2">
              <div className="text-sm text-stone-200">{i.asset_name} <span className="text-stone-500 text-xs" dir="ltr">({i.asset_code})</span> × {i.quantity} — <span className="text-[10px]">{i.status}</span></div>
              {(i.condition_at_return || i.return_notes) && <div className="text-[11px] text-amber-400/80">الموظف: {i.condition_at_return ?? ""}{i.return_notes ? ` — ${i.return_notes}` : ""}</div>}
              {/* صور الاستلام والإرجاع */}
              <div className="flex gap-1 flex-wrap">
                {(ev[a.id] ?? []).filter((e) => e.item === i.id && e.url).map((e, k) => <a key={k} href={e.url} target="_blank" rel="noreferrer"><img src={e.url} className="w-12 h-12 object-cover rounded border border-stone-700" alt={e.stage} title={e.stage} /></a>)}
              </div>
              {canInspect && i.status === "return_requested" && (
                <div className="grid grid-cols-2 gap-2">
                  <select className={inp} value={insp[i.id]?.result ?? ""} onChange={(e) => setInsp((p) => ({ ...p, [i.id]: { assignment_item_id: i.id, result: e.target.value as CivInspectResult, note: p[i.id]?.note } }))}>
                    <option value="">اختر النتيجة</option>{RESULTS.map((r) => <option key={r.v} value={r.v}>{r.ar}</option>)}
                  </select>
                  <label className={`${btnGhost} px-3 py-2 text-xs cursor-pointer text-center`}>📷 فحص {(photoCount[i.id] ?? 0) > 0 ? `(${photoCount[i.id]})` : ""}
                    <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) void uploadInspection(a, i.id, file); e.target.value = ""; }} /></label>
                  <input className={`${inp} col-span-2`} placeholder="ملاحظة الفحص" value={insp[i.id]?.note ?? ""} onChange={(e) => setInsp((p) => ({ ...p, [i.id]: { ...(p[i.id] ?? { assignment_item_id: i.id, result: "accepted_good" }), note: e.target.value } }))} />
                </div>
              )}
            </div>
          ))}
          {canInspect && <button disabled={busy} onClick={() => void submitInspect(a)} className={`${btnRed} w-full py-2.5`}>اعتماد الفحص</button>}
        </div>
      )}
    </div>
  );
  return (
    <div className="space-y-4">
      <section className={card}><h3 className="text-sm font-medium text-white mb-2">طلبات إرجاع بانتظار الفحص</h3>{pending.length === 0 ? <p className="text-xs text-stone-500">لا طلبات.</p> : pending.map((a) => row(a, true))}</section>
      <section className={card}><h3 className="text-sm font-medium text-white mb-2">كل العهد</h3>{others.map((a) => row(a, false))}</section>
    </div>
  );
}

// ─── الصيانة ───
function MaintenanceTab({ assets, busy, setBusy, flash, err, t }: Common & { assets: CivAsset[] }) {
  const [list, setList] = useState<{ id: string; maintenance_number: string; asset_id: string; status: string; issue_description: string | null }[]>([]);
  const [f, setF] = useState({ asset_id: "", type: "repair", desc: "", provider: "" });
  const reload = useCallback(() => civListMaintenance().then((r) => { if (r.ok) setList(r.data); }), []);
  useEffect(() => { void reload(); }, [reload]);
  return (
    <div className="space-y-3">
      <div className={`${card} grid grid-cols-2 md:grid-cols-4 gap-2`}>
        <select className={inp} value={f.asset_id} onChange={(e) => setF({ ...f, asset_id: e.target.value })}><option value="">اختر أصلًا</option>{assets.map((a) => <option key={a.id} value={a.id}>{a.asset_name} ({a.asset_code})</option>)}</select>
        <select className={inp} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{["preventive", "repair", "inspection", "calibration", "other"].map((x) => <option key={x} value={x}>{x}</option>)}</select>
        <input className={inp} value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value })} placeholder="الجهة" />
        <input className={inp} value={f.desc} onChange={(e) => setF({ ...f, desc: e.target.value })} placeholder="وصف العطل" />
        <button disabled={busy} onClick={async () => { if (!f.asset_id) return flash("اختر أصلًا."); setBusy(true); const r = await civOpenMaintenance({ asset_id: f.asset_id, type: f.type, desc: f.desc, provider: f.provider }); setBusy(false); if (!r.ok) return err(r, "تعذّر: "); void civEmitEvent("civ_maintenance_opened", { title: "فتح صيانة" }); setF({ asset_id: "", type: "repair", desc: "", provider: "" }); await reload(); flash("فُتحت الصيانة."); }} className={`${btnRed} py-2 col-span-2 md:col-span-4`}>فتح صيانة</button>
      </div>
      {list.map((m) => (
        <div key={m.id} className="flex justify-between items-center border border-stone-800 rounded-lg p-2">
          <span className="text-xs text-stone-300"><span className="font-mono" dir="ltr">{m.maintenance_number}</span> — {m.status} {m.issue_description ? `— ${m.issue_description}` : ""}</span>
          {m.status !== "completed" && <button disabled={busy} onClick={async () => { const rc = prompt("حالة الإرجاع: good / damaged / retired", "good"); if (!rc) return; setBusy(true); const r = await civCloseMaintenance(m.id, "completed", rc, null); setBusy(false); if (!r.ok) return err(r, "تعذّر: "); void civEmitEvent("civ_maintenance_closed", { title: "إغلاق صيانة" }); await reload(); flash("أُغلقت الصيانة."); }} className={`${btnGhost} px-3 py-1 text-xs`}>إغلاق</button>}
        </div>
      ))}
    </div>
  );
}

// ─── الجرد ───
function AuditsTab({ locs, busy, setBusy, flash, err, t }: Common & { locs: CivLocation[] }) {
  const [list, setList] = useState<{ id: string; audit_number: string; status: string }[]>([]);
  const [loc, setLoc] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [aitems, setAitems] = useState<{ id: string; asset_id: string; expected_quantity: number | null; counted_quantity: number | null; variance: number | null }[]>([]);
  const reload = useCallback(() => civListAudits().then((r) => { if (r.ok) setList(r.data); }), []);
  useEffect(() => { void reload(); }, [reload]);
  async function openAudit(id: string) { const n = open === id ? null : id; setOpen(n); if (n) { const r = await civListAuditItems(n); if (r.ok) setAitems(r.data); } }
  return (
    <div className="space-y-3">
      <div className={`${card} flex gap-2`}>
        <select className={inp} value={loc} onChange={(e) => setLoc(e.target.value)}><option value="">كل المواقع</option>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
        <button disabled={busy} onClick={async () => { setBusy(true); const r = await civStartAudit(loc || null); setBusy(false); if (!r.ok) return err(r, "تعذّر: "); void civEmitEvent("civ_audit_started", { title: "بدء جرد" }); await reload(); flash(`بدأ الجرد ${r.data.audit_number}.`); }} className={`${btnRed} px-4 py-2 whitespace-nowrap`}>بدء جرد</button>
      </div>
      {list.map((au) => (
        <div key={au.id} className="border border-stone-800 rounded-lg p-2">
          <div className="flex justify-between items-center">
            <span className="text-xs text-stone-300"><span className="font-mono" dir="ltr">{au.audit_number}</span> — {au.status}</span>
            <div className="flex gap-2">
              <button onClick={() => void openAudit(au.id)} className={`${btnGhost} px-3 py-1 text-xs`}>{open === au.id ? "إخفاء" : "البنود"}</button>
              {au.status === "in_progress" && <button disabled={busy} onClick={async () => { if (!confirm("اعتماد الجرد وتطبيق الفروقات؟")) return; setBusy(true); const r = await civApproveAudit(au.id); setBusy(false); if (!r.ok) return err(r, "تعذّر: "); void civEmitEvent("civ_audit_approved", { title: "اعتماد جرد" }); await reload(); flash(`اعتُمد. فروقات مطبّقة: ${r.data.variances_applied}.`); }} className={`${btnRed} px-3 py-1 text-xs`}>اعتماد</button>}
            </div>
          </div>
          {open === au.id && (
            <div className="mt-2 max-h-64 overflow-y-auto">
              {aitems.map((it) => (
                <div key={it.id} className="flex items-center gap-2 border-t border-stone-800 py-1">
                  <span className="text-[11px] text-stone-400 flex-1" dir="ltr">{it.asset_id.slice(0, 8)}</span>
                  <span className="text-[11px] text-stone-500">متوقع {it.expected_quantity ?? "—"}</span>
                  <input className={`${inp} w-20`} type="number" defaultValue={it.counted_quantity ?? ""} placeholder="عُدّ"
                    onBlur={async (e) => { const v = e.target.value; if (v === "") return; setBusy(true); await civCountAuditItem({ audit_id: au.id, asset_id: it.asset_id, counted: Number(v) }); setBusy(false); const r = await civListAuditItems(au.id); if (r.ok) setAitems(r.data); }} />
                  {it.variance != null && it.variance !== 0 && <span className="text-[11px] text-amber-400">فرق {it.variance}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── التقارير ───
function ReportsTab({ busy, setBusy, flash, err, t }: Common) {
  const KINDS: { k: string; ar: string }[] = [
    { k: "stock", ar: "المخزون الحالي" }, { k: "active_assignments", ar: "العهد النشطة" }, { k: "overdue", ar: "تأخر الإرجاع" },
    { k: "damage_lost", ar: "التلف والمفقود" }, { k: "maintenance", ar: "الصيانة" }, { k: "warranty", ar: "الضمانات" },
    { k: "value", ar: "القيمة" }, { k: "movements", ar: "حركات المخزون" },
  ];
  const [kind, setKind] = useState("stock");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  async function run(k: string) {
    setKind(k); setBusy(true);
    const r = await civGetReport<Record<string, unknown>[] | Record<string, unknown>>(k);
    setBusy(false);
    if (!r.ok) return err(r, "تعذّر: ");
    setRows(Array.isArray(r.data) ? r.data : [r.data]);
  }
  useEffect(() => { void run("stock"); /* eslint-disable-next-line */ }, []);
  const cols = rows[0] ? Object.keys(rows[0]) : [];
  return (
    <div className="space-y-3">
      <div className="flex gap-1.5 flex-wrap">{KINDS.map((x) => <button key={x.k} onClick={() => void run(x.k)} className={`px-3 py-1.5 rounded-lg text-xs ${kind === x.k ? "bg-red-600 text-white" : "bg-stone-800 text-stone-300 border border-stone-700"}`}>{x.ar}</button>)}</div>
      <div className="flex justify-end"><button disabled={busy || rows.length === 0} onClick={() => downloadCsv(`custody_${kind}`, rows)} className={`${btnGhost} px-3 py-1.5 text-xs`}>تصدير CSV</button></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[600px]"><thead><tr>{cols.map((c) => <th key={c} className={th}>{c}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c} className={td} dir="auto">{String(r[c] ?? "")}</td>)}</tr>)}</tbody></table>
        {rows.length === 0 && <p className="text-xs text-stone-500 py-3">لا بيانات.</p>}</div>
    </div>
  );
}

// ─── الإعدادات (يشمل إظهار/إخفاء العهدة اليدوية للموظف) ───
function SettingsTab({ settings, setSettings, busy, setBusy, flash, err, t }: Common & { settings: CivSettings; setSettings: (s: CivSettings) => void }) {
  const save = async (patch: Partial<CivSettings>) => {
    setBusy(true); const r = await civUpdateSettings(patch); setBusy(false);
    if (!r.ok) return err(r, "تعذّر الحفظ: "); setSettings({ ...settings, ...r.data }); flash("حُفظ الإعداد.");
  };
  const Toggle = ({ on, onClick }: { on: boolean; onClick: () => void }) => (
    <button disabled={busy} onClick={onClick} className={`w-11 h-6 rounded-full transition ${on ? "bg-red-600" : "bg-stone-700"} relative`}>
      <span className={`absolute top-0.5 ${on ? "left-0.5" : "right-0.5"} w-5 h-5 bg-white rounded-full`} /></button>
  );
  return (
    <div className={`${card} space-y-4`}>
      <div className="flex items-start gap-3">
        <Toggle on={settings.legacy_custody_employee_visible} onClick={() => void save({ legacy_custody_employee_visible: !settings.legacy_custody_employee_visible })} />
        <div><div className="text-sm text-stone-200">إظهار «العهدة اليدوية» للموظفين</div>
          <div className="text-[11px] text-stone-500">موقوف: يُخفى تبويب العهدة اليدوية القديمة من بوابة الموظف (تبقى ظاهرة للإدارة وبياناتها محفوظة). للمالك/الأدمن فقط.</div></div>
      </div>
      <div className="flex items-start gap-3 border-t border-stone-800 pt-4">
        <Toggle on={settings.show_purchase_value_to_employee} onClick={() => void save({ show_purchase_value_to_employee: !settings.show_purchase_value_to_employee })} />
        <div><div className="text-sm text-stone-200">إظهار قيمة الشراء للموظف</div>
          <div className="text-[11px] text-stone-500">الافتراضي مخفي — لا يرى الموظف تكلفة الأصول.</div></div>
      </div>
      {/* أعلام المنصّة المؤسسية (يقرؤها الكود بأمان قبل تشغيل الـ patches) */}
      <div className="border-t border-stone-800 pt-4">
        <h3 className="text-sm font-medium text-stone-300 mb-3">{t({ ar: "مزايا المنصّة المؤسسية", en: "Enterprise modules" })}</h3>
        <CustodyEnterpriseSettings />
      </div>
    </div>
  );
}
