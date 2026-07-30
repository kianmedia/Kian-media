// ════════════════════════════════════════════════════════════════════════════
// tests/compliance_sql_package.test.js — عقد حزمة الـSQL نفسها.
//
// أربعة ملفّات · RUNME معامليّ وقابل لإعادة التشغيل · PREFLIGHT **يُفشل** ولا
// يكتفي بالتحذير · POSTCHECK للقراءة فقط وبمجموعة نتائج واحدة · الفحوص الذاتية
// ساكنة لا تنادي دالّة محميّة · ROLLBACK صادق ولا يُشغَّل بالخطأ.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  SQL, PREFLIGHT, POSTCHECK, ROLLBACK, CODE, FILES, DOCS, exists,
  stripCommentsAndStrings, selfTest, createdTables, createdFunctions,
  NEW_TABLES, FORBIDDEN_REGISTRIES,
} = require("./compliance_helpers.js");

test("الحزمة أربعة ملفّات وكلّها موجودة", () => {
  for (const [name, p] of Object.entries(FILES)) {
    assert.ok(exists(p), `${name} مفقود: ${p}`);
  }
});

test("الوثائق الستّ موجودة", () => {
  for (const [name, p] of Object.entries(DOCS)) {
    assert.ok(exists(p), `وثيقة ${name} مفقودة: ${p}`);
  }
});

test("PREFLIGHT وPOSTCHECK للقراءة فقط — لا كتابة ولا DDL", () => {
  for (const [name, src] of [["PREFLIGHT", PREFLIGHT], ["POSTCHECK", POSTCHECK]]) {
    const code = stripCommentsAndStrings(src);
    assert.doesNotMatch(code, /^\s*(insert|update|delete|truncate|grant|revoke)\b/im,
      `${name}: يحتوي كتابة`);
    assert.doesNotMatch(code, /^\s*(create|alter|drop)\s+(table|function|index|policy|trigger)/im,
      `${name}: يحتوي DDL`);
  }
});

test("★ PREFLIGHT يُفشل ولا يكتفي بالتحذير", () => {
  // PREFLIGHT يطبع جداول ثمّ يرفع استثناءً. لو اكتفى بـnotice لمرّ المشغّل إلى
  // RUNME ظانًّا أنّه فحص، والفشل سيقع بعدها على سجلّ وثائق حقيقيّ.
  assert.match(PREFLIGHT, /raise\s+exception/i, "PREFLIGHT لا يرفع استثناءً");
  const raises = (PREFLIGHT.match(/raise\s+exception/gi) || []).length;
  assert.ok(raises >= 5, `PREFLIGHT يرفع ${raises} استثناءات فقط — التغطية ضعيفة`);
});

test("★★ PREFLIGHT يمنع التشغيل إن وُجد صفّ يشير إلى bucket آخر", () => {
  // هذه هي الثغرة التي جاءت الحزمة لإغلاقها. لو مرّ PREFLIGHT فوقها لفشل القيد
  // داخل RUNME برسالة 23514 غامضة بدل تفسير مقروء.
  assert.match(PREFLIGHT, /storage_bucket\s+is\s+not\s+null\s*\n?\s*and\s+storage_bucket\s*<>\s*'compliance-documents'/i,
    "PREFLIGHT لا يفحص مراجع التخزين المخالفة");
  assert.match(PREFLIGHT, /لن يعدّل أيّ ملفّ في هذه الحزمة مرجع تخزين قائم تلقائيًّا/,
    "PREFLIGHT لا يصرّح بأنّه لا يعدّل مرجع تخزين تلقائيًّا");
});

test("★ POSTCHECK **مجموعة نتائج واحدة** — المحرّر يعرض الأخيرة فقط", () => {
  const code = stripCommentsAndStrings(POSTCHECK);
  const stmts = code.split(";").filter((s) => s.trim().length > 0);
  assert.equal(stmts.length, 1,
    `POSTCHECK يُرجع ${stmts.length} مجموعة نتائج — يجب أن تكون واحدة`);
});

