// ════════════════════════════════════════════════════════════════════════════
// tests/email_monitor_honesty_phase1.test.js — P1.3 · GREEN DURING A BLACKOUT
//
// This is the defect that hid the original outage and would have hidden the next.
//
// In the live condition (Apps Script portal_notify handler not deployed) the worker
// classifies every row as relay_handler_missing: status stays 'pending', NO attempt
// is burned, and the run counts it as skipped. So all four health counters read zero
// simultaneously —
//     disabled_pending  filters ('disabled','no_endpoint') only ........... 0
//     dead_letter       required attempts >= 5 ............................ 0
//     retrying          requires attempts > 0 .............................. 0
//     last_run.failed   the worker counts these as skipped, not failed ..... 0
// — and the CASE fell through to `else 'active'`, painting the emerald
// "email channel active" banner while NOTHING was being delivered.
//
// There was also no staleness arm, so a cron that stopped entirely left its last
// heartbeat green forever, and notification_cron_runs.ok was hardcoded true.
//
// Models the SQL's CASE ladder against the real blackout inputs, plus source pins.
// No DB, no network.
// ════════════════════════════════════════════════════════════════════════════
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(root, p), "utf8");

const SQL = R("docs/email_backbone_phase1_monitor_RUNME.sql");
const CRON = R("app/api/cron/notify-email/route.ts");
const MONITOR = R("components/portal/projectcore/NotifyMonitor.tsx");
const TYPES = R("lib/portal/projectCore.ts");

const code = SQL.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

// ─── model of the NEW CASE ladder (mirrors the SQL, in order) ────────────────
function channelState({ relayPending = 0, disabledPending = 0, emailEnabled = true, last = {}, ranAtHoursAgo = 0 }) {
  if (relayPending > 0) return "relay_missing";
  if (disabledPending > 0 || emailEnabled === false) return "disabled";
  if (last === null) return "unknown";
  if (ranAtHoursAgo === null || ranAtHoursAgo > 36) return "stale";
  if ((last.sent ?? 0) === 0 && ((last.failed ?? 0) > 0 || (last.skipped ?? 0) > 0)) return "failing";
  return "active";
}

// ─── (A) the exact live blackout ─────────────────────────────────────────────

test("P1.3 an undeployed relay handler reports relay_missing, not active", () => {
  const state = channelState({
    relayPending: 42,
    disabledPending: 0,          // last_error is 'relay_handler_missing', not 'disabled'
    emailEnabled: true,
    last: { sent: 0, failed: 0, skipped: 42 },   // the worker counts these as skipped
    ranAtHoursAgo: 1,
  });
  assert.equal(state, "relay_missing");
});

test("P1.3 regression: the OLD ladder painted that same blackout green", () => {
  // Reproduces the pre-P1.3 CASE to prove the test above is meaningful.
  const old = ({ disabledPending = 0, emailEnabled = true, last = {} }) => {
    if (disabledPending > 0 || emailEnabled === false) return "disabled";
    if (last === null) return "unknown";
    if ((last.failed ?? 0) > 0 && (last.sent ?? 0) === 0) return "failing";
    return "active";
  };
  assert.equal(
    old({ disabledPending: 0, emailEnabled: true, last: { sent: 0, failed: 0, skipped: 42 } }),
    "active",
    "every counter reads zero during a total blackout, so it fell through to active",
  );
});

// ─── (B) the other silent failures ───────────────────────────────────────────

test("P1.3 a dead cron goes stale instead of staying green forever", () => {
  assert.equal(channelState({ last: { sent: 5, failed: 0 }, ranAtHoursAgo: 100 }), "stale");
  assert.equal(channelState({ last: { sent: 5, failed: 0 }, ranAtHoursAgo: null }), "stale");
  assert.equal(channelState({ last: { sent: 5, failed: 0 }, ranAtHoursAgo: 20 }), "active", "a normal daily gap is fine");
});

test("P1.3 a run that sent nothing but skipped everything is 'failing'", () => {
  // The old ladder required failed > 0. The worker records channel conditions as
  // skipped, so a run that delivered nothing at all looked healthy.
  assert.equal(channelState({ last: { sent: 0, failed: 0, skipped: 30 }, ranAtHoursAgo: 1 }), "failing");
});

test("P1.3 healthy stays healthy — the ladder is not just pessimistic", () => {
  assert.equal(channelState({ last: { sent: 12, failed: 1, skipped: 0 }, ranAtHoursAgo: 2 }), "active");
  assert.equal(channelState({ relayPending: 0, disabledPending: 0, last: { sent: 3 }, ranAtHoursAgo: 0 }), "active");
});

test("P1.3 relay_missing outranks disabled — the more actionable diagnosis wins", () => {
  assert.equal(channelState({ relayPending: 5, disabledPending: 5 }), "relay_missing");
});

// ─── (C) the SQL implements that ladder ──────────────────────────────────────

test("P1.3 SQL counts relay-deferred rows separately", () => {
  assert.match(code, /v_relay_pending[\s\S]{0,200}?last_error\s*=\s*'relay_handler_missing'/i);
  assert.match(code, /'relay_pending',\s*v_relay_pending/i, "and returns it");
});

