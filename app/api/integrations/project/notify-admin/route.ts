// ════════════════════════════════════════════════════════════════════════
// POST /api/integrations/project/notify-admin   (SERVER-ONLY, admin diagnostics)
//
// Batch 9D §15 — safe admin tools surfaced in the Notification Monitor:
//   • action:"self_test"  → writes a portal row to the CALLER only + emails the
//     CALLER only, then returns the delivery outcome. Proves portal+email+
//     provider end-to-end without touching any client/employee/renter.
//   • action:"process_now"→ drains a bounded batch of the email queue using the
//     SAME worker the cron uses (no secret in the client). Owner/manager only.
// Both are auth-gated (can_manage_projects) and rate-limited per user. No secrets.
// ════════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import { authGetUserId, rpcAsUser, rpcAsService, selectAsService, patchAsService, authAdminEmails, adminConfigured } from "@/lib/server/supabaseAdmin";
import { sendProjectEmail, projectEmailEnabled } from "@/lib/server/projectNotify";
import { processQueue, pendingBacklog } from "@/lib/server/notifyWorker";

const BACKLOG_HOURS = 24;   // older than this = expired backlog (never auto-sent)
const RECENT_HOURS = 2;     // Batch 10 · Phase 10 — "recent" eligibility window
// Critical events worth a manual one-off retry when recent (never a mass send).
const CRITICAL_EVENTS = new Set([
  "client_deliverable_approved", "client_revision_requested", "deliverable_final_ready",
  "deliverable_preview_sent", "project_delivery_recorded",
]);
const mask = (e: string | null | undefined) => {
  const s = (e ?? "").trim(); const at = s.indexOf("@");
  if (at < 1) return "—";
  return s[0] + "***" + s.slice(at);
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const log = (tag: string, extra: Record<string, unknown>) => console.log(JSON.stringify({ tag, ...extra }));

// Best-effort per-instance rate limit (admin-only tool; abuse-prevention, not security).
const lastCall = new Map<string, number>();
const RATE_MS = 15_000;

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!bearer) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  let b: Record<string, unknown>;
  try { b = (await req.json()) as Record<string, unknown>; } catch { return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 }); }
  const action = typeof b.action === "string" ? b.action : "";
  const ACTIONS = new Set(["self_test", "process_now", "backlog_preview", "backlog_classify", "retry_one", "expire_backlog"]);
  if (!ACTIONS.has(action)) return NextResponse.json({ ok: false, error: "invalid_action" }, { status: 400 });

  const uid = await authGetUserId(bearer);
  if (!uid) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!adminConfigured()) return NextResponse.json({ ok: false, error: "server_not_configured" }, { status: 500 });

  // Authorization: caller must be able to manage projects (owner/super_admin/admin/manager).
  const can = await rpcAsUser<boolean>("can_manage_projects", {}, bearer);
  if (!can.ok || can.data !== true) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  // Rate limit.
  const key = `${uid}:${action}`;
  const now = Date.now();
  const prev = lastCall.get(key) ?? 0;
  if (now - prev < RATE_MS) return NextResponse.json({ ok: false, error: "rate_limited", retry_ms: RATE_MS - (now - prev) }, { status: 429 });
  lastCall.set(key, now);

  if (action === "self_test") {
    // Portal row → caller only (dedicated RPC, never fans out to other management).
    const portal = await rpcAsService<{ ok: boolean }>("notification_admin_self_test", {
      p_user: uid, p_title_ar: "اختبار إشعار من لوحة المراقبة", p_title_en: "Notification monitor self-test",
    });
    // Email → caller only.
    const em = await authAdminEmails([uid]);
    const self = (em[uid] ?? "").toLowerCase();
    let emailSent = false; let emailReason = "no_email";
    if (self.includes("@")) {
      const res = await sendProjectEmail({
        to: [self], subject: "اختبار إشعار — كيان",
        body: "هذه رسالة اختبار من لوحة مراقبة الإشعارات. وصولها يؤكّد أنّ قناة البريد تعمل.",
        directUrl: "/client-portal/project-core", eventType: "diagnostic.self_test",
      });
      emailSent = res.sent; emailReason = res.reason ?? "sent";
    }
    log("NOTIFY_ADMIN_SELF_TEST", { portal: portal.ok, email_sent: emailSent, reason: emailReason });
    return NextResponse.json({
      ok: true, portal: portal.ok, email: { sent: emailSent, reason: emailReason, to_self: self.includes("@") },
      email_channel_enabled: projectEmailEnabled(),
    });
  }

  if (action === "backlog_preview") {
    // Read-only: what WOULD send vs what is old-backlog, by recency + event type.
    const backlog = await pendingBacklog(BACKLOG_HOURS);
    const rows = await selectAsService<{ recipient_email: string | null; created_at: string; notification_events: { event_type: string | null } | null }[]>(
      `email_deliveries?select=recipient_email,created_at,notification_events(event_type)&status=eq.pending&order=created_at.desc&limit=200`);
    const byType: Record<string, number> = {};
    const sample: { to: string; type: string; created_at: string; recent: boolean }[] = [];
    const cutoff = Date.now() - BACKLOG_HOURS * 3600_000;
    if (rows.ok && Array.isArray(rows.data)) {
      for (const r of rows.data) {
        const ty = r.notification_events?.event_type ?? "(untyped)";
        byType[ty] = (byType[ty] ?? 0) + 1;
        if (sample.length < 20) sample.push({ to: mask(r.recipient_email), type: ty, created_at: r.created_at, recent: new Date(r.created_at).getTime() >= cutoff });
      }
    }
    return NextResponse.json({
      ok: true, window_hours: BACKLOG_HOURS,
      pending: backlog, would_send: backlog.recent, would_defer: backlog.old,
      by_type: byType, sample, email_channel_enabled: projectEmailEnabled(),
    });
  }

  if (action === "expire_backlog") {
    // Owner/super_admin only (stricter than can_manage_projects) — marks OLD pending
    // rows 'skipped' (backlog_expired). Never sends; safe bulk update, not deletion.
    const prof = await selectAsService<{ account_type: string | null; staff_role: string | null; account_status: string | null }[]>(
      `profiles?id=eq.${encodeURIComponent(uid)}&select=account_type,staff_role,account_status&limit=1`);
    const me = prof.ok ? prof.data[0] : null;
    const isOwner = !!me && me.account_status === "active" && (me.account_type === "admin" || me.staff_role === "super_admin");
    if (!isOwner) return NextResponse.json({ ok: false, error: "forbidden_owner_only" }, { status: 403 });
    const cutoffIso = new Date(Date.now() - BACKLOG_HOURS * 3600_000).toISOString();
    const before = await selectAsService<{ id: string }[]>(`email_deliveries?select=id&status=eq.pending&created_at=lt.${encodeURIComponent(cutoffIso)}&limit=5000`);
    const n = before.ok && Array.isArray(before.data) ? before.data.length : 0;
    if (n > 0) await patchAsService(`email_deliveries?status=eq.pending&created_at=lt.${encodeURIComponent(cutoffIso)}`, { status: "skipped", last_error: "backlog_expired" });
    log("NOTIFY_ADMIN_EXPIRE_BACKLOG", { expired: n });
    return NextResponse.json({ ok: true, expired: n, window_hours: BACKLOG_HOURS });
  }

  if (action === "backlog_classify") {
    // Batch 10 · Phase 10 — READ-ONLY classification of the pending queue into the
    // four control buckets. No sending, no mutation. Guides the admin on what to do:
    //   eligible_recent   — pending, < RECENT_HOURS, not a duplicate → safe to send.
    //   expired_old       — pending, > BACKLOG_HOURS → should be expired, never sent.
    //   duplicate         — a newer pending row already superseded by an equal one.
    //   critical_recent   — recent pending for a critical event → manual retry ids.
    const rows = await selectAsService<{ id: string; recipient_email: string | null; subject: string | null; created_at: string; idempotency_key: string | null; notification_events: { event_type: string | null } | null }[]>(
      `email_deliveries?select=id,recipient_email,subject,created_at,idempotency_key,notification_events(event_type)&status=eq.pending&order=created_at.asc&limit=1000`);
    const nowMs = Date.now();
    const recentCut = nowMs - RECENT_HOURS * 3600_000;
    const oldCut = nowMs - BACKLOG_HOURS * 3600_000;
    const buckets = { eligible_recent: 0, mid_pending: 0, expired_old: 0, duplicate: 0, critical_recent: 0, total: 0 };
    const seen = new Set<string>();               // dedupe signature → first (kept) row
    const criticalIds: { id: string; to: string; type: string; created_at: string }[] = [];
    if (rows.ok && Array.isArray(rows.data)) {
      for (const r of rows.data) {
        buckets.total++;
        const t = new Date(r.created_at).getTime();
        const type = r.notification_events?.event_type ?? "(untyped)";
        const sig = r.idempotency_key && r.idempotency_key.trim()
          ? `k:${r.idempotency_key}`
          : `p:${(r.recipient_email ?? "").toLowerCase()}|${r.subject ?? ""}`;
        const isDup = seen.has(sig);
        if (!isDup) seen.add(sig);
        if (isDup) { buckets.duplicate++; continue; }   // a duplicate is neither eligible nor critical
        if (t < oldCut) { buckets.expired_old++; continue; }
        if (t >= recentCut) {
          buckets.eligible_recent++;
          if (CRITICAL_EVENTS.has(type)) {
            buckets.critical_recent++;
            if (criticalIds.length < 25) criticalIds.push({ id: r.id, to: mask(r.recipient_email), type, created_at: r.created_at });
          }
        } else {
          buckets.mid_pending++;
        }
      }
    }
    return NextResponse.json({
      ok: true, recent_hours: RECENT_HOURS, expire_hours: BACKLOG_HOURS,
      buckets, critical_retry_candidates: criticalIds, email_channel_enabled: projectEmailEnabled(),
    });
  }

  if (action === "retry_one") {
    // Batch 10 · Phase 10 — manual retry of ONE recent row by id. NEVER a mass send:
    // exactly one delivery id, and only if it is still pending/failed AND recent (older
    // rows must be expired, not resurrected). Processes via the shared exact-ID worker.
    const id = typeof b.delivery_id === "string" ? b.delivery_id.trim() : "";
    if (!/^[0-9a-fA-F-]{36}$/.test(id)) return NextResponse.json({ ok: false, error: "bad_delivery_id" }, { status: 400 });
    const row = await selectAsService<{ id: string; status: string; created_at: string }[]>(
      `email_deliveries?id=eq.${encodeURIComponent(id)}&select=id,status,created_at&limit=1`);
    const r = row.ok ? row.data[0] : null;
    if (!r) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    if (r.status !== "pending" && r.status !== "failed")
      return NextResponse.json({ ok: false, error: `not_retryable_status:${r.status}` }, { status: 409 });
    if (new Date(r.created_at).getTime() < Date.now() - BACKLOG_HOURS * 3600_000)
      return NextResponse.json({ ok: false, error: "too_old_expire_instead" }, { status: 409 });
    // Make the ONE row due & retryable: clear any backoff; if it dead-lettered
    // (status=failed ⇒ attempts>=MAX), revive it to pending with fresh attempts so
    // exact-ID processing actually re-attempts it instead of returning already_failed.
    const patch: Record<string, unknown> = { next_attempt_at: null };
    if (r.status === "failed") { patch.status = "pending"; patch.attempts = 0; }
    await patchAsService(`email_deliveries?id=eq.${encodeURIComponent(id)}`, patch);
    const result = await processQueue(1, { deliveryIds: [id] });
    const outcome = result.perId?.[id] ?? "unknown";
    log("NOTIFY_ADMIN_RETRY_ONE", { id, outcome, sent: result.sent });
    return NextResponse.json({ ok: true, delivery_id: id, outcome, processed: result, email_channel_enabled: projectEmailEnabled() });
  }

  // action === "process_now" — bounded drain via the shared worker, with honesty:
  // report pending counts + WHY nothing was claimed (backlog / not due / channel off).
  const backlog = await pendingBacklog(BACKLOG_HOURS);
  // Batch 9F: recent-only (last 60m) + bounded — Process Now must NOT blast the old
  // backlog. The Backlog preview/Expire tools handle old rows explicitly.
  const result = await processQueue(25, { recentMinutes: 60 });
  let reason: string | null = null;
  if (result.claimed === 0 && backlog.total > 0) {
    reason = !projectEmailEnabled() ? "email_channel_disabled"
      : backlog.recent === 0 ? "only_old_backlog_pending"
      : "no_rows_due_yet";
  }
  log("NOTIFY_ADMIN_PROCESS_NOW", { ...result, pending: backlog, reason, email_channel_enabled: projectEmailEnabled() });
  return NextResponse.json({
    ok: true, processed: result, pending: backlog, reason, email_channel_enabled: projectEmailEnabled(),
  });
}
