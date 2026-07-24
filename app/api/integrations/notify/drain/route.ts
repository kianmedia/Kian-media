// ════════════════════════════════════════════════════════════════════════
// POST /api/integrations/notify/drain   (SERVER-ONLY, immediate bounded drain)
//
// Batch 9E — the PRIMARY (immediate) email path. DB-trigger producers
// (pc_event_emit, e.g. client_deliverable_approved) enqueue email_deliveries
// rows but cannot call an HTTP worker; the daily cron was the only drainer, so
// queued mail sat pending for up to a day. Any authenticated action that just
// caused an enqueue (client approve/revision, preview send, …) fires this
// endpoint fire-and-forget; it runs a BOUNDED batch of the SAME shared worker,
// so mail goes out within seconds. The daily cron remains the fallback for
// retries, stale rows, and anything missed.
//
// Batch 9F: ADMIN-ONLY (can_manage_projects). Regular users can no longer drain
// the general queue — event-scoped draining now happens server-authoritatively
// inside the review/preview routes. Recent-only + bounded; no secret exposed.
// ════════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import { authGetUserId, rpcAsUser, adminConfigured } from "@/lib/server/supabaseAdmin";
import { projectEmailEnabled } from "@/lib/server/projectNotify";
import { processQueue } from "@/lib/server/notifyWorker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const log = (tag: string, extra: Record<string, unknown>) => console.log(JSON.stringify({ tag, ...extra }));

// Best-effort per-user rate limit (abuse-prevention; the work is always bounded).
const lastCall = new Map<string, number>();
const RATE_MS = 4000;
const BATCH = 20;

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!bearer) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const uid = await authGetUserId(bearer);
  if (!uid) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!adminConfigured()) return NextResponse.json({ ok: true, drained: false, reason: "server_not_configured" });

  // Admin gate — a regular user must not be able to drain the general queue.
  const can = await rpcAsUser<boolean>("can_manage_projects", {}, bearer);
  if (!can.ok || can.data !== true) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const now = Date.now();
  const prev = lastCall.get(uid) ?? 0;
  if (now - prev < RATE_MS) return NextResponse.json({ ok: true, drained: false, reason: "rate_limited" });
  lastCall.set(uid, now);

  const result = await processQueue(BATCH, { recentMinutes: 60 });
  log("NOTIFY_DRAIN_ADMIN", { ...result, email_enabled: projectEmailEnabled() });
  return NextResponse.json({ ok: true, drained: true, result, email_enabled: projectEmailEnabled() });
}
