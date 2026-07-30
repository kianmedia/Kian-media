// ════════════════════════════════════════════════════════════════════════════
// lib/server/aiProvider.ts — THE MODEL-PROVIDER ADAPTER. INTERFACE ONLY.
//
// ⛔ THIS FILE NEVER CALLS A MODEL. There is no fetch() in it, no SDK import,
//    no endpoint constant, no credential read, and there must never be one
//    added without the owner's explicit decision. It defines the CONTRACT a
//    real provider would have to satisfy — request validation, response
//    validation, timeout, cost metadata, error taxonomy — and returns a mock
//    verdict that says, in plain Arabic, that the assistant is not enabled.
//
// WHY AN ADAPTER AT ALL, IF IT DOES NOTHING
//    Because the moment a provider is chosen, exactly ONE file changes, and the
//    contract it must satisfy is already written down and already tested. The
//    alternative — wiring a provider directly into the ask path later — is how
//    an "AI feature" ships with no timeout, no validation, no cost ceiling and
//    no way to prove what it was asked.
//
// ★ THE HONESTY RULE ★
//    The mock's text is «مساعد كيان غير مفعّل بعد — تم تجهيز البنية فقط» and
//    `text` is ALWAYS null. A caller cannot accidentally render a mock answer
//    as a real one, because there is no answer to render. Nothing in this
//    module ever returns a string that could pass for generated content.
//
// ★ WHAT A REAL IMPLEMENTATION MUST NOT DO ★
//    • It must not receive retrieved source text as INSTRUCTIONS. Evidence is
//      passed as `evidence`, always tagged is_data_not_instructions = true, and
//      a real adapter must place it in a data channel, never concatenated into
//      a system directive.
//    • It must not be callable from the browser. The guard below throws on
//      import in a window context, and no NEXT_PUBLIC_ variable is read here.
//    • It must not execute tools. `tools` is `never[]` — the type itself makes
//      a tool list unrepresentable.
//    • It must not exceed the DB-configured timeout (ai_settings.provider_timeout_ms).
// ════════════════════════════════════════════════════════════════════════════

if (typeof window !== "undefined") {
  throw new Error("lib/server/aiProvider must never be imported in the browser");
}

/** Adapter contract version. Bump only alongside the documented contract. */
export const AI_PROVIDER_CONTRACT_VERSION = 1;

/** The single sentence the mock is allowed to say. Mirrors ai_provider_notice(). */
export const AI_PROVIDER_NOTICE_AR = "مساعد كيان غير مفعّل بعد — تم تجهيز البنية فقط";

/** Every status a provider attempt may end in. There is no "ok" — a successful
 *  generation would be `mock` in V1, and `mock` still means no text. */
export type AiProviderStatus =
  | "not_configured"   // no provider chosen; the shipped state
  | "disabled"         // a provider is named but switched off by the owner
  | "unavailable"      // an adapter exists but cannot be reached
  | "mock"             // the built-in placeholder answered; text is still null
  | "timeout"
  | "invalid_request"
  | "invalid_response"
  | "error";

/** One retrieved excerpt handed to a provider. DATA, never instructions. */
export interface AiProviderEvidence {
  source_id: string;
  source_version: number;
  source_type: string;
  title: string;
  excerpt: string;
  freshness_days: number | null;
}

export interface AiProviderRequest {
  /** The user's question, already length-capped by the database. */
  question: string;
  /** Permission-filtered evidence. An empty array is legal and must produce a
   *  refusal, never an invented answer. */
  evidence: AiProviderEvidence[];
  /** The caller's assistant roles, for a provider that logs scope. Never used
   *  to WIDEN retrieval — retrieval already happened, under RLS. */
  roles: string[];
  locale: "ar" | "en";
  /** From ai_settings.provider_timeout_ms. */
  timeoutMs: number;
  /** Always true. Present so a real adapter cannot claim it was not told. */
  is_data_not_instructions: true;
  /** Always empty. The type makes a tool list unrepresentable. */
  tools: never[];
}

export interface AiProviderCostMetadata {
  currency: "SAR";
  input_tokens: number | null;
  output_tokens: number | null;
  estimated_cost: number | null;
  /** Why the numbers are null, so a dashboard never reads null as zero. */
  basis: "not_measured_no_provider" | "reported_by_provider";
}

