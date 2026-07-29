// ════════════════════════════════════════════════════════════════════════════
// tests/misbar10_local_acceptance_batch4.test.js — LOCAL ACCEPTANCE of the real
// owner workbook against the REAL engine, for the three edits the owner will
// actually make to a plan after it has been imported once.
//
// WHY THIS FILE EXISTS ALONGSIDE misbar10_real_file_import.test.js
//   That suite proves the FIGURES (1 project / 11 blocks / 79 deliverables) and
//   the re-import case, and it simulates "one row changed" by handing the engine
//   a FAKE content hash. Faking a hash proves the classifier reacts to a hash;
//   it does not prove the engine derives the right hash from an edited FILE.
//   Everything below edits an actual .xlsx and re-reads it, so the whole chain —
//   ZIP, shared strings, mapping, key derivation, hashing, classification — is
//   what decides the outcome. All three cases are real, and all three are the
//   ones that silently duplicate or silently destroy data when they go wrong:
//     1. a caption edited      → exactly 1 update CANDIDATE, 0 creates
//     2. a title edited        → a CONFLICT, never a create (no stranded twin)
//     3. a row deleted         → reported missing, and NOTHING is deleted
//
// THE COPY IS ROW-NUMBER ALIGNED, ON PURPOSE
//   Excel omits fully-blank rows from the sheet XML, so the real sheet's row
//   numbers contain gaps. Rebuilding the grid densely would renumber every row
//   below the first gap, and the renumbering — not the edit — would then drive
//   conflict detection, which keys off (project, source row). The grid below is
//   indexed by TRUE row number with the omitted blanks restored, so the source
//   row numbers of all 79 deliverables come out identical to the real file's.
//   The test asserts that identity before it trusts a single mutation result.
//
// NOTHING IS WRITTEN TO DISK. The mutated workbooks exist only as byte arrays,
// so the owner's file cannot be touched even by a bug in this file.
//
// CLIENT DATA: the workbook is git-ignored and absent on CI, Vercel and fresh
// clones; every test then SKIPS with an explicit reason (see
// tests/misbar10_private_paths.js). Not one assertion below names a title, a
// caption or a stage — rows are addressed by number and by count only.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { loadTs, makeXlsx } = require("./import_engine_loader");
const { localAcceptanceInputs } = require("./misbar10_private_paths.js");

const REAL = localAcceptanceInputs("misbar10_local_acceptance_batch4.test.js", ["workbook"]);
const opts = REAL.opts;
const PRESENT = REAL.present;

const { parseWorkbook, pickSheet } = loadTs("lib/portal/import/parse.ts");
const { buildPlan } = loadTs("lib/portal/import/preview.ts");
const { resolveProfile } = loadTs("lib/portal/import/profiles.ts");
const { comparableFields } = loadTs("lib/portal/import/change.ts");
const { buildBatchRows } = loadTs("lib/portal/import/batchBackend.ts");
const { buildExecutePayload, gatePlanForWrite } = loadTs("lib/portal/import/execute.ts");
const PROFILE = resolveProfile(loadTs("docs/import_profiles/misbar10.json"));

/** The exact pipeline /api/portal/import/preview runs. No simulation. */
function planOf(bytes, existing, setComplete) {
  const wb = parseWorkbook(bytes, "plan.xlsx");
  const picked = pickSheet(wb, PROFILE.sheet);
  return buildPlan({
    sheet: picked.sheet,
    profile: PROFILE,
    context: {
      projectKey: "local-acceptance-batch4",
      parentProjectTitle: "مشروع الاختبار",
      existing,
      existingLookupAvailable: true,
      existingSetComplete: !!setComplete,
    },
    fileName: "plan.xlsx",
    carriedWarnings: wb.warnings.concat(picked.warnings),
  });
}

const S = (() => {
  if (!PRESENT) return null;
  const bytes = new Uint8Array(fs.readFileSync(REAL.paths.workbook));
  const real = planOf(bytes, {}, true);
  const sheet = pickSheet(parseWorkbook(bytes, "plan.xlsx"), PROFILE.sheet).sheet;

  // Grid indexed by TRUE row number; rows Excel omitted come back as blanks.
  const maxRow = Math.max.apply(null, sheet.rows.map((r) => r.rowNumber));
  const grid = [];
  for (let i = 0; i < maxRow; i++) grid.push([]);
  for (const r of sheet.rows) grid[r.rowNumber - 1] = r.cells.map((c) => (c == null ? "" : String(c)));
  const rebuild = (rows) => new Uint8Array(makeXlsx(rows, { sheetName: sheet.name }));

  // The database as it stands AFTER a first successful import of the real file.
  const existing = {};
  for (const d of real.deliverables) {
    existing[d.external_key] = {
      id: `id-${d.external_key}`,
      content_hash: d.content_hash,
      source_row_number: d.source_row_number,
      title: d.title,
      fields: comparableFields(d),
    };
  }
  for (const n of real.nodes) existing[n.key] = { id: `node-${n.key}`, content_hash: null, source_row_number: null, title: n.title, fields: null };
  existing[real.parentProject.key] = { id: "id-parent", content_hash: null, source_row_number: null, title: real.parentProject.title, fields: null };

  // A deliverable with a caption, a title unique in the file, and a source row
  // BELOW the first omitted blank — so the alignment above is actually exercised.
  const titleCount = {};
  for (const d of real.deliverables) titleCount[d.title] = (titleCount[d.title] || 0) + 1;
  const target = real.deliverables.filter((d) => d.proposed_caption !== null && titleCount[d.title] === 1 && d.source_row_number > 25)[0];

  const capCol = real.mapping.find((m) => m.field === "proposed_caption").index;
  const titleCol = real.mapping.find((m) => m.field === "title").index;
  const edited = (col, suffix) => {
    const g = grid.map((r) => r.slice());
    g[target.source_row_number - 1][col] = g[target.source_row_number - 1][col] + suffix;
    return rebuild(g);
  };

  return {
    real,
    existing,
    target,
    baseline: rebuild(grid),
    captionEdited: edited(capCol, " ✎"),
    titleEdited: edited(titleCol, " (٢)"),
    rowDeleted: rebuild(grid.filter((_, i) => i !== target.source_row_number - 1)),
  };
})();