test("★ POSTCHECK ساكن: لا نداء لأيّ RPC محميّة", () => {
  // محرّر SQL يعمل بدور postgres وauth.uid() = NULL: نداء دالّة محميّة يرفع
  // «not authorized» فيقتل الفحص كلّه.
  const code = stripCommentsAndStrings(POSTCHECK);
  for (const fn of [
    "vcc_readiness", "vcc_grant_open", "vcc_grant_issue", "vcc_document_list",
    "vcc_registration_status_board", "vcc_access", "vcc_scan_compliance",
    "can_view_compliance_center", "can_manage_vendor_registration",
  ]) {
    assert.doesNotMatch(
      code,
      new RegExp(`public\\.${fn}\\s*\\((?!\\s*(uuid|jsonb|text|boolean|timestamptz|int|numeric)\\s*[,)])`, "i"),
      `POSTCHECK ينادي ${fn} فعليًّا بدل فحص جسمها`,
    );
  }
  assert.match(code, /pg_get_functiondef/, "POSTCHECK لا يفحص الأجسام ساكنًا");
});

test("★ POSTCHECK بنيويّ بالكامل: لا FROM على جدول تطبيقيّ", () => {
  // PostgreSQL يحلّ أسماء الجداول وقت التحليل: ذكر جدول غائب في FROM ينهار
  // بـ42P01 ويقتل الملفّ بدل أن يُبلّغ عن الغياب.
  const code = stripCommentsAndStrings(POSTCHECK);
  const froms = [...code.matchAll(/\b(from|join)\s+(public|storage)\.([a-z0-9_]+)/gi)].map((m) => m[3]);
  assert.deepEqual(froms, [], `POSTCHECK يشير مباشرةً إلى: ${froms.join(", ")}`);
});

