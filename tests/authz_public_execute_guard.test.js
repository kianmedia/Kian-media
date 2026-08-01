// ════════════════════════════════════════════════════════════════════════════
// tests/authz_public_execute_guard.test.js
//
// حارس C16: منح authenticated مع بقاء PUBLIC EXECUTE الافتراضيّ.
//
// ★ لماذا Fixture مستقلّ ★ حاولتُ إثبات هذا الحارس بتطويع ملفّات الحزم
// الكبيرة، فلم تُزل طفرتي كلّ REVOKE (بقي موضعان يقاومان التعبير النمطيّ)،
// فبقي الحارس **غير مُكذَّب**. والطفرة التي لا تصل إلى موضعها ليست دليلًا على
// قوّة الحارس — وهذا بالضبط ما رفضتُ أن أعدّه إثباتًا.
// فالحُكم هنا على نصوص مصغَّرة أكتبها بنفسي: حالة تُدان وحالة تمرّ، وكلّ واحدة
// تعزل متغيّرًا واحدًا.
//
// القاعدة: PostgreSQL يمنح EXECUTE لـPUBLIC افتراضيًّا عند الإنشاء، و
// `grant … to authenticated` **لا يُلغيه** بل يضيف فوقه، وanon عضو في PUBLIC
// فيرث. لا يُزيله إلّا `revoke … from public` صريح **على التوقيع نفسه**.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

/** التعليقات محذوفة، السلاسل باقية. */
function noComments(sql) {
  let out = "", i = 0, q = false;
  while (i < sql.length) {
    const c = sql[i];
    if (q) { if (c === "'") { if (sql.startsWith("''", i)) { out += "''"; i += 2; continue; } q = false; } out += c; i++; continue; }
    if (c === "'") { q = true; out += c; i++; continue; }
    if (sql.startsWith("--", i)) { while (i < sql.length && sql[i] !== "\n") i++; continue; }
    out += c; i++;
  }
  return out;
}
/** توقيع الدالّة مُطبَّع: الاسم + أنواع الوسائط فقط. */
function sig(text) {
  const m = text.match(/public\.([a-z0-9_]+)\s*\(([^)]*)\)/i);
  if (!m) return null;
  const types = m[2].split(",").map((a) => a.trim().split(/\s+/).pop()).filter(Boolean).join(",");
  return `${m[1]}(${types})`;
}

/**
 * يُعيد كلّ دالّة تُمنح لـauthenticated بلا REVOKE من public **على توقيعها**.
 * المطابقة بالتوقيع لا بالاسم: سحبٌ على overload آخر لا يحمي هذا.
 */
function offenders(sql) {
  const nc = noComments(sql);
  const revoked = new Set();
  for (const m of nc.matchAll(/revoke\s+[a-z ,]*\s*on function\s+([^;]*?)\s+from\s+([^;]*);/gi)) {
    if (!/\bpublic\b/i.test(m[2])) continue;               // سحب من anon وحده لا يكفي
    for (const part of m[1].split(/,(?![^(]*\))/)) { const s = sig(part); if (s) revoked.add(s); }
  }
  const bad = [];
  for (const m of nc.matchAll(/grant\s+execute\s+on function\s+([^;]*?)\s+to\s+([^;]*);/gi)) {
    if (!/\bauthenticated\b/i.test(m[2])) continue;
    for (const part of m[1].split(/,(?![^(]*\))/)) {
      const s = sig(part);
      if (s && !revoked.has(s)) bad.push(s);
    }
  }
  return bad;
}

// ─── الحالة المدانة ────────────────────────────────────────────────────────

test("(١) ★★ منح authenticated بلا REVOKE من PUBLIC — يُدان ★★", () => {
  const BAD = `
create or replace function public.demo_surface() returns void language sql as $$ select 1 $$;
grant execute on function public.demo_surface() to authenticated;`;
  assert.deepEqual(offenders(BAD), ["demo_surface()"],
    "الحارس لم يُدن أوضح حالة: منحٌ فوق الافتراضيّ PUBLIC");
});

