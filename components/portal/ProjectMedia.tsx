"use client";
// ════════════════════════════════════════════════════════════════════════
// Project media — mounted in the project detail page.
//  • Admin: upload/import watermarked image & audio previews, see processing
//    status, and manage FINAL delivery (upload clean audio, make available/revoke).
//  • Client: watermarked image gallery + audio preview + download of FINAL assets
//    the admin has made available. Originals/paths/source ids are never exposed.
// ════════════════════════════════════════════════════════════════════════
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import WatermarkedImageGallery from "@/components/portal/WatermarkedImageGallery";
import WatermarkedAudioPreview from "@/components/portal/WatermarkedAudioPreview";
import DrivePreviewImportForm from "@/components/portal/DrivePreviewImportForm";
import {
  uploadMediaFile, adminListPreviewAssets, adminDeletePreviewAsset,
  adminListFinalAssets, adminSetFinalAvailability, adminDeleteFinalAsset,
  listProjectFinalAssets, downloadFinalAsset,
  type AdminPreviewAsset, type AdminFinalAsset, type FinalAssetClient,
} from "@/lib/portal/media";

const STATUS_LABEL: Record<string, { ar: string; en: string; c: string }> = {
  ready:        { ar: "جاهزة",              en: "Ready",        c: "#7ee2a8" },
  processing:   { ar: "قيد المعالجة",       en: "Processing",   c: "#90cdf4" },
  needs_worker: { ar: "بانتظار معالِج الصوت", en: "Needs worker", c: "#f5d76e" },
  failed:       { ar: "فشلت",               en: "Failed",       c: "#ff9ea1" },
};

export default function ProjectMedia({ projectId, deliverableId, isAdmin }: { projectId: string; deliverableId?: string; isAdmin: boolean }) {
  return isAdmin ? <AdminMedia projectId={projectId} deliverableId={deliverableId} /> : <ClientMedia projectId={projectId} />;
}

