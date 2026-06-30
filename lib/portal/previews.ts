// ════════════════════════════════════════════════════════════════════════
// Kian Portal — watermarked preview assets (client read model). Clients receive
// ONLY safe metadata (no Drive ids/urls, no storage path) via the SECURITY DEFINER
// RPC, and stream the watermarked bytes through the authenticated route as a blob
// (the original Drive URL never appears in the DOM or network).
// ════════════════════════════════════════════════════════════════════════
import { prpc, type Result } from "@/lib/portal/client";
import { getValidSession } from "@/lib/portalAuth";

export interface PreviewAsset {
  id: string;
  deliverable_id: string | null;
  asset_type: "image" | "audio";
  original_file_name: string | null;
  preview_mime_type: string | null;
  status: string;
  watermark_applied: boolean;
  created_at: string;
}

/** Safe preview metadata for a project the caller belongs to (ready assets only). */
export function listProjectPreviewAssets(projectId: string): Promise<Result<PreviewAsset[]>> {
  return prpc<PreviewAsset[]>("list_project_preview_assets", { p_project: projectId });
}

/** Fetch a watermarked preview as an object URL (authenticated; bytes never cached
 *  in the page source). Caller should URL.revokeObjectURL when done. */
export async function fetchPreviewObjectUrl(assetId: string): Promise<string | null> {
  const s = await getValidSession();
  if (!s) return null;
  try {
    const res = await fetch(`/api/portal/preview-assets/${assetId}`, {
      headers: { Authorization: `Bearer ${s.access_token}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return URL.createObjectURL(await res.blob());
  } catch { return null; }
}

export interface ImportResult {
  ok: boolean; setup_required?: boolean; warnings?: string[];
  created?: Array<{ id?: string; name?: string; status: string }>; error?: string;
}

/** Admin: import a Drive image/file/folder link → server generates watermarked previews. */
export async function importDrivePreview(input: {
  projectId: string; deliverableId?: string; driveUrl: string; assetType: "image" | "audio";
}): Promise<ImportResult> {
  const s = await getValidSession();
  if (!s) return { ok: false, error: "not_authenticated" };
  try {
    const res = await fetch("/api/admin/deliverables/import-drive-preview", {
      method: "POST",
      headers: { Authorization: `Bearer ${s.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    return (await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))) as ImportResult;
  } catch (e) { return { ok: false, error: String(e) }; }
}
