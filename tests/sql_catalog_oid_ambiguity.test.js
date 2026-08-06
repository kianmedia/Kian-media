// ════════════════════════════════════════════════════════════════════════════
// tests/sql_catalog_oid_ambiguity.test.js
//
// يمنع رجوع خطأ وقت التشغيل:
//     ERROR: column reference "oid" is ambiguous
//
// ★ لماذا يقع ★ `pg_class` و`pg_constraint` و`pg_proc` و`pg_namespace` … كلّها
//   تملك عمودًا اسمه `oid`. فحالما يُضمّ اثنان منها في **نفس نطاق `from`**،
//   يصير `oid` المجرَّد ملتبسًا ويفشل الاستعلام كلّه.
//
// 🔴 والفحص يجب أن يكون **بالنطاق** لا بالبحث النصّيّ: `oid` المجرَّد في
//   استعلام بجدول واحد **صحيح تمامًا**، وهو الشكل الغالب في هذا المستودع
//   (`select … from pg_constraint where conname = …`). فقاعدة نصّية عمياء
//   تُعطي عشرات الإنذارات الكاذبة ثمّ تُطفأ — وحارسٌ مُطفأ ليس حارسًا.
//
// ⚠️ وقوسا استدعاء الدالّة **ليسا نطاقًا**: `pg_get_constraintdef(oid)` يقرأ
//   `oid` من `from` الخارجيّ — وهذا بالضبط موضع العطب المرصود.
//
// ⛔ لا قاعدة ولا شبكة: تحليل نصّيّ ساكن.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { unqualifiedCatalogCols, scanFiles, stripComments } = require("./sql_catalog_scope.js");

const ROOT = path.resolve(__dirname, "..");
const DOCS = path.join(ROOT, "docs");
const sqlFiles = fs.readdirSync(DOCS).filter((f) => f.endsWith(".sql")).map((f) => path.join(DOCS, f));

// ─── ١ · المستودع كلّه نظيف ────────────────────────────────────────────────
test("🔴 لا `oid` مجرَّد في استعلام يضمّ أكثر من جدول كتالوج", () => {
  const hits = scanFiles(sqlFiles);
  assert.deepEqual(hits, [],
    "مواضع ملتبسة:\n" + hits.map((h) => `  ${h.file} [${h.tables.join("+")}]\n    ${h.snippet}`).join("\n"));
});

// ─── ٢ · الملفّ المُصلَح تحديدًا ────────────────────────────────────────────
const CSG_PRE = "wave6_case_study_generator_PREFLIGHT.sql";

test("🔴 wave6_case_study_generator_PREFLIGHT: كل oid مؤهَّل", () => {
  const raw = fs.readFileSync(path.join(DOCS, CSG_PRE), "utf8");
  // ⚠️ على الكود لا على الشرح: الملفّ يذكر الصيغة المعطوبة **في تعليق** يشرح
  //    ما وقع على Preview، ومحاكمةُ الشرح كأنّه كود تُحوّل التوثيق إلى عطب.
  const t = stripComments(raw);
  assert.deepEqual(unqualifiedCatalogCols(raw), []);
  assert.match(t, /pg_get_constraintdef\(con\.oid\)/, "الاستدعاء غير مؤهَّل بـcon");
  assert.ok(!/pg_get_constraintdef\(\s*oid\s*\)/.test(t), "بقي `pg_get_constraintdef(oid)` في الكود");
  assert.match(t, /con\.conname as name/, "conname غير مؤهَّل");
});

test("العقد الوظيفيّ للحزمة لم يتغيّر", () => {
  const t = stripComments(fs.readFileSync(path.join(DOCS, CSG_PRE), "utf8"));
  // ⚠️ إصلاحُ فحصِ كتالوج، ⛔ لا تعديلَ عقدٍ: الأقسام الخمسة كما هي.
  for (const kind of ["TABLE", "WORKFLOW_FN", "STATUS_VOCAB", "COLUMN", "PARALLEL_CHECK"]) {
    assert.match(t, new RegExp(`'${kind}' as kind`), `القسم ${kind} اختفى`);
  }
  assert.match(t, /r\.relname='cs_case_studies'/, "شرط الجدول تغيّر");
  assert.match(t, /like '%draft%'/, "شرط المفردات تغيّر");
});

// 🔴 و`to_regproc` هنا صحيحة: أسماء مجرَّدة بلا توقيع. وتحويلها إلى
//    `to_regprocedure` يقلب الفحص السليم إلى بلاغ «مفقود» كاذب — وهو الخطأ
//    المعاكس تمامًا لما أُصلح في Wave 4/6.
test("⚠️ to_regproc تبقى للأسماء المجرَّدة — ⛔ ولا تُحوَّل", () => {
  const t = stripComments(fs.readFileSync(path.join(DOCS, CSG_PRE), "utf8"));
  assert.match(t, /to_regproc\('public\.'\|\|v\.n\)/, "الفحص لم يعد يستعمل to_regproc للاسم المجرَّد");
  assert.ok(!/to_regproc\(\s*'[a-z0-9_.]+\([^']*\)'/i.test(t), "to_regproc بتوقيع — تُعيد NULL دائمًا");
});