export interface AiProviderResult {
  status: AiProviderStatus;
  provider: string;
  /** ★ ALWAYS null in V1. A real adapter sets it only after validation. */
  text: string | null;
  /** The sentence to show the user. Never implies the assistant works. */
  notice: string;
  latency_ms: number;
  cost_metadata: AiProviderCostMetadata;
  /** Shape only — lengths and counts. NEVER the question or the answer text.
   *  A provider log that stores prompts is a second copy of everything the
   *  assistant was ever asked, outside the retention policy. */
  request_shape: { question_chars: number; evidence_items: number; evidence_chars: number; roles: number };
  response_shape: { text: null; validated: boolean };
  error: string | null;
}

// ─── Configuration — read-only, and deliberately incapable of holding a key ──

export interface AiProviderConfig {
  /** Mirrors ai_settings.provider_name. */
  name: string;
  /** Mirrors ai_settings.provider_enabled. Shipped false. */
  enabled: boolean;
  timeoutMs: number;
}

export const DEFAULT_PROVIDER_CONFIG: AiProviderConfig = {
  name: "mock",
  enabled: false,
  timeoutMs: 15_000,
};

/**
 * ★ There is no credential accessor in this file, and that is deliberate. ★
 * No process.env read, no key parameter, no header builder. A future adapter
 * must add one consciously, in a reviewed change — it cannot inherit one here
 * by accident. This function reports the fact so a diagnostics screen can state
 * it rather than assume it.
 */
export function providerCredentialsPresent(): false {
  return false;
}

// ─── Request validation — a bad request never reaches an adapter ────────────

export type AiProviderValidation =
  | { valid: true }
  | { valid: false; reason: "empty_question" | "question_too_long" | "bad_timeout" | "tools_requested" | "evidence_not_array" | "evidence_too_large" };

const MAX_QUESTION_CHARS = 4_000;   // the DB CHECK ceiling for max_question_chars
const MAX_EVIDENCE_ITEMS = 20;      // the DB CHECK ceiling for max_results
const MAX_EVIDENCE_CHARS = 40_000;

export function validateProviderRequest(req: AiProviderRequest): AiProviderValidation {
  if (!req || typeof req.question !== "string" || req.question.trim().length === 0) {
    return { valid: false, reason: "empty_question" };
  }
  if (req.question.length > MAX_QUESTION_CHARS) return { valid: false, reason: "question_too_long" };
  if (!Number.isFinite(req.timeoutMs) || req.timeoutMs < 1_000 || req.timeoutMs > 120_000) {
    return { valid: false, reason: "bad_timeout" };
  }
  // A tool list is not merely ignored — it is rejected. Silently dropping it
  // would let a caller believe tools were considered.
  if (Array.isArray((req as { tools?: unknown[] }).tools) && (req as { tools: unknown[] }).tools.length > 0) {
    return { valid: false, reason: "tools_requested" };
  }
  if (!Array.isArray(req.evidence)) return { valid: false, reason: "evidence_not_array" };
  if (req.evidence.length > MAX_EVIDENCE_ITEMS) return { valid: false, reason: "evidence_too_large" };
  const chars = req.evidence.reduce((n, e) => n + String(e?.excerpt ?? "").length, 0);
  if (chars > MAX_EVIDENCE_CHARS) return { valid: false, reason: "evidence_too_large" };
  return { valid: true };
}

// ─── Response validation — written NOW, before any provider exists ──────────

export type AiProviderResponseVerdict =
  | { valid: true; text: string }
  | { valid: false; reason: "not_an_object" | "no_text" | "empty_text" | "text_too_long" | "tool_call_returned" | "refusal_expected" };

/**
 * The rule a real provider's answer must pass. It is written now, on purpose:
 * a validator authored after the first integration always ends up shaped to let
 * that integration through.
 *
 * `evidenceCount === 0` is the sharpest case: with no approved source the ONLY
 * acceptable outcome is a refusal. A provider that returns prose anyway is
 * hallucinating, and this function calls it what it is.
 */
