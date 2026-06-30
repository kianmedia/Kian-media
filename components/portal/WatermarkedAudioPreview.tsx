"use client";
// ════════════════════════════════════════════════════════════════════════
// Client audio preview player. Plays ONLY the generated watermarked preview
// (streamed as an authenticated blob; the original is never served). V1 audio
// watermarking needs an external ffmpeg worker — until that runs, no 'ready'
// audio asset exists and this renders nothing (the admin sees a setup warning at
// import time). Mount: <WatermarkedAudioPreview projectId={project.id} />.
// ════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { listProjectPreviewAssets, fetchPreviewObjectUrl, type PreviewAsset } from "@/lib/portal/previews";

export default function WatermarkedAudioPreview({ projectId }: { projectId: string }) {
  const { t } = useI18n();
  const [assets, setAssets] = useState<PreviewAsset[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<"loading" | "ready">("loading");

  useEffect(() => {
    let alive = true;
    const created: string[] = [];
    (async () => {
      const r = await listProjectPreviewAssets(projectId);
      if (!alive) return;
      const auds = r.ok ? r.data.filter((a) => a.asset_type === "audio") : [];
      setAssets(auds);
      setPhase("ready");
      for (const a of auds) {
        const u = await fetchPreviewObjectUrl(a.id);
        if (!alive) { if (u) URL.revokeObjectURL(u); continue; }
        if (u) { created.push(u); setUrls((p) => ({ ...p, [a.id]: u })); }
      }
    })();
    return () => { alive = false; created.forEach((u) => URL.revokeObjectURL(u)); };
  }, [projectId]);

  if (phase === "loading" || assets.length === 0) return null; // nothing ready to play

  return (
    <div style={{ marginTop: 24 }}>
      <div className="eyebrow mb-3">{t({ ar: "معاينة صوتية", en: "Audio Preview" })}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {assets.map((a) => (
          <div key={a.id} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: "10px 12px" }}>
            <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 12.5, marginBottom: 6 }}>{a.original_file_name || t({ ar: "مقطع صوتي", en: "Audio clip" })}</div>
            {urls[a.id]
              ? <audio src={urls[a.id]} controls controlsList="nodownload noplaybackrate" onContextMenu={(e) => e.preventDefault()} style={{ width: "100%" }} />
              : <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 11 }}>•••</div>}
          </div>
        ))}
      </div>
      <p className="f-sans" style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 8, lineHeight: 1.7 }}>
        {t({ ar: "معاينة صوتية بعلامة «Kian Media» مسموعة للمراجعة فقط.", en: "Watermarked audio preview (audible “Kian Media” mark) — for review only." })}
      </p>
    </div>
  );
}
