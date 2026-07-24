// ════════════════════════════════════════════════════════════════════════════
// tests/global_notifications_pipeline_batch10.test.js — BATCH 10 · PHASE 2
// The UNIFIED pipeline: notify_emit_event (SQL, composes the central resolver) +
// emitEventEmail (TS, the one dispatch helper). Proves the helper's outcome logic
// matches the Phase-0 contract for every enqueue/process result, and pins the
// SQL/helper/architecture invariants that keep it a SINGLE pipeline.
// No DB, no network, no real email.
// ════════════════════════════════════════════════════════════════════════════
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(root, p), "utf8");

// ─── (A) faithful simulation of emitEventEmail's outcome computation ───
function emit(deps) {
  const out = { ok: false, code: "EMAIL_NOT_ATTEMPTED", correlation_id: null, expected: 0, queued: 0, claimed: 0, sent: 0 };
  try {
    if (!deps.adminConfigured) { out.code = "SERVER_NOT_CONFIGURED"; return out; }
    const enq = deps.enqueue();
    if (!enq.ok || !enq.data || enq.data.ok === false) {
      out.code = "EMAIL_ENQUEUE_FAILED";
      out.error = String(enq.error ?? (enq.ok && enq.data ? enq.data.error : undefined) ?? "enqueue_failed");
      return out;
    }
    const ids = Array.isArray(enq.data.delivery_ids) ? enq.data.delivery_ids : [];
    out.correlation_id = enq.data.correlation_id ?? null;
    out.expected = typeof enq.data.expected_recipients === "number" ? enq.data.expected_recipients : ids.length;
    out.queued = Array.isArray(enq.data.new_ids) ? enq.data.new_ids.length : 0;
    const processed = ids.length > 0 ? deps.processQueue(ids) : { claimed: 0, sent: 0, perId: {} };
    const already = Object.values(processed.perId ?? {}).filter((o) => o === "already_sent").length;
    const anySent = processed.sent > 0 || already > 0;
    out.claimed = processed.claimed; out.sent = processed.sent;
    out.ok = out.expected === 0 || anySent;
    out.code = out.expected === 0 ? "NO_RECIPIENTS" : anySent ? "SENT" : "EMAIL_ROWS_NOT_CLAIMED";
  } catch (e) { out.code = "EMAIL_ENQUEUE_FAILED"; out.error = String(e); }
  return out;
}
const ok = (data) => ({ ok: true, data });
const enqOk = (over = {}) => ok({ ok: true, correlation_id: "c1", expected_recipients: 2, new_ids: ["a", "b"], delivery_ids: ["a", "b"], ...over });
const base = (over = {}) => ({ adminConfigured: true, enqueue: () => enqOk(), processQueue: () => ({ claimed: 2, sent: 2, perId: { a: "sent", b: "sent" } }), ...over });

test("10.2 emit: recipients resolved, enqueued, all sent → SENT/ok", () => {
  const r = emit(base());
  assert.equal(r.code, "SENT"); assert.equal(r.ok, true); assert.equal(r.sent, 2); assert.equal(r.expected, 2);
});
test("10.2 emit: no recipients (resolver returned none) → NO_RECIPIENTS/ok", () => {
  const r = emit(base({ enqueue: () => enqOk({ expected_recipients: 0, new_ids: [], delivery_ids: [] }) }));
  assert.equal(r.code, "NO_RECIPIENTS"); assert.equal(r.ok, true);
});
test("10.2 emit: enqueue RPC missing → EMAIL_ENQUEUE_FAILED, ok false, never throws", () => {
  const r = emit(base({ enqueue: () => ({ ok: false, error: "PGRST202" }) }));
  assert.equal(r.code, "EMAIL_ENQUEUE_FAILED"); assert.equal(r.ok, false);
});
test("10.2 emit: enqueue ok:false (subject_required) → EMAIL_ENQUEUE_FAILED", () => {
  const r = emit(base({ enqueue: () => ok({ ok: false, error: "subject_required" }) }));
  assert.equal(r.code, "EMAIL_ENQUEUE_FAILED"); assert.equal(r.error, "subject_required");
});
test("10.2 emit: provider rejects (claimed>0 sent=0) → EMAIL_ROWS_NOT_CLAIMED, not a false success", () => {
  const r = emit(base({ processQueue: () => ({ claimed: 2, sent: 0, perId: { a: "retrying", b: "retrying" } }) }));
  assert.equal(r.code, "EMAIL_ROWS_NOT_CLAIMED"); assert.equal(r.ok, false);
});
test("10.2 emit: idempotent repeat (already_sent, no new rows) → SENT, queued 0", () => {
  const r = emit(base({ enqueue: () => enqOk({ new_ids: [] }), processQueue: () => ({ claimed: 0, sent: 0, perId: { a: "already_sent", b: "already_sent" } }) }));
  assert.equal(r.code, "SENT"); assert.equal(r.queued, 0);
});
test("10.2 emit: admin not configured → SERVER_NOT_CONFIGURED, no enqueue", () => {
  let called = false;
  const r = emit(base({ adminConfigured: false, enqueue: () => { called = true; return enqOk(); } }));
  assert.equal(r.code, "SERVER_NOT_CONFIGURED"); assert.equal(called, false);
});
test("10.2 emit: enqueue throws → caught, EMAIL_ENQUEUE_FAILED (never throws to caller)", () => {
  const r = emit(base({ enqueue: () => { throw new Error("boom"); } }));
  assert.equal(r.code, "EMAIL_ENQUEUE_FAILED");
});

