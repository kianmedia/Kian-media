// ════════════════════════════════════════════════════════════════════════════
// lib/server/commsHub.ts — the server-side face of the Communications Hub.
//
// Two jobs, both thin on purpose:
//   commsEnqueue()  — hand a business event to comms_enqueue (SQL). Recipients,
//                     safety rules, templates, preferences, rate limit and
//                     idempotency all live in the database, where a direct API
//                     call cannot go around them.
//   commsDrain()    — claim rows, hand each to the MOCK provider, settle the
//                     result. This is the whole worker; there is no second one.
//
// ⛔ NOTHING SENDS. commsDrain calls lib/server/commsProvider.deliver(), which
//    has no network call at all. Every settled row carries ack:false, so the
//    database refuses to mark a live (non-dry-run) row as 'sent'.
//
// FEATURE DETECTION IS MANDATORY. The owner pushes code BEFORE running SQL, so
// every entry point answers HUB_NOT_INSTALLED honestly instead of throwing, and
// the UI renders «الميزة بانتظار تفعيل قاعدة البيانات».
//
// NEVER THROWS into a caller. A communications failure must not roll back the
// business action that caused it — the same law the rest of this codebase
// already follows (docs/NOTIFICATION_EVENT_CONTRACT.md §2).
// ════════════════════════════════════════════════════════════════════════════

import { rpcAsService, adminConfigured } from "@/lib/server/supabaseAdmin";
import { deliver, maskAddress, type CommsMessage, type CommsSendResult } from "@/lib/server/commsProvider";

if (typeof window !== "undefined") {
  throw new Error("lib/server/commsHub must never be imported in the browser");
}

const log = (tag: string, extra: Record<string, unknown>) => console.log(JSON.stringify({ tag, ...extra }));

/** PostgREST's answer when the function is simply not deployed yet. */
export function hubNotInstalled(err: string): boolean {
  return /PGRST202|could not find the function|does not exist|schema cache|HTTP 404/i.test(err ?? "");
}

// ─────────────────────────────────────────────────────────────────────────────
// ENQUEUE
// ─────────────────────────────────────────────────────────────────────────────

export interface CommsEnqueueInput {
  event: string;                       // must exist in comms_event_catalog
  entity_type?: string | null;
  entity_id?: string | null;
  project_id?: string | null;
  actor?: string | null;
  /** Template variables + optional { action_url, direct: [{user_id, reason}] }. */
  payload?: Record<string, unknown>;
  correlation_id?: string | null;
}

export interface CommsEnqueueOutcome {
  ok: boolean;
  code: "QUEUED" | "NOTHING_TO_QUEUE" | "RATE_LIMITED" | "UNKNOWN_EVENT"
      | "HUB_NOT_INSTALLED" | "SERVER_NOT_CONFIGURED" | "ENQUEUE_FAILED";
  correlation_id: string | null;
  queued: number;
  duplicates_suppressed: number;
  blocked_r1: number;                  // client refused an internal notification
  blocked_r2: number;                  // internal/financial content refused to a client
  skipped_preference: number;
  skipped_channel_disabled: number;
  /** Per-channel queued counts. The legacy adapter branches on `email` — see
   *  lib/server/commsLegacyAdapter.ts. Guessing here is how a double-send starts. */
  queued_by_channel: { portal: number; email: number; whatsapp: number };
  ids: string[];
  error?: string;
}

const emptyEnqueue = (code: CommsEnqueueOutcome["code"]): CommsEnqueueOutcome => ({
  ok: false, code, correlation_id: null, queued: 0, duplicates_suppressed: 0,
  blocked_r1: 0, blocked_r2: 0, skipped_preference: 0, skipped_channel_disabled: 0,
  queued_by_channel: { portal: 0, email: 0, whatsapp: 0 }, ids: [],
});

interface EnqueueRpc {
  ok?: boolean; error?: string; correlation_id?: string; queued?: number;
  ids?: string[]; duplicates_suppressed?: number; blocked_r1?: number; blocked_r2?: number;
  skipped_preference?: number; skipped_channel_disabled?: number;
  queued_by_channel?: Record<string, number>;
}

