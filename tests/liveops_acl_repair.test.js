// ════════════════════════════════════════════════════════════════════════════
// tests/liveops_acl_repair.test.js
//
// حزمة liveops أنشأت 56 دالّة ولم تسحب EXECUTE من PUBLIC عن **أيّ** منها.
// PostgreSQL يمنح PUBLIC تنفيذًا افتراضيًّا عند الإنشاء، وanon عضوٌ في PUBLIC
// — فورث تنفيذ الكلّ، ومنه كاتبات SECURITY DEFINER تعمل بصلاحيات المالك.
// وهو الصنف نفسه الذي أصاب حزمة الأصول سابقًا (78 من 135).
//
// ومنحُ authenticated لا يُصلحه: المنح يضيف ولا يُلغي.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const read = (r) => (fs.existsSync(path.join(ROOT, r)) ? fs.readFileSync(path.join(ROOT, r), "utf8") : null);
const PRE = "docs/liveops_acl_repair_PREFLIGHT.sql";
const RUN = "docs/liveops_acl_repair_RUNME.sql";
const POST = "docs/liveops_acl_repair_POSTCHECK.sql";
const SRC = "docs/live_operations_dashboard_RUNME.sql";
const noComments = (s) => s.replace(/^\s*--.*$/gm, "");

test("(١) ★★ العطل حقيقيّ: دوالّ liveops_ بلا سحب من PUBLIC ★★", () => {
  const s = read(SRC);
  const created = new Set([...s.matchAll(/create or replace function public\.(liveops_[a-z0-9_]+)\s*\(/gi)].map((m) => m[1]));
  assert.ok(created.size >= 50, `قُرئت ${created.size} دالّة فقط`);
  const revoked = new Set();
  for (const m of s.matchAll(/revoke\s+(?:all|execute)[^;]*?on function public\.(liveops_[a-z0-9_]+)\s*\([^)]*\)[^;]*?from([^;]*);/gis))
    if (/\b(public|anon)\b/i.test(m[2])) revoked.add(m[1]);
  // الحزمة الأصليّة لا تسحب: هذا هو سببُ وجود الرقعة.
  assert.equal([...created].filter((f) => revoked.has(f)).length, 0,
    "الحزمة صارت تسحب — راجع هل ما زالت الرقعة لازمة");
});

test("(٢) ★★ الرقعة صلاحيات فقط: لا جسم ولا جدول ولا بيانات ★★", () => {
  const c = noComments(read(RUN));
  assert.doesNotMatch(c, /create\s+(or\s+replace\s+)?function/i, "تستبدل جسم دالّة");
  assert.doesNotMatch(c, /\binsert\s+into\b|\bdelete\s+from\b|\bupdate\s+\w+\s+set\b/i, "تكتب بيانات");
  assert.doesNotMatch(c, /alter\s+table|drop\s+(table|function)/i, "تغيّر بنية");
  assert.doesNotMatch(c, /concurrently/i, "CONCURRENTLY يمنع المعاملة الواحدة");
  assert.equal((read(RUN).match(/^begin;$/gm) || []).length, 1, "ليست معاملة واحدة");
  assert.equal((read(RUN).match(/^commit;$/gm) || []).length, 1, "بلا commit واحد");
  assert.ok(read(RUN).lastIndexOf("raise exception") < read(RUN).lastIndexOf("commit;"),
    "الفحص الذاتيّ بعد COMMIT");
});