// ─── Client view ───
function ClientMedia({ projectId }: { projectId: string }) {
  const { t, isAr } = useI18n();
  const [finals, setFinals] = useState<FinalAssetClient[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    listProjectFinalAssets(projectId).then((r) => { if (alive && r.ok) setFinals(r.data); });
    return () => { alive = false; };
  }, [projectId]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <WatermarkedImageGallery projectId={projectId} />
      <WatermarkedAudioPreview projectId={projectId} />
      {finals.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div className="eyebrow mb-3">{t({ ar: "التسليم النهائي", en: "Final Delivery" })}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {finals.map((f) => (
              <div key={f.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, background: "rgba(37,211,102,0.06)", border: "1px solid rgba(37,211,102,0.25)", borderRadius: 8, padding: "10px 12px", flexWrap: "wrap" }}>
                <div style={{ color: "rgba(255,255,255,0.85)", fontSize: 13 }}>{f.original_file_name || t({ ar: "ملف نهائي", en: "Final file" })}{f.delivered_at ? <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 11 }}> · {new Date(f.delivered_at).toLocaleDateString(isAr ? "ar-SA" : "en-GB")}</span> : null}</div>
                <button onClick={async () => { setBusy(f.id); await downloadFinalAsset(f.id, f.original_file_name || "kian-final"); setBusy(null); }} disabled={busy === f.id}
                  style={{ fontSize: 12, fontWeight: 600, padding: "7px 13px", borderRadius: 7, cursor: "pointer", border: "1px solid rgba(37,211,102,0.5)", background: "rgba(37,211,102,0.14)", color: "#7ee2a8" }}>
                  {busy === f.id ? t({ ar: "جارٍ التنزيل…", en: "Downloading…" }) : t({ ar: "تحميل الصوت النهائي", en: "Download final" })}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Admin view ───
function AdminMedia({ projectId, deliverableId }: { projectId: string; deliverableId?: string }) {
  const { t, isAr } = useI18n();
  const [assets, setAssets] = useState<AdminPreviewAsset[]>([]);
  const [finals, setFinals] = useState<AdminFinalAsset[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const imgRef = useRef<HTMLInputElement>(null);
  const audRef = useRef<HTMLInputElement>(null);
  const finRef = useRef<HTMLInputElement>(null);

  async function reload() {
    const [a, f] = await Promise.all([adminListPreviewAssets(projectId), adminListFinalAssets(projectId)]);
    if (a.ok) setAssets(a.data);
    if (f.ok) setFinals(f.data);
  }
  useEffect(() => { void reload(); }, [projectId]);

  async function doUpload(file: File | undefined, kind: "image_preview" | "audio_preview" | "final") {
    if (!file) return;
    // Derive the final asset_type from the file's MIME so images/videos aren't mislabelled as audio.
    const mt = file.type || "";
    const finalType: "audio" | "image" | "video" | "file" =
      mt.startsWith("audio/") ? "audio" : mt.startsWith("image/") ? "image" : mt.startsWith("video/") ? "video" : "file";
    setBusy(true); setMsg(null);
    const r = await uploadMediaFile(file, { projectId, deliverableId, kind, assetType: kind === "final" ? finalType : undefined });
    setBusy(false);
    setMsg((r.warnings && r.warnings[0]) || (r.ok ? t({ ar: "تم الرفع ✓", en: "Uploaded ✓" }) : (r.error || t({ ar: "تعذّر الرفع.", en: "Upload failed." }))));
    void reload();
  }

  const box: React.CSSProperties = { background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: 10, padding: 14 };
  const btn: React.CSSProperties = { fontSize: 12.5, fontWeight: 600, padding: "8px 13px", borderRadius: 8, cursor: busy ? "wait" : "pointer", border: "1px solid rgba(255,255,255,0.16)", background: "transparent", color: "rgba(255,255,255,0.85)", opacity: busy ? 0.6 : 1 };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={box}>
        <strong style={{ color: "#fff", fontSize: 13 }}>{t({ ar: "المعاينات (صور/صوت)", en: "Previews (image/audio)" })}</strong>
        <p className="f-sans" style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", margin: "4px 0 12px", lineHeight: 1.7 }}>
          {t({ ar: "تُنشأ نسخ معاينة بعلامة «Kian Media». لا يُعرض الأصل ولا رابط Drive للعميل أبداً.", en: "Watermarked “Kian Media” previews are generated. The original / Drive link is never shown to the client." })}
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input ref={imgRef} type="file" accept="image/*" hidden onChange={(e) => void doUpload(e.target.files?.[0], "image_preview")} />
          <button style={btn} disabled={busy} onClick={() => imgRef.current?.click()}>{t({ ar: "رفع صور", en: "Upload image" })}</button>
          <input ref={audRef} type="file" accept="audio/*" hidden onChange={(e) => void doUpload(e.target.files?.[0], "audio_preview")} />
          <button style={btn} disabled={busy} onClick={() => audRef.current?.click()}>{t({ ar: "رفع صوت للمعاينة", en: "Upload audio" })}</button>
        </div>
        <div style={{ marginTop: 12 }}>
          <DrivePreviewImportForm projectId={projectId} deliverableId={deliverableId} />
        </div>
        {msg && <div style={{ marginTop: 10, fontSize: 12, color: "#f5d76e", lineHeight: 1.6 }}>{msg}</div>}

        {assets.length > 0 && (
          <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 6 }}>
            <div className="f-sans" style={{ fontSize: 10.5, letterSpacing: "1px", textTransform: "uppercase", color: "rgba(255,255,255,0.4)" }}>{t({ ar: "حالة المعالجة", en: "Processing status" })}</div>
            {assets.map((a) => {
              const s = STATUS_LABEL[a.status] ?? { ar: a.status, en: a.status, c: "rgba(255,255,255,0.6)" };
              return (
                <div key={a.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 12, padding: "7px 10px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 7 }}>
                  <span style={{ color: "rgba(255,255,255,0.8)" }}>{a.asset_type === "image" ? "🖼️" : "🎧"} {a.original_file_name || a.id.slice(0, 8)}</span>
                  <span style={{ display: "inline-flex", gap: 10, alignItems: "center" }}>
                    <span style={{ color: s.c, fontSize: 11 }}>{isAr ? s.ar : s.en}</span>
                    <button onClick={async () => { setBusy(true); await adminDeletePreviewAsset(a.id); setBusy(false); void reload(); }} disabled={busy} style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6, cursor: "pointer", background: "transparent", border: "1px solid rgba(227,30,36,0.4)", color: "#ff9ea1" }}>{t({ ar: "حذف", en: "Delete" })}</button>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={box}>
        <strong style={{ color: "#fff", fontSize: 13 }}>{t({ ar: "التسليم النهائي", en: "Final Delivery" })}</strong>
        <p className="f-sans" style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", margin: "4px 0 12px", lineHeight: 1.7 }}>
          {t({ ar: "ملف نظيف بلا علامة مائية. لا يظهر للعميل إلا بعد «إتاحة التحميل».", en: "Clean, non-watermarked file. The client sees it only after you make it available." })}
        </p>
        <input ref={finRef} type="file" accept="audio/*,image/*,video/*" hidden onChange={(e) => void doUpload(e.target.files?.[0], "final")} />
        <button style={{ ...btn, border: "1px solid rgba(37,211,102,0.4)", color: "#7ee2a8" }} disabled={busy} onClick={() => finRef.current?.click()}>{t({ ar: "رفع الصوت النهائي", en: "Upload final audio" })}</button>

        {finals.length > 0 && (
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
            {finals.map((f) => (
              <div key={f.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 12, padding: "8px 10px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 7, flexWrap: "wrap" }}>
                <span style={{ color: "rgba(255,255,255,0.8)" }}>{f.asset_type === "image" ? "🖼️" : f.asset_type === "video" ? "🎬" : f.asset_type === "audio" ? "🎵" : "📄"} {f.original_file_name || f.id.slice(0, 8)}
                  <span style={{ color: f.is_available_to_client ? "#7ee2a8" : "rgba(255,255,255,0.4)", fontSize: 11, marginInlineStart: 8 }}>
                    {f.is_available_to_client ? t({ ar: "متاح للعميل", en: "Available" }) : t({ ar: "غير متاح", en: "Not available" })}
                  </span>
                </span>
                <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                  <button onClick={async () => { setBusy(true); await adminSetFinalAvailability(f.id, !f.is_available_to_client); setBusy(false); void reload(); }} disabled={busy}
                    style={{ fontSize: 11, padding: "4px 9px", borderRadius: 6, cursor: "pointer", background: "transparent", border: `1px solid ${f.is_available_to_client ? "rgba(255,255,255,0.2)" : "rgba(37,211,102,0.5)"}`, color: f.is_available_to_client ? "rgba(255,255,255,0.7)" : "#7ee2a8" }}>
                    {f.is_available_to_client ? t({ ar: "إلغاء الإتاحة", en: "Revoke" }) : t({ ar: "إتاحة التحميل للعميل", en: "Make available" })}
                  </button>
                  <button onClick={async () => { setBusy(true); await adminDeleteFinalAsset(f.id); setBusy(false); void reload(); }} disabled={busy} style={{ fontSize: 11, padding: "4px 9px", borderRadius: 6, cursor: "pointer", background: "transparent", border: "1px solid rgba(227,30,36,0.4)", color: "#ff9ea1" }}>{t({ ar: "حذف", en: "Delete" })}</button>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
