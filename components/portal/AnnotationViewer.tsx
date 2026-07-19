"use client";
// ════════════════════════════════════════════════════════════════════════
// §3 Inline annotation viewer — version-scoped preview + anchored comments.
// Renders one deliverable VERSION's protected preview (watermarked, no download,
// no raw-URL leak for Office) and its comments anchored to the exact version.
//   Video : capture current playback time; click a comment → seek to it.
//   Image : click to place a numbered marker (normalized x/y); markers reposition
//           responsively; click a comment → highlight its marker.
//   PDF   : page number (+ optional point); click a comment → jump to page.
//   Office: safe notice only, never the raw URL.
// Every comment carries status/resolution + Kian response (read-only for client).
// ════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { listCommentsForVersion, addComment, resolveNote, secondsToTimecode, type VersionSummary } from "@/lib/portal/deliverables";
import type { ClientComment } from "@/lib/portal/types";
import PreviewWatermark, { type WatermarkStamp } from "@/components/portal/PreviewWatermark";

type Kind = "youtube" | "vimeo" | "image" | "video" | "pdf" | "office" | "external" | "invalid";
function classify(raw: string | null, hint?: string): { kind: Kind; src: string | null } {
  if (!raw || !raw.trim()) return { kind: hint === "office" ? "office" : "invalid", src: null };
  try {
    const u = new URL(raw); const host = u.hostname.replace(/^www\./, ""); const path = u.pathname.toLowerCase();
    if (u.protocol !== "http:" && u.protocol !== "https:") return { kind: "invalid", src: null };
    if (host === "youtube.com" && u.searchParams.get("v")) return { kind: "youtube", src: `https://www.youtube.com/embed/${u.searchParams.get("v")}?rel=0&modestbranding=1` };
    if (host === "youtu.be") return { kind: "youtube", src: `https://www.youtube.com/embed/${u.pathname.slice(1)}?rel=0` };
    if (host === "vimeo.com") { const id = u.pathname.split("/").filter(Boolean)[0]; if (/^\d+$/.test(id)) return { kind: "vimeo", src: `https://player.vimeo.com/video/${id}` }; }
    if (host === "player.vimeo.com") return { kind: "vimeo", src: raw };
    if (/\.(jpe?g|png|gif|webp|avif)$/.test(path) || hint === "image") return { kind: "image", src: raw };
    if (/\.(mp4|webm|mov|ogg)$/.test(path) || hint === "video") return { kind: "video", src: raw };
    if (/\.pdf$/.test(path) || hint === "pdf") return { kind: "pdf", src: `${raw}${raw.includes("#") ? "&" : "#"}toolbar=0&navpanes=0` };
    if (/\.(docx?|xlsx?|pptx?)$/.test(path) || hint === "office") return { kind: "office", src: null };
    return { kind: "external", src: raw };
  } catch { return { kind: "invalid", src: null }; }
}

