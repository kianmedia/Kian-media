"use client";
// ════════════════════════════════════════════════════════════════════════
// P0-1 — Shared preview watermark. A LARGE, REPEATED, DIAGONAL watermark tiled
// across the ENTIRE preview surface (not a single corner/center). Carries the
// required marks — "نسخة معاينة", "PREVIEW COPY", "KIAN MEDIA" — plus optional
// client/project/email/date stamps interleaved into the SAME tile so a captured
// frame is traceable to the reviewing client. pointer-events:none so it never
// blocks player controls; sits above the media (zIndex 5).
//
// HONEST LIMITATION (do not claim DRM): a portal overlay deters casual
// screenshots/re-sharing only. It cannot stop screen recording, external
// YouTube/Vimeo access, or capture below the browser. For real control the
// deliverable must be served as a private, short-lived signed derivative — the
// overlay is defence-in-depth, not a guarantee. In native/iframe fullscreen the
// overlay lives outside the media element and may not render (documented).
// ════════════════════════════════════════════════════════════════════════

export interface WatermarkStamp {
  clientName?: string | null;
  projectName?: string | null;
  clientEmail?: string | null;
  /** Show a live date/time line (default true). */
  showDateTime?: boolean;
  /** Base tile opacity 0..1 (default 0.12 — visible without blocking review). */
  opacity?: number;
}

// Escape text for safe embedding inside an SVG <text> element.
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildTileUrl(lines: string[], opacity: number): string {
  const W = 360;
  const lineH = 26;
  const H = Math.max(150, 60 + lines.length * lineH);
  const cx = W / 2;
  const startY = H / 2 - ((lines.length - 1) * lineH) / 2;
  const texts = lines
    .map((ln, i) => {
      // First line (KIAN MEDIA) is the boldest/largest anchor of the tile.
      const isHead = i === 0;
      const fs = isHead ? 22 : 14;
      const weight = isHead ? "700" : "500";
      const ls = isHead ? "3" : "1.5";
      const y = startY + i * lineH;
      return `<text x='${cx}' y='${y}' font-size='${fs}' font-weight='${weight}' letter-spacing='${ls}'>${esc(ln)}</text>`;
    })
    .join("");
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${W}' height='${H}'>` +
    `<g transform='rotate(-24 ${cx} ${H / 2})' fill='#ffffff' fill-opacity='${opacity}' ` +
    `font-family='Arial, Helvetica, sans-serif' text-anchor='middle'>${texts}</g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

export default function PreviewWatermark(props: WatermarkStamp = {}) {
  const { clientName, projectName, clientEmail, showDateTime = true, opacity = 0.12 } = props;
  // Core required marks, then any identity stamps that were supplied.
  const lines = ["KIAN MEDIA", "نسخة معاينة · PREVIEW COPY"];
  if (clientName) lines.push(clientName);
  if (projectName) lines.push(projectName);
  if (clientEmail) lines.push(clientEmail);
  if (showDateTime) {
    // Rendered in the browser — Date is available here (unlike workflow scripts).
    lines.push(new Date().toLocaleString("en-GB"));
  }
  const tile = buildTileUrl(lines, opacity);
  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        zIndex: 5,
        overflow: "hidden",
        backgroundImage: tile,
        backgroundRepeat: "repeat",
        backgroundPosition: "center",
      }}
    >
      {/* Corner brand lock-up — kept for identity even where the tile is faint. */}
      <div style={{ position: "absolute", top: 10, insetInlineStart: 12, display: "flex", alignItems: "center", gap: 8, opacity: 0.55 }}>
        <img src="/logo.png" alt="" style={{ width: 24, height: 24, objectFit: "contain" }} />
        <span className="f-sans" style={{ fontSize: 10, letterSpacing: 2, color: "rgba(255,255,255,0.8)", textShadow: "0 1px 3px rgba(0,0,0,0.6)" }}>
          KIAN MEDIA · نسخة معاينة
        </span>
      </div>
    </div>
  );
}
