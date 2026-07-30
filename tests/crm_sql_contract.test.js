// ════════════════════════════════════════════════════════════════════════════
// tests/crm_sql_contract.test.js — Phase 3: عقد حزمة الـSQL.
//
// أربعة ملفّات · معاملة واحدة · idempotency (وإعادة تشغيل فوق بيانات حقيقية) ·
// مُسنَدات لا تعيد NULL · تدقيق كلّ كتابة حسّاسة · صدق الـself-test ·
// لا صلاحية anon · لا سياسة كتابة مباشرة.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  exists, SQL, PREFLIGHT, POSTCHECK, ROLLBACK,
  funcBody, funcDecl, selfTest, TABLES, PREDICATES, WRITE_FNS, READ_FNS, INTERNAL_FNS,
} = require("./crm_helpers.js");

test("الحزمة أربعة ملفّات، وكلّها موجودة", () => {
  for (const f of ["PREFLIGHT", "RUNME", "POSTCHECK", "ROLLBACK"]) {
    assert.ok(exists(`docs/crm_sales_FOUNDATION_${f}.sql`), `الملفّ ${f} مفقود`);
  }
});

test("PREFLIGHT وPOSTCHECK للقراءة فقط — لا كتابة ولا DDL ولا معاملة", () => {
  for (const [name, src] of [["PREFLIGHT", PREFLIGHT], ["POSTCHECK", POSTCHECK]]) {
    assert.doesNotMatch(src, /^\s*(insert|update|delete|create|alter|drop|grant|revoke|truncate)\b/im,
      `${name}: يحتوي كتابة أو DDL`);
    assert.doesNotMatch(src, /^\s*(begin|commit);/im, `${name}: يفتح معاملة`);
  }
});

test("ROLLBACK صادق: يقول ماذا يُفقَد، ولا يُشغَّل بالخطأ", () => {
  // كلّ سطر هدم معلَّق: التراجع قرار لا حادث.
  const live = ROLLBACK.split("\n").filter((l) => /^\s*(drop|delete|truncate|begin|commit)\b/i.test(l));
  assert.deepEqual(live, [], "ROLLBACK يحتوي سطر هدم غير معلَّق");
  assert.match(ROLLBACK, /يحذف بيانات/, "ROLLBACK لا يصرّح بأنّه يحذف بيانات");
  assert.match(ROLLBACK, /crm_audit/, "ROLLBACK لا يذكر فقدان سجلّ التدقيق");
  assert.match(ROLLBACK, /نسخة احتياطية/, "ROLLBACK بلا خطوة نسخة احتياطية");
  // ولا يلمس المنصّة ولا طلبات الأسعار
  assert.doesNotMatch(ROLLBACK, /drop\s+table\s+if\s+exists\s+public\.(projects|project_core|deliverables|quote_requests)/i,
    "ROLLBACK يسقط جدولًا خارج الوحدة");
});

test("RUNME داخل معاملة واحدة، وينتهي بإعادة تحميل المخطّط", () => {
  assert.match(SQL, /\nbegin;[\s\S]*\ncommit;/, "ليس داخل معاملة");
  assert.match(SQL, /notify pgrst, 'reload schema';/,
    "لا إعادة تحميل مخطّط — الواجهة ستقرأ PGRST202 كاذبًا بعد ترحيلة ناجحة");
  const pre = SQL.slice(0, SQL.indexOf("\nbegin;"));
  assert.match(pre, /do \$pre\$[\s\S]*raise exception 'CRM PREFLIGHT/i,
    "لا PREFLIGHT صلب يوقف التشغيل قبل كتابة أيّ شيء");
});

