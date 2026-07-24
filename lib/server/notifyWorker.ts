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
  const lock = await patchAsService(`email_deliveries?id=eq.${d.id}&status=eq.pending`, { status: "processing", next_attempt_at: leaseIso });
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
    await patchAsService(`email_deliveries?id=eq.${d.id}`, {
      status: "sent", attempts: (d.attempts ?? 0) + 1, sent_at: new Date().toISOString(),
      provider_message_id: res.providerId ?? null, last_error: null,
    });
    out.sent++; trace.push(traceRow(d, "email_sent", null)); return "sent";
  }
  if (res.reason === "disabled" || res.reason === "no_endpoint") {
    await patchAsService(`email_deliveries?id=eq.${d.id}`, {
      status: "pending", last_error: res.reason, next_attempt_at: new Date(Date.now() + 6 * 3600_000).toISOString(),
    });
    out.skipped++; trace.push(traceRow(d, "email_skipped", res.reason)); return "channel_" + res.reason;
  }
  const attempts = (d.attempts ?? 0) + 1;
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
  const nowIso = new Date(nowMs).toISOString();
  const staleIso = new Date(nowMs - STALE_MS).toISOString();
  const windowMs = opts.recentMinutes != null
    ? Math.max(1, opts.recentMinutes) * 60_000
    : (opts.maxAgeHours ?? DEFAULT_MAX_AGE_HOURS) * 3600_000;
  const cutoffIso = new Date(nowMs - windowMs).toISOString();

  // Reaper: reclaim rows whose PROCESSING LEASE expired (dwell-in-processing, not age).
  await patchAsService(`email_deliveries?status=eq.processing&next_attempt_at=lt.${encodeURIComponent(nowIso)}`, { status: "pending", next_attempt_at: null });
  await patchAsService(`email_deliveries?status=eq.processing&next_attempt_at=is.null&created_at=lt.${encodeURIComponent(staleIso)}`, { status: "pending" });

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
