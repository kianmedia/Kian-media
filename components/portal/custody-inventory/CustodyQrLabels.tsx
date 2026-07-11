"use client";
// QR والباركود وطباعة الملصقات — واجهة إدارة حقيقية. يولّد QR (حزمة qrcode) + Code128
// (مضمّن) لكل أصل، ويطبع منفردًا/مجموعة/A4، ويسجّل الطباعة، ويعيد إصدار QR.
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { custodyListAssetsForLabels, custodyReissueQr, custodyLogLabelPrint } from "@/lib/portal/custodyEnterprise";
import { qrDataUrl, qrScanUrl } from "@/lib/qr/qr";
import { code128Svg } from "@/lib/qr/code128";

const card = "bg-stone-900 border border-stone-800 rounded-xl p-4";
const inp = "w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-200 placeholder:text-stone-600 focus:outline-none focus:ring-2 focus:ring-red-500";
const btnRed = "rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium";
const btnGhost = "rounded-lg bg-stone-800 border border-stone-700 text-stone-200 text-sm disabled:opacity-50";

interface LabelAsset { id: string; asset_code: string; asset_name: string; qr_token: string; barcode_value: string | null; label_version: number }

export default function CustodyQrLabels() {
  const { t } = useI18n();
  const [assets, setAssets] = useState<LabelAsset[]>([]);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [qrMap, setQrMap] = useState<Record<string, string>>({});   // assetId -> QR dataURL
  const [busy, setBusy] = useState(false);
  const [dbReady, setDbReady] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast(null), 3200); };

  async function load(query: string) {
    const r = await custodyListAssetsForLabels(query || undefined);
    if (!r.ok) { if (/qr_token|column|does not exist/i.test(r.error)) setDbReady(false); return; }
    setDbReady(true); setAssets(r.data);
    // ولّد QR لكل أصل (dataURL) — بشكل غير متزامن.
    for (const a of r.data) {
      if (a.qr_token && !qrMap[a.id]) {
        const url = await qrDataUrl(qrScanUrl(a.qr_token), 140);
        if (url) setQrMap((p) => ({ ...p, [a.id]: url }));
      }
    }
  }
  useEffect(() => { const id = window.setTimeout(() => void load(q), 300); return () => window.clearTimeout(id); }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id: string) => setSel((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const selected = assets.filter((a) => sel.has(a.id));

  function printLabels(list: LabelAsset[]) {
    if (list.length === 0) { flash(t({ ar: "اختر أصلًا واحدًا على الأقل.", en: "Select at least one asset." })); return; }
    const w = window.open("", "_blank", "width=900,height=700");
    if (!w) { flash(t({ ar: "اسمح بالنوافذ المنبثقة للطباعة.", en: "Allow pop-ups to print." })); return; }
    const labelHtml = list.map((a) => `
      <div class="lbl">
        <div class="brand">Kian • كيان</div>
        <div class="name">${escapeHtml(a.asset_name)}</div>
        <div class="row">
          <img class="qr" src="${qrMap[a.id] ?? ""}" alt="QR"/>
          <div class="meta"><div class="code">${escapeHtml(a.asset_code)}</div>${code128Svg(a.asset_code, { moduleWidth: 1.4, height: 34 })}</div>
        </div>
      </div>`).join("");
    w.document.write(`<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>Kian Labels</title><style>
      @page { margin: 8mm; } body { font-family: system-ui, sans-serif; }
      .grid { display: flex; flex-wrap: wrap; gap: 6mm; }
      .lbl { border: 1px solid #ccc; border-radius: 6px; padding: 6mm; width: 62mm; }
      .brand { font-size: 9px; color: #e31e24; font-weight: 700; }
      .name { font-size: 13px; font-weight: 600; margin: 2px 0 4px; }
      .row { display: flex; gap: 6px; align-items: center; }
      .qr { width: 82px; height: 82px; } .meta { flex: 1; } .code { font-family: monospace; font-size: 11px; margin-bottom: 3px; }
    </style></head><body><div class="grid">${labelHtml}</div><script>window.onload=()=>{window.print();}</script></body></html>`);
    w.document.close();
    void custodyLogLabelPrint(list.map((a) => a.id), list.length > 1 ? "sheet" : "single").then(() => void load(q));
  }

  async function reissue(a: LabelAsset) {
    if (!confirm(t({ ar: `إعادة إصدار QR للأصل ${a.asset_code}؟ سيُبطل القديم.`, en: "Reissue QR? Old code is revoked." }))) return;
    setBusy(true);
    const r = await custodyReissueQr(a.id, "manual reissue");
    setBusy(false);
    if (!r.ok) { flash((/not authorized/.test(r.error) ? t({ ar: "غير مصرّح.", en: "Not authorized." }) : t({ ar: "تعذّر: ", en: "Failed: " }) + r.error)); return; }
    setQrMap((p) => { const n = { ...p }; delete n[a.id]; return n; });
    await load(q); flash(t({ ar: "أُعيد إصدار QR.", en: "QR reissued." }));
  }

  if (!dbReady) return (
    <div className="bg-amber-950/40 border border-amber-800/60 rounded-xl p-4 text-sm text-amber-300">
      {t({ ar: "وحدة QR غير مُجهّزة — شغّل docs/custody_enterprise_01_qr_kits_PATCH.sql", en: "QR module not prepared — run patch 01." })}
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex gap-2 items-center flex-wrap">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t({ ar: "بحث بالاسم/الكود", en: "Search" })} className={inp} />
        <button disabled={busy} onClick={() => printLabels(selected)} className={`${btnRed} px-4 py-2 whitespace-nowrap`}>{t({ ar: `طباعة المحدد (${sel.size})`, en: `Print selected (${sel.size})` })}</button>
        <button disabled={busy || assets.length === 0} onClick={() => printLabels(assets)} className={`${btnGhost} px-4 py-2 whitespace-nowrap`}>{t({ ar: "طباعة A4 للكل", en: "Print all (A4)" })}</button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {assets.map((a) => (
          <div key={a.id} className={`${card} ${sel.has(a.id) ? "ring-2 ring-red-600" : ""}`}>
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="checkbox" checked={sel.has(a.id)} onChange={() => toggle(a.id)} className="mt-1" />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-stone-200 truncate">{a.asset_name}</div>
                <div className="text-[11px] text-stone-500 font-mono" dir="ltr">{a.asset_code} · v{a.label_version}</div>
              </div>
              {qrMap[a.id] && <img src={qrMap[a.id]} alt="QR" className="w-16 h-16 rounded bg-white p-0.5" />}
            </label>
            <div className="flex gap-2 mt-2">
              <button onClick={() => printLabels([a])} className={`${btnGhost} px-3 py-1 text-[11px]`}>{t({ ar: "طباعة", en: "Print" })}</button>
              <button disabled={busy} onClick={() => void reissue(a)} className={`${btnGhost} px-3 py-1 text-[11px] text-amber-400`}>{t({ ar: "إعادة إصدار", en: "Reissue" })}</button>
            </div>
          </div>
        ))}
        {assets.length === 0 && <p className="text-xs text-stone-500 col-span-full py-3">{t({ ar: "لا أصول.", en: "No assets." })}</p>}
      </div>
      {toast && <div className="fixed bottom-4 inset-x-4 z-50 mx-auto max-w-sm bg-stone-800 border border-stone-700 rounded-lg px-4 py-2 text-sm text-stone-100 text-center shadow-lg">{toast}</div>}
    </div>
  );
}

const HTML_ESCAPE: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPE[c] ?? c);
}
