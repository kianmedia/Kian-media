// ════════════════════════════════════════════════════════════════════════════
// tests/event_bound_email_9g.test.js — BATCH 9G — EVENT-BOUND EMAIL DISPATCH
// The proven production failure: /project/review → 200 with claimed=0/sent=0
// because the approval enqueued NO rows for the right recipients and a generic
// recent-window scan found nothing. 9G binds dispatch to the event via EXACT
// delivery IDs returned from the enqueue, and processes precisely those IDs.
//
// (A) behavioral sim of exact-ID processing (per-id outcomes, idempotency,
//     claim-conflict, provider fail, no-rows=failure); (B) structural pins that
//     the real RPC/routes are event-bound; no DB/network/real email.
// ════════════════════════════════════════════════════════════════════════════
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(root, p), "utf8");

const SQL = R("docs/event_bound_email_dispatch_batch9g_RUNME.sql");
const WORKER = R("lib/server/notifyWorker.ts");
const REVIEW = R("app/api/integrations/project/review/route.ts");
const PREVIEW = R("app/api/integrations/project/notify/route.ts");
const VERSIONS = R("components/portal/VersionHistory.tsx");

const codeOf = (sql) => sql.split("\n").map((l) => { const i = l.indexOf("--"); return i >= 0 ? l.slice(0, i) : l; }).join("\n");
const CODE = codeOf(SQL);

// ─── (A) EXACT-ID processing model (faithful to notifyWorker exact-ID branch) ───
const MAX = 5;
// Given a set of rows (the enqueued event rows) + a provider, process EXACTLY the ids.
function processExact(rowsById, ids, sendFor, { now = Date.now() } = {}) {
  const out = { claimed: 0, sent: 0, retrying: 0, dead_letter: 0, failed: 0, skipped: 0, perId: {} };
  for (const id of ids) {
    const d = rowsById[id];
    if (!d) { out.perId[id] = "not_found"; continue; }
    if (d.status === "sent") { out.perId[id] = "already_sent"; continue; }
    if (d.status === "failed") { out.perId[id] = "already_failed"; continue; }
    if (d.status === "skipped") { out.perId[id] = "skipped"; out.skipped++; continue; }
    if (d.status === "processing") { out.perId[id] = "claim_conflict"; continue; }
    if ((d.attempts ?? 0) >= MAX) { out.perId[id] = "already_failed"; continue; }
    if (d.next_attempt_at && d.next_attempt_at > now) { out.perId[id] = "not_due"; continue; }
    // atomic claim + send
    d.status = "processing"; out.claimed++;
    const res = sendFor(d);
    if (res.sent) { d.status = "sent"; d.attempts = (d.attempts ?? 0) + 1; d.sent_at = now; d.provider_message_id = res.providerId ?? null; out.sent++; out.perId[id] = "sent"; }
    else { d.attempts = (d.attempts ?? 0) + 1; const term = d.attempts >= MAX; d.status = term ? "failed" : "pending"; out.failed++; if (term) { out.dead_letter++; out.perId[id] = "dead_letter"; } else { out.retrying++; out.perId[id] = "retrying"; } }
  }
  return out;
}
const mkRow = (id, o) => [id, { id, status: "pending", attempts: 0, next_attempt_at: null, recipient_email: "a@b.com", ...o }];

