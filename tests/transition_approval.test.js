// ════════════════════════════════════════════════════════════════════════════
// tests/transition_approval.test.js
//
// دورة حياة طلب الانتقال، مُنفَّذة من نصّ
// docs/project_transition_approval_RUNME.sql الحقيقيّ عبر مفسّر plpgsql.
// القاعدة الحاكمة: **إنشاء الطلب لا يغيّر شيئًا**، والتنفيذ لا يقع إلّا بقبول
// المالك، ومرّة واحدة، وعلى حالة لم تتغيّر منذ الطلب.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const { makeWorld } = require("./fixtures/project_authz_world");

const REQ = (over = {}) => ({
  p_deliverable: null, p_kind: "status", p_from_value: null,
  p_to_value: null, p_reason: "سبب مكتوب", p_dry_run: false, ...over,
});

/** ينشئ طلبًا ويُعيد {ret,error} دون رمي. */
const mk = (w, over) => w.trCreateVerbose(REQ(over));
const dec = (w, id, decision, note) =>
  w.trDecideVerbose({ p_request: id, p_decision: decision, p_note: note || null, p_dry_run: false });

/** يستخرج معرّف الطلب من قيمة الإرجاع أيًّا كان شكلها. */
function reqId(ret) {
  if (!ret) return null;
  if (typeof ret === "string") return ret;
  return ret.request_id || ret.id || (ret.request && (ret.request.id || ret.request.request_id)) || null;
}

// ─── (أ) الإنشاء لا يغيّر الهدف ─────────────────────────────────────────────

test("15 · إنشاء الطلب لا يغيّر المخرج ولا المشروع", () => {
  const w = makeWorld(); const { P1, D1 } = w.ids;
  w.as("editor");
  const before = JSON.stringify({ d: w.db.deliverables, p: w.db.projects, pc: w.db.project_core });
  const r = mk(w, { p_project: P1, p_deliverable: D1, p_kind: "status", p_to_value: "client_review" });
  assert.ok(!r.error, r.error && String(r.error.message || r.error));
  const after = JSON.stringify({ d: w.db.deliverables, p: w.db.projects, pc: w.db.project_core });
  assert.equal(after, before, "الطلب غيّر الهدف — ممنوع قطعًا");
  assert.equal(w.requests().length, 1, "لم يُسجَّل الطلب");
  assert.equal(w.requests()[0].status, "pending");
});

test("16 · السبب إلزاميّ", () => {
  const w = makeWorld(); const { P1, D1 } = w.ids;
  w.as("editor");
  for (const bad of [null, "", "   "]) {
    const r = mk(w, { p_project: P1, p_deliverable: D1, p_to_value: "client_review", p_reason: bad });
    assert.ok(r.error, `قُبل طلب بسبب فارغ: ${JSON.stringify(bad)}`);
  }
  assert.equal(w.requests().length, 0);
});

test("17 · المونتير لا يطلب على مشروع ليس مُسنَدًا عليه", () => {
  const w = makeWorld(); const { P9, D2 } = w.ids;
  w.as("editor");
  const r = mk(w, { p_project: P9, p_deliverable: D2, p_to_value: "approved" });
  assert.ok(r.error, "أنشأ طلبًا على مشروع خارج نطاقه");
});

// ─── (ب) مَن يعتمد ──────────────────────────────────────────────────────────

test("18 · مقدّم الطلب لا يعتمد طلبه — ولو كان مالكًا", () => {
  for (const who of ["editor", "owner"]) {
    const w = makeWorld(); const { P1, D1 } = w.ids;
    w.as(who);
    const id = reqId(mk(w, { p_project: P1, p_deliverable: D1, p_to_value: "client_review" }).ret);
    assert.ok(id, "لم يُنشأ الطلب");
    const r = dec(w, id, "approve");
    assert.ok(r.error, `${who} اعتمد طلبه بنفسه`);
    assert.equal(w.requests()[0].status, "pending");
  }
});

test("19 · لا يعتمد الطلب موظّف آخر ولا عميل", () => {
  const w = makeWorld(); const { P1, D1 } = w.ids;
  w.as("editor");
  const id = reqId(mk(w, { p_project: P1, p_deliverable: D1, p_to_value: "client_review" }).ret);
  for (const who of ["employee", "outsider", "client", "project_manager"]) {
    w.as(who);
    assert.ok(dec(w, id, "approve").error, `${who} اعتمد الطلب`);
  }
  assert.equal(w.requests()[0].status, "pending");
});

