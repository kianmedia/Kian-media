// ════════════════════════════════════════════════════════════════════════════
// tests/lead_acl_and_package_families.test.js
//
// ثلاثة إخفاقات ظهرت في POST_APPLY_SUMMARY على الإنتاج بعد أن وصل RUNME إلى
// COMMIT. هذا الملفّ يمنع عودتها، ويميّز بينها بصدق:
//
//  (١) «مكشوف افتراضيًّا: 2» — إخفاق **حقيقيّ** في مصفوفة الصلاحيات:
//      lsr_rules_frozen() و lsr_touch() تُنشَآن ولا تردان في أيّ قائمة صلاحيات،
//      فتبقيان بـproacl NULL أي EXECUTE لـPUBLIC. (غير قابل للاستغلال لأنّهما
//      تُعيدان trigger، لكنّه قرار متروك للافتراض — وهو ما نمنعه.)
//
//  (٢) اللوحات ← margin / sq_quote_internal — **إنذاران كاذبان**: الأوّل عنصرٌ
//      في مصفوفة excluded_by_design، والثاني كلمةٌ في تعليق. رابع تكرار لصنف
//      «الكلمة المجرّدة» في هذا البرنامج بعد reser·VAT·ion وZoho وfloor_price.
//
//  (٣) «finance_profitability: 22 جدولًا / 0 دالّة» — نمطٌ لا يغطّي عائلة
//      الدوالّ: الجداول fin_* والدوالّ finops_*. والعطل نفسه في مركز العمليات
//      (ops_* مقابل prodops_*).
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const read = (r) => (fs.existsSync(path.join(ROOT, r)) ? fs.readFileSync(path.join(ROOT, r), "utf8") : null);

const RUNME = () => read("docs/lead_scoring_routing_RUNME.sql") || "";
const SUMMARY = () => read("docs/lead_scoring_routing_POST_APPLY_SUMMARY.sql") || "";

/** يحذف تعليقات `--` ويُبقي السلاسل. */
function noComments(sql) {
  return sql.split("\n").map((l) => {
    let q = false;
    for (let i = 0; i < l.length; i++) {
      if (l[i] === "'") q = !q;
      else if (!q && l[i] === "-" && l[i + 1] === "-") return l.slice(0, i);
    }
    return l;
  }).join("\n");
}

// ─── (١) كلّ دالّة lsr_* لها قرار صلاحيات صريح ──────────────────────────────

