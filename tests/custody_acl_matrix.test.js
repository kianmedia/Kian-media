// ════════════════════════════════════════════════════════════════════════════
// tests/custody_acl_matrix.test.js
//
// asset_intelligence_RUNME توقّف في معاملته العاشرة بـ:
//     ASSET SELF-TEST: anon يملك تنفيذ custody_inv_get_settings()
// والفحص محقّ. الآلية: PostgreSQL يمنح EXECUTE لـPUBLIC افتراضيًّا عند إنشاء
// أيّ دالّة، و`grant … to authenticated` **لا يُلغي** ذلك بل يضيف فوقه، وanon
// عضو في PUBLIC فيرث. لا يُزيله إلّا `revoke … from public` صريح.
//
// وليست دالّة واحدة: من 135 دالّة custody_inv_*/civ_* كانت 78 بلا revoke،
// منها 35 تُنشئها حزمة الأصول نفسها. ولا منحة مباشرة واحدة لـanon في المستودع:
// الوراثة هي المسار كلّه — وهذا ما يجعل «امنح authenticated» علاجًا ناقصًا.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const read = (r) => (fs.existsSync(path.join(ROOT, r)) ? fs.readFileSync(path.join(ROOT, r), "utf8") : null);
const docs = () => fs.readdirSync(path.join(ROOT, "docs")).filter((f) => f.endsWith(".sql"));

const FN = /create or replace function public\.((?:custody_inv|civ)_[a-z0-9_]+)\s*\(/g;

/** كلّ دالّة عهدة يُنشئها المستودع، وكلّ دالّة لها REVOKE من public/anon. */
function survey() {
  const created = new Set(), revoked = new Set();
  for (const f of docs()) {
    const s = read(`docs/${f}`);
    for (const m of s.matchAll(FN)) created.add(m[1]);
    for (const m of s.matchAll(/revoke\s+(?:all|execute)[^;]*?on function public\.((?:custody_inv|civ)_[a-z0-9_]+)\s*\([^)]*\)[^;]*?from([^;]*);/gis)) {
      if (/\b(public|anon)\b/i.test(m[2])) revoked.add(m[1]);
    }
    // كتل السحب الديناميكية: array[...] يتبعها revoke all on function
    for (const m of s.matchAll(/foreach\s+\w+\s+in\s+array\s+array\[([\s\S]*?)\][\s\S]{0,900}?revoke all on function/gi)) {
      for (const n of m[1].matchAll(/'((?:custody_inv|civ)_[a-z0-9_]+)'/g)) revoked.add(n[1]);
    }
  }
  return { created, revoked };
}

test("(١) ★★ كلّ دالّة عهدة تُنشئها حزمة الأصول لها قرار صلاحيات صريح ★★", () => {
  const s = read("docs/asset_intelligence_RUNME.sql");
  const mine = new Set([...s.matchAll(FN)].map((m) => m[1]));
  const { revoked } = survey();
  assert.ok(mine.size >= 30, `لم تُقرأ إلّا ${mine.size} دالّة — القارئ لا يرى الملفّ`);
  const uncovered = [...mine].filter((f) => !revoked.has(f)).sort();
  assert.deepEqual(uncovered, [],
    "دوالّ تُنشأ بلا REVOKE من public — فتبقى بالافتراضيّ وanon يرثها:\n  " + uncovered.join("\n  "));
});

test("(٢) ★ رقعة الصلاحيات موجودة وكاملة وصلاحيات فقط ★", () => {
  const files = ["PREFLIGHT", "RUNME", "POSTCHECK", "ROLLBACK"]
    .map((k) => `docs/asset_intelligence_security_patch_${k}.sql`);
  for (const f of files) assert.ok(read(f) !== null, `ملفّ الرقعة مفقود: ${f}`);
  const r = read(files[1]);
  assert.equal((r.match(/^begin;$/gim) || []).length, 1, "الرقعة ليست معاملة واحدة");
  assert.equal((r.match(/^commit;$/gim) || []).length, 1, "الرقعة بلا commit واحد");
  assert.doesNotMatch(r, /create or replace function/i, "الرقعة تستبدل جسم دالّة — يجب أن تكون صلاحيات فقط");
  assert.doesNotMatch(r, /\binsert\s+into\b|\bdelete\s+from\b/i, "الرقعة تكتب بيانات");
  assert.doesNotMatch(r.replace(/^\s*--.*$/gm, ""), /concurrently/i, "الرقعة تستعمل CONCURRENTLY");
  // تسحب من public **و**anon معًا: سحب anon وحده لا يُزيل الوراثة.
  assert.match(r, /revoke all on function %s from public/, "الرقعة لا تسحب من PUBLIC — والوراثة تبقى");
  assert.match(r, /revoke all on function %s from anon/, "الرقعة لا تسحب من anon");
});