test("P1.3 SQL has the new arms, ordered before the healthy fallback", () => {
  const caseBlock = code.match(/v_channel\s*:=\s*case([\s\S]*?)end;/i);
  assert.ok(caseBlock, "the CASE ladder must exist");
  const body = caseBlock[1];
  for (const arm of ["relay_missing", "stale", "failing"]) {
    assert.ok(body.includes(`'${arm}'`), `missing arm: ${arm}`);
  }
  assert.ok(
    body.indexOf("'relay_missing'") < body.indexOf("else 'active'"),
    "relay_missing must be evaluated before the healthy fallback",
  );
  assert.ok(body.indexOf("'stale'") < body.indexOf("else 'active'"));
});

test("P1.3 dead_letter is no longer coupled to a TypeScript constant SQL cannot see", () => {
  assert.match(
    code,
    /v_dead\s+from public\.email_deliveries where status = 'failed';/i,
    "the worker is the only writer of 'failed' and writes it only when terminal, " +
      "so status='failed' alone IS the dead-letter set",
  );
  assert.ok(
    !/v_dead[\s\S]{0,120}?attempts\s*>=\s*5/i.test(code),
    "hardcoding 5 meant lowering MAX_ATTEMPTS would silently zero this counter",
  );
});

// ─── (D) the 42725 trap is not reintroduced ──────────────────────────────────

test("P1.3 the function signature is frozen at one argument", () => {
  const defs = code.match(/create or replace function public\.pc_notify_monitor_v2\s*\(([^)]*)\)/gi) ?? [];
  assert.equal(defs.length, 1, "exactly one definition");
  assert.match(defs[0], /p_limit int default 150/i, "signature unchanged");
  assert.ok(!/p_status/i.test(code), "adding a second parameter would create a SECOND function → 42725 on one-arg calls");
});

test("P1.3 the self-check proves only one signature exists", () => {
  assert.match(code, /proname\s*=\s*'pc_notify_monitor_v2'/i);
  assert.match(code, /v_n\s*<>\s*1[\s\S]{0,200}?raise exception/i);
});

test("P1.3 every pre-existing output key is preserved", () => {
  for (const k of ["items", "counts", "by_severity", "by_event", "by_channel", "portal_inbox",
                   "queued_nowhere", "dead_letter", "retrying", "disabled_pending",
                   "channel_state", "last_run", "generated_at"]) {
    assert.ok(new RegExp(`'${k}',`).test(code), `output key '${k}' must not be dropped — the UI reads it`);
  }
});

test("P1.3 is read-only and safe", () => {
  assert.match(code, /stable security definer set search_path = public/i);
  assert.ok(!/\bdrop\s+(function|table|column)\b/i.test(code), "no DROP");
  assert.ok(!/\bdelete\s+from\b|\btruncate\b/i.test(code), "no data change");
});

// ─── (E) the heartbeat stopped lying ─────────────────────────────────────────

test("P1.3 the cron no longer hardcodes a successful heartbeat", () => {
  assert.ok(!/p_ok:\s*true/.test(CRON), "ok was a constant, so a totally failed run still recorded ok=true");
  assert.match(CRON, /p_ok:\s*runOk/, "it must be derived");
  assert.match(CRON, /const\s+runOk\s*=\s*errors\.length === 0/, "any scan error makes the run not-ok");
  assert.match(CRON, /queue\.claimed > 0 && queue\.sent === 0/, "so does claiming rows and delivering none");
});

test("P1.3 the cron reports which scans failed, and only real failures", () => {
  assert.match(CRON, /const errors: string\[\] = \[\]/);
  assert.match(CRON, /p_error:\s*errors\.length > 0/);
  // *_SKIPPED means an optional module is not installed — not an error.
  const skippedBranches = CRON.match(/log\("[A-Z_]+_SKIPPED"/g) ?? [];
  assert.ok(skippedBranches.length > 0, "guarded optional scans must still exist");
  for (const m of CRON.split("\n")) {
    if (/_SKIPPED"/.test(m)) {
      assert.ok(!/errors\.push/.test(m), `a *_SKIPPED branch must not be counted as an error: ${m.trim().slice(0, 70)}`);
    }
  }
});

test("P1.3 the heartbeat's own failure is not counted into its own flag", () => {
  // It runs after runOk is computed, so pushing there would be dead code.
  const tail = CRON.slice(CRON.indexOf("const runOk"));
  assert.ok(!/CRON_HEARTBEAT[\s\S]{0,80}?errors\.push/.test(tail));
});

// ─── (F) the UI surfaces the new states ──────────────────────────────────────

test("P1.3 the monitor renders both new states", () => {
  assert.match(MONITOR, /channel_state === "relay_missing"/);
  assert.match(MONITOR, /channel_state === "stale"/);
});

test("P1.3 the relay banner names the file that fixes it", () => {
  const i = MONITOR.indexOf('channel_state === "relay_missing"');
  const block = MONITOR.slice(i, i + 900);
  assert.match(block, /red-/, "a total blackout must read as red, not amber");
  assert.match(block, /apps_script_portal_notify_HANDLER\.gs/, "an operator must be told exactly what to do");
  assert.match(block, /ولم يضع شيء|Nothing is lost/, "and be reassured the queued mail is not lost");
});

test("P1.3 the payload type admits the new states", () => {
  assert.match(TYPES, /"relay_missing"/);
  assert.match(TYPES, /"stale"/);
  assert.match(TYPES, /relay_pending\?: number/, "optional — absent until the SQL is applied");
});
