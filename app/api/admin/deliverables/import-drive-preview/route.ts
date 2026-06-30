// ════════════════════════════════════════════════════════════════════════
// POST /api/admin/deliverables/import-drive-preview   (SERVER-ONLY, admin)
//
// Admin imports a Google Drive image/file/folder link → server fetches the
// original (service-account creds, never exposed), bakes a "Kian Media" watermark
// into a downscaled JPEG, uploads it to the PRIVATE bucket, and records a preview
// asset. Originals are never stored or returned. Audio watermarking needs an
// external worker (ffmpeg) — V1 records a 'failed' asset + a clear setup warning.
//
// Auth: a logged-in admin's bearer (is_admin() verified in the DB). Missing Drive
// or Supabase config returns a clear warning (HTTP 200, ok:false) — never a crash.
// ════════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import { rpcAsUser } from "@/lib/server/supabaseAdmin";
import { driveConfigured, parseDriveRef, getDriveFileMeta, downloadDriveFile, listFolderImages } from "@/lib/server/googleDrive";
import { imageProcessorAvailable, makeWatermarkedImage } from "@/lib/server/imageWatermark";
import { uploadPreview, storageConfigured } from "@/lib/server/previewStorage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILES = Math.max(1, Math.min(Number(process.env.PREVIEW_FOLDER_MAX_FILES || 30), 100));

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!bearer) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const admin = await rpcAsUser<boolean>("is_admin", {}, bearer);
  if (!admin.ok || admin.data !== true) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  let body: { projectId?: string; deliverableId?: string; driveUrl?: string; assetType?: "image" | "audio" };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "bad_json" }, { status: 400 }); }
  const projectId = (body.projectId || "").trim();
  const assetType = body.assetType === "audio" ? "audio" : "image";
  if (!projectId) return NextResponse.json({ ok: false, error: "project_required" }, { status: 400 });

  const ref = parseDriveRef(body.driveUrl || "");
  if (!ref) return NextResponse.json({ ok: false, error: "invalid_drive_url" }, { status: 400 });

  // Config gates → clear setup warnings (no crash).
  const warnings: string[] = [];
  if (!driveConfigured()) warnings.push("Google Drive not configured — set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_SERVICE_ACCOUNT_KEY, and share the file/folder with that service account.");
  if (!storageConfigured()) warnings.push("Supabase storage not configured — set SUPABASE_SERVICE_ROLE_KEY and run the migration (creates the private 'deliverable-previews' bucket).");
  if (warnings.length) return NextResponse.json({ ok: false, setup_required: true, warnings }, { status: 200 });

  const save = (p: Record<string, unknown>) => rpcAsUser<string>("admin_save_preview_asset", { p }, bearer);

  // ── AUDIO (V1): no in-process watermarking on serverless → record + warn. ──
  if (assetType === "audio") {
    let fileMeta: { id: string; name: string } | null = null;
    try { fileMeta = await getDriveFileMeta(ref.id); } catch { /* keep going with id only */ }
    await save({
      project_id: projectId, deliverable_id: body.deliverableId, asset_type: "audio",
      source_file_id: ref.kind === "file" ? ref.id : null, source_folder_id: ref.kind === "folder" ? ref.id : null,
      original_file_name: fileMeta?.name ?? null, status: "failed", watermark_applied: false,
      error_message: "audio_watermark_requires_external_worker",
    });
    return NextResponse.json({
      ok: false, setup_required: true, created: [{ asset_type: "audio", status: "failed" }],
      warnings: ["Audio watermarking (a 'Kian Media' voice every 20s) needs an external ffmpeg worker — not available on Vercel serverless. The asset was recorded as 'failed'. See docs/portal_quote_project_preview_fixes_RUNME.sql + .env.example (KIAN_AUDIO_WATERMARK_PATH) and run an admin-side processing job."],
    }, { status: 200 });
  }

  // ── IMAGE: requires the sharp processor. ──
  if (!imageProcessorAvailable()) {
    await save({
      project_id: projectId, deliverable_id: body.deliverableId, asset_type: "image",
      source_file_id: ref.kind === "file" ? ref.id : null, source_folder_id: ref.kind === "folder" ? ref.id : null,
      status: "failed", watermark_applied: false, error_message: "image_processor_unavailable",
    });
    return NextResponse.json({ ok: false, setup_required: true, warnings: ["Image watermark processor not installed — run `npm i sharp` and redeploy."] }, { status: 200 });
  }

  // Resolve the list of Drive files to process.
  let files: { id: string; name?: string }[];
  try {
    files = ref.kind === "folder" ? (await listFolderImages(ref.id, MAX_FILES)) : [{ id: ref.id }];
  } catch (e) {
    return NextResponse.json({ ok: false, error: `drive_error:${String((e as Error)?.message ?? e).slice(0, 120)}` }, { status: 502 });
  }
  if (ref.kind === "folder" && files.length > MAX_FILES) files = files.slice(0, MAX_FILES);

  const created: Array<{ id?: string; name?: string; status: string }> = [];
  for (const f of files) {
    try {
      const meta = f.name ? { id: f.id, name: f.name } : await getDriveFileMeta(f.id);
      const original = await downloadDriveFile(f.id);
      const { bytes, mime } = await makeWatermarkedImage(original, { label: "Kian Media" });
      const path = `${projectId}/${f.id}.jpg`;
      await uploadPreview(path, bytes, mime);
      const idRes = await save({
        project_id: projectId, deliverable_id: body.deliverableId, asset_type: "image",
        source_file_id: f.id, source_folder_id: ref.kind === "folder" ? ref.id : null,
        original_file_name: meta.name, preview_storage_path: path, preview_mime_type: mime,
        watermark_applied: true, status: "ready",
      });
      created.push({ id: idRes.ok ? idRes.data : undefined, name: meta.name, status: "ready" });
    } catch (e) {
      created.push({ name: f.name, status: "failed" });
      warnings.push(`Failed for ${f.name || f.id}: ${String((e as Error)?.message ?? e).slice(0, 120)}`);
    }
  }

  const okCount = created.filter((c) => c.status === "ready").length;
  return NextResponse.json({ ok: okCount > 0, created, warnings }, { status: 200 });
}
