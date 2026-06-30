// ════════════════════════════════════════════════════════════════════════
// GET /api/portal/preview-assets/[assetId]   (SERVER-ONLY)
//
// Streams a WATERMARKED preview asset to an authorized client. Security:
//   1) requires the user's bearer (sent by the gallery/player via fetch()).
//   2) get_preview_asset_for_stream() runs AS THE USER → returns the storage path
//      ONLY if they are admin or a member of the asset's project and it is 'ready'.
//   3) the bytes are read from the PRIVATE bucket via the service role and streamed.
// The Google Drive source id/url and the storage path NEVER reach the browser.
// ════════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import { rpcAsUser } from "@/lib/server/supabaseAdmin";
import { downloadPreview } from "@/lib/server/previewStorage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface StreamRow { preview_storage_path: string; preview_mime_type: string | null; asset_type: string }

export async function GET(req: Request, { params }: { params: { assetId: string } }) {
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!bearer) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const assetId = (params.assetId || "").trim();
  if (!/^[0-9a-fA-F-]{36}$/.test(assetId)) return NextResponse.json({ error: "bad_asset_id" }, { status: 400 });

  // Authorize + resolve the storage path AS THE USER (RLS/membership enforced in DB).
  const r = await rpcAsUser<StreamRow[]>("get_preview_asset_for_stream", { p_asset: assetId }, bearer);
  if (!r.ok) return NextResponse.json({ error: "lookup_failed" }, { status: r.status || 502 });
  const row = Array.isArray(r.data) ? r.data[0] : (r.data as unknown as StreamRow | null);
  if (!row || !row.preview_storage_path) return NextResponse.json({ error: "not_found_or_forbidden" }, { status: 404 });

  try {
    const { bytes, contentType } = await downloadPreview(row.preview_storage_path);
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": row.preview_mime_type || contentType || "application/octet-stream",
        "Content-Disposition": "inline",
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
        "Content-Length": String(bytes.byteLength),
      },
    });
  } catch (e) {
    return NextResponse.json({ error: `stream_failed:${String((e as Error)?.message ?? e).slice(0, 80)}` }, { status: 502 });
  }
}
