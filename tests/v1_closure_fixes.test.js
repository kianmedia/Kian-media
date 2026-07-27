// ════════════════════════════════════════════════════════════════════════════
// tests/v1_closure_fixes.test.js — V1 CLOSURE: the verified silent-loss fixes
//
// All three were confirmed against the real system before being fixed:
//  1. QUEUE AGEING — processQueue's backlog cutoff is 24h (notifyWorker.ts:26) while the
//     notify-email cron runs ONCE A DAY (vercel.json "10 3 * * *") and was called with no
//     options. A row queued shortly before a run — and everything queued during a run that
//     is delayed, skipped or failing — was already older than the cutoff at the next run
//     and could never be claimed again. Silent, permanent loss.
//  2. DELIVERABLE EVENTS — "send to client" and "mark final" emitted the notification only
//     from the legacy AdminDeliverables screen. Doing the same thing from the MAIN
//     project-core workspace produced no email at all.
//  3. is_client_owner was still EXECUTE-able by anon (probe: returns null) while every peer
//     closure helper returns 42501.
// Plus the closure-integrity items: mandatory closure reason, 'rejected' vocabulary, and
// server-side gating of the financial readiness block.
//
// Static only — no DB, no network.
// ════════════════════════════════════════════════════════════════════════════
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(root, p), "utf8");

const CRON = R("app/api/cron/notify-email/route.ts");
const WORKER = R("lib/server/notifyWorker.ts");
const VERCEL = JSON.parse(R("vercel.json"));
const MODULES = R("components/portal/projectcore/ProjectModules.tsx");
const ADMINDLV = R("components/portal/AdminDeliverables.tsx");
const CLOSURE = R("docs/project_closure_integrity_RUNME.sql");

// ─── 1. queue ageing ───
test("Q1: the defect is real — the recovery window was narrower than the cron interval", () => {
  const cutoffHours = Number(/DEFAULT_MAX_AGE_HOURS = (\d+)/.exec(WORKER)?.[1]);
  assert.equal(cutoffHours, 24, "worker default cutoff");
  const cron = VERCEL.crons.find((c) => c.path.includes("notify-email"));
  assert.ok(cron, "the notify-email cron exists");
  const daily = /^\d+ \d+ \* \* \*$/.test(cron.schedule);
  assert.ok(daily, "it runs once a day");
  // a 24h lookback with a 24h interval leaves rows that fall in the gap unrecoverable
  const intervalHours = 24;
  assert.ok(cutoffHours <= intervalHours, "cutoff <= interval ⇒ rows can age out between runs");
});

test("Q2: the cron now looks back further than its own interval", () => {
  // Phase 1 moved this constant into notifyWorker.ts and exported it, so the admin
  // "expire old backlog" control discards on the SAME horizon (it previously used its
  // own 24h and destroyed six days of deliverable mail). The cron imports it rather
  // than declaring a local copy that could silently diverge.
  const win = Number(/export const RECOVERY_WINDOW_HOURS = (\d+)/.exec(WORKER)?.[1]);
  assert.equal(win, 168, "7-day recovery window");
  assert.ok(
    /import\s*\{[^}]*RECOVERY_WINDOW_HOURS[^}]*\}\s*from\s*"@\/lib\/server\/notifyWorker"/.test(CRON),
    "the cron must import the shared constant",
  );
  assert.ok(!/const\s+RECOVERY_WINDOW_HOURS\s*=/.test(CRON), "and must not shadow it locally");
  assert.ok(win > 24, "strictly wider than the daily interval — nothing can slip through");
  assert.ok(/processQueue\(30, \{ maxAgeHours: RECOVERY_WINDOW_HOURS \}\)/.test(CRON), "passed to the worker");
  assert.ok(/pendingBacklog\(RECOVERY_WINDOW_HOURS\)/.test(CRON), "telemetry measures the same window");
});

test("Q3: a bounded cutoff is retained — no unbounded blast of ancient mail", () => {
  assert.ok(!/maxAgeHours: *0|maxAgeHours: *null/.test(CRON), "the cutoff is not disabled");
  assert.ok(/expire old backlog|deliberate/i.test(CRON), "retiring stale rows stays an explicit admin action");
});

