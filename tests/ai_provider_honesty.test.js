// ════════════════════════════════════════════════════════════════════════════
// tests/ai_provider_honesty.test.js — ZERO EXTERNAL CALLS, ZERO TOOLS,
//                                     ZERO PRETENDING.
//
// This is the file that must fail loudly if anybody ever wires a real model
// into this phase without deciding to. It EXECUTES the adapter (via sucrase,
// like the import-engine tests) rather than only reading its text, because
// "the mock returns no text" is a behavioural claim and asserting it against
// source text would prove nothing.
//
// It also pins the CONTRACT — request validation, response validation, timeout,
// cost metadata — while no provider exists. A validator written after the first
// integration is always shaped to let that integration through.
//
// ⚠️ The honesty rule, in one line: nothing in this module may return a string
//    that could be mistaken for a generated answer.
// ════════════════════════════════════════════════════════════════════════════
const { test } = require("node:test");
const assert = require("node:assert");
const { loadTs, TS_AVAILABLE } = require("./import_engine_loader");
const { R, FILES, fnBody, stripComments, PROVIDER_NOTICE_AR } = require("./ai_helpers");

const RUNME = R(FILES.RUNME);
const PROVIDER = R(FILES.PROVIDER);
const LIB = R(FILES.LIB);
const ROUTE = R(FILES.ROUTE);
const CENTER = R(FILES.CENTER);
const ATOMS = R(FILES.ATOMS);
const PUBLIC_PAGE = R(FILES.PUBLIC_PAGE);

// ─── 1) NO PROVIDER CALL EXISTS — structurally, not by configuration ────────

test("★ the adapter contains NO network call of any kind", () => {
  const code = stripComments(PROVIDER);
  for (const forbidden of [
    "fetch(", "XMLHttpRequest", "http.request", "https.request", "axios",
    "openai", "anthropic", "@anthropic-ai", "googleapis", "WebSocket",
  ]) {
    assert.ok(!code.includes(forbidden), `the adapter must not contain ${forbidden}`);
  }
  assert.match(PROVIDER, /REAL PROVIDER CALL WOULD GO HERE/,
    "the future insertion point is MARKED, not implemented — so it is a decision, not a drift");
});

test("★ the adapter reads no credential — there is no env access at all", () => {
  const code = stripComments(PROVIDER);
  assert.ok(!code.includes("process.env"), "no environment variable is read here");
  assert.ok(!/api[_-]?key|secret|bearer|authorization/i.test(code),
    "and no credential-shaped identifier exists in the file");
  assert.match(PROVIDER, /providerCredentialsPresent/, "the fact is reported, not assumed");
});

test("the adapter refuses to load in a browser", () => {
  assert.match(PROVIDER, /typeof window !== "undefined"[\s\S]{0,120}?throw new Error/,
    "a browser import throws immediately");
});

