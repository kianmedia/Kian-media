// ════════════════════════════════════════════════════════════════════════════
// tests/lead_finance_contract.test.js
//
// ★★ لماذا يوجد هذا الملفّ ★★
//
// سقطت docs/lead_scoring_routing_RUNME.sql على الإنتاج قبل COMMIT بـ:
//     ERROR P0001: LSR SELF-TEST: عقد المالية مكسور — كتابة أو نداء خارجيّ
//
// ولم يكن هناك خرق. الفحص كان:
//     v_def ~* '(insert\s+into\s+public\.fin_|…|zoho)'
// مطبَّقًا على pg_get_functiondef كاملًا. والبديل الوحيد الذي طابق هو الكلمة
// المجرّدة `zoho`، وطابقت داخل **جملة العقد** التي تقولها الدالّة عن نفسها:
//     «… ولا تنشئ فاتورة، ولا تنادي Zoho، ولا تدّعي تحصيلًا.»
// أي أنّ الدالّة سقطت لأنّها **أعلنت** أنّها لا تنادي Zoho.
//
// الدرس المكتوب هنا كاختبار: المطابقة النصّية على تعريف دالّة لا تفرّق بين
// جملة تنفيذية وتعليق ونصّ رسالة. والعلاج ليس إضعاف الفحص ولا تعديل الجملة
// كي تفلت منه — بل **التقسيم البنيويّ** ثمّ المطابقة على **شكل الجملة**.
//
// ودقّة حاسمة يجب ألّا تُنسى: lsr_finance_reference تقرأ عبر execute '…'، أي
// أنّ جملها الفعلية تسكن **داخل سلاسل نصّية**. فتجاهل السلاسل ليس علاجًا —
// إنّه يُعمي الكاشف عن `execute 'insert into public.fin_receivables …'`.
// الصواب: امسح الكود والسلاسل معًا، لكن على **شكل جملة/نداء** لا على كلمة.
// جملة بشرية لا تحوي «insert into public.fin_receivables» أبدًا، بينما تحوي
// كلمة «Zoho» بسهولة. ذلك الفارق هو كامل الإصلاح.
//
// ★ الأنماط هنا **تُستخرَج من ملفّ SQL نفسه** ★ لا تُنسخ. نسخة ثانية في
// JavaScript كانت ستنجح بعد أن ينحرف المصدر — وهو تمامًا ما جعل الاختبارات
// تقيس بالمسطرة الخطأ في حادثة {0,400}.
//
// كلّ الفحوص ساكنة: لا قاعدة بيانات، ولا شبكة، ولا بيانات إنتاج.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  SQL, funcBody, selfTest, stripComments, allFuncBodies,
} = require("./lead_helpers.js");

// ─── (أ) منفَذ التقسيم: منقول عن public.lsr_sql_partition حرفيًّا بالخوارزمية ──
//
// مرور واحد واعٍ بالاقتباس والتعليق:
//   code    = الهيكل التنفيذيّ (التعليقات محذوفة، السلاسل مُفرَّغة)
//   strings = محتوى السلاسل مجموعًا (حيث يسكن SQL الديناميكيّ)
// و'' داخل سلسلة اقتباس مهروب لا نهاية لها. ووسوم $tag$ تُمحى وما بداخلها
// **كود** — لأنّ جسم الدالّة نفسه مقتبس بالدولار.
function sqlPartition(src) {
  let code = "";
  let strings = "";
  let i = 0;
  let seg = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === "-" && src[i + 1] === "-") {
      code += src.slice(seg, i) + " ";
      const nl = src.indexOf("\n", i);
      i = nl === -1 ? n : nl + 1;
      seg = i;
    } else if (c === "/" && src[i + 1] === "*") {
      code += src.slice(seg, i) + " ";
      let d = 1;
      i += 2;
      while (i < n && d > 0) {
        if (src.startsWith("/*", i)) { d++; i += 2; }
        else if (src.startsWith("*/", i)) { d--; i += 2; }
        else i++;
      }
      seg = i;
    } else if (c === "'") {
      code += src.slice(seg, i) + " '' ";
      const s = i + 1;
      i++;
      for (;;) {
        if (i >= n) break;
        if (src[i] === "'") {
          if (src[i + 1] === "'") i += 2;
          else break;
        } else i++;
      }
      strings += src.slice(s, i).replace(/''/g, "'") + "\n";
      i++;
      seg = i;
    } else if (c === '"') {
      i++;
      for (;;) {
        if (i >= n) break;
        if (src[i] === '"') {
          if (src[i + 1] === '"') i += 2;
          else { i++; break; }
        } else i++;
      }
    } else if (c === "$") {
      const m = /^\$(?:[A-Za-z_][A-Za-z_0-9]{0,62})?\$/.exec(src.slice(i, i + 66));
      if (m) {
        code += src.slice(seg, i) + " ";
        i += m[0].length;
        seg = i;
      } else i++;
    } else i++;
  }
  code += src.slice(seg);
  return { code, strings };
}

