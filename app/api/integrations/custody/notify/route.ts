// ════════════════════════════════════════════════════════════════════════
// POST /api/integrations/custody/notify   (SERVER-ONLY, STAGED channel relay)
//
// The browser fires this AFTER a successful custody RPC (portal notifications
// are already written by the RPC — this only feeds the staged n8n email/WhatsApp
// fan-out). Auth: the caller's JWT must resolve a profile AND must be able to
// SEE the record via RLS (selectAsUser) — a user cannot emit events for records
// that aren't theirs. Fail-closed when N8N_NOTIFY_WEBHOOK_URL is unset.
// Never returns an error that would break the client flow.
// ════════════════════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { selectAsUser } from "@/lib/server/supabaseAdmin";
import { postCustodyEvent, custodyWebhookConfigured } from "@/lib/server/custodyNotify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

const EVENTS = new Set([
  "custody_checkout_new", "rental_request_new", "custody_return_submitted",
  "custody_return_shortage", "custody_handover_approved", "custody_closed",
  "custody_rejected", "custody_note_new",
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

  if (!custodyWebhookConfigured()) {
    // Staged channel — nothing to send yet; the portal notification already exists.
    return NextResponse.json({ ok: true, sent: false, reason: "not_configured" }, { status: 200 });
  }

  // The caller must be able to SEE the record (RLS as the user) — blocks forgery.
  const rec = await selectAsUser<{ id: string; record_no: string; kind: string; party_name: string }[]>(
    `custody_records?id=eq.${encodeURIComponent(recordId)}&select=id,record_no,kind,party_name&limit=1`, bearer);
  if (!rec.ok || !rec.data[0]) return NextResponse.json({ ok: false, error: "not_visible" }, { status: 403 });

  const r = rec.data[0];
  const out = await postCustodyEvent({
    event, record_id: r.id, record_no: r.record_no, kind: r.kind, party_name: r.party_name,
    urgent: event === "custody_return_shortage",
    channels: ["portal", "email", "whatsapp"],
  });
  return NextResponse.json({ ok: true, ...out }, { status: 200 });
}