export default function AnnotationViewer({
  deliverableId, version, deliverableType, canComment, canResolve = false, onClose, stamp,
}: {
  deliverableId: string; version: VersionSummary; deliverableType: string; canComment: boolean; canResolve?: boolean; onClose: () => void;
  stamp?: WatermarkStamp;
}) {
  const { t } = useI18n();
  // P0-1: full-coverage repeated diagonal watermark, stamped with client/project
  // identity where the caller supplies it (makes a captured frame traceable).
  const wm = <PreviewWatermark {...(stamp ?? {})} />;
  const raw = version.vimeo_review_url || version.preview_url;
  const { kind, src } = classify(raw, version.preview_type);
  const [comments, setComments] = useState<ClientComment[]>([]);
  const [body, setBody] = useState("");
  const [tc, setTc] = useState<number | null>(null);       // captured video time (seconds)
  const [page, setPage] = useState<number | null>(null);   // pdf page
  const [pin, setPin] = useState<{ x: number; y: number } | null>(null); // image normalized point
  const [busy, setBusy] = useState(false);
  const [activeMarker, setActiveMarker] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const imgWrapRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => { const r = await listCommentsForVersion(version.id); if (r.ok) setComments(r.data); }, [version.id]);
  useEffect(() => { void load(); }, [load]);

  // Video: capture the current playback time for the next comment.
  function captureTime() { const v = videoRef.current; if (v) setTc(Math.floor(v.currentTime)); }
  // Click a comment → seek video / (image marker highlight) / (pdf note).
  function goToComment(c: ClientComment) {
    if (c.timecode_seconds != null && videoRef.current) { videoRef.current.currentTime = c.timecode_seconds; void videoRef.current.play?.().catch(() => {}); }
    if (c.pos_x != null && c.pos_y != null) { setActiveMarker(c.id); window.setTimeout(() => setActiveMarker(null), 2500); }
  }
  // Image: click to place a normalized pin.
  function onImageClick(e: React.MouseEvent) {
    if (!canComment) return;
    const el = imgWrapRef.current; if (!el) return;
    const r = el.getBoundingClientRect();
    setPin({ x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) });
  }
  async function add() {
    if (busy || !body.trim()) return; setBusy(true);
    const r = await addComment(deliverableId, body.trim(), {
      versionId: version.id,
      timecodeSeconds: tc ?? undefined,
      pageNumber: page ?? undefined,
      posX: pin?.x, posY: pin?.y,
      kind: (tc != null || page != null || pin) ? "annotation" : "comment",
    });
    setBusy(false);
    if (!r.ok) return;
    setBody(""); setTc(null); setPage(null); setPin(null); void load();
  }
  const imgMarkers = comments.filter((c) => c.pos_x != null && c.pos_y != null);
  const statusLabel = (s?: string) => s === "resolved" ? t({ ar: "محلول", en: "Resolved" }) : s === "in_progress" ? t({ ar: "قيد المعالجة", en: "In progress" }) : t({ ar: "مفتوح", en: "Open" });

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 140, background: "rgba(0,0,0,0.88)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "16px", overflowY: "auto" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: "1100px", display: "grid", gridTemplateColumns: "minmax(0,1fr) 320px", gap: "14px" }} className="annot-grid">
        {/* Preview */}
        <div>
          <div className="flex items-center justify-between gap-2 mb-2">
            <h3 className="text-white" style={{ fontSize: "15px", fontWeight: 700 }}>{version.label} {version.is_final ? `· ${t({ ar: "نهائية", en: "Final" })}` : ""}</h3>
            <button onClick={onClose} className="f-sans" style={{ background: "none", border: "none", color: "rgba(255,255,255,0.7)", fontSize: "12px", cursor: "pointer" }}>✕ {t({ ar: "إغلاق", en: "Close" })}</button>
          </div>
          <div style={{ position: "relative", background: "#000", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "4px", overflow: "hidden" }}>
            {kind === "youtube" || kind === "vimeo" ? (
              <div style={{ position: "relative", paddingBottom: "56.25%", height: 0 }}>
                <iframe src={src!} title={version.label} allow="encrypted-media; picture-in-picture; fullscreen" allowFullScreen style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }} />
                {wm}
              </div>
            ) : kind === "video" ? (
              <div style={{ position: "relative" }}>
                <video ref={videoRef} src={src!} controls controlsList="nodownload noplaybackrate" disablePictureInPicture onContextMenu={(e) => e.preventDefault()} style={{ display: "block", width: "100%", maxHeight: "70vh", background: "#000" }} />
                {wm}
              </div>
            ) : kind === "image" ? (
              <div ref={imgWrapRef} onClick={onImageClick} style={{ position: "relative", cursor: canComment ? "crosshair" : "default" }}>
                <img src={src!} alt={version.label} onContextMenu={(e) => e.preventDefault()} draggable={false} style={{ display: "block", width: "100%", maxHeight: "70vh", objectFit: "contain", userSelect: "none" }} />
                {imgMarkers.map((c, i) => (
                  <span key={c.id} title={c.body} style={{ position: "absolute", left: `${(c.pos_x ?? 0) * 100}%`, top: `${(c.pos_y ?? 0) * 100}%`, transform: "translate(-50%,-50%)", width: 22, height: 22, borderRadius: "50%", background: activeMarker === c.id ? "#fff" : "#E31E24", color: activeMarker === c.id ? "#E31E24" : "#fff", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", border: "2px solid #fff", zIndex: 6, boxShadow: "0 1px 4px rgba(0,0,0,0.5)" }}>{i + 1}</span>
                ))}
                {pin && <span style={{ position: "absolute", left: `${pin.x * 100}%`, top: `${pin.y * 100}%`, transform: "translate(-50%,-50%)", width: 22, height: 22, borderRadius: "50%", background: "rgba(255,210,138,0.9)", border: "2px dashed #fff", zIndex: 7 }} />}
                {wm}
              </div>
            ) : kind === "pdf" ? (
              <div style={{ position: "relative" }} onContextMenu={(e) => e.preventDefault()}>
                <iframe src={page ? `${src}&page=${page}` : src!} title={version.label} style={{ display: "block", width: "100%", height: "70vh", border: 0, background: "#fff" }} />
                {wm}
              </div>
            ) : kind === "invalid" ? (
              <div className="text-center" style={{ position: "relative", padding: "48px 24px" }}>
                <div style={{ fontSize: 30, marginBottom: 8 }}>⚠️</div>
                <p style={{ fontSize: "14px", fontWeight: 700, color: "#ff8a8e" }}>{t({ ar: "رابط المعاينة غير صالح", en: "Preview link is invalid" })}</p>
                <p className="text-white/55" style={{ fontSize: "12.5px", lineHeight: 1.7, marginTop: 6 }}>{t({ ar: "لا يوجد رابط معاينة صالح لهذه النسخة. يرجى من فريق كيان إضافة رابط معاينة صحيح.", en: "This version has no valid preview link. Kian staff should attach a correct preview URL." })}</p>
                {wm}
              </div>
            ) : (
              <div className="text-center" style={{ position: "relative", padding: "48px 24px" }}>
                <div style={{ fontSize: 30, marginBottom: 8 }}>📄</div>
                <p style={{ fontSize: "14px", fontWeight: 700, color: "rgba(255,210,138,0.95)" }}>{t({ ar: "هذا الملف يحتاج معاينة مُولّدة", en: "This file requires a generated preview" })}</p>
                <p className="text-white/55" style={{ fontSize: "12.5px", lineHeight: 1.7, marginTop: 6 }}>{t({ ar: "ملفات Office/الملفات غير القابلة للعرض المباشر تُعرض عبر نسخة PDF محمية — ولا يُكشف الرابط الأصلي. يمكن للفريق رفع نسخة معاينة (PDF/صورة/فيديو).", en: "Office and non-embeddable files display via a protected PDF derivative — the original URL is never exposed. Staff can upload a preview (PDF/image/video)." })}</p>
                {wm}
              </div>
            )}
          </div>
          {kind === "video" && canComment && (
            <button onClick={captureTime} className="f-sans" style={{ marginTop: "8px", fontSize: "11px", color: "rgba(255,255,255,0.85)", background: "none", border: "1px solid rgba(255,255,255,0.2)", borderRadius: "3px", padding: "6px 11px", cursor: "pointer" }}>
              ⏱ {t({ ar: "التقاط الوقت الحالي للتعليق", en: "Capture current time" })}{tc != null ? ` (${secondsToTimecode(tc)})` : ""}
            </button>
          )}
        </div>

        {/* Comments rail */}
        <div style={{ background: "rgba(10,10,10,0.7)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "4px", padding: "12px", maxHeight: "82vh", overflowY: "auto" }}>
          <div className="f-sans" style={{ fontSize: "10px", letterSpacing: "0.5px", textTransform: "uppercase", color: "rgba(255,255,255,0.5)", marginBottom: "8px" }}>{t({ ar: "التعليقات على", en: "Comments on" })} {version.label}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
            {comments.map((c, i) => (
              <div key={c.id} role="button" tabIndex={0} onClick={() => goToComment(c)} className="f-sans" style={{ textAlign: "start", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "3px", padding: "8px 10px", cursor: (c.timecode_seconds != null || c.pos_x != null) ? "pointer" : "default", color: "rgba(255,255,255,0.85)", fontSize: "12.5px", lineHeight: 1.6 }}>
                {c.pos_x != null && <span style={{ color: "#E31E24", fontWeight: 700, marginInlineEnd: 6 }}>#{imgMarkers.findIndex((m) => m.id === c.id) + 1}</span>}
                {c.timecode_seconds != null && <span style={{ color: "#E31E24", marginInlineEnd: 6 }} dir="ltr">[{secondsToTimecode(c.timecode_seconds)}]</span>}
                {c.page_number != null && <span style={{ color: "#E31E24", marginInlineEnd: 6 }} dir="ltr">[{t({ ar: "ص", en: "p." })}{c.page_number}]</span>}
                <span dir="auto">{c.body}</span>
                <span style={{ display: "block", fontSize: "9px", color: c.status === "resolved" ? "#7CFC9A" : "rgba(255,255,255,0.4)", marginTop: 3 }}>
                  {c.author_role === "admin" ? t({ ar: "كيان", en: "Kian" }) : t({ ar: "العميل", en: "Client" })} · {statusLabel(c.status)}
                </span>
                {c.resolution_note?.trim() && <span style={{ display: "block", marginTop: 4, borderInlineStart: "2px solid rgba(124,252,154,0.4)", paddingInlineStart: 7, fontSize: 11.5, color: "rgba(124,252,154,0.9)" }} dir="auto">{c.resolution_note}</span>}
                {canResolve && c.status !== "resolved" && <ResolveInline comment={c} onDone={load} t={t} />}
              </div>
            ))}
            {comments.length === 0 && <p className="f-sans" style={{ fontSize: "11.5px", color: "rgba(255,255,255,0.35)" }}>{t({ ar: "لا تعليقات على هذه النسخة.", en: "No comments on this version." })}</p>}
          </div>
          {canComment && (
            <div style={{ marginTop: "10px", display: "flex", flexDirection: "column", gap: "6px" }}>
              <div className="f-sans" style={{ fontSize: "10px", color: "rgba(255,255,255,0.4)" }}>
                {tc != null && <span dir="ltr">⏱ {secondsToTimecode(tc)} </span>}
                {pin && <span>📍 {t({ ar: "نقطة على الصورة", en: "image point" })} </span>}
                {kind === "pdf" && <input type="number" min={1} value={page ?? ""} onChange={(e) => setPage(e.target.value ? Number(e.target.value) : null)} placeholder={t({ ar: "صفحة", en: "page" })} style={{ width: 60, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 3, padding: "4px 6px", color: "#fff", fontSize: 11 }} dir="ltr" />}
                {(tc != null || pin || page != null) && <button onClick={() => { setTc(null); setPin(null); setPage(null); }} style={{ background: "none", border: "none", color: "rgba(255,138,142,0.9)", cursor: "pointer", fontSize: 10 }}>{t({ ar: "مسح الموضع", en: "clear anchor" })}</button>}
              </div>
              <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} maxLength={4000} placeholder={t({ ar: kind === "image" ? "انقر على الصورة لتحديد نقطة ثم اكتب…" : "أضف تعليقًا…", en: kind === "image" ? "Click the image to place a point, then type…" : "Add a comment…" })} style={{ width: "100%", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "3px", padding: "8px 10px", color: "#fff", fontSize: "12.5px", outline: "none", resize: "vertical", colorScheme: "dark", fontFamily: "var(--sans)" }} />
              <button onClick={add} disabled={busy || !body.trim()} className="btn-red" style={{ justifyContent: "center", opacity: busy || !body.trim() ? 0.5 : 1 }}><span>{busy ? "…" : t({ ar: "إرسال التعليق", en: "Send comment" })}</span></button>
            </div>
          )}
        </div>
      </div>
      <style>{`@media (max-width: 720px){ .annot-grid { grid-template-columns: 1fr !important; } }`}</style>
    </div>
  );
}

// Staff inline resolve/respond on an annotation (at the exact mark).
function ResolveInline({ comment, onDone, t }: { comment: ClientComment; onDone: () => void; t: (m: { ar: string; en: string }) => string }) {
  const [open, setOpen] = useState(false);
  const [resp, setResp] = useState("");
  const [busy, setBusy] = useState(false);
  async function go(status: "in_progress" | "resolved") {
    setBusy(true);
    const r = await resolveNote("comment", comment.id, status, resp.trim() || undefined);
    setBusy(false);
    if (r.ok) { setOpen(false); setResp(""); onDone(); }
  }
  return (
    <span onClick={(e) => e.stopPropagation()} style={{ display: "block", marginTop: 6 }}>
      {open ? (
        <span style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <textarea value={resp} onChange={(e) => setResp(e.target.value)} rows={2} placeholder={t({ ar: "ردّ كيان…", en: "Kian response…" })} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 3, padding: "6px 8px", color: "#fff", fontSize: 11.5, outline: "none", resize: "vertical", colorScheme: "dark", fontFamily: "var(--sans)" }} />
          <span style={{ display: "flex", gap: 6 }}>
            <button onClick={() => go("in_progress")} disabled={busy} className="f-sans" style={{ fontSize: 10.5, color: "rgba(255,210,138,0.95)", background: "none", border: "1px solid rgba(255,210,138,0.35)", borderRadius: 3, padding: "5px 9px", cursor: "pointer" }}>{t({ ar: "قيد المعالجة", en: "In progress" })}</button>
            <button onClick={() => go("resolved")} disabled={busy} className="f-sans" style={{ fontSize: 10.5, color: "#7CFC9A", background: "none", border: "1px solid rgba(124,252,154,0.35)", borderRadius: 3, padding: "5px 9px", cursor: "pointer" }}>{busy ? "…" : t({ ar: "حلّ + ردّ", en: "Resolve + respond" })}</button>
          </span>
        </span>
      ) : (
        <button onClick={() => setOpen(true)} className="f-sans" style={{ fontSize: 10.5, color: "rgba(255,255,255,0.55)", background: "none", border: "none", cursor: "pointer", padding: 0 }}>↳ {t({ ar: "الردّ/الحلّ", en: "Respond / resolve" })}</button>
      )}
    </span>
  );
}
