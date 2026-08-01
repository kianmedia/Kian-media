// ════════════════════════════════════════════════════════════════════════════
// tests/case_studies_public_surface_acl.test.js
//
// PREFLIGHT النهائيّ أعطى STOP على:
//     8.no_anon_execute → cs_public_index · cs_public_slugs · cs_public_study
//
// وكان **إنذارًا كاذبًا من فحصٍ كتبتُه أنا**: كنسٌ ببادئة cs_% يخلط السطحَ
// العامّ المقصود بالدوالّ الداخليّة. وحزمة دراسات الحالة تُعلن في كتلة منحها،
// القسم (د): «★ السطح العامّ: ثلاث دوالّ قراءة، ولا رابعة ★» — تسحب PUBLIC
// أوّلًا ثمّ تمنح anon **صراحةً** لثلاثة تواقيع، وتحجب كلّ داخليّة عن anon
// وauthenticated معًا. فالمنح مقصود، والوراثة مسحوبة.
//
// العقد إذن: anon يُنفّذ هذه الثلاثة **وحدها**، بالتوقيع الكامل لا بالاسم.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const read = (r) => (fs.existsSync(path.join(ROOT, r)) ? fs.readFileSync(path.join(ROOT, r), "utf8") : null);
const CS = "docs/case_studies_platform_RUNME.sql";
const PRE = "docs/final_platform_acceptance_PREFLIGHT.sql";
const RUN = "docs/final_platform_acceptance_RUNME.sql";
const POST = "docs/final_platform_acceptance_POSTCHECK.sql";
const PUBLIC_SIGS = ["public.cs_public_index(jsonb)", "public.cs_public_study(text)", "public.cs_public_slugs()"];
const noC = (s) => s.replace(/^\s*--.*$/gm, "");

/** جسم دالّة من الحزمة، بين علامتَي الاقتباس الدولاريّ. */
function body(name) {
  const s = read(CS);
  const i = s.indexOf(`create or replace function public.${name}(`);
  if (i < 0) return null;
  const t = /as (\$[a-z0-9_]*\$)/.exec(s.slice(i, i + 400));
  const st = s.indexOf(t[1], i) + t[1].length;
  return s.slice(st, s.indexOf(t[1], st));
}
const header = (name) => {
  const s = read(CS);
  const i = s.indexOf(`create or replace function public.${name}(`);
  return s.slice(i, s.indexOf("$$", i));
};

// ── (أ) العقد الأصليّ للحزمة ────────────────────────────────────────────────
test("(١) ★★ الحزمة تمنح anon ثلاثة تواقيع صراحةً، وتسحب PUBLIC أوّلًا ★★", () => {
  const c = noC(read(CS));
  const m = /foreach f in array array\['cs_public_index\(jsonb\)','cs_public_study\(text\)','cs_public_slugs\(\)'\]([\s\S]{0,400}?)end loop;/.exec(c);
  assert.ok(m, "كتلة منح السطح العامّ غير موجودة كما هي");
  assert.match(m[1], /revoke all on function public\.%s from public/, "PUBLIC لا يُسحب قبل المنح");
  assert.match(m[1], /grant execute on function public\.%s to anon, authenticated/, "لا منح صريح لـanon");
  // ولا رابعة: كلّ cs_ أخرى مسحوبة من anon
  assert.match(c, /revoke all on function public\.%s from anon/, "الداخليّات لا تُسحب من anon");
});

test("(٢) ★★ الدوالّ الداخليّة محجوبة عن anon **و**authenticated ★★", () => {
  const c = noC(read(CS));
  for (const f of ["cs_mask(uuid,jsonb,boolean)", "cs_public_row(uuid,boolean)", "cs_is_public(uuid)"])
    assert.ok(c.includes(`'${f}'`), `الدالّة الداخليّة ليست في قائمة الحجب: ${f}`);
});

