// ════════════════════════════════════════════════════════════════════════════
// tests/sql_information_schema_casts.test.js
//
// يمنع رجوع خطأ وقت التشغيل:
//     ERROR: operator does not exist: information_schema.sql_identifier[] = text[]
//
// ★ لماذا يقع هذا الخطأ ★
//   أعمدة `information_schema` مثل `grantee` و`routine_name` و`table_name`
//   نوعها **`information_schema.sql_identifier`** (نطاق فوق `name`) لا `text`.
//   ومقارنة عنصر مفرد بحرف نصّيّ تعمل (الحرف غير محدَّد النوع فيُوفَّق)، لكنّ
//   **مقارنة المصفوفات لا تُوفَّق ضمنيًّا**: فـ`array_agg(grantee)` يعطي
//   `sql_identifier[]`، و`array['service_role']` يعطي `text[]`، ولا مُعامل
//   بينهما ⇒ يفشل الاستعلام كلّه وقت التشغيل لا وقت الكتابة.
//
// 🔴 والأسوأ أنّ الفشل يقع في ملفّ **POSTCHECK**: أي بعد تطبيق التغيير على
//    قاعدة حيّة، فيبدو كأنّ التطبيق نفسه فشل، ويُجهض ما تبقّى من فحوص.
//
// ⛔ لا اتصال بقاعدة: تحليل نصّيّ ساكن لملفّات SQL في المستودع.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DOCS = path.join(ROOT, "docs");

/** يجرّد تعليقات `--` ويُبقي السلاسل، فلا يُحاكَم الشرح كأنّه كود. */
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

const sqlFiles = fs.readdirSync(DOCS)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => ({ f, text: code(fs.readFileSync(path.join(DOCS, f), "utf8")) }));

/** الأعمدة التي نوعها `sql_identifier` في information_schema. */
const IDENT_COLS = [
  "grantee", "grantor", "routine_name", "routine_schema", "specific_name",
  "table_name", "table_schema", "column_name", "constraint_name",
  "constraint_schema", "udt_name", "trigger_name",
];

/** هل يستعمل هذا الملفّ information_schema أصلًا؟ */
const usesInfoSchema = (t) => /information_schema\./i.test(t);

// ─── ١ · 🔴 القاعدة الأساسية: array_agg على عمود هويّة يجب أن يُحوَّل ───────
test("🔴 array_agg على عمود information_schema يُحوَّل إلى text", () => {
  const bad = [];
  for (const { f, text } of sqlFiles) {
    if (!usesInfoSchema(text)) continue;
    for (const col of IDENT_COLS) {
      // array_agg( [distinct] col ...) بلا ::text على العمود
      const re = new RegExp(`array_agg\\s*\\(\\s*(?:distinct\\s+)?${col}\\b(?!\\s*::\\s*text)`, "gi");
      for (const m of text.match(re) ?? []) bad.push(`${f}: ${m.trim()}`);
    }
  }
  assert.deepEqual(bad, [],
    "array_agg على عمود sql_identifier بلا ::text — سيفشل عند مقارنته بـtext[]:\n" +
    bad.join("\n"));
});

// ─── ٢ · والطرف الآخر: array[...] المُقارَن يجب أن يُحوَّل ─────────────────
test("🔴 مصفوفة الحرفيّات المقارَنة بـarray_agg تُحوَّل إلى text[]", () => {
  const bad = [];
  for (const { f, text } of sqlFiles) {
    if (!usesInfoSchema(text)) continue;
    // array_agg(...) = array[...]  بلا ::text[] على الطرف الأيمن
    const re = /array_agg\s*\([^)]*\)(?:\s*order\s+by[^=]*?)?\s*=\s*array\s*\[[^\]]*\](?!\s*::\s*text\s*\[\s*\])/gi;
    for (const m of text.match(re) ?? []) bad.push(`${f}: ${m.replace(/\s+/g, " ").slice(0, 90)}`);
  }
  assert.deepEqual(bad, [],
    "مقارنة array_agg بـarray[...] بلا ::text[] — نفس خطأ sql_identifier[] = text[]:\n" +
    bad.join("\n"));
});

