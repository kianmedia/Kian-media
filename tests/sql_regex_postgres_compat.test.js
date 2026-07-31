// ════════════════════════════════════════════════════════════════════════════
// tests/sql_regex_postgres_compat.test.js
//
// ★ لماذا هذا الملفّ موجود ★
// سقطت commercial_subscriptions_RUNME.sql على الإنتاج قبل COMMIT بـ:
//     ERROR 2201B: invalid regular expression: invalid repetition count(s)
// والنمط كان: [^;]{0,400}?
// محرّك regex في PostgreSQL يسقُف حدّ التكرار عند 255 (RE_DUP_MAX في POSIX).
// و‏JavaScript **بلا سقف**، فكلّ اختبار Node كان يترجم النمط بنجاح ويؤكّد صحّته.
// أي أنّ الاختبارات لم تكن ناقصة التغطية — كانت تقيس بالمسطرة الخطأ.
//
// لذلك: هذا الفاحص **لا يستعمل RegExp في الحكم**. يفحص النصّ بقواعد ARE
// الخاصّة بـPostgreSQL. `new RegExp(p)` هنا لا يُسأل عن الصلاحية إطلاقًا.
//
// ويمسح الملفّ كلّه: لا يعتمد على اسم CTE ولا اسم متغيّر ولا رقم سطر، ولا يقف
// عند أوّل مطابقة. البحث بالاسم أعمى بالفعل عن كتلة ثانية في هذا البرنامج من
// قبل، فلا يتكرّر ذلك هنا.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");

/** سقف حدّ التكرار في محرّك PostgreSQL. تجاوزه = 2201B لا نمط ضيّق. */
const PG_RE_DUP_MAX = 255;

/** الملفّات المحروسة: حزمة الاشتراكات + كلّ حزمة غير مطبَّقة تحمل العيب نفسه. */
const GUARDED = [
  "docs/commercial_subscriptions_PREFLIGHT.sql",
  "docs/commercial_subscriptions_RUNME.sql",
  "docs/commercial_subscriptions_POSTCHECK.sql",
  "docs/commercial_subscriptions_AFTER_FAILURE_VERIFY.sql",
  "docs/case_studies_platform_RUNME.sql",
  "docs/kian_ai_assistant_RUNME.sql",
  "docs/live_operations_dashboard_RUNME.sql",
];

function read(rel) {
  const p = path.join(ROOT, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
}

// ─── استخراج السلاسل النصّية، بما فيها المبنيّة بـ|| وchr() ────────────────────
//
// الأنماط في POSTCHECK تُبنى هكذا:
//     '...[^' || chr(59) || ']{0,400}?else...'
// فالمسح الحرفيّ للسلاسل يرى ثلاث قطع لا نمطًا واحدًا، ويفوّت {0,400} تمامًا
// إن وقع الحدّ في قطعة والقوس في أخرى. لذلك نطوي التسلسل أوّلًا.
const CHR = { 10: "\n", 13: "\r", 9: "\t", 45: "-", 59: ";", 39: "'", 44: ",", 34: '"' };

/** يطوي `'a' || chr(59) || 'b'` إلى سلسلة واحدة قبل الفحص. */
function foldConcat(sql) {
  let out = sql;
  for (let i = 0; i < 6; i++) {
    const next = out
      // 'x' || chr(N) || 'y'  →  'x<char>y'
      .replace(/'([^'\n]*)'\s*\|\|\s*chr\((\d+)\)\s*\|\|\s*'([^'\n]*)'/g,
        (m, a, n, b) => (CHR[n] === undefined ? m : `'${a}${CHR[n]}${b}'`))
      // 'x' || 'y'  →  'xy'   (تسلسل حرفيّ مباشر، وقد يمتدّ عبر سطر)
      .replace(/'([^'\n]*)'\s*\|\|\s*'([^'\n]*)'/g, (m, a, b) => `'${a}${b}'`)
      // chr(N) || 'y'  →  '<char>y'
      .replace(/chr\((\d+)\)\s*\|\|\s*'([^'\n]*)'/g,
        (m, n, b) => (CHR[n] === undefined ? m : `'${CHR[n]}${b}'`))
      // 'x' || chr(N)  →  'x<char>'
      .replace(/'([^'\n]*)'\s*\|\|\s*chr\((\d+)\)/g,
        (m, a, n) => (CHR[n] === undefined ? m : `'${a}${CHR[n]}'`));
    if (next === out) break;
    out = next;
  }
  return out;
}

