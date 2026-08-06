// ════════════════════════════════════════════════════════════════════════════
// tests/wave7_global_search.test.js
//
// Wave 7 · V2-7.1-A — البحث الشامل عبر Postgres FTS.
//
// ⛔ لا SQL يُشغَّل · لا قاعدة · لا شبكة · لا خدمة بحث خارجية.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (r) => fs.readFileSync(path.join(ROOT, r), "utf8");
const has = (r) => fs.existsSync(path.join(ROOT, r));

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
const noComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
const bodyOf = (src, name) => {
  const t = noComments(src);
  const i = t.indexOf(`function public.${name}`);
  return i < 0 ? "" : t.slice(i, t.indexOf("$$;", i));
};

const SQL = () => read("docs/wave7_global_search_RUNME.sql");
const UI = () => read("components/portal/CommandPalette.tsx");

const catches = (label, mutate, check) => {
  const m = mutate(SQL());
  assert.notEqual(m, SQL(), `الطفرة لم تغيّر شيئًا: ${label}`);
  let threw = false;
  try { check(m); } catch { threw = true; }
  assert.ok(threw, `🔴 الطفرة لم تُرصد: ${label}`);
};

test("(S-1) ★★ الحزمة كاملة ★★", () => {
  for (const n of ["PREFLIGHT", "RUNME", "POSTCHECK", "ROLLBACK"]) {
    assert.ok(has(`docs/wave7_global_search_${n}.sql`), `${n} مفقود`);
  }
});

test("(S-2) ★★★ بلا خدمة خارجية · ولا نسخة ثانية من البيانات ★★★", () => {
  const c = codeOnly(SQL());
  // ⛔ لا جدول فهرسة: نسخة ثانية للبيانات تتقادم.
  assert.doesNotMatch(c, /create\s+table/i, "🔴 جدول فهرسة — نسخة ثانية");
  // ⛔ ولا خروج إلى الشبكة من القاعدة.
  for (const re of [/pg_net/i, /http_(get|post)/i, /elastic/i, /algolia/i, /meilisearch/i, /typesense/i]) {
    assert.doesNotMatch(c, re, "🔴 خدمة بحث خارجية");
  }
  // الفهارس تعبيرية — لا تغيير شكل أيّ جدول.
  assert.match(c, /create index if not exists projects_fts_idx[\s\S]{0,120}using gin/i, "لا فهرس GIN");
  assert.doesNotMatch(c, /add column[^;]*tsvector/i, "🔴 عمود tsvector — تغيير شكل جدول حيّ");
});

