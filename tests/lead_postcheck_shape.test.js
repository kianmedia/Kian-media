// ════════════════════════════════════════════════════════════════════════════
// tests/lead_postcheck_shape.test.js
//
// ★ لماذا هذا الملفّ موجود ★
// طُبِّقت حزمة التقييم والتوزيع على الإنتاج بنجاح، ثمّ شُغِّل ملفّ الفحص مرّتين
// في محرّر Supabase فانقطع الطلب في الطبقة الأعلى:
//     SQL query ran into an upstream timeout
// بلا خطأ SQL وبلا صفّ FAIL. الملفّ للقراءة فقط، فلم يتغيّر شيء — لكنّ أداة
// الفحص التي لا تُنهي عملها لا تُثبت شيئًا.
//
// والسبب **شكل استعلام** لا طول ملفّ: كتلةُ رسمِ النداءات كانت تضمّ كلّ دالّة
// من دوالّ الموديول (٤٧) إلى **كلّ** دالّة في public (مئات)، وتبني لكلّ زوج
// تعبيرًا نمطيًّا جديدًا من اسم المُنادى ثمّ تطابقه على جسمٍ بحجم كيلوبايتات.
// والأسوأ: الجسم نفسه كان يُنتَج داخل lateral على الجانب الداخليّ من ذلك
// الضمّ، وبلا MATERIALIZED، فحلقةُ التقسيم plpgsql قابلة لأن تُعاد **لكلّ
// زوج** لا لكلّ دالّة.
//
// وهذا عيب لا يظهر في مراجعة نصّية ولا في اختبار يقرأ الملفّ كنصّ مجرّد؛ يظهر
// في خطّة التنفيذ وحدها — ولا قاعدة بيانات هنا. لذلك نمنع **الأشكال** التي
// تُنتجه: الضمّ ضدّ pg_proc بلا حصر، والدالّة الغالية داخل lateral لكلّ صفّ،
// وCTE غاليًا بلا تثبيت.
//
// ملاحظة على الأداة: كلّ الأحكام أدناه على codeOnly (بلا تعليقات ولا سلاسل)
// إلّا حيث يكون المطلوب صراحةً وجود اسم داخل سلسلة — فذكرُ الشكل في شرحٍ ليس
// ارتكابًا له، وهذا بالضبط الخطأ الذي أسقط ترحيلةً من قبل.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");

const DEEP = "docs/lead_scoring_routing_POSTCHECK.sql";
const SUMMARY = "docs/lead_scoring_routing_POST_APPLY_SUMMARY.sql";
const GUARDED = [DEEP, SUMMARY];

