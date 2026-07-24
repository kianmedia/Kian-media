// ════════════════════════════════════════════════════════════════════════════
// tests/email_queue_worker_9e.test.js — BATCH 9E — EMAIL QUEUE WORKER OUTAGE
//
// Two layers (no real email, no DB, no network):
//  (A) BEHAVIORAL E2E SIMULATION — a faithful in-test model of processQueue's
//      state machine + interpretRelayResponse, driven end-to-end:
//      event → pending → claim → provider(accepted/rejected/timeout/200-fail) →
//      sent/retrying/dead_letter → delivery log. Proves the CONTRACT.
//  (B) STRUCTURAL PINNING — asserts the REAL TS source implements those exact
//      decisions (query handles NULL next_attempt_at, backlog cutoff, atomic
//      claim, provider confirmation, immediate drain + kick, cron/admin reuse),
//      so the model can't drift from the shipped code.
// ════════════════════════════════════════════════════════════════════════════
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(root, p), "utf8");

const WORKER = R("lib/server/notifyWorker.ts");
const PROJNOTIFY = R("lib/server/projectNotify.ts");
const DRAIN = R("app/api/integrations/notify/drain/route.ts");
const CRON = R("app/api/cron/notify-email/route.ts");
const ADMIN = R("app/api/integrations/project/notify-admin/route.ts");
const NOTIFYEMAIL = R("lib/portal/notifyEmail.ts");
const DELIVERABLES = R("lib/portal/deliverables.ts");
const PROJNOTIFY_ROUTE = R("app/api/integrations/project/notify/route.ts");

// ─────────────────────────────────────────────────────────────────────────────
// (A) FAITHFUL MODEL of the shipped worker logic (mirrors notifyWorker.ts).
// ─────────────────────────────────────────────────────────────────────────────
const MAX_ATTEMPTS = 5;
const STALE_MS = 3600_000;
const HOUR = 3600_000;

// Mirror of interpretRelayResponse (projectNotify.ts) — provider confirmation.
// BATCH 11: an opaque/non-JSON 2xx is NO LONGER treated as delivered. The Apps Script
// answered 200 while silently dropping every portal_notify payload (it emailed only
// _type:"quote"), so "trust the 2xx" marked undelivered mail as sent for months.
// Positive acknowledgment is now required → handlerPresent.
function interpretRelay(text) {
  const t = (text ?? "").trim();
  if (!t) return { rejected: false, handlerPresent: false, reason: "relay_handler_missing" };
  let obj = null;
  try { const p = JSON.parse(t); obj = p && typeof p === "object" ? p : null; } catch { obj = null; }
  if (!obj) return { rejected: false, handlerPresent: false, reason: "relay_handler_missing" };
  const pidRaw = obj.messageId ?? obj.message_id ?? obj.id ?? obj.provider_message_id;
  const providerId = typeof pidRaw === "string" && pidRaw ? pidRaw.slice(0, 120) : undefined;
  const flag = obj.ok ?? obj.success ?? obj.accepted;
  const errStr = typeof obj.error === "string" ? obj.error : (typeof obj.message === "string" && flag === false ? obj.message : "");
  const isPortalHandler = obj.handler === "portal_notify";
  const sentCount = typeof obj.sent === "number" ? obj.sent : undefined;
  if (flag === false || obj.sent === false || (errStr && errStr.length > 0)) {
    return { rejected: true, handlerPresent: isPortalHandler, reason: "provider_rejected", providerId, sentCount };
  }
  if (isPortalHandler) {
    if (sentCount !== undefined && sentCount <= 0) return { rejected: true, handlerPresent: true, reason: "provider_rejected", providerId, sentCount };
    return { rejected: false, handlerPresent: true, providerId, sentCount };
  }
  // A generic {"ok":true} is NOT proof of delivery — the deployed Web App answers
  // {"ok":true,"message":"Kian Media forms API is live"} as a health banner.
  return { rejected: false, handlerPresent: false, reason: "relay_handler_missing", providerId, sentCount };
}
// sendProjectEmail's verdict: rejected OR unacknowledged both mean NOT delivered.
function relayToResult(c) {
  if (c.rejected) return { sent: false, reason: c.reason };
  if (!c.handlerPresent) return { sent: false, reason: "relay_handler_missing" };
  return { sent: true, providerId: c.providerId };
}

