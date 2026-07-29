// ════════════════════════════════════════════════════════════════════════════
// tests/import_conflict_detection.test.js — the ACCEPTANCE CRITERIA for change
// and conflict detection.
//
// EVERY fixture here is SYNTHETIC. No client file is read, none is required to
// exist, and no private input directory is touched — the tests must pass on a
// fresh clone that never had the owner's workbook, which is exactly the state
// the repository is being pushed in. The last test in the file enforces that.
//
// The key strategy under test is the owner's decision, unchanged: normalized
// title + occurrence. Its one hole — renaming a title changes the key — is what
// these tests pin shut:
//   • re-importing the same file creates nothing,
//   • editing a caption is an UPDATE CANDIDATE, never an automatic write,
//   • renaming a title is a SOURCE-ROW CONFLICT, never a silent second copy,
//   • adding a row creates exactly one row,
//   • deleting a row from the file deletes NOTHING,
//   • inserting a row ABOVE everything re-creates NOTHING (the regression a
//     row-number key strategy would have caused).
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadTs } = require("./import_engine_loader");

const { buildPlan } = loadTs("lib/portal/import/preview.ts");
const { parseWorkbook, pickSheet } = loadTs("lib/portal/import/parse.ts");
const { DEFAULT_PROFILE } = loadTs("lib/portal/import/profile.ts");
const { comparableFields, isStructuralKey } = loadTs("lib/portal/import/change.ts");
const { buildExecutePayload, executeImport, gatePlanForWrite } = loadTs("lib/portal/import/execute.ts");
const { lookupProjectRows } = loadTs("lib/portal/import/rpc.ts");

const PROFILE = DEFAULT_PROFILE;
const PROJECT_KEY = "مشروع-تجريبي";
const PROJECT_ID = "11111111-2222-3333-4444-555555555555";

// ─── synthetic fixtures ────────────────────────────────────────────────────

const HEADER = "المرحلة,المحتوى,نوع المحتوى,نص الوصف المقترح";
/** The baseline file: header on row 1, three deliverables on rows 2, 3 and 4. */
const BASE_ROWS = [
  "تمهيد,فيديو تعريفي,فيديو,نص أول",
  "تمهيد,صورة الفريق,صورة,نص ثانٍ",
  "إطلاق,ريلز الإطلاق,فيديو,نص ثالث",
];
const csv = (rows) => [HEADER, ...rows].join("\n");

function planFor(rows, context = {}) {
  const wb = parseWorkbook(csv(rows), "plan.csv");
  const picked = pickSheet(wb, null);
  return buildPlan({
    sheet: picked.sheet,
    profile: PROFILE,
    context: { projectId: PROJECT_ID, projectKey: PROJECT_KEY, ...context },
    fileName: "plan.csv",
  });
}

/**
 * What the database holds after a plan was imported — the SAME information the
 * project-wide lookup returns: key, row number, title, hash and the comparable
 * field values. Hierarchy nodes are stored too, so the tests also prove that a
 * structural key is never mistaken for a missing deliverable.
 */
function storeOf(plan) {
  const existing = {};
  for (const d of plan.deliverables) {
    existing[d.external_key] = {
      id: `del-${d.source_row_number}`,
      content_hash: d.content_hash,
      source_row_number: d.source_row_number,
      title: d.title,
      fields: comparableFields(d),
    };
  }
  for (const n of plan.nodes) {
    existing[n.key] = { id: `node-${n.sequence}`, content_hash: null, source_row_number: null, title: n.title, fields: null };
  }
  return existing;
}

/** A plan built against a COMPLETE project-wide read (the deployed state). */
const against = (rows, existing) => planFor(rows, { existing, existingLookupAvailable: true, existingSetComplete: true });

const FIRST = planFor(BASE_ROWS, { existingLookupAvailable: false });
const STORE = storeOf(FIRST);

test("the baseline file plans three deliverables and two stages", () => {
  assert.equal(FIRST.ok, true);
  assert.equal(FIRST.deliverables.length, 3);
  assert.deepEqual(
    FIRST.deliverables.map((d) => d.source_row_number),
    [2, 3, 4],
  );
  assert.equal(FIRST.counts.toCreate, 3);
  assert.equal(FIRST.counts.deliverablesToCreate, FIRST.counts.toCreate, "the legacy count must keep matching");
});

