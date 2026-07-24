// ════════════════════════════════════════════════════════════════════════════
// tests/review_decouple_phase0_batch10.test.js — BATCH 10 · PHASE 0 (HARD GATE)
//
// Proves the client decision is COMPLETELY independent of notification delivery:
//   • the decision is saved in its OWN step (STEP A) before any email work;
//   • notifications are best-effort (STEP B) and can fail every possible way
//     WITHOUT rolling back, changing action_saved, or returning 5xx;
//   • HTTP is 200 whenever the decision saved; 4xx/5xx ONLY when the decision
//     itself failed;
//   • the client is never shown "تعذر تسجيل قرارك" for an email problem.
//
// (A) a faithful simulation of route.ts's STEP-A/STEP-B control flow;
// (B) structural pins on the SQL (enqueue-only, no mutation, service-only,
//     ON CONFLICT partial-index inference) + route + browser + UI invariants.
// No DB, no network, no real email.
// ════════════════════════════════════════════════════════════════════════════
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(root, p), "utf8");

// ─────────────────────────────────────────────────────────────────────────────
// (A) FAITHFUL ROUTE SIMULATION — mirrors app/api/integrations/project/review/route.ts
// A shared mutable `store` records what actually persisted so we can assert the
// decision is NEVER rolled back by a notification failure.
// ─────────────────────────────────────────────────────────────────────────────
function runReview(input, deps) {
  const { versionId, decision, bearer } = input;
  const store = deps.store; // { decision: <persisted decision or null> }

  // guards (identical order to the route)
  if (!bearer) return { status: 401, body: { ok: false, action_saved: false, error: "unauthorized" } };
  if (!versionId) return { status: 400, body: { ok: false, action_saved: false, error: "missing_version" } };
  if (decision !== "approved" && decision !== "revision_requested")
    return { status: 400, body: { ok: false, action_saved: false, error: "bad_decision" } };

  // ── STEP A: SAVE THE DECISION (own committed step; authz lives in the RPC) ──
  const save = deps.clientReviewVersion(input); // AdminResult<boolean>
  if (!save.ok) {
    const err = String(save.error ?? "review_failed");
    const denied = /not authorized|not_found|not_current|not_in_review|bad_decision|reason_required/i.test(err);
    return { status: denied ? 403 : 500, body: { ok: false, action_saved: false, error: err } };
  }
  store.decision = decision; // committed — nothing below may undo this

  // ── STEP B: NOTIFICATIONS — best-effort, fully isolated ──
  const notification = { ok: false, code: "EMAIL_NOT_ATTEMPTED", correlation_id: null, expected: 0, queued: 0, claimed: 0, sent: 0 };
  try {
    if (!deps.adminConfigured) {
      notification.code = "SERVER_NOT_CONFIGURED";
    } else {
      const enq = deps.enqueue(input); // AdminResult<EnqueueResult>
      if (!enq.ok || !enq.data || enq.data.ok === false) {
        notification.code = "EMAIL_ENQUEUE_FAILED";
        notification.error = String(enq.error ?? (enq.ok && enq.data ? enq.data.error : undefined) ?? "enqueue_failed");
      } else {
        const deliveryIds = Array.isArray(enq.data.delivery_ids) ? enq.data.delivery_ids : [];
        notification.correlation_id = enq.data.correlation_id ?? null;
        notification.expected = typeof enq.data.expected_recipients === "number" ? enq.data.expected_recipients : deliveryIds.length;
        notification.queued = Array.isArray(enq.data.new_ids) ? enq.data.new_ids.length : 0;
        const processed = deliveryIds.length > 0 ? deps.processQueue(deliveryIds) : { claimed: 0, sent: 0, perId: {} };
        const alreadySent = Object.values(processed.perId ?? {}).filter((o) => o === "already_sent").length;
        const anySent = processed.sent > 0 || alreadySent > 0;
        notification.claimed = processed.claimed;
        notification.sent = processed.sent;
        notification.ok = notification.expected === 0 || anySent;
        notification.code = notification.expected === 0 ? "NO_RECIPIENTS" : anySent ? "SENT" : "EMAIL_ROWS_NOT_CLAIMED";
      }
    }
  } catch (e) {
    notification.code = "EMAIL_ENQUEUE_FAILED";
    notification.error = String(e);
  }

  // ALWAYS 200 when the decision was saved.
  return { status: 200, body: { ok: true, action_saved: true, decision, notification } };
}

const ok = (data) => ({ ok: true, data });
const okBool = () => ({ ok: true, data: true });
const err = (error, status) => ({ ok: false, error, status: status ?? 500 });
const baseEnq = (over = {}) => ok({ ok: true, correlation_id: "corr-1", expected_recipients: 2, new_ids: ["d1", "d2"], delivery_ids: ["d1", "d2"], ...over });

