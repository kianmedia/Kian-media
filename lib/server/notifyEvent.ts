// ════════════════════════════════════════════════════════════════════════════
// lib/server/notifyEvent.ts — the ONE notification dispatch helper (Batch 10 · Phase 2)
//
// This is the reusable embodiment of the business-action isolation law (Phase 1.3):
// a caller SAVES its operational row first, then calls emitEventEmail() best-effort.
// Every module uses THIS instead of resolving recipients and calling a sender itself
// (no direct-send bypass, no ad-hoc recipient queries, no second queue).
//
// It composes the canonical pieces only:
//   notify_emit_event (SQL) → resolves via notification_resolve_recipients, enqueues
//                             into email_deliveries with idempotency + correlation,
//                             returns the EXACT delivery IDs for this event;
//   processQueue (worker)   → processes exactly those IDs immediately (event-bound),
//                             with provider confirmation. Cron is the retry fallback.
//
// The returned outcome is honest and never throws: a caller can log it and surface the
// three-state UX without ever letting an email problem fail the saved action.
// ════════════════════════════════════════════════════════════════════════════
import { rpcAsService, adminConfigured } from "@/lib/server/supabaseAdmin";
import { processQueue } from "@/lib/server/notifyWorker";
import { projectEmailEnabled } from "@/lib/server/projectNotify";

export interface NotifyEmitInput {
  event: string;                 // e.g. "custody.assigned", "deliverable.download_recorded"
  entity_type: string;           // e.g. "custody", "deliverable", "project"
  entity_id?: string | null;
  project_id?: string | null;
  actor?: string | null;         // the user who triggered the action (self-suppression handled in SQL/resolver)
  subject: string;
  body: string;
  payload?: Record<string, unknown>; // { action_url, client_action_url, direct: [{user_id, reason}] }
  correlation_id?: string | null;
}

// Mirrors the shape the review route reports, so every module surfaces the same signals.
export interface NotifyEmitOutcome {
  ok: boolean;                   // nothing left to send (sent OR genuinely no recipients)
  code:
    | "SENT" | "NO_RECIPIENTS" | "EMAIL_ROWS_NOT_CLAIMED"
    | "EMAIL_ENQUEUE_FAILED" | "SERVER_NOT_CONFIGURED" | "EMAIL_NOT_ATTEMPTED";
  correlation_id: string | null;
  expected: number;              // recipients the resolver produced
  queued: number;                // rows newly inserted this call (deduped repeats excluded)
  claimed: number;
  sent: number;
  error?: string;
}

interface EmitResult {
  ok?: boolean; error?: string; correlation_id?: string;
  expected_recipients?: number; new_ids?: string[]; delivery_ids?: string[];
}

/**
 * Enqueue + immediately process the email for one business event. Best-effort:
 * resolves recipients centrally, writes the queue rows, processes the exact IDs,
 * and returns an honest outcome. NEVER throws — the caller's saved action is safe.
 */
export async function emitEventEmail(input: NotifyEmitInput): Promise<NotifyEmitOutcome> {
  const out: NotifyEmitOutcome = {
    ok: false, code: "EMAIL_NOT_ATTEMPTED", correlation_id: null,
    expected: 0, queued: 0, claimed: 0, sent: 0,
  };
  try {
    if (!adminConfigured()) { out.code = "SERVER_NOT_CONFIGURED"; return out; }

    const enq = await rpcAsService<EmitResult>("notify_emit_event", {
      p_event: input.event,
      p_entity_type: input.entity_type,
      p_entity_id: input.entity_id ?? null,
      p_project: input.project_id ?? null,
      p_actor: input.actor ?? null,
      p_subject: input.subject,
      p_body: input.body,
      p_payload: input.payload ?? {},
      p_correlation: input.correlation_id ?? null,
    });
    if (!enq.ok || !enq.data || enq.data.ok === false) {
      out.code = "EMAIL_ENQUEUE_FAILED";
      const dataErr = enq.ok && enq.data ? enq.data.error : undefined;
      out.error = String((enq as { error?: string }).error ?? dataErr ?? "enqueue_failed").slice(0, 160);
      return out;
    }

    const deliveryIds = Array.isArray(enq.data.delivery_ids) ? enq.data.delivery_ids : [];
    out.correlation_id = enq.data.correlation_id ?? null;
    out.expected = typeof enq.data.expected_recipients === "number" ? enq.data.expected_recipients : deliveryIds.length;
    out.queued = Array.isArray(enq.data.new_ids) ? enq.data.new_ids.length : 0;

    const processed = deliveryIds.length > 0
      ? await processQueue(deliveryIds.length, { deliveryIds })
      : { claimed: 0, sent: 0, retrying: 0, dead_letter: 0, failed: 0, skipped: 0, backlog_deferred: 0, perId: {} as Record<string, string> };
    const alreadySent = Object.values(processed.perId ?? {}).filter((o) => o === "already_sent").length;
    const anySent = processed.sent > 0 || alreadySent > 0;
    out.claimed = processed.claimed;
    out.sent = processed.sent;
    out.ok = out.expected === 0 || anySent;
    out.code = out.expected === 0 ? "NO_RECIPIENTS" : anySent ? "SENT" : "EMAIL_ROWS_NOT_CLAIMED";
  } catch (e) {
    out.code = "EMAIL_ENQUEUE_FAILED";
    out.error = String(e).slice(0, 160);
  }
  return out;
}

/** Structured log line for a dispatch outcome (admin-facing; correlation id is internal). */
export function logEmitOutcome(tag: string, event: string, o: NotifyEmitOutcome): void {
  console.log(JSON.stringify({
    tag, event, notification_ok: o.ok, notification_code: o.code,
    correlation_id: o.correlation_id, expected_recipients: o.expected,
    queued: o.queued, claimed: o.claimed, sent: o.sent,
    email_channel_enabled: projectEmailEnabled(), error: o.error,
  }));
}