// ALWAYS RUNS: a suite that never ran must never look like a suite that passed.
test("batch4 local acceptance status is REPORTED, never assumed", () => {
  if (PRESENT) {
    assert.ok(S !== null, "the workbook is present but no scenario set was built");
    assert.ok(S.target, "no usable target row was found — the scenarios below would be vacuous");
    return;
  }
  assert.equal(S, null, "no workbook, yet scenarios exist — something fabricated them");
  assert.match(String(REAL.reason), /SKIPPED/, "the skip reason does not say it skipped");
  assert.deepEqual(opts, { skip: REAL.reason }, "the skip reason is not attached to the tests");
});

test("the mutable copy is the real file: same keys, same hashes, same source rows", opts, () => {
  const copy = planOf(S.baseline, {}, true);
  const real = S.real;
  assert.deepEqual(copy.deliverables.map((d) => d.source_row_number), real.deliverables.map((d) => d.source_row_number), "row-number alignment was lost — conflict detection would be tested against the wrong rows");
  assert.deepEqual(copy.deliverables.map((d) => d.external_key), real.deliverables.map((d) => d.external_key));
  assert.deepEqual(copy.deliverables.map((d) => d.content_hash), real.deliverables.map((d) => d.content_hash));
  assert.deepEqual(copy.nodes, real.nodes);
  assert.equal(copy.counts.accepted, real.counts.accepted);
  assert.equal(copy.counts.invalid, 0);
  assert.equal(copy.counts.duplicate, 0);
  // The copy carries one sheet, so it lacks the real file's "second sheet
  // ignored" note; `skipped` grows by the blank rows Excel had omitted. Those
  // two differences are the ONLY ones permitted, and both are inert.
  assert.ok(copy.counts.skipped >= real.counts.skipped, "the copy skipped fewer rows than the real file");
  assert.equal(copy.counts.accepted + copy.counts.duplicate + copy.counts.invalid, real.counts.accepted);
});

test("re-importing the unchanged file creates nothing and changes nothing", opts, () => {
  for (const bytes of [S.baseline, new Uint8Array(fs.readFileSync(REAL.paths.workbook))]) {
    const p = planOf(bytes, S.existing, true);
    assert.equal(p.counts.toCreate, 0, "a re-import would duplicate the plan");
    assert.equal(p.counts.deliverablesToCreate, 0);
    assert.equal(p.counts.updateCandidates, 0);
    assert.equal(p.counts.sourceRowConflicts, 0);
    assert.equal(p.counts.missingFromFile, 0);
    assert.equal(p.counts.stagesToCreate, 0);
    assert.equal(p.counts.parentProjectsToCreate, 0);
    assert.equal(p.counts.unchanged, p.deliverables.length);
    // and nothing reaches the database beyond the idempotent block upserts
    const batch = buildBatchRows(p, PROFILE, { includeUnchanged: false });
    assert.equal(batch.rows.filter((r) => r.entity_type === "deliverable").length, 0, "a deliverable row was queued for an unchanged re-import");
  }
});

test("one edited caption ⇒ exactly one update CANDIDATE, zero creates", opts, () => {
  const p = planOf(S.captionEdited, S.existing, true);
  assert.equal(p.counts.toCreate, 0, "an edited caption created a second deliverable");
  assert.equal(p.counts.deliverablesToCreate, 0);
  assert.equal(p.counts.sourceRowConflicts, 0);
  assert.equal(p.counts.missingFromFile, 0);
  assert.equal(p.counts.invalid, 0);
  assert.equal(p.counts.updateCandidates, 1);
  assert.equal(p.counts.unchanged, p.deliverables.length - 1);
  assert.deepEqual(p.updateCandidates.map((u) => u.rowNumber), [S.target.source_row_number]);
  assert.equal(p.updateCandidates[0].external_key, S.target.external_key, "the key moved — a caption must not change identity");
  assert.deepEqual(p.updateCandidates[0].changes.map((c) => c.field), ["proposed_caption"], "the diff named a field the edit never touched");

  // CANDIDATE, not decision: unconfirmed, the stored row is left exactly as it was.
  const held = gatePlanForWrite(p, {});
  assert.equal(held.ok, true);
  assert.equal(held.gate.heldUpdates, 1);
  assert.equal(held.gate.plan.deliverables.filter((d) => d.action !== "unchanged").length, 0, "an unconfirmed update would have been written");
  const applied = gatePlanForWrite(p, { applyUpdates: true });
  assert.equal(applied.gate.plan.deliverables.filter((d) => d.action !== "unchanged").length, 1, "confirming the update wrote the wrong number of rows");
});