test("(S-3) ★★★ التطبيع العربيّ شرط عمل لا تحسين ★★★", () => {
  const fn = bodyOf(SQL(), "search_norm");
  assert.ok(fn.length > 0, "دالّة التطبيع مفقودة");
  // 🔴 الألف بأشكالها والياء والتاء المربوطة — بلا توحيدها يفشل البحث صامتًا.
  const s = noComments(SQL());
  assert.match(s, /translate\(/, "لا توحيد للحروف");
  assert.ok(/أإآ/.test(s), "🔴 الألف بأشكالها غير موحَّدة");
  assert.match(s, /regexp_replace\(/, "لا إزالة للتشكيل");
  assert.match(s, /lower\(/, "لا توحيد لحالة الأحرف");
  // الإعداد `simple` عمدًا — لا جذوع عربية في Postgres الافتراضيّ.
  assert.match(s, /to_tsvector\('simple'/, "🔴 إعداد لغويّ غير مناسب للعربية");
  assert.match(s, /websearch_to_tsquery\('simple'/, "الاستعلام بإعداد مختلف عن الفهرس");
  // والدوالّ immutable — وإلّا لا يمكن بناء فهرس عليها.
  for (const f of ["search_norm", "search_vector", "search_query"]) {
    assert.match(bodyOf(SQL(), f) || s, /immutable/i, `🔴 ${f} ليست immutable — الفهرس يفشل`);
  }
});

test("(S-4) ★★★ التصفية داخل الاستعلام — لا جمع ثمّ تصفية ★★★", () => {
  const fn = bodyOf(SQL(), "global_search");
  // 🔴 بوّابة كلّ مصدر داخل WHERE أو حول الكتلة، لا بعد التجميع.
  assert.match(fn, /can_access_project\(p\.id\)/, "🔴 المشاريع بلا بوّابة في الاستعلام");
  assert.match(fn, /can_access_project\(d\.project_id\)/, "🔴 المخرَجات بلا بوّابة");
  assert.match(fn, /if public\.civ_can_view_assets\(\) then/, "🔴 المعدّات بلا بوّابة");
  assert.match(fn, /if public\.can_manage_projects\(\) then/, "🔴 العملاء بلا بوّابة");
  // ومستدعٍ بلا هويّة يُرفض.
  assert.match(fn, /auth\.uid\(\) is null/, "🔴 مستدعٍ مجهول يمرّ");
  // ⛔ ولا حقل حسّاس في أيّ نتيجة.
  for (const leak of ["purchase_price", "current_value", "phone", "email", "storage_path",
                      "file_path", "salary", "amount"]) {
    assert.ok(!fn.includes(leak), `🔴 حقل حسّاس في نتيجة بحث: ${leak}`);
  }

  catches("إسقاط بوّابة المشاريع",
    // ⚠️ حُدِّث النصّ بعد تصحيح `to_regproc` ← `to_regprocedure`: الطفرة بالنصّ
    //    القديم صارت بلا أثر، فرصدها الاختبار بحقّ («الطفرة لم تغيّر شيئًا»).
    (m) => m.replace("       and (to_regprocedure('public.can_access_project(uuid)') is null\n            or public.can_access_project(p.id))\n", ""),
    (m) => assert.match(bodyOf(m, "global_search"), /can_access_project\(p\.id\)/));
});

test("(S-5) ★★ استعلام قصير أو بلا كلمات لا يُرجع كلّ شيء ★★", () => {
  const fn = bodyOf(SQL(), "global_search");
  assert.match(fn, /length\(btrim\(coalesce\(p_q,''\)\)\) < 2/, "🔴 حرف واحد يبحث");
  assert.match(fn, /query_too_short/, "لا سبب صريح");
  assert.match(fn, /no_searchable_terms/, "🔴 استعلام بلا كلمات قد يمرّ");
  // وسقف النتائج مقيَّد.
  assert.match(fn, /least\(greatest\(coalesce\(p_limit, 20\), 1\), 50\)/, "🔴 سقف غير مقيَّد");
});

test("(S-6) ★★ الأمن: REVOKE قبل GRANT · لا anon · search_path مثبَّت ★★", () => {
  const c = codeOnly(SQL());
  const fns = [...c.matchAll(/create\s+or\s+replace\s+function\s+public\.([a-z0-9_]+)/gi)].map((m) => m[1]);
  assert.ok(fns.length >= 4, `عدد الدوالّ ${fns.length}`);
  for (const f of fns) {
    assert.match(c, new RegExp(`revoke all on function public\\.${f}\\(`), `🔴 ${f} بلا REVOKE`);
  }
  // 🔴 البحث يكشف وجود سجلّات — فلا شيء لـanon.
  assert.doesNotMatch(c, /grant execute on function[^;]*\banon\b/i, "🔴 دالّة بحث لـanon");
  assert.doesNotMatch(c, /grant\s+all\b/i, "🔴 منح شامل");
  for (const m of c.matchAll(/language plpgsql[^;]*?security definer([^;]*?)as \$\$/gi)) {
    assert.match(m[1], /set search_path = public/, "🔴 security definer بلا search_path");
  }
  // PREFLIGHT/POSTCHECK لا يكتبان.
  for (const n of ["PREFLIGHT", "POSTCHECK"]) {
    const q = codeOnly(read(`docs/wave7_global_search_${n}.sql`));
    for (const re of [/\bcreate\s+(table|function|index|view)/i, /\balter\s+table/i,
                      /\binsert\s+into/i, /\bdelete\s+from/i, /\bdrop\s+/i]) {
      assert.doesNotMatch(q, re, `🔴 ${n} يكتب`);
    }
  }
});

test("(S-7) ★★★ الواجهة: العلم مطفأ ⇒ لا مستمع ولا طلب ★★★", () => {
  const shell = read("components/portal/PortalShell.tsx");
  assert.match(shell, /globalSearchEnabled\(\) && <CommandPalette \/>/,
    "🔴 المكوّن يُركَّب ثمّ يُخفى — مستمع لوحة مفاتيح خلف بوّابة مغلقة");
  const lib = read("lib/portal/client.ts");
  assert.match(lib, /NEXT_PUBLIC_SHOW_GLOBAL_SEARCH === "true"/, "العلم ليس مقارنة صارمة");
});

test("(S-8) ★★★ الواجهة لا تُصفّي · ولا تُغرق · ولا تقفز ★★★", () => {
  const ui = UI();
  // ⛔ لا تصفية في المتصفّح: وصول البيانات هو التسريب.
  assert.doesNotMatch(ui, /\.filter\(\s*\(?h\)?\s*=>/, "🔴 تصفية في المتصفّح");
  assert.match(ui, /التصفية تقع في القاعدة لا هنا/, "لا إعلان بمكان التصفية");
  // تأخير قبل الإرسال.
  assert.match(ui, /setTimeout\([\s\S]{0,60}250\)/, "🔴 طلب على كلّ ضغطة");
  // 🔴 عدّاد تسلسليّ: ردّ قديم لا يستبدل أحدث.
  assert.match(ui, /const mine = \+\+seq\.current/, "🔴 لا حماية من ترتيب الردود");
  assert.match(ui, /if \(mine !== seq\.current\) return/, "🔴 ردّ قديم قد يستبدل نتيجة أحدث");
  // وحرفان على الأقلّ قبل أيّ نداء.
  assert.match(ui, /text\.trim\(\)\.length < 2/, "🔴 يبحث بحرف واحد");
});

// ═══ V2-7.3-A · عارض سجلّ التدقيق ═══════════════════════════════════════════

const AUD = () => read("docs/wave7_audit_viewer_RUNME.sql");

test("(A-1) ★★★ لا سجلّ تدقيق سادس عشر · وقراءة فقط ★★★", () => {
  const c = codeOnly(AUD());
  assert.doesNotMatch(c, /create\s+table/i, "🔴 سجلّ تدقيق جديد");
  // ⛔ ولا كتابة في أيّ سجلّ قائم.
  for (const re of [/\binsert\s+into\s+public\./i, /\bupdate\s+public\./i, /\bdelete\s+from\b/i]) {
    assert.doesNotMatch(c, re, "🔴 العارض يكتب");
  }
  for (const f of ["audit_viewer_list", "audit_sources_registry"]) {
    assert.match(c, new RegExp(`create or replace function public\\.${f}`), `${f} مفقودة`);
    assert.match(c, new RegExp(`revoke all on function public\\.${f}\\(`), `🔴 ${f} بلا REVOKE`);
  }
  assert.doesNotMatch(c, /grant execute on function[^;]*\banon\b/i, "🔴 سجلّ التدقيق لـanon");
});

test("(A-2) ★★★ يُعلن أنّه ليس كلّ التدقيق — ولا يدّعي الاكتمال ★★★", () => {
  const fn = bodyOf(AUD(), "audit_viewer_list");
  // 🔴 عارض يبدو كاملًا وهو ليس كذلك أخطر من عارض ناقص معلن.
  assert.match(fn, /'is_complete_audit', false/, "🔴 لا يُعلن أنّه ناقص");
  assert.match(fn, /'source', 'activity_log'/, "لا يُسمّي مصدره");
  // وسجلّ الإحالة يُبنى من الكتالوج لا من قائمة تتقادم.
  const reg = bodyOf(AUD(), "audit_sources_registry");
  assert.match(reg, /from pg_class c join pg_namespace n/, "🔴 قائمة مكتوبة يدويًّا تتقادم");
  assert.match(reg, /'in_viewer'/, "لا تمييز لما يُقرأ فعلًا");
  assert.match(reg, /W7-1/, "القرار غير مسجَّل في المخرَج");
});

test("(A-3) ★★★ metadata لا يُعاد خامًّا ★★★", () => {
  const fn = bodyOf(AUD(), "audit_viewer_list");
  // 🔴 `metadata` jsonb حرّ كتبه مستدعٍ سابق — قد يحمل أيّ شيء.
  assert.match(fn, /'metadata_keys'/, "لا إعادة للمفاتيح");
  assert.match(fn, /jsonb_object_keys/, "🔴 لا استخراج للمفاتيح");
  assert.doesNotMatch(fn, /'metadata', a\.metadata/, "🔴 metadata يُعاد خامًّا");
});

test("(A-4) ★★★ W7-1: تحذير دائم · ولا ادّعاء شمول · ولا عدّاد يوحي به ★★★", () => {
  const ui = read("components/portal/AuditViewer.tsx");
  // 🔴 التحذير حرفيّ ودائم — لا يُطوى ولا يُغلق.
  assert.match(ui, /PARTIAL AUDIT VIEW — NOT A COMPLETE INVESTIGATION RECORD/,
    "🔴 لا تحذير جزئيّة صريح");
  assert.doesNotMatch(ui, /useState[^;]*warning|dismiss|setHideWarning/i,
    "🔴 التحذير قابل للإخفاء");
  // ⛔ ولا عبارة توحي بالشمول في أيّ من الطبقتين.
  const blob = ui + read("docs/wave7_audit_viewer_RUNME.sql");
  for (const re of [/complete audit/i, /full history/i, /all actions/i,
                    /سجلّ كامل/, /كلّ الإجراءات/, /السجلّ الشامل/]) {
    assert.doesNotMatch(blob, re, "🔴 ادّعاء شمول");
  }
  // ⛔ ولا عدّاد نتائج يُقرأ كإجماليّ.
  assert.doesNotMatch(ui, /rows\.length\}\s*(سجل|إجراء|نتيجة)/,
    "🔴 عدّاد يوحي بالشمول");
  // والحقول قائمة بيضاء — لا عرض للحمولة كاملة.
  assert.doesNotMatch(ui, /Object\.entries\(r\)|JSON\.stringify\(r\)/,
    "🔴 عرض الصفّ كاملًا بلا قائمة بيضاء");
});