// ─── ٣ · الملفّان اللذان فشلا فعلًا على Preview ────────────────────────────
test("🔴 الملفّان المُصلَحان: لا مقارنة مصفوفات بلا تحويل", () => {
  for (const f of ["wave3_permits_media_POSTCHECK.sql", "wave3_calendar_tokens_POSTCHECK.sql"]) {
    const text = code(fs.readFileSync(path.join(DOCS, f), "utf8"));
    const aggs = text.match(/array_agg\s*\([^)]*\)/gi) ?? [];
    assert.ok(aggs.length > 0, `${f}: لا array_agg إطلاقًا — هل حُذف الفحص؟`);
    for (const a of aggs) {
      assert.match(a, /::\s*text/i, `${f}: array_agg بلا ::text ⇒ ${a.slice(0, 70)}`);
    }
  }
});

test("permits: مصفوفة المِنَح المتوقَّعة مُحوَّلة ومقارنتها بالاحتواء", () => {
  const t = code(fs.readFileSync(path.join(DOCS, "wave3_permits_media_POSTCHECK.sql"), "utf8"));
  assert.match(t, /array\[[^\]]*'service_role'[^\]]*\]\s*::\s*text\s*\[\s*\]/i,
    "مصفوفة الأدوار المتوقَّعة بلا ::text[]");
  // ⚠️ الاحتواء `<@` لا المساواة: المالك يظهر ضمن المِنَح، والمساواة تفشل عليه.
  assert.match(t, /<@\s*array\[/, "المقارنة مساواة لا احتواء — ستفشل بظهور المالك");
});

test("calendar: مقارنة routine_name مُحوَّلة على الطرفين", () => {
  const t = code(fs.readFileSync(path.join(DOCS, "wave3_calendar_tokens_POSTCHECK.sql"), "utf8"));
  assert.match(t, /array_agg\s*\(\s*routine_name\s*::\s*text/i, "array_agg بلا ::text");
  assert.match(t, /=\s*array\[\s*'prodops_calendar_feed'\s*\]\s*::\s*text\s*\[\s*\]/i,
    "الطرف الأيمن بلا ::text[]");
});

// ─── ٤ · قبول المالك — ولا يتحوّل ذلك إلى قبول الجميع ─────────────────────
test("🔴 قبول المالك محصور بأدوار إدارية مسمّاة", () => {
  const t = code(fs.readFileSync(path.join(DOCS, "wave3_permits_media_POSTCHECK.sql"), "utf8"));
  const m = t.match(/<@\s*array\[([^\]]*)\]/);
  assert.ok(m, "لا قائمة أدوار مقبولة");
  const roles = m[1].split(",").map((r) => r.trim().replace(/'/g, ""));
  assert.ok(roles.includes("service_role"), "service_role ليست ضمن المقبول");
  assert.ok(roles.includes("postgres"), "المالك postgres غير مقبول — سيفشل زورًا");
  // 🔴 ولا يتسلّل دور عميل إلى القائمة تحت غطاء «المالك».
  for (const bad of ["anon", "authenticated", "public", "PUBLIC"]) {
    assert.ok(!roles.includes(bad), `🔴 ${bad} ضمن الأدوار المقبولة — تخفيف للأمن`);
  }
});

// ─── ٥ · الصلاحية الفعلية تُفحص لا سطور الجدول وحدها ──────────────────────
test("🔴 فحص has_function_privilege يثبت anon=false و authenticated=false", () => {
  const t = code(fs.readFileSync(path.join(DOCS, "wave3_permits_media_POSTCHECK.sql"), "utf8"));
  assert.match(t, /has_function_privilege\s*\(\s*'anon'[^)]*'EXECUTE'\s*\)\s*=\s*false/i,
    "لا إثبات أنّ anon بلا تنفيذ");
  assert.match(t, /has_function_privilege\s*\(\s*'authenticated'[^)]*'EXECUTE'\s*\)\s*=\s*false/i,
    "لا إثبات أنّ authenticated بلا تنفيذ");
  assert.match(t, /has_function_privilege\s*\(\s*'service_role'[^)]*'EXECUTE'\s*\)\s*=\s*true/i,
    "لا إثبات أنّ service_role يملك التنفيذ");
  // ⚠️ ودور مفقود يجب أن يُميَّز عن صلاحية خاطئة، وإلّا أجهض الملفّ كلّه.
  assert.match(t, /to_regrole\s*\(/, "لا حارس لدور غير موجود — has_function_privilege ترمي خطأً");
});