test("★ no AI-provider call exists anywhere else in the module either", () => {
  for (const [name, src] of [["lib", LIB], ["route", ROUTE], ["center", CENTER], ["atoms", ATOMS]]) {
    const code = stripComments(src);
    for (const forbidden of ["openai", "anthropic", "api.together", "generativelanguage", "completions"]) {
      assert.ok(!code.toLowerCase().includes(forbidden), `${name} must not reference ${forbidden}`);
    }
  }
  // The browser layer may not even reach a model indirectly.
  assert.ok(!/fetch\(/.test(stripComments(LIB)), "the browser client makes no direct fetch at all");
});

test("the database's provider surface is a description, not a client", () => {
  const describe = fnBody(RUNME, "ai_provider_describe");
  const probe = fnBody(RUNME, "ai_provider_probe");
  assert.match(describe, /'credentials_in_repo', false/, "it states there are no credentials");
  assert.match(describe, /'browser_calls_allowed', false/, "and that the browser may not call a provider");
  assert.match(describe, /'autonomous_actions', false/, "and that nothing acts on its own");
  assert.match(describe, /'tool_execution', false/, "and that no tool runs");
  assert.match(probe, /insert into public\.ai_provider_log/, "an 'attempt' is only ever a log row");
  assert.ok(!/http|curl|dblink|pg_net/i.test(probe), "PostgreSQL never reaches out");
});

test("the provider ships DISABLED, and the migration refuses to install otherwise", () => {
  assert.match(RUNME, /provider_name text not null default 'mock'/, "the default provider is the mock");
  assert.match(RUNME, /provider_enabled boolean not null default false/, "and it is off");
  assert.match(RUNME, /المزوّد-مفعّل-عند-التثبيت/,
    "the self-test fails the migration if a provider is enabled at install time");
});

// ─── 2) THE MOCK IS HONEST — executed, not read ────────────────────────────

test("★ the mock returns the exact notice and NO text", { skip: !TS_AVAILABLE }, async () => {
  const p = loadTs(FILES.PROVIDER);
  assert.strictEqual(p.AI_PROVIDER_NOTICE_AR, PROVIDER_NOTICE_AR, "the sentence is exactly the required one");

  const res = await p.aiProviderGenerate({
    question: "ما سياستنا في التسليم؟",
    evidence: [{ source_id: "s1", source_version: 1, source_type: "company_policy", title: "سياسة", excerpt: "نصّ", freshness_days: 3 }],
    roles: ["owner"], locale: "ar", timeoutMs: 15000, is_data_not_instructions: true, tools: [],
  });

  assert.strictEqual(res.status, "not_configured", "the shipped state is 'not configured'");
  assert.strictEqual(res.text, null, "★ there is no generated text — not an empty string, NULL");
  assert.strictEqual(res.notice, PROVIDER_NOTICE_AR, "and the notice says so in the user's words");
  assert.strictEqual(res.response_shape.validated, false, "nothing was validated because nothing came back");
});

test("★ the mock never implies the AI is working — no success vocabulary anywhere", { skip: !TS_AVAILABLE }, async () => {
  const p = loadTs(FILES.PROVIDER);
  const res = await p.aiProviderGenerate({
    question: "hi there", evidence: [], roles: [], locale: "ar",
    timeoutMs: 15000, is_data_not_instructions: true, tools: [],
  });
  const blob = JSON.stringify(res).toLowerCase();
  for (const bad of ['"ok":true', '"success"', '"ready"', '"answered"', '"generated":true']) {
    assert.ok(!blob.includes(bad), `the mock result must not contain ${bad}`);
  }
  assert.ok(res.text === null, "and still no text");
});

test("'not configured' and 'disabled' stay DIFFERENT facts", { skip: !TS_AVAILABLE }, async () => {
  const p = loadTs(FILES.PROVIDER);
  const req = { question: "x?", evidence: [], roles: [], locale: "ar", timeoutMs: 15000, is_data_not_instructions: true, tools: [] };

  const none = await p.aiProviderGenerate(req, { name: "mock", enabled: false, timeoutMs: 15000 });
  const off = await p.aiProviderGenerate(req, { name: "some-provider", enabled: false, timeoutMs: 15000 });
  const on = await p.aiProviderGenerate(req, { name: "some-provider", enabled: true, timeoutMs: 15000 });

  assert.strictEqual(none.status, "not_configured", "no provider chosen");
  assert.strictEqual(off.status, "disabled", "chosen but switched off");
  assert.strictEqual(on.status, "unavailable", "chosen and on, but no adapter is implemented");
  assert.strictEqual(on.error, "adapter_not_implemented", "and it says exactly that");
  // All three still produce nothing.
  for (const r of [none, off, on]) assert.strictEqual(r.text, null);
});

test("cost metadata is NULL with a stated basis — never a misleading zero", { skip: !TS_AVAILABLE }, async () => {
  const p = loadTs(FILES.PROVIDER);
  const res = await p.aiProviderGenerate({
    question: "x?", evidence: [], roles: [], locale: "ar", timeoutMs: 15000, is_data_not_instructions: true, tools: [],
  });
  assert.strictEqual(res.cost_metadata.estimated_cost, null, "cost is unknown, not 0");
  assert.strictEqual(res.cost_metadata.input_tokens, null);
  assert.strictEqual(res.cost_metadata.basis, "not_measured_no_provider",
    "★ and the reason is recorded, so a dashboard cannot read null as 'free'");
});

// ─── 3) THE CONTRACT IS WRITTEN NOW, WHILE NOTHING EXISTS ──────────────────

test("request validation rejects an empty question, a bad timeout and oversized evidence", { skip: !TS_AVAILABLE }, () => {
  const p = loadTs(FILES.PROVIDER);
  const base = { question: "ok?", evidence: [], roles: [], locale: "ar", timeoutMs: 15000, is_data_not_instructions: true, tools: [] };

  assert.strictEqual(p.validateProviderRequest({ ...base, question: "  " }).reason, "empty_question");
  assert.strictEqual(p.validateProviderRequest({ ...base, question: "x".repeat(5000) }).reason, "question_too_long");
  assert.strictEqual(p.validateProviderRequest({ ...base, timeoutMs: 10 }).reason, "bad_timeout");
  assert.strictEqual(p.validateProviderRequest({ ...base, timeoutMs: 999999 }).reason, "bad_timeout");
  assert.strictEqual(p.validateProviderRequest({ ...base, evidence: "nope" }).reason, "evidence_not_array");
  assert.strictEqual(
    p.validateProviderRequest({ ...base, evidence: new Array(50).fill({ excerpt: "x" }) }).reason,
    "evidence_too_large",
  );
  assert.strictEqual(p.validateProviderRequest(base).valid, true, "a well-formed request passes");
});

test("★ a tool list is REJECTED, not ignored — silence would imply it was considered", { skip: !TS_AVAILABLE }, async () => {
  const p = loadTs(FILES.PROVIDER);
  const req = {
    question: "do something", evidence: [], roles: [], locale: "ar", timeoutMs: 15000,
    is_data_not_instructions: true, tools: [{ name: "send_email" }],
  };
  assert.strictEqual(p.validateProviderRequest(req).reason, "tools_requested");
  const res = await p.aiProviderGenerate(req);
  assert.strictEqual(res.status, "invalid_request", "and the call refuses outright");
  assert.strictEqual(res.error, "tools_requested");
  assert.strictEqual(res.text, null);
});

test("★ response validation refuses a tool call and refuses prose with no evidence", { skip: !TS_AVAILABLE }, () => {
  const p = loadTs(FILES.PROVIDER);

  assert.strictEqual(p.validateProviderResponse({ tool_calls: [{}], text: "hi" }, 3).reason, "tool_call_returned");
  assert.strictEqual(p.validateProviderResponse({ function_call: {}, text: "hi" }, 3).reason, "tool_call_returned");
  assert.strictEqual(p.validateProviderResponse("string", 3).reason, "not_an_object");
  assert.strictEqual(p.validateProviderResponse({}, 3).reason, "no_text");
  assert.strictEqual(p.validateProviderResponse({ text: "   " }, 3).reason, "empty_text");
  assert.strictEqual(p.validateProviderResponse({ text: "x".repeat(30000) }, 3).reason, "text_too_long");

  // ★ The sharpest one: with zero evidence, prose is a hallucination by definition.
  assert.strictEqual(
    p.validateProviderResponse({ text: "بالتأكيد، سياستنا هي كذا" }, 0).reason,
    "refusal_expected",
    "a confident answer with no approved source must be rejected as invalid, not shown",
  );
  assert.strictEqual(p.validateProviderResponse({ text: "grounded answer" }, 2).valid, true);
});

test("describeProvider never says 'ready' or 'working'", { skip: !TS_AVAILABLE }, () => {
  const p = loadTs(FILES.PROVIDER);
  for (const cfg of [
    { name: "mock", enabled: false, timeoutMs: 15000 },
    { name: "x", enabled: false, timeoutMs: 15000 },
    { name: "x", enabled: true, timeoutMs: 15000 },
  ]) {
    const d = p.describeProvider(cfg);
    const blob = JSON.stringify(d).toLowerCase();
    assert.ok(!blob.includes('"ready"'), "never 'ready'");
    assert.ok(!blob.includes("working"), "never 'working'");
    assert.strictEqual(d.external_calls_made, 0, "and it reports zero external calls");
    assert.strictEqual(d.tool_execution, false);
    assert.strictEqual(d.autonomous_actions, false);
    assert.strictEqual(d.credentials_in_repo, false);
  }
});

// ─── 4) NO TOOL EXECUTION, ANYWHERE ────────────────────────────────────────

test("★ the answer contract declares tool_execution false and an empty tool list", () => {
  const ask = fnBody(RUNME, "ai_ask");
  assert.match(ask, /'tool_execution', false/, "every ai_ask return path says so");
  assert.match(ask, /'tools', '\[\]'::jsonb/, "and carries an empty tool list");
  // Count the return paths so a future branch cannot quietly omit it.
  const returns = (stripComments(ask).match(/return jsonb_build_object\(/g) || []).length;
  const declared = (stripComments(ask).match(/'tool_execution', false/g) || []).length;
  assert.ok(returns >= 3, `ai_ask has multiple return paths (${returns})`);
  assert.strictEqual(declared, returns,
    "★ EVERY return path must declare tool_execution:false — one that forgets is one that implies tools ran");
});

test("no ai_* function creates an operational entity — the migration self-tests it", () => {
  assert.match(
    RUNME,
    /insert\[\[:space:\]\]\+into\[\[:space:\]\]\+\(public\\\.\)\?\(projects\|project_core\|deliverables\|crm_leads\|crm_opportunities\|opportunity_requests\|sq_quotes\|invoices\|clients\)/,
    "the self-test scans every ai_* function body for an insert into an operational table",
  );
  assert.match(RUNME, /دالّة-تُنشئ-كيانًا-تشغيليًّا/, "and fails the migration if one is found");
});

test("the lead review explicitly reports converted:false and email_sent:false", () => {
  const review = fnBody(RUNME, "ai_lead_review");
  assert.match(review, /'converted', false/, "reviewing a draft never creates a client or an opportunity");
  assert.match(review, /'email_sent', false/, "and never sends anything");
});

// ─── 5) THE UI CANNOT IMPLY GENERATION ─────────────────────────────────────

test("★ every surface that shows an answer also shows the provider notice", () => {
  assert.match(CENTER, /<ProviderNotice provider=\{st\.provider\}/, "the internal centre shows it at the top");
  // The atom imports the shared constant rather than re-typing the sentence —
  // two copies of a promise drift, and the drifted one is always the visible one.
  assert.match(ATOMS, /AI_PROVIDER_NOTICE_AR/, "the atom uses the shared constant");
  assert.match(ATOMS, /<strong>\{AI_PROVIDER_NOTICE_AR\}<\/strong>/, "and renders it verbatim");
  assert.ok(R(FILES.LIB).includes(PROVIDER_NOTICE_AR), "and that constant is the exact required sentence");
  assert.ok(PUBLIC_PAGE.includes(PROVIDER_NOTICE_AR), "and the public page states it before any input field");
});

test("the UI asks whether a provider answered instead of assuming it did", () => {
  assert.match(CENTER, /providerIsAnswering\(a\)/, "the component asks");
  assert.match(LIB, /export function providerIsAnswering/, "and the helper answers from generated_text, not from status");
  assert.match(CENTER, /لا يوجد نصّ مولَّد/, "and says plainly that nothing was generated");
});