test("Idempotency: كلّ إنشاء يحتمل إعادة التشغيل", () => {
  assert.deepEqual(SQL.match(/^create table (?!if not exists)/gim) ?? [], [], "جدول بلا if not exists");
  assert.deepEqual(SQL.match(/^create (unique )?index (?!if not exists)/gim) ?? [], [], "فهرس بلا if not exists");
  assert.deepEqual(SQL.match(/^create function /gim) ?? [], [], "دالّة بلا create or replace");
  assert.match(SQL, /create sequence if not exists public\.crm_lead_code_seq/i, "تسلسل بلا if not exists");
  assert.match(SQL, /create sequence if not exists public\.crm_opportunity_code_seq/i, "تسلسل بلا if not exists");
  // السياسات: تُحذف ثمّ تُنشأ (create policy وحدها تفشل في التشغيل الثاني)
  const policies = [...SQL.matchAll(/create policy (\w+) on/gi)].map((m) => m[1]);
  for (const p of policies) {
    assert.match(SQL, new RegExp(`drop policy if exists ${p} on`, "i"), `السياسة ${p} بلا drop if exists`);
  }
  assert.ok(policies.length >= 8, `عدد السياسات المكتوبة صراحةً ${policies.length} أقلّ من المتوقّع`);
  // المُشغِّلات كذلك
  const triggers = [...SQL.matchAll(/create trigger (\w+)/gi)].map((m) => m[1]);
  for (const t of triggers) {
    assert.match(SQL, new RegExp(`drop trigger if exists ${t} on`, "i"), `المُشغِّل ${t} بلا drop if exists`);
  }
  // المفاتيح الخارجية الاختيارية بحارس pg_constraint
  for (const c of ["crm_opp_quote_fk", "crm_opp_project_fk"]) {
    assert.match(SQL, new RegExp(`not exists \\(select 1 from pg_constraint where conname = '${c}'\\)`, "i"),
      `المفتاح الخارجيّ ${c} يُضاف بلا حارس — التشغيل الثاني سيفشل`);
  }
  // البذور
  assert.match(SQL, /on conflict \(key\) do update set/i, "بذر المفاتيح بلا on conflict");
  assert.match(SQL, /on conflict \(key\) do nothing/i, "بذر الإعدادات/القواعد بلا on conflict");
  assert.match(SQL, /and not exists \(select 1 from public\.crm_stages s/i, "بذر المراحل قد يكرّر");
});

test("لا حذف بيانات في RUNME: صفر DROP TABLE/COLUMN وصفر TRUNCATE وصفر DELETE", () => {
  assert.doesNotMatch(SQL, /drop\s+table/i, "DROP TABLE في ترحيلة إضافية");
  assert.doesNotMatch(SQL, /drop\s+column/i, "DROP COLUMN");
  assert.doesNotMatch(SQL, /truncate/i, "TRUNCATE");
  assert.doesNotMatch(SQL, /^\s*delete\s+from/im, "DELETE في الترحيلة");
  assert.doesNotMatch(SQL, /drop function/i, "DROP FUNCTION في RUNME (يكسر التبعيات)");
});

test("كلّ مُسنَد يعيد boolean صريحًا ولا يعيد NULL أبدًا", () => {
  for (const p of PREDICATES) {
    assert.match(funcDecl(p), /returns boolean/i, `${p}: لا يعيد boolean`);
    const b = funcBody(p);
    assert.match(b, /coalesce\(/i, `${p}: بلا coalesce — قد يعيد NULL`);
    assert.match(b, /false/i, `${p}: بلا قيمة افتراضية false`);
  }
});

test("SELF-TEST يستدعي المُسنَدات حيًّا ويسقط على NULL أو fail-open", () => {
  const st = selfTest();
  for (const p of ["can_view", "can_manage", "can_view_team", "can_see_owner", "can_read_lead",
                   "can_view_commission", "can_manage_targets", "can_import", "perm"]) {
    assert.match(st, new RegExp(`${p}[\\s\\S]{0,160}أعادت NULL`), `self-test لا يفحص NULL في ${p}`);
  }
  assert.match(st, /can_view = true بلا جلسة/, "self-test لا يفحص fail-open");
  assert.match(st, /can_view_team = true بلا جلسة/, "self-test لا يفحص fail-open في رؤية الفريق");
});

test("SELF-TEST صادق: يستطيع الفشل، ولا مصيدة تجعله ينجح مهما حدث", () => {
  const st = selfTest();
  assert.doesNotMatch(st, /exception\s+when\s+others/i,
    "مصيدة عامّة داخل self-test — اختبار لا يستطيع الفشل ليس اختبارًا");
  const raises = st.match(/raise exception 'CRM SELF-TEST/g) ?? [];
  assert.ok(raises.length >= 40, `عدد فحوص self-test ${raises.length} أقلّ من المتوقّع`);
  // لا يستدعي دالّة كتابة حيًّا (auth.uid() = NULL في المحرّر يُسقط الترحيلة)
  for (const f of WRITE_FNS) {
    assert.doesNotMatch(st, new RegExp(`(perform|select)\\s+public\\.${f}\\s*\\(`, "i"),
      `self-test يستدعي ${f} حيًّا — سيموت بـnot authorized في المحرّر`);
  }
  // ولا دالّة قراءة محميّة ترفع استثناءً (crm_access وحدها آمنة: مِجَسّ)
  for (const f of READ_FNS.filter((x) => x !== "crm_access")) {
    assert.doesNotMatch(st, new RegExp(`(perform|select)\\s+public\\.${f}\\s*\\(`, "i"),
      `self-test يستدعي ${f} حيًّا — سيموت بـnot authorized`);
  }
  // الفحص النصّيّ يستعمل ilike/~* لا المطابقة الحسّاسة لحالة الأحرف
  assert.match(st, /pg_get_functiondef[\s\S]{0,600}(ilike|~\*)/i, "الفحص النصّيّ لا يتجاهل حالة الأحرف");
});

test("SELF-TEST يثبت أنّ الترحيلة لم تُنشئ بيانات — وبطريقة تصمد عند إعادة التشغيل", () => {
  const st = selfTest();
  // now() ثابت داخل المعاملة: created_at = now() يعني «أنشأته هذه الترحيلة»،
  // بخلاف count(*) = 0 الذي ينهار على قاعدة فيها بيانات حقيقية.
  assert.match(st, /from public\.crm_leads where created_at = now\(\)/i,
    "فحص «صفر عملاء» يعتمد على العدّ المطلق فينهار عند إعادة التشغيل فوق بيانات");
  assert.match(st, /from public\.crm_opportunities where created_at = now\(\)/i, "لا فحص «صفر فرص»");
  assert.match(st, /from public\.crm_audit where created_at = now\(\)/i, "لا فحص «صفر تدقيق»");
});

test("تدقيق كلّ كتابة حسّاسة في crm_audit", () => {
  for (const f of WRITE_FNS) {
    assert.match(funcBody(f), /crm_log\(/, `${f}: بلا تدقيق`);
  }
  const log = funcBody("crm_log");
  assert.match(log, /insert into public\.crm_audit\(actor_id, action, entity_type, entity_id, detail\)/i,
    "شكل سجلّ التدقيق تغيّر");
  assert.match(log, /auth\.uid\(\)/, "التدقيق لا يسجّل الفاعل");
  // والتصدير مُدقَّق أيضًا (وهو قراءة، لكنّه إخراج بيانات)
  assert.match(funcBody("crm_export"), /crm_log\(/, "التصدير بلا تدقيق");
  assert.match(funcDecl("crm_export"), /volatile/i,
    "التصدير stable فلن يستطيع الكتابة في سجلّ التدقيق — تناقض صامت");
});

test("كلّ دالّة عامّة: SECURITY DEFINER بمسار بحث مثبَّت", () => {
  for (const f of [...WRITE_FNS, ...READ_FNS, ...PREDICATES, ...INTERNAL_FNS]) {
    const d = funcDecl(f);
    assert.match(d, /security definer/i, `${f}: ليست SECURITY DEFINER`);
    assert.match(d, /set search_path = public/i, `${f}: بلا search_path مثبَّت`);
  }
});

test("كلّ دالّة كتابة: بوّابة جلسة ومنع صريح", () => {
  for (const f of WRITE_FNS) {
    const b = funcBody(f);
    assert.match(b, /auth\.uid\(\) is null/i, `${f}: بلا بوّابة جلسة`);
    assert.match(b, /not authorized/i, `${f}: لا ترفع منعًا صريحًا`);
  }
});

test("لا سياسة كتابة مباشرة على أيّ جدول — الكتابة كلّها عبر RPC", () => {
  const policies = [...SQL.matchAll(/create policy\s+(?:%I|\w+)\s+on\s+(?:public\.%I|public\.\w+)\s+for\s+(\w+)/gi)]
    .map((m) => m[1].toLowerCase());
  for (const cmd of policies) {
    assert.equal(cmd, "select", `سياسة غير SELECT (${cmd}) — الكتابة يجب أن تمرّ بـRPC`);
  }
  assert.ok(policies.length >= 8, "عدد السياسات المرصودة أقلّ من المتوقّع");
  // ومنح الجداول: SELECT فقط
  assert.match(SQL, /grant select on table public\.%I to authenticated/i, "لا منح SELECT للجداول");
  assert.doesNotMatch(SQL, /grant (insert|update|delete)[\s\S]{0,80}on table public\./i,
    "منح كتابة مباشر على جدول");
});

test("RLS مفعّلة على الجداول التسعة عشر كلّها", () => {
  for (const t of TABLES) {
    assert.ok(SQL.includes(`'${t}'`), `الجدول ${t} غائب عن قوائم الترحيلة`);
    assert.match(SQL, new RegExp(`create table if not exists public\\.${t}\\b`, "i"),
      `الجدول ${t} غير مُنشأ`);
  }
  assert.match(SQL, /alter table public\.%I enable row level security/i, "لا تفعيل RLS");
  const st = selfTest();
  assert.match(st, /RLS غير مفعّلة على/, "self-test لا يفحص تفعيل RLS");
});

test("لا صلاحية anon على أيّ جدول أو دالّة", () => {
  assert.match(SQL, /revoke all on function %s from anon/i, "لا سحب anon عن الدوالّ");
  assert.match(SQL, /revoke all on table public\.%I from anon/i, "لا سحب anon عن الجداول");
  assert.doesNotMatch(SQL, /grant\s+(execute|select)[\s\S]{0,80}to anon/i, "منح صريح لـanon");
  const st = selfTest();
  assert.match(st, /anon يملك EXECUTE على/, "self-test لا يفحص anon على الدوالّ");
  assert.match(st, /anon يملك صلاحية على/, "self-test لا يفحص anon على الجداول");
});

test("الدوالّ الداخلية محجوبة عن authenticated", () => {
  for (const f of INTERNAL_FNS) {
    assert.match(SQL, new RegExp(`'public\\.${f}\\(`, "i"), `${f} غائبة عن قائمة السحب`);
  }
  assert.match(SQL, /revoke all on function %s from authenticated/i, "لا سحب authenticated عن الداخلية");
  assert.match(selfTest(), /authenticated يملك EXECUTE على دالّة داخلية/,
    "self-test لا يفحص تسرّب الدوالّ الداخلية");
});

test("الموديول يملك مُسنَداته: لا اعتماد على can_manage_projects", () => {
  // يُستثنى نصّ الـself-test نفسه: ذكره هناك حراسة ضدّ الاعتماد لا اعتماد.
  const body = SQL.replace(selfTest(), "").replace(/^--.*$/gm, "");
  assert.doesNotMatch(body, /can_manage_projects/i, "الحزمة تتّكئ على can_manage_projects");
  assert.match(selfTest(), /can_manage_projects/, "self-test لا يحرس ضدّ can_manage_projects");
});

test("الدرجة والجاهزية مشتقّتان لا محفوظتين", () => {
  // لا عمود score على crm_leads
  const leadTable = SQL.match(/create table if not exists public\.crm_leads \(([\s\S]*?)\n\);/);
  assert.ok(leadTable, "تعذّر إيجاد تعريف crm_leads");
  assert.doesNotMatch(leadTable[1], /^\s*score\s+(int|integer|numeric)/im,
    "عمود score محفوظ — الدرجة يجب أن تبقى مشتقّة");
  assert.match(leadTable[1], /score_manual_adjust/, "لا عمود تعديل يدويّ معلَن");
  assert.match(leadTable[1], /score_override_reason/, "التجاوز بلا سبب معلَن");
  // الجاهزية تُحسب في الدالّة لا تُخزَّن
  const opp = SQL.match(/create table if not exists public\.crm_opportunities \(([\s\S]*?)\n\);/);
  assert.doesNotMatch(opp[1], /readiness_score/i, "درجة الجاهزية محفوظة كعمود");
  assert.match(selfTest(), /محفوظة كعمود/, "self-test لا يحرس اشتقاق الدرجة");
});

test("التنبّؤ والركود يقرآن العتبات من الإعدادات لا من أرقام سحرية", () => {
  const stale = funcBody("crm_stale_alerts");
  assert.match(stale, /crm_setting_int\('stale_days'/, "عتبة الركود رقم سحريّ");
  assert.match(stale, /crm_setting_int\('stale_stage_days'/, "عتبة المرحلة رقم سحريّ");
  const dup = funcBody("crm_duplicate_core");
  assert.match(dup, /crm_setting_int\('duplicate_window_days'/, "نافذة التكرار رقم سحريّ");
});

test("القوائم تُرتَّب قبل القصّ — LIMIT بلا ORDER BY يقتطع صفوفًا عشوائية", () => {
  for (const f of ["crm_leads_list", "crm_opportunities_list", "crm_activities_list"]) {
    const b = funcBody(f);
    const i = b.toLowerCase().lastIndexOf("order by");
    const j = b.toLowerCase().lastIndexOf("limit");
    assert.ok(i !== -1 && j !== -1 && i < j, `${f}: LIMIT قبل ORDER BY أو بلا ترتيب`);
  }
});

test("الحدود العليا مقيَّدة — لا استعلام بلا سقف", () => {
  for (const f of ["crm_leads_list", "crm_opportunities_list", "crm_activities_list", "crm_audit_list"]) {
    assert.match(funcBody(f), /least\(greatest\(coalesce\(\(p_filters->>'limit'\)::int/i,
      `${f}: الحدّ الأقصى غير مقيَّد`);
  }
  assert.match(funcBody("crm_import_leads"), /too_many_rows/, "الاستيراد بلا سقف صفوف");
});

test("POSTCHECK يفحص ما تعد به الترحيلة فعلًا", () => {
  for (const needle of [
    /cmd <> 'SELECT'/,                                   // لا سياسة كتابة
    /grantee = 'anon'/,                                  // لا anon
    /privilege_type <> 'SELECT'/,                        // لا كتابة لـauthenticated
    /prosecdef as security_definer/,                     // definer
    /pinned_search_path/,                                // search_path
    /crm_can_view\(\)/,                                  // مُسنَدات لا تعيد NULL
    /column_name = 'score'/,                             // الدرجة مشتقّة
    /crm_norm_text/,                                     // التطبيع العربيّ
    /self_target_denied/,                                // منع الهدف الذاتيّ
    /self_commission_denied/,                            // منع العمولة الذاتية
    /leaks_via_manage/,                                  // فصل العمولة عن الإدارة
    /quote_requests\\b/,                                 // لا كتابة في طلبات الأسعار
    /frozen_objects/,                                    // لقطة التجميد
  ]) {
    assert.match(POSTCHECK, needle, `POSTCHECK لا يفحص: ${needle}`);
  }
});

test("PREFLIGHT يفحص الاعتمادات وقدرات الخادم التي يعتمد عليها التطبيع", () => {
  assert.match(PREFLIGHT, /is_staff\(\)/, "PREFLIGHT لا يفحص is_staff");
  assert.match(PREFLIGHT, /emp_has_permission/, "PREFLIGHT لا يفحص محرّك الصلاحيات");
  assert.match(PREFLIGHT, /standard_conforming_strings/, "PREFLIGHT لا يفحص standard_conforming_strings");
  assert.match(PREFLIGHT, /server_encoding/, "PREFLIGHT لا يفحص الترميز — تطبيع العربية يعتمد عليه");
  assert.match(PREFLIGHT, /table_name = 'quote_requests'/, "PREFLIGHT لا يفحص أعمدة طلبات الأسعار");
  assert.match(PREFLIGHT, /'project_name','title','name'/, "PREFLIGHT لا يقرأ اسم عمود المشروع");
});
