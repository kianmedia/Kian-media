// ════════════════════════════════════════════════════════════════════════
// POST /api/integrations/zoho/webhook — استقبال Zoho Books Webhooks (SERVER-ONLY).
//
// الحماية: ZOHO_BOOKS_WEBHOOK_SECRET (query ?secret= أو Header x-webhook-secret).
// - Dedup: remote_event_id فريد + payload_hash.
// - يخزّن الحدث في zoho_webhook_events ويُحدّث حالة/مبالغ الخريطة المرتبطة فقط
//   (metadata.remote) — لا يعدّل بيانات كيان التشغيلية أو المالية مباشرة؛
//   الفروقات تظهر في تقرير Reconciliation وتُطبَّق بقرار مالي بشري.
// - منع Sync loop: أحداث مصدرها كيان (reference KIAN-) تُعلَّم processed فورًا.
// ════════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import { selectAsService, patchAsService } from "@/lib/server/supabaseAdmin";
import { postAsService } from "@/lib/server/zohoUpsert";
import { createHash } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const log = (tag: string, extra: Record<string, unknown>) => console.log(JSON.stringify({ tag, ...extra }));

export async function POST(req: Request) {
  const secret = process.env.ZOHO_BOOKS_WEBHOOK_SECRET ?? "";
  if (!secret) return NextResponse.json({ ok: false, error: "webhook_not_configured" }, { status: 503 });
  const url = new URL(req.url);
  const provided = url.searchParams.get("secret") ?? req.headers.get("x-webhook-secret") ?? "";
  if (provided !== secret) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  let raw = "";
  try { raw = await req.text(); } catch { return NextResponse.json({ ok: false, error: "bad_body" }, { status: 400 }); }
  if (raw.length > 200_000) return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
  let body: Record<string, unknown> = {};
  try { body = raw ? JSON.parse(raw) : {}; } catch { body = { raw: raw.slice(0, 5000) }; }

  const hash = createHash("md5").update(raw).digest("hex");
  // استخراج مرن لهوية الحدث والكيان من صيغ Zoho Books المتعددة.
  const inv = (body.invoice ?? body.data) as Record<string, unknown> | undefined;
  const entityType = body.invoice ? "invoice" : body.bill ? "bill" : body.expense ? "expense" : body.payment ? "payment" : String(body.module ?? "unknown");
  const ent = (body.invoice ?? body.bill ?? body.expense ?? body.payment ?? inv ?? {}) as Record<string, unknown>;
  const entityId = String(ent.invoice_id ?? ent.bill_id ?? ent.expense_id ?? ent.payment_id ?? "");
  const eventId = String(body.event_id ?? `${entityType}:${entityId}:${hash}`);
  const reference = String(ent.reference_number ?? "");

  // Dedup — الحدث المكرر يُقبل بصمت (Zoho يعيد الإرسال).
  const ins = await postAsService(`zoho_webhook_events`, {
    remote_event_id: eventId, event_type: String(body.event_type ?? entityType), entity_type: entityType,
    entity_id: entityId, organization_id: String(ent.organization_id ?? body.organization_id ?? ""),
    payload_hash: hash, payload: body,
  });
  if (!ins.ok && /HTTP 409/.test(ins.error ?? "")) return NextResponse.json({ ok: true, dedup: true });

  // تحديث الخريطة المرتبطة (metadata.remote) — قراءة عكسية آمنة.
  let note = "stored";
  if (entityId) {
    const m = await selectAsService<Array<{ id: string; metadata: Record<string, unknown> }>>(
      `zoho_entity_mappings?zoho_entity_id=eq.${encodeURIComponent(entityId)}&select=id,metadata&limit=1`);
    if (m.ok && Array.isArray(m.data) && m.data[0]) {
      const remote = {
        status: ent.status ?? null, total: ent.total ?? null, balance: ent.balance ?? null,
        paid: ent.payment_made ?? ent.amount_applied ?? null, updated_at: new Date().toISOString(),
      };
      await patchAsService(`zoho_entity_mappings?id=eq.${m.data[0].id}`, {
        metadata: { ...(m.data[0].metadata ?? {}), remote }, last_remote_hash: hash, updated_at: new Date().toISOString(),
      });
      note = "mapping_updated";
    } else if (!reference.startsWith("KIAN-")) {
      note = "unmapped_remote_entity";   // سيظهر في Reconciliation كسجل بلا Mapping
    }
  }
  await patchAsService(`zoho_webhook_events?remote_event_id=eq.${encodeURIComponent(eventId)}`, {
    processed_at: new Date().toISOString(), process_note: note,
  });
  log("ZOHO_WEBHOOK", { entityType, note });
  return NextResponse.json({ ok: true, note });
}