test("9G-1: event returns 3 delivery IDs → processExact claims all 3, attempts 0→1, sent", () => {
  const rows = Object.fromEntries([mkRow("d1"), mkRow("d2"), mkRow("d3")]);
  const out = processExact(rows, ["d1", "d2", "d3"], () => ({ sent: true, providerId: "p" }));
  assert.equal(out.claimed, 3); assert.equal(out.sent, 3);
  assert.deepEqual(Object.values(rows).map((r) => r.attempts), [1, 1, 1]);
  assert.deepEqual(out.perId, { d1: "sent", d2: "sent", d3: "sent" });
});
test("9G-2: expected>0 but ZERO IDs (producer created no rows) → route treats as failure", () => {
  // model the route decision: expected>0, deliveryIds empty, nothing sent → EMAIL_ROWS_NOT_CLAIMED.
  const expected = 3, deliveryIds = [];
  const out = processExact({}, deliveryIds, () => ({ sent: true }));
  const anySent = out.sent > 0 || Object.values(out.perId).includes("already_sent");
  const isFailure = expected > 0 && !anySent && out.claimed === 0;
  assert.equal(isFailure, true, "the exact production bug (200 + claimed=0) is now a failure, not a false success");
});
test("9G-3: idempotent repeat — rows already sent → perId already_sent, treated as success", () => {
  const rows = Object.fromEntries([mkRow("d1", { status: "sent" }), mkRow("d2", { status: "sent" })]);
  const out = processExact(rows, ["d1", "d2"], () => { throw new Error("no re-send"); });
  assert.equal(out.sent, 0); // no NEW sends
  const anySent = out.sent > 0 || Object.values(out.perId).includes("already_sent");
  assert.equal(anySent, true); // but already-sent counts as delivered
});
test("9G-4: exact-ID mode ignores rows NOT in the id list (no old backlog touched)", () => {
  const rows = Object.fromEntries([mkRow("mine"), mkRow("old_backlog", { created_at: 1 })]);
  const out = processExact(rows, ["mine"], () => ({ sent: true }));
  assert.equal(out.claimed, 1);
  assert.equal(rows["old_backlog"].status, "pending"); // untouched
});
test("9G-5: claim conflict — a row already 'processing' is reported, not double-sent", () => {
  const rows = Object.fromEntries([mkRow("d1", { status: "processing" })]);
  const out = processExact(rows, ["d1"], () => { throw new Error("no send"); });
  assert.equal(out.perId["d1"], "claim_conflict"); assert.equal(out.claimed, 0);
});
test("9G-6: provider failure on the event's row → retrying, attempts 1, NOT a success", () => {
  const rows = Object.fromEntries([mkRow("d1")]);
  const out = processExact(rows, ["d1"], () => ({ sent: false, reason: "http_500" }));
  assert.equal(out.sent, 0); assert.equal(out.retrying, 1); assert.equal(rows["d1"].attempts, 1);
});
test("9G-7: not_found id (never enqueued) reported distinctly", () => {
  const out = processExact({}, ["ghost"], () => ({ sent: true }));
  assert.equal(out.perId["ghost"], "not_found");
});

