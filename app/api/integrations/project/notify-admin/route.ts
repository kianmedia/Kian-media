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
import { authGetUserId, rpcAsUser, rpcAsService, authAdminEmails, adminConfigured } from "@/lib/server/supabaseAdmin";
import { sendProjectEmail, projectEmailEnabled } from "@/lib/server/projectNotify";
import { processQueue } from "@/lib/server/notifyWorker";

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
  if (action !== "self_test" && action !== "process_now") return NextResponse.json({ ok: false, error: "invalid_action" }, { status: 400 });

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

  // action === "process_now" — bounded drain via the shared worker.
  const result = await processQueue(25);
  log("NOTIFY_ADMIN_PROCESS_NOW", { ...result, email_channel_enabled: projectEmailEnabled() });
  return NextResponse.json({ ok: true, processed: result, email_channel_enabled: projectEmailEnabled() });
}
