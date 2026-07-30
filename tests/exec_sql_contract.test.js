// ════════════════════════════════════════════════════════════════════════════
// tests/exec_sql_contract.test.js — عقد حزمة SQL للّوحة التنفيذية.
//
// شكل الحزمة · SECURITY DEFINER بمسار مثبَّت · الداخليّ لا يُمنَح · حارس تجميد
// منصّة المشاريع · لا مكالمة خارجية · وصلابة الـSELF-TEST نفسه (اختبار لا يمكن
// أن يفشل ليس اختبارًا).
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  SQL, PREFLIGHT, POSTCHECK, ROLLBACK, TS, ATOMS, DASH, CONTRACT, ACCEPTANCE,
  funcBody, funcDecl, selfTest, stripJsComments, stripSqlComments, sqlWithoutSelfTest,
  TABLES, PREDICATES, INTERNAL_FNS, GATED_FNS, FROZEN_PATTERNS,
} = require("./exec_helpers.js");

test("الحزمة معاملة واحدة: PREFLIGHT خارجها، وbegin/commit يحيطان بالباقي", () => {
  const iPre = SQL.indexOf("do $pre$");
  const iBegin = SQL.indexOf("\nbegin;");
  const iCommit = SQL.lastIndexOf("\ncommit;");
  assert.ok(iPre > 0 && iBegin > iPre, "PREFLIGHT الصلب يجب أن يسبق begin");
  assert.ok(iCommit > iBegin, "لا commit بعد begin");
  assert.match(SQL, /notify pgrst, 'reload schema'/, "لا إعادة تحميل لمخطّط PostgREST");
});

test("الحزمة idempotent في كلّ إنشاء", () => {
  for (const t of TABLES) {
    assert.match(SQL, new RegExp(`create table if not exists public\\.${t}\\s*\\(`, "i"),
      `الجدول ${t} غير idempotent`);
  }
  const creates = SQL.match(/create (or replace )?function/g) ?? [];
  const replaces = SQL.match(/create or replace function/g) ?? [];
  assert.equal(creates.length, replaces.length, "توجد دالّة بلا or replace");
  assert.match(SQL, /create index if not exists/, "فهرس غير idempotent");
  assert.match(SQL, /drop policy if exists/, "سياسة تُنشأ بلا drop سابق — إعادة التشغيل ستفشل");
  assert.match(SQL, /on conflict \(key\) do update/, "بذر المفاتيح غير idempotent");
});

test("كلّ دالّة في الحزمة بمسار بحث مثبَّت، والعامّة منها SECURITY DEFINER", () => {
  const names = [...PREDICATES, ...INTERNAL_FNS, ...GATED_FNS,
                 "mgmt_access", "mgmt_audit_list"];
  for (const f of names) {
    const d = funcDecl(f);
    assert.match(d, /set search_path = public/i, `${f} بلا search_path مثبَّت`);
  }
  for (const f of [...PREDICATES, ...GATED_FNS, "mgmt_access", "mgmt_audit_list"]) {
    assert.match(funcDecl(f), /security definer/i, `${f} ليست SECURITY DEFINER`);
  }
});

test("الدوالّ الداخلية مسحوبة من authenticated — والقائمة كاملة", () => {
  const g = SQL.slice(SQL.indexOf("-- (ب) الداخلية"), SQL.indexOf("-- (ج) الجداول"));
  for (const f of INTERNAL_FNS) {
    assert.ok(g.includes(`public.${f}(`), `الدالّة الداخلية ${f} ليست في قائمة السحب`);
  }
  assert.match(g, /revoke all on function %s from authenticated/i, "لا سحب من authenticated");
  assert.ok(!/grant execute[\s\S]{0,80}authenticated/i.test(g),
    "قائمة الداخليات تمنح تنفيذًا لـauthenticated");
});

test("الواجهة العامّة ممنوحة لـauthenticated (والبوّابة داخل الدالّة)", () => {
  const g = SQL.slice(SQL.indexOf("-- (أ) الواجهة العامّة"), SQL.indexOf("-- (ب) الداخلية"));
  for (const f of [...GATED_FNS, "mgmt_access", "mgmt_audit_list", ...PREDICATES]) {
    assert.ok(g.includes(`public.${f}(`), `${f} خارج قائمة المنح`);
  }
  assert.match(g, /grant execute on function %s to authenticated/i, "لا منح لـauthenticated");
});

test("RLS مفعّلة على الجدولين — بـenable لا force (وإلّا فشلت كتابة الذاكرة)", () => {
  const rls = SQL.slice(SQL.indexOf("do $rls$"), SQL.indexOf("end $rls$;"));
  assert.match(rls, /enable row level security/i, "RLS غير مفعّلة");
  assert.ok(!/force row level security/i.test(SQL),
    "force RLS تُخضِع كتابة الذاكرة لسياسة SELECT-فقط فتفشل كلّ إعادة حساب بصمت");
  assert.ok(/enable وليس force عمدًا/.test(SQL), "القرار غير موثّق في الحزمة");
});

