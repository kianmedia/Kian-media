// ════════════════════════════════════════════════════════════════════════
// GET/POST /api/cron/notify-email — محرك بريد المشاريع + التذكيرات (SERVER-ONLY).
//
// يُستدعى من Vercel Cron (vercel.json) محميًا بـ CRON_SECRET:
//   1) pc_reminders_scan(): يبثّ تذكيرات المهام/الجلسات/الاجتماعات/المخرجات/
//      الدفعات المتأخرة/التنبيهات الحرجة/العهدة (dedup عبر reminder_tracking).
//   2) يعالج طابور email_deliveries: pending → sent/failed/skipped
//      مع Attempts + Exponential Backoff (5m·2^attempts) وحد أقصى 5 محاولات.
// فشل البريد لا يُفشل شيئًا آخر. لا أسرار في السجلات. WhatsApp يبقى معطّلًا.
// الجدولة الافتراضية يومية (متوافقة مع Vercel Hobby)؛ لدقّة أعلى شغّله خارجيًا
// (n8n مثلًا) كل 15 دقيقة: GET /api/cron/notify-email?secret=CRON_SECRET.
// ════════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import { rpcAsService, adminConfigured } from "@/lib/server/supabaseAdmin";
import { projectEmailEnabled } from "@/lib/server/projectNotify";
import { processQueue, pendingBacklog } from "@/lib/server/notifyWorker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const log = (tag: string, extra: Record<string, unknown>) => console.log(JSON.stringify({ tag, ...extra }));

