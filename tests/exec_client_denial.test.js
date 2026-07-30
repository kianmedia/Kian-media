// ════════════════════════════════════════════════════════════════════════════
// tests/exec_client_denial.test.js
//
// ★ لا وصول ماليّ للعميل — ولا وصول أصلًا ★
// اللوحة التنفيذية داخلية بالكامل. العميل والزائر مستبعدان بنيويًّا (is_staff)،
// وإخفاء التبويب ليس تصريحًا: هذه الاختبارات تحرس المنع في القاعدة، وتتأكّد أنّ
// الرابط المباشر يُقابَل برسالة صريحة لا بشاشة فارغة ولا بادّعاء «ترحيلة ناقصة».
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  SQL, TS, DASH, ATOMS, NAV, POSTCHECK, ROLLBACK,
  funcBody, selfTest, PREDICATES, GATED_FNS, TABLES,
} = require("./exec_helpers.js");

test("كلّ مُسنَد عرض يشترط is_staff — العميل مستبعد بنيويًّا", () => {
  for (const p of ["mgmt_can_view", "mgmt_can_view_sensitive", "mgmt_can_export"]) {
    const body = funcBody(p);
    assert.match(body, /is_staff\(\)/, `${p} لا تشترط كون المستخدم موظّفًا`);
    assert.match(body, /auth\.uid\(\) is not null/, `${p} لا تشترط جلسة`);
    assert.match(body, /coalesce\(/i, `${p} قد تعيد NULL`);
  }
  assert.match(funcBody("mgmt_is_client"), /not coalesce\(public\.is_staff\(\), false\)/,
    "تعريف العميل ليس «ليس موظّفًا»");
});

test("لا مُسنَد يشتقّ صلاحيته من إدارة المشاريع", () => {
  for (const p of PREDICATES) {
    assert.ok(!/can_manage_projects/.test(funcBody(p)),
      `${p} تعتمد can_manage_projects — الموديول يجب أن يملك مُسنَداته`);
  }
});

test("كلّ دالّة عامّة تُغلق قبل أن تقرأ شيئًا", () => {
  for (const f of GATED_FNS) {
    const body = funcBody(f);
    assert.match(body, /mgmt_can_view\(\)/, `${f} بلا بوّابة اللوحة`);
    assert.match(body, /raise exception 'not authorized'/, `${f} لا ترفع منعًا صريحًا`);
    // البوّابة أوّل شيء **بعد begin**، قبل أيّ قراءة. القياس يبدأ بعد قسم
    // التصريحات عمدًا: `v_row public.mgmt_report_cache%rowtype` هناك إشارةُ نوع
    // لا قراءةَ صفّ، وحسابها قراءةً كان سيُفشِل فحصًا سليمًا.
    const exec = body.slice(body.indexOf("\nbegin"));
    const iGate = exec.indexOf("not authorized");
    const iRead = Math.min(
      ...["mgmt_compute(", "mgmt_source_installed(", "from public.mgmt_report_cache",
          "from public.mgmt_audit"]
        .map((s) => { const i = exec.indexOf(s); return i < 0 ? Number.MAX_SAFE_INTEGER : i; }),
    );
    assert.ok(iGate >= 0 && iGate < iRead, `${f} تقرأ قبل أن تُبوَّب`);
  }
});

test("لا صلاحية anon على أيّ جدول أو دالّة — سحب صريح لا افتراض", () => {
  const grants = SQL.slice(SQL.indexOf("do $g$"), SQL.indexOf("end $g$;"));
  assert.match(grants, /revoke all on function %s from anon/i, "لا سحب من anon للدوالّ");
  assert.match(grants, /revoke all on table public\.%I from anon/i, "لا سحب من anon للجداول");
  assert.ok(!/grant\s+[a-z ,]*\s+to\s+anon/i.test(SQL), "توجد منحة لـanon في الحزمة");
  assert.match(selfTest(), /has_function_privilege\('anon'/, "الـSELF-TEST لا يفحص anon");
  assert.match(POSTCHECK, /grantee = 'anon'/, "POSTCHECK لا يفحص anon على الجداول");
});

test("الجداول للقراءة فقط، ولا سياسة كتابة على أيّها", () => {
  const grants = SQL.slice(SQL.indexOf("do $g$"), SQL.indexOf("end $g$;"));
  assert.match(grants, /revoke all on table public\.%I from authenticated/i);
  assert.match(grants, /grant select on table public\.%I to authenticated/i);
  assert.ok(!/grant\s+(insert|update|delete)[\s\S]{0,60}to authenticated/i.test(SQL),
    "منحة كتابة مباشرة على جدول");
  assert.ok(!/create policy[\s\S]{0,200}for\s+(insert|update|delete|all)\b/i.test(SQL),
    "توجد سياسة كتابة — كلّ كتابة يجب أن تمرّ بـRPC");
  for (const t of TABLES) {
    assert.ok(SQL.includes(`'${t}'`), `الجدول ${t} خارج قائمة تفعيل RLS/المنح`);
  }
});

test("لا مؤشّر ماليّ يصل إلى مسار العميل — القسم كلّه خلف بوّابة المالك", () => {
  const body = funcBody("mgmt_compute");
  // العميل لا يصل إلى mgmt_compute أصلًا (mgmt_dashboard تمنعه)، وهذه طبقة ثانية.
  assert.match(body, /v_sens\s+boolean\s*:=\s*coalesce\(public\.mgmt_can_view_sensitive\(\), false\)/,
    "المحرّك لا يقيّم بوّابة المالك مرّة واحدة في مقدّمته");
  const fin = body.slice(body.indexOf("-- ── المالية"));
  assert.ok(fin.indexOf("elsif not v_sens then") < fin.indexOf("finops_dashboard"),
    "استدعاء المالية يسبق بوّابة المالك");
});

test("اللوحة غائبة عن مجموعتَي client وlead في التنقّل", () => {
  const sets = NAV.slice(NAV.indexOf("const SETS"), NAV.indexOf("export function"));
  const clientLine = sets.match(/^\s*client:\s*\[.*\],$/m);
  const leadLine = sets.match(/^\s*lead:\s*\[.*\],$/m);
  assert.ok(clientLine, "مجموعة client غير موجودة");
  assert.ok(leadLine, "مجموعة lead غير موجودة");
  assert.ok(!clientLine[0].includes('"executive"'), "التبويب ظاهر للعميل");
  assert.ok(!leadLine[0].includes('"executive"'), "التبويب ظاهر للزائر");
  assert.match(NAV, /executive:\s*\{ href: "\/client-portal\/executive"/, "التبويب غير مسجَّل");
});

test("إخفاء التبويب ليس تصريحًا — التعليق يقول ذلك والقاعدة تفرضه", () => {
  assert.ok(/mgmt_can_view = is_staff/.test(NAV),
    "تعليق التنقّل لا يوضّح أنّ المنع في القاعدة لا في القائمة");
  // ما يمنع فعلًا: بوّابة داخل الدالّة، لا غياب زرّ
  assert.match(funcBody("mgmt_dashboard"), /if not coalesce\(public\.mgmt_can_view\(\), false\) then raise exception/,
    "اللوحة تعتمد على إخفاء الزرّ");
});

test("الرابط المباشر يُقابَل برسالة صريحة لا بشاشة فارغة", () => {
  assert.match(DASH, /a\.is_client \|\| !a\.can_view/, "الشاشة لا تفحص حالة العميل");
  assert.match(DASH, /<Denied message=/, "لا شاشة منع صريحة");
  assert.match(ATOMS, /export function Denied/, "لا مكوّن منع");
  assert.match(ATOMS, /export function MigrationPending/, "لا مكوّن ترحيلة معلّقة");
  assert.match(ATOMS, /export function ErrorBox/, "لا مكوّن خطأ");
  // الثلاثة مختلفة النصّ — لا واحدة تُستعمل مكان الأخرى
  const denied = ATOMS.slice(ATOMS.indexOf("export function Denied"), ATOMS.indexOf("export function ErrorBox"));
  const migr = ATOMS.slice(ATOMS.indexOf("export function MigrationPending"), ATOMS.indexOf("export function Denied"));
  assert.ok(/لا تملك صلاحية/.test(denied), "شاشة المنع لا تقول «لا تملك صلاحية»");
  assert.ok(/بانتظار تفعيل قاعدة البيانات/.test(migr), "شاشة الترحيلة لا تقولها");
  assert.ok(!/بانتظار تفعيل قاعدة البيانات/.test(denied),
    "شاشة المنع تدّعي ترحيلة ناقصة — هذا الخلط كلّف دورة إنتاج سابقة");
});

test("طبقة TypeScript تفصل المنع عن الترحيلة الناقصة", () => {
  assert.match(TS, /pgIsMigrationPending\(d\)/, "لا اعتماد على المصنّف الأمين");
  assert.match(TS, /state: "needs_migration"/, "لا حالة ترحيلة معلّقة");
  assert.match(TS, /state: "denied"/, "لا حالة منع");
  const i = TS.indexOf("function toState");
  const body = TS.slice(i, TS.indexOf("export function execReasonText"));
  assert.ok(body.indexOf("pgIsMigrationPending") < body.indexOf('d.kind === "permission_denied"'),
    "ترتيب التصنيف يجعل منعًا يُعرض كترحيلة ناقصة");
});

test("رسائل المنع ثنائية اللغة ولا تُخلَط", () => {
  assert.match(TS, /EXEC_DENIED_AR/, "لا رسالة منع عربية");
  assert.match(TS, /EXEC_DENIED_EN/, "لا رسالة منع إنجليزية");
  assert.match(TS, /EXEC_MIGRATION_AR/, "لا رسالة ترحيلة عربية");
  assert.match(TS, /EXEC_MIGRATION_EN/, "لا رسالة ترحيلة إنجليزية");
  assert.match(funcBody("mgmt_access"), /message_ar[\s\S]{0,600}message_en/,
    "مِجَسّ الوصول بلغة واحدة");
});

test("SELF-TEST يثبت المنع سلوكيًّا بفحص يستطيع أن يفشل", () => {
  const st = selfTest();
  assert.match(st, /perform public\.mgmt_dashboard\('\{\}'::jsonb, false\);/,
    "لا استدعاء حيّ يثبت المنع");
  assert.match(st, /v_err not ilike '%not authorized%'/,
    "الفحص لا يتحقّق من نصّ المنع — مصيدة تبتلع بدل أن تُفشِل");
  assert.match(st, /fail-open/, "لا تسمية صريحة لخطر الانفتاح");
  // ولا مصيدة كاسحة تجعل الفحص ينجح مهما حدث
  assert.ok(!/exception when others then null;\s*end;\s*$/m.test(st.slice(st.indexOf("(7)"), st.indexOf("(8)"))),
    "مصيدة تبتلع نتيجة فحص المنع");
});

test("ROLLBACK يغلق الباب بلا فقدان بيانات، وصادق عمّا يُفقَد", () => {
  assert.match(ROLLBACK, /revoke all on function %s from authenticated/,
    "المرحلة (أ) لا تسحب المنح");
  assert.match(ROLLBACK, /mgmt_audit/, "ROLLBACK لا يذكر سجلّ التدقيق");
  assert.ok(/سجلّ .{0,40}لا نسخة له|أثر رقابيّ لا نسخة له/.test(ROLLBACK),
    "ROLLBACK لا يصرّح بأنّ سجلّ التدقيق لا نسخة له");
  assert.ok(/لا يُفقَد أيّ رقم تشغيليّ أو ماليّ أو بيعيّ/.test(ROLLBACK),
    "ROLLBACK لا يوضّح أنّ بيانات الموديولات لا تتأثّر");
  // مرحلة الحذف الكامل ليست جاهزة للّصق
  const destructive = ROLLBACK.slice(ROLLBACK.indexOf("(ب) حذف كامل"));
  assert.ok(!/^\s*drop table if exists public\.mgmt_audit;/m.test(destructive),
    "أمر حذف سجلّ التدقيق غير معلَّق — قابل للّصق بالخطأ");
});
