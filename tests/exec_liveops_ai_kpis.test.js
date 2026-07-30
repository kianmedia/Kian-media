// ════════════════════════════════════════════════════════════════════════════
// tests/exec_liveops_ai_kpis.test.js
//
// The executive package is the LAST package in the program, and the final
// cross-module audit extended it with four KPIs sourced from the two newest
// modules: live operations and the Kian assistant.
//
// An executive dashboard is the most dangerous place to widen a read. It is
// looked at by the people with the broadest permissions, so a field that leaks
// there leaks to exactly the audience least likely to notice it is a leak. This
// file therefore asserts what the two new blocks may NOT do, not just that they
// exist:
//
//   · counts only — no stream key, no IP, no serial, no cost, no internal note,
//     no conversation text, no lead PII
//   · no new visibility — the source RPC is called under the reader's own
//     identity, so the source module's own gate still decides
//   · a missing module reads "unavailable" with its RUNME name, never zero
//   · a denial reads "restricted", never zero, and never "missing migration"
//   · nothing here implies the assistant is live: external_calls stays 0 and
//     telemetry_connected stays false
// ════════════════════════════════════════════════════════════════════════════
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { SQL, PREFLIGHT, POSTCHECK, TS, DASH, funcBody, KPI_KEYS } = require("./exec_helpers.js");

const NEW_KEYS = [
  "live_sessions_active",
  "live_open_incidents",
  "ai_knowledge_approved",
  "ai_leads_pending_review",
];

test("the four new KPIs exist in the engine, the labels and the layout", () => {
  const body = funcBody("mgmt_compute");
  for (const k of NEW_KEYS) {
    assert.ok(KPI_KEYS.includes(k), `${k} is missing from the test catalogue`);
    assert.ok(body.includes(`'${k}'`), `${k} is not built inside mgmt_compute`);
    assert.ok(TS.includes(k), `${k} has no Arabic/English label — it would render as a raw key`);
    assert.ok(DASH.includes(k), `${k} is built but never placed in a department column`);
  }
});

test("every new KPI is NON-sensitive and stays a count", () => {
  const body = funcBody("mgmt_compute");
  for (const k of NEW_KEYS) {
    // mgmt_kpi(key, department, unit, sensitive, ...) — the 4th argument.
    const calls = body.split(`mgmt_kpi('${k}'`).slice(1);
    assert.ok(calls.length > 0, `${k} is never built through mgmt_kpi`);
    for (const c of calls) {
      const head = c.slice(0, 80);
      assert.match(head, /^,\s*'(production|communications)'\s*,\s*'count'\s*,\s*false/,
        `${k} must be a non-sensitive count in production/communications — got: ${head.trim()}`);
    }
  }
});

test("no sensitive live-ops or assistant field is ever read into the dashboard", () => {
  const body = funcBody("mgmt_compute");
  // Field names that must never appear in the executive engine. Each one is a
  // real column in the source modules, which is why naming them is meaningful.
  const FORBIDDEN = [
    "stream_key", "ingest_url", "rtmp", "ip_address", "serial_number",
    "internal_notes", "root_cause", "token_hash", "adapter_id",
    "ai_messages", "ai_source_chunks", "content", "excerpt",
    "contact_email", "contact_phone", "cost", "rate",
  ];
  for (const f of FORBIDDEN) {
    assert.ok(!new RegExp(`\\b${f}\\b`).test(body),
      `mgmt_compute reads "${f}" — the executive dashboard must carry counts only`);
  }
});

test("both new sources go through mgmt_read_jsonb, so absence is not a zero", () => {
  const body = funcBody("mgmt_compute");
  assert.match(body, /mgmt_read_jsonb\('public\.liveops_session_list\(jsonb\)'/,
    "live ops is read directly instead of through the feature-detecting reader");
  assert.match(body, /mgmt_read_jsonb\('public\.ai_admin_overview\(\)'/,
    "the assistant is read directly instead of through the feature-detecting reader");
  assert.ok(body.includes("docs/live_operations_dashboard_RUNME.sql"),
    "a missing live-ops module must name its RUNME file");
  assert.ok(body.includes("docs/kian_ai_assistant_RUNME.sql"),
    "a missing assistant module must name its RUNME file");
});

test("the assistant's soft denial is translated to restricted, not to zero", () => {
  const body = funcBody("mgmt_compute");
  // ai_admin_overview() does NOT raise on denial — it returns state:not_permitted
  // per section. Read naively that becomes a confident zero.
  assert.match(body, /'knowledge'->>'state'\) = 'ok'/,
    "the knowledge section's own state is not inspected");
  assert.match(body, /'leads'->>'state'\) = 'ok'/,
    "the leads section's own state is not inspected");
  // One explicit restricted branch per section: knowledge and leads.
  const restricted = body.split("'restricted','not_authorized'").length - 1;
  assert.ok(restricted >= 2,
    `a soft denial from the assistant is not mapped to an explicit restricted state (found ${restricted}, need 2)`);
});

test("nothing in the new KPIs implies telemetry or a working model", () => {
  const body = funcBody("mgmt_compute");
  assert.match(body, /'telemetry_connected', false/,
    "the live-ops KPIs must repeat that these are human entries, not measurements");
  assert.match(body, /'external_calls'/,
    "the assistant KPI must carry the provider's external-call count (which is 0)");
});

test("both new modules are optional in PREFLIGHT and visible in POSTCHECK", () => {
  for (const sig of ["public.liveops_session_list(jsonb)", "public.ai_admin_overview()"]) {
    assert.ok(PREFLIGHT.includes(sig), `PREFLIGHT does not probe ${sig}`);
    assert.ok(POSTCHECK.includes(sig), `POSTCHECK does not report ${sig}`);
  }
  // The hard preflight inside the RUNME must NOT abort when they are absent.
  const pre = SQL.slice(SQL.indexOf("do $pre$"), SQL.indexOf("end $pre$;"));
  for (const sig of ["liveops_session_list", "ai_admin_overview"]) {
    const i = pre.indexOf(sig);
    assert.ok(i > 0, `the hard preflight does not detect ${sig}`);
    assert.match(pre.slice(i, i + 300), /raise notice/,
      `a missing ${sig} raises an exception instead of a notice`);
  }
  assert.ok(!/raise exception[^;]*liveops|raise exception[^;]*ai_admin/.test(pre),
    "the new modules must never be a hard dependency of this package");
});

test("the executive POSTCHECK returns ONE result set and calls no gated RPC", () => {
  // Multiple top-level SELECTs mean a SQL editor shows only the last one, and a
  // file read as "it ran fine" was in practice one check out of thirty.
  const tops = POSTCHECK.split("\n").filter((l) => /^(select|with)\b/.test(l));
  assert.equal(tops.length, 2,
    `expected exactly one WITH + one final SELECT, found ${tops.length} top-level statements`);
  assert.ok(/^with\b/m.test(POSTCHECK), "the checks are not assembled in a single CTE chain");

  // A gated RPC dies under postgres (auth.uid() = NULL) and takes the file down.
  for (const gated of ["mgmt_dashboard(", "mgmt_export(", "mgmt_refresh(", "mgmt_sources(", "mgmt_audit_list("]) {
    assert.ok(!new RegExp(`(?<!')\\bpublic\\.${gated.replace("(", "\\(")}`).test(
      POSTCHECK.replace(/'[^']*'/g, "''")),
      `POSTCHECK invokes the gated ${gated}) — it would abort under the postgres role`);
  }
});
