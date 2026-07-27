// ════════════════════════════════════════════════════════════════════════
// Kian — SERVER-ONLY email-queue worker (shared).
//
// Extracted (Batch 9D) and hardened (Batch 9E) so the daily cron, the admin
// "process now" button, AND the immediate-dispatch drain all run the SAME logic:
//   • Reaper: rows stuck in 'processing' > STALE_MS return to 'pending'.
//   • Backlog cutoff: only rows created within maxAgeHours are auto-claimed;
//     older rows are LEFT untouched (no mass blast) for admin review/expiry.
//   • Atomic claim: pending → processing only if still pending (no double-send).
//   • Provider confirmation: 'sent' ONLY when the relay body confirms acceptance
//     (sendProjectEmail reads the Apps Script response) — not on bare HTTP 200.
//   • Backoff 5m·2^attempts → 10m, 20m, 40m, 80m; attempts>=MAX → terminal 'failed'
//     (dead-letter). The formula is at :104 and matches NOTIFICATION_EVENT_CONTRACT.md:175.
//   • disabled/no_endpoint keep the row 'pending' (config gap, not a burned try).
//   • Every row's email lifecycle is written to notification_delivery_log.
// Never throws in a way that breaks the caller. No secrets/full emails logged.
// Status vocabulary stays the applied CHECK set (pending/processing/sent/failed/
// skipped/bounced) so NO migration is required; 'retrying'/'dead_letter' are
// REPORTED distinctly in the result (retrying = pending w/ attempts>0; dead_letter
// = failed w/ attempts>=MAX), and the monitor derives them the same way.
// ════════════════════════════════════════════════════════════════════════
import { selectAsService, patchAsService, rpcAsService } from "@/lib/server/supabaseAdmin";
import { sendProjectEmail } from "@/lib/server/projectNotify";

const MAX_ATTEMPTS = 5;
const STALE_MS = 3600_000;                 // 1h → reclaim stuck 'processing'
const DEFAULT_MAX_AGE_HOURS = 24;          // backlog cutoff for auto-send
/** The cron's lookback. MUST stay wider than the cron interval or rows age out of the
 *  auto-claim window and strand forever. Exported so the admin "expire old backlog"
 *  control discards on the SAME horizon the cron would still have delivered on —
 *  previously it expired at 24h while the cron looked back 168h. */
export const RECOVERY_WINDOW_HOURS = 168;

interface DeliveryRow {
  id: string; recipient_email: string | null; recipient_id: string | null;
  subject: string; body_text: string | null; direct_url: string | null;
  attempts: number; status: string; created_at: string; next_attempt_at: string | null; event_id: string | null;
  notification_events: { event_type: string | null; entity_id: string | null; project_id: string | null; severity: string | null; direct_url: string | null } | null;
}

export interface QueueResult {
  claimed: number; sent: number; failed: number; retrying: number;
  dead_letter: number; skipped: number; backlog_deferred: number;
  perId?: Record<string, string>;   // exact-ID mode: id → outcome
}

const emptyResult = (): QueueResult => ({ claimed: 0, sent: 0, failed: 0, retrying: 0, dead_letter: 0, skipped: 0, backlog_deferred: 0 });

/** Count pending rows not yet due — helps callers report why nothing was claimed. */
export async function pendingBacklog(maxAgeHours = DEFAULT_MAX_AGE_HOURS): Promise<{ total: number; recent: number; old: number }> {
  const cutoff = new Date(Date.now() - maxAgeHours * 3600_000).toISOString();
  const all = await selectAsService<{ id: string }[]>(`email_deliveries?select=id&status=eq.pending&limit=1000`);
  const old = await selectAsService<{ id: string }[]>(`email_deliveries?select=id&status=eq.pending&created_at=lt.${encodeURIComponent(cutoff)}&limit=1000`);
  const total = all.ok && Array.isArray(all.data) ? all.data.length : 0;
  const oldN = old.ok && Array.isArray(old.data) ? old.data.length : 0;
  return { total, recent: Math.max(0, total - oldN), old: oldN };
}

export interface ProcessOpts { maxAgeHours?: number; recentMinutes?: number; deliveryIds?: string[] }

