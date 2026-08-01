// ════════════════════════════════════════════════════════════════════════════
// tests/sql_vs_markdown_artifacts.test.js
//
// المالك نسخ ملفًّا توثيقيًّا إلى محرّر SQL فحصل على:
//     ERROR: 42601 syntax error at or near "#"
//     LINE 1: # قبول التقارير التنفيذية — المرحلة ٥
//
// ولم يكن في قاعدة البيانات عطل: نُفِّذ **نوعُ ملفٍّ خاطئ**.
// والسبب المباشر سطرٌ كتبتُه أنا في مخرَج POSTCHECK:
//     'run docs/EXECUTIVE_REPORTING_ACCEPTANCE.md with owner + …'
// فعلُ الأمر «run» بجوار ‎.md‎ في مخرَجٍ يظهر داخل محرّر SQL يُقرأ حرفيًّا:
// «شغّله هنا». والحدّ الفاصل بسيط ويجب أن يبقى ميكانيكيًّا:
//     ‎.sql‎ = يُنفَّذ  ·  ‎.md‎ = يُقرأ.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const DOCS = path.join(ROOT, "docs");
const list = (ext) => fs.readdirSync(DOCS).filter((f) => f.endsWith(ext)).map((f) => `docs/${f}`);
const read = (r) => fs.readFileSync(path.join(ROOT, r), "utf8");
const SQL = list(".sql");
const MD = list(".md");

/** أسطر الشيفرة: بلا تعليقات ‎--‎ ولا كتل ‎/* *​/‎ */
function sqlCodeLines(sql) {
  const out = [];
  let block = false;
  sql.split("\n").forEach((raw, i) => {
    let l = raw;
    if (block) { const e = l.indexOf("*/"); if (e < 0) return; l = l.slice(e + 2); block = false; }
    for (;;) {
      const b = l.indexOf("/*");
      if (b < 0) break;
      const e = l.indexOf("*/", b + 2);
      if (e < 0) { l = l.slice(0, b); block = true; break; }
      l = l.slice(0, b) + l.slice(e + 2);
    }
    const c = l.indexOf("--");
    if (c >= 0) l = l.slice(0, c);
    if (l.trim()) out.push({ n: i + 1, text: l });
  });
  return out;
}

// (١) لا ملفّ ‎.md‎ داخل قائمة تشغيل SQL
test("(١) ★★ لا ملفّ .md يظهر ضمن قائمة ملفّات SQL القابلة للتشغيل ★★", () => {
  const bad = [];
  for (const f of MD) {
    const s = read(f);
    // كتلة «شغّل هذه الملفّات» = سطور مرقّمة/منقّطة تحوي ‎.sql‎
    const lines = s.split("\n");
    lines.forEach((l, i) => {
      const item = /^\s*(?:[-*+]|\d+[.)])\s/.test(l);
      if (!item) return;
      const namesMd = /\.md\b/.test(l);
      const nearSql = lines.slice(Math.max(0, i - 4), i + 5).some((x) => /\.sql\b/.test(x));
      const runVerb = /(^|\s)(run|execute|شغّل|شغل|نفّذ|نفذ)\b/i.test(l);
      if (namesMd && nearSql && runVerb) bad.push(`${f}:${i + 1}: ${l.trim().slice(0, 90)}`);
    });
  }
  assert.deepEqual(bad, [],
    "ملفّ توثيقيّ مُدرَج داخل قائمة تشغيل SQL:\n  " + bad.join("\n  "));
});

