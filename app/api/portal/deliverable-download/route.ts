// ════════════════════════════════════════════════════════════════════════
// POST /api/portal/deliverable-download  — SERVER-ONLY gated final-download.
//
// The single download path for a client's FINAL deliverable file:
//   1) Enforces the gate + LOGS by calling client_download_deliverable AS THE
//      USER (the caller's Bearer token → RLS + status=final_delivered + dues
//      cleared all apply; the RPC also writes the deliverable_downloads log row).
//   2) If the returned asset lives in a Supabase Storage bucket, mints a
//      SHORT-LIVED signed URL (service key, 300s) — no permanent public URL is
//      ever handed out. External review URLs are passed through unchanged.
//
// No Zoho/finance dependency. Never logs secrets. Returns { url } or 403 when
// the gate is shut (payment not confirmed / not final-delivered).
// ════════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const SIGN_TTL = 300; // seconds

// Resolve a stored asset URL to {bucket, path} when it points at Supabase Storage.
// Handles both a full public/sign URL and a bare "bucket/path" string.
function toStorageRef(url: string): { bucket: string; path: string } | null {
  try {
    if (SUPABASE_URL && url.startsWith(SUPABASE_URL)) {
      const m = url.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+?)(?:\?|#|$)/);
      if (m) return { bucket: m[1], path: decodeURIComponent(m[2]) };
      return null;
    }
    if (/^https?:\/\//i.test(url)) return null; // some other external URL
    // bare "bucket/path" (no scheme)
    const parts = url.replace(/^\/+/, "").split("/");
    if (parts.length >= 2) return { bucket: parts[0], path: parts.slice(1).join("/") };
    return null;
  } catch { return null; }
}

async function signStorage(bucket: string, path: string): Promise<string | null> {
  if (!SERVICE_KEY) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${bucket}/${encodeURI(path)}`, {
      method: "POST",
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ expiresIn: SIGN_TTL }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { signedURL?: string };
    return j.signedURL ? `${SUPABASE_URL}/storage/v1${j.signedURL}` : null;
  } catch { return null; }
}

export async function POST(req: Request) {
  if (!SUPABASE_URL || !ANON_KEY) return NextResponse.json({ ok: false, error: "server_not_configured" }, { status: 500 });
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!token) return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });

  let deliverableId = "";
  try { deliverableId = String(((await req.json()) as { deliverableId?: string }).deliverableId ?? ""); } catch { /* ignore */ }
  if (!deliverableId) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });

  // Enforce gate + log, AS THE USER (RLS + status + dues predicate all apply).
  let rpc: Response;
  try {
    rpc = await fetch(`${SUPABASE_URL}/rest/v1/rpc/client_download_deliverable`, {
      method: "POST",
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_deliverable: deliverableId }),
      cache: "no-store",
    });
  } catch { return NextResponse.json({ ok: false, error: "upstream_error" }, { status: 502 }); }
  if (rpc.status === 401) return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });
  if (!rpc.ok) return NextResponse.json({ ok: false, error: "download_failed" }, { status: 502 });

  const raw = await rpc.text();
  let assetUrl: string | null = null;
  try { assetUrl = raw ? (JSON.parse(raw) as string | null) : null; } catch { assetUrl = null; }
  // RPC returns null when the gate is shut (not final-delivered / dues not confirmed).
  if (!assetUrl) return NextResponse.json({ ok: false, error: "locked" }, { status: 403 });

  const ref = toStorageRef(assetUrl);
  if (ref) {
    // Storage-backed final → MUST be a short-lived signed URL; never leak the raw
    // storage path (it may reference a private bucket). Signing failure = 502.
    const signed = await signStorage(ref.bucket, ref.path);
    if (!signed) return NextResponse.json({ ok: false, error: "sign_failed" }, { status: 502 });
    return NextResponse.json({ ok: true, url: signed, signed: true });
  }
  // Genuinely external review URL (e.g. Vimeo/Drive) → pass through unchanged.
  return NextResponse.json({ ok: true, url: assetUrl, signed: false });
}
