// ════════════════════════════════════════════════════════════════════════
// POST /api/integrations/custody/notify   (SERVER-ONLY, staged channel relay)
//
// Fired by the browser AFTER a successful custody RPC (portal notifications are
// already written by the RPC). This relays the event to:
//   1) EMAIL (Apps Script channel) → admins + super_admin/manager +
//      custody_officer (أمين العهدة) + the record's party — gated by
//      CUSTODY_EMAIL_ALERTS_ENABLED (default off, fail-closed).
//   2) the staged n8n webhook (email/WhatsApp fan-out later) — fail-closed
//      until N8N_NOTIFY_WEBHOOK_URL is set.
// Auth: the caller's JWT must SEE the record via RLS — no forged events.
// Recipient emails are read server-side (service role, READ-only) exactly like
// the existing WhatsApp alert route computes its recipients.
// ════════════════════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { selectAsUser, selectAsService } from "@/lib/server/supabaseAdmin";
import { postCustodyEvent, sendCustodyEmail, custodyWebhookConfigured, custodyEmailEnabled } from "@/lib/server/custodyNotify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

const EVENTS = new Set([
  "custody_checkout_new", "rental_request_new", "custody_return_submitted",
  "custody_return_shortage", "custody_handover_approved", "custody_closed",
  "custody_rejected", "custody_note_new",
  "custody_claim_pending", "custody_claim_acknowledged",
]);

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!bearer) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  let b: Record<string, unknown>;
  try { b = (await req.json()) as Record<string, unknown>; } catch { return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 }); }

  const event = str(b.event);
  const recordId = str(b.record_id);
  if (!EVENTS.has(event) || !recordId) return NextResponse.json({ ok: false, error: "invalid_event" }, { status: 400 });

  if (!custodyWebhookConfigured() && !custodyEmailEnabled()) {
    // Both staged channels off — the portal notification already exists.
    return NextResponse.json({ ok: true, sent: false, reason: "not_configured" }, { status: 200 });
  }

  // The caller must be able to SEE the record (RLS as the user) — blocks forgery.
  const rec = await selectAsUser<{ id: string; record_no: string; kind: string; party_name: string; party_user_id: string; claim_amount: number | null }[]>(
    `custody_records?id=eq.${encodeURIComponent(recordId)}&select=id,record_no,kind,party_name,party_user_id,claim_amount&limit=1`, bearer);
  if (!rec.ok || !rec.data[0]) return NextResponse.json({ ok: false, error: "not_visible" }, { status: 403 });
  const r = rec.data[0];

  const payload = {
    event, record_id: r.id, record_no: r.record_no, kind: r.kind, party_name: r.party_name,
    urgent: event === "custody_return_shortage" || event === "custody_claim_pending",
    amount: typeof b.amount === "number" ? (b.amount as number) : (r.claim_amount ?? undefined),
    channels: ["portal", "email", "whatsapp"],
  };

  // EMAIL: admins + super_admin/manager/custody_officer + the party (fail-closed).
  if (custodyEmailEnabled()) {
    const recipients: string[] = [];
    const staff = await selectAsService<{ email: string | null }[]>(
      `profiles?select=email&account_status=eq.active&or=(account_type.eq.admin,staff_role.in.(super_admin,manager,custody_officer))`);
    if (staff.ok) staff.data.forEach((p) => { if (p.email) recipients.push(p.email); });
    const party = await selectAsService<{ email: string | null }[]>(
      `profiles?select=email&id=eq.${encodeURIComponent(r.party_user_id)}&limit=1`);
    if (party.ok && party.data[0]?.email) recipients.push(party.data[0].email);
    await sendCustodyEmail({ ...payload, recipients });
  }

  // n8n webhook (staged; WhatsApp node stays disabled inside n8n).
  const out = await postCustodyEvent(payload);
  return NextResponse.json({ ok: true, ...out }, { status: 200 });
}
