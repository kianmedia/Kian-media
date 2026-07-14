// ════════════════════════════════════════════════════════════════════════════
// Kian — تطبيع صور أدلة التأجير قبل الرفع (يعالج فشل «تعذر رفع الصورة»).
// السبب الجذري: صور iPhone بصيغة HEIC/HEIF (وكِبَر الحجم) يرفضها bucket rental-evidence
// (allowed_mime_types = jpeg/png/webp) وحد 10MB. الحل: فك الترميز مع اتجاه EXIF ثم
// إعادة الرسم على canvas وتصديرها JPEG مضغوطة باسم UUID — الناتج JPEG دائمًا (مقبول).
// إن تعذّر فك HEIC (Chrome/Android لا يدعمه أصلًا) نعيد خطأً عربيًا واضحًا.
// ════════════════════════════════════════════════════════════════════════════

export interface NormalizedImage { file: File; previewUrl: string }
export type NormalizeResult = { ok: true; file: File; previewUrl: string } | { ok: false; error: string };

const MAX_INPUT_BYTES = 25 * 1024 * 1024; // قبل المعالجة
const DEFAULT_MAX_DIM = 2800;

function fit(w: number, h: number, max: number): { w: number; h: number } {
  if (w <= max && h <= max) return { w, h };
  const r = w > h ? max / w : max / h;
  return { w: Math.max(1, Math.round(w * r)), h: Math.max(1, Math.round(h * r)) };
}

async function decode(file: File): Promise<{ src: CanvasImageSource; w: number; h: number; close?: () => void }> {
  // الأفضل: createImageBitmap مع اتجاه EXIF (يفك HEIC على Safari native).
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
      return { src: bmp, w: bmp.width, h: bmp.height, close: () => bmp.close() };
    } catch { /* fall through */ }
  }
  // احتياطي: <img> + object URL (المتصفحات الحديثة تطبّق اتجاه EXIF على drawImage).
  return await new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ src: img, w: img.naturalWidth, h: img.naturalHeight, close: () => URL.revokeObjectURL(url) });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("decode_failed")); };
    img.src = url;
  });
}

/** يطبّع أي صورة إلى JPEG آمنة (اتجاه/حجم/جودة). يعيد ملفًا باسم UUID + رابط معاينة. */
export async function normalizeImageToJpeg(input: File, maxDim = DEFAULT_MAX_DIM, quality = 0.85): Promise<NormalizeResult> {
  if (!input) return { ok: false, error: "لم يتم اختيار صورة." };
  if (input.size > MAX_INPUT_BYTES) return { ok: false, error: "الصورة أكبر من 25MB. اختر صورة أصغر أو التقطها من الكاميرا." };
  if (typeof document === "undefined") return { ok: false, error: "تعذّرت معالجة الصورة." };
  let decoded: { src: CanvasImageSource; w: number; h: number; close?: () => void } | null = null;
  try {
    decoded = await decode(input);
    if (!decoded.w || !decoded.h) throw new Error("bad_dims");
    const { w, h } = fit(decoded.w, decoded.h, maxDim);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no_ctx");
    ctx.drawImage(decoded.src, 0, 0, w, h);
    const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, "image/jpeg", quality));
    if (!blob) throw new Error("encode_failed");
    const rid = (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now());
    const file = new File([blob], `${rid}.jpg`, { type: "image/jpeg" });
    return { ok: true, file, previewUrl: URL.createObjectURL(blob) };
  } catch {
    // غالبًا HEIC على متصفح لا يدعم فك ترميزه.
    return { ok: false, error: "تعذّر معالجة صيغة الصورة. التقط صورة جديدة من الكاميرا أو اختر JPG." };
  } finally {
    try { decoded?.close?.(); } catch { /* noop */ }
  }
}