/**
 * كلّ سلسلة نصّية في الملفّ بعد الطيّ، مع رقم سطرها.
 * لا نحاول تمييز «سلسلة نمط» عن غيرها: الحكم على الجميع أأمن، وأيّ حدّ تكرار
 * يتجاوز 255 خطأ سواء استُعمل كنمط أم لا — وإن لم يكن نمطًا فلن يحوي {n,m}.
 */
function sqlStrings(sql) {
  const folded = foldConcat(sql);
  const out = [];
  const lines = folded.split("\n");
  for (let i = 0; i < lines.length; i++) {
    // '' داخل السلسلة اقتباس مهروب، لا نهاية لها.
    for (const m of lines[i].matchAll(/'((?:[^']|'')*)'/g)) out.push({ line: i + 1, s: m[1] });
  }
  return out;
}

// ─── قواعد PostgreSQL ARE التي لا يشاركها JavaScript ────────────────────────

/** كلّ حدّ تكرار {n} أو {n,} أو {n,m} في النمط، متجاهلًا \{ المهروب. */
function bounds(pat) {
  const found = [];
  for (const m of pat.matchAll(/(\\*)\{(\d+)(?:,(\d*))?\}/g)) {
    if (m[1].length % 2 === 1) continue; // \{ حرفيّ لا حدّ
    found.push({ raw: m[0], lo: Number(m[2]), hi: m[3] === undefined || m[3] === "" ? null : Number(m[3]) });
  }
  return found;
}

/**
 * يحذف أصناف المحارف [...] من النمط.
 * داخل الصنف تفقد * و+ و? معناها وتصير محارف عادية، فالبحث عنها بلا وعي
 * بالبنية إنذار كاذب — وهو بالضبط نوع الخطأ الذي أسقط قائمة المنع القديمة
 * («reser·VAT·ion»). هنا: `[A-Za-z0-9._~%!$&*+,;=:@/-]` ليس فيه أيّ مكمّم.
 * ملاحظة ARE: `]` أوّلَ الصنف حرفيّ، و`^]` كذلك.
 */
function stripClasses(pat) {
  let out = "", i = 0;
  while (i < pat.length) {
    if (pat[i] === "\\") { out += pat.slice(i, i + 2); i += 2; continue; }
    if (pat[i] !== "[") { out += pat[i++]; continue; }
    let j = i + 1;
    if (pat[j] === "^") j++;
    if (pat[j] === "]") j++;                       // ] أوّلَ الصنف حرفيّ
    while (j < pat.length && pat[j] !== "]") {
      if (pat[j] === "\\") j++;
      j++;
    }
    if (j >= pat.length) { out += pat.slice(i); break; }  // صنف غير مغلق
    out += "";                                // نائب محايد عن الصنف
    i = j + 1;
  }
  return out;
}

/**
 * بُنى موجودة في JS/PCRE وغائبة عن ARE.
 *
 * ⚠️ هذه القائمة تُضبط بدقّة عمدًا. قاعدة صارمة أكثر من اللازم تُجبر على
 * إعادة كتابة SQL سليم، وهو ضرر لا وقاية. المستبعَد صراحةً بعد التحقّق:
 *   • ‏(?<= و(?<!  — PostgreSQL **يدعم** lookbehind منذ 9.5، فلا تُدرَج.
 *   • ‏\A و\Z      — قيدان قائمان في ARE (جدول قيود الهروب)، فلا تُدرَجان.
 * والمُدرَج أدناه غائب فعلًا ويُنتج خطأ ترجمة.
 */
