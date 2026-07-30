// ════════════════════════════════════════════════════════════════════════════
// tests/cross_module_notification_contract.test.js
//
// ★ الإشعار المفقود بصمت ★
// public.notifications.entity_type محصور في phase0_migration.sql:285 بخمس قيم من
// عهد المشاريع: ('profile','company','quote_request','project','deliverable').
// ولا ترحيلة في المستودع كلّه توسّعه بعدها — 9C عالج notifications_type_check
// وحده وترك هذا.
//
// ومركز التشغيل يكتب 'ops_job'، والمبيعات تكتب 'crm_opportunity'. السلسلة
// كاملةً: القيد يرفع 23514 ⇒ المصيدة `exception when others then null` تبتلعه ⇒
// العملية تنجح ظاهريًّا ولا يصل الإشعار ولا يبقى له أثر. مصوِّر يُسنَد ولا يعلم،
// وفرصة تُربَح ولا يعلم مالكها، والشاشة خضراء.
//
// هذه الاختبارات تحرس الطرفين معًا: أنّ القيد يُوسَّع إلى **شكل** لا تعداد، وأنّ
// المصيدة لم تعد تبتلع بلا أثر.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const OPS = read("docs/operations_center_RUNME.sql");
const CRM = read("docs/crm_sales_FOUNDATION_RUNME.sql");
const OPS_RB = read("docs/operations_center_ROLLBACK.sql");
const CRM_RB = read("docs/crm_sales_FOUNDATION_ROLLBACK.sql");
const PHASE0 = read("docs/phase0_migration.sql");
const AUDIT = read("docs/CROSS_MODULE_SECURITY_AUDIT.md");
const CONTRACTS = read("docs/CROSS_MODULE_DATA_CONTRACTS.md");

const MODULES = [
  { name: "operations", sql: OPS, rb: OPS_RB, entity: "ops_job", fn: "prodops_notify", log: "prodops_log" },
  { name: "crm", sql: CRM, rb: CRM_RB, entity: "crm_opportunity", fn: "crm_notify", log: "crm_log" },
];

