// ════════════════════════════════════════════════════════════════════════════
// tests/talent_sql_contract.test.js — عقد حزمة الـSQL.
// أربعة ملفّات · معاملة واحدة · idempotency · مُسنَدات لا تعيد NULL ·
// تدقيق كلّ كتابة حسّاسة · صدق الـself-test · لا anon · لا سياسة كتابة مباشرة.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  exists, SQL, PREFLIGHT, POSTCHECK, ROLLBACK,
  funcDecl, funcBody, selfTest, tableDef, TABLES, PREDICATES,
} = require("./talent_helpers.js");

test("الحزمة أربعة ملفّات وكلّها موجودة", () => {
  for (const f of ["PREFLIGHT", "RUNME", "POSTCHECK", "ROLLBACK"]) {
    assert.ok(exists(`docs/talent_vendor_network_${f}.sql`), `الملفّ ${f} مفقود`);
  }
});

test("PREFLIGHT وPOSTCHECK للقراءة فقط — لا كتابة ولا DDL ولا معاملة", () => {
  for (const [name, src] of [["PREFLIGHT", PREFLIGHT], ["POSTCHECK", POSTCHECK]]) {
    assert.doesNotMatch(src, /^\s*(insert|update|delete|create|alter|drop|grant|revoke|truncate)\b/im,
      `${name}: يحتوي كتابة أو DDL`);
    assert.doesNotMatch(src, /^\s*(begin|commit);/im, `${name}: يفتح معاملة`);
  }
});

/** إسقاط أسطر التعليق، كي لا يُطابَق نصّ شرح بدل تعليمة حقيقية. */
const stripComments = (src) =>
  src.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");

test("POSTCHECK مجموعة نتائج واحدة، وساكن، وبلا مصيدة catch-all", () => {
  const code = stripComments(POSTCHECK);
  const statements = (code.match(/;/g) || []).length;
  assert.equal(statements, 1, "POSTCHECK يُنتج أكثر من مجموعة نتائج واحدة");
  assert.match(code.trim(), /^with\b/i, "POSTCHECK لا يبدأ باستعلام واحد");
  // ساكن: لا استدعاء لبوّابة حيّة (المحرّر auth.uid()=NULL).
  for (const p of PREDICATES) {
    assert.doesNotMatch(POSTCHECK, new RegExp(`select\\s+public\\.${p}\\s*\\(`, "i"),
      `POSTCHECK يستدعي البوّابة الحيّة ${p} — ستُقرأ false على أنّها عطل`);
  }
  // كلّ صفّ قادر على الفشل: لا بدّ من وجود FAIL بكثرة.
  assert.ok((POSTCHECK.match(/'FAIL'/g) || []).length > 25, "POSTCHECK بلا قدرة حقيقية على الفشل");
});

test("RUNME داخل معاملة واحدة، وينتهي بإعادة تحميل المخطّط", () => {
  assert.match(SQL, /\nbegin;[\s\S]*\ncommit;/, "ليس داخل معاملة");
  assert.match(SQL, /notify pgrst, 'reload schema';/,
    "لا إعادة تحميل مخطّط — الواجهة ستقرأ PGRST202 كاذبًا بعد ترحيلة ناجحة");
  const pre = SQL.slice(0, SQL.indexOf("\nbegin;"));
  assert.match(pre, /do \$pre\$[\s\S]*raise exception 'TALENT PREFLIGHT/i,
    "لا PREFLIGHT صلب يوقف التشغيل قبل كتابة أيّ شيء");
});

test("لا CONCURRENTLY داخل المعاملة", () => {
  const code = SQL.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
  assert.doesNotMatch(code, /concurrently/i, "CONCURRENTLY لا يعمل داخل معاملة");
});

test("Idempotency: كلّ إنشاء يحتمل إعادة التشغيل", () => {
  for (const t of TABLES) {
    assert.match(SQL, new RegExp(`create table if not exists public\\.${t}\\b`),
      `الجدول ${t} لا يُنشأ بصيغة if not exists`);
  }
  const badIndex = SQL.match(/create\s+(unique\s+)?index\s+(?!if not exists)/gi) || [];
  assert.deepEqual(badIndex, [], "فهرس بلا if not exists");
  // السياسات تُسقَط قبل الإنشاء (لا يوجد create policy if not exists).
  const policies = SQL.match(/create policy (\w+)/g) || [];
  assert.ok(policies.length > 0, "لا سياسات");
  for (const p of policies) {
    const name = p.split(" ")[2];
    assert.match(SQL, new RegExp(`drop policy if exists ${name}\\b`),
      `السياسة ${name} تُنشأ بلا drop مسبق — إعادة التشغيل ستفشل`);
  }
  // البذور بـon conflict.
  const inserts = SQL.match(/insert into public\.\w+\([\s\S]*?\)\s*values/g) || [];
  assert.ok(inserts.length > 0);
  assert.ok((SQL.match(/on conflict/g) || []).length >= 4, "بذور بلا on conflict");
});

