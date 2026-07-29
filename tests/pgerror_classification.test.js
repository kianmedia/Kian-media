// ════════════════════════════════════════════════════════════════════════════
// tests/pgerror_classification.test.js — بندا القبول ١١ و١٢ من إصلاح حادثة
// «الترحيل معلّق» الكاذبة، مُختبَران على **أجسام أخطاء PostgREST الحقيقية**.
//
//   (١١) خطأ صلاحية (42501) لا يُبلَّغ أبدًا كعمود مفقود.
//   (١٢) عمود مفقود (42703) يُصنَّف بدقّة **مع إظهار اسم العمود**.
//
// يكمّل tests/pg_error_classification.test.js (الذي يغطّي السِّلال التسع كلّها):
// هنا نختبر النصوص كما يرسلها Supabase حرفيًّا، ونثبت أن **ترتيب** الفروع صامد
// حتى حين تحمل رسالة الصلاحية كلمة column، وأن الرسالة العربية لا تكذب.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ROOT, TS_AVAILABLE, loadTs } = require("./import_engine_loader.js");

const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const skip = { skip: TS_AVAILABLE ? false : "sucrase unavailable" };
const pg = TS_AVAILABLE ? loadTs("lib/portal/pgerror.ts") : null;
const lp = TS_AVAILABLE ? loadTs("lib/portal/large-projects.ts") : null;

/** أجسام أخطاء حقيقية كما يعيدها PostgREST (message هو ما يصل إلى الواجهة). */
const REAL = {
  // 42501 — RLS / صلاحية. هذه هي الصيغ الثلاث الشائعة فعليًّا.
  perm_rls: 'new row violates row-level security policy for table "projects"',
  perm_table: "permission denied for table projects",
  perm_col: 'permission denied for column "due_date" of relation "projects"',
  perm_fn: "permission denied for function large_project_deliverables_bulk_update",
  // 42703 — العمود المطلوب غير موجود (نصّ الحادثة حرفيًّا).
  col_incident: "column projects.due_date does not exist",
  col_quoted: 'column "due_date" of relation "projects" does not exist',
  col_pgrst204: "Could not find the 'due_date' column of 'projects' in the schema cache",
};

// ════════════════════════════════════════════════════════════════════════════
// (١١) خطأ الصلاحية ليس عمودًا مفقودًا — أبدًا
// ════════════════════════════════════════════════════════════════════════════
test("11. خطأ صلاحية (42501) لا يُصنَّف عمودًا مفقودًا ولا ترحيلة معلّقة", skip, () => {
  const cases = [
    [REAL.perm_rls, 403],
    [REAL.perm_table, 403],
    [`${REAL.perm_table} (42501)`, 400],
    [REAL.perm_fn, 403],
    ["42501: insufficient_privilege", 400],
    ["not authorized", 403],
  ];
  for (const [msg, st] of cases) {
    const d = pg.pgClassify(msg, st);
    assert.equal(d.kind, "permission_denied", `تصنيف خاطئ لـ«${msg}» ⇒ ${d.kind}`);
    assert.equal(d.verdict, "permission");
    assert.notEqual(d.kind, "missing_column");
    assert.equal(pg.pgIsMigrationPending(d), false, "خطأ صلاحية عُرض كترحيلة معلّقة");
    // والرسالة العربية تقول «صلاحية»، ولا تذكر عمودًا ولا ترحيلة.
    const ar = pg.pgUserMessageAr(d);
    assert.match(ar, /صلاحية/);
    assert.equal(/عمودًا غير موجود|الترحيلة غير مطبّقة/.test(ar), false, `رسالة كاذبة: ${ar}`);
    // والطبقة القديمة (lpClassify) توافق: forbidden لا missing_column.
    assert.equal(lp.lpClassify(msg, st), "forbidden");
    assert.equal(lp.lpIsMigrationPending(lp.lpClassify(msg, st)), false);
  }
});

test("11ب. حتى حين تذكر رسالةُ الصلاحية عمودًا صراحةً، تبقى صلاحية", skip, () => {
  // هذه هي الحالة الخبيثة: النصّ يحوي column و«does not» قد تسبقه أو تليه.
  const d = pg.pgClassify(REAL.perm_col, 403);
  assert.equal(d.kind, "permission_denied", "★ رسالة صلاحية تحمل كلمة column انقلبت إلى عمود مفقود");
  assert.equal(pg.pgIsMigrationPending(d), false);
  assert.match(pg.pgUserMessageAr(d), /صلاحية/);

  // وترتيب الفروع مثبَّت في المصدر: المصادقة ثم الصلاحية **قبل** أيّ سؤال مخطّط.
  const SRC = read("lib/portal/pgerror.ts");
  const iAuth = SRC.indexOf('return build("not_authenticated"');
  const iPerm = SRC.indexOf('return build("permission_denied"');
  const iCol = SRC.indexOf('return build("missing_column"');
  const iTbl = SRC.indexOf('return build("missing_table"');
  assert.ok(iAuth > 0 && iPerm > 0 && iCol > 0 && iTbl > 0, "فروع التصنيف غير موجودة");
  assert.ok(iAuth < iPerm, "المصادقة يجب أن تُحسم قبل الصلاحية");
  assert.ok(iPerm < iCol, "★ فرع الصلاحية انتقل بعد فرع العمود — 42501 سيظهر كعمود مفقود");
  assert.ok(iPerm < iTbl, "★ فرع الصلاحية انتقل بعد فرع الجدول");
});