// ─── (ب) استخراج أنماط الحكم من lsr_contract_scan في RUNME ──────────────────
//
// ARE في PostgreSQL تكتب حدّ الكلمة \m (بداية) و\M (نهاية)؛ JavaScript تكتب
// \b. الترجمة هنا **لغوية فقط** ولا تمسّ محتوى النمط.
const SCAN = funcBody("lsr_contract_scan");

function areToJs(p) {
  return p.replace(/\\m/g, "\\b").replace(/\\M/g, "\\b");
}

/**
 * كلّ أنماط مفتاح واحد، **مع نطاقها**: هل تُطابَق على الهيكل التنفيذيّ وحده
 * (v_code) أم عليه وعلى السلاسل معًا (v_both)؟
 *
 * النطاق ليس تفصيلًا: مسح السلاسل بحثًا عن **شكل جملة** آمن (جملة بشرية لا
 * تحوي «insert into public.fin_receivables»)، ومسحها بحثًا عن **عنوان أو
 * كلمة** ليس كذلك. خلط النطاقين هنا كان سيجعل المنفَذ يقيس غير ما يقيسه SQL.
 */
function patternsOf(label) {
  const keys = ["finance_write", "project_write", "external_call",
                "sensitive_attribute", "forbidden_gate", "forbidden_finance_read"];
  const start = SCAN.indexOf(`'${label}'`);
  assert.ok(start > 0, `المفتاح «${label}» غائب عن lsr_contract_scan`);
  let end = SCAN.length;
  for (const k of keys) {
    if (k === label) continue;
    const j = SCAN.indexOf(`'${k}'`, start + 1);
    if (j > start && j < end) end = j;
  }
  const chunk = SCAN.slice(start, end);
  const out = [...chunk.matchAll(/(v_both|v_code|v_str)\s*~\*?\s*'((?:[^'\n]|'')*)'/g)]
    .map((m) => ({ scope: m[1], re: new RegExp(areToJs(m[2].replace(/''/g, "'")), "i") }));
  assert.ok(out.length > 0, `لا نمط مستخرَج للمفتاح «${label}»`);
  return out;
}

const P = {
  financeWrite: patternsOf("finance_write"),
  projectWrite: patternsOf("project_write"),
  externalCall: patternsOf("external_call"),
  sensitive: patternsOf("sensitive_attribute"),
  forbiddenRead: patternsOf("forbidden_finance_read"),
};

/**
 * الحكم على مصدر دالّة، بالقواعد المستخرَجة من SQL.
 * الكتابة والنداء يُفحصان في الكود **والسلاسل** — لأنّ القراءات تمرّ بـexecute.
 */
