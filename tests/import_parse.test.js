// ════════════════════════════════════════════════════════════════════════════
// tests/import_parse.test.js — the READING layer of the import engine:
// SHA-256, raw DEFLATE, ZIP, XLSX, CSV and the Arabic text primitives.
//
// The decompressor and the ZIP reader are hand-written, so they are tested
// against bytes produced by node:zlib — an independent implementation. Arabic
// strings are asserted for EXACT equality end-to-end: any normalisation that
// damaged them would fail here rather than in production.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("node:zlib");
const crypto = require("node:crypto");
const { loadTs, makeXlsx, TS_AVAILABLE } = require("./import_engine_loader");

assert.ok(TS_AVAILABLE, "sucrase must be available to run the import engine tests");

const sha = loadTs("lib/portal/import/sha256.ts");
const text = loadTs("lib/portal/import/text.ts");
const { inflateRaw } = loadTs("lib/portal/import/inflate.ts");
const { ZipArchive } = loadTs("lib/portal/import/zip.ts");
const xlsx = loadTs("lib/portal/import/xlsx.ts");
const { parseCsv, detectDelimiter } = loadTs("lib/portal/import/csvParse.ts");
const { parseWorkbook, pickSheet } = loadTs("lib/portal/import/parse.ts");

const AR = "المرحلة الأولى — إطلاق الحملة";
const AR2 = "نص الوصف المقترح: «نبدأ اليوم رحلةً جديدة»";

// ─── SHA-256 ───────────────────────────────────────────────────────────────
test("sha256 matches node:crypto for ASCII, Arabic and long input", () => {
  const cases = ["", "abc", AR, AR2, "x".repeat(1000), AR.repeat(97)];
  for (const c of cases) {
    assert.equal(sha.sha256(c), crypto.createHash("sha256").update(c, "utf8").digest("hex"), `sha256 mismatch for ${JSON.stringify(c.slice(0, 20))}`);
  }
});

test("sha256 known vectors + shortHash is a stable prefix", () => {
  assert.equal(sha.sha256("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(sha.shortHash("abc", 12), "ba7816bf8f01");
  assert.equal(sha.shortHash("abc", 12), sha.shortHash("abc", 12));
});

// ─── DEFLATE ───────────────────────────────────────────────────────────────
test("inflateRaw round-trips every zlib compression level (stored, fixed, dynamic)", () => {
  const payloads = [
    Buffer.from(""),
    Buffer.from("a"),
    Buffer.from(AR.repeat(400), "utf8"),
    Buffer.from(JSON.stringify({ a: AR, b: [1, 2, 3] }).repeat(60), "utf8"),
    crypto.randomBytes(50_000),
    Buffer.from("ab".repeat(70_000), "utf8"),
  ];
  for (const p of payloads) {
    for (const level of [0, 1, 6, 9]) {
      const comp = zlib.deflateRawSync(p, { level });
      const out = Buffer.from(inflateRaw(new Uint8Array(comp), p.length));
      assert.equal(out.length, p.length, `length mismatch at level ${level}`);
      assert.ok(out.equals(p), `payload mismatch at level ${level}`);
    }
  }
});

test("inflateRaw refuses a decompression bomb instead of exhausting memory", () => {
  // 8 MiB of zeros compresses to a few KB — the classic upload that OOM-kills a
  // server. The cap turns it into a thrown error the route reports as a 400.
  const bomb = zlib.deflateRawSync(Buffer.alloc(8 * 1024 * 1024));
  assert.throws(() => inflateRaw(new Uint8Array(bomb), 8 * 1024 * 1024, 64 * 1024), /exceeds the .* limit/);
  const fine = inflateRaw(new Uint8Array(bomb), 8 * 1024 * 1024);
  assert.equal(fine.length, 8 * 1024 * 1024, "a legitimate large sheet still inflates under the default cap");
});

test("inflateRaw rejects corrupt input instead of returning garbage", () => {
  assert.throws(() => inflateRaw(new Uint8Array([0xff, 0xff, 0xff, 0xff])));
  const good = zlib.deflateRawSync(Buffer.from(AR.repeat(50)));
  assert.throws(() => inflateRaw(new Uint8Array(good.subarray(0, 5))));
});

// ─── ZIP ───────────────────────────────────────────────────────────────────
test("ZipArchive reads deflated and stored entries and rejects non-zip bytes", () => {
  const deflated = makeXlsx([["أ", "ب"]]);
  const stored = makeXlsx([["أ", "ب"]], { store: true });
  for (const bytes of [deflated, stored]) {
    const zip = new ZipArchive(bytes);
    assert.ok(zip.has("xl/workbook.xml"));
    assert.match(zip.readText("xl/workbook.xml"), /<sheets>/);
  }
  assert.throws(() => new ZipArchive(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23])));
});

