// ════════════════════════════════════════════════════════════════════════════
// tests/import_mapping_keys.test.js — profiles, column mapping and the
// DETERMINISTIC key machinery.
//
// The two failure modes this file exists to prevent:
//   1. a mapping profile that quietly stops being data (hard-coded columns), and
//   2. a key that changes between two runs of the same file — which is what
//      turns "re-import" into "duplicate everything".
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadTs } = require("./import_engine_loader");

const { DEFAULT_PROFILE, canonicalType, normalizeProfile, synonymIndex, ImportProfileError } = loadTs("lib/portal/import/profile.ts");
const { getProfile, listProfiles, registerProfile, resolveProfile } = loadTs("lib/portal/import/profiles.ts");
const { buildMapping, detectHeaderRow, parseDateStrict, parseIntStrict } = loadTs("lib/portal/import/mapping.ts");
const keys = loadTs("lib/portal/import/keys.ts");
const { parseCsv } = loadTs("lib/portal/import/csvParse.ts");

// The shipped profile is DATA: the engine has never heard of it until it is
// registered from its JSON file, exactly as the server does at runtime.
const SHIPPED_ID = registerProfile(loadTs("docs/import_profiles/misbar10.json")).id;
const MISBAR = getProfile(SHIPPED_ID);
const sheetOf = (csv) => parseCsv(csv);

// ─── profiles are DATA ─────────────────────────────────────────────────────
test("the shipped profile maps the exact Arabic headers required by the brief", () => {
  const idx = synonymIndex(MISBAR);
  const expected = {
    "المحتوى": "title",
    "نوع المحتوى": "content_type",
    "المنصات": "platforms",
    "تفاصيل التنفيذ": "execution_details",
    "نص الوصف المقترح": "proposed_caption",
  };
  const { headerKey } = loadTs("lib/portal/import/text.ts");
  for (const [header, field] of Object.entries(expected)) {
    // Lookup goes through headerKey() — the same normalisation the mapper uses,
    // which is what lets «المحتوى» and «المحتوي» resolve to the same field.
    assert.equal(idx.get(headerKey(header)), field, `«${header}» must map to ${field}`);
  }
});

test("profiles are registered as data and validated on load", () => {
  const ids = listProfiles().map((p) => p.id);
  assert.ok(ids.includes("generic"), "the built-in generic profile is always available");
  assert.ok(ids.includes(SHIPPED_ID), "a profile file registers itself under the id IT declares");
  assert.equal(listProfiles().find((p) => p.id === "generic").builtIn, true);
  assert.equal(listProfiles().find((p) => p.id === SHIPPED_ID).builtIn, false);
  assert.throws(() => getProfile("does-not-exist"), ImportProfileError);
  assert.throws(() => normalizeProfile({ id: "x1", fields: {} }), /title/);
  assert.throws(() => normalizeProfile({ id: "!!", fields: { title: { synonyms: ["a"] } } }), /المعرّف/);
  assert.throws(
    () => normalizeProfile({ id: "x1", fields: { title: { synonyms: ["a"] } }, levels: [{ key: "s", field: "ghost" }] }),
    /غير معرّف/,
  );
  // a caller-supplied profile object is accepted and normalised
  const custom = resolveProfile({ id: "adhoc", fields: { title: { synonyms: ["البند"] } } });
  assert.equal(custom.id, "adhoc");
  assert.equal(custom.keyStrategy, "identity");
  assert.equal(custom.defaultScheduleStatus, "awaiting_schedule");
});

test("content types collapse onto the live deliverables.type CHECK domain only", () => {
  const allowed = new Set(["video", "photo", "other"]);
  const samples = ["فيديو", "ريلز", "موشن جرافيك", "صورة", "تصوير فوتوغرافي", "تصميم", "مقال", "بودكاست", "", "شيء غريب تمامًا"];
  for (const s of samples) {
    const r = canonicalType(s, MISBAR);
    assert.ok(allowed.has(r.type), `«${s}» produced an illegal type ${r.type}`);
  }
  assert.equal(canonicalType("ريلز", MISBAR).type, "video");
  assert.equal(canonicalType("تصوير فوتوغرافي", MISBAR).type, "photo");
  assert.equal(canonicalType("تصميم", MISBAR).type, "other");
  assert.equal(canonicalType("بودكاست", MISBAR).matched, false, "an unknown type must be reported, not silently accepted");
});