const SELECT_COLS = `id,recipient_email,recipient_id,subject,body_text,direct_url,attempts,status,created_at,next_attempt_at,event_id,notification_events(event_type,entity_id,project_id,severity,direct_url)`;
const traceRow = (d: DeliveryRow, outcome: "email_sent" | "email_failed" | "email_skipped", errorClass: string | null, lifecycle?: string) => ({
  correlation_id: d.event_id ?? undefined,
  event_type: d.notification_events?.event_type ?? "email_delivery",
  entity_type: "email_delivery", entity_id: d.notification_events?.entity_id ?? null,
  project_id: d.notification_events?.project_id ?? null,
  recipient_id: d.recipient_id ?? null, recipient_reason: null,
  channel: "email", outcome, error_class: errorClass,
  meta: { delivery_id: d.id, attempts: d.attempts, ...(lifecycle ? { lifecycle } : {}) },
});

// Claim + send ONE already-selected row. Returns a per-row outcome and mutates
// counts/trace. Atomic claim (pending→processing only if still pending) blocks a
// concurrent worker; a processing LEASE (next_attempt_at=now+STALE) lets the reaper
// measure dwell-in-processing so an in-flight row is never re-sent.
async function processRow(d: DeliveryRow, leaseIso: string, out: QueueResult, trace: Record<string, unknown>[]): Promise<string> {
  // ATTEMPT IS BURNED AT CLAIM TIME, not on completion. Previously `attempts` was only
  // written by the terminal PATCHes below, so a send whose result PATCH never landed
  // (network throw / non-2xx / zero rows matched — patchAsService reports all three as
  // ok:false) left the row 'processing' with attempts UNCHANGED. The reaper then returned
  // it to 'pending' without burning anything, so it could never reach MAX_ATTEMPTS: it
  // re-sent once per cron run for the whole recovery window and then stranded at
  // attempts=0, invisible to every health signal. Counting at claim makes delivery
  // bounded at-least-once — a crashed in-flight row costs exactly one attempt.
  const claimedAttempts = (d.attempts ?? 0) + 1;
  const lock = await patchAsService(`email_deliveries?id=eq.${d.id}&status=eq.pending`,
    { status: "processing", attempts: claimedAttempts, next_attempt_at: leaseIso });
  if (!lock.ok) return "claim_conflict";
  out.claimed++;
  if (!d.recipient_email || !d.recipient_email.includes("@")) {
    await patchAsService(`email_deliveries?id=eq.${d.id}`, { status: "skipped", last_error: "no_email" });
    out.skipped++; trace.push(traceRow(d, "email_skipped", "no_email")); return "skipped";
  }
  const res = await sendProjectEmail({
    to: [d.recipient_email], subject: d.subject, body: d.body_text,
    directUrl: d.direct_url ?? d.notification_events?.direct_url ?? null,
    eventType: d.notification_events?.event_type ?? null,
  });
  if (res.sent) {
    const done = await patchAsService(`email_deliveries?id=eq.${d.id}`, {
      status: "sent", attempts: claimedAttempts, sent_at: new Date().toISOString(),
      provider_message_id: res.providerId ?? null, last_error: null,
    });
    // The relay accepted it, but we could not record that. Do NOT report it as sent —
    // counting a row we failed to persist is how a run reports success while the row is
    // still 'processing'. Leave it for the reaper: the attempt is already burned, so it
    // now terminates instead of looping. A redelivery is possible here; that is the
    // accepted cost of at-least-once without a distributed transaction, and it is
    // bounded by MAX_ATTEMPTS rather than unbounded as before.
    if (!done.ok) {
      out.retrying++;
      trace.push(traceRow(d, "email_failed", "sent_unconfirmed", "sent_unconfirmed"));
      return "sent_unconfirmed";
    }
    out.sent++; trace.push(traceRow(d, "email_sent", null)); return "sent";
  }
  // CHANNEL-level conditions: the message is fine, the channel is not. Defer the row
  // (keep it pending, do NOT burn an attempt and do NOT dead-letter) so nothing is lost
  // and no duplicate is risked. Batch 11 adds relay_handler_missing — the Apps Script has
  // not been patched with the portal_notify handler, so NOTHING would be delivered; a
  // shorter defer lets the whole queue self-heal soon after the handler is applied.
  if (res.reason === "disabled" || res.reason === "no_endpoint" || res.reason === "relay_handler_missing") {
    const deferMs = res.reason === "relay_handler_missing" ? 30 * 60_000 : 6 * 3600_000;
    // ⚠️ HAND THE ATTEMPT BACK. Claiming now burns an attempt up front, but a channel
    // condition is not the message's fault: the relay is disabled, unconfigured, or the
    // Apps Script handler is not deployed. If these burned attempts, an undeployed
    // handler would dead-letter the entire queue in MAX_ATTEMPTS cron runs — destroying
    // exactly the mail this deferral exists to preserve. Restoring the pre-claim value
    // keeps the established behaviour: defer, lose nothing, self-heal once the channel
    // returns. Only a genuine send failure (below) is allowed to consume the attempt.
    await patchAsService(`email_deliveries?id=eq.${d.id}`, {
      status: "pending", attempts: d.attempts ?? 0, last_error: res.reason,
      next_attempt_at: new Date(Date.now() + deferMs).toISOString(),
    });
    out.skipped++; trace.push(traceRow(d, "email_skipped", res.reason)); return "channel_" + res.reason;
  }
  // Real send failure: the attempt claimed above stands.
  const attempts = claimedAttempts;
  const terminal = attempts >= MAX_ATTEMPTS;
  const backoffMin = 5 * Math.pow(2, attempts);
  await patchAsService(`email_deliveries?id=eq.${d.id}`, {
    status: terminal ? "failed" : "pending",
    attempts, last_error: (res.reason ?? "send_failed").slice(0, 200),
    next_attempt_at: terminal ? null : new Date(Date.now() + backoffMin * 60_000).toISOString(),
  });
  out.failed++;
  if (terminal) { out.dead_letter++; trace.push(traceRow(d, "email_failed", (res.reason ?? "send_failed").slice(0, 60), "dead_letter")); return "dead_letter"; }
  out.retrying++; trace.push(traceRow(d, "email_failed", (res.reason ?? "send_failed").slice(0, 60), "retry_scheduled")); return "retrying";
}

