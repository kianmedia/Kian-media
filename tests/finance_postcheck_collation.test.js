// ════════════════════════════════════════════════════════════════════════════
// tests/finance_postcheck_collation.test.js
//
// الحادثة: POSTCHECK سقط على الإنتاج بـ42P21 —
//   recursive query "walk" column 2 has collation "default" in non-recursive
//   term but collation "C" overall
// السبب: `pg_proc.proname` من نوع `name` ويجرّ ترتيب "C"، بينما `regexp_matches`
// و`values(...)` تُعيدان `text` بالترتيب **الافتراضيّ لقاعدة البيانات**. التقاؤهما
// في حدَّي UNION تكراريّ يرفع الخطأ. الفحص نفسه كان سليمًا؛ الاستعلام كان يعتمد
// ضمنًا على ترتيب البيئة — وهذا ما يجعله ينجح محليًّا ويسقط على الإنتاج.
//
// هذه الاختبارات تحرس **عدم الاعتماد على الترتيب الافتراضيّ**، لا مجرد وجود الكلمة.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const PC = read("docs/finance_profitability_POSTCHECK.sql");

/** يستخرج جسم CTE بالاسم. */
function cte(sql, name) {
  const i = sql.indexOf(`${name}(`);
  if (i < 0) return null;
  const open = sql.indexOf("as (", i);
  if (open < 0) return null;
  let d = 0;
  for (let k = sql.indexOf("(", open + 2); k < sql.length; k++) {
    if (sql[k] === "(") d++;
    else if (sql[k] === ")") { d--; if (d === 0) return sql.slice(open, k + 1); }
  }
  return null;
}

test("1 · كل حدّ في المشي التكراريّ يثبّت الترتيب صراحةً", () => {
  for (const name of ["gwalk", "coll_walk", "gate_seed"]) {
    const body = cte(PC, name);
    assert.ok(body, `CTE مفقودة: ${name}`);
    const terms = body.split(/\bunion\b(?:\s+all)?/i);
    assert.ok(terms.length >= 2, `${name} ليست اتحادًا`);
    for (let i = 0; i < terms.length; i++) {
      assert.match(terms[i], /collate\s+"C"/i,
        `${name}: الحدّ ${i + 1} بلا COLLATE صريح — يعتمد على ترتيب البيئة`);
    }
  }
});

test("2 · مصادر النصّ مثبَّتة قبل أن تلتقي في الاتحاد", () => {
  // proname يجرّ "C"؛ regexp_matches تُعيد الافتراضيّ. كلاهما يُثبَّت عند المصدر.
  assert.match(cte(PC, "fin_proc"), /proname::text\s+collate\s+"C"/i,
    "fin_proc لا يثبّت proname");
  const edge = cte(PC, "fin_edge");
  assert.equal((edge.match(/collate\s+"C"/gi) || []).length >= 2, true,
    "fin_edge يجب أن يثبّت caller و callee معًا");
});

test("3 · بذور values لا تدخل اتحادًا تكراريًّا بلا تثبيت", () => {
  // `values ('a'),('b')` تُنتج text بالترتيب **الافتراضيّ**. هذا هو الطرف الذي
  // سقط فعلًا: gate_seed كان يقرأ من owner_gate/no_descent بلا COLLATE.
  for (const seed of ["gate_seed", "coll_walk"]) {
    const body = cte(PC, seed);
    const nonRecursive = body.split(/\bunion\b(?:\s+all)?/i)[0];
    const collates = (nonRecursive.match(/collate\s+"C"/gi) || []).length;
    assert.ok(collates >= 1,
      `${seed}: الحدّ غير التكراريّ يقرأ من values بلا COLLATE — نفس سبب 42P21`);
  }
});

test("4 · الفحص لم يُضعَّف — رسم النداء ما زال قائمًا", () => {
  // الإصلاح كان يجب ألّا يحذف التحقّق من الانحدار.
  assert.ok(PC.includes("finops_can_view_finance_sensitive"), "جذر البوّابة الحسّاسة اختفى");
  assert.ok(cte(PC, "gwalk"), "المشي التكراريّ حُذف بدل إصلاحه");
  assert.ok(cte(PC, "fin_edge"), "أضلاع رسم النداء حُذفت");
  // النمط السيّئ يُفحص في **الكود** لا في التعليق الذي يشرح تجنّبه.
  const code = PC.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  assert.ok(!/\[\^\)\]\*/.test(code), "عاد النمط الذي يقف عند أوّل قوس");
});

test("5 · POSTCHECK ما زال للقراءة فقط", () => {
  for (const line of PC.split("\n")) {
    assert.ok(!/^\s{0,3}(insert|update|delete|drop|alter|truncate|create|grant|revoke)\s/i.test(line),
      `عبارة كتابة في ملفّ قراءة: ${line.trim().slice(0, 60)}`);
  }
});
