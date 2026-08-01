// ════════════════════════════════════════════════════════════════════════════
// tests/ai_runme_postcheck_parity.test.js
//
// RUNME رُكّبت بنجاح (SELF-TEST PASS → COMMIT) ثمّ أدان POSTCHECK الشيفرة
// نفسها: 146 صفًّا، 145 PASS، وفشل واحد «المنع يسبق الاسترجاع».
//
// السبب أنّ r_guard_before_retrieval بقي على القاعدة المعيبة التي أُصلحت في
// RUNME بالالتزام 2ea378e: مقارنة **مواضع نصّية** في pg_get_functiondef الخام
//     position('blocked_by_guard') < position('ai_search_sources')
// والتعليقُ في فرع المنع يذكر ai_search_sources قبل الرمز — فالجملة التي تنفي
// الاسترجاع هي التي أدانت الشيفرة. ثالث عشر ظهور لصنف «طابق الاسم لا الشكل»،
// وثاني مرّة يتباعد فيها ملفّان على الشيفرة الواحدة.
//
// لذا لا يكفي أن يمرّ كلّ ملفّ بقاعدته: يجب أن تكون القاعدة **واحدة**.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const read = (r) => fs.readFileSync(path.join(ROOT, r), "utf8");
const RUNME = () => read("docs/kian_ai_assistant_RUNME.sql");
const POST = () => read("docs/kian_ai_assistant_POSTCHECK.sql");

/** نظير ai_exec_code: تعليقات محذوفة، محتوى السلاسل مُفرَّغ. */
function execCode(sql) {
  let out = "", i = 0, q = false;
  while (i < sql.length) {
    const c = sql[i];
    if (q) { if (c === "'") { if (sql.startsWith("''", i)) { i += 2; continue; } q = false; out += "''"; } i++; continue; }
    if (c === "'") { q = true; i++; continue; }
    if (sql.startsWith("--", i)) { while (i < sql.length && sql[i] !== "\n") i++; continue; }
    out += c; i++;
  }
  return out;
}

/**
 * محاكاة **أمينة** لحساب SQL: position() تُعيد 0 عند الغياب (لا -1)، والفهرسة
 * من 1، وsubstr(src, p) تبدأ من المحرف p.
 * ⚠️ نموذج indexOf المريح لا يكفي: هو يُعيد -1 فيلتقط الغياب مجّانًا، بينما
 *    حساب SQL كان يحوّل الغياب إلى p_g - 1 فيمرّ. الفارق بين النموذجين هو
 *    بالضبط النفي الصامت الذي كان مختبئًا، فيُقاس النموذجان معًا ويُشترط
 *    اتّفاقهما على كلّ Fixture.
 */
function judgeSql(body) {
  const src = execCode(body);
  const pos = (needle, from = 1) => { const i = src.indexOf(needle, from - 1); return i < 0 ? 0 : i + 1; };
  const p_g = pos("ai_guard_question(");
  const p_ret = pos("ai_search_sources(");
  if (p_g === 0) return "لا-نداء-للحارس";
  if (p_ret === 0) return "لا-استرجاع";
  if (p_g > p_ret) return "الاسترجاع-يسبق-الحارس";
  const rel = src.slice(p_g - 1).indexOf("return ");
  const p_ret_stmt = rel < 0 ? 0 : rel + 1 + p_g - 1;
  if (p_ret_stmt === 0 || p_ret_stmt > p_ret) return "فرع-المنع-لا-يعود-قبل-الاسترجاع";
  return null;
}

/** النموذج المقصود (indexOf). يجب أن يوافق judgeSql على كلّ حالة. */
function judgeIntent(body) {
  const src = execCode(body);
  const g = src.indexOf("ai_guard_question(");
  const ret = src.indexOf("ai_search_sources(");
  if (g < 0) return "لا-نداء-للحارس";
  if (ret < 0) return "لا-استرجاع";
  if (g > ret) return "الاسترجاع-يسبق-الحارس";
  const retStmt = src.indexOf("return ", g);
  if (retStmt < 0 || retStmt > ret) return "فرع-المنع-لا-يعود-قبل-الاسترجاع";
  return null;
}

