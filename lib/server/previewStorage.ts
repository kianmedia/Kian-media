// ════════════════════════════════════════════════════════════════════════
// Kian — SERVER-ONLY access to the PRIVATE "deliverable-previews" Supabase
// Storage bucket via the service-role key. Clients NEVER touch storage directly;
// the stream route reads bytes here after authorizing the user in the database.
// ════════════════════════════════════════════════════════════════════════
if (typeof window !== "undefined") throw new Error("lib/server/previewStorage is server-only");

const SUPABASE_URL = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
export const PREVIEW_BUCKET = "deliverable-previews";

export function storageConfigured(): boolean {
  return SUPABASE_URL.length > 0 && SERVICE_KEY.length > 0;
}

/** Upload preview bytes to the private bucket (upsert). Returns the storage path. */
export async function uploadPreview(path: string, bytes: Buffer | Uint8Array, contentType: string): Promise<string> {
  if (!storageConfigured()) throw new Error("server_supabase_not_configured");
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${PREVIEW_BUCKET}/${path}`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": contentType,
      "x-upsert": "true",
      "cache-control": "3600",
    },
    body: bytes as unknown as BodyInit,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`storage_upload_failed:${res.status}:${(await res.text()).slice(0, 120)}`);
  return path;
}

/** Download preview bytes from the private bucket (server-side stream source). */
export async function downloadPreview(path: string): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  if (!storageConfigured()) throw new Error("server_supabase_not_configured");
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${PREVIEW_BUCKET}/${path}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`storage_download_failed:${res.status}`);
  return { bytes: await res.arrayBuffer(), contentType: res.headers.get("content-type") || "application/octet-stream" };
}
