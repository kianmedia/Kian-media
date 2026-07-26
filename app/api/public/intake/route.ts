// ════════════════════════════════════════════════════════════════════════
// POST /api/public/intake   (PUBLIC — captures a website submission to Supabase)
//
// Mirrors a guest quote/meeting/file submission into public_intake (email-keyed)
// so that after the same person signs up with the SAME verified email the portal
// shows it (via link_my_records_by_email). Best-effort: never blocks the form.
// If a logged-in user submits (bearer present), the row is attributed to them.
// Writes go through the service_role capture RPC; no table grants to anon.
// ════════════════════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { rpcAsService } from "@/lib/server/supabaseAdmin";
import { rateLimit, clientKey } from "@/lib/server/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Phase 2 abuse limits. This endpoint is PUBLIC and unauthenticated, and every accepted
// call writes a row through the service role — so it had to stop being unlimited.
// Generous enough that a real visitor filling several forms is never blocked.
const MAX_BODY_BYTES = 100_000;
const PER_IP = { limit: 12, windowMs: 60 * 60_000 };
const PER_EMAIL = { limit: 6, windowMs: 60 * 60_000 };
/** Field caps — a public endpoint must never accept unbounded text. */
const CAP = { short: 200, long: 8_000, files: 20 };

const asStr = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const cap = (v: string, n: number) => (v.length > n ? v.slice(0, n) : v);

/** Best-effort decode of a JWT 'sub' (only to attribute the row to a logged-in user). */
function jwtSub(bearer: string): string | null {
  try {
    const p = bearer.split(".")[1];
    if (!p) return null;
    const j = JSON.parse(Buffer.from(p.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    return typeof j.sub === "string" ? j.sub : null;
  } catch { return null; }
}

export async function POST(req: Request) {
  let b: {
    type?: unknown; email?: unknown; phone?: unknown; name?: unknown; company?: unknown; city?: unknown;
    reference?: unknown; services?: unknown; details?: unknown; preferred_date?: unknown;
    preferred_contact?: unknown; source?: unknown; files?: unknown;
  };
  // Reject an oversized body BEFORE parsing it — an unbounded req.json() on a public
  // endpoint is free memory pressure for anyone who wants it.
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 200 });
  }

  // Per-IP brake. Applied before parsing so a flood costs as little as possible.
  // NOTE: this is per-instance memory, so it slows casual abuse rather than stopping a
  // distributed one — documented as a residual risk, not sold as protection.
  const ipVerdict = rateLimit(`intake:ip:${clientKey(req)}`, PER_IP.limit, PER_IP.windowMs);
  if (!ipVerdict.allowed) {
    // Deliberately 200 + ok:false: this route's contract is that the public form never
    // shows a technical error, and the browser helper discards the body anyway.
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 200 });
  }

  try { b = await req.json(); } catch { return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 }); }

  const email = asStr(b.email).trim();
  if (!email || !email.includes("@")) {
    // Never error the form for a missing email — just no-op the mirror.
    return NextResponse.json({ ok: false, error: "no_email" }, { status: 200 });
  }
  // Second brake, per email address: one IP can rotate, but a campaign usually reuses the
  // same address. Same silent 200 contract.
  const emailVerdict = rateLimit(`intake:email:${email.toLowerCase()}`, PER_EMAIL.limit, PER_EMAIL.windowMs);
  if (!emailVerdict.allowed) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 200 });
  }

  const services = Array.isArray(b.services) ? (b.services as unknown[]).map((s) => cap(asStr(s), CAP.short)).filter(Boolean).slice(0, 30)
    : asStr(b.services) ? [cap(asStr(b.services), CAP.short)] : [];
  const files = Array.isArray(b.files) ? b.files.slice(0, CAP.files) : null;

  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  const userId = bearer ? jwtSub(bearer) : null;

  const r = await rpcAsService<string>("capture_public_intake", {
    p_user: userId, p_type: cap(asStr(b.type), CAP.short) || "other", p_email: cap(email, CAP.short),
    p_phone: cap(asStr(b.phone), CAP.short),
    p_name: cap(asStr(b.name), CAP.short), p_company: cap(asStr(b.company), CAP.short),
    p_city: cap(asStr(b.city), CAP.short), p_reference: cap(asStr(b.reference), CAP.short),
    p_services: services, p_details: cap(asStr(b.details), CAP.long),
    p_preferred_date: cap(asStr(b.preferred_date), CAP.short),
    p_preferred_contact: cap(asStr(b.preferred_contact), CAP.short),
    p_source: cap(asStr(b.source), CAP.short) || "website", p_files: files,
  });
  // Always 200 so the public form never shows a technical error.
  return NextResponse.json(r.ok ? { ok: true, id: r.data } : { ok: false, error: r.error }, { status: 200 });
}
