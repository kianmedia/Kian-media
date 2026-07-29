// ════════════════════════════════════════════════════════════════════════════
// lib/server/commsLegacyAdapter.ts — the ONLY sanctioned way the Communications
// Hub touches the existing email path.
//
// THE PROBLEM THIS SOLVES
//   The repo already has a working (if undelivered) pipeline:
//     emitEventEmail() → notify_emit_event → email_deliveries → processQueue
//   Adding a second pipeline beside it is how a business event ends up mailed
//   twice — the audit lists that as the single most likely double-send
//   (docs/NOTIFICATIONS_CURRENT_STATE_AUDIT.md §6). So the hub does NOT run
//   beside it. Exactly one of the two owns any given event.
//
// THE RULE — MUTUALLY EXCLUSIVE, DECIDED BY EVIDENCE, NOT BY GUESSWORK
//   1. Offer the event to the hub.
//   2. If the hub actually queued an EMAIL row for it
//      (queued_by_channel.email > 0), the hub owns the email. The legacy sender
//      is NOT called. Return.
//   3. In every other case — hub not installed, event not in its catalogue,
//      email channel disabled (the shipped default), rate limited, no recipient
//      — fall through to emitEventEmail() with its behaviour completely
//      unchanged.
//   There is no branch in which both run.
//
// WHAT HAPPENS TODAY
//   The hub ships with the email channel DISABLED, so step 2 is never taken and
//   every caller behaves exactly as it does now. The hub may still queue the
//   PORTAL leg (in-app rows only, and even those simulated) — that is additive
//   visibility, not a second email.
//
// ⛔ Nothing here sends. The hub side is a mock; the legacy side is the existing
//    code, which today returns relay_handler_missing because the Apps Script is
//    not deployed.
// ════════════════════════════════════════════════════════════════════════════

import { commsEnqueue, logCommsOutcome, type CommsEnqueueOutcome } from "@/lib/server/commsHub";
import { emitEventEmail, logEmitOutcome, type NotifyEmitInput, type NotifyEmitOutcome } from "@/lib/server/notifyEvent";

if (typeof window !== "undefined") {
  throw new Error("lib/server/commsLegacyAdapter must never be imported in the browser");
}

export interface AdapterResult {
  /** Which pipeline ended up owning the EMAIL leg. Never both. */
  owner: "hub" | "legacy";
  /** Why the hub did not take it (null when it did). */
  fell_through_because:
    | null | "HUB_NOT_INSTALLED" | "UNKNOWN_EVENT" | "EMAIL_CHANNEL_DISABLED"
    | "RATE_LIMITED" | "NO_EMAIL_RECIPIENT" | "ENQUEUE_FAILED" | "SERVER_NOT_CONFIGURED";
  hub: CommsEnqueueOutcome;
  legacy: NotifyEmitOutcome | null;
}

/** Map an enqueue outcome to the reason we are handing the event back. */
function fallThroughReason(o: CommsEnqueueOutcome): AdapterResult["fell_through_because"] {
  switch (o.code) {
    case "HUB_NOT_INSTALLED":     return "HUB_NOT_INSTALLED";
    case "UNKNOWN_EVENT":         return "UNKNOWN_EVENT";
    case "RATE_LIMITED":          return "RATE_LIMITED";
    case "SERVER_NOT_CONFIGURED": return "SERVER_NOT_CONFIGURED";
    case "ENQUEUE_FAILED":        return "ENQUEUE_FAILED";
    default:
      // The hub answered fine but produced no email row. Distinguish the two
      // ordinary causes so the log says which, rather than "something".
      return o.skipped_channel_disabled > 0 ? "EMAIL_CHANNEL_DISABLED" : "NO_EMAIL_RECIPIENT";
  }
}

/**
 * Drop-in replacement for emitEventEmail(). Same input shape, same
 * never-throws contract, same "the business action is already saved" law.
 *
 * `hubEvent` is the catalogue key (comms_event_catalog.event_key). It is passed
 * separately because the legacy vocabulary and the hub vocabulary are not the
 * same set, and silently reusing one as the other would enqueue events the
 * catalogue never reviewed.
 */
export async function notifyViaHubOrLegacy(
  input: NotifyEmitInput,
  hubEvent?: string,
): Promise<AdapterResult> {
  const hub = await commsEnqueue({
    event: hubEvent ?? input.event,
    entity_type: input.entity_type,
    entity_id: input.entity_id ?? null,
    project_id: input.project_id ?? null,
    actor: input.actor ?? null,
    payload: {
      ...(input.payload ?? {}),
      details: input.body,
      subject_hint: input.subject,
    },
    correlation_id: input.correlation_id ?? null,
  });
  logCommsOutcome("comms_adapter_hub", hubEvent ?? input.event, hub);

  // ── The hub took the email leg. The legacy sender must NOT also run. ──
  if (hub.ok && hub.queued_by_channel.email > 0) {
    return { owner: "hub", fell_through_because: null, hub, legacy: null };
  }

  // ── Fall through. Legacy behaviour is untouched. ──
  const legacy = await emitEventEmail(input);
  logEmitOutcome("comms_adapter_legacy", input.event, legacy);
  return { owner: "legacy", fell_through_because: fallThroughReason(hub), hub, legacy };
}

/**
 * Record-only mode: hand the event to the hub for VISIBILITY, and never let it
 * own the email. Use this when a caller wants hub telemetry without changing
 * which pipeline delivers. Returns the hub outcome and nothing else happens.
 *
 * Safe by construction: it does not call the legacy sender either, so it can
 * never be the second half of a double-send. The caller keeps doing whatever it
 * already did.
 */
export async function observeInHub(
  hubEvent: string,
  input: Omit<NotifyEmitInput, "event">,
): Promise<CommsEnqueueOutcome> {
  const out = await commsEnqueue({
    event: hubEvent,
    entity_type: input.entity_type,
    entity_id: input.entity_id ?? null,
    project_id: input.project_id ?? null,
    actor: input.actor ?? null,
    payload: { ...(input.payload ?? {}), details: input.body, subject_hint: input.subject },
    correlation_id: input.correlation_id ?? null,
  });
  logCommsOutcome("comms_observe", hubEvent, out);
  return out;
}
