// ════════════════════════════════════════════════════════════════════════════
// tests/wave7_global_search_project_name.test.js
//
// عقد عمود اسم المشروع في حزمة Global Search — والعطب الذي أوقف التطبيق:
//
//     ERROR: column "name" does not exist
//
// ★ لماذا وقع ★ الحزمة قرأت اسم المشروع من `projects.name`. ⛔ ولا وجود له:
//   العمود اسمه `project_name`. والدليل ليس رسالة الخطأ وحدها — **٤٤ موضعًا**
//   في `docs/*.sql` تقرأ `p.project_name`، ⛔ ولا ملفّ واحد غير هذه الحزمة كان
//   يذكر `projects.name`. اسمُ عمودٍ اختُرع، والقاعدة كانت على حقّ.
//
// 🔴 وتوقّع هذا الملفّ **لا يُشتقّ من الحزمة**: يُشتقّ من إجماع بقيّة المستودع
//    (SQL + TypeScript). فلو اشتُقّ من الملفّ المفحوص لصدّق أيّ اسم يحمله.
//
// ⛔ لا قاعدة ولا شبكة: تحليل نصّيّ ساكن.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DOCS = path.join(ROOT, "docs");

const RUNME = "wave7_global_search_RUNME.sql";
const PRE = "wave7_global_search_PREFLIGHT.sql";
const POST = "wave7_global_search_POSTCHECK.sql";
const ROLL = "wave7_global_search_ROLLBACK.sql";
const PKG = [RUNME, PRE, POST, ROLL];
const R = (f) => fs.readFileSync(path.join(DOCS, f), "utf8");

/** نمط المسار الذي يمرّر كلّ المشاريع عند غياب البوّابة. */
const FAIL_OPEN = /to_regprocedure\([^;]{0,80}can_access_project[^;]{0,80}is\s+null\s*(?:\r?\n)?\s*or/i;

/** يجرّد تعليقات `--` ويُبقي السلاسل — فلا يُحاكَم الشرح كأنّه كود. */
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
/**
 * يجرّد التعليقات **والسلاسل** — فمرجعُ عمودٍ لا يعيش داخل علامتَي اقتباس.
 * ⚠️ ولولا ذلك لعُدَّ `'projects.name'` في نصّ تشخيصيّ، ونمطُ `'p\.name'` داخل
 *    فحصٍ يبحث عنه، انتهاكين — فيُدان الحارس بأنّه ما يحرس منه.
 */
function codeNoStrings(sql) {
  return code(sql).replace(/'(?:[^']|'')*'/g, "''");
}

