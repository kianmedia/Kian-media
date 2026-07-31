// ════════════════════════════════════════════════════════════════════════════
// tests/lead_json_key_parser.test.js
//
// ★ المسطرة ★ هذه المرّة الثانية التي يمرّ فيها اختبار Node بينما يرفض
// PostgreSQL البناء نفسه. الأولى كانت حدّ تكرار مقداره ٤٠٠ مقابل RE_DUP_MAX
// (‏255)، والثانية هي هذا الملفّ: `btrim(str)` بوسيط واحد في PostgreSQL يعني
// `btrim(str, ' ')` — يحذف **الفراغات وحدها**، لا سطرًا جديدًا ولا جدولة.
// ووسائط jsonb_build_object في ملفّ منسّق تبدأ على أسطر جديدة، فيبقى chr(10)
// في صدر الوسيط، فلا يطابق النمط '^''(.*)''$' الذي يشترط أن تبدأ السلسلة
// باقتباس، فيُقرأ مفتاحٌ حرفيّ سليم «محسوبًا» وتسقط الترحيلة.
// و`.trim()` في JavaScript يحذف **كلّ** المسافات البيضاء (وأكثر)، فالنقل
// الساذج إلى Node كان يمرّ دائمًا: قياسٌ بمسطرة أخرى ليس قياسًا.
//
// لذلك يَنقل هذا الملفّ الكواشف الأربعة — lsr_key_of · lsr_sql_literals ·
// lsr_json_keys · lsr_client_scan — بدلالات **PostgreSQL** لا بدلالات
// JavaScript، ويقيس بها الملفّ الحقيقيّ. كلّ الفحوص **ساكنة**: قراءة ملفّات
// من القرص. لا اتّصال بقاعدة، ولا شبكة، ولا بيانات إنتاج.
//
// ⚠️ ما لا يستطيعه هذا الملفّ: لا يُشغّل PostgreSQL. هو **نموذج** لدلالاته،
//    والنموذج يُثبت أنّ المنطق سليم لا أنّ الخادم قَبِله. لا اختبار حيّ هنا.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const BASE = "docs/lead_scoring_routing_";
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const SQL = read(`${BASE}RUNME.sql`);

/** كلّ ملفّات الحزمة — الفحص الساكن على btrim يشملها جميعًا. */
const PACKAGE_FILES = fs
  .readdirSync(path.join(ROOT, "docs"))
  .filter((f) => /^lead_scoring_routing_.*\.sql$/.test(f))
  .sort();

// ════════════════════════════════════════════════════════════════════════════
// ١) نموذج دلالات PostgreSQL — لا دلالات JavaScript
// ════════════════════════════════════════════════════════════════════════════

/**
 * صنف [[:space:]] في PostgreSQL بالمحليّة C: فراغ · جدولة · سطر · عموديّة ·
 * صفحة · إرجاع. ‏JavaScript's \s يزيد عليها مسافات Unicode (‏  …) — وزيادةٌ
 * كهذه تجعل الاختبار **أرحم** من المحرّك، وهو بالضبط العطب الذي نطارده.
 */
const PG_SPACE = " \t\n\v\f\r";

/** الوسيط الثاني الضمنيّ لـbtrim: الفراغ وحده. هذا هو بيت الداء كلّه. */
const BTRIM_DEFAULT_CHARS = " ";

/** مجموعة التشذيب في lsr_key_of: ' ' || chr(9) || chr(10) || chr(13). */
const KEY_TRIM_CHARS = " " + "\t" + "\n" + "\r";

/**
 * btrim(string, characters) — يحذف من الطرفين كلّ محرف **من المجموعة**.
 * باستدعاء وسيط واحد تكون المجموعة الفراغ وحده، تمامًا كـPostgreSQL.
 */
function pgBtrim(s, chars = BTRIM_DEFAULT_CHARS) {
  const str = s == null ? "" : String(s);
  let a = 0;
  let b = str.length;
  while (a < b && chars.includes(str[a])) a += 1;
  while (b > a && chars.includes(str[b - 1])) b -= 1;
  return str.slice(a, b);
}

/**
 * يحوّل نمط PostgreSQL (ARE) إلى نمط JavaScript مكافئ للحالات المستعملة هنا:
 *   \m ← بداية كلمة   ·   \M ← نهاية كلمة
 * ونستعمل صنف حروف واعيًا بـUnicode لأنّ حدّ الكلمة في PostgreSQL يتبع
 * المحليّة، والملفّ عربيّ في معظمه.
 */
function pgRe(pattern, flags = "iu") {
  const W = "[\\p{L}\\p{N}_]";
  return new RegExp(
    pattern.replace(/\\m/g, `(?<!${W})`).replace(/\\M/g, `(?!${W})`),
    flags,
  );
}

/**
 * منقول عن public.lsr_key_of **بعد الإصلاح**:
 *   btrim بمجموعة المسافات الأربع، ثمّ '^''(.*)''$'، وإلّا وسم يحمل التعبير.
 * ملاحظة على النمط: `.` في PostgreSQL تطابق سطرًا جديدًا (لا مطابقة حسّاسة
 * للأسطر افتراضًا)، بينما `.` في JavaScript لا تطابقه — فنكتب [\s\S].
 */
function lsrKeyOf(arg) {
  const t = pgBtrim(arg, KEY_TRIM_CHARS);
  const m = /^'([\s\S]*)'$/.exec(t);
  if (m) return m[1];
  // regexp_replace(t, '\s+', ' ', 'g') ثمّ left(…, 60)
  return `<computed: ${t.replace(/[ \t\n\v\f\r]+/g, " ").slice(0, 60)}>`;
}

/** ★ الصيغة **القديمة** ★ محفوظة كبصمة: btrim بوسيط واحد ووسم مبهم. */
function lsrKeyOfBroken(arg) {
  const t = pgBtrim(arg, BTRIM_DEFAULT_CHARS);
  const m = /^'([\s\S]*)'$/.exec(t);
  return m ? m[1] : "<computed>";
}

