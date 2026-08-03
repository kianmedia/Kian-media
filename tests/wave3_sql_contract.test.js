// ════════════════════════════════════════════════════════════════════════════
// tests/wave3_sql_contract.test.js
//
// عقد حزمة Wave 3 الساكن. **لا تشغيل ولا اتصال بقاعدة** — قراءة نصّ فقط.
// الغرض: أن تُرصد مخالفة قرار D-1/D-2/D-3 في المستودع، لا على Production.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (r) => fs.readFileSync(path.join(ROOT, r), "utf8");
const P = (n) => `docs/wave3_production_ops_${n}.sql`;

/** يجرّد التعليقات والسلاسل النصّية، فلا يُحاكَم النصّ الشارح كأنّه كود. */
function codeOnly(sql) {
  let out = "", i = 0, q = false;
  while (i < sql.length) {
    const c = sql[i];
    if (q) { if (c === "'") { if (sql.startsWith("''", i)) { out += "  "; i += 2; continue; } q = false; } out += c === "\n" ? "\n" : " "; i++; continue; }
    if (c === "'") { q = true; out += " "; i++; continue; }
    if (sql.startsWith("--", i)) { while (i < sql.length && sql[i] !== "\n") { out += " "; i++; } continue; }
    out += c; i++;
  }
  return out;
}

const RUNME = () => codeOnly(read(P("RUNME")));

/**
 * يجرّد التعليقات **ويُبقي السلاسل**. لازم للتحقّق من رسائل الرفض نفسها:
 * `codeOnly` يمحو ما بين علامتي اقتباس، فلا يرى 'not authorized' إطلاقًا.
 */
const noComments = (sql) => sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
const RUNME_STR = () => noComments(read(P("RUNME")));

test("(Q-1) ★★ الحزمة كاملة: PREFLIGHT · RUNME · POSTCHECK · ROLLBACK ★★", () => {
  for (const n of ["PREFLIGHT", "RUNME", "POSTCHECK", "ROLLBACK"]) {
    assert.ok(fs.existsSync(path.join(ROOT, P(n))), `${n} مفقود — الحزمة ناقصة`);
    assert.ok(read(P(n)).length > 400, `${n} أقصر من أن يكون حقيقيًّا`);
  }
});

test("(Q-2) ★★★ لا مصدر موازٍ — قرارات D-1/D-2/D-3 مفروضة نصًّا ★★★", () => {
  const c = RUNME();
  // ⛔ لا جدول أوراق نداء ثالث ولا جدول مواقع رابع.
  for (const forbidden of ["call_sheets", "locations", "crew_members", "crew_assignments", "crew_documents", "project_templates"]) {
    const re = new RegExp(`create\\s+table\\s+(if\\s+not\\s+exists\\s+)?(public\\.)?${forbidden}\\b`, "i");
    assert.doesNotMatch(c, re, `🔴 RUNME يُنشئ جدولًا موازيًا: ${forbidden}`);
  }
  // ⛔ ولا يمسّ المُجمَّدين إطلاقًا.
  assert.doesNotMatch(c, /\b(alter|drop|delete\s+from|update)\s+[^;]*project_call_sheets/i,
    "🔴 RUNME يعدّل project_call_sheets وهو مُجمَّد (قرار W3-1)");
  assert.doesNotMatch(c, /\b(alter|drop|delete\s+from|update)\s+[^;]*project_locations/i,
    "🔴 RUNME يعدّل project_locations وهو مُجمَّد (قرار W3-1)");
  // ⛔ ولا عائلة دوال ثالثة — D-2 يفرض البادئة.
  const fns = [...c.matchAll(/create\s+or\s+replace\s+function\s+public\.([a-z0-9_]+)/gi)].map((m) => m[1]);
  assert.ok(fns.length > 0, "لا دوال في RUNME — الاختبار بلا معنى");
  for (const f of fns) {
    assert.ok(f.startsWith("prodops_"), `🔴 الدالّة ${f} خارج العائلة المعتمدة prodops_* (D-2)`);
  }
});

test("(Q-3) ★★★ إضافية بالكامل: لا إسقاط ولا حذف بيانات في RUNME ★★★", () => {
  const c = RUNME();
  assert.doesNotMatch(c, /drop\s+table/i, "🔴 RUNME يُسقط جدولًا");
  assert.doesNotMatch(c, /drop\s+column/i, "🔴 RUNME يُسقط عمودًا");
  assert.doesNotMatch(c, /truncate/i, "🔴 RUNME يفرّغ جدولًا");
  assert.doesNotMatch(c, /delete\s+from/i, "🔴 RUNME يحذف صفوفًا");
  // إسقاط القيد الوحيد مسموح لأنّه يُستبدَل فورًا في المعاملة نفسها.
  const dropped = [...c.matchAll(/drop\s+constraint\s+(if\s+exists\s+)?%?I?/gi)];
  assert.ok(dropped.length <= 1, "🔴 أكثر من قيد يُسقط — راجع النطاق");
  assert.match(c, /add\s+constraint\s+ops_job_weather_source_check/i,
    "🔴 القيد أُسقط ولم يُستبدَل — نافذة يُقبل فيها أيّ نصّ");
});

