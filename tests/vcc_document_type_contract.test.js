// ════════════════════════════════════════════════════════════════════════════
// tests/vcc_document_type_contract.test.js
//
// vendor_compliance_center_RUNME.sql سقط قبل COMMIT بـ:
//     ERROR 23503: … doc_type = 'commercial_register' غير موجود في
//                  tvn_document_types
//
// السبب **اختلاف مفتاح** لا نقص زرع: حزمة المواهب والموردين تزرع
// 'commercial_registration' لنفس الوثيقة — التسمية العربية في الحزمتين واحدة
// حرفيًّا: «السجلّ التجاريّ». والثانية 'tax_certificate' مقابل 'vat_certificate'
// المزروع أصلًا. وترتيب الزرع كان سليمًا (الأنواع عند 395، المتطلّبات عند 850)،
// فليست مشكلة ترتيب.
//
// والأخطر أنّ المفتاحين لم يكونا في الإدراج وحده: كانا في جملتَي UPDATE
// (never_public و applies_to) حيث `where key in (…)` لا يطابق شيئًا فيمرّ
// **بصمت** — فلا السجلّ التجاريّ يُمنع من النشر العامّ، ولا هو ولا الشهادة
// الضريبية يكتسبان applies_to = company. عطلٌ وظيفيّ لا يُظهره أيّ خطأ.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const read = (r) => (fs.existsSync(path.join(ROOT, r)) ? fs.readFileSync(path.join(ROOT, r), "utf8") : null);

const VCC = () => read("docs/vendor_compliance_center_RUNME.sql") || "";
const TVN = () => read("docs/talent_vendor_network_RUNME.sql") || "";