// ─── header detection + mapping ────────────────────────────────────────────
test("the header row is found under decoration rows", () => {
  const sheet = sheetOf("خطة المحتوى — 2026,,,\n,,,\nالمرحلة,المحتوى,نوع المحتوى,المنصات\nالتمهيد,فيديو تعريفي,فيديو,انستغرام\n");
  const d = detectHeaderRow(sheet, MISBAR);
  assert.equal(d.rowIndex, 2);
  const m = buildMapping(sheet, MISBAR);
  assert.equal(m.headerRowNumber, 3);
  assert.equal(m.byField.get("title"), 1);
});

test("synonyms, fuzzy headers, unknown columns and duplicate columns are all reported", () => {
  const sheet = sheetOf("المرحله,العنوان,المنصات المستهدفة,ميزانية,المحتوى\nأ,ب,ج,د,هـ\n");
  const m = buildMapping(sheet, MISBAR);
  assert.equal(m.byField.get("stage"), 0, "المرحله (no ة) must still match المرحلة");
  assert.equal(m.byField.get("title"), 1);
  assert.equal(m.byField.get("platforms"), 2, "fuzzy header must resolve");
  assert.ok(m.unmapped.includes("ميزانية"), "unknown column must be reported");
  assert.deepEqual(m.duplicateColumns, [{ header: "المحتوى", field: "title" }], "second column claiming title is dropped");
  assert.equal(m.columns[4].field, null);
});

test("a sheet with no title column is detected (mapping has no title field)", () => {
  const m = buildMapping(sheetOf("المرحلة,المنصات\nأ,ب\n"), MISBAR);
  assert.equal(m.byField.has("title"), false);
});

// ─── dates: never invented ─────────────────────────────────────────────────
test("parseDateStrict accepts only unambiguous, real dates", () => {
  assert.equal(parseDateStrict("2026-09-20").iso, "2026-09-20");
  assert.equal(parseDateStrict("20/09/2026").iso, "2026-09-20");
  assert.equal(parseDateStrict("20-09-2026").iso, "2026-09-20");
  assert.equal(parseDateStrict("2026/09/20").iso, "2026-09-20");
  assert.equal(parseDateStrict("٢٠/٠٩/٢٠٢٦").iso, "2026-09-20", "Arabic-Indic digits");
  assert.equal(parseDateStrict("04/25/2026").iso, "2026-04-25", "US-locale export falls back to month-first");
  assert.equal(parseDateStrict("2026-09-20T10:30:00").iso, "2026-09-20");
});

test("parseDateStrict refuses to guess — no value ever becomes today", () => {
  const today = new Date().toISOString().slice(0, 10);
  for (const bad of ["", "قريبًا", "الأسبوع القادم", "31/02/2026", "2026-13-01", "45000", "3", "TBD", "—"]) {
    const r = parseDateStrict(bad);
    assert.equal(r.iso, null, `«${bad}» must not produce a date`);
    assert.notEqual(r.iso, today);
  }
  assert.equal(parseDateStrict("45000").reason, "ambiguous_number");
  assert.equal(parseDateStrict("قريبًا").reason, "unreadable");
  assert.equal(parseDateStrict("").reason, "empty");
});

test("parseIntStrict reads Arabic digits and reports garbage", () => {
  assert.deepEqual(parseIntStrict("٣"), { value: 3, ok: true });
  assert.deepEqual(parseIntStrict("1,200"), { value: 1200, ok: true });
  assert.deepEqual(parseIntStrict(""), { value: null, ok: true });
  assert.deepEqual(parseIntStrict("كثير"), { value: null, ok: false });
});

// ─── deterministic keys ────────────────────────────────────────────────────
const rowInput = (over = {}) => ({
  strategy: "identity",
  explicit: null,
  levelKeys: ["الاطلاق", "اليوم-الاول"],
  title: "ريلز الإطلاق",
  occurrence: 1,
  rowNumber: 7,
  ...over,
});

test("external keys are 4 segments, profile-scoped, and identical across runs", () => {
  const build = () => keys.externalKey({ profileId: "misbar10", projectKey: "حملة-2026", levelKeys: ["الاطلاق", "اليوم-الاول"], row: rowInput() });
  const a = build();
  const b = build();
  assert.equal(a.key, b.key, "same input must give the same key");
  assert.equal(a.key.split(":").length, 4);
  assert.ok(a.key.startsWith("misbar10:حملة-2026:"), `unexpected key ${a.key}`);
  assert.match(a.key, /:الاطلاق\/اليوم-الاول:/, "the level path is part of the key");
  assert.doesNotMatch(a.key, /[0-9a-f]{8}-[0-9a-f]{4}-/i, "keys must never contain a UUID");
});

