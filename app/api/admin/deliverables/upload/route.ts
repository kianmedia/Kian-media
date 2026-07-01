// ════════════════════════════════════════════════════════════════════════
// POST /api/admin/deliverables/upload   (SERVER-ONLY, admin, multipart)
//
// Direct device uploads. Fields: file, projectId, deliverableId?, kind, assetType?
//   kind='image_preview' → watermark (sharp) → PRIVATE previews bucket → 'ready'.
//   kind='audio_preview'  → store original in PRIVATE originals bucket → 'needs_worker'
//                           (audible "Kian Media" watermark needs an ffmpeg worker;
//                            the ORIGINAL is never served to the client).
//   kind='final'          → store clean file in PRIVATE finals bucket (delivered
//                           only after admin marks it available).
// Auth: admin bearer (is_admin verified in DB). Missing config → clear warning, no crash.
// NOTE: Vercel serverless request bodies are size-limited (~4.5 MB on Hobby). Large
// media should use the Drive-import path or a resumable/worker upload (documented).
// ════════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import { rpcAsUser } from "@/lib/server/supabaseAdmin";
import { imageProcessorAvailable, makeWatermarkedImage } from "@/lib/server/imageWatermark";
import { uploadObject, storageConfigured, PREVIEW_BUCKET, ORIGINALS_BUCKET, FINALS_BUCKET } from "@/lib/server/previewStorage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sanitize = (name: string) => (name || "file").replace(/[^\w.\-]+/g, "_").slice(-80);
const stamp = () => `${Date.now()}-${Math.floor(Date.now() % 100000)}`;

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!bearer) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const admin = await rpcAsUser<boolean>("is_admin", {}, bearer);
  if (!admin.ok || admin.data !== true) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ ok: false, error: "bad_form" }, { status: 400 }); }
  const file = form.get("file");
  const projectId = String(form.get("projectId") || "").trim();
  const deliverableId = String(form.get("deliverableId") || "").trim() || undefined;
  const kind = String(form.get("kind") || "image_preview");
  const finalType = String(form.get("assetType") || "audio");
  if (!(file instanceof Blob)) return NextResponse.json({ ok: false, error: "file_required" }, { status: 400 });
  if (!projectId) return NextResponse.json({ ok: false, error: "project_required" }, { status: 400 });
  if (!storageConfigured()) return NextResponse.json({ ok: false, setup_required: true, warnings: ["Supabase storage not configured — set SUPABASE_SERVICE_ROLE_KEY and run the media migration (creates the private buckets)."] }, { status: 200 });

  const name = sanitize((file as File).name || "upload");
  const mime = file.type || "application/octet-stream";
  const bytes = Buffer.from(await file.arrayBuffer());
  const savePreview = (p: Record<string, unknown>) => rpcAsUser<string>("admin_save_preview_asset", { p }, bearer);
  const saveFinal = (p: Record<string, unknown>) => rpcAsUser<string>("admin_save_final_asset", { p }, bearer);

  try {
    if (kind === "image_preview") {
      if (!imageProcessorAvailable()) {
        await savePreview({ project_id: projectId, deliverable_id: deliverableId, asset_type: "image", source_provider: "direct_upload", original_file_name: name, status: "failed", watermark_applied: false, error_message: "image_processor_unavailable" });
        return NextResponse.json({ ok: false, setup_required: true, warnings: ["Image watermark processor not installed — run `npm i sharp` and redeploy."] }, { status: 200 });
      }
      const { bytes: out, mime: outMime } = await makeWatermarkedImage(bytes, { label: "Kian Media" });
      const path = `${projectId}/${stamp()}-${name}.jpg`;
      await uploadObject(PREVIEW_BUCKET, path, out, outMime);
      const r = await savePreview({ project_id: projectId, deliverable_id: deliverableId, asset_type: "image", source_provider: "direct_upload", original_file_name: name, preview_storage_path: path, preview_mime_type: outMime, watermark_applied: true, status: "ready" });
      return NextResponse.json({ ok: r.ok, created: [{ id: r.ok ? r.data : undefined, asset_type: "image", status: "ready" }] }, { status: 200 });
    }

    if (kind === "audio_preview") {
      // Store the ORIGINAL privately (admin-only) so a worker can generate the
      // watermarked preview later. The client is served NOTHING until 'ready'.
      const path = `${projectId}/${stamp()}-${name}`;
      await uploadObject(ORIGINALS_BUCKET, path, bytes, mime);
      await savePreview({ project_id: projectId, deliverable_id: deliverableId, asset_type: "audio", source_provider: "direct_upload", original_file_name: name, original_storage_path: path, status: "needs_worker", watermark_applied: false, error_message: "audio_watermark_requires_external_worker" });
      return NextResponse.json({ ok: true, needs_worker: true, created: [{ asset_type: "audio", status: "needs_worker" }], warnings: ["Audio preview queued. The audible “Kian Media” watermark needs an external ffmpeg worker (KIAN_AUDIO_WATERMARK_PATH). The client only sees it once a worker marks it 'ready'. The original is never served to the client."] }, { status: 200 });
    }

    if (kind === "final") {
      const at = ["audio", "image", "video", "file"].includes(finalType) ? finalType : "file";
      const path = `${projectId}/${stamp()}-${name}`;
      await uploadObject(FINALS_BUCKET, path, bytes, mime);
      const r = await saveFinal({ project_id: projectId, deliverable_id: deliverableId, asset_type: at, final_storage_path: path, original_file_name: name, mime_type: mime });
      return NextResponse.json({ ok: r.ok, created: [{ id: r.ok ? r.data : undefined, asset_type: at, status: "stored" }] }, { status: 200 });
    }

    return NextResponse.json({ ok: false, error: "unknown_kind" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: `upload_failed:${String((e as Error)?.message ?? e).slice(0, 120)}` }, { status: 502 });
  }
}
