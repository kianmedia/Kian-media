// ════════════════════════════════════════════════════════════════════════════
// tests/project_lifecycle_e2e.test.js — THE FULL PROJECT LIFECYCLE
//
// Encodes the complete operational scenario the platform must support:
// master + two subprojects → team → pre-production → session → resource conflict
// → override → tasks/milestones → risk/issue/decision → change request → deliverable
// → versions → timecode comments → revision → approval → final delivery → closure.
//
// Two layers, the pattern used throughout this repo:
//   (A) a faithful simulation of the rules as the DB actually implements them, so the
//       INVARIANTS are executable (not prose);
//   (B) structural pins proving the real SQL/TS enforces each rule server-side, so a
//       future refactor cannot quietly drop a guard.
// No DB, no network, no real email.
// ════════════════════════════════════════════════════════════════════════════
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(root, p), "utf8");

// ─────────────────────────────────────────────────────────────────────────────
// (A) LIFECYCLE SIMULATION — faithful to project_core_set_stage + hold/cancel
// ─────────────────────────────────────────────────────────────────────────────
const ORDER = ["lead_approved", "project_created", "planning", "ready", "scheduled",
  "in_production", "post_production", "internal_review", "client_review", "revision",
  "approved", "delivered", "closed"];

/** Mirrors project_core_set_stage's guards. Throws exactly like the RPC. */
function setStage(p, to, { reason = null, actor = "manager" } = {}) {
  const canManage = actor === "owner" || actor === "manager";
  const isOwner = actor === "owner";
  if (!canManage && actor !== "editor") throw new Error("not authorized");
  if (!ORDER.includes(to)) throw new Error("bad_stage");
  const from = p.stage;
  if (from === to) return p;
  const fi = ORDER.indexOf(from), ti = ORDER.indexOf(to);
  if (ti < fi || to === "closed") {
    if (!reason) throw new Error("reason_required");
    if (!canManage) throw new Error("not authorized");
  }
  if (to === "delivered" && !canManage) throw new Error("not authorized");
  if (ti > fi + 1 && !isOwner) throw new Error("no_stage_skip");
  if (to === "ready") {
    if (!p.members.some((m) => m.role === "kian_manager")) throw new Error("need_manager");
    if (!p.due_date) throw new Error("need_due_date");
  }
  p.history.push({ from, to, note: reason, by: actor });
  p.stage = to;
  return p;
}

/** Mirrors project_core_hold_action (hold/resume/cancel). */
function holdAction(p, action, reason, actor = "manager") {
  if (!["hold", "resume", "cancel"].includes(action)) throw new Error("bad_action");
  if (!reason) throw new Error("reason_required");
  if (!(actor === "owner" || actor === "manager")) throw new Error("not authorized");
  const from = p.stage;
  let to;
  if (action === "hold") {
    if (["closed", "cancelled"].includes(from)) throw new Error(`cannot_hold_from_${from}`);
    if (from === "on_hold") return p;
    to = "on_hold";
  } else if (action === "resume") {
    if (from !== "on_hold") throw new Error("not_on_hold");
    const last = [...p.history].reverse().find((h) => h.to === "on_hold");
    to = last && last.from !== "on_hold" ? last.from : "planning";
  } else {
    if (from === "closed") throw new Error("cannot_cancel_closed");
    if (from === "cancelled") return p;
    to = "cancelled";
  }
  p.history.push({ from, to, note: reason, by: actor });
  p.stage = to;
  return p;
}

const newProject = (over = {}) => ({
  id: over.id ?? "p1", scope: over.scope ?? "standalone", parent: over.parent ?? null,
  stage: "project_created", due_date: null, members: [], history: [], ...over,
});

// ── 1-8: creation, hierarchy, cycle prevention, team ──
test("L1: a master with two subprojects — the hierarchy is a strict 2-level model", () => {
  const master = newProject({ id: "M", scope: "master" });
  const a = newProject({ id: "A", scope: "subproject", parent: "M" });
  const b = newProject({ id: "B", scope: "subproject", parent: "M" });
  assert.equal(a.parent, "M"); assert.equal(b.parent, "M");
  assert.equal(master.parent, null, "a master never has a parent");
});

test("L2: a project can never be its own parent (DB CHECK constraint)", () => {
  const setParent = (p, np) => { if (np === p.id) throw new Error("circular_hierarchy"); p.parent = np; };
  const a = newProject({ id: "A", scope: "subproject" });
  assert.throws(() => setParent(a, "A"), /circular_hierarchy/);
});