// default happy dependencies
function deps(over = {}) {
  return {
    store: { decision: null },
    adminConfigured: true,
    clientReviewVersion: okBool,
    enqueue: () => baseEnq(),
    processQueue: () => ({ claimed: 2, sent: 2, perId: { d1: "sent", d2: "sent" } }),
    ...over,
  };
}
const approve = { versionId: "v1", decision: "approved", bearer: "b" };
const revise = { versionId: "v1", decision: "revision_requested", bearer: "b" };

// ── the golden path: decision saved + email sent ──
test("10.0 approve: decision saved AND email sent → 200, action_saved, code SENT", () => {
  const d = deps();
  const r = runReview(approve, d);
  assert.equal(r.status, 200);
  assert.equal(r.body.action_saved, true);
  assert.equal(r.body.decision, "approved");
  assert.equal(r.body.notification.code, "SENT");
  assert.equal(r.body.notification.sent, 2);
  assert.equal(d.store.decision, "approved");
});

test("10.0 revision_requested: same decoupled success shape", () => {
  const d = deps();
  const r = runReview(revise, d);
  assert.equal(r.status, 200);
  assert.equal(r.body.action_saved, true);
  assert.equal(r.body.decision, "revision_requested");
  assert.equal(d.store.decision, "revision_requested");
});

// ── the WHOLE point of Phase 0: email fails every way, decision still stands ──
test("10.0 enqueue RPC missing/42P10 → decision STILL saved, 200, EMAIL_ENQUEUE_FAILED, NO rollback", () => {
  const d = deps({ enqueue: () => err("PGRST202: review_enqueue_notifications not found") });
  const r = runReview(approve, d);
  assert.equal(r.status, 200, "never 5xx once the decision saved");
  assert.equal(r.body.action_saved, true);
  assert.equal(r.body.notification.code, "EMAIL_ENQUEUE_FAILED");
  assert.equal(d.store.decision, "approved", "decision was NOT rolled back by the enqueue failure");
});

test("10.0 enqueue returns ok:false (not_found deliverable) → 200, EMAIL_ENQUEUE_FAILED, decision saved", () => {
  const d = deps({ enqueue: () => ok({ ok: false, error: "not_found" }) });
  const r = runReview(approve, d);
  assert.equal(r.status, 200);
  assert.equal(r.body.action_saved, true);
  assert.equal(r.body.notification.code, "EMAIL_ENQUEUE_FAILED");
  assert.equal(d.store.decision, "approved");
});

test("10.0 enqueue throws → caught, 200, EMAIL_ENQUEUE_FAILED, decision saved", () => {
  const d = deps({ enqueue: () => { throw new Error("boom"); } });
  const r = runReview(approve, d);
  assert.equal(r.status, 200);
  assert.equal(r.body.action_saved, true);
  assert.equal(r.body.notification.code, "EMAIL_ENQUEUE_FAILED");
  assert.equal(d.store.decision, "approved");
});

test("10.0 provider rejects (claimed>0, sent=0) → 200, EMAIL_ROWS_NOT_CLAIMED, decision saved", () => {
  const d = deps({ processQueue: () => ({ claimed: 2, sent: 0, perId: { d1: "retrying", d2: "retrying" } }) });
  const r = runReview(approve, d);
  assert.equal(r.status, 200);
  assert.equal(r.body.action_saved, true);
  assert.equal(r.body.notification.code, "EMAIL_ROWS_NOT_CLAIMED");
  assert.equal(r.body.notification.ok, false, "not a false success");
  assert.equal(d.store.decision, "approved");
});

test("10.0 rows not claimed (claimed=0) → 200, EMAIL_ROWS_NOT_CLAIMED, decision saved", () => {
  const d = deps({ processQueue: () => ({ claimed: 0, sent: 0, perId: {} }) });
  const r = runReview(approve, d);
  assert.equal(r.status, 200);
  assert.equal(r.body.notification.code, "EMAIL_ROWS_NOT_CLAIMED");
  assert.equal(d.store.decision, "approved");
});

test("10.0 already_sent (idempotent re-review) counts as sent → SENT, no duplicate", () => {
  const d = deps({
    enqueue: () => baseEnq({ new_ids: [] }), // conflict → nothing newly inserted
    processQueue: () => ({ claimed: 0, sent: 0, perId: { d1: "already_sent", d2: "already_sent" } }),
  });
  const r = runReview(approve, d);
  assert.equal(r.status, 200);
  assert.equal(r.body.notification.code, "SENT", "already-sent rows are a success, not a re-blast");
  assert.equal(r.body.notification.queued, 0, "no new rows queued on a repeat decision");
});