// (٢) لا Runbook يخلط التوثيق بالتنفيذ
test("(٢) ★★ لا Runbook يأمر بتشغيل ملفّ .md ★★", () => {
  const bad = [];
  for (const f of MD.filter((x) => /RUNBOOK|RUN_ORDER|DEPLOY/i.test(x))) {
    for (const [i, l] of read(f).split("\n").entries()) {
      if (/^\s*>/.test(l)) continue;                       // اقتباس تحذيريّ
      if (/(^|\s)(run|execute|paste|شغّل|شغل|نفّذ|نفذ|الصق|انسخ)\b[^\n]{0,80}?\.md\b/i.test(l)
          && !/(لا|not|never|do not|don't|بدل|instead)/i.test(l))
        bad.push(`${f}:${i + 1}: ${l.trim().slice(0, 100)}`);
    }
  }
  assert.deepEqual(bad, [], "Runbook يأمر بتشغيل توثيق:\n  " + bad.join("\n  "));
});

// (٣) لا ملفّ SQL يبدأ بعناوين Markdown
test("(٣) ★★ لا ملفّ .sql يبدأ بـ# أو ## أو *** أو ``` ★★", () => {
  const bad = [];
  for (const f of SQL) {
    const first = read(f).split("\n").find((l) => l.trim()) || "";
    if (/^\s*(#{1,6}\s|\*\*\*|```|===|---\s*$)/.test(first)) bad.push(`${f}: ${first.slice(0, 60)}`);
    // ولا عنوان Markdown في أيّ سطر شيفرة (خارج التعليقات)
    for (const { n, text } of sqlCodeLines(read(f)))
      if (/^\s*(#{1,6}\s|\*\*\*|```)/.test(text)) bad.push(`${f}:${n}: ${text.trim().slice(0, 60)}`);
  }
  assert.deepEqual(bad, [], "Markdown داخل شيفرة SQL:\n  " + bad.join("\n  "));
});

// (٤) التعليقات داخل SQL بصيغة SQL
test("(٤) ★ كلّ تعليق في .sql يستعمل -- أو /* */ ★", () => {
  const bad = [];
  for (const f of SQL) {
    for (const { n, text } of sqlCodeLines(read(f))) {
      // ‎//‎ خارج سلسلة نصّية ليست تعليق SQL
      const noStr = text.replace(/'[^']*'/g, "''");
      if (/(^|\s)\/\/\s/.test(noStr)) bad.push(`${f}:${n}: تعليق بصيغة // — ليست تعليق SQL`);
    }
  }
  assert.deepEqual(bad, [], bad.join("\n  "));
});

// (٥) الامتداد يطابق المحتوى الحقيقيّ
test("(٥) ★★ امتداد كلّ ملفّ يطابق نوعه الحقيقيّ ★★", () => {
  const bad = [];
  for (const f of MD) {
    const h = read(f).replace(/^\s+/, "").slice(0, 300).toLowerCase();
    if (/^(create\s|begin;|with\s|select\s|do\s+\$|alter\s|grant\s|revoke\s|insert\s+into)/.test(h))
      bad.push(`${f}: محتواه SQL وامتداده .md`);
  }
  for (const f of SQL) {
    const h = read(f).replace(/^\s+/, "");
    if (/^#{1,6}\s/.test(h)) bad.push(`${f}: محتواه Markdown وامتداده .sql`);
  }
  assert.deepEqual(bad, [], bad.join("\n  "));
});

// (٦) ملفّات القبول تبقى توثيقًا وتحمل التحذير
test("(٦) ★★ كلّ ملفّ قبول يدويّ يحمل التحذير ويبقى .md ★★", () => {
  const acceptance = MD.filter((f) => /ACCEPTANCE|MANUAL/i.test(f));
  assert.ok(acceptance.length >= 10, `وُجد ${acceptance.length} ملفًّا فقط`);
  const missing = acceptance.filter((f) => !/DO NOT PASTE INTO THE SQL EDITOR/.test(read(f)));
  assert.deepEqual(missing, [], "ملفّ قبول بلا تحذير:\n  " + missing.join("\n  "));
  const bilingual = acceptance.filter((f) => !/لا يُنسخ إلى محرّر SQL/.test(read(f)));
  assert.deepEqual(bilingual, [], "التحذير بلغة واحدة:\n  " + bilingual.join("\n  "));
  // ولم يُحوَّل أيٌّ منها إلى SQL ولا فقد محتواه
  assert.ok(fs.existsSync(path.join(ROOT, "docs/EXECUTIVE_REPORTING_ACCEPTANCE.md")),
    "ملفّ القبول أُعيدت تسميته أو حُذف");
  assert.ok(!fs.existsSync(path.join(ROOT, "docs/EXECUTIVE_REPORTING_ACCEPTANCE.sql")),
    "ملفّ القبول حُوِّل إلى SQL — وهو توثيق");
  assert.ok(read("docs/EXECUTIVE_REPORTING_ACCEPTANCE.md").length > 2000,
    "محتوى ملفّ القبول تقلّص — التوثيق لا يُحذف");
});

// (٧) ★ الجذر: لا فعل أمر بجوار .md في أيّ مخرَج تنفيذيّ من SQL
test("(٧) ★★ لا مخرَج SQL يأمر بتشغيل ملفّ .md ★★", () => {
  const bad = [];
  for (const f of SQL) {
    const s = read(f);
    for (const [i, l] of s.split("\n").entries()) {
      if (l.trim().startsWith("--")) continue;
      for (const m of l.matchAll(/'([^']*)'/g)) {
        const t = m[1];
        // ⚠️ بحدود: pg_catalog.md5 يحوي «.md» وليس ملفًّا. الامتداد ينتهي بحدّ كلمة.
        if (!/\.md\b(?!\d)/.test(t)) continue;
        if (/(^|\s)(run|execute|paste|شغّل|شغل|نفّذ|نفذ|الصق)\s/i.test(t)
            && !/NOT in this SQL editor|MANUAL, IN A BROWSER|لا يُنسخ/i.test(t))
          bad.push(`${f}:${i + 1}: «${t.slice(0, 95)}»`);
      }
    }
  }
  assert.deepEqual(bad, [],
    "مخرَجٌ يظهر داخل محرّر SQL ويأمر بتشغيل توثيق:\n  " + bad.join("\n  "));
});

test("(٨) ★ الفاحص غير أجوف ★", () => {
  // الحالة التي وقعت فعلًا تُدان، والصياغة المصحّحة تمرّ، وmd5 لا يُدان
  const judge = (t) => /\.md\b(?!\d)/.test(t)
    && /(^|\s)(run|execute|paste|شغّل|نفّذ)\s/i.test(t)
    && !/NOT in this SQL editor|MANUAL, IN A BROWSER|لا يُنسخ/i.test(t);
  assert.equal(judge("run docs/EXECUTIVE_REPORTING_ACCEPTANCE.md with owner"), true, "الحالة الأصليّة لم تُدَن");
  assert.equal(judge("MANUAL, IN A BROWSER — NOT in this SQL editor: open docs/X.md"), false, "الصياغة المصحّحة أُدينت");
  assert.equal(judge("pg_catalog.md5(text)"), false, "md5 أُدين — التضمين بدل حدّ الكلمة");
  assert.equal(judge("الحدود المعروفة في docs/LIMITS.md"), false, "إشارة مرجعيّة بلا فعل أمر أُدينت");
});

test("SAFE: ساكن فقط (لا شبكة ولا عمليّة ولا مفتاح خدمة)", () => {
  const src = fs.readFileSync(__filename, "utf8");
  for (const [what, re] of [["شبكة", new RegExp("\\b" + "fet" + "ch\\s*\\(")],
                            ["عمليّة", new RegExp("\\b" + "child_" + "process\\b")],
                            ["مفتاح خدمة", new RegExp("\\b" + "service_" + "role\\b")]])
    assert.doesNotMatch(src, re, `الفاحص يلمس ${what}`);
});