/** Hand one business event to the hub. Call AFTER the business row is committed. */
export async function commsEnqueue(input: CommsEnqueueInput): Promise<CommsEnqueueOutcome> {
  try {
    if (!adminConfigured()) return emptyEnqueue("SERVER_NOT_CONFIGURED");

    const r = await rpcAsService<EnqueueRpc>("comms_enqueue", {
      p_event: input.event,
      p_entity_type: input.entity_type ?? null,
      p_entity_id: input.entity_id ?? null,
      p_project: input.project_id ?? null,
      p_actor: input.actor ?? null,
      p_payload: input.payload ?? {},
      p_correlation: input.correlation_id ?? null,
    });

    if (!r.ok) {
      const err = String((r as { error?: string }).error ?? "enqueue_failed");
      const out = emptyEnqueue(hubNotInstalled(err) ? "HUB_NOT_INSTALLED" : "ENQUEUE_FAILED");
      out.error = err.slice(0, 200);
      return out;
    }

    const d = r.data ?? {};
    if (d.ok === false) {
      const code: CommsEnqueueOutcome["code"] =
        d.error === "rate_limited" ? "RATE_LIMITED"
        : d.error === "event_not_in_catalog" ? "UNKNOWN_EVENT" : "ENQUEUE_FAILED";
      const out = emptyEnqueue(code);
      out.correlation_id = d.correlation_id ?? null;
      out.error = d.error;
      return out;
    }

    const queued = d.queued ?? 0;
    const byCh = d.queued_by_channel ?? {};
    return {
      ok: true,
      code: queued > 0 ? "QUEUED" : "NOTHING_TO_QUEUE",
      correlation_id: d.correlation_id ?? null,
      queued,
      duplicates_suppressed: d.duplicates_suppressed ?? 0,
      blocked_r1: d.blocked_r1 ?? 0,
      blocked_r2: d.blocked_r2 ?? 0,
      skipped_preference: d.skipped_preference ?? 0,
      skipped_channel_disabled: d.skipped_channel_disabled ?? 0,
      queued_by_channel: {
        portal: Number(byCh.portal ?? 0),
        email: Number(byCh.email ?? 0),
        whatsapp: Number(byCh.whatsapp ?? 0),
      },
      ids: Array.isArray(d.ids) ? d.ids : [],
    };
  } catch (e) {
    const out = emptyEnqueue("ENQUEUE_FAILED");
    out.error = String(e).slice(0, 200);
    return out;
  }
}

