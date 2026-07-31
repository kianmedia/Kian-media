// ════════════════════════════════════════════════════════════════════════════
// tests/sql_join_alias_scope.test.js
//
// ★ لماذا هذا الملفّ موجود ★
// سقط lead_scoring_routing_POSTCHECK.sql على الإنتاج **بعد** نجاح RUNME بـ:
//     ERROR 42P01: invalid reference to FROM-clause entry for table "p"
//     LINE 751: join internal_fns i on i.f = p.proname
//     DETAIL:   There is an entry for table "p", but it cannot be referenced
//               from this part of the query.
//
// السبب نحويّ بحت: الفاصلة في FROM تُنشئ **عنصرًا شقيقًا** لا امتدادًا لشجرة
// الضمّ. فحين يُكتب
//     from pg_proc p join pg_namespace n on …,        ← عنصر أوّل
//          lateral aclexplode(p.proacl) a             ← عنصر ثانٍ يبدأ هنا
//          join internal_fns i on i.f = p.proname     ← ON داخل العنصر الثاني
// لا يرى شرطُ ON في العنصر الثاني اسمَ `p` المُعرَّف في العنصر الأوّل.
// وLATERAL يمدّ النطاق إلى **تعبير الدالّة** وحده — aclexplode(p.proacl) —
// ولا يمدّه إلى شروط ON المعلّقة على ذلك العنصر. فالسطر 749 يعمل والسطر 751 لا.
//
// وهذا خطأ **تحليل** لا خطأ منطق: لا يظهر في مراجعة نصّية، ولا يمنعه اختبار
// يقرأ الملفّ كنصّ. يظهر عند التحليل النحويّ وحده — ولا قاعدة بيانات هنا.
// لذلك نمنع **الشكل** نفسه: لا فاصلة في FROM أصلًا داخل ملفّات الحزمة.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");

const GUARDED = [
  "docs/lead_scoring_routing_PREFLIGHT.sql",
  "docs/lead_scoring_routing_RUNME.sql",
  "docs/lead_scoring_routing_POSTCHECK.sql",
  "docs/lead_scoring_routing_AFTER_FAILURE_VERIFY.sql",
];