// ─── XLSX ──────────────────────────────────────────────────────────────────
test("parseXlsx preserves Arabic exactly and keeps true row/column positions", () => {
  const rows = [
    ["المرحلة", "المحتوى", "المنصات", "العدد"],
    [AR, "فيديو تعريفي", "انستغرام، تيك توك", { n: 3 }],
    ["", { inline: AR2 }, "", ""],
  ];
  const wb = xlsx.parseXlsx(makeXlsx(rows), "plan.xlsx");
  assert.equal(wb.format, "xlsx");
  assert.equal(wb.sheets.length, 1);
  assert.equal(wb.sheets[0].name, "الخطة");
  const r = wb.sheets[0].rows;
  assert.equal(r[0].rowNumber, 1);
  assert.equal(r[1].cells[0], AR, "Arabic shared string was altered");
  assert.equal(r[1].cells[2], "انستغرام، تيك توك");
  assert.equal(r[1].cells[3], "3");
  assert.equal(r[2].cells[1], AR2, "inline Arabic string was altered");
  assert.equal(r[2].rowNumber, 3);
});

test("XLSX numeric cells become dates ONLY when the cell style says so", () => {
  const wb = xlsx.parseXlsx(makeXlsx([["تاريخ التسليم", "العدد"], [{ d: 44927 }, { n: 44927 }]]), "d.xlsx");
  const row = wb.sheets[0].rows[1];
  assert.equal(row.cells[0], "2023-01-01", "date-styled serial must convert");
  assert.equal(row.cells[1], "44927", "unstyled number must stay a number, never a guessed date");
});

test("a workbook that exceeds the byte budget degrades instead of dying", () => {
  const rows = [["المحتوى"], ["فيديو"], ["صورة"]];
  const bytes = makeXlsx(rows);
  // A budget that covers the shared strings but not the worksheet: the sheet is
  // skipped WITH a warning rather than half-read or crashed.
  const shortBudget = new (require("./import_engine_loader").loadTs("lib/portal/import/zip.ts").ZipArchive)(bytes).sizeOf("xl/sharedStrings.xml") + 10;
  const wb = xlsx.parseXlsx(bytes, "big.xlsx", shortBudget);
  assert.equal(wb.sheets[0].rows.length, 0, "the sheet is not read past the budget");
  assert.equal(wb.warnings.length, 1);
  assert.equal(wb.warnings[0].code, "truncated");
  assert.match(wb.warnings[0].message, /لم تُقرأ الورقة/);
  // a budget too small even for the string table is a clear, refused import
  assert.throws(() => xlsx.parseXlsx(bytes, "big.xlsx", 8), /أكبر من الحدّ الآمن/);
  // …and the same file inside the real budget reads normally
  assert.equal(xlsx.parseXlsx(bytes, "big.xlsx").sheets[0].rows.length, 3);
});

test("serialToIso anchors on the real Excel epochs", () => {
  assert.equal(xlsx.serialToIso(25569, false), "1970-01-01");
  assert.equal(xlsx.serialToIso(44927, false), "2023-01-01");
  assert.equal(xlsx.serialToIso(0, true), "1904-01-01");
  assert.equal(xlsx.serialToIso(-5, false), null);
});

