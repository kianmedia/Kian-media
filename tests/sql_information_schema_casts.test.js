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
test("🔴 prodops_touch مستبعَدة بالاسم، ⛔ ولا بنمط يبتلع غيرها", () => {
  for (const f of ["wave3_permits_media_POSTCHECK.sql", "wave3_calendar_tokens_POSTCHECK.sql"]) {
    const t = code(fs.readFileSync(path.join(DOCS, f), "utf8"));
    assert.match(t, /routine_name::text\s*<>\s*'prodops_touch'/,
      `${f}: prodops_touch غير مستبعَدة بالاسم`);
    // ⛔ ولا استبعاد جماعيّ يُخفي دوالّ حقيقية.
    assert.ok(!/routine_name\s+not\s+like\s+'prodops_%'/i.test(t),
      `${f}: استبعاد جماعيّ يُبطل الفحص`);
  }
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
