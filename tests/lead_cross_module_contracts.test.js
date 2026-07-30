// ════════════════════════════════════════════════════════════════════════════
// tests/lead_cross_module_contracts.test.js — المرحلة ٩: عقود ما بين الموديولات.
//
// العقد الأهمّ: مسار CRM ينتهي عند «جاهز للتسليم اليدويّ» و**لا يُنشئ مشروعًا**.
// والمالية **مرجع للقراءة فقط**: لا فاتورة، ولا Zoho، ولا ادّعاء تحصيل، ولا
// اعتراف بإيراد. وعقد بيانات لا كتابة متبادلة.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  ROOT, SQL, PREFLIGHT, POSTCHECK, ROLLBACK, DOCS, read, exists,
  funcBody, stripComments, selfTest, API_FNS, INTERNAL_FNS, PREDICATES,
} = require("./lead_helpers.js");

// ─── منصّة المشاريع المجمَّدة ────────────────────────────────────────────────

test("★ الحزمة لا تُنشئ مشروعًا ولا تكتب في المنصّة المجمَّدة ★", () => {
  const code = stripComments(SQL);
  const writes = [
    /insert\s+into\s+public\.projects\b/i,
    /update\s+public\.projects\b/i,
    /delete\s+from\s+public\.projects\b/i,
    /insert\s+into\s+public\.project_core\b/i,
    /update\s+public\.project_core\b/i,
    /insert\s+into\s+public\.deliverables?\b/i,
    /update\s+public\.deliverables?\b/i,
    /insert\s+into\s+public\.project_transition_requests\b/i,
  ];
  for (const rx of writes) {
    // نتخطّى أسطر الحراسة (تعبير نمطيّ يمنع النمط) — هي ذكرٌ يحمي لا يخرق.
    for (const [n, line] of code.split("\n").entries()) {
      if (/[!]?~\*\s*'\(/.test(line)) continue;
      assert.doesNotMatch(line, rx,
        `★ خرق التجميد ★ السطر ${n + 1} يكتب في منصّة المشاريع: ${line.trim()}`);
    }
  }
});

test("★ الحزمة لا تلمس أيّ ملفّ من ملفّات التجميد ★", () => {
  const freeze = JSON.parse(read("tests/fixtures/project_platform_freeze.json"));
  const mine = [
    "docs/lead_scoring_routing_PREFLIGHT.sql",
    "docs/lead_scoring_routing_RUNME.sql",
    "docs/lead_scoring_routing_POSTCHECK.sql",
    "docs/lead_scoring_routing_ROLLBACK.sql",
    DOCS.scoring, DOCS.routing, DOCS.contracts, DOCS.limits,
  ];
  for (const f of mine) {
    assert.ok(exists(f), `ملفّ الحزمة ${f} مفقود`);
    assert.ok(!freeze.paths.includes(f), `ملفّ الحزمة ${f} داخل قائمة التجميد`);
  }
  // ولا ملفّ من ملفّات التجميد أُضيف إليه شيء من هذه الدفعة.
  for (const p of freeze.paths) {
    const full = path.join(ROOT, p);
    if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) continue;
    assert.doesNotMatch(fs.readFileSync(full, "utf8"), /\blsr_/,
      `ملفّ مجمَّد (${p}) يذكر رموز الحزمة الجديدة`);
  }
});

test("مرجع المشروع اختياريّ وللقراءة فقط", () => {
  // لا مفتاح أجنبيّ إلى المنصّة من أيّ جدول في الحزمة.
  assert.doesNotMatch(SQL, /references\s+public\.projects\b/i,
    "مفتاح أجنبيّ إلى منصّة المشاريع — اعتماديّة صلبة على مجمَّد");
  assert.doesNotMatch(SQL, /references\s+public\.project_core\b/i,
    "مفتاح أجنبيّ إلى project_core");
});

// ─── عقد المالية ────────────────────────────────────────────────────────────