const read = (rel) => {
  const p = path.join(ROOT, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
};

/** يحذف التعليقات والسلاسل: ذكرُ فاصلةٍ في شرحٍ ليس ضمًّا بفاصلة. */
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
    if (sql[i] === "'") {                       // سلسلة: تُستبدل بفراغ محايد
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

/**
 * كلّ جملة FROM وما يتبعها حتّى نهاية عبارتها، مع رقم السطر.
 * لا نبني محلّلًا نحويًّا كاملًا: نبحث عن الشكل الخطر تحديدًا — فاصلة على
 * المستوى الأعلى داخل FROM، متبوعةً لاحقًا بـJOIN … ON.
 */
function commaJoinsWithLaterOn(sql) {
  const code = codeOnly(sql);
  const hits = [];
  const re = /\bfrom\b/gi;
  let m;
  while ((m = re.exec(code)) !== null) {
    let i = m.index + 4, d = 0, sawComma = false, commaAt = -1;
    // امسح حتّى نهاية عبارة FROM: where/group/order/union/limit أو إغلاق قوس.
    while (i < code.length) {
      const c = code[i];
      if (c === "(") d++;
      else if (c === ")") { if (d === 0) break; d--; }
      else if (c === ";" && d === 0) break;
      else if (c === "," && d === 0) { sawComma = true; if (commaAt < 0) commaAt = i; }
      else if (d === 0 && /\s/.test(code[i - 1] || " ")) {
        const rest = code.slice(i, i + 12).toLowerCase();
        if (/^(where|group\b|order\b|union\b|limit\b|having\b|window\b|then\b|loop\b|else\b|end\b|into\b|using\b|returning\b)/.test(rest)) break;
        if (sawComma && /^(join|left join|inner join|right join|full join)/.test(rest)) {
          // اقرأ شرط ON التالي وابحث عن أسماء مؤهَّلة
          const onIdx = code.toLowerCase().indexOf(" on ", i);
          if (onIdx > -1 && onIdx - i < 400) {
            const onExpr = code.slice(onIdx + 4, onIdx + 160);
            const aliases = [...onExpr.matchAll(/\b([a-z_][a-z_0-9]*)\s*\./gi)].map((x) => x[1]);
            // هل يُذكر اسم عُرِّف **قبل** الفاصلة؟
            const before = code.slice(m.index, commaAt);
            for (const al of new Set(aliases)) {
              const declaredBefore = new RegExp(`\\b${al}\\b(?!\\s*\\.)`, "i").test(before);
              const declaredAfter = new RegExp(`\\b${al}\\b(?!\\s*\\.)`, "i").test(code.slice(commaAt, i));
              if (declaredBefore && !declaredAfter) {
                hits.push({ line: sql.slice(0, 1).length && code.slice(0, onIdx).split("\n").length, alias: al });
              }
            }
          }
        }
      }
      i++;
    }
  }
  return hits;
}

/** أي فاصلة على المستوى الأعلى داخل FROM — الشكل الخطر بحدّ ذاته. */
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
      else if (c === ";" && d === 0) break;   // نهاية جملة — ما بعدها ليس FROM
      else if (c === "," && d === 0) {
        out.push({ line: code.slice(0, i).split("\n").length, ctx: code.slice(m.index, i + 40).replace(/\s+/g, " ").slice(0, 90) });
        break;
      } else if (d === 0 && /\s/.test(code[i - 1] || " ")) {
        // نهايات عبارة FROM في SQL **وفي plpgsql**: بدونها يواصل المسح داخل
        // شيفرة إجرائية فيلتقط فاصلة قائمة أعمدة أو وسائط دالّة — إنذار كاذب.
        if (/^(where|group\b|order\b|union\b|limit\b|having\b|then\b|loop\b|else\b|end\b|into\b|using\b|returning\b|window\b|for\b)/   // ⚠️ لا `on`: ON جزءٌ من الضمّ لا نهايةٌ لعبارة FROM
              .test(code.slice(i, i + 10).toLowerCase())) break;
      }
      i++;
    }
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════════════

test("(١) ★ لا ضمّ بفاصلة في ملفّات الحزمة — الشكل الذي أنتج 42P01 ★", () => {
  const bad = [];
  for (const rel of GUARDED) {
    const sql = read(rel);
    if (sql === null) continue;
    for (const h of commaJoins(sql)) bad.push(`${rel}:${h.line} → ${h.ctx}`);
  }
  assert.deepEqual(bad, [],
    "ضمّ بفاصلة داخل FROM — استعمل JOIN صريحًا بترتيب يعرّف كلّ اسم قبل استعماله:\n  " +
    bad.join("\n  "));
});

test("(٢) ★ الحالة الدقيقة: ON يذكر اسمًا عُرِّف قبل الفاصلة ★", () => {
  const bad = [];
  for (const rel of GUARDED) {
    const sql = read(rel);
    if (sql === null) continue;
    for (const h of commaJoinsWithLaterOn(sql)) bad.push(`${rel}:${h.line} → الاسم «${h.alias}» خارج نطاق ON`);
  }
  assert.deepEqual(bad, [], "42P01 في الانتظار:\n  " + bad.join("\n  "));
});

test("(٣) الفاحص يرفض الاستعلام المعيب نفسه ويقبل المصحَّح — غير أجوف", () => {
  // النصّ الحرفيّ الذي أسقط الإنتاج.
  const BROKEN = `
    select p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
           lateral aclexplode(p.proacl) a
      join pg_roles r on r.oid = a.grantee
      join internal_fns i on i.f = p.proname
     where n.nspname = 'public'`;
  assert.ok(commaJoins(BROKEN).length > 0, "الفاحص لا يرى الضمّ بفاصلة — فاحص بلا قيمة");
  assert.ok(commaJoinsWithLaterOn(BROKEN).length > 0,
    "الفاحص لا يرى أنّ ON يذكر اسمًا خارج نطاقه — وهو جوهر 42P01");

  const FIXED = `
    select p.proname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join internal_fns i on i.f = p.proname
      cross join lateral aclexplode(p.proacl) a
      join pg_roles r on r.oid = a.grantee
     where n.nspname = 'public'`;
  assert.equal(commaJoins(FIXED).length, 0, "الفاحص يُنذر كذبًا على الاستعلام المصحَّح");
  assert.equal(commaJoinsWithLaterOn(FIXED).length, 0, "إنذار كاذب على الشكل السليم");
});

test("(٤) لا إنذار كاذب على فاصلة في تعليق أو سلسلة أو قائمة values", () => {
  const SAFE = [
    "select 1 from t -- from a, b join c on c.x = a.x\n where 1=1",
    "select 'from a, b join c on c.x = a.x' as s from t",
    "select * from (values ('a'),('b')) v(x)",
    "select * from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'",
    "select c.callee from callees c cross join lateral (select 1 from pg_proc p where p.proname = c.callee) z",
  ];
  for (const s of SAFE) {
    assert.equal(commaJoins(s).length, 0, `إنذار كاذب على: ${s.slice(0, 60)}`);
    assert.equal(commaJoinsWithLaterOn(s).length, 0, `إنذار كاذب (ON) على: ${s.slice(0, 60)}`);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// (٤-ب) الفحوص التي يقوم عليها POSTCHECK نفسه.
//   إصلاح شكل الضمّ لا يكفي: استعلامٌ صحيح نحويًّا قد يكون فارغ المعنى. هذه
//   التثبيتات تمنع «إصلاحًا» يمرّ بحذف الفحص أو بجعل شرطه true.
// ════════════════════════════════════════════════════════════════════════════

const PC = () => read("docs/lead_scoring_routing_POSTCHECK.sql") || "";

/**
 * يحذف التعليقات ويُبقي السلاسل النصّية.
 * الفحوص أدناه تبحث عن أسماء تقع **داخل** سلاسل بحكم التصميم — مثل
 * `(z.s ->> 'finance_write')` وقائمة النوى `('lsr_score_core')` — فتجريدُ
 * السلاسل هنا يُنتج فشلًا كاذبًا. أمّا فحوص شكل الضمّ فتستعمل codeOnly لأنّ
 * ذكر فاصلة داخل نصّ ليس ضمًّا بفاصلة. لكلّ سؤال أداتُه.
 */
function noComments(sql) {
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
    if (sql[i] === "'") {                 // سلسلة تُنقل كما هي
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

test("(٦) ★ ضمّ internal_fns قائم بشرطه الحقيقيّ — لا حذف ولا ON true ★", () => {
  const pc = codeOnly(PC());
  assert.match(pc, /join\s+internal_fns\s+i\s+on\s+i\.f\s*=\s*p\.proname/i,
    "ضمّ internal_fns غائب أو شرطه غُيِّر — فحص كشف النوى الداخلية بلا معنى");
  assert.doesNotMatch(pc, /join\s+internal_fns\s+\w+\s+on\s+true/i,
    "شرط ON صار true — ضمٌّ يمرّ على كلّ صفّ، أي فحص بلا هدف");
  // وقائمة النوى نفسها ليست فارغة، وإلّا مرّ الفحص لانعدام الصفوف.
  // ⚠️ قراءة الجسم **بمسح متوازن** لا بتعبير نمطيّ غير جشع: `[\s\S]*?\)` يقف
  //    عند أوّل قوس مغلق، وقائمة values مليئة بالأقواس، فيلتقط عنصرًا واحدًا
  //    فيبدو الفحص فاشلًا وهو سليم — إنذار كاذب من نوع ما نُصلحه هنا أصلًا.
  const body = noComments(PC());
  const at = body.search(/internal_fns\s*(?:\([^)]*\))?\s*as\s*\(/i);
  assert.ok(at > -1, "تعريف internal_fns غير موجود");
  let o = body.indexOf("(", body.toLowerCase().indexOf(" as ", at) + 1), d = 1, e = o + 1;
  while (e < body.length && d > 0) {
    if (body[e] === "(") d++;
    else if (body[e] === ")") d--;
    e++;
  }
  const cteBody = body.slice(o + 1, e - 1);
  assert.ok((cteBody.match(/'lsr_/g) || []).length >= 3,
    `قائمة النوى الداخلية فيها ${(cteBody.match(/'lsr_/g) || []).length} عنصرًا — فحص أجوف`);
});

test("(٧) ★ كاشف الكتابة الماليّة وقائمة مفاتيح العميل ما زالا في POSTCHECK ★", () => {
  const pc = noComments(PC());   // الأسماء داخل سلاسل بحكم التصميم
  assert.match(pc, /finance_write/i, "كاشف الكتابة الماليّة حُذف من POSTCHECK");
  assert.match(pc, /external_call/i, "كاشف النداء الخارجيّ حُذف");
  assert.match(pc, /project_write/i, "كاشف الكتابة على المشاريع حُذف");
  assert.match(pc, /lsr_client_scan|client_keys/i, "فحص قائمة مفاتيح لوحة العميل حُذف");
  // ولا catch-all يبتلع فشلًا حقيقيًّا.
  assert.doesNotMatch(pc, /exception\s+when\s+others\s+then\s+null/i, "catch-all يبتلع الفشل");
});

test("(٨) POSTCHECK آمن في محرّر SQL: قراءة فقط، نتيجة واحدة", () => {
  const raw = PC();
  const pc = codeOnly(raw);
  assert.doesNotMatch(pc, /^\s*(insert|update|delete|truncate|create|alter|drop)\s/im,
    "POSTCHECK يكتب — يجب أن يكون قراءة فقط");
  assert.doesNotMatch(pc, /\b(begin|commit|rollback)\s*;/i, "POSTCHECK يفتح معاملة");
  // جملة واحدة ⇒ نتيجة واحدة في محرّر Supabase.
  let d = 0, q = false, stmts = 0;
  for (let i = 0; i < pc.length; i++) {
    const c = pc[i];
    if (c === "'") q = !q;
    else if (!q && c === "(") d++;
    else if (!q && c === ")") d--;
    else if (!q && c === ";" && d === 0) stmts++;
  }
  assert.equal(stmts, 1, `POSTCHECK فيه ${stmts} جملة — محرّر Supabase يعرض الأخيرة فقط`);
});

test("(٥) الملفّات المحروسة موجودة — لا حارس بلا هدف", () => {
  const missing = GUARDED.filter((f) => read(f) === null);
  assert.deepEqual(missing, [], `ملفّ محروس مفقود: ${missing.join(", ")}`);
});

test("SAFE: ساكن فقط (لا قاعدة بيانات ولا شبكة)", () => {
  const src = fs.readFileSync(__filename, "utf8");
  for (const bad of ["fet" + "ch(", "child_" + "process", "service_" + "role"]) {
    assert.ok(!src.includes(bad), `الفاحص يلمس ${bad}`);
  }
});