function scan(src) {
  const { code, strings } = sqlPartition(src);
  const both = code + "\n" + strings;
  const at = (p) => p.some(({ scope, re }) => re.test(scope === "v_code" ? code : both));
  return {
    finance_write: at(P.financeWrite),
    project_write: at(P.projectWrite),
    external_call: at(P.externalCall),
    sensitive_attribute: at(P.sensitive),
    forbidden_finance_read: at(P.forbiddenRead),
  };
}

// ─── (ج) نماذج مصطنعة على هيئة مخرَج pg_get_functiondef ─────────────────────
const wrap = (name, body) =>
  `CREATE OR REPLACE FUNCTION public.${name}(p_lead uuid)\n` +
  ` RETURNS jsonb\n LANGUAGE plpgsql\nAS $function$\n${body}\n$function$\n`;

// ─── ١) كتابة مباشرة في fin_receivables داخل دالّة lsr_* → يجب أن يسقط ──────
test("(١) INSERT في fin_receivables داخل دالّة lsr_* — يسقط", () => {
  const f = wrap("lsr_bad_insert", `
begin
  insert into public.fin_receivables(code, amount_net) values ('X', 1);
  return '{}'::jsonb;
end`);
  assert.equal(scan(f).finance_write, true,
    "★ كتابة ماليّة مباشرة لم تُكتشف — الكاشف بلا قيمة");
});

test("(١-ب) الكتابة داخل execute '…' تُكتشف أيضًا — تجاهل السلاسل يُعمي الكاشف", () => {
  const f = wrap("lsr_bad_dynamic", `
begin
  execute 'insert into public.fin_receivables(code) values (''X'')';
  return '{}'::jsonb;
end`);
  assert.equal(scan(f).finance_write, true,
    "★ الكتابة الديناميكية أفلتت — وهي المسار الفعليّ لهذه الوحدة");
});

// ─── ٢) UPDATE لجدول fin_* → يجب أن يسقط ───────────────────────────────────
test("(٢) UPDATE لجدول ماليّ — يسقط", () => {
  const f = wrap("lsr_bad_update", `
begin
  update public.fin_receivables set status = 'paid' where id = p_lead;
  return '{}'::jsonb;
end`);
  assert.equal(scan(f).finance_write, true, "★ تحديث ماليّ لم يُكتشف");
});

// ─── ٣) نداء pg_net → يجب أن يسقط ──────────────────────────────────────────
test("(٣) نداء pg_net — يسقط", () => {
  // نموذج **يعزل** حارس pg_net وحده: لا فعل HTTP معروف بعد http_، ولا عنوان،
  // ولا net.http — فلو سقط ذلك الحارس ما التقطه غيره. حارسٌ يحميه حارسٌ آخر
  // يبدو سليمًا وهو ميّت، وهذه أخطر حالات الفحص.
  const f = wrap("lsr_bad_net", `
begin
  perform pg_net.http_collect_response(p_lead);
  return '{}'::jsonb;
end`);
  assert.equal(scan(f).external_call, true, "★ نداء pg_net لم يُكتشف");
});

test("(٣-ب) نداء HTTP صريح — يسقط", () => {
  const f = wrap("lsr_bad_http", `
begin
  perform pg_net.http_post('https://example.test', '{}'::jsonb);
  return '{}'::jsonb;
end`);
  assert.equal(scan(f).external_call, true, "★ نداء HTTP لم يُكتشف");
});

// ─── ٤) نداء Zoho بشكل نداء → يجب أن يسقط ──────────────────────────────────
test("(٤) نداء Zoho بشكل نداء (zoho_sync(…)) — يسقط", () => {
  const f = wrap("lsr_bad_zoho", `
begin
  perform public.zoho_sync(p_lead);
  return '{}'::jsonb;
end`);
  assert.equal(scan(f).external_call, true,
    "★ نداء Zoho الحقيقيّ لم يُكتشف — الكاشف تُرك ضعيفًا بحجّة إصلاح الإنذار الكاذب");
});

