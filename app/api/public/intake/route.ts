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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const asStr = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

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
  try { b = await req.json(); } catch { return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 }); }

  const email = asStr(b.email).trim();
  if (!email || !email.includes("@")) {
    // Never error the form for a missing email — just no-op the mirror.
    return NextResponse.json({ ok: false, error: "no_email" }, { status: 200 });
  }
  const services = Array.isArray(b.services) ? (b.services as unknown[]).map((s) => asStr(s)).filter(Boolean)
    : asStr(b.services) ? [asStr(b.services)] : [];
  const files = Array.isArray(b.files) ? b.files : null;

  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  const userId = bearer ? jwtSub(bearer) : null;

  const r = await rpcAsService<string>("capture_public_intake", {
    p_user: userId, p_type: asStr(b.type) || "other", p_email: email, p_phone: asStr(b.phone),
    p_name: asStr(b.name), p_company: asStr(b.company), p_city: asStr(b.city), p_reference: asStr(b.reference),
    p_services: services, p_details: asStr(b.details), p_preferred_date: asStr(b.preferred_date),
    p_preferred_contact: asStr(b.preferred_contact), p_source: asStr(b.source) || "website", p_files: files,
  });
  // Always 200 so the public form never shows a technical error.
  return NextResponse.json(r.ok ? { ok: true, id: r.data } : { ok: false, error: r.error }, { status: 200 });
}
