// ════════════════════════════════════════════════════════════════════════════
// POST /api/public/live-status — SERVER-ONLY redemption of a live-status link.
//
// This is the ONLY place in the module where the service key is used, and it
// follows the secure-document shape exactly:
//   1) AUTHORISE FIRST — call liveops_client_view with the token. The database
//      hashes it, resolves the link, re-checks the window, the open limit, the
//      revocation, bumps the counter, and writes the audit row (denials too).
//   2) RETURN WHAT THE RPC RETURNED, unchanged. This route adds nothing, looks
//      up nothing, and joins nothing. The redaction decision lives in ONE
//      place — public.liveops_client_payload — so it cannot drift here.
//   3) Never echo anything the caller sent back as if it were data.
//
// ⛔ The token never appears in a URL, query string, or log line. The public
//    page keeps it in the URL fragment and POSTs it in the body, so it is not
//    sent in the Referer header and never reaches an access log.
// ⛔ Nothing here sends email or any message. Links are shared by hand.
// ⛔ No directory listing: there is no GET, no session id in the response, and
//    no way to reach a second session from here.
// ⛔ An unknown token and an expired token produce the SAME response, because
//    the database produces the same response. If this route ever tried to be
//    more helpful ("expired" vs "not found"), the link would become an oracle.
// ════════════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { rateLimit, clientKey } from "@/lib/server/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

const NO_STORE = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  "X-Robots-Tag": "noindex, nofollow",
};

/**
 * A stable-but-not-identifying visitor fingerprint for the audit trail.
 * ⚠️ We never store the raw IP or user-agent — that is personal data about a
 * third party we have no relationship with. A salted SHA-256 lets us see
 * "the same client tried 40 tokens" without keeping who they are.
 */
function fingerprint(req: Request): string {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  const ua = req.headers.get("user-agent") ?? "";
  const salt = process.env.LIVE_STATUS_FP_SALT ?? SUPABASE_URL;
  return createHash("sha256").update(`${salt}|${ip}|${ua}`).digest("hex");
}

export async function POST(req: Request) {
  // A brake on casual token guessing. NOT a security control (see the header of
  // lib/server/rateLimit.ts) — the real defence is a 256-bit token and the
  // identical-response rule.
  const verdict = rateLimit(`live-status:${clientKey(req)}`, 30, 60_000);
  if (!verdict.allowed) {
    return NextResponse.json(
      { ok: false, error: "rate_limited", retry_after_ms: verdict.retryAfterMs },
      { status: 429, headers: NO_STORE },
    );
  }

  if (!SUPABASE_URL || !SERVICE_KEY) {
    // Honest: the feature is not configured. NOT "invalid link" — that would
    // send the recipient chasing a problem that is ours, not theirs.
    return NextResponse.json({ ok: false, error: "server_not_configured" }, { status: 503, headers: NO_STORE });
  }

  let token = "";
  try {
    const b = (await req.json()) as { token?: string };
    token = String(b.token ?? "").trim();
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400, headers: NO_STORE });
  }
  if (!token || token.length < 32 || token.length > 200) {
    // Same shape as an unknown token: never confirm that a token is well-formed.
    return NextResponse.json({ ok: false, reason: "invalid_or_expired" }, { status: 200, headers: NO_STORE });
  }

  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/liveops_client_view`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_token: token, p_fingerprint: fingerprint(req) }),
      cache: "no-store",
    });
  } catch {
    // The transport never completed. Not "invalid link", not "not deployed".
    return NextResponse.json({ ok: false, error: "upstream_error" }, { status: 502, headers: NO_STORE });
  }

  if (res.status === 404 || res.status === 400) {
    const text = await res.text();
    if (/PGRST202|could not find the function/i.test(text)) {
      // The migration is not applied yet. Say exactly that.
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
    // The RPC already logged the denial and already collapsed every cause into
    // one word. Pass it through untouched — do not enrich it.
    return NextResponse.json(
      { ok: false, reason: "invalid_or_expired" },
      { status: 200, headers: NO_STORE },
    );
  }

  // ★ Pass the payload through verbatim. This route deliberately does NOT
  //   assemble its own object: every added field would be a redaction decision
  //   made outside liveops_client_payload, and two redaction authorities is
  //   how leaks happen.
  return NextResponse.json(payload, { status: 200, headers: NO_STORE });
}