// ─── (ج) القرار ─────────────────────────────────────────────────────────────

test("20 · الرفض لا يغيّر الهدف", () => {
  const w = makeWorld(); const { P1, D1 } = w.ids;
  w.as("editor");
  const id = reqId(mk(w, { p_project: P1, p_deliverable: D1, p_to_value: "client_review" }).ret);
  const before = JSON.stringify(w.db.deliverables);
  w.as("owner");
  const r = dec(w, id, "reject", "غير الآن");
  assert.ok(!r.error, r.error && String(r.error.message || r.error));
  assert.equal(JSON.stringify(w.db.deliverables), before, "الرفض غيّر المخرج");
  assert.equal(w.requests()[0].status, "rejected");
});

test("21 · القبول ينفّذ الانتقال مرّة واحدة فقط", () => {
  const w = makeWorld(); const { P1, D1 } = w.ids;
  w.as("editor");
  const id = reqId(mk(w, { p_project: P1, p_deliverable: D1, p_to_value: "client_review" }).ret);
  w.as("owner");
  assert.ok(!dec(w, id, "approve").error);
  assert.equal(w.deliverable(D1).status, "client_review", "لم يُنفَّذ الانتقال بعد القبول");
  const snap = w.snapshot();
  const again = dec(w, id, "approve");
  assert.ok(again.error || w.snapshot() === snap, "نُفّذ الانتقال مرّتين");
  assert.equal(w.snapshot(), snap, "القبول الثاني غيّر الحالة");
});

test("22 · طلب بائت لا يُنفَّذ إذا تغيّرت الحالة بعد إنشائه", () => {
  const w = makeWorld(); const { P1, D1 } = w.ids;
  w.as("editor");
  const id = reqId(mk(w, {
    p_project: P1, p_deliverable: D1, p_kind: "status",
    p_from_value: w.deliverable(D1).status, p_to_value: "client_review",
  }).ret);
  // المالك يغيّر الحالة يدويًّا قبل أن يبتّ في الطلب.
  w.deliverable(D1).status = "approved";
  w.as("owner");
  const r = dec(w, id, "approve");
  assert.ok(r.error || w.requests()[0].status !== "approved",
    "نُفِّذ طلب على حالة تغيّرت — انتقال على بيانات قديمة");
  assert.equal(w.deliverable(D1).status, "approved", "دهس الطلب البائت الحالة الجديدة");
});

test("23 · لا يُنشأ طلبان معلّقان لنفس الانتقال", () => {
  const w = makeWorld(); const { P1, D1 } = w.ids;
  w.as("editor");
  const a = mk(w, { p_project: P1, p_deliverable: D1, p_to_value: "client_review" });
  assert.ok(!a.error);
  const b = mk(w, { p_project: P1, p_deliverable: D1, p_to_value: "client_review" });
  const pending = w.requests().filter((r) => r.status === "pending");
  assert.ok(b.error || pending.length === 1,
    `أُنشئ طلب مكرّر: ${pending.length} طلبات معلّقة`);
});

// ─── (د) الأثر الجانبيّ: تدقيق وإشعارات ─────────────────────────────────────

test("24 · الطلب والقرار يُسجَّلان، والعميل لا يُشعَر", () => {
  const w = makeWorld(); const { P1, D1 } = w.ids;
  w.as("editor");
  const id = reqId(mk(w, { p_project: P1, p_deliverable: D1, p_to_value: "client_review" }).ret);
  w.as("owner");
  dec(w, id, "approve", "موافق");
  const row = w.requests()[0];
  assert.equal(row.status, "approved");
  assert.ok(row.decided_by || row.reviewed_by, "لم يُسجَّل مَن قرّر");
  assert.ok(row.executed_at, "لم يُسجَّل وقت التنفيذ");
  const toClient = (w.log.notify || []).filter((n) => JSON.stringify(n).includes("u-client"));
  assert.equal(toClient.length, 0, "أُشعِر العميل بطلب داخليّ");
});

test("25 · dry run لا يكتب شيئًا", () => {
  const w = makeWorld(); const { P1, D1 } = w.ids;
  w.as("editor");
  const before = w.snapshot();
  w.trCreateVerbose(REQ({ p_project: P1, p_deliverable: D1, p_to_value: "client_review", p_dry_run: true }));
  assert.equal(w.snapshot(), before, "dry run كتب");
  assert.equal(w.requests().length, 0, "dry run أنشأ طلبًا");
});
