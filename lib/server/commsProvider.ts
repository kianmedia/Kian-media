// ════════════════════════════════════════════════════════════════════════════
// lib/server/commsProvider.ts — the Communications Hub provider layer.
//
// ⛔ THIS FILE NEVER SENDS ANYTHING. There is no fetch() in it and there must
//    never be one. It BUILDS the exact payload and signature that a real relay
//    would receive, and hands back a mock verdict. That is the whole point:
//    the owner has twice been burned by a "sent" signal that was forged, so the
//    hub is shipped with the wire format fully specified and the wire itself
//    disconnected.
//
// WHY A SEPARATE PROVIDER LAYER AT ALL
//    Because the moment a real send is wired up, exactly one file changes, and
//    the contract it must satisfy is already written down and already tested.
//    The relay's answer is judged by the SAME rule the existing, proven sender
//    uses — interpretRelayResponse() in lib/server/projectNotify.ts:70 — which
//    refuses HTTP 200, an opaque body and even a bare {"ok":true} as evidence of
//    delivery. We import it rather than reimplementing it, so the two can never
//    drift apart.
//
// THE APPS SCRIPT IS NOT DEPLOYED.
//    docs/apps_script_portal_notify_HANDLER.gs exists and is paste-ready, but it
//    lives in the owner's Google account and nothing in this repository can put
//    it there. Until somebody deploys it, a real send would answer
//    `relay_handler_missing` and the hub would (correctly) requeue the row
//    without burning an attempt. See docs/APPS_SCRIPT_DEPLOYMENT_GUIDE.md.
// ════════════════════════════════════════════════════════════════════════════

import { createHmac, timingSafeEqual } from "node:crypto";
import { interpretRelayResponse } from "@/lib/server/projectNotify";

if (typeof window !== "undefined") {
  throw new Error("lib/server/commsProvider must never be imported in the browser");
}

/** Wire contract version. Bump only with docs/EMAIL_PROVIDER_CONTRACT.md. */
export const COMMS_CONTRACT_VERSION = 1;

export type CommsChannel = "portal" | "email" | "whatsapp";

export interface CommsMessage {
  id: string;
  channel: CommsChannel;
  event_key: string;
  correlation_id: string;
  idempotency_key: string | null;
  recipient_address: string | null;
  recipient_user_id: string | null;
  locale: string;
  subject: string;
  body: string;
  action_url: string | null;
  audience_scope: "internal" | "client";
  dry_run: boolean;
}

/** What comms_settle() is told. Mirrors the SQL state machine exactly. */
export type CommsOutcome = "sent" | "delivered" | "failed" | "channel_deferred";

export interface CommsSendResult {
  outcome: CommsOutcome;
  provider: string;
  providerMessageId: string | null;
  /** Handed to comms_settle as p_provider_response. `ack:true` is the ONLY way a
   *  non-dry-run row may reach 'sent' — the database enforces that, not us. */
  providerResponse: Record<string, unknown>;
  error: string | null;
  errorClass: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1) THE WIRE PAYLOAD
// ─────────────────────────────────────────────────────────────────────────────

/** Absolute base for deep links. No secrets, no query parameters. */
function publicBase(): string {
  return (process.env.PORTAL_PUBLIC_URL || "https://www.kianmedia.com").replace(/\/+$/, "");
}

export interface RelayPayload {
  _type: "portal_notify";
  contract_version: number;
  To: string;
  Subject: string;
  Body: string;
  Event: string;
  Link: string;
  Locale: string;
  /** Lets the relay drop an exact repeat without knowing anything about us. */
  IdempotencyKey: string;
  /** Correlates every recipient of one business event. NEVER shown to a client. */
  CorrelationId: string;
  /** Present only when COMMS_RELAY_SIGNING_SECRET is configured. */
  Signature?: string;
  SignedAt?: string;
}

/**
 * Build the payload the relay would receive. Deterministic and side-effect free
 * — the admin "preview the wire payload" view renders exactly this, so what is
 * reviewed is what would be sent.
 */
export function buildRelayPayload(m: CommsMessage): RelayPayload {
  const link = m.action_url
    ? `${publicBase()}${m.action_url.startsWith("/") ? "" : "/"}${m.action_url}`
    : publicBase();
  const p: RelayPayload = {
    _type: "portal_notify",
    contract_version: COMMS_CONTRACT_VERSION,
    To: m.recipient_address ?? "",
    Subject: m.subject || "تحديث من منصة كيان",
    Body: m.body || "",
    Event: m.event_key,
    Link: link,
    Locale: m.locale || "ar",
    IdempotencyKey: m.idempotency_key ?? m.id,
    CorrelationId: m.correlation_id,
  };
  const signed = signRelayPayload(p);
  if (signed) { p.Signature = signed.signature; p.SignedAt = signed.signedAt; }
  return p;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) SIGNATURE
//    HMAC-SHA256 over a CANONICAL string — not over JSON.stringify, whose key
//    order and whitespace are not stable across runtimes. Both sides build the
//    same string from the same named fields, so the signature is reproducible.
// ─────────────────────────────────────────────────────────────────────────────

export function relaySigningSecret(): string {
  return (process.env.COMMS_RELAY_SIGNING_SECRET ?? "").trim();
}

