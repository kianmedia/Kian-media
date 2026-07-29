// ════════════════════════════════════════════════════════════════════════════
// tests/ops_sql_contract.test.js — Phase 2: عقد حزمة الـSQL.
//
// idempotency · migration idempotency · مُسنَدات لا تعيد NULL · تدقيق كلّ كتابة
// حسّاسة · صدق الـself-test · حارس تجميد منصّة المشاريع · Placeholder الطقس.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ROOT, read, SQL, funcBody, funcDecl, TABLES, WRITE_FNS, CHILD_KINDS } = require("./ops_helpers.js");

const PREFLIGHT = read("docs/operations_center_PREFLIGHT.sql");
const POSTCHECK = read("docs/operations_center_POSTCHECK.sql");
const ROLLBACK = read("docs/operations_center_ROLLBACK.sql");

test("الحزمة أربعة ملفّات، وكلّها موجودة", () => {
  for (const f of ["PREFLIGHT", "RUNME", "POSTCHECK", "ROLLBACK"]) {
    assert.ok(fs.existsSync(path.join(ROOT, `docs/operations_center_${f}.sql`)), `الملفّ ${f} مفقود`);
  }
});

test("PREFLIGHT وPOSTCHECK للقراءة فقط — لا كتابة ولا DDL", () => {
  for (const [name, src] of [["PREFLIGHT", PREFLIGHT], ["POSTCHECK", POSTCHECK]]) {
    assert.doesNotMatch(src, /^\s*(insert|update|delete|create|alter|drop|grant|revoke|truncate)\b/im,
      `${name}: يحتوي كتابة أو DDL`);
    assert.doesNotMatch(src, /^\s*(begin|commit);/im, `${name}: يفتح معاملة`);
  }
});

