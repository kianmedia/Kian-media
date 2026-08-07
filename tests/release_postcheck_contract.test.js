// ════════════════════════════════════════════════════════════════════════════
// tests/release_postcheck_contract.test.js
//
// عقد بوّابة الإصدار — نشأ من Final Preview Sweep الذي أعطى:
//
//     FINAL PREVIEW SWEEP PASSED: 11/11
//     FINAL_PREVIEW_SWEEP_STATUS=0
//
// بينما كانت السجلّات تحمل صفوفًا حمراء داخل POSTCHECKs.
//
// ★ السبب الجذريّ ★ **ستّة** من الأحد عشر كانت `select` صِرفًا: تطبع 🔴 ثمّ
//   تنتهي بحالة خروج 0. والمِكنسة تقيس خروج `psql`، لا نتيجة الفحص. ⇒ ملفٌّ بلا
//   `raise exception` **لا يحرس شيئًا** مهما كثرت صفوفه، و«11/11» كان يقيس أنّ
//   الملفّات تُنفَّذ بلا خطأ نحويّ — لا أنّ العقد سليم.
//
// ⚠️ ولا يُحوَّل تشخيصيّ مقصود إلى حاجب بلا دليل: التصنيف صريح أدناه.
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
const REL = path.join(DOCS, "release");

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

/** POSTCHECKs المطلوبة — مشتقّة من **ترتيب الإصدار** لا من قائمة مكتوبة هنا. */
function requiredPostchecks() {
  const m = fs.readFileSync(path.join(REL, "SQL_RELEASE_SELECTION_MATRIX.md"), "utf8");
  const fence = (m.split("PROPOSED PRODUCTION RUN ORDER")[1] ?? "").match(/```[\s\S]*?```/);
  assert.ok(fence, "كتلة ترتيب الإصدار مفقودة");
  const runmes = [...fence[0].matchAll(/([a-z0-9_]+)_RUNME\.sql/gi)].map((x) => x[1]);
  assert.ok(runmes.length >= 11, `ترتيب الإصدار فيه ${runmes.length} حزمة فقط`);
  return runmes.map((b) => `${b}_POSTCHECK.sql`);
}

/** بلوك الحسم: من أوّل `do $` يحوي `raise exception` إلى آخر الملفّ. */
function verdictOf(sql) {
  const t = code(sql);
  const i = t.search(/do\s+\$[a-z_]*\$/i);
  if (i === -1) return null;
  const tail = t.slice(i);
  return /raise\s+exception/i.test(tail) ? tail : null;
}

// ════════════════════════════════════════════════════════════════════════════
// ١ · كل POSTCHECK مطلوب يملك حسمًا يفشل فعليًّا
// ════════════════════════════════════════════════════════════════════════════
test("🔴 كل POSTCHECK في ترتيب الإصدار يرفع استثناءً", () => {
  const bad = [];
  for (const f of requiredPostchecks()) {
    const p = path.join(DOCS, f);
    if (!fs.existsSync(p)) { bad.push(`${f}: مفقود`); continue; }
    if (!verdictOf(fs.readFileSync(p, "utf8"))) bad.push(`${f}: بلا بلوك حسم — يطبع 🔴 ويخرج بحالة 0`);
  }
  assert.deepEqual(bad, [],
    "🔴 «11/11 PASSED» كان يقيس خروج psql لا نتيجة الفحص:\n  " + bad.join("\n  "));
});

