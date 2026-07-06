// ════════════════════════════════════════════════════════════════════════
// /api/integrations/custody/notify   (SERVER-ONLY)
//
// GET  → safe env diagnostic (no secrets/URLs): proves at runtime whether the
//        deployed build sees CUSTODY_EMAIL_ALERTS_ENABLED / PORTAL_NOTIFY_ENDPOINT
//        / the service key, and which environment it is (production/preview).
// POST → fired by the browser AFTER a successful custody action. Relays to:
//        EMAIL (Apps Script channel — admins+owner+manager+custody_officer+party)
//        and the staged n8n webhook. Portal rows are written by the SQL RPCs.
//        Every step logs (custody_notify_event_created / custody_email_*).
// ════════════════════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { selectAsUser, selectAsService, adminConfigured } from "@/lib/server/supabaseAdmin";
import {
  postCustodyEvent, sendCustodyEmail, custodyWebhookConfigured,
  custodyEmailEnabled, emailEndpoint, emailEndpointHost, runtimeEnv,
} from "@/lib/server/custodyNotify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const log = (tag: string, extra: Record<string, unknown>) => console.log(JSON.stringify({ tag, ...extra }));

const RECORD_EVENTS = new Set([
  "custody_checkout_new", "rental_request_new", "custody_return_submitted",
  "custody_return_shortage", "custody_handover_approved", "custody_closed",
  "custody_rejected", "custody_note_new",
  "custody_claim_pending", "custody_claim_acknowledged",
]);
// طلب عرض سعر تأجير معدات — ليس سجل عهدة؛ يُتحقق من هوية المرسل فقط.
const QUOTE_EVENTS = new Set(["rental_quote_request_new"]);

/** GET — تشخيص آمن: هل البيئة المنشورة ترى المتغيرات فعلاً؟ */
export async function GET() {
  return NextResponse.json({
    ok: true,
    runtime_env: runtimeEnv(),
    email_enabled: custodyEmailEnabled(),
    has_endpoint: emailEndpoint().startsWith("https://"),
    endpoint_host: emailEndpointHost(),          // اسم المضيف فقط — بلا الرابط الكامل
    webhook_configured: custodyWebhookConfigured(),
    service_key_present: adminConfigured(),
  }, { status: 200 });
}

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!bearer) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  let b: Record<string, unknown>;
  try { b = (await req.json()) as Record<string, unknown>; } catch { return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 }); }

  const event = str(b.event);
  const recordId = str(b.record_id);
  const isRecordEvent = RECORD_EVENTS.has(event);
  const isQuoteEvent = QUOTE_EVENTS.has(event);
  if ((!isRecordEvent && !isQuoteEvent) || !recordId) {
    return NextResponse.json({ ok: false, error: "invalid_event" }, { status: 400 });
  }

  log("custody_notify_event_created", {
    event_type: event, record_id: recordId,
    email_enabled: custodyEmailEnabled(), has_endpoint: emailEndpoint().startsWith("https://"),
    webhook_configured: custodyWebhookConfigured(), service_key_present: adminConfigured(),
    runtime_env: runtimeEnv(),
  });

  // ── تحقق الهوية/الملكية ──
  let payload: { event: string; record_id: string; record_no?: string; kind?: string;
                 party_name?: string; urgent?: boolean; amount?: number; reference?: string;
                 channels: string[] };
  let partyUserId = "";

  if (isRecordEvent) {
    // يجب أن يرى المرسل السجل عبر RLS — يمنع تزوير الأحداث.
    const rec = await selectAsUser<{ id: string; record_no: string; kind: string; party_name: string; party_user_id: string; claim_amount: number | null }[]>(
      `custody_records?id=eq.${encodeURIComponent(recordId)}&select=id,record_no,kind,party_name,party_user_id,claim_amount&limit=1`, bearer);
    if (!rec.ok || !rec.data[0]) {
      log("custody_email_skipped", { reason: "record_not_visible", event_type: event, record_id: recordId, detail: rec.ok ? "empty" : rec.error });
      return NextResponse.json({ ok: false, error: "not_visible" }, { status: 403 });
    }
    const r = rec.data[0];
    partyUserId = r.party_user_id;
    payload = {
      event, record_id: r.id, record_no: r.record_no, kind: r.kind, party_name: r.party_name,
      urgent: event === "custody_return_shortage" || event === "custody_claim_pending",
      amount: typeof b.amount === "number" ? (b.amount as number) : (r.claim_amount ?? undefined),
      channels: ["portal", "email", "whatsapp"],
    };
  } else {
    // حدث عرض سعر: يكفي إثبات هوية المرسل (قراءة ملفه بمفتاحه — توقيع JWT يُتحقق في PostgREST).
    const me = await selectAsUser<{ id: string; email: string | null; full_name: string | null }[]>(
      `profiles?select=id,email,full_name&limit=1`, bearer);
    if (!me.ok || !me.data[0]) {
      log("custody_email_skipped", { reason: "auth_failed", event_type: event, record_id: recordId });
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
    partyUserId = me.data[0].id;
    payload = {
      event, record_id: recordId,
      reference: str(b.reference) || undefined,
      kind: "rental", party_name: str(b.party_name) || me.data[0].full_name || me.data[0].email || "",
      urgent: false, channels: ["portal", "email", "whatsapp"],
    };
  }

  // ── حساب المستلمين (قراءة فقط بمفتاح الخدمة؛ الفشل يُسجَّل ولا يُسقط الإرسال) ──
  const recipients: string[] = [];
  if (custodyEmailEnabled()) {
    const staff = await selectAsService<{ email: string | null }[]>(
      `profiles?select=email&account_status=eq.active&or=(account_type.eq.admin,staff_role.in.(super_admin,manager,custody_officer))`);
    if (staff.ok) staff.data.forEach((p) => { if (p.email) recipients.push(p.email); });
    else log("custody_email_recipients_partial", { reason: "staff_query_failed", detail: staff.error, service_key_present: adminConfigured() });

    if (partyUserId) {
      const party = await selectAsService<{ email: string | null }[]>(
        `profiles?select=email&id=eq.${encodeURIComponent(partyUserId)}&limit=1`);
      if (party.ok && party.data[0]?.email) recipients.push(party.data[0].email);
      else if (!party.ok) log("custody_email_recipients_partial", { reason: "party_query_failed", detail: party.error });
    }
  }

  // ── الإرسال (كلاهما يسجّل نتيجته دائماً) ──
  const email = await sendCustodyEmail({ ...payload, recipients });
  const webhook = await postCustodyEvent(payload);

  return NextResponse.json({ ok: true, email, webhook, recipient_count: recipients.length }, { status: 200 });
}