test("RUNME داخل معاملة واحدة، وينتهي بإعادة تحميل المخطّط", () => {
  assert.match(SQL, /\nbegin;[\s\S]*\ncommit;/, "ليس داخل معاملة");
  assert.match(SQL, /notify pgrst, 'reload schema';/, "لا إعادة تحميل مخطّط — الواجهة ستقرأ PGRST202 كاذبًا");
  // PREFLIGHT صلب قبل المعاملة: يوقف التشغيل بدل ترك نصف ترحيلة
  const pre = SQL.slice(0, SQL.indexOf("\nbegin;"));
  assert.match(pre, /do \$pre\$[\s\S]*raise exception 'OPS PREFLIGHT/i, "لا PREFLIGHT يوقف التشغيل");
});

test("Idempotency: كلّ إنشاء يحتمل إعادة التشغيل", () => {
  const creates = SQL.match(/^create table (?!if not exists)/gim) ?? [];
  assert.deepEqual(creates, [], "جدول بلا if not exists");
  const idx = SQL.match(/^create (unique )?index (?!if not exists)/gim) ?? [];
  assert.deepEqual(idx, [], "فهرس بلا if not exists");
  const fn = SQL.match(/^create function /gim) ?? [];
  assert.deepEqual(fn, [], "دالّة بلا create or replace");
  assert.match(SQL, /create sequence if not exists public\.ops_job_code_seq/i, "التسلسل بلا if not exists");
  // السياسات: تُحذف ثمّ تُنشأ (create policy وحدها تفشل في التشغيل الثاني)
  const policies = [...SQL.matchAll(/create policy (\w+) on/gi)].map((m) => m[1]);
  for (const p of policies) {
    assert.match(SQL, new RegExp(`drop policy if exists ${p} on`, "i"), `السياسة ${p} بلا drop if exists`);
  }
  assert.ok(policies.length >= 4, "عدد السياسات المكتوبة صراحةً أقلّ من المتوقّع");
  // المفتاح الخارجيّ يُضاف مرّة واحدة فقط
  assert.match(SQL, /not exists \(select 1 from pg_constraint where conname = 'ops_jobs_project_fk'\)/i,
    "المفتاح الخارجيّ يُضاف بلا حارس — التشغيل الثاني سيفشل");
});

test("Idempotency: بذر مفاتيح الصلاحيات وقائمة السلامة لا يكرّران", () => {
  assert.match(SQL, /on conflict \(key\) do update set/i, "بذر المفاتيح بلا on conflict");
  assert.match(funcBody("prodops_hse_seed"), /where not exists \(select 1 from public\.ops_job_hse/i,
    "بذر السلامة يكرّر البنود");
});

test("لا حذف بيانات في RUNME: صفر DROP TABLE/COLUMN وصفر TRUNCATE وصفر DELETE", () => {
  assert.doesNotMatch(SQL, /drop\s+table/i, "DROP TABLE في ترحيلة إضافية");
  assert.doesNotMatch(SQL, /drop\s+column/i, "DROP COLUMN");
  assert.doesNotMatch(SQL, /truncate/i, "TRUNCATE");
  assert.doesNotMatch(SQL, /^\s*delete\s+from/im, "DELETE في الترحيلة");
  // drop trigger/policy/function مسموح لأنّه إعادة تعريف لا فقدان بيانات
  assert.doesNotMatch(SQL, /drop function/i, "DROP FUNCTION في RUNME (يكسر التبعيات)");
});

test("كلّ مُسنَد يعيد boolean صريحًا ولا يعيد NULL أبدًا", () => {
  const preds = ["prodops_can_view", "prodops_can_manage", "prodops_is_client",
                 "prodops_can_read_job", "prodops_can_edit_job", "prodops_is_crew",
                 "prodops_is_post_assignee", "prodops_perm"];
  for (const p of preds) {
    assert.match(funcDecl(p), /returns boolean/i, `${p}: لا يعيد boolean`);
    const b = funcBody(p);
    assert.match(b, /coalesce\(/i, `${p}: بلا coalesce — قد يعيد NULL`);
    assert.match(b, /false/i, `${p}: بلا قيمة افتراضية false`);
  }
  // والـself-test يستدعيها حيًّا ويسقط لو أعادت NULL أو true بلا جلسة
  const st = SQL.match(/do \$st\$[\s\S]*?end \$st\$;/);
  assert.ok(st, "لا self-test");
  for (const p of ["can_view", "can_manage", "can_read_job", "is_crew", "perm", "is_client"]) {
    assert.match(st[0], new RegExp(`${p}[\\s\\S]{0,120}أعادت NULL`), `self-test لا يفحص NULL في ${p}`);
  }
  assert.match(st[0], /can_view = true بلا جلسة/, "self-test لا يفحص fail-open");
});

test("SELF-TEST صادق: يستطيع الفشل، ولا مصيدة تجعله ينجح مهما حدث", () => {
  const st = SQL.match(/do \$st\$[\s\S]*?end \$st\$;/)[0];
  assert.doesNotMatch(st, /exception\s+when\s+others/i,
    "مصيدة عامّة داخل self-test — اختبار لا يستطيع الفشل ليس اختبارًا");
  const raises = st.match(/raise exception 'OPS SELF-TEST/g) ?? [];
  assert.ok(raises.length >= 20, `عدد فحوص self-test ${raises.length} أقلّ من المتوقّع`);
  // لا يستدعي دالّة محميّة حيًّا (auth.uid() = NULL في محرّر SQL يُسقط الترحيلة)
  for (const f of WRITE_FNS) {
    assert.doesNotMatch(st, new RegExp(`(perform|select)\\s+public\\.${f}\\s*\\(`, "i"),
      `self-test يستدعي ${f} حيًّا — سيموت بـnot authorized في المحرّر`);
  }
  // الفحص النصّيّ يستعمل ilike مع pg_get_functiondef (المُفكِّك يرفع حالة COALESCE)
  assert.match(st, /pg_get_functiondef[\s\S]{0,400}ilike/i, "الفحص النصّيّ لا يستعمل ilike");
});

test("SELF-TEST يثبت أنّ الترحيلة لم تُنشئ بيانات", () => {
  const st = SQL.match(/do \$st\$[\s\S]*?end \$st\$;/)[0];
  assert.match(st, /count\(\*\) into v_n from public\.ops_jobs[\s\S]{0,160}أنشأت/, "لا فحص «صفر مهامّ»");
  assert.match(st, /from public\.ops_audit[\s\S]{0,160}سجلّ التدقيق/, "لا فحص «صفر تدقيق»");
});

test("تدقيق كلّ كتابة حسّاسة في ops_audit", () => {
  for (const f of WRITE_FNS) {
    assert.match(funcBody(f), /prodops_log\(/, `${f}: بلا تدقيق`);
  }
  const log = funcBody("prodops_log");
  assert.match(log, /insert into public\.ops_audit\(actor_id, action, entity_type, entity_id, job_id, detail\)/i,
    "شكل سجلّ التدقيق تغيّر");
  assert.match(log, /auth\.uid\(\)/, "التدقيق لا يسجّل الفاعل");
  // سجلّ التدقيق لا يُحذف من الموديول
  assert.doesNotMatch(SQL, /delete from public\.ops_audit/i, "الموديول يحذف من سجلّ التدقيق");
});

test("★ تجميد منصّة المشاريع: لا كتابة ولا تعديل ولا اعتماد ★", () => {
  const frozen = /(insert\s+into|update|delete\s+from)\s+public\.(projects|project_core|deliverables|deliverable_internal|project_transition_requests)\b/i;
  // يُستثنى الـself-test الذي يفحص هذا النمط نصًّا، والتعليقات.
  const code = SQL.split("\n")
    .filter((l) => !/^\s*--/.test(l) && !/~\*\s*'(insert|update|delete)/.test(l))
    .join("\n");
  assert.doesNotMatch(code, frozen, "الحزمة تكتب في منصّة المشاريع المجمَّدة");
  assert.doesNotMatch(code, /alter table public\.projects/i, "الحزمة تعدّل جدول المشاريع");
  // الرابط اختياريّ: on delete set null، ومشروط بوجود الجدول
  assert.match(SQL, /add constraint ops_jobs_project_fk foreign key \(project_id\)[\s\S]{0,120}on delete set null/i,
    "الرابط بالمشروع ليس SET NULL — قد يمنع حذف مشروع");
  assert.match(SQL, /if to_regclass\('public\.projects'\) is not null/i, "الرابط غير مشروط بوجود الجدول");
  // اسم المشروع يُقرأ من الكتالوج لا بتخمين العمود
  assert.match(funcBody("prodops_project_label"), /information_schema\.columns/i,
    "اسم عمود المشروع مخمَّن — سبق أن أنتج 42703");
  // والـself-test يحرس ذلك بنفسه
  assert.match(SQL, /حارس تجميد منصّة المشاريع/, "لا حارس تجميد داخل self-test");
  // POSTCHECK يقارن لقطة قبل/بعد
  assert.match(POSTCHECK, /frozen_objects/, "POSTCHECK بلا لقطة تجميد");
  assert.match(PREFLIGHT, /frozen_objects/, "PREFLIGHT بلا لقطة تجميد");
});

test("تركيب لا ازدواج: المخزون والعهدة وطبقة 4B تُقرأ ولا تُكتب", () => {
  const ext = funcBody("prodops_external_conflicts");
  assert.match(ext, /custody_inventory_reservations/, "لا قراءة لحجوزات المخزون");
  assert.match(ext, /resource_bookings/, "لا قراءة لحجوزات طبقة التخطيط");
  assert.match(ext, /to_regclass\('public\.custody_inventory_reservations'\) is not null/i,
    "قراءة المخزون غير مكتشَفة — ستنفجر على قاعدة بلا الموديول");
  // ولا كتابة في أيّ من هذه الجداول
  for (const t of ["custody_inventory_reservations", "custody_inventory_assets",
                   "custody_inventory_assignments", "resource_bookings", "planning_resources",
                   "preproduction_items"]) {
    assert.doesNotMatch(SQL, new RegExp(`(insert\\s+into|update|delete\\s+from)\\s+public\\.${t}\\b`, "i"),
      `الحزمة تكتب في ${t} — مصدر حقيقة موديول آخر`);
  }
  // «غير متاح» ≠ «صفر تعارض»
  assert.match(ext, /'unavailable'/, "المسح الخارجيّ لا يميّز غياب المصدر");
  assert.match(ext, /'sources'/, "المسح الخارجيّ لا يُعلن حالة مصادره");
});

test("لا تصادم مع Batch 7B: ops_can_view() القديمة لم تُعرَّف من جديد", () => {
  assert.doesNotMatch(SQL, /create or replace function public\.ops_can_view\s*\(/i,
    "الحزمة تعيد تعريف ops_can_view() الخاصّة بـ7B");
  assert.doesNotMatch(SQL, /create or replace function public\.ops_visible_ids\s*\(/i,
    "الحزمة تعيد تعريف ops_visible_ids() الخاصّة بـ7B");
  // كلّ دوالّ الحزمة ببادئة prodops_
  const names = [...SQL.matchAll(/create or replace function public\.(\w+)\s*\(/gi)].map((m) => m[1]);
  assert.ok(names.length >= 25, `عدد الدوالّ ${names.length} أقلّ من المتوقّع`);
  for (const n of names) assert.match(n, /^prodops_/, `الدالّة ${n} خارج بادئة الموديول`);
});

test("الطقس Placeholder: لا اتصال خارجيّ ولا مفتاح ولا cron", () => {
  assert.match(SQL, /check \(source in \('manual','placeholder'\)\)/i, "قيد مصدر الطقس غائب");
  assert.match(funcBody("prodops_child_upsert"), /'manual'/, "كتابة الطقس لا تُثبّت المصدر اليدويّ");
  assert.doesNotMatch(SQL, /https?:\/\/(?!\s)[a-z]/i, "رابط خارجيّ داخل حزمة SQL");
  assert.doesNotMatch(SQL, /pg_net|http_get|http_post|extensions\.http/i, "استدعاء شبكة من القاعدة");
  assert.doesNotMatch(SQL, /cron\.schedule/i, "جدولة cron");
});

test("سلامة المادّة: التحقّق لا يُقبل قبل نسختين — قيد لا نيّة", () => {
  assert.match(SQL, /constraint ops_backup_verify_needs_two check \(verified = false or \(primary_done and second_done\)\)/i,
    "قيد التحقّق غائب أو ضعيف");
  const b = funcBody("prodops_backup_step");
  assert.match(b, /p_step not in \('primary','second','nas','verified'\)/, "خطوات النسخ غير محصورة");
  assert.match(b, /prodops_can_manage\(\), false\) or coalesce\(public\.prodops_is_crew/i,
    "خطوة النسخ ليست مقصورة على المدير أو طاقم المهمّة");
  // رسالة عربية قبل القيد الخام، والقيد يبقى هو الفاصل
  assert.match(b, /needs_two_copies/, "التحقّق يفشل بـ23514 خام بلا رسالة مفهومة");
  assert.match(b, /لا يُعلَّم التحقّق قبل تسجيل نسختين/, "لا رسالة عربية لرفض التحقّق");
});

test("انتقالات حالة المهمّة مضبوطة — لا قفزة عشوائية", () => {
  const b = funcBody("prodops_job_set_status");
  assert.match(b, /p_status not in \('draft','scheduled','confirmed','in_progress','on_hold','completed','cancelled'\)/,
    "قائمة الحالات غير محصورة");
  assert.match(b, /invalid_transition/, "لا رفض للانتقال غير المسموح");
  assert.match(b, /for update/i, "لا قفل صفّ — سباق ممكن");
  assert.match(b, /v_old = 'cancelled'|else false end/, "لا حالة افتراضية ترفض");
});

test("المُحرِّر العامّ: قائمة بيضاء مغلقة + منع نقل الصفّ بين المهامّ", () => {
  const b = funcBody("prodops_child_upsert");
  for (const k of CHILD_KINDS) assert.match(b, new RegExp(`when '${k}'`), `النوع ${k} غير مدعوم`);
  assert.match(b, /if v_tbl is null then raise exception 'unknown_kind'/i, "نوع مجهول لا يُرفض");
  assert.match(b, /v_owner <> v_job then raise exception 'job_mismatch'/i,
    "يمكن نقل صفّ إلى مهمّة أخرى صامتًا");
  assert.match(b, /prodops_can_edit_job\(v_job\)/, "المُحرِّر بلا بوّابة المهمّة");
  // format(%I) يُبنى من قائمة ثابتة لا من مدخل المستخدم
  assert.match(b, /format\('select job_id from public\.%I where id = \$1', v_tbl\)/i,
    "بناء الاستعلام الديناميكيّ تغيّر — راجع الحقن");
  assert.doesNotMatch(b, /format\([^)]*p_kind/i, "اسم الجدول يُبنى من مدخل المستخدم مباشرةً");
});

test("عربيّ/Unicode: نصوص عربية سليمة، وأعمدة text بلا حدّ يقصّ الحروف", () => {
  assert.ok(/[؀-ۿ]/.test(SQL), "الحزمة بلا نصّ عربيّ");
  assert.doesNotMatch(SQL, /�/, "محارف تالفة (mojibake) في الحزمة");
  // لا varchar(n) على حقول نصّية عربية (الحرف العربيّ متعدّد البايتات)
  assert.doesNotMatch(SQL, /varchar\s*\(\s*\d+\s*\)/i, "varchar بطول ثابت — يقصّ النصّ العربيّ");
  // رسائل الخطأ للمستخدم عربية
  for (const f of ["prodops_job_set_status", "prodops_confirm_attendance", "prodops_call_sheet_publish"]) {
    assert.ok(/[؀-ۿ]/.test(funcBody(f)), `${f}: بلا رسالة عربية`);
  }
  // بنود السلامة المبذورة عربية
  assert.match(funcBody("prodops_hse_seed"), /إحاطة المخاطر/, "بنود السلامة ليست عربية");
});

test("ROLLBACK صادق: مرحلة آمنة أوّلًا، والحذف معلَّق ويذكر ما يُفقَد", () => {
  assert.match(ROLLBACK, /revoke all on function[\s\S]{0,200}from authenticated/i, "لا مرحلة تعطيل آمنة");
  assert.match(ROLLBACK, /ما الذي يُفقَد فعلًا/, "لا قسم يشرح ما يُفقَد");
  assert.match(ROLLBACK, /التقارير اليومية/, "لا يذكر فقدان التقارير");
  assert.match(ROLLBACK, /ops_audit/, "لا يذكر فقدان سجلّ التدقيق");
  // الحذف الكامل معلَّق سطرًا سطرًا
  const dropLines = ROLLBACK.split("\n").filter((l) => /drop table/i.test(l));
  assert.ok(dropLines.length >= 15, "قائمة الحذف ناقصة");
  for (const l of dropLines) assert.match(l, /^\s*--/, `سطر حذف غير معلَّق: ${l.trim()}`);
  // ولا يمسّ المنصّة ولا موديولات أخرى
  assert.doesNotMatch(ROLLBACK.replace(/^\s*--.*$/gm, ""), /projects|custody_inventory|resource_bookings/i,
    "ROLLBACK يمسّ جداول موديولات أخرى");
});

test("POSTCHECK يفحص ما يهمّ فعلًا (لا يكتفي بوجود الجداول)", () => {
  for (const t of TABLES) assert.match(POSTCHECK, new RegExp(`'${t}'`), `${t} خارج POSTCHECK`);
  assert.match(POSTCHECK, /cmd <> 'SELECT'/, "لا فحص لسياسات الكتابة");
  assert.match(POSTCHECK, /grantee = 'anon'/, "لا فحص لصلاحيات anon");
  assert.match(POSTCHECK, /prosecdef/, "لا فحص SECURITY DEFINER");
  assert.match(POSTCHECK, /proconfig/, "لا فحص search_path");
  assert.match(POSTCHECK, /prodops_can_view\(\)/, "لا فحص للمُسنَدات حيًّا");
  assert.match(POSTCHECK, /prodops_access\(\)/, "لا فحص لمِجَسّ الكشف");
  assert.match(POSTCHECK, /confdeltype/, "لا فحص لنوع حذف المفتاح الخارجيّ");
});
