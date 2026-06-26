// ════════════════════════════════════════════════════════════════════════
// POST /api/integrations/deliveries/process   (SERVER-ONLY)
//
// The delivery processor: claims pending email/whatsapp rows (10-min lease,
// FOR UPDATE SKIP LOCKED) and sends them via the configured providers, writing the
// result back to notification_deliveries. Idempotent (a 'sent' row is never
// reclaimed). Never touches business data. Fully env-gated; dry-run by default.
//
// Auth: either the DELIVERY_PROCESSOR_SECRET (header x-delivery-secret or ?secret=,
// for cron) OR a logged-in staff bearer with can_manage_quotes (admin "process now").
// ════════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { rpcAsService, rpcAsUser } from "@/lib/server/supabaseAdmin";
import { renderEmail, whatsappTemplate, portalUrl, type DeliveryRow } from "@/lib/server/deliveryRender";
import { sendEmail } from "@/lib/server/deliveryEmail";
import { sendWhatsAppTemplate, toE164Digits } from "@/lib/server/deliveryWhatsApp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const flag = (k: string, def = false) => { const v = process.env[k]; return v == null ? def : v === "true" || v === "1"; };
const list = (k: string) => (process.env[k] || "").split(",").map((s) => s.trim()).filter(Boolean);
function secretEq(a: string, b: string): boolean {
  if (!a || !b) return false;
  const ba = Buffer.from(a), bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

interface Row extends DeliveryRow { id: string; recipient_user_id: string | null; idempotency_key: string; retry_count: number }

// Vercel Cron sends GET with `Authorization: Bearer $CRON_SECRET`; admins POST with their JWT.
export async function GET(req: Request) { return handle(req); }
export async function POST(req: Request) { return handle(req); }

async function handle(req: Request) {
  // ── auth ──
  const url = new URL(req.url);
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  const procSecret = process.env.DELIVERY_PROCESSOR_SECRET || "";
  const cronSecret = process.env.CRON_SECRET || "";
  const secret = req.headers.get("x-delivery-secret") || url.searchParams.get("secret") || "";
  // Secret auth: explicit header/query, OR a Bearer that matches the processor/cron secret (Vercel cron).
  let authed = !!procSecret && (secretEq(secret, procSecret) || secretEq(bearer, procSecret));
  if (!authed && cronSecret) authed = secretEq(bearer, cronSecret);
  // Else: a logged-in staff bearer (can_manage_quotes) — the admin "process now" button.
  if (!authed && bearer && !secretEq(bearer, procSecret) && !secretEq(bearer, cronSecret)) {
    const perm = await rpcAsUser<boolean>("can_manage_quotes", {}, bearer);
    authed = perm.ok && perm.data === true;
  }
  if (!authed) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  if (!flag("DELIVERY_PROCESSOR_ENABLED")) return NextResponse.json({ ok: true, disabled: true, processed: 0 }, { status: 200 });

  const dryRun = flag("DELIVERY_DRY_RUN", true);
  const emailOn = flag("EMAIL_SEND_ENABLED");
  const waOn = flag("WHATSAPP_DELIVERY_ENABLED");
  const emailAllowAll = flag("EMAIL_ALLOW_ALL");
  const waAllowAll = flag("WHATSAPP_ALLOW_ALL");
  const emailAllow = list("EMAIL_TEST_ALLOWLIST").map((s) => s.toLowerCase());
  const waAllow = list("WHATSAPP_TEST_ALLOWLIST").map(toE164Digits).filter(Boolean);
  const maxRetries = Number(process.env.DELIVERY_MAX_RETRIES || 3);
  const batch = Math.max(1, Math.min(Number(process.env.DELIVERY_BATCH_LIMIT || 25), 200));

  const claimed = await rpcAsService<Row[]>("claim_deliveries", { p_limit: batch, p_channels: ["email", "whatsapp"] });
  if (!claimed.ok) return NextResponse.json({ ok: false, error: claimed.error }, { status: claimed.status || 502 });
  const rows = claimed.data ?? [];

  const counts = { sent: 0, failed: 0, skipped: 0, dry_run: 0 };
  for (const row of rows) {
    let status: "sent" | "failed" | "skipped" | "dry_run" = "skipped";
    let provider: string | null = null, messageId: string | null = null, error: string | null = null, bump = false;

    if (row.channel === "email") {
      const to = (row.destination_email || "").toLowerCase();
      if (!to || !to.includes("@")) { status = "skipped"; error = "no_email"; }
      else if (!emailAllowAll && !emailAllow.includes(to)) { status = "skipped"; error = "not_allowlisted"; }
      else if (!emailOn || dryRun) { status = "dry_run"; provider = "email"; error = !emailOn ? "channel_disabled" : "dry_run"; }
      else {
        const r = renderEmail(row);
        const out = await sendEmail({ to: row.destination_email as string, subject: r.subject, html: r.html, text: r.text, idempotencyKey: row.idempotency_key });
        status = out.status; provider = out.provider; messageId = out.messageId; error = out.error;
        if (status === "failed") bump = true;
      }
    } else if (row.channel === "whatsapp") {
      const e164 = toE164Digits(row.destination_phone);
      const tmpl = whatsappTemplate(row);
      if (!e164) { status = "skipped"; error = "invalid_phone"; }
      else if (!tmpl) { status = "skipped"; error = "no_approved_template"; }     // client event with no approved template
      else if (!waAllowAll && !waAllow.includes(e164)) { status = "skipped"; error = "not_allowlisted"; }
      else if (!waOn || dryRun) { status = "dry_run"; provider = "whatsapp"; error = !waOn ? "channel_disabled" : "dry_run"; }
      else {
        const out = await sendWhatsAppTemplate({
          to: e164, templateName: tmpl.name, language: "ar", variables: tmpl.variables,
          event_type: row.event_type, entity_type: row.entity_type, entity_id: row.entity_id,
          recipient_role: row.recipient_role, portal_url: portalUrl(row.event_type, row.recipient_role),
          idempotency_key: row.idempotency_key,
        });
        status = out.status; provider = out.provider; messageId = out.messageId; error = out.error;
        if (status === "failed") bump = true;
      }
    }

    // Auto-retry: a transient failure with retries left goes back to 'pending' (reclaimed next run).
    let finalStatus: string = status;
    if (status === "failed" && row.retry_count + 1 < maxRetries) finalStatus = "pending";
    await rpcAsService("mark_delivery_result", {
      p_id: row.id, p_status: finalStatus, p_provider: provider, p_message_id: messageId, p_error: error, p_bump_retry: bump,
    });
    counts[status] = (counts[status] ?? 0) + 1;
  }

  return NextResponse.json({ ok: true, dry_run_mode: dryRun, email_send: emailOn, whatsapp_send: waOn, claimed: rows.length, ...counts }, { status: 200 });
}