test("11ج. انتهاء الجلسة (401) ليس صلاحيةً ولا عمودًا", skip, () => {
  for (const [m, s] of [["not_authenticated", 401], ["JWT expired", 401], ["session_expired", 401]]) {
    const d = pg.pgClassify(m, s);
    assert.equal(d.kind, "not_authenticated");
    assert.equal(pg.pgIsMigrationPending(d), false);
    assert.match(pg.pgUserMessageAr(d), /الجلسة/);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// (١٢) العمود المفقود يُصنَّف بدقّة — واسمه يظهر
// ════════════════════════════════════════════════════════════════════════════
test("12. عمود مفقود (42703) يُصنَّف بدقّة مع إظهار اسم العمود", skip, () => {
  const d = pg.pgClassify(REAL.col_incident, 400);
  assert.equal(d.kind, "missing_column");
  assert.equal(d.code, "42703");
  assert.equal(d.column, "projects.due_date", "★ اسم العمود لم يظهر — بلا اسم لا يمكن إصلاح الاستعلام");
  // الحكم: خطؤنا نحن، لا نقص في القاعدة. هذا بيت القصيد في الحادثة.
  assert.equal(d.verdict, "our_request");
  assert.equal(pg.pgIsOurFault(d), true);
  assert.equal(pg.pgIsMigrationPending(d), false, "★ 42703 عاد يُقرأ ترحيلةً معلّقة");

  // الرسالة العربية تسمّي العمود ولا تتّهم الترحيلة.
  const ar = pg.pgUserMessageAr(d);
  assert.match(ar, /due_date/);
  assert.equal(/الترحيلة غير مطبّقة/.test(ar), false, `★ رسالة الحادثة عادت: ${ar}`);
  // والسطر التشخيصيّ للمطوّر يحمل الرمز واسم العمود.
  const line = pg.pgDevLine(d, { component: "LargeProjectDashboard", table: "projects", purpose: "load snapshot" });
  assert.match(line, /code=42703/);
  assert.match(line, /column=projects\.due_date/);
  assert.match(line, /table:projects/);
});

test("12ب. الصيغة المقتبَسة والصيغة الرقمية تُعطيان الاسم نفسه", skip, () => {
  const a = pg.pgClassify(REAL.col_quoted, 400);
  assert.equal(a.kind, "missing_column");
  assert.equal(a.column, "due_date");
  assert.equal(a.relation, "projects");

  const b = pg.pgClassify("42703", 400);
  assert.equal(b.kind, "missing_column");
  assert.equal(b.column, null, "لا يجوز اختلاق اسم عمود حين لا تذكره الرسالة");

  // PGRST204 صنف آخر: الكائن موجود والذاكرة قديمة ⇒ «أعِد تحميل المخطّط».
  const c = pg.pgClassify(REAL.col_pgrst204, 400);
  assert.equal(c.kind, "schema_cache_stale");
  assert.equal(c.column, "due_date", "اسم العمود مطلوب هنا أيضًا");
  assert.equal(pg.pgIsMigrationPending(c), false);
  assert.match(pg.pgUserMessageAr(c), /مخطط|المخطط|Reload|مخطّط/);
});

test("12ج. الجدول المفقود (42P01) لا يُخلط بالعمود المفقود", skip, () => {
  const d = pg.pgClassify('relation "public.deliverable_internal" does not exist', 404);
  assert.equal(d.kind, "missing_table");
  assert.equal(pg.pgIsMigrationPending(d), true, "جدول غائب فعلًا = الحالة المشروعة الوحيدة للترحيلة");
  assert.notEqual(d.kind, "missing_column");
});

// ════════════════════════════════════════════════════════════════════════════
// حارس التسريب: لا رمز جلسة ولا مفتاح ولا عنوان في أيّ سطر سجلّ
// ════════════════════════════════════════════════════════════════════════════
test("لا يُسجَّل رمز ولا جلسة ولا مفتاح ولا عنوان", skip, () => {
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.QWxsWW91ckJhc2VBcmVCZWxvbmc";
  const dirty = `permission denied; apikey=sk_live_ABCDEF123456 authorization=Bearer ${jwt} `
    + `at https://xyz.supabase.co/rest/v1/projects?id=eq.9f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f `
    + `user kianmedia01@gmail.com phone 966512345678`;
  const line = pg.pgDevLine(pg.pgClassify(dirty, 403), { component: "X", table: "projects", purpose: "p" });
  for (const secret of [jwt, "sk_live_ABCDEF123456", "kianmedia01@gmail.com", "966512345678",
    "9f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f", "https://xyz.supabase.co"]) {
    assert.equal(line.includes(secret), false, `★ تسرّب إلى السجلّ: ${secret}`);
  }
  assert.match(line, /<jwt>|<redacted>/);
  // والهدف يبقى اسم الجدول وحده — لا مرشّحات ولا معرّفات.
  assert.equal(pg.pgSafeTarget("projects?id=eq.9f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f"), "projects");
  assert.equal(pg.pgSafeTarget("/rest/v1/project_core?select=due_date"), "project_core");
});