test("the key survives a content edit but changes with identity", () => {
  const base = keys.externalKey({ profileId: "p", projectKey: "k", levelKeys: ["s1"], row: rowInput({ levelKeys: ["s1"] }) }).key;
  // same identity (stage + title + occurrence) ⇒ same key, whatever else changed
  assert.equal(keys.externalKey({ profileId: "p", projectKey: "k", levelKeys: ["s1"], row: rowInput({ levelKeys: ["s1"], rowNumber: 99 }) }).key, base);
  // a different stage, title, occurrence, project or profile ⇒ a different key
  assert.notEqual(keys.externalKey({ profileId: "p", projectKey: "k", levelKeys: ["s2"], row: rowInput({ levelKeys: ["s2"] }) }).key, base);
  assert.notEqual(keys.externalKey({ profileId: "p", projectKey: "k", levelKeys: ["s1"], row: rowInput({ levelKeys: ["s1"], title: "آخر" }) }).key, base);
  assert.notEqual(keys.externalKey({ profileId: "p", projectKey: "k", levelKeys: ["s1"], row: rowInput({ levelKeys: ["s1"], occurrence: 2 }) }).key, base);
  assert.notEqual(keys.externalKey({ profileId: "p", projectKey: "OTHER", levelKeys: ["s1"], row: rowInput({ levelKeys: ["s1"] }) }).key, base);
  assert.notEqual(keys.externalKey({ profileId: "other", projectKey: "k", levelKeys: ["s1"], row: rowInput({ levelKeys: ["s1"] }) }).key, base);
});

test("key strategies: explicit reference, row number, and the blank-reference fallback", () => {
  const ex = keys.rowKey(rowInput({ strategy: "external_key", explicit: "REF-014" }));
  assert.equal(ex.strategyUsed, "external_key");
  assert.equal(ex.key, "k-ref-014");
  const blank = keys.rowKey(rowInput({ strategy: "external_key", explicit: "  " }));
  assert.equal(blank.strategyUsed, "identity", "a blank reference must fall back deterministically, not randomly");
  assert.equal(blank.key, keys.rowKey(rowInput({ strategy: "external_key", explicit: "" })).key);
  assert.equal(keys.rowKey(rowInput({ strategy: "row" })).key, "r7");
});

test("level path and node keys are stable and root-safe", () => {
  assert.equal(keys.levelPathKey([null, null]), "root");
  assert.equal(keys.levelPathKey(["a", null]), "a");
  assert.equal(keys.levelPathKey(["a", "b"]), "a/b");
  assert.equal(keys.nodeKey("p", "k", ["a"]), "p:k:a:#node");
  assert.equal(keys.parentProjectKey("p", "k"), "p:k:root:#project");
});

test("long titles keep distinct keys (truncation adds a hash of the full text)", () => {
  const a = "مرحلة إنتاج المحتوى المرئي للحملة الوطنية الكبرى في الربع الأول - الجزء أ";
  const b = "مرحلة إنتاج المحتوى المرئي للحملة الوطنية الكبرى في الربع الأول - الجزء ب";
  assert.notEqual(keys.stableSlug(a), keys.stableSlug(b), "two long titles sharing a prefix must not collapse");
  assert.equal(keys.stableSlug(a), keys.stableSlug(a));
  assert.ok(keys.stableSlug(a).includes("~"), "a truncated slug carries its hash suffix");
});

test("canonicalJson is order-independent so hashes are stable", () => {
  assert.equal(keys.canonicalJson({ b: 1, a: [2, { d: 4, c: 3 }] }), keys.canonicalJson({ a: [2, { c: 3, d: 4 }], b: 1 }));
  assert.equal(keys.canonicalJson({ a: undefined }), '{"a":null}');
});

test("contentHash reacts to content, not to row position", () => {
  const row = {
    source_row_number: 5,
    level_path: ["الإطلاق", null],
    level_keys: ["الاطلاق", null],
    title: "ريلز",
    type: "video",
    content_type_raw: "ريلز",
    platforms: ["انستغرام"],
    execution_details: "مونتاج",
    proposed_caption: null,
    notes: null,
    assignee_hint: null,
    priority: null,
    quantity: 1,
    due_date: null,
    schedule_status: "awaiting_schedule",
    status: "draft",
    extra: {},
  };
  const base = keys.contentHash(row);
  assert.equal(keys.contentHash({ ...row, source_row_number: 99 }), base, "moving a row must not look like an edit");
  assert.notEqual(keys.contentHash({ ...row, proposed_caption: "نص جديد" }), base);
  assert.notEqual(keys.contentHash({ ...row, platforms: ["انستغرام", "تيك توك"] }), base);
  assert.notEqual(keys.contentHash({ ...row, due_date: "2026-09-20" }), base);
});
