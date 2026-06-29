// ════════════════════════════════════════════════════════════════════════
// Kian — SERVER-ONLY validation for OUTBOUND WhatsApp delivery config.
//
// The undici `fetch` Headers init converts every value to a ByteString (each
// code unit must be 0–255). An env value with Arabic text (e.g. "ن" = U+0646 =
// 1606) throws "Cannot convert argument to a ByteString …". This module gates
// every env value that reaches an outbound URL or header BEFORE fetch is called,
// so that crash can never surface and the UI can name the offending env var.
//
// SECURITY: no secret VALUE ever leaves this module — callers receive only the
// env NAME and a short machine reason. Never log/return the raw value.
// ════════════════════════════════════════════════════════════════════════
if (typeof window !== "undefined") throw new Error("lib/server/deliveryConfig is server-only");

export type ConfigReason =
  | "missing"
  | "non_ascii_header"   // contains a char > 0x7E (e.g. Arabic) — would crash fetch Headers
  | "control_chars"      // contains control/whitespace chars invalid in a header value
  | "placeholder"        // still holds a default/placeholder value
  | "not_http_url"       // not a valid http/https URL
  | "not_numeric";       // expected digits only (phone number id)

export interface ConfigIssue { env: string; reason: ConfigReason }

/** True iff `v` contains any char outside printable ASCII (0x20–0x7E). Detects the
 *  Arabic / non-Latin1 values that crash undici's ByteString header conversion. */
export function hasNonAscii(v: string): boolean {
  for (let i = 0; i < v.length; i++) if (v.charCodeAt(i) > 0x7e) return true;
  return false;
}

/** True iff every char is printable ASCII (0x20–0x7E) — safe as an HTTP header value. */
export function isAsciiHeaderSafe(v: string): boolean {
  if (v.length === 0) return false;
  for (let i = 0; i < v.length; i++) { const c = v.charCodeAt(i); if (c < 0x20 || c > 0x7e) return false; }
  return true;
}

// Common leftover-placeholder shapes, incl. Arabic prompt words ("ضع/هنا/السر/سر").
const PLACEHOLDER_RES: RegExp[] = [
  /^<.*>$/, /your[_-]?(secret|token|key)/i, /change[_-]?me/i, /^x{4,}$/i,
  /placeholder/i, /example\.com/i, /^\.\.\.+$/, /(ضع|هنا|السر|سر|القيمة)/,
];
function looksPlaceholder(v: string): boolean { return PLACEHOLDER_RES.some((re) => re.test(v.trim())); }

/** Validate a value bound for an HTTP HEADER. null = OK, else a safe reason. */
export function headerReason(raw: string | undefined | null): ConfigReason | null {
  const v = (raw ?? "").trim();
  if (!v) return "missing";
  if (hasNonAscii(v)) return "non_ascii_header";
  if (!isAsciiHeaderSafe(v)) return "control_chars";
  if (looksPlaceholder(v)) return "placeholder";
  return null;
}

/** Validate a value bound for a fetch URL. null = OK, else a safe reason. */
export function urlReason(raw: string | undefined | null): ConfigReason | null {
  const v = (raw ?? "").trim();
  if (!v) return "missing";
  if (hasNonAscii(v)) return "non_ascii_header";
  let u: URL;
  try { u = new URL(v); } catch { return "not_http_url"; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "not_http_url";
  if (looksPlaceholder(v)) return "placeholder";
  return null;
}

/** Validate a Meta phone-number-id (digits only; it also goes in the URL path). */
export function phoneIdReason(raw: string | undefined | null): ConfigReason | null {
  const v = (raw ?? "").trim();
  if (!v) return "missing";
  if (!/^\d{5,20}$/.test(v)) return "not_numeric";
  return null;
}

/** Build an Authorization value, de-duping any existing "Bearer " prefix so we
 *  never produce "Bearer Bearer …". Caller MUST have validated the token first. */
export function bearerAuth(rawToken: string): string {
  const core = rawToken.trim().replace(/^bearer\s+/i, "");
  return `Bearer ${core}`;
}

/** The token core (without any "Bearer " prefix) — what must be header-safe. */
export function tokenCore(rawToken: string | undefined | null): string {
  return (rawToken ?? "").trim().replace(/^bearer\s+/i, "");
}

/** Map a thrown fetch/Headers error to a SAFE message. Specifically replaces the
 *  raw "Cannot convert … ByteString …" text so it can never surface in the UI. */
export function safeFetchError(e: unknown, fallbackEnv?: string): string {
  const msg = String((e as Error)?.message ?? e);
  if (/ByteString|character at index|code unit|Headers\b/i.test(msg)) {
    return fallbackEnv
      ? `invalid_config:${fallbackEnv}:non_ascii_header`
      : `invalid_config:header:non_ascii_header`;
  }
  return msg.slice(0, 300);
}

export interface WaConfigHealth {
  n8n_webhook_present: boolean;
  n8n_webhook_valid: boolean;
  n8n_secret_present: boolean;
  n8n_secret_valid_header_value: boolean;
  whatsapp_token_present: boolean;
  whatsapp_token_valid_header_value: boolean;
  whatsapp_phone_number_id_present: boolean;
  whatsapp_phone_number_id_valid: boolean;
  issues: ConfigIssue[];
}

/** Inspect the outbound WhatsApp env config and report presence + header-safety,
 *  plus a list of {env, reason} issues. Values are read but NEVER returned. */
export function whatsappConfigHealth(): WaConfigHealth {
  const url = process.env.N8N_WHATSAPP_SEND_WEBHOOK_URL;
  const secret = process.env.N8N_WHATSAPP_SEND_SECRET;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const issues: ConfigIssue[] = [];

  const urlR = url && url.trim() ? urlReason(url) : null;
  const secretR = secret && secret.trim() ? headerReason(secret) : null;
  const tokenR = token && token.trim() ? headerReason(tokenCore(token)) : null;
  const phoneR = phoneId && phoneId.trim() ? phoneIdReason(phoneId) : null;

  if (urlR) issues.push({ env: "N8N_WHATSAPP_SEND_WEBHOOK_URL", reason: urlR });
  if (secretR) issues.push({ env: "N8N_WHATSAPP_SEND_SECRET", reason: secretR });
  if (tokenR) issues.push({ env: "WHATSAPP_ACCESS_TOKEN", reason: tokenR });
  if (phoneR) issues.push({ env: "WHATSAPP_PHONE_NUMBER_ID", reason: phoneR });

  const present = (v: string | undefined | null) => !!(v && v.trim());
  return {
    n8n_webhook_present: present(url),
    n8n_webhook_valid: present(url) && !urlR,
    n8n_secret_present: present(secret),
    n8n_secret_valid_header_value: present(secret) && !secretR,
    whatsapp_token_present: present(token),
    whatsapp_token_valid_header_value: present(token) && !tokenR,
    whatsapp_phone_number_id_present: present(phoneId),
    whatsapp_phone_number_id_valid: present(phoneId) && !phoneR,
    issues,
  };
}
