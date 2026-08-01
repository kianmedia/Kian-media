// ════════════════════════════════════════════════════════════════════════════
// tests/sql_function_signature_identity.test.js
//
// executive_reporting_RUNME.sql سقط قبل COMMIT بـ:
//     ERROR 42601: syntax error at or near "jsonb"
//     CONTEXT: invalid type name "p_kpis jsonb"
//     PL/pgSQL function inline_code_block line 47 at IF
//
// «هوية الدالّة» في PostgreSQL تُقرأ **أنواعًا فقط**: public.f(jsonb,boolean).
// أمّا p_kpis فاسمُ وسيط، قانونيّ في CREATE FUNCTION ومحرَّم في regprocedure.
//
// والموضع (السطر 47 من كتلة $st$ = 1379) كان:
//     if has_function_privilege('anon', f, 'EXECUTE')
// وf نصٌّ **يُبنى وقت التشغيل** من الكتالوج. تمرير نصّ يدفع PostgreSQL إلى
// تحويله regprocedure، فيصير نجاحُ الترحيلة رهنًا بأن يعود كلُّ صفّ في
// الكتالوج توقيعًا قابلًا للتحليل. وPOSTCHECK كان يسأل بالoid منذ البداية:
// ملفّان يقيسان الخاصّية ذاتها، أحدهما بطريقة لا تفشل والآخر بطريقة تفشل.
//
// العلاج ليس تصحيح نصّ بل إزالة التحويل: يُسأل بالoid، فلا تحليل فلا فشل.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const read = (r) => (fs.existsSync(path.join(ROOT, r)) ? fs.readFileSync(path.join(ROOT, r), "utf8") : null);
const FILES = ["PREFLIGHT", "RUNME", "POSTCHECK", "ROLLBACK"]
  .map((k) => `docs/executive_reporting_${k}.sql`);

/** تجريد التعليقات مع الإبقاء على السلاسل، بوعي بالاقتباس. */
function stripComments(sql) {
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

/** هل يحمل هذا الوسيطُ اسمًا؟ «p_kpis jsonb» نعم، «jsonb» لا، «double precision» لا. */
const TYPE_WORDS = new Set(["double", "precision", "character", "varying", "time", "timestamp", "with",
  "without", "zone", "bit", "int", "integer", "big", "bigint", "smallint", "numeric", "decimal",
  "text", "boolean", "jsonb", "json", "uuid", "date", "interval", "bytea", "real", "money", "name",
  "oid", "record", "void", "any", "anyelement", "anyarray", "variadic", "out", "inout", "in"]);
function argHasName(arg) {
  const parts = arg.trim().replace(/\[\]/g, "").split(/\s+/).filter(Boolean);
  if (parts.length < 2) return false;
  return !TYPE_WORDS.has(parts[0].toLowerCase());
}

/** كلّ سلسلة نصّية تبدو هويّة دالّة، مع موضعها. */
function identityLiterals(sql) {
  const out = [];
  for (const m of stripComments(sql).matchAll(/'((?:[a-z_][a-z0-9_]*\.)?[a-z_][a-z0-9_]*\(([^')]*)\))'/gi)) {
    if (!m[2].trim()) { out.push({ sig: m[1], args: [], named: [] }); continue; }
    const args = m[2].split(",");
    out.push({ sig: m[1], args, named: args.filter(argHasName) });
  }
  return out;
}

// ── (أ) الحزمة كما هي ──────────────────────────────────────────────────────
test("(١) ★★ كلّ هويّة دالّة في الملفّات الأربعة أنواعٌ فقط ★★", () => {
  const bad = [];
  for (const f of FILES) {
    const sql = read(f);
    if (sql === null) continue;
    for (const lit of identityLiterals(sql))
      if (lit.named.length) bad.push(`${f}: ${lit.sig}  ← ${lit.named.join(" · ")}`);
  }
  assert.deepEqual(bad, [],
    "هويّة الدالّة تُقرأ أنواعًا فقط — اسم الوسيط يرفع 42601:\n  " + bad.join("\n  "));
});

