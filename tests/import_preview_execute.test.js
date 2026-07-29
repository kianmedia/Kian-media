// ════════════════════════════════════════════════════════════════════════════
// tests/import_preview_execute.test.js — the engine end to end over a FULL
// fixture (a 50-line content plan: 4 stages, 5 sub-groups, 36 valid rows,
// section rows, carried-forward stages, blanks, a totals row, invalid rows, an
// exact duplicate, an unknown content type and an unreadable date).
//
// What these tests defend:
//   • preview/dry-run write NOTHING (the RPC stub records every call),
//   • re-importing the same file creates NOTHING,
//   • editing ONE row updates exactly that row,
//   • no date is ever invented,
//   • Arabic survives byte-for-byte, platforms stay a list, stages link up,
//   • a half-finished import is reported as such and never as success,
//   • the whole thing still previews when the SQL has not been applied.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadTs, makeXlsx } = require("./import_engine_loader");

const { buildPlan } = loadTs("lib/portal/import/preview.ts");
const { getProfile, registerProfile } = loadTs("lib/portal/import/profiles.ts");
const { parseWorkbook, pickSheet } = loadTs("lib/portal/import/parse.ts");
const { buildExecutePayload, executeImport, normalizeExecuteResponse } = loadTs("lib/portal/import/execute.ts");
const { lookupExisting, classifyMissing, detectBackend } = loadTs("lib/portal/import/rpc.ts");
const { nodeKey } = loadTs("lib/portal/import/keys.ts");

// The mapping profile is loaded from its JSON file as DATA (the engine ships
// only the generic profile; the server registers the rest at runtime).
const PROFILE = getProfile(registerProfile(loadTs("docs/import_profiles/misbar10.json")).id);
const PROJECT_KEY = "حملة-الوعي-2026";

// ─── fixture ───────────────────────────────────────────────────────────────
const HEADERS = ["المرحلة", "المجموعة", "المحتوى", "نوع المحتوى", "المنصات", "تفاصيل التنفيذ", "نص الوصف المقترح", "تاريخ التسليم", "العدد", "ميزانية"];

/** rows: [stage, group, title, type, platforms, details, caption, date, qty, budget] */
function makeRows() {
  const rows = [];
  const push = (r) => rows.push(r);
  const blank = () => rows.push(["", "", "", "", "", "", "", "", "", ""]);

  // ── stage A: declared by a SECTION row, then carried forward ──
  push(["مرحلة التمهيد", "", "", "", "", "", "", "", "", ""]);
  const firstRow = ["", "الأسبوع الأول", "تمهيد 1 — لقطة تعريفية", "فيديو", "انستغرام، تيك توك", "تصوير ومونتاج 1", "نص مقترح 1", "", "1", "1000"];
  for (let i = 1; i <= 6; i++) {
    push(i === 1 ? [...firstRow] : ["", "الأسبوع الأول", `تمهيد ${i} — لقطة تعريفية`, i % 2 ? "فيديو" : "صورة", i % 2 ? "انستغرام، تيك توك" : "انستغرام", `تصوير ومونتاج ${i}`, `نص مقترح ${i}`, "", String(i), "1000"]);
  }
  // an exact copy-paste of the first row, in place — the classic import accident
  push([...firstRow]);
  blank();
  for (let i = 1; i <= 5; i++) {
    push(["", "الأسبوع الثاني", `تمهيد ب${i} — تصميم`, "تصميم", "انستغرام / إكس", `تصميم ثابت ${i}`, `وصف ${i}`, i === 1 ? "15/09/2026" : "", "2", ""]);
  }

  // ── stage B: section row again, with two invalid rows and one exact duplicate ──
  push(["مرحلة الإطلاق", "", "", "", "", "", "", "", "", ""]);
  for (let i = 1; i <= 8; i++) {
    push(["", "اليوم الأول", `إطلاق ${i} — ريلز`, "ريلز", "انستغرام، تيك توك، يوتيوب", `مونتاج عمودي ${i}`, `اللحظة ${i}`, i === 1 ? "2026-09-20" : "", "1", ""]);
  }
  // invalid: no title at all (but the row carries other data ⇒ not a section row)
  push(["", "اليوم الأول", "", "فيديو", "انستغرام", "بلا عنوان", "", "", "1", ""]);
  push(["", "اليوم الأول", "   ", "فيديو", "انستغرام", "مسافات فقط", "", "", "1", ""]);
  blank();
  for (let i = 1; i <= 6; i++) {
    push(["", "اليوم الثاني", `إطلاق ب${i} — بودكاست`, "بودكاست", "يوتيوب", `تسجيل ${i}`, `حلقة ${i}`, i === 2 ? "قريبًا" : "", "1", ""]);
  }

  // ── stage C: stage repeated on every row (no section row) ──
  for (let i = 1; i <= 7; i++) {
    push(["مرحلة الاستمرارية", "الشهر الأول", `استمرارية ${i}`, "تصوير فوتوغرافي", "انستغرام", `جلسة ${i}`, `صور ${i}`, "", "4", ""]);
  }
  blank();

  // ── stage D: NO sub-group at all ⇒ the carried sub-group must reset ──
  for (let i = 1; i <= 4; i++) {
    push(["مرحلة القياس", "", `تقرير ${i}`, "مقال", "لينكدإن", `تحليل ${i}`, "", "", "1", ""]);
  }

  // a decoration/totals row at the very bottom
  push(["الإجمالي", "", "", "", "", "", "", "", "36", ""]);
  return rows;
}