// ─── 1. identical re-import ────────────────────────────────────────────────
test("re-importing an identical file creates nothing: toCreate 0, unchanged = all", () => {
  const plan = against(BASE_ROWS, STORE);
  assert.equal(plan.counts.toCreate, 0);
  assert.equal(plan.counts.unchanged, 3);
  assert.equal(plan.counts.updateCandidates, 0);
  assert.equal(plan.counts.sourceRowConflicts, 0);
  assert.equal(plan.counts.missingFromFile, 0);
  assert.equal(plan.counts.invalid, 0);
  assert.equal(plan.deliverables.every((d) => d.action === "unchanged"), true);
  // The legacy fields stay truthful for every existing reader.
  assert.equal(plan.counts.deliverablesToCreate, 0);
  assert.equal(plan.counts.deliverablesUnchanged, 3);
  assert.equal(plan.counts.deliverablesToUpdate, 0);
});

test("nothing is written for an identical re-import, and the payload is empty", async () => {
  const plan = against(BASE_ROWS, STORE);
  const { payload, attempted } = buildExecutePayload(plan, { mode: "commit" });
  assert.equal(attempted.length, 0);
  assert.equal(payload.rows.length, 0);
});

// ─── 2. an edited caption ──────────────────────────────────────────────────
test("changing only proposed_caption yields updateCandidates 1 and toCreate 0", () => {
  const rows = [...BASE_ROWS];
  rows[1] = "تمهيد,صورة الفريق,صورة,نص ثانٍ بعد التعديل";
  const plan = against(rows, STORE);

  assert.equal(plan.counts.updateCandidates, 1);
  assert.equal(plan.counts.toCreate, 0);
  assert.equal(plan.counts.unchanged, 2);
  assert.equal(plan.counts.sourceRowConflicts, 0);
  assert.equal(plan.counts.missingFromFile, 0);

  const c = plan.updateCandidates[0];
  assert.equal(c.rowNumber, 3, "the operator is told WHICH row changed");
  assert.equal(c.existingId, "del-3");
  assert.deepEqual(c.changes.map((x) => x.field), ["proposed_caption"], "and WHAT changed — only the caption");
  assert.equal(c.changes[0].from, "نص ثانٍ");
  assert.equal(c.changes[0].to, "نص ثانٍ بعد التعديل");
  assert.match(c.reason, /نص الوصف المقترح/);
});

test("an update candidate is NEVER written without its own confirmation", async () => {
  const rows = [...BASE_ROWS];
  rows[1] = "تمهيد,صورة الفريق,صورة,نص ثانٍ بعد التعديل";
  const plan = against(rows, STORE);

  const held = gatePlanForWrite(plan, { mode: "commit" });
  assert.equal(held.ok, true);
  assert.equal(held.gate.plan.deliverables.filter((d) => d.action === "update").length, 0, "the update reached the write path unconfirmed");
  assert.equal(held.gate.heldUpdates, 1);
  assert.match(held.gate.notes.join(" "), /لم تُطبَّق/);

  const applied = gatePlanForWrite(plan, { mode: "commit", applyUpdates: true });
  assert.equal(applied.gate.plan.deliverables.filter((d) => d.action === "update").length, 1, "an explicit confirmation must let it through");
  assert.equal(applied.gate.heldUpdates, 0);
});

// ─── 3. the renamed title (the whole point) ────────────────────────────────
test("changing the title at the same source row is a conflict, not a duplicate", () => {
  const rows = [...BASE_ROWS];
  rows[1] = "تمهيد,صورة الفريق الجديدة,صورة,نص ثانٍ";
  const plan = against(rows, STORE);

  assert.equal(plan.counts.sourceRowConflicts, 1);
  assert.equal(plan.counts.toCreate, 0, "a renamed row must NEVER count as a creation");
  assert.equal(plan.counts.unchanged, 2);
  assert.equal(plan.counts.updateCandidates, 0);
  assert.equal(plan.counts.missingFromFile, 0, "the stranded record is explained by the conflict, not double-reported");

  const conflict = plan.sourceRowConflicts[0];
  assert.equal(conflict.rowNumber, 3);
  assert.equal(conflict.newTitle, "صورة الفريق الجديدة");
  assert.equal(conflict.existingTitle, "صورة الفريق", "the operator is told which record this row used to be");
  assert.equal(conflict.existingId, "del-3");
  assert.notEqual(conflict.newKey, conflict.existingKey);
  assert.match(conflict.reason, /السطر 3/);

  const row = plan.deliverables.find((d) => d.source_row_number === 3);
  assert.equal(row.action, "source_row_conflict");
  assert.equal(row.conflictWith.external_key, conflict.existingKey);
});

