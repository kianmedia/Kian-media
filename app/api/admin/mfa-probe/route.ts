// ════════════════════════════════════════════════════════════════════════════
// GET /api/admin/mfa-probe   (SERVER-ONLY · OWNER-ONLY · read-only diagnostic)
//
// WHY THIS ROUTE EXISTS — and why the obvious alternative is wrong.
//
// Phase 2 must establish one fact before any MFA enforcement is written: does
// Postgres actually see the JWT's `aal` claim in THIS project? A repo-wide grep for
// auth.jwt across all 169 SQL files returns zero hits, so it has never been shown.
//
// The tempting way to check is `select public.mfa_claim_probe();` in the Supabase SQL
// editor. That is WRONG and would have produced a confidently false answer: the SQL
// editor runs as the `postgres` role and carries no portal access token, so
// request.jwt.claims is empty there. The probe would report aal = null for a reason
// unrelated to the question, and enforcement would then be designed around a defect
// that does not exist.
//
// The only meaningful call is an authenticated PostgREST RPC carrying a REAL session
// JWT — which is exactly how every other privileged call in this portal already
// works. rpcAsUser forwards the caller's own token, so PostgREST validates the
// signature and populates request.jwt.claims from the live session.
//
// PRIVACY:
//   • Owner-only, checked server-side twice: here, and again inside the SQL function.
//   • Returns only the CALLER'S OWN claims — never another user's.
//   • The access token is never returned, never logged, never echoed.
//   • Nothing from the claim payload is written to logs; only a boolean and the
//     assurance level reach the log line, because that is the whole diagnostic.
// ════════════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import { authGetUserId, rpcAsUser, adminConfigured } from "@/lib/server/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const log = (tag: string, extra: Record<string, unknown>) => console.log(JSON.stringify({ tag, ...extra }));

export async function GET(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!bearer) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!adminConfigured()) return NextResponse.json({ ok: false, error: "server_not_configured" }, { status: 500 });

  // Identity is verified against GoTrue, never by decoding the token here. Two routes
  // in this repo base64-decode a JWT payload without verifying the signature; that is
  // forgeable and must never be the basis of an authorization decision.
  const uid = await authGetUserId(bearer);
  if (!uid) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  // Owner gate, server-side. is_owner() is a bare OR and can return NULL, so a NULL
  // must not read as permission — hence the explicit === true.
  const owner = await rpcAsUser<boolean>("is_owner", {}, bearer);
  if (!owner.ok || owner.data !== true) {
    return NextResponse.json({ ok: false, error: "forbidden_owner_only" }, { status: 403 });
  }

  // The probe runs under the caller's JWT, which is the entire point.
  const probe = await rpcAsUser<Record<string, unknown>>("mfa_claim_probe", {}, bearer);
  if (!probe.ok) {
    const err = String((probe as { error?: string }).error ?? "probe_failed");
    // A missing function means S1/S1b have not been applied yet — say so plainly
    // rather than letting it look like "claims do not arrive".
    const notInstalled = /PGRST202|could not find|does not exist/i.test(err);
    log("MFA_PROBE_FAILED", { not_installed: notInstalled });
    return NextResponse.json({
      ok: false,
      error: notInstalled ? "probe_not_installed" : "probe_failed",
      hint: notInstalled
        ? "run docs/mfa_foundation_batch_s1_RUNME.sql then docs/mfa_probe_claims_s1b_RUNME.sql"
        : undefined,
    }, { status: 200 });
  }

  const claims = (probe.data ?? {}) as Record<string, unknown>;
  // ONLY the assurance level and a presence boolean are logged. No sub, no session_id,
  // no token, no claim payload.
  log("MFA_PROBE_OK", { aal: claims.aal ?? null, claims_present: claims.claims_present === true });

  return NextResponse.json({ ok: true, probe: claims }, {
    status: 200,
    headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" },
  });
}
