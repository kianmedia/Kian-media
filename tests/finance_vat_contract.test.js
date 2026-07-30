// ════════════════════════════════════════════════════════════════════════════
// tests/finance_vat_contract.test.js — ★ الضريبة حقل مستقلّ، لا تُطوى في مجموع ★
//
// الطلب كان صريحًا: «VAT as its OWN field, never folded into a total». هذا
// الملفّ يفحص القاعدة في أربع طبقات لأنّ خرقها في أيّ واحدة يكفي لإخفاء الضريبة:
//   (١) المخطَّط  — حقل ضريبة + إجمالي **مولَّد** + لا عمود مجموع يطويها.
//   (٢) الكتابة   — الخادم يرفض أيّ إجماليّ مُرسَل.
//   (٣) العرض     — لا مكوّن واجهة يعرض الإجمالي وحده.
//   (٤) التصدير   — عمود vat_amount قائم بذاته في كلّ مجموعة.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const { SQL, TS, read, funcBody, tableDef, MONEY_TABLES } = require("./finance_helpers.js");

const ATOMS = read("components/portal/finance/FinAtoms.tsx");
const FORMS = read("components/portal/finance/FinForms.tsx");
const CENTER = read("components/portal/finance/FinanceCenter.tsx");
const MINE = read("components/portal/finance/FinMyRequests.tsx");

test("(١) كلّ جدول ماليّ يحمل ضريبة مستقلّة ونسبة محفوظة", () => {
  for (const t of MONEY_TABLES) {
    const def = tableDef(t);
    assert.match(def, /amount_net\s+numeric/, `${t} بلا مبلغ صافٍ`);
    assert.match(def, /vat_rate\s+numeric/, `${t} بلا نسبة ضريبة محفوظة`);
    assert.match(def, /vat_amount\s+numeric/, `${t} بلا حقل ضريبة مستقلّ`);
  }
});

test("(١ب) الإجمالي عمود مولَّد — لا يمكن كتابة إجماليّ يخفي الضريبة", () => {
  for (const t of MONEY_TABLES) {
    assert.match(tableDef(t),
      /amount_gross\s+numeric\([\d,]+\)\s+generated always as \(amount_net \+ vat_amount\) stored/,
      `${t}: الإجمالي ليس عمودًا مولَّدًا`);
  }
  for (const t of ["fin_purchase_request_items", "fin_purchase_order_items"]) {
    assert.match(tableDef(t), /line_gross\s+numeric[\s\S]{0,80}generated always as/,
      `${t}: إجمالي السطر ليس مولَّدًا`);
    assert.match(tableDef(t), /line_net\s+numeric[\s\S]{0,80}generated always as/,
      `${t}: صافي السطر ليس مولَّدًا`);
  }
});

test("(١ج) لا عمود مجموع يطوي الضريبة في أيّ جدول ماليّ", () => {
  for (const t of MONEY_TABLES) {
    const def = tableDef(t);
    assert.ok(!/\btotal\s+numeric|\bamount_total\b|\bgrand_total\b/.test(def),
      `${t} يحمل عمود مجموع يطوي الضريبة`);
  }
  assert.match(SQL, /يحمل عمود مجموع يطوي الضريبة/,
    "الـSELF-TEST بلا حارس يمنع إضافة عمود مجموع لاحقًا");
});

test("(٢) مُطبِّع المال يرفض أيّ إجماليّ مُرسَل من الواجهة", () => {
  const b = funcBody("finops_money");
  assert.match(b, /p \? 'amount_gross' or p \? 'total' or p \? 'amount_total'/,
    "المُطبِّع لا يفحص مفاتيح الإجماليّ الثلاثة");
  assert.match(b, /raise exception 'gross_not_writable'/, "المُطبِّع يقبل إجماليًّا جاهزًا");
  // وضريبة غير مُرسَلة تُحسب من النسبة، لا تُترك صفرًا صامتًا
  assert.match(b, /v_vat := round\(v_net \* v_rate \/ 100\.0, 2\)/,
    "الضريبة الغائبة لا تُحسب من النسبة");
  assert.match(b, /raise exception 'negative_amount'/, "مبلغ سالب يمرّ");
  assert.match(b, /raise exception 'invalid_vat_rate'/, "نسبة ضريبة خارج المدى تمرّ");
});

test("(٢ب) كلّ دالّة كتابة تحمل مالًا تمرّ بالمُطبِّع", () => {
  const moneyWriters = [
    "finops_budget_line_upsert", "finops_contract_upsert", "finops_revenue_upsert",
    "finops_retainer_upsert", "finops_receivable_upsert", "finops_collection_record",
    "finops_milestone_upsert", "finops_cost_upsert", "finops_expense_request_submit",
    "finops_purchase_request_submit", "finops_po_upsert",
  ];
  for (const f of moneyWriters) {
    assert.match(funcBody(f), /public\.finops_money\(p, 15\)/,
      `${f} تكتب مالًا بلا مُطبِّع — يمكن تمرير إجماليّ عبرها`);
  }
  // ولا واحدة منها تكتب في amount_gross مباشرةً
  for (const f of moneyWriters) {
    assert.ok(!/amount_gross\s*=|amount_gross,/.test(funcBody(f).split("returning")[0]
      .replace(/m->>'amount_gross'/g, "")),
      `${f} تحاول كتابة عمود الإجمالي المولَّد`);
  }
});