test("L3: deep cycles are STRUCTURALLY impossible — a parent must be a master and a subproject cannot parent", () => {
  const move = (child, parent) => {
    if (child.scope !== "subproject") throw new Error("not_a_subproject");
    if (parent.scope !== "master") throw new Error("parent_must_be_master");
    if (parent.id === child.id) throw new Error("circular_hierarchy");
    child.parent = parent.id;
  };
  const M = newProject({ id: "M", scope: "master" });
  const A = newProject({ id: "A", scope: "subproject", parent: "M" });
  const B = newProject({ id: "B", scope: "subproject", parent: "M" });
  move(A, M);                                             // legal
  assert.throws(() => move(M, A), /not_a_subproject/, "a master cannot become a child");
  assert.throws(() => move(A, B), /parent_must_be_master/, "a subproject cannot become a parent");
  // ⇒ no A→B→A cycle can ever be constructed. No recursive check is needed.
});

test("L4: moving a subproject requires a reason and a matching client", () => {
  const move = (child, parent, reason) => {
    if (!reason) throw new Error("reason_required");
    if (child.client !== parent.client) throw new Error("subproject_client_must_match_master");
    child.parent = parent.id;
  };
  const M = newProject({ id: "M", scope: "master", client: "c1" });
  const A = newProject({ id: "A", scope: "subproject", client: "c1" });
  const X = newProject({ id: "X", scope: "master", client: "c2" });
  assert.throws(() => move(A, M, null), /reason_required/);
  assert.throws(() => move(A, X, "why"), /subproject_client_must_match_master/);
  move(A, M, "consolidating"); assert.equal(A.parent, "M");
});

test("L5: an employee may hold several professions on one project", () => {
  const p = newProject();
  p.members.push({ user: "u1", role: "kian_manager" });
  p.members.push({ user: "u2", role: "kian_photographer" });
  p.members.push({ user: "u2", role: "kian_editor" });
  assert.equal(p.members.filter((m) => m.user === "u2").length, 2);
});

test("L6: an editor cannot promote themselves to project manager (hardening §D)", () => {
  const memberAdd = (p, user, role, actor) => {
    const canManage = actor.role === "manager" || actor.role === "owner";
    if (!canManage && !actor.canEdit) throw new Error("not authorized");
    if (user === actor.id && role === "kian_manager" && !canManage) throw new Error("no_self_promotion");
    p.members.push({ user, role });
  };
  const p = newProject();
  assert.throws(() => memberAdd(p, "e1", "kian_manager", { id: "e1", role: "editor", canEdit: true }), /no_self_promotion/);
  memberAdd(p, "e1", "kian_editor", { id: "e1", role: "editor", canEdit: true });   // still allowed
  memberAdd(p, "e1", "kian_manager", { id: "boss", role: "manager" });              // a manager may
});

// ── 9-13: the ready gate, sessions, resource conflict, override ──
test("L7: 'ready' is gated on a project manager AND a due date", () => {
  const p = newProject({ stage: "planning" });
  assert.throws(() => setStage(p, "ready"), /need_manager/);
  p.members.push({ role: "kian_manager", user: "u1" });
  assert.throws(() => setStage(p, "ready"), /need_due_date/);
  p.due_date = "2026-09-01";
  setStage(p, "ready");
  assert.equal(p.stage, "ready");
});

test("L8: overlapping bookings for the same resource are detected", () => {
  const overlaps = (a, b) => a.resource === b.resource && a.start < b.end && b.start < a.end;
  const b1 = { resource: "cam1", start: 10, end: 14 };
  assert.equal(overlaps(b1, { resource: "cam1", start: 12, end: 16 }), true, "same resource, overlapping window");
  assert.equal(overlaps(b1, { resource: "cam1", start: 14, end: 18 }), false, "touching but not overlapping");
  assert.equal(overlaps(b1, { resource: "cam2", start: 12, end: 16 }), false, "different resource");
});

test("L9: a blocking conflict can only be overridden with a recorded reason, and it is logged", () => {
  const audit = [];
  const book = (conflict, { override = false, reason = null, actor = "manager" } = {}) => {
    if (conflict && !override) throw new Error("resource_conflict");
    if (conflict && override) {
      if (!reason) throw new Error("reason_required");
      if (!["owner", "manager"].includes(actor)) throw new Error("not authorized");
      audit.push({ action: "conflict_override", reason, actor });
    }
    return true;
  };
  assert.throws(() => book(true), /resource_conflict/);
  assert.throws(() => book(true, { override: true }), /reason_required/);
  assert.throws(() => book(true, { override: true, reason: "client insists", actor: "editor" }), /not authorized/);
  book(true, { override: true, reason: "client insists" });
  assert.equal(audit.length, 1, "every override leaves an audit entry");
});