test("★ POSTCHECK بلا مصيدة catch-all — كلّ صفّ قادر على الفشل", () => {
  const code = stripCommentsAndStrings(POSTCHECK);
  // صفّ ينتهي بـ`, true` هو صفّ معلوماتيّ (ℹ️) وحده. أيّ صفّ آخر يجب أن يحمل
  // تعبيرًا منطقيًّا حقيقيًّا، وإلّا لمرّ الفحص مهما كانت الحال.
  const alwaysTrue = (code.match(/,\s*true\s*\n\s*union all/gi) || []).length;
  const infoRows = (POSTCHECK.match(/'ℹ️/g) || []).length;
  assert.ok(alwaysTrue <= infoRows,
    `${alwaysTrue} صفًّا يمرّ دائمًا مقابل ${infoRows} صفًّا معلوماتيًّا — يوجد فحص لا يفشل أبدًا`);
});

test("RUNME معاملة واحدة · idempotent · بلا CONCURRENTLY", () => {
  assert.match(CODE, /^\s*begin;/m, "RUNME بلا begin");
  assert.match(CODE, /^\s*commit;/m, "RUNME بلا commit");
  assert.doesNotMatch(CODE, /concurrently/i, "RUNME يستعمل CONCURRENTLY (لا يعمل داخل معاملة)");
  // كلّ إنشاء جدول idempotent، وكلّ دالّة create or replace.
  const rawCreates = [...CODE.matchAll(/create\s+table\s+(?!if\s+not\s+exists)/gi)];
  assert.equal(rawCreates.length, 0, "create table بلا if not exists ⇒ إعادة التشغيل تفشل");
  const rawFns = [...CODE.matchAll(/create\s+function\s+/gi)];
  assert.equal(rawFns.length, 0, "create function بلا or replace");
});

test("★ RUNME يحمل PREFLIGHT صلبًا قبل begin — لا نصف ترحيلة", () => {
  const beginAt = CODE.search(/^\s*begin;/m);
  const head = CODE.slice(0, beginAt);
  assert.match(head, /raise\s+exception/i, "لا بوّابة قبل begin");
  assert.match(head, /tvn_documents/, "البوّابة لا تتحقّق من سجلّ الوثائق");
  assert.match(head, /sha256/i, "البوّابة لا تتحقّق من دالّة التهشيم");
});

test("★★ لا سجلّ وثائق ثالث", () => {
  const tables = createdTables();
  for (const bad of FORBIDDEN_REGISTRIES) {
    assert.ok(!tables.includes(bad), `أُنشئ سجلّ وثائق ثانٍ: ${bad}`);
  }
  // والحزمة توسّع القائم فعلًا.
  assert.match(CODE, /alter\s+table\s+public\.tvn_documents/i,
    "الحزمة لا توسّع tvn_documents — فأين تُخزَّن وثائق الشركة؟");
});

test("الجداول المُنشأة هي الخمسة عشر المعلنة ولا شيء غيرها", () => {
  const tables = createdTables().sort();
  assert.deepEqual(tables, [...NEW_TABLES].sort(),
    `فرق في الجداول:\nالمُنشأ: ${tables.join(", ")}`);
});

test("★ الفحص الذاتيّ ساكن — لا نداء لدالّة محميّة داخل RUNME", () => {
  const st = stripCommentsAndStrings(selfTest());
  assert.ok(st.length > 500, "كتلة SELF-TEST مفقودة أو فارغة");
  assert.match(st, /pg_get_functiondef/, "الفحص الذاتيّ لا يقرأ الأجسام");
  for (const fn of ["vcc_readiness", "vcc_access", "vcc_grant_issue", "vcc_document_list"]) {
    assert.doesNotMatch(
      st,
      new RegExp(`(perform|select)\\s+public\\.${fn}\\s*\\(`, "i"),
      `الفحص الذاتيّ ينادي ${fn} فعليًّا — سيموت تحت دور postgres`,
    );
  }
});

test("★ الفحص الذاتيّ بلا catch-all — كلّ تأكيد قادر على الفشل", () => {
  const st = selfTest();
  const raises = (st.match(/raise\s+exception/gi) || []).length;
  assert.ok(raises >= 20, `الفحص الذاتيّ يرفع ${raises} استثناءً فقط`);
  assert.doesNotMatch(st, /exception\s+when\s+others\s+then\s+null/i,
    "الفحص الذاتيّ يبتلع أخطاءه — فيمرّ مهما كانت الحال");
});

test("ROLLBACK صادق: الأقسام المُتلفة معطَّلة بالتعليق", () => {
  const lines = ROLLBACK.split("\n");
  const activeDrops = lines.filter(
    (l) => /^\s*(drop\s+table|delete\s+from|drop\s+column|alter\s+table[^\n]*drop\s+column)/i.test(l),
  );
  assert.deepEqual(activeDrops, [],
    `ROLLBACK يحذف بيانات بلا تعليق:\n${activeDrops.join("\n")}`);
});

test("★ ROLLBACK يقول صراحةً إنّ الحذف يُتلف تاريخًا حقيقيًّا", () => {
  for (const phrase of [
    "يُتلف بيانات حقيقية",
    "دليل من فتح أيّ وثيقة",
    "دليل التسليم اليدويّ",
  ]) {
    assert.ok(ROLLBACK.includes(phrase), `ROLLBACK لا يحذّر: «${phrase}»`);
  }
  // ولا يحذف الأعمدة التي ليست من هذه الحزمة.
  assert.match(ROLLBACK, /الأعمدة المستثناة صراحةً/, "ROLLBACK لا يستثني الأعمدة القديمة");
  assert.match(ROLLBACK, /verified · verified_by · verified_at/, "ROLLBACK لا يسمّي الأعمدة المستثناة");
});

test("★ ROLLBACK لا يحذف tvn_doc_valid (دالّة حزمة الشبكة)", () => {
  const code = stripCommentsAndStrings(ROLLBACK);
  assert.doesNotMatch(code, /drop\s+function[^\n;]*tvn_doc_valid/i,
    "ROLLBACK يحذف الدالّة التي تعتمد عليها شبكة المواهب كلّها");
});

test("★ ROLLBACK يحذف الدالّة المستعملة في سياسة التخزين **بعد** السياسة", () => {
  const code = stripCommentsAndStrings(ROLLBACK);
  const policyAt = code.search(/drop\s+policy[^\n]*compliance documents read/i);
  const fnAt = code.search(/drop\s+function[^\n]*vcc_storage_readable/i);
  assert.ok(policyAt >= 0 && fnAt >= 0, "أحد السطرين مفقود");
  assert.ok(policyAt < fnAt,
    "حذف vcc_storage_readable قبل السياسة يجعل كلّ قراءة من الـbucket تنهار بخطأ غامض");
});

test("كلّ الدوالّ المُنشأة تحمل search_path مثبَّتًا", () => {
  const fns = createdFunctions();
  assert.ok(fns.length >= 40, `عدد الدوالّ ${fns.length} — أقلّ من المتوقّع`);
  const blocks = [...SQL.matchAll(/create\s+or\s+replace\s+function\s+public\.([a-z0-9_]+)[\s\S]*?\$fn\$/gi)];
  for (const b of blocks) {
    assert.match(b[0], /set\s+search_path\s*=\s*public/i,
      `الدالّة ${b[1]} بلا search_path مثبَّت`);
  }
});

test("⛔ لا صلاحية anon في أيّ موضع من RUNME", () => {
  const code = stripCommentsAndStrings(SQL);
  assert.doesNotMatch(code, /grant[^;\n]*\bto\s+anon\b/i, "RUNME يمنح anon شيئًا");
  assert.doesNotMatch(code, /to\s+anon\s*,/i, "RUNME يمنح anon ضمن قائمة أدوار");
});
