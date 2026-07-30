// ════════════════════════════════════════════════════════════════════════════
// tests/finance_collections_isolation.test.js
//
// ★★ هذا الملفّ هو جوهر المرحلة، لا ملحق بها ★★
//
// الثغرة المُثبَتة التي يمنع عودتها: حاملُ finance_ops.view كان يقرأ
// fin_receivables.amount_net (إيراد مفوتَر) ويقرأ fin_costs، فيطرح الأوّل من
// الثاني ويحصل على هامش تقريبيّ **بلا** finance_ops.view_profit. البوّابة التي
// بُنيت لحماية الهامش كانت تُلتَفّ من حولها بجمعٍ بسيط.
//
// القاعدة المُختبَرة هنا ليست «أخفِ عمود الربح»، بل:
//   ★ لا يُمنح دورٌ واحد جدولين يمكن طرح أحدهما من الآخر لاستنتاج الربحية. ★
//
// ولذلك الاختبارات **عدائية بالقصد**: تبحث عن أيّ طريق — جدول أو دالّة أو
// تصدير أو RLS أو مرفق أو سجلّ تدقيق — يوصل دورَ التحصيل إلى طرف التكلفة.
// كلّ اختبار هنا قادر على الفشل: لا واحد منها ملفوف بمصيدة تجعله ينجح.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  SQL, TS, read, funcBody, funcDecl, section,
  SENSITIVE_TABLES, SENSITIVE_PREDICATES, GRANTABLE_PREDICATES, LEGACY_PREDICATES,
  COST_SIDE_TOKENS, WRITE_FNS, READ_FNS,
} = require("./finance_helpers.js");

const COLLECTIONS_UI = read("components/portal/finance/FinCollections.tsx");
const CENTER = read("components/portal/finance/FinanceCenter.tsx");
const MATRIX = read("docs/FINANCE_ROLE_MATRIX.md");