/** مفاتيح tvn_document_types التي تزرعها الحزمة. */
function seeded(sql) {
  const out = new Map();
  for (const m of sql.matchAll(/insert into public\.tvn_document_types[^;]*?values([^;]*);/gis)) {
    for (const t of m[1].matchAll(/\(\s*'([a-z_]+)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'/g)) {
      out.set(t[1], { ar: t[2], en: t[3] });
    }
  }
  return out;
}

/** صفوف vcc_readiness_requirements: doc_type هو العمود الرابع. */
function requirements(sql) {
  const m = sql.match(/insert into public\.vcc_readiness_requirements\s*\([^)]*\)\s*values(.*?)\non conflict/s);
  if (!m) return [];
  return [...m[1].matchAll(/\(\s*'([a-z_]+)'\s*,\s*'([a-z_]+)'\s*,\s*'([a-z_]+)'\s*,\s*('([a-z_]+)'|null)/g)]
    .map((t) => ({ key: t[1], context: t[2], kind: t[3], docType: t[5] || null }));
}

const ALL = () => new Map([...seeded(TVN()), ...seeded(VCC())]);

// ─── (أ) اكتمال المفاتيح ────────────────────────────────────────────────────

test("(١) ★★ كلّ doc_type مطلوب موجود في سجلّ الأنواع — الكلّ لا الأوّل ★★", () => {
  const all = ALL();
  const reqs = requirements(VCC());
  assert.ok(reqs.length >= 20, `لم تُقرأ إلّا ${reqs.length} متطلّبات — القارئ لا يرى الإدراج`);
  const docs = reqs.filter((r) => r.kind === "document");
  assert.ok(docs.length >= 15, `${docs.length} متطلّب وثيقة فقط`);
  const missing = [...new Set(docs.map((d) => d.docType).filter((d) => d && !all.has(d)))].sort();
  assert.deepEqual(missing, [],
    "doc_type مطلوب وغير مزروع — 23503 في الانتظار:\n  " + missing.join("\n  "));
});

test("(٢) ★ المفتاحان اللذان أسقطا الترحيلة صارا قانونيَّين ★", () => {
  const reqs = requirements(VCC());
  const byKey = Object.fromEntries(reqs.map((r) => [r.key, r.docType]));
  assert.equal(byKey["commercial_register"], "commercial_registration",
    "متطلَّب السجلّ التجاريّ لا يشير إلى المفتاح القانونيّ commercial_registration");
  assert.equal(byKey["tax_certificate"], "vat_certificate",
    "متطلَّب الشهادة الضريبية لا يشير إلى vat_certificate القائم");
  // ولم يُزرع مرادف ثانٍ لأيٍّ منهما.
  const vccSeed = seeded(VCC());
  for (const bad of ["commercial_register", "tax_certificate"]) {
    assert.ok(!vccSeed.has(bad), `زُرع مرادف ثانٍ للوثيقة: ${bad} — السجلّ يُشقّ نصفين`);
  }
});

test("(٣) ★★ لا مفتاح غير قانونيّ في أيّ جملة — لا في UPDATE التي تمرّ بصمت ★★", () => {
  const code = VCC().split("\n").map((l) => {
    let q = false;
    for (let i = 0; i < l.length; i++) {
      if (l[i] === "'") q = !q;
      else if (!q && l[i] === "-" && l[i + 1] === "-") return l.slice(0, i);
    }
    return l;
  }).join("\n");
  // 'commercial_register' و'tax_certificate' مسموحان **كـrequirement_key فقط**
  // (العمود الأوّل، وهو ليس مفتاحًا أجنبيًّا) — لا كـdoc_type ولا في where key in.
  for (const bad of ["commercial_register", "tax_certificate"]) {
    for (const m of code.matchAll(new RegExp(`'${bad}'`, "g"))) {
      const line = code.slice(0, m.index).split("\n").length;
      const text = code.split("\n")[line - 1];
      const isRequirementKey = new RegExp(`\\(\\s*'${bad}'\\s*,\\s*'[a-z_]+'\\s*,\\s*'[a-z_]+'`).test(text);
      assert.ok(isRequirementKey,
        `السطر ${line}: '${bad}' يُستعمل خارج requirement_key — و\`where key in\` به يمرّ بصمت بلا مطابقة:\n    ${text.trim().slice(0, 100)}`);
    }
  }
});

// ─── (ب) سجلّ واحد ─────────────────────────────────────────────────────────

test("(٤) ★ لا سجلّ أنواع مستندات ثانٍ ★", () => {
  const tables = [...VCC().matchAll(/create table if not exists public\.([a-z0-9_]+)/gi)].map((m) => m[1]);
  const rival = tables.filter((t) => /document_type|doc_type/.test(t));
  assert.deepEqual(rival, [], `سجلّ أنواع ثانٍ: ${rival.join(", ")}`);
  assert.ok(tables.every((t) => t.startsWith("vcc_")),
    `جدول خارج عائلة vcc_: ${tables.filter((t) => !t.startsWith("vcc_")).join(", ")}`);
  // ولا جدول وثائق ثالث: tvn_documents هو السجلّ.
  assert.ok(!tables.some((t) => /^vcc_documents?$/.test(t)), "أُنشئ سجلّ وثائق ثالث");
});

test("(٥) ★ لا مرادف دلاليّ: تسمية عربية واحدة لمفتاح واحد ★", () => {
  const all = ALL();
  const byAr = {};
  for (const [k, v] of all) (byAr[v.ar] ||= []).push(k);
  const dupes = Object.entries(byAr).filter(([, ks]) => ks.length > 1)
    .map(([ar, ks]) => `${ar}: ${ks.join(" / ")}`);
  assert.deepEqual(dupes, [],
    "مفتاحان لوثيقة واحدة — ترفع الشركة تحت أحدهما فتبقى ناقصة تحت الآخر:\n  " + dupes.join("\n  "));
});

// ─── (ج) الحارس والترتيب ───────────────────────────────────────────────────

test("(٦) ★★ حارس العقد قبل الإدراج، ويطبع كلّ الناقص دفعة واحدة ★★", () => {
  const s = VCC();
  const guard = s.indexOf("do $doctypes$");
  const insert = s.indexOf("insert into public.vcc_readiness_requirements");
  assert.ok(guard > -1, "لا حارس عقد قبل الإدراج");
  assert.ok(guard < insert, "الحارس بعد الإدراج — يسقط على أوّل مفتاح ويُخفي البقية");
  assert.match(s.slice(guard, insert), /string_agg/,
    "الحارس لا يجمع المفاتيح الناقصة — يسقط على الأوّل فقط");
  assert.match(s.slice(guard, insert), /label_ar/, "الحارس بلا فحص مرادف دلاليّ");
});

test("(٧) ★ الـFK قائم وdoc_type ليس nullable للمتطلَّب من نوع وثيقة ★", () => {
  const s = VCC();
  assert.match(s, /doc_type\s+text references public\.tvn_document_types\(key\)/,
    "المفتاح الأجنبيّ حُذف — doc_type يتيم يُقرأ «مستوفى» بالخطأ");
  assert.match(s, /kind = 'document'\s+and doc_type is not null/,
    "القيد لا يشترط doc_type لمتطلَّب الوثيقة");
  assert.doesNotMatch(s, /alter table public\.vcc_readiness_requirements[^;]*drop constraint[^;]*doc_type/i,
    "الـFK يُحذف لاحقًا");
});

test("(٨) ★ الحزمة لا تُنشئ وثائق فعلية ولا تكتب على المشاريع ★", () => {
  const raw = VCC();
  const code = raw.replace(/^\s*--.*$/gm, "");
  // ⚠️ يُميَّز DML **وقت التركيب** عن جسم دالّة تعمل وقت التشغيل: إدراج وثيقة
  //    داخل vcc_document_register هو المسار المشروع حين يرفع المورّد مستنده،
  //    أمّا إدراجها في الترحيلة فهو اختلاق بيانات. الخلط بينهما يُدين الصحيح.
  const bodies = [];
  for (const m of raw.matchAll(/create or replace function public\.([a-z0-9_]+)\s*\(/g)) {
    const head = raw.slice(m.index, m.index + 500);
    const t = head.match(/as (\$[a-z0-9_]*\$)/);
    if (!t) continue;
    const start = m.index + head.indexOf(t[1]) + t[1].length;
    const end = raw.indexOf(t[1], start);
    if (end > -1) bodies.push([m.index, end + t[1].length]);
  }
  const atInstallTime = (idx) => !bodies.some(([a, b]) => idx >= a && idx <= b);
  for (const m of raw.matchAll(/insert\s+into\s+public\.tvn_documents\b/gi)) {
    assert.ok(!atInstallTime(m.index),
      `الترحيلة تُدرج وثيقة فعلية عند السطر ${raw.slice(0, m.index).split("\n").length} — التركيب يزرع أنواعًا وقواعد لا مستندات`);
  }
  assert.doesNotMatch(code, /\b(insert into|update|delete from)\s+(public\.)?(projects|project_core|deliverables)\b/i,
    "كتابة على منصّة المشاريع المجمَّدة");
  for (const [what, re] of [["نداء خارجيّ", /\b(pg_net|net\.http|http_(get|post)|dblink)\b/i],
                            ["رابط موقَّع فعليّ", /storage\.sign|create_signed_url/i]])
    assert.doesNotMatch(code, re, `${what} أثناء التركيب`);
});

test("(٩) ★ RUNME معاملة واحدة وقابلة لإعادة التشغيل ★", () => {
  const s = VCC();
  assert.equal((s.match(/^begin;$/gim) || []).length, 1, "أكثر من معاملة — فشلٌ يترك حالة جزئية");
  assert.equal((s.match(/^commit;$/gim) || []).length, 1, "commit غير متوازن");
  assert.doesNotMatch(s.replace(/^\s*--.*$/gm, ""), /concurrently/i, "CONCURRENTLY داخل معاملة");
  assert.match(s, /on conflict \(requirement_key, context\) do nothing/,
    "إعادة التشغيل تكرّر قواعد الجاهزية");
  assert.match(s, /insert into public\.tvn_document_types[\s\S]{0,4000}?on conflict/i,
    "زرع الأنواع بلا on conflict — إعادة التشغيل تكرّرها");
});

// ─── (د) تصنيف الشروط: سابق صلب مقابل قابل للزرع ──────────────────────────

const PRE = () => read("docs/vendor_compliance_center_PREFLIGHT.sql") || "";

function preflightList(name) {
  // ⚠️ مسح متوازن لا تعبير غير جشع: صفوف values تحوي `),` بنفسها، فالتعبير
  //    يقف عند أوّل صفّ فيُرجع ثلاثة من ستّة — وقد أعطى ذلك «قائمة قصيرة».
  const sql = PRE();
  const at = sql.indexOf(`${name}(d) as (values`);
  if (at < 0) return [];
  // ⚠️ القوس المقصود هو قوس `values` لا قوس `(d)` الذي يلي الاسم مباشرةً:
  //    البدء من الأوّل يلتقط `(d)` فيُرجع صفرًا ويبدو الفحص كأنّ القائمة فارغة.
  let i = sql.indexOf("(", sql.indexOf("as (values", at) + 3), d = 0, j = i;
  while (j < sql.length) {
    if (sql[j] === "(") d++;
    else if (sql[j] === ")") { d--; if (d === 0) break; }
    j++;
  }
  return [...sql.slice(i, j).matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
}

test("(١٠) ★★ التصنيف مطابق للواقع: الصلب من TVN والقابل للزرع من VCC ★★", () => {
  // الصيغة الأولى لهذا الصفّ طلبت أن تكون العشرون موجودةً مسبقًا، فأعطت STOP
  // على تركيب أوّل سليم: أربعة عشر منها تزرعها الحزمة نفسها. الغياب قبل
  // التشغيل هو الحالة الطبيعية لا خللًا — والحكم يجب أن يفرّق.
  const hard = preflightList("hard");
  const seedable = preflightList("seedable");
  assert.ok(hard.length >= 5, `قائمة الشروط الصلبة قصيرة: ${hard.length}`);
  assert.ok(seedable.length >= 10, `قائمة القابل للزرع قصيرة: ${seedable.length}`);
  const tvn = seeded(TVN());
  const vcc = seeded(VCC());
  for (const h of hard) {
    assert.ok(tvn.has(h), `مُصنَّف شرطًا صلبًا وليس من زرع TVN: ${h}`);
    assert.ok(!vcc.has(h), `مُصنَّف صلبًا لكنّ VCC تزرعه — فهو قابل للزرع: ${h}`);
  }
  for (const sd of seedable) {
    assert.ok(vcc.has(sd), `مُصنَّف قابلًا للزرع ولا تزرعه VCC: ${sd}`);
  }
  // ولا مفتاح جاهزية خارج الاتّحاد — هذا هو فحص «المجهول» ساكنًا.
  const union = new Set([...hard, ...seedable]);
  const docs = requirements(VCC()).filter((r) => r.kind === "document").map((r) => r.docType);
  const unknown = [...new Set(docs.filter((d) => d && !union.has(d)))].sort();
  assert.deepEqual(unknown, [],
    `doc_type في الترحيلة خارج hard ∪ seedable — الـPreflight لن يراه: ${unknown.join(", ")}`);
});

test("(١١) ★★ غياب القابل للزرع ليس STOP ★★", () => {
  const pre = PRE();
  // الحكم يشترط hard_missing / unknown / dupes للـSTOP، وseedable_missing
  // يُنتج READY_TO_SEED لا STOP.
  const verdict = pre.slice(pre.indexOf("select case when to_regclass('public.tvn_document_types') is null"),
                            pre.indexOf("as verdict"));
  assert.match(verdict, /hard_missing\) > 0\s+then 'STOP'/, "غياب الشرط الصلب لا يُنتج STOP");
  assert.match(verdict, /unknown_types\) > 0 then 'STOP'/, "المفتاح المجهول لا يُنتج STOP");
  assert.match(verdict, /dupes\) > 0\s+then 'STOP'/, "التعارض الدلاليّ لا يُنتج STOP");
  assert.match(verdict, /seedable_missing\) > 0 then 'READY_TO_SEED'/,
    "غياب القابل للزرع ما زال يُنتج STOP — إنذار كاذب على التركيب الأوّل");
  // ولا يظهر seedable_missing في أيّ فرع STOP.
  assert.doesNotMatch(verdict, /seedable_missing\)[^\n]*'STOP'/, "القابل للزرع مانع");
});

