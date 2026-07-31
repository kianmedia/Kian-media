// ════════════════════════════════════════════════════════════════════════════
// tests/sql_cte_dependency_order.test.js
//
// asset_intelligence_POSTCHECK.sql سقط قبل إخراج أيّ صفّ بـ:
//     ERROR 42P01: relation "src" does not exist
//     HINT: … re-order the WITH items to remove forward references.
//
// السبب: أدخلتُ في الجولة السابقة كتل التسمية (naming_rule · live_names ·
// dishonest) **قبل** src، وlive_names تقرأ def_signals منه. وWITH غير
// تعاودية يرى العنصرُ فيها ما سبقه فقط.
//
// وهو عطل **ترتيب** لا منطق: لا يظهر في قراءة الملفّ ولا في اختبار نصّيّ،
// ويظهر عند التحليل النحويّ وحده — ولا قاعدة بيانات هنا. فيُمنع بالبنية:
// نرسم رسم الاعتماديات ونرفض أيّ مرجع أماميّ.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const read = (r) => (fs.existsSync(path.join(ROOT, r)) ? fs.readFileSync(path.join(ROOT, r), "utf8") : null);

const GUARDED = [
  "docs/asset_intelligence_POSTCHECK.sql",
  "docs/asset_intelligence_AFTER_FAILURE_VERIFY.sql",
  "docs/lead_scoring_routing_POST_APPLY_SUMMARY.sql",
  "docs/lead_scoring_routing_POSTCHECK.sql",
];

/**
 * كلّ CTE في الملفّ بترتيب تعريفه، مع جسمه بمسح متوازن للأقواس.
 * المسح واعٍ بالاقتباس: قوسٌ داخل سلسلة ليس قوسًا.
 */
function ctes(sql) {
  const out = [];
  const re = /^([a-z_][a-z0-9_]*)\s*(?:\([^)]*\))?\s+as\s+(?:materialized\s+|not\s+materialized\s+)?\(/gim;
  let m;
  while ((m = re.exec(sql)) !== null) {
    const start = m.index + m[0].length - 1;
    let d = 0, i = start;
    while (i < sql.length) {
      const c = sql[i];
      if (c === "'") {
        i++;
        while (i < sql.length) {
          if (sql[i] === "'") { if (sql.startsWith("''", i)) { i += 2; continue; } break; }
          i++;
        }
      } else if (c === "(") d++;
      else if (c === ")") { d--; if (d === 0) break; }
      i++;
    }
    out.push({ name: m[1], line: sql.slice(0, m.index).split("\n").length, body: sql.slice(start, i + 1) });
  }
  return out;
}

/** كلّ مرجع أماميّ: CTE يقرأ اسمًا يُعرَّف بعده. */
function forwardRefs(sql) {
  const list = ctes(sql);
  const names = list.map((c) => c.name);
  const bad = [];
  list.forEach((c, idx) => {
    for (const other of names) {
      if (other === c.name) continue;
      if (names.indexOf(other) <= idx) continue;                // معرَّف قبله: سليم
      if (new RegExp(`\\b${other}\\b`).test(c.body)) {
        bad.push(`${c.name} (سطر ${c.line}) يقرأ ${other} المعرَّف بعده`);
      }
    }
  });
  return bad;
}

test("(١) ★★ لا مرجع أماميّ بين CTEs في أيّ ملفّ محروس ★★", () => {
  const bad = [];
  for (const f of GUARDED) {
    const sql = read(f);
    if (sql === null) continue;
    for (const b of forwardRefs(sql)) bad.push(`${f}: ${b}`);
  }
  assert.deepEqual(bad, [],
    "WITH غير تعاودية ترى ما سبق فقط — أعد الترتيب طوبولوجيًّا:\n  " + bad.join("\n  "));
});

test("(٢) الفاحص يرصد العطل نفسه ويقبل المصحَّح — غير أجوف", () => {
  const BROKEN = `with
live_names as (select (select def from src) as d),
src as (select 1 as def)
select 1;`;
  const FIXED = `with
src as (select 1 as def),
live_names as (select (select def from src) as d)
select 1;`;
  assert.ok(forwardRefs(BROKEN).length > 0, "الفاحص لا يرى المرجع الأماميّ — فاحص بلا قيمة");
  assert.equal(forwardRefs(FIXED).length, 0, "إنذار كاذب على الترتيب السليم");
});