test("(٢) ★★ لا سؤال عن صلاحية بنصّ توقيع: الoid وحده ★★", () => {
  const bad = [];
  for (const f of FILES) {
    const sql = read(f);
    if (sql === null) continue;
    for (const m of stripComments(sql).matchAll(/has_function_privilege\s*\(([^;]{0,120}?)\)/gi)) {
      const args = m[1].split(",").map((x) => x.trim());
      const target = args.length === 3 ? args[1] : args[0];
      // مقبول: p.oid · v_oid · to_regprocedure(…) — ومقبول f.sig لأنّه سلاسل
      // حرفيّة يضمن الفحص (١) أنّها أنواعٌ فقط. مرفوض: متغيّر نصّيّ يُبنى وقت
      // التشغيل من الكتالوج، فمصيره خارج سيطرة الملفّ.
      // ⚠️ بحدود صحيحة: \boid\b لا يطابق v_oid لأنّ الشرطة السفليّة حرفُ كلمة.
      if (!/((^|[._])oid\b|to_regproc|::regproc|\.sig\b)/i.test(target))
        bad.push(`${f}: has_function_privilege(… ${target} …)`);
    }
  }
  assert.deepEqual(bad, [],
    "نصّ التوقيع يُحوَّل regprocedure وقد يفشل بـ42601 — اسأل بالoid:\n  " + bad.join("\n  "));
});

