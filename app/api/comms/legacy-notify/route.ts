// ════════════════════════════════════════════════════════════════════════════
// /api/comms/legacy-notify — the SERVER ADAPTER that replaces the browser
// no-cors mail relay (the old lib/portal/notifyEmail.ts:57 `postNotify`).
//
// WHY THIS EXISTS
//   The audit (docs/NOTIFICATIONS_CURRENT_STATE_AUDIT.md §5, path D5) found the
//   most serious defect in the whole notification system: a `mode:"no-cors"`
//   POST fired from the BROWSER straight at the Google Apps Script mail relay —
//   including from the PUBLIC, ANONYMOUS opportunities page. That handed an
//   unauthenticated visitor a direct, unmetered, unlogged POST to the mail
//   relay, and the response was unreadable by construction, so nobody could
//   ever tell what happened.
//
//   This route is the compatible replacement. The browser now calls US, with
//   the user's own session, and we hand the event to the ONE unified pipeline
//   (comms_enqueue → comms_outbox → the drain → the mock provider).
//
// FOUR THINGS THIS ROUTE DELIBERATELY REFUSES
//   1. ANONYMOUS CALLERS. A valid portal Bearer token is required, and the
//      caller must additionally be staff (checked in the DATABASE, as that
//      user, via comms_is_staff()). There is NO public door. Ever.
//   2. CALLER-CHOSEN RECIPIENTS. The legacy payload carried a `To` field the
//      browser picked. It is read for the audit trail and then DISCARDED:
//      recipients come from comms_resolve() alone. A browser cannot address
//      mail to an arbitrary person any more.
//   3. `payload.direct`. The resolver's `direct` array is an open door
//      (audit §7) — it returns any user id the caller names with
//      email_allowed = true. It is stripped here and can never be set from a
//      browser.
//   4. THE OPPORTUNITIES EVENTS. `opportunity_new` / `opportunity_ack` came
//      from the anonymous page; they are refused outright. Their server-side
//      replacement already exists and already runs:
//      public.submit_opportunity_request() notifies the admins itself
//      (docs/opportunities_notifications_addendum_RUNME.sql:59,70).
//
// ⛔ NOTHING SENDS. This route never contacts a provider. It records the event
//    in the hub, whose channels ship disabled + dry_run, and answers with an
//    HONEST state — dry_run_completed / provider_unavailable /
//    HUB_NOT_INSTALLED — never "sent".
//
// RESIDUAL RISK, STATED RATHER THAN HIDDEN
//   A staff caller may name a project they are not a member of; recipients are
//   then resolved for THAT project. That is bounded by comms_is_staff, by the
//   30/minute per-user brake here, and by comms_rate_check per event in SQL —
//   but it is not zero, and it is the reason this route stays a closed
//   five-event vocabulary rather than a general "send a notification" endpoint.
// ════════════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import { authGetUserId, rpcAsUser, adminConfigured } from "@/lib/server/supabaseAdmin";
import { observeInHub } from "@/lib/server/commsLegacyAdapter";
import { hubNotInstalled } from "@/lib/server/commsHub";
import { rateLimit } from "@/lib/server/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = (tag: string, extra: Record<string, unknown>) => console.log(JSON.stringify({ tag, ...extra }));

/**
 * The closed vocabulary. A legacy browser event that is not in this map is
 * refused — the old path free-texted an `Event` string into the relay, which is
 * exactly how an unreviewed message shape reaches a recipient.
 */
const LEGACY_EVENT_MAP: Record<string, { hub: string; entity: string }> = {
  review_ready:    { hub: "deliverable.preview_sent",     entity: "deliverable" },
  final_delivered: { hub: "deliverable.final_ready",      entity: "deliverable" },
  staff_assigned:  { hub: "project.member_assigned",      entity: "project" },
  assignment_note: { hub: "project.assignment_note",      entity: "project" },
  review_update:   { hub: "deliverable.client_commented", entity: "deliverable" },
};

