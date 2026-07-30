// ════════════════════════════════════════════════════════════════════════════
// POST /api/public/assistant — THE PUBLIC LEAD ASSISTANT. SERVER ONLY.
//
// Two actions, both READ-OR-DRAFT and nothing else:
//   { action: "ask",  question }   → public.ai_public_ask
//   { action: "lead", payload }    → public.ai_public_lead_draft
//
// ★ WHY THE SERVICE KEY IS HERE AND NOWHERE ELSE ★
//   ai_public_ask / ai_public_lead_draft are granted to service_role ONLY —
//   never to anon, never to authenticated. So the public surface has exactly
//   one door, and this file is it. There is no anon grant on any ai_* object,
//   which means an unauthenticated caller holding the anon key cannot reach a
//   single row or function of this module directly. (That is the lesson of the
//   authz incident in this repo: an anon key once read real company data.)
//
// ★ THE ROUTE DECIDES NOTHING ★
//   It does not filter sources, does not choose roles, does not compose an
//   answer, and does not redact. `ai_public_ask` pins the retrieval roles to
//   ['anonymous'] INSIDE the database — the caller cannot name a role, and this
//   route never sends one. Every safety decision lives in one place, so it
//   cannot drift here.
//
// ⛔ WHAT THIS ENDPOINT NEVER DOES
//   • It never sends email, WhatsApp or any message. A lead draft waits for a
//     human in the portal. `email_sent:false` is in the response so nobody has
//     to guess. The anonymous relay stays closed.
//   • It never lets the caller choose a recipient. There is no `to`, no
//     `notify`, no `assignee` field — an unknown key is REJECTED, not ignored.
//   • It never creates a client, an opportunity, a project or a quote, and it
//     never states a price. The draft's status is 'pending_human_review'.
//   • It never returns internal knowledge. Only sources approved for the
//     'anonymous' role at 'public' sensitivity can match, enforced by a table
//     CHECK, an access matrix, and the retrieval predicate — three layers.
//   • It never stores a raw IP or user-agent. Both are salted-SHA-256 hashes:
//     enough to rate-limit and to see "one client tried 200 questions", not
//     enough to identify a visitor we have no relationship with.
//   • It never echoes the caller's input back as if it were data.
// ════════════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { rpcAsService } from "@/lib/server/supabaseAdmin";
import { rateLimit, clientKey } from "@/lib/server/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  "X-Robots-Tag": "noindex, nofollow",
};

/** Bodies are small by contract; reject an oversized one before parsing. */
const MAX_BODY_BYTES = 20_000;

/** The in-process brake. HONEST LIMITS: per-instance memory, so it slows casual
 *  abuse and double-submits. The REAL limit is in the database
 *  (ai_rate_take, per IP-hash, hourly + daily + global), which survives cold
 *  starts and is shared across instances. This is the cheap first gate. */
const ASK_BRAKE = { limit: 20, windowMs: 60 * 60_000 };
const LEAD_BRAKE = { limit: 8, windowMs: 60 * 60_000 };

/** Field caps mirror the database CHECK constraints exactly. A public endpoint
 *  never accepts unbounded text, and never accepts a field the DB would reject
 *  — a 400 here is kinder than a constraint violation there. */
const CAP = { question: 1_000, name: 120, email: 160, phone: 40, company: 160, service: 120, message: 2_000, idem: 120 };

/** The ONLY keys a lead payload may carry. Anything else is rejected. */
const LEAD_KEYS = ["full_name", "email", "phone", "company", "service_interest", "message", "locale"] as const;

const asStr = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const cap = (v: string, n: number) => (v.length > n ? v.slice(0, n) : v);

/**
 * A stable-but-not-identifying visitor fingerprint. We never store the raw IP
 * or user-agent — that is personal data about a third party. A salted SHA-256
 * lets the database count attempts per client without keeping who they are.
 */
function hashOf(value: string): string {
  const salt = process.env.AI_PUBLIC_FP_SALT ?? process.env.LIVE_STATUS_FP_SALT ?? "kian-ai-public";
  return createHash("sha256").update(`${salt}|${value}`).digest("hex");
}

function ipHash(req: Request): string {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  return hashOf(`ip|${ip}`);
}

function uaHash(req: Request): string {
  return hashOf(`ua|${req.headers.get("user-agent") ?? ""}`);
}

/** The public privacy notice. Shown by the page AND returned here, so the two
 *  cannot disagree about what the visitor was told. */
const PRIVACY_NOTICE_AR =
  "نحفظ ما تكتبه هنا كمسوّدة طلب ليطّلع عليها موظّف. لا نرسل بريدًا آليًّا، ولا نصدر سعرًا ولا التزامًا. " +
  "لا نحتفظ بعنوانك الشبكيّ ولا بمتصفّحك، بل ببصمة مُعمّاة تُستعمل للحدّ من الإساءة فقط.";

