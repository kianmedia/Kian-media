// ════════════════════════════════════════════════════════════════════════════
// tests/commercial_operations_financial_isolation.test.js
//
// ★ لماذا هذا الملفّ ★
//   سقطت ترحيلة الاشتراكات قبل COMMIT عند فحص §17 رقم (11)، وكان قائمة **منع**
//   بالسلاسل الجزئية على أسماء الأعمدة:
//       '%price%' · '%amount%' · '%cost%' · '%vat%' · '%margin%' · '%profit%'
//   والعمود الذي أسقطها هو
//       reservation_entry_id uuid references public.csub_ledger(id)
//   لأنّ حروف «reser·VAT·ion» تحتوي 'vat'. مفتاح أجنبيّ إلى الدفتر، بلا مال.
//   إنذار كاذب: الفحص كان خاطئًا لا المخطّط.
//
//   وقائمة المنع خاطئة في الاتّجاه الآخر أيضًا، وهذا نصفها الخطر: عمود ماليّ
//   حقيقيّ يتجنّب تلك السلاسل الستّ — unit_rate، overage_value — كان يمرّ.
//
//   فحوص هذا الملفّ تقرأ **قائمة السماح من الترحيلة نفسها** وتقارنها بتعريف
//   الجدول. فإن أُضيف عمود إلى الجدول ولم يُضَف إلى القائمة، سقط الفحص —
//   وهذا هو معنى «لا فراغ»: الفحص مربوط بالمصدر لا بنسخة منه.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const SQL = read("docs/commercial_subscriptions_RUNME.sql");
const PREFLIGHT = read("docs/commercial_subscriptions_PREFLIGHT.sql");
const POSTCHECK = read("docs/commercial_subscriptions_POSTCHECK.sql");
const VERIFY = read("docs/commercial_subscriptions_AFTER_FAILURE_VERIFY.sql");

// ─── أدوات استخراج ──────────────────────────────────────────────────────────

/** نصّ التعريف الكامل لدالّة (رأس + جسم)، كما يراه pg_get_functiondef. */
function fnDef(name, src = SQL) {
  const m = src.match(new RegExp(
    "create\\s+or\\s+replace\\s+function\\s+public\\." + name +
      "\\s*\\([\\s\\S]*?\\bas\\s*\\$\\$[\\s\\S]*?\\$\\$\\s*;", "i"));
  assert.ok(m, `تعذّر إيجاد تعريف الدالّة ${name}`);
  return m[0];
}

/** التعريف بلا تعليقات — pg_get_functiondef يُعيد التعليقات، وذكرُ اسمٍ في
 *  شرحٍ ليس إخراجًا له. كلّ فحص تسريب أدناه يعمل على هذه الصورة. */
const stripComments = (s) => s.replace(/--[^\n]*/g, " ");

/** أعمدة جدول، من تعريفه في الترحيلة. */
function tableCols(name) {
  const m = SQL.match(new RegExp(
    "create table if not exists public\\." + name + "\\s*\\(([\\s\\S]*?)\\n\\);", "i"));
  assert.ok(m, `تعذّر إيجاد تعريف الجدول ${name}`);
  const cols = [];
  for (const line of stripComments(m[1]).split("\n")) {
    const mm = line.match(
      /^\s{2}([a-z_][a-z0-9_]*)\s+(uuid|text|numeric|boolean|date|timestamptz|int|integer|bigint|jsonb)\b/i);
    if (mm) cols.push(mm[1]);
  }
  assert.ok(cols.length > 3, `لم تُقرأ أعمدة ${name}`);
  return cols;
}