/** Return rows whose processing LEASE expired to a runnable state.
 *
 *  Because the attempt is now burned at claim time, a reclaimed row already carries the
 *  cost of the attempt that died — so this classifies rather than counts: a row that has
 *  reached MAX_ATTEMPTS terminates as 'failed' (dead-letter) instead of cycling forever.
 *  The previous bulk PATCH could only ever set rows back to 'pending', which is why a row
 *  whose send kept dying was immortal.
 *
 *  SCOPED, and deliberately so. `ids` restricts the sweep to the rows the caller is about
 *  to process. The event-bound path runs inside a user-facing request (a client pressing
 *  approve / request-revision), so an unscoped sweep there could issue up to 200 sequential
 *  PATCHes and stall that request on rows the request has nothing to do with. Scoped, it
 *  touches only that event's own recipients — typically a handful. The daily cron passes no
 *  ids and does the full bounded sweep, which is where a global backlog belongs.
 *
 *  Bounded and best-effort: reclamation must never throw into the caller. */
async function reapStuck(nowMs: number, ids?: string[]): Promise<void> {
  try {
    if (ids && ids.length === 0) return;
    const nowIso = new Date(nowMs).toISOString();
    const staleIso = new Date(nowMs - STALE_MS).toISOString();
    const scope = ids && ids.length > 0 ? `&id=in.(${ids.join(",")})` : "";
    // Expired lease, or a legacy row claimed before leases existed (null lease + old).
    const q = await selectAsService<{ id: string; attempts: number }[]>(
      `email_deliveries?select=id,attempts&status=eq.processing` + scope +
      `&or=(next_attempt_at.lt.${encodeURIComponent(nowIso)},` +
      `and(next_attempt_at.is.null,created_at.lt.${encodeURIComponent(staleIso)}))` +
      `&limit=200`);
    if (!q.ok || !Array.isArray(q.data)) return;
    for (const r of q.data) {
      const attempts = r.attempts ?? 0;
      const terminal = attempts >= MAX_ATTEMPTS;
      const backoffMin = 5 * Math.pow(2, Math.max(1, attempts));
      await patchAsService(`email_deliveries?id=eq.${r.id}&status=eq.processing`, {
        status: terminal ? "failed" : "pending",
        last_error: "reclaimed_stuck_processing",
        next_attempt_at: terminal ? null : new Date(nowMs + backoffMin * 60_000).toISOString(),
      });
    }
  } catch { /* reclamation is best-effort; never break the drain */ }
}

