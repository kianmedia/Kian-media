// ════════════════════════════════════════════════════════════════════════
// POST /api/integrations/project/review   (SERVER-ONLY, server-authoritative)
//
// Batch 9F HOTFIX — the client's approve / request-revision decision. Previously
// the browser called the client_review_version RPC directly and then relied on a
// separate fire-and-forget notifyDrainKick() to run the worker; in production that
// second call was unreliable, so the approval email sat pending (attempts=0)
// until the daily cron. This route makes it ATOMIC on the server: it runs the
// mutation (RLS-enforced inside the RPC) AND then drains the just-enqueued mail in
// the SAME request, returning the real outcome. No browser second-call, no general
// queue exposure — the drain is bounded + recent-only (this event's fresh rows).
// ════════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import { authGetUserId, rpcAsUser, adminConfigured } from "@/lib/server/supabaseAdmin";
import { projectEmailEnabled } from "@/lib/server/projectNotify";
import { processQueue } from "@/lib/server/notifyWorker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const log = (tag: string, extra: Record<string, unknown>) => console.log(JSON.stringify({ tag, ...extra }));
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export async function POST(req: Request) {
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

  // 1) Mutation — authorization (is_client_owner + current + in-review) is enforced
  //    INSIDE client_review_version; we run it AS THE USER so RLS/ownership applies.
  const rpc = await rpcAsUser<boolean>("client_review_version", { p_version: versionId, p_decision: decision, p_comments: comments }, bearer);
  if (!rpc.ok) {
    const err = String((rpc as { error?: string }).error ?? "review_failed");
    const denied = /not authorized|not_found|not_current|not_in_review|bad_decision|reason_required/i.test(err);
    log("PROJECT_REVIEW_RPC_FAILED", { decision, error: err.slice(0, 160) });
    return NextResponse.json({ ok: false, error: err.slice(0, 160) }, { status: denied ? 403 : 200 });
  }

  // 2) Drain the just-enqueued approval/revision email in THIS server request —
  //    recent-only + bounded, so it never touches the old backlog.
  let processed = { claimed: 0, sent: 0, retrying: 0, dead_letter: 0, failed: 0, skipped: 0, backlog_deferred: 0 };
  if (adminConfigured()) {
    try { processed = await processQueue(20, { recentMinutes: 15 }); }
    catch (e) { log("PROJECT_REVIEW_DRAIN_ERROR", { error: String(e).slice(0, 160) }); }
  }
  log("PROJECT_REVIEW", { decision, ...processed, email_enabled: projectEmailEnabled() });

  return NextResponse.json({
    ok: true, event_created: true, decision,
    processed, email_channel_enabled: projectEmailEnabled(),
  });
}
