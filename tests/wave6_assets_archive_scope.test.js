// ════════════════════════════════════════════════════════════════════════════
// tests/wave6_assets_archive_scope.test.js
//
// يحرس نطاق حزمة Wave 6 Assets Archive والعيوب التي كشفها Preview:
//
//  ١. `to_regproc(v.sig)` و`v.sig` توقيع بأقواس ⇒ NULL دائمًا ⇒ بوّابة موجودة
//     تُبلَّغ «مفقودة». الصحيح `to_regprocedure`.
//  ٢. PREFLIGHT كان **نسخة طبق الأصل** من حزمة Compliance Knowledge: قائمة
//     اعتمادات مشتركة، فحُجبت هذه الحزمة بجدول لا تستعمله (`custody_incidents`).
//  ٣. 🔴 ثمّ خروج بحالة 0 ⇒ لا توقّف حقيقيّ.
//
// 🔴 والتوقّعات هنا **مستخرَجة من RUNME** لا من الملفّ المفحوص — فاختبارٌ يشتقّ
//    توقّعه ممّا يفحصه لا يُثبت شيئًا (وقد أوقعني ذلك سابقًا في Wave 4).
//
// ⛔ لا قاعدة ولا شبكة: تحليل نصّيّ ساكن.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DOCS = path.join(ROOT, "docs");
const R = (f) => fs.readFileSync(path.join(DOCS, f), "utf8");
/** يجرّد تعليقات `--` ويُبقي السلاسل. */
function code(sql) {
  let out = "", i = 0, q = false;
  while (i < sql.length) {
    const c = sql[i];
    if (q) { if (c === "'") q = false; out += c; i++; continue; }
    if (c === "'") { q = true; out += c; i++; continue; }
    if (sql.startsWith("--", i)) { while (i < sql.length && sql[i] !== "\n") { out += " "; i++; } continue; }
    out += c; i++;
  }
  return out;
}
const C = (f) => code(R(f));

const AA_PRE = "wave6_assets_archive_PREFLIGHT.sql";
const AA_RUN = "wave6_assets_archive_RUNME.sql";
const AA_POST = "wave6_assets_archive_POSTCHECK.sql";
const CK_PRE = "wave6_compliance_knowledge_PREFLIGHT.sql";
const CK_RUN = "wave6_compliance_knowledge_RUNME.sql";

/** كل `public.<obj>` يشير إليه ملفّ — مصدر الحقيقة للاعتمادات. */
function referenced(file) {
  return new Set([...C(file).matchAll(/public\.([a-z0-9_]+)/g)].map((m) => m[1]));
}
/** ما يُنشئه الملفّ (جداول ودوالّ وعروض). */
function created(file) {
  return new Set([...C(file).matchAll(
    /create (?:or replace )?(?:table (?:if not exists )?|function |view )public\.([a-z0-9_]+)/g,
  )].map((m) => m[1]));
}
/** ما يستهلكه الملفّ من الخارج = المشار إليه ناقص المُنشأ. */
function externalDeps(file) {
  const made = created(file);
  return new Set([...referenced(file)].filter((o) => !made.has(o)));
}