test("(٣) ★★ السحب من PUBLIC **و**anon، لا من authenticated وحده ★★", () => {
  const c = noComments(read(RUN));
  assert.match(c, /revoke all on function %s from public/, "لا سحب من PUBLIC — والوراثة تبقى");
  assert.match(c, /revoke all on function %s from anon/, "لا سحب من anon");
  assert.match(c, /pg_get_function_identity_arguments/, "السحب بلا توقيع كامل يُخطئ الoverload");
  // ولا اسم دالّة مُستثنى بالاسم من السحب
  assert.doesNotMatch(c, /proname\s*(<>|!=)\s*'liveops_/, "استثناء بالاسم من السحب");
});

test("(٤) ★★ سطح التطبيق يُعاد منحه بالاسم، ومصدره الشيفرة ★★", () => {
  const c = read(RUN);
  const m = /APP_SURFACE constant text\[\] := array\[([\s\S]*?)\];/.exec(c);
  assert.ok(m, "لا قائمة سطح تطبيق — سحبٌ شامل يكسر كلّ نداء");
  const surface = [...m[1].matchAll(/'(liveops_[a-z0-9_]+)'/g)].map((x) => x[1]);
  assert.ok(surface.length >= 25, `سطح التطبيق ${surface.length} دالّة — يبدو ناقصًا`);
  // كلّ اسم في القائمة موجود فعلًا في الحزمة
  const created = new Set([...read(SRC).matchAll(/create or replace function public\.(liveops_[a-z0-9_]+)\s*\(/gi)].map((x) => x[1]));
  const ghosts = surface.filter((f) => !created.has(f));
  assert.deepEqual(ghosts, [], `أسماء بلا دالّة مقابلة: ${ghosts.join(", ")}`);
  // ولا تُمنح anon شيئًا
  assert.doesNotMatch(noComments(c), /to\s+anon\b/i, "الرقعة تمنح anon");
  assert.match(c, /grant execute on function %s to authenticated/, "لا إعادة منح");
  // والدالّة الخادميّة إلى دور الخدمة وحده
  assert.match(c, /SERVER_SURFACE constant text\[\] := array\['liveops_client_view'\]/,
    "الدالّة التي يناديها الخادم غير مفصولة");
  // ولا اسم في السطح بلا دالّة: liveops_client_text سلسلةُ تصنيف خطأ لا RPC
  assert.ok(!surface.includes("liveops_client_text"),
    "اسمٌ ليس دالّة في قائمة المنح — يوسّع السطح بلا سبب");
  assert.match(c, new RegExp("to " + "service_" + "role"), "لا منح للخادم — سينكسر المسار العامّ");
});

test("(٥) ★★ الفحص الذاتيّ يفحص الاتّجاهين قبل COMMIT ★★", () => {
  const c = read(RUN);
  for (const [what, re] of [["صفر PUBLIC", /has_function_privilege\('public'/],
                            ["صفر anon", /has_function_privilege\('anon'/],
                            ["proacl NULL", /proacl is null/],
                            ["سطح التطبيق يعمل", /has_function_privilege\('authenticated'/],
                            ["عدد الدوالّ لم يتغيّر", /v_bodies_before <> v_before/]])
    assert.match(c, re, `الفحص الذاتيّ بلا تحقّق من: ${what}`);
  // ولكلّ تحقّقٍ إجهاضُه: وجودُ الرمز لا يكفي إن لم يُوقف COMMIT.
  for (const [what, re] of [
    ["PUBLIC", /if v_pub > 0 then[\s\S]{0,160}?raise exception/],
    ["anon", /if v_anon > 0 then[\s\S]{0,160}?raise exception/],
    ["سطح التطبيق", /if v_surface_lost <> ''[\s\S]{0,160}?raise exception/],
    ["عدد الدوالّ", /if v_bodies_before <> v_before then[\s\S]{0,200}?raise exception/]])
    assert.match(c, re, `تحقّق «${what}» بلا إجهاض — يمرّ إلى COMMIT`);
});

test("(٦) ★★ PREFLIGHT وPOSTCHECK: قراءة · جملة واحدة · بلا معاملة ★★", () => {
  for (const f of [PRE, POST]) {
    const c = noComments(read(f));
    assert.doesNotMatch(c, /^\s*(insert|update|delete|create|alter|drop|grant|revoke)\s/im, `${f} يكتب`);
    assert.doesNotMatch(c, /\b(begin|commit|rollback)\s*;/i, `${f} يفتح معاملة`);
    assert.doesNotMatch(c, /exception when others/i, `${f} catch-all`);
    let d = 0, q = false, n = 0;
    for (const ch of c) { if (ch === "'") q = !q; else if (!q && ch === "(") d++; else if (!q && ch === ")") d--; else if (!q && ch === ";" && d === 0) n++; }
    assert.equal(n, 1, `${f}: ${n} جملة`);
  }
  assert.match(read(PRE), /READY|NOT_NEEDED|STOP/, "PREFLIGHT بلا حكم صريح");
});

test("(٧) ★ لا Rollback لهذه الرقعة: التراجع يُعيد فتح PUBLIC ★", () => {
  assert.ok(!fs.existsSync(path.join(ROOT, "docs/liveops_acl_repair_ROLLBACK.sql")),
    "ملفّ تراجع يُعيد فتح الثغرة — البديل الصحيح إضافة الدالّة إلى APP_SURFACE");
});

test("SAFE: ساكن فقط (لا شبكة ولا عمليّة ولا مفتاح خدمة)", () => {
  const src = fs.readFileSync(__filename, "utf8");
  for (const [what, re] of [["شبكة", new RegExp("\\b" + "fet" + "ch\\s*\\(")],
                            ["عمليّة", new RegExp("\\b" + "child_" + "process\\b")],
                            ["مفتاح خدمة", new RegExp("\\b" + "service_" + "role\\b")]])
    assert.doesNotMatch(src, re, `الفاحص يلمس ${what}`);
});