test("(١٢) ★ الـPreflight يعرض التصنيف كاملًا لا رقمًا واحدًا ★", () => {
  const pre = PRE();
  for (const col of ["verdict", "existing_required_types", "seedable_missing_types",
                     "hard_missing_types", "unknown_requirement_types",
                     "semantic_conflicts", "expected_seed_count"]) {
    assert.match(pre, new RegExp(`as ${col}\\b`), `عمود مفقود من نتيجة الـPreflight: ${col}`);
  }
  // و«المجهول» لا يُكتب صفرًا ثابتًا يُقرأ نجاحًا حين لا يمكن قياسه: يُعلَن
  // صراحةً أنّ الفحص الحيّ لا ينطبق قبل التركيب، وأنّ العقد الساكن مُتحقَّق.
  assert.match(pre, /NOT_APPLICABLE_BEFORE_INSTALL/,
    "فحص المجهول يُصرّح صفرًا بدل الإعلان عن عدم قابليته للقياس");
  // ولا يعود المرجع المباشر الذي أسقط الملفّ بـ42P01.
  assert.doesNotMatch(pre, /\bfrom\s+public\.vcc_readiness_requirements\b/i,
    "عاد المرجع المباشر إلى جدول قد لا يوجد");
});

// ─── (هـ) التركيب الأوّل: لا مرجع إلى علاقة قد تغيب ───────────────────────

