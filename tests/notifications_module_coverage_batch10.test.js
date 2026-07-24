// ════════════════════════════════════════════════════════════════════════════
// tests/notifications_module_coverage_batch10.test.js — BATCH 10 · Phase 3
// Module coverage: the deliverable-download receipt now flows through the UNIFIED
// pipeline (emitEventEmail) with a SAFE FALLBACK to the previous direct send so the
// alert is never lost while notify_emit_event is unapplied. Structural pins only.
// No DB, no network, no real email.
// ════════════════════════════════════════════════════════════════════════════
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(root, p), "utf8");

const DL = R("app/api/portal/deliverable-download/route.ts");

test("10.3 download receipt: primary path is the unified emitEventEmail (queue + trace + retry)", () => {
  assert.ok(DL.includes('emitEventEmail'), "uses the one dispatch helper");
  assert.ok(/event:\s*"deliverable\.download_recorded"/.test(DL), "canonical event name");
  assert.ok(/entity_type:\s*"deliverable"/.test(DL) && /entity_id:\s*deliverableId/.test(DL), "entity is the deliverable");
  assert.ok(/project_id:\s*d\.project_id/.test(DL), "project passed so the resolver can add the PM");
  assert.ok(DL.includes("logEmitOutcome"), "logs the honest dispatch outcome");
});

test("10.3 download receipt: SAFE FALLBACK to direct send ONLY when the queue path is unavailable", () => {
  // fallback is gated on the two 'queue unavailable' codes, and returns for all others.
  assert.ok(/emit\.code !== "EMAIL_ENQUEUE_FAILED" && emit\.code !== "SERVER_NOT_CONFIGURED"[\s\S]*return/.test(DL), "returns early on SENT/NO_RECIPIENTS/ROWS_NOT_CLAIMED — no direct send");
  const fallbackIdx = DL.indexOf("SAFE FALLBACK");
  assert.ok(fallbackIdx > -1, "documented fallback");
  const after = DL.slice(fallbackIdx);
  assert.ok(after.includes("sendProjectEmail"), "fallback uses the previous direct sender");
  // The direct send must NOT run on the happy path: it lives after the early return.
  assert.ok(DL.indexOf("emitEventEmail") < fallbackIdx, "unified path attempted before any fallback");
});

test("10.3 download receipt: best-effort — helper never throws, receipt never blocks the download", () => {
  // notifyAdminsOfDownload is awaited/caught by the caller; the helper itself never throws.
  assert.ok(/notifyAdminsOfDownload/.test(DL), "receipt helper present");
  // no bare sendProjectEmail on the primary path (only inside the fallback block).
  const firstSend = DL.indexOf("sendProjectEmail");
  assert.ok(firstSend > DL.indexOf("SAFE FALLBACK"), "the ONLY direct send is inside the fallback");
});

test("10.3 helper contract: emitEventEmail exists and exposes the honest outcome codes", () => {
  const H = R("lib/server/notifyEvent.ts");
  assert.ok(/export async function emitEventEmail/.test(H), "the one dispatch helper is exported");
  assert.ok(/export function logEmitOutcome/.test(H), "outcome logger exported");
});

test("10.3/4 module SQL files: catalog + resolver smoke-test, additive & non-destructive", () => {
  const PROJ = R("docs/global_notifications_projects_batch10_RUNME.sql");
  const CR = R("docs/global_notifications_custody_rental_batch10_RUNME.sql");
  for (const [name, sql] of [["projects", PROJ], ["custody_rental", CR]]) {
    assert.ok(/notification_resolve_recipients/.test(sql), `${name}: exercises the central resolver`);
    assert.ok(/PREFLIGHT: notification_resolve_recipients missing/.test(sql), `${name}: preflight requires the resolver`);
    assert.ok(/SMOKE PASSED/.test(sql), `${name}: has a smoke assertion`);
    assert.ok(!/\bdrop\s+(table|function|index)\b/i.test(sql) && !/\bdelete\s+from\b/i.test(sql) && !/\binsert\s+into\b/i.test(sql), `${name}: no mutation/DROP/INSERT (read-only verify)`);
    assert.ok(/event → entity_type/.test(sql), `${name}: documents the event catalog`);
  }
  // the custody/rental file must document the civ_notify double-path entanglement finding
  assert.ok(/civ_notify/.test(CR) && /nt_enqueue_email/.test(CR), "custody file records the existing civ_notify→email_deliveries path");
});

test("10.3 safety: static only (no DB/network/real email)", () => {
  const self = R("tests/notifications_module_coverage_batch10.test.js");
  const reqs = [...self.matchAll(/require\(["']([^"']+)["']\)/g)].map((m) => m[1]);
  for (const r of reqs) assert.ok(["node:test", "node:assert", "node:fs", "node:path"].includes(r), `static (got ${r})`);
});
