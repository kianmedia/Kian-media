// ════════════════════════════════════════════════════════════════════════════
// tests/email_worker_atleastonce_phase1.test.js — P1.2 · THE IMMORTAL ROW
//
// The defect: `attempts` was written ONLY by the terminal PATCHes at the end of a
// completed send. The claim PATCH did not touch it. So when a send's result PATCH
// never landed — patchAsService reports ok:false on a network throw, a non-2xx, or
// zero rows matched — the row stayed 'processing' with attempts UNCHANGED, while the
// run had already counted out.sent++.
//
// The reaper then returned it to 'pending' without burning anything. The row could
// therefore never reach MAX_ATTEMPTS: it re-sent once per cron run for the entire
// recovery window and then stranded at attempts=0, invisible to every health signal
// (v_dead needs attempts>=5, v_retrying needs attempts>0 — both read zero).
//
// The fix burns the attempt at CLAIM time, which required one non-obvious carve-out:
// a channel condition (disabled / no_endpoint / relay_handler_missing) must HAND THE
// ATTEMPT BACK, or an undeployed Apps Script handler would dead-letter the whole queue
// in MAX_ATTEMPTS runs — destroying exactly the mail the deferral exists to preserve.
//
// These are behavioural model tests (a mock reimplementation of the state machine,
// same approach as tests/email_queue_worker_9e.test.js), plus source pins for the
// parts that cannot be modelled. No DB, no network.
// ════════════════════════════════════════════════════════════════════════════
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(root, p), "utf8");

const WORKER = R("lib/server/notifyWorker.ts");
const PROJNOTIFY = R("lib/server/projectNotify.ts");
const ADMIN = R("app/api/integrations/project/notify-admin/route.ts");
const MONITOR = R("components/portal/projectcore/NotifyMonitor.tsx");

// Strip // comments before any NEGATIVE assertion. A comment explaining the old ">24h"
// literal would otherwise satisfy a search for it and fail a test that is actually green —
// the assertion must look at code, not at prose describing the code.
const stripComments = (s) => s.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
const MONITOR_CODE = stripComments(MONITOR);

const MAX_ATTEMPTS = 5;

// ─── model of the CURRENT (fixed) state machine ───────────────────────────────
// sendResult: {sent:true} | {sent:false, reason} ; patchOk: whether the result PATCH lands
function makeRow() {
  return { status: "pending", attempts: 0, next_attempt_at: null, last_error: null };
}
function claim(row) {
  if (row.status !== "pending") return false;
  row.attempts += 1;              // ← burned at claim
  row.status = "processing";
  row.next_attempt_at = "lease";
  return true;
}
function complete(row, sendResult, patchOk = true) {
  const CHANNEL = ["disabled", "no_endpoint", "relay_handler_missing"];
  if (sendResult.sent) {
    if (!patchOk) return "sent_unconfirmed";   // row stays 'processing' for the reaper
    row.status = "sent";
    return "sent";
  }
  if (CHANNEL.includes(sendResult.reason)) {
    row.attempts -= 1;                          // ← handed back
    row.status = "pending";
    row.last_error = sendResult.reason;
    return "channel_" + sendResult.reason;
  }
  const terminal = row.attempts >= MAX_ATTEMPTS;
  row.status = terminal ? "failed" : "pending";
  row.last_error = sendResult.reason;
  return terminal ? "dead_letter" : "retrying";
}
function reap(row) {
  if (row.status !== "processing") return null;
  const terminal = row.attempts >= MAX_ATTEMPTS;
  row.status = terminal ? "failed" : "pending";
  row.last_error = "reclaimed_stuck_processing";
  return row.status;
}

// ─── (A) the immortal row is dead ─────────────────────────────────────────────

test("P1.2 a row whose result PATCH never lands still terminates", () => {
  const row = makeRow();
  let cycles = 0;
  // every cycle: claim, send succeeds, but the PATCH is lost → reaper reclaims
  while (row.status !== "failed" && cycles < 50) {
    cycles++;
    if (!claim(row)) break;
    complete(row, { sent: true }, /* patchOk */ false);
    reap(row);
  }
  assert.equal(row.status, "failed", "it must reach the dead-letter state");
  assert.ok(cycles <= MAX_ATTEMPTS, `should terminate within ${MAX_ATTEMPTS} cycles, took ${cycles}`);
});