// ─── ٥) القراءة المحدودة المسموحة من fin_receivables → يجب أن تمرّ ─────────
test("(٥) القراءة المحدودة المسموحة من fin_receivables — تمرّ", () => {
  const f = wrap("lsr_ok_read", `
begin
  execute 'select jsonb_agg(jsonb_build_object(''receivable_reference'', r.code,
             ''status'', r.status, ''due_date'', r.due_date))
             from public.fin_receivables r where r.contract_reference = $1'
    into v_out using p_lead;
  return v_out;
end`);
  const s = scan(f);
  assert.equal(s.finance_write, false, "★ إنذار كاذب: قراءة مسموحة عُدّت كتابة");
  assert.equal(s.external_call, false, "★ إنذار كاذب: قراءة مسموحة عُدّت نداءً خارجيًّا");
});

// ─── ٦) كلمة «update» داخل تعليق → يجب أن تمرّ ─────────────────────────────
test("(٦) كلمة update داخل تعليق — تمرّ بلا إنذار كاذب", () => {
  const f = wrap("lsr_ok_comment", `
begin
  -- هذه الوحدة لا تفعل update public.fin_receivables إطلاقًا.
  /* ولا insert into public.fin_receivables ولو طُلب ذلك. */
  return '{}'::jsonb;
end`);
  assert.equal(scan(f).finance_write, false,
    "★ تعليق يشرح المنع أُدين كخرق — هذا هو العيب الذي أسقط الترحيلة، بثوب آخر");

  // ولا يكفي أن ينجح المنفَذ: التقسيم في SQL هو ما سيعمل على الإنتاج، فنتحقّق
  // أنّه يحمل فروع الحذف الأربعة فعلًا. بدونها يمرّ هذا الاختبار ويسقط الإنتاج.
  const part = funcBody("lsr_sql_partition");
  assert.match(part, /c = '-' and substr\(p_src, i \+ 1, 1\) = '-'/,
    "★ تقسيم SQL لا يحذف تعليق السطر — التعليق سيُقرأ كجملة تنفيذية على الإنتاج");
  assert.match(part, /c = '\/' and substr\(p_src, i \+ 1, 1\) = '\*'/,
    "★ تقسيم SQL لا يحذف التعليق الكتليّ");
  assert.match(part, /''''''/, "★ تقسيم SQL لا يعالج '' كاقتباس مهروب داخل سلسلة");
  assert.match(part, /\[A-Za-z_\]\[A-Za-z_0-9\]\{0,62\}/,
    "★ تقسيم SQL لا يتعرّف على وسم اقتباس الدولار — وجسم الدالّة نفسه مقتبس به");
});

// ─── ٧) «Zoho»/«fetch» داخل نصّ رسالة → يجب أن تمرّ (العيب الذي شُحن) ──────
test("(٧) ★ الخلل الذي شُحن فعلًا ★ كلمة Zoho داخل نصّ رسالة — تمرّ", () => {
  const f = wrap("lsr_ok_contract_sentence", `
begin
  return jsonb_build_object('contract_note',
    'عقد بيانات لا كتابة متبادلة: هذه الوحدة تقرأ مراجع المالية ولا تكتب فيها، ولا تنشئ فاتورة، ولا تنادي Zoho، ولا تدّعي تحصيلًا.');
end`);
  assert.equal(scan(f).external_call, false,
    "★ الانحدار عاد ★ الدالّة تسقط لأنّها أعلنت أنّها لا تنادي Zoho — هذا نصّ الحادثة حرفيًّا");
});

test("(٧-ب) كلمة fetch داخل نصّ رسالة — تمرّ", () => {
  const f = wrap("lsr_ok_fetch_word", `
begin
  return jsonb_build_object('message', 'لا fetch ولا استدعاء خارجيّ من هذه الوحدة.');
end`);
  assert.equal(scan(f).external_call, false, "★ إنذار كاذب على كلمة في رسالة");
});

