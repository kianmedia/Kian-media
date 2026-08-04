// ════════════════════════════════════════════════════════════════════════════
// tests/wave5_financial_source_policy.test.js — Wave 5 · W5-2
//
// ⛔ لا قاعدة ولا شبكة ولا بيانات عملاء حقيقية. أرقام اختبار مُختلَقة **صراحةً**
//    داخل الاختبار وحده — ⛔ ولا تُعرض قطّ كنتيجة مالية.
//
// ★ ما يحرسه هذا الملفّ ★
//   أنّ **لا رقم ماليًّا يُنتَج قبل اعتماد القرارات السبعة**، وأنّ كل طريق
//   مختصر مغرٍ — قيمة افتراضية، رجوع صامت، صفر بدل ناقص — **يفشل**.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const ROOT = path.resolve(__dirname, "..");
const SRC_REL = "lib/finance/financialSourcePolicy.ts";
const SRC = fs.readFileSync(path.join(ROOT, SRC_REL), "utf8");
const loadTs = (rel) => {
  const js = ts.transpileModule(fs.readFileSync(path.join(ROOT, rel), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const m = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function("exports", "module", "require", js)(m.exports, m, () => ({}));
  return m.exports;
};
const P = loadTs(SRC_REL);

const FULL = {
  revenueSource: "fin_revenue", costSource: "fin_costs", invoiceSource: "fin_receivables",
  vatSource: "stored", currencyPolicy: "reject_mixed", marginPolicy: "net_of_vat",
  zohoPrecedence: "database_wins", approvedBy: "khaled", approvedAt: "2026-08-04T00:00:00Z",
};
const NOW = "2026-08-04T12:00:00Z";
const row = (o = {}) => ({
  source: "fin_costs", amountNet: 100, vatAmount: 15, amountGross: 115,
  currency: "SAR", asOf: null, ...o,
});

// ─── ١ · 🔴 لا رقم دون سياسة ───────────────────────────────────────────────
test("🔴 سياسة ناقصة ⇒ لا رقم إطلاقًا", () => {
  for (const k of P.POLICY_KEYS) {
    const partial = { ...FULL }; delete partial[k];
    const r = P.resolveAmount([row()], { policy: partial, nowIso: NOW });
    assert.equal(r.available, false, `أُنتج رقم رغم غياب ${k}`);
    assert.equal(r.reason, "source_unselected");
  }
  for (const empty of [undefined, null, {}, "", 0]) {
    const r = P.resolveAmount([row()], { policy: empty, nowIso: NOW });
    assert.equal(r.available, false, `أُنتج رقم مع سياسة ${JSON.stringify(empty)}`);
  }
});

test("🔴 سياسة كاملة بلا اعتماد بشريّ ⇒ مرفوضة", () => {
  for (const bad of [{ approvedBy: "" }, { approvedAt: "" }, { approvedBy: "   " }]) {
    const v = P.validatePolicy({ ...FULL, ...bad });
    assert.equal(v.ok, false, `قُبلت سياسة بلا اعتماد: ${JSON.stringify(bad)}`);
    assert.equal(v.reason, "not_approved");
  }
});

test("🔴 قيمة غير معروفة تُرفض ولا تُصحَّح", () => {
  const v = P.validatePolicy({ ...FULL, costSource: "whatever_costs" });
  assert.equal(v.ok, false);
  assert.deepEqual(v.missing, ["costSource"]);
});

// ─── ٢ · ⛔ لا افتراضات في الشيفرة نفسها ───────────────────────────────────
test("⛔ لا ثابت افتراضيّ ولا fallback في المصدر", () => {
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const re of [/DEFAULT_POLICY/, /FALLBACK_SOURCE/, /defaultSource/i,
                    /\?\?\s*["']fin_costs["']/, /\?\?\s*["']project_expenses["']/,
                    /\?\?\s*["']zoho["']/, /\|\|\s*["']fin_revenue["']/]) {
    assert.ok(!re.test(code), `المصدر يحمل افتراضًا صامتًا: ${re}`);
  }
});

test("⛔ لا تحويل Null إلى Zero", () => {
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const re of [/amountNet\s*\?\?\s*0/, /amountGross\s*\?\?\s*0/,
                    /amountNet\s*\|\|\s*0/, /Number\(\s*\w+\s*\)\s*\|\|\s*0/]) {
    assert.ok(!re.test(code), `الناقص يُحوَّل إلى صفر: ${re}`);
  }
});

// ─── ٣ · ناقص ≠ صفر ────────────────────────────────────────────────────────
test("🔴 لا صفوف ⇒ missing_data لا صفر", () => {
  const r = P.resolveAmount([], { policy: FULL, nowIso: NOW });
  assert.equal(r.available, false);
  assert.equal(r.reason, "missing_data");
  assert.equal(r.value, undefined, "أُعيدت قيمة مع تعذُّر");
});

test("🔴 net = null ⇒ تعذُّر لا صفر", () => {
  const r = P.resolveAmount([row({ amountNet: null, amountGross: null })],
    { policy: FULL, nowIso: NOW });
  assert.equal(r.available, false);
  assert.equal(r.reason, "missing_data");
});

// ─── ٤ · 🔴 العملات ────────────────────────────────────────────────────────
test("🔴 لا جمع بين عملتين", () => {
  const r = P.resolveAmount(
    [row({ currency: "SAR" }), row({ currency: "USD" })], { policy: FULL, nowIso: NOW });
  assert.equal(r.available, false, "جُمعت عملتان مختلفتان");
  assert.equal(r.reason, "currency_mismatch");
  assert.equal(r.detail, "SAR,USD");
});

test("🔴 base_currency_conversion لا يخترع سعر صرف", () => {
  const r = P.resolveAmount(
    [row({ currency: "SAR" }), row({ currency: "USD" })],
    { policy: { ...FULL, currencyPolicy: "base_currency_conversion" }, nowIso: NOW });
  assert.equal(r.available, false, "حُوِّلت عملة بلا جدول أسعار صرف");
  assert.equal(r.detail, "no_fx_table_available");
});

test("عملة واحدة تُجمع بلا اعتراض", () => {
  const r = P.resolveAmount([row(), row()], { policy: FULL, nowIso: NOW });
  assert.equal(r.available, true);
  assert.equal(r.value, 200);
  assert.equal(r.currency, "SAR");
});

// ─── ٥ · 🔴 تناقض gross/net/vat ────────────────────────────────────────────
test("🔴 لا يُستعمل gross إذا ناقض net + vat", () => {
  const bad = row({ amountNet: 100, vatAmount: 15, amountGross: 999 });
  assert.equal(P.rowIsConsistent(bad), false);
  const r = P.resolveAmount([bad], { policy: FULL, nowIso: NOW });
  assert.equal(r.available, false, "حُسب رقم من صفّ يناقض نفسه");
  assert.equal(r.reason, "conflicting_values");
});

test("التقريب العشريّ لا يُعدّ تناقضًا", () => {
  assert.equal(P.rowIsConsistent(row({ amountNet: 100, vatAmount: 15, amountGross: 115.004 })), true);
  assert.equal(P.rowIsConsistent(row({ amountNet: 100, vatAmount: 15, amountGross: 115.5 })), false);
});

test("vatSource=calculated يشتقّ من gross - vat، ويتعذّر عند النقص", () => {
  const pol = { ...FULL, vatSource: "calculated" };
  const ok = P.resolveAmount([row()], { policy: pol, nowIso: NOW });
  assert.equal(ok.available, true);
  assert.equal(ok.value, 100);
  assert.equal(ok.basis, "calculated");
  const miss = P.resolveAmount([row({ amountGross: null })], { policy: pol, nowIso: NOW });
  assert.equal(miss.available, false);
});

// ─── ٦ · 🔴 الهامش ─────────────────────────────────────────────────────────
test("🔴 لا هامش دون إيراد وتكلفة معتمدَين", () => {
  const rev = P.resolveAmount([row({ source: "fin_revenue", amountNet: 1000, vatAmount: 150, amountGross: 1150 })],
    { policy: FULL, nowIso: NOW });
  const missing = P.unavailable("missing_data");
  assert.equal(P.computeMargin(rev, missing, FULL).available, false, "حُسب هامش بلا تكلفة");
  assert.equal(P.computeMargin(missing, rev, FULL).available, false, "حُسب هامش بلا إيراد");
  assert.equal(P.computeMargin(rev, rev, {}).available, false, "حُسب هامش بلا سياسة");
});

test("🔴 لا هامش عبر عملتين", () => {
  const rev = { available: true, value: 1000, currency: "SAR", source: "fin_revenue", basis: "stored", asOf: null, stale: false };
  const cost = { available: true, value: 100, currency: "USD", source: "fin_costs", basis: "stored", asOf: null, stale: false };
  const m = P.computeMargin(rev, cost, FULL);
  assert.equal(m.available, false);
  assert.equal(m.reason, "currency_mismatch");
});

test("🔴 إيراد صفر ⇒ النسبة غير معرَّفة، ولا تُعرض 0% ولا 100%", () => {
  const rev = { available: true, value: 0, currency: "SAR", source: "fin_revenue", basis: "stored", asOf: null, stale: false };
  const cost = { available: true, value: 50, currency: "SAR", source: "fin_costs", basis: "stored", asOf: null, stale: false };
  const m = P.computeMargin(rev, cost, FULL);
  assert.equal(m.available, false);
  assert.equal(m.reason, "missing_data");
});

test("marginPolicy=disabled يمنع الحساب", () => {
  const rev = { available: true, value: 1000, currency: "SAR", source: "fin_revenue", basis: "stored", asOf: null, stale: false };
  const cost = { available: true, value: 400, currency: "SAR", source: "fin_costs", basis: "stored", asOf: null, stale: false };
  assert.equal(P.computeMargin(rev, cost, { ...FULL, marginPolicy: "disabled" }).available, false);
  const on = P.computeMargin(rev, cost, FULL);
  assert.equal(on.available, true);
  assert.equal(on.value, 60);
});

// ─── ٧ · 🔴 الازدواج بين نطاقَي التكلفة ────────────────────────────────────
test("🔴 لا جمع بين fin_costs وproject_expenses", () => {
  const rows = [row({ source: "fin_costs" }), row({ source: "project_expenses" })];
  const guard = P.assertSingleCostSource(rows, FULL);
  assert.ok(guard, "لم يُرصد الازدواج");
  assert.equal(guard.reason, "duplicate_cost_candidate");
  assert.equal(guard.detail, "fin_costs+project_expenses");
});

test("🔴 مصدر لم تعتمده السياسة يُرفض ولو كان الوحيد المتاح", () => {
  const guard = P.assertSingleCostSource([row({ source: "project_expenses" })], FULL);
  assert.ok(guard, "قُبل مصدر غير معتمَد لأنّه الوحيد");
  assert.equal(guard.reason, "source_unverified");
});

test("المصدر المطابق للسياسة يمرّ", () => {
  assert.equal(P.assertSingleCostSource([row({ source: "fin_costs" })], FULL), null);
});

// ─── ٨ · قِدَم البيانات الخارجية ───────────────────────────────────────────
test("🔴 بيانات Zoho القديمة لا تُعرض كأنّها حالية", () => {
  const pol = { ...FULL, zohoPrecedence: "zoho_wins", revenueSource: "zoho" };
  const old = row({ source: "zoho", asOf: "2026-07-01T00:00:00Z" });
  const r = P.resolveAmount([old], { policy: pol, nowIso: NOW });
  assert.equal(r.available, false);
  assert.equal(r.reason, "stale_external_data");
});

test("stale يُعلَن حتّى حين يُسمح بالعرض", () => {
  const fresh = row({ source: "zoho", asOf: "2026-08-04T11:00:00Z" });
  const r = P.resolveAmount([fresh], { policy: { ...FULL, zohoPrecedence: "zoho_wins" }, nowIso: NOW });
  assert.equal(r.available, true);
  assert.equal(r.stale, false);
  assert.equal(r.basis, "stored", "لم يُميَّز المخزَّن عن المحسوب");
});

// ─── ٩ · عقد التصدير ───────────────────────────────────────────────────────
test("🔴 لا تصدير ماليّ بلا سياسة معتمَدة", () => {
  assert.equal(P.assertExportAllowed({}).allowed, false);
  assert.equal(P.assertExportAllowed({ ...FULL, approvedBy: "" }).allowed, false);
  assert.equal(P.assertExportAllowed(FULL).allowed, true);
});

// ─── ١٠ · العلم ────────────────────────────────────────────────────────────
test("علم التقارير المالية مطفأ إلا بـ\"1\"", () => {
  for (const v of [undefined, "", "0", "true", "yes", " 1"]) {
    assert.equal(P.financialReportingEnabled({ NEXT_PUBLIC_SHOW_FINANCIAL_REPORTING: v }), false,
      `القيمة ${JSON.stringify(v)} فعّلت التقارير`);
  }
  assert.equal(P.financialReportingEnabled({ NEXT_PUBLIC_SHOW_FINANCIAL_REPORTING: "1" }), true);
});

// ─── ١١ · ⛔ لا ربط بواجهة إنتاج بعد ───────────────────────────────────────
test("⛔ العقد غير مركَّب في أيّ واجهة", () => {
  const dirs = ["components", "app"];
  const hits = [];
  const walk = (d) => {
    const abs = path.join(ROOT, d);
    if (!fs.existsSync(abs)) return;
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const p = path.join(abs, e.name);
      if (e.isDirectory()) { walk(path.relative(ROOT, p)); continue; }
      if (!/\.(ts|tsx)$/.test(e.name)) continue;
      if (/financialSourcePolicy/.test(fs.readFileSync(p, "utf8"))) {
        hits.push(path.relative(ROOT, p));
      }
    }
  };
  dirs.forEach(walk);
  assert.deepEqual(hits, [],
    `العقد مركَّب في واجهة قبل اعتماد القرارات: ${hits.join(", ")}`);
});
