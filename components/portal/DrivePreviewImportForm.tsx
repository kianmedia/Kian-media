"use client";
// ════════════════════════════════════════════════════════════════════════
// Admin form to import a Google Drive image/file/folder link → server generates
// watermarked previews into the private bucket. Shows clear setup warnings when
// Drive/Storage/processor are not configured (never crashes). Mount in the admin
// deliverable/project area: <DrivePreviewImportForm projectId={p.id} deliverableId={d.id} />.
// ════════════════════════════════════════════════════════════════════════
import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { importDrivePreview, type ImportResult } from "@/lib/portal/previews";

export default function DrivePreviewImportForm({ projectId, deliverableId }: { projectId: string; deliverableId?: string }) {
  const { t } = useI18n();
  const [url, setUrl] = useState("");
  const [assetType, setAssetType] = useState<"image" | "audio">("image");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<ImportResult | null>(null);

  async function run() {
    if (!url.trim()) return;
    setBusy(true); setRes(null);
    const r = await importDrivePreview({ projectId, deliverableId, driveUrl: url.trim(), assetType });
    setBusy(false); setRes(r);
    if (r.ok) setUrl("");
  }

  const inp: React.CSSProperties = { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 7, padding: "8px 10px", color: "#fff", fontSize: 13, fontFamily: "inherit" };
  const okCount = res?.created?.filter((c) => c.status === "ready").length ?? 0;

  return (
    <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: 10, padding: 14, marginTop: 14 }}>
      <strong style={{ color: "#fff", fontSize: 13 }}>{t({ ar: "إضافة معاينة من Google Drive", en: "Add Drive preview" })}</strong>
      <p className="f-sans" style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", margin: "4px 0 12px", lineHeight: 1.7 }}>
        {t({ ar: "ألصق رابط ملف أو مجلد Drive. تُنشأ نسخة معاينة بعلامة مائية فقط — لا يُعرض الرابط الأصلي للعميل.", en: "Paste a Drive file or folder link. A watermarked preview is generated — the original link is never shown to the client." })}
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://drive.google.com/…" dir="ltr" style={{ ...inp, flex: 1, minWidth: 220 }} />
        <select value={assetType} onChange={(e) => setAssetType(e.target.value as "image" | "audio")} style={inp}>
          <option value="image">{t({ ar: "صورة / مجلد صور", en: "Image / folder" })}</option>
          <option value="audio">{t({ ar: "صوت", en: "Audio" })}</option>
        </select>
        <button onClick={() => void run()} disabled={busy || !url.trim()} style={{ fontSize: 12.5, fontWeight: 600, padding: "8px 14px", borderRadius: 8, border: "none", cursor: busy ? "wait" : "pointer", background: "#E31E24", color: "#fff", opacity: busy || !url.trim() ? 0.6 : 1 }}>
          {busy ? t({ ar: "جارٍ المعالجة…", en: "Processing…" }) : t({ ar: "إنشاء المعاينة", en: "Generate preview" })}
        </button>
      </div>

      {res && (
        <div style={{ marginTop: 12, fontSize: 12, lineHeight: 1.7 }}>
          {res.ok && <div style={{ color: "#7ee2a8" }}>{t({ ar: `تم إنشاء ${okCount} معاينة ✓`, en: `Generated ${okCount} preview(s) ✓` })}</div>}
          {res.error && <div style={{ color: "#ff9ea1" }}>{t({ ar: "خطأ: ", en: "Error: " })}{res.error}</div>}
          {(res.warnings ?? []).map((w, i) => (
            <div key={i} style={{ color: "#f5d76e", marginTop: 4 }}>⚠ {w}</div>
          ))}
        </div>
      )}
    </div>
  );
}
