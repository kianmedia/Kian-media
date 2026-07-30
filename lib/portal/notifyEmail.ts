// ════════════════════════════════════════════════════════════════════════
// Kian Portal — browser-side notification helpers for the review workflow.
//
// ⚠️ WHAT CHANGED, AND WHY IT MATTERED MOST
//   This file used to POST directly at the Google Apps Script mail relay with
//   an opaque cross-origin (no-cors) request from the BROWSER — including from the PUBLIC, ANONYMOUS
//   opportunities page. The audit rated that the single most serious defect in
//   the notification system (docs/NOTIFICATIONS_CURRENT_STATE_AUDIT.md §5, D5):
//     • an unauthenticated visitor got a direct, unmetered POST to the relay;
//     • the browser chose the recipient address;
//     • the response was opaque by construction, so nothing could be verified;
//     • nothing was queued, deduplicated, logged or auditable.
//
//   THE RELAY CALL IS GONE. There is no fetch to SHEETS_ENDPOINT in this file
//   and there must never be one again. Every helper now posts to the SERVER
//   adapter /api/comms/legacy-notify with the caller's own session; that route
//   authenticates, re-authorizes in the database, discards any caller-chosen
//   recipient, and hands the event to the ONE unified pipeline. Nothing sends:
//   the hub's channels ship disabled + dry_run and the provider is a mock.
//
//   The function signatures are UNCHANGED, so every existing caller keeps
//   working; they now return an honest outcome instead of a silent void.
//
// FEATURE FLAG. NEXT_PUBLIC_COMMS_LEGACY_NOTIFY_ENABLED = "false" stops these
// helpers from calling anything at all (they answer `disabled`). Default is
// enabled, because the adapter is safe by construction — it cannot send.
//
// ANONYMOUS SURFACES MUST NEVER CALL THIS. notifyOpportunityNew/Ack are kept
// only as refusing stubs: their server-side replacement already runs inside
// public.submit_opportunity_request().
// ════════════════════════════════════════════════════════════════════════

import { getValidSession } from "@/lib/portal/auth";

/**
 * Batch 9D — fire the SERVER-SIDE project/preview notification producer.
 *
 * Unlike the old opaque browser relay call (unverifiable, and it only ever
 * reached the client), this calls the authenticated
 * /api/integrations/project/notify route, which resolves the CANONICAL
 * recipient set (management + project manager + the deliverable assignee +
 * the actor as a confirmation + the authorized client), sends email
 * immediately via the (now opt-out enabled) project relay, and records the
 * delivery trace. Best-effort from the browser: the internal-staff portal rows
 * are written server-side by the 9D trigger regardless, so a failed fetch here
 * never loses the portal notification.
 */