/** The exact bytes that get signed. Documented in docs/EMAIL_PROVIDER_CONTRACT.md. */
export function canonicalSigningString(p: Omit<RelayPayload, "Signature" | "SignedAt">, signedAt: string): string {
  return [
    "v" + String(p.contract_version),
    p._type,
    p.Event,
    p.To,
    p.IdempotencyKey,
    p.CorrelationId,
    signedAt,
    // Body hash rather than the body itself: keeps the signed string short and
    // keeps message text out of any log that records what was signed.
    createHmac("sha256", "kian.body").update(p.Subject + "\n" + p.Body, "utf8").digest("hex"),
  ].join("\n");
}

export function signRelayPayload(
  p: Omit<RelayPayload, "Signature" | "SignedAt">,
  nowIso?: string,
): { signature: string; signedAt: string } | null {
  const secret = relaySigningSecret();
  if (!secret) return null;   // unsigned is a valid, documented mode
  const signedAt = nowIso ?? new Date().toISOString();
  const sig = createHmac("sha256", secret).update(canonicalSigningString(p, signedAt), "utf8").digest("hex");
  return { signature: sig, signedAt };
}

/** Constant-time verification, for the relay side and for the tests. */
export function verifyRelaySignature(
  p: Omit<RelayPayload, "Signature" | "SignedAt">,
  signature: string,
  signedAt: string,
): boolean {
  const secret = relaySigningSecret();
  if (!secret || !signature || !signedAt) return false;
  const expected = createHmac("sha256", secret).update(canonicalSigningString(p, signedAt), "utf8").digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) THE MOCK PROVIDER — the only implementation that exists today
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Simulate delivery. Records the payload it WOULD have sent and returns a
 * verdict carrying `dry_run: true` and `ack: false`.
 *
 * `ack:false` matters: comms_settle refuses to mark a NON-dry-run row as 'sent'
 * without `ack:true`. So even if a channel were taken out of dry-run by mistake
 * while this mock is still the provider, the row would settle as FAILED with
 * error_class `no_provider_ack` — visibly wrong instead of a forged success.
 */
export function mockSend(m: CommsMessage): CommsSendResult {
  const payload = buildRelayPayload(m);
  return {
    outcome: "sent",
    provider: "mock",
    providerMessageId: `mock-${m.id}`,
    providerResponse: {
      ack: false,
      dry_run: true,
      simulated: true,
      channel: m.channel,
      would_send_to: m.channel === "email" ? maskAddress(m.recipient_address) : m.recipient_user_id,
      payload_bytes: Buffer.byteLength(JSON.stringify(payload), "utf8"),
      contract_version: COMMS_CONTRACT_VERSION,
      signed: Boolean(payload.Signature),
      note: "MOCK PROVIDER — nothing was transmitted.",
    },
    error: null,
    errorClass: null,
  };
}

/** WhatsApp is a placeholder. It has no provider and must not pretend otherwise. */
export function whatsappPlaceholder(m: CommsMessage): CommsSendResult {
  return {
    outcome: "channel_deferred",
    provider: "whatsapp_placeholder",
    providerMessageId: null,
    providerResponse: { ack: false, dry_run: true, channel: "whatsapp", note: "no WhatsApp provider is wired for notifications" },
    error: "whatsapp_not_implemented",
    errorClass: "channel",
  };
}

/** Mask an email for logs and for the non-admin dashboard tier. */
export function maskAddress(addr: string | null): string | null {
  if (!addr) return null;
  const at = addr.indexOf("@");
  if (at <= 0) return "***";
  return addr[0] + "***" + addr.slice(at);
}

/**
 * The single dispatch point. Today every branch is simulated.
 *
 * A future real email implementation replaces the marked branch ONLY, and must
 * keep the interpretRelayResponse() verdict below: `handlerPresent` false ⇒
 * `channel_deferred` (requeue, do not burn an attempt), `rejected` ⇒ failed,
 * otherwise `sent` with `ack:true`.
 */
export async function deliver(m: CommsMessage): Promise<CommsSendResult> {
  if (m.channel === "whatsapp") return whatsappPlaceholder(m);
  // ⛔ REAL SEND WOULD GO HERE. It does not exist, and adding one is out of
  //    scope for this phase. Everything below is simulation.
  return mockSend(m);
}

/**
 * Translate a relay's raw response body into a hub outcome, reusing the proven
 * classifier. Exported (and tested) so the contract is pinned NOW, before any
 * real send exists — this is the function a future implementer must call.
 */
export function classifyRelayBody(bodyText: string): CommsSendResult {
  const v = interpretRelayResponse(bodyText);
  if (v.rejected) {
    return {
      outcome: "failed", provider: "apps_script",
      providerMessageId: v.providerId ?? null,
      providerResponse: { ack: false, rejected: true, reason: v.reason ?? "provider_rejected" },
      error: v.reason ?? "provider_rejected", errorClass: "provider_rejected",
    };
  }
  if (!v.handlerPresent) {
    // The relay answered, but not as our handler. This is the undeployed Apps
    // Script. Channel-level: requeue, do NOT burn an attempt, do NOT dead-letter.
    return {
      outcome: "channel_deferred", provider: "apps_script", providerMessageId: null,
      providerResponse: { ack: false, handler_present: false, reason: "relay_handler_missing" },
      error: "relay_handler_missing", errorClass: "channel",
    };
  }
  return {
    outcome: "sent", provider: "apps_script",
    providerMessageId: v.providerId ?? null,
    providerResponse: { ack: true, handler_present: true, sent: v.sentCount ?? null },
    error: null, errorClass: null,
  };
}
