// ════════════════════════════════════════════════════════════════════════════
// tests/ai_citations_and_retention.test.js — GROUNDING AND WHAT IS KEPT.
//
// Two guarantees, both of which are easy to erode later and are therefore
// pinned structurally rather than by convention:
//
//   A. NO ANSWER WITHOUT SOURCES. An assistant reply either carries citations
//      or carries a refusal code — the database makes any third possibility
//      unrepresentable, and the refusal sentence is fixed text, not a template
//      a future edit can soften into "here is what I think".
//
//   B. NO CHAIN OF THOUGHT, NO SYSTEM PROMPT, NO SECRETS IN THE TRANSCRIPT.
//      Enforced by the column list and a role CHECK, so a direct INSERT with
//      the service key cannot store reasoning either. Retention and redaction
//      exist and are reachable.
// ════════════════════════════════════════════════════════════════════════════
const { test } = require("node:test");
const assert = require("node:assert");
const { loadTs, TS_AVAILABLE } = require("./import_engine_loader");
const { R, FILES, fnBody, stripComments, NO_SOURCE_AR } = require("./ai_helpers");

const RUNME = R(FILES.RUNME);
const ASK = fnBody(RUNME, "ai_ask");
const LIB = R(FILES.LIB);
const CENTER = R(FILES.CENTER);

// ─── A) GROUNDING ───────────────────────────────────────────────────────────

test("★ an assistant message must have sources OR a refusal code — the third case is unrepresentable", () => {
  assert.match(
    RUNME,
    /ai_messages_grounded_or_refusal[\s\S]{0,300}?role <> 'assistant' or retrieved_count > 0 or refusal_code is not null/,
    "a grounded-or-refusal CHECK must exist on ai_messages",
  );
});

test("★ the no-source refusal is the EXACT sentence, in the database and in the UI layer", () => {
  assert.ok(RUNME.includes(NO_SOURCE_AR), "the database returns the required sentence verbatim");
  assert.ok(LIB.includes(NO_SOURCE_AR), "the client layer knows the same sentence");
  // And the refusal is stored with its code, not as free text.
  assert.match(ASK, /'no_approved_source'/, "the refusal carries a machine-readable code");
  assert.match(ASK, /'confidence', 'none'/, "a refusal is explicitly zero-confidence, never omitted");
});

test("the UI shows the server's refusal sentence and never substitutes a friendlier one", () => {
  assert.match(CENTER, /a\.answer \|\| AI_NO_SOURCE_AR/,
    "the component renders the server's own sentence, falling back to the same constant");
  // A generic consolation reply would be the exact failure mode this forbids.
  for (const bad of ["يمكنني مساعدتك", "بشكل عام", "غالبًا", "أعتقد"]) {
    assert.ok(!CENTER.includes(bad), `the UI must not soften a refusal with «${bad}»`);
  }
});

test("citations are written for EVERY retrieved chunk, with version and freshness", () => {
  assert.match(
    ASK,
    /insert into public\.ai_message_citations \(message_id, source_id, source_version, source_title,\s*\n\s*source_type, chunk_index, freshness_days, rank\)/,
    "each answer inserts its citations",
  );
  assert.match(ASK, /from jsonb_array_elements\(v_evidence\) e;/,
    "one citation per retrieved item — not a summary, not a sample");
});

test("a citation cannot outlive its source: the FK is ON DELETE RESTRICT", () => {
  assert.match(
    RUNME,
    /source_id uuid not null references public\.ai_knowledge_sources\(id\) on delete restrict/,
    "deleting a cited source is refused, so an answer's provenance can never become a dangling id",
  );
});

test("confidence is a CATEGORY derived from count, rank and freshness — never a bare number", () => {
  assert.match(ASK, /v_conf := case\s*\n?\s*when v_rows >= 2 and v_top >= 0\.05 and v_fresh <= 180 then 'high'/,
    "high confidence needs several sources, a real match, and recent material");
  assert.match(RUNME, /ai_messages_confidence_known[\s\S]{0,200}?in \('none','low','medium','high'\)/,
    "and the stored value is a closed vocabulary");
});

test("freshness is rendered with meaning, and a stale source is called stale", { skip: !TS_AVAILABLE }, () => {
  const m = loadTs(FILES.LIB);
  assert.match(m.freshnessLabelAr(null), /غير معروفة/, "unknown freshness says unknown — never 'fresh'");
  assert.match(m.freshnessLabelAr(5), /خلال 5/, "recent material says so");
  assert.match(m.freshnessLabelAr(400), /قديم/, "old material is flagged, not quietly cited");

  const line = m.citationLineAr({
    source_id: "x", title_ar: "سياسة التسليم", source_type: "company_policy",
    source_version: 3, freshness_days: 12,
  });
  assert.match(line, /سياسة التسليم/, "the title is present");
  assert.match(line, /نسخة 3/, "★ the version is present — an answer citing 'the policy' without a version is unauditable");
  assert.match(line, /12/, "and the freshness is present");
});

