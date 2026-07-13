"use client";
// ════════════════════════════════════════════════════════════════════════════
// «استكمال صور الأصول» — شاشة إدارية (owner/super_admin/admin) لرفع صور الأصول الناقصة.
// المصدر: custody_inv_admin_assets_photo_status (has_photo = صف asset_photo + كائن تخزين).
// الرفع عبر civSaveAssetPhoto (رفع→ربط→أساسية تلقائيًا؛ ينظّف اليتيم عند فشل الربط، Retry آمن).
// لا ربط تلقائي بالاسم. الصورة الأولى تصبح Primary بالقاعدة. تحديث فوري بلا Refresh كامل.
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { civListAssetsPhotoStatus, civSaveAssetPhoto, type CivAssetPhotoStatus, type CivCategory, type CivLocation } from "@/lib/portal/custodyInventory";

const PAGE = 24;
const card = "bg-stone-900 border border-stone-800 rounded-xl p-3";
const inp = "w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-200 placeholder:text-stone-600 focus:outline-none focus:ring-2 focus:ring-red-500";
const btnGhost = "rounded-lg bg-stone-800 border border-stone-700 text-stone-200 text-sm disabled:opacity-50";
type Row = CivAssetPhotoStatus & { st?: "uploading" | "done" | "failed"; err?: string };
type Filter = "without" | "with" | "all";

