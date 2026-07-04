// ════════════════════════════════════════════════════════════════════════
// Kian — custody/rental notification webhook (SERVER-ONLY, STAGED).
//
// Channel-ready per the custody brief §8: portal notifications are already
// written by the SQL RPCs; this module additionally POSTs the event payload to
// an n8n webhook that fans out email NOW and WhatsApp LATER (the WhatsApp node
// stays disabled inside n8n until Meta verification clears — no code change).
//
// FAIL-CLOSED: when N8N_NOTIFY_WEBHOOK_URL is unset, nothing is sent and the
// caller gets {sent:false, reason:"not_configured"} — never an error. Never
// throws. Never logs secrets. Does NOT touch the existing WhatsApp integration.
// Env (new, namespaced — no collision with WHATSAPP_* / DELIVERY_*):
//   N8N_NOTIFY_WEBHOOK_URL  — the n8n webhook endpoint (absent = staged/off)
//   N8N_NOTIFY_SECRET       — shared secret sent as x-kian-notify-secret
// ════════════════════════════════════════════════════════════════════════

if (typeof window !== "undefined") {
  throw new Error("lib/server/custodyNotify must never be imported in the browser");
}

export interface CustodyEventPayload {
  event: string;                    // e.g. custody_checkout_new / custody_return_shortage
  record_id: string;
  record_no?: string;
  kind?: string;                    // custody | rental
  party_name?: string;
  urgent?: boolean;
  channels?: string[];              // ['portal','email','whatsapp'] — n8n decides per flag
  actor_user_id?: string;
}

export function custodyWebhookConfigured(): boolean {
  return (process.env.N8N_NOTIFY_WEBHOOK_URL ?? "").length > 0;
}

export async function postCustodyEvent(payload: CustodyEventPayload):
  Promise<{ sent: boolean; reason?: string }> {
  const url = process.env.N8N_NOTIFY_WEBHOOK_URL ?? "";
  if (!url) return { sent: false, reason: "not_configured" };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.N8N_NOTIFY_SECRET ? { "x-kian-notify-secret": process.env.N8N_NOTIFY_SECRET } : {}),
      },
      body: JSON.stringify({ source: "kian-portal-custody", ...payload }),
      cache: "no-store",
    });
    if (!res.ok) {
      console.error(`[custody/notify] webhook HTTP ${res.status} for event=${payload.event} record=${payload.record_no || payload.record_id}`);
      return { sent: false, reason: `http_${res.status}` };
    }
    return { sent: true };
  } catch (e) {
    console.error(`[custody/notify] webhook failed for event=${payload.event}: ${String(e)}`);
    return { sent: false, reason: "network" };
  }
}
