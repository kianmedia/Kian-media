// ════════════════════════════════════════════════════════════════════════
// QR helper — يستخدم حزمة qrcode (client-side). الـ QR يحمل رابط مسح يحلّ token
// عبر RPC آمنة (لا asset_id مباشر). آمن الفشل ⇒ نص فارغ.
// ملاحظة: الحزمة تُثبَّت عبر npm install (يفعله Vercel تلقائيًا عند البناء).
// ════════════════════════════════════════════════════════════════════════
import QRCode from "qrcode";

/** محتوى الـ QR: رابط مسح عميق يحمل الـ token فقط. */
export function qrScanUrl(token: string): string {
  const base = typeof window !== "undefined" ? window.location.origin : (process.env.NEXT_PUBLIC_PORTAL_URL || "https://www.kianmedia.com");
  return `${base}/client-portal/asset-custody?scan=${encodeURIComponent(token)}`;
}

export async function qrSvg(text: string, size = 160): Promise<string> {
  try { return await QRCode.toString(text, { type: "svg", margin: 1, width: size, errorCorrectionLevel: "M" }); }
  catch { return ""; }
}
export async function qrDataUrl(text: string, size = 160): Promise<string> {
  try { return await QRCode.toDataURL(text, { margin: 1, width: size, errorCorrectionLevel: "M" }); }
  catch { return ""; }
}