test("(٣) ★ الموضع المُصلَح: مسح anon يسأل بالoid ويحتفظ بالنصّ للرسالة ★", () => {
  const s = stripComments(read("docs/executive_reporting_RUNME.sql"));
  const i = s.indexOf("pg_get_function_identity_arguments");
  assert.ok(i > 0, "بانية الهويّة اختفت");
  const blk = s.slice(i - 300, i + 700);
  assert.match(blk, /select[\s\S]{0,300}?,\s*p\.oid/, "الoid لا يُختار مع النصّ");
  assert.match(blk, /has_function_privilege\('anon',\s*v_oid,/, "المسح ما زال يسأل بالنصّ");
  assert.doesNotMatch(blk, /has_function_privilege\('anon',\s*f,/, "الصيغة الهشّة عادت");
  assert.match(s, /v_oid\s+oid;/, "v_oid غير معرَّف");
  // وpg_get_function_arguments (بالأسماء) ممنوعة في هويّة أيّ ملفّ
  for (const f of FILES) {
    const x = read(f);
    if (x === null) continue;
    assert.doesNotMatch(stripComments(x), /pg_get_function_arguments\s*\(/,
      `${f}: النسخة التي تُعيد الأسماء لا تصلح لهويّة دالّة`);
  }
});

// ── (ب) الفاحص غير أجوف: يُدين المعيب ويُبرّئ السليم ───────────────────────
test("(٤) ★★ Fixtures: أنواعٌ فقط تمرّ، والأسماء تُدان ★★", () => {
  const OK = ["public.f(jsonb)", "public.f(uuid,jsonb,text)", "public.f()",
              "public.f(double precision)", "public.f(timestamp with time zone)",
              "public.f(text[])", "public.mgmt_alerts_from(jsonb,boolean)"];
  const BAD = ["public.f(p_kpis jsonb)", "public.f(p_a uuid, p_b jsonb)",
               "public.mgmt_alerts_from(p_kpis jsonb, p_sensitive boolean)"];
  for (const sig of OK) {
    const [lit] = identityLiterals(`select '${sig}';`);
    assert.equal(lit.named.length, 0, `إنذار كاذب على هويّة قانونيّة: ${sig}`);
  }
  for (const sig of BAD) {
    const [lit] = identityLiterals(`select '${sig}';`);
    assert.ok(lit.named.length > 0, `اسم وسيط لم يُدَن: ${sig}`);
  }
});

test("(٥) ★ ترتيب الأنواع جزءٌ من الهويّة: القلب هويّةٌ أخرى ★", () => {
  const sig = (s) => identityLiterals(`select '${s}';`)[0].args.map((x) => x.trim()).join(",");
  assert.equal(sig("public.f(uuid,jsonb)"), "uuid,jsonb");
  assert.notEqual(sig("public.f(uuid,jsonb)"), sig("public.f(jsonb,uuid)"),
    "القلب يُعامَل كالتوقيع نفسه — الفاحص لا يرى الترتيب");
});

test("(٦) ★ اسم الوسيط في CREATE FUNCTION قانونيّ ولا يُدان ★", () => {
  const s = read("docs/executive_reporting_RUNME.sql");
  assert.match(s, /create or replace function public\.mgmt_alerts_from\(p_kpis jsonb, p_sensitive boolean\)/,
    "التعريف الأصليّ تغيّر — الأسماء قانونيّة هناك");
  // ولا يُحسب ضمن الهويّات: ليس سلسلة نصّية
  for (const lit of identityLiterals(s))
    assert.ok(!/^public\.mgmt_alerts_from\(p_kpis/.test(lit.sig), "تعريف CREATE عُدّ هويّة");
});

test("(٧) ★ توقيعٌ داخل تعليق لا يُعامَل شيفرةً ★", () => {
  const rb = read("docs/executive_reporting_ROLLBACK.sql");
  assert.match(rb, /--\s*drop function if exists public\.mgmt_alerts_from\(jsonb,boolean\);/,
    "سطر التراجع المعلَّق تغيّر");
  const fake = "-- select 'public.f(p_bad jsonb)';\nselect 'public.f(jsonb)';";
  assert.equal(identityLiterals(fake).filter((l) => l.named.length).length, 0,
    "توقيع داخل تعليق أُدين");
});

test("(٨) ★ GRANT/REVOKE يستهدفان الهويّة القانونيّة نفسها ★", () => {
  const s = stripComments(read("docs/executive_reporting_RUNME.sql"));
  const bad = [];
  for (const m of s.matchAll(/(?:grant|revoke)[\s\S]{0,60}?on function\s+([a-z_.]+\(([^)]*)\))/gi)) {
    if (m[2].trim() && m[2].split(",").some(argHasName)) bad.push(m[1]);
  }
  assert.deepEqual(bad, [], `GRANT/REVOKE بأسماء وسائط: ${bad.join(" · ")}`);
});

test("(٩) ★★ Overloads: كلّ اسم mgmt_ يُستهدَف بتوقيع كامل لا بالاسم ★★", () => {
  const s = read("docs/executive_reporting_RUNME.sql");
  const created = [...s.matchAll(/create or replace function public\.(mgmt_[a-z0-9_]+)\s*\(([^)]*)\)/gi)]
    .map((m) => ({ name: m[1], arity: m[2].trim() ? m[2].split(",").length : 0 }));
  const byName = {};
  for (const c of created) (byName[c.name] ||= []).push(c.arity);
  const overloaded = Object.entries(byName).filter(([, a]) => a.length > 1);
  // كلّ سحب/منح يذكر أقواسًا — لا سحب بالاسم المجرَّد يطال overload غير مقصود
  const c = stripComments(s);
  for (const m of c.matchAll(/(?:grant|revoke)[\s\S]{0,60}?on function\s+([a-z_.]+)(\s*\()?/gi))
    assert.ok(m[2], `صلاحية بالاسم المجرَّد تطال كلّ overloads: ${m[1]}`);
  assert.ok(created.length > 10, `قُرئت ${created.length} دالّة فقط`);
  // وإن وُجد overload حقيقيّ فلا بدّ أن يكون كلّ توقيعاته مذكورة في الفحص الذاتيّ
  for (const [n, ar] of overloaded)
    assert.ok(ar.length === new Set(ar).size, `${n}: توقيعان بالعدد نفسه من الوسائط — التباس`);
});

test("(١٠) ★ الحزمة معاملة واحدة والفحص الذاتيّ قبل COMMIT ★", () => {
  const s = read("docs/executive_reporting_RUNME.sql");
  assert.equal((s.match(/^begin;$/gm) || []).length, 1, "ليست معاملة واحدة");
  assert.equal((s.match(/^commit;$/gm) || []).length, 1, "بلا commit واحد");
  assert.ok(s.indexOf("do $st$") < s.lastIndexOf("\ncommit;"), "الفحص الذاتيّ بعد COMMIT");
  assert.doesNotMatch(stripComments(s), /concurrently/i, "CONCURRENTLY يمنع المعاملة الواحدة");
});

/** توقيعات CREATE مُطبَّعة إلى أنواعٍ فقط: الأسماء والقيم الافتراضيّة تُزال. */
function createdSignatures() {
  const s = read("docs/executive_reporting_RUNME.sql");
  const map = new Map();
  for (const m of s.matchAll(/create or replace function public\.(mgmt_[a-z0-9_]+)\s*\(([\s\S]*?)\)\s*\n?\s*returns/gi)) {
    const types = m[2].trim()
      ? m[2].split(",").map((a) => {
          let x = a.trim().replace(/\s+default\s+[\s\S]*$/i, "").replace(/\s*=\s*[\s\S]*$/, "");
          const parts = x.split(/\s+/);
          // أوّل كلمة اسمٌ إن لم تكن كلمةَ نوع
          if (parts.length > 1 && !TYPE_WORDS.has(parts[0].toLowerCase())) parts.shift();
          return parts.join(" ").trim();
        }).join(",")
      : "";
    map.set(`public.${m[1]}(${types})`, true);
  }
  return map;
}

test("(١١) ★★ كلّ هويّة mgmt_ حرفيّة تطابق توقيعًا مُنشأً فعلًا ★★", () => {
  // اسمٌ صحيح بأنواع خاطئة أو مرتَّبة خطأً يمرّ من فحص «أنواعٌ فقط»، ثمّ
  // to_regprocedure يعيد NULL على الإنتاج فيرفع الفحص الذاتيّ «الدالّة مفقودة».
  const created = createdSignatures();
  assert.ok(created.size >= 20, `قُرئت ${created.size} توقيعات فقط — القارئ لا يرى الملفّ`);
  const norm = (x) => x.replace(/\s*,\s*/g, ",").replace(/\s+/g, " ").trim();
  const known = new Set([...created.keys()].map(norm));
  const bad = [];
  for (const f of FILES) {
    const sql = read(f);
    if (sql === null) continue;
    for (const lit of identityLiterals(sql)) {
      if (!/^public\.mgmt_/.test(lit.sig)) continue;          // خارج نطاق هذه الحزمة
      if (!known.has(norm(lit.sig))) bad.push(`${f}: ${lit.sig}`);
    }
  }
  assert.deepEqual(bad, [],
    "هويّة تسمّي توقيعًا غير موجود — to_regprocedure ستعيد NULL على الإنتاج:\n  " +
    bad.join("\n  ") + "\n  المُنشأة فعلًا:\n  " + [...known].sort().join("\n  "));
});

test("SAFE: ساكن فقط (لا شبكة ولا عمليّة ولا مفتاح خدمة)", () => {
  const src = fs.readFileSync(__filename, "utf8");
  for (const [what, re] of [["شبكة", new RegExp("\\b" + "fet" + "ch\\s*\\(")],
                            ["عمليّة", new RegExp("\\b" + "child_" + "process\\b")],
                            ["مفتاح خدمة", new RegExp("\\b" + "service_" + "role\\b")]])
    assert.doesNotMatch(src, re, `الفاحص يلمس ${what}`);
});