// ⚠️ وحسمٌ فارغ ليس حسمًا: يجب أن يجمع أعطابًا فعليًّا.
test("🔴 بلوك الحسم يجمع أعطابًا ولا يرفع استثناءً بلا شرط", () => {
  for (const f of requiredPostchecks()) {
    const v = verdictOf(fs.readFileSync(path.join(DOCS, f), "utf8"));
    assert.ok(/array_append\(|v_fail\s*\|\||v_missing\s*\|\||v_bad\s*\|\|/.test(v),
      `${f}: يرفع استثناءً بلا شروط مجمَّعة`);
    assert.match(v, /if\s+array_length\([\s\S]{0,60}>\s*0\s*then[\s\S]{0,200}raise\s+exception/i,
      `${f}: الاستثناء غير مشروط بوجود أعطاب`);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// ٢ · REQUIRED BLOCKER — كل شرط أمنيّ مطبوع يجب أن يكون **محسوبًا**
//
// التصنيف (⛔ ولا يُوسَّع بلا دليل):
//   REQUIRED BLOCKER  · تسريب صلاحية لـanon/PUBLIC · RLS مطفأ · نظام موازٍ ·
//                       كائن من الحزمة مفقود · بوّابة محذوفة.
//   EXPECTED WARNING  · اعتماد اختياريّ غائب (المصدر يُتخطّى).
//   INFORMATIONAL     · عدّ صفوف · حالة بيانات · ACL موروث لا تمنحه الحزمة.
// ════════════════════════════════════════════════════════════════════════════
test("🔴 كل POSTCHECK يحتسب تسريب صلاحية anon/PUBLIC في حسمه", () => {
  const bad = [];
  for (const f of requiredPostchecks()) {
    const raw = fs.readFileSync(path.join(DOCS, f), "utf8");
    const t = code(raw);
    // ⚠️ يُشترط فقط على الملفّات التي **تفحص** anon أصلًا — ⛔ ولا يُخترع شرط.
    if (!/'anon'/.test(t)) continue;
    const v = verdictOf(raw) ?? "";
    if (!/'anon'/.test(v)) bad.push(`${f}: يفحص anon ولا يحتسبه`);
  }
  assert.deepEqual(bad, [], "شرط أمنيّ مطبوع خارج الحسم:\n  " + bad.join("\n  "));
});

// ════════════════════════════════════════════════════════════════════════════
// ٣ · الثلاثة المرصودة في Final Preview Sweep
// ════════════════════════════════════════════════════════════════════════════
// FINDING 1 — CRM: anon يملك TRUNCATE/REFERENCES/TRIGGER على ٢٠ جدولًا (٦٠ صفًّا)
//   وPOSTCHECK يمرّ. والحزمة **تسحبها صراحةً** في RUNME، فالحالة المرصودة تُثبت
//   أنّ هذا الإصدار من RUNME لم يُطبَّق على Preview.
test("🔴 FINDING 1 · CRM: RUNME يسحب كل صلاحية عن anon", () => {
  const t = code(fs.readFileSync(path.join(DOCS, "crm_sales_FOUNDATION_RUNME.sql"), "utf8"));
  assert.match(t, /revoke all on table public\.%I from anon/i,
    "🔴 RUNME لا يسحب صلاحيات الجداول عن anon");
  assert.match(t, /revoke all on table public\.%I from public/i, "لا سحب عن PUBLIC");
  assert.match(t, /revoke all on sequence public\.%I from anon/i, "لا سحب على التسلسلات");
  // ⛔ ولا منحة لـanon في أيّ موضع.
  assert.ok(!/grant[^;]{0,120}\bto\b[^;]{0,40}\banon\b/i.test(t), "منحة صريحة لـanon في RUNME");
});

test("🔴 FINDING 1 · CRM POSTCHECK يفشل عند صلاحية anon", () => {
  const v = verdictOf(fs.readFileSync(path.join(DOCS, "crm_sales_FOUNDATION_POSTCHECK.sql"), "utf8"));
  assert.ok(v, "CRM POSTCHECK بلا حسم — وهو الملفّ الذي طبع ٦٠ صفًّا ثمّ PASS");
  assert.match(v, /role_table_grants[\s\S]{0,200}'anon','PUBLIC'/, "منح الجداول غير محتسَب");
  assert.match(v, /has_function_privilege\('anon'/, "تنفيذ الدوالّ لـanon غير محتسَب");
  assert.match(v, /privilege_type[\s\S]{0,40}<>\s*'SELECT'/, "authenticated بأكثر من SELECT غير محتسَب");
  // 🔴 وRLS لا يحمي TRUNCATE: لا يُقبل الاكتفاء بفحص RLS بدلًا من الصلاحيات.
  assert.match(v, /relrowsecurity/, "RLS غير محتسَب");
});

// FINDING 2 — Assets Archive: النمط التقط `signed_at` وهو تاريخ توقيع مشروع.
test("🔴 FINDING 2 · نمط الروابط لا يلتقط signed_at", () => {
  const t = code(fs.readFileSync(path.join(DOCS, "wave6_assets_archive_POSTCHECK.sql"), "utf8"));
  const m = t.match(/column_name::text ~\* '([^']+)'/);
  assert.ok(m, "فحص أعمدة الروابط مفقود");
  const re = new RegExp(m[1], "i");
  // ✅ عمود مشروع لا يُلتقط.
  for (const ok of ["signed_at", "withdrawn_at", "doc_path", "doc_bucket", "proof_path"]) {
    assert.ok(!re.test(ok), `🔴 إنذار كاذب على عمود مشروع: ${ok}`);
  }
  // 🔴 ورابطٌ فعليّ يبقى ملتقَطًا — ⛔ ولم يُخفَ العطب بتوسيع الاستثناء.
  for (const bad of ["signed_url", "doc_url", "url", "public_url", "href", "doc_link", "asset_uri"]) {
    assert.ok(re.test(bad), `🔴 رابط فعليّ لم يُلتقط: ${bad}`);
  }
});

test("🔴 FINDING 2 · signed_at عمود مطلوب في العقد", () => {
  const t = code(fs.readFileSync(path.join(DOCS, "wave6_assets_archive_RUNME.sql"), "utf8"));
  assert.match(t, /signed_at\s+date/, "signed_at غير معرَّف — راجع قبل اعتباره مشروعًا");
  assert.match(t, /expires_at\s*>=\s*signed_at/, "قيد mr_window لا يستعمل signed_at");
  // والعقد الحقيقيّ: bucket+path بلا رابط.
  assert.match(t, /doc_path\s*!~\*\s*'\^https\?:\/\/'/, "قيد منع الرابط مفقود");
});

test("🔴 FINDING 2 · عمود الرابط محتسَب في الحسم", () => {
  const v = verdictOf(fs.readFileSync(path.join(DOCS, "wave6_assets_archive_POSTCHECK.sql"), "utf8"));
  assert.match(v, /url\|uri\|href\|link/, "فحص الروابط مطبوع خارج الحسم");
});

// FINDING 3 — Global Search: الفحص كان يشترط `c.company_name` الذي حذفناه عمدًا.
test("🔴 FINDING 3 · الفحص يشترط العقد المعتمد لا العقد القديم", () => {
  const raw = fs.readFileSync(path.join(DOCS, "wave7_global_search_POSTCHECK.sql"), "utf8");
  const t = code(raw);
  assert.ok(!/~\s*'c\\\.company_name'\s+and/.test(t),
    "🔴 الفحص ما زال **يشترط** company_name — العمود الذي أثبتت Preview أنّه غير موجود");
  assert.match(t, /nullif\\\(btrim\\\(c\\\.company\\\)/, "لا يشترط عقد العميل المعتمد");
  const v = verdictOf(raw);
  assert.match(v, /company_name/, "عودة company_name غير محتسَبة في الحسم");
  assert.match(v, /nullif\\\(btrim\\\(c\\\.company\\\)/, "عقد العميل غير محتسَب في الحسم");
  assert.match(v, /d\\\.title/, "عمود المخرَجات غير محتسَب");
  assert.match(v, /a\\\.asset_name/, "عمود المعدّات غير محتسَب");
});

// ════════════════════════════════════════════════════════════════════════════
// ٤ · طفرات — ⛔ ولا يُلمس `docs/`
// ════════════════════════════════════════════════════════════════════════════
function mutate(file, from, to, check) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rel-pc-mut-"));
  try {
    const src = fs.readFileSync(path.join(DOCS, file), "utf8");
    const out = src.replace(from, to);
    assert.notEqual(out, src, `التشويه لم يُطبَّق على ${file}`);
    const p = path.join(dir, file);
    fs.writeFileSync(p, out);
    assert.throws(() => check(fs.readFileSync(p, "utf8")), assert.AssertionError,
      `🔴 طفرة غير مرصودة في ${file}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test("طفرة: RAISE EXCEPTION تصير NOTICE", () => {
  for (const f of ["crm_sales_FOUNDATION_POSTCHECK.sql", "wave6_assets_archive_POSTCHECK.sql",
                   "wave7_global_search_POSTCHECK.sql"]) {
    mutate(f, /raise\s+exception/gi, "raise notice",
      (s) => assert.ok(verdictOf(s), "الملفّ بلا حسم"));
  }
});

test("طفرة: حذف بلوك الحسم كليًّا (العودة إلى select صِرف)", () => {
  mutate("crm_sales_FOUNDATION_POSTCHECK.sql", /do \$verdict\$[\s\S]*$/, "",
    (s) => assert.ok(verdictOf(s), "الملفّ بلا حسم"));
});

test("طفرة: إسقاط شرط anon من حسم CRM", () => {
  mutate("crm_sales_FOUNDATION_POSTCHECK.sql",
    "'صلاحية جدول لـanon/PUBLIC'", "'(تشخيصيّ)'",
    (s) => {
      const v = verdictOf(s) ?? "";
      assert.match(v, /role_table_grants[\s\S]{0,200}'anon','PUBLIC'/);
      assert.match(v, /صلاحية جدول لـanon/);
    });
});

test("طفرة: توسيع نمط الروابط ليبتلع signed_url (إخفاء بدل إصلاح)", () => {
  mutate("wave6_assets_archive_POSTCHECK.sql",
    "'(^|_)(url|uri|href|link)($|_)'", "'^(url|uri|href|link)$'",
    (s) => {
      const m = code(s).match(/column_name::text ~\* '([^']+)'/);
      const re = new RegExp(m[1], "i");
      assert.ok(re.test("signed_url"), "رابط فعليّ لم يُلتقط");
    });
});

test("طفرة: تضييق النمط ليعود ملتقطًا signed_at", () => {
  mutate("wave6_assets_archive_POSTCHECK.sql",
    "'(^|_)(url|uri|href|link)($|_)'", "'(^|_)(url|href|signed)'",
    (s) => {
      const m = code(s).match(/column_name::text ~\* '([^']+)'/);
      const re = new RegExp(m[1], "i");
      assert.ok(!re.test("signed_at"), "إنذار كاذب على عمود مشروع: signed_at");
    });
});

test("طفرة: إعادة اشتراط company_name في Global Search", () => {
  mutate("wave7_global_search_POSTCHECK.sql",
    "when p.prosrc ~ 'c\\.company_name' then '🔴 عاد عمود clients.company_name غير الموجود'",
    "when p.prosrc !~ 'c\\.company_name' then '🔴 عمود مصدر تغيّر بلا داعٍ'",
    (s) => assert.ok(!/~\s*'c\\\.company_name'\s+then\s+'🔴 عمود مصدر تغيّر/.test(code(s)),
      "الفحص يشترط عمودًا غير موجود"));
});

test("طفرة: إخراج شرط من حسم Global Search", () => {
  mutate("wave7_global_search_POSTCHECK.sql",
    "v_fail := array_append(v_fail, 'clients.company_name عاد — عمود لا وجود له');", "null;",
    // ⚠️ يُشترط **الإضافة إلى الأعطاب** لا مجرّد ذكر الاسم: الشرط `if` يبقى
    //    قائمًا بعد التشويه، فمطابقةُ الكلمة وحدها تمرّ على حسمٍ مُفرَّغ.
    (s) => assert.match(verdictOf(s) ?? "",
      /array_append\(v_fail,\s*'clients\.company_name/));
});

// 🔴 وطفرة تُثبت أنّ المسح مشتقّ من **ترتيب الإصدار** لا من قائمة ثابتة:
//    حزمةٌ جديدة في الترتيب بلا حسم يجب أن تُرصد.
test("طفرة (عدم الدور): POSTCHECK بلا حسم يدخل ترتيب الإصدار", () => {
  const files = requiredPostchecks();
  assert.ok(files.includes("crm_sales_FOUNDATION_POSTCHECK.sql"),
    "القائمة ليست مشتقّة من ترتيب الإصدار");
  assert.equal(files.length, 11, `ترتيب الإصدار فيه ${files.length} حزمة — راجع العقد`);
});