const csvCell = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
function toCsv(rows) {
  const all = [["خطة المحتوى — نسخة العميل", "", "", "", "", "", "", "", "", ""], ["", "", "", "", "", "", "", "", "", ""], HEADERS, ...rows];
  return all.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

const FIXTURE_ROWS = makeRows();
const FIXTURE_CSV = toCsv(FIXTURE_ROWS);

function planFor(csv, opts = {}) {
  const wb = parseWorkbook(csv, opts.fileName ?? "plan.csv");
  const picked = pickSheet(wb, null);
  return buildPlan({
    sheet: picked.sheet,
    profile: PROFILE,
    context: {
      projectId: opts.projectId ?? null,
      projectKey: PROJECT_KEY,
      parentProjectTitle: opts.parentProjectTitle ?? null,
      existing: opts.existing,
      existingLookupAvailable: opts.existing !== undefined,
    },
    fileName: opts.fileName ?? "plan.csv",
    carriedWarnings: [...wb.warnings, ...picked.warnings],
  });
}

/** The state a database would hold after a successful import of `plan`. */
function existingFrom(plan) {
  const existing = {};
  for (const d of plan.deliverables) existing[d.external_key] = { id: `id-${d.external_key}`, content_hash: d.content_hash };
  for (const n of plan.nodes) existing[n.key] = { id: `node-${n.key}`, content_hash: null };
  return existing;
}

const PLAN = planFor(FIXTURE_CSV);

// ─── the plan ──────────────────────────────────────────────────────────────
test("preview reports every required figure over the full fixture", () => {
  assert.equal(PLAN.ok, true, PLAN.fatalMessage ?? "");
  assert.equal(PLAN.counts.accepted, 36, "36 valid deliverable rows");
  assert.equal(PLAN.counts.invalid, 2, "two rows have no title");
  assert.equal(PLAN.counts.duplicate, 1, "one row is an exact copy");
  assert.equal(PLAN.counts.deliverablesToCreate, 36);
  assert.equal(PLAN.counts.deliverablesToUpdate, 0);
  assert.equal(PLAN.counts.deliverablesUnchanged, 0);
  assert.equal(PLAN.counts.stagesToCreate, 4, "4 stages");
  assert.equal(PLAN.counts.subgroupsToCreate, 5, "5 sub-groups");
  assert.equal(PLAN.counts.parentProjectsToCreate, 0, "no parent project was requested");
  // 3 blank rows + 1 totals row + 2 section rows + the 2 decoration rows that sit
  // ABOVE the header row (a title row and a blank one). Those last two used to be
  // discarded with no skipped entry and no warning: content could vanish from a
  // real sheet and the preview said nothing. They are now REPORTED (still not
  // imported), which is why this figure is 8 and not 6.
  assert.equal(PLAN.counts.skipped, 8, JSON.stringify(PLAN.skippedRows));
  assert.equal(PLAN.deliverables.length, 36);
  assert.equal(PLAN.nodes.length, 9, "4 stages + 5 sub-groups");
});

test("nothing above the header row is dropped silently — every row is accounted for", () => {
  // The fixture's first two physical rows are a title row and a blank row.
  const preHeader = PLAN.skippedRows.filter((r) => r.rowNumber <= 2);
  assert.equal(preHeader.length, 2, JSON.stringify(PLAN.skippedRows));
  assert.match(preHeader[0].reason, /قبل صف العناوين/);
  // Total accounting: every physical row of the sheet ends up in exactly one
  // bucket — accepted, skipped, duplicate or invalid — plus the header row.
  const sheet = pickSheet(parseWorkbook(FIXTURE_CSV, "plan.csv"), null).sheet;
  const bucketed = PLAN.counts.accepted + PLAN.counts.skipped + PLAN.counts.duplicate + PLAN.counts.invalid;
  assert.equal(bucketed + 1, sheet.rows.length, "a row that is in no bucket has silently disappeared");
});

test("a parent project is planned only when one is actually requested", () => {
  const withParent = planFor(FIXTURE_CSV, { parentProjectTitle: "حملة الوعي 2026" });
  assert.equal(withParent.counts.parentProjectsToCreate, 1);
  assert.equal(withParent.parentProject.title, "حملة الوعي 2026");
  assert.match(withParent.parentProject.key, /:#project$/);
  const intoExisting = planFor(FIXTURE_CSV, { parentProjectTitle: "حملة الوعي 2026", projectId: "0f7f1b12-0000-4000-8000-000000000001" });
  assert.equal(intoExisting.counts.parentProjectsToCreate, 0, "importing into an existing project creates no project");
});

test("section rows, carry-forward and the deeper-level reset all work", () => {
  const byTitle = (t) => PLAN.deliverables.find((d) => d.title === t);
  // stage came from a section row, sub-group from the row itself
  assert.deepEqual(byTitle("تمهيد 1 — لقطة تعريفية").level_path, ["مرحلة التمهيد", "الأسبوع الأول"]);
  // stage carried forward across a blank row into the next sub-group
  assert.deepEqual(byTitle("تمهيد ب1 — تصميم").level_path, ["مرحلة التمهيد", "الأسبوع الثاني"]);
  assert.deepEqual(byTitle("إطلاق 1 — ريلز").level_path, ["مرحلة الإطلاق", "اليوم الأول"]);
  assert.deepEqual(byTitle("استمرارية 1").level_path, ["مرحلة الاستمرارية", "الشهر الأول"]);
  // stage D declares a new stage ⇒ the carried sub-group MUST be dropped
  assert.deepEqual(byTitle("تقرير 1").level_path, ["مرحلة القياس", null], "a stale sub-group leaked into a new stage");
});

// ─── banner rows: the hierarchy shape real planning sheets actually use ─────
// REAL-FILE CASE. A supplier's plan has no "stage" COLUMN at all. The stage is a
// full-width BANNER ROW — its title alone in the first content column, every
// other column blank — and the rows beneath belong to it. The whole block then
// repeats its own column-header row. Before this was handled, each banner became
// a phantom deliverable, the file collapsed onto a single level, and two rows
// that legitimately share a title in DIFFERENT stages were reported as an in-file
// duplicate and one of them was silently dropped.
const BANNER_HEADERS = ["المحتوى", "نوع المحتوى", "المنصات", "تفاصيل التنفيذ"];
function bannerSheetRows() {
  const rows = [];
  const banner = (t) => rows.push([t, "", "", ""]);
  const item = (t, extra) => rows.push([t, "فيديو", "انستغرام", extra]);
  banner("المرحلة الأولى"); // ← ABOVE the header row, exactly as Excel users write it
  rows.push([...BANNER_HEADERS]);
  item("مقطع تشويقي", "تفصيل أ");
  item("بطاقة تعريفية", "تفصيل مشترك");
  banner("المرحلة الثانية");
  rows.push([...BANNER_HEADERS]); // the repeated column-header row mid-sheet
  item("لقاء تعريفي", "تفصيل ب");
  // same title AND same content as a row in the previous stage: a different
  // deliverable, not a copy-paste accident.
  item("بطاقة تعريفية", "تفصيل مشترك");
  return rows;
}
const BANNER_PLAN = buildPlan({
  sheet: pickSheet(parseWorkbook(bannerSheetRows().map((r) => r.join(",")).join("\r\n"), "banner.csv"), null).sheet,
  profile: PROFILE,
  context: { projectKey: PROJECT_KEY, existing: {}, existingLookupAvailable: true },
  fileName: "banner.csv",
});

test("a level written as a banner ROW builds the hierarchy instead of phantom rows", () => {
  assert.equal(BANNER_PLAN.ok, true, BANNER_PLAN.fatalMessage ?? "");
  assert.equal(BANNER_PLAN.counts.accepted, 4, JSON.stringify(BANNER_PLAN.deliverables.map((d) => d.title)));
  assert.equal(BANNER_PLAN.counts.stagesToCreate, 2);
  assert.deepEqual(
    BANNER_PLAN.nodes.filter((n) => n.levelIndex === 0).map((n) => n.title),
    ["المرحلة الأولى", "المرحلة الثانية"],
  );
  // the banners themselves are NOT deliverables …
  assert.equal(BANNER_PLAN.deliverables.some((d) => d.title.startsWith("المرحلة")), false, "a banner became a deliverable");
  // … and they are reported, not silently swallowed.
  assert.equal(BANNER_PLAN.skippedRows.filter((r) => /سطر يعرّف/.test(r.reason)).length, 2);
  // the banner ABOVE the header row still defines the first stage
  assert.deepEqual(BANNER_PLAN.deliverables[0].level_path, ["المرحلة الأولى", null]);
});

test("identical titles in DIFFERENT banner stages are two deliverables, not a duplicate", () => {
  const twins = BANNER_PLAN.deliverables.filter((d) => d.title === "بطاقة تعريفية");
  assert.equal(twins.length, 2, "a real deliverable was dropped as a false duplicate");
  assert.equal(BANNER_PLAN.counts.duplicate, 0);
  assert.notEqual(twins[0].external_key, twins[1].external_key);
  assert.deepEqual(twins.map((d) => d.level_path[0]), ["المرحلة الأولى", "المرحلة الثانية"]);
});

test("banner detection stays off when the sheet really does have a level column", () => {
  // The full fixture DOES carry a «المرحلة» column, so its section-row handling
  // must be untouched — no row may be re-read as a banner.
  assert.equal(PLAN.skippedRows.filter((r) => /سطر يعرّف/.test(r.reason)).length, 2, "the fixture has exactly 2 section rows");
  assert.equal(PLAN.counts.accepted, 36);
});

test("a single-column list of titles never turns its rows into banners", () => {
  // Guard against the obvious over-reach: with only ONE content column every row
  // would look like a banner and the whole file would import as zero rows.
  const csv = ["المحتوى", "عنوان أ", "عنوان ب", "عنوان ج"].join("\r\n");
  const plan = buildPlan({
    sheet: pickSheet(parseWorkbook(csv, "one.csv"), null).sheet,
    profile: PROFILE,
    context: { projectKey: PROJECT_KEY, existing: {}, existingLookupAvailable: true },
    fileName: "one.csv",
  });
  assert.equal(plan.counts.accepted, 3, JSON.stringify(plan.skippedRows));
  assert.equal(plan.counts.stagesToCreate, 0);
});

test("a totals row alone in the title column stays a totals row, not a stage", () => {
  const csv = [BANNER_HEADERS.join(","), "الإجمالي,,,", "عنوان أ,فيديو,انستغرام,تفصيل"].join("\r\n");
  const plan = buildPlan({
    sheet: pickSheet(parseWorkbook(csv, "t.csv"), null).sheet,
    profile: PROFILE,
    context: { projectKey: PROJECT_KEY, existing: {}, existingLookupAvailable: true },
    fileName: "t.csv",
  });
  assert.equal(plan.counts.stagesToCreate, 0, "a totals row was promoted to a stage");
  assert.match(plan.skippedRows.find((r) => r.rowNumber === 2).reason, /تجميعي/);
});

test("every deliverable is linked to the node of its deepest level", () => {
  for (const d of PLAN.deliverables) {
    const depth = d.level_keys.filter(Boolean).length;
    const expected = nodeKey(PROFILE.id, PROJECT_KEY, d.level_keys.slice(0, depth));
    assert.equal(d.parentKey, expected, `bad parent for ${d.title}`);
    assert.ok(PLAN.nodes.some((n) => n.key === d.parentKey), `parent node missing for ${d.title}`);
  }
  const stages = PLAN.nodes.filter((n) => n.levelIndex === 0);
  assert.deepEqual(stages.map((n) => n.title), ["مرحلة التمهيد", "مرحلة الإطلاق", "مرحلة الاستمرارية", "مرحلة القياس"]);
  assert.deepEqual(stages.map((n) => n.sequence), [1, 2, 3, 4], "stages are sequenced in first-seen order");
  const firstStageGroups = PLAN.nodes.filter((n) => n.levelIndex === 1 && n.parentKey === stages[0].key);
  assert.deepEqual(firstStageGroups.map((n) => n.sequence), [1, 2], "sub-group sequence restarts inside each stage");
  assert.equal(stages[0].deliverableCount, 11, "6 + 5 rows under the first stage");
});

test("Arabic content is preserved exactly — no mojibake, no normalisation damage", () => {
  const d = PLAN.deliverables.find((x) => x.title === "تمهيد 1 — لقطة تعريفية");
  assert.equal(d.title, "تمهيد 1 — لقطة تعريفية");
  assert.equal(d.execution_details, "تصوير ومونتاج 1");
  assert.equal(d.proposed_caption, "نص مقترح 1");
  assert.equal(d.level_path[0], "مرحلة التمهيد");
  for (const row of PLAN.deliverables) {
    assert.doesNotMatch(row.title, /Ø|Ù|â€/, "mojibake in a title");
    assert.equal(row.title, row.title.trim());
  }
});

test("multiple platforms per deliverable are kept as a list", () => {
  const multi = PLAN.deliverables.find((d) => d.title === "إطلاق 1 — ريلز");
  assert.deepEqual(multi.platforms, ["انستغرام", "تيك توك", "يوتيوب"]);
  const slash = PLAN.deliverables.find((d) => d.title === "تمهيد ب1 — تصميم");
  assert.deepEqual(slash.platforms, ["انستغرام", "إكس"]);
  const single = PLAN.deliverables.find((d) => d.title === "استمرارية 1");
  assert.deepEqual(single.platforms, ["انستغرام"]);
});

test("content types stay inside the CHECK domain while the original wording is kept", () => {
  const allowed = new Set(["video", "photo", "other"]);
  for (const d of PLAN.deliverables) assert.ok(allowed.has(d.type), `illegal type ${d.type}`);
  const reels = PLAN.deliverables.find((d) => d.title === "إطلاق 1 — ريلز");
  assert.equal(reels.type, "video");
  assert.equal(reels.content_type_raw, "ريلز");
  const podcast = PLAN.deliverables.find((d) => d.title === "إطلاق ب1 — بودكاست");
  assert.equal(podcast.type, "other");
  assert.equal(podcast.content_type_raw, "بودكاست", "the user's own wording is never lost");
  assert.ok(
    PLAN.warnings.some((w) => w.code === "unknown_content_type" && w.value === "بودكاست"),
    "an unrecognised type must be surfaced, not silently bucketed",
  );
});

test("NO date is ever invented and unreadable dates are reported", () => {
  const today = new Date().toISOString().slice(0, 10);
  const dated = PLAN.deliverables.filter((d) => d.due_date !== null);
  assert.equal(dated.length, 2, "exactly the two rows that carried a real date");
  assert.deepEqual(dated.map((d) => d.due_date).sort(), ["2026-09-20", "2026-09-15"].sort());
  for (const d of PLAN.deliverables) {
    assert.notEqual(d.due_date, today, "today's date must never appear as a default");
    assert.equal(d.schedule_status, "awaiting_schedule");
    assert.equal(d.status, "draft");
  }
  const warn = PLAN.warnings.find((w) => w.code === "unparsed_date");
  assert.ok(warn, "the unreadable date must produce a warning");
  assert.equal(warn.value, "قريبًا");
  assert.match(warn.message, /لن يُخترع تاريخ/);
});

test("invalid rows are reported per row with the real file line number", () => {
  assert.equal(PLAN.invalidRows.length, 2);
  for (const inv of PLAN.invalidRows) {
    assert.equal(inv.code, "missing_required");
    assert.equal(inv.field, "title");
    assert.ok(inv.rowNumber > 3, "row numbers must point into the file");
    const line = FIXTURE_CSV.split("\r\n")[inv.rowNumber - 1];
    assert.match(line, /بلا عنوان|مسافات فقط/, `row ${inv.rowNumber} is not the row we expected`);
  }
});

test("the duplicated row is excluded and named", () => {
  assert.equal(PLAN.duplicateRows.length, 1);
  const dup = PLAN.duplicateRows[0];
  assert.match(dup.reason, /تمهيد 1/);
  // the report points at the row it duplicates, and at that row's key
  const original = PLAN.deliverables.find((d) => d.title === "تمهيد 1 — لقطة تعريفية");
  assert.equal(dup.external_key, original.external_key);
  assert.match(dup.reason, new RegExp(`يكرّر السطر ${original.source_row_number}`));
  assert.ok(dup.rowNumber > original.source_row_number);
  assert.equal(PLAN.deliverables.filter((d) => d.title === "تمهيد 1 — لقطة تعريفية").length, 1);
  const keys = PLAN.deliverables.map((d) => d.external_key);
  assert.equal(new Set(keys).size, keys.length, "external keys must be unique inside one plan");
});

test("unmapped columns are surfaced instead of being silently dropped", () => {
  assert.deepEqual(PLAN.unmappedColumns, ["ميزانية"]);
  assert.ok(PLAN.warnings.some((w) => w.code === "unmapped_column" && w.column === "ميزانية"));
  const mapped = PLAN.mapping.filter((m) => m.field).map((m) => m.field);
  assert.deepEqual(mapped, ["stage", "sub_group", "title", "content_type", "platforms", "execution_details", "proposed_caption", "due_date", "quantity"]);
});

test("a sheet without a title column fails loudly with an Arabic reason", () => {
  const bad = planFor("المرحلة,المنصات\nالتمهيد,انستغرام\n");
  assert.equal(bad.ok, false);
  assert.match(bad.fatalMessage, /عمود العنوان/);
  assert.equal(bad.counts.accepted, 0);
});

test("fields with no canonical column land in `extra` rather than being lost", () => {
  const profile = {
    id: "adhoc",
    fields: { title: { synonyms: ["البند"] }, owner_team: { synonyms: ["الفريق"] } },
    levels: [],
  };
  const wb = parseWorkbook("البند,الفريق\nمهمة أولى,فريق الإنتاج\n", "x.csv");
  const plan = buildPlan({ sheet: wb.sheets[0], profile: require("./import_engine_loader").loadTs("lib/portal/import/profile.ts").normalizeProfile(profile), context: { projectKey: "k" } });
  assert.equal(plan.deliverables[0].extra.owner_team, "فريق الإنتاج");
});

// ─── XLSX gives the identical plan ─────────────────────────────────────────
test("the same data as .xlsx produces byte-identical keys (format independence)", () => {
  const rows = [HEADERS, ...FIXTURE_ROWS];
  const wb = parseWorkbook(makeXlsx(rows), "plan.xlsx");
  const picked = pickSheet(wb, null);
  const xlsxPlan = buildPlan({ sheet: picked.sheet, profile: PROFILE, context: { projectKey: PROJECT_KEY }, fileName: "plan.xlsx" });
  assert.equal(xlsxPlan.counts.accepted, PLAN.counts.accepted);
  assert.deepEqual(xlsxPlan.deliverables.map((d) => d.external_key), PLAN.deliverables.map((d) => d.external_key));
  assert.deepEqual(xlsxPlan.deliverables.map((d) => d.content_hash), PLAN.deliverables.map((d) => d.content_hash));
});

// ─── idempotency ───────────────────────────────────────────────────────────
test("re-importing the very same file creates nothing", () => {
  const second = planFor(FIXTURE_CSV, { existing: existingFrom(PLAN) });
  assert.equal(second.counts.deliverablesToCreate, 0);
  assert.equal(second.counts.deliverablesToUpdate, 0);
  assert.equal(second.counts.deliverablesUnchanged, 36);
  assert.equal(second.counts.stagesToCreate, 0);
  assert.equal(second.counts.subgroupsToCreate, 0);
  assert.deepEqual(second.deliverables.map((d) => d.external_key), PLAN.deliverables.map((d) => d.external_key));
  assert.ok(second.deliverables.every((d) => d.existingId !== null));
});

test("editing ONE row updates exactly that row and nothing else", () => {
  const edited = FIXTURE_ROWS.map((r) => [...r]);
  const target = edited.findIndex((r) => r[2] === "إطلاق 3 — ريلز");
  assert.ok(target >= 0);
  edited[target][6] = "نص مقترح جديد تمامًا";
  edited[target][4] = "انستغرام، تيك توك، يوتيوب، سناب شات";

  const plan2 = planFor(toCsv(edited), { existing: existingFrom(PLAN) });
  assert.equal(plan2.counts.deliverablesToCreate, 0, "an edit must never create a second row");
  assert.equal(plan2.counts.deliverablesToUpdate, 1);
  assert.equal(plan2.counts.deliverablesUnchanged, 35);
  const changed = plan2.deliverables.filter((d) => d.action === "update");
  assert.equal(changed.length, 1);
  assert.equal(changed[0].title, "إطلاق 3 — ريلز");
  assert.equal(changed[0].proposed_caption, "نص مقترح جديد تمامًا");
  assert.deepEqual(changed[0].platforms, ["انستغرام", "تيك توك", "يوتيوب", "سناب شات"]);
  const before = PLAN.deliverables.find((d) => d.title === "إطلاق 3 — ريلز");
  assert.equal(changed[0].external_key, before.external_key, "the key must survive the edit");
});

test("moving a self-contained block does not fabricate changes", () => {
  // The stage C block repeats its stage AND sub-group on every row, so it carries
  // its own context and can be moved. (Rows that RELY on carry-forward cannot be
  // moved without changing their meaning — that is the sheet's semantics, not a
  // bug, which is exactly why the key is built from the resolved level path.)
  const moved = FIXTURE_ROWS.map((r) => [...r]);
  const start = moved.findIndex((r) => r[2] === "استمرارية 1");
  const block = moved.splice(start, 7);
  moved.splice(moved.length - 1, 0, ...block);
  const plan3 = planFor(toCsv(moved), { existing: existingFrom(PLAN) });
  const created = plan3.deliverables.filter((d) => d.action === "create").map((d) => d.title);
  assert.deepEqual(created, [], "moving a self-contained block must not look like new rows");
  assert.equal(plan3.counts.deliverablesUnchanged, 36);
});

test("a genuinely repeated title in the same group stays a separate deliverable", () => {
  const csv = toCsv([
    ["مرحلة", "مجموعة", "لقطة", "فيديو", "انستغرام", "نسخة أ", "", "", "1", ""],
    ["مرحلة", "مجموعة", "لقطة", "فيديو", "انستغرام", "نسخة ب", "", "", "1", ""],
  ]);
  const p = planFor(csv);
  assert.equal(p.counts.accepted, 2, "two rows with the same title but different content are two deliverables");
  assert.equal(p.counts.duplicate, 0);
  assert.notEqual(p.deliverables[0].external_key, p.deliverables[1].external_key);
});

// ─── execute ───────────────────────────────────────────────────────────────
/** Any function the test did not stub simply does not exist in the database. */
const PGRST202_RESPONSE = { ok: false, error: "PGRST202 | Could not find the function in the schema cache", status: 404 };

/** RPC stub that records every call. Nothing here touches a network. */
function stubCaller(handlers = {}) {
  const calls = [];
  const call = async (fn, args) => {
    calls.push({ fn, args });
    const h = handlers[fn];
    if (typeof h === "function") return h(args);
    if (h !== undefined) return h;
    return PGRST202_RESPONSE;
  };
  call.calls = calls;
  return call;
}

const okCapabilities = { ok: true, data: { ok: true, version: 1, writes: true } };

function successResponse(payload) {
  return {
    ok: true,
    data: {
      ok: true,
      batch_id: "batch-1",
      rolled_back: false,
      results: payload.p_payload.rows.map((r) => ({ external_key: r.external_key, action: "created", id: `new-${r.external_key}`, error: null })),
    },
  };
}

test("dry run performs full validation and zero writes", async () => {
  const call = stubCaller({
    project_import_capabilities: okCapabilities,
    project_import_execute: (args) => {
      assert.equal(args.p_payload.mode, "dry_run", "the database must be told this is a dry run");
      return { ok: true, data: { ok: true, batch_id: null, rolled_back: false, results: args.p_payload.rows.map((r) => ({ external_key: r.external_key, action: "created", id: null })) } };
    },
  });
  const res = await executeImport(PLAN, { mode: "dry_run", skipInvalidRows: true }, call);
  assert.equal(res.code, "DRY_RUN_OK");
  assert.equal(res.ok, true);
  assert.equal(res.created, 36);
  assert.match(res.message, /لم يُكتب أي شيء/);
});

test("the payload carries the plan faithfully and never a fabricated date", () => {
  const { payload, attempted } = buildExecutePayload(PLAN, { mode: "commit" });
  assert.equal(attempted.length, 36);
  assert.equal(payload.rows.length, 36);
  assert.equal(payload.nodes.length, 9);
  assert.equal(payload.profile_id, "misbar10");
  assert.equal(payload.project_key, PROJECT_KEY);
  assert.equal(payload.rows.filter((r) => r.due_date !== null).length, 2);
  for (const r of payload.rows) {
    assert.ok(["video", "photo", "other"].includes(r.type));
    assert.equal(r.schedule_status, "awaiting_schedule");
    assert.ok(Array.isArray(r.platforms));
    assert.ok(r.external_key && r.content_hash);
  }
});

test("commit reports per row and stays honest about what happened", async () => {
  const call = stubCaller({ project_import_capabilities: okCapabilities, project_import_execute: successResponse });
  const res = await executeImport(PLAN, { mode: "commit", skipInvalidRows: true }, call);
  assert.equal(res.code, "COMMITTED");
  assert.equal(res.ok, true);
  assert.equal(res.created, 36);
  assert.equal(res.failed, 0);
  assert.equal(res.notAttempted, 0);
  assert.equal(res.batchId, "batch-1");
  assert.equal(res.rows.length, 36);
  assert.deepEqual(res.rows.map((r) => r.source_row_number), [...res.rows.map((r) => r.source_row_number)].sort((a, b) => a - b));
});

test("a second commit of the same file sends no rows at all", async () => {
  const second = planFor(FIXTURE_CSV, { existing: existingFrom(PLAN) });
  const call = stubCaller({ project_import_capabilities: okCapabilities });
  const res = await executeImport(second, { mode: "commit", skipInvalidRows: true }, call);
  assert.equal(res.code, "NOTHING_TO_DO");
  assert.equal(res.ok, true);
  assert.equal(call.calls.filter((c) => c.fn === "project_import_execute").length, 0, "an idempotent re-run must not call the write RPC");
});

test("a rolled-back batch is reported as a failure, never as a success", async () => {
  const call = stubCaller({
    project_import_capabilities: okCapabilities,
    project_import_execute: (args) => ({
      ok: true,
      data: {
        ok: false,
        batch_id: "batch-2",
        rolled_back: true,
        results: args.p_payload.rows.map((r, i) => ({ external_key: r.external_key, action: i === 3 ? "failed" : "unchanged", error: i === 3 ? "23514 check constraint" : null })),
      },
    }),
  });
  const res = await executeImport(PLAN, { mode: "commit", skipInvalidRows: true }, call);
  assert.equal(res.code, "ROLLED_BACK");
  assert.equal(res.ok, false);
  assert.match(res.message, /ولم يُكتب أي سطر/);
  assert.equal(res.created, 0, "a rolled-back batch may not report anything as written");
  assert.equal(res.updated, 0);
  assert.equal(res.unchanged, 0);
  assert.equal(res.failed, 1, "the failing row is still named");
});

test("a partial result names every failed row instead of hiding it", async () => {
  const call = stubCaller({
    project_import_capabilities: okCapabilities,
    project_import_execute: (args) => ({
      ok: true,
      data: {
        ok: true,
        batch_id: "batch-3",
        rolled_back: false,
        results: args.p_payload.rows.map((r, i) => ({ external_key: r.external_key, action: i < 2 ? "failed" : "created", id: i < 2 ? null : "x", error: i < 2 ? "عنوان مكرر" : null })),
      },
    }),
  });
  const res = await executeImport(PLAN, { mode: "commit", skipInvalidRows: true }, call);
  assert.equal(res.code, "PARTIAL_REPORTED");
  assert.equal(res.ok, false);
  assert.equal(res.failed, 2);
  assert.equal(res.created, 34);
  assert.equal(res.rows.filter((r) => r.action === "failed").every((r) => r.error === "عنوان مكرر"), true);
});

test("a response that does not cover every row is AMBIGUOUS, not success", async () => {
  const call = stubCaller({
    project_import_capabilities: okCapabilities,
    project_import_execute: (args) => ({
      ok: true,
      data: { ok: true, batch_id: "batch-4", rolled_back: false, results: args.p_payload.rows.slice(0, 10).map((r) => ({ external_key: r.external_key, action: "created", id: "x" })) },
    }),
  });
  const res = await executeImport(PLAN, { mode: "commit", skipInvalidRows: true }, call);
  assert.equal(res.code, "AMBIGUOUS_RESULT");
  assert.equal(res.ok, false);
  assert.equal(res.notAttempted, 26);
  assert.match(res.message, /لا تعتبر الاستيراد ناجحًا/);
});

test("invalid rows block execution until they are explicitly acknowledged", async () => {
  const call = stubCaller({ project_import_capabilities: okCapabilities, project_import_execute: successResponse });
  const blocked = await executeImport(PLAN, { mode: "commit" }, call);
  assert.equal(blocked.code, "REFUSED_INVALID_ROWS");
  assert.equal(blocked.ok, false);
  assert.equal(call.calls.length, 0, "nothing may be sent while invalid rows are unacknowledged");
  const allowed = await executeImport(PLAN, { mode: "commit", skipInvalidRows: true }, call);
  assert.equal(allowed.ok, true);
});

test("an unusable plan is refused with its own Arabic reason", async () => {
  const bad = planFor("المرحلة,المنصات\nالتمهيد,انستغرام\n");
  const call = stubCaller({ project_import_capabilities: okCapabilities });
  const res = await executeImport(bad, { mode: "commit" }, call);
  assert.equal(res.code, "REFUSED_INVALID_PLAN");
  assert.match(res.message, /عمود العنوان/);
  assert.equal(call.calls.length, 0);
});

// ─── feature detection (deploy-before-migrate window) ──────────────────────
const PGRST202 = { ok: false, error: "PGRST202 | Could not find the function public.project_import_execute(p_payload) in the schema cache", status: 404 };

test("classifyMissing recognises every 'migration not applied' signature", () => {
  assert.equal(classifyMissing("PGRST202 | Could not find the function"), "function");
  assert.equal(classifyMissing("42883: function does not exist"), "function");
  assert.equal(classifyMissing("PGRST204 | column x does not exist"), "column");
  assert.equal(classifyMissing('42703 | column "external_key" does not exist'), "column");
  assert.equal(classifyMissing("PGRST205 | Could not find the table"), "table");
  assert.equal(classifyMissing("42P01 | relation does not exist"), "table");
  assert.equal(classifyMissing("permission denied for function"), null);
  assert.equal(classifyMissing(""), null);
});

test("a missing migration disables EXECUTION with a clear Arabic message", async () => {
  const call = stubCaller({ project_import_capabilities: PGRST202 });
  const res = await executeImport(PLAN, { mode: "commit", skipInvalidRows: true }, call);
  assert.equal(res.code, "MIGRATION_PENDING");
  assert.equal(res.ok, false);
  assert.match(res.message, /لم تُحدَّث بعد/);
  assert.equal(call.calls.filter((c) => c.fn === "project_import_execute").length, 0);
});

test("a missing migration does NOT disable the preview", () => {
  const plan = planFor(FIXTURE_CSV, { existing: undefined });
  assert.equal(plan.ok, true);
  assert.equal(plan.existingLookupAvailable, false, "the UI must be told matching is unavailable");
  assert.equal(plan.counts.accepted, 36, "the full plan is still produced client-side");
});

test("backend detection names the protocol and separates 'not migrated' from 'not permitted'", async () => {
  assert.deepEqual(await detectBackend(stubCaller({})), {
    available: false,
    protocol: null,
    version: null,
    reason: loadTs("lib/portal/import/rpc.ts").MIGRATION_PENDING_AR,
    lookupAvailable: false,
  });
  const denied = await detectBackend(stubCaller({ import_batch_list: { ok: false, error: "not authorized", status: 400 } }));
  assert.equal(denied.available, false);
  assert.equal(denied.protocol, null);
  assert.match(denied.reason, /صلاحية/);
  // the staging-batch backend (what the import migration installs) wins the probe
  const batch = await detectBackend(stubCaller({ import_batch_list: { ok: true, data: [] } }));
  assert.deepEqual(batch, { available: true, protocol: "batch", version: null, reason: null, lookupAvailable: true });
  // …and the single-payload contract is the documented fallback
  const single = await detectBackend(stubCaller({ project_import_capabilities: okCapabilities }));
  assert.deepEqual(single, { available: true, protocol: "single", version: 1, reason: null, lookupAvailable: true });
});

test("lookupExisting degrades instead of throwing when its RPC is missing", async () => {
  const missing = await lookupExisting(stubCaller({ project_import_lookup: PGRST202 }), { projectId: null, profileId: "misbar10", keys: ["a"] });
  assert.equal(missing.available, false);
  assert.deepEqual(missing.existing, {});
  assert.match(missing.reason, /لم تُحدَّث بعد/);
  const found = await lookupExisting(
    stubCaller({ project_import_lookup: { ok: true, data: { rows: [{ external_key: "a", content_hash: "h", id: "i" }] } } }),
    { projectId: null, profileId: "misbar10", keys: ["a"] },
  );
  assert.deepEqual(found.existing, { a: { id: "i", content_hash: "h" } });
});

test("a transport failure never reports success", async () => {
  const call = stubCaller({
    project_import_capabilities: okCapabilities,
    project_import_execute: () => {
      throw new Error("socket hang up");
    },
  });
  const res = await executeImport(PLAN, { mode: "commit", skipInvalidRows: true }, call);
  assert.equal(res.code, "TRANSPORT_FAILED");
  assert.equal(res.ok, false);
  assert.match(res.message, /لم يُؤكَّد أي سطر/);
  const denied = await executeImport(PLAN, { mode: "commit", skipInvalidRows: true }, stubCaller({ project_import_capabilities: okCapabilities, project_import_execute: { ok: false, error: "permission denied", status: 403 } }));
  assert.equal(denied.code, "NOT_AUTHORIZED");
});

test("normalizeExecuteResponse ignores rows the database invented", () => {
  const attempted = PLAN.deliverables.slice(0, 2);
  const res = normalizeExecuteResponse(
    {
      ok: true,
      batch_id: "b",
      rolled_back: false,
      results: [
        { external_key: attempted[0].external_key, action: "created", id: "1" },
        { external_key: attempted[1].external_key, action: "updated", id: "2" },
        { external_key: "ghost-key-we-never-sent", action: "created", id: "3" },
      ],
    },
    attempted,
    "commit",
  );
  assert.equal(res.rows.length, 2);
  assert.equal(res.created, 1);
  assert.equal(res.updated, 1);
  assert.equal(res.ok, true);
});

// ─── the staging-batch backend (the protocol the import migration installs) ──
const { buildBatchRows, contentTypeKeyFor, DB_PRIORITY, DB_STATUS, DB_SCHEDULE_STATUS } = loadTs("lib/portal/import/batchBackend.ts");

/**
 * A faithful fake of import_batch_* : it keeps staging rows, validates them the
 * way the SQL does (title required, vocabularies fixed, stage key must resolve),
 * skips keys it has already imported (idempotency), and rolls a dry run back.
 */
function fakeBatchDb(options = {}) {
  const db = { deliverables: new Map(), stages: new Map(), batches: new Map(), calls: [] };
  const seq = { n: 0 };
  const call = async (fn, args) => {
    db.calls.push(fn);
    switch (fn) {
      case "import_batch_list":
        return { ok: true, data: [] };
      case "import_batch_create": {
        if (!args.p_target_project) return { ok: false, error: "target_project_required", status: 400 };
        const id = `batch-${++seq.n}`;
        db.batches.set(id, { id, rows: [], status: "draft", profile: args.p_profile, target: args.p_target_project });
        return { ok: true, data: { ok: true, batch_id: id, status: "draft" } };
      }
      case "import_batch_load_rows": {
        const b = db.batches.get(args.p_batch);
        if (!b) return { ok: false, error: "batch_not_found", status: 400 };
        if (args.p_rows.length > 5000) return { ok: false, error: "rows_limit_exceeded", status: 400 };
        b.rows = args.p_rows.map((r) => ({ ...r, status: "pending", action: "create", error: null, result_id: null }));
        return { ok: true, data: { ok: true, batch_id: b.id, loaded: b.rows.length } };
      }
      case "import_batch_preview": {
        const b = db.batches.get(args.p_batch);
        const stageKeys = b.rows.filter((r) => r.entity_type === "stage").map((r) => r.external_key);
        for (const r of b.rows) {
          const p = r.payload ?? {};
          let err = null;
          if (r.entity_type === "deliverable") {
            if (!String(p.title ?? "").trim()) err = "title_required";
            else if (p.status && !DB_STATUS.includes(p.status)) err = `status_not_allowed_in_import: ${p.status}`;
            else if (p.schedule_status && !DB_SCHEDULE_STATUS.includes(p.schedule_status)) err = `bad_schedule_status: ${p.schedule_status}`;
            else if (p.priority && !DB_PRIORITY.includes(p.priority)) err = `bad_priority: ${p.priority}`;
            else if (p.content_type && !(options.contentTypes ?? ["video", "photography", "design", "print", "live_stream", "event", "field_execution", "presentation", "gift", "report", "digital_content", "copywriting", "custom"]).includes(p.content_type))
              err = `unknown_content_type: ${p.content_type}`;
            else if (p.stage_external_key && !stageKeys.includes(p.stage_external_key) && !db.stages.has(p.stage_external_key)) err = "stage_not_found";
          } else if (!String(p.name ?? "").trim()) err = "name_required";
          const store = r.entity_type === "stage" ? db.stages : db.deliverables;
          r.status = err ? "invalid" : "valid";
          r.action = err ? "error" : store.has(r.external_key) ? "skip" : "create";
          r.error = err;
        }
        return { ok: true, data: { ok: true, batch_id: b.id } };
      }
      case "import_batch_dry_run":
      case "import_batch_execute": {
        const b = db.batches.get(args.p_batch);
        const invalid = b.rows.filter((r) => r.status === "invalid").length;
        if (invalid > 0 && !args.p_allow_partial) return { ok: false, error: `batch_has_invalid_rows: ${invalid}`, status: 400 };
        const commit = fn === "import_batch_execute";
        let created = 0;
        let skipped = 0;
        for (const r of b.rows) {
          if (r.status !== "valid") continue;
          const store = r.entity_type === "stage" ? db.stages : db.deliverables;
          if (store.has(r.external_key)) {
            skipped++;
            if (commit) { r.status = "skipped"; r.action = "skip"; r.result_id = store.get(r.external_key); }
            continue;
          }
          created++;
          if (commit) {
            const id = `${r.entity_type}-${store.size + 1}`;
            store.set(r.external_key, id);
            r.status = "applied";
            r.action = "create";
            r.result_id = id;
          }
        }
        // the dry run leaves the staging statuses exactly as the preview set them
        return { ok: true, data: { ok: true, batch_id: b.id, created, skipped, failed: 0, note_ar: commit ? "" : "تشغيل تجريبي: لم يُكتب أيّ صفّ حقيقي." } };
      }
      case "import_batch_report": {
        const b = db.batches.get(args.p_batch);
        return { ok: true, data: { batch: { id: b.id, status: b.status }, rows: b.rows.map((r) => ({ row_number: r.row_number, entity_type: r.entity_type, external_key: r.external_key, action: r.action, status: r.status, error: r.error, result_id: r.result_id })), events: [] } };
      }
      default:
        return PGRST202_RESPONSE;
    }
  };
  call.db = db;
  return call;
}

const TARGET = "0f7f1b12-2222-4000-8000-000000000002";

test("batch rows: one stage row per stage, one row per deliverable, DB vocabulary only", () => {
  const built = buildBatchRows(PLAN, PROFILE, {});
  assert.equal(built.rows.filter((r) => r.entity_type === "stage").length, 4);
  assert.equal(built.rows.filter((r) => r.entity_type === "deliverable").length, 36);
  assert.equal(built.deeperLevelsRecordedAsMetadata, true, "the sub-group level must be reported, not silently dropped");
  for (const r of built.rows.filter((x) => x.entity_type === "deliverable")) {
    const p = r.payload;
    assert.ok(DB_STATUS.includes(p.status), `illegal status ${p.status}`);
    assert.ok(DB_SCHEDULE_STATUS.includes(p.schedule_status), `illegal schedule_status ${p.schedule_status}`);
    if (p.priority !== undefined) assert.ok(DB_PRIORITY.includes(p.priority), `illegal priority ${p.priority}`);
    assert.ok(Array.isArray(p.platforms));
    assert.equal(typeof p.metadata.content_hash, "string");
    assert.ok(Array.isArray(p.metadata.level_path), "the deeper level path is preserved in metadata");
  }
  // the sub-group of a deliverable is in metadata, and its stage key resolves
  const reels = built.rows.find((r) => r.payload?.title === "إطلاق 1 — ريلز");
  assert.equal(reels.payload.metadata.level_path[1], "اليوم الأول");
  assert.ok(built.rows.some((r) => r.entity_type === "stage" && r.external_key === reels.payload.stage_external_key));
});

test("free-text kinds map onto the database's catalog, unknown ones onto 'custom'", () => {
  const of = (raw) => contentTypeKeyFor({ content_type_raw: raw }, PROFILE).key;
  assert.equal(of("ريلز"), "video");
  assert.equal(of("تصوير فوتوغرافي"), "photography");
  assert.equal(of("تصميم"), "design");
  assert.equal(of("مقال"), "copywriting");
  assert.equal(of("بودكاست"), "custom", "an unknown kind lands on a REAL catalog key");
  assert.equal(of(""), "custom");
  assert.equal(contentTypeKeyFor({ content_type_raw: "بودكاست" }, PROFILE).matched, false);
  // Arabic priority words map onto the four values the database accepts
  const built = buildBatchRows(PLAN, PROFILE, {});
  const priorities = new Set(built.rows.filter((r) => r.entity_type === "deliverable").map((r) => r.payload.priority));
  for (const p of priorities) if (p !== undefined) assert.ok(DB_PRIORITY.includes(p));
});

test("batch dry run writes nothing and reports the whole plan", async () => {
  const call = fakeBatchDb();
  const res = await executeImport(PLAN, { mode: "dry_run", skipInvalidRows: true, projectId: TARGET, profile: PROFILE }, call);
  assert.equal(res.code, "DRY_RUN_OK", res.message);
  assert.equal(res.ok, true);
  assert.equal(res.created, 40, "36 deliverables + 4 stages");
  assert.equal(res.failed, 0);
  assert.equal(res.notAttempted, 0);
  assert.equal(call.db.deliverables.size, 0, "a dry run must not create anything");
  assert.equal(call.db.stages.size, 0);
});

test("batch commit creates everything, and a second run creates nothing", async () => {
  const call = fakeBatchDb();
  const first = await executeImport(PLAN, { mode: "commit", skipInvalidRows: true, projectId: TARGET, profile: PROFILE }, call);
  assert.equal(first.code, "COMMITTED", first.message);
  assert.equal(first.created, 40);
  assert.equal(call.db.deliverables.size, 36);
  assert.equal(call.db.stages.size, 4);

  // the same file again, against the same database → nothing new
  const second = await executeImport(PLAN, { mode: "commit", skipInvalidRows: true, projectId: TARGET, profile: PROFILE }, call);
  assert.equal(second.code, "NOTHING_TO_DO", second.message);
  assert.equal(second.created, 0);
  assert.equal(second.unchanged, 40);
  assert.equal(call.db.deliverables.size, 36, "re-import must not duplicate a single row");
});

test("editing one row re-imports only that row through the batch backend", async () => {
  const call = fakeBatchDb();
  await executeImport(PLAN, { mode: "commit", skipInvalidRows: true, projectId: TARGET, profile: PROFILE }, call);

  const edited = FIXTURE_ROWS.map((r) => [...r]);
  const target = edited.findIndex((r) => r[2] === "إطلاق 3 — ريلز");
  edited[target][2] = "إطلاق 3 — ريلز (نسخة جديدة)";
  const plan2 = planFor(toCsv(edited));
  const res = await executeImport(plan2, { mode: "commit", skipInvalidRows: true, projectId: TARGET, profile: PROFILE }, call);
  assert.equal(res.code, "COMMITTED");
  assert.equal(res.created, 1, "only the changed row is new");
  assert.equal(res.unchanged, 39);
  assert.equal(call.db.deliverables.size, 37);
});

test("the batch backend refuses without a target project and above the row limit", async () => {
  const call = fakeBatchDb();
  const noTarget = await executeImport(PLAN, { mode: "commit", skipInvalidRows: true, profile: PROFILE }, call);
  assert.equal(noTarget.code, "REFUSED_INVALID_PLAN");
  assert.match(noTarget.message, /مشروعًا هدفًا/);
  assert.equal(call.db.calls.length, 1, "only the capability probe ran");
  const noProfile = await executeImport(PLAN, { mode: "commit", skipInvalidRows: true, projectId: TARGET }, fakeBatchDb());
  assert.equal(noProfile.code, "REFUSED_INVALID_PLAN");
});

test("a database-side rejection is reported per row, never as success", async () => {
  // A catalog that does not know 'video' ⇒ the preview marks those rows invalid.
  const call = fakeBatchDb({ contentTypes: ["custom"] });
  const res = await executeImport(PLAN, { mode: "commit", skipInvalidRows: true, projectId: TARGET, profile: PROFILE }, call);
  assert.equal(res.ok, false);
  assert.equal(res.code, "PARTIAL_REPORTED");
  assert.ok(res.failed > 0);
  assert.ok(res.rows.some((r) => r.action === "failed" && /unknown_content_type/.test(r.error ?? "")));
});

test("invalid rows abort the batch when the operator did not acknowledge them", async () => {
  const call = fakeBatchDb({ contentTypes: ["custom"] });
  const res = await executeImport(PLAN, { mode: "commit", projectId: TARGET, profile: PROFILE }, call);
  // the plan itself carries invalid rows, so we never reach the database
  assert.equal(res.code, "REFUSED_INVALID_ROWS");
  assert.equal(call.db.calls.length, 0);
});

test("a mid-protocol failure on commit is reported as AMBIGUOUS, with the batch id", async () => {
  const base = fakeBatchDb();
  const call = async (fn, args) => (fn === "import_batch_execute" ? { ok: false, error: "deadlock detected", status: 500 } : base(fn, args));
  const res = await executeImport(PLAN, { mode: "commit", skipInvalidRows: true, projectId: TARGET, profile: PROFILE }, call);
  assert.equal(res.ok, false);
  assert.equal(res.code, "AMBIGUOUS_RESULT");
  assert.equal(res.created, 0, "an interrupted commit may not claim creations");
  assert.match(res.message, /راجع الدفعة batch-1/);
  assert.match(res.message, /لا تفترض/);
});

test("a batch backend that vanishes mid-protocol degrades to 'migration pending'", async () => {
  const base = fakeBatchDb();
  const call = async (fn, args) => (fn === "import_batch_create" ? PGRST202_RESPONSE : base(fn, args));
  const res = await executeImport(PLAN, { mode: "commit", skipInvalidRows: true, projectId: TARGET, profile: PROFILE }, call);
  assert.equal(res.code, "MIGRATION_PENDING");
  assert.match(res.message, /لم تُحدَّث بعد/);
});

// ─── volume ────────────────────────────────────────────────────────────────
test("warnings are capped for a huge sheet while the counts stay exact", () => {
  const rows = [];
  for (let i = 1; i <= 700; i++) rows.push(["مرحلة", "مجموعة", `بند ${i}`, "فيديو", "انستغرام", "", "", "قريبًا", "1", ""]);
  const plan = planFor(toCsv(rows));
  assert.equal(plan.counts.accepted, 700, "every row is still planned");
  assert.equal(plan.deliverables.filter((d) => d.due_date === null).length, 700);
  assert.ok(plan.warnings.length <= 502, `warnings were not bounded (${plan.warnings.length})`);
  const last = plan.warnings[plan.warnings.length - 1];
  assert.equal(last.code, "truncated");
  assert.match(last.message, /الأعداد أدناه كاملة وصحيحة/);
});

test("thousands of rows plan in linear time with unique keys", () => {
  const rows = [];
  for (let s = 1; s <= 20; s++) {
    rows.push([`مرحلة ${s}`, "", "", "", "", "", "", "", "", ""]);
    for (let i = 1; i <= 150; i++) rows.push(["", `مجموعة ${i % 5}`, `بند ${s}-${i}`, "فيديو", "انستغرام", "تفاصيل", "وصف", "", "1", ""]);
  }
  const csv = toCsv(rows);
  const started = Date.now();
  const plan = planFor(csv);
  const elapsed = Date.now() - started;
  assert.equal(plan.counts.accepted, 3000);
  assert.equal(plan.counts.stagesToCreate, 20);
  assert.equal(new Set(plan.deliverables.map((d) => d.external_key)).size, 3000, "3000 distinct keys");
  assert.ok(elapsed < 10_000, `planning 3000 rows took ${elapsed}ms`);
});

// ─── the shipped CSV template must work with the shipped profile ───────────
test("docs/templates/project_import_template.csv imports cleanly", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const bytes = new Uint8Array(fs.readFileSync(path.join(__dirname, "..", "docs/templates/project_import_template.csv")));
  const wb = parseWorkbook(bytes, "project_import_template.csv");
  const plan = buildPlan({ sheet: pickSheet(wb, null).sheet, profile: PROFILE, context: { projectKey: "قالب" }, fileName: "template.csv" });
  assert.equal(plan.ok, true, plan.fatalMessage ?? "");
  assert.equal(plan.counts.invalid, 0);
  assert.ok(plan.counts.accepted >= 6, "the template must contain usable example rows");
  assert.equal(plan.unmappedColumns.length, 0, "every template column must be mapped by the shipped profile");
  assert.equal(plan.deliverables.filter((d) => d.due_date !== null).length, 2, "only the two dated example rows carry a date");
});
