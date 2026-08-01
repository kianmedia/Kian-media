// ════════════════════════════════════════════════════════════════════════════
// tests/sql_postcheck_union_types.test.js
//
// executive_reporting_POSTCHECK.sql لم يُنتج صفًّا واحدًا: خطأ نوعٍ أثناء
// تحليل الاستعلام. فروع UNION يجب أن تتّفق أنواعُها عمودًا بعمود، وفرعٌ واحد
// وضع تعبيرًا **منطقيًّا** (not exists …) في خانة detail النصّية.
//
// والسبب الأعمق أخطر: عمود الحكم سقط من ذلك الفرع فانزاحت الأعمدة يسارًا،
// فحلّ '13 حزمة' محلّ verdict — أي صفٌّ لا يقول PASS ولا FAIL مهما كانت
// الحقيقة. فحصٌ لا يستطيع أن يفشل ليس فحصًا.
//
// وملفّ POSTCHECK جملةٌ واحدة: فرعٌ واحد معطوب يُسقط الملفّ كلّه قبل أيّ صفّ.
// ولا قاعدة بيانات هنا، فيُمنع الصنف ساكنًا: تُعدّ الأعمدة، وتُستنتج أنواعها،
// ويُشترط أن يُنتج عمود الحكم PASS/FAIL.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const read = (r) => (fs.existsSync(path.join(ROOT, r)) ? fs.readFileSync(path.join(ROOT, r), "utf8") : null);

/**
 * تجريد التعليقات بوعي بالاقتباس.
 * ⚠️ لا بدّ منه **قبل** موازنة الأقواس: التعليق «-- ─── 17) خطوة…» يحمل قوسًا
 *    مغلقًا، فموازنةٌ على النصّ الخام تُنهي الكتلة في منتصفها وتُخفي فرعًا.
 *    PostgreSQL يُسقط التعليقات أوّلًا، والفاحص يجب أن يفعل مثله.
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

/** يقسم على كلمة مفتاحية في العمق صفر، بوعي بالاقتباس. */
function splitTop(t, kw) {
  const out = []; let d = 0, q = false, last = 0, i = 0;
  while (i < t.length) {
    const c = t[i];
    if (q) { if (c === "'") { if (t.startsWith("''", i)) { i += 2; continue; } q = false; } i++; continue; }
    if (c === "'") { q = true; i++; continue; }
    if (c === "(") d++;
    else if (c === ")") d--;
    else if (d === 0 && t.slice(i, i + kw.length).toLowerCase() === kw) {
      out.push(t.slice(last, i)); last = i + kw.length; i += kw.length; continue;
    }
    i++;
  }
  out.push(t.slice(last));
  return out;
}

/** أعمدة قائمة SELECT حتّى FROM في العمق صفر. */
function selectColumns(branch) {
  const m = /\bselect\b/i.exec(branch);
  if (!m) return null;
  let t = branch.slice(m.index + m[0].length);
  let d = 0, q = false, end = t.length;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === "'") { if (t.startsWith("''", i)) { i++; continue; } q = false; } continue; }
    if (c === "'") { q = true; continue; }
    if (c === "(") d++;
    else if (c === ")") d--;
    else if (d === 0 && /^from\b/i.test(t.slice(i))) { end = i; break; }
  }
  return splitTop(t.slice(0, end), ",").map((x) => x.trim().replace(/\s+/g, " "));
}

const kindOf = (e) => {
  const x = e.trim();
  if (/^'/.test(x)) return "text";
  if (/^\d+$/.test(x)) return "int";
  if (/^(not\s+)?exists\b/i.test(x)) return "boolean";
  if (/^(true|false)$/i.test(x)) return "boolean";
  if (/^case\b/i.test(x)) return "case";
  return "expr";
};

/** كلّ فروع كتلة checks(...) من نصّ SQL. */
function branchesFrom(raw) {
  if (raw === null || raw === undefined) return null;
  const s = stripComments(raw);
  const hdr = /checks\s*\(([^)]*)\)\s*as\s*\(/i.exec(s);
  if (!hdr) return null;
  const names = hdr[1].split(",").map((x) => x.trim());
  const open = s.indexOf("(", hdr.index + hdr[0].length - 1);
  let d = 0, q = false, close = s.length;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === "'") { if (s.startsWith("''", i)) { i++; continue; } q = false; } continue; }
    if (c === "'") { q = true; continue; }
    if (c === "(") d++;
    else if (c === ")") { d--; if (d === 0) { close = i; break; } }
  }
  return { names, branches: splitTop(s.slice(open + 1, close), "union all") };
}
const branchesOf = (file) => branchesFrom(read(file));