/** One structured log line per dispatch. Blocked counts are surfaced, never hidden. */
export function logCommsOutcome(tag: string, event: string, o: CommsEnqueueOutcome): void {
  log(tag, {
    event, ok: o.ok, code: o.code, correlation_id: o.correlation_id,
    queued: o.queued, duplicates_suppressed: o.duplicates_suppressed,
    blocked_r1: o.blocked_r1, blocked_r2: o.blocked_r2,
    skipped_preference: o.skipped_preference,
    skipped_channel_disabled: o.skipped_channel_disabled,
    error: o.error,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// DRAIN
// ─────────────────────────────────────────────────────────────────────────────

export interface CommsDrainResult {
  ok: boolean;
  code: "OK" | "HUB_NOT_INSTALLED" | "SERVER_NOT_CONFIGURED" | "DRAIN_FAILED";
  claimed: number;
  simulated: number;      // settled 'sent' while dry_run — NOT a delivery
  live_sent: number;      // settled 'sent' with a real provider ack. Expect 0.
  deferred: number;       // channel unavailable → requeued, no attempt burned
  failed: number;
  requeued_stuck: number;
  dead_lettered_stuck: number;
  error?: string;
}

interface OutboxRow {
  id: string; channel: string; event_key: string; correlation_id: string;
  idempotency_key: string | null; recipient_address: string | null;
  recipient_user_id: string | null; locale: string; subject: string; body: string;
  action_url: string | null; audience_scope: string; dry_run: boolean;
}

const toMessage = (r: OutboxRow): CommsMessage => ({
  id: r.id,
  channel: (r.channel === "email" || r.channel === "whatsapp" ? r.channel : "portal"),
  event_key: r.event_key,
  correlation_id: r.correlation_id,
  idempotency_key: r.idempotency_key,
  recipient_address: r.recipient_address,
  recipient_user_id: r.recipient_user_id,
  locale: r.locale,
  subject: r.subject,
  body: r.body,
  action_url: r.action_url,
  audience_scope: r.audience_scope === "client" ? "client" : "internal",
  dry_run: r.dry_run,
});

/**
 * Claim → simulate → settle. Bounded and best-effort.
 *
 * Order matters: reap FIRST so a row whose worker died mid-flight is runnable
 * again before we claim. That mirrors lib/server/notifyWorker.ts:229 and exists
 * for the same reason — otherwise a crashed row waits for the next daily cron.
 */
export async function commsDrain(limit = 25, ids?: string[]): Promise<CommsDrainResult> {
  const out: CommsDrainResult = {
    ok: false, code: "DRAIN_FAILED", claimed: 0, simulated: 0, live_sent: 0,
    deferred: 0, failed: 0, requeued_stuck: 0, dead_lettered_stuck: 0,
  };
  try {
    if (!adminConfigured()) { out.code = "SERVER_NOT_CONFIGURED"; return out; }

    const reap = await rpcAsService<{ requeued?: number; dead_lettered?: number }>("comms_reap", {});
    if (!reap.ok) {
      const err = String((reap as { error?: string }).error ?? "");
      if (hubNotInstalled(err)) { out.code = "HUB_NOT_INSTALLED"; out.error = err.slice(0, 200); return out; }
    } else {
      out.requeued_stuck = reap.data?.requeued ?? 0;
      out.dead_lettered_stuck = reap.data?.dead_lettered ?? 0;
    }

    const claim = await rpcAsService<OutboxRow[]>("comms_claim", {
      p_limit: Math.max(1, Math.min(limit, 200)),
      p_ids: ids && ids.length > 0 ? ids : null,
    });
    if (!claim.ok) {
      const err = String((claim as { error?: string }).error ?? "claim_failed");
      out.code = hubNotInstalled(err) ? "HUB_NOT_INSTALLED" : "DRAIN_FAILED";
      out.error = err.slice(0, 200);
      return out;
    }

    const rows = Array.isArray(claim.data) ? claim.data : [];
    out.claimed = rows.length;

    for (const row of rows) {
      const m = toMessage(row);
      let res: CommsSendResult;
      try {
        res = await deliver(m);
      } catch (e) {
        res = {
          outcome: "failed", provider: "mock", providerMessageId: null,
          providerResponse: { ack: false, thrown: true },
          error: String(e).slice(0, 200), errorClass: "provider_exception",
        };
      }

      const settle = await rpcAsService<{ ok?: boolean; status?: string }>("comms_settle", {
        p_id: m.id,
        p_outcome: res.outcome,
        p_provider: res.provider,
        p_provider_message_id: res.providerMessageId,
        p_provider_response: res.providerResponse,
        p_error: res.error,
        p_error_class: res.errorClass,
      });

      const status = settle.ok ? settle.data?.status ?? "" : "";
      if (status === "sent" || status === "delivered") {
        if (m.dry_run) out.simulated++; else out.live_sent++;
      } else if (status === "queued") out.deferred++;
      else out.failed++;

      log("comms_drain_row", {
        id: m.id, channel: m.channel, event: m.event_key, dry_run: m.dry_run,
        outcome: res.outcome, settled_status: status,
        recipient: m.channel === "email" ? maskAddress(m.recipient_address) : m.recipient_user_id,
      });
    }

    out.ok = true;
    out.code = "OK";
    return out;
  } catch (e) {
    out.error = String(e).slice(0, 200);
    return out;
  }
}