test("(١٣) ★★ الـPreflight لا يشير إلى علاقة vcc_* قد لا توجد ★★", () => {
  // سقط الـPreflight بـ42P01 على تركيب أوّل لأنّه قرأ
  // public.vcc_readiness_requirements داخل CASE محروس بـto_regclass.
  // والحارس لا يحمي: PostgreSQL يحلّ أسماء العلاقات **وقت تحليل الجملة**،
  // للجملة كلّها، قبل تقييم أيّ تعبير. وto_regclass آمنة لأنّها تأخذ نصًّا؛
  // أمّا اسم الجدول عاريًا في FROM فيُطلب من الكتالوج ولو لم يُنفَّذ فرعه.
  const pre = PRE();
  const code = pre.split("\n").map((l) => {
    let q = false;
    for (let i = 0; i < l.length; i++) {
      if (l[i] === "'") q = !q;
      else if (!q && l[i] === "-" && l[i + 1] === "-") return l.slice(0, i);
    }
    return l;
  }).join("\n");
  const refs = [...code.matchAll(/\b(from|join)\s+public\.(vcc_[a-z0-9_]+)/gi)]
    .map((m) => `${m[2]} (سطر ${code.slice(0, m.index).split("\n").length})`);
  assert.deepEqual(refs, [],
    "مرجع مباشر إلى علاقة vcc_* في ملفّ يسبق التركيب — 42P01 مهما كان الحارس:\n  " + refs.join("\n  "));
});