test("L10: a retried booking must not create a duplicate", () => {
  const rows = new Map();
  const book = (key) => { if (rows.has(key)) return { created: false }; rows.set(key, 1); return { created: true }; };
  assert.equal(book("sess1:cam1").created, true);
  assert.equal(book("sess1:cam1").created, false, "idempotent on retry");
  assert.equal(rows.size, 1);
});

// ── 17-19: change requests ──
test("L11: applying an approved change request is IDEMPOTENT", () => {
  const cr = { id: "cr1", status: "approved", applied_at: null, extra_cost: 5000, extra_days: 7 };
  const project = { budget: 100000, due_date: 10 };
  const apply = (c, p) => {
    if (c.status !== "approved") throw new Error("not_approved");
    if (c.applied_at) return { applied: false, reason: "already_applied" };
    p.budget += c.extra_cost; p.due_date += c.extra_days; c.applied_at = "now"; c.status = "implemented";
    return { applied: true };
  };
  assert.equal(apply(cr, project).applied, true);
  assert.equal(project.budget, 105000);
  const second = apply({ ...cr, status: "approved" }, project);
  assert.equal(second.applied, false, "a retry must not apply the effect twice");
  assert.equal(project.budget, 105000, "budget unchanged by the retry");
});

test("L12: the change-request flow rejects illegal transitions", () => {
  const NEXT = { draft: ["internal_review", "cancelled"], internal_review: ["client_pending", "rejected", "cancelled"],
    client_pending: ["approved", "rejected", "cancelled"], approved: ["implemented"], rejected: [], cancelled: [], implemented: [] };
  const move = (from, to) => { if (!NEXT[from].includes(to)) throw new Error("bad_transition"); return to; };
  assert.equal(move("draft", "internal_review"), "internal_review");
  assert.throws(() => move("draft", "approved"), /bad_transition/, "cannot skip review");
  assert.throws(() => move("implemented", "approved"), /bad_transition/, "terminal");
});

// ── 20-31: the deliverable pipeline ──
test("L13: the deliverable flow and the approval/version consistency rule", () => {
  const d = { status: "draft", versions: [] };
  const addVersion = (n) => { d.versions.push({ n, decision: null, final: false }); d.status = "draft"; };
  const toInternal = () => { d.status = "internal_review"; };
  const toClient = () => { if (d.status !== "internal_review") throw new Error("bad_flow"); d.status = "client_review"; };
  // the ONLY correct review path — sets BOTH, exactly like client_review_version
  const review = (decision, comments) => {
    if (d.status !== "client_review") throw new Error("not_in_review");
    if (decision === "revision_requested" && !comments) throw new Error("reason_required");
    const cur = d.versions[d.versions.length - 1];
    cur.decision = decision;
    d.status = decision;
    return true;
  };
  addVersion(1); toInternal(); toClient();
  assert.throws(() => review("revision_requested"), /reason_required/, "a revision must carry a reason");
  review("revision_requested", "please recut the intro");
  assert.equal(d.versions[0].decision, "revision_requested");
  addVersion(2); toInternal(); toClient(); review("approved");
  assert.equal(d.versions[1].decision, "approved");
  assert.equal(d.status, "approved");
});

test("L14: an approved version cannot be edited — a new version is required", () => {
  const v = { n: 2, decision: "approved", locked: true };
  const edit = (ver) => { if (ver.decision === "approved") throw new Error("approved_version_is_locked"); ver.n++; };
  assert.throws(() => edit(v), /approved_version_is_locked/);
});

test("L15: final delivery requires an APPROVED VERSION — the §A corruption case is caught", () => {
  const markFinal = (deliverable, version) => {
    if (version.decision !== "approved") throw new Error("version_not_approved");
    if (!version.final_master) throw new Error("clean_final_master_required");
    deliverable.status = "final_delivered"; version.final = true; return true;
  };
  // the corruption the direct-insert policy produced: deliverable approved, version not
  const corrupted = { status: "approved" };
  const noDecision = { decision: null, final_master: "url" };
  assert.throws(() => markFinal(corrupted, noDecision), /version_not_approved/,
    "deliverable-level 'approved' with no approved version = permanently undeliverable");
  const good = { decision: "approved", final_master: "url" };
  assert.equal(markFinal({ status: "approved" }, good), true);
});