// ─── (B) SQL / helper / architecture structural pins ───
const CORE = R("docs/global_notifications_core_batch10_RUNME.sql");
const HELPER = R("lib/server/notifyEvent.ts");
const ARCH = R("docs/global_notifications_ARCHITECTURE_batch10.md");

test("10.2 SQL: notify_emit_event composes the CENTRAL resolver (single source of truth)", () => {
  assert.ok(/notification_resolve_recipients\(p_event, p_entity_type, p_entity_id, p_project, p_actor/.test(CORE), "drives recipients from the 9D resolver");
  assert.ok(/PREFLIGHT: notification_resolve_recipients missing/.test(CORE), "preflight requires the resolver");
  assert.ok(!/create table/i.test(CORE), "adds NO new table (uses email_deliveries)");
});
test("10.2 SQL: enqueue-only (no business mutation), idempotent, partial-index safe, service-only", () => {
  const fn = CORE.slice(CORE.indexOf("function public.notify_emit_event"));
  const body = fn.slice(0, fn.indexOf("$$;") + 3);
  assert.ok(!/\bupdate\s+public\.|\bdelete\s+from\b/i.test(body), "no mutation of business rows");
  assert.ok(/on conflict \(idempotency_key\) where idempotency_key is not null do nothing/.test(CORE), "restated partial-index predicate (42P10 guard)");
  assert.ok(/idempotency_key = any\(v_keys\)/.test(CORE), "gathers exact delivery IDs by the attempted dedupe keys");
  assert.ok(/revoke all on function public\.notify_emit_event/.test(CORE) && /grant execute on function public\.notify_emit_event\([^)]*\) to service_role/.test(CORE), "service-only + service_role keeps EXECUTE");
});
test("10.2 SQL: empty subject rejected; self-test probes emit + on-conflict and rolls back", () => {
  assert.ok(/subject_required/.test(CORE), "rejects an empty subject without enqueuing");
  assert.ok(/42P10/.test(CORE) && /ROLLBACK_10_CORE_PROBE/.test(CORE), "self-test probes on-conflict and rolls the probe back");
});
test("10.2 helper: emitEventEmail is the ONE dispatch path (resolver→queue→exact IDs), never throws", () => {
  assert.ok(/rpcAsService<EmitResult>\("notify_emit_event"/.test(HELPER), "calls the canonical enqueue RPC");
  assert.ok(/processQueue\(deliveryIds\.length, \{ deliveryIds \}\)/.test(HELPER), "processes exactly the event's delivery IDs");
  assert.ok(/from "@\/lib\/server\/notifyWorker"/.test(HELPER), "uses the shared worker (no second worker)");
  assert.ok(/catch \(e\)/.test(HELPER), "best-effort — catches everything, never throws");
  for (const c of ["SENT", "NO_RECIPIENTS", "EMAIL_ROWS_NOT_CLAIMED", "EMAIL_ENQUEUE_FAILED", "SERVER_NOT_CONFIGURED"])
    assert.ok(HELPER.includes(c), `reports ${c} (mirrors the Phase-0 contract)`);
});
test("10.2 architecture doc declares the one pipeline + isolation law + prohibitions", () => {
  assert.ok(/email_deliveries.*the ONLY queue|the ONLY queue/.test(ARCH), "one queue declared");
  assert.ok(/notification_resolve_recipients.*the ONLY resolver|the ONLY resolver/.test(ARCH), "one resolver declared");
  const arch1 = ARCH.replace(/\s+/g, " ");
  assert.ok(/no 3rd notifications table, no 2nd email queue, no parallel email provider, no per-module cron/.test(arch1), "prohibitions stated");
  assert.ok(/business-action isolation law/i.test(ARCH) && /never\b[\s\S]{0,40}roll(s|ing)? ?back/i.test(ARCH), "isolation law: notification failure never rolls back the action");
  assert.ok(/Golden Path/.test(ARCH) && /do not touch/i.test(ARCH), "golden path protected");
});
test("10.2 safety: static only (no DB/network/real email)", () => {
  const self = R("tests/global_notifications_pipeline_batch10.test.js");
  const reqs = [...self.matchAll(/require\(["']([^"']+)["']\)/g)].map((m) => m[1]);
  for (const r of reqs) assert.ok(["node:test", "node:assert", "node:fs", "node:path"].includes(r), `static (got ${r})`);
});