const judge = judgeSql;

/**
 * تجريد التعليقات **مع الإبقاء على السلاسل**، بوعي بالاقتباس.
 * ⚠️ لا تُستعمل execCode هنا: رموزُ القاعدة نفسها سلاسل نصّية
 * ('ai_guard_question(' وأخواتها)، وتفريغُ السلاسل يمحو ما نبحث عنه.
 */
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

/** بصمة القاعدة كما هي مكتوبة في ملفّ SQL: الرموز والمقارنات، لا الصياغة. */
function ruleFingerprint(sqlSlice) {
  const c = stripComments(sqlSlice);
  return {
    stripsSource: /ai_exec_code\s*\(/.test(c),
    guardToken: /'ai_guard_question\('/.test(c),
    retrievalToken: /'ai_search_sources\('/.test(c),
    returnToken: /'return '/.test(c),
    ordersGuardFirst: /p_g\s*>\s*p_ret\b/.test(c),
    requiresClosedReturn: /p_ret_stmt\s*=\s*0\s+or\s+p_ret_stmt\s*>\s*p_ret/.test(c),
    // ولا أثر للقاعدة المعيبة:
    rawWordOrder: /position\('blocked_by_guard'[\s\S]{0,200}position\('ai_search_sources'/.test(c),
  };
}

const runmeRule = () => {
  const s = RUNME(); const i = s.indexOf("p_g   := coalesce(position('ai_guard_question(");
  assert.ok(i > 0, "قاعدة RUNME غير موجودة"); return s.slice(i - 400, i + 1600);
};
const postRule = () => {
  const s = POST(); const i = s.indexOf("ask_flow as (");
  assert.ok(i > 0, "قاعدة POSTCHECK غير موجودة");
  return s.slice(i, s.indexOf("r_no_execute_in_ask"));
};

/**
 * **منطقة القرار** وحدها: سلسلة if/elsif في RUNME، وتعبير CASE الذي يُنتج
 * verdict في POSTCHECK.
 * ⚠️ لولا هذا التضييق لبقيت البصمة صادقة بعد حذف فرعٍ من الحكم: فنصّ الشرط
 *    نفسه يتكرّر في عبارة detail التفسيريّة، فيَستُر حذفَ الحكم.
 */
const runmeDecision = () => {
  const r = runmeRule(); const i = r.indexOf("if p_g = 0 then");
  assert.ok(i > 0, "سلسلة قرار RUNME غير موجودة");
  return r.slice(i, r.indexOf("end if;", i));
};
const postDecision = () => {
  const r = postRule(); const i = r.indexOf("select case when src is null");
  assert.ok(i > 0, "تعبير قرار POSTCHECK غير موجود");
  return r.slice(i, r.indexOf("end as verdict", i));
};

// ── (أ) التطابق ────────────────────────────────────────────────────────────
test("(١) ★★ RUNME وPOSTCHECK يحملان العقد نفسه رمزًا رمزًا ★★", () => {
  const a = ruleFingerprint(runmeRule()), b = ruleFingerprint(postRule());
  // والفروع الأربعة موجودة في **منطقة القرار** لا في الشرح المرافق.
  const da = stripComments(runmeDecision()), db = stripComments(postDecision());
  for (const [what, re] of [["لا-حارس", /p_g\s*=\s*0/],
                            ["لا-استرجاع", /p_ret\s*=\s*0/],
                            ["الحارس-قبل-الاسترجاع", /p_g\s*>\s*p_ret/],
                            ["عودة-مغلقة", /p_ret_stmt\s*=\s*0\s+or\s+p_ret_stmt\s*>\s*p_ret/]]) {
    assert.match(da, re, `فرع الحكم «${what}» مفقود من RUNME`);
    assert.match(db, re, `فرع الحكم «${what}» مفقود من POSTCHECK`);
  }
  assert.equal((db.match(/'FAIL'/g) || []).length, 5, "عدد فروع الإدانة في POSTCHECK تغيّر");
  assert.deepEqual(b, a, "الملفّان يحكمان على الشيفرة الواحدة بقاعدتين مختلفتين");
  assert.equal(a.rawWordOrder, false, "القاعدة المعيبة ما زالت في RUNME");
  assert.equal(b.rawWordOrder, false, "القاعدة المعيبة ما زالت في POSTCHECK");
  for (const k of ["stripsSource", "guardToken", "retrievalToken", "returnToken",
                   "ordersGuardFirst", "requiresClosedReturn"])
    assert.equal(a[k], true, `العقد ناقص: ${k}`);
});

test("(٢) ★ POSTCHECK لا يقيس التعريف الخام في أيّ موضع ★", () => {
  const c = stripComments(POST());
  const bad = [...c.matchAll(/position\('[a-z_]+' in pg_get_functiondef/g)].map((m) => m[0]);
  assert.deepEqual(bad, [], `قياس على تعريف خام بلا تجريد: ${bad.join(" · ")}`);
});

// ── (ب) الـFixtures الاثنا عشر — الحكم نفسه للملفّين ────────────────────────
const F = (body) => body;
const CASES = [
  ["١ حارس ← فرع منع ← عودة ← استرجاع", F(`
     v_guard := public.ai_guard_question(v_q);
     if coalesce((v_guard->>'blocked')::boolean,false) then
       return jsonb_build_object('refusal_code','blocked_by_guard');
     end if;
     for r in select * from public.ai_search_sources(v_q,v_roles,5) loop null; end loop;`), null],
  ["٢ استرجاع قبل الحارس", F(`
     for r in select * from public.ai_search_sources(v_q,v_roles,5) loop null; end loop;
     v_guard := public.ai_guard_question(v_q); return 1;`), "الاسترجاع-يسبق-الحارس"],
  ["٣ فرع منع بلا return", F(`
     v_guard := public.ai_guard_question(v_q);
     for r in select * from public.ai_search_sources(v_q,v_roles,5) loop null; end loop;
     return 1;`), "فرع-المنع-لا-يعود-قبل-الاسترجاع"],
  ["٤ اسم الاسترجاع في تعليق لا يُدان", F(`
     v_guard := public.ai_guard_question(v_q);
     -- لا نداء لـai_search_sources في هذا الفرع إطلاقًا
     if true then return jsonb_build_object('refusal_code','blocked_by_guard'); end if;
     for r in select * from public.ai_search_sources(v_q,v_roles,5) loop null; end loop;`), null],
  ["٥ الحارس في تعليق لا يحمي", F(`
     -- v_guard := public.ai_guard_question(v_q);
     for r in select * from public.ai_search_sources(v_q,v_roles,5) loop null; end loop;`), "لا-نداء-للحارس"],
  ["٦ الحارس في سلسلة نصّية لا يحمي", F(`
     v_note := 'public.ai_guard_question(v_q) يسبق الاسترجاع';
     for r in select * from public.ai_search_sources(v_q,v_roles,5) loop null; end loop;`), "لا-نداء-للحارس"],
  ["٧ مسار استرجاع ثانٍ قبل الحارس", F(`
     for r0 in select * from public.ai_search_sources(v_q,v_roles,1) loop null; end loop;
     v_guard := public.ai_guard_question(v_q);
     if true then return 1; end if;
     for r in select * from public.ai_search_sources(v_q,v_roles,5) loop null; end loop;`),
   "الاسترجاع-يسبق-الحارس"],
  ["٨ استرجاع بلا حارس البتّة", F(`
     for r in select * from public.ai_search_sources(v_q,v_roles,5) loop null; end loop;`),
   "لا-نداء-للحارس"],
  // ★ الحالة التي كشفت النفي الصامت: الحارس يُنادى ثمّ **يُتجاهَل**، ولا
  //   `return` بعده إطلاقًا، والاسترجاع يقع بلا شرط.
  ["٩ الحارس مُنادى ومُتجاهَل بلا أيّ عودة بعده", F(`
     v_guard := public.ai_guard_question(v_q);
     for r in select * from public.ai_search_sources(v_q,v_roles,5) loop null; end loop;`),
   "فرع-المنع-لا-يعود-قبل-الاسترجاع"],
];

test("(٣) ★★ تسعة Fixtures للتدفّق: الحكم واحد في الملفّين ★★", () => {
  for (const [name, body, expected] of CASES)
    assert.equal(judgeSql(body), expected, `Fixture ${name}`);
});

test("(٣ب) ★★ حساب SQL والنموذج المقصود متّفقان على كلّ Fixture ★★", () => {
  for (const [name, body] of CASES)
    assert.equal(judgeSql(body), judgeIntent(body),
      `حساب SQL يخالف النموذج المقصود عند: ${name} — نفيٌ صامت مختبئ في الحساب`);
});

/**
 * الحكم مع تتبّع النداءات: يُدرَج جسمُ كلّ دالّة مُناداة مكان ندائها مرّة واحدة.
 * ⚠️ هذا البعد **ليس** في عقد RUNME/POSTCHECK: كلاهما يقيس دالّة واحدة.
 *    فهو محروس هنا ساكنًا على ملفّات المستودع فقط، ومُعلَن بهذا الحدّ.
 */
function judgeCallGraph(entry, helpers) {
  let body = entry;
  for (const [name, src] of Object.entries(helpers))
    body = body.replace(new RegExp(`\\bpublic\\.${name}\\s*\\([^;]*\\)`), `/*inl*/ ${src}`);
  return judge(body);
}

test("(٤) ★★ Helper تسترجع قبل الحارس تُدان عبر تتبّع النداءات ★★", () => {
  const bad = { ai_prefetch: "for r in select * from public.ai_search_sources(v_q,v_roles,5) loop null; end loop;" };
  const ok = { ai_prefetch: "select 1;" };
  const entry = `
    v_x := public.ai_prefetch(v_q);
    v_guard := public.ai_guard_question(v_q);
    if true then return 1; end if;
    for r in select * from public.ai_search_sources(v_q,v_roles,5) loop null; end loop;`;
  assert.equal(judgeCallGraph(entry, bad), "الاسترجاع-يسبق-الحارس",
    "Helper تسترجع قبل الحارس مرّت — التتبّع لا يعمل");
  assert.equal(judgeCallGraph(entry, ok), null, "إنذار كاذب على helper بريئة");
});

test("(٥) ★ لا دالّة ai_ تسترجع قبل حارسها في المستودع كلّه ★", () => {
  const s = RUNME();
  const offenders = [];
  for (const m of s.matchAll(/create or replace function public\.(ai_[a-z0-9_]+)\s*\(/g)) {
    const t = s.slice(m.index, m.index + 700).match(/as (\$[a-z0-9_]*\$)/);
    if (!t) continue;
    const st = s.indexOf(t[1], m.index) + t[1].length;
    const body = execCode(s.slice(st, s.indexOf(t[1], st)));
    const ret = body.indexOf("ai_search_sources(");
    if (ret < 0) continue;
    const g = body.indexOf("ai_guard_question(");
    if (g < 0 || g > ret) offenders.push(m[1]);
  }
  assert.deepEqual(offenders, [], `دوالّ تسترجع بلا حارس سابق: ${offenders.join(" · ")}`);
});

test("(٦) ★ ai_ask المطبَّقة تمرّ بالعقد الواحد ★", () => {
  const s = RUNME(); const i = s.indexOf("create or replace function public.ai_ask(");
  const t = s.slice(i, i + 500).match(/as (\$[a-z0-9_]*\$)/)[1];
  const st = s.indexOf(t, i) + t.length;
  assert.equal(judge(s.slice(st, s.indexOf(t, st))), null, "ai_ask المطبَّقة مُدانة بالعقد");
});

// ── (ج) POSTCHECK ما زال آمنًا في محرّر SQL ────────────────────────────────
test("(٧) ★ قراءة فقط · جملة واحدة · بلا معاملة ★", () => {
  const c = execCode(POST());
  assert.doesNotMatch(c, /^\s*(insert|update|delete|create|alter|drop|truncate|grant|revoke)\s/im, "يكتب");
  assert.doesNotMatch(c, /\b(begin|commit|rollback)\s*;/i, "يفتح معاملة");
  assert.doesNotMatch(c, /exception when others/i, "catch-all");
  let d = 0, stmts = 0;
  for (const ch of c) { if (ch === "(") d++; else if (ch === ")") d--; else if (ch === ";" && d === 0) stmts++; }
  assert.equal(stmts, 1, `${stmts} جملة — المحرّر يعرض الأخيرة فقط`);
});

test("(٨) ★ لا مرجع أماميّ: ask_flow ← ask_flow_pos ← r_guard_before_retrieval ★", () => {
  const s = POST();
  const order = ["ask_flow as (", "ask_flow_pos as (", "r_guard_before_retrieval as ("].map((k) => s.indexOf(k));
  assert.ok(order.every((x) => x > 0), "كتلة مفقودة");
  assert.deepEqual(order, [...order].sort((a, b) => a - b), "WITH غير تعاودية ترى ما سبقها فقط");
});

test("(٩) ★ لا استثناء بالاسم ولا تحويل FAIL إلى INFO/SKIP ★", () => {
  const r = postRule();
  assert.doesNotMatch(r, /'(INFO|SKIP)'/, "الفحص خُفِّض إلى INFO/SKIP");
  assert.match(r, /'FAIL'/, "الفحص لم يعد قادرًا على الإدانة");
  assert.match(r, /'PASS'/, "الفحص بلا حالة نجاح");
  // وعدد صفوف النتيجة لم يتغيّر: الفحص ما زال موصولًا، والكتلتان المساعدتان
  // ليستا صفَّي نتيجة. (وهذا ما يُبقي الإجمالَ 146 كما هو.)
  const p = POST();
  assert.equal((p.match(/union all select \* from r_guard_before_retrieval\b/g) || []).length +
               (p.match(/\(select \* from r_guard_before_retrieval\b/g) || []).length, 1,
               "صفّ الفحص إمّا مفقود من الاتّحاد أو مكرَّر فيه");
  for (const helper of ["ask_flow", "ask_flow_pos"])
    assert.doesNotMatch(p, new RegExp(`from ${helper}\\b(?![_a-z])[\\s\\S]{0,40}union`),
      `${helper} كتلة مساعدة ولا يجوز أن تكون صفّ نتيجة`);
});

test("(١٠) ★★ كلّ فحص نفي في POSTCHECK يُقاس على شيفرة مجرَّدة ★★", () => {
  // فحص النفي = يُدين عند العثور على الرمز. تعليقٌ يذكر الرمز كان يُدين
  // شيفرة سليمة. أمّا فحوص الإثبات فمُستثناة بالشكل: هي تُنجح عند العثور.
  const c = stripComments(POST());
  // التصنيف **بالشكل** لا بالاسم: الكتلة التي حكمها `count(*) = 0 then 'PASS'`
  // هي فحص نفي؛ والتي تحكم `... then 'PASS'` عند المطابقة هي فحص إثبات.
  // مصنِّف **واحد** يقسم الكتل قسمة تامّة. (تصنيفان مختلفان أوقعا كتلةً
  // واحدة في المجموعتين معًا، فأدانها الحارس وهي سليمة.)
  // الحدود على **كلّ** كتلة WITH لا على المُصدَّرة بـr_ وحدها: الكتلتان
  // المساعدتان ask_flow/ask_flow_pos تقعان بين كتلتَي نتيجة، فحدٌّ يتجاهلهما
  // يجعل شريحة الكتلة السابقة تبتلعهما وتَرِث سماتِهما.
  const blocks = [...c.matchAll(/^([a-z_][a-z0-9_]*) as \(/gm)];
  const classified = blocks
    .map((b, i) => ({
      name: b[1],
      body: c.slice(b.index, i + 1 < blocks.length ? blocks[i + 1].index : c.length),
    }))
    .filter((x) => x.name.startsWith("r_") && /pg_get_functiondef\s*\(/.test(x.body))
    .map((x) => ({
      ...x,
      // نفي: يُدين عند العثور — إمّا عدّ يجب أن يكون صفرًا، أو فرع 'FAIL' مباشر.
      negative: /count\(\*\)\s*=\s*0\s+then\s+'PASS'/.test(x.body) ||
                /~[\s\S]{0,300}?then\s+'FAIL'/.test(x.body),
      strips: /ai_exec_code\s*\(/.test(x.body),
    }));

  const negatives = classified.filter((x) => x.negative);
  const positives = classified.filter((x) => !x.negative);
  assert.ok(negatives.length >= 5, `فحوص النفي اختفت (${negatives.length})`);
  assert.ok(positives.length >= 5, `فحوص الإثبات اختفت (${positives.length}) — حُذفت أو غُيّرت بلا إعلان`);

  const raw = negatives.filter((x) => !x.strips).map((x) => x.name);
  assert.deepEqual(raw, [],
    "فحص نفي يقيس النصّ الخام — تعليقٌ يذكر الرمز سيُدين شيفرة سليمة:\n  " + raw.join("\n  "));

  // وفحوص الإثبات تبقى على النصّ الخام: تجريدُها يجعلها **أشدّ** (رمزٌ مذكور
  // في تعليق يكفّ عن إرضاء الشرط) وقد يقلب PASS إلى FAIL على الإنتاج. وهو
  // تغيير دلاليّ يحتاج تحقّقًا حيًّا، فلا يمرّ صامتًا.
  const stripped = positives.filter((x) => x.strips).map((x) => x.name);
  assert.deepEqual(stripped, [],
    "فحص إثبات صار يقيس شيفرة مجرَّدة — تشديدٌ غير مُتحقَّق منه على الإنتاج:\n  " + stripped.join("\n  "));
  // والعائلة الثلاثة موصولة فعلًا بالمجرِّد
  for (const k of ["r_no_execute_in_ask", "r_execute_census", "r_no_http",
                   "r_no_relay", "r_no_entity_creation"]) {
    const i = c.indexOf(k + " as (");
    assert.ok(i > 0, `${k} مفقود`);
    assert.match(c.slice(i, i + 900), /ai_exec_code/, `${k} ما زال يقيس النصّ الخام`);
  }
});

test("SAFE: ساكن فقط (لا شبكة ولا عمليّة ولا مفتاح خدمة)", () => {
  const src = fs.readFileSync(__filename, "utf8");
  // ⚠️ بحدود الكلمة لا بالتضمين: المُعرِّف ai_prefetch في Fixture ساكن يحوي
  //    اسمَ دالّة الشبكة نصًّا داخله. وهذا صنف الخطأ نفسه الذي يعالجه الملفّ:
  //    التضمين يُدين مُعرِّفًا بريئًا، وحدُّ الكلمة يفرّق بينهما.
  for (const [what, re] of [["شبكة", new RegExp("\\b" + "fet" + "ch\\s*\\(")],
                            ["عمليّة", new RegExp("\\b" + "child_" + "process\\b")],
                            ["مفتاح خدمة", new RegExp("\\b" + "service_" + "role\\b")]])
    assert.doesNotMatch(src, re, `الفاحص يلمس ${what}`);
});