async function run(req: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  if (!secret) return NextResponse.json({ ok: false, error: "cron_secret_not_configured" }, { status: 500 });
  const auth = req.headers.get("authorization") ?? "";
  const url = new URL(req.url);
  const provided = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : url.searchParams.get("secret") ?? "";
  if (provided !== secret) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!adminConfigured()) return NextResponse.json({ ok: false, error: "server_not_configured" }, { status: 500 });

  let reminders = 0;
  try {
    const r = await rpcAsService<{ ok: boolean; reminders: number }>("pc_reminders_scan", {});
    if (r.ok) reminders = r.data?.reminders ?? 0;
    else log("REMINDERS_SCAN_FAILED", { error: String((r as { error?: string }).error ?? "").slice(0, 200) });
  } catch (e) { log("REMINDERS_SCAN_ERROR", { error: String(e).slice(0, 200) }); }

  // Batch 3C: task/project operational alerts (blocked-too-long, review-stuck, project
  // heavily overdue). Idempotent via reminder_tracking; reuses this same daily cron.
  let taskAlerts = 0;
  try {
    const r = await rpcAsService<{ ok: boolean; emitted: number }>("pc_task_alerts_scan", {});
    if (r.ok) taskAlerts = r.data?.emitted ?? 0;
    else log("TASK_ALERTS_SCAN_FAILED", { error: String((r as { error?: string }).error ?? "").slice(0, 200) });
  } catch (e) { log("TASK_ALERTS_SCAN_ERROR", { error: String(e).slice(0, 200) }); }

  // Batch 5B: executive portfolio alerts (project became critical) — idempotent via
  // reminder_tracking + notification_events idem key. Reuses this same daily cron (no new cron).
  // Guarded: if 5B not applied, the RPC is absent and this block no-ops.
  let execAlerts = 0;
  try {
    const r = await rpcAsService<{ ok: boolean; emitted: number }>("executive_alerts_scan", {});
    if (r.ok) execAlerts = r.data?.emitted ?? 0;
    else log("EXEC_ALERTS_SCAN_SKIPPED", { error: String((r as { error?: string }).error ?? "").slice(0, 200) });
  } catch (e) { log("EXEC_ALERTS_SCAN_ERROR", { error: String(e).slice(0, 200) }); }

  // Batch 5B: capture a weekly KPI snapshot (idempotent per ISO period) — foundation for trends.
  try { await rpcAsService<{ ok: boolean }>("executive_snapshot_capture", { p_period: "weekly" }); }
  catch (e) { log("EXEC_SNAPSHOT_ERROR", { error: String(e).slice(0, 200) }); }

  // Batch 5C: closure alerts (closure review overdue) — idempotent via reminder_tracking.
  // Reuses this same cron; guarded so it no-ops if 5C not applied.
  let closureAlerts = 0;
  try {
    const r = await rpcAsService<{ ok: boolean; emitted: number }>("closure_alerts_scan", {});
    if (r.ok) closureAlerts = r.data?.emitted ?? 0;
    else log("CLOSURE_ALERTS_SCAN_SKIPPED", { error: String((r as { error?: string }).error ?? "").slice(0, 200) });
  } catch (e) { log("CLOSURE_ALERTS_SCAN_ERROR", { error: String(e).slice(0, 200) }); }

  // Batch 9C: resource/planning conflict alerts. The producer resource_alerts_scan was
  // fully built (4D) but NEVER invoked by any cron — a confirmed break (conflicts/
  // bookings-soon/maintenance-soon written to nobody). Idempotent via reminder_tracking;
  // guarded so it no-ops if 4D isn't applied.
  let resourceAlerts = 0;
  try {
    const r = await rpcAsService<{ ok: boolean; alerts_emitted: number }>("resource_alerts_scan", {});
    if (r.ok) resourceAlerts = r.data?.alerts_emitted ?? 0;
    else log("RESOURCE_ALERTS_SCAN_SKIPPED", { error: String((r as { error?: string }).error ?? "").slice(0, 200) });
  } catch (e) { log("RESOURCE_ALERTS_SCAN_ERROR", { error: String(e).slice(0, 200) }); }

  // Batch 9C: governance critical alerts — a critical risk/issue was raised but no event
  // was ever emitted (confirmed break). Idempotent via reminder_tracking; guarded if absent.
  let govAlerts = 0;
  try {
    const r = await rpcAsService<{ ok: boolean; emitted: number }>("pc_governance_alerts_scan", {});
    if (r.ok) govAlerts = r.data?.emitted ?? 0;
    else log("GOV_ALERTS_SCAN_SKIPPED", { error: String((r as { error?: string }).error ?? "").slice(0, 200) });
  } catch (e) { log("GOV_ALERTS_SCAN_ERROR", { error: String(e).slice(0, 200) }); }

  // Batch 9C: program SLA breach alerts (8D). The RPC self-guards (returns skipped) if 8D
  // isn't installed, so this block is safe regardless of environment.
  let slaAlerts = 0;
  try {
    const r = await rpcAsService<{ ok: boolean; emitted: number }>("pc_program_sla_scan", {});
    if (r.ok) slaAlerts = r.data?.emitted ?? 0;
    else log("SLA_SCAN_SKIPPED", { error: String((r as { error?: string }).error ?? "").slice(0, 200) });
  } catch (e) { log("SLA_SCAN_ERROR", { error: String(e).slice(0, 200) }); }

  // Batch 9E: structured drain telemetry (cron is the FALLBACK path; the primary
  // path is immediate bounded processing via the drain kick after each action).
  const t0 = Date.now();
  const runId = globalThis.crypto?.randomUUID?.() ?? String(t0);
  const backlog = await pendingBacklog();
  const queue = await processQueue();
  const stats = {
    cron_run_id: runId,
    deployment: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8) ?? "local",
    env: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
    reminders, taskAlerts, execAlerts, closureAlerts, resourceAlerts, govAlerts, slaAlerts,
    ...queue,
    pending_before: backlog.total, pending_recent: backlog.recent, pending_old_backlog: backlog.old,
    duration_ms: Date.now() - t0, email_enabled: projectEmailEnabled(),
  };
  log("NOTIFY_EMAIL_RUN", stats);
  // Batch 9C: persist a cron heartbeat so the monitor can distinguish a dead cron / disabled
  // channel from a quiet-but-healthy queue. Best-effort — a telemetry failure never fails the run.
  try { await rpcAsService("pc_notify_cron_record", { p_job: "notify-email", p_ok: true, p_stats: stats, p_error: null }); }
  catch (e) { log("CRON_HEARTBEAT_ERROR", { error: String(e).slice(0, 200) }); }
  return NextResponse.json({ ok: true, ...stats });
}

export async function GET(req: Request) { return run(req); }
export async function POST(req: Request) { return run(req); }
