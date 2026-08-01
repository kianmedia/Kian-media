// ════════════════════════════════════════════════════════════════════════════
// tests/ai_guard_before_retrieval.test.js
//
// kian_ai_assistant_RUNME.sql سقط قبل COMMIT بـ:
//     SELF-TEST فشل: ترتيب_الحارس_قبل_الاسترجاع
//
// وهو **إنذار كاذب**. الفحص كان يقارن مواضع نصّية في pg_get_functiondef الخام:
//     position('blocked_by_guard') > position('ai_search_sources')
// و**التعليق** الذي يوثّق أنّه «لا نداء لـai_search_sources في فرع المنع» يذكر
// الاسم قبل الرمز — فبدا الاسترجاع سابقًا للحارس. الشرحُ الذي ينفي الاسترجاع
// أُدين به. ثاني عشر ظهور لصنف «طابق الاسم لا الشكل».
//
// وترتيبُ ظهور الكلمات ليس ترتيب التنفيذ أصلًا. فالعقد الآن:
//   نداء الحارس → عودةٌ مغلقة في فرع المنع → أوّل نداء استرجاع.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const read = (r) => (fs.existsSync(path.join(ROOT, r)) ? fs.readFileSync(path.join(ROOT, r), "utf8") : null);
const AI = () => read("docs/kian_ai_assistant_RUNME.sql") || "";

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
 * العقد نفسه المكتوب في الفحص الذاتيّ، بمحاكاة **أمينة** لحساب SQL:
 * position() تُعيد 0 عند الغياب (لا -1)، والفهرسة من 1.
 * ⚠️ نموذج indexOf كان يستر نفيًا صامتًا: الصياغة الأولى في RUNME كانت
 *    coalesce(nullif(position('return ' in substr(src,p_g)),0),0) + p_g - 1،
 *    فإذا غاب `return` بعد الحارس أعطت p_g - 1 — لا صفرًا ولا أكبر من p_ret —
 *    فتمرّ دالّة تنادي الحارس ثمّ تتجاهله وتسترجع بلا شرط. صُحّح المصدران معًا.
 */
function judge(sql) {
  const src = execCode(sql);
  const pos = (n) => { const i = src.indexOf(n); return i < 0 ? 0 : i + 1; };
  const p_g = pos("ai_guard_question(");
  const p_ret = pos("ai_search_sources(");
  if (p_g === 0) return "لا-نداء-للحارس";
  if (p_ret === 0) return "لا-استرجاع";
  if (p_g > p_ret) return "ترتيب-الحارس-قبل-الاسترجاع";
  const rel = src.slice(p_g - 1).indexOf("return ");
  const p_ret_stmt = rel < 0 ? 0 : rel + p_g;
  if (p_ret_stmt === 0 || p_ret_stmt > p_ret) return "فرع-المنع-لا-يعود-قبل-الاسترجاع";
  return null;
}

const GOOD = `
  v_guard := public.ai_guard_question(v_q);
  if coalesce((v_guard->>'blocked')::boolean,false) then
    return jsonb_build_object('refusal_code','blocked_by_guard');
  end if;
  for r in select * from public.ai_search_sources(v_q, v_roles, 5) loop null; end loop;`;

test("(١) ★ حارس ثمّ عودة ثمّ استرجاع — يمرّ ★", () => {
  assert.equal(judge(GOOD), null, "المسار الصحيح أُدين");
});
test("(٢) ★★ استرجاع ثمّ حارس — يُدان ★★", () => {
  assert.equal(judge(`
    for r in select * from public.ai_search_sources(v_q, v_roles, 5) loop null; end loop;
    v_guard := public.ai_guard_question(v_q);
    if true then return 1; end if;`), "ترتيب-الحارس-قبل-الاسترجاع");
});
test("(٣) ★★ فرع يتجاوز العودة فيصل الاسترجاع بلا خروج — يُدان ★★", () => {
  assert.equal(judge(`
    v_guard := public.ai_guard_question(v_q);
    for r in select * from public.ai_search_sources(v_q, v_roles, 5) loop null; end loop;
    return 1;`), "فرع-المنع-لا-يعود-قبل-الاسترجاع");
});
test("(٤) ★ الحارس في تعليق لا يحمي — يُدان ★", () => {
  assert.equal(judge(`
    -- v_guard := public.ai_guard_question(v_q);
    for r in select * from public.ai_search_sources(v_q, v_roles, 5) loop null; end loop;`),
    "لا-نداء-للحارس");
});
test("(٥) ★ الحارس داخل سلسلة نصّية لا يحمي — يُدان ★", () => {
  assert.equal(judge(`
    v_note := 'public.ai_guard_question(v_q)';
    for r in select * from public.ai_search_sources(v_q, v_roles, 5) loop null; end loop;`),
    "لا-نداء-للحارس");
});
test("(٦) ★★ اسم الاسترجاع في تعليق لا يُدان — وهو ما أسقط الإنتاج ★★", () => {
  assert.equal(judge(`
    v_guard := public.ai_guard_question(v_q);
    -- لا نداء لـai_search_sources في هذا الفرع إطلاقًا
    if coalesce((v_guard->>'blocked')::boolean,false) then
      return jsonb_build_object('refusal_code','blocked_by_guard');
    end if;
    for r in select * from public.ai_search_sources(v_q, v_roles, 5) loop null; end loop;`),
    null, "التعليق الذي ينفي الاسترجاع أُدين به — العطل نفسه عاد");
});
test("(٦ب) ★★ الحارس مُنادى ومُتجاهَل بلا عودة بعده — يُدان ★★", () => {
  assert.equal(judge(`
    v_guard := public.ai_guard_question(v_q);
    for r in select * from public.ai_search_sources(v_q, v_roles, 5) loop null; end loop;`),
    "فرع-المنع-لا-يعود-قبل-الاسترجاع",
    "نداء الحارس ثمّ تجاهله مرّ — النفي الصامت عاد");
});

