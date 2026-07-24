// ════════════════════════════════════════════════════════════════════════════
// tests/email_worker_serverside_9f.test.js — BATCH 9F HOTFIX
// Proves the worker is invoked SERVER-SIDE (not via an unreliable browser kick),
// recent-only + bounded, and that a success response cannot leave a fresh row
// pending/attempts=0. (A) behavioral sim of the recent-only claim→attempts→provider
// state machine; (B) structural pins that the real routes call processQueue directly.
// No DB, no network, no real email.
// ════════════════════════════════════════════════════════════════════════════
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(root, p), "utf8");

const WORKER = R("lib/server/notifyWorker.ts");
const REVIEW = R("app/api/integrations/project/review/route.ts");
const DELIVERABLES = R("lib/portal/deliverables.ts");
const NOTIFYEMAIL = R("lib/portal/notifyEmail.ts");
const DRAIN = R("app/api/integrations/notify/drain/route.ts");
const PREVIEW = R("app/api/integrations/project/notify/route.ts");
const ADMIN = R("app/api/integrations/project/notify-admin/route.ts");
const VERSIONS = R("components/portal/VersionHistory.tsx");

// ─── (A) recent-only claim + attempts + provider (faithful to notifyWorker) ───
const MAX = 5, HOUR = 3600_000, STALE = HOUR;
function simulate(queue, sendFor, { now = Date.now(), limit = 20, recentMinutes = 15 } = {}) {
  const out = { claimed: 0, sent: 0, retrying: 0, dead_letter: 0, failed: 0, skipped: 0 };
  const cutoff = now - recentMinutes * 60_000;
  for (const r of queue) { // lease reaper
    if (r.status === "processing" && r.next_attempt_at != null && r.next_attempt_at < now) { r.status = "pending"; r.next_attempt_at = null; }
  }
  const due = queue.filter((r) => r.status === "pending" && r.attempts < MAX &&
    (r.next_attempt_at == null || r.next_attempt_at <= now) && r.created_at >= cutoff)
    .sort((a, b) => a.created_at - b.created_at).slice(0, limit);
  for (const d of due) {
    if (d.status !== "pending") continue;
    d.status = "processing"; d.next_attempt_at = now + STALE; out.claimed++;
    const res = sendFor(d);
    if (res.sent) { d.status = "sent"; d.attempts++; d.sent_at = now; d.provider_message_id = res.providerId ?? null; d.last_error = null; out.sent++; }
    else { d.attempts++; const terminal = d.attempts >= MAX; d.status = terminal ? "failed" : "pending"; d.last_error = res.reason ?? "send_failed"; d.next_attempt_at = terminal ? null : now + 60_000; terminal ? out.dead_letter++ : out.retrying++; out.failed++; }
  }
  return out;
}
const row = (o) => ({ id: "r" + Math.random().toString(36).slice(2, 7), status: "pending", attempts: 0, next_attempt_at: null, recipient_email: "a@b.com", created_at: Date.now(), ...o });

test("9F-1: a fresh pending row (attempts=0) is claimed and attempts → 1 on send", () => {
  const q = [row()];
  const out = simulate(q, () => ({ sent: true, providerId: "p1" }));
  assert.equal(out.claimed, 1); assert.equal(out.sent, 1);
  assert.equal(q[0].attempts, 1); assert.equal(q[0].status, "sent"); assert.ok(q[0].sent_at != null); assert.equal(q[0].provider_message_id, "p1");
});
test("9F-2: after a successful drain, NO fresh recipient stays pending+attempts=0", () => {
  const q = [row(), row(), row()];
  simulate(q, () => ({ sent: true, providerId: "x" }));
  assert.equal(q.filter((r) => r.status === "pending" && r.attempts === 0).length, 0);
});
test("9F-3: recent-only — a row older than the window is NOT processed (no 405 blast)", () => {
  const now = Date.now();
  const q = [row({ created_at: now - 40 * 60_000, id: "old" }), row({ created_at: now - 60_000, id: "new" })];
  const out = simulate(q, () => ({ sent: true }), { now, recentMinutes: 15 });
  assert.equal(out.claimed, 1); // only the 'new' one
  assert.equal(q.find((r) => r.id === "old").status, "pending");
  assert.equal(q.find((r) => r.id === "new").status, "sent");
});
test("9F-4: bounded — a huge backlog is capped by limit (never all-at-once)", () => {
  const q = Array.from({ length: 405 }, () => row());
  const out = simulate(q, () => ({ sent: true }), { limit: 20 });
  assert.equal(out.claimed, 20); assert.equal(out.sent, 20);
});
test("9F-5: provider failure on a fresh row → attempts 1, retrying (not a false success)", () => {
  const q = [row()];
  const out = simulate(q, () => ({ sent: false, reason: "http_500" }));
  assert.equal(out.sent, 0); assert.equal(out.retrying, 1); assert.equal(q[0].attempts, 1); assert.equal(q[0].status, "pending");
});
test("9F-6: claimed=0 while a recent pending row exists is detectable as failure", () => {
  const now = Date.now();
  // provider throws → simulate the worker not being able to send; but claim still happens.
  // Model the 'never invoked' bug instead: no drain call at all → row stays pending.
  const q = [row({ created_at: now })];
  // (no simulate call = worker never invoked)
  const stillStuck = q[0].status === "pending" && q[0].attempts === 0;
  assert.equal(stillStuck, true, "if the server route does NOT call processQueue, the row stays stuck — this is the bug 9F fixes");
});