export default function CustodyPhotoCompletion({ cats, locs }: { cats: CivCategory[]; locs: CivLocation[] }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<Row[]>([]);
  const [load, setLoad] = useState<"loading" | "ready" | "forbidden" | "not_prepared" | "error">("loading");
  const [errMsg, setErrMsg] = useState("");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("without");
  const [page, setPage] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast(null), 3200); };
  const reqId = useRef(0);   // حارس ضد نتائج البحث القديمة (out-of-order)

  const reload = useCallback(async () => {
    const my = ++reqId.current;
    setLoad("loading");
    const r = await civListAssetsPhotoStatus(q || undefined);
    if (my !== reqId.current) return;   // وصلت نتيجة أحدث — تجاهل هذه
    if (!r.ok) {
      // eslint-disable-next-line no-console
      console.error("[custody] photo status load failed", { status: r.status, error: r.error });
      setErrMsg(r.error);
      if (r.status === 401 || r.status === 403 || /not authorized|permission|forbidden/i.test(r.error)) setLoad("forbidden");
      else if (r.status === 404 || /PGRST202|does not exist|schema cache|function/i.test(r.error)) setLoad("not_prepared");
      else setLoad("error");
      return;
    }
    setRows(r.data.map((d) => ({ ...d }))); setPage(0); setLoad("ready");
  }, [q]);
  useEffect(() => { const id = window.setTimeout(() => void reload(), 300); return () => window.clearTimeout(id); }, [reload]);

  const catName = (id: string | null) => cats.find((c) => c.id === id)?.name ?? "—";
  const locName = (id: string | null) => locs.find((l) => l.id === id)?.name ?? "—";

  async function upload(row: Row, file: File) {
    setRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, st: "uploading", err: undefined } : x)));
    const res = await civSaveAssetPhoto(row.id, file);
    if (!res.ok) {
      setRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, st: "failed", err: res.error } : x)));
      flash(/not_image/.test(res.error) ? t({ ar: "اختر ملف صورة (لا PDF/مستند).", en: "Choose an image file." })
        : /attach_uncertain/.test(res.error) ? t({ ar: `تعذّر تأكيد حفظ ${row.asset_code} (شبكة) — حدّث وتحقّق.`, en: "Save unconfirmed — refresh & check." })
        : t({ ar: `تعذّر رفع صورة ${row.asset_code} — أعد المحاولة.`, en: "Upload failed — retry." })); return;
    }
    // نجاح: الأصل صار له صورة (يخرج من فلتر «بدون صورة» → انتقال للتالي)، مع تحديث العدّاد.
    setRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, st: "done", has_photo: true } : x)));
    flash(t({ ar: `تم حفظ صورة ${row.asset_code}.`, en: "Saved." }));
  }

  const withoutCount = rows.filter((r) => !r.has_photo).length;
  const filtered = rows.filter((r) => (filter === "all" ? true : filter === "with" ? r.has_photo : !r.has_photo));
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const clampedPage = Math.min(page, pages - 1);
  const pageRows = filtered.slice(clampedPage * PAGE, clampedPage * PAGE + PAGE);
  const FILTERS: { k: Filter; ar: string; en: string }[] = [
    { k: "without", ar: "بدون صورة", en: "Without photo" }, { k: "with", ar: "لها صور", en: "With photo" }, { k: "all", ar: "الكل", en: "All" },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-sm text-stone-200">{t({ ar: "أصول بدون صورة: ", en: "Assets without photo: " })}<span className="text-red-400 font-semibold">{withoutCount}</span></div>
        <button disabled={load === "loading"} onClick={() => void reload()} className={`${btnGhost} px-3 py-1.5 text-xs`}>↻ {t({ ar: "تحديث", en: "Refresh" })}</button>
      </div>
      <div className="flex gap-2 flex-wrap">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t({ ar: "بحث بالاسم/الكود/التسلسلي", en: "Search" })} className={`${inp} flex-1 min-w-[180px]`} />
        <div className="flex gap-1.5">{FILTERS.map((f) => (
          <button key={f.k} onClick={() => { setFilter(f.k); setPage(0); }} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${filter === f.k ? "bg-red-600 text-white" : "bg-stone-800 text-stone-300 border border-stone-700"}`}>{t({ ar: f.ar, en: f.en })}</button>
        ))}</div>
      </div>

      {load === "loading" && <p className="text-xs text-stone-500">{t({ ar: "جارٍ التحميل…", en: "Loading…" })}</p>}
      {load === "forbidden" && <div className="bg-amber-950/40 border border-amber-800/60 rounded-xl p-3 text-sm text-amber-300">{t({ ar: "غير مصرّح — هذه الشاشة للمالك والسوبر أدمن والأدمن.", en: "Not authorized." })}</div>}
      {load === "not_prepared" && <div className="bg-amber-950/40 border border-amber-800/60 rounded-xl p-3 text-sm text-amber-300 space-y-1"><div>{t({ ar: "الوحدة غير مُجهّزة في قاعدة البيانات.", en: "Not prepared." })}</div><div className="font-mono text-[11px]" dir="ltr">Run: docs/custody_asset_photos_production_RUNME.sql</div></div>}
      {load === "error" && <div className="bg-red-950/40 border border-red-900/60 rounded-xl p-3 text-sm text-red-300">{t({ ar: "تعذّر التحميل: ", en: "Failed: " })}<span dir="ltr">{errMsg}</span></div>}

      {load === "ready" && filtered.length === 0 && <p className="text-sm text-stone-400 bg-stone-900 border border-stone-800 rounded-xl p-3">{filter === "without" ? t({ ar: "كل الأصول لها صور 🎉", en: "All assets have photos 🎉" }) : t({ ar: "لا نتائج.", en: "No results." })}</p>}

      {load === "ready" && pageRows.length > 0 && <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {pageRows.map((r) => (
          <div key={r.id} className={`${card} flex items-center gap-3 ${r.st === "done" ? "ring-1 ring-emerald-700" : r.st === "failed" ? "ring-1 ring-red-800" : ""}`}>
            <div className="flex-1 min-w-0">
              <div className="text-sm text-stone-200 truncate">{r.asset_name}</div>
              <div className="text-[11px] text-stone-500 font-mono truncate" dir="ltr">{r.asset_code}{r.serial_number ? ` · SN ${r.serial_number}` : ""}</div>
              <div className="text-[10px] text-stone-600 truncate">{r.asset_type === "serialized" ? "متسلسل" : "كمي"} · {catName(r.category_id)} · {locName(r.warehouse_location_id)}</div>
              {r.st === "uploading" && <div className="text-[10px] text-sky-400">{t({ ar: "جارٍ الرفع…", en: "Uploading…" })}</div>}
              {r.st === "done" && <div className="text-[10px] text-emerald-400">✓ {t({ ar: "تم الحفظ", en: "Saved" })}</div>}
              {r.st === "failed" && <div className="text-[10px] text-red-400">✗ {t({ ar: "فشل — أعد المحاولة", en: "Failed — retry" })}</div>}
              {r.has_photo && r.st !== "done" && <div className="text-[10px] text-emerald-500/70">✓ {t({ ar: "لها صورة", en: "has photo" })}</div>}
            </div>
            {/* الرفع فقط للأصول بلا صورة (أو إعادة محاولة بعد فشل) — منعًا لصور مكررة. */}
            {(!r.has_photo || r.st === "failed") && r.st !== "done"
              ? <label className={`${btnGhost} px-3 py-2 text-xs cursor-pointer whitespace-nowrap ${r.st === "uploading" ? "opacity-50 pointer-events-none" : ""}`}>
                  📷 {r.st === "failed" ? t({ ar: "إعادة", en: "Retry" }) : t({ ar: "رفع صورة", en: "Upload" })}
                  <input type="file" accept="image/*" className="hidden" disabled={r.st === "uploading"} onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(r, f); e.target.value = ""; }} />
                </label>
              : <span className="text-[10px] text-emerald-500/80 whitespace-nowrap">✓</span>}
          </div>
        ))}
      </div>}

      {load === "ready" && pages > 1 && <div className="flex items-center justify-center gap-2 pt-1">
        <button disabled={clampedPage === 0} onClick={() => setPage(clampedPage - 1)} className={`${btnGhost} px-3 py-1 text-xs`}>‹</button>
        <span className="text-[11px] text-stone-500">{clampedPage + 1} / {pages}</span>
        <button disabled={clampedPage >= pages - 1} onClick={() => setPage(clampedPage + 1)} className={`${btnGhost} px-3 py-1 text-xs`}>›</button>
      </div>}

      {toast && <div className="fixed bottom-4 inset-x-4 z-50 mx-auto max-w-sm bg-stone-800 border border-stone-700 rounded-lg px-4 py-2 text-sm text-stone-100 text-center shadow-lg">{toast}</div>}
    </div>
  );
}