/** كلّ سياسة قراءة في §4 كنصّ، مفهرسة بالجدول. */
function policiesByTable() {
  const rls = section("-- §4) RLS");
  const out = {};
  // المجموعة المعمَّمة داخل foreach: تُنسب لكلّ جدول في مصفوفتها
  for (const m of rls.matchAll(/foreach t in array array\[([\s\S]*?)\] loop([\s\S]*?)end loop;/g)) {
    const names = [...m[1].matchAll(/'(\w+)'/g)].map((x) => x[1]);
    for (const n of names) out[n] = (out[n] ?? "") + m[2];
  }
  // السياسات المكتوبة صراحةً باسم الجدول
  for (const m of rls.matchAll(/create policy (\w+)_read on public\.(\w+)[\s\S]*?using \(([\s\S]*?)\);/g)) {
    out[m[2]] = (out[m[2]] ?? "") + m[3];
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// (١) الطريق المباشر: وصول جدوليّ
// ─────────────────────────────────────────────────────────────────────────────

test("★ دور التحصيل لا يقرأ أيّ جدول ماليّ — لا صفّ واحد ★", () => {
  const pol = policiesByTable();
  for (const t of SENSITIVE_TABLES) {
    assert.ok(pol[t], `${t} بلا سياسة قراءة معروفة`);
    assert.match(pol[t], /finops_can_view_finance_sensitive\(\)/,
      `${t} لا يُحرَس بالبوّابة الحسّاسة`);
    assert.ok(!/can_view_collections|can_record_collection|collections_view|collections_record/.test(pol[t]),
      `★ الثغرة عادت ★ — ${t} مفتوح لدور التحصيل عبر RLS، وPostgREST يقرؤه مباشرةً`);
    assert.ok(!/finops_perm\s*\(/.test(pol[t]),
      `${t} يُفتح بمفتاح خام في السياسة بدل البوّابة الحسّاسة`);
  }
});

test("fin_costs وfin_receivables تحت بوّابة واحدة — لا قسمة تسمح بجمعهما", () => {
  const pol = policiesByTable();
  const a = pol["fin_costs"];
  const b = pol["fin_receivables"];
  assert.ok(a && b, "أحد طرفَي المعادلة بلا سياسة");
  assert.equal(
    /finops_can_view_finance_sensitive\(\)/.test(a),
    /finops_can_view_finance_sensitive\(\)/.test(b),
    "طرفا المعادلة تحت بوّابتين مختلفتين — من يملك الأوسع يجمعهما",
  );
  // ولا سياسة على أيّ منهما تحمل شرط ملكية يفتحه لغير المالك
  for (const p of [a, b]) {
    assert.ok(!/auth\.uid\(\)/.test(p),
      "سياسة على طرف من المعادلة تحمل شرط ملكية ⇒ صفوف تتسرّب لغير المالك");
  }
});

test("السياسات لا تُمنح لدور لا يشترط is_owner — البوّابة الحسّاسة للمالك حرفيًّا", () => {
  const g = funcBody("finops_can_view_finance_sensitive");
  assert.match(g, /is_owner\(\)/, "البوّابة الحسّاسة لا تشترط المالك");
  assert.match(g, /is_staff\(\)/, "البوّابة الحسّاسة لا تستبعد العميل");
  assert.ok(!/finops_perm/.test(g), "البوّابة الحسّاسة تُفتح بمفتاح — V1 للمالك وحده");
  assert.ok(!/staff_role/.test(g), "البوّابة الحسّاسة تُفتح بدور وظيفيّ");
  // ولا واحدة من مشتقّاتها تفتح بابًا جانبيًّا
  // finops_can_approve وحده من الأسماء المتوارثة ليس حسّاسًا: مرادف لبوّابة
  // الاعتماد القابلة للمنح، وهي لا تلمس جدولًا حسّاسًا (مُختبَر أدناه).
  for (const p of [...SENSITIVE_PREDICATES.filter((x) => x !== "finops_can_view_finance_sensitive"),
    ...LEGACY_PREDICATES.filter((x) => x !== "finops_can_approve")]) {
    const b = funcBody(p);
    // الانحدار قد يكون مباشرًا أو عبر مُسنَد حسّاس آخر — المهمّ ألّا يكون
    // للمُسنَد مصدرُ صلاحية خارج هذه السلسلة.
    assert.match(b, /finops_can_(view_finance_sensitive|manage_finance|export_sensitive)\(\)/,
      `${p} لا تنحدر من البوّابة الحسّاسة`);
    assert.ok(!/finops_perm/.test(b), `${p} تُفتح بمفتاح مباشر — طريق جانبيّ إلى الحسّاس`);
  }
  assert.match(funcBody("finops_can_approve"), /finops_can_approve_expense\(\)/,
    "الاسم المتوارث للاعتماد لا يشير إلى بوّابة الاعتماد الصريحة");
});

// ─────────────────────────────────────────────────────────────────────────────
// (٢) الطريق غير المباشر: دالّة تعيد ما لا يجوز
// ─────────────────────────────────────────────────────────────────────────────

test("★ سطح التحصيل لا يذكر طرف التكلفة ولو مرّة ★", () => {
  for (const f of ["finops_collections_list", "finops_collections_summary"]) {
    const b = funcBody(f);
    for (const token of COST_SIDE_TOKENS) {
      assert.ok(!b.includes(token),
        `${f} تقرأ ${token} — طرفا الطرح اجتمعا في دور واحد`);
    }
    assert.ok(!/select\s+\*/i.test(b), `${f} تستعمل select * — أوّل عمود يُضاف يتسرّب`);
    assert.match(b, /finops_can_view_collections\(\)/, `${f} بلا بوّابة التحصيل`);
    assert.match(b, /raise exception 'not authorized'/, `${f} لا ترفع منعًا صريحًا`);
  }
});

// ★ قائمة بيضاء حقيقية، لا قائمة سوداء ★
//
// كان هذا الفحص يعدّ أسماءً ممنوعة بعينها، فكان يمرّ على أيّ اسم لم يخطر
// للكاتب: إقحام 'actual_cost_gross' في حمولة التحصيل كان يمرّ صامتًا رغم أنّ
// اسم الفحص يَعِد بقائمة بيضاء. القائمة السوداء تحرس ما تذكره وحده، والثقب
// دائمًا فيما لا يُذكَر. لذلك يُقلَب المنطق: كلّ رمز مقتبس في جسم الدالّة
// يجب أن يكون مذكورًا هنا صراحةً، وأيّ إضافة — مهما كان اسمها — تُسقِط الفحص
// حتى يقرّرها إنسان.
const COLLECTIONS_ALLOWED_TOKENS = new Set([
  // مفاتيح الصفّ التشغيليّ
  "id", "doc_no", "invoice_ref", "title", "client_label", "issue_date", "due_date",
  "currency", "amount_net", "vat_amount", "amount_due_gross", "amount_gross", "doc_status",
  "collection_notes", "collected_on", "method", "reference", "note",
  // الحالة المشتقّة من الدفعات
  "collection_status", "collected", "outstanding", "days_overdue", "is_overdue",
  "aging_bucket", "found", "gross",
  // المجاميع ودلاء التقادم
  "totals", "due_gross", "collected_gross", "outstanding_gross", "overdue_gross",
  "overdue_count", "open_count", "aging", "current", "d1_30", "d31_60", "d61_90",
  "over_90", "1_30", "31_60", "61_90",
  // المرشِّحات وحالات المستند وغلاف الردّ
  "only_overdue", "q", "open", "written_off", "ok", "rows", "scope", "collections_only",
]);

test("قائمة الأعمدة البيضاء مكتوبة حرفيًّا — وما ليس فيها لا يخرج", () => {
  const b = funcBody("finops_collections_list");

  // (أ) المسموح موجود فعلًا — وإلّا تعطّلت العملية
  for (const k of ["client_label", "invoice_ref", "due_date", "amount_due_gross",
    "vat_amount", "collection_notes"]) {
    assert.ok(b.includes(`'${k}'`), `قائمة التحصيل بلا ${k} — ستُعطَّل العملية`);
  }

  // (ب) ★ القلب: لا رمز خارج القائمة البيضاء ★
  const found = new Set((b.match(/'[a-z0-9_]+'/g) || []).map((s) => s.slice(1, -1)));
  const extra = [...found].filter((t) => !COLLECTIONS_ALLOWED_TOKENS.has(t)).sort();
  assert.deepEqual(extra, [],
    "رموز خارج القائمة البيضاء في سطح التحصيل: " + extra.join("، ") +
    " — أيّ حقل جديد هنا قد يكون طرف التكلفة. أضِفه إلى القائمة عمدًا أو احذفه.");

  // (ج) وبصريح العبارة: لا اسم يشي بالتكلفة أو الهامش أو الميزانية
  for (const k of ["cost", "margin", "profit", "budget", "supplier", "contract_id",
    "project_id", "rate_card"]) {
    assert.ok(!b.includes(k), `قائمة التحصيل تُخرج ${k}`);
  }

  // (د) ولا ملاحظات الذمّة الداخلية (قد تحمل تعليقًا عن التكلفة)
  assert.ok(!/r\.notes/.test(b), "قائمة التحصيل تُخرج ملاحظات الذمّة الداخلية");
});

test("لا دالّة قراءة أخرى تنفتح لدور التحصيل", () => {
  const allowed = new Set(["finops_access", "finops_collections_list", "finops_collections_summary"]);
  for (const f of READ_FNS) {
    if (allowed.has(f)) continue;
    const b = funcBody(f);
    assert.ok(!/finops_can_view_collections\(\)|finops_can_record_collection\(\)/.test(b),
      `${f} تعترف ببوّابة التحصيل — توسيع صامت لسطح الدور`);
  }
});

test("الكتابة المتاحة لدور التحصيل واحدة: تسجيل الدفعة (وسند قبضها)", () => {
  const allowed = new Set(["finops_collection_record", "finops_attachment_add"]);
  for (const f of WRITE_FNS) {
    const b = funcBody(f);
    const usesCollections = /finops_can_record_collection\(\)/.test(b);
    if (allowed.has(f)) continue;
    assert.ok(!usesCollections, `${f} مفتوحة لدور التحصيل — الكتابة الوحيدة هي تسجيل الدفعة`);
  }
  assert.match(funcBody("finops_collection_record"), /finops_can_record_collection\(\)/,
    "تسجيل التحصيل لا يستعمل بوّابته");
  // والمرفق مقيّد بنوع صفّ التحصيل نفسه، لا بأيّ كيان ماليّ
  const att = funcBody("finops_attachment_add");
  assert.match(att, /v_type = 'collection'[\s\S]{0,240}finops_can_record_collection\(\)/,
    "مرفق دور التحصيل غير مقيّد بصفّ تحصيل قائم");
});

test("إنشاء الذمّة نفسها للمالك — دور التحصيل يسجّل السداد لا يخلق الإيراد", () => {
  for (const f of ["finops_receivable_upsert", "finops_milestone_upsert"]) {
    const b = funcBody(f);
    assert.match(b, /finops_can_manage_finance\(\)/, `${f} تسمح لغير المالك بكتابة إيراد مفوتَر`);
    assert.ok(!/finops_can_record_collection\(\)/.test(b),
      `${f} مفتوحة لدور التحصيل — يستطيع كتابة رقم إيراد ثمّ قراءته`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// (٣) الطريق الملتوي: تصدير · تدقيق · مرفقات · عروض
// ─────────────────────────────────────────────────────────────────────────────

test("★ صلاحية التصدير مقسومة، والمجموعة الحسّاسة لا تُفتح بمفتاح التحصيل ★", () => {
  const b = funcBody("finops_export");
  assert.match(b, /finops_can_export_collections\(\)/, "لا مفتاح تصدير مستقلّ للتحصيل");
  assert.match(b, /finops_can_export_sensitive\(\)/, "لا بوّابة للتصدير الشامل");
  // الترتيب: مجموعة التحصيل تُخدَم وتُنهى قبل الوصول إلى بوّابة الشامل،
  // وباقي المجموعات لا تُخدَم إلّا بعد بوّابة الشامل.
  const iColl = b.indexOf("finops_can_export_collections()");
  const iSens = b.indexOf("if not coalesce(public.finops_can_export_sensitive(), false)");
  assert.ok(iColl > 0 && iSens > iColl,
    "بوّابة التصدير الشامل ليست هي الفاصل أمام المجموعات الحسّاسة");
  for (const ds of ["'costs'", "'revenue'", "'budget_lines'", "'purchase_orders'"]) {
    const i = b.indexOf(`p_dataset = ${ds}`);
    if (i > 0) assert.ok(i > iSens, `مجموعة ${ds} تُخدَم قبل بوّابة التصدير الشامل`);
  }
  // ومجموعة التحصيل نفسها بلا عمود تكلفة
  const cols = b.match(/"invoice_ref"[\s\S]*?\]'::jsonb/);
  assert.ok(cols, "أعمدة تصدير التحصيل غير معرَّفة حرفيًّا");
  for (const bad of ["cost", "margin", "profit", "supplier", "budget"]) {
    assert.ok(!cols[0].includes(bad), `تصدير التحصيل يحمل عمود ${bad}`);
  }
});

test("سجلّ التدقيق والصادر للمالك — detail يحمل المبالغ", () => {
  const pol = policiesByTable();
  for (const t of ["fin_audit", "fin_zoho_outbox"]) {
    assert.match(pol[t] ?? "", /finops_can_manage_finance\(\)/, `${t} مقروء لغير المالك`);
    assert.ok(!/collections/.test(pol[t] ?? ""), `${t} مفتوح لدور التحصيل`);
  }
});

test("المرفقات لا تفتح مرفق تكلفة ولا عقد لغير المالك", () => {
  const pol = policiesByTable();
  const att = pol["fin_attachments"] ?? "";
  assert.match(att, /finops_can_view_finance_sensitive\(\)/, "مرفقات بلا البوّابة الحسّاسة");
  assert.match(att, /uploaded_by = auth\.uid\(\)/, "المرفق غير مقيّد برافعه");
  // المعتمِد يرى مرفق الطلب وحده — لا مرفق تكلفة ولا عقد ولا ذمّة
  assert.match(att, /entity_type in \('expense_request','purchase_request'\)/,
    "استثناء المعتمِد غير محصور بنوعَي الطلب");
  for (const bad of ["'cost'", "'contract'", "'receivable'", "'supplier'", "'budget'"]) {
    assert.ok(!new RegExp(`can_approve_expense[\\s\\S]{0,120}${bad}`).test(att),
      `سياسة المرفقات تفتح ${bad} للمعتمِد`);
  }
});

test("لا VIEW في الموديول — العرض يملكه postgres ويتجاوز RLS", () => {
  assert.ok(!/create\s+(or\s+replace\s+)?view\s+public\.fin/i.test(SQL),
    "الحزمة تنشئ VIEW ماليًّا — طريق جانبيّ يتجاوز كلّ سياسة");
  assert.match(SQL, /pg_views where schemaname = 'public' and viewname like 'fin/,
    "الـSELF-TEST بلا حارس يمنع إضافة VIEW لاحقًا");
});

// ─────────────────────────────────────────────────────────────────────────────
// (٤) المعتمِد: الطرف الثاني من الفصل
// ─────────────────────────────────────────────────────────────────────────────

test("المعتمِد يرى الطلب الذي يقرّر فيه فقط — لا دفتر تكاليف ولا ذمم", () => {
  const pol = policiesByTable();
  for (const t of ["fin_expense_requests", "fin_purchase_requests"]) {
    assert.match(pol[t] ?? "", /finops_can_approve_expense\(\)/,
      `${t} لا يفتح للمعتمِد ⇒ يقرّر في مبلغ لا يراه`);
  }
  for (const t of SENSITIVE_TABLES) {
    assert.ok(!/can_approve_expense/.test(pol[t] ?? ""),
      `${t} مفتوح للمعتمِد — يجمع مبالغ المصروف مع طرف الإيراد`);
  }
  // ودفتر أوامر الشراء (سعر المورّد) محجوب عنه داخل الدالّة نفسها
  const pl = funcBody("finops_purchase_list");
  assert.match(pl, /purchase_orders_masked/, "قائمة الشراء لا تُصرّح بحجب أوامر الشراء");
  assert.match(pl, /case when v_sensitive then v_po else '\[\]'::jsonb end/,
    "أوامر الشراء تُعاد للمعتمِد");
});

test("جمع مفتاحَي التحصيل والاعتماد لا يبلغ التكلفة — والمصفوفة تنصّ على فصلهما", () => {
  // حتى لو مُنح شخص واحد المفتاحين: لا يصل fin_costs ولا الميزانيات.
  const pol = policiesByTable();
  for (const t of ["fin_costs", "fin_budgets", "fin_budget_lines", "fin_suppliers"]) {
    const p = pol[t] ?? "";
    assert.ok(!/can_view_collections|can_record_collection|can_approve_expense/.test(p),
      `${t} يُبلَغ بجمع مفتاحَي التحصيل والاعتماد`);
  }
  assert.match(SQL, /ولا يُمنح finance_ops\.collections_view وfinance_ops\.approve لشخص واحد/,
    "الحزمة لا تنصّ على فصل المفتاحين");
  assert.match(MATRIX, /finance_ops\.collections_view/, "المصفوفة لا تذكر مفتاح التحصيل");
});

// ─────────────────────────────────────────────────────────────────────────────
// (٥) الواجهة: لا تقرّر صلاحية، ولا تعرف طريقًا إلى الحسّاس
// ─────────────────────────────────────────────────────────────────────────────

test("سطح التحصيل في الواجهة لا يستدعي أيّ دالّة حسّاسة", () => {
  for (const bad of ["finCostsList", "finBudgetsList", "finReceivables", "finProfitability",
    "finDashboard", "finSuppliersList", "finPurchaseList", "finAuditList", "finLookups",
    "finBudgetVariance", "finZohoDiagnostic"]) {
    assert.ok(!COLLECTIONS_UI.includes(bad), `شاشة التحصيل تستدعي ${bad}`);
  }
  assert.match(COLLECTIONS_UI, /finCollectionsList/, "شاشة التحصيل لا تقرأ دالّتها");
  // ولا تصدّر إلّا مجموعتها
  assert.match(COLLECTIONS_UI, /finExport\("collections_queue"/, "تصدير الشاشة ليس مجموعة التحصيل");
  assert.ok(!/finExport\("(costs|revenue|budget_lines|purchase_orders|receivables)"/.test(COLLECTIONS_UI),
    "شاشة التحصيل تصدّر مجموعة حسّاسة");
});

test("التوجيه في الواجهة يقرأ العَلَم الصريح لا العَلَم المتوارث", () => {
  assert.match(CENTER, /a\.can_view_finance_sensitive/, "الشاشة تقرّر بالعَلَم المتوارث");
  assert.match(CENTER, /a\.can_view_collections[\s\S]{0,400}FinCollectionsCenter/,
    "حاملُ صلاحية التحصيل لا يُوجَّه إلى سطحه");
  // وسطح التحصيل ليس تبويبًا داخل المركز (تبويب مخفيّ ≠ منع)
  // سطح التحصيل ليس تبويبًا في المركز: TabKey لا يعرفه، فلا يُفتح بتزوير حالة
  // في المتصفّح. (مجموعة التصدير المسمّاة collections شيء آخر: سجلّ دفعات
  // للمالك، وبوّابتها التصدير الشامل.)
  assert.ok(!/\| "collections"/.test(CENTER),
    "التحصيل تبويب داخل المركز — إخفاء تبويب ليس تفويضًا");
});

test("عقد الواجهة يعلن الأعلام الجديدة كلّها — لا عَلَم يُقرأ وهو غير موجود", () => {
  for (const flag of ["can_view_finance_sensitive", "can_manage_finance", "can_view_collections",
    "can_record_collection", "can_approve_expense", "can_export_sensitive",
    "can_export_collections"]) {
    assert.ok(TS.includes(`${flag}: boolean`), `عقد FinAccess بلا ${flag}`);
    assert.ok(funcBody("finops_access").includes(`'${flag}'`), `finops_access لا تُعيد ${flag}`);
  }
});

test("لا منطق صلاحية في الواجهة: لا مفتاح ولا دور يُقرآن في المتصفّح", () => {
  for (const src of [COLLECTIONS_UI, CENTER]) {
    assert.ok(!/finance_ops\./.test(src), "الواجهة تفحص مفتاح صلاحية بنفسها");
    assert.ok(!/staff_role|account_type|is_owner/.test(src),
      "الواجهة تقرّر الصلاحية من دور المستخدم بدل سؤال الخادم");
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// (٦) حارس الانحدار: أيّ توسيع مستقبليّ يجب أن يكسر اختبارًا هنا
// ─────────────────────────────────────────────────────────────────────────────

test("الحزمة تحمل حارسًا ثابتًا يمنع عودة الثغرة عند أوّل تشغيل", () => {
  assert.match(SQL, /★ الثغرة عادت ★/, "الـSELF-TEST بلا حارس صريح لعودة الوصول الجدوليّ");
  assert.match(SQL, /سطح التحصيل % يقرأ %/, "الـSELF-TEST لا يفحص جسم سطح التحصيل");
  assert.match(SQL, /الصلاحية غير مقسومة/, "الـSELF-TEST لا يفحص قسمة التصدير");
});

test("المُسنَدات المطلوبة موجودة بأسمائها المتّفق عليها ولا تعيد NULL", () => {
  for (const p of [...SENSITIVE_PREDICATES, ...GRANTABLE_PREDICATES]) {
    assert.match(funcDecl(p), /returns boolean/i, `${p} لا تعيد boolean`);
    assert.match(funcBody(p), /coalesce\(/, `${p} قد تعيد NULL — وNULL في «if not» يمرّ كسماح`);
    assert.match(funcBody(p), /auth\.uid\(\) is not null/, `${p} بلا شرط جلسة`);
  }
  // ولا واحد منها مبنيّ على صلاحية المشاريع
  for (const p of [...SENSITIVE_PREDICATES, ...GRANTABLE_PREDICATES]) {
    assert.ok(!/can_manage_projects/.test(funcBody(p)),
      `${p} تعتمد can_manage_projects — مدير المشاريع ليس مديرًا ماليًّا`);
  }
});

test("المفاتيح المعطَّلة موسومة صراحةً — منحها لا يفتح شيئًا ويقول ذلك", () => {
  const perm = section("-- §1) مفاتيح الصلاحيات");
  for (const k of ["finance_ops.view", "finance_ops.manage", "finance_ops.view_profit",
    "finance_ops.manage_receivables", "finance_ops.export"]) {
    const i = perm.indexOf(`'${k}'`);
    assert.ok(i > 0, `المفتاح ${k} غائب عن الكتالوج`);
    assert.match(perm.slice(i, i + 220), /معطَّل في V1/,
      `${k} يبدو قابلًا للمنح بينما لا يفتح شيئًا — فخّ للمالك`);
    // ولا مُسنَد يقرأ هذا المفتاح فعلًا
    assert.ok(!new RegExp(`finops_perm\\('${k.replace(".", "\\.")}'\\)`).test(SQL),
      `${k} ما زال مقروءًا في مُسنَد — الوسم كاذب`);
  }
  for (const k of ["finance_ops.collections_view", "finance_ops.collections_record",
    "finance_ops.export_collections", "finance_ops.approve"]) {
    assert.ok(perm.includes(`'${k}'`), `المفتاح القابل للمنح ${k} غائب عن الكتالوج`);
    assert.ok(SQL.includes(`finops_perm('${k}')`), `${k} مُعلَن ولا يقرؤه أيّ مُسنَد — مفتاح ميت`);
  }
});