test("(٧-ج) ★ الجملة التعاقدية الحقيقية في RUNME لا تُدين نفسها ★", () => {
  // ليس نموذجًا مصطنعًا: نصّ الدالّة كما هو في الحزمة.
  const real = funcBody("lsr_finance_reference");
  const s = scan(real);
  assert.equal(s.finance_write, false, "lsr_finance_reference تُدان بكتابة ماليّة");
  assert.equal(s.external_call, false,
    "lsr_finance_reference تُدان بنداء خارجيّ — وهو بالضبط ما أسقط الترحيلة");
  assert.equal(s.project_write, false, "lsr_finance_reference تُدان بكتابة في المشاريع");
  // ومع ذلك الجملة التعاقدية باقية بلا تعديل: العلاج كان في الكاشف لا في النصّ.
  assert.ok(real.includes("ولا تنادي Zoho"),
    "★ الجملة التعاقدية حُذفت للتملّص من الفحص — هذا إخفاء لا إصلاح");
});

// ─── ٨) كتابة غير مباشرة عبر دالّة lsr_* أخرى → يجب أن تسقط (رسم النداءات) ─
test("(٨) كتابة غير مباشرة عبر دالّة أخرى — يسقط برسم النداءات", () => {
  const universe = {
    lsr_entry: wrap("lsr_entry", `
begin
  perform public.lsr_middle(p_lead);
  return '{}'::jsonb;
end`),
    lsr_middle: wrap("lsr_middle", `
begin
  perform public.lsr_writer(p_lead);
  return '{}'::jsonb;
end`),
    lsr_writer: wrap("lsr_writer", `
begin
  update public.fin_receivables set status = 'paid';
  return '{}'::jsonb;
end`),
  };
  const names = Object.keys(universe);

  // مشي المسار كما يفعل الفحص الذاتيّ: ثلاث قفزات، مع مجموعة مزارة.
  const seen = new Set();
  let frontier = ["lsr_entry"];
  let violation = null;
  for (let hop = 1; hop <= 3 && frontier.length; hop++) {
    const next = [];
    for (const t of frontier) {
      if (seen.has(t)) continue;
      seen.add(t);
      const def = universe[t];
      if (!def) continue;
      if (scan(def).finance_write) { violation = t; break; }
      const { code, strings } = sqlPartition(def);
      const body = code + "\n" + strings;
      for (const f of names) {
        if (f === t || seen.has(f)) continue;
        if (body.includes(f) && new RegExp(`\\b${f}\\s*\\(`).test(body)) next.push(f);
      }
    }
    if (violation) break;
    frontier = next;
  }
  assert.equal(violation, "lsr_writer",
    "★ الالتفاف مرّ ★ فحص مباشر فقط هو ما سمح بالكتابة غير المباشرة في حزمة سابقة");

  // ولا يكفي أن ينجح المنفَذ هنا: الفحص الذاتيّ في RUNME يجب أن يحمل المشي فعلًا.
  const st = selfTest();
  assert.match(st, /رسم النداءات/, "الفحص الذاتيّ بلا رسم نداءات");
  assert.match(st, /غير مباشرة/, "الفحص الذاتيّ لا يُسقط الخرق غير المباشر");
  assert.match(st, /for\s+v_hop\s+in\s+1\.\.3\s+loop/,
    "الفحص الذاتيّ لا يمشي أكثر من قفزة — وهو فحص مباشر بثوب رسم نداءات");
});

// ─── (د) عقد المالية المسموح: قراءات محدَّدة لا أكثر ────────────────────────

