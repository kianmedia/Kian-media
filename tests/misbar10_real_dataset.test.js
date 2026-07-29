// ════════════════════════════════════════════════════════════════════════════
// tests/misbar10_real_dataset.test.js — مجموعة القبول على البيانات الحقيقية.
//
// This suite runs against the OWNER'S REAL WORKBOOK
// (docs/input/MISBAR10_PLAN.xlsx) and the extraction produced from it
// (docs/misbar10_import_payload.json). Nothing here is synthetic; the synthetic
// counterpart lives in tests/misbar10_acceptance.test.js.
//
// THREE INDEPENDENT WITNESSES, and every claim must satisfy all three:
//   1. the FILE      — read through the repo's OWN reader (lib/portal/import),
//                      never through a test-local xlsx parser;
//   2. the PAYLOAD   — docs/misbar10_import_payload.json (the extraction);
//   3. the ENGINE    — lib/portal/import buildPlan() executed over witness 1.
// If the repo reader or the engine disagrees with the payload, a test FAILS.
// The point of the suite is that a wrong extraction cannot pass it.
//
// WHY THE FIXTURE IS NOT THE ONLY SOURCE: a test that reads only the payload
// proves the payload is self-consistent, which a fabricated payload also is.
// Every count, every cell and every key below is re-derived from the .xlsx
// bytes on disk.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { ROOT, TS_AVAILABLE, loadTs } = require("./import_engine_loader.js");

const XLSX_PATH = path.join(ROOT, "docs/input/MISBAR10_PLAN.xlsx");
const PAYLOAD_PATH = path.join(ROOT, "docs/misbar10_import_payload.json");
const FIXTURE_PATH = path.join(ROOT, "tests/fixtures/misbar10_real.json");
const CSV_PATH = path.join(ROOT, "docs/misbar10_import_ready.csv");
const PROFILE_PATH = path.join(ROOT, "docs/import_profiles/misbar10.json");

const PAYLOAD = JSON.parse(fs.readFileSync(PAYLOAD_PATH, "utf8"));
const PROFILE_JSON = JSON.parse(fs.readFileSync(PROFILE_PATH, "utf8"));

// ─── the owner's independently verified numbers ─────────────────────────────
const EXPECT = {
  parent_project_count: 1,
  operational_block_count: 11,
  deliverable_count: 79,
  distribution: [7, 5, 8, 4, 3, 4, 9, 7, 16, 10, 6],
  duplicate_external_keys: 0,
  rows_with_fake_dates: 0,
  rows_missing_source_row: 0,
  rows_missing_external_key: 0,
};

const SHEET_MAIN = "الخطة الإعلامية الكاملة";
const SHEET_SCRATCH = "ورقة1";

// Column layout of the real sheet. B is the title column; a row with B set and
// C..F all blank is a BLOCK BANNER, not a deliverable.
const COL = { A: 0, B: 1, C: 2, D: 3, E: 4, F: 5 };
/** The repeated column-header row the sheet writes once per block. */
const HEADER_B = "المحتوى";
const HEADER_C = "نوع المحتوى";

// ─── witness 1: the file, through the repo's own reader ─────────────────────

if (!TS_AVAILABLE) {
  test("محرّك الاستيراد قابل للتحميل (sucrase)", () => {
    assert.fail("sucrase غير متاح — لا يمكن تنفيذ محرّك الاستيراد الحقيقي، والاختبار لا يجوز أن يمرّ فارغًا.");
  });
}

const parse = loadTs("lib/portal/import/parse.ts");
const preview = loadTs("lib/portal/import/preview.ts");
const profiles = loadTs("lib/portal/import/profiles.ts");
const keys = loadTs("lib/portal/import/keys.ts");
const textUtil = loadTs("lib/portal/import/text.ts");
const mappingUtil = loadTs("lib/portal/import/mapping.ts");

const XLSX_BYTES = new Uint8Array(fs.readFileSync(XLSX_PATH));
/** THE workbook as the platform itself reads it. */
const WB = parse.parseWorkbook(XLSX_BYTES, "MISBAR10_PLAN.xlsx");
const SHEET1 = WB.sheets.find((s) => s.name === SHEET_MAIN);
const SHEET2 = WB.sheets.find((s) => s.name === SHEET_SCRATCH);

/** Raw cell, byte-for-byte as the reader returned it; "" ⇒ null. */
function cell(row, i) {
  const v = row.cells[i];
  return v === undefined || v === "" ? null : v;
}
function blank(row, i) {
  return cell(row, i) === null;
}

/**
 * Classify sheet1 exactly as specified, from the reader's rows only:
 *   banner  = B set, C..F all blank
 *   header  = B "المحتوى" and C "نوع المحتوى"
 *   row     = anything else with any of B..F set
 */