test("colIndex handles single and double letter columns", () => {
  assert.equal(xlsx.colIndex("A1"), 0);
  assert.equal(xlsx.colIndex("Z9"), 25);
  assert.equal(xlsx.colIndex("AA1"), 26);
  assert.equal(xlsx.colIndex("AB12"), 27);
});

test("XML entities and Excel _xHHHH_ escapes decode without touching Arabic", () => {
  const { xmlText, decodeEntities } = loadTs("lib/portal/import/xml.ts");
  assert.equal(decodeEntities("&lt;a&gt; &amp; &quot;b&quot; &#1575;"), '<a> & "b" ا');
  assert.equal(xmlText("سطر_x000D__x000A_ثانٍ"), "سطر\r\nثانٍ");
  assert.equal(xmlText("_x005F_x0041_"), "_x0041_", "an escaped literal must not be decoded twice");
  assert.equal(xmlText(AR), AR);
});

// ─── CSV ───────────────────────────────────────────────────────────────────
test("parseCsv handles quotes, embedded commas/newlines and doubled quotes", () => {
  const csv = 'a,b,c\r\n"قيمة، بفاصلة","سطر\nثانٍ","قال ""مرحبًا"""\r\nx,y,z\r\n';
  const sheet = parseCsv(csv);
  assert.equal(sheet.rows.length, 3);
  assert.equal(sheet.rows[1].cells[0], "قيمة، بفاصلة");
  assert.equal(sheet.rows[1].cells[1], "سطر\nثانٍ");
  assert.equal(sheet.rows[1].cells[2], 'قال "مرحبًا"');
  assert.equal(sheet.rows[2].cells[0], "x");
});

test("CSV row numbers stay physical line numbers across multi-line fields", () => {
  const sheet = parseCsv('h1,h2\n"متعدد\nالأسطر",b\nc,d\n');
  assert.deepEqual(sheet.rows.map((r) => r.rowNumber), [1, 2, 4]);
});

test("delimiter detection: comma, semicolon, tab, pipe", () => {
  assert.equal(detectDelimiter("a,b,c\n1,2,3"), ",");
  assert.equal(detectDelimiter("a;b;c\n1;2;3"), ";");
  assert.equal(detectDelimiter("a\tb\tc\n1\t2\t3"), "\t");
  assert.equal(detectDelimiter("a|b|c\n1|2|3"), "|");
  assert.equal(detectDelimiter("المحتوى;المنصات\nفيديو;انستغرام"), ";", "ar/fr Excel exports use semicolons");
});

test("UTF-8 BOM is stripped so the first header still matches", () => {
  const bytes = new Uint8Array(Buffer.from("﻿المحتوى,المنصات\nفيديو,انستغرام\n", "utf8"));
  const wb = parseWorkbook(bytes, "x.csv");
  assert.equal(wb.sheets[0].rows[0].cells[0], "المحتوى");
});

test("parseWorkbook sniffs content, not the extension, and refuses binary junk", () => {
  const asXlsx = parseWorkbook(makeXlsx([["المحتوى"], ["فيديو"]]), "mislabelled.csv");
  assert.equal(asXlsx.format, "xlsx", "an .xlsx named .csv must still parse");
  assert.throws(() => parseWorkbook(new Uint8Array([0x00, 0x01, 0x02, 0x00, 0x05]), "junk.bin"), /صيغة الملف غير مدعومة|الملف فارغ/);
  assert.throws(() => parseWorkbook(new Uint8Array([]), "empty.csv"), /فارغ/);
  assert.throws(() => parseWorkbook("\n\n\n", "blank.csv"), /لا توجد بيانات/);
});

