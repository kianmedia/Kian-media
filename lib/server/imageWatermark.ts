// ════════════════════════════════════════════════════════════════════════
// Kian — SERVER-ONLY watermarked image preview generation.
//
// Bakes a repeated diagonal "Kian Media" watermark into a downscaled JPEG and
// strips EXIF (re-encode drops metadata). Uses `sharp` if available. `sharp` is
// loaded via a non-analyzable require so a missing optional dependency NEVER
// breaks the Next.js build — the admin route reports a clear setup warning and
// the asset is marked 'failed' instead.  Install: npm i sharp
// ════════════════════════════════════════════════════════════════════════
if (typeof window !== "undefined") throw new Error("lib/server/imageWatermark is server-only");

/* eslint-disable @typescript-eslint/no-explicit-any */
function loadSharp(): any {
  // eslint-disable-next-line no-eval
  const req = eval("require") as NodeRequire;
  return req("sharp");
}

/** True when the image processor (sharp) is installed and loadable. */
export function imageProcessorAvailable(): boolean {
  try { loadSharp(); return true; } catch { return false; }
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function watermarkTile(text: string): Buffer {
  const t = xmlEscape(text);
  // A 380×260 tile with a rotated, semi-transparent label; tiled across the image.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="380" height="260">
  <g transform="rotate(-30 190 130)" font-family="Helvetica, Arial, sans-serif" font-weight="700">
    <text x="0" y="120" font-size="28" fill="rgba(255,255,255,0.32)">${t}</text>
    <text x="0" y="122" font-size="28" fill="rgba(0,0,0,0.10)">${t}</text>
  </g>
</svg>`;
  return Buffer.from(svg);
}

export interface WatermarkOptions { maxWidth?: number; label?: string; reference?: string | null; }

/** Produce a downscaled, EXIF-stripped, watermarked JPEG. Throws if sharp missing. */
export async function makeWatermarkedImage(input: Buffer, opts: WatermarkOptions = {}): Promise<{ bytes: Buffer; mime: string }> {
  const sharp = loadSharp();
  const maxWidth = opts.maxWidth ?? Number(process.env.PREVIEW_IMAGE_MAX_WIDTH || 1600);
  const label = opts.label || "Kian Media";
  const text = opts.reference ? `${label} · ${opts.reference}` : label;

  const base = sharp(input, { failOn: "none" }).rotate(); // auto-orient via EXIF, then re-encode drops metadata
  const meta = await base.metadata();
  const targetW = Math.min(maxWidth, meta.width || maxWidth);

  const bytes = await base
    .resize({ width: targetW, withoutEnlargement: true })
    .composite([{ input: watermarkTile(text), tile: true, blend: "over" }])
    .jpeg({ quality: 78, mozjpeg: true })
    .toBuffer();
  return { bytes, mime: "image/jpeg" };
}