test("an edited title at the same source row ⇒ a CONFLICT, never a create", opts, () => {
  const p = planOf(S.titleEdited, S.existing, true);
  assert.equal(p.counts.toCreate, 0, "★ the renamed row was created as a duplicate and the original left stranded");
  assert.equal(p.counts.deliverablesToCreate, 0);
  assert.equal(p.counts.updateCandidates, 0);
  assert.equal(p.counts.missingFromFile, 0, "the stranded row must be reported as a CONFLICT, not as missing");
  assert.equal(p.counts.invalid, 0);
  assert.equal(p.counts.sourceRowConflicts, 1);
  assert.equal(p.counts.unchanged, p.deliverables.length - 1);
  const c = p.sourceRowConflicts[0];
  assert.equal(c.rowNumber, S.target.source_row_number);
  assert.equal(c.existingKey, S.target.external_key, "the conflict points at the wrong stored record");
  assert.equal(c.existingId, `id-${S.target.external_key}`);
  assert.notEqual(c.newKey, c.existingKey, "the key did not actually change — the case is not exercised");
  assert.ok(typeof c.reason === "string" && c.reason.length > 0, "the conflict carries no explanation");

  // Execution is REFUSED outright until the operator chooses what to do.
  const refused = gatePlanForWrite(p, {});
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "REFUSED_ROW_CONFLICTS");
  const skipped = gatePlanForWrite(p, { conflictResolution: "skip" });
  assert.equal(skipped.gate.plan.deliverables.filter((d) => d.action !== "unchanged").length, 0);
  const created = gatePlanForWrite(p, { conflictResolution: "create" });
  assert.equal(created.gate.plan.deliverables.filter((d) => d.action !== "unchanged").length, 1);
});

test("a deleted row is REPORTED missing, and nothing anywhere is deleted", opts, () => {
  const p = planOf(S.rowDeleted, S.existing, true);
  assert.equal(p.counts.missingFromFile, 1);
  assert.equal(p.counts.toCreate, 0);
  assert.equal(p.counts.updateCandidates, 0);
  assert.equal(p.counts.sourceRowConflicts, 0, "removing a row must not look like a rename");
  assert.equal(p.counts.invalid, 0);
  assert.equal(p.counts.accepted, S.real.counts.accepted - 1);
  assert.equal(p.counts.unchanged, p.deliverables.length, "every surviving row must still match — a deletion may not renumber identities");
  assert.equal(p.changeDetection.existingSetComplete, true, "missingFromFile is only honest when the lookup was complete");
  const m = p.missingFromFile[0];
  assert.equal(m.external_key, S.target.external_key);
  assert.equal(m.id, `id-${S.target.external_key}`);
  assert.ok(typeof m.reason === "string" && m.reason.length > 0);

  // NOTHING deletable leaves the engine.
  const batch = buildBatchRows(p, PROFILE, { includeUnchanged: false });
  assert.equal(batch.rows.filter((r) => r.entity_type === "deliverable").length, 0);
  const gate = gatePlanForWrite(p, {});
  assert.equal(gate.ok, true);
  assert.ok(gate.gate.notes.some((n) => n.indexOf("يُحذف") !== -1), "the operator is not told the stored record was kept");
  const payload = JSON.stringify(buildExecutePayload(gate.gate.plan, PROFILE, {}));
  assert.equal(payload.indexOf(S.target.external_key), -1, "the removed record's key was sent to the database");
  assert.doesNotMatch(payload, /delete|remove|destroy|purge/i, "a destructive verb reached the write payload");
});

test("no edit anywhere invents a date or schedules a row", opts, () => {
  for (const bytes of [S.baseline, S.captionEdited, S.titleEdited, S.rowDeleted]) {
    const p = planOf(bytes, S.existing, true);
    for (const d of p.deliverables) {
      assert.equal(d.due_date, null, `السطر ${d.source_row_number}: تاريخ مُختلَق`);
      assert.equal(d.schedule_status, "awaiting_schedule", `السطر ${d.source_row_number}: حالة جدولة غير متوقّعة`);
    }
    const batch = buildBatchRows(p, PROFILE, { includeUnchanged: true });
    for (const r of batch.rows) {
      assert.equal(r.payload.due_date ?? null, null, "a date reached the write payload");
      assert.equal(r.payload.schedule_status, "awaiting_schedule");
    }
  }
});