test("★ الكاشف موجود في RUNME ويُستعمل فعلًا في الفحص الذاتيّ ★", () => {
  assert.match(SQL, /create\s+or\s+replace\s+function\s+public\.lsr_sql_partition/i,
    "منفَذ التقسيم غائب عن RUNME");
  assert.match(SQL, /create\s+or\s+replace\s+function\s+public\.lsr_contract_scan/i,
    "كاشف العقد غائب عن RUNME");
  const st = selfTest();
  assert.match(st, /lsr_contract_scan/, "الفحص الذاتيّ لا يستعمل الكاشف البنيويّ");
  // ★ الانحدار الحرفيّ ★ الكلمة المجرّدة `zoho` بديلًا داخل نمط = الحادثة نفسها.
  //   نحذف التعليقات لا السلاسل: التعليق الذي **يوثّق** النمط الساقط ليس النمط،
  //   والنمط الحقيقيّ يسكن في سلسلة — فحذف السلاسل هنا كان سيجعل الفحص أجوف.
  assert.doesNotMatch(stripComments(st), /\|zoho\)/i,
    "★ عاد النمط الذي أسقط الإنتاج ★ الكلمة المجرّدة zoho بديلًا داخل نمط");
  assert.doesNotMatch(SCAN, /\|zoho\)/i,
    "★ الكاشف نفسه يطابق الكلمة المجرّدة zoho ★");
});

test("عقد المالية: القراءات المسموحة فقط، ولا كتابة في أيّ جدول ماليّ", () => {
  // كلّ إشارة إلى جدول ماليّ في الحزمة كلّها يجب أن تكون قراءة.
  const { code, strings } = sqlPartition(SQL);
  const both = code + "\n" + strings;
  for (const verb of ["insert\\s+into", "update", "delete\\s+from", "truncate"]) {
    const rx = new RegExp(`${verb}\\s+(table\\s+)?(only\\s+)?(public\\.)?(fin_|finops_)`, "i");
    assert.doesNotMatch(both, rx, `★ كتابة ماليّة في الحزمة (${verb}) ★`);
  }
  // ولا قراءة لتكلفة أو هامش أو ربح أو أرضية سعر أو سعر مورّد.
  for (const col of ["fin_costs", "base_cost", "cost_rate", "margin_pct",
                     "gross_profit", "floor_price", "supplier_rate"]) {
    assert.doesNotMatch(both, new RegExp(`\\b[a-z]\\.${col}\\b`, "i"),
      `★ قراءة ماليّة ممنوعة (${col}) ★`);
  }
});

// ─── (هـ) ★★ قراءة ماليّة ممنوعة: الشكل يميّز الارتكاب من الإعلان ★★ ───────
//
// الحادثة الثانية بنصّها: الصيغة القديمة طابقت **الاسم المجرّد** floor_price
// و supplier_rate، فأسقطتها مصفوفة excluded_by_design في lsr_dashboard_client —
// وهي المصفوفة التي تُعلن أنّ هذه الحقول **غير** معروضة. الدالّة سقطت لأنّها
// أعلنت براءتها، تمامًا كما سقطت قبلها بجملة «ولا تنادي Zoho».

test("(٩) قراءة حقيقية s.floor_price — تسقط", () => {
  const f = wrap("lsr_bad_floor", `
begin
  execute 'select s.floor_price from public.csub_subscriptions s' into v_x;
  return '{}'::jsonb;
end`);
  assert.equal(scan(f).forbidden_finance_read, true,
    "★ قراءة أرضية السعر أفلتت — الحارس أُضعف بحجّة إصلاح الإنذار الكاذب");
});

test("(٩-ب) قراءة حقيقية s.supplier_rate — تسقط", () => {
  const f = wrap("lsr_bad_supplier", `
begin
  execute 'select s.supplier_rate from public.csub_subscriptions s' into v_x;
  return '{}'::jsonb;
end`);
  assert.equal(scan(f).forbidden_finance_read, true, "★ سعر المورّد أفلت");
});

test("(٩-ج) إشارة إلى جدول التكلفة في جملة — تسقط", () => {
  for (const stmt of ["select 1 from public.fin_costs c",
                      "select 1 from public.sq_quote_internal q",
                      "select c.x from fin_costs c"]) {
    const f = wrap("lsr_bad_costs_table", `
begin
  execute '${stmt}' into v_x;
  return '{}'::jsonb;
end`);
    assert.equal(scan(f).forbidden_finance_read, true,
      `★ إشارة جدول تكلفة أفلتت: ${stmt}`);
  }
});