test("★ حارس تجميد منصّة المشاريع ★ — لا كتابة ولا قراءة ولا ذكر", () => {
  for (const re of FROZEN_PATTERNS) {
    assert.ok(!re.test(SQL), `الحزمة تذكر منصّة المشاريع المجمَّدة: ${re}`);
    assert.ok(!re.test(TS), `طبقة TypeScript تذكر منصّة المشاريع المجمَّدة: ${re}`);
    assert.ok(!re.test(ATOMS) && !re.test(DASH),
      `الواجهة تذكر منصّة المشاريع المجمَّدة: ${re}`);
  }
  // والحارس مكتوب داخل الحزمة نفسها لا في الاختبار وحده
  const st = selfTest();
  assert.match(st, /منصّة المشاريع المجمَّدة/, "الـSELF-TEST بلا حارس تجميد");
  assert.match(st, /insert\\s\+into\|update\|delete\\s\+from/,
    "حارس التجميد لا يغطّي الكتابة بأنواعها الثلاثة");
  assert.match(st, /ولو بالقراءة/, "حارس التجميد يسمح بالقراءة من المنصّة");
});

test("البادئة mgmt_ لا exec_/executive_ — هاتان محجوزتان لتقارير المنصّة", () => {
  assert.ok(!/create or replace function public\.(exec|executive)_/.test(SQL),
    "الحزمة تُنشئ دالّة ببادئة محجوزة لمنصّة المشاريع");
  assert.ok(!/create table if not exists public\.(exec|executive)_/.test(SQL),
    "الحزمة تُنشئ جدولًا ببادئة محجوزة");
  assert.match(PREFLIGHT, /exec\\_%' or p\.proname like 'executive\\_%/,
    "PREFLIGHT لا يوثّق دوالّ المنصّة التي لن تُلمَس");
  assert.match(POSTCHECK, /executive\\_%/, "POSTCHECK لا يتحقّق من بقائها كما هي");
});

test("لا مكالمة شبكية ولا بيانات اعتماد ولا service_role", () => {
  // ⚠️ الحزمة تُفحَص بلا كتلة SELF-TEST، والواجهة بلا تعليقات: الحارس نفسه يذكر
  //    الأنماط الممنوعة نصًّا، وفحصٌ يقرأها كان سيعاقب على وجود الحارس.
  for (const [name, src] of [["SQL", stripSqlComments(sqlWithoutSelfTest(SQL))],
                             ["TS", stripJsComments(TS)],
                             ["ATOMS", stripJsComments(ATOMS)],
                             ["DASH", stripJsComments(DASH)]]) {
    assert.ok(!/\b(pg_net|net\.http_post|net\.http_get|dblink)\b/.test(src),
      `${name} يحاول مكالمة خارجية`);
    assert.ok(!/service_role/.test(src), `${name} يذكر service_role`);
    assert.ok(!/client_secret|refresh_token(?!:)/.test(src), `${name} يتعامل مع بيانات اعتماد`);
  }
  assert.match(selfTest(), /مكالمة شبكية خارجية/, "الـSELF-TEST بلا حارس مكالمات");
});

test("الكتابات الحسّاسة مُدقَّقة، ولا كتابة أخرى في الحزمة", () => {
  for (const f of ["mgmt_refresh", "mgmt_export"]) {
    assert.match(funcBody(f), /mgmt_log/, `${f} بلا تدقيق`);
  }
  // الكتابة الوحيدة غير المُدقَّقة هي الذاكرة المؤقّتة — وهي ليست حدثًا رقابيًّا
  const inserts = SQL.match(/insert into public\.mgmt_[a-z_]+/g) ?? [];
  assert.deepEqual(
    [...new Set(inserts)].sort(),
    ["insert into public.mgmt_audit", "insert into public.mgmt_report_cache"],
    "توجد كتابة في جدول غير متوقّع",
  );
  // ولا كتابة في أيّ جدول خارج هذه الحزمة
  const foreign = SQL.match(/insert into public\.(?!mgmt_|permissions)[a-z_]+/g) ?? [];
  assert.deepEqual(foreign, [], `الحزمة تكتب في جداول موديولات أخرى: ${foreign.join(", ")}`);
});

test("الحزمة لا تعدّل مفتاح صلاحية قائمًا لغيرها", () => {
  const perms = SQL.slice(SQL.indexOf("do $perm$"), SQL.indexOf("end $perm$;"));
  assert.ok(!/delete from public\.permissions/i.test(SQL), "الحزمة تحذف مفاتيح");
  assert.ok(!/update public\.permissions/i.test(perms), "الحزمة تعدّل مفاتيح بـUPDATE مباشر");
  const keys = perms.match(/'(?:crm|finance_ops|ops|finance)\.[a-z_]+'/g) ?? [];
  assert.deepEqual(keys, [], `الحزمة تلمس مفاتيح موديول آخر: ${keys.join(", ")}`);
});