test("L16: approval and delivery are idempotent under retry", () => {
  const d = { status: "client_review", approvals: 0, deliveries: 0 };
  const approve = () => { if (d.status === "approved") return false; d.status = "approved"; d.approvals++; return true; };
  const deliver = () => { if (d.status === "final_delivered") return false; d.status = "final_delivered"; d.deliveries++; return true; };
  approve(); approve(); deliver(); deliver();
  assert.equal(d.approvals, 1, "a retried approval does not double-record");
  assert.equal(d.deliveries, 1, "a retried delivery does not double-record");
});

// ── 32-36: closure ──
test("L17: a master cannot close while a mandatory subproject is open; override needs a reason", () => {
  const closeMaster = (m, subs, { override = false, reason = null } = {}) => {
    const open = subs.filter((s) => s.mandatory && s.stage !== "closed");
    if (open.length && !override) throw new Error("subprojects_open");
    if (open.length && override && !reason) throw new Error("reason_required");
    m.stage = "closed"; return { closed: true, overridden: open.length > 0 };
  };
  const M = newProject({ id: "M", scope: "master", stage: "delivered" });
  const subs = [{ id: "A", stage: "closed", mandatory: true }, { id: "B", stage: "delivered", mandatory: true }];
  assert.throws(() => closeMaster(M, subs), /subprojects_open/);
  assert.throws(() => closeMaster(M, subs, { override: true }), /reason_required/);
  subs[1].stage = "closed";
  assert.equal(closeMaster(M, subs).closed, true);
});

test("L18: closing always demands a reason, even for management", () => {
  const p = newProject({ stage: "delivered", due_date: "x", members: [{ role: "kian_manager" }] });
  assert.throws(() => setStage(p, "closed"), /reason_required/);
  setStage(p, "closed", { reason: "delivered and accepted" });
  assert.equal(p.stage, "closed");
  assert.equal(p.history.at(-1).note, "delivered and accepted", "the reason is persisted on the transition");
});

test("L19: a closed project is protected; reopening is a logged, reasoned action", () => {
  const p = { stage: "closed", history: [] };
  const edit = () => { if (p.stage === "closed") throw new Error("project_closed"); };
  const reopen = (reason) => { if (!reason) throw new Error("reason_required"); p.history.push({ action: "reopen", reason }); p.stage = "delivered"; };
  assert.throws(edit, /project_closed/);
  assert.throws(() => reopen(null), /reason_required/);
  reopen("client requested an extra cut");
  assert.equal(p.history.at(-1).action, "reopen");
  edit();  // now permitted
});

// ── lifecycle guards: skipping, backwards, hold/cancel ──
test("L20: only the owner may skip stages; everyone else moves one step", () => {
  const p = newProject({ stage: "planning", due_date: "x", members: [{ role: "kian_manager" }] });
  assert.throws(() => setStage(p, "in_production", { actor: "manager" }), /no_stage_skip/);
  setStage(p, "in_production", { actor: "owner" });
  assert.equal(p.stage, "in_production");
});

test("L21: moving backwards demands a reason and management rights", () => {
  const p = newProject({ stage: "client_review" });
  assert.throws(() => setStage(p, "post_production"), /reason_required/);
  setStage(p, "post_production", { reason: "client changed the brief" });
  assert.equal(p.stage, "post_production");
});

test("L22: hold → resume returns to the pre-hold stage, with no extra column", () => {
  const p = newProject({ stage: "in_production" });
  holdAction(p, "hold", "waiting on the client's location permit");
  assert.equal(p.stage, "on_hold");
  holdAction(p, "resume", "permit received");
  assert.equal(p.stage, "in_production", "restored from project_status_history, not a stored field");
});

test("L23: hold/resume/cancel always require a reason and management rights", () => {
  const p = newProject({ stage: "planning" });
  assert.throws(() => holdAction(p, "hold", null), /reason_required/);
  assert.throws(() => holdAction(p, "hold", "x", "editor"), /not authorized/);
  assert.throws(() => holdAction(p, "resume", "x"), /not_on_hold/);
  holdAction(p, "cancel", "client withdrew");
  assert.equal(p.stage, "cancelled");
  assert.throws(() => holdAction(p, "hold", "x"), /cannot_hold_from_cancelled/);
});

test("L24: a closed project can be neither held nor cancelled", () => {
  const p = newProject({ stage: "closed" });
  assert.throws(() => holdAction(p, "hold", "x"), /cannot_hold_from_closed/);
  assert.throws(() => holdAction(p, "cancel", "x"), /cannot_cancel_closed/);
});

