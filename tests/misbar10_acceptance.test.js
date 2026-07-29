// ════════════════════════════════════════════════════════════════════════════
// tests/misbar10_acceptance.test.js — حراس مجموعة القبول الاصطناعية.
//
// This suite runs over tests/fixtures/misbar10_structure.json, which is a
// SYNTHETIC dataset. The owner's real workbook is NOT in this repository, so
// the eleven stage names are real (owner-supplied) while every deliverable is
// invented. The suite therefore asserts:
//   · the fixture's ACTUAL counts (self-consistency), and
//   · the owner's 11/79 EXPECTATION separately, recorded as UNVERIFIED.
// It must never assert 79 as a platform requirement — no platform code may
// hardcode a deliverable count, and no platform code may mention this project
// by name.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const FIXTURE_PATH = path.join(ROOT, "tests/fixtures/misbar10_structure.json");
const AUDIT_PATH = path.join(ROOT, "docs/MISBAR10_PLATFORM_GAP_AUDIT.md");
const F = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));

const ARABIC = /[؀-ۿ]/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
// The real CHECK on public.deliverables.type (docs/phase0_migration.sql:219).
const DB_TYPES = new Set(["video", "photo", "other"]);
// The statuses RLS exposes to a client (docs/phase0_migration.sql:886-891).
const CLIENT_VISIBLE_STATUSES = new Set(["client_review", "revision_requested", "approved", "final_delivered"]);

// The eleven operational stage names exactly as the owner supplied them.
const OWNER_STAGE_TITLES = [
  "01 التهيئة",
  "02 ما قبل التسجيل وأثناء التسجيل",
  "03 القبول",
  "04 الانطلاق عن بُعد",
  "05 ختام المرحلة الأولى وإعلان المتأهلين",
  "06 الاستكشاف عن بُعد",
  "07 المؤتمر الصحفي",
  "08 التهيئة الحضورية",
  "09 المرحلة الحضورية",
  "10 فيديوهات المسارات التخصصية",
  "11 الحفل الختامي",
];

// ─── 0) The fixture must be unmistakably synthetic ───────────────────────────
test("الملف موسوم كبيانات اصطناعية بلا لبس", () => {
  assert.equal(F.synthetic, true, "العلم synthetic غير مضبوط في الجذر");
  assert.match(F._WARNING_EN, /SYNTHETIC/i, "لا تحذير إنجليزي في الترويسة");
  assert.match(F._WARNING_EN, /NOT OWNER DATA/i, "التحذير لا ينفي ملكية البيانات");
  assert.match(F._WARNING_AR, /اصطناعية/, "لا تحذير عربي في الترويسة");
  for (const d of F.deliverables) assert.equal(d.synthetic, true, `المخرَج ${d.external_key} غير موسوم`);
  for (const s of F.stages) assert.equal(s.synthetic, true, `المرحلة ${s.stage_key} غير موسومة`);
  assert.equal(F.parent_project.synthetic, true, "المشروع الأب غير موسوم");
});

test("توقّع المالك (11/79) مسجَّل كتوقّع غير مُتحقَّق منه، لا كحقيقة", () => {
  assert.equal(F.owner_expectation.stages, 11);
  assert.equal(F.owner_expectation.deliverables, 79);
  assert.equal(F.owner_expectation.verified_against_real_file, false,
    "لا يجوز الادّعاء بأنّ 79 تحقّق مقابل الملف الحقيقي — الملف غير موجود في المستودع");
  assert.match(F.owner_expectation.source, /NOT present in this repository/i);
  // The synthetic count is deliberately different so the two can never be conflated.
  assert.notEqual(F.deliverables.length, F.owner_expectation.deliverables,
    "عدد الملف الاصطناعي يساوي 79 — يصبح مُضلِّلًا ويُخلط ببيانات المالك");
});