test("(٣) ★★ الرقعة تُعيد المنح لسطح التطبيق بالاسم — وإلّا كسرت الواجهة ★★", () => {
  const r = read("docs/asset_intelligence_security_patch_RUNME.sql");
  const m = r.match(/APP_SURFACE constant text\[\] := array\[([\s\S]*?)\];/);
  assert.ok(m, "الرقعة بلا قائمة سطح تطبيق — سحبٌ شاملٌ يكسر كلّ نداء");
  const surface = [...m[1].matchAll(/'((?:custody_inv|civ)_[a-z0-9_]+)'/g)].map((x) => x[1]);
  assert.ok(surface.length >= 50, `سطح التطبيق ${surface.length} دالّة فقط — القائمة تبدو ناقصة`);
  // وكلّ اسم في القائمة دالّة موجودة فعلًا: قائمة تطلب المستحيل تُسقط الرقعة.
  const { created } = survey();
  const ghosts = surface.filter((f) => !created.has(f));
  assert.deepEqual(ghosts, [], `أسماء في سطح التطبيق بلا دالّة مقابلة: ${ghosts.join(", ")}`);
  // ولا تُمنح دالّة لا يناديها التطبيق: الحارس أنّ القائمة مغلقة ومصدرها الكود.
  assert.match(r, /grant execute on function %s to authenticated/, "الرقعة لا تُعيد المنح");
  assert.doesNotMatch(r, /to\s+anon\b/i, "الرقعة تمنح anon");
});

test("(٤) ★ الرقعة تفحص نفسها قبل COMMIT ★", () => {
  const r = read("docs/asset_intelligence_security_patch_RUNME.sql");
  for (const [what, re] of [
    ["صفر PUBLIC", /has_function_privilege\('public'/],
    ["صفر anon", /has_function_privilege\('anon'/],
    ["لا proacl NULL", /proacl is null/],
    ["سطح التطبيق ما زال يعمل", /has_function_privilege\('authenticated'/],
    ["بصمة عدد الدوالّ", /v_bodies_before/],
    ["بصمة عدد الزنادات", /v_trigs_before/],
  ]) assert.match(r, re, `الرقعة بلا فحص ذاتيّ لـ${what}`);
});

test("(٥) ★ التراجع يُحذّر صراحةً أنّه يُعيد فتح PUBLIC ★", () => {
  const rb = read("docs/asset_intelligence_security_patch_ROLLBACK.sql");
  assert.match(rb, /يُعيد فتح|يعيد فتح/, "التراجع لا يُحذّر");
  assert.match(rb, /PUBLIC/, "التراجع لا يسمّي ما يُعيد فتحه");
  assert.match(rb, /APP_SURFACE/, "التراجع لا يذكر البديل الأصحّ (إضافة الدالّة إلى القائمة)");
});

test("(٦) ★ PREFLIGHT يميّز الوراثة عن المنحة المباشرة ★", () => {
  const p = read("docs/asset_intelligence_security_patch_PREFLIGHT.sql");
  assert.match(p, /proacl/, "PREFLIGHT لا يقرأ proacl — فلا يعرف مصدر الامتياز");
  assert.match(p, /anon=/, "PREFLIGHT لا يبحث عن منحة anon المباشرة داخل proacl");
  assert.match(p, /READY|NOT_NEEDED|STOP/, "PREFLIGHT بلا حكم صريح");
  assert.doesNotMatch(p, /^\s*(insert|update|delete|create)\s/im, "PREFLIGHT يكتب");
});

test("(٧) ★ POSTCHECK الرقعة: قراءة فقط، نتيجة واحدة، بلا معاملة ★", () => {
  const pc = read("docs/asset_intelligence_security_patch_POSTCHECK.sql");
  assert.doesNotMatch(pc, /^\s*(insert|update|delete|create|alter|drop)\s/im, "يكتب");
  assert.doesNotMatch(pc, /\b(begin|commit)\s*;/i, "يفتح معاملة");
  assert.doesNotMatch(pc, /exception when others then null/i, "catch-all");
  const stmts = (pc.replace(/^\s*--.*$/gm, "").match(/;/g) || []).length;
  assert.equal(stmts, 1, `${stmts} جملة — المحرّر يعرض الأخيرة فقط`);
  // ويُثبت أنّ سطح التطبيق لم ينكسر، لا صفر anon وحده.
  assert.match(pc, /surface/i, "POSTCHECK لا يتحقّق من بقاء سطح التطبيق عاملًا");
});

test("SAFE: ساكن فقط (لا قاعدة بيانات ولا شبكة)", () => {
  const src = fs.readFileSync(__filename, "utf8");
  for (const bad of ["fet" + "ch(", "child_" + "process", "service_" + "role"]) {
    assert.ok(!src.includes(bad), `الفاحص يلمس ${bad}`);
  }
});