test("(٣) ★ src في POSTCHECK معرَّف مرّة واحدة وقبل مستهلكيه ★", () => {
  const sql = read("docs/asset_intelligence_POSTCHECK.sql");
  assert.ok(sql, "الملفّ مفقود");
  const list = ctes(sql);
  const names = list.map((c) => c.name);
  assert.equal(names.filter((n) => n === "src").length, 1,
    "src مكرَّر — التكرار حلٌّ التفافيّ لا إعادة ترتيب");
  const iSrc = names.indexOf("src");
  for (const c of list) {
    if (/\bsrc\b/.test(c.body) && names.indexOf(c.name) < iSrc) {
      assert.fail(`${c.name} يقرأ src قبل تعريفه`);
    }
  }
  // والترتيب الصحيح للكتل الثلاث الجديدة
  for (const [a, b] of [["src", "live_names"], ["live_names", "dishonest"], ["naming_rule", "dishonest"]]) {
    assert.ok(names.indexOf(a) > -1 && names.indexOf(b) > -1, `CTE مفقود: ${a} أو ${b}`);
    assert.ok(names.indexOf(a) < names.indexOf(b), `${b} يسبق ${a} وهو يعتمد عليه`);
  }
});

test("(٤) ★ لا WITH RECURSIVE بلا CTE ذاتيّ حقيقيّ ★", () => {
  for (const f of GUARDED) {
    const sql = read(f);
    if (sql === null || !/with\s+recursive/i.test(sql)) continue;
    // إن استُعملت، فليكن فيها CTE يذكر اسمه في جسمه فعلًا.
    const selfRef = ctes(sql).some((c) => new RegExp(`\\b${c.name}\\b`).test(c.body));
    assert.ok(selfRef, `${f}: WITH RECURSIVE بلا تعاود حقيقيّ — التفاف على خطأ ترتيب`);
  }
});

test("(٥) ★ الفحوص المرقّمة ٢…٥٨ كاملة في POSTCHECK ★", () => {
  const sql = read("docs/asset_intelligence_POSTCHECK.sql");
  const nums = [...sql.matchAll(/^\s*select (\d+),/gm)].map((m) => Number(m[1]));
  const missing = [];
  for (let i = 2; i <= 58; i++) if (!nums.includes(i)) missing.push(i);
  assert.deepEqual(missing, [], `فحوص سقطت أثناء إعادة الترتيب: ${missing.join(", ")}`);
  assert.ok(nums.includes(46), "الفحص 46 اختفى");
});

test("(٦) ★ POSTCHECK ما زال آمنًا في محرّر SQL ★", () => {
  const sql = read("docs/asset_intelligence_POSTCHECK.sql");
  const code = sql.split("\n").map((l) => {
    let q = false;
    for (let i = 0; i < l.length; i++) {
      if (l[i] === "'") q = !q;
      else if (!q && l[i] === "-" && l[i + 1] === "-") return l.slice(0, i);
    }
    return l;
  }).join("\n");
  assert.doesNotMatch(code, /^\s*(insert|update|delete|create|alter|drop|truncate)\s/im, "يكتب");
  assert.doesNotMatch(code, /\b(begin|commit|rollback)\s*;/i, "يفتح معاملة");
  assert.doesNotMatch(code, /exception when others then null/i, "catch-all");
  assert.doesNotMatch(code, /^\s*select public\.(custody_inv|civ)_/im, "نداء محميّ حيّ");
  let d = 0, q = false, stmts = 0;
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (c === "'") q = !q;
    else if (!q && c === "(") d++;
    else if (!q && c === ")") d--;
    else if (!q && c === ";" && d === 0) stmts++;
  }
  assert.equal(stmts, 1, `${stmts} جملة — المحرّر يعرض الأخيرة فقط`);
});

test("SAFE: ساكن فقط (لا قاعدة بيانات ولا شبكة)", () => {
  const src = fs.readFileSync(__filename, "utf8");
  for (const bad of ["fet" + "ch(", "child_" + "process", "service_" + "role"]) {
    assert.ok(!src.includes(bad), `الفاحص يلمس ${bad}`);
  }
});