const read = (rel) => {
  const p = path.join(ROOT, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
};

/** يحذف التعليقات ويستبدل بكلّ سلسلة فراغًا محايدًا. */
function codeOnly(sql) {
  let out = "", i = 0;
  while (i < sql.length) {
    if (sql.startsWith("--", i)) { const j = sql.indexOf("\n", i); i = j < 0 ? sql.length : j; continue; }
    if (sql.startsWith("/*", i)) {
      let d = 1; i += 2;
      while (i < sql.length && d > 0) {
        if (sql.startsWith("/*", i)) { d++; i += 2; }
        else if (sql.startsWith("*/", i)) { d--; i += 2; }
        else i++;
      }
      continue;
    }
    if (sql[i] === "'") {
      i++;
      while (i < sql.length) {
        if (sql[i] === "'") { if (sql.startsWith("''", i)) i += 2; else { i++; break; } }
        else i++;
      }
      out += " ";
      continue;
    }
    out += sql[i++];
  }
  return out;
}

/** يحذف التعليقات ويُبقي السلاسل — للأحكام التي يقع محلّها داخل سلسلة بالتصميم. */
function noComments(sql) {
  let out = "", i = 0;
  while (i < sql.length) {
    if (sql.startsWith("--", i)) { const j = sql.indexOf("\n", i); i = j < 0 ? sql.length : j; continue; }
    if (sql[i] === "'") {
      out += sql[i++];
      while (i < sql.length) {
        if (sql[i] === "'") { if (sql.startsWith("''", i)) { out += "''"; i += 2; } else { out += sql[i++]; break; } }
        else out += sql[i++];
      }
      continue;
    }
    out += sql[i++];
  }
  return out;
}

/**
 * كلّ CTE في الملفّ: الاسم · هل هو MATERIALIZED · جسمه بين قوسيه.
 * القراءة بمسح متوازن لا بتعبير نمطيّ غير جشع: `[\s\S]*?\)` يقف عند أوّل قوس
 * مغلق، وأجسام هذه الـCTEs مليئة بالأقواس، فينقطع الجسم ويصير الحكم عليه كذبًا.
 */
function ctes(sql) {
  const code = codeOnly(sql);
  const out = [];
  const re = /(^|[\s,(])([a-z_][a-z_0-9]*)\s*(\([^)]*\))?\s+as\s+(materialized\s+)?\(/gi;
  let m;
  while ((m = re.exec(code)) !== null) {
    const open = code.indexOf("(", m.index + m[0].length - 1);
    let d = 1, i = open + 1;
    while (i < code.length && d > 0) {
      if (code[i] === "(") d++;
      else if (code[i] === ")") d--;
      i++;
    }
    out.push({
      name: m[2].toLowerCase(),
      materialized: Boolean(m[4]),
      body: code.slice(open + 1, i - 1),
      at: code.slice(0, m.index).split("\n").length,
    });
  }
  return out;
}

/** فاصلة على المستوى الأعلى داخل FROM — الشكل الذي أنتج 42P01. */
function commaJoins(sql) {
  const code = codeOnly(sql);
  const out = [];
  const re = /\bfrom\b/gi;
  let m;
  while ((m = re.exec(code)) !== null) {
    let i = m.index + 4, d = 0;
    while (i < code.length) {
      const c = code[i];
      if (c === "(") d++;
      else if (c === ")") { if (d === 0) break; d--; }
      else if (c === ";" && d === 0) break;
      else if (c === "," && d === 0) {
        out.push({ line: code.slice(0, i).split("\n").length });
        break;
      } else if (d === 0 && /\s/.test(code[i - 1] || " ")) {
        if (/^(where|group\b|order\b|union\b|limit\b|having\b|then\b|loop\b|else\b|end\b|into\b|using\b|returning\b|window\b|for\b)/
              .test(code.slice(i, i + 10).toLowerCase())) break;
      }
      i++;
    }
  }
  return out;
}

/** عدد الجُمل على المستوى الأعلى — محرّر Supabase يعرض الأخيرة فقط. */
function topLevelStatements(sql) {
  const code = codeOnly(sql);
  let d = 0, n = 0;
  for (const c of code) {
    if (c === "(") d++;
    else if (c === ")") d--;
    else if (c === ";" && d === 0) n++;
  }
  return n;
}

/** الدوالّ التي تكلّف تمريرة على مصدر دالّة كاملة. */
const EXPENSIVE = [
  "pg_get_functiondef", "lsr_contract_scan", "lsr_sql_partition",
  "lsr_client_scan", "regexp_matches",
];

/** علاقات «مجتمع دوالّ lsr_*» — الضمّ منها إلى pg_proc بلا حصر هو العيب. */
const LSR_POPULATION = ["defs", "bodies", "scan", "called_names", "callees"];

// ════════════════════════════════════════════════════════════════════════════

test("(٠) الملفّان المحروسان موجودان — لا حارس بلا هدف", () => {
  const missing = GUARDED.filter((f) => read(f) === null);
  assert.deepEqual(missing, [], `ملفّ محروس مفقود: ${missing.join(", ")}`);
});

test("(١) لا ضمّ بفاصلة في أيّ من ملفَّي الفحص", () => {
  const bad = [];
  for (const rel of GUARDED) {
    for (const h of commaJoins(read(rel))) bad.push(`${rel}:${h.line}`);
  }
  assert.deepEqual(bad, [],
    "فاصلة على المستوى الأعلى داخل FROM — استعمل JOIN صريحًا بترتيب يعرّف كلّ اسم قبل استعماله");
});

test("(٢) ★ كلّ CTE غالٍ مُعلَن MATERIALIZED ★", () => {
  const bad = [];
  for (const rel of GUARDED) {
    for (const c of ctes(read(rel))) {
      const costly = EXPENSIVE.filter((f) => new RegExp(`\\b${f}\\s*\\(`, "i").test(c.body));
      if (costly.length > 0 && !c.materialized) {
        bad.push(`${rel}:${c.at} → «${c.name}» يستدعي ${costly.join("/")} بلا MATERIALIZED`);
      }
    }
  }
  assert.deepEqual(bad, [],
    "CTE غالٍ بلا تثبيت. PostgreSQL 12+ يُثبّت عادةً CTE متعدّد الإشارات، لكنّ «عادةً» " +
    "رهانٌ على المخطّط في ملفٍّ انقطع مرّتين بمهلة أعلى المكدّس:\n  " + bad.join("\n  "));
});

test("(٣) ★ lsr_contract_scan لا تُنادى أكثر من مرّة للدالّة ★", () => {
  for (const rel of GUARDED) {
    const raw = read(rel);
    const code = codeOnly(raw);
    // (أ) لا استدعاء داخل lateral لكلّ صفّ — الشكل القديم في الفحص ٧٦.
    assert.doesNotMatch(code, /lateral\s*\(\s*select\s+public\.lsr_contract_scan/i,
      `${rel}: فحص العقد داخل lateral مُعلَّق على ضمّ — استدعاء لكلّ صفّ لا لكلّ دالّة`);
    // (ب) كلّ موضع استدعاء يقع داخل CTE مثبَّت.
    const sites = [...code.matchAll(/public\.lsr_contract_scan\s*\(/gi)].map((m) => m.index);
    const mat = ctes(raw).filter((c) => c.materialized);
    for (const s of sites) {
      const inside = mat.some((c) => {
        const at = code.indexOf(c.body);
        return at > -1 && s > at && s < at + c.body.length;
      });
      assert.ok(inside,
        `${rel}: استدعاء lsr_contract_scan خارج CTE مثبَّت — قد يُعاد حسابه لكلّ إشارة`);
    }
    // (ج) وعدد المواضع محدود بعدد المجتمعات المفحوصة (دوالّ lsr_* · ما تناديه).
    assert.ok(sites.length > 0, `${rel}: لا فحص عقد بنيويّ إطلاقًا — الملفّ بلا حكم`);
    assert.ok(sites.length <= 2,
      `${rel}: ${sites.length} موضع استدعاء لـlsr_contract_scan — المتوقَّع موضع لكلّ مجتمع لا أكثر`);
  }
});

test("(٤) ★ lsr_sql_partition لا تُستدعى مرّتين على التعبير نفسه ★", () => {
  for (const rel of GUARDED) {
    const code = codeOnly(read(rel));
    const args = [...code.matchAll(/lsr_sql_partition\s*\(\s*([a-z_][a-z_0-9.]*)\s*\)/gi)]
      .map((m) => m[1].toLowerCase());
    const seen = new Map();
    for (const a of args) seen.set(a, (seen.get(a) || 0) + 1);
    const dup = [...seen.entries()].filter(([, n]) => n > 1).map(([a, n]) => `${a}×${n}`);
    assert.deepEqual(dup, [],
      `${rel}: التقسيم يُعاد على التعبير نفسه (${dup.join(", ")}). ` +
      "lsr_sql_partition حلقة تمشي المصدر حرفًا بحرف: استدعِها مرّة واقرأ code وstrings من نتيجتها.");
  }
});

test("(٥) ★ لا ضمّ لمجتمع lsr_* ضدّ pg_proc بلا حصر ★", () => {
  const bad = [];
  for (const rel of GUARDED) {
    for (const c of ctes(read(rel))) {
      if (!/\bpg_proc\b/i.test(c.body)) continue;
      const touchesLsr = LSR_POPULATION.some((r) => new RegExp(`\\b${r}\\b`, "i").test(c.body));
      if (!touchesLsr) continue;                       // مسحٌ عامّ بحكم سؤاله
      const bounded = /proname\s*=/i.test(c.body) || /proname\s+like\s+'lsr/i.test(noComments(c.body));
      if (!bounded) bad.push(`${rel}:${c.at} → «${c.name}»`);
    }
  }
  assert.deepEqual(bad, [],
    "CTE يضمّ دوالّ الموديول إلى كلّ دوالّ public بلا مساواة على الاسم ولا حصر بـlsr\\_%. " +
    "هذا هو ٤٧×مئات من الأزواج، وهو سبب الانقطاع:\n  " + bad.join("\n  "));
});

test("(٥-ب) ★ لا تعبير نمطيّ يُبنى من اسم دالّة داخل ضمّ ★", () => {
  for (const rel of GUARDED) {
    const code = noComments(read(rel));
    assert.doesNotMatch(code, /\|\|\s*[a-z_][a-z_0-9]*\.proname\s*\|\|/i,
      `${rel}: اسم دالّة يُدسّ داخل نمط — ترجمةُ نمطٍ جديدة لكلّ زوج`);
    assert.doesNotMatch(code, /position\s*\(\s*[a-z_][a-z_0-9]*\.proname\s+in\b/i,
      `${rel}: مسح position لكلّ زوج على جسم بحجم كيلوبايتات`);
  }
});

test("(٦) ★ كلّ مسح ACL محصور بـlsr\\_% ★", () => {
  const bad = [];
  for (const rel of GUARDED) {
    const code = noComments(read(rel));
    const idx = [...code.matchAll(/aclexplode\s*\(/gi)].map((m) => m.index);
    assert.ok(idx.length > 0, `${rel}: لا فحص صلاحيات إطلاقًا`);
    for (const i of idx) {
      const win = code.slice(Math.max(0, i - 500), i + 500);
      if (!/proname\s+like\s+'lsr\\_%'/i.test(win)) bad.push(`${rel}@${i}`);
    }
  }
  assert.deepEqual(bad, [],
    "مسح aclexplode على كلّ دوالّ public — العقد المفحوص lsr_* وحده:\n  " + bad.join("\n  "));
});

test("(٦-ب) المسح الشامل الوحيد المسموح (الحزم الستّ) لا ينادي دالّة داخله", () => {
  for (const rel of GUARDED) {
    const c = ctes(read(rel)).find((x) => x.name === "pkg_objects");
    assert.ok(c, `${rel}: عدّ الحزم الستّ غير مثبَّت في CTE — يُعاد لكلّ صفّ`);
    assert.ok(c.materialized, `${rel}: pkg_objects بلا MATERIALIZED`);
    for (const f of EXPENSIVE) {
      assert.doesNotMatch(c.body, new RegExp(`\\b${f}\\s*\\(`, "i"),
        `${rel}: المسح الشامل ينادي ${f} — مسحٌ عامّ يجب أن يبقى رخيصًا`);
    }
  }
});

test("(٧) ★ رسم النداءات محدود العمق وبحماية من الدورة ★", () => {
  for (const rel of GUARDED) {
    const raw = read(rel);
    assert.doesNotMatch(codeOnly(raw), /\bwith\s+recursive\b/i,
      `${rel}: رسم نداءات متعدٍّ بلا سقف — دورة واحدة تكفي لإسقاط الملفّ`);
    const cs = ctes(raw).find((x) => x.name === "callees");
    if (!cs) continue;                       // الملخّص بلا رسم نداءات أصلًا
    const body = noComments(raw).slice();
    assert.match(cs.body, /callee\s*<>\s*[a-z_.]*caller/i,
      `${rel}: رسم النداءات لا يستثني نداء الدالّة نفسها`);
    assert.match(body, /callee\s+not\s+like\s+'lsr\\_%'/i,
      `${rel}: رسم النداءات لا يستثني lsr\\_% — يعود إلى المجتمع نفسه فيتوسّع`);
    assert.match(body, /callee\s+not\s+like\s+'comms\\_%'/i,
      `${rel}: استثناء مركز الاتصالات سقط — تصنيفه مشروط بتثبيت dry_run`);
  }
});

test("(٨) كلّ ملفّ يُرجع مجموعة نتائج واحدة", () => {
  for (const rel of GUARDED) {
    assert.equal(topLevelStatements(read(rel)), 1,
      `${rel}: أكثر من جملة — محرّر Supabase يعرض الأخيرة فقط فتضيع بقيّة الفحوص`);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// (٩) تثبيتات المعنى: إصلاحُ الشكل لا يجوز أن يمرّ بحذف فحص أو بجعل شرطه true.
// ════════════════════════════════════════════════════════════════════════════

test("(٩) ★ الكواشف التعاقدية ما زالت قائمة في الملفّين ★", () => {
  for (const rel of GUARDED) {
    const src = noComments(read(rel));     // الأسماء داخل سلاسل بحكم التصميم
    for (const [tok, why] of [
      ["finance_write", "كاشف الكتابة الماليّة"],
      ["forbidden_finance_read", "كاشف القراءة الماليّة الممنوعة"],
      ["external_call", "كاشف النداء الخارجيّ"],
      ["project_write", "كاشف الكتابة على منصّة المشاريع"],
      ["client_keys", "القائمة المغلقة لمفاتيح لوحة العميل"],
      ["client_emitted", "قارئ المفاتيح المُصدَرة فعلًا"],
      ["wide_projection", "كاشف الإسقاط العريض"],
      ["unscoped_query", "كاشف القراءة العابرة للعملاء"],
      ["idempotency_key", "مفتاح عدم التكرار"],
      ["anonymous_no_contact_channel", "احتجاز العميل غير القابل للتواصل"],
    ]) {
      assert.ok(src.includes(tok), `${rel}: ${why} (${tok}) حُذف`);
    }
    assert.doesNotMatch(src, /exception\s+when\s+others/i, `${rel}: catch-all يبتلع الفشل`);
  }
});

test("(٩-ب) ★ القائمة المغلقة تُقارَن في الاتّجاهين ولا شرط ضمٍّ صار true ★", () => {
  for (const rel of GUARDED) {
    const src = noComments(read(rel));
    assert.match(src, /client_emitted\s+e\s*\n?\s*where\s+e\.k\s+not\s+in\s*\(\s*select\s+k\s+from\s+client_keys\s*\)/i,
      `${rel}: لا فحص «مفتاح مُصدَر خارج القائمة» — القائمة صارت زينة`);
    assert.match(src, /client_keys\s+k\s*\n?\s*where\s+k\.k\s+not\s+in\s*\(\s*select\s+k\s+from\s+client_emitted\s*\)/i,
      `${rel}: لا فحص «مُجاز غير مُصدَر» — التمهيد المسبق يمرّ`);
    assert.doesNotMatch(codeOnly(read(rel)), /\bon\s+true\b/i,
      `${rel}: شرط ON صار true — ضمٌّ يمرّ على كلّ صفّ، أي فحص بلا هدف`);
    assert.match(codeOnly(read(rel)), /join\s+internal_fns\s+i\s+on\s+i\.f\s*=\s*p\.proname/i,
      `${rel}: ضمّ internal_fns غائب أو شرطه غُيِّر — كشف النوى الداخلية بلا معنى`);
  }
});

test("(٩-ج) الملخّص يحمل الفحوص الستّة عشر كاملة", () => {
  const src = read(SUMMARY);
  for (let i = 1; i <= 16; i++) {
    assert.match(src, new RegExp(`^select ${i === 1 ? "1 as ord" : i}, `, "m"),
      `الملخّص: الفحص رقم ${i} مفقود — التقسيم لا يجوز أن يُخفي إخفاقًا`);
  }
  assert.match(src, /عدد الإخفاقات/, "الملخّص لا يُعلن عدد الإخفاقات");
  assert.match(src, /POSTCHECK/, "الملخّص لا يحيل إلى الفحص العميق");
});

test("(٩-د) قائمة مفاتيح العميل في الملخّص مطابقة لقائمة الفحص العميق", () => {
  const grab = (src) => {
    const i = src.indexOf("client_keys(k) as (values");
    assert.ok(i > -1, "قائمة مفاتيح العميل غير موجودة");
    // ‼️ الحدّ هو `')),` — نهاية آخر عنصر ثمّ إغلاق قائمة values. البحث عن `))`
    //    المجرّد يقف **قبل** قوس العنصر الأخير فيبتلعه، فيصير العدّ ٤٨ لا ٤٩:
    //    فحصٌ يعدّ ناقصًا يُدين قائمةً سليمة.
    const j = src.indexOf("')),", i) + 4;
    assert.ok(j > 3, "قائمة مفاتيح العميل غير مغلقة");
    return [...src.slice(i, j).matchAll(/\('([a-z_0-9]+)'\)/g)].map((m) => m[1]);
  };
  const deep = grab(read(DEEP));
  const sum = grab(read(SUMMARY));
  assert.equal(sum.length, 49, `الملخّص فيه ${sum.length} مفتاحًا لا ٤٩`);
  assert.deepEqual(sum, deep, "قائمتا المفاتيح انحرفتا — نسختان بصمت أسوأ من نسخة واحدة");
});

test("(٩-هـ) الفحص العميق يُعلن أنّ الملخّص هو المسار الآمن في المحرّر", () => {
  assert.match(read(DEEP), /POST_APPLY_SUMMARY\.sql/,
    "الفحص العميق لا يذكر البديل الآمن — من انقطع عليه سيعيد تشغيله بلا فائدة");
});

test("SAFE: ساكن فقط (لا قاعدة بيانات ولا شبكة)", () => {
  const src = fs.readFileSync(__filename, "utf8");
  for (const bad of ["fet" + "ch(", "child_" + "process", "service_" + "role"]) {
    assert.ok(!src.includes(bad), `الفاحص يلمس ${bad}`);
  }
});
