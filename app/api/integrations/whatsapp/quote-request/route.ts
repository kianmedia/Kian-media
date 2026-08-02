// ════════════════════════════════════════════════════════════════════════
// POST /api/integrations/whatsapp/quote-request   (public link-back from the
// /quote-request form when ?source=whatsapp&conversation=<id>).
//
// Links a customer-submitted quote to its WhatsApp conversation/contact via the
// SECURITY DEFINER RPC wa_link_quote_request_public (service_role) — anonymous
// customers can't write tables directly. Best-effort + never throws. Does NOT
// touch the existing quote_requests portal table; writes whatsapp_quote_requests.
// ════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────
// Wave 0 · V2-0.6-A — SECURITY HARDENING OF AN EXISTING ROUTE.
// This is NOT a WhatsApp feature and NOT an expansion of the integration
// (G7 keeps it frozen). Nothing about the RPC, its parameters, the flags or
// the credentials changes; the functional path is byte-for-byte the same.
// Two defects found by docs/PUBLIC_POST_RATE_LIMIT_COVERAGE.md are closed:
//
//   1. NO RATE LIMIT. Public, unauthenticated, and every accepted call reaches
//      Postgres through the SERVICE KEY. Reuses lib/server/rateLimit.ts — the
//      same helper /api/public/intake and /api/public/secure-document use.
//      No second limiter, no new dependency.
//
//   2. RESPONSE ORACLE. Failures returned the RAW PostgREST message
//      (`error: r.error`), so a caller could tell "this conversation exists but
//      is closed" from "no such conversation" from "database error" — i.e.
//      probe whether a conversation id, and by extension a customer, is real.
//      The raw text also leaked the RPC name and schema detail to anonymous
//      callers, the exact leak /api/public/intake already fixed. Every failure
//      now returns ONE opaque code with ONE status.
//
// Safe to make uniform because the only caller is fire-and-forget:
// app/quote-request/page.tsx does `void fetch(...).catch(() => {})` and never
// reads the status or the body. Success keeps its exact previous shape.
// ─────────────────────────────────────────────────────────────────────────
import { NextResponse } from "next/server";
import { rpcAsService } from "@/lib/server/supabaseAdmin";
import { sendQuoteConfirmations } from "@/lib/server/quoteConfirm";
import { rateLimit, clientKey } from "@/lib/server/rateLimit";
import { pgRedact } from "@/lib/portal/pgerror";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const asStr = (v: unknown) => (typeof v === "string" ? v : "");

/**
 * One shape for EVERY failure: same status, same body, no detail.
 *
 * Rate-limited, malformed JSON, missing conversation id, unknown conversation,
 * closed conversation and database error are indistinguishable from outside.
 * Status is 200 like the pre-existing RPC-failure path, so the public form is
 * never shown a technical error — and so the two former 400s stop standing out
 * as a separate, probe-able class.
 */
const notLinked = () => NextResponse.json({ ok: false, error: "not_linked" }, { status: 200 });

/**
 * Generous for a real visitor — the legitimate flow fires this at most once per
 * submitted form — and hostile to probing. Per-instance memory, so like every
 * other limiter in this repo it slows casual abuse rather than stopping a
 * distributed one; stated as a residual risk, not sold as protection.
 */
const PER_IP = { limit: 10, windowMs: 60 * 60_000 };

interface LinkedQuote {
  id?: string; external_request_id?: string | null; phone?: string | null; email?: string | null;
  full_name?: string | null; company?: string | null; city?: string | null;
  preferred_date?: string | null; services?: string | null;
}

export async function POST(req: Request) {
  let b: {
    conversation_id?: unknown; full_name?: unknown; phone?: unknown; services?: unknown; city?: unknown;
    message?: unknown; reference?: unknown; budget?: unknown; company?: unknown; email?: unknown;
    lead_source?: unknown; priority?: unknown; duration?: unknown; preferred_date?: unknown;
    mode?: unknown; quote_id?: unknown;
  };
  // Before parsing and before the RPC, so a flood costs as little as possible
  // and a limited caller never reaches the service key.
  if (!rateLimit(`wa-quote:ip:${clientKey(req)}`, PER_IP.limit, PER_IP.windowMs).allowed) return notLinked();

  try { b = await req.json(); } catch { return notLinked(); }

  const conversationId = asStr(b.conversation_id);
  if (!conversationId) return notLinked();

  const services = Array.isArray(b.services) ? (b.services as unknown[]).map((s) => asStr(s)).filter(Boolean)
    : asStr(b.services) ? [asStr(b.services)] : [];
  // Normalise a free-text date to YYYY-MM-DD (or null) so a malformed value can't fail the insert.
  const dateStr = asStr(b.preferred_date).trim();
  const preferredDate = /^\d{4}-\d{2}-\d{2}/.test(dateStr) ? dateStr.slice(0, 10) : null;
  // Link mode: 'update' (exact quote), 'new' (force create), else 'auto' (reuse open). Validated; default auto.
  const mode = ["update", "new", "auto"].includes(asStr(b.mode)) ? asStr(b.mode) : "auto";
  const quoteIdRaw = asStr(b.quote_id).trim();
  const quoteId = mode === "update" && /^[0-9a-f-]{36}$/i.test(quoteIdRaw) ? quoteIdRaw : null;

  const r = await rpcAsService<LinkedQuote>("wa_link_quote_request_public", {
    p_conversation: conversationId,
    p_full_name: asStr(b.full_name),
    p_phone: asStr(b.phone),
    p_services: services,
    p_city: asStr(b.city),
    p_message: asStr(b.message),
    // The public quote form's Sheets reference → human-friendly request number.
    p_external_request_id: asStr(b.reference),
    p_budget_range: asStr(b.budget),
    p_company: asStr(b.company),
    p_email: asStr(b.email),
    p_lead_source: asStr(b.lead_source),
    p_priority: asStr(b.priority),
    p_duration: asStr(b.duration),
    p_preferred_date: preferredDate,
    p_mode: mode,
    p_quote_id: quoteId,
  });
  if (!r.ok) {
    // not_found_or_forbidden / bad conversation / DB error → ONE opaque code, so
    // the customer never sees a technical error AND an outsider cannot tell which
    // of those it was. The real reason is logged server-side (redacted) instead of
    // being handed to an anonymous caller.
    console.log(JSON.stringify({
      tag: "WA_QUOTE_LINK_FAILED",
      error: pgRedact(String(r.error)).slice(0, 200),
    }));
    return notLinked();
  }
  const q = r.data || {};

  // Customer confirmation (email + WhatsApp) — both gated + non-blocking. Awaited so
  // the audit lands, but each channel swallows its own failure; never fails the form.
  try {
    await sendQuoteConfirmations({
      conversationId, quoteId: q.id || "", requestNumber: q.external_request_id || asStr(b.reference),
      fullName: q.full_name || asStr(b.full_name), email: q.email || asStr(b.email),
      phone: q.phone || asStr(b.phone), services: q.services || services.join("، "),
      city: q.city || asStr(b.city), preferredDate: q.preferred_date || preferredDate || "",
    });
  } catch { /* confirmations must never fail the customer submission */ }

  return NextResponse.json({ ok: true, id: q.id, mode }, { status: 200 });
}