test("(٢) ★ السحب ثمّ المنح — يمرّ ★", () => {
  const GOOD = `
create or replace function public.demo_surface() returns void language sql as $$ select 1 $$;
revoke all on function public.demo_surface() from public;
revoke all on function public.demo_surface() from anon;
grant execute on function public.demo_surface() to authenticated;`;
  assert.deepEqual(offenders(GOOD), [], "إنذار كاذب على النمط الصحيح");
});

test("(٣) ★ سحب من anon وحده لا يكفي — الوراثة من PUBLIC تبقى ★", () => {
  const BAD = `
revoke all on function public.demo_surface() from anon;
grant execute on function public.demo_surface() to authenticated;`;
  assert.deepEqual(offenders(BAD), ["demo_surface()"],
    "سحبُ anon وحده يوهم بالإغلاق: anon عضو في PUBLIC ويرث من جديد");
});

test("(٤) ★★ Overloadان: المسحوب يمرّ وغير المسحوب يُدان ★★", () => {
  const MIX = `
revoke all on function public.demo_fn(uuid) from public;
grant execute on function public.demo_fn(uuid) to authenticated;
grant execute on function public.demo_fn(uuid, text) to authenticated;`;
  assert.deepEqual(offenders(MIX), ["demo_fn(uuid,text)"],
    "الحارس يخلط الـoverloads — السحب على توقيع لا يحمي توقيعًا آخر");
});

test("(٥) ★ REVOKE على توقيع مختلف لا يحمي التوقيع الفعليّ ★", () => {
  const BAD = `
revoke all on function public.demo_fn(text) from public;
grant execute on function public.demo_fn(uuid) to authenticated;`;
  assert.deepEqual(offenders(BAD), ["demo_fn(uuid)"], "قُرئ السحب على توقيع آخر حمايةً");
});

test("(٦) ★ تعليق يذكر grant/anon لا يُدان ★", () => {
  const OK = `
-- grant execute on function public.demo_fn() to authenticated;  ← شرحٌ لا منح
-- anon يرث من PUBLIC ما لم يُسحب
revoke all on function public.demo_fn() from public;
grant execute on function public.demo_fn() to authenticated;`;
  assert.deepEqual(offenders(OK), [], "أدان تعليقًا يشرح القاعدة");
});

test("(٧) ★ REVOKE … FROM public, anon يُفهم قائمةَ أدوار لا FROM clause ★", () => {
  const OK = `
revoke all on function public.demo_fn(jsonb) from public, anon, authenticated;
grant execute on function public.demo_fn(jsonb) to authenticated;`;
  assert.deepEqual(offenders(OK), [], "قائمة الأدوار قُرئت جملة FROM");
});

test("(٨) ★ دالّة داخلية بلا منح authenticated تمرّ بعد سحب PUBLIC ★", () => {
  const OK = `
revoke all on function public.demo_core(uuid) from public;
revoke all on function public.demo_core(uuid) from anon;
revoke all on function public.demo_core(uuid) from authenticated;`;
  assert.deepEqual(offenders(OK), [], "أدان نواةً داخلية لا تُمنح أصلًا");
});

test("(٩) ★ سطح بلا Caller لا يُمنح تلقائيًّا — الحارس لا يخترع منحًا ★", () => {
  const OK = `
revoke all on function public.demo_unused(uuid) from public;`;
  assert.deepEqual(offenders(OK), [], "الحارس اخترع منحًا غير موجود");
});

test("(١٠) ★ الحزم الأربع الحقيقية: صفر مخالف ★", () => {
  const PKGS = ["case_studies_platform", "live_operations_dashboard",
                "kian_ai_assistant", "executive_reporting"];
  const bad = [];
  for (const p of PKGS) {
    const f = `docs/${p}_RUNME.sql`;
    if (!fs.existsSync(f)) continue;
    for (const s of offenders(fs.readFileSync(f, "utf8"))) bad.push(`${p}: ${s}`);
  }
  assert.deepEqual(bad, [],
    "دوالّ تُمنح لـauthenticated بلا سحب PUBLIC على توقيعها:\n  " + bad.join("\n  "));
});

test("SAFE: ساكن فقط (لا قاعدة بيانات ولا شبكة)", () => {
  const src = fs.readFileSync(__filename, "utf8");
  for (const bad of ["fet" + "ch(", "child_" + "process", "service_" + "role"]) {
    assert.ok(!src.includes(bad), `الفاحص يلمس ${bad}`);
  }
});