/** يقسّم على `;` خارج الأقواس والسلاسل — لتُفحص كل جملة بأسمائها المستعارة. */
function statements(sql) {
  const c = code(sql);
  const out = []; let cur = "", depth = 0, q = false;
  for (let i = 0; i < c.length; i++) {
    const ch = c[i];
    if (q) { if (ch === "'") q = false; cur += ch; continue; }
    if (ch === "'") { q = true; cur += ch; continue; }
    if (ch === "(") depth++;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === ";" && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** جسم `global_search` وحده. */
function globalSearchBody(sql) {
  const t = code(sql);
  const i = t.search(/create\s+or\s+replace\s+function\s+public\.global_search\b/i);
  assert.notEqual(i, -1, "global_search غير موجودة في RUNME");
  const m = t.slice(i).match(/\$\$([\s\S]*?)\$\$/);
  assert.ok(m, "جسم global_search غير مقروء");
  return m[1];
}

// ════════════════════════════════════════════════════════════════════════════
// ١ · مصدر التوقّع: إجماع المستودع، ⛔ لا الحزمة
// ════════════════════════════════════════════════════════════════════════════
test("🔴 إجماع المستودع: اسم المشروع هو project_name", () => {
  let withProjectName = 0;
  for (const f of fs.readdirSync(DOCS).filter((x) => x.endsWith(".sql"))) {
    if (f.startsWith("wave7_global_search_")) continue;      // ⛔ لا يُستشهد بالمفحوص
    const t = code(fs.readFileSync(path.join(DOCS, f), "utf8"));
    withProjectName += (t.match(/\b[a-z_]+\.project_name\b/g) ?? []).length;
  }
  assert.ok(withProjectName >= 20,
    `${withProjectName} موضعًا فقط تقرأ project_name — راجع الافتراض قبل تثبيته`);
});

test("⛔ ولا ملفّ SQL في المستودع يقرأ projects.name", () => {
  const bad = [];
  for (const f of fs.readdirSync(DOCS).filter((x) => x.endsWith(".sql"))) {
    const raw = fs.readFileSync(path.join(DOCS, f), "utf8");
    if (/\bprojects\.name\b/.test(codeNoStrings(raw))) bad.push(`${f}: projects.name`);
    // 🔴 والاسم المستعار يُفحص **داخل جملته**: ملفٌّ يضمّ `projects p` في جملة
    //    و`crm_commission_plans p` في أخرى ليس فيه عطب — و`plans.name` موجود
    //    فعلًا. فحصٌ على مستوى الملفّ يُدين البريء ثمّ يُطفأ.
    for (const st of statements(raw)) {
      const s2 = st.replace(/'(?:[^']|'')*'/g, "''");
      const m = s2.match(/(?:from|join)\s+public\.projects\s+(?:as\s+)?([a-z_][a-z0-9_]*)/i);
      if (!m) continue;
      if (new RegExp(`\\b${m[1]}\\.name\\b`).test(s2)) bad.push(`${f}: ${m[1]}.name على projects`);
    }
  }
  assert.deepEqual(bad, [], "قراءة عمود غير موجود:\n" + bad.join("\n"));
});

// ════════════════════════════════════════════════════════════════════════════
// ٢ · المواضع الأربعة في مسار Global Search
// ════════════════════════════════════════════════════════════════════════════
test("🔴 الفهرس يُبنى على project_name", () => {
  const t = code(R(RUNME));
  assert.match(t, /create index if not exists projects_fts_idx\s+on public\.projects using gin \(public\.search_vector\(coalesce\(project_name,''\)\)\)/,
    "تعريف الفهرس ليس على project_name");
  assert.ok(!/coalesce\(name\s*,/.test(t), "بقي `coalesce(name,'')` — وهو ما رمى column \"name\" does not exist");
});

test("🔴 JSON title وrank وWHERE — ثلاثتها project_name", () => {
  const body = globalSearchBody(R(RUNME));
  assert.match(body, /'title',\s*p\.project_name/, "عنوان JSON ليس project_name");
  assert.match(body, /ts_rank\(public\.search_vector\(coalesce\(p\.project_name,''\)\)/, "الترتيب ليس project_name");
  assert.match(body, /where public\.search_vector\(coalesce\(p\.project_name,''\)\) @@ v_q/, "الشرط ليس project_name");
  assert.equal((body.match(/p\.project_name/g) ?? []).length, 3,
    "المواضع الثلاثة بالضبط: العنوان والترتيب والشرط");
});

test("⛔ ولا `p.name` في أيّ ملفّ من الحزمة", () => {
  for (const f of PKG) {
    assert.ok(!/\bp\.name\b/.test(codeNoStrings(R(f))), `${f}: بقي p.name`);
  }
});

// 🔴 والاستبدال **مُحكَم**: أعمدة المصادر الأخرى صحيحة ولا تُمسّ.
test("🔴 عمود كل مصدر — دُقِّق مقابل مُنشئه ولم يتغيّر إلّا ما ثبت خطؤه", () => {
  const body = globalSearchBody(R(RUNME));
  // ⚠️ `d.title` و`a.asset_name` و`a.asset_code` صحيحة بالدليل (§٦) ⇒ لا تُمسّ.
  for (const [col, why, n] of [
    ["d.title", "المخرَجات", 3], ["a.asset_name", "المعدّات", 3], ["a.asset_code", "المعدّات", 3],
  ]) {
    assert.equal((body.match(new RegExp(col.replace(".", "\\."), "g")) ?? []).length, n,
      `${why}: ${col} لم يعد في ${n} مواضع — استبدالٌ عامّ أصاب ما لا يخصّه`);
  }
  const t = code(R(RUNME));
  assert.match(t, /coalesce\(title,/, "فهرس المخرَجات تغيّر");
  assert.match(t, /coalesce\(asset_name,/, "فهرس المعدّات تغيّر");
  assert.ok(!/d\.project_name|a\.project_name|c\.project_name/.test(t),
    "🔴 استبدال عامّ: عمود مصدر آخر صار project_name");
});

// ════════════════════════════════════════════════════════════════════════════
// ٣ · بوّابة الوصول — fail-closed
// ════════════════════════════════════════════════════════════════════════════
test("🔴 لا مسار fail-open حول can_access_project", () => {
  const body = globalSearchBody(R(RUNME));
  // ★ `to_regprocedure(…) is null or can_access_project(…)` يجعل الشرط صحيحًا
  //   دائمًا عند غياب البوّابة ⇒ كلّ مشروع في القاعدة لأيّ مستخدم مُصادَق.
  // ⚠️ `[^)]*` لا تصلح: تتوقّف عند القوس المغلق في `can_access_project(uuid)`
  //    نفسه فلا تبلغ `is null` — نمطٌ يبدو حارسًا ولا يُطابق شيئًا.
  assert.ok(!FAIL_OPEN.test(body), "🔴 fail-open: غياب البوّابة يُظهر كلّ المشاريع");
  assert.match(body, /and public\.can_access_project\(p\.id\)/, "بوّابة المشاريع غائبة");
  assert.match(body, /and public\.can_access_project\(d\.project_id\)/, "بوّابة المخرَجات غائبة");
});

test("🔴 البوّابة إلزامية في PREFLIGHT وفي حارس RUNME", () => {
  assert.match(code(R(PRE)), /REQUIRED_GATE/, "البوّابة ما زالت اختيارية في PREFLIGHT");
  assert.match(code(R(PRE)), /'GATE public\.can_access_project\(uuid\)/, "الحسم لا يشترط البوّابة");
  assert.match(code(R(RUNME)), /GATE public\.can_access_project\(uuid\)/, "حارس §0 لا يشترط البوّابة");
});

// ⚠️ وبوّابتا الأصول والعملاء **اختياريتان بحقّ**: مصدرهما محروس بـ`if … then`
//    فيُتخطّى عند الغياب — لا يُفتح. ⛔ ولا تُرقَّيان إلى إلزاميتين بلا سبب.
test("بوّابتا الأصول والعملاء تتخطّيان ولا تفتحان", () => {
  const body = globalSearchBody(R(RUNME));
  for (const g of ["civ_can_view_assets", "can_manage_projects"]) {
    assert.match(body, new RegExp(`to_regprocedure\\('public\\.${g}\\(\\)'\\) is not null`),
      `${g}: الحارس ليس is not null — قد ينقلب إلى fail-open`);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// ٤ · PREFLIGHT: العمود · الحالة الجزئية · الحسم الفعليّ
// ════════════════════════════════════════════════════════════════════════════
test("🔴 PREFLIGHT يرفض غياب projects.project_name", () => {
  const t = code(R(PRE));
  assert.match(t, /REQUIRED_COLUMN/, "لا فحص للعمود");
  assert.match(t, /column_name::text='project_name'/, "لا فحص باسم العمود الصحيح");
  assert.match(t, /data_type='text'/, "لا فحص لنوع العمود");
  assert.match(t, /COLUMN projects\.project_name/, "غياب العمود لا يدخل الحسم");
  assert.match(t, /raise exception/, "PREFLIGHT يطبع ولا يوقف");
});

test("🔴 PREFLIGHT يُصنّف حالة التطبيق ويوقف عند الهجينة", () => {
  const t = code(R(PRE));
  for (const token of ["APPLY_STATE", "FRESH_APPLY", "MATCHING_REAPPLY", "PARTIAL"]) {
    assert.ok(t.includes(token), `PREFLIGHT بلا تصنيف ${token}`);
  }
  assert.match(t, /v_present not in \(0, ?5\)/, "التصنيف معروض ولا يُحتسب في الحسم");
  // 🔴 وفهرس `INVALID` بقيّةُ بناءٍ فاشل: لا يُستعمل ولا يُعاد بناؤه تلقائيًّا.
  assert.match(t, /indisvalid/, "لا فحص للفهرس غير الصالح");
});

test("POSTCHECK يُثبت العمود من الكتالوج ويفشل فعليًّا", () => {
  const t = code(R(POST));
  assert.match(t, /indexdef ~\* 'project_name'|indexdef !~\* 'project_name'/, "لا فحص لتعريف الفهرس");
  assert.match(t, /prosrc/, "لا فحص لجسم الدالّة");
  assert.match(t, /raise exception/, "POSTCHECK يطبع ولا يوقف");
});

test("ROLLBACK: أسماء الفهارس مستقلّة عن العمود", () => {
  const t = code(R(ROLL));
  for (const idx of ["projects_fts_idx", "clients_fts_idx", "deliverables_fts_idx", "assets_fts_idx"]) {
    assert.ok(t.includes(idx), `${idx} لا يُسقَط`);
  }
  assert.ok(!/project_name|coalesce\(name/.test(t), "ROLLBACK صار يذكر عمودًا — أسماء الفهارس لا تحمل أعمدة");
});

// ════════════════════════════════════════════════════════════════════════════
// ٥ · طفرات — كل موضع على حدة، في **نسخة** بمجلَّد مؤقّت
// 🔴 حارسٌ لا تُثبته طفرةٌ ليس حارسًا.
// ════════════════════════════════════════════════════════════════════════════
/** ينسخ ملفّات الحزمة، يشوّه واحدًا، يُعيد دالّة قراءة موجَّهة للنسخة. */
function mutated(file, from, to) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "w7-gs-mut-"));
  for (const f of PKG) fs.copyFileSync(path.join(DOCS, f), path.join(dir, f));
  const src = fs.readFileSync(path.join(dir, file), "utf8");
  const out = src.replace(from, to);
  assert.notEqual(out, src, `التشويه لم يُطبَّق على ${file}`);
  fs.writeFileSync(path.join(dir, file), out);
  return { dir, read: (f) => fs.readFileSync(path.join(dir, f), "utf8"),
           cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
/** يشترط سقوط تأكيدٍ ما على النسخة المُشوَّهة. */
function expectCaught(m, check, label) {
  try {
    assert.throws(() => check(m.read), assert.AssertionError, `🔴 طفرة غير مرصودة: ${label}`);
  } finally { m.cleanup(); }
}

test("طفرة: إعادة `name` داخل الفهرس", () => {
  const m = mutated(RUNME, "coalesce(project_name,'')", "coalesce(name,'')");
  expectCaught(m, (read) => {
    const t = code(read(RUNME));
    assert.ok(!/coalesce\(name\s*,/.test(t));
  }, "الفهرس على عمود غير موجود — وهو ما أجهض المعاملة");
});

test("طفرة: إعادة `p.name` داخل JSON title", () => {
  const m = mutated(RUNME, "'title',p.project_name", "'title',p.name");
  expectCaught(m, (read) => {
    assert.match(globalSearchBody(read(RUNME)), /'title',\s*p\.project_name/);
  }, "عنوان النتيجة من عمود غير موجود");
});

test("طفرة: إعادة `p.name` داخل rank", () => {
  const m = mutated(RUNME, "ts_rank(public.search_vector(coalesce(p.project_name,''))",
                           "ts_rank(public.search_vector(coalesce(p.name,''))");
  expectCaught(m, (read) => {
    assert.match(globalSearchBody(read(RUNME)),
      /ts_rank\(public\.search_vector\(coalesce\(p\.project_name,''\)\)/);
  }, "ترتيب النتائج من عمود غير موجود");
});

test("طفرة: إعادة `p.name` داخل WHERE", () => {
  const m = mutated(RUNME, "where public.search_vector(coalesce(p.project_name,'')) @@ v_q",
                           "where public.search_vector(coalesce(p.name,'')) @@ v_q");
  expectCaught(m, (read) => {
    assert.match(globalSearchBody(read(RUNME)),
      /where public\.search_vector\(coalesce\(p\.project_name,''\)\) @@ v_q/);
  }, "شرط المطابقة على عمود غير موجود");
});

test("طفرة: استبدال عامّ يصيب d.title", () => {
  const m = mutated(RUNME, "d.title", "d.project_name");
  expectCaught(m, (read) => {
    assert.equal((globalSearchBody(read(RUNME)).match(/d\.title/g) ?? []).length, 3);
  }, "عمود المخرَجات الصحيح تغيّر");
});

test("طفرة: حذف فحص العمود من PREFLIGHT", () => {
  const m = mutated(PRE, /column_name::text='project_name'/g, "column_name::text='name'");
  expectCaught(m, (read) => {
    assert.match(code(read(PRE)), /column_name::text='project_name'/);
  }, "PREFLIGHT يقبل قاعدة بلا العمود — فينفجر RUNME كما انفجر");
});

test("طفرة: تحويل بوّابة الوصول إلى fail-open", () => {
  const m = mutated(RUNME, "and public.can_access_project(p.id)",
    "and (to_regprocedure('public.can_access_project(uuid)') is null\n            or public.can_access_project(p.id))");
  expectCaught(m, (read) => {
    const body = globalSearchBody(read(RUNME));
    assert.ok(!FAIL_OPEN.test(body));
  }, "غياب البوّابة يُظهر كلّ مشاريع القاعدة لأيّ مُصادَق");
});

test("طفرة: حذف بوّابة المشاريع كليًّا", () => {
  const m = mutated(RUNME, "       and public.can_access_project(p.id)\n", "");
  expectCaught(m, (read) => {
    assert.match(globalSearchBody(read(RUNME)), /and public\.can_access_project\(p\.id\)/);
  }, "بحثٌ بلا بوّابة");
});

test("طفرة: PREFLIGHT يقبل حالة جزئية", () => {
  const m = mutated(PRE, "if v_present not in (0, 5) then", "if false then");
  expectCaught(m, (read) => {
    assert.match(code(read(PRE)), /v_present not in \(0, ?5\)/);
  }, "دوالّ بلا فهرس، أو فهرس بلا دوالّ — حالة هجينة تمرّ");
});

test("طفرة: PREFLIGHT يطبع ولا يوقف", () => {
  const m = mutated(PRE, /raise exception/g, "raise notice");
  expectCaught(m, (read) => {
    assert.match(code(read(PRE)), /raise exception/);
  }, "🔴 مطبوع مع حالة خروج 0");
});

// ════════════════════════════════════════════════════════════════════════════
// ٦ · عقد اسم العميل — `company` وإن خلا فـ`full_name`
//
// ★ الأدلّة التي حسمته (⛔ لا تخمين) ★
//   `lib/portal/large-projects.ts:1172` → `c.company || c.full_name || null`
//   `commercial_subscriptions_RUNME.sql:2252` → `coalesce(c.company, c.full_name, '—')`
//   `deliverable_delivery_audit_RUNME.sql:85` → `coalesce(c.company, c.full_name, …)`
//   وحزم التأجير تفحص `coalesce(pr.company,'') <> ''` ⇒ الشركة **الفارغة** حالة
//   قائمة، فلزم `nullif(btrim(...),'')` لا `coalesce` وحدها.
// ⛔ و`company_name` عمودُ `crm_leads` — جدولٌ آخر تمامًا.
// ════════════════════════════════════════════════════════════════════════════
const CLIENT_FN = "coalesce(nullif(btrim(c.company),''), c.full_name, '')";
const CLIENT_IDX = "coalesce(nullif(btrim(company),''''), full_name, '''')";

test("⛔ ولا `clients.company_name` في أيّ ملفّ من الحزمة", () => {
  for (const f of PKG) {
    const t = codeNoStrings(R(f));
    assert.ok(!/\bc\.company_name\b|\bclients\.company_name\b/.test(t), `${f}: بقي company_name`);
    assert.ok(!/coalesce\(company_name\s*,/.test(t), `${f}: فهرس على company_name`);
  }
});

test("🔴 عقد العميل في المواضع الثلاثة", () => {
  const body = globalSearchBody(R(RUNME));
  assert.ok(body.includes(`'title', ${CLIENT_FN}`), "عنوان JSON ليس عقد العميل");
  assert.ok(body.includes(`ts_rank(public.search_vector(${CLIENT_FN})`), "الترتيب ليس عقد العميل");
  assert.ok(body.includes(`where public.search_vector(${CLIENT_FN}) @@ v_q`), "الشرط ليس عقد العميل");
  assert.equal((body.match(/nullif\(btrim\(c\.company\)/g) ?? []).length, 3, "المواضع الثلاثة بالضبط");
});

// 🔴 الأهمّ: تعبير **الفهرس** = تعبير **البحث** حرفًا بحرف. واختلافهما لا يُنتج
//    خطأً — يُنتج فهرسًا يُبنى ثمّ **لا يُستعمل أبدًا**: مسحٌ تسلسليّ صامت.
/** تعبير `using gin (...)` بعد فكّ تهريب `execute '...'`. */
function indexExpr(sqlText, idxName) {
  const m = sqlText.match(new RegExp(`execute '((?:[^']|'')*${idxName}(?:[^']|'')*)'`));
  assert.ok(m, `${idxName}: تعريف الفهرس غير موجود`);
  const decoded = m[1].replace(/''/g, "'");
  const e = decoded.match(/using gin \(([\s\S]*)\)\s*$/);
  assert.ok(e, `${idxName}: تعبير الفهرس غير مقروء`);
  return e[1].trim();
}

test("🔴 تعبير الفهرس مطابق لتعبير البحث — لكل مصدر", () => {
  const t = code(R(RUNME));
  const body = globalSearchBody(R(RUNME));
  for (const [idx, alias, label] of [
    ["clients_fts_idx", "c.", "العملاء"],
    ["deliverables_fts_idx", "d.", "المخرَجات"],
    ["assets_fts_idx", "a.", "المعدّات"],
  ]) {
    const expr = indexExpr(t, idx);
    const aliased = expr.replace(/\b(company|full_name|title|asset_name|asset_code)\b/g, `${alias}$1`);
    // ⚠️ تُجرَّد المسافات: PostgreSQL يطابق **شجرة الإعراب** لا النصّ، فـ
    //    `a || b` و`a||b` تعبيرٌ واحد. والمقارنة الحرفية هنا تُعطي إنذارًا كاذبًا.
    const flat = (x) => x.replace(/\s+/g, "");
    assert.ok(flat(body).includes(flat(aliased)),
      `🔴 ${label}: تعبير الفهرس لا يطابق تعبير البحث ⇒ الفهرس لا يُستعمل أبدًا\n  ${aliased}`);
  }
});

// 🔴 تهريب مزدوج: داخل `$$…$$` مستوى واحد لا اثنان.
//    `''''` تُنتج حرف `'` لا نصًّا فارغًا · و`'' ''` سلسلتان متجاورتان = خطأ نحويّ.
test("🔴 لا تهريب مزدوج في تعريفات الفهارس", () => {
  for (const m of code(R(RUNME)).matchAll(/execute '((?:[^']|'')*)'/g)) {
    const d = m[1].replace(/''/g, "'");
    assert.ok(!/,\s*''''\s*\)/.test(d), `🔴 الافتراض حرف اقتباس لا نصّ فارغ:\n${d}`);
    assert.ok(!/''\s+''/.test(d), `🔴 سلسلتان فارغتان متجاورتان — خطأ نحويّ:\n${d}`);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// ٧ · أعمدة المصادر الأخرى — دُقِّقت مقابل مُنشئها ولم تتغيّر
// ════════════════════════════════════════════════════════════════════════════
test("🔴 deliverables.title صحيح — من phase0_migration", () => {
  const ddl = fs.readFileSync(path.join(DOCS, "phase0_migration.sql"), "utf8");
  const i = ddl.indexOf("create table public.deliverables");
  assert.notEqual(i, -1, "مُنشئ deliverables غير موجود");
  assert.match(ddl.slice(i, ddl.indexOf(");", i)), /\btitle\s+text\s+not null/,
    "المُنشئ لا يعرّف title — راجع قبل الاعتماد");
  assert.match(globalSearchBody(R(RUNME)), /coalesce\(d\.title,''\)/, "البحث لا يستعمل d.title");
});

test("🔴 asset_name وasset_code صحيحان — من منشئ العهدة", () => {
  const ddl = fs.readFileSync(path.join(DOCS, "portal_custody_inventory_system_v1_RUNME.sql"), "utf8");
  const i = ddl.indexOf("create table if not exists public.custody_inventory_assets");
  assert.notEqual(i, -1, "مُنشئ الأصول غير موجود");
  const block = ddl.slice(i, ddl.indexOf(");", i));
  assert.match(block, /\basset_name\s+text\s+not null/, "asset_name غير معرَّف");
  assert.match(block, /\basset_code\s+text\s+not null/, "asset_code غير معرَّف");
  const body = globalSearchBody(R(RUNME));
  assert.match(body, /coalesce\(a\.asset_name,''\)/, "البحث لا يستعمل asset_name");
  assert.match(body, /coalesce\(a\.asset_code,''\)/, "البحث لا يستعمل asset_code");
});

test("🔴 PREFLIGHT يفحص أعمدة المصادر لا الجداول وحدها", () => {
  const t = code(R(PRE));
  assert.match(t, /SOURCE_COLUMN/, "لا فحص لأعمدة المصادر");
  const decide = t.slice(t.indexOf("do $$"));
  for (const pair of ["clients.company", "clients.full_name", "deliverables.title",
                      "custody_inventory_assets.asset_name", "custody_inventory_assets.asset_code"]) {
    const [tbl, col] = pair.split(".");
    assert.ok(t.includes(`('${tbl}','${col}')`), `PREFLIGHT لا يعرض ${pair}`);
    assert.ok(decide.includes(`'${pair}'`), `${pair} معروض ولا يُحتسب في الحسم`);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// ٨ · طفرات عقد العميل والتهريب وفحص الأعمدة
// ════════════════════════════════════════════════════════════════════════════
test("طفرة: إعادة company_name إلى الفهرس", () => {
  const m = mutated(RUNME, CLIENT_IDX, "coalesce(company_name,'''')");
  // ⚠️ تعريف الفهرس يعيش **داخل** سلسلة `execute`، فـ`codeNoStrings` يمحوه.
  //    يُفكّ التهريب ويُفحص النصّ المنفَّذ فعلًا.
  expectCaught(m, (read) => {
    assert.ok(!/coalesce\(company_name\s*,/.test(indexExpr(code(read(RUNME)), "clients_fts_idx")));
  }, 'ERROR: column "company_name" does not exist');
});

test("طفرة: إعادة company_name إلى JSON title", () => {
  const m = mutated(RUNME, `'title', ${CLIENT_FN}`, "'title', c.company_name");
  expectCaught(m, (read) => {
    assert.ok(globalSearchBody(read(RUNME)).includes(`'title', ${CLIENT_FN}`));
  }, "عنوان العميل من عمود غير موجود");
});

test("طفرة: إعادة company_name إلى rank", () => {
  const m = mutated(RUNME, `ts_rank(public.search_vector(${CLIENT_FN})`,
                           "ts_rank(public.search_vector(coalesce(c.company_name,''))");
  expectCaught(m, (read) => {
    assert.ok(globalSearchBody(read(RUNME)).includes(`ts_rank(public.search_vector(${CLIENT_FN})`));
  }, "ترتيب العملاء من عمود غير موجود");
});

test("طفرة: إعادة company_name إلى WHERE", () => {
  const m = mutated(RUNME, `where public.search_vector(${CLIENT_FN}) @@ v_q`,
                           "where public.search_vector(coalesce(c.company_name,'')) @@ v_q");
  expectCaught(m, (read) => {
    assert.ok(globalSearchBody(read(RUNME)).includes(`where public.search_vector(${CLIENT_FN}) @@ v_q`));
  }, "شرط مطابقة العملاء من عمود غير موجود");
});

// 🔴 الأخطر: عمودٌ **موجود** لكنّه يخالف تعبير البحث ⇒ لا خطأ SQL، ولا فهرس.
test("طفرة: تعبير الفهرس ينحرف عن تعبير البحث بلا خطأ SQL", () => {
  const m = mutated(RUNME, CLIENT_IDX, "coalesce(company,'''')");
  expectCaught(m, (read) => {
    const expr = indexExpr(code(read(RUNME)), "clients_fts_idx");
    assert.ok(globalSearchBody(read(RUNME))
      .includes(expr.replace(/\b(company|full_name)\b/g, "c.$1")));
  }, "فهرس يُبنى ثمّ لا يُستعمل — مسح تسلسليّ صامت مع كل بحث");
});

test("طفرة: إعادة التهريب المزدوج", () => {
  const m = mutated(RUNME, "coalesce(title,'''')", "coalesce(title,'''''''')");
  expectCaught(m, (read) => {
    for (const mm of code(read(RUNME)).matchAll(/execute '((?:[^']|'')*)'/g)) {
      assert.ok(!/,\s*''''\s*\)/.test(mm[1].replace(/''/g, "'")));
    }
  }, "الافتراض حرف اقتباس لا نصّ فارغ ⇒ الفهرس لا يطابق البحث");
});

test("طفرة: مسافة الأصول تعود سلسلتين فارغتين", () => {
  // ⚠️ المرساة تشمل `coalesce(asset_code` لأنّ **الشرح** أعلى الملفّ يحوي
  //    الشكل المعطوب نفسه، ومرساةٌ أقصر كانت تُشوّه تعليقًا فلا يتغيّر شيء.
  const m = mutated(RUNME,
    "coalesce(asset_name,'''') || '' '' || coalesce(asset_code,'''')",
    "coalesce(asset_name,'''') || '''' '''' || coalesce(asset_code,'''')");
  expectCaught(m, (read) => {
    for (const mm of code(read(RUNME)).matchAll(/execute '((?:[^']|'')*)'/g)) {
      assert.ok(!/''\s+''/.test(mm[1].replace(/''/g, "'")));
    }
  }, "خطأ نحويّ في فهرس المعدّات — الخطأ الثالث في السلسلة");
});

for (const pair of ["clients.company", "deliverables.title",
                    "custody_inventory_assets.asset_name", "custody_inventory_assets.asset_code"]) {
  test(`طفرة: حذف فحص ${pair} من حسم PREFLIGHT`, () => {
    // ⚠️ آخر عنصر في المصفوفة بلا فاصلة لاحقة، وفاصلتُه السابقة على سطر آخر.
    const esc = pair.replace(/\./g, "\\.");
    const src = R(PRE);
    const from = src.includes(`'${pair}',`)
      ? new RegExp(`'${esc}',`)
      : new RegExp(`,\\s*'${esc}'`);
    const m = mutated(PRE, from, "");
    expectCaught(m, (read) => {
      const t = code(read(PRE));
      assert.ok(t.slice(t.indexOf("do $$")).includes(`'${pair}'`));
    }, "الجدول يُفحص وعموده لا — وهو العيب الذي تكرّر مرّتين");
  });
}

test("طفرة: PREFLIGHT يمرّ مع Schema ناقصة (فحص الجدول وحده)", () => {
  const m = mutated(PRE, /foreach v_pair in array array\['clients\.company'[\s\S]*?end loop;/,
                         "-- (حُذف فحص الأعمدة)");
  expectCaught(m, (read) => {
    const t = code(read(PRE));
    assert.ok(t.slice(t.indexOf("do $$")).includes("'clients.company'"));
  }, "فحصُ وجود الجدول بلا أعمدته هو ما سمح بالانفجار في §2 مرّتين");
});