// Mock provider: turns a scenario into a sendProjectEmail-shaped result, using
// the SAME interpretRelay contract the real sender uses.
function mockSend(scenario) {
  switch (scenario) {
    case "disabled": return { sent: false, reason: "disabled" };
    case "no_endpoint": return { sent: false, reason: "no_endpoint" };
    case "http_500": return { sent: false, reason: "http_500" };
    case "timeout": return { sent: false, reason: "network_error" };
    case "accepted": return relayToResult(interpretRelay(JSON.stringify({ ok: true, handler: "portal_notify", sent: 1, messageId: "prov-123" })));
    case "http200_failbody": return relayToResult(interpretRelay(JSON.stringify({ ok: false, error: "quota" })));
    // The un-patched Apps Script: HTTP 200 with an opaque body and NO email sent.
    case "opaque_unhandled": return relayToResult(interpretRelay(""));
    default: return { sent: false, reason: "send_failed" };
  }
}

// Faithful model of processQueue (notifyWorker.ts). Mutates the queue in place.
function simulate(queue, sendFor, { now = Date.now(), maxAgeHours = 24, limit = 30 } = {}) {
  const out = { claimed: 0, sent: 0, failed: 0, retrying: 0, dead_letter: 0, skipped: 0, backlog_deferred: 0 };
  const log = [];
  const staleBefore = now - STALE_MS;
  const cutoff = now - maxAgeHours * HOUR;

  // Reaper (lease-based): reclaim only processing rows whose lease deadline passed,
  // plus legacy null-lease rows older than STALE. Measures dwell-in-processing.
  for (const r of queue) {
    if (r.status !== "processing") continue;
    if (r.next_attempt_at != null && r.next_attempt_at < now) { r.status = "pending"; r.next_attempt_at = null; }
    else if (r.next_attempt_at == null && r.created_at < staleBefore) r.status = "pending";
  }

  // Selection: pending, attempts<MAX, due (next_attempt_at null OR <= now), within window.
  const due = queue.filter((r) =>
    r.status === "pending" && r.attempts < MAX_ATTEMPTS &&
    (r.next_attempt_at == null || r.next_attempt_at <= now) &&
    r.created_at >= cutoff)
    .sort((a, b) => a.created_at - b.created_at)
    .slice(0, Math.max(1, Math.min(limit, 100)));

  for (const d of due) {
    // Atomic claim (only if still pending) — stamp a processing lease deadline.
    if (d.status !== "pending") continue;
    d.status = "processing"; d.next_attempt_at = now + STALE_MS; out.claimed++;
    if (!d.recipient_email || !d.recipient_email.includes("@")) {
      d.status = "skipped"; d.last_error = "no_email"; out.skipped++; log.push({ id: d.id, outcome: "email_skipped" }); continue;
    }
    const res = sendFor(d);
    if (res.sent) {
      d.status = "sent"; d.attempts = (d.attempts ?? 0) + 1; d.sent_at = now; d.provider_message_id = res.providerId ?? null; d.last_error = null;
      out.sent++; log.push({ id: d.id, outcome: "email_sent", provider: d.provider_message_id });
    } else if (res.reason === "disabled" || res.reason === "no_endpoint" || res.reason === "relay_handler_missing") {
      // CHANNEL-level: defer, never burn an attempt, never dead-letter, never duplicate.
      d.status = "pending"; d.last_error = res.reason;
      d.next_attempt_at = now + (res.reason === "relay_handler_missing" ? 0.5 : 6) * HOUR;
      out.skipped++; log.push({ id: d.id, outcome: "email_skipped", err: res.reason });
    } else {
      const attempts = (d.attempts ?? 0) + 1;
      const terminal = attempts >= MAX_ATTEMPTS;
      d.attempts = attempts; d.last_error = res.reason ?? "send_failed";
      d.status = terminal ? "failed" : "pending";
      d.next_attempt_at = terminal ? null : now + 5 * Math.pow(2, attempts) * 60_000;
      out.failed++;
      if (terminal) { out.dead_letter++; log.push({ id: d.id, outcome: "email_dead_letter" }); }
      else { out.retrying++; log.push({ id: d.id, outcome: "email_retry_scheduled" }); }
    }
  }
  return { out, log };
}

