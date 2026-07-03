// ════════════════════════════════════════════════════════════════════════
// POST /api/integrations/zoho/estimate-respond   (SERVER-ONLY)
//
// A client accepts/declines a visible estimate. The local status is updated via
// client_respond_quote (RLS enforces it's THEIR quote, by client_id or verified
// email, and that it's visible + non-empty). Then, best-effort, the Zoho estimate
// status is synced. NEVER creates an invoice. Graceful when Zoho is unconfigured.
// ════════════════════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { rpcAsUser } from "@/lib/server/supabaseAdmin";
import { estimatesConfigured, markEstimateStatus } from "@/lib/server/zohoBooksEstimates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const asStr = (v: unknown) => (typeof v === "string" ? v : "");

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!bearer) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  let b: { quote_id?: unknown; response?: unknown; note?: unknown; zoho_estimate_id?: unknown };
  try { b = await req.json(); } catch { return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 }); }
  const quoteId = asStr(b.quote_id);
  const response = asStr(b.response) === "accepted" || asStr(b.response) === "accept" ? "accepted"
    : asStr(b.response) === "declined" || asStr(b.response) === "decline" ? "declined" : "";
  if (!quoteId || !response) return NextResponse.json({ ok: false, error: "quote_id_and_response_required" }, { status: 400 });

  // Local (RLS-enforced ownership + non-empty + visible).
  const r = await rpcAsUser<boolean>("client_respond_quote", { p_quote: quoteId, p_response: response, p_note: asStr(b.note) || null }, bearer);
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status && r.status < 500 ? r.status : 200 });

  // Best-effort Zoho status sync (never fails the client action).
  let zoho: string | null = null;
  const zid = asStr(b.zoho_estimate_id);
  if (zid && estimatesConfigured()) {
    const m = await markEstimateStatus(zid, response === "accepted" ? "accepted" : "declined");
    zoho = m.ok ? response : `skip_${m.reason}`;
  }
  return NextResponse.json({ ok: true, response, zoho_status: zoho }, { status: 200 });
}
