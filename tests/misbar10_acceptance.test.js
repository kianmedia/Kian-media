// ════════════════════════════════════════════════════════════════════════════
// tests/misbar10_acceptance.test.js — حراس القبول الاصطناعية. تعمل دائمًا.
//
// THIS SUITE CONTAINS NO CLIENT DATA AND NEEDS NONE. It runs everywhere — CI,
// Vercel, a fresh clone — and it is where the structural coverage lives now.
//
// Two synthetic fixtures, two different jobs:
//
//   1. tests/fixtures/misbar10_sanitized.json — an INVENTED content-plan sheet
//      that mirrors the SHAPE of a real one: 1 parent, 11 blocks, 79 rows, the
//      distribution [7,5,8,4,3,4,9,7,16,10,6], the same empty-cell census, the
//      same traps (a merged block, four numbered sections, a date inside a
//      title, a near-duplicate pair, a preserved typo, two content types that
//      differ only by a trailing space, three platform separators). The suite
//      rebuilds a real .xlsx from it and drives the repo's OWN import engine
//      over it, so the eight headline numbers and every no-merge / no-invented-
//      date / verbatim rule are proved with zero client prose in the tree.
//
//   2. tests/fixtures/misbar10_structure.json — an INVENTED stage/deliverable
//      dataset that guards the PLATFORM shapes (empty stage, recurrence vs
//      quantity, client visibility, roll-up arithmetic, DB type domain).
//
// The owner's real workbook is asserted cell by cell in
// tests/misbar10_real_dataset.test.js and tests/misbar10_real_file_import.test.js.
// Those are OPTIONAL LOCAL ACCEPTANCE suites: the files are git-ignored client
// data, so when they are absent those suites SKIP loudly. Nothing in this file
// depends on them, and no platform code may hardcode a deliverable count or
// name a client.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { ROOT, TS_AVAILABLE, loadTs, makeXlsx } = require("./import_engine_loader.js");
const { CANDIDATES, resolveInput } = require("./misbar10_private_paths.js");

const SANITIZED_PATH = path.join(ROOT, "tests/fixtures/misbar10_sanitized.json");
const STRUCTURE_PATH = path.join(ROOT, "tests/fixtures/misbar10_structure.json");
const PROFILE_PATH = path.join(ROOT, "docs/import_profiles/misbar10.json");
const AUDIT_PATH = path.join(ROOT, "docs/MISBAR10_PLATFORM_GAP_AUDIT.md");

const S = JSON.parse(fs.readFileSync(SANITIZED_PATH, "utf8"));
const F = JSON.parse(fs.readFileSync(STRUCTURE_PATH, "utf8"));
const PROFILE_JSON = JSON.parse(fs.readFileSync(PROFILE_PATH, "utf8"));

const ARABIC = /[؀-ۿ]/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
// The real CHECK on public.deliverables.type (docs/phase0_migration.sql:219).
const DB_TYPES = new Set(["video", "photo", "other"]);
// The statuses RLS exposes to a client (docs/phase0_migration.sql:886-891).
const CLIENT_VISIBLE_STATUSES = new Set(["client_review", "revision_requested", "approved", "final_delivered"]);

// ════════════════════════════════════════════════════════════════════════════
// PART A — the sanitized import fixture, driven through the REAL engine.
//
// Everything here used to be provable only against the owner's workbook. It is
// proved against invented bytes now, so it keeps running with no client file
// anywhere on the machine.
// ════════════════════════════════════════════════════════════════════════════

if (!TS_AVAILABLE) {
  test("محرّك الاستيراد قابل للتحميل (sucrase)", () => {
    assert.fail("sucrase غير متاح — لا يمكن تنفيذ محرّك الاستيراد، والاختبار لا يجوز أن يمرّ فارغًا.");
  });
}

const parse = TS_AVAILABLE ? loadTs("lib/portal/import/parse.ts") : null;
const preview = TS_AVAILABLE ? loadTs("lib/portal/import/preview.ts") : null;
const profiles = TS_AVAILABLE ? loadTs("lib/portal/import/profiles.ts") : null;
const keys = TS_AVAILABLE ? loadTs("lib/portal/import/keys.ts") : null;
const textUtil = TS_AVAILABLE ? loadTs("lib/portal/import/text.ts") : null;
const mappingUtil = TS_AVAILABLE ? loadTs("lib/portal/import/mapping.ts") : null;

const engineOpts = TS_AVAILABLE ? {} : { skip: "sucrase غير متاح — لا يمكن تنفيذ المحرّك" };

const EXPECT = S.expect;
const COL = { A: 0, B: 1, C: 2, D: 3, E: 4, F: 5 };
const HEADER_B = "المحتوى";
const HEADER_C = "نوع المحتوى";

/** A REAL .xlsx built from the fixture's grid — the reader is fed bytes, not JSON. */
const SAN_BYTES = TS_AVAILABLE ? makeXlsx(S.sheet.rows, { sheetName: S.sheet.name }) : null;
const WB = TS_AVAILABLE ? parse.parseWorkbook(SAN_BYTES, S.source.file) : null;
const SHEET = TS_AVAILABLE ? WB.sheets.find((s) => s.name === S.sheet.name) : null;
const PROFILE = TS_AVAILABLE ? profiles.resolveProfile(PROFILE_JSON) : null;

function cell(row, i) {
  const v = row.cells[i];
  return v === undefined || v === "" ? null : v;
}
function blank(row, i) {
  return cell(row, i) === null;
}

/** banner = B set and C..F blank; header = the repeated column-title row. */
function classify() {
  const banners = [];
  const rows = [];
  const headers = [];
  const empties = [];
  for (const r of SHEET.rows) {
    const anyBF = [COL.B, COL.C, COL.D, COL.E, COL.F].some((c) => !blank(r, c));
    if (!anyBF && blank(r, COL.A)) {
      empties.push(r.rowNumber);
      continue;
    }
    const b = cell(r, COL.B);
    const c = cell(r, COL.C);
    if (b !== null && b.trim() === HEADER_B && c !== null && c.trim() === HEADER_C) {
      headers.push(r.rowNumber);
      continue;
    }
    if (b !== null && [COL.C, COL.D, COL.E, COL.F].every((x) => blank(r, x))) {
      banners.push({ rowNumber: r.rowNumber, title: b });
      continue;
    }
    rows.push(r);
  }
  return { banners, rows, headers, empties };
}
const SHEET_VIEW = TS_AVAILABLE ? classify() : null;

function planFromFixture(context) {
  const picked = parse.pickSheet(WB, S.sheet.name);
  return preview.buildPlan({
    sheet: picked.sheet,
    profile: PROFILE,
    context: Object.assign({ projectKey: S.project.project_key, parentProjectTitle: S.project.title }, context || {}),
    carriedWarnings: WB.warnings.concat(picked.warnings),
    fileName: S.source.file,
  });
}
const PLAN = TS_AVAILABLE ? planFromFixture() : null;

/** The 13 catalog keys, read from the mapping profile — never written here. */
const GENERIC_KEYS = Object.keys(PROFILE_JSON.contentTypeKeys).filter((k) => !k.startsWith("$")).concat(["custom"]);
function contentTypeKeyOf(raw) {
  const n = textUtil.normalizeForMatch(raw);
  for (const [k, list] of Object.entries(PROFILE_JSON.contentTypeKeys)) {
    if (k.startsWith("$")) continue;
    if (list.some((syn) => textUtil.normalizeForMatch(syn) === n)) return k;
  }
  return "custom";
}

// ─── A0) the fixture must be unmistakably synthetic ──────────────────────────
test("sanitized: الملف موسوم كبيانات اصطناعية بلا لبس", () => {
  assert.equal(S.synthetic, true, "العلم synthetic غير مضبوط في الجذر");
  assert.match(S._WARNING_EN, /SYNTHETIC/i, "لا تحذير إنجليزي في الترويسة");
  assert.match(S._WARNING_EN, /NOT OWNER DATA/i, "التحذير لا ينفي ملكية البيانات");
  assert.match(S._WARNING_EN, /NOT CLIENT DATA/i, "التحذير لا ينفي أنّها بيانات عميل");
  assert.match(S._WARNING_EN, /INVENTED/i, "التحذير لا يقول إنّ المحتوى مُختلَق");
  assert.match(S._WARNING_AR, /اصطناعي/, "لا تحذير عربي في الترويسة");
  assert.match(S._WARNING_AR, /مُختلَق/, "التحذير العربي لا يقول إنّ المحتوى مُختلَق");
  // It must not pretend to be, or point at, the owner's file.
  assert.equal(S.source.file, "SYNTHETIC_PLAN.xlsx", "الملف الاصطناعي ينتحل اسم ملف حقيقي");
  const raw = fs.readFileSync(SANITIZED_PATH, "utf8");
  assert.doesNotMatch(raw, /MISBAR10_PLAN\.xlsx/, "الملف الاصطناعي يشير إلى ملف المالك");
  // Real Arabic bytes on disk, not \u escapes — the traps are byte-level.
  assert.ok(raw.includes("المرحلة الأولى"), "العربية مهرَّبة إلى \\u بدل حفظها كما هي");
  assert.doesNotMatch(raw, /\\u06[0-9a-f]{2}/i, "الملف يحوي هروبًا يونيكوديًّا بدل النصّ العربي");
  // A reader must be told what the file is FOR, and which traps it carries.
  assert.ok(Array.isArray(S.mirrors.traps) && S.mirrors.traps.length >= 8, "الفخاخ المحاكاة غير مذكورة");
});

// ─── A1) the eight headline numbers, each its own named assertion ────────────
test("sanitized: parent_project_count = 1", engineOpts, () => {
  assert.ok(S.project && typeof S.project === "object" && !Array.isArray(S.project), "لا مشروع أب واحد في الملف");
  assert.equal(PLAN.parentProject.key, S.project.external_key, "مفتاح المشروع الأب لا يطابق ما يولّده المحرّك");
  assert.equal(PLAN.counts.parentProjectsToCreate, EXPECT.parent_project_count);
});

