// ════════════════════════════════════════════════════════════════════════════
// tests/finance_postcheck_collation.test.js
//
// الحادثة: POSTCHECK سقط على الإنتاج بـ42P21 —
//   recursive query column has collation "default" in non-recursive term
//   but collation "C" overall
// السبب: `pg_proc.proname` من نوع `name` ويجرّ ترتيب "C"، بينما `regexp_matches`
// و`values(...)` تُنتجان `text` بالترتيب **الافتراضيّ لقاعدة البيانات**. التقاؤهما
// في حدَّي UNION تكراريّ يرفع الخطأ — ولهذا نجح محليًّا وسقط على الإنتاج.
//
// ★ ولماذا أُعيدت كتابة هذا الملفّ ★
//   النسخة الأولى فحصت CTEs **بالاسم** (gwalk / coll_walk / gate_seed)، فمرّت
//   خضراء بينما كتلة `$verdict$` الثانية — بأسمائها w / cw / seed / og — لم
//   تُصلَح إطلاقًا. اختبار يعرف أسماء اليوم يعمى عن كتلة الغد. الفحص الآن
//   **بنيويّ**: يجد كل `with recursive` في الملفّ ويفحص كل حدّ فيها.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const FILE = "docs/finance_profitability_POSTCHECK.sql";
const PC = fs.readFileSync(path.join(ROOT, FILE), "utf8");

/** يُسقط تعليقات `--` حتى لا يُخدع الفحص بنصّ يشرح النمط السيّئ. */
const stripComments = (s) =>
  s.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

/**
 * كل كتلة `with recursive` في الملفّ. تقسيم بسيط مقصود: المُحلّل السابق حاول
 * إيجاد `;` على عمق أقواس صفر، وهو غير موثوق داخل جسم `do $verdict$` حيث تختلّ
 * الموازنة. الشريحة حتى الـ`with recursive` التالية تكفي تمامًا لحارس نصّيّ،
 * ولا تُخطئ في الاتجاه الخطر (قد تضمّ زيادة، ولن تُسقط كتلة).
 */
function recursiveBlocks(sql) {
  const idx = [];
  const re = /with\s+recursive\b/gi;
  let m;
  while ((m = re.exec(sql))) idx.push(m.index);
  return idx.map((start, i) => sql.slice(start, i + 1 < idx.length ? idx[i + 1] : sql.length));
}

/** كل CTE داخل كتلة: الاسم + الجسم بين قوسي `as ( ... )`. */
function ctes(block) {
  const out = [];
  const re = /([a-z_][a-z0-9_]*)\s*(\([^)]*\))?\s+as\s*\(/gi;
  let m;
  while ((m = re.exec(block))) {
    let d = 1;
    const start = m.index + m[0].length;
    for (let k = start; k < block.length; k++) {
      if (block[k] === "(") d++;
      else if (block[k] === ")") { d--; if (d === 0) { out.push({ name: m[1], body: block.slice(start, k) }); break; } }
    }
  }
  return out;
}

const BLOCKS = recursiveBlocks(stripComments(PC));

test("0 · الملفّ يحوي أكثر من كتلة تكراريّة — وإلّا فالحارس بلا معنى", () => {
  assert.ok(BLOCKS.length >= 2,
    `وُجدت ${BLOCKS.length} كتلة فقط. النسخة السابقة سقطت لأنها فحصت واحدة.`);
});

test("1 · كل حدّ في كل CTE تكراريّة يثبّت الترتيب صراحةً", () => {
  let checked = 0;
  BLOCKS.forEach((block, bi) => {
    ctes(block).forEach(({ name, body }) => {
      const terms = body.split(/\bunion\b(?:\s+all)?/i);
      if (terms.length < 2) return;              // ليست اتحادًا — لا يعنينا
      // ★ الشرط الحاسم: **تكراريّة فعلًا** — أي أن جسمها يشير إلى اسمها.
      //   PostgreSQL يفرض توافق الترتيب في الاتحاد **التكراريّ** وحده؛ اتحاد
      //   عاديّ مثل `failures` لا يرفع 42P21، وفحصه تشدّد بلا سبب.
      const selfRef = new RegExp(`\\b${name}\\b`, "i");
      if (!selfRef.test(body)) return;
      // ولا نعني CTEs بلا أعمدة نصّيّة إطلاقًا.
      if (!/\bname\b|\bcallee\b|\bcaller\b|\bgate\b|\bnode\b|\bfn\b|proname|rx\.m/i.test(body)) return;
      checked++;
      terms.forEach((t, ti) => {
        assert.match(t, /collate\s+"C"/i,
          `الكتلة ${bi + 1} · CTE «${name}» · الحدّ ${ti + 1}: بلا COLLATE صريح ⇒ 42P21`);
      });
    });
  });
  assert.ok(checked >= 3, `فُحصت ${checked} CTE فقط — الفحص يبدو أنه لا يصل إلى الكتلتين`);
});

test("2 · لا نمط خام باقٍ في أيّ مكان من الملفّ", () => {
  const code = stripComments(PC);
  for (const bad of [
    "p.proname::text,",
    "select name, name, 0",
    "select gate, node, hops",
    "select cs.fn, 0",
    "select b.name, rx.m[1]",
    "select e.callee, w.hops",
  ]) {
    assert.ok(!code.includes(bad), `نمط غير مثبَّت باقٍ: ${bad}`);
  }
});

test("3 · كلتا الكتلتين مثبَّتتان — لا واحدة دون الأخرى", () => {
  const i = PC.indexOf("do $verdict$");
  assert.ok(i > 0, "كتلة verdict غير موجودة");
  const report = PC.slice(0, i);
  const verdict = PC.slice(i);
  const nReport = (report.match(/collate\s+"C"/gi) || []).length;
  const nVerdict = (verdict.match(/collate\s+"C"/gi) || []).length;
  assert.ok(nReport >= 10, `كتلة التقرير: ${nReport} تثبيتًا فقط`);
  assert.ok(nVerdict >= 10, `كتلة verdict: ${nVerdict} تثبيتًا فقط — هذه هي التي فاتت سابقًا`);
});

test("4 · الفحص لم يُضعَّف — رسم النداء ما زال قائمًا", () => {
  const code = stripComments(PC);
  assert.ok(PC.includes("finops_can_view_finance_sensitive"), "جذر البوّابة الحسّاسة اختفى");
  assert.ok(!/\[\^\)\]\*/.test(code), "عاد النمط الذي يقف عند أوّل قوس");
  assert.ok(/finops_can_manage/i.test(code), "لم تبقَ بوّابة finops_can_manage مفحوصة");
});

test("5 · POSTCHECK ما زال للقراءة فقط", () => {
  for (const line of PC.split("\n")) {
    assert.ok(!/^\s{0,3}(insert|update|delete|drop|alter|truncate|create|grant|revoke)\s/i.test(line),
      `عبارة كتابة في ملفّ قراءة: ${line.trim().slice(0, 60)}`);
  }
});