/** Refused by name, so the refusal reads as a decision rather than an omission. */
const ANONYMOUS_ORIGIN_EVENTS = ["opportunity_new", "opportunity_ack"];

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** Trim, cap, collapse whitespace and drop control characters. Never null. */
function clean(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  // eslint-disable-next-line no-control-regex
  return v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function bearer(req: Request): string {
  const a = req.headers.get("authorization") ?? "";
  return a.toLowerCase().startsWith("bearer ") ? a.slice(7).trim() : "";
}

/** Safe diagnostic. No secrets, no counts, nothing that needs authorization. */
export async function GET() {
  return NextResponse.json({
    ok: true,
    route: "comms/legacy-notify",
    purpose: "server adapter replacing the browser no-cors mail relay",
    accepts_anonymous: false,
    sends_anything: false,
    contacts_provider_directly: false,
    accepted_events: Object.keys(LEGACY_EVENT_MAP),
    refused_events: ANONYMOUS_ORIGIN_EVENTS,
    server_configured: adminConfigured(),
    note: "Recipients are resolved server-side. A caller-supplied To or direct[] is discarded.",
  });
}

export async function POST(req: Request) {
  if (!adminConfigured()) {
    return NextResponse.json({ ok: false, code: "server_not_configured", sent: false }, { status: 500 });
  }

  // ── Door: an authenticated portal session. There is no other door. ──
  const token = bearer(req);
  if (!token) {
    return NextResponse.json({
      ok: false, code: "not_authenticated", sent: false,
      message_ar: "انتهت الجلسة. سجّل الدخول من جديد.",
    }, { status: 401 });
  }
  const uid = await authGetUserId(token);
  if (!uid) {
    return NextResponse.json({
      ok: false, code: "not_authenticated", sent: false,
      message_ar: "انتهت الجلسة. سجّل الدخول من جديد.",
    }, { status: 401 });
  }

  // ── Abuse brake. Honest about its limits (lib/server/rateLimit.ts header):
  //    per-instance memory, a brake on accidents, not a security control. The
  //    real per-event limit lives in SQL (comms_rate_check). ──
  const rl = rateLimit(`comms_legacy_notify:${uid}`, 30, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({
      ok: false, code: "rate_limited", sent: false, retry_after_ms: rl.retryAfterMs,
      message_ar: "طلبات كثيرة خلال وقت قصير. حاول بعد قليل.",
    }, { status: 429 });
  }

  let body: Record<string, unknown> = {};
  try { body = (await req.json()) as Record<string, unknown>; } catch { body = {}; }

  const legacyEvent = clean(body.event, 60);
  if (ANONYMOUS_ORIGIN_EVENTS.includes(legacyEvent)) {
    // Refused on purpose. See the header: the server-side producer already runs.
    return NextResponse.json({
      ok: false, code: "event_not_relayable_from_browser", sent: false, event: legacyEvent,
      message_ar: "هذا الحدث يُنتَج من الخادم ولا يُرسَل من المتصفّح — لا يوجد ترحيل بريد عام.",
    }, { status: 400 });
  }
  const mapped = LEGACY_EVENT_MAP[legacyEvent];
  if (!mapped) {
    return NextResponse.json({
      ok: false, code: "unknown_legacy_event", sent: false, event: legacyEvent,
      message_ar: "حدث غير معروف — الأحداث مُعرَّفة في قائمة مغلقة.",
    }, { status: 400 });
  }

  const projectId = clean(body.project_id, 40);
  const entityId = clean(body.entity_id, 40);
  if (projectId && !UUID_RE.test(projectId)) {
    return NextResponse.json({ ok: false, code: "invalid_payload", field: "project_id", sent: false }, { status: 400 });
  }
  if (entityId && !UUID_RE.test(entityId)) {
    return NextResponse.json({ ok: false, code: "invalid_payload", field: "entity_id", sent: false }, { status: 400 });
  }

  // ── Authorization, in the database, AS THE USER. Hiding a button is not a
  //    control; this is the control. ──
  const staff = await rpcAsUser<boolean>("comms_is_staff", {}, token);
  if (!staff.ok) {
    const err = String((staff as { error?: string }).error ?? "");
    if (hubNotInstalled(err)) {
      // Code ships before SQL. Say so precisely — this is NOT a permission
      // problem and must never be reported as one.
      log("comms_legacy_notify", { uid, event: legacyEvent, code: "HUB_NOT_INSTALLED" });
      return NextResponse.json({
        ok: false, code: "HUB_NOT_INSTALLED", sent: false,
        message_ar: "الميزة بانتظار تفعيل قاعدة البيانات — شغّل docs/communications_hub_RUNME.sql.",
      }, { status: 200 });
    }
    return NextResponse.json({
      ok: false, code: "authorization_check_failed", sent: false,
      message_ar: "تعذّر التحقق من الصلاحية. لم يُرسَل شيء.",
    }, { status: 502 });
  }
  if (staff.data !== true) {
    return NextResponse.json({
      ok: false, code: "not_authorized", sent: false,
      message_ar: "لا تملك صلاحية إرسال إشعارات من هذا المسار.",
    }, { status: 403 });
  }

  // ── Build the hub payload. Everything the browser sent is treated as UNTRUSTED
  //    template text: capped, control-stripped, and never used to pick a
  //    recipient. `To`, `direct`, and any unknown key are discarded here. ──
  const vars = {
    project_name: clean(body.project_name, 200),
    entity_label: clean(body.entity_label, 200),
    actor_name: clean(body.actor_name, 120),
    details: clean(body.details, 2000),
  };
  const droppedTo = clean(body.to, 160);   // recorded for the audit, never used

  // The idempotency key is built in SQL from event + ENTITY + user + channel. A
  // null entity would collapse every occurrence of the event for one user into a
  // single key, so the second project assignment (or the second deliverable)
  // would be suppressed as a "duplicate" and silently never notified. For a
  // project-scoped event the project IS the entity, so fall back to it rather
  // than queue under a key that cannot distinguish two real events.
  const effectiveEntityId = entityId || (mapped.entity === "project" ? projectId : "");

  const out = await observeInHub(mapped.hub, {
    entity_type: mapped.entity,
    entity_id: effectiveEntityId || null,
    project_id: projectId || null,
    actor: uid,
    subject: "",
    body: vars.details,
    payload: {
      ...vars,
      legacy_event: legacyEvent,
      legacy_origin: "browser_adapter",
      // Proof, in the row itself, that a browser-chosen address was ignored.
      legacy_to_discarded: droppedTo ? true : false,
    },
    correlation_id: null,
  });

  log("comms_legacy_notify", {
    uid, legacy_event: legacyEvent, hub_event: mapped.hub, code: out.code,
    queued: out.queued, to_discarded: droppedTo ? true : false,
  });

  if (out.code === "HUB_NOT_INSTALLED" || out.code === "SERVER_NOT_CONFIGURED") {
    return NextResponse.json({
      ok: false, code: out.code, sent: false,
      message_ar: "الميزة بانتظار تفعيل قاعدة البيانات — شغّل docs/communications_hub_RUNME.sql.",
    }, { status: 200 });
  }

  // The owner may one day set COMMS_LEGACY_RELAY_ENABLED=true expecting a real
  // send. There is no real provider, so say so plainly instead of implying one.
  const relayRequested = (process.env.COMMS_LEGACY_RELAY_ENABLED ?? "false").trim() === "true";
  const code = relayRequested ? "provider_unavailable" : "dry_run_completed";

  return NextResponse.json({
    ok: out.ok,
    code,
    sent: false,
    dry_run: true,
    recorded: out.queued,
    duplicates_suppressed: out.duplicates_suppressed,
    blocked_r1: out.blocked_r1,
    blocked_r2: out.blocked_r2,
    correlation_id: out.correlation_id,
    hub_event: mapped.hub,
    message_ar: relayRequested
      ? "لا يوجد مزوّد بريد فعّال — سُجِّلت الرسالة ولم تُرسل. راجع docs/APPS_SCRIPT_DEPLOYMENT_GUIDE.md."
      : "وضع تجريبي — لن يتم إرسال رسالة حقيقية. سُجِّلت الرسالة في مركز الاتصالات فقط.",
  }, { status: 200 });
}