test("(٦ج) ★ حساب p_ret_stmt يُبقي «غير موجود» صفرًا في الملفّين ★", () => {
  for (const [f, src] of [["RUNME", AI()],
                          ["POSTCHECK", read("docs/kian_ai_assistant_POSTCHECK.sql") || ""]]) {
    assert.doesNotMatch(src, /coalesce\(nullif\(position\('return '[\s\S]{0,80}?\+\s*\w*p_g\s*-\s*1/,
      `${f}: الغياب يتحوّل إلى p_g - 1 بدل الصفر — نفي صامت`);
    assert.match(src, /position\('return ' in substr\([\s\S]{0,40}?\)\s*=\s*0 then 0/,
      `${f}: لا فرع صريح يُبقي الغياب صفرًا`);
  }
});

test("(٧) ★ ai_ask الحقيقية تمرّ بالعقد الجديد ★", () => {
  const s = AI();
  const i = s.indexOf("create or replace function public.ai_ask");
  assert.ok(i > -1, "ai_ask غير موجودة");
  const h = s.slice(i, i + 400);
  const t = h.match(/as (\$[a-z0-9_]*\$)/);
  const st = i + h.indexOf(t[1]) + t[1].length;
  const en = s.indexOf(t[1], st);
  assert.equal(judge(s.slice(i, en)), null, "ai_ask الحقيقية ما زالت مُدانة");
});
test("(٨) ★★ الفحص الذاتيّ يقيس التنفيذ لا مواضع الكلمات ★★", () => {
  const code = execCode(AI());
  assert.doesNotMatch(code, /position\('blocked_by_guard' in src\)\s*>\s*position\('ai_search_sources' in src\)/,
    "عادت مقارنة المواضع النصّية على النصّ الخام");
  assert.match(code, /ai_exec_code/, "الفحص لا يجرّد التعليقات والسلاسل");
  // ولا يقيس النصّ الخام: كلّ إسناد لـsrc يمرّ عبر المجرِّد. هذا ما أسقط الإنتاج.
  for (const m of code.matchAll(/\bsrc\s*:?=\s*([^;]+);/g))
    assert.match(m[1], /ai_exec_code\s*\(/,
      `src يُسنَد من تعريف خام بلا تجريد: ${m[1].trim().slice(0, 70)}`);
  assert.match(AI(), /فرع-المنع-لا-يعود-قبل-الاسترجاع/, "لا فحص لوجود العودة المغلقة");
  // ولم تُستثنَ الدالّة باسمها ولم يُحذف الفحص.
  assert.match(AI(), /ترتيب-الحارس-قبل-الاسترجاع/, "حُذف الفحص بدل إصلاحه");
});
test("(٩) ★ لا HTTP ولا مزوّد حيّ ولا كتابة على المشاريع ★", () => {
  const code = execCode(AI());
  for (const [w, re] of [["HTTP", /\b(pg_net|net\.http|http_(get|post))\b/i],
                         ["مزوّد", /\b(api\.openai|api\.anthropic)\b/i],
                         ["كتابة على المشاريع", /\b(insert into|update|delete from)\s+(public\.)?(projects|project_core|deliverables)\b/i]])
    assert.doesNotMatch(code, re, `${w} في حزمة تُعلن أنّها معطَّلة`);
});
test("SAFE: ساكن فقط", () => {
  const src = fs.readFileSync(__filename, "utf8");
  for (const b of ["fet" + "ch(", "child_" + "process", "service_" + "role"]) assert.ok(!src.includes(b));
});
