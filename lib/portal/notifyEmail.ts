// ════════════════════════════════════════════════════════════════════════
// Kian Portal — EMAIL notifications for the review workflow.
//
// Channel: the SAME Google Apps Script Web App the quote forms already use
// (lib/submitForm.ts → SHEETS_ENDPOINT). We POST a `_type: "portal_notify"`
// event; the Apps Script decides recipients + sends the mail server-side.
// This keeps ALL email credentials in the Apps Script (never in client code):
// no SMTP keys, no provider keys, no service-role key in the browser.
//
// ⚠️ DELIVERY IS NOT LIVE UNTIL the Apps Script `doPost` is extended to handle
// `_type === "portal_notify"` (see docs/portal_email_notifications.md). Until
// then this is a best-effort, fire-and-forget no-op on the mail side: the POST
// succeeds (opaque/no-cors) but no email is sent. We therefore NEVER block the
// UI on it and NEVER surface it as "email sent".
//
// WhatsApp is intentionally NOT implemented here — see the deferral note in
// docs/portal_email_notifications.md.
// ════════════════════════════════════════════════════════════════════════

import { SHEETS_ENDPOINT } from "@/lib/submitForm";

/** Best-effort POST to the Apps Script. Never throws; never blocks the caller. */
async function postNotify(fields: Record<string, string>): Promise<void> {
  try {
    if (typeof SHEETS_ENDPOINT !== "string" || !SHEETS_ENDPOINT.startsWith("https://")) return;
    await fetch(SHEETS_ENDPOINT, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ _type: "portal_notify", ...fields }),
    });
  } catch {
    /* fire-and-forget: a notification failure must never break the workflow */
  }
}

/** Portal deep-link to a project (no secrets; origin-relative). "" on the server. */
export function portalLink(projectId: string): string {
  if (typeof window === "undefined") return "";
  return `${window.location.origin}/client-portal/projects/${projectId}`;
}

/**
 * Client-facing "your work is ready for preview" email. Fired from the ADMIN's
 * browser when a deliverable is created in / moved to client_review. The admin
 * can read the client's email, so we include it as the recipient.
 */
export function notifyReviewReady(input: {
  projectId: string;
  projectName: string;
  deliverableTitle: string;
  clientEmail?: string | null;
}): Promise<void> {
  return postNotify({
    Event: "review_ready",
    Subject: "عملك جاهز للمعاينة - كيان",
    To: input.clientEmail ?? "",
    "Project Name": input.projectName,
    "Deliverable Title": input.deliverableTitle,
    Message: "العمل جاهز للمعاينة في بوابة العميل.",
    Link: portalLink(input.projectId),
  });
}

/**
 * Client-facing "final files delivered" email. Fired from the ADMIN's browser
 * when a deliverable is moved to final_delivered. Recipient is the client.
 */
export function notifyFinalDelivered(input: {
  projectId: string;
  projectName: string;
  deliverableTitle: string;
  clientEmail?: string | null;
}): Promise<void> {
  return postNotify({
    Event: "final_delivered",
    Subject: "تم التسليم النهائي - كيان",
    To: input.clientEmail ?? "",
    "Project Name": input.projectName,
    "Deliverable Title": input.deliverableTitle,
    Message: "تم تسليم النسخة النهائية من عملك.",
    Link: portalLink(input.projectId),
  });
}

/**
 * Staff-facing "you've been assigned to a project" email. Fired from the ADMIN's
 * browser when a staff member is assigned to a project. The admin can read staff
 * emails (profiles admin-all), so we include the recipient.
 */
export function notifyStaffAssigned(input: {
  projectId: string;
  projectName: string;
  staffEmail?: string | null;
  staffName?: string | null;
  role: string;
  note?: string | null;
}): Promise<void> {
  return postNotify({
    Event: "staff_assigned",
    Subject: "تم تكليفك بمشروع - كيان",
    To: input.staffEmail ?? "",
    "Staff Name": input.staffName ?? "",
    "Project Name": input.projectName,
    Role: input.role,
    Note: input.note ?? "",
    Message: "تم تكليفك بمشروع. فضلاً سجّل الدخول إلى البوابة لعرض التفاصيل.",
    Link: portalLink(input.projectId),
  });
}

/**
 * Staff-facing "new assignment note" email. Fired from the ADMIN's browser when
 * an assignment note is added (notes UI activates after the addendum runs).
 */
export function notifyAssignmentNote(input: {
  projectId: string;
  projectName: string;
  staffEmail?: string | null;
  staffName?: string | null;
  note: string;
}): Promise<void> {
  return postNotify({
    Event: "assignment_note",
    Subject: "ملاحظة جديدة على تكليفك - كيان",
    To: input.staffEmail ?? "",
    "Staff Name": input.staffName ?? "",
    "Project Name": input.projectName,
    Note: input.note,
    Message: "لديك ملاحظة جديدة من الإدارة على مشروعك المكلّف به.",
    Link: portalLink(input.projectId),
  });
}

/**
 * Kian/admin-facing "client review update" email. Fired from the CLIENT's
 * browser on approve / request-revision. We deliberately DO NOT send an admin
 * recipient from the client (clients can't read admin emails, and we won't leak
 * them into client code) — the Apps Script holds the configured Kian admin
 * address server-side and routes there.
 */
export function notifyReviewUpdate(input: {
  projectId: string;
  projectName: string;
  deliverableTitle: string;
  action: "approved" | "revision_requested";
  note?: string | null;
  clientName?: string | null;
  clientEmail?: string | null;
}): Promise<void> {
  return postNotify({
    Event: "review_update",
    Subject: "تحديث مراجعة من العميل - كيان",
    "Project Name": input.projectName,
    "Deliverable Title": input.deliverableTitle,
    Action: input.action,
    Note: input.note ?? "",
    "Client Name": input.clientName ?? "",
    "Client Email": input.clientEmail ?? "",
    Link: portalLink(input.projectId),
  });
}
