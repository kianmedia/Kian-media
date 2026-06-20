// ════════════════════════════════════════════════════════════════════════
// Kian — SERVER-ONLY WhatsApp Cloud API text sender (shared helper).
//
// Used by the rule-based auto quote-link reply and the customer confirmation.
// Sends a free-form text (valid only inside the 24h customer-service window —
// always true right after an inbound message). The token is server-only and is
// never logged. Each caller does its own gating/allowlist/audit BEFORE calling.
// ════════════════════════════════════════════════════════════════════════

if (typeof window !== "undefined") {
  throw new Error("lib/server/whatsappCloud must never be imported in the browser");
}

export const digitsOnly = (s: string) => (s || "").replace(/[^\d]/g, "");

/** True when real WhatsApp Cloud API credentials are present. */
export function whatsappCredsPresent(): boolean {
  return !!process.env.WHATSAPP_PHONE_NUMBER_ID && !!process.env.WHATSAPP_ACCESS_TOKEN;
}

export interface SendTextResult { ok: boolean; waId: string | null; error: string | null }

/** POST a text message. Returns {ok,waId,error}; never throws. */
export async function sendTextMessage(to: string, body: string): Promise<SendTextResult> {
  if (!whatsappCredsPresent()) return { ok: false, waId: null, error: "no_creds" };
  const version = process.env.WHATSAPP_API_VERSION || "v21.0";
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID as string;
  try {
    const res = await fetch(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: digitsOnly(to), type: "text", text: { body } }),
      cache: "no-store",
    });
    const j = (await res.json()) as { messages?: Array<{ id?: string }>; error?: { message?: string } };
    if (!res.ok) return { ok: false, waId: null, error: `cloud_api_${res.status}` };
    return { ok: true, waId: j?.messages?.[0]?.id ?? null, error: null };
  } catch {
    return { ok: false, waId: null, error: "send_error" };
  }
}
