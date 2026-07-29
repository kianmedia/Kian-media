// ════════════════════════════════════════════════════════════════════════════
// tests/misbar10_real_file_import.test.js — the REAL owner workbook, driven
// through the REAL import engine, end to end.
//
// Why this file exists, and why it is named for the supplier instead of living
// in the generic engine tests: the engine was built and proved against SYNTHETIC
// fixtures, and synthetic fixtures agree with the code that generated them. This
// test agrees with nothing — it reads the actual .xlsx the owner sent and asserts
// the figures the owner verified independently. Every defect it now guards was
// found by running it, not by reading the engine.
//
// The generic regressions each of those defects produced live in the engine's own
// test files (import_preview_execute / import_parse); this file is the end-to-end
// proof over the real bytes, so the platform stays free of the supplier's name.
//
// THE WORKBOOK IS CLIENT DATA AND IS NEVER COMMITTED. It is looked up at
// docs/input/private/MISBAR10_PLAN.xlsx (git-ignored), falling back to the
// historical docs/input/MISBAR10_PLAN.xlsx. When it is absent every test below
// SKIPS with an explicit reason — CI, Vercel and a fresh clone stay green and
// nothing here reports a pass it did not earn. The client-data-free structural
// coverage lives in tests/misbar10_acceptance.test.js and always runs.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { loadTs } = require("./import_engine_loader");
const { localAcceptanceInputs } = require("./misbar10_private_paths.js");

const REAL = localAcceptanceInputs("misbar10_real_file_import.test.js", ["workbook"]);
const FILE = REAL.paths.workbook;
const PRESENT = REAL.present;
const opts = REAL.opts;

const { parseWorkbook, pickSheet } = loadTs("lib/portal/import/parse.ts");
const { buildPlan } = loadTs("lib/portal/import/preview.ts");
const { resolveProfile } = loadTs("lib/portal/import/profiles.ts");

const PROFILE = resolveProfile(loadTs("docs/import_profiles/misbar10.json"));
const PROJECT_KEY = "real-file-test";

/** The exact pipeline /api/portal/import/preview runs. No simulation. */
function preview(existing) {
  const bytes = new Uint8Array(fs.readFileSync(FILE));
  const wb = parseWorkbook(bytes, "MISBAR10_PLAN.xlsx");
  const picked = pickSheet(wb, PROFILE.sheet);
  return buildPlan({
    sheet: picked.sheet,
    profile: PROFILE,
    context: { projectKey: PROJECT_KEY, parentProjectTitle: "مشروع الاختبار", existing, existingLookupAvailable: true },
    fileName: "MISBAR10_PLAN.xlsx",
    carriedWarnings: wb.warnings.concat(picked.warnings),
  });
}
const PLAN = PRESENT ? preview({}) : null;

// ALWAYS RUNS. Its whole job is to make the state of this suite impossible to
// misread: either the real file was found and used, or a skip reason exists and
// names what is missing. Without it, an absent workbook would leave nothing but
// SKIP lines, and a suite that never ran can be mistaken for a suite that passed.
test("local acceptance status is REPORTED, never assumed", () => {
  if (PRESENT) {
    assert.ok(fs.existsSync(FILE), "the resolved workbook path vanished mid-run");
    assert.ok(PLAN !== null, "the workbook is present but no plan was built");
    return;
  }
  assert.equal(PLAN, null, "no workbook, yet a plan exists — something fabricated one");
  assert.equal(typeof REAL.reason, "string", "the workbook is missing and no skip reason was produced");
  assert.match(REAL.reason, /SKIPPED/, "the skip reason does not say it skipped");
  assert.ok(REAL.missing.length > 0, "the workbook is missing but nothing was listed as missing");
  assert.deepEqual(opts, { skip: REAL.reason }, "the skip reason is not attached to the tests");
});

test("the real workbook previews with the figures the owner verified", opts, () => {
  assert.equal(PLAN.ok, true, PLAN.fatalMessage ?? "");
  assert.equal(PLAN.counts.parentProjectsToCreate, 1, "one parent project");
  assert.equal(PLAN.counts.stagesToCreate, 11, "11 stages");
  assert.equal(PLAN.counts.deliverablesToCreate, 79, "79 deliverables");
  assert.equal(PLAN.counts.accepted, 79);
  assert.equal(PLAN.counts.invalid, 0, JSON.stringify(PLAN.invalidRows));
  assert.equal(PLAN.counts.duplicate, 0, JSON.stringify(PLAN.duplicateRows));
  assert.equal(PLAN.counts.deliverablesToUpdate, 0);
  assert.equal(PLAN.counts.deliverablesUnchanged, 0);
  // 11 banner rows + 10 repeated column-header rows + 2 blank rows
  assert.equal(PLAN.counts.skipped, 23, JSON.stringify(PLAN.skippedRows));
});

