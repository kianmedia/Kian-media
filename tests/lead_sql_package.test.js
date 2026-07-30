// ════════════════════════════════════════════════════════════════════════════
// tests/lead_sql_package.test.js — عقد حزمة الـSQL نفسها.
//
// أربعة ملفّات · معاملة واحدة · قابلة لإعادة التشغيل · PREFLIGHT وPOSTCHECK
// للقراءة فقط وبمجموعة نتائج واحدة · فحوص ساكنة لا تنادي دالّة محميّة ·
// ROLLBACK صادق ولا يُشغَّل بالخطأ.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  SQL, PREFLIGHT, POSTCHECK, ROLLBACK, exists, funcBody, selfTest,
  stripCommentsAndStrings, stripComments, TABLES, API_FNS, INTERNAL_FNS, PREDICATES,
} = require("./lead_helpers.js");

test("الحزمة أربعة ملفّات، وكلّها موجودة", () => {
  for (const f of ["PREFLIGHT", "RUNME", "POSTCHECK", "ROLLBACK"]) {
    assert.ok(exists(`docs/lead_scoring_routing_${f}.sql`), `الملفّ ${f} مفقود`);
  }
});

test("PREFLIGHT وPOSTCHECK للقراءة فقط — لا كتابة ولا DDL ولا معاملة", () => {
  for (const [name, src] of [["PREFLIGHT", PREFLIGHT], ["POSTCHECK", POSTCHECK]]) {
    assert.doesNotMatch(src, /^\s*(insert|update|delete|create|alter|drop|grant|revoke|truncate)\b/im,
      `${name}: يحتوي كتابة أو DDL`);
    assert.doesNotMatch(src, /^\s*(begin|commit);/im, `${name}: يفتح معاملة`);
  }
});

test("PREFLIGHT وPOSTCHECK يُرجعان **مجموعة نتائج واحدة**", () => {
  for (const [name, src] of [["PREFLIGHT", PREFLIGHT], ["POSTCHECK", POSTCHECK]]) {
    const code = stripCommentsAndStrings(src);
    const stmts = code.split(";").filter((s) => s.trim().length > 0);
    assert.equal(stmts.length, 1,
      `${name}: ${stmts.length} جملة — المحرّر يعرض النتيجة الأخيرة فقط، فتضيع بقيّة الفحوص`);
  }
});

test("★ الفحوص لا تذكر جدولًا اختياريًّا في جملة ثابتة ★", () => {
  // PostgreSQL يحلّ أسماء الجداول **وقت التحليل**، فـCASE لا يحمي: ملفّ فحص
  // يذكر جدولًا غائبًا ينهار بـ42P01 بدل أن يُبلّغ عن غيابه. وأداة الفحص التي
  // تنهار على قاعدة نظيفة عديمة القيمة تمامًا.
  for (const [name, src] of [["PREFLIGHT", PREFLIGHT], ["POSTCHECK", POSTCHECK]]) {
    const code = stripCommentsAndStrings(src);
    for (const t of ["crm_leads", "crm_activities", "comms_channels", "comms_outbox",
                     "comms_event_catalog", "csub_subscriptions", "sq_quotes",
                     "fin_receivables", "lsr_factors", "lsr_rules", "lsr_rulesets",
                     "lsr_agents", "lsr_routing_rules", "lsr_event_log"]) {
      assert.doesNotMatch(code, new RegExp(`\\bfrom\\s+public\\.${t}\\b`, "i"),
        `${name}: يقرأ public.${t} في جملة ثابتة — سينهار إن غاب الجدول بدل أن يُبلّغ`);
    }
    assert.match(src, /query_to_xml/,
      `${name}: بلا قراءة ديناميكية — إمّا أنّه لا يقرأ صفوفًا أصلًا أو أنّه هشّ`);
  }
});

