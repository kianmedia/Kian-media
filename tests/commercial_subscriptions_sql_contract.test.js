// ════════════════════════════════════════════════════════════════════════════
// tests/commercial_subscriptions_sql_contract.test.js
// عقد حزمة الـSQL: أربعة ملفّات · معاملة واحدة · idempotency · PREFLIGHT صلب ·
// POSTCHECK نتيجة واحدة · ROLLBACK صادق · SELF-TEST ثابت لا يلتفّ على نفسه.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  exists, SQL, PREFLIGHT, POSTCHECK, ROLLBACK,
  funcDecl, selfTest, TABLES, UNIT_TYPES, WRITE_FNS, READ_FNS, PREDICATES, INTERNAL_FNS,
} = require("./commercial_subscriptions_helpers.js");

test("الحزمة أربعة ملفّات، وكلّها موجودة", () => {
  for (const f of ["PREFLIGHT", "RUNME", "POSTCHECK", "ROLLBACK"]) {
    assert.ok(exists(`docs/commercial_subscriptions_${f}.sql`), `الملفّ ${f} مفقود`);
  }
});

test("PREFLIGHT وPOSTCHECK للقراءة فقط — لا كتابة ولا DDL ولا معاملة", () => {
  for (const [name, src] of [["PREFLIGHT", PREFLIGHT], ["POSTCHECK", POSTCHECK]]) {
    assert.doesNotMatch(src, /^\s*(insert|update|delete|create|alter|drop|grant|revoke|truncate)\b/im,
      `${name}: يحتوي كتابة أو DDL`);
    assert.doesNotMatch(src, /^\s*(begin|commit);/im, `${name}: يفتح معاملة`);
  }
});

test("PREFLIGHT يُثبت ترتيب الاعتماد ولا يفترضه", () => {
  for (const dep of ["public.clients", "public.my_client_id()", "public.is_owner()", "public.is_staff()"]) {
    assert.ok(PREFLIGHT.includes(dep), `PREFLIGHT لا يفحص الاعتماد ${dep}`);
  }
  assert.match(PREFLIGHT, /frozen_objects/, "PREFLIGHT بلا لقطة تجميد للمقارنة");
  assert.match(PREFLIGHT, /isolation/i, "PREFLIGHT لا يوثّق عزل المعاملات الذي يقوم عليه ضمان السباق");
});