const JS_ONLY = [
  [/\(\?<[A-Za-z_]/, "مجموعة مسمّاة ‏(?<name>"],
  [/\\[zhRK]/, "‏\\z \\h \\R \\K — غائبة عن ARE (‏\\A و\\Z مدعومتان)"],
  [/[*+?}]\+/, "possessive quantifier ‏*+ ++ ?+"],
];

/** يُعيد قائمة أسباب رفض PostgreSQL للنمط. فارغة = مقبول. */
function pgRejects(pat) {
  const bad = [];
  for (const b of bounds(pat)) {
    if (b.lo > PG_RE_DUP_MAX) bad.push(`${b.raw}: الحدّ الأدنى ${b.lo} > ${PG_RE_DUP_MAX}`);
    if (b.hi !== null && b.hi > PG_RE_DUP_MAX) bad.push(`${b.raw}: الحدّ الأعلى ${b.hi} > ${PG_RE_DUP_MAX}`);
    if (b.hi !== null && b.hi < b.lo) bad.push(`${b.raw}: حدّ مقلوب ${b.lo} > ${b.hi}`);
  }
  // {2,x} أو {,} — بند مشوّه يبدأ بـ{ ورقم/فاصلة ولا يُغلق غلقًا صحيحًا.
  for (const m of pat.matchAll(/(\\*)\{[^}]*\}/g)) {
    if (m[1].length % 2 === 1) continue;
    if (!/^\{\d+(,\d*)?\}$/.test(m[0].slice(m[1].length))) {
      // { متبوعًا بغير رقم يُعامَل حرفيًّا في ARE، فلا نرفضه إلّا إن بدأ برقم.
      if (/^\{\d/.test(m[0].slice(m[1].length))) bad.push(`${m[0]}: بند تكرار مشوّه`);
    }
  }
  // البُنى الخاصّة تُفحص **خارج أصناف المحارف** فقط.
  const bare = stripClasses(pat);
  for (const [re, why] of JS_ONLY) if (re.test(bare)) bad.push(`بنية غائبة عن ARE: ${why}`);
  return bad;
}

/** يحذف تعليقات `--` من نصّ SQL. شرحُ نمطٍ معطوب ليس استعمالًا له. */
function stripSqlComments(sql) {
  return sql.split("\n").map((l) => {
    let q = false;
    for (let i = 0; i < l.length; i++) {
      if (l[i] === "'") q = !q;
      else if (!q && l[i] === "-" && l[i + 1] === "-") return l.slice(0, i);
    }
    return l;
  }).join("\n");
}

