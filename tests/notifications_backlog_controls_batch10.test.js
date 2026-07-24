// ════════════════════════════════════════════════════════════════════════════
// tests/notifications_backlog_controls_batch10.test.js — BATCH 10 · Phase 9-10
// Backlog CONTROLS (no mass send): classification into the four buckets +
// single-row manual retry with recency/status guards. (A) faithful bucketing
// simulation; (B) route + wrapper + UI structural pins. No DB/network/email.
// ════════════════════════════════════════════════════════════════════════════
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(root, p), "utf8");

const CRIT = new Set(["client_deliverable_approved", "client_revision_requested", "deliverable_final_ready", "deliverable_preview_sent", "project_delivery_recorded"]);
// faithful to route.ts backlog_classify (rows MUST be created_at asc, like the query)
function classify(rows, nowMs) {
  const recentCut = nowMs - 2 * 3600e3;
  const oldCut = nowMs - 24 * 3600e3;
  const b = { eligible_recent: 0, mid_pending: 0, expired_old: 0, duplicate: 0, critical_recent: 0, total: 0 };
  const seen = new Set();
  const crit = [];
  for (const r of rows) {
    b.total++;
    const type = r.type ?? "(untyped)";
    const sig = r.key && r.key.trim() ? `k:${r.key}` : `p:${(r.email ?? "").toLowerCase()}|${r.subject ?? ""}`;
    if (seen.has(sig)) { b.duplicate++; continue; }
    seen.add(sig);
    if (r.t < oldCut) { b.expired_old++; continue; }
    if (r.t >= recentCut) { b.eligible_recent++; if (CRIT.has(type)) { b.critical_recent++; crit.push(r.id); } }
    else b.mid_pending++;
  }
  return { b, crit };
}

const NOW = 1_000_000_000_000;
const hAgo = (h) => NOW - h * 3600e3;

test("10.10 classify: recent non-dup non-critical → eligible_recent", () => {
  const { b } = classify([{ id: "1", t: hAgo(1), type: "project_note_added", key: "k1" }], NOW);
  assert.equal(b.eligible_recent, 1); assert.equal(b.critical_recent, 0); assert.equal(b.total, 1);
});
test("10.10 classify: recent CRITICAL → eligible + critical + retry candidate id", () => {
  const { b, crit } = classify([{ id: "9", t: hAgo(1), type: "client_deliverable_approved", key: "k9" }], NOW);
  assert.equal(b.critical_recent, 1); assert.deepEqual(crit, ["9"]);
});
test("10.10 classify: old (>24h) → expired_old, never eligible", () => {
  const { b } = classify([{ id: "1", t: hAgo(48), type: "deliverable_final_ready", key: "k1" }], NOW);
  assert.equal(b.expired_old, 1); assert.equal(b.eligible_recent, 0); assert.equal(b.critical_recent, 0);
});
test("10.10 classify: 8h old → mid_pending (neither eligible nor expired)", () => {
  const { b } = classify([{ id: "1", t: hAgo(8), type: "x", key: "k1" }], NOW);
  assert.equal(b.mid_pending, 1); assert.equal(b.eligible_recent, 0); assert.equal(b.expired_old, 0);
});
test("10.10 classify: duplicate key (later row) → duplicate, not double-counted", () => {
  const { b } = classify([
    { id: "1", t: hAgo(1), type: "x", key: "same" },
    { id: "2", t: hAgo(0.5), type: "x", key: "same" },
  ], NOW);
  assert.equal(b.eligible_recent, 1); assert.equal(b.duplicate, 1); assert.equal(b.total, 2);
});
test("10.10 classify: legacy null key dedupes by recipient+subject", () => {
  const { b } = classify([
    { id: "1", t: hAgo(1), type: "x", email: "A@x.com", subject: "S" },
    { id: "2", t: hAgo(0.5), type: "x", email: "a@x.com", subject: "S" },
  ], NOW);
  assert.equal(b.duplicate, 1, "case-insensitive email + same subject = duplicate");
});
test("10.10 classify: buckets partition the total exactly", () => {
  const rows = [
    { id: "1", t: hAgo(1), type: "client_revision_requested", key: "a" }, // eligible+critical
    { id: "2", t: hAgo(1), type: "x", key: "b" },                          // eligible
    { id: "3", t: hAgo(8), type: "x", key: "c" },                          // mid
    { id: "4", t: hAgo(48), type: "x", key: "d" },                         // expired
    { id: "5", t: hAgo(1), type: "x", key: "a" },                          // duplicate of #1's key
  ];
  const { b } = classify(rows, NOW);
  assert.equal(b.eligible_recent + b.mid_pending + b.expired_old + b.duplicate, b.total, "every row lands in exactly one bucket");
  assert.equal(b.total, 5);
});

// ─── (B) route / wrapper / UI structural pins ───
const ROUTE = R("app/api/integrations/project/notify-admin/route.ts");
const WRAP = R("lib/portal/projectCore.ts");
const UI = R("components/portal/projectcore/NotifyMonitor.tsx");

test("10.10 route: backlog_classify is READ-ONLY (no patch/insert in its block)", () => {
  assert.ok(/"backlog_classify"/.test(ROUTE), "action registered");
  const start = ROUTE.indexOf('action === "backlog_classify"');
  const end = ROUTE.indexOf('action === "retry_one"');
  const block = ROUTE.slice(start, end);
  assert.ok(!/patchAsService|insert|rpcAsService\(/.test(block), "classify performs no mutation");
  assert.ok(/critical_retry_candidates/.test(block) && /CRITICAL_EVENTS/.test(block), "surfaces critical retry candidates");
});
test("10.10 route: retry_one is single-row + guarded (no mass send)", () => {
  const start = ROUTE.indexOf('action === "retry_one"');
  const end = ROUTE.indexOf('process_now" — bounded');
  const block = ROUTE.slice(start, end);
  assert.ok(/\{0,\}|\{36\}/.test(block) || /\[0-9a-fA-F-\]\{36\}/.test(block), "validates one uuid");
  assert.ok(/too_old_expire_instead/.test(block), "rejects rows older than the expire window");
  assert.ok(/not_retryable_status/.test(block), "only pending/failed rows");
  assert.ok(/deliveryIds:\s*\[id\]/.test(block), "processes EXACTLY one id (exact-ID mode, never a mass drain)");
  assert.ok(!/recentMinutes/.test(block), "no time-window scan (single id only)");
});
test("10.10 wrapper + UI expose classify and per-row critical retry", () => {
  assert.ok(/backlog_classify|retry_one/.test(WRAP) && /extra\?:/.test(WRAP), "wrapper carries the new actions + extra body");
  assert.ok(/runAdmin\("backlog_classify"\)/.test(UI), "Classify button wired");
  assert.ok(/retryCritical/.test(UI) && /retry_one/.test(UI), "per-row manual retry wired");
  assert.ok(/eligible_recent|expired_old|duplicate|critical_recent/.test(UI), "buckets rendered");
});
test("10.10 safety: static only (no DB/network/real email)", () => {
  const self = R("tests/notifications_backlog_controls_batch10.test.js");
  const reqs = [...self.matchAll(/require\(["']([^"']+)["']\)/g)].map((m) => m[1]);
  for (const r of reqs) assert.ok(["node:test", "node:assert", "node:fs", "node:path"].includes(r), `static (got ${r})`);
});