// ─── 1) Stages ───────────────────────────────────────────────────────────────
test("إحدى عشرة مرحلة بالضبط، بالأسماء العربية كما سلّمها المالك", () => {
  assert.equal(F.stages.length, 11, "عدد المراحل ليس 11");
  assert.deepEqual(F.stages.map((s) => s.title_ar), OWNER_STAGE_TITLES, "أسماء المراحل تغيّرت أو تشوّهت");
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

// ─── 2) Deliverables ↔ stages ────────────────────────────────────────────────
test("عدد المخرجات = العدد الفعليّ للملف (اتّساق ذاتي، لا رقم مُثبَّت)", () => {
  const actual = F.deliverables.length;
  assert.ok(actual > 0, "الملف بلا مخرجات");
  assert.equal(F.parent_project.expected_rollup.deliverables_total, actual,
    "التجميع المعلن لا يطابق العدد الفعليّ");
  const perStage = F.stages.reduce((a, s) => a + s.expected.deliverables_count, 0);
  assert.equal(perStage, actual, "مجموع عدّادات المراحل لا يساوي عدد المخرجات");
});

test("كل مخرَج مرتبط بمرحلة موجودة — لا يتامى", () => {
  const keys = new Set(F.stages.map((s) => s.stage_key));
  for (const d of F.deliverables) {
    assert.ok(d.stage_key, `${d.external_key}: بلا stage_key`);
    assert.ok(keys.has(d.stage_key), `${d.external_key}: مرحلة غير موجودة ${d.stage_key}`);
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

// ─── 3) Arabic preservation ──────────────────────────────────────────────────
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
  // The bytes on disk must be UTF-8 round-trippable, not escaped ASCII.
  const raw = fs.readFileSync(FIXTURE_PATH, "utf8");
  assert.ok(raw.includes("التهيئة"), "العربية مهرَّبة إلى \\u في الملف بدل حفظها كما هي");
});

// ─── 4) Platforms ────────────────────────────────────────────────────────────
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

// ─── 5) Dates: nothing fabricated ────────────────────────────────────────────
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
  // The parent itself carries no invented date either.
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
  // Guard against a vacuous helper: dated items MUST flip to overdue at that date.
  const dated = F.deliverables.filter((d) => d.schedule_status === "scheduled");
  assert.ok(dated.some((d) => isOverdue(d, FAR_FUTURE) === true),
    "دالّة التأخّر لا ترصد أيّ تأخّر — الاختبار أعلاه سيمرّ فارغًا");
  // And nothing is overdue before the earliest date in the fixture.
  const earliest = dated.map((d) => d.due_date).sort()[0];
  const dayBefore = new Date(new Date(`${earliest}T00:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10);
  for (const d of F.deliverables) assert.equal(isOverdue(d, dayBefore), false, `${d.external_key}: تأخّر قبل أوّل موعد`);
});

// ─── 6) Recurrence + quantity ────────────────────────────────────────────────
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

// ─── 7) Types & client visibility ────────────────────────────────────────────
test("كل نوع اصطناعي ينهار إلى نوع تقبله قاعدة البيانات (video/photo/other)", () => {
  const map = F.platform_contract.kind_to_db_type;
  for (const d of F.deliverables) {
    assert.ok(map[d.kind], `${d.external_key}: النوع «${d.kind}» بلا خريطة إلى عمود type`);
    assert.equal(d.db_type, map[d.kind], `${d.external_key}: db_type لا يطابق الخريطة`);
    assert.ok(DB_TYPES.has(d.db_type), `${d.external_key}: db_type «${d.db_type}» يخالف قيد CHECK`);
  }
  // Every shape the brief asked for must actually appear.
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
  // Columns that DO exist on public.deliverables must not be listed as missing.
  for (const real of ["title", "type", "status", "due_date", "assignee_id"]) {
    assert.ok(!declared.has(real), `«${real}» عمود حقيقي لكنه معلَن كغير موجود`);
  }
  for (const f of ["platforms", "recurrence", "client_visible", "expected_units", "kind"]) {
    assert.ok(declared.has(f), `«${f}» غير معلَن كحقل استيراد خارج قاعدة البيانات`);
  }
});

// ─── 8) Parent roll-up + empty stage ─────────────────────────────────────────
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
  // Non-empty stages must expose a real number, never null.
  const withD = F.stages.filter((s) => s.expected.deliverables_count > 0);
  for (const s of withD) {
    assert.equal(typeof s.expected.progress_pct, "number", `${s.stage_key}: تقدّم غير رقمي`);
    assert.ok(!Number.isNaN(s.expected.progress_pct));
    const mine = F.deliverables.filter((d) => d.stage_key === s.stage_key);
    assert.equal(s.expected.progress_pct, Math.round(mine.reduce((a, d) => a + d.progress_pct, 0) / mine.length),
      `${s.stage_key}: تقدّم المرحلة غير مطابق لمخرجاتها`);
    assert.equal(s.expected.client_visible + s.expected.client_hidden, s.expected.deliverables_count);
  }
  // The stage-mean rollup divides by the NON-empty stages only.
  assert.equal(
    F.parent_project.expected_rollup.progress_pct_stage_mean,
    Math.round(withD.reduce((a, s) => a + s.expected.progress_pct, 0) / withD.length),
    "متوسّط المراحل لم يستبعد المرحلة الفارغة");
});

test("المشروع الأب رئيسيّ ومربوط بعميل، ومستوى واحد فقط تحته", () => {
  assert.equal(F.parent_project.project_scope, "master");
  assert.ok(F.parent_project.client_external_key, "الأب بلا عميل");
  // The platform allows exactly two levels (parent_must_be_master + only
  // standalone can be promoted) — the fixture must not imply a third.
  for (const s of F.stages) assert.ok(!("parent_stage_key" in s), `${s.stage_key}: يلمّح لمستوى ثالث`);
});

// ─── 9) Architecture guards ──────────────────────────────────────────────────
test("لا ذكر لهذا المشروع بالاسم داخل كود المنصّة", () => {
  const roots = ["lib", "components", "app"];
  const hits = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== ".next") walk(p); continue; }
      if (!/\.(ts|tsx|js|jsx)$/.test(e.name)) continue;
      if (/misbar/i.test(fs.readFileSync(p, "utf8"))) hits.push(path.relative(ROOT, p));
    }
  };
  for (const r of roots) { const d = path.join(ROOT, r); if (fs.existsSync(d)) walk(d); }
  assert.deepEqual(hits, [], `اسم المشروع تسرّب إلى كود المنصّة: ${hits.join(", ")}`);
});

test("لا عدد مخرجات مُثبَّت (79) في الملف نفسه خارج خانة توقّع المالك", () => {
  const clone = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));
  delete clone.owner_expectation;
  const rest = JSON.stringify(clone);
  assert.doesNotMatch(rest, /"deliverables_total"\s*:\s*79/, "79 مُثبَّت كعدد فعليّ");
  assert.equal(F.deliverables.length, F.parent_project.expected_rollup.deliverables_total);
});

test("تقرير الفجوات موجود ويحمل حكمًا صريحًا لكل مسار من المسارات الـ23", () => {
  assert.ok(fs.existsSync(AUDIT_PATH), "docs/MISBAR10_PLATFORM_GAP_AUDIT.md غير موجود");
  const md = fs.readFileSync(AUDIT_PATH, "utf8");
  const verdicts = md.match(/\|\s*(READY|BLOCKER|PARTIAL)\s*\|/g) || [];
  assert.ok(verdicts.length >= 23, `عدد الأحكام ${verdicts.length} < 23 — التدقيق ناقص`);
  assert.match(md, /SYNTHETIC|اصطناعي/i, "التقرير لا يوضّح أنّ مجموعة القبول اصطناعية");
});