test("every physical row of the real sheet lands in exactly one bucket", opts, () => {
  const sheet = pickSheet(parseWorkbook(new Uint8Array(fs.readFileSync(FILE)), "f.xlsx"), PROFILE.sheet).sheet;
  const bucketed = PLAN.counts.accepted + PLAN.counts.skipped + PLAN.counts.duplicate + PLAN.counts.invalid;
  assert.equal(bucketed + 1, sheet.rows.length, "a row vanished without being reported (+1 = the header row)");
});

test("the stage banners survive verbatim, dates inside them are TEXT only", opts, () => {
  const stages = PLAN.nodes.filter((n) => n.levelIndex === 0);
  assert.equal(stages.length, 11);
  // The owner's own per-stage deliverable counts, independently verified.
  assert.deepEqual(stages.map((n) => n.deliverableCount), [7, 5, 8, 4, 3, 4, 9, 7, 16, 10, 6]);
  // Two stages are legitimately merged (3rd+4th) and one stage legitimately has
  // four sections — neither may be "tidied up" by the engine.
  assert.equal(stages.filter((n) => /المرحلة الثامنة/.test(n.title)).length, 4, "stage 8 has four sections");
  assert.ok(stages.some((n) => /الثالثة والرابعة/.test(n.title)), "the merged stage must stay merged");
  for (const s of stages) {
    assert.equal(s.title, s.title.trim());
    assert.doesNotMatch(s.title, /Ø|Ù|â€/, "mojibake in a stage title");
  }
  // A date written inside a banner title is part of the TITLE. No deliverable
  // may acquire a date from it, and none may be scheduled.
  assert.ok(PLAN.deliverables.every((d) => d.due_date === null), "a date was invented");
  assert.ok(PLAN.deliverables.every((d) => d.schedule_status === "awaiting_schedule"));
  assert.ok(PLAN.deliverables.every((d) => d.level_path[0] !== null), "a row ended up with no stage");
});

// The two rows' literal title is CLIENT CONTENT and is never written into Git:
// the pair is addressed by its source row numbers (20, 21) instead.
test("the two near-identical rows at source rows 20 and 21 stay two deliverables", opts, () => {
  const pair = PLAN.deliverables.filter((d) => d.source_row_number === 20 || d.source_row_number === 21);
  assert.equal(pair.length, 2, "the near-identical pair was merged or deduplicated");
  assert.equal(pair[0].title, pair[1].title, "rows 20/21 no longer share a title — not the intended case");
  assert.notEqual(pair[0].external_key, pair[1].external_key, "the keys collided");
  assert.notEqual(pair[0].content_hash, pair[1].content_hash);
  // they differ ONLY in the last word of the execution details, and that word is
  // preserved on both sides
  assert.notEqual(pair[0].execution_details, pair[1].execution_details);
  assert.deepEqual(pair.map((d) => d.source_row_number).sort((a, b) => a - b), [20, 21]);
});

test("keys are deterministic across runs: no uuid, no timestamp, no counter", opts, () => {
  const again = preview({});
  assert.deepEqual(
    again.deliverables.map((d) => d.external_key),
    PLAN.deliverables.map((d) => d.external_key),
  );
  assert.deepEqual(JSON.stringify({ ...again, generatedAt: null }), JSON.stringify({ ...PLAN, generatedAt: null }));
  assert.equal(new Set(PLAN.deliverables.map((d) => d.external_key)).size, 79, "keys are not unique");
  for (const d of PLAN.deliverables) {
    assert.doesNotMatch(d.external_key, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i, "a UUID leaked into a key");
    assert.doesNotMatch(d.external_key, /\b1[6-9]\d{11}\b/, "a millisecond timestamp leaked into a key");
  }
});

test("Arabic is copied verbatim — the source's own typo included", opts, () => {
  assert.ok(
    PLAN.deliverables.some((d) => (d.execution_details ?? "").includes("المسسجلين")),
    "the source typo was 'corrected' — the text is not verbatim",
  );
  for (const d of PLAN.deliverables) {
    assert.doesNotMatch(d.title, /Ø|Ù|â€/, "mojibake in a title");
    assert.notEqual(d.title, "", "an empty title was accepted");
  }
});

