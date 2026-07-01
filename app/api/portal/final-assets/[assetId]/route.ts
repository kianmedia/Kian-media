// ════════════════════════════════════════════════════════════════════════
// GET /api/portal/final-assets/[assetId]   (SERVER-ONLY)
//
// Streams a FINAL (clean, non-watermarked) delivered asset to an authorized
// client. Security:
//   1) requires the user's bearer (sent by the download link via fetch()).
//   2) get_final_asset_for_stream() runs AS THE USER → returns the storage path
//      ONLY if they are admin OR (a project member AND the asset is marked
//      available_to_client).
//   3) bytes are read from the PRIVATE finals bucket via the service role.
// The storage path / bucket never reach the browser. Content-Disposition=attachment.
// ════════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import { rpcAsUser } from "@/lib/server/supabaseAdmin";
import { downloadObject, FINALS_BUCKET } from "@/lib/server/previewStorage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface FinalRow { final_storage_path: string; mime_type: string | null; original_file_name: string | null; asset_type: string }

const safeName = (n: string | null) => (n || "kian-final").replace(/[^\w.\-]+/g, "_").slice(-80);

export async function GET(req: Request, { params }: { params: { assetId: string } }) {
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!bearer) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const assetId = (params.assetId || "").trim();
  if (!/^[0-9a-fA-F-]{36}$/.test(assetId)) return NextResponse.json({ error: "bad_asset_id" }, { status: 400 });

  const r = await rpcAsUser<FinalRow[]>("get_final_asset_for_stream", { p_asset: assetId }, bearer);
  if (!r.ok) return NextResponse.json({ error: "lookup_failed" }, { status: r.status || 502 });
  const row = Array.isArray(r.data) ? r.data[0] : (r.data as unknown as FinalRow | null);
  if (!row || !row.final_storage_path) return NextResponse.json({ error: "not_found_or_forbidden" }, { status: 404 });

  try {
    const { bytes, contentType } = await downloadObject(FINALS_BUCKET, row.final_storage_path);
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": row.mime_type || contentType || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${safeName(row.original_file_name)}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Length": String(bytes.byteLength),
      },
    });
  } catch (e) {
    return NextResponse.json({ error: `stream_failed:${String((e as Error)?.message ?? e).slice(0, 80)}` }, { status: 502 });
  }
}
