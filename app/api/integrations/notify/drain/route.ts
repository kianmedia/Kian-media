// ════════════════════════════════════════════════════════════════════════
// POST /api/integrations/notify/drain   (SERVER-ONLY, immediate bounded drain)
//
// WHAT THIS IS TODAY: an ADMIN-ONLY manual escape hatch. It has NO automatic
// caller — grep for "integrations/notify" returns only this header and two test
// string-pins. Do not describe it as part of the normal send path.
//
// The immediate path is now event-bound and lives inside the routes that cause
// the enqueue: they receive the exact delivery IDs back from the enqueue RPC and
// drain precisely those rows in the same request —
//   lib/server/notifyEvent.ts:178-180
//   app/api/integrations/project/notify/route.ts:91-92
//   app/api/integrations/project/review/route.ts:128
// The daily cron (/api/cron/notify-email) remains the fallback for retries,
// stale rows, and anything the in-request drain missed.
//
// HISTORY (why the code looks like this): Batch 9E introduced this endpoint as
// the primary immediate path, fired fire-and-forget by any authenticated action
// that had just enqueued. Batch 9F then restricted it to can_manage_projects and
// moved event-scoped draining server-authoritatively into the review/preview
// routes, which left this endpoint with no caller. The Batch 9E description
// survived here unchanged until Phase 1 and contradicted the Batch 9F note
// directly below it — that stale paragraph is what this comment replaces.
// Recent-only + bounded; no secret exposed.
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