test("SELF-TEST صلب: لا مصيدة كاسحة، ولا فحص لا يمكن أن يفشل", () => {
  const st = selfTest();
  // كلّ استدعاء محميّ ملفوف بمصيدة تتحقّق من النصّ بعدها
  const traps = st.match(/exception when others then v_err := SQLERRM;/g) ?? [];
  assert.ok(traps.length >= 3, "عدد المصايد المتحقِّقة أقلّ من ثلاثة");
  const checks = st.match(/v_err not ilike '%not authorized%'/g) ?? [];
  assert.equal(checks.length, traps.length,
    "توجد مصيدة بلا تحقّق بعدها — تبتلع الفشل بدل أن تُفشِل");
  // ولا مصيدة تعيد النجاح
  assert.ok(!/exception when others then\s*(return true|null;\s*--\s*ok)/i.test(st),
    "مصيدة تُنجِح الفحص مهما حدث");
  // الفشل يُلغي المعاملة
  const raises = st.match(/raise exception 'MGMT SELF-TEST/g) ?? [];
  assert.ok(raises.length >= 30, `عدد فحوص الـSELF-TEST قليل: ${raises.length}`);
});

test("SELF-TEST يغطّي المحاور الملزمة كلّها", () => {
  const st = selfTest();
  const axes = [
    "RLS غير مفعّلة", "anon يملك", "بلا search_path مثبَّت",
    "authenticated يملك EXECUTE على الداخلية", "أعادت NULL", "fail-open",
    "بوّابة المؤشّرات الحسّاسة", "مؤشّر غير متاح خرج بقيمة",
    "اللوحة لا تُعلن", "مفتاح الذاكرة لا يتضمّن المستخدم",
    "بلا تدقيق", "منصّة المشاريع المجمَّدة", "الترحيلة أنشأت",
    "تطبيع الأقسام", "تنبيه ماليّ حسّاس",
  ];
  for (const a of axes) {
    assert.ok(st.includes(a), `الـSELF-TEST بلا محور: ${a}`);
  }
});

test("الحزمة لا تُنشئ بيانات — ويُفحَص ذلك داخلها", () => {
  const st = selfTest();
  assert.match(st, /select count\(\*\) into v_n from public\.mgmt_report_cache/,
    "لا فحص لخلوّ الذاكرة بعد الترحيلة");
  assert.match(st, /select count\(\*\) into v_n from public\.mgmt_audit/,
    "لا فحص لخلوّ سجلّ التدقيق بعد الترحيلة");
  assert.ok(!/insert into public\.mgmt_report_cache\s*\([\s\S]{0,200}values\s*\('/.test(SQL),
    "الحزمة تبذر صفوف ذاكرة");
});

test("الملفّات الأربعة موجودة ومتّسقة", () => {
  assert.match(PREFLIGHT, /READ-ONLY/, "PREFLIGHT لا يصرّح بأنّه للقراءة فقط");
  assert.match(POSTCHECK, /READ-ONLY/, "POSTCHECK لا يصرّح بأنّه للقراءة فقط");
  assert.ok(!/^\s*(insert|update|delete|create|alter|drop)\b/im.test(PREFLIGHT),
    "PREFLIGHT يكتب");
  assert.ok(!/^\s*(insert|update|delete|create|alter|drop)\b/im.test(POSTCHECK),
    "POSTCHECK يكتب");
  assert.match(ROLLBACK, /\(أ\) تعطيل آمن/, "ROLLBACK بلا مرحلة تعطيل آمنة");
  assert.match(ROLLBACK, /\(ب\) حذف كامل/, "ROLLBACK بلا مرحلة حذف صريحة");
  assert.match(SQL, /executive_reporting_POSTCHECK\.sql/, "RUNME لا يحيل إلى POSTCHECK");
});

test("الوثيقتان موجودتان وتحملان العقد لا الوصف فقط", () => {
  for (const [name, doc] of [["CONTRACT", CONTRACT], ["ACCEPTANCE", ACCEPTANCE]]) {
    assert.ok(doc.length > 1500, `${name} قصيرة أكثر من اللازم`);
  }
  assert.match(CONTRACT, /mgmt_kpi/, "العقد لا يذكر نقطة الاختناق");
  assert.match(CONTRACT, /غير متاح/, "العقد لا يذكر حالة «غير متاح»");
  assert.match(CONTRACT, /is_owner/, "العقد لا يوثّق الطبقة الحسّاسة");
  assert.match(ACCEPTANCE, /مالك|owner/i, "خطّة القبول بلا حساب مالك");
  assert.match(ACCEPTANCE, /عميل|client/i, "خطّة القبول بلا حساب عميل");
});