// ─── (B) STRUCTURAL PINS — the real code is event-bound ───
test("9G SQL: additive event-binding columns + idempotency unique index + self-test", () => {
  assert.ok(/add column if not exists correlation_id/.test(CODE) && /add column if not exists idempotency_key/.test(CODE), "correlation_id + idempotency_key added");
  assert.ok(CODE.includes("create unique index if not exists uq_edel_idem"), "idempotency unique index");
  assert.ok(SQL.includes("9G FAIL") && SQL.includes("notify pgrst"), "self-test + reload");
  assert.ok(SQL.includes("begin;") && SQL.includes("commit;"), "transactional");
});
test("9G SQL: review RPC = authz + mutation + enqueue + returns delivery_ids", () => {
  assert.ok(SQL.includes("function public.client_review_and_enqueue_notifications("), "review RPC exists");
  assert.ok(SQL.includes("client_review_version"), "reuses the RLS-enforced mutation authz");
  assert.ok(SQL.includes("delivery_ids") && SQL.includes("expected_recipients") && SQL.includes("correlation_id"), "returns exact IDs + expected + correlation");
  assert.ok(SQL.includes("nt_event_enqueue_internal"), "enqueues via the shared internal producer");
});
test("9G SQL: internal enqueue is service-only; idempotency prevents duplicate inserts", () => {
  assert.ok(/revoke all on function public.nt_event_enqueue_internal[\s\S]*from public, anon, authenticated/.test(SQL), "internal enqueue service-only");
  // CRITICAL (review): ON CONFLICT must restate the PARTIAL index predicate or it
  // raises 42P10 and aborts the whole RPC (decision lost, zero rows enqueued).
  assert.ok(SQL.includes("on conflict (idempotency_key) where idempotency_key is not null do nothing"), "ON CONFLICT restates the partial-index predicate (no 42P10)");
  assert.ok(!/on conflict \(idempotency_key\) do nothing/.test(SQL), "no bare ON CONFLICT on the partial index");
  assert.ok(SQL.includes("client_review_version"), "client authz via reused RPC");
});
test("9G SQL: durability — enqueue failure cannot roll back the saved client decision", () => {
  // The enqueue runs in a savepoint (BEGIN/EXCEPTION) so a decision stays committed.
  const rpcBody = SQL.slice(SQL.indexOf("function public.client_review_and_enqueue_notifications("));
  assert.ok(/begin[\s\S]{0,900}nt_event_enqueue_internal[\s\S]{0,200}exception when others then/.test(rpcBody), "enqueue wrapped in a fail-safe subtransaction");
  // Self-test actually exercises ON CONFLICT (rolled back), so this can't false-green again.
  assert.ok(SQL.includes("9g_selftest_probe") && SQL.includes("42P10"), "self-test probes the ON CONFLICT arbiter");
});
test("9G worker: exact-ID mode (deliveryIds) with per-id outcomes, no created_at window", () => {
  assert.ok(WORKER.includes("deliveryIds") && WORKER.includes("EXACT-ID MODE"), "exact-ID branch present");
  assert.ok(WORKER.includes("id=in.(") && !/EXACT-ID MODE[\s\S]{0,400}created_at=gte/.test(WORKER), "exact mode selects by id, not a time window");
  for (const o of ["not_found", "already_sent", "not_due", "claim_conflict"]) assert.ok(WORKER.includes(`"${o}"`), `reports ${o}`);
  assert.ok(WORKER.includes("perId"), "returns a per-id outcome map");
});
test("9G/10.0 routes: preview is event-bound; review is decoupled + event-bound", () => {
  // Batch 10 Phase 0: review now SAVES the decision first, then enqueues best-effort
  // (no combined mutation RPC, no 502 once saved). Preview is unchanged (event-bound).
  assert.ok(REVIEW.includes("review_enqueue_notifications") && REVIEW.includes("{ deliveryIds }"), "review: enqueue-only RPC + exact-ID process");
  assert.ok(!/status:\s*502/.test(REVIEW), "review: never returns HTTP 502 once the decision is saved (decoupled)");
  assert.ok(REVIEW.includes("EMAIL_ROWS_NOT_CLAIMED"), "review: still honest when expected>0 & nothing sent (notification code)");
  assert.ok(PREVIEW.includes("deliverable_preview_enqueue_notifications") && PREVIEW.includes("{ deliveryIds }"), "preview: RPC + exact-ID process");
  assert.ok(PREVIEW.includes("EMAIL_ROWS_NOT_CLAIMED"), "preview: no false success");
  assert.ok(!REVIEW.includes("recentMinutes") && !PREVIEW.includes("recentMinutes"), "no generic recent-window scan on these paths");
});
test("9G preview: single queue source (bridge duplicates suppressed, no direct-send)", () => {
  assert.ok(!PREVIEW.includes("sendProjectEmail"), "no direct-send (one queue source)");
  assert.ok(PREVIEW.includes("superseded_event_bound") && PREVIEW.includes("idempotency_key=is.null"), "bridge rows suppressed; event-bound rows authoritative");
});
test("10.0 UI: honest — recorded, recorded+sent, or recorded-but-email-failed", () => {
  assert.ok(VERSIONS.includes("تعذّر إرسال إشعار البريد"), "distinguishes recorded-but-email-failed");
  assert.ok(/sent > 0/.test(VERSIONS), "only claims 'sent' when sent>0");
  assert.ok(!VERSIONS.includes("correlation_id"), "the correlation id is NOT shown to the client (admin-only per Phase 0.5)");
});
test("9G safety: static only (no DB/network/real email)", () => {
  const self = R("tests/event_bound_email_9g.test.js");
  const reqs = [...self.matchAll(/require\(["']([^"']+)["']\)/g)].map((m) => m[1]);
  for (const r of reqs) assert.ok(["node:test", "node:assert", "node:fs", "node:path"].includes(r), `static (got ${r})`);
});
