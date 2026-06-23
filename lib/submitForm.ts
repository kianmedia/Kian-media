// ════════════════════════════════════════════════════════════════════════
// Kian Media — Google Sheets form submission helper.
// Single source of truth for the Apps Script Web App endpoint.
// ════════════════════════════════════════════════════════════════════════

export const SHEETS_ENDPOINT =
  "https://script.google.com/macros/s/AKfycbwxiZ89h5ZvoNpLfEbQZx_yeLBMocrus6Hku4RVKC_YyiAeMvytRqcj6sV2PdB2w8TKrg/exec";

export type SubmitType = "meeting" | "quote" | "upload";

/**
 * Generate a human-readable reference number CLIENT-SIDE.
 * Because submission uses no-cors (opaque response), the site can't read a
 * server-generated ID — so we generate it here and send it along, which also
 * lets us show it to the user instantly.
 *
 * Format: QR-2026-<6 digits>  /  MT-2026-<6 digits>  /  UP-2026-<6 digits>
 * The 6 digits derive from the timestamp for uniqueness.
 */
export function makeRef(type: SubmitType): string {
  const prefix = type === "meeting" ? "MT" : type === "upload" ? "UP" : "QR";
  const year = new Date().getFullYear();
  // last 6 digits of epoch seconds → effectively unique per submission
  const seq = String(Math.floor(Date.now() / 1000)).slice(-6);
  return `${prefix}-${year}-${seq}`;
}

/** Build a clickable wa.me link from a raw mobile number. */
export function waLink(mobile: string): string {
  const digits = (mobile || "").replace(/[^\d]/g, "");
  // If Saudi local (starts with 0), convert to 966; else keep as-is.
  let normalized = digits;
  if (digits.startsWith("0")) normalized = "966" + digits.slice(1);
  return normalized ? `https://wa.me/${normalized}` : "";
}

/** Basic validators (Issue 15). */
export function isValidEmail(email: string): boolean {
  if (!email) return true; // email optional unless marked required by caller
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
export function isValidMobile(mobile: string): boolean {
  const digits = (mobile || "").replace(/[^\d]/g, "");
  return digits.length >= 9; // permissive: at least 9 digits
}

/**
 * Best-effort: mirror a website submission into Supabase (public_intake) so the
 * same person sees it in the portal after signing up with the same verified email.
 * Never throws and never blocks the form. Sends the logged-in user's bearer when
 * present so the row is attributed immediately.
 */
export interface IntakeInput {
  type: "quote" | "meeting" | "call" | "files" | "contact" | "other";
  email: string; phone?: string; name?: string; company?: string; city?: string;
  reference?: string; services?: string[]; details?: string; preferred_date?: string;
  preferred_contact?: string; source?: string; files?: { label?: string; url: string }[];
  bearer?: string;
}
export async function captureIntake(input: IntakeInput): Promise<void> {
  try {
    if (!input.email || !input.email.includes("@")) return;
    const { bearer, ...body } = input;
    await fetch("/api/public/intake", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
      body: JSON.stringify(body),
    });
  } catch { /* never block the form */ }
}

export async function submitToSheets(
  type: SubmitType,
  fields: Record<string, string | number | boolean>
): Promise<{ ok: boolean; error?: string }> {
  try {
    const payload = { _type: type, ...fields };
    await fetch(SHEETS_ENDPOINT, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