test("sanitized: operational_block_count = 11", engineOpts, () => {
  assert.equal(SHEET_VIEW.banners.length, EXPECT.operational_block_count, "عدد اللافتات المقروء من البايتات ليس 11");
  assert.equal(S.blocks.length, EXPECT.operational_block_count, "عدد الكتل في الملف ليس 11");
  assert.equal(S.counts.blocks, EXPECT.operational_block_count, "العدّاد المعلن ليس 11");
  assert.equal(PLAN.nodes.length, EXPECT.operational_block_count, "عدد العقد التي بناها المحرّك ليس 11");
  assert.equal(PLAN.counts.stagesToCreate, EXPECT.operational_block_count);
});

test("sanitized: deliverable_count = 79", engineOpts, () => {
  assert.equal(SHEET_VIEW.rows.length, EXPECT.deliverable_count, "عدد أسطر المحتوى المقروء من البايتات ليس 79");
  assert.equal(S.deliverables.length, EXPECT.deliverable_count, "عدد المخرجات في الملف ليس 79");
  assert.equal(S.counts.deliverables, EXPECT.deliverable_count, "العدّاد المعلن ليس 79");
  assert.equal(PLAN.counts.accepted, EXPECT.deliverable_count, "المحرّك قَبِل عددًا مختلفًا");
  assert.equal(PLAN.deliverables.length, EXPECT.deliverable_count);
  assert.equal(PLAN.invalidRows.length, 0, "المحرّك رفض أسطرًا — كان يجب أن يقبلها كلّها");
  assert.equal(PLAN.duplicateRows.length, 0, "المحرّك استبعد أسطرًا كمكرّرة — لا يوجد مكرّر حقيقي");
});

test("sanitized: distribution = [7,5,8,4,3,4,9,7,16,10,6]", engineOpts, () => {
  const fromBytes = [];
  for (const r of SHEET.rows) {
    if (SHEET_VIEW.banners.some((b) => b.rowNumber === r.rowNumber)) fromBytes.push(0);
    else if (SHEET_VIEW.rows.some((x) => x.rowNumber === r.rowNumber)) {
      assert.ok(fromBytes.length > 0, `السطر ${r.rowNumber} يسبق أوّل لافتة — يتيم`);
      fromBytes[fromBytes.length - 1] += 1;
    }
  }
  assert.deepEqual(fromBytes, EXPECT.distribution, "التوزيع المقروء من البايتات مختلف");
  assert.deepEqual(S.counts.distribution, EXPECT.distribution, "التوزيع المعلن مختلف");
  assert.deepEqual(S.blocks.map((b) => b.deliverable_count), EXPECT.distribution, "deliverable_count لكل كتلة مختلف");
  assert.deepEqual(PLAN.nodes.map((n) => n.deliverableCount), EXPECT.distribution, "توزيع المحرّك مختلف");
  const byBlock = S.blocks.map((b) => S.deliverables.filter((d) => d.block_index === b.index).length);
  assert.deepEqual(byBlock, EXPECT.distribution, "عدّاد الكتلة لا يساوي عدد المخرجات المنسوبة إليها");
  assert.equal(EXPECT.distribution.reduce((a, n) => a + n, 0), EXPECT.deliverable_count);
});

test("sanitized: duplicate_external_keys = 0", engineOpts, () => {
  const all = S.deliverables.map((d) => d.external_key).concat(
    S.blocks.map((b) => b.external_key),
    [S.project.external_key],
  );
  const seen = new Set();
  const dupes = [];
  for (const k of all) {
    if (seen.has(k)) dupes.push(k);
    seen.add(k);
  }
  assert.deepEqual(dupes, [], `مفاتيح مكرّرة: ${dupes.join(", ")}`);
  assert.equal(all.length - seen.size, EXPECT.duplicate_external_keys);
  assert.equal(PLAN.counts.duplicate, EXPECT.duplicate_external_keys);
  assert.equal(new Set(PLAN.deliverables.map((d) => d.external_key)).size, EXPECT.deliverable_count,
    "مفاتيح المحرّك ليست فريدة");
});

test("sanitized: rows_with_fake_dates = 0", engineOpts, () => {
  const DATE_FIELDS = ["planned_start_date", "due_date", "start_date", "end_date", "date", "scheduled_at"];
  const offenders = [];
  const scan = (obj, where) => {
    if (obj === null || typeof obj !== "object") return;
    if (Array.isArray(obj)) return obj.forEach((v, i) => scan(v, `${where}[${i}]`));
    for (const [k, v] of Object.entries(obj)) {
      if (DATE_FIELDS.includes(k) && v !== null) offenders.push(`${where}.${k} = ${JSON.stringify(v)}`);
      scan(v, `${where}.${k}`);
    }
  };
  scan(S.project, "project");
  S.blocks.forEach((b, i) => scan(b, `blocks[${i}]`));
  S.deliverables.forEach((d) => scan(d, `row#${d.source_row_number}`));
  assert.deepEqual(offenders, [], `تواريخ مُختلَقة: ${offenders.join(" | ")}`);
  assert.equal(offenders.length, EXPECT.rows_with_fake_dates);

  assert.equal(S.project.schedule_status, "awaiting_schedule");
  for (const b of S.blocks) assert.equal(b.schedule_status, "awaiting_schedule", `الكتلة ${b.index}`);
  for (const d of S.deliverables) assert.equal(d.schedule_status, "awaiting_schedule", `السطر ${d.source_row_number}`);
  assert.equal(PLAN.deliverables.filter((d) => d.due_date !== null).length, 0, "المحرّك اخترع تاريخًا");
  assert.equal(PLAN.warnings.filter((w) => w.code === "unparsed_date").length, 0);

  // ضمانة عدم التفاهة: قارئ التواريخ في المحرّك قادر فعلًا على إنتاج تاريخ.
  assert.equal(mappingUtil.parseDateStrict("2026-06-07").iso, "2026-06-07",
    "قارئ التواريخ لا يقرأ تاريخًا صحيحًا — الاختبار أعلاه يمرّ فارغًا");
});

test("sanitized: rows_missing_source_row = 0", engineOpts, () => {
  const missing = S.deliverables.filter((d) => !Number.isInteger(d.source_row_number) || d.source_row_number < 1);
  assert.deepEqual(missing.map((d) => d.title), [], "مخرجات بلا رقم سطر مصدر");
  assert.equal(missing.length, EXPECT.rows_missing_source_row);
  for (const b of S.blocks) {
    assert.ok(Number.isInteger(b.source_row_number) && b.source_row_number >= 1, `الكتلة ${b.index} بلا رقم سطر مصدر`);
  }
  const real = new Set(SHEET.rows.map((r) => r.rowNumber));
  for (const d of S.deliverables) assert.ok(real.has(d.source_row_number), `السطر ${d.source_row_number} غير موجود في الورقة`);
  for (const b of S.blocks) assert.ok(real.has(b.source_row_number), `سطر الكتلة ${b.source_row_number} غير موجود`);
  assert.equal(PLAN.deliverables.filter((d) => !Number.isInteger(d.source_row_number)).length, 0);
});

