// ════════════════════════════════════════════════════════════════════════
// POST /api/integrations/project/notify   (SERVER-ONLY, EVENT-BOUND)
//
// Batch 9G — preview / final-ready email, unified on the QUEUE (no direct-send
// + queue-send double). One RPC (deliverable_preview_enqueue_notifications)
// enqueues the exact recipients (management + PM + assignee + authorized client)
// with a correlation_id + idempotency_key and RETURNS their delivery IDs; then
// the worker processes precisely those IDs (no time window, no old backlog).
// If recipients were expected but nothing could be sent → HTTP 502
// EMAIL_ROWS_NOT_CLAIMED, never a false success. Authorization (is_staff) is
// enforced inside the RPC. No secrets/tokens logged.
// ════════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import { authGetUserId, rpcAsUser, selectAsService, patchAsService, adminConfigured } from "@/lib/server/supabaseAdmin";
import { projectEmailEnabled } from "@/lib/server/projectNotify";
import { processQueue } from "@/lib/server/notifyWorker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const log = (tag: string, extra: Record<string, unknown>) => console.log(JSON.stringify({ tag, ...extra }));
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const enc = (v: string) => encodeURIComponent(v);

// Best-effort per-(user,deliverable,event) rate limit — stops double-click floods.
const lastCall = new Map<string, number>();
const RATE_MS = 3000;
const ALLOWED = new Set(["deliverable.preview_sent", "deliverable.final_ready", "project.delivery_recorded"]);

interface EnqueueResult { ok?: boolean; correlation_id?: string; entity_id?: string; project_id?: string; expected_recipients?: number; new_ids?: string[]; delivery_ids?: string[] }

export async function GET() {
  return NextResponse.json({ ok: true, email_enabled: projectEmailEnabled(), service_key_present: adminConfigured() });
}

export async function POST(req: Request) {
  const t0 = Date.now();
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!bearer) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  let b: Record<string, unknown>;
  try { b = (await req.json()) as Record<string, unknown>; } catch { return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 }); }
  const event = str(b.event);
  const deliverableId = str(b.deliverable_id);
  if (!ALLOWED.has(event)) return NextResponse.json({ ok: false, error: "invalid_event" }, { status: 400 });
  if (!deliverableId) return NextResponse.json({ ok: false, error: "missing_deliverable" }, { status: 400 });

  const uid = await authGetUserId(bearer);
  if (!uid) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!adminConfigured()) return NextResponse.json({ ok: true, email: false, reason: "server_not_configured" }, { status: 200 });

  const rlKey = `${uid}:${event}:${deliverableId}`;
  const nowMs = Date.now();
  if (nowMs - (lastCall.get(rlKey) ?? 0) < RATE_MS) return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  lastCall.set(rlKey, nowMs);

  // 1) EVENT-BOUND ENQUEUE — authorization (is_staff) + recipient resolution +
  //    exact delivery IDs, all in the RPC. Run AS THE USER so is_staff() applies.
  const rpc = await rpcAsUser<EnqueueResult>("deliverable_preview_enqueue_notifications",
    { p_deliverable: deliverableId, p_event: event, p_correlation: null }, bearer);
  if (!rpc.ok || !rpc.data) {
    const err = String((rpc as { error?: string }).error ?? "enqueue_failed");
    const denied = /not authorized|not_found/i.test(err);
    log("PROJECT_NOTIFY_ENQUEUE_FAILED", { event, error: err.slice(0, 160) });
    return NextResponse.json({ ok: false, error: err.slice(0, 160) }, { status: denied ? 403 : 200 });
  }
  const correlationId = rpc.data.correlation_id ?? null;
  const deliveryIds = Array.isArray(rpc.data.delivery_ids) ? rpc.data.delivery_ids : [];
  const newIds = Array.isArray(rpc.data.new_ids) ? rpc.data.new_ids : [];
  const expected = typeof rpc.data.expected_recipients === "number" ? rpc.data.expected_recipients : deliveryIds.length;

  // 2) ONE QUEUE SOURCE — suppress bridge-enqueued duplicates. The status-change
  //    triggers bridge a row for any email_enabled recipient; our explicit event-
  //    bound rows (which carry an idempotency_key; bridge rows do not and carry a
  //    notification_id) are authoritative. Mark the bridge rows for this deliverable
  //    'skipped' so we never send twice. Runs BEFORE the drain.
  if (deliveryIds.length > 0) {
    try {
      const notifs = await selectAsService<{ id: string }[]>(
        `notifications?entity_type=eq.deliverable&entity_id=eq.${enc(deliverableId)}&select=id&order=created_at.desc&limit=100`);
      const nids = notifs.ok && Array.isArray(notifs.data) ? notifs.data.map((n) => n.id) : [];
      if (nids.length > 0) {
        await patchAsService(
          `email_deliveries?status=eq.pending&idempotency_key=is.null&notification_id=in.(${nids.join(",")})`,
          { status: "skipped", last_error: "superseded_event_bound" });
      }
    } catch { /* best-effort de-dup */ }
  }

  // 3) Process EXACTLY those delivery IDs in this same request.
  const processed = deliveryIds.length > 0
    ? await processQueue(deliveryIds.length, { deliveryIds })
    : { claimed: 0, sent: 0, retrying: 0, dead_letter: 0, failed: 0, skipped: 0, backlog_deferred: 0, perId: {} as Record<string, string> };
  const alreadySent = Object.values(processed.perId ?? {}).filter((o) => o === "already_sent").length;
  const anySent = processed.sent > 0 || alreadySent > 0;

  const base = {
    correlation_id: correlationId, event, expected_recipients: expected, queued: newIds.length,
    claimed: processed.claimed, sent: processed.sent, retrying: processed.retrying,
    failed: processed.failed, delivery_ids: deliveryIds, email_channel_enabled: projectEmailEnabled(),
  };
  log("PROJECT_PREVIEW_EMAIL", {
    correlation_id: correlationId, event, expected_recipients: expected, delivery_ids_count: deliveryIds.length,
    queued: newIds.length, claimed: processed.claimed, sent: processed.sent, retrying: processed.retrying,
    failed: processed.failed, already_sent: alreadySent, duration_ms: Date.now() - t0,
    producer_stage: deliveryIds.length === 0 ? (expected === 0 ? "no_recipients" : "no_rows_created") : null,
  });

  if (expected > 0 && !anySent && processed.claimed === 0) {
    return NextResponse.json({ ok: false, code: "EMAIL_ROWS_NOT_CLAIMED", ...base }, { status: 502 });
  }
  return NextResponse.json({ ok: true, ...base }, { status: 200 });
}