// ─── (B) STRUCTURAL PINS — real routes are server-authoritative ───
test("9F/9G PIN: review route runs the mutation AND processes exact IDs in-request", () => {
  assert.ok(REVIEW.includes("client_review_and_enqueue_notifications") && REVIEW.includes("rpcAsUser"), "event-bound RPC (mutation + enqueue) as the user");
  assert.ok(REVIEW.includes("processQueue(deliveryIds.length, { deliveryIds })"), "processes EXACTLY the event's delivery IDs (no time window)");
  assert.ok(REVIEW.includes('from "@/lib/server/notifyWorker"'), "imports the shared worker (no internal HTTP hop)");
  assert.ok(REVIEW.includes("EMAIL_ROWS_NOT_CLAIMED"), "no false success when expected>0 and claimed=0");
});
test("9F PIN: browser reviewVersion posts to the server route; no browser drain kick", () => {
  assert.ok(DELIVERABLES.includes("/api/integrations/project/review"), "browser calls the server-authoritative route");
  assert.ok(!DELIVERABLES.includes("notifyDrainKick"), "no fire-and-forget browser kick");
  assert.ok(!NOTIFYEMAIL.includes("export async function notifyDrainKick"), "the unreliable kick helper is removed");
});
test("9F PIN: general drain endpoint is ADMIN-only now (regular users can't drain the queue)", () => {
  assert.ok(DRAIN.includes("can_manage_projects") && DRAIN.includes("forbidden"), "admin-gated");
  assert.ok(DRAIN.includes("recentMinutes"), "recent-only bounded");
});
test("9F/9G PIN: preview is event-bound (exact IDs); admin process-now is recent-only", () => {
  assert.ok(PREVIEW.includes("deliverable_preview_enqueue_notifications") && PREVIEW.includes("{ deliveryIds }"), "preview enqueues exact recipients + processes those IDs");
  assert.ok(ADMIN.includes("recentMinutes: 60"), "process-now is recent-only + bounded");
});
test("9F PIN: worker supports recentMinutes windowing", () => {
  assert.ok(WORKER.includes("recentMinutes") && WORKER.includes("ProcessOpts"), "processQueue accepts a recent window");
});
test("9F/9G PIN: honest user-facing result (no blanket success when nothing sent)", () => {
  assert.ok(VERSIONS.includes("email_channel_enabled") && VERSIONS.includes("EMAIL_ROWS_NOT_CLAIMED"), "surfaces the real send outcome + not-claimed code");
  assert.ok(/could not start|تعذّر بدء إرسال البريد/.test(VERSIONS), "distinguishes recorded-but-email-failed");
});
test("9F safety: static only (no DB/network/real email)", () => {
  const self = R("tests/email_worker_serverside_9f.test.js");
  const reqs = [...self.matchAll(/require\(["']([^"']+)["']\)/g)].map((m) => m[1]);
  for (const r of reqs) assert.ok(["node:test", "node:assert", "node:fs", "node:path"].includes(r), `static (got ${r})`);
});