test("the answer object cannot carry generated text — it is pinned to null on the way in", { skip: !TS_AVAILABLE }, () => {
  const code = stripComments(LIB);
  assert.match(code, /generated_text: null,/, "the mapper hard-codes null");
  assert.ok(!/generated_text:\s*(?:o|d|data)\./.test(code),
    "★ it never reads a generated string out of the payload — a future server that returned one could not surface here by accident");
});

// ─── B) WHAT IS STORED ──────────────────────────────────────────────────────

test("★ no column in the conversation model can hold a chain of thought or a system prompt", () => {
  const conv = RUNME.slice(
    RUNME.indexOf("create table if not exists public.ai_conversations"),
    RUNME.indexOf("create table if not exists public.ai_message_citations"),
  );
  assert.ok(conv.length > 500, "the conversation + message tables were found");
  for (const forbidden of [
    "thought", "reasoning", "chain_of", "scratch", "system_prompt", "internal_prompt",
    "raw_context", "prompt_text", "hidden",
  ]) {
    assert.ok(!conv.includes(forbidden), `no column may be named/derived ${forbidden}`);
  }
  // And the RUNME self-tests the same thing at deploy time.
  assert.match(RUNME, /عمود-سلسلة-تفكير/, "the migration refuses to install if such a column appears");
});

test("★ the message role vocabulary makes 'thought' and 'system_prompt' impossible values", () => {
  assert.match(
    RUNME,
    /ai_messages_role_known[\s\S]{0,200}?role in \('user','assistant','system_notice'\)/,
    "three roles only — a reasoning row cannot be inserted even with the service key",
  );
});

test("the provider log stores SHAPE only — never the question, never the answer", () => {
  const probe = fnBody(RUNME, "ai_provider_probe");
  assert.match(probe, /'question_chars'/, "lengths are logged");
  assert.match(probe, /'evidence_items'/, "counts are logged");
  // The probe's only inputs are an int length and an int count — there is no
  // text parameter at all, so the question CANNOT be logged even by mistake.
  const sig = probe.slice(0, probe.indexOf("as $$"));
  assert.match(sig, /\(p_question_length int, p_evidence_count int\)/,
    "the probe takes a LENGTH, not the question");
  assert.ok(!/\btext\b/.test(sig), "no text parameter reaches the provider log");
  assert.match(probe, /'text', null/, "and the response shape records no text");
  const table = RUNME.slice(
    RUNME.indexOf("create table if not exists public.ai_provider_log"),
    RUNME.indexOf("create index if not exists ai_provider_log_time_idx"),
  );
  for (const forbidden of ["question text", "prompt", "completion", "answer_text"]) {
    assert.ok(!table.includes(forbidden), `the provider log must not carry ${forbidden}`);
  }
});

test("a public conversation carries no user id — minimal personal data by CHECK", () => {
  assert.match(
    RUNME,
    /ai_conversations_public_has_no_user[\s\S]{0,250}?actor_kind <> 'public' or actor_user_id is null/,
    "the public channel cannot be tied to an account row",
  );
});

test("retention, redaction and deletion all exist and are permissioned", () => {
  const redact = fnBody(RUNME, "ai_conversation_redact");
  const del = fnBody(RUNME, "ai_conversation_delete");
  const purge = fnBody(RUNME, "ai_retention_purge_due");

  assert.match(redact, /ai_can_redact/, "redaction is gated");
  assert.match(redact, /'\[محتوى مُنقَّح\]'/, "and actually replaces the content, not just a flag");
  assert.match(del, /ai_can_redact/, "deletion is gated by the same key");
  assert.match(purge, /expires_at is not null and expires_at < now\(\)/, "the purge is time-based");
  assert.match(purge, /delete from public\.ai_messages/, "and really removes message bodies");

  // Every conversation gets an expiry at creation — retention is not optional.
  const start = fnBody(RUNME, "ai_conversation_start");
  assert.match(start, /retention_days_internal/, "the retention window is read from settings");
  assert.match(start, /expires_at\)/, "expires_at is written at creation");
  assert.match(start, /now\(\) \+ make_interval\(days => v_days\)/,
    "and its value is now() + the configured retention — retention is not optional");
});

test("redaction and purge are AUDITED — who removed what, and when", () => {
  for (const fn of ["ai_conversation_redact", "ai_conversation_delete", "ai_retention_purge_due", "ai_source_approve", "ai_settings_update", "ai_lead_review"]) {
    assert.match(fnBody(RUNME, fn), /ai_log\(/, `${fn} must write an audit row`);
  }
});

test("escalation is a status change, not a message — nothing is sent", () => {
  const esc = fnBody(RUNME, "ai_conversation_escalate");
  assert.match(esc, /escalation_status = 'requested'/, "the state moves");
  assert.match(esc, /'email_sent', false/, "and the response states plainly that nothing was sent");
  assert.ok(!/notify_|email_outbox|comms_|whatsapp/i.test(esc), "no delivery path is touched");
});