test("10.0 no recipients (expected=0) → 200, NO_RECIPIENTS, notification.ok true, decision saved", () => {
  const d = deps({ enqueue: () => baseEnq({ expected_recipients: 0, new_ids: [], delivery_ids: [] }) });
  const r = runReview(approve, d);
  assert.equal(r.status, 200);
  assert.equal(r.body.notification.code, "NO_RECIPIENTS");
  assert.equal(r.body.notification.ok, true);
  assert.equal(d.store.decision, "approved");
});

test("10.0 admin not configured → 200, SERVER_NOT_CONFIGURED, decision saved, no enqueue attempted", () => {
  let enqueued = false;
  const d = deps({ adminConfigured: false, enqueue: () => { enqueued = true; return baseEnq(); } });
  const r = runReview(approve, d);
  assert.equal(r.status, 200);
  assert.equal(r.body.action_saved, true);
  assert.equal(r.body.notification.code, "SERVER_NOT_CONFIGURED");
  assert.equal(enqueued, false);
  assert.equal(d.store.decision, "approved");
});

// ── the ONLY failures are decision failures ──
test("10.0 client not authorized for version → 403, action_saved false, NO email attempt", () => {
  let enqueued = false;
  const d = deps({ clientReviewVersion: () => err("not authorized", 403), enqueue: () => { enqueued = true; return baseEnq(); } });
  const r = runReview(approve, d);
  assert.equal(r.status, 403);
  assert.equal(r.body.action_saved, false);
  assert.equal(r.body.ok, false);
  assert.equal(enqueued, false, "no notification work when the decision itself failed");
  assert.equal(d.store.decision, null, "nothing persisted");
});

test("10.0 version not in review / not current → 403 (guarded decision failure)", () => {
  for (const e of ["not_in_review", "not_current", "reason_required"]) {
    const r = runReview(approve, deps({ clientReviewVersion: () => err(e, 400) }));
    assert.equal(r.status, 403, e);
    assert.equal(r.body.action_saved, false, e);
  }
});

test("10.0 unexpected DB error saving decision → 500, action_saved false", () => {
  const r = runReview(approve, deps({ clientReviewVersion: () => err("deadlock detected", 500) }));
  assert.equal(r.status, 500);
  assert.equal(r.body.action_saved, false);
});

test("10.0 bad inputs are 4xx BEFORE any save/enqueue", () => {
  assert.equal(runReview({ ...approve, bearer: "" }, deps()).status, 401);
  assert.equal(runReview({ ...approve, versionId: "" }, deps()).status, 400);
  assert.equal(runReview({ ...approve, decision: "maybe" }, deps()).status, 400);
});