test("(١) ★★ لا دالّة lsr_* بلا قرار صلاحيات صريح ★★", () => {
  const src = noComments(RUNME());
  const created = new Set([...src.matchAll(/create or replace function public\.(lsr_[a-z0-9_]+)\s*\(/g)].map((m) => m[1]));
  // ⚠️ الأسماء تُقرأ من **كتل الصلاحيات وحدها**، لا من كلّ الملفّ: اسم الدالّة
  //    يرد أيضًا في مصفوفات الفحص الذاتيّ وقوائم الاستثناء، فالمسح الشامل يجعل
  //    كلّ دالّة تبدو مُغطّاة — وقد أعطى ذلك «تمريرة» لحذفِ سحبٍ حقيقيّ.
  const aclBlocks = [];
  for (const m of src.matchAll(/revoke all on function/g)) {
    const before = src.slice(0, m.index);
    const start = before.lastIndexOf("foreach f in array array[");
    if (start > -1) aclBlocks.push(src.slice(start, m.index));
  }
  const acl = new Set(aclBlocks.flatMap((b) => [...b.matchAll(/'public\.(lsr_[a-z0-9_]+)\(/g)].map((m) => m[1])));
  assert.ok(aclBlocks.length >= 2, `لم تُعثر إلّا على ${aclBlocks.length} كتلة صلاحيات — القارئ لا يرى الكتل`);
  const missing = [...created].filter((f) => !acl.has(f)).sort();
  assert.ok(created.size >= 40, `لم تُقرأ إلّا ${created.size} دالّة — القارئ لا يرى الملفّ`);
  assert.deepEqual(missing, [],
    "دوالّ lsr_* تُنشأ بلا REVOKE/GRANT صريح، فتبقى بـproacl NULL أي EXECUTE لـPUBLIC:\n  " +
    missing.join("\n  "));
});

test("(٢) ★ دالّتا الزناد تحديدًا مُقفَلتان — وهما اللتان سقطتا على الإنتاج ★", () => {
  const src = noComments(RUNME());
  for (const f of ["lsr_rules_frozen", "lsr_touch"]) {
    assert.match(src, new RegExp(`'public\\.${f}\\(\\)'`),
      `${f}() ليست في أيّ قائمة صلاحيات — هذا بالضبط ما أنتج «مكشوف افتراضيًّا: 2»`);
  }
  // ولا تُمنح لأيّ دور: يجب أن تقع في قائمة السحب لا قائمة المنح.
  const grantBlock = src.slice(0, src.indexOf("lsr_rules_frozen"));
  const lastGrant = grantBlock.lastIndexOf("grant execute on function");
  const lastRevoke = grantBlock.lastIndexOf("revoke all on function");
  assert.ok(lastRevoke > lastGrant || lastGrant === -1,
    "دالّتا الزناد وقعتا في كتلة تمنح EXECUTE — يجب أن تقعا في كتلة السحب");
});

test("(٣) حزمة الرقعة موجودة وكاملة وبلا CONCURRENTLY", () => {
  const files = ["PREFLIGHT", "RUNME", "POSTCHECK", "ROLLBACK"]
    .map((k) => `docs/lead_scoring_routing_security_patch_${k}.sql`);
  for (const f of files) assert.ok(read(f) !== null, `ملفّ الرقعة مفقود: ${f}`);
  const r = read(files[1]);
  assert.equal((r.match(/^begin;$/gim) || []).length, 1, "الرقعة ليست معاملة واحدة");
  assert.equal((r.match(/^commit;$/gim) || []).length, 1, "الرقعة بلا commit واحد");
  assert.ok(!/^\s*[^-\n]*concurrently/im.test(noComments(r)), "الرقعة تستعمل CONCURRENTLY");
  // ولا تكتب بيانات ولا تستبدل جسم دالّة.
  assert.doesNotMatch(noComments(r), /\binsert\s+into\b|\bupdate\s+public\.|\bdelete\s+from\b/i,
    "الرقعة تكتب بيانات — يجب أن تكون صلاحيات فقط");
  assert.doesNotMatch(noComments(r), /create or replace function/i,
    "الرقعة تستبدل جسم دالّة — يجب أن تكون صلاحيات فقط");
});

// ─── (٢) مِجَسّات التسريب شكلٌ لا كلمة ──────────────────────────────────────

test("(٤) ★★ لا مِجَسّ تسريب بكلمة مجرّدة — رابع تكرار للصنف نفسه ★★", () => {
  const s = SUMMARY();
  const block = s.slice(s.indexOf("leak_probes"), s.indexOf("leaks as"));
  assert.ok(block.length > 100, "كتلة المجسّات غير موجودة");
  const probes = [...block.matchAll(/\('(lsr_[a-z_]+)','(re|lit)','([^']*(?:''[^']*)*)'\)/g)]
    .map((m) => ({ fn: m[1], kind: m[2], pat: m[3] }));
  assert.ok(probes.length >= 10, `لم تُقرأ إلّا ${probes.length} مِجَسّات — القارئ لا يرى الكتلة`);
  for (const p of probes) {
    if (p.kind !== "lit") continue;
    // المِجَسّ النصّيّ الحرفيّ مقبول فقط إن كان **مؤهَّلًا** (alias.column):
    // الكلمة المجرّدة تطابق عنصر مصفوفة أو تعليقًا فتُنتج إنذارًا كاذبًا.
    assert.match(p.pat, /^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/,
      `مِجَسّ بكلمة مجرّدة: ${p.fn} ← '${p.pat}' — استعمل شكل قراءة (alias.col) أو شكل نداء (name()`);
  }
});

test("(٥) ★ الكلمتان اللتان أسقطتا الفحص لم تعودا مِجَسًّا مجرّدًا ★", () => {
  const s = SUMMARY();
  const block = s.slice(s.indexOf("leak_probes"), s.indexOf("leaks as"));
  assert.doesNotMatch(block, /,'lit','margin'\)/, "'margin' عادت كلمةً مجرّدة");
  assert.doesNotMatch(block, /,'lit','sq_quote_internal'\)/, "'sq_quote_internal' عادت كلمةً مجرّدة");
  // وما زالتا محروستَين — بالشكل لا بالحذف.
  assert.match(block, /\\\.\(margin\||\|margin\||margin\|/, "لم يبقَ أيّ مِجَسّ لـmargin — حُذف الفحص بدل إصلاحه");
  assert.match(block, /sq_quote_internal\\s\*\\\(/, "لم يبقَ مِجَسّ نداء لـsq_quote_internal");
});

test("(٦) ★ مِجَسّات التسريب تُطابَق على الجسم المُقسَّم لا على التعريف الخام ★", () => {
  const s = noComments(SUMMARY());
  const leaks = s.slice(s.indexOf("leaks as"), s.indexOf("leaks as") + 500);
  assert.match(leaks, /join\s+bodies\s+b/i,
    "leaks ما زالت تضمّ defs — أي تطابق pg_get_functiondef الخام بتعليقاته");
  assert.doesNotMatch(leaks, /join\s+defs\s+d/i, "leaks تطابق التعريف الخام — التعليق يُقرأ تسريبًا");
});

// ─── (٣) عائلات الحزم ───────────────────────────────────────────────────────

test("(٧) ★★ عائلة الدوالّ تُعلَن مستقلّة عن عائلة الجداول، ومطابقة للواقع ★★", () => {
  const s = SUMMARY();
  // ⚠️ حدّ الكتلة عند CTE التالية لا عند `)),`: الصيغة غير الجشعة تبتلع القوس
  //    المُغلِق للصفّ الأخير فتُسقطه من العدّ — وقد أعطت «5 حزم لا ستّ».
  const start = s.indexOf("six(o, pkg, tbl_prefix, fn_prefix) as (values");
  const m = start > -1 ? [null, s.slice(start, s.indexOf("pkg_core", start))] : null;
  assert.ok(m, "six ما زال بنمط واحد للجداول والدوالّ — وهو ما أعطى «0 دالّة»");
  const rows = [...m[1].matchAll(/\(\s*\d+\s*,\s*'([a-z_A-Z]+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*\)/g)]
    .map((x) => ({ pkg: x[1], tbl: x[2], fn: x[3] }));
  assert.equal(rows.length, 6, `أُعلنت ${rows.length} حزم لا ستّ`);

  // كلّ عائلة معلَنة تُطابَق بالفعل ضدّ RUNME الحزمة نفسها — لا نثق بالإعلان.
  for (const r of rows) {
    const pkgSql = read(`docs/${r.pkg}_RUNME.sql`);
    if (pkgSql === null) continue;
    const fns = new Set([...pkgSql.matchAll(/create or replace function public\.([a-z0-9_]+)\s*\(/g)].map((x) => x[1]));
    const tbls = new Set([...pkgSql.matchAll(/create table if not exists public\.([a-z0-9_]+)/g)].map((x) => x[1]));
    const fnPre = r.fn.replace(/\\_/g, "_").replace(/%$/, "");
    const tbPre = r.tbl.replace(/\\_/g, "_").replace(/%$/, "");
    const fnHit = [...fns].filter((n) => n.startsWith(fnPre)).length;
    const tbHit = [...tbls].filter((n) => n.startsWith(tbPre)).length;
    if (fns.size) assert.ok(fnHit > 0,
      `${r.pkg}: نمط الدوالّ '${r.fn}' لا يطابق أيًّا من ${fns.size} دالّة — هذا هو عطل «0 دالّة»`);
    if (tbls.size) assert.ok(tbHit > 0, `${r.pkg}: نمط الجداول '${r.tbl}' لا يطابق أيّ جدول`);
  }
});

test("(٨) ★ السلامة لا تقوم على عدٍّ إجماليّ وحده — دوالّ جوهرية بالتوقيع ★", () => {
  const s = SUMMARY();
  const m = s.match(/pkg_core\(o, sig\) as \(values([\s\S]*?)\)\),/);
  assert.ok(m, "pkg_core غائبة — السلامة تعتمد على رقم إجماليّ هشّ وحده");
  const sigs = [...m[1].matchAll(/'(public\.[a-z0-9_]+\([^)]*\))'/g)].map((x) => x[1]);
  assert.ok(sigs.length >= 10, `${sigs.length} دالّة جوهرية فقط — تغطية أضعف من أن تُلزم`);
  // وكلّ حزمة من الستّ لها مدخلان على الأقلّ: مجموعٌ كافٍ لا يعني تغطيةً كافية،
  // فحذفُ مدخلٍ من حزمةٍ واحدة يترك المجموع مُرضيًا والحزمة بلا حارس.
  const perPkg = {};
  for (const o of m[1].matchAll(/\((\d+),'public\./g)) perPkg[o[1]] = (perPkg[o[1]] || 0) + 1;
  for (const o of ["1", "2", "3", "4", "5", "6"]) {
    assert.ok((perPkg[o] || 0) >= 2,
      `الحزمة ${o} فيها ${perPkg[o] || 0} دالّة جوهرية — أقلّ من مدخلين يعني حارسًا بلا أسنان`);
  }
  // وكلّ توقيع معلَن موجود فعلًا في RUNME حزمته — وإلّا فالفحص يطلب المستحيل.
  const owner = [...m[1].matchAll(/\((\d+),'(public\.[a-z0-9_]+)\(/g)];
  const pkgOf = { 1: "communications_hub", 2: "operations_center", 3: "crm_sales_FOUNDATION",
                  4: "finance_profitability", 5: "commercial_subscriptions", 6: "smart_quoting" };
  for (const o of owner) {
    const pkgSql = read(`docs/${pkgOf[o[1]]}_RUNME.sql`);
    if (pkgSql === null) continue;
    const name = o[2].replace("public.", "");
    assert.match(pkgSql, new RegExp(`create or replace function public\\.${name}\\s*\\(`),
      `pkg_core تطلب ${o[2]} وهي غير مُنشأة في ${pkgOf[o[1]]}_RUNME.sql`);
  }
  // ★ وتُثبَّت التواقيع بأعيانها ★ عدٌّ لكلّ حزمة لا يكفي: حذفُ دالّة بعينها
  //   يُبقي العدّ مقبولًا ويُسقط الحارس عن تلك الدالّة تحديدًا.
  for (const must of ["public.comms_health()", "public.prodops_access()", "public.crm_access()",
                      "public.finops_access()", "public.csub_access()", "public.sq_tiers()"]) {
    assert.ok(sigs.includes(must),
      `دالّة جوهرية سقطت من pkg_core: ${must} — الحزمة تفقد حارسها المسمَّى`);
  }
  assert.match(s, /missing_core/, "الدوالّ الجوهرية الغائبة لا تُحتسب في الحكم");
});

test("(٩) عند الفشل تُطبع الأسماء لا الأعداد وحدها", () => {
  const s = SUMMARY();
  assert.match(s, /string_agg\(\s*distinct\s+fn \|\| ' ← ' \|\| pat/, "صفّ التسريب لا يسمّي الدالّة والمِجَسّ");
  assert.match(s, /missing_core <> ''/, "صفّ الحزم لا يسمّي الدالّة الجوهرية الغائبة");
});

test("SAFE: ساكن فقط (لا قاعدة بيانات ولا شبكة)", () => {
  const src = fs.readFileSync(__filename, "utf8");
  for (const bad of ["fet" + "ch(", "child_" + "process", "service_" + "role"]) {
    assert.ok(!src.includes(bad), `الفاحص يلمس ${bad}`);
  }
});