test("a commit is REFUSED while a conflict is unanswered, before any database call", async () => {
  const rows = [...BASE_ROWS];
  rows[1] = "تمهيد,صورة الفريق الجديدة,صورة,نص ثانٍ";
  const plan = against(rows, STORE);

  const calls = [];
  const call = async (fn, args) => {
    calls.push(fn);
    return { ok: false, error: "PGRST202 | Could not find the function", status: 404 };
  };
  const res = await executeImport(plan, { mode: "commit" }, call);
  assert.equal(res.ok, false);
  assert.equal(res.code, "REFUSED_ROW_CONFLICTS");
  assert.equal(res.created, 0);
  assert.equal(calls.length, 0, "an unanswered conflict must cost zero database calls");
  assert.match(res.message, /نسخة ثانية/);
});

test("a blanket confirmation applies NEITHER updates nor conflicts", () => {
  const rows = ["تمهيد,فيديو تعريفي,فيديو,نص أول", "تمهيد,صورة الفريق الجديدة,صورة,نص ثانٍ", "إطلاق,ريلز الإطلاق,فيديو,نص ثالث معدّل"];
  const plan = against(rows, STORE);
  assert.equal(plan.counts.sourceRowConflicts, 1);
  assert.equal(plan.counts.updateCandidates, 1);

  // "skipInvalidRows" is the blanket acknowledgement of the OLD flow: on its own
  // it must move neither of the two new decisions.
  const blanket = gatePlanForWrite(plan, { mode: "commit", skipInvalidRows: true });
  assert.equal(blanket.ok, false, "conflicts must still stop the write");

  // Answering the conflict must NOT smuggle the update through with it.
  const conflictOnly = gatePlanForWrite(plan, { mode: "commit", conflictResolution: "create" });
  assert.equal(conflictOnly.ok, true);
  assert.equal(conflictOnly.gate.plan.deliverables.filter((d) => d.action === "source_row_conflict").length, 1);
  assert.equal(conflictOnly.gate.plan.deliverables.filter((d) => d.action === "update").length, 0, "the update slipped in on the conflict's confirmation");
  assert.equal(conflictOnly.gate.heldUpdates, 1);
});

test("conflictResolution 'skip' leaves the conflicting row out of the payload entirely", () => {
  const rows = [...BASE_ROWS, "إطلاق,محتوى جديد تمامًا,صورة,نص رابع"];
  rows[1] = "تمهيد,صورة الفريق الجديدة,صورة,نص ثانٍ";
  const plan = against(rows, STORE);
  assert.equal(plan.counts.sourceRowConflicts, 1);
  assert.equal(plan.counts.toCreate, 1);

  const gated = gatePlanForWrite(plan, { mode: "commit", conflictResolution: "skip" });
  const { payload } = buildExecutePayload(gated.gate.plan, { mode: "commit" });
  assert.equal(payload.rows.length, 1, "only the genuinely new row may be written");
  assert.equal(payload.rows[0].title, "محتوى جديد تمامًا");
  assert.equal(gated.gate.skippedConflicts, 1);
  assert.match(gated.gate.notes.join(" "), /لم يُحذف السجل الأصلي/);
});

// ─── 4. a new row ──────────────────────────────────────────────────────────
test("adding one new row creates exactly one", () => {
  const plan = against([...BASE_ROWS, "إطلاق,بث مباشر,فيديو,نص رابع"], STORE);
  assert.equal(plan.counts.toCreate, 1);
  assert.equal(plan.counts.unchanged, 3);
  assert.equal(plan.counts.updateCandidates, 0);
  assert.equal(plan.counts.sourceRowConflicts, 0);
  assert.equal(plan.counts.missingFromFile, 0);
  assert.equal(plan.deliverables.filter((d) => d.action === "create").length, 1);
  assert.equal(plan.deliverables.find((d) => d.action === "create").title, "بث مباشر");
});

