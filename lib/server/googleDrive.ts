// ════════════════════════════════════════════════════════════════════════
// Kian — SERVER-ONLY Google Drive fetch for preview generation. Uses a Google
// service account (no extra npm package — RS256 JWT signed with Node crypto).
// Originals are fetched server-side ONLY and never exposed to clients.
//
// Config (Vercel env, server-only — NOT NEXT_PUBLIC):
//   GOOGLE_SERVICE_ACCOUNT_EMAIL   service account client_email
//   GOOGLE_SERVICE_ACCOUNT_KEY     service account private_key (PEM, \n escaped ok)
// Share the Drive files/folders with that service account email (Viewer).
// ════════════════════════════════════════════════════════════════════════
import { createSign } from "crypto";

if (typeof window !== "undefined") throw new Error("lib/server/googleDrive is server-only");

const EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "";
const RAW_KEY = process.env.GOOGLE_SERVICE_ACCOUNT_KEY || "";
const KEY = RAW_KEY.includes("\\n") ? RAW_KEY.replace(/\\n/g, "\n") : RAW_KEY;

/** True when Drive credentials are present. UI shows a setup warning when false. */
export function driveConfigured(): boolean {
  return EMAIL.length > 0 && KEY.includes("PRIVATE KEY");
}

export interface DriveRef { kind: "file" | "folder"; id: string; }

/** Parse a Google Drive file/folder URL (or a bare id) into a DriveRef. */
export function parseDriveRef(input: string): DriveRef | null {
  const s = (input || "").trim();
  if (!s) return null;
  const folder = s.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (folder) return { kind: "folder", id: folder[1] };
  const fileD = s.match(/\/d\/([a-zA-Z0-9_-]+)/) || s.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (fileD) return { kind: "file", id: fileD[1] };
  const idParam = s.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idParam) return { kind: "file", id: idParam[1] };
  if (/^[a-zA-Z0-9_-]{20,}$/.test(s)) return { kind: "file", id: s }; // bare id
  return null;
}

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

let cachedToken: { token: string; exp: number } | null = null;
async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.exp > Date.now() + 60_000) return cachedToken.token;
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: EMAIL,
    scope: "https://www.googleapis.com/auth/drive.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify(claim));
  const sig = createSign("RSA-SHA256").update(`${header}.${payload}`).sign(KEY).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const assertion = `${header}.${payload}.${sig}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${encodeURIComponent(assertion)}`,
    cache: "no-store",
  });
  const j = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string; error_description?: string };
  if (!res.ok || !j.access_token) throw new Error(`drive_auth_failed:${j.error || res.status}`);
  cachedToken = { token: j.access_token, exp: (now + 3500) * 1000 };
  return j.access_token;
}

export interface DriveFileMeta { id: string; name: string; mimeType: string; }

/** Metadata for one Drive file. */
export async function getDriveFileMeta(fileId: string): Promise<DriveFileMeta> {
  const token = await getAccessToken();
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType&supportsAllDrives=true`, {
    headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
  });
  if (!res.ok) throw new Error(`drive_meta_failed:${res.status}`);
  return (await res.json()) as DriveFileMeta;
}

/** Download one Drive file's bytes (server-side only). */
export async function downloadDriveFile(fileId: string): Promise<Buffer> {
  const token = await getAccessToken();
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`, {
    headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
  });
  if (!res.ok) throw new Error(`drive_download_failed:${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** List image files inside a Drive folder (for gallery import). */
export async function listFolderImages(folderId: string, limit = 50): Promise<DriveFileMeta[]> {
  const token = await getAccessToken();
  const q = encodeURIComponent(`'${folderId}' in parents and mimeType contains 'image/' and trashed = false`);
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType)&pageSize=${limit}&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
  );
  if (!res.ok) throw new Error(`drive_list_failed:${res.status}`);
  const j = (await res.json()) as { files?: DriveFileMeta[] };
  return j.files ?? [];
}
