// ════════════════════════════════════════════════════════════════════════════
// tests/wave5_financial_reporting.test.js — V2-5.5-B/D/E/F
//
// ⛔ لا شبكة · لا Zoho · لا قاعدة · لا بيانات عملاء حقيقية.
//    كل الأرقام أدناه **مُختلَقة للاختبار** ولا تُعرض قطّ كنتيجة.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const ROOT = path.resolve(__dirname, "..");
const SRC = "lib/finance/financialReporting.ts";
const POL = "lib/finance/financialSourcePolicy.ts";

/** يترجم الوحدتين معًا ويحلّ الاستيراد بينهما — ⛔ بلا شبكة ولا بناء. */
function load() {
  const compile = (rel) => ts.transpileModule(fs.readFileSync(path.join(ROOT, rel), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const polMod = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function("exports", "module", "require", compile(POL))(polMod.exports, polMod, () => ({}));
  const repMod = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function("exports", "module", "require", compile(SRC))(
    repMod.exports, repMod,
    (id) => (id.includes("financialSourcePolicy") ? polMod.exports : {}),
  );
  return { P: polMod.exports, R: repMod.exports };
}
const { P, R } = load();
const POLICY = P.OWNER_APPROVED_POLICY;
const NOW = "2026-08-05T09:00:00Z";

const rev = (o = {}) => ({ source: "fin_revenue", amountNet: 1000, vatAmount: 150,
  amountGross: 1150, currency: "SAR", asOf: null, ...o });
const cost = (o = {}) => ({ source: "fin_costs", amountNet: 400, vatAmount: 60,
  amountGross: 460, currency: "SAR", asOf: null, ...o });
const inv = (o = {}) => ({ id: "i1", invoice_number: "INV-1", zoho_invoice_id: "z1",
  project_id: "p1", client_id: "c1", status: "sent", currency: "SAR",
  total: 1000, due_date: "2026-07-01", is_deleted: false, ...o });

// ─── ٠ · السياسة المعتمَدة مسجَّلة، ⛔ وليست افتراضًا ──────────────────────
test("السياسة المعتمَدة مسجَّلة بقيمها السبع", () => {
  assert.equal(POLICY.revenueSource, "fin_revenue");
  assert.equal(POLICY.costSource, "fin_costs");
  assert.equal(POLICY.invoiceSource, "zoho");
  assert.equal(POLICY.vatSource, "stored");
  assert.equal(POLICY.currencyPolicy, "reject_mixed");
  assert.equal(POLICY.marginPolicy, "net_of_vat");
  assert.equal(POLICY.zohoPrecedence, "flag_conflict");
  assert.ok(POLICY.approvedBy && POLICY.approvedAt);
});

test("🔴 السياسة المعتمَدة **ليست** افتراضًا — الغياب ما يزال يفشل", () => {
  const m = R.buildMarginCard({ revenueRows: [rev()], costRows: [cost()] }, undefined);
  assert.equal(m.amount.available, false, "أُنتج رقم بلا سياسة ممرَّرة");
  assert.equal(m.amount.reason, "source_unselected");
  const c = R.buildCashFlowCalendar([inv()], { policy: null, nowIso: NOW });
  assert.equal(c.totals.overdue.available, false);
  // ولا تقرأ أيّ دالّة الثابت تلقائيًّا.
  const src = fs.readFileSync(path.join(ROOT, SRC), "utf8");
  assert.ok(!/OWNER_APPROVED_POLICY/.test(src),
    "وحدة التقارير تقرأ السياسة المعتمَدة تلقائيًّا — فصارت افتراضًا");
});

// ─── ١ · V2-5.5-B · الهامش ─────────────────────────────────────────────────
test("الهامش يُحسب صافيًا من الضريبة", () => {
  const m = R.buildMarginCard({ revenueRows: [rev()], costRows: [cost()] }, POLICY);
  assert.equal(m.amount.available, true);
  assert.equal(m.amount.value, 600);          // 1000 − 400
  assert.equal(m.percentage.value, 60);
  assert.equal(m.amount.currency, "SAR");
});

test("🔴 لا هامش دون إيراد", () => {
  const m = R.buildMarginCard({ revenueRows: [], costRows: [cost()] }, POLICY);
  assert.equal(m.amount.available, false);
  assert.equal(m.amount.reason, "missing_data");
});

test("🔴 لا هامش بعملات مختلطة", () => {
  const m = R.buildMarginCard(
    { revenueRows: [rev({ currency: "USD" })], costRows: [cost({ currency: "SAR" })] }, POLICY);
  assert.equal(m.amount.available, false);
  assert.equal(m.amount.reason, "currency_mismatch");
});

test("🔴 لا هامش عند تعارض الضريبة داخل الصفّ", () => {
  const m = R.buildMarginCard(
    { revenueRows: [rev({ amountGross: 9999 })], costRows: [cost()] }, POLICY);
  assert.equal(m.amount.available, false);
  assert.equal(m.revenue.reason, "conflicting_values");
});

test("🔴 لا ازدواج بين fin_costs وproject_expenses", () => {
  const m = R.buildMarginCard(
    { revenueRows: [rev()], costRows: [cost(), cost({ source: "project_expenses" })] }, POLICY);
  assert.equal(m.amount.available, false, "جُمع النطاقان فتضاعفت التكلفة");
  assert.equal(m.amount.reason, "duplicate_cost_candidate");
});

test("🔴 project_expenses وحده مرفوض — السياسة تعتمد fin_costs", () => {
  const m = R.buildMarginCard(
    { revenueRows: [rev()], costRows: [cost({ source: "project_expenses" })] }, POLICY);
  assert.equal(m.amount.available, false);
  assert.equal(m.amount.reason, "source_unverified");
});

// ─── ٢ · V2-5.5-D · تقويم التدفّق ──────────────────────────────────────────
test("الدلاء الأربعة تُميَّز", () => {
  const c = R.buildCashFlowCalendar([
    inv({ id: "a", status: "draft", due_date: "2026-09-01" }),
    inv({ id: "b", status: "sent", due_date: "2026-09-01" }),
    inv({ id: "c", status: "sent", due_date: "2026-07-01" }),
    inv({ id: "d", status: "paid", due_date: "2026-07-01" }),
  ], { policy: POLICY, nowIso: NOW });
  const by = Object.fromEntries(c.entries.map((e) => [e.invoiceId, e.bucket]));
  assert.equal(by.a, "expected", "المسوّدة عُدّت محقَّقة");
  assert.equal(by.b, "invoiced");
  assert.equal(by.c, "overdue");
  assert.equal(by.d, "paid");
});

test("🔴 الفاتورة المدفوعة ليست متأخّرة ولو مضى استحقاقها", () => {
  const c = R.buildCashFlowCalendar(
    [inv({ status: "paid", due_date: "2026-01-01" })], { policy: POLICY, nowIso: NOW });
  assert.equal(c.entries[0].bucket, "paid");
  assert.equal(c.entries[0].daysOverdue, null);
});

test("🔴 بلا تاريخ استحقاق: لا تصنيف ولا تأخّر — وتُعدّ منفصلة", () => {
  const c = R.buildCashFlowCalendar(
    [inv({ due_date: null })], { policy: POLICY, nowIso: NOW });
  assert.equal(c.entries.length, 0, "صُنِّفت فاتورة بلا تاريخ استحقاق");
  assert.equal(c.missingDueDate.length, 1);
});

test("🔴 غير المربوطة تُعرض منفصلة ولا تدخل الدلاء", () => {
  const c = R.buildCashFlowCalendar(
    [inv({ project_id: null, client_id: null })], { policy: POLICY, nowIso: NOW });
  assert.equal(c.entries.length, 0);
  assert.equal(c.unmapped.length, 1);
});

test("🔴 لا جمع عبر العملات داخل الدلو", () => {
  const c = R.buildCashFlowCalendar([
    inv({ id: "a", status: "sent", due_date: "2026-07-01", currency: "SAR" }),
    inv({ id: "b", status: "sent", due_date: "2026-07-01", currency: "USD" }),
  ], { policy: POLICY, nowIso: NOW });
  assert.equal(c.totals.overdue.available, false);
  assert.equal(c.totals.overdue.reason, "currency_mismatch");
});

test("🔴 غياب ربط Zoho يُرفع تعارضًا ولا يُحلّ تلقائيًّا", () => {
  const c = R.buildCashFlowCalendar(
    [inv({ zoho_invoice_id: null })], { policy: POLICY, nowIso: NOW });
  assert.ok(c.conflicts.some((x) => x.startsWith("missing_zoho_mapping")));
});

test("الملغاة والمحذوفة تُستبعد", () => {
  const c = R.buildCashFlowCalendar([
    inv({ id: "a", status: "void" }), inv({ id: "b", is_deleted: true }),
  ], { policy: POLICY, nowIso: NOW });
  assert.equal(c.entries.length, 0);
});

// ─── ٣ · المنطقة الزمنية ───────────────────────────────────────────────────
test("🔴 التأخّر يُقاس على بداية اليوم بمنطقة صريحة", () => {
  // مستحقّة اليوم ⇒ ليست متأخّرة مهما تأخّرت الساعة **في تلك المنطقة**.
  // ⚠️ 18:00Z = 21:00 بتوقيت الرياض، أي ما يزال اليوم نفسه.
  assert.equal(R.daysOverdue("2026-08-05", "2026-08-05T18:00:00Z", "Asia/Riyadh"), 0);
  // 🔴 و23:30Z **هو اليوم التالي** في الرياض (+3) — وهذا صحيح لا خطأ،
  //    وهو بالضبط سبب تمرير المنطقة صراحةً بدل الاعتماد على UTC.
  assert.equal(R.daysOverdue("2026-08-05", "2026-08-05T23:30:00Z", "Asia/Riyadh"), 1);
  assert.equal(R.daysOverdue("2026-08-05", "2026-08-05T23:30:00Z", "UTC"), 0);
  assert.equal(R.daysOverdue("2026-08-04", "2026-08-05T00:30:00Z", "Asia/Riyadh"), 1);
  // ⚠️ والمنطقة تُغيّر النتيجة فعلًا — ولهذا تُمرَّر صراحةً.
  const utc = R.daysOverdue("2026-08-04", "2026-08-04T22:00:00Z", "UTC");
  const ryd = R.daysOverdue("2026-08-04", "2026-08-04T22:00:00Z", "Asia/Riyadh");
  assert.equal(utc, 0);
  assert.equal(ryd, 1, "لم تُطبَّق المنطقة الزمنية");
});

// ─── ٤ · V2-5.5-E · عدّاد التأخّر ──────────────────────────────────────────
test("العدّاد الرسميّ يستبعد غير المربوطة وبلا تاريخ", () => {
  const o = R.buildOverdueCounter([
    inv({ id: "a", status: "sent", due_date: "2026-07-01" }),
    inv({ id: "b", status: "sent", due_date: "2026-06-01" }),
    inv({ id: "c", status: "sent", due_date: "2026-07-01", project_id: null, client_id: null }),
    inv({ id: "d", status: "sent", due_date: null }),
    inv({ id: "e", status: "paid", due_date: "2026-01-01" }),
  ], { policy: POLICY, nowIso: NOW });
  assert.equal(o.officialCount, 2, "دخلت غير مربوطة أو مدفوعة في الرسميّ");
  assert.equal(o.unmappedCount, 1);
  assert.equal(o.missingDueDateCount, 1);
  assert.equal(o.officialTotal.value, 2000);
  assert.equal(o.oldestDays, R.daysOverdue("2026-06-01", NOW, "Asia/Riyadh"));
});

// ─── ٥ · V2-5.5-F · مسوّدة الإشعار ─────────────────────────────────────────
const ON = { NEXT_PUBLIC_SHOW_SUSPENSION_NOTICE: "1" };

test("🔴 العلم مطفأ ⇒ لا مسوّدة", () => {
  for (const env of [{}, { NEXT_PUBLIC_SHOW_SUSPENSION_NOTICE: "0" },
                     { NEXT_PUBLIC_SHOW_SUSPENSION_NOTICE: "true" }]) {
    const d = R.buildSuspensionNoticeDraft(
      { invoice: inv(), customerName: "شركة", nowIso: NOW }, POLICY, env);
    assert.equal(d.ok, false);
    assert.equal(d.refusal, "flag_off");
  }
});

test("المسوّدة تُبنى وتتطلّب اعتمادًا بشريًّا", () => {
  const d = R.buildSuspensionNoticeDraft(
    { invoice: inv(), customerName: "شركة الاختبار", nowIso: NOW }, POLICY, ON);
  assert.equal(d.ok, true);
  assert.equal(d.requiresHumanApproval, true);
  assert.ok(d.body.includes("INV-1"));
  assert.ok(d.body.includes("1000 SAR"));
  assert.ok(d.subject.includes("INV-1"));
});

test("🔴 تفشل مغلقةً عند نقص أيّ حقل — ⛔ ولا تقدير", () => {
  const cases = [
    ["missing_invoice_number", { invoice_number: null }],
    ["missing_amount", { total: null }],
    ["missing_currency", { currency: null }],
    ["missing_due_date", { due_date: null }],
    ["invoice_unmapped", { project_id: null, client_id: null }],
    ["invoice_unmapped", { zoho_invoice_id: null }],
    ["invoice_paid", { status: "paid" }],
    ["not_overdue", { due_date: "2026-12-01" }],
  ];
  for (const [refusal, patch] of cases) {
    const d = R.buildSuspensionNoticeDraft(
      { invoice: inv(patch), customerName: "شركة", nowIso: NOW }, POLICY, ON);
    assert.equal(d.ok, false, `بُنيت مسوّدة رغم ${refusal}`);
    assert.equal(d.refusal, refusal);
  }
  const noCustomer = R.buildSuspensionNoticeDraft(
    { invoice: inv(), customerName: "  ", nowIso: NOW }, POLICY, ON);
  assert.equal(noCustomer.refusal, "missing_customer");
});

test("🔴 لا مسوّدة بلا سياسة", () => {
  const d = R.buildSuspensionNoticeDraft(
    { invoice: inv(), customerName: "شركة", nowIso: NOW }, {}, ON);
  assert.equal(d.ok, false);
  assert.equal(d.refusal, "policy_missing");
});

// ─── ٦ · ⛔ لا Zoho حيّ ولا إرسال ──────────────────────────────────────────
test("⛔ لا نداء شبكة ولا إرسال في الوحدة", () => {
  const src = fs.readFileSync(path.join(ROOT, SRC), "utf8");
  for (const re of [/\bfetch\s*\(/, /axios/, /sendMail|sendEmail|nodemailer/,
                    /exp\.host/, /books\.zoho/, /https?:\/\//]) {
    assert.ok(!re.test(src), `الوحدة تتّصل أو تُرسل: ${re}`);
  }
});

test("⛔ لا تحويل عملة ولا سعر صرف", () => {
  const src = fs.readFileSync(path.join(ROOT, SRC), "utf8");
  for (const re of [/exchange[_ ]?rate/i, /convertCurrency/i, /fxRate/i]) {
    assert.ok(!re.test(src), `تحويل عملة: ${re}`);
  }
});

test("الأعلام مطفأة إلا بـ\"1\"", () => {
  for (const v of [undefined, "", "0", "true", "yes"]) {
    assert.equal(R.financialCardsEnabled({ NEXT_PUBLIC_SHOW_FINANCIAL_REPORTING: v }), false);
    assert.equal(R.suspensionNoticeEnabled({ NEXT_PUBLIC_SHOW_SUSPENSION_NOTICE: v }), false);
  }
  assert.equal(R.financialCardsEnabled({ NEXT_PUBLIC_SHOW_FINANCIAL_REPORTING: "1" }), true);
});

test("⛔ لا واجهة مركَّبة بعد", () => {
  const hits = [];
  const walk = (d) => {
    const abs = path.join(ROOT, d);
    if (!fs.existsSync(abs)) return;
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const p = path.join(abs, e.name);
      if (e.isDirectory()) { walk(path.relative(ROOT, p)); continue; }
      if (!/\.(ts|tsx)$/.test(e.name)) continue;
      if (/financialReporting/.test(fs.readFileSync(p, "utf8"))) hits.push(path.relative(ROOT, p));
    }
  };
  ["components", "app"].forEach(walk);
  assert.deepEqual(hits, [], `مركَّب في واجهة: ${hits.join(", ")}`);
});
