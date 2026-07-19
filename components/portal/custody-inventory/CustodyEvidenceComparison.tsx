"use client";
// ════════════════════════════════════════════════════════════════════════
// P0 — Custody return-inspection EVIDENCE COMPARISON. For each asset it shows all
// four evidence groups (registered / issue / return / inspection) as three
// comparison columns, never substituting one group for another and never the
// overall photo for the per-asset ones. Signed URLs are minted client-side from
// the two PRIVATE buckets; a missing group shows an explicit state (never a broken
// image). Historic cases with no issue evidence are flagged and must be
// acknowledged. A lightbox gives large preview + zoom + fullscreen + prev/next +
// full metadata. Data + access come from custody_inv_evidence_bundle (server-side
// civ_can_manage OR own-employee; employees get a redacted set).
// ════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  civEvidenceBundle, civSignFiles, civRequestMoreEvidence, CIV_ASSETS_BUCKET, CIV_EVIDENCE_BUCKET,
  type CivEvidenceBundle, type CivEvidenceImage, type CivEvidenceItem,
} from "@/lib/portal/custodyInventory";

const COND_AR: Record<string, string> = {
  new: "جديد", excellent: "ممتاز", good: "جيد", fair: "مقبول", damaged: "تالف",
  under_maintenance: "صيانة", lost: "مفقود", retired: "مُخرَج",
};
const cond = (c: string | null) => (c ? COND_AR[c] ?? c : "—");
const fmtSize = (n: number | null) => (n == null ? "" : n < 1024 ? `${n}B` : n < 1048576 ? `${(n / 1024).toFixed(0)}KB` : `${(n / 1048576).toFixed(1)}MB`);
const roleAr = (r: string | null) => (r === "employee" ? "الموظف" : r === "staff" ? "الفريق" : "");

export default function CustodyEvidenceComparison({ assignmentId }: { assignmentId: string }) {
  const [b, setB] = useState<CivEvidenceBundle | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [ack, setAck] = useState<Set<string>>(new Set());   // acknowledged historic items
  const [box, setBox] = useState<{ imgs: CivEvidenceImage[]; i: number } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await civEvidenceBundle(assignmentId);
    if (!r.ok) { setLoading(false); return; }
    setB(r.data);
    // collect paths per bucket and sign.
    const byBucket: Record<string, string[]> = {};
    const collect = (imgs?: CivEvidenceImage[]) => (imgs ?? []).forEach((im) => { (byBucket[im.bucket] ??= []).push(im.path); });
    r.data.items.forEach((it) => { collect(it.registered_images); collect(it.issue_images); collect(it.return_images); collect(it.inspection_images); });
    collect(r.data.overall.issue); collect(r.data.overall.return); collect(r.data.overall.inspection);
    collect(r.data.unlinked);
    const merged: Record<string, string> = {};
    for (const bucket of Object.keys(byBucket)) Object.assign(merged, await civSignFiles(bucket, byBucket[bucket]));
    setUrls(merged); setLoading(false);
  }, [assignmentId]);
  useEffect(() => { void load(); }, [load]);

  const resolved = useMemo(() => (b?.items ?? []).filter((i) => ["inspected", "returned", "damaged", "missing"].includes(i.item_status)).length, [b]);

  async function requestMore() {
    const n = window.prompt("ما الأدلة/الصور الإضافية المطلوبة من الموظف؟");
    if (n == null) return;
    const r = await civRequestMoreEvidence(assignmentId, n);
    setFlash(r.ok ? "أُرسل الطلب للموظف." : "تعذّر: " + r.error);
    window.setTimeout(() => setFlash(null), 4000);
  }

  if (loading) return <div className="text-[11px] text-stone-500">جارٍ تحميل الأدلة…</div>;
  if (!b) return <div className="text-[11px] text-amber-400">تعذّر تحميل الأدلة — شغّل custody_evidence_bundle_RUNME.sql.</div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-xs font-medium text-stone-300">مقارنة أدلة الفحص · تم فحص {resolved} من {b.items.length} قطعة</span>
        {b.is_manager && <button onClick={requestMore} className="text-[11px] text-sky-300 border border-sky-800 rounded px-2.5 py-1">طلب أدلة إضافية</button>}
      </div>
      {flash && <div className="text-[11px] text-emerald-300">{flash}</div>}

      {b.items.map((it) => (
        <AssetCard key={it.item_id} it={it} overall={b.overall} urls={urls} onOpen={(imgs, i) => setBox({ imgs, i })}
          acknowledged={ack.has(it.item_id)} onAck={() => setAck((s) => new Set(s).add(it.item_id))} />
      ))}

      {/* Overall (assignment-level) photos — kept SEPARATE from per-asset. */}
      <OverallSection overall={b.overall} urls={urls} onOpen={(imgs, i) => setBox({ imgs, i })} />

      {/* Unlinked evidence (admin) — asset-tagged rows that don't map to one item; never dropped. */}
      {b.is_manager && (b.unlinked?.length ?? 0) > 0 && (
        <div className="rounded-lg border border-amber-700/50 bg-amber-900/10 p-3">
          <div className="text-xs font-medium text-amber-300 mb-2">⚠ أدلة غير مربوطة ({b.unlinked!.length}) — تحتاج مراجعة (ربط يدوي/غامض)</div>
          <div className="flex flex-wrap gap-1.5">
            {b.unlinked!.map((im, i) => urls[im.path] ? (
              <button key={im.path + i} onClick={() => setBox({ imgs: b.unlinked!, i })} className="relative">
                <img src={urls[im.path]} alt="" className="w-14 h-14 object-cover rounded border border-amber-700/60" />
                <span className="absolute bottom-0 left-0 right-0 bg-black/70 text-[7px] text-amber-200 text-center">{im.group ?? im.stage}</span>
              </button>
            ) : null)}
          </div>
        </div>
      )}

      {box && <Lightbox imgs={box.imgs} i={box.i} urls={urls} onClose={() => setBox(null)} onNav={(i) => setBox({ ...box, i })} />}
    </div>
  );
}