function classifySheet1() {
  const banners = [];
  const rows = [];
  const headers = [];
  const empties = [];
  for (const r of SHEET1.rows) {
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
const FILE = classifySheet1();

// ─── witness 3: the engine, executed over witness 1 ─────────────────────────
const PROFILE = profiles.resolveProfile(PROFILE_JSON);
const PROJECT_KEY = PAYLOAD.project.external_key.split(":")[1];
const PROJECT_TITLE = PAYLOAD.project.title;

function planFromXlsx(context) {
  const picked = parse.pickSheet(WB, SHEET_MAIN);
  return preview.buildPlan({
    sheet: picked.sheet,
    profile: PROFILE,
    context: Object.assign({ projectKey: PROJECT_KEY, parentProjectTitle: PROJECT_TITLE }, context || {}),
    carriedWarnings: picked.warnings,
    fileName: "MISBAR10_PLAN.xlsx",
  });
}
const PLAN = planFromXlsx();

// ════════════════════════════════════════════════════════════════════════════
// 0) الشهود موجودون فعلًا
// ════════════════════════════════════════════════════════════════════════════
test("witnesses_present — الملف الحقيقي والحمولة والقارئ كلّها حاضرة", () => {
  assert.ok(fs.existsSync(XLSX_PATH), "ملف المالك الحقيقي غير موجود في المستودع");
  assert.ok(XLSX_BYTES.length > 0, "ملف المالك فارغ");
  assert.equal(WB.format, "xlsx", "قُرئ الملف بغير صيغة xlsx");
  assert.ok(SHEET1, `الورقة «${SHEET_MAIN}» غير موجودة`);
  assert.ok(SHEET2, `الورقة «${SHEET_SCRATCH}» غير موجودة`);
  assert.equal(SHEET1.rows.length, PAYLOAD.source.parsed_rows, "عدد أسطر الورقة الرئيسية لا يطابق ما أعلنته الحمولة");
  assert.equal(PAYLOAD.source.file, "MISBAR10_PLAN.xlsx");
  assert.equal(PAYLOAD.source.sheet, SHEET_MAIN);
});

// ════════════════════════════════════════════════════════════════════════════
// 1) الأرقام الثمانية المطلوبة — كل واحد تأكيد مستقلّ باسمه
// ════════════════════════════════════════════════════════════════════════════
test("parent_project_count = 1", () => {
  assert.ok(PAYLOAD.project && typeof PAYLOAD.project === "object", "لا مشروع أب في الحمولة");
  assert.equal(Array.isArray(PAYLOAD.project), false, "المشروع الأب مصفوفة — يجب أن يكون واحدًا");
  assert.equal(PAYLOAD.project.title, "مسبار 10");
  assert.equal(PAYLOAD.project.external_key, keys.parentProjectKey(PROFILE.id, PROJECT_KEY),
    "مفتاح المشروع الأب لا يطابق ما يولّده المحرّك");
  // والمحرّك نفسه يرى مشروعًا أبًا واحدًا لا أكثر
  assert.ok(PLAN.parentProject, "المحرّك لم يرَ مشروعًا أبًا");
  assert.equal(PLAN.parentProject.key, PAYLOAD.project.external_key);
  assert.equal(PLAN.counts.parentProjectsToCreate, EXPECT.parent_project_count);
});

test("operational_block_count = 11", () => {
  assert.equal(FILE.banners.length, EXPECT.operational_block_count, "عدد الكتل المقروء من الملف ليس 11");
  assert.equal(PAYLOAD.blocks.length, EXPECT.operational_block_count, "عدد الكتل في الحمولة ليس 11");
  assert.equal(PAYLOAD.counts.blocks, EXPECT.operational_block_count, "عدّاد الحمولة المعلن ليس 11");
  assert.equal(PLAN.nodes.length, EXPECT.operational_block_count, "عدد العقد التي بناها المحرّك ليس 11");
  assert.equal(PLAN.counts.stagesToCreate, EXPECT.operational_block_count);
});

test("deliverable_count = 79", () => {
  assert.equal(FILE.rows.length, EXPECT.deliverable_count, "عدد أسطر المحتوى المقروء من الملف ليس 79");
  assert.equal(PAYLOAD.deliverables.length, EXPECT.deliverable_count, "عدد المخرجات في الحمولة ليس 79");
  assert.equal(PAYLOAD.counts.deliverables, EXPECT.deliverable_count, "عدّاد الحمولة المعلن ليس 79");
  assert.equal(PLAN.counts.accepted, EXPECT.deliverable_count, "المحرّك قَبِل عددًا مختلفًا");
  assert.equal(PLAN.deliverables.length, EXPECT.deliverable_count);
  assert.equal(PLAN.invalidRows.length, 0, "المحرّك رفض أسطرًا — كان يجب أن يقبلها كلّها");
  assert.equal(PLAN.duplicateRows.length, 0, "المحرّك استبعد أسطرًا كمكرّرة — لا يوجد مكرّر حقيقي");
});

test("distribution = [7,5,8,4,3,4,9,7,16,10,6]", () => {
  // من الملف: عدّ الأسطر تحت كلّ لافتة.
  const fromFile = [];
  for (const r of SHEET1.rows) {
    if (FILE.banners.some((b) => b.rowNumber === r.rowNumber)) fromFile.push(0);
    else if (FILE.rows.some((x) => x.rowNumber === r.rowNumber)) {
      assert.ok(fromFile.length > 0, `السطر ${r.rowNumber} يسبق أوّل لافتة — يتيم`);
      fromFile[fromFile.length - 1] += 1;
    }
  }
  assert.deepEqual(fromFile, EXPECT.distribution, "التوزيع المقروء من الملف مختلف");
  assert.deepEqual(PAYLOAD.counts.distribution, EXPECT.distribution, "التوزيع المعلن في الحمولة مختلف");
  assert.deepEqual(PAYLOAD.blocks.map((b) => b.deliverable_count), EXPECT.distribution, "deliverable_count لكل كتلة مختلف");
  assert.deepEqual(PLAN.nodes.map((n) => n.deliverableCount), EXPECT.distribution, "توزيع المحرّك مختلف");
  // والعدّادات المعلنة ليست مجرّد ثوابت: مجموعها = 79 ومحسوبة فعلًا من الأبناء
  const byBlock = PAYLOAD.blocks.map((b) => PAYLOAD.deliverables.filter((d) => d.block_index === b.index).length);
  assert.deepEqual(byBlock, EXPECT.distribution, "عدّاد الكتلة لا يساوي عدد المخرجات المنسوبة إليها");
  assert.equal(EXPECT.distribution.reduce((a, n) => a + n, 0), EXPECT.deliverable_count);
});

test("duplicate_external_keys = 0", () => {
  const all = PAYLOAD.deliverables.map((d) => d.external_key).concat(
    PAYLOAD.blocks.map((b) => b.external_key),
    [PAYLOAD.project.external_key],
  );
  const seen = new Map();
  const dupes = [];
  for (const k of all) {
    if (seen.has(k)) dupes.push(k);
    seen.set(k, true);
  }
  assert.deepEqual(dupes, [], `مفاتيح مكرّرة: ${dupes.join(", ")}`);
  assert.equal(all.length - seen.size, EXPECT.duplicate_external_keys);
  // والمحرّك أيضًا لم يُبلغ عن أيّ تصادم مفاتيح داخل الملف
  assert.equal(PLAN.counts.duplicate, EXPECT.duplicate_external_keys);
});

test("rows_with_fake_dates = 0", () => {
  const DATE_FIELDS = ["planned_start_date", "due_date", "start_date", "end_date", "date", "scheduled_at"];
  let offenders = [];
  const scan = (obj, where) => {
    if (obj === null || typeof obj !== "object") return;
    if (Array.isArray(obj)) return obj.forEach((v, i) => scan(v, `${where}[${i}]`));
    for (const [k, v] of Object.entries(obj)) {
      if (DATE_FIELDS.includes(k) && v !== null) offenders.push(`${where}.${k} = ${JSON.stringify(v)}`);
      scan(v, `${where}.${k}`);
    }
  };
  scan(PAYLOAD.project, "project");
  PAYLOAD.blocks.forEach((b, i) => scan(b, `blocks[${i}]`));
  PAYLOAD.deliverables.forEach((d) => scan(d, `row#${d.source_row_number}`));
  assert.deepEqual(offenders, [], `تواريخ مُختلَقة: ${offenders.join(" | ")}`);
  assert.equal(offenders.length, EXPECT.rows_with_fake_dates);

  // كل شيء بانتظار الجدولة، بلا استثناء
  assert.equal(PAYLOAD.project.schedule_status, "awaiting_schedule");
  for (const b of PAYLOAD.blocks) assert.equal(b.schedule_status, "awaiting_schedule", `الكتلة ${b.index}`);
  for (const d of PAYLOAD.deliverables) assert.equal(d.schedule_status, "awaiting_schedule", `السطر ${d.source_row_number}`);
  // والمحرّك نفسه لم يستخرج أيّ تاريخ من الملف
  assert.equal(PLAN.deliverables.filter((d) => d.due_date !== null).length, 0, "المحرّك اخترع تاريخًا");
  assert.equal(PLAN.warnings.filter((w) => w.code === "unparsed_date").length, 0);

  // ضمانة عدم التفاهة: قارئ التواريخ في المحرّك قادر فعلًا على إنتاج تاريخ.
  assert.equal(mappingUtil.parseDateStrict("2026-06-07").iso, "2026-06-07",
    "قارئ التواريخ لا يقرأ تاريخًا صحيحًا — الاختبار أعلاه يمرّ فارغًا");
});

test("rows_missing_source_row = 0", () => {
  const missing = PAYLOAD.deliverables.filter((d) => !Number.isInteger(d.source_row_number) || d.source_row_number < 1);
  assert.deepEqual(missing.map((d) => d.title), [], "مخرجات بلا رقم سطر مصدر");
  assert.equal(missing.length, EXPECT.rows_missing_source_row);
  for (const b of PAYLOAD.blocks) {
    assert.ok(Number.isInteger(b.source_row_number) && b.source_row_number >= 1, `الكتلة ${b.index} بلا رقم سطر مصدر`);
  }
  // ورقم السطر يشير إلى سطر موجود فعلًا في الملف
  const real = new Set(SHEET1.rows.map((r) => r.rowNumber));
  for (const d of PAYLOAD.deliverables) assert.ok(real.has(d.source_row_number), `السطر ${d.source_row_number} غير موجود في الورقة`);
  for (const b of PAYLOAD.blocks) assert.ok(real.has(b.source_row_number), `سطر الكتلة ${b.source_row_number} غير موجود`);
});

test("rows_missing_external_key = 0", () => {
  const bad = PAYLOAD.deliverables.filter((d) => typeof d.external_key !== "string" || d.external_key.trim() === "");
  assert.deepEqual(bad.map((d) => d.source_row_number), [], "مخرجات بلا مفتاح خارجي");
  assert.equal(bad.length, EXPECT.rows_missing_external_key);
  for (const b of PAYLOAD.blocks) assert.ok(b.external_key && b.external_key.trim() !== "", `الكتلة ${b.index} بلا مفتاح`);
  assert.ok(PAYLOAD.project.external_key.trim() !== "", "المشروع الأب بلا مفتاح");
  // كل مفتاح مخرَج يحمل مفتاح كتلته، فالنسب ليس حرًّا
  for (const d of PAYLOAD.deliverables) {
    const block = PAYLOAD.blocks.find((b) => b.index === d.block_index);
    assert.ok(block, `السطر ${d.source_row_number}: كتلة غير موجودة ${d.block_index}`);
    assert.equal(d.block_external_key, block.external_key, `السطر ${d.source_row_number}: مفتاح كتلة غير مطابق`);
    const stem = block.external_key.replace(/:#node$/, "");
    assert.ok(d.external_key.startsWith(`${stem}:`), `السطر ${d.source_row_number}: المفتاح لا ينتمي لمسار كتلته`);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// 2) قارئ المستودع نفسه هو الحَكَم — لا محلّل خاصّ بالاختبار
// ════════════════════════════════════════════════════════════════════════════
test("repo_reader_is_the_witness — القراءة تمرّ عبر lib/portal/import لا عبر محلّل محلّي", () => {
  // القارئ الحقيقي أنتج الأوراق والأسطر التي بُنيت عليها كل التأكيدات أعلاه.
  assert.equal(typeof parse.parseWorkbook, "function");
  assert.equal(typeof preview.buildPlan, "function");
  // الدوالّ المستعمَلة هنا هي فعلًا الواجهة العامّة للمحرّك، لا نسخة اختبارية
  const surface = loadTs("lib/portal/import/index.ts");
  assert.equal(surface.parseWorkbook, parse.parseWorkbook, "parseWorkbook ليس دالّة المحرّك المصدَّرة");
  assert.equal(surface.buildPlan, preview.buildPlan, "buildPlan ليس دالّة المحرّك المصدَّرة");
  assert.equal(surface.externalKey, keys.externalKey, "externalKey ليس دالّة المحرّك المصدَّرة");
  assert.equal(WB.sheets.length, 2, "القارئ لم يرَ الورقتين");
  assert.deepEqual(WB.sheets.map((s) => s.name), [SHEET_MAIN, SHEET_SCRATCH]);
  assert.deepEqual(WB.warnings, [], "القارئ رفع تنبيهًا عند قراءة ملف المالك");
  // ولم يُستورد أيّ محلّل xlsx خارجي في هذا الملف
  const src = fs.readFileSync(__filename, "utf8");
  for (const banned of ["xlsx", "exceljs", "sheetjs", "node-xlsx"]) {
    assert.doesNotMatch(src, new RegExp(`require\\(["']${banned}`), `الاختبار يستعمل محلّلًا خارجيًّا «${banned}»`);
  }
});

test("reader_vs_payload_cell_exact — كل خلية في الحمولة تطابق ما قرأه المحرّك حرفًا بحرف", () => {
  const byRow = new Map(SHEET1.rows.map((r) => [r.rowNumber, r]));
  const diffs = [];
  for (const d of PAYLOAD.deliverables) {
    const r = byRow.get(d.source_row_number);
    const expected = [d.title, d.metadata.source_content_type, d.metadata.source_platforms, d.execution_details, d.proposed_caption];
    const actual = [cell(r, COL.B), cell(r, COL.C), cell(r, COL.D), cell(r, COL.E), cell(r, COL.F)];
    for (let i = 0; i < expected.length; i++) {
      if (expected[i] !== actual[i]) {
        diffs.push(`سطر ${d.source_row_number} عمود ${["B", "C", "D", "E", "F"][i]}: ملف=${JSON.stringify(actual[i])} حمولة=${JSON.stringify(expected[i])}`);
      }
    }
  }
  assert.deepEqual(diffs, [], `اختلاف بين قارئ المستودع والحمولة:\n${diffs.join("\n")}`);
  // ولا مسافة زائدة حُذفت خلسة: النصّ الأصلي محفوظ بمسافاته
  assert.ok(PAYLOAD.deliverables.some((d) => d.metadata.source_content_type !== d.metadata.source_content_type.trim()),
    "لا قيمة تحمل مسافة طرفية — لُمِّعت البيانات، وفخّ المسافات لم يُختبر");
});

test("engine_reproduces_the_payload — buildPlan فوق ملف xlsx الحقيقي يعيد إنتاج كل مفتاح", () => {
  assert.equal(PLAN.ok, true, `المحرّك فشل: ${PLAN.fatalMessage}`);
  assert.deepEqual(PLAN.deliverables.map((d) => d.external_key), PAYLOAD.deliverables.map((d) => d.external_key),
    "مفاتيح المخرجات التي يولّدها المحرّك تختلف عن الحمولة");
  assert.deepEqual(PLAN.nodes.map((n) => n.key), PAYLOAD.blocks.map((b) => b.external_key),
    "مفاتيح الكتل التي يولّدها المحرّك تختلف عن الحمولة");
  assert.deepEqual(PLAN.deliverables.map((d) => d.source_row_number), PAYLOAD.deliverables.map((d) => d.source_row_number),
    "ترتيب/أرقام أسطر المحرّك تختلف عن الحمولة");
  assert.deepEqual(PLAN.nodes.map((n) => n.title), PAYLOAD.blocks.map((b) => b.title), "عناوين الكتل تختلف");

  // القيم: المحرّك يخزّن القيمة بعد cleanCell (سياسته المعلنة في text.ts:
  // اقتصاص المسافات المحيطة وتوحيد أسطر CRLF فقط، بلا أيّ مساس بالنصّ الداخلي).
  // الحمولة تحفظ الأصل الخام. الجسر بينهما هو cleanCell نفسها — لا استثناء يدويّ.
  const nz = (s) => {
    const c = textUtil.cleanCell(s === null || s === undefined ? "" : s);
    return c === "" ? null : c;
  };
  const diffs = [];
  PLAN.deliverables.forEach((d, i) => {
    const p = PAYLOAD.deliverables[i];
    const pairs = [
      ["title", d.title, nz(p.title)],
      ["content_type_raw", d.content_type_raw, nz(p.metadata.source_content_type)],
      ["platforms", JSON.stringify(d.platforms), JSON.stringify(p.platforms)],
      ["execution_details", d.execution_details, nz(p.execution_details)],
      ["proposed_caption", d.proposed_caption, nz(p.proposed_caption)],
      ["schedule_status", d.schedule_status, p.schedule_status],
      ["due_date", d.due_date, p.due_date],
    ];
    for (const [f, a, b] of pairs) if (a !== b) diffs.push(`سطر ${p.source_row_number} ${f}: محرّك=${JSON.stringify(a)} حمولة=${JSON.stringify(b)}`);
  });
  assert.deepEqual(diffs, [], `المحرّك والحمولة يختلفان:\n${diffs.join("\n")}`);
});

test("csv_artifact_matches_the_xlsx — ملف CSV الوسيط ليس نسخة محرَّرة يدويًّا", () => {
  const csv = fs.readFileSync(CSV_PATH, "utf8");
  const csvWb = parse.parseWorkbook(csv, "misbar10_import_ready.csv");
  const picked = parse.pickSheet(csvWb, null);
  const csvPlan = preview.buildPlan({
    sheet: picked.sheet,
    profile: PROFILE,
    context: { projectKey: PROJECT_KEY, parentProjectTitle: PROJECT_TITLE },
    fileName: "misbar10_import_ready.csv",
  });
  assert.equal(csvPlan.counts.accepted, EXPECT.deliverable_count);
  assert.deepEqual(csvPlan.nodes.map((n) => n.deliverableCount), EXPECT.distribution);
  assert.deepEqual(csvPlan.deliverables.map((d) => d.external_key), PLAN.deliverables.map((d) => d.external_key),
    "مفاتيح CSV تختلف عن مفاتيح ملف xlsx الأصلي");
  assert.deepEqual(csvPlan.deliverables.map((d) => d.title), PLAN.deliverables.map((d) => d.title));
  assert.deepEqual(csvPlan.deliverables.map((d) => JSON.stringify(d.platforms)), PLAN.deliverables.map((d) => JSON.stringify(d.platforms)));
  assert.equal(csvPlan.deliverables.filter((d) => d.due_date !== null).length, 0);
});

test("test_fixture_equals_the_payload — نسخة الاختبار ليست فرعًا منفصلًا يتعفّن", () => {
  const F = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));
  assert.match(F._WARNING_EN, /REAL OWNER DATA/i, "نسخة الاختبار غير موسومة كبيانات حقيقية");
  assert.match(F._WARNING_EN, /do NOT import into production/i, "لا تحذير من الاستيراد إلى الإنتاج");
  assert.match(F._WARNING_AR, /لا تُستورد/, "لا تحذير عربي");
  for (const k of ["source", "project", "blocks", "deliverables", "excluded_rows", "counts"]) {
    assert.deepEqual(F[k], PAYLOAD[k], `القسم «${k}» في نسخة الاختبار يختلف عن الحمولة`);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// 3) سلامة العربية والترميز
// ════════════════════════════════════════════════════════════════════════════
const ARABIC = /[؀-ۿ]/;

test("arabic_integrity — لا تشويه ترميز ولا تطبيع مدمِّر", () => {
  const texts = [];
  texts.push(PAYLOAD.project.title);
  for (const b of PAYLOAD.blocks) texts.push(b.title);
  for (const d of PAYLOAD.deliverables) {
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
  // بايتات القرص عربية حقيقية، لا \u مهرَّبة
  const raw = fs.readFileSync(PAYLOAD_PATH, "utf8");
  assert.ok(raw.includes("المرحلة الأولى"), "العربية مهرَّبة إلى \\u بدل حفظها كما هي");
  assert.doesNotMatch(raw, /\\u06[0-9a-f]{2}/i, "الملف يحوي هروبًا يونيكوديًّا بدل النصّ العربي");
});

test("source_typo_is_preserved — الخطأ الإملائي «المسسجلين» باقٍ كما كتبه المالك", () => {
  const TYPO = "المسسجلين";
  const CORRECT = "المسجلين";
  const inFile = SHEET1.rows.filter((r) => r.cells.join(" ").includes(TYPO)).map((r) => r.rowNumber);
  assert.deepEqual(inFile, [20, 21], "الخطأ الإملائي ليس في السطرين 20 و21 من الملف الحقيقي");
  const inPayload = PAYLOAD.deliverables.filter((d) => (d.execution_details || "").includes(TYPO)).map((d) => d.source_row_number);
  assert.deepEqual(inPayload, [20, 21], "الخطأ الإملائي صُحِّح أو ضاع أثناء الاستخراج");
  for (const n of [20, 21]) {
    const d = PAYLOAD.deliverables.find((x) => x.source_row_number === n);
    const r = SHEET1.rows.find((x) => x.rowNumber === n);
    assert.equal(d.execution_details, cell(r, COL.E), `السطر ${n}: تفاصيل التنفيذ لا تطابق الملف حرفًا بحرف`);
    assert.ok(!d.execution_details.includes(` ${CORRECT}`), `السطر ${n}: الخطأ صُحِّح — الأمانة النصّية مكسورة`);
  }
});

test("en_dash_survives_storage — الشرطة «–» محفوظة في الأصل ومفهومة عند التقسيم", () => {
  const EN_DASH = "–";
  const withDash = PAYLOAD.deliverables.filter((d) => (d.metadata.source_platforms || "").includes(EN_DASH));
  assert.ok(withDash.length >= 10, `عدد الأسطر ذات الشرطة «–» ${withDash.length} — أقلّ من المتوقّع، الفخّ غير مغطّى`);
  for (const d of withDash) {
    const r = SHEET1.rows.find((x) => x.rowNumber === d.source_row_number);
    assert.equal(d.metadata.source_platforms, cell(r, COL.D), `السطر ${d.source_row_number}: نصّ المنصات الأصلي تغيّر`);
    assert.ok(d.platforms.length >= 2, `السطر ${d.source_row_number}: «${d.metadata.source_platforms}» لم يُقسَّم`);
    for (const p of d.platforms) assert.ok(!p.includes(EN_DASH), `السطر ${d.source_row_number}: بقيت الشرطة داخل القيمة «${p}»`);
  }
  // والمحرّك نفسه يعرف الشرطة — لا يكفي أن يعرفها المستخرِج
  assert.deepEqual(textUtil.splitMulti(`إنستقرام ${EN_DASH} إكس`), ["إنستقرام", "إكس"],
    "splitMulti لا يقسّم على الشرطة «–» — المحرّك سيخالف الحمولة عند إعادة الاستيراد");
});

test("unicode_lookalikes_stay_distinct — «تصميم» و«مطبوع» بنسختيهما محفوظتان بالبايت", () => {
  const ctVariants = new Set(PAYLOAD.deliverables.map((d) => d.metadata.source_content_type));
  const tasmim = [...ctVariants].filter((s) => textUtil.normalizeForMatch(s) === "تصميم");
  assert.equal(tasmim.length, 2, `«تصميم» ظهرت ${tasmim.length} مرّة كصيغة متمايزة — المتوقّع نسختان مختلفتان بالبايت`);
  assert.equal(new Set(tasmim.map((s) => s.trim())).size, 1, "النسختان لا تتطابقان بعد التطبيع — ليستا الفخّ نفسه");
  const pfVariants = new Set(PAYLOAD.deliverables.map((d) => d.metadata.source_platforms).filter(Boolean));
  const matbou = [...pfVariants].filter((s) => textUtil.normalizeForMatch(s) === "مطبوع");
  assert.equal(matbou.length, 2, `«مطبوع» ظهرت ${matbou.length} مرّة كصيغة متمايزة — المتوقّع نسختان`);
  // التطبيع للمطابقة فقط: الصيغتان تنهاران إلى نوع واحد رغم اختلاف البايت
  const types = new Set(PAYLOAD.deliverables.filter((d) => tasmim.includes(d.metadata.source_content_type)).map((d) => d.content_type));
  assert.deepEqual([...types], ["design"], "نسختا «تصميم» أُسنِدتا إلى نوعين مختلفين — التطبيع لم يُستعمل في المطابقة");
  // 33 و28 قيمة متمايزة كما في الملف — لا دمج ولا تنظيف
  assert.equal(ctVariants.size, 33, `عدد قيم «نوع المحتوى» المتمايزة ${ctVariants.size} وليس 33`);
  assert.equal(new Set(PAYLOAD.deliverables.map((d) => d.metadata.source_platforms)).size, 28,
    "عدد قيم «المنصات» المتمايزة ليس 28");
});

// ════════════════════════════════════════════════════════════════════════════
// 4) لا سطر ضاع، ولا سطران دُمِجا
// ════════════════════════════════════════════════════════════════════════════
test("no_content_row_is_lost — كل سطر محتوى في الورقة يظهر مرّة واحدة بالضبط", () => {
  const fromFile = FILE.rows.map((r) => r.rowNumber).sort((a, b) => a - b);
  const inPayload = PAYLOAD.deliverables.map((d) => d.source_row_number).sort((a, b) => a - b);
  assert.deepEqual(inPayload, fromFile, "مجموعة أسطر الحمولة لا تساوي أسطر المحتوى في الملف");
  assert.equal(new Set(inPayload).size, inPayload.length, "سطر مصدر مستعمَل أكثر من مرّة");
  // والمحرّك قرأ الأسطر نفسها
  assert.deepEqual(PLAN.deliverables.map((d) => d.source_row_number).sort((a, b) => a - b), fromFile);
  // لافتات الكتل ليست مخرجات، لكنّها ليست مفقودة أيضًا: كل واحدة كتلة معلَنة
  assert.deepEqual(PAYLOAD.blocks.map((b) => b.source_row_number), FILE.banners.map((b) => b.rowNumber));
  // صفوف العناوين: الورقة تكرّرها 11 مرّة (واحدة تحت كل لافتة). المحرّك يتّخذ
  // واحدة منها صفَّ العناوين الفعليّ، والعشرة الباقية يجب أن تُسجَّل في
  // skippedRows بسببها — لا أن تختفي بصمت ولا أن تصير مخرجات.
  assert.equal(FILE.headers.length, 11, "عدد صفوف العناوين المكرّرة ليس 11");
  const headerRowNumber = PLAN.mapping.length > 0 ? mappingUtil.buildMapping(parse.pickSheet(WB, SHEET_MAIN).sheet, PROFILE).headerRowNumber : -1;
  assert.ok(FILE.headers.includes(headerRowNumber), `صفّ العناوين الذي اختاره المحرّك (${headerRowNumber}) ليس أحد الصفوف الـ11`);
  for (const n of FILE.headers) {
    assert.equal(PAYLOAD.deliverables.some((d) => d.source_row_number === n), false, `صفّ عناوين ${n} صار مخرَجًا`);
    assert.equal(PLAN.deliverables.some((d) => d.source_row_number === n), false, `صفّ عناوين ${n} صار مخرَجًا عند المحرّك`);
    if (n === headerRowNumber) continue;
    assert.ok(PLAN.skippedRows.some((s) => s.rowNumber === n), `صفّ العناوين ${n} أُسقط بلا تسجيل`);
  }
  assert.equal(FILE.headers.filter((n) => n !== headerRowNumber).length, 10);
  // واللافتات نفسها مسجَّلة كمُسقَطة أيضًا — لا كتلة تختفي بلا أثر
  for (const b of FILE.banners) {
    assert.ok(PLAN.skippedRows.some((s) => s.rowNumber === b.rowNumber), `لافتة الكتلة ${b.rowNumber} أُسقطت بلا تسجيل`);
  }
});

test("the_two_announcement_rows_stay_two — «إعلان المقبولين» سطران لا سطر", () => {
  const pair = PAYLOAD.deliverables.filter((d) => d.source_row_number === 20 || d.source_row_number === 21);
  assert.equal(pair.length, 2, "أحد سطري «إعلان المقبولين» ضاع أو دُمج");
  const [a, b] = pair.sort((x, y) => x.source_row_number - y.source_row_number);
  assert.equal(a.title, "إعلان المقبولين");
  assert.equal(b.title, a.title, "العنوانان مختلفان — ليسا الحالة المقصودة");
  assert.equal(a.content_type, b.content_type);
  assert.equal(a.metadata.source_platforms, b.metadata.source_platforms);
  assert.equal(a.proposed_caption, b.proposed_caption);
  assert.notEqual(a.external_key, b.external_key, "السطران يحملان المفتاح نفسه — سيُدمجان عند الاستيراد");
  assert.notEqual(a.execution_details, b.execution_details, "تفاصيل التنفيذ متطابقة — أحد النصّين ضاع");
  assert.ok(a.execution_details.endsWith("شعارات الجمعيات)"), `السطر 20 لا ينتهي بـ«شعارات الجمعيات»: ${a.execution_details}`);
  assert.ok(b.execution_details.endsWith("شعارات الداعمين)"), `السطر 21 لا ينتهي بـ«شعارات الداعمين»: ${b.execution_details}`);
  // والمحرّك أيضًا يبقيهما اثنين ولا يعدّ الثاني تكرارًا
  const engine = PLAN.deliverables.filter((d) => d.source_row_number === 20 || d.source_row_number === 21);
  assert.equal(engine.length, 2, "المحرّك أسقط أحد السطرين كتكرار");
  assert.notEqual(engine[0].external_key, engine[1].external_key);
  assert.notEqual(engine[0].content_hash, engine[1].content_hash, "بصمة المحتوى متطابقة رغم اختلاف النصّ");
  assert.equal(PLAN.duplicateRows.filter((r) => r.rowNumber === 20 || r.rowNumber === 21).length, 0);
});

test("scratch_sheet_rows_are_excluded_but_reported — أسطر «ورقة1» الثلاثة معلنة لا مطموسة", () => {
  assert.equal(SHEET2.rows.length, 3, "ورقة1 لا تحوي ثلاثة أسطر كما هو موصوف");
  assert.equal(PAYLOAD.excluded_rows.length, 3, "الحمولة لا تُبلغ عن ثلاثة أسطر مستبعَدة");
  assert.deepEqual(PAYLOAD.excluded_rows.map((r) => r.row).sort((a, b) => a - b), [14, 18, 24]);
  const dupOf = {};
  for (const ex of PAYLOAD.excluded_rows) {
    assert.equal(ex.sheet, SHEET_SCRATCH, "سطر مستبعَد منسوب لغير ورقة1");
    assert.ok(typeof ex.reason === "string" && ex.reason.length > 40, `السطر ${ex.row} مستبعَد بلا تعليل مكتوب`);
    assert.ok(Number.isInteger(ex.duplicate_of_row), `السطر ${ex.row} بلا إشارة إلى السطر الذي يكرّره`);
    assert.ok(PAYLOAD.deliverables.some((d) => d.source_row_number === ex.duplicate_of_row),
      `السطر ${ex.row} يشير إلى سطر ${ex.duplicate_of_row} غير موجود في الـ79`);
    dupOf[ex.row] = ex.duplicate_of_row;
  }
  assert.deepEqual(dupOf, { 14: 49, 18: 5, 24: 6 }, "خريطة التكرار لا تطابق ما رُصد في الملف");
  // وهي فعلًا مستبعَدة من الـ79
  assert.equal(PAYLOAD.deliverables.length, EXPECT.deliverable_count);
});

// ════════════════════════════════════════════════════════════════════════════
// 5) الخلايا الفارغة null — لا "" ولا نصّ بديل
// ════════════════════════════════════════════════════════════════════════════
test("empty_cells_are_null_with_the_exact_census — 1 منصات، 2 تفاصيل، 23 وصف", () => {
  const censusFile = { D: 0, E: 0, F: 0 };
  const byRow = new Map(SHEET1.rows.map((r) => [r.rowNumber, r]));
  for (const d of PAYLOAD.deliverables) {
    const r = byRow.get(d.source_row_number);
    if (blank(r, COL.D)) censusFile.D++;
    if (blank(r, COL.E)) censusFile.E++;
    if (blank(r, COL.F)) censusFile.F++;
    assert.ok(!blank(r, COL.B), `السطر ${d.source_row_number}: عمود العنوان فارغ`);
    assert.ok(!blank(r, COL.C), `السطر ${d.source_row_number}: عمود نوع المحتوى فارغ`);
  }
  assert.deepEqual(censusFile, { D: 1, E: 2, F: 23 }, "إحصاء الفراغات في الملف الحقيقي مختلف");

  const censusPayload = {
    D: PAYLOAD.deliverables.filter((d) => d.metadata.source_platforms === null).length,
    E: PAYLOAD.deliverables.filter((d) => d.execution_details === null).length,
    F: PAYLOAD.deliverables.filter((d) => d.proposed_caption === null).length,
  };
  assert.deepEqual(censusPayload, { D: 1, E: 2, F: 23 }, "إحصاء الفراغات في الحمولة مختلف");

  // الفارغ null حصرًا: لا "" ولا "غير محدد" ولا "-" ولا "N/A"
  const PLACEHOLDERS = ["", " ", "-", "—", "لا يوجد", "غير محدد", "غير محدّد", "N/A", "n/a", "null", "NULL", "TBD", "?"];
  for (const d of PAYLOAD.deliverables) {
    for (const f of ["execution_details", "proposed_caption", "expected_units"]) {
      const v = d[f];
      if (v === null) continue;
      assert.notEqual(typeof v === "string" ? v.trim() : v, "", `السطر ${d.source_row_number}: ${f} نصّ فارغ بدل null`);
      if (typeof v === "string") assert.ok(!PLACEHOLDERS.includes(v.trim()), `السطر ${d.source_row_number}: ${f} قيمة بديلة «${v}»`);
    }
    assert.ok(d.metadata.source_platforms === null || d.metadata.source_platforms.trim() !== "",
      `السطر ${d.source_row_number}: source_platforms نصّ فارغ بدل null`);
  }
  // السطر الوحيد بلا منصات: مصفوفة فارغة، لا مصفوفة فيها ""
  const noPlatform = PAYLOAD.deliverables.filter((d) => d.metadata.source_platforms === null);
  assert.equal(noPlatform.length, 1);
  assert.deepEqual(noPlatform[0].platforms, [], "السطر بلا منصات حُشِي بقيمة مخترعة");
});

// ════════════════════════════════════════════════════════════════════════════
// 6) تعيين نوع المحتوى
// ════════════════════════════════════════════════════════════════════════════
/** المفاتيح الـ13 التي تملكها المنصّة — مقروءة من ملف التعيين، لا مكتوبة هنا. */
const GENERIC_KEYS = Object.keys(PROFILE_JSON.contentTypeKeys).filter((k) => !k.startsWith("$")).concat(["custom"]);

test("content_type_maps_into_the_13_platform_keys — والأصل العربي محفوظ", () => {
  assert.equal(GENERIC_KEYS.length, 13, `عدد المفاتيح العامّة ${GENERIC_KEYS.length} وليس 13`);
  for (const k of ["video", "photography", "design", "print", "live_stream", "event", "field_execution",
    "presentation", "gift", "report", "digital_content", "copywriting", "custom"]) {
    assert.ok(GENERIC_KEYS.includes(k), `المفتاح العامّ «${k}» غير معرَّف في ملف التعيين`);
  }
  const byRow = new Map(SHEET1.rows.map((r) => [r.rowNumber, r]));
  for (const d of PAYLOAD.deliverables) {
    assert.ok(GENERIC_KEYS.includes(d.content_type),
      `السطر ${d.source_row_number}: النوع «${d.content_type}» ليس من المفاتيح الـ13`);
    assert.equal(typeof d.metadata.source_content_type, "string", `السطر ${d.source_row_number}: الأصل العربي مفقود`);
    assert.notEqual(d.metadata.source_content_type, null);
    assert.ok(ARABIC.test(d.metadata.source_content_type), `السطر ${d.source_row_number}: الأصل ليس عربيًّا`);
    assert.equal(d.metadata.source_content_type, cell(byRow.get(d.source_row_number), COL.C),
      `السطر ${d.source_row_number}: الأصل لا يطابق الخلية في الملف`);
  }
  // القيم المركّبة لم تُلقَ كلّها في «custom»: التعيين تمّ فعلًا
  const used = new Set(PAYLOAD.deliverables.map((d) => d.content_type));
  assert.ok(used.size >= 5, `عدد الأنواع المستعمَلة ${used.size} — التعيين شبه معطَّل`);
  const customCount = PAYLOAD.deliverables.filter((d) => d.content_type === "custom").length;
  assert.ok(customCount < PAYLOAD.deliverables.length / 2, `«custom» ابتلع ${customCount} من ${PAYLOAD.deliverables.length}`);
  // وكل مصدر متمايز أُسند بثبات: نفس النصّ ⇒ نفس المفتاح دائمًا
  const seen = new Map();
  for (const d of PAYLOAD.deliverables) {
    const k = textUtil.normalizeForMatch(d.metadata.source_content_type);
    if (seen.has(k)) assert.equal(d.content_type, seen.get(k), `«${d.metadata.source_content_type}» أُسند لمفتاحين مختلفين`);
    else seen.set(k, d.content_type);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// 7) المنصّات
// ════════════════════════════════════════════════════════════════════════════
test("platforms_split_correctly_and_keep_their_original", () => {
  const byRow = new Map(SHEET1.rows.map((r) => [r.rowNumber, r]));
  let multi = 0;
  for (const d of PAYLOAD.deliverables) {
    assert.ok(Array.isArray(d.platforms), `السطر ${d.source_row_number}: platforms ليست مصفوفة`);
    for (const p of d.platforms) {
      assert.equal(typeof p, "string");
      assert.equal(p, p.trim(), `السطر ${d.source_row_number}: مسافات حول «${p}»`);
      assert.ok(p.length > 0, `السطر ${d.source_row_number}: منصّة فارغة`);
      assert.ok(!/[–—+]|(\s-\s)/.test(p), `السطر ${d.source_row_number}: فاصل باقٍ داخل «${p}»`);
    }
    assert.equal(new Set(d.platforms).size, d.platforms.length, `السطر ${d.source_row_number}: تكرار منصّات`);
    if (d.platforms.length > 1) multi++;
    // الأصل محفوظ حرفًا بحرف مقابل الخلية
    assert.equal(d.metadata.source_platforms, cell(byRow.get(d.source_row_number), COL.D),
      `السطر ${d.source_row_number}: نصّ المنصات الأصلي لا يطابق الملف`);
  }
  assert.ok(multi >= 20, `عدد الأسطر متعدّدة المنصّات ${multi} — أقلّ من المتوقّع`);

  // «جميع المنصات» قيمة واحدة مشروعة، لا تُفكَّك
  const all = PAYLOAD.deliverables.filter((d) => (d.metadata.source_platforms || "").trim() === "جميع المنصات");
  assert.ok(all.length > 0, "«جميع المنصات» غير ممثّلة — الحالة غير مغطّاة");
  for (const d of all) assert.deepEqual(d.platforms, ["جميع المنصات"], `السطر ${d.source_row_number}: «جميع المنصات» فُكِّكت`);

  // الفواصل الثلاثة كلّها مغطّاة، وكلّها تُقسَّم فعلًا
  const seps = { "–": 0, "+": 0, "-": 0 };
  for (const d of PAYLOAD.deliverables) {
    const s = d.metadata.source_platforms || "";
    for (const sep of Object.keys(seps)) if (s.includes(` ${sep} `)) seps[sep]++;
  }
  assert.ok(seps["–"] > 0 && seps["+"] > 0, `الفواصل غير ممثّلة: ${JSON.stringify(seps)}`);
  for (const d of PAYLOAD.deliverables) {
    const s = d.metadata.source_platforms || "";
    if (/ [–+] /.test(s)) assert.ok(d.platforms.length >= 2, `السطر ${d.source_row_number}: «${s}» لم يُقسَّم`);
  }
  // والمحرّك يوافق على التقسيم نفسه (وإلا فإعادة الاستيراد ستنتج قيمًا أخرى)
  PLAN.deliverables.forEach((d, i) => {
    assert.deepEqual(d.platforms, PAYLOAD.deliverables[i].platforms,
      `السطر ${PAYLOAD.deliverables[i].source_row_number}: تقسيم المحرّك يخالف الحمولة`);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 8) التكرار — القرارات الموثَّقة، بلا توليد نسخ
// ════════════════════════════════════════════════════════════════════════════
/**
 * القرار المتّخذ لكل مرشَّح من مرشّحي المسح بالكلمات المفتاحية، مع سببه.
 * كل ما عدا هذه الأسطر = none.
 */
const RECURRENCE_DECISIONS = {
  3: { type: "daily", why: "«عد تنازلي يومي» — التنفيذ ينصّ على تسليم يوميّ (العد التنازلي اليومي)" },
  16: { type: "weekly", why: "«تقارير أسبوعية (إحصائيات أسبوعية…)» — الإحصاءات الأسبوعية" },
  34: { type: "none", why: "«لقطات من التفاعل اليومي» تصف مادّة المصدر لا وتيرة التسليم — مخرَج واحد" },
  35: { type: "none", why: "«بالإستفادة من محتوى اللقاء الأسبوعي» — اللقاء أسبوعيّ، لا المخرَج" },
  36: { type: "weekly", why: "«النشرة الأسبوعية»، ونوعها «صحيفة رقمية أسبوعية»" },
  42: { type: "none", why: "«حصاد المرحلة الأولى» يستفيد من النشرة الأسبوعية — حصاد لمرّة واحدة" },
  50: { type: "none", why: "نفس نصّ السطر 34: لقطات من التفاعل اليومي كمصدر — مخرَج واحد" },
  51: { type: "weekly", why: "«النشرة الأسبوعية» مرّة ثانية في مرحلة أخرى — تكرار مشروع" },
  77: { type: "daily", why: "نوع المحتوى نفسه «فيديو يومي» — الفيديو اليومي" },
  82: { type: "none", why: "«عرض المشاريع اليومية» عرض واحد يلخّص، لا سلسلة" },
  90: { type: "daily", why: "«النشرة اليومية»، ونوعها «صحيفة رقمية يومية»" },
};
const RECURRING_ROWS = Object.keys(RECURRENCE_DECISIONS)
  .filter((n) => RECURRENCE_DECISIONS[n].type !== "none")
  .map(Number)
  .sort((a, b) => a - b);

test("recurrence_matches_the_documented_decisions", () => {
  const ALLOWED = ["none", "daily", "weekly", "monthly", "custom"];
  for (const d of PAYLOAD.deliverables) {
    assert.ok(ALLOWED.includes(d.recurrence_type), `السطر ${d.source_row_number}: نوع تكرار مجهول «${d.recurrence_type}»`);
  }
  for (const [rowStr, decision] of Object.entries(RECURRENCE_DECISIONS)) {
    const row = Number(rowStr);
    const d = PAYLOAD.deliverables.find((x) => x.source_row_number === row);
    assert.ok(d, `السطر المرشَّح ${row} غير موجود في الـ79`);
    assert.equal(d.recurrence_type, decision.type, `السطر ${row} («${d.title}») — القرار الموثَّق: ${decision.why}`);
  }
  const actual = PAYLOAD.deliverables.filter((d) => d.recurrence_type !== "none").map((d) => d.source_row_number).sort((a, b) => a - b);
  assert.deepEqual(actual, RECURRING_ROWS, "مجموعة الأسطر المتكرّرة تخالف القرارات الموثَّقة");
  // الخمسة التي سمّاها المالك ممثَّلة (النشرة الأسبوعية تظهر مرّتين ⇒ 6 أسطر)
  assert.equal(RECURRING_ROWS.length, 6);
  assert.equal(actual.filter((n) => PAYLOAD.deliverables.find((d) => d.source_row_number === n).recurrence_type === "daily").length, 3);
  assert.equal(actual.filter((n) => PAYLOAD.deliverables.find((d) => d.source_row_number === n).recurrence_type === "weekly").length, 3);
});

test("no_daily_instances_were_generated — التكرار وصف لا تفريخ", () => {
  assert.equal(PAYLOAD.deliverables.length, EXPECT.deliverable_count, "عدد المخرجات تغيّر — وُلِّدت نسخ");
  const titles = new Map();
  for (const d of PAYLOAD.deliverables) titles.set(d.title, (titles.get(d.title) || 0) + 1);
  for (const n of RECURRING_ROWS) {
    const d = PAYLOAD.deliverables.find((x) => x.source_row_number === n);
    assert.ok(titles.get(d.title) <= 2, `«${d.title}» مكرّر ${titles.get(d.title)} مرّة — يبدو تفريخًا`);
  }
  // العدد المتوقّع غير معروف ما دام لا جدول معتمَد — يبقى null، لا 30 ولا 1
  for (const d of PAYLOAD.deliverables) {
    assert.equal(d.expected_units, null, `السطر ${d.source_row_number}: expected_units مخترَع (${d.expected_units})`);
    assert.equal(d.completed_units, 0, `السطر ${d.source_row_number}: completed_units ليس 0`);
  }
  assert.equal(PAYLOAD.deliverables.filter((d) => d.expected_units !== null).length, 0);
});

// ════════════════════════════════════════════════════════════════════════════
// 9) عناوين الكتل حرفية، والتواريخ داخلها نصّ لا حقل
// ════════════════════════════════════════════════════════════════════════════
test("block_titles_are_verbatim_including_their_dates", () => {
  const byRow = new Map(SHEET1.rows.map((r) => [r.rowNumber, r]));
  assert.equal(PAYLOAD.blocks.length, 11);
  PAYLOAD.blocks.forEach((b, i) => {
    assert.equal(b.index, i + 1, "ترقيم الكتل غير متّصل");
    assert.equal(b.stage_order, i + 1, "stage_order لا يطابق الترتيب");
    const fileTitle = cell(byRow.get(b.source_row_number), COL.B);
    assert.equal(b.title, fileTitle, `الكتلة ${b.index}: العنوان أُعيدت صياغته أو اقتُطع`);
    assert.equal(b.title, FILE.banners[i].title, "ترتيب الكتل لا يطابق ترتيب اللافتات في الملف");
    assert.ok(b.title.startsWith("المرحلة"), `الكتلة ${b.index}: العنوان لا يبدأ بـ«المرحلة» — تغيّر`);
  });
  // المرحلة الثامنة أربعة أقسام، والثالثة والرابعة مدموجتان — كلاهما مقصود
  assert.equal(PAYLOAD.blocks.filter((b) => b.title.startsWith("المرحلة الثامنة")).length, 4,
    "أقسام المرحلة الثامنة الأربعة دُمجت أو ضاع أحدها");
  assert.equal(PAYLOAD.blocks.filter((b) => b.title.includes("الثالثة والرابعة")).length, 1,
    "دمج المرحلتين الثالثة والرابعة اختفى");

  // التاريخ داخل العنوان نصّ فقط: يظهر في العنوان، ولا حقل تاريخ اشتُقّ منه
  const dated = PAYLOAD.blocks.filter((b) => /\d{2}/.test(b.title) && /20\d\d/.test(b.title));
  assert.ok(dated.length >= 9, `عدد الكتل التي تحمل تاريخًا في عنوانها ${dated.length} — أقلّ من المتوقّع`);
  for (const b of dated) {
    assert.equal(b.planned_start_date, null, `الكتلة ${b.index}: اشتُقّ تاريخ بدء من نصّ العنوان`);
    assert.equal(b.due_date, null, `الكتلة ${b.index}: اشتُقّ تاريخ تسليم من نصّ العنوان`);
    for (const d of PAYLOAD.deliverables.filter((x) => x.block_index === b.index)) {
      assert.equal(d.planned_start_date, null, `السطر ${d.source_row_number}: ورث تاريخًا من عنوان كتلته`);
      assert.equal(d.due_date, null, `السطر ${d.source_row_number}: ورث تاريخًا من عنوان كتلته`);
    }
  }
  // والمحرّك احتفظ بالعنوان كما هو في العقدة
  assert.deepEqual(PLAN.nodes.map((n) => n.title), PAYLOAD.blocks.map((b) => b.title));
});

// ════════════════════════════════════════════════════════════════════════════
// 10) الثبات وإعادة الاستيراد
// ════════════════════════════════════════════════════════════════════════════
test("key_derivation_is_deterministic — تشغيلان متتاليان ⇒ المفاتيح نفسها", () => {
  const again = planFromXlsx();
  assert.deepEqual(again.deliverables.map((d) => d.external_key), PLAN.deliverables.map((d) => d.external_key));
  assert.deepEqual(again.nodes.map((n) => n.key), PLAN.nodes.map((n) => n.key));
  assert.deepEqual(again.deliverables.map((d) => d.content_hash), PLAN.deliverables.map((d) => d.content_hash));
  // الخطّتان متطابقتان كلّيًّا عدا ختم الوقت
  assert.equal(JSON.stringify({ ...again, generatedAt: null }), JSON.stringify({ ...PLAN, generatedAt: null }),
    "خطّتان من الملف نفسه ليستا متطابقتين");
  // ولا مصدر عشوائيّ في المفتاح: لا UUID ولا ختم وقت
  for (const d of PLAN.deliverables) {
    assert.doesNotMatch(d.external_key, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i, `مفتاح يشبه UUID: ${d.external_key}`);
    assert.doesNotMatch(d.external_key, /1[6-9]\d{11}/, `مفتاح يحوي ختم وقت: ${d.external_key}`);
    assert.equal(d.external_key.split(":").length, 4, `المفتاح ليس رباعيّ المقاطع: ${d.external_key}`);
  }
  // ونفس مدخلات الهوية عبر واجهة keys.ts مباشرةً تعطي النتيجة نفسها
  const sample = PLAN.deliverables[0];
  const mk = () => keys.externalKey({
    profileId: PROFILE.id,
    projectKey: PROJECT_KEY,
    levelKeys: sample.level_keys,
    row: { strategy: PROFILE.keyStrategy, explicit: null, levelKeys: sample.level_keys, title: sample.title, occurrence: 1, rowNumber: sample.source_row_number },
  }).key;
  assert.equal(mk(), mk());
  assert.equal(mk(), sample.external_key, "keys.externalKey لا يعيد إنتاج مفتاح المحرّك");
});

test("re_import_is_idempotent — deliverablesToCreate = 0 عند إعادة تمرير الحمولة نفسها", () => {
  const existing = {};
  for (const d of PLAN.deliverables) existing[d.external_key] = { id: `row-${d.source_row_number}`, content_hash: d.content_hash };
  for (const n of PLAN.nodes) existing[n.key] = { id: `node-${n.sequence}`, content_hash: null };
  existing[PLAN.parentProject.key] = { id: "project", content_hash: null };

  const second = planFromXlsx({ existing, existingLookupAvailable: true, projectId: "project" });
  assert.equal(second.counts.deliverablesToCreate, 0, "إعادة الاستيراد ستنشئ صفوفًا جديدة — الهوية غير مستقرّة");
  assert.equal(second.counts.deliverablesToUpdate, 0, "إعادة الاستيراد ستحدّث صفوفًا رغم عدم تغيّر شيء");
  assert.equal(second.counts.deliverablesUnchanged, EXPECT.deliverable_count, "لم تُطابَق الـ79 كلّها");
  assert.equal(second.counts.stagesToCreate, 0, "ستُنشأ كتل جديدة رغم وجودها");
  assert.equal(second.counts.parentProjectsToCreate, 0, "سيُنشأ مشروع أب ثانٍ");
  assert.equal(second.counts.accepted, EXPECT.deliverable_count);
  for (const d of second.deliverables) assert.equal(d.action, "unchanged", `السطر ${d.source_row_number}: ${d.action}`);

  // ضمانة عدم التفاهة: تغيير حرف واحد في بصمة صفّ واحد يجب أن يقلبه إلى update
  const tampered = { ...existing };
  const victim = PLAN.deliverables[0];
  tampered[victim.external_key] = { id: "row-x", content_hash: "0000000000000000" };
  const third = planFromXlsx({ existing: tampered, existingLookupAvailable: true, projectId: "project" });
  assert.equal(third.counts.deliverablesToUpdate, 1, "تغيّر المحتوى لم يُرصد — كشف التغيير معطَّل");
  assert.equal(third.counts.deliverablesToCreate, 0);
  assert.equal(third.counts.deliverablesUnchanged, EXPECT.deliverable_count - 1);
});

// ════════════════════════════════════════════════════════════════════════════
// 11) نقاء نواة المنصّة
// ════════════════════════════════════════════════════════════════════════════
test("platform_core_stays_generic — لا اسم مشروع ولا عدد مُثبَّت داخل النواة", () => {
  const hits = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== "node_modules" && e.name !== ".next") walk(p);
        continue;
      }
      if (!/\.(ts|tsx|js|jsx)$/.test(e.name)) continue;
      if (/misbar/i.test(fs.readFileSync(p, "utf8"))) hits.push(path.relative(ROOT, p));
    }
  };
  for (const r of ["lib", "components", "app"]) {
    const d = path.join(ROOT, r);
    if (fs.existsSync(d)) walk(d);
  }
  assert.deepEqual(hits, [], `اسم المشروع تسرّب إلى نواة المنصّة: ${hits.join(", ")}`);

  const sqlHits = fs.readdirSync(path.join(ROOT, "docs"))
    .filter((f) => /RUNME.*\.sql$/i.test(f))
    .filter((f) => /misbar/i.test(fs.readFileSync(path.join(ROOT, "docs", f), "utf8")));
  assert.deepEqual(sqlHits, [], `اسم المشروع تسرّب إلى ملفات SQL التشغيلية: ${sqlHits.join(", ")}`);

  // ملف التعيين بيانات: يصف أعمدة، ولا يذكر مرحلة ولا عددًا ولا اسم عميل
  const profileText = fs.readFileSync(PROFILE_PATH, "utf8");
  assert.doesNotMatch(profileText, /\b79\b/, "ملف التعيين يثبّت عدد المخرجات");
  assert.doesNotMatch(profileText, /المرحلة الأولى|المرحلة الثامنة/, "ملف التعيين يسمّي مراحل مشروع بعينه");
});