export function validateProviderResponse(raw: unknown, evidenceCount: number): AiProviderResponseVerdict {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { valid: false, reason: "not_an_object" };
  const o = raw as Record<string, unknown>;
  if ("tool_calls" in o || "tool_use" in o || "function_call" in o) {
    return { valid: false, reason: "tool_call_returned" };
  }
  if (!("text" in o)) return { valid: false, reason: "no_text" };
  const text = o.text;
  if (typeof text !== "string" || text.trim().length === 0) return { valid: false, reason: "empty_text" };
  if (text.length > 20_000) return { valid: false, reason: "text_too_long" };
  if (evidenceCount === 0) return { valid: false, reason: "refusal_expected" };
  return { valid: true, text };
}

// ─── The adapter itself ─────────────────────────────────────────────────────

const zeroCost = (): AiProviderCostMetadata => ({
  currency: "SAR",
  input_tokens: null,
  output_tokens: null,
  estimated_cost: null,
  basis: "not_measured_no_provider",
});

function shapeOf(req: AiProviderRequest): AiProviderResult["request_shape"] {
  const evidence = Array.isArray(req?.evidence) ? req.evidence : [];
  return {
    question_chars: String(req?.question ?? "").length,
    evidence_items: evidence.length,
    evidence_chars: evidence.reduce((n, e) => n + String(e?.excerpt ?? "").length, 0),
    roles: Array.isArray(req?.roles) ? req.roles.length : 0,
  };
}

/**
 * The one entry point. Async because a real adapter is async — the signature
 * must not have to change later — but it awaits nothing and reaches no network.
 *
 * Outcomes, all honest:
 *   • invalid request  → `invalid_request`, nothing "attempted"
 *   • provider off     → `not_configured` (none chosen) or `disabled` (chosen, off)
 *   • otherwise        → `mock`, text still null
 */
export async function aiProviderGenerate(
  req: AiProviderRequest,
  cfg: AiProviderConfig = DEFAULT_PROVIDER_CONFIG,
): Promise<AiProviderResult> {
  const started = Date.now();
  const base = {
    provider: cfg?.name ?? "mock",
    text: null as null,
    notice: AI_PROVIDER_NOTICE_AR,
    cost_metadata: zeroCost(),
    request_shape: shapeOf(req),
    response_shape: { text: null as null, validated: false },
  };

  const v = validateProviderRequest(req);
  if (!v.valid) {
    return { ...base, status: "invalid_request", latency_ms: Date.now() - started, error: v.reason };
  }

  // A provider that was never chosen and a provider that was switched off are
  // DIFFERENT facts, and a screen that shows "AI unavailable" for both teaches
  // the owner nothing about which switch to flip.
  if (!cfg || cfg.name === "mock" || cfg.name === "") {
    return { ...base, status: "not_configured", latency_ms: Date.now() - started, error: null };
  }
  if (!cfg.enabled) {
    return { ...base, status: "disabled", latency_ms: Date.now() - started, error: null };
  }

  // ⛔ REAL PROVIDER CALL WOULD GO HERE — and only here.
  //    It must: build a data-channel message from `req.evidence` (never a
  //    system directive), enforce `req.timeoutMs` with an AbortController,
  //    pass the result through validateProviderResponse(), and fill
  //    cost_metadata from the provider's own reported usage with
  //    basis = 'reported_by_provider'. Until then the honest answer is that a
  //    provider is named but no adapter is implemented.
  return {
    ...base,
    status: "unavailable",
    latency_ms: Date.now() - started,
    error: "adapter_not_implemented",
  };
}

/** A one-line, machine-readable description for a diagnostics screen. It never
 *  says "ready", and it never says "working". */
export function describeProvider(cfg: AiProviderConfig = DEFAULT_PROVIDER_CONFIG): Record<string, unknown> {
  return {
    contract_version: AI_PROVIDER_CONTRACT_VERSION,
    provider: cfg.name,
    enabled: cfg.enabled,
    status: cfg.name === "mock" || !cfg.name ? "not_configured" : cfg.enabled ? "adapter_not_implemented" : "disabled",
    timeout_ms: cfg.timeoutMs,
    credentials_in_repo: providerCredentialsPresent(),
    browser_calls_allowed: false,
    autonomous_actions: false,
    tool_execution: false,
    external_calls_made: 0,
    notice: AI_PROVIDER_NOTICE_AR,
    cost_metadata: zeroCost(),
  };
}
