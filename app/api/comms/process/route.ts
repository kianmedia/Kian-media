// ════════════════════════════════════════════════════════════════════════════
// /api/comms/process — drain the Communications Hub outbox (SERVER-ONLY).
//
// ⛔ NOTHING IS SENT. The drain hands every claimed row to the MOCK provider
//    (lib/server/commsProvider.ts — no network call exists in it). Rows settle
//    as simulated. `live_sent` in the response should always be 0; if it is not,
//    somebody wired a real provider and that is a finding, not a success.
//
// AUTHORIZATION — two doors, both closed by default:
//   • the scheduler: CRON_SECRET, as Bearer or ?secret= (same shape as
//     /api/cron/notify-email, so no new secret is introduced);
//   • a human admin: a portal Bearer token whose session passes comms_can_admin()
//     — checked in the DATABASE, as the user, never inferred from a UI flag.
// A request with neither gets 401 and does no work.
//
// This route deliberately does NOT get its own Vercel cron entry. The hub is not
// live; adding a schedule now would exercise a dark path daily for no reason.
// docs/COMMUNICATIONS_GO_LIVE_GUIDE.md says exactly when to add it.
// ════════════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import { authGetUserId, rpcAsUser, adminConfigured } from "@/lib/server/supabaseAdmin";
import { commsDrain } from "@/lib/server/commsHub";
import { COMMS_CONTRACT_VERSION, relaySigningSecret } from "@/lib/server/commsProvider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const log = (tag: string, extra: Record<string, unknown>) => console.log(JSON.stringify({ tag, ...extra }));

function bearer(req: Request): string {
  const a = req.headers.get("authorization") ?? "";
  return a.toLowerCase().startsWith("bearer ") ? a.slice(7).trim() : "";
}

/** Safe diagnostic. No secrets, no counts that require authorization. */
export async function GET() {
  return NextResponse.json({
    ok: true,
    hub: "communications",
    contract_version: COMMS_CONTRACT_VERSION,
    provider: "mock",
    sends_anything: false,
    relay_signing_configured: relaySigningSecret().length > 0,
    apps_script_handler_deployed: false,
    note: "The provider is a mock. The Apps Script portal_notify handler is NOT deployed — see docs/APPS_SCRIPT_DEPLOYMENT_GUIDE.md.",
    server_configured: adminConfigured(),
  });
}

export async function POST(req: Request) {
  if (!adminConfigured()) {
    return NextResponse.json({ ok: false, error: "server_not_configured" }, { status: 500 });
  }

  // ── Door 1: the scheduler ──
  const secret = (process.env.CRON_SECRET ?? "").trim();
  const url = new URL(req.url);
  const token = bearer(req);
  const provided = token || (url.searchParams.get("secret") ?? "");
  let via: "cron" | "admin" | null = null;
  if (secret && provided === secret) via = "cron";

  // ── Door 2: an authorized human. Checked in the database, as that user. ──
  if (!via && token) {
    const uid = await authGetUserId(token);
    if (uid) {
      const can = await rpcAsUser<boolean>("comms_can_admin", {}, token);
      if (can.ok && can.data === true) via = "admin";
    }
  }

  if (!via) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  let body: { limit?: number; ids?: string[] } = {};
  try { body = (await req.json()) as typeof body; } catch { body = {}; }
  const limit = Math.max(1, Math.min(Number(body.limit) || 25, 200));
  const ids = Array.isArray(body.ids)
    ? body.ids.filter((s) => typeof s === "string" && /^[0-9a-fA-F-]{36}$/.test(s)).slice(0, 200)
    : undefined;

  const r = await commsDrain(limit, ids);
  log("comms_process", { via, ...r });

  if (r.code === "HUB_NOT_INSTALLED") {
    return NextResponse.json({
      ok: false, code: r.code,
      message_ar: "الميزة بانتظار تفعيل قاعدة البيانات — شغّل docs/communications_hub_RUNME.sql",
    }, { status: 200 });
  }

  return NextResponse.json({
    ...r,
    via,
    provider: "mock",
    live_sent_expected: 0,
    note: "simulated only — no message left the system",
  });
}