// ─── ٣ · الكاشف نفسه — وإلّا فهو يمرّ على كل شيء ───────────────────────────
// 🔴 كاشفٌ لا تُثبته حالاتٌ موجبة **وسالبة** قد يكون دالّةً تُعيد [] دائمًا.
test("🔴 الكاشف يرصد الالتباس الحقيقيّ", () => {
  const broken = `select conname, pg_get_constraintdef(oid) as def
                    from pg_constraint con join pg_class r on r.oid = con.conrelid
                   where r.relname = 'x';`;
  const hits = unqualifiedCatalogCols(broken);
  assert.equal(hits.length, 1, "الالتباس الصريح لم يُرصد");
  assert.equal(hits[0].col, "oid");
  assert.deepEqual(hits[0].tables.sort(), ["pg_class", "pg_constraint"]);
});

test("⛔ ولا يرصد `oid` المجرَّد في استعلام بجدول واحد", () => {
  assert.deepEqual(unqualifiedCatalogCols(
    "select pg_get_constraintdef(oid) from pg_constraint where conname = 'x';"), [],
    "إنذار كاذب: جدول واحد ⇒ لا التباس");
  assert.deepEqual(unqualifiedCatalogCols(
    "select relrowsecurity from pg_class where oid = 'public.t'::regclass;"), []);
});

test("⛔ ولا يرصد استعلامًا فرعيًّا مستقلًّا داخل جملة متعدّدة الجداول", () => {
  // كل قوسٍ يبدأ بـselect نطاقٌ بجداوله الخاصّة.
  const ok = `select (select relrowsecurity from pg_class where oid = 'public.t'::regclass) as a,
                     (select count(*) from pg_policies where tablename = 't') as b;`;
  assert.deepEqual(unqualifiedCatalogCols(ok), []);
  const ok2 = `select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname='public'
                  and not exists (select 1 from pg_constraint
                                   where conrelid = 'public.t'::regclass
                                     and pg_get_constraintdef(oid) ilike '%x%');`;
  assert.deepEqual(unqualifiedCatalogCols(ok2), [], "الاستعلام الفرعيّ ذو الجدول الواحد أُنذر خطأً");
});

test("⛔ ولا يرصد `::oid` ولا `x.oid` ولا `oidvectortypes`", () => {
  const ok = `select pg_catalog.oidvectortypes(p.proargtypes), n.oid, to_regclass('public.t')::oid
                from pg_proc p join pg_namespace n on n.oid = p.pronamespace;`;
  assert.deepEqual(unqualifiedCatalogCols(ok), []);
});

test("🔴 ويرصد الالتباس في كل طرف من UNION على حدة", () => {
  const mixed = `select 1 from pg_class where oid = 'public.t'::regclass
                 union all
                 select pg_get_constraintdef(oid) from pg_constraint c join pg_class r on r.oid=c.conrelid;`;
  assert.equal(unqualifiedCatalogCols(mixed).length, 1,
    "الطرف السليم أُنذر، أو الطرف المعطوب أُهمل");
});

// ════════════════════════════════════════════════════════════════════════════
// ٤ · طفرات — يُعاد العطب في **نسخة** ويُشترط أن يسقط الحارس
// ⚠️ ولا يُلمَس `docs/`: النسخ في `fs.mkdtempSync`.
// ════════════════════════════════════════════════════════════════════════════
const os = require("node:os");

/** ينسخ ملفّات SQL إلى مجلَّد مؤقّت، يطبّق التشويه، يمسح، ثمّ ينظّف. */
function mutateSql(file, apply) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sql-oid-mut-"));
  try {
    const dst = path.join(dir, file);
    const src = fs.readFileSync(path.join(DOCS, file), "utf8");
    const out = apply(src);
    assert.notEqual(out, src, `التشويه لم يُطبَّق على ${file} — النمط لم يُطابِق`);
    fs.writeFileSync(dst, out);
    return scanFiles([dst]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("طفرة: إعادة `pg_get_constraintdef(oid)` غير المؤهَّل", () => {
  const hits = mutateSql(CSG_PRE, (s) => s.replace("pg_get_constraintdef(con.oid) as status",
                                                   "pg_get_constraintdef(oid) as status"));
  assert.equal(hits.length, 1, "🔴 العطب الأصليّ عاد ولم يُرصد — الحارس بلا قيمة");
  assert.equal(hits[0].col, "oid");
  assert.deepEqual(hits[0].tables.sort(), ["pg_class", "pg_constraint"]);
});

test("طفرة: تجريد `oid` في شرط where أيضًا", () => {
  const hits = mutateSql(CSG_PRE, (s) => s.replace("and pg_get_constraintdef(con.oid) like '%draft%'",
                                                   "and pg_get_constraintdef(oid) like '%draft%'"));
  assert.ok(hits.length >= 1, "الالتباس في `where` لا يُرصد");
});

test("طفرة: `oid` مجرَّد في شرط الضمّ نفسه", () => {
  const hits = mutateSql(CSG_PRE, (s) => s.replace("join pg_class r on r.oid=con.conrelid",
                                                   "join pg_class r on oid=con.conrelid"));
  assert.ok(hits.some((h) => h.col === "oid"), "الالتباس داخل ON لا يُرصد");
});

// 🔴 وضدّ التعطيل: كاشفٌ عُطِّل ليمرّ كل شيء يجب أن يسقط هنا.
test("🔴 الكاشف ليس دالّةً تُعيد [] دائمًا", () => {
  const hits = unqualifiedCatalogCols(
    "select pg_get_constraintdef(oid) from pg_constraint c join pg_class r on r.oid=c.conrelid;");
  assert.equal(hits.length, 1, "الكاشف معطَّل — كل الطفرات أعلاه بلا معنى");
});