test("★ المالية مرجع للقراءة فقط: لا كتابة ولا Zoho ولا إيراد ★", () => {
  const fn = stripComments(funcBody("lsr_finance_reference"));
  assert.doesNotMatch(fn, /insert\s+into\s+public\.fin_/i, "كتابة في المالية");
  assert.doesNotMatch(fn, /update\s+public\.fin_/i, "تحديث في المالية");
  assert.doesNotMatch(fn, /delete\s+from\s+public\.fin_/i, "حذف من المالية");
  // نمنع **النداء** لا **الإعلان**: المخرَج نفسه يقول «لا تنادي Zoho»،
  // وفحصٌ يخلط بين التصريح بعدم الفعل وبين الفعل فحصٌ يُعطَّل.
  assert.doesNotMatch(fn, /fin_zoho_outbox|zoho_push|zoho_sync|zoho_api|public\.\w*zoho/i,
    "نداء أو كتابة Zoho");
  assert.match(fn, /لا تنادي Zoho/, "المخرَج لا يصرّح بأنّه لا ينادي Zoho");
  assert.match(fn, /'revenue_recognized', false/, "لا إعلان بعدم الاعتراف بالإيراد");
  assert.match(fn, /'payment_status_is_read_only', true/,
    "حالة السداد لا تُعلن كقراءة فقط");
  assert.match(fn, /created_by_this_module', false/,
    "مرجع الفاتورة لا يُعلن أنّه خارجيّ");
});

test("عقد المالية يعلن غياب الموديول ولا يعرض صفرًا", () => {
  const fn = funcBody("lsr_finance_reference");
  assert.match(fn, /module_not_enabled/, "غياب الاشتراكات لا يُعلن");
  assert.match(fn, /الغياب يُعلَن ولا يُقرأ صفرًا|لا رصيد ولا مبلغ/,
    "لا شرح للفرق بين «صفر» و«غير مفعّل»");
  assert.match(fn, /receivables_available/,
    "غياب الذمم لا يُميَّز عن «لا ذمم» — وهما ليسا سواء");
});

test("تقدير التجاوز بالوحدات لا بالمال", () => {
  const fn = funcBody("lsr_finance_reference");
  assert.match(fn, /overage_estimate_units/, "التجاوز غير مقدَّر بالوحدات");
});

test("الضريبة حقل مستقلّ في كلّ مخرَج ماليّ", () => {
  const fn = funcBody("lsr_finance_reference");
  for (const k of ["vat_rate", "vat_amount", "price_net", "price_gross"]) {
    assert.ok(fn.includes(k), `الحقل «${k}» غائب — الضريبة لا تُطوى في الإجمالي أبدًا`);
  }
});

// ─── حدود الوحدة ────────────────────────────────────────────────────────────

test("الحزمة لا تكتب في أيّ موديول آخر — قراءة فقط عبر الحدود", () => {
  const code = stripComments(SQL);
  const foreign = ["csub_", "sq_", "fin_", "crm_companies", "crm_activities"];
  for (const prefix of foreign) {
    for (const verb of ["insert\\s+into", "update", "delete\\s+from"]) {
      const rx = new RegExp(`${verb}\\s+public\\.${prefix}`, "i");
      assert.doesNotMatch(code, rx,
        `★ كتابة عبر الحدود ★ الحزمة تكتب في ${prefix}* — العقد بيانات لا كتابة متبادلة`);
    }
  }
});

test("الاستثناء الوحيد المعلَن: عمود مالك العميل المحتمل", () => {
  // الاستثناء مقصود وموثَّق: مصدر واحد للملكية، وبدالّة مبوَّبة ومدقَّقة.
  const code = stripComments(SQL);
  const updates = [...code.matchAll(/update\s+public\.crm_leads/gi)];
  assert.equal(updates.length, 1,
    `الحزمة تكتب في crm_leads في ${updates.length} موضعًا — المتوقَّع موضع واحد داخل lsr_assign`);
  const assign = funcBody("lsr_assign");
  assert.match(assign, /update public\.crm_leads/, "الكتابة الوحيدة ليست داخل lsr_assign");
  assert.match(read(DOCS.routing), /owner_user_id/, "الاستثناء غير موثَّق في عقد التوزيع");
});

