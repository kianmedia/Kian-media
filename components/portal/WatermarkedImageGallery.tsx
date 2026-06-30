"use client";
// ════════════════════════════════════════════════════════════════════════
// Client proofing gallery of WATERMARKED image previews for a project. Streams
// each preview as an authenticated blob (the original Drive URL never appears in
// the DOM/network). UI deterrents: no download, right-click disabled, draggable
// off, user-select off — the real protection is the baked-in "Kian Media" mark.
// Mount: <WatermarkedImageGallery projectId={project.id} /> in the client project view.
// ════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { listProjectPreviewAssets, fetchPreviewObjectUrl, type PreviewAsset } from "@/lib/portal/previews";

export default function WatermarkedImageGallery({ projectId }: { projectId: string }) {
  const { t } = useI18n();
  const [assets, setAssets] = useState<PreviewAsset[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [lightbox, setLightbox] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const created: string[] = [];
    (async () => {
      const r = await listProjectPreviewAssets(projectId);
      if (!alive) return;
      if (!r.ok) { setPhase("error"); return; }
      const imgs = r.data.filter((a) => a.asset_type === "image");
      setAssets(imgs);
      setPhase("ready");
      for (const a of imgs) {
        const u = await fetchPreviewObjectUrl(a.id);
        if (!alive) { if (u) URL.revokeObjectURL(u); continue; }
        if (u) { created.push(u); setUrls((p) => ({ ...p, [a.id]: u })); }
      }
    })();
    return () => { alive = false; created.forEach((u) => URL.revokeObjectURL(u)); };
  }, [projectId]);

  const block = (e: React.SyntheticEvent) => e.preventDefault();
  if (phase === "loading") return <p className="text-white/45" style={{ fontSize: 13 }}>{t({ ar: "جارٍ تحميل المعاينات...", en: "Loading previews..." })}</p>;
  if (phase === "error" || assets.length === 0) return null; // nothing to show

  const imgStyle: React.CSSProperties = {
    width: "100%", height: "100%", objectFit: "cover", display: "block",
    userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none", pointerEvents: "none",
  };

  return (
    <div style={{ marginTop: 24 }} onContextMenu={block}>
      <div className="eyebrow mb-3">{t({ ar: "معرض المعاينة", en: "Proofing Gallery" })}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: 10 }}>
        {assets.map((a) => (
          <figure
            key={a.id}
            onClick={() => urls[a.id] && setLightbox(urls[a.id])}
            style={{ margin: 0, aspectRatio: "1 / 1", borderRadius: 8, overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)", cursor: urls[a.id] ? "zoom-in" : "default", userSelect: "none" }}
          >
            {urls[a.id]
              ? <img src={urls[a.id]} alt="" draggable={false} onDragStart={block} onContextMenu={block} style={imgStyle} />
              : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.3)", fontSize: 11 }}>•••</div>}
          </figure>
        ))}
      </div>
      <p className="f-sans" style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 10, lineHeight: 1.7 }}>
        {t({ ar: "هذه صور معاينة بعلامة مائية للمراجعة والاعتماد فقط. النسخ النهائية تُسلَّم بعد الاعتماد.", en: "Watermarked preview images for review/approval only. Final files are delivered after approval." })}
      </p>

      {lightbox && (
        <div onClick={() => setLightbox(null)} onContextMenu={block}
          style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,0.9)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, cursor: "zoom-out", userSelect: "none" }}>
          <img src={lightbox} alt="" draggable={false} onDragStart={block} onContextMenu={block}
            style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none" }} />
        </div>
      )}
    </div>
  );
}