export async function POST(req: Request) {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413, headers: NO_STORE });
  }

  let body: Record<string, unknown>;
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("shape");
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400, headers: NO_STORE });
  }

  const action = asStr(body.action).trim();
  if (action !== "ask" && action !== "lead") {
    return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 400, headers: NO_STORE });
  }

  const brake = action === "ask" ? ASK_BRAKE : LEAD_BRAKE;
  const verdict = rateLimit(`ai-public:${action}:${clientKey(req)}`, brake.limit, brake.windowMs);
  if (!verdict.allowed) {
    // 429 with a distinct code: rate limiting is NOT "the assistant is broken"
    // and NOT "you are not allowed". The page says so in those words.
    return NextResponse.json(
      { ok: false, error: "rate_limited", retry_after_ms: verdict.retryAfterMs },
      { status: 429, headers: NO_STORE },
    );
  }

  const p_ip_hash = ipHash(req);

  // ── ask ───────────────────────────────────────────────────────────────────
  if (action === "ask") {
    const question = cap(asStr(body.question).trim(), CAP.question);
    if (question.length < 2) {
      return NextResponse.json({ ok: false, error: "question_too_short" }, { status: 400, headers: NO_STORE });
    }
    // ⚠️ No `roles` argument exists on this call and none is ever sent. The
    //    database pins retrieval to ['anonymous'] itself.
    const r = await rpcAsService<Record<string, unknown>>("ai_public_ask", {
      p_question: question,
      p_ip_hash,
    });
    if (!r.ok) return failure(r.error, r.status);
    // Pass the database's payload through VERBATIM. This route adds no field,
    // removes none, and re-words nothing — the refusal sentence
    // «لا توجد لدي معلومة معتمدة كافية للإجابة» must reach the visitor exactly
    // as the database wrote it.
    return NextResponse.json(r.data, { status: 200, headers: NO_STORE });
  }

  // ── lead ──────────────────────────────────────────────────────────────────
  const rawPayload = body.payload;
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) {
    return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 400, headers: NO_STORE });
  }
  const src = rawPayload as Record<string, unknown>;

  // ★ CLOSED PAYLOAD, checked twice. An unknown key is refused here AND in the
  //   database. Silently dropping it would let a caller believe a field like
  //   "notify_email" or "assigned_to" was honoured.
  const unknown = Object.keys(src).filter((k) => !(LEAD_KEYS as readonly string[]).includes(k));
  if (unknown.length > 0) {
    return NextResponse.json(
      { ok: false, error: "unknown_fields", fields: unknown.slice(0, 10) },
      { status: 400, headers: NO_STORE },
    );
  }

  const payload: Record<string, string> = {};
  const put = (k: string, v: string) => { if (v) payload[k] = v; };
  put("full_name", cap(asStr(src.full_name).trim(), CAP.name));
  put("email", cap(asStr(src.email).trim().toLowerCase(), CAP.email));
  put("phone", cap(asStr(src.phone).trim(), CAP.phone));
  put("company", cap(asStr(src.company).trim(), CAP.company));
  put("service_interest", cap(asStr(src.service_interest).trim(), CAP.service));
  put("message", cap(asStr(src.message), CAP.message));
  const locale = asStr(src.locale) === "en" ? "en" : "ar";
  payload.locale = locale;

  // Minimal personal data: one contact channel is required, and we say which.
  if (!payload.email && !payload.phone) {
    return NextResponse.json({ ok: false, error: "contact_required" }, { status: 400, headers: NO_STORE });
  }

  const idem = cap(asStr(body.idempotency_key).trim(), CAP.idem);

  const r = await rpcAsService<Record<string, unknown>>("ai_public_lead_draft", {
    p_payload: payload,
    p_ip_hash,
    p_user_agent_hash: uaHash(req),
    p_idempotency_key: idem || null,
    // The CAPTCHA adapter is a placeholder in the database and FAILS CLOSED
    // there when captcha_required is on and no verifier exists. This route
    // forwards the token untouched and asserts nothing about it.
    p_captcha_token: cap(asStr(body.captcha_token), 4_000) || null,
  });
  if (!r.ok) return failure(r.error, r.status);

  const data = (r.data ?? {}) as Record<string, unknown>;
  return NextResponse.json(
    {
      ...data,
      // Restated by this route as well, because "did it email anyone?" must be
      // answerable from the response alone.
      email_sent: false,
      notification_sent: false,
      converted_to_client: false,
      quote_issued: false,
      binding_price: false,
      privacy_notice: PRIVACY_NOTICE_AR,
    },
    { status: 200, headers: NO_STORE },
  );
}

/**
 * One failure shape, and each cause named as what it IS.
 *
 * ⚠️ The raw PostgREST message is NEVER handed to an anonymous caller — it
 * leaks function names, argument types and schema detail for free. The server
 * log keeps the truncated original; the visitor gets a coarse code.
 */
function failure(error: string, status: number) {
  const raw = String(error ?? "");
  console.log(JSON.stringify({ tag: "AI_PUBLIC_FAILED", status, error: raw.slice(0, 200) }));

  if (raw === "server_supabase_not_configured") {
    // Honest: OUR configuration, not the visitor's problem, and not "no answer".
    return NextResponse.json({ ok: false, error: "server_not_configured" }, { status: 503, headers: NO_STORE });
  }
  const lower = raw.toLowerCase();
  // The migration has not been run yet — code ships before SQL. Say so plainly
  // rather than pretending the assistant considered the question.
  if (lower.includes("pgrst202") || lower.includes("could not find the function") || lower.includes("42883")) {
    return NextResponse.json({ ok: false, error: "feature_not_enabled" }, { status: 503, headers: NO_STORE });
  }
  if (lower.includes("42501") || lower.includes("permission denied") || status === 403) {
    return NextResponse.json({ ok: false, error: "not_permitted" }, { status: 403, headers: NO_STORE });
  }
  return NextResponse.json({ ok: false, error: "request_failed" }, { status: 502, headers: NO_STORE });
}
