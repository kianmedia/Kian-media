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
import { authGetUserId, rpcAsUser, rpcAsService, selectAsService, adminConfigured } from "@/lib/server/supabaseAdmin";
import { projectEmailEnabled } from "@/lib/server/projectNotify";
import { processQueue } from "@/lib/server/notifyWorker";
import { emitEventEmail } from "@/lib/server/notifyEvent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const log = (tag: string, extra: Record<string, unknown>) => console.log(JSON.stringify({ tag, ...extra }));
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

interface EnqueueResult { ok?: boolean; correlation_id?: string; expected_recipients?: number; new_ids?: string[]; delivery_ids?: string[]; error?: string }

/** Version → deliverable/project context from BASE tables (no Batch-10/9G RPC needed).
 *  Used only by the SQL-independent fallback. Never throws. */
async function reviewContext(versionId: string): Promise<{ deliverableId: string | null; projectId: string | null; title: string | null; projectName: string | null }> {
  const empty = { deliverableId: null, projectId: null, title: null, projectName: null };
  try {
    const v = await selectAsService<{ deliverable_id: string | null }[]>(
      `deliverable_versions?id=eq.${encodeURIComponent(versionId)}&select=deliverable_id&limit=1`);
    const deliverableId = v.ok && v.data[0]?.deliverable_id ? v.data[0].deliverable_id : null;
    if (!deliverableId) return empty;
    const d = await selectAsService<{ project_id: string | null; title: string | null }[]>(
      `deliverables?id=eq.${encodeURIComponent(deliverableId)}&select=project_id,title&limit=1`);
    const projectId = d.ok && d.data[0]?.project_id ? d.data[0].project_id : null;
    const title = d.ok ? (d.data[0]?.title ?? null) : null;
    let projectName: string | null = null;
    if (projectId) {
      // The column is project_name — `name` does not exist on public.projects (42703).
      const p = await selectAsService<{ project_name: string | null }[]>(
        `projects?id=eq.${encodeURIComponent(projectId)}&select=project_name&limit=1`);
      projectName = p.ok ? (p.data[0]?.project_name ?? null) : null;
    }
    return { deliverableId, projectId, title, projectName };
  } catch { return empty; }
}

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
        // Batch 11 — the enqueue RPC is not deployed on this database yet. Do NOT lose the
        // notification: resolve management + the project manager from base tables and send
        // through the same single provider. This is why a client decision now emails
        // management even with NO Batch-10/9G SQL applied.
        if (!enq.ok && /PGRST202|could not find the function|does not exist|schema cache|HTTP 404/i.test(notification.error)) {
          const ctx = await reviewContext(versionId);
          const emit = await emitEventEmail({
            event: "deliverable.client_reviewed",
            entity_type: "deliverable",
            entity_id: ctx.deliverableId,
            project_id: ctx.projectId,
            actor: uid,
            subject: (decision === "approved" ? "اعتمد العميل مخرجًا: " : "طلب العميل تعديلًا: ") + (ctx.title ?? ""),
            body: `المشروع: ${ctx.projectName ?? ""}\nالمخرَج: ${ctx.title ?? ""}\nقرار العميل: ${decision === "approved" ? "اعتماد" : "طلب تعديل"}`,
            payload: { action_url: ctx.projectId ? `/client-portal/project-core/${ctx.projectId}?tab=deliverables` : "/client-portal/project-core" },
          });
          notification.ok = emit.ok;
          notification.code = emit.code;
          notification.expected = emit.expected;
          notification.sent = emit.sent;
          notification.claimed = emit.claimed;
          notification.correlation_id = emit.correlation_id;
          // Do not leave the stale "RPC not deployed" text on a successful fallback.
          notification.error = emit.error ?? undefined;
        }
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