// ─── 5. a deleted row ──────────────────────────────────────────────────────
test("deleting a row from the file reports it and deletes NOTHING", () => {
  const plan = against([BASE_ROWS[0], BASE_ROWS[2]], STORE);
  assert.equal(plan.counts.missingFromFile, 1);
  assert.equal(plan.counts.toCreate, 0);
  assert.equal(plan.counts.unchanged, 2, "the surviving rows keep their identity even though their row numbers moved");
  assert.equal(plan.counts.sourceRowConflicts, 0);

  const gone = plan.missingFromFile[0];
  assert.equal(gone.title, "صورة الفريق");
  assert.equal(gone.id, "del-3");
  assert.match(gone.reason, /لم يُحذف شيء/);

  // Nothing in the write path can act on it: the payload has no delete concept
  // and the key never appears in it.
  const gated = gatePlanForWrite(plan, { mode: "commit", applyUpdates: true });
  const { payload } = buildExecutePayload(gated.gate.plan, { mode: "commit" });
  assert.equal(payload.rows.length, 0);
  assert.equal(JSON.stringify(payload).includes(gone.external_key), false);
  assert.equal(JSON.stringify(payload).toLowerCase().includes("delete"), false);
});

test("hierarchy nodes are never reported as records missing from the file", () => {
  const plan = against(BASE_ROWS, STORE);
  assert.equal(plan.counts.missingFromFile, 0);
  assert.equal(Object.keys(STORE).some((k) => isStructuralKey(k)), true, "the fixture must actually contain node keys");
});

// ─── 6. THE REGRESSION: a row inserted above everything ────────────────────
test("inserting a row ABOVE all others re-creates nothing below it", () => {
  const plan = against(["تمهيد,مقدمة مضافة أعلى الملف,فيديو,نص جديد", ...BASE_ROWS], STORE);

  assert.equal(plan.counts.toCreate, 1, "only the inserted row is new");
  assert.equal(plan.counts.unchanged, 3, "every shifted row must stay unchanged");
  assert.equal(plan.counts.updateCandidates, 0);
  assert.equal(plan.counts.sourceRowConflicts, 0, "a shifted row is NOT a conflict: its key is still claimed by the file");
  assert.equal(plan.counts.missingFromFile, 0);

  const created = plan.deliverables.filter((d) => d.action === "create");
  assert.equal(created.length, 1);
  assert.equal(created[0].title, "مقدمة مضافة أعلى الملف");
  assert.equal(created[0].source_row_number, 2);

  // The three originals moved from rows 2,3,4 to 3,4,5 and kept their identity.
  const moved = plan.deliverables.filter((d) => d.action === "unchanged");
  assert.deepEqual(moved.map((d) => d.source_row_number), [3, 4, 5]);
  assert.deepEqual(moved.map((d) => d.existingId), ["del-2", "del-3", "del-4"]);
});

test("a row REMOVED from the top does not strand or duplicate the rows below", () => {
  const plan = against(BASE_ROWS.slice(1), STORE);
  assert.equal(plan.counts.toCreate, 0);
  assert.equal(plan.counts.unchanged, 2);
  assert.equal(plan.counts.sourceRowConflicts, 0);
  assert.equal(plan.counts.missingFromFile, 1, "only the row that really left the file is reported");
  assert.equal(plan.missingFromFile[0].title, "فيديو تعريفي");
});

// ─── honesty when the database cannot answer fully ─────────────────────────
test("a key-only lookup keeps create/update but INVENTS no conflicts and no deletions", () => {
  const legacy = {};
  for (const key of Object.keys(STORE)) legacy[key] = { id: STORE[key].id, content_hash: STORE[key].content_hash };
  const rows = [...BASE_ROWS];
  rows[1] = "تمهيد,صورة الفريق الجديدة,صورة,نص ثانٍ";
  const plan = planFor(rows, { existing: legacy, existingLookupAvailable: true, existingSetComplete: false });

  assert.equal(plan.counts.sourceRowConflicts, 0, "with no stored row numbers a conflict cannot be claimed");
  assert.equal(plan.counts.missingFromFile, 0, "a partial read must never report records as missing");
  assert.equal(plan.counts.toCreate, 1, "the renamed row degrades to a plain create — which is what the report must say");
  assert.equal(plan.changeDetection.existingSetComplete, false);
  assert.equal(plan.changeDetection.sourceRowNumbersKnown, false);
  assert.ok(plan.changeDetection.note, "the plan must SAY which checks it could not run");
  assert.ok(plan.warnings.some((w) => w.code === "change_detection_unavailable"));
});