// ── (ب) كلّ دالّة عامّة على حدة — لا حكم جماعيّ ─────────────────────────────
for (const [fn, sig] of [["cs_public_index", "jsonb"], ["cs_public_study", "text"], ["cs_public_slugs", ""]]) {
  test(`(٣.${fn}) ★★ قراءة فقط · definer · search_path · إسقاط صريح ★★`, () => {
    const h = header(fn), b = body(fn);
    assert.ok(b, `${fn} غير موجودة`);
    assert.match(h, /\bstable\b/, `${fn} ليست stable — قد تكتب`);
    assert.match(h, /security definer/, `${fn} ليست SECURITY DEFINER`);
    assert.match(h, /set search_path = public/, `${fn} بلا search_path مثبَّت`);
    assert.match(h, new RegExp(`cs_public_${fn.slice(10)}\\(${sig ? "p_\\w+ " + sig : ""}`),
      `${fn}: التوقيع تغيّر`);
    const code = b.replace(/'[^']*'/g, "''");
    assert.doesNotMatch(code, /\b(insert\s+into|update\s+\w+\s+set|delete\s+from)\b/i, `${fn} تكتب`);
    assert.doesNotMatch(code, /to_jsonb\s*\(\s*[a-z_]+\s*\)/i, `${fn} تُصدّر صفًّا كاملًا`);
    assert.doesNotMatch(code, /select\s+\*\s+from\s+public\.cs_case_studies/i, `${fn}: select * على الجدول`);
  });
  if (fn !== "cs_public_slugs" || true) {
    test(`(٤.${fn}) ★★ كلّ استعلام مرشّحين محروس بالنشر والإذن ★★`, () => {
      const b = body(fn);
      assert.match(b, /public_enabled/, `${fn} لا تحترم مفتاح تفعيل السطح العامّ`);
      // ⚠️ العدد لا مجرّد الوجود: cs_public_study تختار مرشّحين **مرّتين**
      //    (الدراسة نفسها ثمّ المرتبطة بها)، فحذفُ بوّابةٍ واحدة كان يمرّ.
      const gates = (b.match(/cs_is_public\s*\(/g) || []).length;
      const need = { cs_public_index: 1, cs_public_study: 2, cs_public_slugs: 1 }[fn];
      assert.equal(gates, need,
        `${fn}: بوّابات النشر ${gates} والمطلوب ${need} — استعلامُ مرشّحين بلا حارس يكشف مسوّدة`);
    });
  }
}

test("(٥) ★★ الإسقاط العامّ قائمة حقول مغلقة — لا حقل داخليّ ولا ماليّ ★★", () => {
  const s = read(CS);
  const i = s.indexOf("create or replace function public.cs_mask(");
  const m = s.slice(i, s.indexOf("\nend $$;", i));
  for (const bad of ["project_id", "cost", "margin", "budget", "internal_note", "revenue",
                     "supplier", "vendor_rate", "price_net"])
    assert.doesNotMatch(m, new RegExp(`'${bad}'\\s*,`), `الإسقاط العامّ يُصدّر حقلًا ممنوعًا: ${bad}`);
  // ولا معرّف عميل خام: الهويّة تمرّ عبر وسم موافقة
  assert.doesNotMatch(m, /'client_id'\s*,/, "الإسقاط يُصدّر client_id");
  for (const good of ["slug", "title_ar", "client_label_ar", "client_named"])
    assert.match(m, new RegExp(`'${good}'\\s*,`), `حقل عامّ متوقَّع مفقود: ${good}`);
});

// ── (ج) عقد القبول يستعمل التوقيع الكامل في الملفّات الثلاثة ────────────────
test("(٦) ★★ PRE/RUN/POST تحمل العقد نفسه بالتوقيع الكامل ★★", () => {
  for (const f of [PRE, RUN, POST]) {
    const c = noC(read(f));
    for (const sig of PUBLIC_SIGS)
      assert.ok(c.includes(`'${sig}'`), `${f}: التوقيع غير مذكور بالكامل: ${sig}`);
    // ⚠️ الشرط السابق كان يطلب pg_get_function_identity_arguments — وهو نفسه
    //    سببُ السقوط: يُبقي أسماء الوسائط. الهويّة الآن OID، وoverload آخر
    //    له OID مختلف فلا يدخل القائمة.
    assert.match(c, /to_regprocedure\s*\(/,
      `${f}: لا يحوّل التوقيع إلى OID — المقارنة النصّية تُخطئ الهويّة`);
  }
});

/**
 * منطقة **قائمة السماح** وحدها.
 * ⚠️ الاسم المجرَّد مشروعٌ في فحص **الأمان** (نريد كلّ overload لتلك الأسماء أن
 *    يكون آمنًا)، ومحرَّمٌ في **الصلاحية** (اسمٌ مجرَّد يفتح كلّ overload). فلا
 *    يُقاس الملفّ كلّه بقاعدة واحدة.
 */
/** منطقة الكنس: الشرط الذي يقرّر ما يُعدّ انكشافًا. */
function anonSweepRegion(f) {
  const c = noC(read(f));
  const i = c.indexOf("has_function_privilege('anon', p.oid, 'EXECUTE')");
  if (i < 0) return "";
  return c.slice(Math.max(0, i - 420), i + 420);
}

function allowlistRegion(f) {
  const c = noC(read(f));
  const out = [];
  // قائمة الصلاحية تُقارن **التوقيع** (sig)؛ وقائمة الأمان تُقارن الاسم
  // (proname) وهي مشروعة بالاسم المجرَّد. التمييز بالمفتاح المُقارَن.
  // ⚠️ نافذة ثابتة لا التقاطٌ غير جشع: أوّل ")" يقع داخل "(jsonb)" فيقطع
  //    الالتقاط قبل التواقيع. الأقواس متداخلة، والتعبير النمطيّ لا يوازنها.
  for (const m of c.matchAll(/cs_public_allowlist\(sig\) as \(values/g)) out.push(c.slice(m.index, m.index + 340));
  for (const m of c.matchAll(/unnest\(array\[/g)) out.push(c.slice(m.index, m.index + 340));
  return out.join("\n");
}

test("(٧) ★★ قائمة السماح بالتوقيع الكامل: لا اسم مجرَّد فيها ★★", () => {
  for (const f of [PRE, RUN, POST]) {
    const region = allowlistRegion(f);
    assert.ok(region.length > 0, `${f}: لم يُعثر على منطقة قائمة السماح`);
    for (const bare of ["'cs_public_index'", "'cs_public_study'", "'cs_public_slugs'"])
      assert.ok(!region.includes(bare), `${f}: سماحٌ بالاسم المجرَّد ${bare} — يفتح كلّ overload`);
    for (const sig of PUBLIC_SIGS)
      assert.ok(region.includes(`'${sig}'`), `${f}: التوقيع الكامل غائب عن قائمة السماح: ${sig}`);
    // ★ ثلاثة بالضبط: «ولا رابعة». أيّ overload إضافيّ يدخل القائمة يُدان.
    const listed = [...region.matchAll(/'public\.[a-z_]+\([^']*\)'/g)].map((m) => m[0].slice(1, -1));
    assert.deepEqual([...new Set(listed)].sort(), [...PUBLIC_SIGS].sort(),
      `${f}: قائمة السماح ليست الثلاثة بالضبط — ${listed.join(" · ")}`);
  }
});

test("(٨) ★★ غياب السطح العامّ ≠ انكشاف: حكمان منفصلان ★★", () => {
  const c = noC(read(PRE));
  assert.match(c, /8b\.public_surface_present/, "لا فحص مستقلّ لوجود السطح العامّ");
  assert.match(c, /MISSING PUBLIC SURFACE \(not an exposure\)/,
    "لا تمييز بين «سطح مفقود» و«انكشاف غير آمن»");
  assert.match(c, /PRESENT BUT anon CANNOT REACH IT/, "لا تمييز لحالة السطح الموجود غير المتاح");
  assert.match(noC(read(POST)), /4b\.public_surface_present/, "POSTCHECK بلا الفحص المقابل");
});

test("(٩) ★★ mgmt_/liveops_/ai_ تبقى صفر anon ★★", () => {
  for (const f of [PRE, RUN, POST]) {
    const c = noC(read(f));
    // ⚠️ داخل شرط الكنس نفسه: بقاؤها في مكانٍ آخر من الملفّ لا يحمي شيئًا.
    const sweep = anonSweepRegion(f);
    assert.match(sweep, /mgmt\\_%/, `${f}: البادئة الإدارية خرجت من كنس anon`);
    assert.match(sweep, /liveops\\_%/, `${f}: liveops خرجت من كنس anon`);
    assert.match(sweep, /ai\\_%/, `${f}: ai خرجت من كنس anon`);
    // ولا توقيع إداريّ **داخل قائمة السماح** (وجودُه في قائمة الكائنات
    // المطلوبة مشروع تمامًا — فالنطاق هو قائمة السماح وحدها).
    assert.ok(!/'public\.(mgmt|liveops|ai)_[a-z0-9_]*\(/.test(allowlistRegion(f)),
      `${f}: توقيعٌ إداريّ داخل قائمة السماح`);
  }
});

test("(١٠) ★★ RUNME يُثبت أمان الثلاثة لا وجودها فقط ★★", () => {
  const c = noC(read(RUN));
  for (const k of ["anon.only_three_public_reads", "public_reads_are_safe",
                   "public_reads_gate_on_published"])
    assert.ok(c.includes(k), `فحص أمان مفقود: ${k}`);
  assert.match(c, /provolatile <> 's'/, "لا فحص أنّها قراءة فقط");
  assert.match(c, /not p\.prosecdef/, "لا فحص SECURITY DEFINER");
  assert.match(c, /to_jsonb/, "لا فحص ضدّ تصدير الصفّ الكامل");
  assert.match(c, /cs_is_public/, "لا فحص لبوّابة النشر");
});

test("(١١) ★★ الحكم على OID لا على نصّ التوقيع ★★", () => {
  for (const f of [PRE, RUN, POST]) {
    const c = noC(read(f));
    // ⚠️ pg_get_function_identity_arguments **يُبقي أسماء الوسائط** (يُسقط
    //    القيم الافتراضيّة لا الأسماء)، فأنتج على الإنتاج
    //    «cs_public_index(p_params jsonb)» ولم يطابق قائمةً بالأنواع.
    //    فلا يجوز أن يدخل قرارَ صلاحيّة أبدًا.
    assert.equal(c.match(/pg_get_function_identity_arguments/g), null,
      `${f}: نصّ التوقيع يدخل قرار الصلاحيّة — أسماءُ الوسائط تُفسده`);
    // التحويل إلى OID موجود، أيًّا كانت صياغته (a.sig أو المصفوفة المباشرة)
    assert.match(c, /to_regprocedure\s*\(/, `${f}: قائمة السماح لا تُحوَّل إلى OID`);
    assert.match(c, /::oid\b/, `${f}: لا تحويل صريح إلى oid`);
    assert.match(c, /has_function_privilege\('anon',\s*p\.oid,\s*'EXECUTE'\)/,
      `${f}: الصلاحيّة لا تُسأل بالoid`);
    // واستبعاد NULL صريح **داخل شرط الكنس نفسه**: NOT IN مع NULL يُعيد NULL
    // فيبتلع كلّ صفّ ويصير الفحص أعمى. وجودُه في مكانٍ آخر من الملفّ لا يحمي.
    // ⚠️ العبارة بحدودها الحقيقيّة، بمسحٍ متوازن للأقواس. النوافذ الثابتة
    //    خاسرة في الاتّجاهين: الضيّقة تقطع صيغة المصفوفة في RUNME، والواسعة
    //    تلتقط "is not null" من كتلة مجاورة مشروعة في PREFLIGHT.
    const ni = c.indexOf("p.oid not in (");
    assert.ok(ni > 0, `${f}: لا استبعاد بالoid`);
    const open = c.indexOf("(", ni);
    let d = 0, end = c.length;
    for (let i = open; i < c.length; i++) {
      if (c[i] === "(") d++;
      else if (c[i] === ")") { d--; if (d === 0) { end = i + 1; break; } }
    }
    assert.match(c.slice(open, end), /\bis not null\b/,
      `${f}: NULL غير مُستبعَد داخل NOT IN — يُعيد NULL فيمرّ كلّ شيء`);
  }
});

test("(١٢) ★ اسم الوسيط لا يُغيّر الهويّة — والتعريفات الحيّة تُثبته ★", () => {
  const s2 = read(CS);
  // التعريف يحمل أسماء وسائط، وقائمة السماح بالأنواع: الهويّة واحدة رغم ذلك
  assert.match(s2, /function public\.cs_public_index\(p_params jsonb/, "التعريف تغيّر");
  assert.match(s2, /function public\.cs_public_study\(p_slug text\)/, "التعريف تغيّر");
  for (const f of [PRE, RUN, POST]) {
    const c = noC(read(f));
    assert.ok(c.includes("'public.cs_public_index(jsonb)'"), `${f}: التوقيع بالأنواع مفقود`);
    assert.ok(!c.includes("p_params"), `${f}: اسم وسيط داخل عقد الصلاحيّة`);
    assert.ok(!c.includes("p_slug"), `${f}: اسم وسيط داخل عقد الصلاحيّة`);
  }
});

test("SAFE: ساكن فقط", () => {
  const src = fs.readFileSync(__filename, "utf8");
  for (const [what, re] of [["شبكة", new RegExp("\\b" + "fet" + "ch\\s*\\(")],
                            ["عمليّة", new RegExp("\\b" + "child_" + "process\\b")]])
    assert.doesNotMatch(src, re, `الفاحص يلمس ${what}`);
});
