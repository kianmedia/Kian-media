// ════════════════════════════════════════════════════════════════════════
// Kian — SERVER-ONLY WhatsApp sender for the delivery processor. COMPLIANT path:
// approved Meta templates only (no proactive free-form to clients). Preferred
// transport = the n8n send webhook (Kian Sales number); falls back to the Meta
// Cloud API template send if n8n is not configured. Never throws.
// ════════════════════════════════════════════════════════════════════════
if (typeof window !== "undefined") throw new Error("lib/server/deliveryWhatsApp is server-only");

import { headerReason, urlReason, phoneIdReason, bearerAuth, tokenCore, safeFetchError } from "@/lib/server/deliveryConfig";

export interface WaSendResult {
  ok: boolean;
  status: "sent" | "failed" | "skipped";
  provider: string | null;
  messageId: string | null;
  error: string | null;
}

/** Normalize a Saudi/intl phone to E.164 digits (no '+'). Returns "" if implausible. */
export function toE164Digits(raw: string | null | undefined): string {
  let d = (raw || "").replace(/[^\d]/g, "");
  if (!d) return "";
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("0")) d = "966" + d.slice(1);        // Saudi national 05… → 9665…
  else if (d.length === 9 && d.startsWith("5")) d = "966" + d; // 5XXXXXXXX → 9665XXXXXXXX
  return d.length >= 11 && d.length <= 15 ? d : "";
}

export interface WaTemplateSend {
  to: string;
  templateName: string;
  language?: string;
  variables: string[];
  event_type: string;
  entity_type: string | null;
  entity_id: string | null;
  recipient_role: string;
  portal_url: string;
  idempotency_key: string;
}

export async function sendWhatsAppTemplate(p: WaTemplateSend): Promise<WaSendResult> {
  const to = toE164Digits(p.to);
  if (!to) return { ok: false, status: "skipped", provider: null, messageId: null, error: "invalid_phone" };
  const lang = p.language || "ar";

  // Preferred: hand off to the n8n send webhook (it owns the Meta bridge + retry/rate-limit).
  const n8nUrlRaw = process.env.N8N_WHATSAPP_SEND_WEBHOOK_URL;
  if (n8nUrlRaw && n8nUrlRaw.trim()) {
    // Validate every value that reaches the URL/headers BEFORE fetch, so a bad env
    // (e.g. Arabic secret) is reported as a clear config error, never a ByteString crash.
    const urlR = urlReason(n8nUrlRaw);
    if (urlR) return { ok: false, status: "failed", provider: "n8n", messageId: null, error: `invalid_config:N8N_WHATSAPP_SEND_WEBHOOK_URL:${urlR}` };
    const secretRaw = process.env.N8N_WHATSAPP_SEND_SECRET;
    let secretHeader: Record<string, string> = {};
    if (secretRaw && secretRaw.trim()) {
      const sR = headerReason(secretRaw);
      if (sR) return { ok: false, status: "failed", provider: "n8n", messageId: null, error: `invalid_config:N8N_WHATSAPP_SEND_SECRET:${sR}` };
      secretHeader = { "x-kian-send-secret": secretRaw.trim() };
    }
    try {
      const res = await fetch(n8nUrlRaw.trim(), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...secretHeader },
        body: JSON.stringify({
          to, template_name: p.templateName, language: lang, variables: p.variables,
          event_type: p.event_type, entity_type: p.entity_type, entity_id: p.entity_id,
          recipient_role: p.recipient_role, portal_url: p.portal_url, idempotency_key: p.idempotency_key,
        }),
        cache: "no-store",
      });
      const j = (await res.json().catch(() => ({}))) as { message_id?: string; id?: string; error?: string };
      if (!res.ok) return { ok: false, status: "failed", provider: "n8n", messageId: null, error: `n8n_${res.status}:${j.error || ""}`.slice(0, 300) };
      return { ok: true, status: "sent", provider: "n8n", messageId: j.message_id || j.id || null, error: null };
    } catch (e) {
      return { ok: false, status: "failed", provider: "n8n", messageId: null, error: safeFetchError(e, "N8N_WHATSAPP_SEND_SECRET") };
    }
  }

  // Fallback: direct Meta Cloud API template send (server token; never proactive free-form).
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID, token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneId || !phoneId.trim() || !token || !token.trim()) return { ok: false, status: "skipped", provider: null, messageId: null, error: "whatsapp_provider_missing" };
  // Validate before fetch: phone id goes in the URL path, the token in the Authorization header.
  const phoneR = phoneIdReason(phoneId);
  if (phoneR) return { ok: false, status: "failed", provider: "meta_cloud", messageId: null, error: `invalid_config:WHATSAPP_PHONE_NUMBER_ID:${phoneR}` };
  const tokR = headerReason(tokenCore(token));   // validate the token core (any "Bearer " prefix stripped)
  if (tokR) return { ok: false, status: "failed", provider: "meta_cloud", messageId: null, error: `invalid_config:WHATSAPP_ACCESS_TOKEN:${tokR}` };
  const authHeader = bearerAuth(token);          // "Bearer <token>" — never "Bearer Bearer …"
  const version = process.env.WHATSAPP_API_VERSION || "v21.0";
  try {
    const components = p.variables.length
      ? [{ type: "body", parameters: p.variables.map((t) => ({ type: "text", text: String(t || "-") })) }]
      : undefined;
    const res = await fetch(`https://graph.facebook.com/${version}/${phoneId.trim()}/messages`, {
      method: "POST",
      headers: { Authorization: authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp", to, type: "template",
        template: { name: p.templateName, language: { code: lang }, ...(components ? { components } : {}) },
      }),
      cache: "no-store",
    });
    const j = (await res.json().catch(() => ({}))) as { messages?: Array<{ id?: string }>; error?: { message?: string } };
    if (!res.ok) return { ok: false, status: "failed", provider: "meta_cloud", messageId: null, error: `cloud_${res.status}:${j.error?.message || ""}`.slice(0, 300) };
    return { ok: true, status: "sent", provider: "meta_cloud", messageId: j.messages?.[0]?.id ?? null, error: null };
  } catch (e) {
    return { ok: false, status: "failed", provider: "meta_cloud", messageId: null, error: safeFetchError(e, "WHATSAPP_ACCESS_TOKEN") };
  }
}