test("with no lookup at all every row reads as new and the plan says so", () => {
  const plan = planFor(BASE_ROWS, { existingLookupAvailable: false });
  assert.equal(plan.existingLookupAvailable, false);
  assert.equal(plan.changeDetection.existingLookupAvailable, false);
  assert.equal(plan.counts.toCreate, 3);
  assert.equal(plan.counts.sourceRowConflicts, 0);
  assert.equal(plan.counts.missingFromFile, 0);
});

test("the project-wide lookup degrades to 'unavailable' when its RPC is absent", async () => {
  const missing = await lookupProjectRows(async () => ({ ok: false, error: "PGRST202 | Could not find the function", status: 404 }), {
    projectId: PROJECT_ID,
    profileId: PROFILE.id,
  });
  assert.equal(missing.available, false);
  assert.equal(missing.complete, false);
  assert.equal(missing.reason, null, "a migration that has not run yet is not an error to shout about");

  const partial = await lookupProjectRows(
    async () => ({ ok: true, data: { complete: false, rows: [{ external_key: "k", id: "1", content_hash: "h", source_row_number: "7", title: "t" }] } }),
    { projectId: PROJECT_ID, profileId: PROFILE.id },
  );
  assert.equal(partial.available, true);
  assert.equal(partial.complete, false, "a truncated answer must never be treated as the whole project");
  assert.equal(partial.existing.k.source_row_number, 7);
});

// ─── the seven first-class counts ──────────────────────────────────────────
test("the preview exposes all seven outcomes as first-class counts", () => {
  const plan = against(BASE_ROWS, STORE);
  for (const key of ["toCreate", "unchanged", "updateCandidates", "sourceRowConflicts", "missingFromFile", "invalid", "warnings"]) {
    assert.equal(typeof plan.counts[key], "number", `counts.${key} is missing`);
  }
  assert.equal(plan.counts.warnings, plan.warnings.length);
  assert.ok(Array.isArray(plan.updateCandidates));
  assert.ok(Array.isArray(plan.sourceRowConflicts));
  assert.ok(Array.isArray(plan.missingFromFile));
});

test("every accepted row lands in exactly one outcome", () => {
  const rows = ["تمهيد,فيديو تعريفي,فيديو,نص أول", "تمهيد,صورة الفريق الجديدة,صورة,نص ثانٍ", "إطلاق,ريلز الإطلاق,فيديو,نص ثالث معدّل", "إطلاق,عمل جديد,صورة,نص رابع"];
  const plan = against(rows, STORE);
  const buckets = { create: 0, unchanged: 0, update: 0, source_row_conflict: 0 };
  for (const d of plan.deliverables) buckets[d.action]++;
  assert.deepEqual(buckets, { create: 1, unchanged: 1, update: 1, source_row_conflict: 1 });
  assert.equal(buckets.create + buckets.unchanged + buckets.update + buckets.source_row_conflict, plan.deliverables.length);
  assert.equal(plan.counts.toCreate, 1);
  assert.equal(plan.counts.unchanged, 1);
  assert.equal(plan.counts.updateCandidates, 1);
  assert.equal(plan.counts.sourceRowConflicts, 1);
});

test("the change listings are bounded while the counts stay exact", () => {
  const rows = [];
  for (let i = 1; i <= 620; i++) rows.push(`تمهيد,عنصر رقم ${i},فيديو,نص ${i}`);
  const store = storeOf(planFor(rows, { existingLookupAvailable: false }));
  const edited = rows.map((_, i) => `تمهيد,عنصر رقم ${i + 1},فيديو,نص معدّل ${i + 1}`);
  const plan = against(edited, store);

  assert.equal(plan.counts.updateCandidates, 620, "the COUNT must never be capped");
  assert.equal(plan.counts.toCreate, 0);
  assert.ok(plan.updateCandidates.length <= 500, "the LISTING must be bounded");
  assert.ok(plan.warnings.some((w) => w.code === "truncated"), "a bounded listing must say it is bounded");
});

// ─── this suite must not depend on the owner's real file ──────────────────
test("no fixture in this suite reads a client file from disk", () => {
  const src = require("node:fs").readFileSync(__filename, "utf8");
  // The needles are assembled at runtime so this very assertion does not put the
  // forbidden paths into the file it is checking.
  const needles = [["docs", "input"].join("/"), ["docs", "private-imports"].join("/"), ["MISBAR", "10_PLAN"].join(""), ["misbar", "10_"].join("")];
  for (const needle of needles) {
    assert.equal(src.includes(needle), false, `this suite must not reference ${needle}`);
  }
});