test("(١٤) ★★ القوائم الثلاث متطابقة: الزرع · الجاهزية · المعلَنة ★★", () => {
  const declared = preflightList("declared_requirement_types");
  assert.ok(declared.length >= 15, `القائمة المعلَنة قصيرة: ${declared.length}`);
  // (أ) المعلَنة = doc_type في متطلّبات الجاهزية داخل RUNME، حرفًا بحرف.
  const fromRunme = [...new Set(requirements(VCC())
    .filter((r) => r.kind === "document").map((r) => r.docType).filter(Boolean))].sort();
  assert.deepEqual([...declared].sort(), fromRunme,
    "القائمة المعلَنة في الـPreflight تخالف doc_type في الترحيلة — الفحص يقيس غير ما يُزرع");
  // (ب) وكلّ معلَن داخل hard ∪ seedable.
  const union = new Set([...preflightList("hard"), ...preflightList("seedable")]);
  const orphan = declared.filter((d) => !union.has(d)).sort();
  assert.deepEqual(orphan, [], `مفتاح معلَن خارج hard ∪ seedable: ${orphan.join(", ")}`);
  // (ج) وكلّ قابل للزرع تزرعه الترحيلة فعلًا.
  const vccSeed = seeded(VCC());
  const notSeeded = preflightList("seedable").filter((d) => !vccSeed.has(d)).sort();
  assert.deepEqual(notSeeded, [], `مُعلَن قابلًا للزرع ولا تزرعه الترحيلة: ${notSeeded.join(", ")}`);
});

test("(١٥) ★ الحكم يعلن عدم قابلية القياس بدل صفر مضلِّل ★", () => {
  const pre = PRE();
  assert.match(pre, /NOT_APPLICABLE_BEFORE_INSTALL — STATIC CONTRACT VERIFIED/,
    "لا يُعلن أنّ الفحص الحيّ لا ينطبق قبل التركيب");
  // ويظلّ قادرًا على الإدانة: مفتاح معلَن بلا مصدر يسبق الإعلان في ترتيب الحالات.
  const col = pre.slice(pre.indexOf("as unknown_requirement_types") - 700,
                        pre.indexOf("as unknown_requirement_types"));
  const iUnknown = col.indexOf("unknown_types) > 0");
  const iNA = col.indexOf("NOT_APPLICABLE_BEFORE_INSTALL");
  assert.ok(iUnknown > -1 && iUnknown < iNA,
    "إعلان «لا ينطبق» يسبق فحص المفتاح المجهول فيبتلعه");
});

test("SAFE: ساكن فقط (لا قاعدة بيانات ولا شبكة)", () => {
  const src = fs.readFileSync(__filename, "utf8");
  for (const bad of ["fet" + "ch(", "child_" + "process", "service_" + "role"]) {
    assert.ok(!src.includes(bad), `الفاحص يلمس ${bad}`);
  }
});
