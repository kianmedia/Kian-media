// ════════════════════════════════════════════════════════════════════════
// GET /api/integrations/zoho/estimate-pdf?quote_id=...   (SERVER-ONLY)
//
// Streams the official Zoho Books estimate PDF to an AUTHORIZED portal user.
// Authorization is delegated entirely to RLS: we read the quote row with the
// caller's JWT (selectAsUser), so PostgREST returns it ONLY when the caller is
// admin/staff OR the verified-email/own-client RLS grants it. A client can pull
// ONLY their own published estimate's PDF; the Zoho OAuth token never reaches the
// browser. Graceful when Zoho is unconfigured. Never issues/sends anything.
// ════════════════════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { selectAsUser } from "@/lib/server/supabaseAdmin";
import { fetchEstimatePdf } from "@/lib/server/zohoBooksEstimates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface QRow { id: string; zoho_estimate_id: string | null; source: string | null }

export async function GET(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!bearer) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const quoteId = new URL(req.url).searchParams.get("quote_id") ?? "";
  if (!quoteId) return NextResponse.json({ ok: false, error: "quote_id_required" }, { status: 400 });

  // RLS gate: empty result ⇒ the caller may not see this quote.
  const q = await selectAsUser<QRow[]>(
    `quotes?id=eq.${encodeURIComponent(quoteId)}&select=id,zoho_estimate_id,source&limit=1`, bearer);
  if (!q.ok) return NextResponse.json({ ok: false, error: q.error }, { status: q.status && q.status < 500 ? q.status : 502 });
  const row = q.data?.[0];
  if (!row) return NextResponse.json({ ok: false, error: "not_found_or_forbidden" }, { status: 404 });
  if (!row.zoho_estimate_id || row.source !== "zoho") {
    return NextResponse.json({ ok: false, error: "no_zoho_estimate" }, { status: 404 });
  }

  const pdf = await fetchEstimatePdf(row.zoho_estimate_id);
  if (!pdf.ok) return NextResponse.json({ ok: false, configured: pdf.configured, reason: pdf.reason }, { status: 200 });

  return new NextResponse(Buffer.from(pdf.data.bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${pdf.data.filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