test("POSTCHECK نتيجة واحدة، ولا يستدعي دالّة محميّة تحتاج جلسة", () => {
  // Result Set واحد = جملة واحدة. الفاصلة المنقوطة الوحيدة هي نهايتها؛ كلّ
  // select آخر في الملفّ داخل CTE أو داخل UNION ALL ولا يُنتج نتيجة مستقلّة.
  const statements = (POSTCHECK.replace(/^--.*$/gm, "").match(/;/g) ?? []).length;
  assert.equal(statements, 1,
    `POSTCHECK يحتوي ${statements} جملة — محرّر Supabase يعرض النتيجة الأخيرة فقط فتضيع البقيّة`);
  assert.match(POSTCHECK, /^with\b/im, "POSTCHECK ليس استعلامًا واحدًا مبنيًّا على CTE");
  // الدوالّ المستدعاة حيًّا يجب أن تكون مُسنَدات تعيد false بلا جلسة، لا RPC محميّة.
  const called = [...POSTCHECK.matchAll(/public\.(csub_\w+)\s*\(/g)].map((m) => m[1]);
  const live = new Set(called);
  for (const f of [...WRITE_FNS, ...READ_FNS]) {
    assert.ok(!live.has(f) || POSTCHECK.includes(`'public.${f}(`),
      `POSTCHECK يستدعي ${f} حيًّا — سترفع "not authorized" في محرّر SQL وتُقرأ خطأً كفشل ترحيل`);
  }
  assert.match(POSTCHECK, /verdict/i, "POSTCHECK بلا عمود حكم صريح");
});

test("ROLLBACK صادق: يقول ماذا يُفقَد، ولا يُشغَّل بالخطأ", () => {
  const live = ROLLBACK.split("\n").filter((l) => /^\s*(drop|delete|truncate|begin|commit|notify)\b/i.test(l));
  assert.deepEqual(live, [], "ROLLBACK يحتوي سطر هدم غير معلَّق");
  assert.match(ROLLBACK, /يحذف بيانات/, "ROLLBACK لا يصرّح بأنّه يحذف بيانات");
  assert.match(ROLLBACK, /csub_ledger/, "ROLLBACK لا يذكر فقدان الدفتر");
  assert.match(ROLLBACK, /csub_audit/, "ROLLBACK لا يذكر فقدان سجلّ التدقيق");
  assert.match(ROLLBACK, /نسخة احتياطية/, "ROLLBACK بلا خطوة نسخة احتياطية");
  assert.match(ROLLBACK, /csub_reverse/, "ROLLBACK لا يوجّه إلى القيد العكسيّ كبديل صحيح");
  // بديل قابل للعكس يُعرض قبل الهدم
  assert.match(ROLLBACK, /suspended/, "ROLLBACK بلا بديل تعليق قابل للعكس");
  // ولا يلمس المنصّة ولا جداول الهوية
  assert.doesNotMatch(ROLLBACK,
    /^\s*drop\s+table\s+if\s+exists\s+public\.(projects|project_core|deliverables|clients|profiles)/im,
    "ROLLBACK يسقط جدولًا خارج الوحدة");
});

test("RUNME داخل معاملة واحدة، بـPREFLIGHT صلب قبلها وإعادة تحميل مخطّط بعدها", () => {
  assert.match(SQL, /\nbegin;[\s\S]*\ncommit;/, "ليس داخل معاملة");
  assert.equal((SQL.match(/^begin;/gm) ?? []).length, 1, "أكثر من معاملة واحدة");
  assert.equal((SQL.match(/^commit;/gm) ?? []).length, 1, "أكثر من commit واحد");
  assert.match(SQL, /notify pgrst, 'reload schema';/,
    "لا إعادة تحميل مخطّط — الواجهة ستقرأ PGRST202 كاذبًا بعد ترحيلة ناجحة");
  const pre = SQL.slice(0, SQL.indexOf("\nbegin;"));
  assert.match(pre, /do \$pre\$[\s\S]*raise exception 'COMMERCIAL SUBSCRIPTIONS PREFLIGHT/i,
    "لا PREFLIGHT صلب يوقف التشغيل قبل كتابة أيّ شيء");
  assert.match(pre, /clients/, "PREFLIGHT الصلب لا يفحص public.clients — أساس عزل العميل");
});

test("Idempotency: كلّ إنشاء يحتمل إعادة التشغيل فوق بيانات حقيقية", () => {
  assert.deepEqual(SQL.match(/^create table (?!if not exists)/gim) ?? [], [], "جدول بلا if not exists");
  assert.deepEqual(SQL.match(/^create (unique )?index (?!if not exists)/gim) ?? [], [], "فهرس بلا if not exists");
  assert.deepEqual(SQL.match(/^create sequence (?!if not exists)/gim) ?? [], [], "تسلسل بلا if not exists");
  assert.deepEqual(SQL.match(/^create function /gim) ?? [], [], "دالّة بلا create or replace");
  for (const p of [...SQL.matchAll(/create policy (\w+) on/gi)].map((m) => m[1])) {
    assert.match(SQL, new RegExp(`drop policy if exists ${p} on`, "i"), `السياسة ${p} بلا drop if exists`);
  }
  // المُشغِّلات الساكنة تُحذف بالاسم؛ والمُشغِّل المبنيّ بـformat (اسمه t_%s_touch)
  // يُحذف داخل الحلقة نفسها — ويُفحص هنا صراحةً بدل استثنائه بصمت.
  for (const t of [...SQL.matchAll(/create trigger (t_\w+)/gi)].map((m) => m[1])) {
    assert.match(SQL, new RegExp(`drop trigger if exists ${t} on`, "i"), `المُشغِّل ${t} بلا drop if exists`);
  }
  assert.match(SQL, /drop trigger if exists t_%s_touch on public\.%I[\s\S]{0,200}create trigger t_%s_touch/i,
    "مُشغِّل updated_at المبنيّ ديناميكيًّا بلا drop if exists — التشغيل الثاني سيفشل");
  // البذور تُحدَّث ولا تُكرَّر
  assert.match(SQL, /on conflict \(key\) do update set/i, "بذر أنواع الوحدات غير idempotent");
  assert.match(SQL, /on conflict \(key\) do nothing/i, "بذر الإعدادات يدهس إعدادًا عدّله المالك");
  // التخصيص لا يُمنح مرّتين عند إعادة التفعيل
  assert.match(SQL, /exception when unique_violation then null/i,
    "تخصيص الرصيد بلا حارس تكرار — إعادة التفعيل ستمنح رصيدًا مرّتين");
});

test("الجداول الأحد عشر معرَّفة، والأنواع الثلاثة عشر مبذورة بالاسم", () => {
  for (const t of TABLES) {
    assert.match(SQL, new RegExp(`create table if not exists public\\.${t}\\b`, "i"), `الجدول ${t} غير معرَّف`);
  }
  for (const u of UNIT_TYPES) {
    assert.ok(SQL.includes(`'${u}'`), `نوع الوحدة ${u} غير مبذور`);
  }
});

test("كلّ دوالّ الموديول SECURITY DEFINER بمسار بحث مثبَّت", () => {
  for (const f of [...WRITE_FNS, ...READ_FNS, ...PREDICATES, ...INTERNAL_FNS]) {
    const d = funcDecl(f);
    assert.match(d, /security definer/i, `${f} ليست SECURITY DEFINER`);
    assert.match(d, /set search_path = public/i, `${f} بلا search_path مثبَّت`);
  }
});

test("SELF-TEST ثابت: لا نداء حيّ لدالّة محميّة، ولا مصيدة تُنجِح فحصًا", () => {
  const st = selfTest();
  for (const f of [...WRITE_FNS, ...READ_FNS]) {
    assert.ok(!new RegExp(`public\\.${f}\\s*\\(`).test(st.replace(/'public\.\w+\([^)]*\)'/g, "")),
      `SELF-TEST ينادي ${f} حيًّا — auth.uid() = NULL في المحرّر فسترفع "not authorized" وتُسقط ترحيلة ناجحة`);
  }
  assert.doesNotMatch(st, /exception\s+when\s+others\s+then\s+null/i,
    "SELF-TEST يبتلع استثناءً — فحص يمرّ مهما حدث ليس فحصًا");
  // يفحص الأشياء التي يسهل أن تنكسر صامتة
  for (const needle of [
    "t_csub_ledger_no_update", "uq_csub_ledger_idem", "csub_can_approve",
    "auto_renew", "ledger_client_mismatch", "insufficient_balance", "for\\s+update",
  ]) {
    assert.match(st, new RegExp(needle, "i"), `SELF-TEST لا يفحص ${needle}`);
  }
  assert.match(st, /created_at = now\(\)/, "SELF-TEST لا يتحقّق من أنّ الترحيلة لم تُنشئ بيانات عمل");
});

test("الترحيلة لا تنشئ بيانات عمل ولا تكتب في سجلّ التدقيق", () => {
  // لا insert في جداول العمل خارج الدوالّ: البذور محصورة في الكتالوج والإعدادات.
  const topInserts = [...SQL.matchAll(/^insert into public\.(\w+)/gim)].map((m) => m[1]);
  const allowed = new Set(["csub_unit_types", "csub_settings", "permissions"]);
  for (const t of topInserts) {
    assert.ok(allowed.has(t), `الترحيلة تُدرج في ${t} خارج الدوالّ — بيانات عمل من ترحيلة`);
  }
});
