// ════════════════════════════════════════════════════════════════════════
// POST /api/integrations/project/review   (SERVER-ONLY)
//
// Batch 10 · Phase 0 — DECOUPLE the client decision from notifications.
// Regression after 9G: the decision + the email enqueue ran in one RPC, so any
// enqueue failure (RPC not applied, permission, a column issue) rolled back the
// decision → the client saw "تعذر تسجيل قرارك".
//
// Now:
//   STEP A — SAVE the decision via the old, stable client_review_version (its
//            OWN committed transaction). This alone restores approve/revision,
//            EVEN IF no Batch-10/9G SQL is applied.
//   STEP B — AFTER the decision is committed, attempt notifications best-effort
//            (enqueue exact recipients + process them). Any failure is caught,
//            logged, and reported WITHOUT touching the saved decision.
//
// Response separates action_saved / notification. HTTP is 200 whenever the
// decision was saved (never 502); 4xx/5xx only when the decision itself failed.
// ════════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import { authGetUserId, rpcAsUser, rpcAsService, adminConfigured } from "@/lib/server/supabaseAdmin";
import { projectEmailEnabled } from "@/lib/server/projectNotify";
import { processQueue } from "@/lib/server/notifyWorker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const log = (tag: string, extra: Record<string, unknown>) => console.log(JSON.stringify({ tag, ...extra }));
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

interface EnqueueResult { ok?: boolean; correlation_id?: string; expected_recipients?: number; new_ids?: string[]; delivery_ids?: string[]; error?: string }

export async function POST(req: Request) {
  const t0 = Date.now();
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!bearer) return NextResponse.json({ ok: false, action_saved: false, error: "unauthorized" }, { status: 401 });

  let b: Record<string, unknown>;
  try { b = (await req.json()) as Record<string, unknown>; } catch { return NextResponse.json({ ok: false, action_saved: false, error: "invalid_json" }, { status: 400 }); }
  const versionId = str(b.version_id);
  const decision = str(b.decision);
  const comments = typeof b.comments === "string" ? b.comments : null;
  if (!versionId) return NextResponse.json({ ok: false, action_saved: false, error: "missing_version" }, { status: 400 });
  if (decision !== "approved" && decision !== "revision_requested") return NextResponse.json({ ok: false, action_saved: false, error: "bad_decision" }, { status: 400 });

  const uid = await authGetUserId(bearer);
  if (!uid) return NextResponse.json({ ok: false, action_saved: false, error: "unauthorized" }, { status: 401 });

  // ── STEP A: SAVE THE DECISION (its own committed step; authorization inside the RPC).
  const save = await rpcAsUser<boolean>("client_review_version", { p_version: versionId, p_decision: decision, p_comments: comments }, bearer);
  if (!save.ok) {
    const err = String((save as { error?: string }).error ?? "review_failed");
    const denied = /not authorized|not_found|not_current|not_in_review|bad_decision|reason_required/i.test(err);
    log("PROJECT_REVIEW_SAVE_FAILED", { decision, error: err.slice(0, 160) });
    // The DECISION itself failed → this is the only case that is not a success.
    return NextResponse.json({ ok: false, action_saved: false, error: err.slice(0, 160) }, { status: denied ? 403 : 500 });
  }
  // The client's decision is now SAVED and committed. Nothing below can undo it.

  // ── STEP B: NOTIFICATIONS — best-effort, fully isolated. Never fails the action.
  const notification: { ok: boolean; code: string; correlation_id: string | null; expected: number; queued: number; claimed: number; sent: number; error?: string } =
    { ok: false, code: "EMAIL_NOT_ATTEMPTED", correlation_id: null, expected: 0, queued: 0, claimed: 0, sent: 0 };
  try {
    if (!adminConfigured()) {
      notification.code = "SERVER_NOT_CONFIGURED";
    } else {
      const enq = await rpcAsService<EnqueueResult>("review_enqueue_notifications", { p_version: versionId, p_decision: decision, p_correlation: null });
      if (!enq.ok || !enq.data || enq.data.ok === false) {
        notification.code = "EMAIL_ENQUEUE_FAILED";
        const dataErr = enq.ok && enq.data ? enq.data.error : undefined;
        notification.error = String((enq as { error?: string }).error ?? dataErr ?? "enqueue_failed").slice(0, 120);
      } else {
        const deliveryIds = Array.isArray(enq.data.delivery_ids) ? enq.data.delivery_ids : [];
        notification.correlation_id = enq.data.correlation_id ?? null;
        notification.expected = typeof enq.data.expected_recipients === "number" ? enq.data.expected_recipients : deliveryIds.length;
        notification.queued = Array.isArray(enq.data.new_ids) ? enq.data.new_ids.length : 0;
        const processed = deliveryIds.length > 0
          ? await processQueue(deliveryIds.length, { deliveryIds })
          : { claimed: 0, sent: 0, retrying: 0, dead_letter: 0, failed: 0, skipped: 0, backlog_deferred: 0, perId: {} as Record<string, string> };
        const alreadySent = Object.values(processed.perId ?? {}).filter((o) => o === "already_sent").length;
        const anySent = processed.sent > 0 || alreadySent > 0;
        notification.claimed = processed.claimed;
        notification.sent = processed.sent;
        notification.ok = notification.expected === 0 || anySent;
        notification.code = notification.expected === 0 ? "NO_RECIPIENTS"
          : anySent ? "SENT"
          : "EMAIL_ROWS_NOT_CLAIMED";
      }
    }
  } catch (e) {
    notification.code = "EMAIL_ENQUEUE_FAILED";
    notification.error = String(e).slice(0, 120);
  }

  log("PROJECT_REVIEW_EMAIL", {
    decision, action_saved: true, notification_ok: notification.ok, notification_code: notification.code,
    correlation_id: notification.correlation_id, expected_recipients: notification.expected,
    queued: notification.queued, claimed: notification.claimed, sent: notification.sent,
    duration_ms: Date.now() - t0, email_channel_enabled: projectEmailEnabled(),
  });

  // ALWAYS 200 when the decision was saved. The notification block only informs.
  return NextResponse.json({ ok: true, action_saved: true, decision, notification }, { status: 200 });
}