test("الحزمة لا تُضعِف نموذج صلاحيات أيّ موديول منتهٍ", () => {
  const code = stripComments(SQL);
  // لا إنشاء ولا استبدال لدوالّ الموديولات الأخرى.
  for (const prefix of ["crm_", "csub_", "sq_", "comms_", "fin_", "finops_"]) {
    const rx = new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${prefix}`, "i");
    assert.doesNotMatch(code, rx,
      `★ خرق ★ الحزمة تعيد تعريف دالّة في الموديول ${prefix}*`);
  }
  // ولا سياسات على جداولهم.
  assert.doesNotMatch(code, /create\s+policy[^\n]*on\s+public\.(crm|csub|sq|comms|fin)_/i,
    "الحزمة تُنشئ سياسة على جدول موديول آخر");
  assert.doesNotMatch(code, /alter\s+table\s+public\.(crm|csub|sq|comms|fin)_/i,
    "الحزمة تُعدّل بنية جدول موديول آخر");
});

test("★ لا منح anon في أيّ موضع ★", () => {
  const code = stripComments(SQL);
  assert.doesNotMatch(code, /grant\s+(execute|select|all)[^\n]*\bto\s+anon\b/i,
    "منحة anon — لا مسار مجهول إلى بيانات تجارية");
  assert.match(code, /revoke all on function %s from anon/,
    "لا سحب صريح لصلاحية anon");
});

// ─── التوثيق ────────────────────────────────────────────────────────────────

test("الوثائق الأربع موجودة وتحمل عقودها", () => {
  for (const [k, p] of Object.entries(DOCS)) {
    assert.ok(exists(p), `الوثيقة ${k} (${p}) مفقودة`);
    assert.ok(read(p).length > 1200, `الوثيقة ${p} أقصر من أن تكون عقدًا`);
  }
});

test("عقد التسليم اليدويّ مكتوب بالنصّ", () => {
  const doc = read(DOCS.contracts);
  for (const step of ["lead", "qualified", "quote draft", "quote approved",
                      "quote accepted", "READY FOR MANUAL HANDOFF"]) {
    assert.ok(doc.includes(step), `عقد التسليم لا يذكر المرحلة «${step}»`);
  }
  assert.match(doc, /لا يُنشئ مشروعًا|لا يُنشأ مشروع/,
    "عقد التسليم لا يعلن أنّه لا يُنشئ مشروعًا");
});

test("العقود تعلن الخطوط الحمراء المُورَّثة ولم تُمسّ", () => {
  const doc = read(DOCS.contracts);
  for (const k of ["مُرحِّل البريد المجهول", "حجز مزدوج", "ربحية",
                   "تحصيل", "can_manage_projects"]) {
    assert.ok(doc.includes(k), `العقود لا تذكر الخطّ الأحمر «${k}»`);
  }
});

test("وثيقة الحدود صادقة عن التعطيل والمؤجَّل", () => {
  const limits = read(DOCS.limits);
  for (const k of ["معطّل", "dry_run", "لا يُنشأ مشروع", "مؤجَّل", "PREFLIGHT"]) {
    assert.ok(limits.includes(k), `وثيقة الحدود لا تذكر «${k}»`);
  }
  assert.match(limits, /صفر مندوبين/,
    "وثيقة الحدود لا تحذّر من الحالة التي ستُقرأ عطلًا بعد التركيب مباشرة");
});

test("الفحص الذاتيّ يحرس عقدي المنصّة والمالية", () => {
  const st = selfTest();
  assert.match(st, /project_core|projects/, "الفحص الذاتيّ لا يحرس تجميد المنصّة");
  assert.match(st, /payment_status_is_read_only/, "الفحص الذاتيّ لا يحرس عقد المالية");
  assert.match(st, /zoho/i, "الفحص الذاتيّ لا يمنع نداء Zoho");
});

test("POSTCHECK يحمل صفوف العقود، وكلّها قادرة على الإخفاق", () => {
  assert.match(POSTCHECK, /لا كتابة في منصّة المشاريع/, "POSTCHECK بلا صفّ لتجميد المنصّة");
  assert.match(POSTCHECK, /المالية مرجع للقراءة فقط/, "POSTCHECK بلا صفّ لعقد المالية");
  const i = POSTCHECK.indexOf("(٧) العقود");
  assert.ok(i > 0, "قسم العقود غائب عن POSTCHECK");
  assert.match(POSTCHECK.slice(i, i + 2500), /'FAIL'/,
    "قسم العقود بلا فرع FAIL — فحص لا يفشل ليس فحصًا");
});
