// ════════════════════════════════════════════════════════════════════════
// GET/POST /api/cron/custody-alerts  — محرك تنبيهات العهدة (SERVER-ONLY، محمي بسر).
//
// يُستدعى من Vercel Cron (vercel.json) أو أي جدولة، محمي بـ CRON_SECRET.
// ينفّذ custody_run_alerts() (استحقاق/تأخير/تصعيد/ضمانات، dedup داخلي) +
// custody_gps_apply_retention() (حذف نقاط GPS المنتهية). كلاهما SECURITY DEFINER
// يُستدعى بمفتاح الخدمة. لا يُسجَّل السر. فشله لا يؤثر على بقية النظام.
// ════════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import { rpcAsService, selectAsService, adminConfigured } from "@/lib/server/supabaseAdmin";
import { sendCustodyEmail } from "@/lib/server/custodyNotify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const log = (tag: string, extra: Record<string, unknown>) => console.log(JSON.stringify({ tag, ...extra }));

// تذكيرات التأجير (قرب موعد التسليم) + تعليم المتأخرات. بوابة (SQL) + إيميل. دقة تقريبية:
// يشغّلها الكرون اليومي؛ الدقة الحقيقية لساعتين تحتاج مُشغّلًا أكثر تكرارًا (لاحقًا).
async function rentalReminders(): Promise<{ marked: number; reminded: number; emailed: number; expired: number }> {
  const out = { marked: 0, reminded: 0, emailed: 0, expired: 0 };
  try {
    // backstop يومي: إنهاء صلاحية المسودّات القديمة (>15د) وإرجاع معداتها (الدقة اللحظية عبر الكنس الكسول في الواجهة).
    const exp = await rpcAsService<{ ok: boolean; expired: number }>("custody_rental_expire_stale_drafts", { p_minutes: 15 });
    if (exp.ok) out.expired = exp.data?.expired ?? 0;
    const overdue = await rpcAsService<{ ok: boolean; marked: number }>("custody_rental_mark_overdue", {});
    if (overdue.ok) out.marked = overdue.data?.marked ?? 0;
    const rem = await rpcAsService<{ ok: boolean; reminded: number; due: Array<{ request_id: string; request_number: string; customer_email: string | null; party_name: string | null }> }>("custody_rental_due_reminders", { p_window_hours: 2 });
    if (rem.ok && Array.isArray(rem.data?.due) && rem.data.due.length) {
      out.reminded = rem.data.reminded ?? rem.data.due.length;
      const staff = await selectAsService<{ email: string | null }[]>(`profiles?select=email&account_status=eq.active&or=(account_type.eq.admin,staff_role.in.(super_admin,manager,custody_officer))`);
      const mgr = staff.ok ? staff.data.map((p) => p.email).filter((e): e is string => !!e && e.includes("@")) : [];
      for (const d of rem.data.due) {
        const to = [d.customer_email, ...mgr].filter((e): e is string => !!e && e.includes("@"));
        const res = await sendCustodyEmail({ event: "rental_due_soon", record_id: d.request_id, record_no: d.request_number, kind: "rental", party_name: d.party_name ?? undefined, recipients: to });
        if (res.sent) out.emailed++;
      }
    }
  } catch (e) { log("RENTAL_REMINDER_FAILED", { error: String(e).slice(0, 200) }); }
  return out;
}

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
  const rental = await rentalReminders();
  log("CUSTODY_CRON_RUN", {
    alerts_ok: alerts.ok, alerts: alerts.ok ? alerts.data : alerts.error,
    retention_ok: retention.ok, retention_deleted: retention.ok ? retention.data : null,
    rental_overdue: rental.marked, rental_reminded: rental.reminded, rental_emailed: rental.emailed,
  });
  return NextResponse.json({ ok: true, alerts: alerts.ok ? alerts.data : { error: alerts.error }, gps_retention_deleted: retention.ok ? retention.data : null, rental }, { status: 200 });
}

export const GET = run;
export const POST = run;