test("كلّ مُسنَد: security definer · search_path مثبَّت · لا يعيد NULL", () => {
  for (const p of PREDICATES) {
    const decl = funcDecl(p);
    assert.match(decl, /returns boolean/i, `${p} لا يعيد boolean`);
    assert.match(decl, /security definer/i, `${p} ليس security definer`);
    assert.match(decl, /set search_path\s*=\s*public/i, `${p} بلا search_path مثبَّت`);
    const body = funcBody(p);
    assert.ok(/coalesce\(/i.test(body) || /return false/i.test(body),
      `${p} قد يعيد NULL — كلّ سياسة فوقه تصير «غير محدَّد» وهو ليس منعًا`);
    assert.match(body, /return false/i, `${p} بلا مسار fail-closed صريح`);
  }
});

test("كلّ كتابة حسّاسة مُدقَّقة، والمحاولات المرفوضة تُسجَّل أيضًا", () => {
  const writes = [
    "tvn_profile_upsert", "tvn_profile_set_status", "tvn_rates_set", "tvn_bank_set",
    "tvn_restricted_set", "tvn_document_upsert", "tvn_document_verify",
    "tvn_assignment_propose", "tvn_assignment_approve", "tvn_assignment_confirm",
    "tvn_review_submit", "tvn_review_close", "tvn_review_correct",
    "tvn_promote_opportunity", "tvn_vendor_link",
  ];
  for (const w of writes) {
    const body = funcBody(w);
    assert.match(body, /tvn_log\(/, `${w} لا يكتب سجلّ تدقيق`);
  }
  // المرفوض يُسجَّل بـfalse قبل رفع الاستثناء، في المسارات الحسّاسة على الأقلّ.
  for (const w of ["tvn_rates_set", "tvn_bank_set", "tvn_restricted_set",
                   "tvn_document_verify", "tvn_assignment_propose", "tvn_review_submit"]) {
    assert.match(funcBody(w), /tvn_log\([^)]*false/s,
      `${w} لا يسجّل المحاولة المرفوضة — المنع بلا أثر لا يُحقَّق فيه`);
  }
});

test("SELF-TEST ساكن: يقرأ التعاريف ولا يستدعي بوّابة حيّة", () => {
  const st = selfTest();
  assert.match(st, /pg_get_functiondef/, "SELF-TEST لا يقرأ التعاريف");
  for (const p of PREDICATES) {
    assert.doesNotMatch(st, new RegExp(`select\\s+public\\.${p}\\s*\\(`, "i"),
      `SELF-TEST يستدعي البوّابة الحيّة ${p} — سترفع not authorized وتُسقط الترحيلة`);
  }
  // المطابقة على مُعرِّفات صغيرة الحروف لا كلمات مفتاحية (الـdeparser يرفع الحالة).
  assert.doesNotMatch(st, /ilike '%COALESCE%'/, "SELF-TEST يطابق كلمة مفتاحية يرفع الـdeparser حالتها");
  // لا مصيدة تجعل الفحص يمرّ دائمًا.
  assert.doesNotMatch(st, /exception\s+when\s+others\s+then\s+null/i, "SELF-TEST يبتلع أخطاءه");
  assert.ok((st.match(/raise exception 'SELF-TEST/g) || []).length >= 15,
    "SELF-TEST بتأكيدات قليلة جدًّا");
});

test("ROLLBACK صادق: يقول ماذا يُفقَد، وهدمه معلَّق", () => {
  // ★ المستوى ١ حيّ عمدًا (سحب تنفيذ + تعطيل أحداث، بلا فقدان بيانات) ★
  // لكنّ أيّ سطر هدم غير معلَّق ممنوع.
  const destructive = ROLLBACK.split("\n")
    .filter((l) => /^\s*(drop|delete|truncate|alter table[\s\S]*drop column)\b/i.test(l));
  assert.deepEqual(destructive, [], "ROLLBACK يحتوي سطر هدم غير معلَّق");
  assert.match(ROLLBACK, /يحذف عمودًا من public\.custody_vendors|custody_vendors\.tvn_profile_id/,
    "ROLLBACK لا يصرّح بأنّه يلمس جدول مورّدين حيّ");
  assert.match(ROLLBACK, /tvn_reviews/, "ROLLBACK لا يذكر فقدان التقييمات");
  assert.match(ROLLBACK, /tvn_audit/, "ROLLBACK لا يذكر فقدان سجلّ التدقيق");
  assert.match(ROLLBACK, /نسخة احتياطية/, "ROLLBACK بلا خطوة نسخة احتياطية");
  // لا يمسّ ما ليس له.
  assert.doesNotMatch(ROLLBACK, /^\s*drop table if exists public\.(custody_vendors|opportunity_requests|projects)/im,
    "ROLLBACK يسقط جدولًا خارج الوحدة");
});

test("لا anon، ولا سياسة كتابة مباشرة، ولا خدمة service_role", () => {
  assert.doesNotMatch(SQL, /grant[^;]*to anon/i, "منح لـanon");
  assert.doesNotMatch(SQL, /service_role/i, "ذكر service_role داخل الترحيلة");
  const writePolicies = SQL.match(/create policy \w+ on public\.tvn_\w+ for (insert|update|delete|all)/gi) || [];
  assert.deepEqual(writePolicies, [], "سياسة كتابة مباشرة — الكتابة يجب أن تمرّ عبر RPC");
});

test("البيانات البنكية وصفية فقط — قيد يمنع IBAN كاملًا", () => {
  const def = tableDef("tvn_profile_bank");
  assert.match(def, /iban_last4[\s\S]*\^\[0-9\]\{1,4\}\$/,
    "لا قيد يمنع تخزين رقم حساب كامل");
  assert.doesNotMatch(def, /\biban\b(?!_last4)/i, "عمود IBAN كامل في الجدول");
  assert.match(funcBody("tvn_bank_set"), /آخر أربعة أرقام فقط/,
    "دالّة الكتابة لا ترفض IBAN الكامل برسالة واضحة");
});

test("جدول التوافر يحمل النطاقات والمدن والسفر والحجب والمصدر والتأكيد", () => {
  const def = tableDef("tvn_availability");
  for (const col of ["starts_on", "ends_on", "cities", "travel_willing", "remote_ok",
                     "is_blackout", "source", "confirmation_status"]) {
    assert.match(def, new RegExp(`\\b${col}\\b`), `عمود التوافر ${col} مفقود`);
  }
  assert.match(def, /check \(ends_on >= starts_on\)/, "نطاق تاريخ مقلوب مسموح");
});