/** منقول عن public.lsr_sql_literals: كلّ سلسلة حرفية على حدة، بعد فكّ الهروب. */
function lsrSqlLiterals(src) {
  const out = [];
  const n = src.length;
  let i = 0;
  while (i < n) {
    const c = src[i];
    if (c === "-" && src[i + 1] === "-") {
      const p = src.indexOf("\n", i);
      i = p < 0 ? n : p + 1;
    } else if (c === "/" && src[i + 1] === "*") {
      let d = 1;
      i += 2;
      while (i < n && d > 0) {
        if (src.startsWith("/*", i)) { d += 1; i += 2; }
        else if (src.startsWith("*/", i)) { d -= 1; i += 2; }
        else i += 1;
      }
    } else if (c === "'") {
      const s = ++i;
      while (i < n) {
        if (src[i] === "'") { if (src[i + 1] === "'") i += 2; else break; }
        else i += 1;
      }
      out.push(src.slice(s, i).split("''").join("'"));
      i += 1;
    } else i += 1;
  }
  return out;
}

const TOKEN = "jsonb_build_object";

/**
 * منقول عن public.lsr_json_keys: مسح متوازن الأقواس، واعٍ بالاقتباس والتعليق.
 * الوسائط الزوجية مفاتيح والفردية قيم. المؤشّر الخارجيّ يتقدّم **وسمًا** لا
 * كائنًا، فيواصل المرور داخل الوسائط ويلتقط الكائن المتداخل.
 * @param {(s:string)=>string} keyOf — لحقن الصيغة القديمة عند إثبات البصمة.
 * @param {string} emptyChars — مجموعة btrim في فحص «الوسيط فارغ».
 */
function lsrJsonKeys(src, keyOf = lsrKeyOf, emptyChars = KEY_TRIM_CHARS) {
  const out = [];
  const n = src.length;
  let i = 0;
  while (i < n) {
    const c0 = src[i];
    if (c0 === "-" && src[i + 1] === "-") {
      const p = src.indexOf("\n", i);
      i = p < 0 ? n : p + 1;
      continue;
    }
    if (c0 === "/" && src[i + 1] === "*") {
      let d0 = 1;
      i += 2;
      while (i < n && d0 > 0) {
        if (src.startsWith("/*", i)) { d0 += 1; i += 2; }
        else if (src.startsWith("*/", i)) { d0 -= 1; i += 2; }
        else i += 1;
      }
      continue;
    }
    // تخطّي السلسلة **قبل** البحث عن الوسم: داخل SQL الديناميكيّ تُكتب المفاتيح
    // ''key'' بهروب، فقراءتها هنا تُنتج مفتاحًا بعلاماته — إنذار كاذب. السلاسل
    // تُفحص في مرور منفصل بعد فكّ الهروب.
    if (c0 === "'") {
      i += 1;
      while (i < n) {
        if (src[i] === "'") { if (src[i + 1] === "'") i += 2; else { i += 1; break; } }
        else i += 1;
      }
      continue;
    }
    if (!src.startsWith(TOKEN, i)) { i += 1; continue; }
    let k = i + TOKEN.length;
    i = k;                                   // المسح الخارجيّ يواصل داخل الوسائط
    while (k < n && PG_SPACE.includes(src[k])) k += 1;
    if (k >= n || src[k] !== "(") continue;
    k += 1;
    let d = 1;
    let argi = 0;
    let seg = k;
    const take = (end) => {
      const arg = src.slice(seg, end);
      if (argi % 2 === 0 && pgBtrim(arg, emptyChars) !== "") out.push(keyOf(arg));
    };
    while (k < n && d > 0) {
      const c = src[k];
      if (c === "'") {
        k += 1;
        while (k < n) {
          if (src[k] === "'") { if (src[k + 1] === "'") k += 2; else { k += 1; break; } }
          else k += 1;
        }
        continue;
      } else if (c === "(") d += 1;
      else if (c === ")") { d -= 1; if (d === 0) { take(k); break; } }
      else if (c === "," && d === 1) { take(k); argi += 1; seg = k + 1; }
      k += 1;
    }
  }
  return out;
}

/** منقول عن public.lsr_sql_partition: هيكل تنفيذيّ · محتوى السلاسل. */
function lsrSqlPartition(src) {
  let code = "";
  let str = "";
  const n = src.length;
  let i = 0;
  let seg = 0;
  while (i < n) {
    const c = src[i];
    if (c === "-" && src[i + 1] === "-") {
      code += src.slice(seg, i) + " ";
      const p = src.indexOf("\n", i);
      i = p < 0 ? n : p + 1;
      seg = i;
    } else if (c === "/" && src[i + 1] === "*") {
      code += src.slice(seg, i) + " ";
      let d = 1;
      i += 2;
      while (i < n && d > 0) {
        if (src.startsWith("/*", i)) { d += 1; i += 2; }
        else if (src.startsWith("*/", i)) { d -= 1; i += 2; }
        else i += 1;
      }
      seg = i;
    } else if (c === "'") {
      code += src.slice(seg, i) + " '' ";
      const s = ++i;
      while (i < n) {
        if (src[i] === "'") { if (src[i + 1] === "'") i += 2; else break; }
        else i += 1;
      }
      str += src.slice(s, i).split("''").join("'") + "\n";
      i += 1;
      seg = i;
    } else if (c === '"') {
      i += 1;
      while (i < n) {
        if (src[i] === '"') { if (src[i + 1] === '"') i += 2; else { i += 1; break; } }
        else i += 1;
      }
    } else if (c === "$") {
      const m = /^\$(?:[A-Za-z_][A-Za-z_0-9]{0,62})?\$/.exec(src.slice(i, i + 66));
      if (m) { code += src.slice(seg, i) + " "; i += m[0].length; seg = i; }
      else i += 1;
    } else i += 1;
  }
  code += src.slice(seg);
  return { code, strings: str };
}

const RE_WIDE = [
  pgRe("\\mto_jsonb\\s*\\(\\s*[a-z_][a-z_0-9]{0,62}\\s*\\)"),
  pgRe("\\mrow_to_json\\s*\\("),
  pgRe("\\mjsonb_agg\\s*\\(\\s*[a-z_][a-z_0-9]{0,62}\\s*\\)"),
  pgRe("\\mjsonb_agg\\s*\\(\\s*[a-z_][a-z_0-9]{0,62}\\s+order\\s"),
];
const RE_CLIENT_FAMILY = pgRe("\\m(from|join)\\s+(only\\s+)?(public\\.)?(csub_|crm_|sq_|fin_|comms_)");
const RE_CLIENT_SCOPE = pgRe("\\mclient_id\\s*=\\s*\\$1\\M");