function AssetCard({ it, overall, urls, onOpen, acknowledged, onAck }: {
  it: CivEvidenceItem; overall: CivEvidenceBundle["overall"]; urls: Record<string, string>;
  onOpen: (imgs: CivEvidenceImage[], i: number) => void; acknowledged: boolean; onAck: () => void;
}) {
  // issue evidence completeness = per-asset issue OR overall issue present.
  const issueComplete = it.issue_images.length > 0 || overall.issue.length > 0;
  return (
    <div className="rounded-lg border border-stone-700 bg-stone-900/50 p-3">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
        <div className="text-[12.5px] text-white">
          <span className="font-semibold">{it.asset_name}</span> <span className="text-stone-500" dir="ltr">({it.asset_code})</span>
          {it.serial_number && <span className="text-[11px] text-stone-500" dir="ltr"> · SN {it.serial_number}</span>}
        </div>
        <span className="text-[10.5px] text-stone-400">مسجّل: {cond(it.registered_condition)} · صرف: {cond(it.condition_at_issue)} · إرجاع: {cond(it.condition_at_return)}</span>
      </div>

      {!issueComplete && (
        <div className="mb-2 rounded border border-amber-700/50 bg-amber-900/10 p-2 text-[11px] text-amber-300 flex items-center justify-between gap-2 flex-wrap">
          <span>⚠ أدلة الصرف غير مكتملة — حالة قديمة. لا تُرفض تلقائيًا.</span>
          <label className="flex items-center gap-1 text-amber-200"><input type="checkbox" checked={acknowledged} onChange={onAck} /> أُقرّ بذلك قبل القرار</label>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <Col title="الصورة المسجلة / وقت الصرف" empties={["لا توجد صورة مسجلة للأصل", "لم تُرفع صورة عند الصرف"]}
          groups={[{ label: "مسجّلة", imgs: it.registered_images }, { label: "الصرف", imgs: it.issue_images }]} urls={urls} onOpen={onOpen} />
        <Col title="صورة الموظف عند الإرجاع" empties={["لم يرفق الموظف صورة عند الإرجاع"]}
          groups={[{ label: "الإرجاع", imgs: it.return_images }]} urls={urls} onOpen={onOpen} note={it.return_notes} />
        <Col title="صورة الفحص" empties={["لم تُرفع صورة الفحص"]}
          groups={[{ label: "الفحص", imgs: it.inspection_images }]} urls={urls} onOpen={onOpen} />
      </div>
    </div>
  );
}

function Col({ title, groups, empties, urls, onOpen, note }: {
  title: string; groups: { label: string; imgs: CivEvidenceImage[] }[]; empties: string[];
  urls: Record<string, string>; onOpen: (imgs: CivEvidenceImage[], i: number) => void; note?: string | null;
}) {
  const total = groups.reduce((n, g) => n + g.imgs.length, 0);
  const flat = groups.flatMap((g) => g.imgs);
  return (
    <div className="rounded border border-stone-800 bg-stone-950/40 p-2">
      <div className="text-[10.5px] font-medium text-stone-400 mb-1.5">{title}</div>
      {total === 0 ? (
        <div className="space-y-1">{empties.map((e) => <div key={e} className="text-[10.5px] text-stone-600 italic">— {e}</div>)}</div>
      ) : (
        groups.map((g) => g.imgs.length > 0 && (
          <div key={g.label} className="mb-1.5">
            <div className="text-[9.5px] text-stone-500 mb-1">{g.label} ({g.imgs.length})</div>
            <div className="flex flex-wrap gap-1.5">
              {g.imgs.map((im, i) => {
                const u = urls[im.path];
                const idx = flat.indexOf(im);
                return u ? (
                  <button key={im.path + i} onClick={() => onOpen(flat, idx)} className="relative group">
                    <img src={u} alt="" className="w-14 h-14 object-cover rounded border border-stone-700 group-hover:border-red-600" />
                    {im.scope === "overall" && <span className="absolute top-0 left-0 bg-black/70 text-[8px] text-amber-300 px-1 rounded-br">إجمالي</span>}
                  </button>
                ) : <div key={im.path + i} className="w-14 h-14 rounded bg-stone-800 border border-stone-700 flex items-center justify-center text-stone-600 text-[9px]">…</div>;
              })}
            </div>
          </div>
        ))
      )}
      {note && <div className="text-[10px] text-stone-400 mt-1">ملاحظة: {note}</div>}
    </div>
  );
}

function OverallSection({ overall, urls, onOpen }: { overall: CivEvidenceBundle["overall"]; urls: Record<string, string>; onOpen: (imgs: CivEvidenceImage[], i: number) => void }) {
  const groups = [
    { label: "صورة الصرف الإجمالية", imgs: overall.issue },
    { label: "صورة الإرجاع الإجمالية", imgs: overall.return },
    { label: "صورة الفحص الإجمالية", imgs: overall.inspection },
  ];
  if (groups.every((g) => g.imgs.length === 0)) return null;
  return (
    <div className="rounded-lg border border-stone-700 bg-stone-900/50 p-3">
      <div className="text-xs font-medium text-stone-300 mb-2">الصور الإجمالية للعهدة (منفصلة عن صور القِطع)</div>
      <div className="grid grid-cols-3 gap-2">
        {groups.map((g) => (
          <div key={g.label}>
            <div className="text-[10px] text-stone-500 mb-1">{g.label}</div>
            {g.imgs.length === 0 ? <div className="text-[10px] text-stone-600 italic">— لا توجد</div> : (
              <div className="flex flex-wrap gap-1.5">
                {g.imgs.map((im, i) => urls[im.path] && (
                  <button key={im.path + i} onClick={() => onOpen(g.imgs, i)}>
                    <img src={urls[im.path]} alt="" className="w-14 h-14 object-cover rounded border border-stone-700 hover:border-red-600" />
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Lightbox({ imgs, i, urls, onClose, onNav }: {
  imgs: CivEvidenceImage[]; i: number; urls: Record<string, string>; onClose: () => void; onNav: (i: number) => void;
}) {
  const [zoom, setZoom] = useState(1);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const im = imgs[i]; const u = im ? urls[im.path] : null;
  useEffect(() => { setZoom(1); }, [i]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && i < imgs.length - 1) onNav(i + 1);
      if (e.key === "ArrowRight" && i > 0) onNav(i - 1);
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [i, imgs.length, onClose, onNav]);
  if (!im) return null;
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.92)", display: "flex", flexDirection: "column" }}>
      <div className="flex items-center justify-between p-3 text-stone-300 text-xs" onClick={(e) => e.stopPropagation()}>
        <span>{i + 1} / {imgs.length} · {im.stage ?? "مسجّلة"} · {im.scope === "overall" ? "إجمالي" : "للقطعة"}</span>
        <div className="flex items-center gap-2">
          <button onClick={() => setZoom((z) => Math.max(1, z - 0.25))} className="px-2 py-1 border border-stone-700 rounded">−</button>
          <span dir="ltr">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom((z) => Math.min(4, z + 0.25))} className="px-2 py-1 border border-stone-700 rounded">＋</button>
          <button onClick={() => { const el = wrapRef.current; if (el?.requestFullscreen) void el.requestFullscreen().catch(() => {}); }} className="px-2 py-1 border border-stone-700 rounded">⛶ ملء الشاشة</button>
          <button onClick={onClose} className="px-2 py-1 border border-stone-700 rounded">✕</button>
        </div>
      </div>
      <div ref={wrapRef} className="flex-1 flex items-center justify-center overflow-auto relative" onClick={(e) => e.stopPropagation()} style={{ background: "#000" }}>
        {i < imgs.length - 1 && <button onClick={() => onNav(i + 1)} className="absolute right-3 top-1/2 -translate-y-1/2 text-white text-3xl px-3 py-2 bg-black/40 rounded">‹</button>}
        {i > 0 && <button onClick={() => onNav(i - 1)} className="absolute left-3 top-1/2 -translate-y-1/2 text-white text-3xl px-3 py-2 bg-black/40 rounded">›</button>}
        {u ? <img src={u} alt="" style={{ transform: `scale(${zoom})`, transformOrigin: "center", maxHeight: "80vh", maxWidth: "94vw", objectFit: "contain", transition: "transform 0.12s" }} /> : <span className="text-stone-500">…</span>}
      </div>
      <div className="p-3 text-[11px] text-stone-400 flex flex-wrap gap-x-4 gap-y-1" onClick={(e) => e.stopPropagation()}>
        {im.uploaded_by_name && <span>الرافع: {im.uploaded_by_name}{im.uploaded_by_role ? ` (${roleAr(im.uploaded_by_role)})` : ""}</span>}
        {im.uploaded_at && <span dir="ltr">{new Date(im.uploaded_at).toLocaleString("en-GB")}</span>}
        {im.mime && <span dir="ltr">{im.mime}</span>}
        {im.size != null && <span dir="ltr">{fmtSize(im.size)}</span>}
        {(im.note || im.description) && <span>الوصف: {im.note || im.description}</span>}
      </div>
    </div>
  );
}
