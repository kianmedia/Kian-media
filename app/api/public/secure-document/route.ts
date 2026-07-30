// ════════════════════════════════════════════════════════════════════════════
// POST /api/public/secure-document — SERVER-ONLY redemption of a document grant.
//
// This is the ONLY place in the module where the service key is used, and it
// follows the deliverable-download shape exactly:
//   1) AUTHORISE FIRST — call vcc_grant_open with the token. The database
//      hashes it, resolves the grant, re-checks the window, the open/download
//      limits, the revocation, and that the requested document is attached to
//      THAT grant and is still verified and unexpired. It also writes the audit
//      row (including denials).
//   2) THEN sign — a short-lived signed URL for the {bucket, path} the RPC
//      RETURNED. Never for a bucket/path taken from the request body. That
//      distinction is the whole security model: a caller-supplied path signed
//      with the service key is a universal cross-bucket read oracle.
//   3) NEVER echo the storage reference back to the browser.
//
// ⛔ The token never appears in a URL, query string, or log line. The public
//    page keeps it in the URL fragment and POSTs it in the body, so it is not
//    sent in the Referer header and never reaches an access log.
// ⛔ Nothing here sends email or any message. Grant links are shared by hand.
// ⛔ No directory listing: the RPC enumerates only rows explicitly attached to
//    the grant, and the bucket is private with no anon grant.
// ════════════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import { createHash } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
/** Short by design. A signed URL is a bearer token: TTL is the only control. */
const SIGN_TTL = 120;

/**
 * A stable-but-not-identifying visitor fingerprint for the audit trail.
 * ⚠️ We never store the raw IP or user-agent — that is personal data about a
 * third party we have no relationship with. A salted SHA-256 lets us see
 * "the same client tried 40 tokens" without keeping who they are.
 */
function fingerprint(req: Request): string {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  const ua = req.headers.get("user-agent") ?? "";
  const salt = process.env.SECURE_DOCUMENT_FP_SALT ?? SUPABASE_URL;
  return createHash("sha256").update(`${salt}|${ip}|${ua}`).digest("hex");
}

async function rpc(fn: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
}

async function signStorage(bucket: string, path: string): Promise<string | null> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/storage/v1/object/sign/${encodeURIComponent(bucket)}/${encodeURI(path)}`,
      {
        method: "POST",
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ expiresIn: SIGN_TTL }),
        cache: "no-store",
      },
    );
    if (!res.ok) return null;
    const j = (await res.json()) as { signedURL?: string };
    return j.signedURL ? `${SUPABASE_URL}/storage/v1${j.signedURL}` : null;
  } catch {
    return null;
  }
}

const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate", "X-Robots-Tag": "noindex, nofollow" };

export async function POST(req: Request) {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    // Honest: the feature is not configured. Not "invalid link" — that would
    // send the recipient chasing the wrong problem.
    return NextResponse.json({ ok: false, error: "server_not_configured" }, { status: 503, headers: NO_STORE });
  }

  let token = "";
  let action: "open" | "download" = "open";
  let documentId: string | null = null;
  try {
    const b = (await req.json()) as { token?: string; action?: string; documentId?: string };
    token = String(b.token ?? "").trim();
    action = b.action === "download" ? "download" : "open";
    documentId = b.documentId ? String(b.documentId) : null;
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400, headers: NO_STORE });
  }
  if (!token || token.length < 32 || token.length > 200) {
    // Same shape as an unknown token: never confirm that a token is well-formed.
    return NextResponse.json({ ok: false, reason: "invalid_or_expired" }, { status: 200, headers: NO_STORE });
  }

  // ─── 1) AUTHORISE (and audit) IN THE DATABASE, AS service_role ──────────
  let res: Response;
  try {
    res = await rpc("vcc_grant_open", {
      p_token: token,
      p_action: action,
      p_document: documentId,
      p_fingerprint: fingerprint(req),
    });
  } catch {
    return NextResponse.json({ ok: false, error: "upstream_error" }, { status: 502, headers: NO_STORE });
  }

  if (res.status === 404 || res.status === 400) {
    // PGRST202 → the migration is not applied yet. Say exactly that; do NOT
    // dress it up as an invalid link (the classifier lesson: a message may only
    // assert a cause the evidence supports).
    const text = await res.text();
    if (/PGRST202|could not find the function/i.test(text)) {
      return NextResponse.json({ ok: false, error: "pending_migration" }, { status: 503, headers: NO_STORE });
    }
    return NextResponse.json({ ok: false, error: "upstream_error" }, { status: 502, headers: NO_STORE });
  }
  if (!res.ok) {
    return NextResponse.json({ ok: false, error: "upstream_error" }, { status: 502, headers: NO_STORE });
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await res.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "upstream_error" }, { status: 502, headers: NO_STORE });
  }

  if (payload?.ok !== true) {
    // The RPC already logged the denial. Pass the reason through unchanged —
    // it is deliberately coarse for unknown/expired tokens.
    return NextResponse.json(
      { ok: false, reason: String(payload?.reason ?? "invalid_or_expired") },
      { status: 200, headers: NO_STORE },
    );
  }

  // ─── Grant-level open: metadata only, no storage reference exists yet ────
  if (payload.action === "open" && !documentId) {
    return NextResponse.json(
      {
        ok: true,
        action: "open",
        recipient_org: payload.recipient_org ?? null,
        recipient_name: payload.recipient_name ?? null,
        purpose: payload.purpose ?? null,
        expires_at: payload.expires_at ?? null,
        watermark_identity: payload.watermark_identity ?? null,
        opens_left: payload.opens_left ?? 0,
        downloads_left: payload.downloads_left ?? 0,
        documents: payload.documents ?? [],
        delivery_note_ar: "هذا الرابط شُورك يدويًّا ولم يُرسَل من النظام.",
      },
      { status: 200, headers: NO_STORE },
    );
  }

  // ─── 2) SIGN WHAT THE RPC RETURNED — never what the caller sent ──────────
  const bucket = typeof payload.storage_bucket === "string" ? payload.storage_bucket : "";
  const path = typeof payload.storage_path === "string" ? payload.storage_path : "";
  if (!bucket || !path) {
    return NextResponse.json({ ok: false, reason: "no_file" }, { status: 200, headers: NO_STORE });
  }
  const signed = await signStorage(bucket, path);
  if (!signed) {
    return NextResponse.json({ ok: false, error: "sign_failed" }, { status: 502, headers: NO_STORE });
  }

  // ─── 3) The storage reference NEVER leaves the server ────────────────────
  return NextResponse.json(
    {
      ok: true,
      action: payload.action ?? action,
      url: signed,
      expires_in: SIGN_TTL,
      file_name: payload.file_name ?? null,
      file_mime: payload.file_mime ?? null,
      doc_type: payload.doc_type ?? null,
      watermark_required: payload.watermark_required ?? true,
      watermark_identity: payload.watermark_identity ?? null,
    },
    { status: 200, headers: NO_STORE },
  );
}

/** GET is deliberately unsupported: a token must never travel in a URL. */
export async function GET() {
  return NextResponse.json(
    { ok: false, error: "method_not_allowed", note: "الرمز لا يُمرَّر في رابط. استخدم POST." },
    { status: 405, headers: NO_STORE },
  );
}