const row = (over) => ({ id: "r" + Math.random().toString(36).slice(2, 8), status: "pending", attempts: 0, next_attempt_at: null, recipient_email: "a@b.com", created_at: Date.now(), ...over });

// ─── (A) BEHAVIORAL CASES ───
test("1. pending + next_attempt_at NULL is claimed (the incident's brand-new rows)", () => {
  const q = [row({ next_attempt_at: null })];
  const { out } = simulate(q, () => mockSend("accepted"));
  assert.equal(out.claimed, 1); assert.equal(out.sent, 1); assert.equal(q[0].status, "sent");
});
test("2. pending + next_attempt_at in the FUTURE is NOT claimed", () => {
  const now = Date.now();
  const q = [row({ next_attempt_at: now + HOUR, created_at: now })];
  const { out } = simulate(q, () => mockSend("accepted"), { now });
  assert.equal(out.claimed, 0); assert.equal(q[0].status, "pending");
});
test("3. retrying (pending w/ attempts>0) that is DUE is claimed", () => {
  const now = Date.now();
  const q = [row({ attempts: 2, next_attempt_at: now - 60_000, created_at: now })];
  const { out } = simulate(q, () => mockSend("accepted"), { now });
  assert.equal(out.claimed, 1); assert.equal(out.sent, 1);
});
test("4. stale 'processing' (>1h) is reclaimed to pending then processed", () => {
  const now = Date.now();
  const q = [row({ status: "processing", created_at: now - 2 * HOUR })];
  const { out } = simulate(q, () => mockSend("accepted"), { now });
  assert.equal(out.sent, 1); assert.equal(q[0].status, "sent");
});
test("5. atomic claim: a row already processing is not double-sent", () => {
  const now = Date.now();
  // recent processing (not stale) must be skipped by selection.
  const q = [row({ status: "processing", created_at: now - 1000 })];
  const { out } = simulate(q, () => { throw new Error("should not send"); }, { now });
  assert.equal(out.claimed, 0);
});
test("6. attempts increments 0 → 1 on send", () => {
  const q = [row({ attempts: 0 })];
  simulate(q, () => mockSend("accepted"));
  assert.equal(q[0].attempts, 1);
});
test("7. provider accepted (JSON ok:true) → sent + provider id stored", () => {
  const q = [row()];
  const { out } = simulate(q, () => mockSend("accepted"));
  assert.equal(out.sent, 1); assert.equal(q[0].provider_message_id, "prov-123"); assert.equal(q[0].sent_at != null, true);
});
test("8. provider rejected (JSON ok:false) → retrying, NOT sent", () => {
  const q = [row()];
  const { out } = simulate(q, () => mockSend("http200_failbody"));
  assert.equal(out.sent, 0); assert.equal(out.retrying, 1); assert.equal(q[0].status, "pending"); assert.equal(q[0].attempts, 1);
});
test("9. provider timeout → retrying with backoff", () => {
  const now = Date.now();
  const q = [row()];
  const { out } = simulate(q, () => mockSend("timeout"), { now });
  assert.equal(out.retrying, 1); assert.ok(q[0].next_attempt_at > now);
});
test("10. max attempts → dead_letter (terminal 'failed')", () => {
  const q = [row({ attempts: 4 })];  // 4 → 5 = terminal
  const { out } = simulate(q, () => mockSend("http_500"));
  assert.equal(out.dead_letter, 1); assert.equal(q[0].status, "failed"); assert.equal(q[0].attempts, 5); assert.equal(q[0].next_attempt_at, null);
});
test("11. HTTP 200 + failure body is NOT sent (the false-success bug)", () => {
  const res = mockSend("http200_failbody");
  assert.equal(res.sent, false);
  // and interpretRelay confirms the rejection directly:
  assert.equal(interpretRelay(JSON.stringify({ ok: false })).rejected, true);
  assert.equal(interpretRelay(JSON.stringify({ success: false, error: "x" })).rejected, true);
});
test("11b. BATCH 11: opaque/non-JSON 2xx is NOT delivery (un-patched Apps Script)", () => {
  // The regression that hid the outage: these bodies used to be treated as 'sent'.
  for (const body of ["", "<html>ok</html>", "The script completed but did not return anything."]) {
    const c = interpretRelay(body);
    assert.equal(c.handlerPresent, false, `no positive ack for: ${body.slice(0, 20)}`);
    assert.deepEqual(relayToResult(c), { sent: false, reason: "relay_handler_missing" }, "never a false success");
  }
});
test("11c. BATCH 11: the patched handler's ack IS delivery (and 0-sent is not)", () => {
  const okAck = interpretRelay(JSON.stringify({ ok: true, handler: "portal_notify", sent: 2, messageId: "m1" }));
  assert.equal(okAck.handlerPresent, true);
  assert.equal(okAck.sentCount, 2);
  assert.deepEqual(relayToResult(okAck), { sent: true, providerId: "m1" });
  // handler present but it mailed nobody → honest rejection, not success.
  const zero = interpretRelay(JSON.stringify({ ok: false, handler: "portal_notify", sent: 0, error: "no_valid_recipients" }));
  assert.equal(zero.rejected, true);
  assert.equal(relayToResult(zero).sent, false);
  // LIVE-PROBE FACT: the deployed Web App answers {"ok":true,"message":"...forms API is
  // live"} — a health banner. Treating that as delivery is the false success itself.
  assert.equal(relayToResult(interpretRelay(JSON.stringify({ ok: true, message: "Kian Media forms API is live" }))).sent, false);
});
test("12. missing endpoint → kept pending (config gap, not a burned attempt)", () => {
  const q = [row()];
  const { out } = simulate(q, () => mockSend("no_endpoint"));
  assert.equal(out.skipped, 1); assert.equal(q[0].status, "pending"); assert.equal(q[0].attempts, 0);
});
test("13. disabled flag → explicit skipped/pending, attempts not burned", () => {
  const q = [row()];
  const { out } = simulate(q, () => mockSend("disabled"));
  assert.equal(out.skipped, 1); assert.equal(q[0].attempts, 0); assert.equal(q[0].last_error, "disabled");
});
test("14. process-now style bounded batch drains many", () => {
  const q = Array.from({ length: 40 }, () => row());
  const { out } = simulate(q, () => mockSend("accepted"), { limit: 25 });
  assert.equal(out.claimed, 25); assert.equal(out.sent, 25);
});
test("23. OLD backlog (older than window) is NOT auto-claimed", () => {
  const now = Date.now();
  const q = [row({ created_at: now - 48 * HOUR })];  // 48h old, window 24h
  const { out } = simulate(q, () => { throw new Error("must not send old backlog"); }, { now, maxAgeHours: 24 });
  assert.equal(out.claimed, 0); assert.equal(q[0].status, "pending");
});
test("E2E: event → pending → claim → provider accepted → sent → log", () => {
  const q = [row({ id: "approval-1", recipient_email: "owner@kian.com" })];
  const { out, log } = simulate(q, () => mockSend("accepted"));
  assert.equal(out.claimed, 1); assert.equal(out.sent, 1);
  assert.equal(q[0].status, "sent"); assert.equal(q[0].sent_at != null, true);
  assert.deepEqual(log[0], { id: "approval-1", outcome: "email_sent", provider: "prov-123" });
});
test("no duplicate: a sent row is not re-claimed on a second run", () => {
  const q = [row()];
  simulate(q, () => mockSend("accepted"));
  const second = simulate(q, () => { throw new Error("no re-send"); });
  assert.equal(second.out.claimed, 0);
});
test("MAJOR-2: an in-flight (leased) >1h-old row is NOT reclaimed by a concurrent reaper", () => {
  const now = Date.now();
  const q = [row({ status: "processing", created_at: now - 2 * HOUR, next_attempt_at: now + STALE_MS - 1000 })];
  const { out } = simulate(q, () => { throw new Error("must not re-send an in-flight row"); }, { now });
  assert.equal(out.claimed, 0); assert.equal(q[0].status, "processing");
});
test("MAJOR-2: a row whose processing LEASE expired IS reclaimed (crash recovery)", () => {
  const now = Date.now();
  const q = [row({ status: "processing", created_at: now - 3 * HOUR, next_attempt_at: now - 1000 })];
  const { out } = simulate(q, () => mockSend("accepted"), { now });
  assert.equal(out.sent, 1);
});