const FILE = "docs/executive_reporting_POSTCHECK.sql";

/** كلّ ملفّات POSTCHECK التي تحمل بنية checks(...) — الصنف يُغلق في كلّها. */
const SHAPED = fs.readdirSync(path.join(ROOT, "docs"))
  .filter((f) => /POSTCHECK.*\.sql$/.test(f))
  .map((f) => `docs/${f}`)
  .filter((f) => /checks\s*\([^)]*\)\s*as\s*\(/i.test(stripComments(read(f) || "")));

test("(١) ★★ كلّ فرع UNION بعدد الأعمدة المعلَن ★★", () => {
  const b = branchesOf(FILE);
  assert.ok(b, "كتلة checks غير موجودة");
  assert.equal(b.names.length, 5, `الترويسة تُعلن ${b.names.length} أعمدة`);
  assert.ok(b.branches.length >= 20, `قُرئ ${b.branches.length} فرعًا فقط — القارئ لا يرى الملفّ`);
  const bad = [];
  b.branches.forEach((br, i) => {
    const c = selectColumns(br);
    if (c === null) { bad.push(`فرع ${i + 1}: بلا SELECT`); return; }
    if (c.length !== b.names.length) bad.push(`فرع ${i + 1}: ${c.length} أعمدة لا ${b.names.length}`);
  });
  assert.deepEqual(bad, [], "انزياح أعمدة يُسقط الجملة كلّها:\n  " + bad.join("\n  "));
});

test("(٢) ★★ لا تعبير منطقيّ في عمود نصّيّ — 42804 ★★", () => {
  const b = branchesOf(FILE);
  const bad = [];
  b.branches.forEach((br, i) => {
    const c = selectColumns(br) || [];
    c.forEach((e, j) => {
      if (kindOf(e) === "boolean" && b.names[j] !== "sort_key")
        bad.push(`فرع ${i + 1} · العمود «${b.names[j]}»: ${e.slice(0, 60)}`);
    });
  });
  assert.deepEqual(bad, [],
    "UNION لا يوفّق بين boolean وtext، فيسقط التحليل قبل أيّ صفّ:\n  " + bad.join("\n  "));
});

test("(٣) ★★ كلّ فرع يُنتج حكمًا يمكن أن يفشل ★★", () => {
  const b = branchesOf(FILE);
  const vi = b.names.indexOf("verdict");
  assert.ok(vi >= 0, "لا عمود حكم");
  const bad = [];
  b.branches.forEach((br, i) => {
    const c = selectColumns(br) || [];
    const v = (c[vi] || "").trim();
    // ⚠️ بالشكل لا بالحرف: بعض الملفّات تكتب 'FAIL — expected 7, found ' || n
    //    فالحكم يحمل رسالته. المطلوب أن يستطيع الفرعُ قولَ FAIL، لا أن يطابق
    //    صياغةً بعينها.
    const isCase = /^case\b/i.test(v) && /'FAIL/.test(v);
    const isConst = /^'(INFO|SKIP)'$/.test(v);            // إعلانٌ صريح لا حكم
    if (!isCase && !isConst)
      bad.push(`فرع ${i + 1}: ${v.slice(0, 70)}`);
  });
  assert.deepEqual(bad, [],
    "حكمٌ لا يقول FAIL أبدًا ليس فحصًا:\n  " + bad.join("\n  "));
});

test("(٤) ★ العمود الأوّل رقم ترتيب في كلّ فرع ★", () => {
  const b = branchesOf(FILE);
  const keys = b.branches.map((br) => (selectColumns(br) || [])[0]);
  for (const k of keys) assert.match(String(k), /^\d+$/, `مفتاح ترتيب غير رقميّ: ${k}`);
  assert.equal(new Set(keys).size, keys.length, `مفاتيح ترتيب مكرَّرة: ${keys.join(",")}`);
});