test("P1.2 regression: with completion-time counting it looped forever", () => {
  // Reproduces the OLD behaviour to prove the test above is meaningful.
  const row = makeRow();
  const claimOld = (r) => { if (r.status !== "pending") return false; r.status = "processing"; return true; };
  let cycles = 0;
  while (row.status !== "failed" && cycles < 50) {
    cycles++;
    if (!claimOld(row)) break;
    /* lost PATCH: attempts never written */
    row.status = "pending";   // old bulk reaper: back to pending, nothing burned
  }
  assert.equal(row.attempts, 0, "the old path never burned an attempt");
  assert.notEqual(row.status, "failed", "and therefore never dead-lettered");
});

test("P1.2 a repeatedly failing send dead-letters in exactly MAX_ATTEMPTS claims", () => {
  const row = makeRow();
  const outcomes = [];
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    assert.ok(claim(row), `claim ${i + 1} should succeed`);
    outcomes.push(complete(row, { sent: false, reason: "network_error" }));
  }
  assert.equal(row.attempts, MAX_ATTEMPTS);
  assert.equal(row.status, "failed");
  assert.equal(outcomes.filter((o) => o === "retrying").length, MAX_ATTEMPTS - 1);
  assert.equal(outcomes[outcomes.length - 1], "dead_letter");
});

// ─── (B) the carve-out that makes claim-time counting safe ────────────────────

test("P1.2 CRITICAL: a missing Apps Script handler never burns attempts", () => {
  const row = makeRow();
  // Simulate a year of daily cron runs against an undeployed handler.
  for (let i = 0; i < 365; i++) {
    assert.ok(claim(row), "the row must stay claimable");
    const outcome = complete(row, { sent: false, reason: "relay_handler_missing" });
    assert.equal(outcome, "channel_relay_handler_missing");
  }
  assert.equal(row.attempts, 0, "not one attempt may be consumed by a channel outage");
  assert.equal(row.status, "pending", "and the mail must still be deliverable");
});

for (const reason of ["disabled", "no_endpoint"]) {
  test(`P1.2 channel condition '${reason}' also hands the attempt back`, () => {
    const row = makeRow();
    claim(row);
    complete(row, { sent: false, reason });
    assert.equal(row.attempts, 0);
    assert.equal(row.status, "pending");
  });
}

test("P1.2 a channel outage does not mask a genuine failure that follows", () => {
  const row = makeRow();
  claim(row); complete(row, { sent: false, reason: "relay_handler_missing" });
  assert.equal(row.attempts, 0);
  claim(row); complete(row, { sent: false, reason: "http_500" });
  assert.equal(row.attempts, 1, "the real failure still counts");
});

// ─── (C) honest reporting ─────────────────────────────────────────────────────

test("P1.2 a send whose PATCH failed is not reported as sent", () => {
  const row = makeRow();
  claim(row);
  const outcome = complete(row, { sent: true }, false);
  assert.equal(outcome, "sent_unconfirmed");
  assert.equal(row.status, "processing", "it stays claimed so the reaper owns it");
});

test("P1.2 source: out.sent++ is gated on the PATCH result", () => {
  assert.match(
    WORKER,
    /const\s+done\s*=\s*await\s+patchAsService[\s\S]{0,1200}?if\s*\(\s*!done\.ok\s*\)[\s\S]{0,300}?return\s+"sent_unconfirmed"/,
    "the success PATCH result must be checked before counting a send",
  );
});

// ─── (D) reaper reaches both paths ────────────────────────────────────────────

test("P1.2 the exact-ID branch reclaims its own rows before reading them", () => {
  const exactBranch = WORKER.indexOf("if (opts.deliveryIds");
  const scopedReap = WORKER.indexOf("await reapStuck(nowMs, ids)");
  const selectRows = WORKER.indexOf("email_deliveries?select=${SELECT_COLS}&id=in.", exactBranch);
  assert.ok(exactBranch > 0 && scopedReap > exactBranch, "reclamation must happen inside the event-bound branch");
  assert.ok(
    scopedReap < selectRows,
    "it must run BEFORE the rows are read, or a reclaimed row is still seen as 'processing' " +
      "and reported claim_conflict — which is the bug being fixed",
  );
});

