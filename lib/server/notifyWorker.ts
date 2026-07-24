// ════════════════════════════════════════════════════════════════════════
// Kian — SERVER-ONLY email-queue worker (shared).
//
// Extracted (Batch 9D) from app/api/cron/notify-email so BOTH the daily cron
// AND the admin "process queue now" button run the IDENTICAL drain logic:
//   • Reaper: processing rows stuck > 1h return to pending.
//   • Optimistic lock: pending → processing only if still pending (no double-send).
//   • Backoff 10m·2^attempts, max 5 attempts → failed (dead-letter).
//   • disabled/no_endpoint keep the row pending (+6h) — nothing is lost.
// Never throws in a way that breaks the caller. No secrets logged.
// ════════════════════════════════════════════════════════════════════════
import { selectAsService, patchAsService } from "@/lib/server/supabaseAdmin";
import { sendProjectEmail } from "@/lib/server/projectNotify";

interface DeliveryRow {
  id: string; recipient_email: string | null; subject: string; body_text: string | null;
  direct_url: string | null; attempts: number; status: string;
  notification_events: { event_type: string | null; severity: string | null; direct_url: string | null } | null;
}

export interface QueueResult { sent: number; failed: number; skipped: number }

/** Drain up to `limit` pending email_deliveries rows. Best-effort, never throws. */
export async function processQueue(limit = 30): Promise<QueueResult> {
  const out: QueueResult = { sent: 0, failed: 0, skipped: 0 };
  const nowIso = new Date().toISOString();
  const hourAgo = new Date(Date.now() - 3600_000).toISOString();
  await patchAsService(`email_deliveries?status=eq.processing&created_at=lt.${encodeURIComponent(hourAgo)}`, { status: "pending" });
  const q = await selectAsService<DeliveryRow[]>(
    `email_deliveries?select=id,recipient_email,subject,body_text,direct_url,attempts,status,notification_events(event_type,severity,direct_url)` +
    `&status=eq.pending&attempts=lt.5&or=(next_attempt_at.is.null,next_attempt_at.lte.${encodeURIComponent(nowIso)})` +
    `&order=created_at.asc&limit=${Math.max(1, Math.min(limit, 100))}`);
  if (!q.ok || !Array.isArray(q.data)) return out;
  for (const d of q.data) {
    const lock = await patchAsService(`email_deliveries?id=eq.${d.id}&status=eq.pending`, { status: "processing" });
    if (!lock.ok) continue;
    if (!d.recipient_email || !d.recipient_email.includes("@")) {
      await patchAsService(`email_deliveries?id=eq.${d.id}`, { status: "skipped", last_error: "no_email" });
      out.skipped++; continue;
    }
    const res = await sendProjectEmail({
      to: [d.recipient_email], subject: d.subject, body: d.body_text,
      directUrl: d.direct_url ?? d.notification_events?.direct_url ?? null,
      eventType: d.notification_events?.event_type ?? null,
    });
    if (res.sent) {
      await patchAsService(`email_deliveries?id=eq.${d.id}`, { status: "sent", sent_at: new Date().toISOString(), last_error: null });
      out.sent++;
    } else if (res.reason === "disabled" || res.reason === "no_endpoint") {
      await patchAsService(`email_deliveries?id=eq.${d.id}`, {
        status: "pending", last_error: res.reason, next_attempt_at: new Date(Date.now() + 6 * 3600_000).toISOString(),
      });
      out.skipped++;
    } else {
      const attempts = (d.attempts ?? 0) + 1;
      const backoffMin = 5 * Math.pow(2, attempts);
      await patchAsService(`email_deliveries?id=eq.${d.id}`, {
        status: attempts >= 5 ? "failed" : "pending",
        attempts, last_error: (res.reason ?? "send_failed").slice(0, 200),
        next_attempt_at: new Date(Date.now() + backoffMin * 60_000).toISOString(),
      });
      out.failed++;
    }
  }
  return out;
}