test("(٥) ★★ الفاحص غير أجوف: يرى العطل ويقبل المصحَّح ★★", () => {
  const HDR = "checks(sort_key, check_id, verdict, expected, detail) as (";
  const OK = `with ${HDR}\n  select 10,'a',case when n=0 then 'PASS' else 'FAIL' end,'e','d' from t\n)`;
  const BOOL = `with ${HDR}\n  select 10,'a',case when n=0 then 'PASS' else 'FAIL' end,'e',not exists (select 1) from t\n)`;
  const SHIFT = `with ${HDR}\n  select 10,'a','13 حزمة',coalesce(x,'y') from t\n)`;
  const judge = (sql) => {
    const b = branchesFrom(sql); const c = selectColumns(b.branches[0]) || [];
    return {
      cols: c.length,
      hasBool: c.some((e, j) => kindOf(e) === "boolean" && b.names[j] !== "sort_key"),
      verdictOk: /^case\b/i.test((c[2] || "").trim()) && /'FAIL'/.test(c[2] || ""),
    };
  };
  assert.deepEqual(judge(OK), { cols: 5, hasBool: false, verdictOk: true }, "إنذار كاذب على فرع سليم");
  assert.equal(judge(BOOL).hasBool, true, "منطقيّ في عمود نصّيّ لم يُرصد");
  assert.equal(judge(SHIFT).cols, 4, "انزياح الأعمدة لم يُرصد");
  assert.equal(judge(SHIFT).verdictOk, false, "حكمٌ نصّيّ ثابت عُدّ حكمًا");
});

test("(٦) ★ التعليق لا يُختصر الكتلة: القوس داخله لا يُوازَن ★", () => {
  const raw = read(FILE);
  assert.match(raw, /--[^\n]*\)/, "لا تعليق فيه قوس — الحالة التي تُوقع الموازنة الساذجة اختفت");
  const b = branchesOf(FILE);
  assert.ok(b.branches.length >= 26,
    `قُرئ ${b.branches.length} فرعًا: الموازنة انتهت مبكّرًا عند قوسٍ داخل تعليق`);
});

test("(٧) ★ مصدر واحد لقائمة الحزم: لا تكرار ينحرف ★", () => {
  const s = stripComments(read(FILE));
  const lists = [...s.matchAll(/\('comms\\_%'|\('communications_hub'/g)];
  assert.equal(lists.length, 1, `قائمة الحزم مكرَّرة ${lists.length} مرّات — مصدران لحقيقة واحدة`);
  // ⚠️ الوجود يُؤكَّد **قبل** المقارنة: indexOf تُعيد -1 عند الغياب، و-1 أصغر
  //    من كلّ شيء — فكتلةٌ محذوفة كانت تمرّ من شرط الترتيب وهي غير موجودة.
  const iCte = s.indexOf("t_prior_packages as ("), iChecks = s.indexOf("checks(sort_key");
  assert.ok(iCte >= 0, "كتلة t_prior_packages مفقودة");
  assert.ok(iChecks >= 0, "كتلة checks مفقودة");
  assert.ok(iCte < iChecks, "WITH غير تعاودية ترى ما سبقها فقط");
  assert.match(s, /from t_prior_packages\b/, "الفرع لا يقرأ من الكتلة");
});

test("(٨) ★★ الصنف مغلق في كلّ ملفّات POSTCHECK ذات البنية نفسها ★★", () => {
  assert.ok(SHAPED.length >= 3, `وُجد ${SHAPED.length} ملفًّا فقط بهذه البنية`);
  const bad = [];
  for (const f of SHAPED) {
    const b = branchesOf(f);
    if (!b) continue;
    const vi = b.names.indexOf("verdict");
    b.branches.forEach((br, i) => {
      const c = selectColumns(br);
      if (c === null) { bad.push(`${f} فرع ${i + 1}: بلا SELECT`); return; }
      if (c.length !== b.names.length)
        bad.push(`${f} فرع ${i + 1}: ${c.length}≠${b.names.length} أعمدة`);
      c.forEach((e, j) => {
        if (kindOf(e) === "boolean" && b.names[j] !== "sort_key")
          bad.push(`${f} فرع ${i + 1}: منطقيّ في «${b.names[j]}»`);
      });
      // ملاحظة نطاق: مفردات الحكم تختلف بين الحزم — communications_hub يستعمل
      // REVIEW/INFO برسائل. تلك مسألة تصميم أخرى، ولا تُسقط التنفيذ. المشترك
      // المُلزِم هنا هو ما يمنع الجملة من العمل: عدد الأعمدة ونوعها.
      void vi;
    });
  }
  assert.deepEqual(bad, [], "الصنف نفسه في ملفّ آخر:\n  " + bad.join("\n  "));
});

test("SAFE: ساكن فقط (لا شبكة ولا عمليّة ولا مفتاح خدمة)", () => {
  const src = fs.readFileSync(__filename, "utf8");
  for (const [what, re] of [["شبكة", new RegExp("\\b" + "fet" + "ch\\s*\\(")],
                            ["عمليّة", new RegExp("\\b" + "child_" + "process\\b")],
                            ["مفتاح خدمة", new RegExp("\\b" + "service_" + "role\\b")]])
    assert.doesNotMatch(src, re, `الفاحص يلمس ${what}`);
});
