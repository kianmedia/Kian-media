// ════════════════════════════════════════════════════════════════════════
// GET/POST /api/cron/custody-alerts  — محرك تنبيهات العهدة (SERVER-ONLY، محمي بسر).
//
// يُستدعى من Vercel Cron (vercel.json) أو أي جدولة، محمي بـ CRON_SECRET.
// ينفّذ custody_run_alerts() (استحقاق/تأخير/تصعيد/ضمانات، dedup داخلي) +
// custody_gps_apply_retention() (حذف نقاط GPS المنتهية). كلاهما SECURITY DEFINER
// يُستدعى بمفتاح الخدمة. لا يُسجَّل السر. فشله لا يؤثر على بقية النظام.
// ════════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import { rpcAsService, adminConfigured } from "@/lib/server/supabaseAdmin";

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

  const alerts = await rpcAsService<Record<string, number>>("custody_run_alerts", {});
  const retention = await rpcAsService<number>("custody_gps_apply_retention", {});
  log("CUSTODY_CRON_RUN", {
    alerts_ok: alerts.ok, alerts: alerts.ok ? alerts.data : alerts.error,
    retention_ok: retention.ok, retention_deleted: retention.ok ? retention.data : null,
  });
  return NextResponse.json({ ok: true, alerts: alerts.ok ? alerts.data : { error: alerts.error }, gps_retention_deleted: retention.ok ? retention.data : null }, { status: 200 });
}

export const GET = run;
export const POST = run;