// ─────────────────────────────────────────────────────────────────────────────
// (B) STRUCTURAL PINNING — the real TS source implements these exact decisions.
// ─────────────────────────────────────────────────────────────────────────────
test("PIN worker: query handles NULL next_attempt_at + backlog cutoff + attempts cap", () => {
  assert.ok(WORKER.includes("next_attempt_at.is.null"), "claims brand-new NULL rows (the incident fix)");
  assert.ok(WORKER.includes("created_at=gte.") && WORKER.includes("cutoffIso"), "backlog cutoff on claim");
  assert.ok(WORKER.includes("attempts=lt.") && WORKER.includes("MAX_ATTEMPTS"), "attempts cap");
});
test("PIN MAJOR-2: reaper leases on next_attempt_at (dwell-in-processing); claim stamps the lease", () => {
  assert.ok(WORKER.includes("leaseIso") && /status: "processing", next_attempt_at: leaseIso/.test(WORKER), "claim stamps a processing lease");
  assert.ok(WORKER.includes("status=eq.processing&next_attempt_at=lt."), "reaper reclaims by lease deadline, not row age");
});
test("PIN MAJOR-3: trace outcomes stay within the delivery-log CHECK vocabulary", () => {
  assert.ok(!/traceRow\([^;]*"email_dead_letter"/.test(WORKER) && !/traceRow\([^;]*"email_retry_scheduled"/.test(WORKER), "no out-of-CHECK outcome literal reaches the log");
  assert.ok(WORKER.includes('"dead_letter"') && WORKER.includes('"retry_scheduled"') && WORKER.includes("lifecycle"), "retry/dead-letter distinction carried in meta.lifecycle");
  assert.ok(/traceRow\(d, "email_failed"/.test(WORKER), "failures logged as the allowed 'email_failed' outcome");
});
test("PIN MAJOR-1: preview route suppresses bridge-enqueued duplicates (9G: one queue source)", () => {
  assert.ok(PROJNOTIFY_ROUTE.includes("notification_id=in."), "targets the bridge rows for the deliverable");
  assert.ok(PROJNOTIFY_ROUTE.includes("idempotency_key=is.null") && PROJNOTIFY_ROUTE.includes("superseded_event_bound"), "keeps event-bound rows, skips the bridge duplicates");
});
test("PIN worker: atomic claim + provider confirmation + provider_message_id + lifecycle log", () => {
  assert.ok(WORKER.includes("id=eq.${d.id}&status=eq.pending") && WORKER.includes('status: "processing"'), "atomic claim pending→processing (guarded on still-pending)");
  assert.ok(WORKER.includes("res.sent") && WORKER.includes("provider_message_id"), "stores provider id on confirmed send");
  assert.ok(WORKER.includes("notification_trace"), "writes email lifecycle to the delivery log");
  assert.ok(WORKER.includes("dead_letter") && WORKER.includes("retrying"), "reports retrying vs dead_letter distinctly");
});
test("PIN sender: reads relay body + follows redirect; not sent on explicit failure", () => {
  assert.ok(PROJNOTIFY.includes("interpretRelayResponse"), "confirmation helper present");
  assert.ok(PROJNOTIFY.includes('redirect: "follow"'), "follows the Apps Script 302 to read the body");
  assert.ok(PROJNOTIFY.includes("await res.text()"), "reads the response body (not bare HTTP 200)");
  assert.ok(PROJNOTIFY.includes("conf.rejected"), "explicit failure body → not sent");
});
test("PIN immediate dispatch (9F server-authoritative): review route + preview route drain in-request", () => {
  assert.ok(DRAIN.includes("processQueue") && DRAIN.includes("authGetUserId"), "admin drain uses the shared worker");
  // 9F: the unreliable browser kick was removed; draining is server-side.
  assert.ok(!NOTIFYEMAIL.includes("export async function notifyDrainKick"), "browser drain-kick helper removed");
  assert.ok(!DELIVERABLES.includes("notifyDrainKick"), "approval no longer relies on a browser kick");
  assert.ok(PROJNOTIFY_ROUTE.includes("processQueue"), "preview route drains queued mail server-side");
});
test("15/16. cron AND admin AND drain all reuse the SAME shared worker", () => {
  for (const [name, src] of [["cron", CRON], ["admin", ADMIN], ["drain", DRAIN]]) {
    assert.ok(src.includes('from "@/lib/server/notifyWorker"'), `${name} imports the shared worker`);
  }
});
test("PIN process-now honesty: pending count + reason when claimed=0 while pending>0", () => {
  assert.ok(ADMIN.includes("pendingBacklog") && ADMIN.includes("reason"), "reports pending + why nothing was claimed");
  assert.ok(ADMIN.includes("email_channel_disabled") && ADMIN.includes("only_old_backlog_pending"), "honest reasons");
});
test("PIN backlog admin: preview (masked) + owner-only expire (no delete, no mass-send)", () => {
  assert.ok(ADMIN.includes("backlog_preview") && ADMIN.includes("mask("), "backlog preview masks recipients");
  assert.ok(ADMIN.includes("expire_backlog") && ADMIN.includes("forbidden_owner_only"), "expire is owner/super-admin only");
  assert.ok(ADMIN.includes('status: "skipped"') && ADMIN.includes("backlog_expired"), "expire marks skipped (never deletes, never sends)");
  assert.ok(!ADMIN.includes("delete from") && !/delete\(/.test(ADMIN), "no deletion of email_deliveries");
});
test("PIN cron: structured drain telemetry (run id, deployment, duration, pending, counts)", () => {
  for (const k of ["cron_run_id", "deployment", "duration_ms", "pending_before"]) assert.ok(CRON.includes(k), `cron logs ${k}`);
});
test("24. no real email + no secrets in this test or the drain path", () => {
  const self = R("tests/email_queue_worker_9e.test.js");
  const reqs = [...self.matchAll(/require\(["']([^"']+)["']\)/g)].map((m) => m[1]);
  for (const r of reqs) assert.ok(["node:test", "node:assert", "node:fs", "node:path"].includes(r), `static only (got ${r})`);
  assert.ok(!/CRON_SECRET|service_role/.test(DRAIN), "drain never references the cron secret / service key literal");
});