/** Drain email_deliveries rows. Best-effort, never throws.
 *  Batch 9G: opts.deliveryIds = EXACT-ID mode — process precisely those rows (the
 *  current event's), with NO created_at window and a per-id outcome map. This is the
 *  authoritative immediate path (the enqueue returns the ids). Otherwise: the generic
 *  scan (cron fallback) with recentMinutes/maxAgeHours windowing. */
export async function processQueue(limit = 30, opts: ProcessOpts = {}): Promise<QueueResult> {
  const out = emptyResult();
  const nowMs = Date.now();
  const leaseIso = new Date(nowMs + STALE_MS).toISOString();
  const trace: Record<string, unknown>[] = [];

  // ─── EXACT-ID MODE (event-bound) ───
  if (opts.deliveryIds && opts.deliveryIds.length > 0) {
    const ids = Array.from(new Set(opts.deliveryIds.filter((s) => typeof s === "string" && s.length > 0)));
    // Reclaim expired leases for THESE rows before reading them. Reclamation used to live
    // only in the generic scan, below this branch's early return — so an event-bound row
    // whose worker died mid-send stayed 'processing' until the next daily cron, and this
    // path reported claim_conflict instead of recovering it. Scoped to the event's own
    // rows so a user-facing request never pays for an unrelated global backlog.
    await reapStuck(nowMs, ids);
    out.perId = {};
    for (const id of ids) out.perId[id] = "not_found";
    if (ids.length > 0) {
      const q = await selectAsService<DeliveryRow[]>(`email_deliveries?select=${SELECT_COLS}&id=in.(${ids.join(",")})&limit=${Math.min(ids.length, 200)}`);
      if (q.ok && Array.isArray(q.data)) {
        for (const d of q.data) {
          if (d.status === "sent") { out.perId[d.id] = "already_sent"; continue; }
          if (d.status === "failed" || d.status === "bounced") { out.perId[d.id] = "already_failed"; continue; }
          if (d.status === "skipped") { out.perId[d.id] = "skipped"; out.skipped++; continue; }
          if (d.status === "processing") { out.perId[d.id] = "claim_conflict"; continue; }
          // pending:
          if ((d.attempts ?? 0) >= MAX_ATTEMPTS) { out.perId[d.id] = "already_failed"; continue; }
          const na = d.next_attempt_at ? new Date(d.next_attempt_at).getTime() : 0;
          if (na > nowMs) { out.perId[d.id] = "not_due"; continue; }
          out.perId[d.id] = await processRow(d, leaseIso, out, trace);
        }
      }
    }
    if (trace.length > 0) { try { await rpcAsService("notification_trace", { p_rows: trace }); } catch { /* telemetry */ } }
    return out;
  }

  // ─── GENERIC SCAN (fallback) ───
  // Full unscoped sweep: this is the cron, so a global backlog of stuck rows is exactly
  // its job, and there is no user waiting on the response.
  await reapStuck(nowMs);
  const nowIso = new Date(nowMs).toISOString();
  const windowMs = opts.recentMinutes != null
    ? Math.max(1, opts.recentMinutes) * 60_000
    : (opts.maxAgeHours ?? DEFAULT_MAX_AGE_HOURS) * 3600_000;
  const cutoffIso = new Date(nowMs - windowMs).toISOString();

  const q = await selectAsService<DeliveryRow[]>(
    `email_deliveries?select=${SELECT_COLS}` +
    `&status=eq.pending&attempts=lt.${MAX_ATTEMPTS}` +
    `&or=(next_attempt_at.is.null,next_attempt_at.lte.${encodeURIComponent(nowIso)})` +
    `&created_at=gte.${encodeURIComponent(cutoffIso)}` +
    `&order=created_at.asc&limit=${Math.max(1, Math.min(limit, 100))}`);
  if (!q.ok || !Array.isArray(q.data)) return out;

  for (const d of q.data) { await processRow(d, leaseIso, out, trace); }

  if (trace.length > 0) { try { await rpcAsService("notification_trace", { p_rows: trace }); } catch { /* telemetry */ } }
  return out;
}