test("10.0 INVARIANT: for every notification outcome, a saved decision NEVER yields <200 or ≥300, and is never rolled back", () => {
  const notifCases = [
    () => baseEnq(),
    () => err("rpc missing"),
    () => ok({ ok: false, error: "not_found" }),
    () => { throw new Error("x"); },
    () => baseEnq({ expected_recipients: 0, new_ids: [], delivery_ids: [] }),
  ];
  const procCases = [
    () => ({ claimed: 2, sent: 2, perId: { d1: "sent", d2: "sent" } }),
    () => ({ claimed: 2, sent: 0, perId: {} }),
    () => ({ claimed: 0, sent: 0, perId: {} }),
  ];
  for (const enqueue of notifCases) for (const processQueue of procCases) {
    const d = deps({ enqueue, processQueue });
    const r = runReview(approve, d);
    assert.equal(r.status, 200, "saved decision ⇒ HTTP 200");
    assert.equal(r.body.action_saved, true);
    assert.equal(d.store.decision, "approved", "decision persisted regardless of notification path");
    assert.notEqual(r.body.notification.code, "EMAIL_NOT_ATTEMPTED", "an outcome code is always set");
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// (B) STRUCTURAL PINS — SQL / route / browser / UI invariants
// ─────────────────────────────────────────────────────────────────────────────
const SQL = R("docs/project_review_decouple_batch10_RUNME.sql");
const REVIEW = R("app/api/integrations/project/review/route.ts");
const DELIVERABLES = R("lib/portal/deliverables.ts");
const VERSIONS = R("components/portal/VersionHistory.tsx");

test("10.0 SQL: review_enqueue_notifications is ENQUEUE-ONLY (no client_review_version, no version mutation)", () => {
  const fn = SQL.slice(SQL.indexOf("function public.review_enqueue_notifications"));
  const body = fn.slice(0, fn.indexOf("$$;") + 3);
  assert.ok(!/client_review_version/.test(body), "does not save the decision (route already did)");
  assert.ok(!/update\s+public\.deliverable_versions/i.test(body), "does not mutate the version status");
  assert.ok(/nt_event_enqueue_internal/.test(body), "delegates to the shared enqueue helper");
  assert.ok(/'ok',\s*true/.test(body), "returns a structured ok result");
});

test("10.0 SQL: ON CONFLICT restates the partial-index predicate (42P10 guard) + service-only grants", () => {
  assert.ok(/on conflict \(idempotency_key\) where idempotency_key is not null do nothing/.test(SQL), "partial-index predicate restated");
  assert.ok(/create unique index if not exists uq_edel_idem[\s\S]*where idempotency_key is not null/.test(SQL), "partial unique index present");
  assert.ok(/revoke all on function public\.review_enqueue_notifications/.test(SQL), "enqueue RPC revoked from client roles");
  assert.ok(/grant execute on function public\.review_enqueue_notifications\(uuid,text,uuid\) to service_role/.test(SQL), "service_role keeps EXECUTE (the route calls it with the service key)");
  assert.ok(/service_role must keep EXECUTE/.test(SQL), "self-test asserts the service_role grant survived");
  assert.ok(/service-only|service-داخليّ|خدمة-داخليّ/.test(SQL), "documented service-internal");
});

test("10.0 SQL: self-test PROBES on-conflict and rolls it back (catches 42P10)", () => {
  assert.ok(/42P10/.test(SQL), "self-test detects the partial-index inference failure");
  assert.ok(/ROLLBACK_10_PROBE/.test(SQL), "probe is rolled back — no residual rows");
});

test("10.0 SQL: additive only — no destructive statements", () => {
  assert.ok(!/\bdrop\s+(table|function|index|column)\b/i.test(SQL), "no DROP");
  assert.ok(!/\bdelete\s+from\b/i.test(SQL), "no DELETE");
  assert.ok(/add column if not exists/.test(SQL), "columns added idempotently");
});

test("10.0 route: STEP A (save) precedes STEP B (notify); notify is try/caught and never sets action_saved false", () => {
  const aIdx = REVIEW.indexOf('client_review_version');
  const bIdx = REVIEW.indexOf('review_enqueue_notifications');
  assert.ok(aIdx > -1 && bIdx > aIdx, "save call appears before the enqueue call");
  assert.ok(/try\s*{[\s\S]*review_enqueue_notifications[\s\S]*}\s*catch/.test(REVIEW), "STEP B wrapped in try/catch");
  // action_saved:false only appears on the pre-save guards / save-failure branch, never after save.
  const afterSave = REVIEW.slice(REVIEW.indexOf("now SAVED"));
  assert.ok(!/action_saved:\s*false/.test(afterSave), "no action_saved:false after the decision is saved");
});

test("10.0 route: reports the five signals separately (saved / code / correlation / expected / sent)", () => {
  for (const k of ["action_saved", "notification_code", "correlation_id", "expected_recipients", "sent"])
    assert.ok(REVIEW.includes(k), `logs ${k}`);
});

test("10.0 browser: reviewVersion only reports ok when action_saved===true", () => {
  assert.ok(/action_saved\s*===\s*true/.test(DELIVERABLES), "success is gated on action_saved, not merely res.ok");
  assert.ok(/ReviewOutcome/.test(DELIVERABLES), "typed outcome carries the notification block");
});

test("10.0 UI: 'تعذر/تعذّر تسجيل قرارك' shows ONLY when the decision failed (r.ok===false)", () => {
  // the failure message must be guarded by !r.ok, not by any notification field
  assert.ok(/if\s*\(\s*!r\.ok\s*\)\s*{[^}]*تعذّر تسجيل قرارك/.test(VERSIONS), "decision-failed message is bound to !r.ok");
  assert.ok(VERSIONS.includes("تم تسجيل قرارك وإرسال الإشعار"), "recorded + sent");
  assert.ok(VERSIONS.includes("تعذّر إرسال إشعار البريد") && VERSIONS.includes("تم إبلاغ الإدارة"), "recorded but email failed → management notified");
});

test("10.0 safety: static only (no DB/network/real email)", () => {
  const self = R("tests/review_decouple_phase0_batch10.test.js");
  const reqs = [...self.matchAll(/require\(["']([^"']+)["']\)/g)].map((m) => m[1]);
  for (const r of reqs) assert.ok(["node:test", "node:assert", "node:fs", "node:path"].includes(r), `static (got ${r})`);
});