test("(٩-د) ★ العطب الذي شُحن ★ الأسماء داخل مصفوفة «المستبعَد بالتصميم» — تمرّ", () => {
  const f = wrap("lsr_ok_excluded_array", `
begin
  return jsonb_build_object('excluded_by_design',
    jsonb_build_array('internal_notes','internal_metadata','decision_reason',
                      'cost','margin','floor_price','profit','supplier_rate'));
end`);
  assert.equal(scan(f).forbidden_finance_read, false,
    "★ الانحدار عاد ★ الدالّة تسقط لأنّ قائمة المستبعَد تسمّي ما استبعدته — " +
    "هذا نصّ الحادثة الثانية حرفيًّا");
});

test("(٩-هـ) كلمة profit داخل تعليق، وجملة «لا تعرض profit» داخل سلسلة — تمرّان", () => {
  const f = wrap("lsr_ok_prose", `
begin
  -- هذه اللوحة لا تحمل gross_profit ولا margin_pct ولا floor_price إطلاقًا.
  return jsonb_build_object('note', 'لا تعرض profit ولا هامشًا ولا أرضية سعر.');
end`);
  assert.equal(scan(f).forbidden_finance_read, false,
    "★ نثرٌ يشرح المنع أُدين كخرق — الحارس سيُعطَّل بعد أوّل إنذار كاذب");
});

test("(٩-و) ★ لوحة العميل الحقيقية في RUNME لا تُدين نفسها ★", () => {
  const real = funcBody("lsr_dashboard_client");
  assert.equal(scan(real).forbidden_finance_read, false,
    "★ الترحيلة ستسقط ★ لوحة العميل تُدان بقراءة ماليّة وهي لا تقرأ عمودًا واحدًا منها");
  // والقائمة المُعلَنة باقية بلا تعديل: العلاج في الكاشف لا في حذف الإعلان.
  assert.ok(real.includes("'floor_price'") && real.includes("'supplier_rate'"),
    "★ حُذف الإعلان للتملّص من الفحص — هذا إخفاء لا إصلاح");
  // ولا دالّة أخرى في الحزمة تسقط على هذا الحارس.
  for (const name of ["lsr_dashboard_owner", "lsr_dashboard_sales",
                      "lsr_dashboard_operations", "lsr_finance_reference"]) {
    assert.equal(scan(funcBody(name)).forbidden_finance_read, false,
      `★ إنذار كاذب على ${name} — الترحيلة ستسقط بلا خرق`);
  }
});

