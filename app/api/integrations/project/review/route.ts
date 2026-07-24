// ════════════════════════════════════════════════════════════════════════
// POST /api/integrations/project/review   (SERVER-ONLY, EVENT-BOUND)
//
// Batch 9G — the client approve/revision decision. Production proof: the old
// path returned 200 with claimed=0/sent=0 because the approval enqueued NO
// email_deliveries rows for the right recipients (admin-broadcast is bridge-
// skipped; the assignee trigger only fires when an assignee exists), so a
// generic recent-window scan had nothing to claim.
//
// This route is EVENT-BOUND: one RPC runs the mutation AND enqueues the exact
// recipients (management + PM + assignee) in the same transaction and RETURNS
// their delivery IDs; then the worker processes precisely those IDs (no time
// window, no old backlog). If recipients were expected but nothing could be
// sent, it returns HTTP 502 EMAIL_ROWS_NOT_CLAIMED — never a false success.
// The client's decision is persisted regardless (committed by the RPC).
// ════════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import { authGetUserId, rpcAsUser, adminConfigured } from "@/lib/server/supabaseAdmin";
import { projectEmailEnabled } from "@/lib/server/projectNotify";
import { processQueue } from "@/lib/server/notifyWorker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const log = (tag: string, extra: Record<string, unknown>) => console.log(JSON.stringify({ tag, ...extra }));
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

interface EnqueueResult { ok?: boolean; correlation_id?: string; decision?: string; entity_id?: string; project_id?: string; expected_recipients?: number; new_ids?: string[]; delivery_ids?: string[] }

export async function POST(req: Request) {
  const t0 = Date.now();
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!bearer) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  let b: Record<string, unknown>;
  try { b = (await req.json()) as Record<string, unknown>; } catch { return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 }); }
  const versionId = str(b.version_id);
  const decision = str(b.decision);
  const comments = typeof b.comments === "string" ? b.comments : null;
  if (!versionId) return NextResponse.json({ ok: false, error: "missing_version" }, { status: 400 });
  if (decision !== "approved" && decision !== "revision_requested") return NextResponse.json({ ok: false, error: "bad_decision" }, { status: 400 });

  const uid = await authGetUserId(bearer);
  if (!uid) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  // 1) MUTATION + EVENT-BOUND ENQUEUE in one RPC (authorization is enforced inside
  //    via client_review_version → is_client_owner). Returns the exact delivery IDs.
  const rpc = await rpcAsUser<EnqueueResult>("client_review_and_enqueue_notifications",
    { p_version: versionId, p_decision: decision, p_comments: comments, p_correlation: null }, bearer);
  if (!rpc.ok || !rpc.data) {
    const err = String((rpc as { error?: string }).error ?? "review_failed");
    const denied = /not authorized|not_found|not_current|not_in_review|bad_decision|reason_required/i.test(err);
    log("PROJECT_REVIEW_RPC_FAILED", { decision, error: err.slice(0, 160) });
    return NextResponse.json({ ok: false, error: err.slice(0, 160) }, { status: denied ? 403 : 200 });
  }
  const correlationId = rpc.data.correlation_id ?? null;
  const deliveryIds = Array.isArray(rpc.data.delivery_ids) ? rpc.data.delivery_ids : [];
  const newIds = Array.isArray(rpc.data.new_ids) ? rpc.data.new_ids : [];
  const expected = typeof rpc.data.expected_recipients === "number" ? rpc.data.expected_recipients : deliveryIds.length;

  // 2) Process EXACTLY those delivery IDs in this same server request.
  const processed = adminConfigured() && deliveryIds.length > 0
    ? await processQueue(deliveryIds.length, { deliveryIds })
    : { claimed: 0, sent: 0, retrying: 0, dead_letter: 0, failed: 0, skipped: 0, backlog_deferred: 0, perId: {} as Record<string, string> };
  const alreadySent = Object.values(processed.perId ?? {}).filter((o) => o === "already_sent").length;
  const anySent = processed.sent > 0 || alreadySent > 0;

  const base = {
    correlation_id: correlationId, decision,
    expected_recipients: expected, queued: newIds.length,
    claimed: processed.claimed, sent: processed.sent, retrying: processed.retrying,
    failed: processed.failed, dead_letter: processed.dead_letter,
    delivery_ids: deliveryIds, email_channel_enabled: projectEmailEnabled(),
  };
  log("PROJECT_REVIEW_EMAIL", {
    correlation_id: correlationId, decision, expected_recipients: expected,
    delivery_ids_count: deliveryIds.length, queued: newIds.length, claimed: processed.claimed,
    sent: processed.sent, retrying: processed.retrying, failed: processed.failed,
    already_sent: alreadySent, duration_ms: Date.now() - t0,
    producer_stage: deliveryIds.length === 0 ? (expected === 0 ? "no_recipients" : "no_rows_created") : null,
  });

  // 3) HONEST outcome — the decision is saved either way. If recipients were
  //    expected but nothing was sent/claimed, this is NOT a success.
  if (expected > 0 && !anySent && processed.claimed === 0) {
    return NextResponse.json({ ok: false, code: "EMAIL_ROWS_NOT_CLAIMED", decision_saved: true, ...base }, { status: 502 });
  }
  return NextResponse.json({ ok: true, decision_saved: true, ...base }, { status: 200 });
}
