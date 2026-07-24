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
import { rpcAsService, selectAsService, authAdminEmails, adminConfigured } from "@/lib/server/supabaseAdmin";
import { processQueue } from "@/lib/server/notifyWorker";
import { projectEmailEnabled, sendProjectEmail } from "@/lib/server/projectNotify";

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
  via?: "pipeline" | "fallback_no_sql";   // which path delivered (diagnostics)
}

interface EmitResult {
  ok?: boolean; error?: string; correlation_id?: string;
  expected_recipients?: number; new_ids?: string[]; delivery_ids?: string[];
}

// ── SQL-INDEPENDENT FALLBACK (Batch 11) ───────────────────────────────────────
// The canonical path needs notify_emit_event / notification_resolve_recipients to be
// applied on production. When they are NOT (PostgREST answers PGRST202 "function not
// found"), the entire notification would be lost — the owner would still get nothing.
// This fallback resolves recipients from BASE tables that always exist, and sends via
// the same single provider. It is a safety net, not a second pipeline: same sender,
// same channel, no new queue, and it only runs when the canonical RPC is unavailable.

/** True when the RPC simply is not deployed (as opposed to a real runtime error). */
function rpcNotDeployed(err: string): boolean {
  return /PGRST202|could not find the function|does not exist|schema cache|HTTP 404/i.test(err);
}

interface Recip { id: string; email: string }

/** Resolve management (+ project manager, + optionally the project's client users)
 *  using only base tables/functions that ship with the applied production schema. */
async function resolveRecipientsNoSql(projectId: string | null, includeClient: boolean): Promise<Recip[]> {
  const ids = new Set<string>();
  const byId: Record<string, string> = {};   // id → profiles.email (fallback only)

  // Management: owner / super_admin / admin / manager — always notified.
  const mgmt = await selectAsService<{ id: string; email: string | null }[]>(
    `profiles?select=id,email&account_status=eq.active&or=(account_type.eq.admin,staff_role.in.(super_admin,manager))`);
  if (mgmt.ok && Array.isArray(mgmt.data)) {
    for (const p of mgmt.data) { if (p.id) { ids.add(p.id); if (p.email) byId[p.id] = p.email; } }
  }

  // Project manager(s) for this project.
  if (projectId) {
    const pm = await selectAsService<{ user_id: string | null }[]>(
      `project_members?select=user_id&project_id=eq.${encodeURIComponent(projectId)}&is_deleted=eq.false&role=eq.kian_manager`);
    if (pm.ok && Array.isArray(pm.data)) for (const m of pm.data) if (m.user_id) ids.add(m.user_id);
  }

  // Client users — only for client-facing events, via the base helper (guarded: if it
  // is unavailable we simply notify staff rather than failing the whole dispatch).
  if (includeClient && projectId) {
    const cu = await rpcAsService<{ user_id: string | null }[]>("project_client_user_ids", { p_project: projectId });
    if (cu.ok && Array.isArray(cu.data)) for (const c of cu.data) if (c.user_id) ids.add(c.user_id);
  }

  if (ids.size === 0) return [];
  // auth.users is authoritative for email (profiles.email is often blank for staff) —
  // this is the gap that used to drop management silently.
  const list = Array.from(ids);
  const authMap = await authAdminEmails(list);
  const out: Recip[] = [];
  const seen = new Set<string>();
  for (const id of list) {
    const email = (authMap[id] ?? byId[id] ?? "").trim().toLowerCase();
    if (!email.includes("@") || seen.has(email)) continue;
    seen.add(email);
    out.push({ id, email });
  }
  return out;
}

/** Deliver one event without any Batch-10/9G SQL. Sends per recipient; never throws. */
async function emitViaFallback(input: NotifyEmitInput, out: NotifyEmitOutcome): Promise<NotifyEmitOutcome> {
  const clientFacing = /preview_sent|final_ready|delivery_recorded/.test(input.event);
  const recips = await resolveRecipientsNoSql(input.project_id ?? null, clientFacing);
  out.via = "fallback_no_sql";
  out.expected = recips.length;
  if (recips.length === 0) { out.ok = true; out.code = "NO_RECIPIENTS"; return out; }
  const actionUrl = typeof input.payload?.action_url === "string" ? input.payload.action_url : null;
  let sent = 0;
  let lastReason: string | undefined;
  for (const r of recips) {
    const res = await sendProjectEmail({
      to: [r.email], subject: input.subject, body: input.body,
      directUrl: actionUrl, eventType: input.event,
    });
    if (res.sent) sent++; else lastReason = res.reason;
  }
  out.sent = sent;
  out.claimed = recips.length;
  out.ok = sent > 0;
  out.code = sent > 0 ? "SENT" : "EMAIL_ROWS_NOT_CLAIMED";
  if (sent === 0 && lastReason) out.error = lastReason.slice(0, 160);
  return out;
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
      // The canonical RPC simply is not deployed yet → deliver anyway via base tables,
      // so notifications are never lost while the SQL is pending.
      if (!enq.ok && rpcNotDeployed(out.error)) return await emitViaFallback(input, out);
      return out;
    }
    out.via = "pipeline";

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