test("pickSheet reports every sheet it did not read", () => {
  const wb = parseWorkbook("a,b\n1,2\n", "x.csv");
  wb.sheets.push({ name: "ورقة 2", rows: [{ rowNumber: 1, cells: ["ب"] }] });
  const picked = pickSheet(wb, null);
  assert.equal(picked.sheet.name, "x.csv");
  assert.equal(picked.warnings.length, 1);
  assert.match(picked.warnings[0].message, /ورقة 2/);
});

// ─── Arabic text primitives ────────────────────────────────────────────────
test("cleanCell removes invisible marks but never touches real Arabic", () => {
  assert.equal(text.cleanCell("‏" + AR + "‎"), AR);
  assert.equal(text.cleanCell("  فيديو  "), "فيديو");
  assert.equal(text.cleanCell(null), "");
  assert.equal(text.cleanCell("مُشَكَّل"), "مُشَكَّل", "diacritics in stored values are preserved");
});

test("normalizeForMatch unifies letter shapes for MATCHING only", () => {
  assert.equal(text.normalizeForMatch("الأولى"), text.normalizeForMatch("الاولي"));
  assert.equal(text.normalizeForMatch("المُحتوى"), text.normalizeForMatch("المحتوى"));
  assert.equal(text.normalizeForMatch("Platforms"), "platforms");
  assert.notEqual(text.normalizeForMatch("مدرسة"), text.normalizeForMatch("مدرسه"), "ة and ه must stay distinct");
});

test("slugify keeps Arabic letters and drops punctuation", () => {
  assert.equal(text.slugify("المرحلة الأولى!"), "المرحلة-الاولي");
  assert.equal(text.slugify("Stage 1 — launch"), "stage-1-launch");
  assert.equal(text.slugify("!!!"), "");
});

test("splitMulti splits real separators and never on the conjunction و", () => {
  assert.deepEqual(text.splitMulti("انستغرام، تيك توك / يوتيوب"), ["انستغرام", "تيك توك", "يوتيوب"]);
  assert.deepEqual(text.splitMulti("انستغرام\nسناب شات"), ["انستغرام", "سناب شات"]);
  assert.deepEqual(text.splitMulti("واتساب"), ["واتساب"], "a word starting with و must survive");
  assert.deepEqual(text.splitMulti("انستغرام، انستغرام"), ["انستغرام"], "duplicates collapse");
  assert.deepEqual(text.splitMulti(""), []);
  // REAL-FILE CASE: the same sheet writes the same separator three ways. Only the
  // ASCII hyphen was split, so "إنستقرام – إكس" stayed ONE platform while
  // "المعرض + جميع المنصات" split into two — from one column of one file.
  assert.deepEqual(text.splitMulti("إنستقرام – إكس"), ["إنستقرام", "إكس"], "en dash must separate");
  assert.deepEqual(text.splitMulti("إنستقرام — إكس"), ["إنستقرام", "إكس"], "em dash must separate");
  assert.deepEqual(text.splitMulti("إنستقرام - إكس"), ["إنستقرام", "إكس"]);
  assert.deepEqual(text.splitMulti("إنستقرام – إكس – تيك توك"), ["إنستقرام", "إكس", "تيك توك"]);
  assert.deepEqual(text.splitMulti("المعرض + جميع المنصات"), ["المعرض", "جميع المنصات"]);
  // an UNSPACED dash is part of a real name and must never split
  assert.deepEqual(text.splitMulti("سناب-شات"), ["سناب-شات"], "an unspaced dash is part of the value");
  assert.deepEqual(text.splitMulti("جميع المنصات"), ["جميع المنصات"], "a legitimate single value stays single");
});

test("toAsciiDigits converts both Arabic digit families, for numbers only", () => {
  assert.equal(text.toAsciiDigits("١٥/٠٩/٢٠٢٦"), "15/09/2026");
  assert.equal(text.toAsciiDigits("۲۰۲۶"), "2026");
  assert.equal(text.toAsciiDigits("لا أرقام"), "لا أرقام");
});