// ─── ١ · 🔴 العيب الجذريّ: to_regproc لا تقبل توقيعًا ──────────────────────
test("🔴 لا to_regproc بتوقيع — حرفيًّا أو عبر متغيّر", () => {
  const bad = [];
  for (const f of fs.readdirSync(DOCS).filter((x) => x.endsWith(".sql"))) {
    const t = C(f);
    for (const m of t.match(/to_regproc\(\s*'[a-z0-9_.]+\([^']*\)'/gi) ?? []) bad.push(`${f}: ${m}`);
    // الشكل المتغيّر: to_regproc(v.sig) حيث القيم تحمل أقواسًا.
    if (/to_regproc\(\s*(?:[a-z_][a-z0-9_]*\.)?sig\s*\)/i.test(t)) bad.push(`${f}: to_regproc(<sig var>)`);
  }
  assert.deepEqual(bad, [],
    "to_regproc بتوقيع تُعيد NULL دائمًا ⇒ بلاغ كاذب أو حارس مُتخطّى:\n" + bad.join("\n"));
});

test("🔴 كلا فحصَي Wave 6 يستعملان to_regprocedure", () => {
  for (const f of [AA_PRE, CK_PRE]) {
    assert.match(C(f), /to_regprocedure\s*\(/, `${f}: لا يستعمل to_regprocedure`);
  }
});

// ─── ٢ · النطاق: اعتمادات Assets Archive من RUNME بالأدلّة ────────────────
test("🔴 اعتمادات PREFLIGHT = ما يستعمله RUNME فعلًا، لا أكثر", () => {
  const deps = externalDeps(AA_RUN);
  // الاعتمادات الخارجية الحقيقية (بعد استبعاد ما تُنشئه الحزمة).
  assert.deepEqual([...deps].sort(), [
    "asset_insurance_policies", "can_manage_projects",
    "civ_can_manage_assets", "civ_can_view_assets",
    "custody_inventory_assets", "projects",
  ], "🔴 تغيّرت اعتمادات RUNME — أعد اشتقاق قائمة PREFLIGHT من الأدلّة");

  const pre = C(AA_PRE);
  for (const d of deps) {
    assert.ok(pre.includes(d), `🔴 اعتماد حقيقيّ غائب عن PREFLIGHT: ${d}`);
  }
});

test("🔴 اعتمادات Compliance Knowledge أُزيلت من Assets Archive", () => {
  const pre = C(AA_PRE);
  // ⚠️ هذه كلّها **لا** يستعملها RUNME — والدليل: ليست في externalDeps.
  const foreign = ["custody_incidents", "prodops_can_view", "ops_job_hse", "ops_incidents",
                   "ai_knowledge_sources", "ai_source_revisions", "project_task_checklists",
                   "project_archives", "ai_sources_type_known"];
  const aaDeps = externalDeps(AA_RUN);
  for (const f of foreign) {
    assert.ok(!aaDeps.has(f), `افتراض خاطئ: RUNME يستعمل ${f} فعلًا`);
    assert.ok(!pre.includes(f),
      `🔴 ${f} ما يزال في PREFLIGHT — يحجب الحزمة باعتماد لا تحتاجه`);
  }
});

test("🔴 civ_can_manage_assets — اعتماد حقيقيّ لم يكن في القائمة الرسمية", () => {
  assert.ok(externalDeps(AA_RUN).has("civ_can_manage_assets"),
    "RUNME لم يعد يستعملها — راجع القائمة");
  assert.match(C(AA_PRE), /public\.civ_can_manage_assets\(\)/,
    "🔴 بوّابة تُستدعى بلا حارس وجود وغائبة عن PREFLIGHT ⇒ 42883 وقت التشغيل");
});

/** بوّابات كتلة REQUIRED_GATE وحدها. */
function gateBlock() {
  const t = C(AA_PRE);
  const b = t.slice(t.indexOf("REQUIRED_GATE"), t.indexOf("EXPECTED_ABSENT"));
  return [...b.matchAll(/'(public\.[a-z_]+\([^)]*\))'/g)].map((m) => m[1]).sort();
}
/** البوّابات المحتسَبة في بلوك الحسم. */
function gateVerdict() {
  const t = C(AA_PRE);
  const d = t.slice(t.indexOf("foreach v_sig in array"));
  return [...d.slice(0, d.indexOf("]")).matchAll(/'(public\.[a-z_]+\([^)]*\))'/g)]
    .map((m) => m[1]).sort();
}
const EXPECTED_GATES = [
  "public.can_manage_projects()", "public.civ_can_manage_assets()", "public.civ_can_view_assets()",
];

test("🔴 البوّابات الثلاث مثبَّتة في كتلة الفحص", () => {
  // ⚠️ تُقرأ الكتلة وحدها: فحصُ الملفّ كلّه كان يمرّر إسقاط بوّابة من هنا
  //    لأنّها تبقى مذكورة في بلوك الحسم (طفرتا M4/M5).
  assert.deepEqual(gateBlock(), EXPECTED_GATES, "🔴 تغيّرت بوّابات REQUIRED_GATE");
});

test("🔴 البوّابات الثلاث محتسَبة في الحسم — لا عرضًا فقط", () => {
  assert.deepEqual(gateVerdict(), EXPECTED_GATES,
    "🔴 بوّابة معروضة وخارج الحسم ⇒ غيابها لن يُفشل PREFLIGHT (طفرة M7)");
});

test("🔴 قائمة الجداول المطلوبة محتسَبة في الحسم", () => {
  const t = C(AA_PRE);
  const d = t.slice(t.indexOf("foreach v_t in array"));
  const tables = [...d.slice(0, d.indexOf("]")).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(tables, ["asset_insurance_policies", "custody_inventory_assets", "projects"],
    "🔴 تغيّرت الجداول المحتسَبة في الحسم");
});

test("الحزمتان لم تعودا نسختين متطابقتين", () => {
  assert.notEqual(C(AA_PRE).replace(/\s+/g, ""), C(CK_PRE).replace(/\s+/g, ""),
    "🔴 الملفّان متطابقان — عادت القائمة المشتركة");
  // وكلٌّ يذكر اعتماداته وحده.
  assert.ok(!C(AA_PRE).includes("ai_knowledge_sources"), "Assets يذكر اعتماد الامتثال");
  assert.ok(!C(CK_PRE).includes("civ_can_view_assets"), "Compliance يذكر اعتماد الأصول");
});

test("🔴 Compliance: custody_incidents مطلوب لأنّه غير محروس في RUNME", () => {
  const t = C(CK_RUN);
  assert.ok(t.includes("public.custody_incidents"), "لم يعد يُستعمل — راجع التصنيف");
  // ⛔ ولا حارس وجود حوله ⇒ غيابه يُفشل create view ⇒ تراجع الحزمة.
  assert.ok(!/to_regclass\('public\.custody_incidents'\)/.test(t),
    "صار محروسًا — يمكن خفضه إلى OPTIONAL");
  const pre = C(CK_PRE);
  const decide = pre.slice(pre.indexOf("do $$"));
  assert.ok(decide.includes("custody_incidents"),
    "🔴 مطلوب وغير محتسَب في الحسم — ستفشل الحزمة داخل المعاملة بدل أن تتوقّف قبلها");
});

// ─── ٣ · الفشل الحقيقيّ ────────────────────────────────────────────────────
test("🔴 PREFLIGHT يفشل فعليًّا لا طباعةً", () => {
  for (const f of [AA_PRE, CK_PRE]) {
    const t = C(f);
    assert.match(t, /raise exception/i, `${f}: لا استثناء — 🔴 مع خروج 0`);
    assert.match(t, /PREFLIGHT FAILED/, `${f}: رسالة الفشل غير واضحة`);
    // ⛔ ولا كتابة.
    for (const w of [/\binsert\s+into\b/i, /\bupdate\s+\w+\s+set\b/i, /\bdelete\s+from\b/i,
                     /\bcreate\s+(table|function|view)\b/i, /\balter\s+table\b/i, /\bgrant\b/i]) {
      assert.ok(!w.test(t), `${f} يكتب: ${w}`);
    }
  }
});

test("🔴 EXPECTED_ABSENT لا يدخل الحسم — ولا يُفشل الحزمة", () => {
  const pre = C(AA_PRE);
  const decide = pre.slice(pre.indexOf("do $$"));
  for (const own of created(AA_RUN)) {
    if (!/^(asset_insurance_coverage|archive_media|archive_project_links|music_licenses|music_license_project_links|model_releases)$/.test(own)) continue;
    assert.ok(pre.includes(own), `${own} غير مصنَّف EXPECTED_ABSENT`);
    assert.ok(!decide.includes(`'${own}'`),
      `🔴 ${own} من إنتاج الحزمة ومحتسَب في الحسم — سيفشل دائمًا قبل التشغيل`);
  }
});

test("🔴 التصنيفات الأربعة مستعملة", () => {
  const pre = C(AA_PRE);
  for (const k of ["REQUIRED_DEPENDENCY", "REQUIRED_GATE", "EXPECTED_ABSENT"]) {
    assert.ok(pre.includes(k), `تصنيف مفقود: ${k}`);
  }
  assert.ok(/OPTIONAL_DEPENDENCY|PARALLEL_CHECK/.test(pre), "لا تصنيف اختياريّ/ازدواج");
});

// ─── ٤ · عقد RUNME ────────────────────────────────────────────────────────
test("🔴 RUNME معاملة واحدة — الفشل يتراجع كاملًا", () => {
  const t = C(AA_RUN);
  assert.equal((t.match(/^begin;/gim) ?? []).length, 1, "begin مفقود أو متعدّد");
  assert.equal((t.match(/^commit;/gim) ?? []).length, 1, "commit مفقود أو متعدّد");
  assert.ok(!/^commit;[\s\S]*^begin;/m.test(t), "🔴 معاملات متعدّدة — تطبيق جزئيّ ممكن");
});

test("🔴 ستة جداول جديدة فقط — ولا تعديل على جدول قائم", () => {
  const t = C(AA_RUN);
  const tables = [...t.matchAll(/create table if not exists public\.([a-z_]+)/g)].map((m) => m[1]);
  assert.equal(tables.length, 6, `عدد الجداول ${tables.length} ≠ 6`);
  // كل `alter table` على جدول من إنتاج الحزمة نفسها.
  for (const m of t.matchAll(/alter table\s+public\.([a-z_]+)/g)) {
    assert.ok(tables.includes(m[1]), `🔴 تعديل على جدول قائم خارج العقد: ${m[1]}`);
  }
});

test("🔴 الحذف التلقائيّ مستحيل بنيويًّا · والحجز القانونيّ يمنع الإخفاء", () => {
  const t = C(AA_RUN);
  assert.match(t, /auto_delete_enabled[\s\S]{0,120}check\s*\(\s*auto_delete_enabled\s*=\s*false\s*\)/i,
    "🔴 يمكن تفعيل حذف تلقائيّ — القيد غائب");
  assert.match(t, /legal_hold\s*=\s*false\s+or\s+is_deleted\s*=\s*false/i,
    "🔴 الحجز القانونيّ لا يمنع الإخفاء");
  // ⚠️ يُفحص **سطر تعريف العمود** وحده: `[^,]*` عبر الملفّ كلّه يعبر الأسطر
  //    ويلتقط نصّ التعليق، فيفشل الاختبار لسبب لا علاقة له بالعمود.
  const colLine = t.split("\n").find((l) => /^\s*retention_until\s/.test(l));
  assert.ok(colLine, "حقل الاحتفاظ مفقود");
  assert.match(colLine, /retention_until\s+date\s*,\s*$/, "نوع العمود ليس date قابلًا للفراغ");
  assert.ok(!/\bdefault\b|\bnot null\b/i.test(colLine),
    `🔴 مدّة احتفاظ مفترضة — والسياسة ما تزال PENDING: ${colLine.trim()}`);
  // ⛔ ولا حذف فعليّ للأرشيف في هذه الحزمة.
  assert.ok(!/delete\s+from\s+public\.archive_media/i.test(t), "🔴 حذف مباشر من الأرشيف");
});

test("⛔ RUNME لا يستعمل custody_incidents ولا prodops_can_view", () => {
  const deps = externalDeps(AA_RUN);
  for (const o of ["custody_incidents", "prodops_can_view"]) {
    assert.ok(!deps.has(o), `🔴 اعتماد خارج عقد الحزمة: ${o}`);
  }
});

// ─── ٥ · POSTCHECK ────────────────────────────────────────────────────────
test("🔴 POSTCHECK يفشل فعليًّا وnطاقه الحزمة وحدها", () => {
  const t = C(AA_POST);
  assert.match(t, /raise exception/i, "لا استثناء — فشل دلاليّ بلا فشل فعليّ");
  assert.match(t, /POSTCHECK FAILED/, "رسالة الفشل غير واضحة");
  // ⛔ ولا يفحص كيانات حزمة أخرى إلا للتأكّد من **عدم** الاعتماد عليها.
  const decide = t.slice(t.indexOf("do $$"));
  assert.match(decide, /اعتماد عرضيّ على Compliance Knowledge/,
    "لا فحص لاستقلال الحزمة");
});

test("🔴 POSTCHECK يطابق تواقيع الدوالّ الخمس بما يمنحه RUNME", () => {
  const grants = new Map();
  for (const m of R(AA_RUN).matchAll(/on function public\.([a-z_]+)\(([^)]*)\)/g)) {
    grants.set(m[1], m[2].split(",").map((x) => x.trim()).filter(Boolean).join(", "));
  }
  assert.equal(grants.size, 5, `عدد الدوالّ الممنوحة ${grants.size} ≠ 5`);
  const t = C(AA_POST);
  // ⚠️ الكتلة محدودة بالـCTE: امتدادها إلى آخر الملفّ كان يلتقط تواقيع بلوك
  //    الحسم أيضًا فيُضاعف العدّ (13 بدل 5).
  const startIdx = t.indexOf("with pkg(fname, fargs)");
  const block = t.slice(startIdx, t.indexOf("from pkg k", startIdx));
  const rows = [...block.matchAll(/\(\s*'([a-z_]+)'\s*,\s*'([^']*)'\s*\)/g)];
  assert.equal(rows.length, 5, `تواقيع POSTCHECK ${rows.length} ≠ 5`);
  for (const [, fname, fargs] of rows) {
    assert.ok(grants.has(fname), `🔴 ${fname} في POSTCHECK ولا مِنحة له في RUNME`);
    assert.equal(fargs, grants.get(fname),
      `🔴 ${fname}: POSTCHECK (${fargs}) ≠ RUNME (${grants.get(fname)})`);
  }
  // ⚠️ المطابقة تقع في الـJOIN بعد الـCTE، لا داخل الكتلة المحدودة أعلاه.
  const joinPart = t.slice(t.indexOf("from pkg k", startIdx), t.indexOf(";", startIdx));
  assert.match(joinPart, /oidvectortypes\s*\(\s*p\.proargtypes\s*\)/,
    "المطابقة ليست على قائمة الأنواع");
  assert.ok(!/pg_get_function_identity_arguments/.test(joinPart),
    "🔴 تُعيد أسماء الوسائط مع الأنواع ⇒ لا تطابق أبدًا");
});

test("🔴 sql_identifier يُحوَّل قبل string_agg", () => {
  const t = C(AA_POST);
  // ⚠️ يُبلَّغ فقط عن **عمود مجرَّد** يليه فاصلة/قوس. أمّا `table_name||'.'||col`
  //    فنتيجته `text` أصلًا بفضل التحويل الضمنيّ، وحسبانه خطأً إنذار كاذب.
  for (const m of t.match(/string_agg\s*\(\s*(?:distinct\s+)?(?:table_name|routine_name|grantee)\s*(?=[,)])/gi) ?? []) {
    assert.fail(`${m.trim()} بلا ::text — string_agg على sql_identifier يفشل وقت التشغيل`);
  }
});

test("العلم يبقى OFF ولا بيانات مخترعة", () => {
  const t = C(AA_POST);
  assert.match(R(AA_POST), /العلم يبقى OFF/, "لا تأكيد على بقاء العلم مطفأ");
  assert.match(t, /الجداول تُنشأ فارغة/, "لا فحص للبيانات المخترعة");
  // ⚠️ الإدراج **داخل دوالّ `*_upsert`** هو وظيفتها. الممنوع بذرُ صفوف على
  //    المستوى الأعلى — أي خارج أجسام الدوالّ.
  const run = C(AA_RUN);
  const bodies = [...run.matchAll(/\$\$[\s\S]*?\$\$/g)].map((m) => m[0]).join("\n");
  const topLevel = run.split(/\$\$[\s\S]*?\$\$/).join("\n");
  assert.ok(/insert into public\.archive_media/i.test(bodies), "دوالّ الرفع لا تُدرج شيئًا؟");
  assert.ok(!/insert into public\.(archive_media|music_licenses|model_releases|asset_insurance_coverage)/i.test(topLevel),
    "🔴 بذر صفوف على المستوى الأعلى — بيانات مخترعة");
});