test("(٩-ز) لا قاعدة تمسح السلاسل بالاسم المجرّد — تدقيق كلّ قواعد الكاشف", () => {
  // القاعدة الحاكمة: ما يُمسح في v_both يجب أن يكون **شكل** جملة أو نداء أو
  // إشارة مؤهَّلة. الاسم المجرّد مسموح في v_code وحده، لأنّ v_code بلا تعليقات
  // وسلاسله مُفرَّغة — فالاسم فيه استعمالٌ لا ذكر.
  const SHAPED =
    /(insert|update|delete|truncate|from|join|into|table|https?|~|\\s\*\\\(|\\s\+|\[\(\.\]|\\\.|\{0,\d+\}\\\.)/;
  for (const key of ["finance_write", "project_write", "external_call",
                     "forbidden_finance_read"]) {
    for (const { scope, re } of patternsOf(key)) {
      if (scope === "v_code") continue;
      assert.ok(SHAPED.test(re.source),
        `★ ${key}: نمطٌ يمسح السلاسل بالاسم المجرّد (${re.source}) — ` +
        `نثرٌ أو وسمٌ سيُدان كخرق، وهذا هو العطب الذي أسقط الإنتاج مرّتين`);
    }
  }
});

test("(١٠) تسريب الهامش **بالوكالة**: نداء غير مباشر لدالّة تقرأ margin — يسقط", () => {
  const universe = {
    lsr_client_entry: wrap("lsr_client_entry", `
begin
  return public.lsr_helper(p_lead);
end`),
    lsr_helper: wrap("lsr_helper", `
begin
  return public.lsr_margin_reader(p_lead);
end`),
    lsr_margin_reader: wrap("lsr_margin_reader", `
begin
  execute 'select s.margin_pct from public.csub_subscriptions s' into v_x;
  return v_x;
end`),
  };
  const names = Object.keys(universe);
  const seen = new Set();
  let frontier = ["lsr_client_entry"];
  let violation = null;
  for (let hop = 1; hop <= 3 && frontier.length; hop++) {
    const next = [];
    for (const t of frontier) {
      if (seen.has(t)) continue;
      seen.add(t);
      const def = universe[t];
      if (!def) continue;
      if (scan(def).forbidden_finance_read) { violation = t; break; }
      const { code, strings } = sqlPartition(def);
      const body = code + "\n" + strings;
      for (const f of names) {
        if (f === t || seen.has(f)) continue;
        if (body.includes(f) && new RegExp(`\\b${f}\\s*\\(`).test(body)) next.push(f);
      }
    }
    if (violation) break;
    frontier = next;
  }
  assert.equal(violation, "lsr_margin_reader",
    "★ التسريب بالوكالة مرّ ★ لوحة نظيفة تنادي دالّة تقرأ الهامش تُسرّبه كاملًا");

  // والفحص الذاتيّ في RUNME يجب أن يمشي هذا المسار من لوحة العميل فعلًا.
  const st = selfTest();
  assert.match(st, /v_frontier := array\['lsr_dashboard_client'\]/,
    "الفحص الذاتيّ لا يمشي رسم النداءات من لوحة العميل");
  assert.match(st, /تسريب بالوكالة/,
    "الفحص الذاتيّ لا يُسقط قراءة ماليّة غير مباشرة من لوحة العميل");
});

test("(١٠-ب) رسم النداءات الحقيقيّ من لوحة العميل نظيف", () => {
  const bodies = allFuncBodies();
  const seen = new Set();
  let frontier = ["lsr_dashboard_client"];
  for (let hop = 1; hop <= 3 && frontier.length; hop++) {
    const next = [];
    for (const t of frontier) {
      if (seen.has(t)) continue;
      seen.add(t);
      const def = bodies.get(t);
      if (!def) continue;
      assert.equal(scan(def).forbidden_finance_read, false,
        `★ لوحة العميل تبلغ ${def && t} التي تقرأ تكلفة أو هامشًا — تسريب بالوكالة`);
      const { code, strings } = sqlPartition(def);
      const body = code + "\n" + strings;
      for (const f of bodies.keys()) {
        if (f === t || seen.has(f)) continue;
        if (body.includes(f) && new RegExp(`\\b${f}\\s*\\(`).test(body)) next.push(f);
      }
    }
    frontier = next;
  }
  assert.ok(seen.size >= 1, "رسم النداءات لم يزر شيئًا — الفحص أجوف");
});

test("SAFE: ساكن فقط (لا قاعدة بيانات ولا شبكة)", () => {
  const self = require("node:fs").readFileSync(__filename, "utf8");
  // الرموز مُجزّأة كي لا تلتقط القائمةُ نفسَها — إنذار كاذب من صنع الحارس.
  for (const bad of ["pg" + ".connect", "create" + "Client", "node:" + "http",
                     "node:" + "net"]) {
    assert.ok(!self.includes(bad), `الاختبار يخرج عن السكون: ${bad}`);
  }
  assert.ok(!/\bawait\s+fetch\s*\(/.test(self), "الاختبار يخرج إلى الشبكة");
});