test("PREFLIGHT يُثبت ترتيب الاعتماديات ولا يفترضه", () => {
  assert.match(PREFLIGHT, /to_regprocedure/, "لا فحص لوجود الدوالّ");
  assert.match(PREFLIGHT, /to_regclass/, "لا فحص لوجود الجداول");
  assert.match(PREFLIGHT, /prorettype = 'boolean'::regtype/,
    "لا فحص لنوع إرجاع البوّابات — بوّابة غير boolean تجعل RLS «غير محدَّد»");
  assert.match(PREFLIGHT, /BLOCKER/, "لا تصنيف مانع");
  assert.match(PREFLIGHT, /42P13/, "لا تحذير من تعارض توقيع مع دوالّ قائمة");
  assert.match(PREFLIGHT, /information_schema\.columns/,
    "لا فحص للأعمدة بالاسم — غياب عمود يفشل وقت التشغيل لا وقت الإنشاء");
  // الاعتماديّة الصلبة الأهمّ.
  assert.match(PREFLIGHT, /crm_leads/, "لا يفحص المرساة");
  assert.match(PREFLIGHT, /crm_companies/, "لا يفحص مصدر ملكية الحساب");
});

test("PREFLIGHT وPOSTCHECK لا ينادِيان دالّة محميّة", () => {
  for (const [name, src] of [["PREFLIGHT", PREFLIGHT], ["POSTCHECK", POSTCHECK]]) {
    const code = stripCommentsAndStrings(src);
    for (const f of [...API_FNS, ...INTERNAL_FNS]) {
      assert.doesNotMatch(code, new RegExp(`select\\s+public\\.${f}\\s*\\(`, "i"),
        `${name}: ينادي ${f} — المحرّر يعمل بلا جلسة، فالنداء إمّا يرفع «not authorized» ` +
        `أو يُرجع false ويُقرأ خطأً على أنّ الكائن مكسور`);
    }
  }
});

test("POSTCHECK ساكن: يقرأ التعريفات لا السلوك", () => {
  assert.match(POSTCHECK, /pg_get_functiondef/, "لا قراءة لتعريفات الدوالّ");
  assert.match(POSTCHECK, /pg_constraint/, "لا فحص للقيود");
  assert.match(POSTCHECK, /pg_policies/, "لا فحص للسياسات");
  assert.match(POSTCHECK, /aclexplode|role_table_grants/,
    "فحص الصلاحيات باسم دور نصّيّ يرفع استثناءً إن غاب الدور — أداة الفحص لا تكون هشّة");
});

