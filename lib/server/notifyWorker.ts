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
//   • Backoff 10m·2^attempts; attempts>=MAX → terminal 'failed' (dead-letter).
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

interface DeliveryRow {
  id: string; recipient_email: string | null; recipient_id: string | null;
  subject: string; body_text: string | null; direct_url: string | null;
  attempts: number; status: string; created_at: string; event_id: string | null;
  notification_events: { event_type: string | null; entity_id: string | null; project_id: string | null; severity: string | null; direct_url: string | null } | null;
}

export interface QueueResult {
  claimed: number; sent: number; failed: number; retrying: number;
  dead_letter: number; skipped: number; backlog_deferred: number;
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

/** Drain up to `limit` due email_deliveries rows. Best-effort, never throws. */
export async function processQueue(limit = 30, maxAgeHours = DEFAULT_MAX_AGE_HOURS): Promise<QueueResult> {
  const out = emptyResult();
  const nowIso = new Date().toISOString();
  const staleIso = new Date(Date.now() - STALE_MS).toISOString();
  const cutoffIso = new Date(Date.now() - maxAgeHours * 3600_000).toISOString();
  const trace: Record<string, unknown>[] = [];

  // Reaper: reclaim rows whose PROCESSING LEASE expired — measured by time IN
  // 'processing', not row age. The atomic claim below stamps next_attempt_at with a
  // lease deadline (now+STALE); a still-in-flight row (send takes seconds, lease is
  // 1h) is never reclaimed, so a concurrent drainer cannot re-send it. Two passes:
  // (1) leased rows past deadline; (2) legacy in-flight rows with a null lease.
  await patchAsService(`email_deliveries?status=eq.processing&next_attempt_at=lt.${encodeURIComponent(nowIso)}`, { status: "pending", next_attempt_at: null });
  await patchAsService(`email_deliveries?status=eq.processing&next_attempt_at=is.null&created_at=lt.${encodeURIComponent(staleIso)}`, { status: "pending" });

  // Claim window: pending (or retrying = pending w/ attempts>0), attempts<MAX, DUE
  // (next_attempt_at NULL — brand-new rows — OR due), and within the backlog window.
  const q = await selectAsService<DeliveryRow[]>(
    `email_deliveries?select=id,recipient_email,recipient_id,subject,body_text,direct_url,attempts,status,created_at,event_id,notification_events(event_type,entity_id,project_id,severity,direct_url)` +
    `&status=eq.pending&attempts=lt.${MAX_ATTEMPTS}` +
    `&or=(next_attempt_at.is.null,next_attempt_at.lte.${encodeURIComponent(nowIso)})` +
    `&created_at=gte.${encodeURIComponent(cutoffIso)}` +
    `&order=created_at.asc&limit=${Math.max(1, Math.min(limit, 100))}`);
  if (!q.ok || !Array.isArray(q.data)) return out;

  // Trace outcomes must stay within the applied notification_delivery_log CHECK
  // ('portal_created','email_sent','email_failed','email_skipped','excluded',
  // 'resolved') — 9E ships no SQL. The retry-vs-dead-letter distinction rides in
  // meta.lifecycle so a forced-failure row still lands in the log (not dropped).
  const pushTrace = (d: DeliveryRow, outcome: "email_sent" | "email_failed" | "email_skipped", errorClass: string | null, lifecycle?: string) => {
    trace.push({
      correlation_id: d.event_id ?? undefined,
      event_type: d.notification_events?.event_type ?? "email_delivery",
      entity_type: "email_delivery", entity_id: d.notification_events?.entity_id ?? null,
      project_id: d.notification_events?.project_id ?? null,
      recipient_id: d.recipient_id ?? null, recipient_reason: null,
      channel: "email", outcome, error_class: errorClass,
      meta: { delivery_id: d.id, attempts: d.attempts, ...(lifecycle ? { lifecycle } : {}) },
    });
  };

  const leaseIso = new Date(Date.now() + STALE_MS).toISOString();
  for (const d of q.data) {
    // Atomic claim: only if still pending (blocks a second worker/cron/drain). Also
    // stamp a processing LEASE deadline so the reaper measures dwell-in-processing.
    const lock = await patchAsService(`email_deliveries?id=eq.${d.id}&status=eq.pending`, { status: "processing", next_attempt_at: leaseIso });
    if (!lock.ok) continue;
    out.claimed++;

    if (!d.recipient_email || !d.recipient_email.includes("@")) {
      await patchAsService(`email_deliveries?id=eq.${d.id}`, { status: "skipped", last_error: "no_email" });
      out.skipped++; pushTrace(d, "email_skipped", "no_email"); continue;
    }

    const res = await sendProjectEmail({
      to: [d.recipient_email], subject: d.subject, body: d.body_text,
      directUrl: d.direct_url ?? d.notification_events?.direct_url ?? null,
      eventType: d.notification_events?.event_type ?? null,
    });

    if (res.sent) {
      await patchAsService(`email_deliveries?id=eq.${d.id}`, {
        status: "sent", attempts: (d.attempts ?? 0) + 1, sent_at: new Date().toISOString(),
        provider_message_id: res.providerId ?? null, last_error: null,
      });
      out.sent++; pushTrace(d, "email_sent", null);
    } else if (res.reason === "disabled" || res.reason === "no_endpoint") {
      // External config gap — do NOT burn an attempt; retry after a longer delay.
      await patchAsService(`email_deliveries?id=eq.${d.id}`, {
        status: "pending", last_error: res.reason, next_attempt_at: new Date(Date.now() + 6 * 3600_000).toISOString(),
      });
      out.skipped++; pushTrace(d, "email_skipped", res.reason);
    } else {
      const attempts = (d.attempts ?? 0) + 1;
      const terminal = attempts >= MAX_ATTEMPTS;
      const backoffMin = 5 * Math.pow(2, attempts);   // 10m, 20m, 40m…
      await patchAsService(`email_deliveries?id=eq.${d.id}`, {
        status: terminal ? "failed" : "pending",
        attempts, last_error: (res.reason ?? "send_failed").slice(0, 200),
        next_attempt_at: terminal ? null : new Date(Date.now() + backoffMin * 60_000).toISOString(),
      });
      if (terminal) { out.dead_letter++; pushTrace(d, "email_failed", (res.reason ?? "send_failed").slice(0, 60), "dead_letter"); }
      else { out.retrying++; pushTrace(d, "email_failed", (res.reason ?? "send_failed").slice(0, 60), "retry_scheduled"); }
      out.failed++;
    }
  }

  // Best-effort lifecycle logging (never blocks the drain).
  if (trace.length > 0) { try { await rpcAsService("notification_trace", { p_rows: trace }); } catch { /* telemetry */ } }
  return out;
}