/** ثابت مصفوفة نصّية داخل كتلة plpgsql — تُقرأ من الترحيلة نفسها. */
function sqlArray(name, src = SQL) {
  const m = src.match(new RegExp(
    name + "\\s+constant\\s+text\\[\\]\\s*:=\\s*array\\[([\\s\\S]*?)\\];", "i"));
  assert.ok(m, `تعذّر إيجاد قائمة ${name} في الترحيلة`);
  return [...stripComments(m[1]).matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

const SR_COLS = sqlArray("SR_COLS");
const SRA_COLS = sqlArray("SRA_COLS");
const OPS_COLS = sqlArray("OPS_COLS");
const MONEY_COLS = sqlArray("MONEY_COLS");
const PRICED_COLS = sqlArray("PRICED_COLS");

const PRICED_SURFACES = ["csub_plans_list", "csub_plan_detail", "csub_subscriptions_list",
  "csub_subscription_detail", "csub_balances", "csub_statement", "csub_dashboard"];

/** ما يبقى من نصّ سطحٍ مُسعَّر بعد حذف كلّ ذكر مُقنَّع أو مُسقَط — أي ما يخرج خامًا. */
function unmaskedRemainder(name) {
  let t = stripComments(fnDef(name));
  t = t.replace(/'[a-z_]+'\s*,\s*case\s+when\s+v_price\s+then[^;]{0,400}?else\s+null\s+end/gi, " ");
  t = t.replace(/case\s+when\s+v_price\s+then[^;]{0,400}?else\s+null\s+end/gi, " ");
  t = t.replace(/-\s*'[a-z_]+'/gi, " ");
  return t;
}

const word = (w) => new RegExp("\\b" + w + "\\b", "i");

/** كلّ `return jsonb_build_object( … );` في دالّة، بأقواس متوازنة لا بحدّ طول.
 *  الحدّ الثابت يجعل الفحص فارغًا صامتًا على جواب طويل — وهو أسوأ من فحص يفشل. */
function jsonReturns(name) {
  const d = stripComments(fnDef(name));
  const out = [];
  const NEEDLE = "return jsonb_build_object(";
  for (let i = d.indexOf(NEEDLE); i !== -1; i = d.indexOf(NEEDLE, i + 1)) {
    let depth = 0, j = i + NEEDLE.length - 1;
    for (; j < d.length; j++) {
      if (d[j] === "'") { j++; while (j < d.length && d[j] !== "'") j++; continue; }
      if (d[j] === "(") depth++;
      else if (d[j] === ")" && --depth === 0) break;
    }
    out.push(d.slice(i, j + 1));
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
// (١) قائمة السماح — لا قائمة منع
// ════════════════════════════════════════════════════════════════════════════

test("(١أ) ★★ قائمة المنع بالسلاسل الجزئية اختفت من الترحيلة ★★", () => {
  // الشكل الحرفيّ الذي أسقط الترحيلة: ستّ ilike على column_name في شرط واحد.
  const st17 = SQL.slice(SQL.indexOf("do $st17$"));
  assert.ok(
    !/column_name\s+ilike\s+'%price%'[\s\S]{0,400}?column_name\s+ilike\s+'%vat%'/i.test(st17),
    "قائمة المنع بالسلاسل الجزئية ما زالت في §17 — هي التي أسقطت الترحيلة على reservation_entry_id",
  );
  assert.ok(!/column_name\s+ilike\s+'%vat%'/i.test(st17),
    "ما زال هناك منع بـ'%vat%' على أسماء الأعمدة — سيطابق «reser·VAT·ion» مجدّدًا");
  // وبديلها موجود: مقارنة <> all على قائمة صريحة.
  assert.match(st17, /column_name\s*<>\s*all\s*\(SR_COLS\)/i,
    "لا قائمة سماح على أعمدة جدول الطلبات");
  assert.match(st17, /column_name\s*<>\s*all\s*\(SRA_COLS\)/i,
    "لا قائمة سماح على أعمدة جدول المرفقات");
});

test("(١ب) ★ الإنذار الكاذب موثَّق ومسموح صراحةً: reservation_entry_id ★", () => {
  assert.ok("reservation_entry_id".includes("vat"),
    "الفرضية نفسها خاطئة — أعد قراءة سبب السقوط");
  assert.ok(SR_COLS.includes("reservation_entry_id"),
    "العمود الذي أسقط الترحيلة غير مذكور في قائمة السماح — ستسقط مرّة أخرى");
  // وهو uuid لا رقم: مفتاح أجنبيّ إلى الدفتر.
  const def = SQL.match(/reservation_entry_id\s+uuid\s+references\s+public\.csub_ledger\(id\)/i);
  assert.ok(def, "reservation_entry_id لم يعد مفتاحًا أجنبيًّا uuid إلى الدفتر");
});

test("(١ج) ★★ كلّ عمود في الجدولين مذكور في قائمة السماح — ولا واحد زائد ★★", () => {
  // ← هذا هو فحص «لا فراغ»: القائمة تُقرأ من الترحيلة، والأعمدة من تعريف
  //   الجدول في الترحيلة نفسها. إضافة unit_price أو overage_amount أو vat أو
  //   contract_value أو cost إلى الجدول تُسقط هذا الفحص فورًا.
  for (const c of tableCols("csub_service_requests")) {
    assert.ok(SR_COLS.includes(c),
      `العمود ${c} في جدول الطلبات وليس في قائمة السماح SR_COLS — كلّ عمود يُبرَّر قبل أن يمرّ`);
  }
  for (const c of tableCols("csub_service_request_attachments")) {
    assert.ok(SRA_COLS.includes(c),
      `العمود ${c} في جدول المرفقات وليس في قائمة السماح SRA_COLS`);
  }
  // والقائمة ليست أوسع من الجدول: قائمة تسمح بما لا وجود له تُخفي مراجعتها.
  const live = new Set(tableCols("csub_service_requests"));
  for (const c of SR_COLS) {
    assert.ok(live.has(c), `قائمة السماح تذكر ${c} وهو غير موجود في الجدول — قائمة لا تُقرأ`);
  }
});

test("(١د) ★ القائمة نفسها محروسة: لا مفردة مال تُدسّ فيها ★", () => {
  // المطابقة بالاسم الكامل، فلا يتكرّر إنذار «reser·VAT·ion» الكاذب.
  for (const c of [...SR_COLS, ...SRA_COLS, ...OPS_COLS]) {
    assert.ok(!MONEY_COLS.includes(c),
      `قائمة السماح تحوي مفردة مال صريحة: ${c}`);
  }
  // ومفردات المال تغطّي ما تفوّته السلاسل الستّ القديمة.
  for (const missed of ["unit_rate", "overage_value", "contract_value", "receivable",
                        "selling_price", "internal_cost", "minimum_price", "renewal_value"]) {
    assert.ok(MONEY_COLS.includes(missed),
      `مفردة المال ${missed} غير محروسة — وقائمة المنع القديمة كانت ستمرّرها`);
  }
  // والدليل: هذه الأسماء لا تطابق أيًّا من السلاسل الستّ.
  for (const missed of ["unit_rate", "overage_value", "billing_line"]) {
    for (const sub of ["price", "amount", "cost", "vat", "margin", "profit"]) {
      assert.ok(!missed.includes(sub),
        `${missed} يطابق %${sub}% — المثال المضادّ غير صالح`);
    }
  }
});

test("(١هـ) ★ القائمة تُطبَّق على السطح لا على الجدول وحده ★", () => {
  const st17 = SQL.slice(SQL.indexOf("do $st17$"));
  // (أ) الجدولان  (ب) ما يقرأه السطح  (ج) لا عرض يلتفّ عليهما
  assert.match(st17, /x\.k\s*<>\s*all\s*\(OPS_COLS\)/i,
    "لا قائمة سماح على ما يقرأه سطح التشغيل من صفّ الطلب");
  assert.match(st17, /relkind in \('v','m'\)/i,
    "لا فحص يمنع إنشاء عرض يلتفّ على الجدولين ويعيد تركيب سطح ثالث");
  assert.match(st17, /foreach t in array MONEY_COLS loop/i,
    "لا فحص لمفردات المال في نصّ السطح التشغيليّ");
});

test("(١و) ★★ سطح التشغيل لا يقرأ عمودًا خارج قائمته ★★", () => {
  const def = stripComments(fnDef("csub_service_requests_list"));
  const refs = new Set([...def.matchAll(/\br\.([a-z_][a-z0-9_]*)/g)].map((m) => m[1]));
  assert.ok(refs.size > 10, "لم تُقرأ إشارات الأعمدة — الفحص فارغ");
  for (const k of refs) {
    assert.ok(OPS_COLS.includes(k),
      `سطح التشغيل يقرأ ${k} وهو خارج قائمة السماح التشغيلية`);
  }
  for (const m of MONEY_COLS) {
    assert.ok(!word(m).test(def), `سطح التشغيل يذكر مفردة المال ${m}`);
  }
  assert.match(def, /'finance_visible', false/, "سطح التشغيل لا يصرّح بأنّه بلا مال");
});

test("(١ز) ★ لا عمود رقميّ تشغيليّ غير عدّاد وحدات — مطابقة بالنوع لا بالاسم ★", () => {
  // مطابقة **بالنوع**: المال رقم. عمود رقميّ خارج UNIT_COLS يسقط أيًّا كان
  // اسمه — حتّى لو سُمّي تسميةً بريئة تمامًا. وبالمقابل لا يمكن لمفتاح uuid أن
  // يقع هنا مهما كان اسمه، وهذا بالضبط ما عجزت عنه قائمة المنع القديمة.
  const UNIT_COLS = sqlArray("UNIT_COLS");
  for (const tbl of ["csub_service_requests", "csub_service_request_attachments"]) {
    const block = SQL.match(new RegExp(
      "create table if not exists public\\." + tbl + "\\s*\\(([\\s\\S]*?)\\n\\);", "i"))[1];
    const numerics = [...stripComments(block).matchAll(
      /^\s{2}([a-z_][a-z0-9_]*)\s+(numeric|double precision|real|money)\b/gim)].map((m) => m[1]);
    for (const n of numerics) {
      assert.ok(UNIT_COLS.includes(n),
        `${tbl}.${n} عمود رقميّ ليس عدّاد وحدات — المال رقم، وهذا مال على سطح تشغيليّ`);
    }
  }
  // والقائمة ليست فارغة، وإلّا مرّ الفحص بلا هدف.
  assert.ok(UNIT_COLS.length >= 3, "قائمة عدّادات الوحدات فارغة — الفحص بلا هدف");
  const live = new Set(tableCols("csub_service_requests"));
  for (const u of UNIT_COLS) assert.ok(live.has(u), `UNIT_COLS تذكر ${u} غير الموجود`);
  // ولا مفردة مال تُدسّ في قائمة العدّادات.
  for (const u of UNIT_COLS) assert.ok(!MONEY_COLS.includes(u), `عدّاد يحمل اسم مال: ${u}`);
  // ★ والشبكة النوعية تُهزم بخطوة واحدة لولا هذا: مبلغٌ باسم بريء يُضاف إلى
  //   UNIT_COLS فيصير «عدّادًا» بإعلانٍ لا بحقيقة. فليكن الشرط **إثباتًا**:
  //   كلّ عدّاد يحمل مفردة عدٍّ صريحة. السلسلة الجزئية آمنة هنا وحدها لأنّ
  //   نطاقها الأسماء التي أعلنّاها، لا كلّ أعمدة الجدول.
  const UNIT_VOCAB = /(^|_)(units?|credits?|quantity|qty|count|hours?|days?|sessions?)(_|$)/;
  for (const u of UNIT_COLS) {
    assert.match(u, UNIT_VOCAB,
      `UNIT_COLS تعلن ${u} عدّاد وحدات وليس في اسمه مفردة عدّ — ` +
      `مبلغٌ أُعلن عدّادًا يعبر الفحص النوعيّ`);
  }
  assert.match(SQL, /from unnest\(UNIT_COLS\)/,
    "الترحيلة بلا حارس على ما يدخل قائمة العدّادات نفسها");
  // والترحيلة تحرس هذا بنفسها بعد التطبيق.
  assert.match(SQL, /c\.column_name <> all \(UNIT_COLS\)/,
    "الترحيلة بلا فحص نوعيّ على الأعمدة الرقمية");
});

// ════════════════════════════════════════════════════════════════════════════
// (٢) فصل العقود — المال لا يبلغ دورًا بلا مفتاحه
// ════════════════════════════════════════════════════════════════════════════

test("(٢أ) ★★ لا مبلغ يخرج من سطح موظّف بلا مفتاح الأسعار ★★", () => {
  for (const f of PRICED_SURFACES) {
    const d = fnDef(f);
    assert.match(d, /csub_can_view_pricing/, `${f} تلمس المال بلا بوّابة أسعار`);
    assert.match(d, /'pricing_visible'/, `${f} لا تصرّح بحال رؤية المال`);
    const rest = unmaskedRemainder(f);
    for (const c of PRICED_COLS) {
      assert.ok(!word(c).test(rest),
        `${f} تُخرج ${c} بلا تقنيع ولا إسقاط — المال يبلغ دورًا بلا csub.view_pricing`);
    }
  }
});

test("(٢ب) ★ التسريب الذي كان: plan_snapshot يحمل الخطّة بأسعارها ★", () => {
  // csub_plan_publish_version تحفظ to_jsonb(pl) كاملةً في definition، و
  // csub_activate_core تنسخها إلى csub_subscriptions.plan_snapshot. فإسقاط
  // الأعمدة الأربعة العليا وحده كان يترك السعر كلّه داخل اللقطة.
  const pub = fnDef("csub_plan_publish_version");
  assert.match(pub, /to_jsonb\(pl\)\s*-\s*'internal_notes'/,
    "لقطة الإصدار لم تعد تُبنى من صفّ الخطّة — أعد قراءة أثر الإسقاط");
  const det = fnDef("csub_subscription_detail");
  assert.match(det, /-\s*'plan_snapshot'/,
    "تفصيل الاشتراك لا يُسقط plan_snapshot — لقطة الخطّة تحمل السعر لمن لا يملك مفتاحه");
  assert.match(det, /-\s*'price_is_custom'/,
    "price_is_custom يخرج بلا مفتاح — يكشف أنّ لهذا العميل سعرًا خاصًّا");
});

test("(٢ج) ★ الوحدات تُسقَط بالاسم لا بـto_jsonb خام ★", () => {
  // to_jsonb يُخرج أيّ عمود يُضاف لاحقًا تلقائيًّا: قائمة سماح مفتوحة، أي لا قائمة.
  for (const f of ["csub_plan_detail", "csub_subscription_detail"]) {
    // بلا حذف التعليقات يفشل الفحص على التعليق الذي يشرح الثغرة بالاسم —
    // وهو بالضبط ما كان سيحدث في القاعدة، لأنّ pg_get_functiondef يُعيد التعليقات.
    const d = stripComments(fnDef(f));
    assert.ok(!/to_jsonb\(\s*(pu|u)\s*\)/i.test(d),
      `${f} تُعيد الوحدات بـto_jsonb خام — كلّ عمود سعر يُضاف لاحقًا يخرج بلا تقنيع`);
    assert.match(d, /'overage_unit_price_net',\s*case when v_price/,
      `${f} لا تُقنّع سعر وحدة التجاوز`);
    assert.match(d, /'overage_vat_rate',\s*\n?\s*case when v_price/,
      `${f} لا تُقنّع نسبة ضريبة التجاوز`);
  }
  // والفترات كذلك: إسقاط صريح لا صفّ خام.
  assert.ok(!/to_jsonb\(pr\)/i.test(fnDef("csub_subscription_detail")),
    "تفصيل الاشتراك يُعيد صفّ الفترة خامًا");
});

test("(٢د) ★★ التشغيل لا يُمنح الجدول الماليّ أصلًا — التقنيع في RPC ليس ضابطًا وحده ★★", () => {
  const rls = SQL.slice(SQL.indexOf("§5) RLS"), SQL.indexOf("§6)"));
  // الجداول الحاملة للمال: مفتاح الأسعار.
  const moneyBlock = rls.match(
    /foreach t in array array\['csub_plans','csub_plan_units','csub_plan_versions',[\s\S]*?end loop;/);
  assert.ok(moneyBlock, "كتلة سياسات الجداول المالية غير موجودة");
  assert.match(moneyBlock[0], /csub_can_view_pricing\(\)/,
    "سياسة قراءة الجداول المالية لا تشترط مفتاح الأسعار — csub.view سيقرأ price_net خامًا عبر PostgREST");
  assert.ok(!/using \(public\.csub_can_view\(\)\)/.test(moneyBlock[0]),
    "سياسة جدول ماليّ تقبل بوّابة التشغيل");
  // والمراجع غير المالية بالبوّابة العامّة — وإلّا صار الفصل ادّعاءً.
  const plainBlock = rls.match(
    /foreach t in array array\['csub_unit_types','csub_settings','csub_periods'\][\s\S]*?end loop;/);
  assert.ok(plainBlock && /csub_can_view\(\)/.test(plainBlock[0]),
    "المراجع غير المالية لم تعد مقروءة للتشغيل — الفحص أعلاه يصير فارغًا");
});

test("(٢هـ) ★ نطاق المبيعات: csub.manage لا يشتري رؤية السعر ★", () => {
  const manage = fnDef("csub_can_manage");
  assert.ok(!/csub_can_view_pricing|csub\.view_pricing/.test(manage),
    "إدارة الاشتراكات تمنح رؤية السعر ضمنًا — لا فصل بين «يدير» و«يرى الأرقام»");
  assert.match(fnDef("csub_can_view_pricing"), /'csub\.view_pricing'/,
    "مفتاح الأسعار لم يعد مفتاحًا مستقلًّا");
  // والمالك وحده فوق المفاتيح، وبوّابته لا تُشترى بمفتاح.
  assert.ok(!/csub_perm/.test(fnDef("csub_can_approve")),
    "بوّابة اعتماد المالك صارت تُشترى بمفتاح صلاحية");
});

// ════════════════════════════════════════════════════════════════════════════
// (٣) مِجَسّات السعر والربح
// ════════════════════════════════════════════════════════════════════════════

test("(٣أ) ★★ لا مبلغ في جواب أيّ دالّة — فلا رقمان يُطرحان ★★", () => {
  const probed = ["csub_reserve", "csub_release", "csub_consume", "csub_reverse", "csub_adjust",
    "csub_request_submit", "csub_request_transition", "csub_request_set_credits",
    "csub_service_requests_list", "csub_my_credits_page"];
  for (const f of probed) {
    const returns = jsonReturns(f);
    assert.ok(returns.length > 0, `${f} بلا جواب jsonb — الفحص فارغ`);
    for (const r of returns) {
      for (const c of PRICED_COLS) {
        assert.ok(!word(c).test(r),
          `${f} تُعيد ${c} للمنادي — مبلغ بجوار عدد وحدات يُشتقّ منه سعر الوحدة بطرح واحد`);
      }
    }
  }
});

test("(٣ب) ★ راية «يلزم اعتماد» ليست مِجَسّ عتبة ماليّة ★", () => {
  // العتبة كلّها بالوحدات: النقص = المطلوب − المتاح، ولا مبلغ يُقارَن بشيء.
  const t = stripComments(fnDef("csub_request_transition"));
  assert.match(t, /greatest\(0, r\.credits_required - v_avail\)/,
    "تقدير التجاوز لم يعد بالوحدات — قد يكون صار مقارنة بمبلغ");
  assert.ok(!/>\s*\d+(\.\d+)?\s*(then|and|or)/.test(t.replace(/greatest\(0,[^)]*\)/g, "")),
    "مقارنة برقم ثابت في آلة الحالات — عتبة يمكن بحثها ثنائيًّا");
  // وسبب الرفض عامّ: لا قيمة ولا عتبة في الرسالة.
  assert.match(t, /'overage_not_approved'/, "لا سبب عامّ لرفض التجاوز");
  const reasons = [...t.matchAll(/'reason',\s*'([a-z_]+)'/g)].map((m) => m[1]);
  for (const r of reasons) {
    assert.ok(!/\d/.test(r), `السبب ${r} يحمل رقمًا — عتبة تتسرّب في اسم السبب`);
  }
});

test("(٣ج) ★ تقدير التجاوز يُحسب على الخادم ولا يُقبل من المتصفّح ★", () => {
  const sub = stripComments(fnDef("csub_request_submit"));
  assert.match(sub, /v_avail := public\.csub_available_core\(/,
    "الرصيد المتاح لا يُقرأ من الخادم");
  assert.match(sub, /v_over\s*:=\s*greatest\(0, v_credits - v_avail\)/,
    "تقدير التجاوز لا يُحسب على الخادم");
  assert.ok(!/csub_num\(p, 'overage_estimate_units'\)/.test(sub),
    "التقدير يُقبل من حمولة المتصفّح — يمكن حقن رقم في الطلب");
  // وما يعود للعميل وحدات ورصيده هو، لا مال.
  assert.match(sub, /'overage_estimate_units', v_over, 'available_now', v_avail/,
    "جواب التقديم لا يعيد الوحدات والرصيد صراحةً");
});

test("(٣د) ★★ لا مِجَسّ وجود عبر الأخطاء — طلب عميل آخر = طلب غير موجود ★★", () => {
  const add = stripComments(fnDef("csub_request_attachment_add"));
  assert.match(add, /r\.client_id <> v_client/, "لا تحقّق من ملكية الطلب");
  // الجوابان يجب أن يتطابقا حرفًا بحرف، وإلّا صار الفرق بينهما عدّادًا.
  assert.ok(!/r\.client_id <> v_client then raise exception/.test(add),
    "طلب عميل آخر يرفع «not authorized» بينما الطلب المعدوم يعيد «request_not_found» — " +
    "الفرق بين الجوابين يعدّ به عميلٌ طلبات غيره بتخمين المعرّفات");
  const owner = add.match(/r\.client_id <> v_client then[\s\S]{0,200}?end if;/);
  assert.ok(owner && /'request_not_found'/.test(owner[0]),
    "جواب طلب عميل آخر لا يطابق جواب الطلب غير الموجود");
});

test("(٣هـ) ★ رسائل الأخطاء لا تحمل مبلغًا ★", () => {
  // رسائل الدفتر تحمل وحدات (المتبقّي/المطلوب) وهي مفردة تشغيلية مسموحة،
  // ولا تحمل مبلغًا ولا سعر وحدة.
  const raises = [...stripComments(SQL).matchAll(/raise exception '([^']*)'/g)].map((m) => m[1]);
  assert.ok(raises.length > 20, "لم تُقرأ رسائل الأخطاء — الفحص فارغ");
  for (const r of raises) {
    for (const c of ["price_net", "overage_unit_price_net", "overage_amount_net",
                     "vat_amount", "unit_price", "margin", "profit"]) {
      assert.ok(!r.includes(c), `رسالة خطأ تكشف ${c}: ${r.slice(0, 80)}`);
    }
  }
});

test("(٣و) ★ مفتاح التكرار لا يكشف قيد عميل آخر ★", () => {
  const idem = stripComments(fnDef("csub_idem_lookup"));
  const conflict = idem.match(/'idempotency_conflict'[\s\S]{0,300}?\);/);
  assert.ok(conflict, "لا فرع تعارض في مفتاح التكرار");
  assert.ok(!/'entry_id'/.test(conflict[0]),
    "تعارض المفتاح يكشف معرّف قيد عميل آخر");
  assert.ok(!/subscription_id|client_id/.test(conflict[0]),
    "تعارض المفتاح يكشف اشتراك/عميل الطرف الآخر");
});

// ════════════════════════════════════════════════════════════════════════════
// (٤) عزل العميل · ثبات الدفتر · التزامن · الالتفاف المباشر
// ════════════════════════════════════════════════════════════════════════════

test("(٤أ) ★ عزل العميل بنيويّ: لا سياسة جدولية تعترف بالعميل ★", () => {
  // السياسات تُنشأ هنا بصيغتين: نصًّا صريحًا، وعبر format() داخل حلقة. الفحص
  // يقرأ الاثنتين — لو قرأ الصريحة وحدها لمرّت السياسات الديناميكية بلا فحص.
  const code = stripComments(SQL);
  // نافذة بعد كلّ «create policy» حتّى نهاية الجملة (`;` أو نهاية سلسلة format).
  const policies = [];
  for (let i = code.toLowerCase().indexOf("create policy"); i !== -1;
       i = code.toLowerCase().indexOf("create policy", i + 1)) {
    const tail = code.slice(i, i + 420);
    const end = tail.search(/;|'\s*,|'\s*\)/);
    policies.push(end > 0 ? tail.slice(0, end) : tail);
  }
  assert.ok(policies.length >= 6,
    `لم تُقرأ سياسات RLS (${policies.length}) — الفحص فارغ`);
  for (const pol of policies) {
    assert.ok(!/my_client_id|csub_is_client|csub_client_owns/.test(pol),
      `سياسة تمنح العميل وصولًا جدوليًّا — RLS تصفّي صفوفًا لا أعمدة، ` +
      `فـinternal_notes وplan_snapshot سيصلانه عبر PostgREST: ${pol.slice(0, 120)}`);
    assert.match(pol, /for select/i, `سياسة كتابة مباشرة: ${pol.slice(0, 120)}`);
  }
  // والحارس نفسه في الترحيلة، فلا تُضاف سياسة عميل لاحقًا بلا اعتراض.
  assert.match(SQL, /سياسة تمنح العميل وصولًا جدوليًّا/,
    "الـSELF-TEST بلا حارس ضدّ سياسة عميل تُضاف لاحقًا");
});

test("(٤ب) ★★ الدفتر غير قابل للتعديل ولا الحذف ولا التفريغ ★★", () => {
  for (const t of ["t_csub_ledger_no_update", "t_csub_ledger_no_delete", "t_csub_ledger_no_truncate"]) {
    assert.ok(SQL.includes(t), `مُشغِّل المنع ${t} غير موجود`);
  }
  const imm = fnDef("csub_ledger_immutable");
  assert.match(imm, /0A000/, "دالّة المنع لا ترفع 0A000");
  assert.ok(!/return new/i.test(imm), "دالّة المنع تعيد NEW — أي تسمح");
  // ولا حذف ليّن يخفي صفًّا محاسبيًّا.
  const led = SQL.match(/create table if not exists public\.csub_ledger\s*\(([\s\S]*?)\n\);/i)[1];
  assert.ok(!/\bis_deleted\b/.test(led), "الدفتر يحمل حذفًا ليّنًا — سجلّ محاسبيّ تُخفى صفوفه");
});

test("(٤ج) ★ التزامن والتكرار: قفل صفّ + مفتاح فريد + مفتاح حتميّ ★", () => {
  for (const f of ["csub_reserve", "csub_release", "csub_consume", "csub_reverse", "csub_adjust"]) {
    const d = fnDef(f);
    assert.match(d, /for\s+update/i, `${f} تحسب بلا قفل صفّ — استهلاكان متزامنان يمرّان`);
    assert.match(d, /idempotency_key/, `${f} بلا مفتاح تكرار`);
  }
  assert.match(SQL, /create unique index if not exists uq_csub_ledger_idem/,
    "مفتاح التكرار غير فريد على مستوى القاعدة");
  assert.match(SQL, /create unique index if not exists uq_csub_ledger_reversal/,
    "قيد يمكن عكسه مرّتين");
  // والمفتاح في §17 حتميّ لا عشوائيّ: نقرتان تُنتجان المفتاح نفسه.
  const idem = fnDef("csub_sr_idem");
  assert.match(idem, /\bimmutable\b/i, "مفتاح التكرار الحتميّ ليس IMMUTABLE");
  assert.ok(!/gen_random_uuid|random\(\)|clock_timestamp|now\(\)/.test(idem),
    "مفتاح التكرار عشوائيّ — نقرتان تُنتجان قيدين");
  // ولا استهلاك مزدوج لاعتماد تجاوز واحد، ولا لطلب خدمة واحد.
  const cons = fnDef("csub_consume");
  assert.match(cons, /overage_approval_already_used/, "اعتماد التجاوز يُستهلك أكثر من مرّة");
  assert.match(cons, /service_request_already_consumed/, "طلب الخدمة يُستهلك مرّتين");
});

test("(٤د) ★★ الالتفاف المباشر: REST وRPC ★★", () => {
  // لا anon على شيء.
  assert.ok(!/grant\s+(execute|select)[^\n]*to anon/i.test(SQL), "منح صريح لـanon");
  assert.match(SQL, /revoke all on function %s from anon/i, "لا نزع صلاحية دوالّ عن anon");
  // الجداول: SELECT فقط لـauthenticated، وكلّ كتابة عبر RPC.
  const grants = [...SQL.matchAll(/grant\s+(\w+)\s+on table public\.%I to authenticated/gi)]
    .map((m) => m[1].toLowerCase());
  assert.ok(grants.length > 0 && grants.every((g) => g === "select"),
    `صلاحية جدولية غير SELECT لـauthenticated: ${grants.join(", ")}`);
  const nonSelect = [...SQL.matchAll(/for (insert|update|delete)\b[^\n]*to authenticated/gi)];
  assert.deepEqual(nonSelect.map((m) => m[0]), [], "سياسة كتابة لـauthenticated");
  // ونوى الرصيد والتفعيل لا تُمنح لأحد: نداء مباشر عليها يتخطّى بوّابة المالك.
  const internalBlock = SQL.slice(SQL.indexOf("الدوالّ الداخلية: لا تُمنح لأحد"));
  for (const f of ["csub_activate_core", "csub_renew_core", "csub_balance_core",
                   "csub_available_core", "csub_approval_submit_core"]) {
    assert.ok(internalBlock.includes(`public.${f}(`), `${f} غير مذكورة في كتلة النزع`);
  }
  // ودالّة مفتاح §17 الداخلية لا تُمنح كذلك.
  assert.match(SQL, /revoke all on function public\.csub_sr_idem\(uuid,text\) from authenticated/i,
    "مفتاح التكرار الداخليّ ممنوح لـauthenticated");
});

// ════════════════════════════════════════════════════════════════════════════
// (٥) عقود الملفّات
// ════════════════════════════════════════════════════════════════════════════

test("(٥أ) RUNME معاملة واحدة، بلا CONCURRENTLY، وتنتهي بإعادة تحميل المخطّط", () => {
  assert.match(SQL, /^begin;/im, "الترحيلة ليست معاملة واحدة");
  assert.match(SQL, /^commit;/im, "الترحيلة بلا COMMIT");
  assert.ok(!/concurrently/i.test(SQL),
    "CONCURRENTLY داخل معاملة — يمنع التراجع الكامل عند السقوط");
  assert.match(SQL, /notify pgrst, 'reload schema'/,
    "بلا إعادة تحميل مخطّط PostgREST ستُقرأ PGRST202 كاذبةً بعد ترحيل ناجح");
});

test("(٥أ٢) PREFLIGHT يقرأ أثر السقوط السابق قبل إعادة التشغيل", () => {
  // إعادة تشغيل حزمة سقطت، بلا قراءة سبب سقوطها، هي إعادة السقوط نفسه.
  assert.match(PREFLIGHT, /'reservation_entry_id' ilike '%vat%'/,
    "PREFLIGHT لا يُعيد إنتاج الإنذار الكاذب آليًّا قبل إعادة التشغيل");
  assert.match(PREFLIGHT, /commercial_subscriptions_AFTER_FAILURE_VERIFY\.sql/,
    "PREFLIGHT لا يحيل إلى ملفّ التشخيص بعد السقوط");
  assert.match(PREFLIGHT, /data_type in \('numeric', 'double precision', 'real', 'money'\)/,
    "PREFLIGHT بلا فحص نوعيّ على الأعمدة الرقمية — وهو الفحص الذي كان يجب أن يُكتب ابتداءً");
  // وهو ما زال قراءةً صِرفة.
  for (const verb of ["insert into", "update ", "delete from", "create ", "alter ", "drop ",
                      "grant ", "revoke ", "truncate", "begin", "commit"]) {
    assert.ok(!new RegExp("^\\s*" + verb, "im").test(PREFLIGHT.replace(/^--.*$/gm, "")),
      `PREFLIGHT يكتب: ${verb.trim()}`);
  }
});

test("(٥ب) POSTCHECK: نتيجة واحدة، قائمة سماح، ولا نداء محميّ", () => {
  assert.equal((POSTCHECK.replace(/^--.*$/gm, "").match(/;/g) ?? []).length, 1,
    "POSTCHECK أكثر من جملة — محرّر Supabase يعرض الأخيرة فقط");
  for (const c of ["srallow", "sraallow", "opsallow", "opsnumeric", "pricedleak",
                   "moneyrls", "clientiso", "dblcons", "ovgiso", "salescope",
                   "oracle", "applied4", "commsdry", "partial", "rawjsonb"]) {
    assert.ok(new RegExp(`\\b${c} as \\(`).test(POSTCHECK), `POSTCHECK بلا فحص ${c}`);
  }
  // قائمة سماح لا قائمة منع: لا ilike على '%vat%' على أسماء الأعمدة.
  assert.ok(!/column_name\s+ilike\s+'%vat%'/i.test(POSTCHECK),
    "POSTCHECK يمنع بالسلاسل الجزئية — سيطابق reservation_entry_id");
  assert.match(POSTCHECK, /column_name <> all \(array\[/,
    "POSTCHECK بلا قائمة سماح صريحة");
  // ولا CTE عودية (تجنّبًا لـ42P21 الذي كسر postcheck سابقًا على هذا الإنتاج).
  assert.ok(!/with\s+recursive/i.test(POSTCHECK), "CTE عودية في POSTCHECK — خطر 42P21");
  assert.ok(!/verdict.*'CHECK'.*catch/i.test(POSTCHECK), "حكم شامل يبتلع الفشل");
});

test("(٥ج) AFTER_FAILURE_VERIFY: قراءة فقط، نتيجة واحدة، بلا نداء محميّ", () => {
  const code = VERIFY.replace(/^--.*$/gm, "");
  for (const verb of ["insert into", "update ", "delete from", "create ", "alter ", "drop ",
                      "grant ", "revoke ", "truncate"]) {
    assert.ok(!new RegExp("^\\s*" + verb, "im").test(code),
      `ملفّ التحقّق يكتب: ${verb.trim()}`);
  }
  assert.match(VERIFY, /^with\b/im, "ملفّ التحقّق ليس استعلامًا واحدًا مبنيًّا على CTE");
  assert.equal((code.match(/select claim, verdict, detail from rows_out order by sort_key;/g) ?? []).length, 1,
    "ملفّ التحقّق لا ينتهي بنتيجة واحدة");
  // لا نداء لدالّة محميّة: في محرّر SQL تكون auth.uid() فارغة فترفع not authorized.
  for (const f of ["csub_my_credits_page", "csub_service_requests_list", "csub_request_submit",
                   "csub_plans_list", "csub_subscription_detail", "csub_balances",
                   "csub_statement", "csub_dashboard", "csub_reserve", "csub_consume"]) {
    assert.ok(!new RegExp(`public\\.${f}\\s*\\(`).test(code),
      `ملفّ التحقّق ينادي ${f} حيًّا — سترفع "not authorized" وتُقرأ خطأً كفشل ترحيل`);
  }
  // ويثبت ما طُلب منه إثباته.
  for (const claim of ["V1.no_partial_state", "V2.the_false_positive",
                       "V3.operational_tables_money_free", "V4.communications_hub_intact",
                       "V4.operations_center_intact", "V4.crm_sales_foundation_intact",
                       "V4.finance_profitability_intact", "V5.nothing_can_send",
                       "V6.frozen_platform_snapshot", "V7.anon_on_csub_tables"]) {
    assert.ok(VERIFY.includes(claim), `ملفّ التحقّق بلا ادّعاء ${claim}`);
  }
  // والبصمة: الإنذار الكاذب مُعاد إنتاجه آليًّا لا مذكورًا نصًّا.
  assert.match(VERIFY, /'reservation_entry_id' ilike '%vat%'/,
    "ملفّ التحقّق لا يُعيد إنتاج الإنذار الكاذب آليًّا");
  assert.match(VERIFY, /denylist_misses/,
    "ملفّ التحقّق لا يُظهر النصف الآخر من العطل — ما كانت قائمة المنع تُمرّره");
  assert.match(VERIFY, /query_to_xml/,
    "ملفّ التحقّق يستعلم جدولًا قد لا يوجد بلا حماية — سيرفع relation does not exist");
});

test("(٥د) SQL ساكن: لا مصيدة تبتلع فحصًا، ولا حارس يمرّ بغياب هدفه", () => {
  const st17 = SQL.slice(SQL.indexOf("do $st17$"));
  assert.ok(!/exception\s+when\s+others\s+then\s+null/i.test(st17),
    "§17 SELF-TEST يبتلع أخطاءه");
  // الحارس يجب أن يفشل إن غاب هدفه لا أن يمرّ.
  assert.match(st17, /if to_regprocedure\(t\) is null then\s*\n?\s*raise exception/,
    "غياب دالّة يمرّ بصمت في §17 SELF-TEST");
  const st16 = SQL.slice(SQL.indexOf("do $st$"), SQL.indexOf("do $st17$"));
  assert.match(st16, /if to_regprocedure\(f\) is null then\s*\n?\s*raise exception 'CSUB SELF-TEST: السطح المُسعَّر/,
    "غياب سطح مُسعَّر يجعل فحص التسريب فارغًا بدل أن يفشل");
  assert.ok(!/exception\s+when\s+others\s+then\s+null/i.test(st16),
    "§16 SELF-TEST يبتلع أخطاءه");
});

test("SAFE: ساكن فقط (لا قاعدة بيانات ولا شبكة)", () => {
  const self = read("tests/commercial_operations_financial_isolation.test.js");
  // الأسماء تُركَّب حرفيًّا كي لا يطابق الفحص نصَّ نفسه ويفشل بلا سبب.
  for (const bad of ['require("p' + 'g")', "fet" + "ch(", "ht" + "tps://", "create" + "Client"]) {
    assert.ok(!self.includes(bad), `الاختبار يتّصل بالخارج: ${bad}`);
  }
  assert.ok(!/\bawait\b/.test(self), "الاختبار غير متزامن — لا يقرأ إلّا ملفّات");
});
