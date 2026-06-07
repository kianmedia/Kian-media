// ════════════════════════════════════════════════════════════════════════
// Kian Media — Google Sheets form submission helper.
// Single source of truth for the Apps Script Web App endpoint.
// If the endpoint ever changes, update ONLY this constant.
// ════════════════════════════════════════════════════════════════════════

export const SHEETS_ENDPOINT =
  "https://script.google.com/macros/s/AKfycbwxiZ89h5ZvoNpLfEbQZx_yeLBMocrus6Hku4RVKC_YyiAeMvytRqcj6sV2PdB2w8TKrg/exec";

export type SubmitType = "meeting" | "quote" | "upload";

/**
 * Submit a form payload to Google Sheets via Apps Script.
 *
 * NOTE on CORS: Apps Script Web Apps don't return permissive CORS headers
 * for JSON content-type. Sending as text/plain avoids a preflight request;
 * the body still arrives as a JSON string that the script parses with
 * JSON.parse(e.postData.contents). This is the standard, reliable pattern.
 *
 * Because the response is opaque under no-cors, we treat a resolved fetch
 * as success. The Apps Script itself appends the row server-side.
 */
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

    // Under no-cors the response is opaque (can't read status), so a
    // resolved promise is our success signal.
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