test("★ لا مصيدة catch-all: كلّ قسم في POSTCHECK قادر على الإخفاق ★", () => {
  const sections = POSTCHECK.split(/─── \(/).slice(1);
  assert.ok(sections.length >= 8, `أقسام POSTCHECK قليلة (${sections.length})`);
  for (const s of sections) {
    const title = s.slice(0, 40).replace(/\n/g, " ");
    assert.match(s, /'FAIL'|'WARN'|'INFO'/,
      `قسم «${title}» بلا أيّ حكم — فحص لا يحكم ليس فحصًا`);
  }
  // والخلاصة تُعلن الإخفاق بدل أن تبتلعه.
  assert.match(POSTCHECK, /عدد الإخفاقات/, "الخلاصة لا تعلن عدد الإخفاقات");
});

test("RUNME معاملة واحدة، وينتهي بإعادة تحميل المخطّط", () => {
  assert.match(SQL, /\nbegin;[\s\S]*\ncommit;/, "ليس داخل معاملة");
  assert.match(SQL, /notify pgrst, 'reload schema';/,
    "لا إعادة تحميل مخطّط — الواجهة ستقرأ PGRST202 كاذبًا بعد ترحيلة ناجحة");
  const code = stripComments(SQL);
  assert.equal((code.match(/^begin;/gm) || []).length, 1, "أكثر من معاملة");
  assert.equal((code.match(/^commit;/gm) || []).length, 1, "أكثر من commit");
});

test("RUNME قابل لإعادة التشغيل فوق قاعدة حيّة", () => {
  const code = stripComments(SQL);
  const creates = code.match(/create table\s+(if not exists\s+)?public\./gi) || [];
  for (const c of creates) {
    assert.match(c, /if not exists/i, `إنشاء جدول بلا IF NOT EXISTS: ${c}`);
  }
  for (const c of code.match(/create index\s+(if not exists\s+)?/gi) || []) {
    assert.match(c, /if not exists/i, "إنشاء فهرس بلا IF NOT EXISTS");
  }
  // ولا CONCURRENTLY داخل معاملة (سيفشل حتمًا).
  assert.doesNotMatch(code, /concurrently/i, "CONCURRENTLY داخل معاملة — سيفشل");
  // ولا إسقاط جدول في ملفّ التركيب.
  assert.doesNotMatch(code, /drop table/i, "RUNME يُسقط جدولًا — التركيب لا يهدم");
  // والبذور محميّة من التكرار.
  assert.match(code, /on conflict/i, "بذور بلا حماية من التكرار");
  assert.match(code, /if exists \(select 1 from public\.lsr_rulesets\) then return/,
    "بذور القواعد ستُعاد كتابتها عند إعادة التشغيل");
});

test("كلّ الجداول والدوالّ المعلنة موجودة فعلًا في RUNME", () => {
  for (const t of TABLES) {
    assert.match(SQL, new RegExp(`create table if not exists public\\.${t}\\b`),
      `الجدول ${t} غير مُنشأ`);
  }
  for (const f of [...API_FNS, ...INTERNAL_FNS, ...PREDICATES]) {
    assert.match(SQL, new RegExp(`create or replace function public\\.${f}\\s*\\(`),
      `الدالّة ${f} غير مُنشأة`);
  }
});

test("كلّ دالّة SECURITY DEFINER تثبّت مسار البحث", () => {
  const defs = SQL.match(/create or replace function public\.lsr_[\s\S]*?\$\$/g) || [];
  assert.ok(defs.length > 30, `عدد الدوالّ المقروءة قليل (${defs.length})`);
  for (const d of defs) {
    if (/security definer/i.test(d)) {
      assert.match(d, /set search_path = public/i,
        `دالّة SECURITY DEFINER بلا search_path مثبَّت: ${d.slice(0, 90)}`);
    }
  }
});

test("RLS مفعّل على كلّ جدول، ولا سياسة كتابة لأيّ دور تطبيقيّ", () => {
  for (const t of TABLES) {
    assert.ok(SQL.includes(`'${t}'`), `الجدول ${t} خارج قوائم RLS والصلاحيات`);
  }
  assert.match(SQL, /enable row level security/i, "لا تفعيل لـRLS");
  const code = stripComments(SQL);
  assert.doesNotMatch(code, /for (insert|update|delete)\s+to\s+authenticated/i,
    "سياسة كتابة مباشرة — الكتابة يجب أن تمرّ بدالّة مبوَّبة ومدقَّقة");
  assert.match(code, /grant select on table public\.%I to authenticated/,
    "لا منح قراءة صريح — الجداول ستبقى غير مقروءة رغم السياسات");
});

test("FORCE RLS غير مستعمَل — وإلّا مُنعت دوالّنا نفسها من الكتابة", () => {
  // دوالّ SECURITY DEFINER تعمل بدور المالك؛ ومع FORCE وبلا سياسات كتابة
  // كانت ستُمنع من الكتابة، فينكسر الموديول بصمت بعد ترحيلة «ناجحة».
  assert.doesNotMatch(stripComments(SQL), /force row level security/i,
    "FORCE RLS مفعّل بلا سياسات كتابة — الموديول سينكسر عند أوّل إسناد");
});

test("ROLLBACK لا يُشغَّل بالخطأ: الهدم معلَّق سطرًا سطرًا", () => {
  const live = ROLLBACK.split("\n")
    .filter((l) => /^\s*(drop\s+table|delete\s+from|truncate)\b/i.test(l));
  assert.deepEqual(live, [],
    "ROLLBACK يحتوي سطر هدم غير معلَّق — التراجع قرار لا حادث:\n" + live.join("\n"));
});

test("ROLLBACK صادق عن الفقد، ويطلب نسخة احتياطية", () => {
  assert.match(ROLLBACK, /يُفقَد نهائيًّا/, "ROLLBACK لا يصرّح بفقد نهائيّ");
  assert.match(ROLLBACK, /نسخة احتياطية/, "ROLLBACK بلا خطوة نسخة احتياطية");
  assert.match(ROLLBACK, /lsr_assignments/, "لا ذكر لفقدان تاريخ الإسناد");
  assert.match(ROLLBACK, /lsr_audit/, "لا ذكر لفقدان أثر التدقيق");
  assert.match(ROLLBACK, /lsr_event_log/, "لا ذكر لفقدان سجلّ التكرار");
  assert.match(ROLLBACK, /owner_user_id/,
    "لا ذكر للأثر الجانبيّ: الملكية تبقى ويضيع تفسيرها");
  assert.match(ROLLBACK, /المستوى ١/, "ROLLBACK بلا مستوى آمن بلا فقد");
});

test("ROLLBACK لا يُسقط جدولًا خارج الوحدة", () => {
  const dropLines = ROLLBACK.split("\n").filter((l) => /drop\s+table/i.test(l));
  for (const l of dropLines) {
    assert.match(l, /public\.lsr_/,
      `ROLLBACK يُسقط جدولًا خارج الوحدة: ${l.trim()}`);
  }
  assert.doesNotMatch(ROLLBACK, /drop\s+table[^\n]*public\.(crm_|csub_|sq_|fin_|comms_|projects)/i,
    "ROLLBACK يمسّ موديولًا آخر");
});

test("الفحص الذاتيّ ساكن ولا ينادي دالّة محميّة", () => {
  const st = selfTest();
  // نداءات مسموحة: مُسنَدات تُرجع false بلا جلسة (لا ترفع استثناءً).
  const allowed = new Set([...PREDICATES]);
  // نُزيل السلاسل النصّية أوّلًا: 'public.lsr_score_core(uuid)' داخل
  // to_regprocedure اسمٌ يُقرأ من الكتالوج، لا نداء. الخلط بينهما يُنتج
  // إنذارًا كاذبًا يُعطَّل الاختبار بسببه.
  const bare = st.replace(/'(?:[^']|'')*'/g, "''");
  const calls = [...bare.matchAll(/public\.(lsr_[a-z_]+)\s*\(/g)].map((m) => m[1]);
  for (const c of calls) {
    if (allowed.has(c) || c === "lsr_event_keys") continue;
    assert.fail(
      `الفحص الذاتيّ ينادي ${c} — محرّر SQL بلا جلسة، والنداء سيرفع «not authorized» ` +
      `ويُسقط ترحيلة سليمة. الفحص يقرأ التعريف لا السلوك.`,
    );
  }
  assert.match(st, /pg_get_functiondef/, "الفحص الذاتيّ لا يقرأ التعريفات");
  assert.match(st, /raise exception/, "الفحص الذاتيّ لا يُسقط الترحيلة عند الخرق");
});

test("★ الفحص الذاتيّ بلا نمط عاجز عن الإطلاق ★", () => {
  // نمط ينتهي بـ\M بعد شرطة سفلية (مثل fin_\M) لا يطابق شيئًا أبدًا، فيصير
  // «فحصًا» يمرّ دائمًا. هذه أخطر من غياب الفحص لأنّها تمنح طمأنينة كاذبة.
  const st = selfTest();
  const impossible = st.match(/_\\M/g) || [];
  assert.deepEqual(impossible, [],
    "نمط في الفحص الذاتيّ ينتهي بحدّ كلمة بعد شرطة سفلية — لن يطابق أبدًا");
});

test("لا service_role ولا مفتاح سرّيّ في أيّ ملفّ", () => {
  for (const [n, src] of [["RUNME", SQL], ["PREFLIGHT", PREFLIGHT],
                          ["POSTCHECK", POSTCHECK], ["ROLLBACK", ROLLBACK]]) {
    // التعليق الذي يمنع service_role ليس استعمالًا له؛ نفحص الكود وحده.
    assert.doesNotMatch(stripComments(src), /service_role/i, `${n}: يستعمل service_role`);
    assert.doesNotMatch(src, /eyJ[A-Za-z0-9_-]{20,}/, `${n}: يحتوي رمزًا يشبه JWT`);
  }
});