test("P1.2 the event-bound path never pays for an unrelated global backlog", () => {
  // An unscoped sweep here could issue up to 200 sequential PATCHes inside a client's
  // approve/revision request. Scoping keeps that request proportional to its own event.
  assert.match(WORKER, /await reapStuck\(nowMs, ids\)/, "event-bound reclamation must be scoped to the event's rows");
  assert.match(
    WORKER,
    /async function reapStuck\(nowMs: number, ids\?: string\[\]\)/,
    "reapStuck must accept an id scope",
  );
  assert.match(WORKER, /const scope = ids && ids\.length > 0 \? `&id=in\./, "and apply it to the query");
});

test("P1.2 the cron still does the full unscoped sweep", () => {
  const generic = WORKER.indexOf("─── GENERIC SCAN");
  assert.ok(generic > 0, "the generic scan must exist");
  const after = WORKER.slice(generic, generic + 600);
  assert.match(after, /await reapStuck\(nowMs\)\s*;/, "the cron path reclaims globally — that is where a backlog belongs");
});

test("P1.2 the reaper can terminate, not only re-queue", () => {
  const fn = WORKER.match(/async function reapStuck[\s\S]*?\n}/);
  assert.ok(fn, "reapStuck must exist");
  assert.match(fn[0], /attempts\s*>=\s*MAX_ATTEMPTS/, "it must classify against the cap");
  assert.match(fn[0], /terminal\s*\?\s*"failed"\s*:\s*"pending"/, "and be able to dead-letter");
  assert.match(fn[0], /limit=200/, "bounded");
  assert.match(fn[0], /catch\s*\{/, "best-effort — reclamation must never break the drain");
});

test("P1.2 the old unbounded bulk reaper is gone", () => {
  assert.ok(
    !/status=eq\.processing&next_attempt_at=lt\.\$\{encodeURIComponent\(nowIso\)\}/.test(WORKER),
    "the bulk PATCH that could only ever set rows back to pending must be removed",
  );
});

// ─── (E) hard timeout ─────────────────────────────────────────────────────────

test("P1.2 each relay call has a hard ceiling", () => {
  assert.match(PROJNOTIFY, /signal:\s*AbortSignal\.timeout\(\s*\d+/, "one hung redirect must not consume the function budget");
  assert.match(PROJNOTIFY, /reason:\s*"network_error"/, "a timeout must map to a normal burnable attempt");
});

// ─── (F) one horizon, honestly quoted ─────────────────────────────────────────

test("P1.2 the expire action uses the cron's horizon, not its own", () => {
  assert.match(WORKER, /export\s+const\s+RECOVERY_WINDOW_HOURS\s*=\s*168/);
  assert.match(ADMIN, /RECOVERY_WINDOW_HOURS/, "the admin route must import it");
  assert.match(ADMIN, /const\s+EXPIRE_AFTER_HOURS\s*=\s*RECOVERY_WINDOW_HOURS/);
  assert.match(
    ADMIN,
    /cutoffIso\s*=\s*new\s+Date\(\s*Date\.now\(\)\s*-\s*EXPIRE_AFTER_HOURS/,
    "expiring at 24h discarded six days of mail the cron would still have delivered",
  );
});

test("P1.2 the cron does not shadow the shared constant with a local copy", () => {
  const cron = R("app/api/cron/notify-email/route.ts");
  assert.ok(
    !/const\s+RECOVERY_WINDOW_HOURS\s*=/.test(cron),
    "a local redefinition would silently diverge from the admin route's horizon",
  );
  assert.match(cron, /import\s*\{[^}]*RECOVERY_WINDOW_HOURS[^}]*\}\s*from\s*"@\/lib\/server\/notifyWorker"/);
});

test("P1.2 the confirm dialog quotes the horizon that actually applies", () => {
  assert.match(ADMIN, /expire_after_hours:\s*EXPIRE_AFTER_HOURS/, "the server must expose it");
  assert.match(MONITOR_CODE, /expire_after_hours/, "and the dialog must read that field");
  assert.ok(
    !/أقدم من 24 ساعة|>24h/.test(MONITOR_CODE),
    "the dialog must not promise a 24h cut while the action uses a different window",
  );
});

// ─── (J) P1.5 · event attribution in the trace ──────────────────────────────

test("P1.5 correlation_id is actually selected, not inferred from a column nobody writes", () => {
  assert.match(WORKER, /SELECT_COLS = `[^`]*correlation_id[^`]*`/, "it must be read from the row");
  assert.match(
    WORKER,
    /correlation_id:\s*d\.correlation_id\s*\?\?\s*d\.event_id/,
    "the canonical Batch-10 emitter never writes event_id, so the old fallback was always " +
      "undefined and notification_trace stamped a fresh uuid on every email leg",
  );
});

test("P1.5 the event name is recovered from the idempotency key", () => {
  assert.match(WORKER, /SELECT_COLS = `[^`]*idempotency_key[^`]*`/);
  assert.match(WORKER, /const eventFromKey/);
  assert.match(
    WORKER,
    /event_type:\s*d\.notification_events\?\.event_type\s*\?\?\s*eventFromKey\(d\.idempotency_key\)/,
    "every queued row carries the event in its key; attributing them all to 'email_delivery' discarded it",
  );
});
