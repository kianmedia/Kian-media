"use client";
// ════════════════════════════════════════════════════════════════════════
// Shared in-portal preview window for review deliverables. Embeds YouTube /
// Vimeo (iframe), direct image (<img>), or direct video (<video controls,
// controlsList=nodownload>); falls back to a rel-safe external open link when
// the URL isn't embeddable. A semi-transparent Kian watermark overlay sits
// over the media (pointer-events:none so it never blocks controls).
//
// NOTE (honest): this overlay deters casual screenshots/saving only — it
// cannot prevent screen recording or technical capture. No download control.
// ════════════════════════════════════════════════════════════════════════
import { useI18n } from "@/lib/i18n";

type Kind = "youtube" | "vimeo" | "image" | "video" | "external";

function classify(raw: string | null): { kind: Kind; src: string | null } {
  if (!raw) return { kind: "external", src: null };
  try {
    const u = new URL(raw);
    const host = u.hostname.replace(/^www\./, "");
    const path = u.pathname.toLowerCase();
    if (host === "youtube.com" && u.searchParams.get("v")) return { kind: "youtube", src: `https://www.youtube.com/embed/${u.searchParams.get("v")}?rel=0&modestbranding=1` };
    if (host === "youtube.com" && path.startsWith("/embed/")) return { kind: "youtube", src: raw };
    if (host === "youtu.be") return { kind: "youtube", src: `https://www.youtube.com/embed/${u.pathname.slice(1)}?rel=0&modestbranding=1` };
    if (host === "vimeo.com") { const id = u.pathname.split("/").filter(Boolean)[0]; if (/^\d+$/.test(id)) return { kind: "vimeo", src: `https://player.vimeo.com/video/${id}` }; }
    if (host === "player.vimeo.com") return { kind: "vimeo", src: raw };
    if (/\.(jpe?g|png|gif|webp|avif)$/.test(path)) return { kind: "image", src: raw };
    if (/\.(mp4|webm|mov|ogg)$/.test(path)) return { kind: "video", src: raw };
    return { kind: "external", src: raw };
  } catch { return { kind: "external", src: raw }; }
}

function Watermark() {
  return (
    <div aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 5, overflow: "hidden" }}>
      {/* corner logo + label */}
      <div style={{ position: "absolute", top: "10px", insetInlineStart: "12px", display: "flex", alignItems: "center", gap: "8px", opacity: 0.5 }}>
        <img src="/logo.png" alt="" style={{ width: "26px", height: "26px", objectFit: "contain" }} />
        <span className="f-sans" style={{ fontSize: "10px", letterSpacing: "2px", color: "rgba(255,255,255,0.75)", textShadow: "0 1px 3px rgba(0,0,0,0.6)" }}>KIAN MEDIA PRODUCTION</span>
      </div>
      {/* center diagonal watermark (kept above the bottom control bar) */}
      <div style={{ position: "absolute", top: "42%", left: 0, right: 0, textAlign: "center", transform: "rotate(-18deg)", opacity: 0.16 }}>
        <div className="f-display" style={{ fontSize: "clamp(22px,5vw,46px)", letterSpacing: "6px", color: "#fff", lineHeight: 1.1 }}>KIAN MEDIA</div>
        <div className="f-sans" style={{ fontSize: "clamp(13px,3vw,24px)", letterSpacing: "4px", color: "#fff" }}>كيان · نسخة معاينة</div>
      </div>
    </div>
  );
}

export default function PreviewModal({ title, url, onClose }: { title: string; url: string | null; onClose: () => void }) {
  const { t } = useI18n();
  const { kind, src } = classify(url);

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 130, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: "1000px" }}>
        <div className="flex items-center justify-between gap-3 mb-3">
          <h3 className="text-white" style={{ fontSize: "16px", fontWeight: 700 }}>{title}</h3>
          <button onClick={onClose} className="f-sans" style={{ background: "none", border: "none", color: "rgba(255,255,255,0.7)", fontSize: "12px", letterSpacing: "2px", cursor: "pointer" }}>✕ {t({ ar: "إغلاق", en: "Close" })}</button>
        </div>

        <div style={{ position: "relative", background: "#000", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "4px", overflow: "hidden" }}>
          {kind === "youtube" || kind === "vimeo" ? (
            <div style={{ position: "relative", paddingBottom: "56.25%", height: 0 }}>
              <iframe src={src!} title={title} allow="encrypted-media; picture-in-picture; fullscreen" allowFullScreen style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }} />
              <Watermark />
            </div>
          ) : kind === "image" ? (
            <div style={{ position: "relative" }}>
              <img src={src!} alt={title} onContextMenu={(e) => e.preventDefault()} style={{ display: "block", width: "100%", maxHeight: "75vh", objectFit: "contain", userSelect: "none" }} draggable={false} />
              <Watermark />
            </div>
          ) : kind === "video" ? (
            <div style={{ position: "relative" }}>
              <video src={src!} controls controlsList="nodownload noplaybackrate" disablePictureInPicture onContextMenu={(e) => e.preventDefault()} style={{ display: "block", width: "100%", maxHeight: "75vh", background: "#000" }} />
              <Watermark />
            </div>
          ) : (
            <div className="text-center" style={{ position: "relative", padding: "50px 24px" }}>
              <p className="text-white/60" style={{ fontSize: "14px", lineHeight: 1.7, marginBottom: "18px" }}>
                {t({ ar: "هذه المعاينة لا يمكن عرضها داخل البوابة مباشرة.", en: "This preview can't be embedded inside the portal." })}
              </p>
              {url ? (
                <a href={url} target="_blank" rel="noopener noreferrer" className="btn-ghost" style={{ justifyContent: "center" }}>
                  <span>{t({ ar: "فتح المعاينة في نافذة جديدة", en: "Open preview in a new tab" })}</span>
                </a>
              ) : (
                <p className="text-white/40" style={{ fontSize: "13px" }}>{t({ ar: "لا يوجد رابط معاينة.", en: "No preview URL." })}</p>
              )}
              <Watermark />
            </div>
          )}
        </div>

        <p className="f-sans text-center" style={{ fontSize: "11px", color: "rgba(255,210,138,0.8)", lineHeight: 1.6, marginTop: "12px" }}>
          {t({ ar: "نسخة معاينة للمراجعة فقط — جميع الحقوق محفوظة لكيان ميديا.", en: "Preview copy for review only — © Kian Media." })}
        </p>
      </div>
    </div>
  );
}