test("(Q-4) ★★ إعادة التشغيل آمنة ★★", () => {
  const c = RUNME();
  const adds = [...c.matchAll(/add\s+column\s+(if\s+not\s+exists\s+)?/gi)];
  assert.ok(adds.length > 0, "لا أعمدة مضافة");
  for (const m of adds) assert.ok(m[1], "🔴 add column بلا if not exists — إعادة التشغيل تفشل");
  assert.match(c, /create\s+index\s+if\s+not\s+exists/i, "الفهرس بلا if not exists");
  assert.match(c, /create\s+or\s+replace\s+function/i, "الدالّة ليست قابلة للاستبدال");
  // القيود تُضاف داخل حارس وجود، لا مباشرة.
  assert.match(c, /if\s+not\s+exists\s*\(\s*select\s+1\s+from\s+pg_constraint/i,
    "🔴 قيد يُضاف بلا فحص وجود — إعادة التشغيل تفشل بـ42710");
});

test("(Q-5) ★★★ الأمن: الدالّة محروسة، وanon لا يملك شيئًا ★★★", () => {
  const c = RUNME();
  assert.match(c, /security\s+definer/i, "الدالّة ليست security definer");
  assert.match(c, /set\s+search_path\s*=\s*public/i, "🔴 security definer بلا search_path مثبَّت");
  assert.match(c, /prodops_can_manage\(\)/, "🔴 الدالّة بلا بوّابة صلاحية");
  assert.match(RUNME_STR(), /raise\s+exception\s+'not authorized'/i, "لا رفض صريح");
  assert.match(c, /revoke\s+all\s+on\s+function[^;]*from\s+public,\s*anon/i,
    "🔴 لا REVOKE عن public/anon — وهو سبب حادثة تسريب سابقة");
  assert.match(c, /grant\s+execute\s+on\s+function[^;]*to\s+authenticated/i, "لا GRANT للمُصادَق");
  // ⛔ ولا خروج من القاعدة إلى الشبكة (G7).
  for (const re of [/pg_net/i, /\bnet\.http/i, /\bhttp_(get|post)\b/i, /dblink/i]) {
    assert.doesNotMatch(c, re, "🔴 اتصال شبكيّ من داخل القاعدة");
  }
});

test("(Q-6) ★★ الأفق ٤٨ ساعة مفروض في القاعدة لا في الواجهة وحدها ★★", () => {
  const c = RUNME();
  assert.match(c, /current_date\s*\+\s*2/, "🔴 لا حدّ أفق في القاعدة — أوّل مستدعٍ جديد يلتفّ عليه");
  assert.match(RUNME_STR(), /raise\s+exception\s+'beyond_forecast_horizon'/, "لا رسالة رفض صريحة للأفق");
  // والحدّ نفسه في الكود.
  const w = read("lib/production/weather.ts");
  assert.match(w, /HORIZON_HOURS\s*=\s*48/, "الحدّ في الكود ليس ٤٨");
});

test("(Q-7) ★★ RUNME معاملة واحدة، وPREFLIGHT/POSTCHECK لا يكتبان ★★", () => {
  const r = RUNME();
  assert.match(r, /^\s*begin;/im, "RUNME بلا begin");
  assert.match(r, /commit;\s*$/im, "RUNME بلا commit");
  for (const n of ["PREFLIGHT", "POSTCHECK"]) {
    const c = codeOnly(read(P(n)));
    for (const re of [/\bcreate\s+(table|function|index)/i, /\balter\s+table/i, /\binsert\s+into/i, /\bupdate\s+\w/i, /\bdelete\s+from/i, /\bdrop\s+/i]) {
      assert.doesNotMatch(c, re, `🔴 ${n} يكتب — ويُفترض أنّه آمن على Production`);
    }
  }
});

test("(Q-8) ★★ ROLLBACK متحفّظ: لا يحذف بيانات بلا قصد صريح ★★", () => {
  const raw = read(P("ROLLBACK"));
  const c = codeOnly(raw);
  // إسقاط الأعمدة موجود لكنّه **معلَّق** — يحتاج فعلًا واعيًا.
  assert.doesNotMatch(c, /drop\s+column/i, "🔴 ROLLBACK يُسقط أعمدة تلقائيًّا");
  assert.match(raw, /--\s*alter table public\.ops_call_sheets drop column/i,
    "مسار الإزالة التامّة غير موثَّق حتى معلَّقًا");
  assert.match(c, /drop\s+function\s+if\s+exists\s+public\.prodops_weather_record/i,
    "ROLLBACK لا يزيل الدالّة");
});

test("(Q-9) ★★★ وثيقة شرط الدخول موجودة وتحسم الثلاثة ★★★", () => {
  const rel = "docs/wave-reports/WAVE_3_ENTRY_DUPLICATION_RESOLUTION.md";
  assert.ok(fs.existsSync(path.join(ROOT, rel)), "🔴 شرط الدخول الإلزامي غير موثَّق");
  const d = read(rel);
  for (const k of ["D-1", "D-2", "D-3"]) assert.ok(d.includes(k), `${k} غير محسوم`);
  // المصادر المعتمدة مذكورة صراحةً.
  for (const k of ["ops_call_sheets", "prodops_call_sheet", "ops_locations"]) {
    assert.ok(d.includes(k), `المصدر المعتمد ${k} غير مذكور`);
  }
  // والقرار المعلَّق مسجَّل بوصفه معلَّقًا، لا محسومًا ضمنًا.
  assert.match(d, /W3-1/, "قرار الترحيل غير مسجَّل");
  assert.match(d, /PENDING ROW COUNT/, "قرار الترحيل لم يُصنَّف كمعلَّق");
});