/** هل تبدو السلسلة نمطًا؟ نُبلّغ فقط عمّا يحمل بندًا أو بنية خاصّة. */
const looksLikePattern = (s) => /\{|\(\?|\\[AzZhRKmMsSdDwW]|\[\^/.test(s);

// ════════════════════════════════════════════════════════════════════════════
// (١) الحارس الأساسي
// ════════════════════════════════════════════════════════════════════════════

test("(١) لا نمط في أيّ ملفّ محروس يرفضه محرّك PostgreSQL", () => {
  const failures = [];
  let scanned = 0;
  for (const rel of GUARDED) {
    const sql = read(rel);
    if (sql === null) continue;
    for (const { line, s } of sqlStrings(stripSqlComments(sql))) {
      if (!looksLikePattern(s)) continue;
      scanned++;
      for (const why of pgRejects(s)) failures.push(`${rel}:${line} → ${why}\n    النمط: ${s.slice(0, 120)}`);
    }
  }
  assert.ok(scanned >= 20, `لم يُفحص إلّا ${scanned} نمطًا — المستخرِج لا يرى الملفّات`);
  assert.deepEqual(failures, [],
    "أنماط لا يترجمها PostgreSQL:\n  " + failures.join("\n  "));
});

test("(٢) الملفّات المحروسة موجودة فعلًا — لا حارس بلا هدف", () => {
  const missing = GUARDED.filter((f) => read(f) === null);
  assert.deepEqual(missing, [], `ملفّ محروس مفقود: ${missing.join(", ")}`);
});

// ════════════════════════════════════════════════════════════════════════════
// (٢) انحدار مباشر على النمط الذي أسقط الإنتاج
// ════════════════════════════════════════════════════════════════════════════

test("(٣) ★ انحدار: النمط الذي أسقط الإنتاج لا يعود ★", () => {
  // النصّ الحرفيّ الذي فشل، كما ظهر في RUNME:2864 قبل الإصلاح.
  const BROKE_PRODUCTION = "case\\s+when\\s+v_price\\s+then[^;]{0,400}?else\\s+null\\s+end";
  assert.ok(pgRejects(BROKE_PRODUCTION).length > 0,
    "الفاحص لا يرفض النمط الذي أسقط الإنتاج فعلًا — فاحص بلا قيمة");

  // ولا أثر له في أيّ ملفّ.
  for (const rel of GUARDED) {
    const sql = read(rel);
    if (sql === null) continue;
    // التعليقات تُحذف أوّلًا: هذا الملفّ نفسه يشرح {0,400} في تعليقاته، وذكرُ
    // نمطٍ معطوب في شرحٍ ليس ارتكابَه. بدون هذا يفشل الفحص على توثيقه هو.
    const folded = foldConcat(stripSqlComments(sql));
    for (const b of bounds(folded)) {
      assert.ok(b.lo <= PG_RE_DUP_MAX && (b.hi === null || b.hi <= PG_RE_DUP_MAX),
        `${rel}: عاد حدّ تكرار يتجاوز ${PG_RE_DUP_MAX} — ${b.raw}`);
    }
  }
});

test("(٤) الحزم المطبَّقة على الإنتاج بقيت نظيفة", () => {
  // هذه أُجيزت وطُبّقت؛ خلوّها من الحدّ هو ما فسّر نجاحها. حارس ضدّ الانحدار.
  for (const rel of ["docs/communications_hub_RUNME.sql", "docs/operations_center_RUNME.sql",
                     "docs/crm_sales_FOUNDATION_RUNME.sql", "docs/finance_profitability_RUNME.sql"]) {
    const sql = read(rel);
    if (sql === null) continue;
    for (const b of bounds(foldConcat(stripSqlComments(sql)))) {
      assert.ok(b.lo <= PG_RE_DUP_MAX && (b.hi === null || b.hi <= PG_RE_DUP_MAX),
        `${rel}: حزمة مطبَّقة صار فيها حدّ يتجاوز ${PG_RE_DUP_MAX} — ${b.raw}`);
    }
  }
});

// ════════════════════════════════════════════════════════════════════════════
// (٣) الفاحص نفسه ليس فارغًا — كلّ قاعدة تُختبر بمثال يقبل ومثال يرفض
// ════════════════════════════════════════════════════════════════════════════

test("(٥) قواعد الفاحص تميّز المقبول من المرفوض", () => {
  const REJECT = [
    ["[^;]{0,400}?", "الحدّ الذي أسقط الإنتاج"],
    ["([^;]{0,4000}?)", "حدّ أكبر"],
    ["a{256}", "256 بالضبط — أوّل قيمة مرفوضة"],
    ["a{300,}", "حدّ أدنى يتجاوز السقف"],
    ["a{5,2}", "حدّ مقلوب"],
    ["(?<name>x)", "مجموعة مسمّاة"],
    ["\\zx", "\\z غائب عن ARE"],
    ["a*+b", "possessive quantifier"],
  ];
  for (const [pat, why] of REJECT) {
    assert.ok(pgRejects(pat).length > 0, `كان يجب رفض ${pat} (${why})`);
  }
  const ACCEPT = [
    ["[^;]*?", "بلا حدّ — الإصلاح المعتمد"],
    ["^[a-z][a-z0-9_]{2,40}$", "حدّ صغير مشروع، مستعمل فعلًا في RUNME"],
    ["a{255}", "255 بالضبط — آخر قيمة مقبولة"],
    ["a{0,255}", "الحدّ الأعلى عند السقف"],
    ["\\mr\\.([a-z_][a-z0-9_]*)", "حدود كلمات ARE"],
    ["(^|_)(units?|credits?)(_|$)", "مفردات العدّادات"],
    ["--[^\n]*", "حذف التعليقات"],
    ["a\\{500\\}", "قوس مهروب — نصّ لا بند"],
    // ★ مدعومة في PostgreSQL ورفضُها كان سيُجبر على إعادة كتابة SQL سليم ★
    ["(?<![0-9])[0-9]{7,}(?![0-9])", "lookbehind — مدعوم منذ 9.5"],
    ["(?<=x)y", "lookbehind موجب"],
    ["\\Ax\\Z", "\\A و\\Z قيدان قائمان في ARE"],
    ["^/[A-Za-z0-9._~%!$&*+,;=:@/-]+$", "* و+ داخل صنف محارف = نصّ لا مكمّم"],
  ];
  for (const [pat, why] of ACCEPT) {
    assert.deepEqual(pgRejects(pat), [], `كان يجب قبول ${pat} (${why})`);
  }
});

test("(٦) ★ المستخرِج يطوي البناء بـchr() — وإلّا فاتته أنماط POSTCHECK ★", () => {
  // هذه بالضبط صيغة POSTCHECK: القوس في قطعة والحدّ في أخرى. مستخرِج ساذج
  // يرى ثلاث سلاسل قصيرة ولا يرى بندًا إطلاقًا، فيمرّ الملفّ وهو معطوب.
  const built = "select 'a[^' || chr(59) || ']{0,400}?b' as p";
  const strings = sqlStrings(built).filter((x) => looksLikePattern(x.s));
  assert.ok(strings.length > 0, "لم يُستخرج أيّ نمط من بناء chr()");
  assert.ok(strings.some((x) => pgRejects(x.s).length > 0),
    "الطيّ لم يُنتج النمط الكامل — الحدّ المعطوب مرّ عبر بناء chr()");

  // والصيغة المُصلَحة تمرّ.
  const fixed = "select 'a[^' || chr(59) || ']*?b' as p";
  for (const x of sqlStrings(fixed)) assert.deepEqual(pgRejects(x.s), []);
});

test("(٧) أسماء بمحارف خاصّة لا تكسر الفاحص", () => {
  // reservation وvat وunderscore وأرقام وأقواس — لا شيء منها بند تكرار.
  for (const s of ["reservation_entry_id", "overage_vat_rate", "col_123",
                   "a_b_c", "x{}", "{}", "{,}", "", "{abc}"]) {
    assert.doesNotThrow(() => pgRejects(s), `الفاحص انهار على ${JSON.stringify(s)}`);
  }
  assert.deepEqual(pgRejects("reservation_entry_id"), [], "إنذار كاذب على reservation_entry_id");
  assert.deepEqual(pgRejects("{}"), [], "{} حرفيّ في ARE لا بند");
  assert.deepEqual(pgRejects("{,}"), [], "{,} لا يبدأ برقم — حرفيّ في ARE");
});

test("(٨) قوائم فارغة وأحادية ومتعدّدة لا تُنتج بندًا غير صالح", () => {
  // بناء نمط من قائمة أسماء: الحالات الحدّية التي تُنتج () أو (|) أو ((..))
  for (const names of [[], ["units"], ["units", "credits_required", "overage_estimate_units"]]) {
    const pat = names.length ? `\\m(${names.join("|")})\\M` : "\\m\\M";
    assert.deepEqual(pgRejects(pat), [], `قائمة بـ${names.length} عنصرًا أنتجت نمطًا مرفوضًا: ${pat}`);
  }
});

test("SAFE: ساكن فقط (لا قاعدة بيانات ولا شبكة)", () => {
  const src = fs.readFileSync(__filename, "utf8");
  // تُبنى المفردات بالتجزئة كي لا يطابق الملفّ نفسه — الفحص عن الاستعمال لا الذِّكر.
  for (const bad of ["fet" + "ch(", "child_" + "process", "service_" + "role", "net" + "work"]) {
    assert.ok(!src.includes(bad), `الفاحص يلمس ${bad}`);
  }
});