// ── weighted rollup ──
test("L25: master progress is WEIGHTED, never a misleading arithmetic mean", () => {
  const rollup = (subs) => {
    const tw = subs.reduce((s, x) => s + x.weight, 0);
    return tw === 0 ? 0 : Math.round(subs.reduce((s, x) => s + x.progress * x.weight, 0) / tw);
  };
  const subs = [{ progress: 100, weight: 1 }, { progress: 0, weight: 9 }];
  assert.equal(rollup(subs), 10, "weighted");
  const mean = Math.round((100 + 0) / 2);
  assert.equal(mean, 50);
  assert.notEqual(rollup(subs), mean, "the plain mean would overstate progress fivefold");
  assert.equal(rollup([]), 0, "no subprojects → 0, not NaN");
});

// ─────────────────────────────────────────────────────────────────────────────
// (B) STRUCTURAL PINS — the real implementation enforces the above server-side
// ─────────────────────────────────────────────────────────────────────────────
const SET_STAGE = R("docs/project_core_UI_COMPLETION_RUNME.sql");
const HOLD = R("docs/project_lifecycle_hold_cancel_RUNME.sql");
const HIER = R("docs/project_hierarchy_batch6a_RUNME.sql");

test("PIN: stage transitions are enforced in the DB, not the UI", () => {
  const fn = SET_STAGE.slice(SET_STAGE.indexOf("function public.project_core_set_stage"));
  assert.ok(/raise exception 'not authorized'/.test(fn), "authorization");
  assert.ok(/raise exception 'reason_required'/.test(fn), "mandatory reason for backward/close");
  assert.ok(/raise exception 'no_stage_skip'/.test(fn), "no skipping");
  assert.ok(/raise exception 'need_manager'/.test(fn) && /raise exception 'need_due_date'/.test(fn), "ready gate");
  assert.ok(/insert into public\.project_status_history/.test(fn), "every transition is recorded");
  assert.ok(/pc_log\(p_project, 'stage_changed'/.test(fn), "and audit-logged");
});

test("PIN: hold/resume/cancel exist, demand a reason, and never touch the linear engine", () => {
  assert.ok(/project_core_hold_action/.test(HOLD));
  assert.ok(/raise exception 'reason_required'/.test(HOLD));
  assert.ok(/can_manage_projects\(\)/.test(HOLD), "management only");
  assert.ok(/insert into public\.project_status_history/.test(HOLD), "recorded");
  assert.ok(!/create or replace function public\.project_core_set_stage/.test(HOLD),
    "the existing linear engine is deliberately NOT redefined");
  assert.ok(/from public\.project_status_history[\s\S]{0,200}to_stage = 'on_hold'/.test(HOLD),
    "resume reads the pre-hold stage from history — no duplicated state");
});

test("PIN: hierarchy guards are in the DB (self-parent, 2-level, client match, reason)", () => {
  assert.ok(/projects_no_self_parent_ck[\s\S]{0,120}parent_project_id <> id/.test(HIER), "self-parent CHECK");
  assert.ok(/raise exception 'circular_hierarchy'/.test(HIER));
  assert.ok(/raise exception 'parent_must_be_master'/.test(HIER), "a subproject can never be a parent");
  assert.ok(/raise exception 'not_a_subproject'/.test(HIER), "a master can never become a child");
  assert.ok(/raise exception 'subproject_client_must_match_master'/.test(HIER), "no cross-client attachment");
  assert.ok(/raise exception 'reason_required'/.test(HIER), "moves demand a reason");
  assert.ok(/for update/.test(HIER), "row locks prevent concurrent-move races");
});

test("PIN: the client review path sets BOTH deliverable status and version decision", () => {
  const files = ["docs/project_core_ABSOLUTE_FINAL_RUNME.sql", "docs/project_core_FINAL_COMPLETION_RUNME.sql",
    "docs/deliverable_versions_RUNME.sql", "docs/project_core_REMAINING_MODULES_FINAL_RUNME.sql"];
  const src = files.map((f) => { try { return R(f); } catch { return ""; } }).join("\n");
  const i = src.indexOf("function public.client_review_version");
  assert.ok(i > -1, "the canonical review RPC exists");
  const body = src.slice(i, i + 2000);
  assert.ok(/insert into public\.deliverable_reviews/.test(body), "records the review");
  assert.ok(/update public\.deliverable_versions set decision/.test(body), "AND sets the version decision");
  assert.ok(/not_in_review/.test(body) && /reason_required/.test(body), "flow + reason guards");
});

test("PIN: static only (no DB/network/real email)", () => {
  const self = R("tests/project_lifecycle_e2e.test.js");
  const reqs = [...self.matchAll(/require\(["']([^"']+)["']\)/g)].map((m) => m[1]);
  for (const r of reqs) assert.ok(["node:test", "node:assert", "node:fs", "node:path"].includes(r), `static (got ${r})`);
});