// ─── 2. deliverable events from the main workspace ───
test("D1: the main workspace now emits both client-facing deliverable events", () => {
  assert.ok(/import \{ emitProjectDeliverableEvent \} from "@\/lib\/portal\/notifyEmail"/.test(MODULES), "same helper imported");
  assert.ok(/action === "send_client"[\s\S]{0,120}deliverable\.preview_sent/.test(MODULES), "preview_sent on send_client");
  assert.ok(/action === "final"[\s\S]{0,120}deliverable\.final_ready/.test(MODULES), "final_ready on final");
});

test("D2: it reuses the proven producer — no second notification path is introduced", () => {
  assert.ok(/emitProjectDeliverableEvent/.test(ADMINDLV), "the legacy screen used the same helper");
  assert.ok(!/fetch\(["'`]\/api\/integrations\/project\/notify/.test(MODULES), "no hand-rolled call");
  assert.ok(!/sendProjectEmail|notify_emit_event/.test(MODULES), "no direct sender or RPC in the component");
});

test("D3: the emit happens AFTER the action succeeded and cannot undo it", () => {
  const i = MODULES.indexOf('action === "send_client"');
  const before = MODULES.slice(Math.max(0, i - 900), i);
  assert.ok(/if \(!r\.ok\) \{ flash\(pcErr\(r\.error\)\); return; \}/.test(before), "guarded by the success check");
  assert.ok(/void emitProjectDeliverableEvent/.test(MODULES), "fire-and-forget — never awaited into the action's result");
});

// ─── 3. closure integrity SQL ───
test("C1: the stray anon grant on is_client_owner is closed, authenticated preserved", () => {
  assert.ok(/revoke all on function public\.is_client_owner\(uuid\) from public/.test(CLOSURE));
  assert.ok(/grant execute on function public\.is_client_owner\(uuid\) to authenticated/.test(CLOSURE));
  assert.ok(/regression — authenticated lost is_client_owner/.test(CLOSURE), "self-test guards the regression");
});

test("C2: a closure can no longer be recorded without a human-authored reason", () => {
  assert.ok(/trg_pcl_require_closure_reason/.test(CLOSURE), "trigger installed");
  assert.ok(/raise exception 'reason_required'/.test(CLOSURE));
  assert.ok(/new\.closure_reason\s*:=/.test(CLOSURE), "the previously-dead closure_reason column is now populated");
  assert.ok(/tg_op = 'UPDATE' and new\.status = 'closed'/.test(CLOSURE), "the close transition is covered too");
});

test("C3: 'rejected' counts as closed, so a rejected issue stops blocking closure forever", () => {
  assert.ok(/not in \('closed', 'resolved', 'rejected'\)/.test(CLOSURE), "unified vocabulary");
  assert.ok(/critical_issues/.test(CLOSURE), "applied to the readiness item that was blocking");
});

test("C4: the financial readiness block is gated server-side, not just hidden in the UI", () => {
  assert.ok(/closure_can\(p_project, 'closure\.view_financial_clearance'\)/.test(CLOSURE));
  assert.ok(/'available', false, 'reason', 'no_permission'/.test(CLOSURE), "degrades like the report already does");
});

test("C5: the original readiness function is preserved, not replaced", () => {
  assert.ok(!/create or replace function public\.project_closure_readiness\(uuid\)/.test(CLOSURE),
    "5C's long function is NOT rewritten — its guards cannot be accidentally dropped");
  assert.ok(/project_closure_readiness_v2/.test(CLOSURE), "a companion wrapper is added instead");
  assert.ok(/the original readiness function was lost/.test(CLOSURE), "self-test asserts the original survives");
});

test("C6: additive, idempotent, self-tested, with verification and rollback", () => {
  const code = CLOSURE.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  assert.ok(!/\bdrop\s+table\b/i.test(code) && !/\bdelete\s+from\b/i.test(code), "no destruction");
  assert.ok(/create or replace function/.test(code) && /drop trigger if exists/.test(code), "re-runnable");
  assert.ok(/CLOSURE FAIL/.test(CLOSURE) && /CLOSURE SELF-TEST PASSED/.test(CLOSURE));
  assert.ok(/VERIFICATION/.test(CLOSURE) && /ROLLBACK/.test(CLOSURE));
});

test("SAFE: static only (no DB/network)", () => {
  const self = R("tests/v1_closure_fixes.test.js");
  const reqs = [...self.matchAll(/require\(["']([^"']+)["']\)/g)].map((m) => m[1]);
  for (const r of reqs) assert.ok(["node:test", "node:assert", "node:fs", "node:path"].includes(r), `static (got ${r})`);
});