// ─── ٦ · استبعاد دالّة المُشغِّل — بالاسم الصريح وحده ─────────────────────
test("🔴 prodops_touch خارج الفحص — بالنطاق في permits وبالاسم في calendar", () => {
  // permits_media: الفحص صار **محصورًا بقائمة صريحة**، فدالّة المُشغِّل لا
  // يمكن أن تدخله أصلًا — وهذا أقوى من استثنائها بالاسم.
  const permits = code(fs.readFileSync(path.join(DOCS, "wave3_permits_media_POSTCHECK.sql"), "utf8"));
  assert.ok(!/routine_name\s+like\s+'prodops_%'/i.test(permits),
    "permits: عاد المسح على مساحة الاسم — يعود العيب التابع للترتيب");
  assert.match(permits, /with pkg\s*\(\s*fname\s*,\s*fargs/,
    "permits: لا قائمة حزمة صريحة");
  assert.ok(!/prodops_touch/.test(permits),
    "permits: لا حاجة لذكر prodops_touch بعد الحصر — وذكره يوحي بأنّ النطاق ما يزال واسعًا");

  // calendar: ما يزال يسرد `prodops%` لغرض إعلاميّ، فيبقى الاستثناء بالاسم لازمًا.
  const cal = code(fs.readFileSync(path.join(DOCS, "wave3_calendar_tokens_POSTCHECK.sql"), "utf8"));
  assert.match(cal, /routine_name::text\s*<>\s*'prodops_touch'/,
    "calendar: prodops_touch غير مستبعَدة بالاسم");
  assert.ok(!/routine_name\s+not\s+like\s+'prodops_%'/i.test(cal),
    "calendar: استبعاد جماعيّ يُبطل الفحص");
});

test("prodops_touch دالّة مُشغِّل فعلًا — الاستبعاد مبرَّر لا تعسّفيّ", () => {
  const runme = fs.readFileSync(path.join(DOCS, "operations_center_RUNME.sql"), "utf8");
  assert.match(runme, /create or replace function public\.prodops_touch\(\)\s*returns trigger/i,
    "prodops_touch ليست دالّة مُشغِّل — الاستبعاد غير مبرَّر");
});

// ─── ٧ · ⛔ الملفّان يبقيان للقراءة فقط ────────────────────────────────────
test("⛔ POSTCHECK لا يكتب شيئًا", () => {
  for (const f of ["wave3_permits_media_POSTCHECK.sql", "wave3_calendar_tokens_POSTCHECK.sql"]) {
    const t = code(fs.readFileSync(path.join(DOCS, f), "utf8"));
    for (const w of [/\binsert\s+into\b/i, /\bupdate\s+\w+\s+set\b/i, /\bdelete\s+from\b/i,
                     /\bcreate\s+(table|function)\b/i, /\balter\s+table\b/i,
                     /\bdrop\s+\w/i, /\bgrant\b/i, /\brevoke\b/i]) {
      assert.ok(!w.test(t), `${f} يكتب: ${w}`);
    }
  }
});

// ─── ٨ · العقد الأمنيّ للتقويم لم يُمَسّ ───────────────────────────────────
test("عقد التقويم الأمنيّ باقٍ كما هو", () => {
  const t = code(fs.readFileSync(path.join(DOCS, "wave3_calendar_tokens_POSTCHECK.sql"), "utf8"));
  for (const needle of ["p_token", "digest", "prosecdef", "search_path",
                        "ops_calendar_tokens", "revoked", "expired", "exhausted"]) {
    assert.ok(t.includes(needle), `فُقد فحص: ${needle}`);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// ٩ · 🔴 انحدار النطاق — فحص permits_media لا يتأثّر بحزم أخرى
//
// العيب: كان يمسح `prodops_%`، فلمّا طُبِّقت حزمة calendar_tokens ظهرت
// `prodops_calendar_feed` — الممنوحة لـ`anon` **عن قصد** — فأحمرّ الفحص.
// أي أنّه صار تابعًا لترتيب التطبيق وغير صالح لإعادة التشغيل.
//
// ⚠️ هذا الاختبار **ينفّذ منطق الفحص** لا يقرؤه: يستخرج قائمة الحزمة من الـSQL
//    نفسه، ويبني فهرسًا وهميًّا فيه دالّة التقويم بصلاحية anon، ثمّ يطبّق قاعدة
//    الحصر (الاسم + التوقيع) ويتأكّد أنّ النتيجة تبقى خضراء.
// ════════════════════════════════════════════════════════════════════════════

/** يستخرج (fname, fargs, expect_authenticated) من كتلة `with pkg(...) as (values …)`. */
function packageScope() {
  const t = code(fs.readFileSync(path.join(DOCS, "wave3_permits_media_POSTCHECK.sql"), "utf8"));
  const block = t.slice(t.indexOf("with pkg("), t.indexOf("resolved as ("));
  const rows = [...block.matchAll(/\(\s*'([a-z0-9_]+)'\s*,\s*'([^']*)'\s*,\s*(true|false)\s*\)/gi)]
    .map((m) => ({ fname: m[1], fargs: m[2], expectAuth: m[3] === "true" }));
  return rows;
}

/** قاعدة الحصر كما في SQL: مطابقة الاسم **والتوقيع** معًا. */
const inScope = (scope, fn) =>
  scope.some((s) => s.fname === fn.proname && s.fargs === fn.identityArgs);

test("🔴 قائمة الحزمة تطابق ما يُنشئه RUNME بالضبط", () => {
  const scope = packageScope();
  const runme = fs.readFileSync(path.join(DOCS, "wave3_permits_media_RUNME.sql"), "utf8");
  const created = [...runme.matchAll(/^create or replace function public\.([a-z0-9_]+)/gim)]
    .map((m) => m[1]);
  assert.deepEqual([...scope.map((s) => s.fname)].sort(), [...new Set(created)].sort(),
    "قائمة النطاق لا تطابق دوالّ RUNME — إمّا فحص ناقص أو نطاق متضخّم");
});

test("🔴 وجود prodops_calendar_feed بصلاحية anon لا يُحمِّر فحص permits_media", () => {
  const scope = packageScope();
  // فهرس وهميّ: دوالّ الحزمة سليمة + دالّة التقويم من حزمة أخرى بصلاحية anon.
  const catalog = [
    ...scope.map((s) => ({
      proname: s.fname, identityArgs: s.fargs,
      anon: false, pub: false,
      authenticated: s.expectAuth, service_role: !s.expectAuth,
    })),
    // 🔴 الدخيل: ممنوحة لـanon عن قصد، وخارج الحزمة تمامًا.
    { proname: "prodops_calendar_feed", identityArgs: "text",
      anon: true, pub: false, authenticated: true, service_role: true },
    // ودالّة مُشغِّل بصلاحية PUBLIC افتراضية — خارج النطاق أيضًا.
    { proname: "prodops_touch", identityArgs: "",
      anon: true, pub: true, authenticated: true, service_role: true },
  ];

  const scoped = catalog.filter((fn) => inScope(scope, fn));
  assert.equal(scoped.length, scope.length, "الحصر أسقط أو أضاف دالّة");
  assert.ok(!scoped.some((f) => f.proname === "prodops_calendar_feed"),
    "🔴 دالّة التقويم دخلت نطاق permits_media");
  assert.ok(!scoped.some((f) => f.proname === "prodops_touch"),
    "🔴 دالّة المُشغِّل دخلت النطاق");

  // نتائج الفحوص الثلاثة كما يحسبها SQL:
  assert.deepEqual(scoped.filter((f) => f.anon).map((f) => f.proname), [],
    "🔴 فحص anon أحمر رغم أنّ المخالف خارج الحزمة");
  assert.deepEqual(scoped.filter((f) => f.pub).map((f) => f.proname), [],
    "🔴 فحص PUBLIC أحمر بسبب دالّة خارج الحزمة");
  const authDeviation = scoped.filter(
    (f) => f.authenticated !== scope.find((s) => s.fname === f.proname).expectAuth);
  assert.deepEqual(authDeviation.map((f) => f.proname), [], "انحراف في صلاحية authenticated");
});

test("🔴 ولا يتساهل النطاق: مخالفة داخل الحزمة تُرصد", () => {
  const scope = packageScope();
  const catalog = scope.map((s) => ({
    proname: s.fname, identityArgs: s.fargs,
    // الطفرة: تسريب anon على دالّة **من الحزمة** نفسها.
    anon: s.fname === "prodops_permits_list",
    pub: false, authenticated: s.expectAuth,
  }));
  const scoped = catalog.filter((fn) => inScope(scope, fn));
  assert.deepEqual(scoped.filter((f) => f.anon).map((f) => f.proname), ["prodops_permits_list"],
    "🔴 الحصر أخفى تسريبًا حقيقيًّا داخل الحزمة");
});

test("🔴 التوقيع جزء من الحصر — اسم مطابق بتوقيع مختلف لا يُقبل", () => {
  const scope = packageScope();
  const impostor = { proname: "prodops_permits_list", identityArgs: "text, text", anon: true };
  assert.ok(!inScope(scope, impostor),
    "🔴 قُبلت دالّة بنفس الاسم وتوقيع مختلف — قد تُخفي غياب دالّة الحزمة");
});

test("⛔ الحصر لا يعتمد على استثناء بالاسم", () => {
  const t = code(fs.readFileSync(path.join(DOCS, "wave3_permits_media_POSTCHECK.sql"), "utf8"));
  assert.ok(!/prodops_calendar_feed/.test(t),
    "🔴 استُثنيت دالّة التقويم بالاسم — حلّ مؤقّت يكسر مع أوّل حزمة قادمة");
});

test("عبارة واحدة: WITH يرتبط ببيان واحد فقط", () => {
  const t = code(fs.readFileSync(path.join(DOCS, "wave3_permits_media_POSTCHECK.sql"), "utf8"));
  const block = t.slice(t.indexOf("with pkg("), t.indexOf("from flags;") + "from flags;".length);
  assert.equal((block.match(/;/g) ?? []).length, 1,
    "🔴 أكثر من فاصلة منقوطة داخل كتلة WITH ⇒ `relation \"resolved\" does not exist`");
  assert.ok(/union all/i.test(block), "الفحوص ليست موحَّدة في بيان واحد");
});

// ════════════════════════════════════════════════════════════════════════════
// ١٠ · 🔴 توقّعات **مستقلّة** عن الملفّ المفحوص
//
// الاختبارات أعلاه تستخرج قائمة الحزمة من POSTCHECK نفسه، فهي تتحقّق من
// **اتّساقه الداخليّ** لا من صحّته. وقد أثبتت طفرتان أنّ ذلك لا يكفي:
//   • حذف شرط التوقيع من الـJOIN مرّ دون رصد.
//   • قلب توقّع `authenticated` لمحرّك التنبيهات مرّ دون رصد.
// فالتوقّع هنا يُشتقّ من **RUNME** — مصدر الحقيقة — لا من POSTCHECK.
// ════════════════════════════════════════════════════════════════════════════

/** يقرأ المِنَح الفعلية من RUNME: أيّ دالّة مُنحت لـauthenticated. */
function runmeGrants() {
  const t = fs.readFileSync(path.join(DOCS, "wave3_permits_media_RUNME.sql"), "utf8");
  const granted = new Set();
  for (const m of t.matchAll(/grant\s+execute\s+on\s+function\s+public\.([a-z0-9_]+)\s*\([^)]*\)\s*to\s+([a-z_ ,]+);/gi)) {
    if (/\bauthenticated\b/i.test(m[2])) granted.add(m[1]);
  }
  return granted;
}

test("🔴 توقّع authenticated في POSTCHECK يطابق مِنَح RUNME — لا يُشتقّ من نفسه", () => {
  const scope = packageScope();
  const granted = runmeGrants();
  assert.ok(granted.size > 0, "لم تُقرأ أيّ مِنحة من RUNME — المُحلِّل معطوب");
  for (const s of scope) {
    const expected = granted.has(s.fname);
    assert.equal(s.expectAuth, expected,
      `🔴 ${s.fname}: POSTCHECK يتوقّع authenticated=${s.expectAuth} ` +
      `بينما RUNME ${expected ? "يمنحها" : "لا يمنحها"}`);
  }
});

test("🔴 محرّك التنبيهات محجوب عن authenticated في RUNME وPOSTCHECK معًا", () => {
  const granted = runmeGrants();
  assert.ok(!granted.has("prodops_permit_alerts_run"),
    "RUNME يمنح محرّك التنبيهات لـauthenticated — تخفيف للأمن");
  const scope = packageScope();
  const row = scope.find((s) => s.fname === "prodops_permit_alerts_run");
  assert.ok(row, "محرّك التنبيهات خارج نطاق الفحص");
  assert.equal(row.expectAuth, false,
    "🔴 POSTCHECK يتوقّع أنّ authenticated يشغّل محرّك التنبيهات");
});

test("🔴 الـJOIN يطابق التوقيع لا الاسم وحده", () => {
  const t = code(fs.readFileSync(path.join(DOCS, "wave3_permits_media_POSTCHECK.sql"), "utf8"));
  const join = t.slice(t.indexOf("left join pg_proc"), t.indexOf("flags as ("));
  assert.match(join, /pg_get_function_identity_arguments\s*\(\s*p\.oid\s*\)\s*=\s*k\.fargs/,
    "🔴 الربط بالاسم وحده — دالّة بنفس الاسم من حزمة أخرى تدخل النطاق");
  assert.match(join, /p\.proname\s*=\s*k\.fname/, "لا ربط بالاسم");
  assert.match(join, /pronamespace\s*=\s*'public'::regnamespace/, "لا حصر بمخطّط public");
});

test("🔴 ACL الفارغ يُعامَل تسريبًا لا حالة سليمة", () => {
  const t = code(fs.readFileSync(path.join(DOCS, "wave3_permits_media_POSTCHECK.sql"), "utf8"));
  assert.match(t, /proacl is null\s*\n?\s*or\s+exists/i,
    "🔴 `proacl is null` لا يُحتسب — ودالّة بلا REVOKE صريح يملكها PUBLIC ضمنًا");
  assert.match(t, /aclexplode\s*\([^)]*\)[\s\S]{0,120}?grantee\s*=\s*0/,
    "لا فحص لمِنحة PUBLIC عبر aclexplode (grantee=0)");
});