test("an empty cell becomes null — never a placeholder, never an empty string", opts, () => {
  const nulls = (f) => PLAN.deliverables.filter((d) => d[f] === null).length;
  assert.equal(nulls("proposed_caption"), 23);
  assert.equal(nulls("execution_details"), 2);
  assert.equal(PLAN.deliverables.filter((d) => d.platforms.length === 0).length, 1);
  assert.equal(nulls("content_type_raw"), 0, "every row states its content type");
  for (const d of PLAN.deliverables) {
    for (const f of ["execution_details", "proposed_caption", "notes", "content_type_raw"]) {
      assert.notEqual(d[f], "", `${f} was stored as an empty string instead of null`);
    }
    assert.equal(d.platforms.some((p) => p === ""), false);
  }
});

test("mixed separators in the platforms column all split the same way", opts, () => {
  const withDash = PLAN.deliverables.find((d) => (d.content_type_raw ?? "") !== "" && d.platforms.length > 1);
  assert.ok(withDash, "no multi-platform row was produced at all");
  // the en dash is the sheet's dominant separator; it must not survive INSIDE a value
  for (const d of PLAN.deliverables) {
    for (const p of d.platforms) assert.doesNotMatch(p, /\s[–—-]\s/, `unsplit separator in «${p}»`);
  }
  // "جميع المنصات" is one legitimate value and must not be expanded
  assert.ok(PLAN.deliverables.some((d) => d.platforms.length === 1 && d.platforms[0] === "جميع المنصات"));
});

test("the stray second sheet is excluded from the 79 and SAID to be excluded", opts, () => {
  const wb = parseWorkbook(new Uint8Array(fs.readFileSync(FILE)), "f.xlsx");
  assert.equal(wb.sheets.length, 2, "the workbook really does carry a second sheet");
  const extra = PLAN.warnings.filter((w) => w.code === "extra_sheet_ignored");
  assert.equal(extra.length, 1, "the ignored sheet was not reported");
  assert.match(extra[0].message, /ورقة1/, "the ignored sheet is not named");
  // its 3 shifted scratch rows must not have become deliverables
  assert.equal(PLAN.counts.accepted, 79);
});

test("re-previewing the same file creates nothing, and the panel says so", opts, () => {
  const existing = {};
  for (const d of PLAN.deliverables) existing[d.external_key] = { id: `id-${d.external_key}`, content_hash: d.content_hash };
  for (const n of PLAN.nodes) existing[n.key] = { id: `node-${n.key}`, content_hash: null };
  existing[PLAN.parentProject.key] = { id: "id-parent", content_hash: null };

  const second = preview(existing);
  assert.equal(second.counts.deliverablesToCreate, 0, "a re-import would duplicate the plan");
  assert.equal(second.counts.deliverablesToUpdate, 0);
  assert.equal(second.counts.deliverablesUnchanged, 79, "all 79 rows matched what was already imported");
  assert.equal(second.counts.stagesToCreate, 0);
  assert.equal(second.counts.parentProjectsToCreate, 0);
  // NOTE: `duplicate` counts duplicates WITHIN the file, and this file has none;
  // a re-import surfaces as `unchanged`. The panel's «سبق استيراد هذا الملف»
  // guidance keys off exactly that, and its own test executes the predicate.
  assert.equal(second.counts.duplicate, 0);

  const alreadyImported =
    second.counts.deliverablesToCreate === 0 &&
    second.counts.deliverablesToUpdate === 0 &&
    (second.counts.deliverablesUnchanged > 0 || second.counts.duplicate > 0);
  assert.equal(alreadyImported, true, "the re-import guidance would not trigger on a genuine re-import");
});

test("editing one cell of the real file re-imports exactly that one row", opts, () => {
  const existing = {};
  for (const d of PLAN.deliverables) existing[d.external_key] = { id: `id-${d.external_key}`, content_hash: d.content_hash };
  const target = PLAN.deliverables[5];
  existing[target.external_key] = { id: `id-${target.external_key}`, content_hash: "0000000000000000" };
  const second = preview(existing);
  assert.equal(second.counts.deliverablesToUpdate, 1);
  assert.equal(second.counts.deliverablesToCreate, 0);
  assert.equal(second.counts.deliverablesUnchanged, 78);
  assert.equal(second.deliverables.find((d) => d.action === "update").external_key, target.external_key);
});