test("(٢ج) بنود الأسطر تحسب الضريبة ولا تشتقّها من إجماليّ", () => {
  for (const f of ["finops_purchase_item_upsert", "finops_po_item_upsert"]) {
    const b = funcBody(f);
    assert.match(b, /round\(v_qty \* v_price \* v_rate \/ 100\.0, 2\)/,
      `${f} لا تحسب ضريبة السطر من النسبة`);
    assert.match(b, /vat_rate < 0 or v_rate > 100|v_rate < 0 or v_rate > 100/,
      `${f} تقبل نسبة ضريبة خارج المدى`);
  }
  // ورأس الطلب يساوي مجموع بنوده — وإلّا اعتُمد رقم لا يطابق تفصيله
  assert.match(funcBody("finops_purchase_item_upsert"),
    /update public\.fin_purchase_requests[\s\S]{0,400}sum\(i\.vat_amount\)/,
    "رأس طلب الشراء لا يُجمَع من بنوده");
});

test("(٣) طبقة الواجهة: لا دالّة تُعيد الإجمالي وحده", () => {
  assert.match(TS, /export function finMoneyParts/, "لا مفكِّك يفصل الصافي والضريبة");
  assert.match(TS, /return \{ net, vat, gross, currency:/,
    "المفكِّك لا يعيد القيم الثلاث منفصلة");
  assert.match(TS, /interface FinMoneyParts \{ net: number; vat: number; gross: number;/,
    "نوع المال لا يفصل الضريبة عن الإجمالي");
  // الحمولة تُنظَّف من أيّ مفتاح إجماليّ قبل الإرسال
  assert.match(TS, /k === "amount_gross" \|\| k === "total" \|\| k === "amount_total"/,
    "منظّف الحمولة لا يحذف مفاتيح الإجماليّ");
});

test("(٣ب) خليّة المال تعرض الضريبة دائمًا — لا وضع مختصر يخفيها", () => {
  const cell = ATOMS.slice(ATOMS.indexOf("export function MoneyCell"),
    ATOMS.indexOf("export function MoneyBreakdown"));
  assert.match(cell, /ضريبة/, "خليّة المال لا تعرض الضريبة");
  assert.match(cell, /صافٍ/, "خليّة المال لا تعرض الصافي");
  assert.ok(!/compact|short|hideVat|showVat/.test(cell),
    "خليّة المال تقبل وضعًا يخفي الضريبة");
  // ولا مكوّن بديل يعرض amount_gross وحده في الجداول
  for (const [name, src] of [["FinanceCenter", CENTER], ["FinMyRequests", MINE]]) {
    assert.ok(!/finAmount\(\s*\w+\.amount_gross/.test(src),
      `${name} يعرض الإجمالي وحده في خليّة بدل MoneyCell`);
  }
});

test("(٣ج) النماذج لا تحوي حقل إجماليّ إطلاقًا", () => {
  assert.ok(!/key: "amount_gross"|key: "total"|key: "amount_total"/.test(FORMS),
    "مواصفة نموذج تحوي حقل إجماليّ");
  assert.match(FORMS, /key: "vat_amount"/, "لا حقل ضريبة صريح في النماذج");
  assert.match(FORMS, /key: "vat_rate"/, "لا حقل نسبة ضريبة في النماذج");
  // وتفصيل ما سيُحفَظ يُعرض قبل الحفظ
  assert.match(ATOMS, /export function MoneyBreakdown/, "لا تفصيل قبل الحفظ");
  assert.match(ATOMS, /الإجمالي يُحسب في القاعدة كعمود مولَّد/,
    "التفصيل لا يوضّح أنّ الإجمالي مشتقّ");
});

test("(٤) كلّ مجموعة تصدير تُبقي الضريبة عمودًا مستقلًّا", () => {
  const b = funcBody("finops_export");
  const colSets = [...b.matchAll(/v_cols := '(\[[^']*\])'::jsonb/g)].map((m) => JSON.parse(m[1]));
  assert.ok(colSets.length >= 7, `عدد مجموعات التصدير ${colSets.length} أقلّ من المتوقّع`);
  for (const cols of colSets) {
    assert.ok(cols.includes("vat_amount"),
      `مجموعة تصدير بلا عمود ضريبة مستقلّ: ${cols.join(",")}`);
    assert.ok(!cols.includes("total") && !cols.includes("amount_total"),
      `مجموعة تصدير تحمل عمود مجموع يطوي الضريبة: ${cols.join(",")}`);
  }
  assert.match(b, /الضريبة عمود مستقلّ في كلّ تصدير/, "التصدير لا يصرّح بالقاعدة");
});

test("(٤ب) بناء CSV لا يدمج الأعمدة ولا يحذف الضريبة", () => {
  assert.match(TS, /export function finExportCsv/, "لا بناء CSV");
  const csv = TS.slice(TS.indexOf("export function finExportCsv"));
  assert.match(csv, /cols\.map\(/, "البناء لا يتبع أعمدة الخادم");
  assert.ok(!/filter\(.*vat/i.test(csv), "البناء يرشّح عمود الضريبة");
});

test("الربح يُحسب على الصافي قبل الضريبة — الضريبة ليست ربحًا ولا تكلفة", () => {
  const b = funcBody("finops_profit_core");
  assert.match(b, /v_gross\s*:= round\(v_rev_net - v_direct_net, 2\)/,
    "مجمل الربح يُحسب على مبالغ شاملة الضريبة");
  assert.match(b, /'basis', 'net_of_vat'/, "الأساس غير مُصرَّح به");
  assert.match(b, /'is_estimate', true/, "صافي الربح لا يُعلن أنّه تقديريّ");
  assert.match(b, /لا يقوم مقام الدفاتر المحاسبية/, "التقدير يُقدَّم كرقم نهائيّ");
});
