// ════════════════════════════════════════════════════════════════════════
// Kian Portal — media management model (admin) + final delivery.
// Admin: list/delete preview assets, upload files (image preview / audio preview
// / final), manage final-asset availability. Client: list available finals +
// authenticated download. Originals/paths/source ids are ADMIN-ONLY (server RPCs);
// clients only ever receive safe metadata + opaque asset ids.
// ════════════════════════════════════════════════════════════════════════
import { prpc, type Result } from "@/lib/portal/client";
import { getValidSession } from "@/lib/portalAuth";

// ─── Admin preview assets (full row incl. status/source — admin RLS) ───
export interface AdminPreviewAsset {
  id: string; project_id: string; deliverable_id: string | null;
  asset_type: "image" | "audio"; source_provider: string;
  original_file_name: string | null; preview_mime_type: string | null;
  watermark_applied: boolean; status: "processing" | "ready" | "failed" | "needs_worker";
  error_message: string | null; created_at: string;
}
export function adminListPreviewAssets(projectId: string): Promise<Result<AdminPreviewAsset[]>> {
  return prpc<AdminPreviewAsset[]>("admin_list_preview_assets", { p_project: projectId });
}
export function adminDeletePreviewAsset(assetId: string): Promise<Result<boolean>> {
  return prpc<boolean>("admin_delete_preview_asset", { p_asset: assetId });
}

// ─── Final assets ───
export interface FinalAssetClient {
  id: string; deliverable_id: string | null; asset_type: string;
  original_file_name: string | null; mime_type: string | null; delivered_at: string | null;
}
export interface AdminFinalAsset extends FinalAssetClient {
  project_id: string; is_available_to_client: boolean; created_at: string;
}
/** Client-facing: available finals only, safe metadata. */
export function listProjectFinalAssets(projectId: string): Promise<Result<FinalAssetClient[]>> {
  return prpc<FinalAssetClient[]>("list_project_final_assets", { p_project: projectId });
}
export function adminListFinalAssets(projectId: string): Promise<Result<AdminFinalAsset[]>> {
  return prpc<AdminFinalAsset[]>("admin_list_final_assets", { p_project: projectId });
}
export function adminSetFinalAvailability(assetId: string, available: boolean): Promise<Result<boolean>> {
  return prpc<boolean>("admin_set_final_availability", { p_asset: assetId, p_available: available });
}
export function adminDeleteFinalAsset(assetId: string): Promise<Result<boolean>> {
  return prpc<boolean>("admin_delete_final_asset", { p_asset: assetId });
}

// ─── Uploads (multipart) ───
export interface UploadResult {
  ok: boolean; setup_required?: boolean; needs_worker?: boolean;
  created?: Array<{ id?: string; asset_type?: string; status?: string }>; warnings?: string[]; error?: string;
}
export async function uploadMediaFile(
  file: File,
  opts: { projectId: string; deliverableId?: string; kind: "image_preview" | "audio_preview" | "final"; assetType?: "audio" | "image" | "video" | "file" },
): Promise<UploadResult> {
  const s = await getValidSession();
  if (!s) return { ok: false, error: "not_authenticated" };
  const fd = new FormData();
  fd.append("file", file);
  fd.append("projectId", opts.projectId);
  if (opts.deliverableId) fd.append("deliverableId", opts.deliverableId);
  fd.append("kind", opts.kind);
  if (opts.assetType) fd.append("assetType", opts.assetType);
  try {
    const res = await fetch("/api/admin/deliverables/upload", { method: "POST", headers: { Authorization: `Bearer ${s.access_token}` }, body: fd });
    return (await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))) as UploadResult;
  } catch (e) { return { ok: false, error: String(e) }; }
}

/** Client: download a final asset (authenticated → blob → save). Returns false on error. */
export async function downloadFinalAsset(assetId: string, filename: string): Promise<boolean> {
  const s = await getValidSession();
  if (!s) return false;
  try {
    const res = await fetch(`/api/portal/final-assets/${assetId}`, { headers: { Authorization: `Bearer ${s.access_token}` }, cache: "no-store" });
    if (!res.ok) return false;
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url; a.download = filename || "kian-final";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return true;
  } catch { return false; }
}