test("★ العيب مثبَت في المستودع: التعداد لا يشمل قيم الموديولين ★", () => {
  // لو حُذف هذا القيد يومًا من phase0 فسقط سبب الإصلاح — هذا الاختبار يخبرنا.
  assert.match(PHASE0, /entity_type text not null check \(entity_type in \(/,
    "قيد entity_type التعداديّ اختفى من phase0 — راجع مبرّر الإصلاح");
  const m = PHASE0.match(/entity_type text not null check \(entity_type in \(([^)]*)\)/);
  assert.ok(m, "تعذّرت قراءة التعداد");
  for (const e of ["ops_job", "crm_opportunity"]) {
    assert.ok(!m[1].includes(e), `التعداد يشمل ${e} أصلًا — راجع هذا الاختبار`);
  }
});

for (const M of MODULES) {
  test(`${M.name}: القيد يُستبدَل بشكل لا تعداد، وبإدراك للصفوف القائمة`, () => {
    const blk = M.sql.slice(M.sql.indexOf("do $notif_shape$"),
                            M.sql.indexOf("end $notif_shape$;"));
    assert.ok(blk.length > 100, "كتلة توسعة القيد غير موجودة");
    assert.match(blk, /\^\[a-z\]\[a-z0-9_\]\{2,40\}\$/, "القيد الجديد ليس قيد شكل");
    // ★ يُزال كلّ قيد يقيّد entity_type مهما كان اسمه ★
    //   إزالة الاسم القانونيّ وحده كانت تترك قيدًا منجرف الاسم (…_check1) يرفض
    //   بصمت بينما يبدو القيد القانونيّ سليمًا — أي العطب نفسه مختبئًا خلف فحص ناجح.
    assert.match(blk, /drop constraint %I/, "القيد القديم لا يُزال — التعداد يبقى ويرفض");
    assert.match(blk, /contype = 'c'[\s\S]{0,160}entity_type/,
      "الإزالة مقصورة على اسم واحد — قيد منجرف الاسم سيبقى يرفض بصمت");
    assert.ok(!/drop constraint if exists notifications_entity_type_check/.test(blk),
      "الإزالة ما زالت بالاسم القانونيّ وحده");
    // اكتشاف قبل الكتابة: غياب الجدول لا يُسقط الترحيلة
    assert.match(blk, /to_regclass\('public\.notifications'\)/,
      "الكتلة لا تكتشف وجود الجدول أوّلًا");
    // ★ لا تُطبَّق على صفوف مخالفة: إشعار لا انهيار ولا حذف
    assert.match(blk, /entity_type !~ '\^\[a-z\]/,
      "لا فحص للصفوف القائمة قبل تشديد الشكل");
    assert.match(blk, /raise notice/, "الحالة التي يُترك فيها القيد لا تُعلَن");
    assert.ok(!/delete from public\.notifications/.test(blk),
      "الكتلة تحذف بيانات إشعارات — غير مقبول");
  });

  test(`${M.name}: الكتلة متساوية القوّة الذاتية فلا يهمّ ترتيب تشغيل الحزمتين`, () => {
    const blk = M.sql.slice(M.sql.indexOf("do $notif_shape$"),
                            M.sql.indexOf("end $notif_shape$;"));
    // الشكل نفسه في الحزمتين ⇒ أيّهما شُغّلت أخيرًا تُنتج القيد نفسه.
    assert.match(blk, /add constraint notifications_entity_type_check/,
      "اسم القيد غير موحّد بين الحزمتين — تنازُع");
    assert.ok(!/'ops_job'|'crm_opportunity'/.test(blk),
      "الكتلة تُثبّت مفردة موديول بعينه في القيد — الحزمة الأخرى ستكسرها");
  });

  test(`${M.name}: فشل الإشعار لم يعد يُبتلَع بلا أثر`, () => {
    const re = new RegExp(
      "create\\s+or\\s+replace\\s+function\\s+public\\." + M.fn +
        "\\s*\\([^)]*\\)[\\s\\S]*?\\bas\\s*\\$\\$([\\s\\S]*?)\\$\\$\\s*;", "i");
    const body = M.sql.match(re);
    assert.ok(body, `تعذّر إيجاد ${M.fn}`);
    const b = body[1];
    assert.match(b, new RegExp(`${M.log}\\('notify_failed'`),
      "المصيدة ما زالت `then null` بلا أثر — «لم يصل الإشعار» سؤال بلا جواب");
    assert.match(b, /get stacked diagnostics/, "رمز الحالة لا يُلتقَط، فلا يُعرف سبب الفشل");
    assert.match(b, new RegExp(`${M.log}\\('notify_unavailable'`),
      "غياب public.notify نفسه يمرّ صامتًا");
    // ولا يُسقط المعاملة رغم ذلك: العملية التشغيلية/البيعية صحيحة ولا تُلغى
    assert.match(b, /exception when others then null/,
      "كتابة الأثر نفسها قد تُسقط المعاملة — التدقيق لا يجوز أن يكسر العمل");
  });

  test(`${M.name}: اختبار ذاتيّ في SQL يستطيع أن يفشل`, () => {
    const st = M.sql.slice(M.sql.lastIndexOf("do $st$"));
    const i = st.indexOf("pg_get_constraintdef(con.oid) ilike '%entity_type%'");
    assert.ok(i > 0, "الاختبار الذاتيّ لا يفحص قيود entity_type");
    const seg = st.slice(i - 400, i + 700);
    assert.ok(seg.includes(M.entity),
      `الاختبار الذاتيّ لا يتحقّق من قبول ${M.entity}`);
    assert.match(seg, /string_agg|exists/,
      "الاختبار يفحص قيدًا واحدًا باسمه — قيد منجرف الاسم يفلت");
    assert.match(st, /notify_failed/, "الاختبار الذاتيّ لا يمنع عودة المصيدة الصامتة");
    // to_regclass لا ::regclass: الأخير يرفع 42P01 ويُسقط الترحيلة عند غياب الجدول
    assert.match(seg, /to_regclass\('public\.notifications'\)/,
      "الاختبار يستعمل ::regclass — يُسقط الترحيلة عند غياب الجدول بدل أن يتخطّى");
  });

  test(`${M.name}: الـROLLBACK يقول صراحةً إنّ القيد لا يُعاد إلى تعداده`, () => {
    assert.match(M.rb, /notifications_entity_type_check|قيد notifications\.entity_type/,
      "الـROLLBACK صامت عن القيد — قد يُعاد التعداد فيُكسَر الموديول الآخر");
  });
}

test("النوع المكتوب ليس في القائمة البيضاء لجسر البريد — لا مُرسِلان لحدث واحد", () => {
  const CORE = read("docs/project_core_ABSOLUTE_FINAL_RUNME.sql");
  const bridge = CORE.slice(CORE.indexOf("create or replace function public.pc_notify_email_bridge"),
                            CORE.indexOf("drop trigger if exists trg_notif_email_bridge"));
  assert.ok(bridge.length > 100, "جسر البريد غير موجود — راجع هذا الاختبار");
  for (const t of ["ops_crew_assigned", "ops_post_handoff", "crm_opportunity_won"]) {
    assert.ok(!bridge.includes(t),
      `النوع ${t} دخل قائمة جسر البريد — بريد ثانٍ لحدث واحد`);
  }
});

test("التوثيق يشرح العيب بأدلّة ملفّ:سطر لا بوصف عامّ", () => {
  assert.match(AUDIT, /phase0_migration\.sql:285/, "التدقيق بلا دليل سطر على مصدر القيد");
  assert.match(AUDIT, /23514/, "التدقيق لا يذكر رمز الخطأ الفعليّ");
  assert.match(CONTRACTS, /entity_type/, "عقود البيانات لا توثّق هذا العقد الضمنيّ");
});

test("SAFE: ساكن فقط (لا قاعدة ولا شبكة)", () => {
  assert.ok(OPS.length > 0 && CRM.length > 0 && PHASE0.length > 0);
});