export async function emitProjectDeliverableEvent(
  deliverableId: string,
  event: "deliverable.preview_sent" | "deliverable.final_ready" = "deliverable.preview_sent",
): Promise<void> {
  try {
    const s = await getValidSession();
    if (!s?.access_token) return;
    await fetch("/api/integrations/project/notify", {
      method: "POST", keepalive: true,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.access_token}` },
      body: JSON.stringify({ event, deliverable_id: deliverableId }),
    });
  } catch { /* best-effort: DB triggers still create the portal rows */ }
}

// Batch 9F: the browser fire-and-forget drain kick was removed — it proved
// unreliable in production (approval mail stayed pending). Draining is now
// SERVER-AUTHORITATIVE: the review/preview server routes call processQueue in
// the same request. Admin "Process now" remains available in the monitor.

// ─────────────────────────────────────────────────────────────────────────
// THE SERVER ADAPTER — the replacement for the old no-cors relay POST
// ─────────────────────────────────────────────────────────────────────────

/** Honest outcomes. `sent` is never one of them: nothing here can send. */
export type LegacyNotifyCode =
  | "dry_run_completed"         // recorded in the hub; deliberately not sent
  | "provider_unavailable"      // a relay was asked for; none is implemented
  | "relay_handler_missing"     // the Apps Script portal_notify branch is absent
  | "hub_not_installed"         // code shipped before the SQL was run
  | "suppressed_anonymous"      // no session ⇒ nothing is relayed, by design
  | "suppressed_server_side"    // a server-side producer already owns this event
  | "disabled"                  // switched off by the feature flag
  | "not_authorized"
  | "request_failed";

export interface LegacyNotifyOutcome {
  ok: boolean;
  code: LegacyNotifyCode;
  /** ALWAYS false. Kept explicit so no caller can infer a delivery. */
  sent: false;
  correlation_id?: string | null;
}

/** «وضع تجريبي — لن يتم إرسال رسالة حقيقية» — the sentence every send button shows. */
export const COMMS_DRY_RUN_NOTICE_AR = "وضع تجريبي — لن يتم إرسال رسالة حقيقية";

/** Off only when explicitly set to "false". The adapter is safe by construction. */
export function legacyNotifyEnabled(): boolean {
  return (process.env.NEXT_PUBLIC_COMMS_LEGACY_NOTIFY_ENABLED ?? "true") !== "false";
}

/**
 * Post one legacy event to the SERVER adapter. Never throws, never blocks a
 * workflow, and NEVER contacts a mail provider — that is the whole point of
 * this rewrite.
 *
 * Without a session it returns `suppressed_anonymous` WITHOUT making any
 * request. An anonymous page therefore cannot cause a mail relay call even by
 * accident, which is the specific hole that was open before.
 */
async function postNotify(
  event: string,
  fields: {
    project_id?: string | null;
    entity_id?: string | null;
    project_name?: string | null;
    entity_label?: string | null;
    actor_name?: string | null;
    details?: string | null;
    to?: string | null;      // recorded for the audit trail, never used to address mail
  },
): Promise<LegacyNotifyOutcome> {
  if (!legacyNotifyEnabled()) return { ok: false, code: "disabled", sent: false };
  try {
    const s = await getValidSession();
    if (!s?.access_token) return { ok: false, code: "suppressed_anonymous", sent: false };

    const res = await fetch("/api/comms/legacy-notify", {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.access_token}` },
      body: JSON.stringify({
        event,
        project_id: fields.project_id ?? null,
        entity_id: fields.entity_id ?? null,
        project_name: fields.project_name ?? "",
        entity_label: fields.entity_label ?? "",
        actor_name: fields.actor_name ?? "",
        details: fields.details ?? "",
        to: fields.to ?? "",
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { code?: string; correlation_id?: string | null };
    if (res.status === 403) return { ok: false, code: "not_authorized", sent: false };
    const code = String(body.code ?? "");
    if (code === "HUB_NOT_INSTALLED") return { ok: false, code: "hub_not_installed", sent: false };
    if (code === "provider_unavailable") return { ok: false, code: "provider_unavailable", sent: false };
    if (code === "dry_run_completed") {
      return { ok: true, code: "dry_run_completed", sent: false, correlation_id: body.correlation_id ?? null };
    }
    return { ok: false, code: "request_failed", sent: false };
  } catch {
    // A notification problem must never break the business action it followed.
    return { ok: false, code: "request_failed", sent: false };
  }
}

/** Portal deep-link to a project (no secrets; origin-relative). "" on the server. */
export function portalLink(projectId: string): string {
  if (typeof window === "undefined") return "";
  return `${window.location.origin}/client-portal/projects/${projectId}`;
}

/**
 * Client-facing "your work is ready for preview". Signature unchanged; the mail
 * itself is now composed from a REVIEWED server template, and the recipient is
 * resolved server-side rather than passed in from a browser.
 */
export function notifyReviewReady(input: {
  projectId: string;
  projectName: string;
  deliverableTitle: string;
  /** Pass it when you have it: it becomes the idempotency entity, so two
   *  different deliverables in one project are two events, not a duplicate. */
  deliverableId?: string | null;
  clientEmail?: string | null;
}): Promise<LegacyNotifyOutcome> {
  return postNotify("review_ready", {
    project_id: input.projectId,
    entity_id: input.deliverableId ?? null,
    project_name: input.projectName,
    entity_label: input.deliverableTitle,
    details: "العمل جاهز للمعاينة في بوابة العميل.",
    to: input.clientEmail ?? "",
  });
}

/** Client-facing "final files delivered". */
export function notifyFinalDelivered(input: {
  projectId: string;
  projectName: string;
  deliverableTitle: string;
  deliverableId?: string | null;
  clientEmail?: string | null;
}): Promise<LegacyNotifyOutcome> {
  return postNotify("final_delivered", {
    project_id: input.projectId,
    entity_id: input.deliverableId ?? null,
    project_name: input.projectName,
    entity_label: input.deliverableTitle,
    details: "تم تسليم النسخة النهائية من عملك.",
    to: input.clientEmail ?? "",
  });
}

/** Staff-facing "you've been assigned to a project". */
export function notifyStaffAssigned(input: {
  projectId: string;
  projectName: string;
  staffEmail?: string | null;
  staffName?: string | null;
  role: string;
  note?: string | null;
}): Promise<LegacyNotifyOutcome> {
  return postNotify("staff_assigned", {
    project_id: input.projectId,
    project_name: input.projectName,
    entity_label: input.staffName ?? "",
    actor_name: input.staffName ?? "",
    details: `الدور: ${input.role}${input.note ? " — " + input.note : ""}`,
    to: input.staffEmail ?? "",
  });
}

/** Staff-facing "new assignment note". */
export function notifyAssignmentNote(input: {
  projectId: string;
  projectName: string;
  staffEmail?: string | null;
  staffName?: string | null;
  note: string;
  /** The note's own id. Without it every note to the same person on the same
   *  project shares one idempotency key and only the first is ever notified. */
  noteId?: string | null;
}): Promise<LegacyNotifyOutcome> {
  return postNotify("assignment_note", {
    project_id: input.projectId,
    entity_id: input.noteId ?? null,
    project_name: input.projectName,
    entity_label: input.staffName ?? "",
    details: input.note,
    to: input.staffEmail ?? "",
  });
}

/**
 * Kian/admin-facing "client review update". Fired from the CLIENT's browser on
 * approve / request-revision. No admin address is passed — it never was, and
 * now the server would discard one anyway.
 */
export function notifyReviewUpdate(input: {
  projectId: string;
  projectName: string;
  deliverableTitle: string;
  action: "approved" | "revision_requested";
  deliverableId?: string | null;
  note?: string | null;
  clientName?: string | null;
  clientEmail?: string | null;
}): Promise<LegacyNotifyOutcome> {
  return postNotify("review_update", {
    project_id: input.projectId,
    entity_id: input.deliverableId ?? null,
    project_name: input.projectName,
    entity_label: input.deliverableTitle,
    actor_name: input.clientName ?? "",
    details: `${input.action === "approved" ? "اعتماد" : "طلب تعديل"}${input.note ? " — " + input.note : ""}`,
  });
}

// ─────────────────────────────────────────────────────────────────────────
// THE ANONYMOUS SURFACE — refusing stubs, kept so nobody re-opens the hole
//
// These two used to fire from the PUBLIC opportunities page. They are now
// hard no-ops: no fetch, no relay, no network call of any kind, whatever the
// session state. The notification they used to attempt is already produced
// SERVER-SIDE by public.submit_opportunity_request(), which calls notify()
// for the admins and for the matching portal user
// (docs/opportunities_notifications_addendum_RUNME.sql:59,70).
//
// Deleting them outright would silently change a public page's behaviour on
// upgrade; refusing loudly, with a code that says exactly why, does not.
// ─────────────────────────────────────────────────────────────────────────

const SERVER_SIDE_ONLY: LegacyNotifyOutcome = { ok: false, code: "suppressed_server_side", sent: false };

/** REFUSED FROM THE BROWSER. submit_opportunity_request() already notifies staff. */
export function notifyOpportunityNew(_input: {
  type: string; fullName: string; email?: string | null; phone?: string | null;
  city?: string | null; message?: string | null; requestNumber?: string | null;
}): Promise<LegacyNotifyOutcome> {
  void _input;
  return Promise.resolve(SERVER_SIDE_ONLY);
}

/** REFUSED FROM THE BROWSER. An applicant acknowledgement needs a server producer. */
export function notifyOpportunityAck(_input: {
  toEmail: string; fullName: string; requestNumber?: string | null;
}): Promise<LegacyNotifyOutcome> {
  void _input;
  return Promise.resolve(SERVER_SIDE_ONLY);
}