/** منقول عن public.lsr_client_scan. */
function lsrClientScan(src, keyOf = lsrKeyOf) {
  let keys = lsrJsonKeys(src, keyOf);
  for (const l of lsrSqlLiterals(src)) {
    keys = keys.concat(lsrJsonKeys(l, keyOf));
    for (const l2 of lsrSqlLiterals(l)) keys = keys.concat(lsrJsonKeys(l2, keyOf));
  }
  const part = lsrSqlPartition(src);
  const both = part.code + "\n" + part.strings;
  let unscoped = null;
  for (const l of lsrSqlLiterals(src)) {
    if (!RE_CLIENT_FAMILY.test(l)) continue;
    if (!RE_CLIENT_SCOPE.test(l)) { unscoped = l.slice(0, 160); break; }
  }
  return {
    keys: [...new Set(keys)].sort(),
    wide_projection: RE_WIDE.some((re) => re.test(both)),
    unscoped_query: unscoped !== null,
    unscoped_sample: unscoped,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// ٢) استخراج النصّ من الملفّ — نصّ الدالّة والقائمة المغلقة
// ════════════════════════════════════════════════════════════════════════════

/**
 * نصّ تعريف الدالّة كاملًا. هذا بديل أمين لما يراه الفحص الذاتيّ:
 * pg_get_functiondef يحفظ جسم الدالّة **حرفيًّا** كما كُتب، بأسطره ومسافاته،
 * ولا يحوي رأسُه أيّ نداء jsonb_build_object.
 */
function funcSrcOf(sql, name) {
  const re = new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+public\\.${name}` +
      "\\s*\\([^)]*\\)[\\s\\S]*?(\\$[a-zA-Z_]*\\$)[\\s\\S]*?\\1\\s*;",
    "i",
  );
  const m = sql.match(re);
  assert.ok(m, `تعذّر إيجاد تعريف الدالّة ${name}`);
  return m[0];
}

/** القائمة المغلقة **مقروءة من RUNME** — لا نسخة ثانية في الاختبار. */
function allowlistOf(sql) {
  const a = sql.indexOf("do $selftest$");
  const b = sql.indexOf("$selftest$;", a);
  assert.ok(a > 0 && b > a, "كتلة الفحص الذاتيّ غائبة أو غير مغلقة");
  const st = sql.slice(a, b);
  const i = st.indexOf("v_client_keys text[] := array[");
  assert.ok(i > 0, "قائمة مفاتيح لوحة العميل غائبة عن الفحص الذاتيّ");
  const j = st.indexOf("];", i);
  assert.ok(j > i, "قائمة مفاتيح لوحة العميل غير مغلقة");
  return [...st.slice(i, j).replace(/--[^\n]*/g, "").matchAll(/'([a-z_0-9]+)'/g)].map((m) => m[1]);
}

/**
 * حكم §14 (٩-ب/ج/د) على لوحة العميل، منقولًا كما هو:
 * كلّ مفتاح مُصدَر في القائمة · لا فحص أجوف · لا مدخل ميت في القائمة ·
 * لا إسقاط عريض · لا استعلام بلا حصر بمعرّف العميل.
 */
function clientDashboardVerdict(sql) {
  const scan = lsrClientScan(funcSrcOf(sql, "lsr_dashboard_client"));
  const allow = allowlistOf(sql);
  const failures = [];
  for (const k of scan.keys) {
    if (!allow.includes(k)) failures.push({ rule: "outside_allowlist", key: k });
  }
  if (scan.keys.length < 30) failures.push({ rule: "hollow_scan", key: String(scan.keys.length) });
  for (const k of allow) {
    if (!scan.keys.includes(k)) failures.push({ rule: "dead_allowlist", key: k });
  }
  if (scan.wide_projection) failures.push({ rule: "wide_projection", key: "" });
  if (scan.unscoped_query) failures.push({ rule: "unscoped_query", key: scan.unscoped_sample });
  return { keys: scan.keys, failures, verdict: failures.length === 0 ? "PASS" : "FAIL" };
}

// ════════════════════════════════════════════════════════════════════════════
// ٣) ★ المسطرة نفسها ★ — لو «بُسّطت» إلى trim() سقط هذا أوّلًا
// ════════════════════════════════════════════════════════════════════════════

test("★ btrim بوسيط واحد يحذف الفراغات وحدها — لا سطرًا ولا جدولة", () => {
  assert.equal(pgBtrim("   x   "), "x", "الفراغ يُحذف");
  // كلّ محرف مسافة **غير** الفراغ يجب أن يبقى في مكانه.
  for (const [name, ch] of [["chr(9) جدولة", "\t"], ["chr(10) سطر", "\n"],
                            ["chr(13) إرجاع", "\r"], ["chr(11) عموديّة", "\v"],
                            ["chr(12) صفحة", "\f"]]) {
    assert.equal(pgBtrim(`${ch}abc${ch}`), `${ch}abc${ch}`,
      `btrim بوسيط واحد حذف ${name} — هذا نموذج JavaScript لا نموذج PostgreSQL`);
  }
  // والفرق عن trim() صريح، لا ضمنيّ: هذه هي الحالة التي أسقطت الترحيلة.
  const arg = "\n      'message'";
  assert.equal(pgBtrim(arg), arg, "btrim(str) لم يترك chr(10) — النموذج خاطئ");
  assert.equal(arg.trim(), "'message'", "trim() في JavaScript يحذف السطر");
  assert.notEqual(pgBtrim(arg), arg.trim(),
    "نموذج btrim صار مطابقًا لـtrim() — عادت المسطرة الخطأ التي مرّرت الترحيلة الساقطة");
});

test("★ btrim بوسيطين يحذف المجموعة المُعطاة كلّها", () => {
  assert.equal(pgBtrim("\n\t 'k' \r\n", KEY_TRIM_CHARS), "'k'");
  assert.equal(pgBtrim("\v'k'\v", KEY_TRIM_CHARS), "\v'k'\v",
    "chr(11) ليس في مجموعة lsr_key_of — النموذج يجب أن يطابق SQL لا أن يتوسّع");
});

test("★ lsr_key_of: مفتاح حرفيّ على سطر جديد يُقرأ مفتاحًا", () => {
  assert.equal(lsrKeyOf("\n      'message'"), "message");
  assert.equal(lsrKeyOf("  'ok'"), "ok");
  assert.equal(lsrKeyOf("\t'client_id'\r\n"), "client_id");
  // والمفتاح غير الحرفيّ يُردّ — **وتُحمل رسالته التعبير** لا وسمًا مبهمًا.
  const c = lsrKeyOf("\n   case when x then 'a' else 'b' end");
  assert.match(c, /^<computed: /);
  assert.match(c, /case when x then/, "الرسالة لا تحمل التعبير المخالف — تشخيصٌ أعمى");
  assert.ok(c.length <= 12 + 60 + 1, "left(…, 60) غير مطبَّق");
});

test("★ نداء بلا وسائط لا يُصدِر مفتاحًا — ولو كُتب على سطرين", () => {
  // الرَّكيزة نفسها خطوةً واحدة جانبًا: فحص «الوسيط فارغ» كان بـbtrim بوسيط
  // واحد أيضًا، فوسيطٌ لا يحمل إلّا chr(10) يُقرأ غير فارغ فيُصدَّر «محسوبًا».
  assert.deepEqual(lsrJsonKeys("select jsonb_build_object()"), []);
  assert.deepEqual(lsrJsonKeys("select jsonb_build_object(\n)"), [],
    "نداء بلا وسائط على سطرين أصدر مفتاحًا — فحص الفراغ يقيس بالمسطرة الخطأ");
  // وبالمجموعة القديمة (فراغ فقط) يظهر العطب: هذا ما يشتريه التغيير.
  assert.deepEqual(lsrJsonKeys("select jsonb_build_object(\n)", lsrKeyOf, " "),
    ["<computed: >"], "النموذج لا يُعيد إنتاج العطب — الفحص أجوف");
  // ولا يُبتلع مفتاح حقيقيّ: الوسيط غير الفارغ يبقى مقروءًا.
  assert.deepEqual(lsrJsonKeys("select jsonb_build_object(\n  'ok', true)"), ["ok"]);
});

test("★ البصمة: الصيغة القديمة (btrim بوسيط واحد) تُتلف مفاتيح حرفية سليمة", () => {
  const def = funcSrcOf(SQL, "lsr_dashboard_client");
  // كلّ وسيط صنّفه الماسح **مفتاحًا**، بنصّه الخام وبترتيب المسح.
  const raw = [];
  const collect = (s) => lsrJsonKeys(s, (a) => { raw.push(a); return lsrKeyOf(a); });
  collect(def);
  for (const l of lsrSqlLiterals(def)) {
    collect(l);
    for (const l2 of lsrSqlLiterals(l)) collect(l2);
  }
  const oldComputed = raw.filter((a) => lsrKeyOfBroken(a) === "<computed>");
  const newComputed = raw.filter((a) => lsrKeyOf(a).startsWith("<computed"));
  console.log(`  [بصمة] وسائط مفاتيح=${raw.length} · «محسوب» بالصيغة القديمة=${oldComputed.length}`
    + ` · بالصيغة المصحّحة=${newComputed.length}`);
  assert.equal(raw.length, 63, "عدد وسائط المفاتيح تغيّر — حدِّث البصمة بعد مراجعة القائمة المغلقة");
  assert.equal(oldComputed.length, 32,
    "بصمة السقوط لم تعُد تُعاد إنتاجها — تحقّق قبل تعديل الرقم");
  assert.equal(newComputed.length, 0, "الإصلاح لا يزال يترك مفتاحًا «محسوبًا»");
  assert.equal(oldComputed[0], "\n      'message'",
    "أوّل وسيط تالف بترتيب المسح تغيّر — الفرع identity_not_enabled هو المتوقَّع");
});

// ════════════════════════════════════════════════════════════════════════════
// ٤) القياس على الملفّ الحقيقيّ
// ════════════════════════════════════════════════════════════════════════════

test("★ لوحة العميل تُصدِر ٤٩ مفتاحًا بالضبط، ولا واحد منها «محسوب»", () => {
  const { keys } = clientDashboardVerdict(SQL);
  const computed = keys.filter((k) => k.startsWith("<computed"));
  console.log(`  [قياس] مفاتيح متمايزة=${keys.length} · محسوب=${computed.length}`);
  assert.deepEqual(computed, [], `مفاتيح غير حرفية: ${computed.join(" | ")}`);
  assert.equal(keys.length, 49, "عدد مفاتيح لوحة العميل تغيّر");
});

test("★ لا مفتاح خارج القائمة، ولا مدخل ميت داخلها", () => {
  const { keys, failures, verdict } = clientDashboardVerdict(SQL);
  const allow = allowlistOf(SQL);
  assert.equal(new Set(allow).size, allow.length, "القائمة المغلقة تحمل تكرارًا");
  assert.equal(allow.length, 49, "طول القائمة المغلقة تغيّر");
  assert.deepEqual(keys.filter((k) => !allow.includes(k)), [], "مفتاح خارج القائمة المغلقة");
  assert.deepEqual(allow.filter((k) => !keys.includes(k)), [],
    "مدخل في القائمة لا تُصدِره اللوحة — تمهيدٌ مسبق لتسريب لاحق");
  assert.deepEqual(failures, [], `الحكم: ${JSON.stringify(failures)}`);
  assert.equal(verdict, "PASS");
});

test("★ القائمة في POSTCHECK نسخة طبق الأصل عن القائمة في RUNME", () => {
  const POSTCHECK = read(`${BASE}POSTCHECK.sql`);
  const i = POSTCHECK.indexOf("client_keys(k) as (values");
  assert.ok(i > 0, "قائمة المفاتيح غائبة عن POSTCHECK");
  const j = POSTCHECK.indexOf("))", i) + 1;   // ‏+1 كي يدخل قوسُ آخر مدخل في المقطع
  assert.ok(j > i, "قائمة المفاتيح في POSTCHECK غير مغلقة");
  const post = [...POSTCHECK.slice(i, j).matchAll(/\('([a-z_0-9]+)'\)/g)].map((m) => m[1]);
  assert.equal(post.length, 49, `قائمة POSTCHECK قُرئت ناقصة (${post.length})`);
  assert.deepEqual([...post].sort(), [...allowlistOf(SQL)].sort(),
    "نسخة POSTCHECK انحرفت عن قائمة RUNME");
});

// ════════════════════════════════════════════════════════════════════════════
// ٥) ★ الفحص الساكن على btrim نفسه ★
//    وسيط واحد + نمط مثبَّت الطرفين في الجملة نفسها = العطب الذي أسقط الترحيلة.
// ════════════════════════════════════════════════════════════════════════════

/**
 * يمحو التعليقات ويُبقي السلاسل **وطول النصّ**، فتبقى أرقام الأسطر صحيحة.
 * ‼️ ضروريّ لا تجميليّ: الملفّ يشرح هذا العطب نفسه في تعليق عربيّ يكتب
 *    `btrim(str)` ويذكر النمط '^''(.*)''$'. فحصٌ يمسح النصّ الخام يُدين هذا
 *    الشرح — وهو حرفيًّا عطب `zoho` الذي أسقط الترحيلة الأولى: ذِكرُ الشيء
 *    ليس استعماله. والسلاسل تبقى لأنّ النمط المثبَّت **سلسلة** هو ما نبحث عنه.
 */
function blankSqlComments(src) {
  const n = src.length;
  const keep = src.split("");
  const blank = (a, b) => { for (let x = a; x < b && x < n; x += 1) if (keep[x] !== "\n") keep[x] = " "; };
  let i = 0;
  while (i < n) {
    const c = src[i];
    if (c === "-" && src[i + 1] === "-") {
      const p = src.indexOf("\n", i);
      const end = p < 0 ? n : p;
      blank(i, end);
      i = end;
    } else if (c === "/" && src[i + 1] === "*") {
      const start = i;
      let d = 1;
      i += 2;
      while (i < n && d > 0) {
        if (src.startsWith("/*", i)) { d += 1; i += 2; }
        else if (src.startsWith("*/", i)) { d -= 1; i += 2; }
        else i += 1;
      }
      blank(start, i);
    } else if (c === "'") {
      i += 1;
      while (i < n) {
        if (src[i] === "'") { if (src[i + 1] === "'") i += 2; else { i += 1; break; } }
        else i += 1;
      }
    } else i += 1;
  }
  return keep.join("");
}

/** نداءات btrim في مصدر، بعدد وسائطها العلويّة وبقيّة جملتها. */
function btrimCalls(src) {
  const out = [];
  const re = /\bbtrim\s*\(/gi;
  let m;
  while ((m = re.exec(src)) !== null) {
    let k = m.index + m[0].length;
    let d = 1;
    let commas = 0;
    const n = src.length;
    while (k < n && d > 0) {
      const c = src[k];
      if (c === "'") {
        k += 1;
        while (k < n) {
          if (src[k] === "'") { if (src[k + 1] === "'") k += 2; else { k += 1; break; } }
          else k += 1;
        }
        continue;
      }
      if (c === "(") d += 1;
      else if (c === ")") { d -= 1; if (d === 0) break; }
      else if (c === "," && d === 1) commas += 1;
      k += 1;
    }
    const semi = src.indexOf(";", k);
    out.push({
      index: m.index,
      line: src.slice(0, m.index).split("\n").length,
      argc: commas + 1,
      rest: src.slice(k, semi < 0 ? Math.min(n, k + 400) : semi),
    });
  }
  return out;
}

/**
 * «نتيجته تُغذّي نمطًا مثبَّتًا» — بالشكل لا بالجوار. النتيجة تُمرَّر مباشرة:
 *   substring(btrim(x) from '^…')   أو   btrim(x) ~ '^…'
 * ولا يكفي أن يوجد نمطٌ مثبَّت في مكانٍ ما من الجملة: ملفّ الأدلّة **جملة
 * واحدة** بأكملها، فمعيار الجوار كان سيُدين كلّ btrim فيه — وهو الإفراط نفسه
 * الذي أسقط الترحيلة مرّتين. البقيّة تبدأ بقوس btrim الخاتم.
 */
const RE_FED_ANCHORED = /^\)?\s*(from|!?~\*?)\s*'\^/i;

/**
 * ★ إعادة إنتاج العطب دليلًا، لا ارتكابًا له ★
 * ملفّ ما بعد السقوط يكتب الصيغة **القديمة** كما كانت ثمّ يؤكّد أنّها تُعيد
 * NULL — هكذا يُثبت السببَ على الخادم نفسه. حذفُها إخفاءٌ للدليل، وهو ما رفضه
 * هذا الملفّ مرّتين من قبل (جملة Zoho ومصفوفة excluded_by_design).
 * والتمييز **بنيويّ** لا بالاسم: نتيجة النمط تُختبر فورًا بـ`is null`، أي
 * قيمة منطقية — ولا يمكن لقيمة منطقية أن تُغذّي مفتاحًا في قائمة مغلقة.
 * ومع ذلك يبقى الاستثناء مربوطًا: موضع واحد في الحزمة كلّها، لا أكثر.
 * البقيّة تبدأ بقوس btrim الخاتم، ثمّ from '^''(.*)''$' ثمّ قوس substring.
 */
const RE_EVIDENCE = /^\)\s*from\s+'\^''\(\.\*\)''\$'\)\s*is\s+null\b/;

test("★ لا btrim بوسيط واحد يُغذّي نمطًا مثبَّت الطرفين", () => {
  let checked = 0;
  let single = 0;
  const evidence = [];
  for (const f of PACKAGE_FILES) {
    const src = blankSqlComments(read(`docs/${f}`));
    for (const call of btrimCalls(src)) {
      checked += 1;
      if (call.argc === 1) single += 1;
      const anchored = RE_FED_ANCHORED.test(call.rest);
      if (call.argc === 1 && anchored && RE_EVIDENCE.test(call.rest.slice(0, 120))) {
        evidence.push(`docs/${f}:${call.line}`);
        continue;
      }
      assert.ok(!(call.argc === 1 && anchored),
        `docs/${f}:${call.line} — btrim بوسيط واحد (فراغات فقط) يُغذّي نمطًا مثبَّتًا بـ^: `
        + "سطرٌ جديد أو جدولة في صدر النصّ سيمنع المطابقة، فيُقرأ الحرفيّ «محسوبًا». "
        + "استعمل btrim(x, ' ' || chr(9) || chr(10) || chr(13)).");
    }
  }
  console.log(`  [ساكن] نداءات btrim مفحوصة=${checked} · بوسيط واحد=${single}`
    + ` · إعادة إنتاج دليليّة=${evidence.length} (${evidence.join(", ") || "لا شيء"})`);
  // الاستثناء مربوط: موضع واحد، وفي ملفّ يعرض الصيغة المصحّحة إلى جانبه.
  assert.equal(evidence.length, 1,
    `إعادة إنتاج العطب مسموحة في موضع واحد فقط؛ وُجدت ${evidence.length}: ${evidence.join(", ")}`);
  const afv = read(`${BASE}AFTER_FAILURE_VERIFY.sql`);
  assert.ok(evidence[0].includes("AFTER_FAILURE_VERIFY"),
    `إعادة الإنتاج خارج ملفّ الأدلّة: ${evidence[0]}`);
  assert.match(afv, /btrim\(\(select txt from third_arg\), ' ' \|\| chr\(9\) \|\| chr\(10\) \|\| chr\(13\)\)/,
    "ملفّ الأدلّة يعرض الصيغة القديمة بلا الصيغة المصحّحة إلى جانبها — دليلٌ ناقص");
  assert.ok(checked >= 15, "الفحص لم يجد نداءات btrim — أجوف لا ناجح");
  assert.ok(single >= 1, "لا نداء بوسيط واحد في الحزمة — الفحص غير مُختبَر على حالته الحرجة");
  // وغير أجوف: نداء مصطنع بوسيط واحد أمام نمط مثبَّت يجب أن يُلتقط.
  const bait = btrimCalls("select substring(btrim(x) from '^''(.*)''$');");
  assert.equal(bait.length, 1);
  assert.equal(bait[0].argc, 1);
  assert.ok(RE_FED_ANCHORED.test(bait[0].rest),
    "الفحص لا يرى النمط المثبَّت — كان سيمرّ على العطب نفسه");
  assert.ok(!RE_EVIDENCE.test(bait[0].rest),
    "استثناء الدليل يبتلع ارتكابًا حقيقيًّا — نتيجة تُستعمل لا تُختبر بـis null");
  // ولا يُدين ما ليس تغذية: نتيجة تُقارَن بنصّ، لا تُمرَّر إلى نمط مثبَّت.
  const notFed = btrimCalls("select btrim(chr(10) || '  x  ') = chr(10) || '  x', y ~ '^z';");
  assert.equal(notFed[0].argc, 1);
  assert.ok(!RE_FED_ANCHORED.test(notFed[0].rest),
    "معيار «التغذية» يقيس الجوار لا الشكل — سيُدين كلّ btrim في ملفّ من جملة واحدة");
  const ok2 = btrimCalls("select substring(btrim(x, ' ' || chr(10)) from '^''(.*)''$');");
  assert.equal(ok2[0].argc, 2, "عدّ الوسائط يخلط الفاصلة الداخلية بالعلوية");
  // …ولا يُدين **ذكرًا** في تعليق: الشرح العربيّ للعطب يكتب btrim(str) ويذكر
  // النمط المثبَّت، فمسحُ النصّ الخام كان سيُسقط الملفّ الذي يشرح الإصلاح.
  const mention = "-- btrim(str) مع '^''(.*)''$' شرحٌ للعطب لا ارتكاب له\nselect 1;";
  assert.equal(btrimCalls(blankSqlComments(mention)).length, 0,
    "الفحص يقرأ نداءً داخل تعليق — ذِكرُ الشيء ليس استعماله (عطب zoho نفسه)");
  assert.equal(btrimCalls(mention).length, 1,
    "النصّ الخام لا يحمل الذِّكر أصلًا — فحص إبطال التعليق أجوف");
});

// ════════════════════════════════════════════════════════════════════════════
// ٥-ب) ملفّ ما بعد السقوط — يغطّي المحاولة الثالثة، ويبقى صالحًا للتشغيل
//      في محرّر SQL حيث auth.uid() = NULL: قراءة فقط · نتيجة واحدة · لا نداء
//      لدالّة محميّة (ولا لأيّ lsr_* أصلًا، فهي غير موجودة بعد التراجع).
// ════════════════════════════════════════════════════════════════════════════

test("★ AFTER_FAILURE_VERIFY يغطّي المحاولة الثالثة", () => {
  const AFV = read(`${BASE}AFTER_FAILURE_VERIFY.sql`);
  for (const [what, re] of [
    ["قسم V2d", /V2d\.the_third_abort_was_a_reader_defect/],
    ["إعادة إنتاج btrim الافتراضيّ", /btrim\(chr\(10\) \|\| '  x  '\)/],
    ["الوسيط الذي أسقط الترحيلة", /third_arg\(txt\) as \(\s*\n\s*values \(chr\(10\) \|\| '      ''message'''\)/],
    ["القارئ المصحّح يقرأ المفتاح", /new3_reads_literal_key/],
    ["…ولا يزال يردّ المحسوب", /new3_still_refuses_computed/],
    ["الدرس: المسطرة الخطأ", /RE_DUP_MAX/],
    ["لا حالة جزئية", /V1\.no_partial_lsr_state/],
    ["الحزم الستّ سليمة", /V3\.' \|\| c\.pkg \|\| '_intact/],
  ]) assert.match(AFV, re, `AFTER_FAILURE_VERIFY: ${what} غائب`);
  for (const p of ["comms", "ops", "crm", "fin", "csub", "sq"]) {
    assert.ok(AFV.includes(`'${p}\\_%'`), `AFTER_FAILURE_VERIFY لا يقيس الحزمة ${p}_*`);
  }
});

test("★ AFTER_FAILURE_VERIFY: قراءة فقط · نتيجة واحدة · بلا نداء محميّ", () => {
  const AFV = read(`${BASE}AFTER_FAILURE_VERIFY.sql`);
  assert.doesNotMatch(AFV, /^\s*(insert|update|delete|create|alter|drop|grant|revoke|truncate)\b/im,
    "كتابة أو DDL في ملفّ يُفترض أنّه للقراءة فقط");
  assert.doesNotMatch(AFV, /^\s*(begin|commit);/im, "يفتح معاملة");
  const code = lsrSqlPartition(AFV).code;
  const stmts = code.split(";").filter((s) => s.trim().length > 0);
  assert.equal(stmts.length, 1,
    `${stmts.length} جملة — المحرّر يعرض النتيجة الأخيرة فقط، فتضيع بقيّة الأدلّة`);
  // لا نداء لأيّ دالّة lsr_* — بعد التراجع لا وجود لها، والنداء يُسقط الملفّ
  // كلّه. الإشارة داخل to_regprocedure('…') سلسلة لا نداء، والتقسيم يُفرغها.
  assert.doesNotMatch(code, pgRe("\\mpublic\\.lsr_[a-z_0-9]*\\s*\\("),
    "الملفّ ينادي دالّة lsr_* — سينهار على قاعدة تراجعت بدل أن يشخّص");
  assert.match(AFV, /to_regprocedure/, "لا يفحص وجود الدوالّ عبر الكتالوج");
  // ترتيب الصفوف: كلّ ord حرفيّ فريد، ولا يصطدم بالمدى الديناميكيّ 131..136.
  const ords = [...AFV.matchAll(/^select (\d+)(?: as ord)?, '/gm)].map((m) => Number(m[1]));
  assert.ok(ords.length >= 15, `عدد الصفوف المرقَّمة قليل على نحو مريب (${ords.length})`);
  assert.equal(new Set(ords).size, ords.length, `ord مكرّر: ${ords.join(",")}`);
  for (const o of ords) {
    assert.ok(o < 131 || o > 136, `ord ${o} يصطدم بمدى «130 + c.ord» للحزم الستّ`);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// ٦) ★ اللاتفاهة ★ أربع عشرة حالة: تحوير → قياس → استعادة.
//    التحوير على **نسخة في الذاكرة**؛ الملفّ على القرص لا يُمسّ (يُثبت ذلك
//    الفحص الأخير). كلّ حالة تُعلن حكمها المتوقَّع، وسببه لا مجرّد فشلها.
// ════════════════════════════════════════════════════════════════════════════

const A_CLIENT = "'client_id', v_client,";
const A_SUBS = "'subscriptions', v_subs,";
const A_BAL = "'balances', coalesce(v_bal, '[]'::jsonb),";
const A_REQ = "      into v_req using v_client;";
const A_SCOPE = "where s.client_id = $1 and s.is_deleted = false";
const A_NOTE = "'note', 'أرقامك أنت";

/** يستبدل نصًّا يجب أن يكون **وحيدًا** في الملفّ — تحويرٌ في مكانين وهمٌ لا حالة. */
function sub(sql, needle, replacement) {
  const parts = sql.split(needle);
  assert.equal(parts.length, 2, `المرساة غير وحيدة أو غائبة: ${needle}`);
  const out = parts.join(replacement);
  assert.notEqual(out, sql, "التحوير لم يغيّر النصّ");
  return out;
}

/** يحمل مفتاحًا بعينه في قائمة المخالفات. */
const has = (fs_, rule, key) => fs_.some((f) => f.rule === rule && String(f.key).includes(key));

const CASES = [
  {
    n: 1,
    title: "مفتاح حرفيّ موجود أصلًا في القائمة",
    expect: "PASS",
    mutate: (s) => sub(s, A_CLIENT, `${A_CLIENT} 'status', 'ok',`),
    check: (v) => {
      assert.equal(v.keys.length, 49, "المفتاح المكرّر غيّر عدد المفاتيح المتمايزة");
      assert.ok(v.keys.includes("status"));
    },
  },
  {
    n: 2,
    title: "مفتاح حرفيّ جديد خارج القائمة",
    expect: "FAIL",
    mutate: (s) => sub(s, A_CLIENT, `${A_CLIENT} 'brand_new_key', 1,`),
    check: (v) => assert.ok(has(v.failures, "outside_allowlist", "brand_new_key"),
      `المخالفة المتوقَّعة غائبة: ${JSON.stringify(v.failures)}`),
  },
  {
    n: 3,
    title: "مفتاح من تعبير CASE",
    expect: "FAIL",
    mutate: (s) => sub(s, A_CLIENT,
      "case when v_client is null then 'client_id' else 'client_id' end, v_client,"),
    check: (v) => {
      assert.ok(v.failures.some((f) => f.rule === "outside_allowlist"
        && String(f.key).startsWith("<computed:") && String(f.key).includes("case when")),
        `لم يُردّ المفتاح المحسوب: ${JSON.stringify(v.failures)}`);
      assert.ok(has(v.failures, "dead_allowlist", "client_id"),
        "المفتاح الحرفيّ اختفى ولم يُبلَّغ عنه مدخلًا ميتًا");
    },
  },
  {
    n: 4,
    title: "مفتاح من متغيّر (v_k)",
    expect: "FAIL",
    mutate: (s) => sub(s, A_CLIENT, "v_k, v_client,"),
    check: (v) => assert.ok(v.failures.some((f) => f.rule === "outside_allowlist"
      && String(f.key) === "<computed: v_k>"),
      `المتغيّر لم يُردّ مفتاحًا محسوبًا: ${JSON.stringify(v.failures)}`),
  },
  {
    n: 5,
    title: "coalesce(...) بموضع **قيمة** — لا يُحسب مفتاحًا",
    expect: "PASS",
    mutate: (s) => sub(s, A_SUBS, "'subscriptions', coalesce(v_subs, '[]'::jsonb),"),
    check: (v) => {
      assert.equal(v.keys.length, 49, "الفاصلة داخل coalesce أزاحت ترقيم الوسائط");
      assert.ok(!v.keys.includes("[]"), "قيمة داخل coalesce قُرئت مفتاحًا");
      assert.ok(v.keys.includes("subscriptions"));
    },
  },
  {
    n: 6,
    title: "فاصلة داخل CASE … END",
    expect: "PASS",
    mutate: (s) => sub(s, A_BAL,
      "'balances', case when coalesce(v_bal, '[]'::jsonb) is null "
      + "then '{\"k\": \"a, b\"}'::jsonb else v_bal end,"),
    check: (v) => {
      assert.equal(v.keys.length, 49, "فاصلة داخل CASE كسرت تقسيم الوسائط");
      assert.ok(v.keys.includes("balances"));
    },
  },
  {
    n: 7,
    title: "فاصلة داخل jsonb_build_array",
    expect: "PASS",
    mutate: (s) => sub(s, A_BAL, "'balances', jsonb_build_array(v_bal, 1, 2, 3),"),
    check: (v) => {
      assert.equal(v.keys.length, 49, "فاصلة داخل jsonb_build_array كسرت تقسيم الوسائط");
      assert.ok(v.keys.includes("balances"));
    },
  },
  {
    n: 8,
    title: "jsonb_build_object متداخل — مفاتيحه تُفحص",
    expect: "FAIL",
    mutate: (s) => sub(s, A_SUBS, "'subscriptions', jsonb_build_object('nested_internal_cost', v_subs),"),
    check: (v) => assert.ok(has(v.failures, "outside_allowlist", "nested_internal_cost"),
      `المفتاح المتداخل لم يُفحص: ${JSON.stringify(v.failures)}`),
  },
  {
    n: 9,
    title: "object1 || object2 — الكتلتان تُفحصان",
    expect: "FAIL",
    mutate: (s) => sub(s, A_SUBS,
      "'subscriptions', jsonb_build_object('status', v_subs) || jsonb_build_object('second_block_leak', 1),"),
    check: (v) => assert.ok(has(v.failures, "outside_allowlist", "second_block_leak"),
      `الكتلة الثانية من الدمج لم تُفحص: ${JSON.stringify(v.failures)}`),
    also: {
      title: "…والكتلة الأولى كذلك",
      mutate: (s) => sub(s, A_SUBS,
        "'subscriptions', jsonb_build_object('first_block_leak', v_subs) || jsonb_build_object('status', 1),"),
      check: (v) => assert.ok(has(v.failures, "outside_allowlist", "first_block_leak"),
        `الكتلة الأولى من الدمج لم تُفحص: ${JSON.stringify(v.failures)}`),
    },
  },
  {
    n: 10,
    title: "الوسم داخل تعليق أو سلسلة — لا يُعدّ",
    expect: "PASS",
    mutate: (s) => {
      let out = sub(s, A_REQ, `${A_REQ}\n  -- jsonb_build_object('ghost_from_comment', 1)`
        + "\n  /* jsonb_build_object('ghost_from_block_comment', 1) */");
      out = sub(out, A_NOTE, "'note', 'jsonb_build_object وسمٌ في نصّ لا نداء — أرقامك أنت");
      return out;
    },
    check: (v) => {
      assert.equal(v.keys.length, 49, "الوسم في تعليق أو نصّ غيّر حصيلة المفاتيح");
      assert.ok(!v.keys.some((k) => k.startsWith("ghost_")), "مفتاح من تعليق دخل الحصيلة");
    },
  },
  {
    n: 11,
    title: "to_jsonb(row) — إسقاط عريض",
    expect: "FAIL",
    mutate: (s) => sub(s, A_SUBS, "'subscriptions', to_jsonb(v_subs),"),
    check: (v) => {
      assert.ok(has(v.failures, "wide_projection", ""), `الإسقاط العريض لم يُرصد: ${JSON.stringify(v.failures)}`);
      assert.equal(v.keys.length, 49, "الحالة تفشل لسبب آخر غير الإسقاط العريض");
    },
  },
  {
    n: 12,
    title: "مفتاح internal_cost",
    expect: "FAIL",
    mutate: (s) => sub(s, A_CLIENT, `${A_CLIENT} 'internal_cost', 1,`),
    check: (v) => assert.ok(has(v.failures, "outside_allowlist", "internal_cost"),
      `مفتاح التكلفة الداخلية مرّ: ${JSON.stringify(v.failures)}`),
  },
  {
    n: 13,
    title: "الملفّ كما هو — قائمة الـ٤٩ بلا تغيير",
    expect: "PASS",
    mutate: (s) => s,
    check: (v) => assert.equal(v.keys.length, 49),
  },
  {
    n: 14,
    title: "حذف client_id = $1",
    expect: "FAIL",
    mutate: (s) => sub(s, A_SCOPE, "where s.is_deleted = false"),
    check: (v) => {
      // العيّنة left(l,160) فتُظهر صدر الاستعلام لا جملة from — نتحقّق منها هي.
      assert.ok(has(v.failures, "unscoped_query", "'subscription_id', s.id"),
        `الاستعلام بلا حصر لم يُرصد أو رُصد في استعلام آخر: ${JSON.stringify(v.failures)}`);
      assert.equal(v.keys.length, 49, "الحالة تفشل لسبب آخر غير غياب الحصر");
    },
  },
];

const RESULTS = [];

for (const c of CASES) {
  test(`★ لاتفاهة ${c.n}: ${c.title} → ${c.expect}`, () => {
    const before = read(`${BASE}RUNME.sql`);
    const run = (mutate, check) => {
      const mutated = mutate(SQL);
      const v = clientDashboardVerdict(mutated);
      assert.equal(v.verdict, c.expect,
        `الحكم ${v.verdict} والمتوقَّع ${c.expect} — ${JSON.stringify(v.failures)}`);
      check(v);
      return v;
    };
    const v = run(c.mutate, c.check);
    if (c.also) run(c.also.mutate, c.also.check);
    // الاستعادة: التحوير كان على نسخة، والملفّ على القرص لم يُمسّ.
    assert.equal(read(`${BASE}RUNME.sql`), before, "الاختبار عدّل ملفّ الحزمة على القرص");
    RESULTS.push(`${c.n}:${c.expect}${c.also ? "(+)" : ""}`);
    console.log(`  [لاتفاهة ${String(c.n).padStart(2)}] ${c.expect}`
      + ` · مفاتيح=${v.keys.length} · مخالفات=${v.failures.length} · ${c.title}`);
  });
}

test("★ الأربع عشرة حالة كلّها نُفّذت، ولم يبقَ الملفّ محوَّرًا", () => {
  assert.equal(RESULTS.length, 14, `نُفِّذت ${RESULTS.length} حالة من ١٤`);
  assert.equal(read(`${BASE}RUNME.sql`), SQL, "الملفّ على القرص لا يطابق ما قُرئ في البدء");
  console.log(`  [حصيلة] ${RESULTS.join("  ")}`);
});