test("sanitized: rows_missing_external_key = 0", engineOpts, () => {
  const bad = S.deliverables.filter((d) => typeof d.external_key !== "string" || d.external_key.trim() === "");
  assert.deepEqual(bad.map((d) => d.source_row_number), [], "مخرجات بلا مفتاح خارجي");
  assert.equal(bad.length, EXPECT.rows_missing_external_key);
  for (const b of S.blocks) assert.ok(b.external_key && b.external_key.trim() !== "", `الكتلة ${b.index} بلا مفتاح`);
  assert.ok(S.project.external_key.trim() !== "", "المشروع الأب بلا مفتاح");
  for (const d of S.deliverables) {
    const block = S.blocks.find((b) => b.index === d.block_index);
    assert.ok(block, `السطر ${d.source_row_number}: كتلة غير موجودة ${d.block_index}`);
    assert.equal(d.block_external_key, block.external_key, `السطر ${d.source_row_number}: مفتاح كتلة غير مطابق`);
    const stem = block.external_key.replace(/:#node$/, "");
    assert.ok(d.external_key.startsWith(`${stem}:`), `السطر ${d.source_row_number}: المفتاح لا ينتمي لمسار كتلته`);
  }
  assert.equal(PLAN.deliverables.filter((d) => !d.external_key || d.external_key.trim() === "").length, 0);
});

// ─── A2) the engine agrees with the fixture, byte for byte ───────────────────
test("sanitized: reader_vs_fixture_cell_exact — كل خلية في الملف تطابق ما قرأه القارئ", engineOpts, () => {
  const byRow = new Map(SHEET.rows.map((r) => [r.rowNumber, r]));
  const diffs = [];
  for (const d of S.deliverables) {
    const r = byRow.get(d.source_row_number);
    const expected = [d.title, d.metadata.source_content_type, d.metadata.source_platforms, d.execution_details, d.proposed_caption];
    const actual = [cell(r, COL.B), cell(r, COL.C), cell(r, COL.D), cell(r, COL.E), cell(r, COL.F)];
    for (let i = 0; i < expected.length; i++) {
      if (expected[i] !== actual[i]) {
        diffs.push(`سطر ${d.source_row_number} عمود ${["B", "C", "D", "E", "F"][i]}: ملف=${JSON.stringify(actual[i])} ملحق=${JSON.stringify(expected[i])}`);
      }
    }
  }
  assert.deepEqual(diffs, [], `اختلاف بين القارئ والملف:\n${diffs.join("\n")}`);
  // ولا مسافة زائدة حُذفت خلسة: النصّ الأصلي محفوظ بمسافاته
  assert.ok(S.deliverables.some((d) => d.metadata.source_content_type !== d.metadata.source_content_type.trim()),
    "لا قيمة تحمل مسافة طرفية — لُمِّعت البيانات، وفخّ المسافات لم يُختبر");
});

test("sanitized: engine_reproduces_the_fixture — buildPlan فوق البايتات يعيد إنتاج كل مفتاح", engineOpts, () => {
  assert.equal(PLAN.ok, true, `المحرّك فشل: ${PLAN.fatalMessage}`);
  assert.deepEqual(PLAN.deliverables.map((d) => d.external_key), S.deliverables.map((d) => d.external_key),
    "مفاتيح المخرجات التي يولّدها المحرّك تختلف عن الملف");
  assert.deepEqual(PLAN.nodes.map((n) => n.key), S.blocks.map((b) => b.external_key), "مفاتيح الكتل تختلف");
  assert.deepEqual(PLAN.deliverables.map((d) => d.source_row_number), S.deliverables.map((d) => d.source_row_number),
    "ترتيب/أرقام أسطر المحرّك تختلف عن الملف");
  assert.deepEqual(PLAN.nodes.map((n) => n.title), S.blocks.map((b) => b.title), "عناوين الكتل تختلف");

  // القيم: المحرّك يخزّن القيمة بعد cleanCell، والملف يحفظ الأصل الخام.
  // الجسر بينهما هو cleanCell نفسها — لا استثناء يدويّ.
  const nz = (s) => {
    const c = textUtil.cleanCell(s === null || s === undefined ? "" : s);
    return c === "" ? null : c;
  };
  const diffs = [];
  PLAN.deliverables.forEach((d, i) => {
    const p = S.deliverables[i];
    const pairs = [
      ["title", d.title, nz(p.title)],
      ["content_type_raw", d.content_type_raw, nz(p.metadata.source_content_type)],
      ["platforms", JSON.stringify(d.platforms), JSON.stringify(p.platforms)],
      ["execution_details", d.execution_details, nz(p.execution_details)],
      ["proposed_caption", d.proposed_caption, nz(p.proposed_caption)],
      ["schedule_status", d.schedule_status, p.schedule_status],
      ["due_date", d.due_date, p.due_date],
    ];
    for (const [f, a, b] of pairs) if (a !== b) diffs.push(`سطر ${p.source_row_number} ${f}: محرّك=${JSON.stringify(a)} ملف=${JSON.stringify(b)}`);
  });
  assert.deepEqual(diffs, [], `المحرّك والملف يختلفان:\n${diffs.join("\n")}`);
  assert.deepEqual(PLAN.warnings, [], "المحرّك رفع تنبيهًا على ملف اصطناعي نظيف");
});

// ─── A3) العربية والترميز ────────────────────────────────────────────────────
test("sanitized: arabic_integrity — لا تشويه ترميز ولا تطبيع مدمِّر", engineOpts, () => {
  const texts = [S.project.title];
  for (const b of S.blocks) texts.push(b.title);
  for (const d of S.deliverables) {
    texts.push(d.title, d.metadata.source_content_type);
    if (d.execution_details) texts.push(d.execution_details);
    if (d.proposed_caption) texts.push(d.proposed_caption);
    if (d.metadata.source_platforms) texts.push(d.metadata.source_platforms);
    for (const p of d.platforms) texts.push(p);
  }
  for (const s of texts) {
    assert.equal(typeof s, "string");
    assert.ok(s.trim().length > 0, "نصّ فارغ مخزَّن كنصّ");
    assert.ok(ARABIC.test(s), `لا أحرف عربية في «${s}»`);
    assert.ok(!s.includes("�"), `محرف بديل (ترميز تالف): «${s}»`);
    assert.doesNotMatch(s, /[ÃØÙÚâ€]{2,}/, `تشويه ترميز محتمل: «${s}»`);
    assert.doesNotMatch(s, /\?\?\?/, `علامات استفهام بديلة: «${s}»`);
  }
});

test("sanitized: source_typo_is_preserved — الخطأ الإملائي باقٍ كما كُتب", engineOpts, () => {
  const TYPO = EXPECT.typo;
  const CORRECT = TYPO.replace(/(.)\1+/, "$1");
  assert.notEqual(TYPO, CORRECT, "«الخطأ» ليس خطأً — الفخّ فارغ");
  const inBytes = SHEET.rows.filter((r) => r.cells.join(" ").includes(TYPO)).map((r) => r.rowNumber);
  assert.deepEqual(inBytes, EXPECT.near_duplicate_rows, "الخطأ الإملائي ليس في السطرين المتوقّعين");
  const inFixture = S.deliverables.filter((d) => (d.execution_details || "").includes(TYPO)).map((d) => d.source_row_number);
  assert.deepEqual(inFixture, EXPECT.near_duplicate_rows, "الخطأ الإملائي صُحِّح أو ضاع");
  const inPlan = PLAN.deliverables.filter((d) => (d.execution_details || "").includes(TYPO)).map((d) => d.source_row_number);
  assert.deepEqual(inPlan, EXPECT.near_duplicate_rows, "المحرّك «صحّح» الخطأ — الأمانة النصّية مكسورة");
  for (const n of EXPECT.near_duplicate_rows) {
    const d = S.deliverables.find((x) => x.source_row_number === n);
    const r = SHEET.rows.find((x) => x.rowNumber === n);
    assert.equal(d.execution_details, cell(r, COL.E), `السطر ${n}: تفاصيل التنفيذ لا تطابق البايتات حرفًا بحرف`);
    assert.ok(!d.execution_details.includes(CORRECT), `السطر ${n}: الخطأ صُحِّح`);
  }
});

test("sanitized: unicode_lookalikes_stay_distinct — نسختا «تصميم» محفوظتان بالبايت", engineOpts, () => {
  const ctVariants = new Set(S.deliverables.map((d) => d.metadata.source_content_type));
  const tasmim = [...ctVariants].filter((s) => textUtil.normalizeForMatch(s) === "تصميم");
  assert.equal(tasmim.length, 2, `«تصميم» ظهرت ${tasmim.length} مرّة كصيغة متمايزة — المتوقّع نسختان مختلفتان بالبايت`);
  assert.equal(new Set(tasmim).size, 2, "النسختان متطابقتان بالبايت — لا فخّ");
  assert.equal(new Set(tasmim.map((s) => s.trim())).size, 1, "النسختان لا تتطابقان بعد الاقتصاص — ليستا الفخّ نفسه");
  // التطبيع للمطابقة فقط: الصيغتان تنهاران إلى نوع واحد رغم اختلاف البايت
  const types = new Set(S.deliverables.filter((d) => tasmim.includes(d.metadata.source_content_type)).map((d) => d.content_type));
  assert.deepEqual([...types], ["design"], "نسختا «تصميم» أُسنِدتا إلى نوعين مختلفين — التطبيع لم يُستعمل في المطابقة");
  // لا دمج ولا تنظيف: عدد القيم المتمايزة كما هو
  assert.equal(ctVariants.size, EXPECT.distinct_content_types,
    `عدد قيم «نوع المحتوى» المتمايزة ${ctVariants.size} وليس ${EXPECT.distinct_content_types}`);
  assert.equal(new Set(S.deliverables.map((d) => d.metadata.source_platforms)).size, EXPECT.distinct_platform_cells,
    "عدد قيم «المنصات» المتمايزة تغيّر");
});

// ─── A4) لا سطر ضاع، ولا سطران دُمِجا ────────────────────────────────────────
test("sanitized: no_content_row_is_lost — كل سطر محتوى يظهر مرّة واحدة بالضبط", engineOpts, () => {
  const fromBytes = SHEET_VIEW.rows.map((r) => r.rowNumber).sort((a, b) => a - b);
  const inFixture = S.deliverables.map((d) => d.source_row_number).sort((a, b) => a - b);
  assert.deepEqual(inFixture, fromBytes, "مجموعة أسطر الملف لا تساوي أسطر المحتوى في البايتات");
  assert.equal(new Set(inFixture).size, inFixture.length, "سطر مصدر مستعمَل أكثر من مرّة");
  assert.deepEqual(PLAN.deliverables.map((d) => d.source_row_number).sort((a, b) => a - b), fromBytes);
  assert.deepEqual(S.blocks.map((b) => b.source_row_number), SHEET_VIEW.banners.map((b) => b.rowNumber));

  // صفوف العناوين مكرّرة مرّة تحت كل لافتة: المحرّك يتّخذ واحدة، والباقي يجب أن
  // يُسجَّل في skippedRows — لا يختفي بصمت ولا يصير مخرَجًا.
  assert.equal(SHEET_VIEW.headers.length, 11, "عدد صفوف العناوين المكرّرة ليس 11");
  const headerRowNumber = mappingUtil.buildMapping(parse.pickSheet(WB, S.sheet.name).sheet, PROFILE).headerRowNumber;
  assert.ok(SHEET_VIEW.headers.includes(headerRowNumber), `صفّ العناوين الذي اختاره المحرّك (${headerRowNumber}) ليس أحد الصفوف الـ11`);
  for (const n of SHEET_VIEW.headers) {
    assert.equal(S.deliverables.some((d) => d.source_row_number === n), false, `صفّ عناوين ${n} صار مخرَجًا`);
    assert.equal(PLAN.deliverables.some((d) => d.source_row_number === n), false, `صفّ عناوين ${n} صار مخرَجًا عند المحرّك`);
    if (n === headerRowNumber) continue;
    assert.ok(PLAN.skippedRows.some((s) => s.rowNumber === n), `صفّ العناوين ${n} أُسقط بلا تسجيل`);
  }
  for (const b of SHEET_VIEW.banners) {
    assert.ok(PLAN.skippedRows.some((s) => s.rowNumber === b.rowNumber), `لافتة الكتلة ${b.rowNumber} أُسقطت بلا تسجيل`);
  }
  // كل سطر مادّي في الورقة ينتهي في دلو واحد بالضبط (+1 = صفّ العناوين المعتمَد)
  const bucketed = PLAN.counts.accepted + PLAN.counts.skipped + PLAN.counts.duplicate + PLAN.counts.invalid;
  assert.equal(bucketed + 1, SHEET.rows.length, "سطر اختفى بلا تسجيل");
  assert.equal(SHEET.rows.length, S.source.parsed_rows, "عدد الأسطر المقروءة تغيّر");
});

test("sanitized: the_near_duplicate_pair_stays_two — سطران يفترقان في كلمة واحدة", engineOpts, () => {
  const [n1, n2] = EXPECT.near_duplicate_rows;
  const pair = S.deliverables.filter((d) => d.source_row_number === n1 || d.source_row_number === n2)
    .sort((x, y) => x.source_row_number - y.source_row_number);
  assert.equal(pair.length, 2, "أحد السطرين ضاع أو دُمج");
  const [a, b] = pair;
  assert.equal(a.title, b.title, "العنوانان مختلفان — ليست الحالة المقصودة");
  assert.equal(a.content_type, b.content_type);
  assert.equal(a.metadata.source_platforms, b.metadata.source_platforms);
  assert.equal(a.proposed_caption, b.proposed_caption);
  assert.notEqual(a.external_key, b.external_key, "السطران يحملان المفتاح نفسه — سيُدمجان عند الاستيراد");
  assert.notEqual(a.execution_details, b.execution_details, "تفاصيل التنفيذ متطابقة — أحد النصّين ضاع");
  // ويختلفان في الكلمة الأخيرة فقط — لا أكثر
  const words = (s) => s.split(/\s+/);
  const wa = words(a.execution_details);
  const wb = words(b.execution_details);
  assert.equal(wa.length, wb.length, "النصّان يختلفان في عدد الكلمات — ليس فخّ «الكلمة الأخيرة»");
  assert.deepEqual(wa.slice(0, -1), wb.slice(0, -1), "الاختلاف ليس محصورًا في الكلمة الأخيرة");
  assert.notEqual(wa[wa.length - 1], wb[wb.length - 1], "الكلمة الأخيرة متطابقة — لا فخّ");

  const engine = PLAN.deliverables.filter((d) => d.source_row_number === n1 || d.source_row_number === n2);
  assert.equal(engine.length, 2, "المحرّك أسقط أحد السطرين كتكرار");
  assert.notEqual(engine[0].external_key, engine[1].external_key);
  assert.notEqual(engine[0].content_hash, engine[1].content_hash, "بصمة المحتوى متطابقة رغم اختلاف النصّ");
  assert.equal(PLAN.duplicateRows.filter((r) => r.rowNumber === n1 || r.rowNumber === n2).length, 0);
});

// ─── A5) الخلايا الفارغة null — لا "" ولا نصّ بديل ───────────────────────────
test("sanitized: empty_cells_are_null_with_the_exact_census — 1 منصات، 2 تفاصيل، 23 وصف", engineOpts, () => {
  const censusBytes = { D: 0, E: 0, F: 0 };
  const byRow = new Map(SHEET.rows.map((r) => [r.rowNumber, r]));
  for (const d of S.deliverables) {
    const r = byRow.get(d.source_row_number);
    if (blank(r, COL.D)) censusBytes.D++;
    if (blank(r, COL.E)) censusBytes.E++;
    if (blank(r, COL.F)) censusBytes.F++;
    assert.ok(!blank(r, COL.B), `السطر ${d.source_row_number}: عمود العنوان فارغ`);
    assert.ok(!blank(r, COL.C), `السطر ${d.source_row_number}: عمود نوع المحتوى فارغ`);
  }
  const want = { D: EXPECT.empty_cell_census.platforms, E: EXPECT.empty_cell_census.execution_details, F: EXPECT.empty_cell_census.proposed_caption };
  assert.deepEqual(censusBytes, want, "إحصاء الفراغات في البايتات مختلف");
  assert.deepEqual(want, { D: 1, E: 2, F: 23 }, "الإحصاء المعلن لم يعد يحاكي الشكل الحقيقي");

  const censusFixture = {
    D: S.deliverables.filter((d) => d.metadata.source_platforms === null).length,
    E: S.deliverables.filter((d) => d.execution_details === null).length,
    F: S.deliverables.filter((d) => d.proposed_caption === null).length,
  };
  assert.deepEqual(censusFixture, want, "إحصاء الفراغات في الملف مختلف");
  const censusPlan = {
    D: PLAN.deliverables.filter((d) => d.platforms.length === 0).length,
    E: PLAN.deliverables.filter((d) => d.execution_details === null).length,
    F: PLAN.deliverables.filter((d) => d.proposed_caption === null).length,
  };
  assert.deepEqual(censusPlan, want, "إحصاء الفراغات عند المحرّك مختلف");

  const PLACEHOLDERS = ["", " ", "-", "—", "لا يوجد", "غير محدد", "غير محدّد", "N/A", "n/a", "null", "NULL", "TBD", "?"];
  for (const d of S.deliverables) {
    for (const f of ["execution_details", "proposed_caption", "expected_units"]) {
      const v = d[f];
      if (v === null) continue;
      assert.notEqual(typeof v === "string" ? v.trim() : v, "", `السطر ${d.source_row_number}: ${f} نصّ فارغ بدل null`);
      if (typeof v === "string") assert.ok(!PLACEHOLDERS.includes(v.trim()), `السطر ${d.source_row_number}: ${f} قيمة بديلة «${v}»`);
    }
    assert.ok(d.metadata.source_platforms === null || d.metadata.source_platforms.trim() !== "",
      `السطر ${d.source_row_number}: source_platforms نصّ فارغ بدل null`);
  }
  const noPlatform = S.deliverables.filter((d) => d.metadata.source_platforms === null);
  assert.equal(noPlatform.length, 1);
  assert.deepEqual(noPlatform[0].platforms, [], "السطر بلا منصات حُشِي بقيمة مخترعة");
  for (const d of PLAN.deliverables) {
    for (const f of ["execution_details", "proposed_caption", "notes", "content_type_raw"]) {
      assert.notEqual(d[f], "", `${f} خُزّن كنصّ فارغ بدل null`);
    }
    assert.equal(d.platforms.some((p) => p === ""), false);
  }
  assert.equal(PLAN.deliverables.filter((d) => d.content_type_raw === null).length, 0, "سطر بلا نوع محتوى");
});

// ─── A6) تعيين نوع المحتوى ───────────────────────────────────────────────────
test("sanitized: content_type_maps_into_the_13_platform_keys — والأصل العربي محفوظ", engineOpts, () => {
  assert.equal(GENERIC_KEYS.length, 13, `عدد المفاتيح العامّة ${GENERIC_KEYS.length} وليس 13`);
  for (const k of ["video", "photography", "design", "print", "live_stream", "event", "field_execution",
    "presentation", "gift", "report", "digital_content", "copywriting", "custom"]) {
    assert.ok(GENERIC_KEYS.includes(k), `المفتاح العامّ «${k}» غير معرَّف في ملف التعيين`);
  }
  const byRow = new Map(SHEET.rows.map((r) => [r.rowNumber, r]));
  for (const d of S.deliverables) {
    assert.ok(GENERIC_KEYS.includes(d.content_type), `السطر ${d.source_row_number}: النوع «${d.content_type}» ليس من المفاتيح الـ13`);
    assert.equal(d.content_type, contentTypeKeyOf(d.metadata.source_content_type),
      `السطر ${d.source_row_number}: التعيين المعلن لا يطابق ما يشتقّه ملف التعيين`);
    assert.equal(typeof d.metadata.source_content_type, "string", `السطر ${d.source_row_number}: الأصل العربي مفقود`);
    assert.ok(ARABIC.test(d.metadata.source_content_type), `السطر ${d.source_row_number}: الأصل ليس عربيًّا`);
    assert.equal(d.metadata.source_content_type, cell(byRow.get(d.source_row_number), COL.C),
      `السطر ${d.source_row_number}: الأصل لا يطابق الخلية`);
  }
  const used = new Set(S.deliverables.map((d) => d.content_type));
  assert.ok(used.size >= 5, `عدد الأنواع المستعمَلة ${used.size} — التعيين شبه معطَّل`);
  const customCount = S.deliverables.filter((d) => d.content_type === "custom").length;
  assert.ok(customCount < S.deliverables.length / 2, `«custom» ابتلع ${customCount} من ${S.deliverables.length}`);
  // نفس النصّ ⇒ نفس المفتاح دائمًا
  const seen = new Map();
  for (const d of S.deliverables) {
    const k = textUtil.normalizeForMatch(d.metadata.source_content_type);
    if (seen.has(k)) assert.equal(d.content_type, seen.get(k), `«${d.metadata.source_content_type}» أُسند لمفتاحين مختلفين`);
    else seen.set(k, d.content_type);
  }
  // وكل سطر ينهار إلى نوع تقبله قاعدة البيانات
  for (const d of PLAN.deliverables) {
    assert.ok(DB_TYPES.has(d.type), `السطر ${d.source_row_number}: النوع «${d.type}» يخالف قيد CHECK`);
  }
  assert.ok(new Set(PLAN.deliverables.map((d) => d.type)).size >= 3, "أنواع قاعدة البيانات الثلاثة غير ممثَّلة");
});

// ─── A7) المنصّات ────────────────────────────────────────────────────────────
test("sanitized: platforms_split_correctly_and_keep_their_original", engineOpts, () => {
  const byRow = new Map(SHEET.rows.map((r) => [r.rowNumber, r]));
  let multi = 0;
  for (const d of S.deliverables) {
    assert.ok(Array.isArray(d.platforms), `السطر ${d.source_row_number}: platforms ليست مصفوفة`);
    for (const p of d.platforms) {
      assert.equal(typeof p, "string");
      assert.equal(p, p.trim(), `السطر ${d.source_row_number}: مسافات حول «${p}»`);
      assert.ok(p.length > 0, `السطر ${d.source_row_number}: منصّة فارغة`);
      assert.ok(!/[–—+]|(\s-\s)/.test(p), `السطر ${d.source_row_number}: فاصل باقٍ داخل «${p}»`);
    }
    assert.equal(new Set(d.platforms).size, d.platforms.length, `السطر ${d.source_row_number}: تكرار منصّات`);
    if (d.platforms.length > 1) multi++;
    assert.equal(d.metadata.source_platforms, cell(byRow.get(d.source_row_number), COL.D),
      `السطر ${d.source_row_number}: نصّ المنصات الأصلي لا يطابق البايتات`);
  }
  assert.ok(multi >= 20, `عدد الأسطر متعدّدة المنصّات ${multi} — أقلّ من المتوقّع`);

  // «جميع المنصات» قيمة واحدة مشروعة، لا تُفكَّك
  const all = S.deliverables.filter((d) => (d.metadata.source_platforms || "").trim() === "جميع المنصات");
  assert.ok(all.length > 0, "«جميع المنصات» غير ممثّلة — الحالة غير مغطّاة");
  for (const d of all) assert.deepEqual(d.platforms, ["جميع المنصات"], `السطر ${d.source_row_number}: «جميع المنصات» فُكِّكت`);

  // الفواصل الثلاثة كلّها ممثَّلة وكلّها تُقسَّم فعلًا
  const seps = { "–": 0, "+": 0, "-": 0 };
  for (const d of S.deliverables) {
    const s = d.metadata.source_platforms || "";
    for (const sep of Object.keys(seps)) if (s.includes(` ${sep} `)) seps[sep]++;
  }
  for (const [sep, n] of Object.entries(seps)) assert.ok(n > 0, `الفاصل «${sep}» غير ممثَّل: ${JSON.stringify(seps)}`);
  for (const d of S.deliverables) {
    const s = d.metadata.source_platforms || "";
    if (/ [–+-] /.test(s)) assert.ok(d.platforms.length >= 2, `السطر ${d.source_row_number}: «${s}» لم يُقسَّم`);
  }
  // والمحرّك يوافق على التقسيم نفسه
  PLAN.deliverables.forEach((d, i) => {
    assert.deepEqual(d.platforms, S.deliverables[i].platforms,
      `السطر ${S.deliverables[i].source_row_number}: تقسيم المحرّك يخالف الملف`);
  });
  // ضمانة عدم التفاهة: القاسم نفسه يعرف الشرطة «–»
  assert.deepEqual(textUtil.splitMulti("إنستقرام – إكس"), ["إنستقرام", "إكس"],
    "splitMulti لا يقسّم على الشرطة «–»");
});

// ─── A8) التكرار وصف لا تفريخ ────────────────────────────────────────────────
test("sanitized: recurrence_is_a_description_not_a_generator", engineOpts, () => {
  const ALLOWED = ["none", "daily", "weekly", "monthly", "custom"];
  const tally = { none: 0, daily: 0, weekly: 0, monthly: 0, custom: 0 };
  for (const d of S.deliverables) {
    assert.ok(ALLOWED.includes(d.recurrence_type), `السطر ${d.source_row_number}: نوع تكرار مجهول «${d.recurrence_type}»`);
    tally[d.recurrence_type] += 1;
  }
  assert.equal(tally.daily, EXPECT.recurrence.daily, "عدد اليوميّ تغيّر");
  assert.equal(tally.weekly, EXPECT.recurrence.weekly, "عدد الأسبوعيّ تغيّر");
  assert.equal(tally.none, EXPECT.recurrence.none, "عدد غير المتكرّر تغيّر");
  assert.equal(tally.daily + tally.weekly + tally.none, EXPECT.deliverable_count);
  assert.ok(tally.daily > 0 && tally.weekly > 0, "خليط التكرار غير ممثَّل");

  // لا نسخ وُلِّدت: العدد ثابت، والعدد المتوقّع يبقى null ما دام لا جدول معتمَد
  assert.equal(S.deliverables.length, EXPECT.deliverable_count, "عدد المخرجات تغيّر — وُلِّدت نسخ");
  assert.equal(PLAN.deliverables.length, EXPECT.deliverable_count, "المحرّك ولّد نسخًا");
  for (const d of S.deliverables) {
    assert.equal(d.expected_units, null, `السطر ${d.source_row_number}: expected_units مخترَع (${d.expected_units})`);
    assert.equal(d.completed_units, 0, `السطر ${d.source_row_number}: completed_units ليس 0`);
  }
  // والنصّ الذي يبرّر التكرار موجود فعلًا في السطر — لا وسم بلا سند
  for (const d of S.deliverables.filter((x) => x.recurrence_type === "daily")) {
    assert.match(d.execution_details || "", /يومي/, `السطر ${d.source_row_number}: وُسم يوميًّا بلا سند نصّي`);
  }
  for (const d of S.deliverables.filter((x) => x.recurrence_type === "weekly")) {
    assert.match(d.execution_details || "", /أسبوع/, `السطر ${d.source_row_number}: وُسم أسبوعيًّا بلا سند نصّي`);
  }
});

// ─── A9) عناوين الكتل حرفية، والتواريخ داخلها نصّ لا حقل ─────────────────────
test("sanitized: block_titles_are_verbatim_including_their_dates", engineOpts, () => {
  const byRow = new Map(SHEET.rows.map((r) => [r.rowNumber, r]));
  assert.equal(S.blocks.length, 11);
  S.blocks.forEach((b, i) => {
    assert.equal(b.index, i + 1, "ترقيم الكتل غير متّصل");
    assert.equal(b.stage_order, i + 1, "stage_order لا يطابق الترتيب");
    assert.equal(b.title, cell(byRow.get(b.source_row_number), COL.B), `الكتلة ${b.index}: العنوان أُعيدت صياغته أو اقتُطع`);
    assert.equal(b.title, SHEET_VIEW.banners[i].title, "ترتيب الكتل لا يطابق ترتيب اللافتات");
    assert.equal(b.title, b.title.trim(), `الكتلة ${b.index}: مسافات طرفية`);
  });
  // كتلة مدموجة «الثالثة والرابعة»، وأربعة أقسام مرقّمة تحت اسم مرحلة واحد
  assert.equal(S.blocks.filter((b) => b.title.includes("الثالثة والرابعة")).length, 1, "الكتلة المدموجة اختفت");
  const sections = S.blocks.filter((b) => /المرحلة الثامنة/.test(b.title));
  assert.equal(sections.length, 4, "الأقسام الأربعة تحت مرحلة واحدة دُمجت أو ضاع أحدها");
  assert.equal(new Set(sections.map((b) => b.title)).size, 4, "الأقسام الأربعة ليست متمايزة");

  // التاريخ داخل العنوان نصّ فقط — ولا حقل تاريخ اشتُقّ منه
  const dated = S.blocks.filter((b) => /\d{2}/.test(b.title) && /20\d\d/.test(b.title));
  assert.ok(dated.length >= 9, `عدد الكتل التي تحمل تاريخًا ${dated.length} — أقلّ من المتوقّع`);
  assert.ok(dated.length < S.blocks.length, "كل الكتل مؤرّخة — حالة «بلا تاريخ» غير مغطّاة");
  for (const b of dated) {
    assert.equal(b.planned_start_date, null, `الكتلة ${b.index}: اشتُقّ تاريخ بدء من نصّ العنوان`);
    assert.equal(b.due_date, null, `الكتلة ${b.index}: اشتُقّ تاريخ تسليم من نصّ العنوان`);
    for (const d of S.deliverables.filter((x) => x.block_index === b.index)) {
      assert.equal(d.planned_start_date, null, `السطر ${d.source_row_number}: ورث تاريخًا من عنوان كتلته`);
      assert.equal(d.due_date, null, `السطر ${d.source_row_number}: ورث تاريخًا من عنوان كتلته`);
    }
  }
  assert.deepEqual(PLAN.nodes.map((n) => n.title), S.blocks.map((b) => b.title), "المحرّك غيّر عنوان كتلة");
  assert.ok(PLAN.deliverables.every((d) => d.level_path[0] !== null), "سطر انتهى بلا كتلة");
});

// ─── A10) الثبات وإعادة الاستيراد ────────────────────────────────────────────
test("sanitized: key_derivation_is_deterministic — تشغيلان متتاليان ⇒ المفاتيح نفسها", engineOpts, () => {
  const again = planFromFixture();
  assert.deepEqual(again.deliverables.map((d) => d.external_key), PLAN.deliverables.map((d) => d.external_key));
  assert.deepEqual(again.nodes.map((n) => n.key), PLAN.nodes.map((n) => n.key));
  assert.deepEqual(again.deliverables.map((d) => d.content_hash), PLAN.deliverables.map((d) => d.content_hash));
  assert.equal(JSON.stringify({ ...again, generatedAt: null }), JSON.stringify({ ...PLAN, generatedAt: null }),
    "خطّتان من البايتات نفسها ليستا متطابقتين");
  for (const d of PLAN.deliverables) {
    assert.doesNotMatch(d.external_key, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i, `مفتاح يشبه UUID: ${d.external_key}`);
    assert.doesNotMatch(d.external_key, /1[6-9]\d{11}/, `مفتاح يحوي ختم وقت: ${d.external_key}`);
    assert.equal(d.external_key.split(":").length, 4, `المفتاح ليس رباعيّ المقاطع: ${d.external_key}`);
  }
  // ونفس مدخلات الهوية عبر واجهة keys.ts مباشرةً تعطي النتيجة نفسها
  const sample = PLAN.deliverables[0];
  const mk = () => keys.externalKey({
    profileId: PROFILE.id,
    projectKey: S.project.project_key,
    levelKeys: sample.level_keys,
    row: { strategy: PROFILE.keyStrategy, explicit: null, levelKeys: sample.level_keys, title: sample.title, occurrence: 1, rowNumber: sample.source_row_number },
  }).key;
  assert.equal(mk(), mk());
  assert.equal(mk(), sample.external_key, "keys.externalKey لا يعيد إنتاج مفتاح المحرّك");
});

test("sanitized: re_import_is_idempotent — إعادة تمرير الملف نفسه لا تُنشئ شيئًا", engineOpts, () => {
  const existing = {};
  for (const d of PLAN.deliverables) existing[d.external_key] = { id: `row-${d.source_row_number}`, content_hash: d.content_hash };
  for (const n of PLAN.nodes) existing[n.key] = { id: `node-${n.sequence}`, content_hash: null };
  existing[PLAN.parentProject.key] = { id: "project", content_hash: null };

  const second = planFromFixture({ existing, existingLookupAvailable: true, projectId: "project" });
  assert.equal(second.counts.deliverablesToCreate, 0, "إعادة الاستيراد ستنشئ صفوفًا جديدة — الهوية غير مستقرّة");
  assert.equal(second.counts.deliverablesToUpdate, 0, "إعادة الاستيراد ستحدّث صفوفًا رغم عدم تغيّر شيء");
  assert.equal(second.counts.deliverablesUnchanged, EXPECT.deliverable_count, "لم تُطابَق الـ79 كلّها");
  assert.equal(second.counts.stagesToCreate, 0, "ستُنشأ كتل جديدة رغم وجودها");
  assert.equal(second.counts.parentProjectsToCreate, 0, "سيُنشأ مشروع أب ثانٍ");
  for (const d of second.deliverables) assert.equal(d.action, "unchanged", `السطر ${d.source_row_number}: ${d.action}`);

  // ضمانة عدم التفاهة: تغيير بصمة صفّ واحد يقلبه إلى update وحده
  const tampered = { ...existing };
  const victim = PLAN.deliverables[5];
  tampered[victim.external_key] = { id: "row-x", content_hash: "0000000000000000" };
  const third = planFromFixture({ existing: tampered, existingLookupAvailable: true, projectId: "project" });
  assert.equal(third.counts.deliverablesToUpdate, 1, "تغيّر المحتوى لم يُرصد — كشف التغيير معطَّل");
  assert.equal(third.counts.deliverablesToCreate, 0);
  assert.equal(third.counts.deliverablesUnchanged, EXPECT.deliverable_count - 1);
  assert.equal(third.deliverables.find((d) => d.action === "update").external_key, victim.external_key);
});

// ════════════════════════════════════════════════════════════════════════════
// PART B — the platform-shape fixture (tests/fixtures/misbar10_structure.json).
// ════════════════════════════════════════════════════════════════════════════

// The eleven synthetic stage names, exactly as the fixture carries them.
const STAGE_TITLES = [
  "01 التخطيط التحريري",
  "02 ما قبل الإطلاق وأثناء الإطلاق",
  "03 اعتماد الهوية",
  "04 البث الافتتاحي عن بُعد",
  "05 ختام الجولة الأولى وإعلان القائمة القصيرة",
  "06 الاستطلاع الرقمي",
  "07 الجلسة الإعلامية",
  "08 تجهيز الموقع",
  "09 أيام الفعالية",
  "10 مكتبة الفيديو",
  "11 الجلسة الختامية",
];

// ─── B0) The fixture must be unmistakably synthetic ──────────────────────────
test("الملف موسوم كبيانات اصطناعية بلا لبس", () => {
  assert.equal(F.synthetic, true, "العلم synthetic غير مضبوط في الجذر");
  assert.match(F._WARNING_EN, /SYNTHETIC/i, "لا تحذير إنجليزي في الترويسة");
  assert.match(F._WARNING_EN, /NOT OWNER DATA/i, "التحذير لا ينفي ملكية البيانات");
  assert.match(F._WARNING_EN, /NOT CLIENT DATA/i, "التحذير لا ينفي أنّها بيانات عميل");
  assert.match(F._WARNING_AR, /اصطناعي/, "لا تحذير عربي في الترويسة");
  for (const d of F.deliverables) assert.equal(d.synthetic, true, `المخرَج ${d.external_key} غير موسوم`);
  for (const s of F.stages) assert.equal(s.synthetic, true, `المرحلة ${s.stage_key} غير موسومة`);
  assert.equal(F.parent_project.synthetic, true, "المشروع الأب غير موسوم");
});

test("توقّع المالك (11/79) يشير إلى مجموعة قبول محلّية تتخطّى بوضوح عند غياب ملفّ العميل", () => {
  assert.equal(F.owner_expectation.stages, 11);
  assert.equal(F.owner_expectation.deliverables, 79);
  assert.equal(F.owner_expectation.verified_against_real_file, true,
    "التحقّق تمّ فعلًا مقابل ملف المالك — إبقاء العلم على false ادّعاء غير صحيح");
  assert.match(F.owner_expectation.source, /MISBAR10_PLAN\.xlsx/, "مصدر التحقّق لا يشير إلى ملف المالك");
  assert.match(F.owner_expectation.source, /docs\/input\/private\//, "المصدر لا يشير إلى الموقع الخاصّ المحلّي");
  assert.match(F.owner_expectation.source, /LOCAL ONLY|never committed/i, "المصدر لا يوضّح أنّ الملف لا يدخل المستودع");
  assert.match(F.owner_expectation.verified_payload, /^docs\/private-imports\//, "الحمولة لا تشير إلى المجلّد الخاصّ");

  // الادّعاء مسنود بمجموعة موجودة فعلًا، تقرأ الملف عبر مُحلّل المسارات الخاصّة،
  // وتؤكّد الرقمين باسمهما، وتتخطّى (لا تفشل) عند غيابه.
  const suite = path.join(ROOT, F.owner_expectation.verified_by);
  assert.ok(fs.existsSync(suite), `مجموعة التحقّق «${F.owner_expectation.verified_by}» غير موجودة`);
  const suiteSrc = fs.readFileSync(suite, "utf8");
  assert.match(suiteSrc, /misbar10_private_paths/, "مجموعة التحقّق لا تمرّ عبر مُحلّل المسارات الخاصّة");
  assert.match(suiteSrc, /deliverable_count: 79|deliverable_count = 79/, "مجموعة التحقّق لا تؤكّد العدد 79 باسمه");
  assert.match(suiteSrc, /operational_block_count: 11|operational_block_count = 11/, "مجموعة التحقّق لا تؤكّد العدد 11 باسمه");
  assert.match(suiteSrc, /opts/, "مجموعة التحقّق لا تُمرّر خيار التخطّي إلى الاختبارات");
  // وملف الملحق نفسه يشرح للقارئ أنّ التخطّي متوقَّع في CI
  assert.match(F.owner_expectation.ci_note_en, /SKIP/i, "الملف لا يوضّح أنّ التحقّق يتخطّى في CI");
  assert.match(F.owner_expectation.ci_note_en, /misbar10_sanitized\.json/, "الملف لا يشير إلى التغطية البديلة");
  // والمسارات المعلنة هي فعلًا التي يبحث فيها المُحلّل
  assert.ok(CANDIDATES.workbook.some((p) => F.owner_expectation.source.includes(p)), "المسار المعلن ليس أحد المسارات المدعومة");
  assert.ok(CANDIDATES.payload.includes(F.owner_expectation.verified_payload), "مسار الحمولة المعلن غير مدعوم");
  // العدد الاصطناعي يبقى مختلفًا عمدًا عن 79
  assert.notEqual(F.deliverables.length, F.owner_expectation.deliverables,
    "عدد الملف الاصطناعي يساوي 79 — يصبح مُضلِّلًا ويُخلط ببيانات المالك");
});

test("الملفات الحقيقية اختيارية: غيابها لا يُسقط أي اختبار في هذه المجموعة", () => {
  // This suite must never read client data. Prove it: nothing here resolves.
  for (const name of Object.keys(CANDIDATES)) {
    const found = resolveInput(name);
    assert.ok(found === null || typeof found === "string", `مُحلّل «${name}» أعاد قيمة غريبة`);
  }
  const src = fs.readFileSync(__filename, "utf8");
  assert.doesNotMatch(src, /readFileSync\([^)]*docs\/input/, "المجموعة تقرأ مجلّد مدخلات العميل");
  assert.doesNotMatch(src, /readFileSync\([^)]*private-imports/, "المجموعة تقرأ مجلّد الاستخراجات الخاصّة");
  assert.doesNotMatch(src, /misbar10_real\.json/, "المجموعة تقرأ ملحق البيانات الحقيقية");
});

// ─── B1) Stages ──────────────────────────────────────────────────────────────
test("إحدى عشرة مرحلة بالضبط، بأسماء اصطناعية ثابتة", () => {
  assert.equal(F.stages.length, 11, "عدد المراحل ليس 11");
  assert.deepEqual(F.stages.map((s) => s.title_ar), STAGE_TITLES, "أسماء المراحل تغيّرت أو تشوّهت");
});

test("ترتيب المراحل متّصل وفريد (1..11) ومطابق لـsequence_number", () => {
  const seq = F.stages.map((s) => s.sequence_number);
  assert.deepEqual(seq, [...Array(11)].map((_, i) => i + 1), "التسلسل غير متّصل");
  assert.equal(new Set(seq).size, 11, "تكرار في sequence_number");
  for (const s of F.stages) {
    assert.equal(s.stage_no, s.sequence_number, `${s.stage_key}: stage_no ≠ sequence_number`);
    assert.equal(s.stage_key, `stage_${String(s.stage_no).padStart(2, "0")}`, "مفتاح المرحلة لا يطابق رقمها");
  }
});

test("كل مرحلة تُجسَّد كمشروع فرعي مرتّب — لا مفردات قاعدة بيانات مخترَعة", () => {
  for (const s of F.stages) {
    assert.equal(s.platform_mapping.entity, "projects");
    assert.equal(s.platform_mapping.project_scope, "subproject");
    assert.equal(s.platform_mapping.ordering_column, "sequence_number");
  }
});

// ─── B2) Deliverables ↔ stages ───────────────────────────────────────────────
test("عدد المخرجات = العدد الفعليّ للملف (اتّساق ذاتي، لا رقم مُثبَّت)", () => {
  const actual = F.deliverables.length;
  assert.ok(actual > 0, "الملف بلا مخرجات");
  assert.equal(F.parent_project.expected_rollup.deliverables_total, actual, "التجميع المعلن لا يطابق العدد الفعليّ");
  const perStage = F.stages.reduce((a, s) => a + s.expected.deliverables_count, 0);
  assert.equal(perStage, actual, "مجموع عدّادات المراحل لا يساوي عدد المخرجات");
});

test("كل مخرَج مرتبط بمرحلة موجودة — لا يتامى", () => {
  const stageKeys = new Set(F.stages.map((s) => s.stage_key));
  for (const d of F.deliverables) {
    assert.ok(d.stage_key, `${d.external_key}: بلا stage_key`);
    assert.ok(stageKeys.has(d.stage_key), `${d.external_key}: مرحلة غير موجودة ${d.stage_key}`);
  }
  for (const s of F.stages) {
    const n = F.deliverables.filter((d) => d.stage_key === s.stage_key).length;
    assert.equal(n, s.expected.deliverables_count, `${s.stage_key}: العدد المعلن ≠ المحسوب`);
  }
});

test("مفاتيح المخرجات فريدة وتحمل رقم مرحلتها", () => {
  const seen = new Set();
  for (const d of F.deliverables) {
    assert.ok(!seen.has(d.external_key), `مفتاح مكرّر: ${d.external_key}`);
    seen.add(d.external_key);
    assert.match(d.external_key, new RegExp(`^M10-${d.stage_key.slice(-2)}-\\d{2}$`), `مفتاح لا يطابق مرحلته: ${d.external_key}`);
  }
});

// ─── B3) Arabic preservation ─────────────────────────────────────────────────
test("العربية محفوظة: أحرف عربية فعلية، NFC، بلا تشويه ترميز", () => {
  const texts = [
    ...F.stages.map((s) => s.title_ar), ...F.stages.map((s) => s.name_ar),
    ...F.deliverables.map((d) => d.title_ar), F.parent_project.name_ar,
  ];
  for (const s of texts) {
    assert.equal(typeof s, "string");
    assert.ok(s.trim().length > 0, "نصّ فارغ");
    assert.ok(ARABIC.test(s), `لا أحرف عربية في: ${s}`);
    assert.equal(s, s.normalize("NFC"), `نصّ غير مطبَّع NFC: ${s}`);
    assert.ok(!s.includes("�"), `محرف بديل (ترميز تالف): ${s}`);
    assert.doesNotMatch(s, /[ÃØÙÚâ€]{2,}/, `تشويه ترميز محتمل: ${s}`);
    assert.doesNotMatch(s, /\?\?\?/, `علامات استفهام بديلة: ${s}`);
  }
  const raw = fs.readFileSync(STRUCTURE_PATH, "utf8");
  assert.ok(raw.includes("التخطيط التحريري"), "العربية مهرَّبة إلى \\u في الملف بدل حفظها كما هي");
});

// ─── B4) Platforms ───────────────────────────────────────────────────────────
test("المنصّات محفوظة كمصفوفات نظيفة، ومتعدّدة المنصّات ممثَّل", () => {
  let multi = 0;
  for (const d of F.deliverables) {
    assert.ok(Array.isArray(d.platforms), `${d.external_key}: platforms ليست مصفوفة`);
    for (const p of d.platforms) {
      assert.equal(typeof p, "string");
      assert.ok(p.trim().length > 0, `${d.external_key}: منصّة فارغة`);
      assert.equal(p, p.trim(), `${d.external_key}: مسافات زائدة في «${p}»`);
    }
    assert.equal(new Set(d.platforms).size, d.platforms.length, `${d.external_key}: تكرار منصّات`);
    if (d.platforms.length > 1) multi += 1;
  }
  assert.ok(multi > 0, "لا مخرَج متعدّد المنصّات — الشكل غير مغطّى");
  assert.equal(F.parent_project.expected_rollup.multi_platform, multi, "عدّاد multi_platform المعلن خاطئ");
});

// ─── B5) Dates: nothing fabricated ───────────────────────────────────────────
test("لا تواريخ مُختلَقة: due_date إمّا null أو تاريخ ISO صالح", () => {
  let nulls = 0;
  for (const d of F.deliverables) {
    if (d.due_date === null) { nulls += 1; continue; }
    assert.match(d.due_date, ISO_DATE, `${d.external_key}: صيغة تاريخ غير ISO «${d.due_date}»`);
    const dt = new Date(`${d.due_date}T00:00:00Z`);
    assert.ok(!Number.isNaN(dt.getTime()), `${d.external_key}: تاريخ غير صالح`);
    assert.equal(dt.toISOString().slice(0, 10), d.due_date, `${d.external_key}: تاريخ غير موجود في التقويم`);
  }
  assert.ok(nulls > 0, "كل المخرجات مؤرّخة — شكل «بلا تاريخ» غير مغطّى");
  assert.equal(F.parent_project.expected_rollup.awaiting_schedule, nulls, "عدّاد awaiting_schedule المعلن خاطئ");
  assert.equal(F.parent_project.expected_rollup.scheduled, F.deliverables.length - nulls);
  assert.equal(F.parent_project.due_date, null, "المشروع الأب يحمل تاريخًا مُختلَقًا");
});

test("awaiting_schedule ⇔ due_date = null (في الاتّجاهين)", () => {
  for (const d of F.deliverables) {
    if (d.schedule_status === "awaiting_schedule") {
      assert.equal(d.due_date, null, `${d.external_key}: بانتظار الجدولة ومعه تاريخ`);
    } else {
      assert.equal(d.schedule_status, "scheduled", `${d.external_key}: حالة جدولة غير معروفة`);
      assert.notEqual(d.due_date, null, `${d.external_key}: مجدول بلا تاريخ`);
    }
  }
});

// Mirrors the platform's only overdue rule for deliverables
// (docs/project_core_ABSOLUTE_FINAL_RUNME.sql:2136-2138):
//   due_date IS NOT NULL AND due_date <= today AND status NOT IN (final/archived/approved)
function isOverdue(d, today) {
  if (d.due_date === null) return false;
  if (["final_delivered", "archived", "approved"].includes(d.initial_db_status)) return false;
  return d.due_date <= today;
}

test("مخرَج بلا تاريخ لا يصير متأخّرًا أبدًا — ولو بعد قرن", () => {
  const FAR_FUTURE = "2099-12-31";
  const awaiting = F.deliverables.filter((d) => d.schedule_status === "awaiting_schedule");
  assert.ok(awaiting.length > 0, "لا عيّنة بانتظار الجدولة");
  for (const d of awaiting) {
    assert.equal(isOverdue(d, FAR_FUTURE), false, `${d.external_key}: بلا تاريخ ومع ذلك حُسب متأخّرًا`);
  }
  const dated = F.deliverables.filter((d) => d.schedule_status === "scheduled");
  assert.ok(dated.some((d) => isOverdue(d, FAR_FUTURE) === true),
    "دالّة التأخّر لا ترصد أيّ تأخّر — الاختبار أعلاه سيمرّ فارغًا");
  const earliest = dated.map((d) => d.due_date).sort()[0];
  const dayBefore = new Date(new Date(`${earliest}T00:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10);
  for (const d of F.deliverables) assert.equal(isOverdue(d, dayBefore), false, `${d.external_key}: تأخّر قبل أوّل موعد`);
});

// ─── B6) Recurrence + quantity ───────────────────────────────────────────────
test("تقدّم التكرار: 0 ≤ منجَز ≤ متوقَّع، والنسبة مشتقّة لا مُدخَلة", () => {
  for (const d of F.deliverables) {
    assert.ok(Number.isInteger(d.expected_units) && d.expected_units >= 1, `${d.external_key}: expected_units غير صالح`);
    assert.ok(Number.isInteger(d.completed_units) && d.completed_units >= 0, `${d.external_key}: completed_units غير صالح`);
    assert.ok(d.completed_units <= d.expected_units, `${d.external_key}: المنجَز يتجاوز المتوقَّع`);
    assert.equal(d.progress_pct, Math.round((d.completed_units / d.expected_units) * 100), `${d.external_key}: نسبة تقدّم غير متّسقة`);
    assert.ok(d.progress_pct >= 0 && d.progress_pct <= 100);
  }
});

test("التكرار ممثَّل بأطرافه: 0% وجزئي و100%", () => {
  const rec = F.deliverables.filter((d) => d.recurrence !== null);
  assert.ok(rec.length > 0, "لا مخرَج متكرّر — الشكل غير مغطّى");
  for (const d of rec) {
    assert.ok(["daily", "weekly", "monthly"].includes(d.recurrence.type), `${d.external_key}: نوع تكرار غير معروف`);
    assert.ok(d.expected_units > 1, `${d.external_key}: متكرّر بوحدة واحدة`);
  }
  assert.ok(rec.some((d) => d.progress_pct === 0), "لا تكرار عند 0%");
  assert.ok(rec.some((d) => d.progress_pct === 100), "لا تكرار مكتمل 100%");
  assert.ok(rec.some((d) => d.progress_pct > 0 && d.progress_pct < 100), "لا تكرار جزئي");
  const roll = F.parent_project.expected_rollup;
  assert.equal(roll.recurring, rec.length);
  assert.equal(roll.recurrence_expected_units, rec.reduce((a, d) => a + d.expected_units, 0));
  assert.equal(roll.recurrence_completed_units, rec.reduce((a, d) => a + d.completed_units, 0));
});

test("الكمّية ليست تكرارًا: توجد وحدات متعدّدة بلا recurrence", () => {
  const qty = F.deliverables.filter((d) => d.recurrence === null && d.expected_units > 1);
  assert.ok(qty.length > 0, "لا عيّنة كمّية (طباعة/هدايا) — الشكل المُلبِس غير مغطّى");
});

// ─── B7) Types & client visibility ───────────────────────────────────────────
test("كل نوع اصطناعي ينهار إلى نوع تقبله قاعدة البيانات (video/photo/other)", () => {
  const map = F.platform_contract.kind_to_db_type;
  for (const d of F.deliverables) {
    assert.ok(map[d.kind], `${d.external_key}: النوع «${d.kind}» بلا خريطة إلى عمود type`);
    assert.equal(d.db_type, map[d.kind], `${d.external_key}: db_type لا يطابق الخريطة`);
    assert.ok(DB_TYPES.has(d.db_type), `${d.external_key}: db_type «${d.db_type}» يخالف قيد CHECK`);
  }
  const kinds = new Set(F.deliverables.map((d) => d.kind));
  for (const k of ["video", "photo", "design", "print", "live_stream", "event", "field_execution", "gift", "report"]) {
    assert.ok(kinds.has(k), `الشكل «${k}» غير ممثَّل في الملف`);
  }
});

test("الرؤية للعميل متّسقة مع حالة قاعدة البيانات التي تكشفها RLS", () => {
  let vis = 0, hidden = 0;
  for (const d of F.deliverables) {
    assert.equal(typeof d.client_visible, "boolean");
    if (d.client_visible) {
      vis += 1;
      assert.ok(CLIENT_VISIBLE_STATUSES.has(d.initial_db_status),
        `${d.external_key}: معلَن كمرئي للعميل لكن حالته «${d.initial_db_status}» لا تكشفها RLS`);
    } else {
      hidden += 1;
      assert.ok(!CLIENT_VISIBLE_STATUSES.has(d.initial_db_status),
        `${d.external_key}: معلَن كمخفيّ لكن حالته «${d.initial_db_status}» مرئية للعميل`);
    }
  }
  assert.ok(vis > 0 && hidden > 0, "أحد شكلي الرؤية غير مغطّى");
  assert.equal(F.parent_project.expected_rollup.client_visible, vis);
  assert.equal(F.parent_project.expected_rollup.client_hidden, hidden);
});

test("الحقول الاصطناعية معلَنة صراحةً كحقول غير موجودة في قاعدة البيانات", () => {
  const declared = new Set(F.platform_contract.fields_not_in_db);
  for (const real of ["title", "type", "status", "due_date", "assignee_id"]) {
    assert.ok(!declared.has(real), `«${real}» عمود حقيقي لكنه معلَن كغير موجود`);
  }
  for (const f of ["platforms", "recurrence", "client_visible", "expected_units", "kind"]) {
    assert.ok(declared.has(f), `«${f}» غير معلَن كحقل استيراد خارج قاعدة البيانات`);
  }
});

// ─── B8) Parent roll-up + empty stage ────────────────────────────────────────
test("تجميع الأب محسوب من الأبناء ويطابق المعلن", () => {
  const roll = F.parent_project.expected_rollup;
  const withD = F.stages.filter((s) => s.expected.deliverables_count > 0);
  assert.equal(roll.stages_total, F.stages.length);
  assert.equal(roll.stages_with_deliverables, withD.length);
  assert.equal(roll.empty_stages, F.stages.length - withD.length);
  assert.equal(roll.client_visible + roll.client_hidden, roll.deliverables_total, "مجموع الرؤية لا يساوي الإجمالي");
  assert.equal(roll.awaiting_schedule + roll.scheduled, roll.deliverables_total, "مجموع الجدولة لا يساوي الإجمالي");
  const byKind = {}; const byType = {};
  for (const d of F.deliverables) { byKind[d.kind] = (byKind[d.kind] || 0) + 1; byType[d.db_type] = (byType[d.db_type] || 0) + 1; }
  assert.deepEqual(roll.by_kind, byKind);
  assert.deepEqual(roll.by_db_type, byType);
  assert.equal(
    roll.progress_pct_deliverable_mean,
    Math.round(F.deliverables.reduce((a, d) => a + d.progress_pct, 0) / F.deliverables.length),
    "متوسّط التقدّم على مستوى المخرجات غير مطابق");
});

test("المرحلة الفارغة: تقدّمها «غير متاح» (null) ومستبعَدة من المقام — لا صفر ولا NaN", () => {
  const empty = F.stages.filter((s) => s.expected.deliverables_count === 0);
  assert.equal(empty.length, 1, "المتوقَّع مرحلة فارغة واحدة بالضبط");
  const e = empty[0];
  assert.equal(e.intentionally_empty, true, "المرحلة الفارغة غير موسومة كمقصودة");
  assert.equal(e.expected.progress_pct, null, "تقدّم مرحلة فارغة عُرض 0% بدل «غير متاح»");
  assert.equal(F.deliverables.filter((d) => d.stage_key === e.stage_key).length, 0, "المرحلة «الفارغة» تحوي مخرجات");
  const withD = F.stages.filter((s) => s.expected.deliverables_count > 0);
  for (const s of withD) {
    assert.equal(typeof s.expected.progress_pct, "number", `${s.stage_key}: تقدّم غير رقمي`);
    assert.ok(!Number.isNaN(s.expected.progress_pct));
    const mine = F.deliverables.filter((d) => d.stage_key === s.stage_key);
    assert.equal(s.expected.progress_pct, Math.round(mine.reduce((a, d) => a + d.progress_pct, 0) / mine.length),
      `${s.stage_key}: تقدّم المرحلة غير مطابق لمخرجاتها`);
    assert.equal(s.expected.client_visible + s.expected.client_hidden, s.expected.deliverables_count);
  }
  assert.equal(
    F.parent_project.expected_rollup.progress_pct_stage_mean,
    Math.round(withD.reduce((a, s) => a + s.expected.progress_pct, 0) / withD.length),
    "متوسّط المراحل لم يستبعد المرحلة الفارغة");
});

test("المشروع الأب رئيسيّ ومربوط بعميل، ومستوى واحد فقط تحته", () => {
  assert.equal(F.parent_project.project_scope, "master");
  assert.ok(F.parent_project.client_external_key, "الأب بلا عميل");
  for (const s of F.stages) assert.ok(!("parent_stage_key" in s), `${s.stage_key}: يلمّح لمستوى ثالث`);
});

// ════════════════════════════════════════════════════════════════════════════
// PART C — architecture guards (no client data needed, so they run in CI).
// ════════════════════════════════════════════════════════════════════════════
function walkCode(dir, hits) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "node_modules" && e.name !== ".next") walkCode(p, hits);
      continue;
    }
    if (!/\.(ts|tsx|js|jsx)$/.test(e.name)) continue;
    if (/misbar/i.test(fs.readFileSync(p, "utf8"))) hits.push(path.relative(ROOT, p));
  }
}

test("لا ذكر لهذا المشروع بالاسم داخل كود المنصّة", () => {
  const hits = [];
  for (const r of ["lib", "components", "app"]) {
    const d = path.join(ROOT, r);
    if (fs.existsSync(d)) walkCode(d, hits);
  }
  assert.deepEqual(hits, [], `اسم المشروع تسرّب إلى كود المنصّة: ${hits.join(", ")}`);
});

test("platform_core_stays_generic — لا اسم مشروع في SQL التشغيلي ولا مراحل في ملف التعيين", () => {
  const sqlHits = fs.readdirSync(path.join(ROOT, "docs"))
    .filter((f) => /RUNME.*\.sql$/i.test(f))
    .filter((f) => /misbar/i.test(fs.readFileSync(path.join(ROOT, "docs", f), "utf8")));
  assert.deepEqual(sqlHits, [], `اسم المشروع تسرّب إلى ملفات SQL التشغيلية: ${sqlHits.join(", ")}`);

  // ملف التعيين بيانات: يصف أعمدة، ولا يذكر مرحلة ولا عددًا ولا اسم عميل
  const profileText = fs.readFileSync(PROFILE_PATH, "utf8");
  assert.doesNotMatch(profileText, /\b79\b/, "ملف التعيين يثبّت عدد المخرجات");
  assert.doesNotMatch(profileText, /المرحلة الأولى|المرحلة الثامنة/, "ملف التعيين يسمّي مراحل مشروع بعينه");
});

test("لا عدد مخرجات مُثبَّت (79) في ملف الأشكال خارج خانة توقّع المالك", () => {
  const clone = JSON.parse(fs.readFileSync(STRUCTURE_PATH, "utf8"));
  delete clone.owner_expectation;
  const rest = JSON.stringify(clone);
  assert.doesNotMatch(rest, /"deliverables_total"\s*:\s*79/, "79 مُثبَّت كعدد فعليّ");
  assert.equal(F.deliverables.length, F.parent_project.expected_rollup.deliverables_total);
});

// The gap audit is a tracked document. If it is ever moved out of the tree the
// suite says so and skips — it must not turn a documentation move into a red CI.
const auditOpts = fs.existsSync(AUDIT_PATH)
  ? {}
  : { skip: `SKIPPED — docs/MISBAR10_PLATFORM_GAP_AUDIT.md is not in the tree; nothing to audit. | التقرير غير موجود` };

test("تقرير الفجوات موجود ويحمل حكمًا صريحًا لكل مسار من المسارات الـ23", auditOpts, () => {
  const md = fs.readFileSync(AUDIT_PATH, "utf8");
  const verdicts = md.match(/\|\s*(READY|BLOCKER|PARTIAL)\s*\|/g) || [];
  assert.ok(verdicts.length >= 23, `عدد الأحكام ${verdicts.length} < 23 — التدقيق ناقص`);
  assert.match(md, /SYNTHETIC|اصطناعي/i, "التقرير لا يوضّح أنّ مجموعة القبول اصطناعية");
});
