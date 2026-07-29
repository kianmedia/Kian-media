// ════════════════════════════════════════════════════════════════════════════
// tests/ops_client_denial.test.js — Phase 2: العميل خارج المركز، وتجاوز الواجهة
// لا يفتح بابًا.
//
// «إخفاء الزرّ ليس تصريحًا». هذه الاختبارات تفترض مهاجمًا يملك جلسة عميل صالحة
// ومفتاح anon، ويستدعي PostgREST مباشرةً بلا واجهتنا.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const { read, SQL, funcBody, TABLES, PUBLIC_FNS } = require("./ops_helpers.js");

test("العميل مستبعد بنيويًّا: بوّابة العرض تشترط is_staff", () => {
  const b = funcBody("prodops_can_view");
  assert.match(b, /is_staff\(\)/, "بوّابة العرض لا تشترط كون المستخدم موظّفًا");
  assert.match(b, /auth\.uid\(\)\s+is\s+not\s+null/, "بلا جلسة تمرّ");
  // ولا يوجد أيّ مسار يمنح العميل قدرة
  assert.doesNotMatch(b, /account_type\s*=\s*'client'|'lead'/, "مسار خاصّ بالعميل");
  const c = funcBody("prodops_is_client");
  assert.match(c, /not\s+coalesce\(public\.is_staff\(\),\s*false\)/, "تعريف العميل غير مبنيّ على نفي الموظّف");
});

test("كلّ دالّة قراءة تُغلق على العميل قبل أن تقرأ صفًّا واحدًا", () => {
  for (const f of ["prodops_jobs_list", "prodops_dashboard", "prodops_calendar",
                   "prodops_conflicts", "prodops_lookups", "prodops_my_assignments"]) {
    const b = funcBody(f);
    assert.match(b, /if not coalesce\(public\.prodops_can_view\(\), false\) then raise exception 'not authorized'/i,
      `${f}: بلا بوّابة المركز`);
  }
  // تفصيل المهمّة وCall Sheet والجاهزية: بوّابة الصفّ لا بوّابة المركز فقط
  for (const f of ["prodops_job_detail", "prodops_call_sheet", "prodops_readiness"]) {
    assert.match(funcBody(f), /prodops_can_read_job\(p_job\)/, `${f}: بلا بوّابة صفّ`);
  }
});

test("prodops_access مِجَسّ لا ثغرة: ينجح لأيّ جلسة ويعيد قدرات كلّها false للعميل", () => {
  const b = funcBody("prodops_access");
  assert.doesNotMatch(b, /raise exception/i, "المِجَسّ يرفع استثناء — تفقد الواجهة القدرة على التفريق");
  assert.match(b, /'can_view',\s*coalesce\(public\.prodops_can_view\(\), false\)/,
    "المِجَسّ لا يشتقّ القدرة من المُسنَد");
  assert.match(b, /'can_manage',\s*coalesce\(public\.prodops_can_manage\(\), false\)/,
    "قدرة الإدارة غير مشتقّة من المُسنَد");
  // لا يسرّب بيانات: لا أسماء مهامّ ولا عدّادات
  assert.doesNotMatch(b, /from public\.ops_jobs/i, "المِجَسّ يقرأ مهامّ");
});

test("تجاوز الواجهة: RLS مفعّلة على كلّ جدول، وسياساتها قراءة فقط", () => {
  for (const t of TABLES) {
    assert.ok(
      new RegExp("alter table public\\.%I enable row level security", "i").test(SQL)
        || new RegExp(`alter table public\\.${t} enable row level security`, "i").test(SQL),
      `${t}: RLS غير مفعّلة`,
    );
  }
  // التفعيل يجري لكلّ الجداول عبر حلقة تضمّ الأسماء العشرين
  const loop = SQL.match(/foreach t in array array\[([\s\S]*?)\] loop\s*\n\s*execute format\('alter table public\.%I enable row level security'/i);
  assert.ok(loop, "لا حلقة تفعيل RLS");
  for (const t of TABLES) assert.match(loop[1], new RegExp(`'${t}'`), `${t} خارج حلقة تفعيل RLS`);
  assert.doesNotMatch(SQL, /for\s+(insert|update|delete|all)\s+to\s+authenticated/i, "سياسة كتابة");
});

test("تجاوز الواجهة: التقرير والتسليم لا يُقرآن إلّا لصاحبهما أو للمدير", () => {
  assert.match(SQL,
    /create policy ops_daily_reports_read[\s\S]{0,200}using \(public\.prodops_can_manage\(\) or prepared_by = auth\.uid\(\)\)/i,
    "سياسة التقرير اليوميّ لا تقصره على كاتبه");
  assert.match(SQL,
    /create policy ops_post_handoff_read[\s\S]{0,220}using \(public\.prodops_can_manage\(\) or handed_to_user_id = auth\.uid\(\)\)/i,
    "سياسة التسليم لا تقصره على المُسنَد إليه");
  assert.match(SQL,
    /create policy ops_audit_read[\s\S]{0,160}using \(public\.prodops_can_manage\(\)\)/i,
    "سجلّ التدقيق مقروء لغير الإدارة");
});

test("صفر صلاحية anon: سحب صريح لكلّ دالّة وكلّ جدول", () => {
  assert.match(SQL, /revoke all on function %s from anon/i, "لا سحب anon عن الدوالّ");
  assert.match(SQL, /revoke all on table public\.%I from anon/i, "لا سحب anon عن الجداول");
  assert.doesNotMatch(SQL, /grant\s+[a-z ,]*\s+on\s+(function|table)[^;]*\bto\s+anon\b/i, "منح لـanon");
  assert.doesNotMatch(SQL, /to anon\b/i, "ذكر منح لـanon");
  // الدوالّ الداخلية تُسحب حتى من authenticated
  assert.match(SQL, /revoke all on function %s from authenticated/i, "الدوالّ الداخلية غير محميّة");
  for (const f of ["prodops_conflicts_core", "prodops_readiness_core", "prodops_log",
                   "prodops_visible_jobs", "prodops_next_job_code", "prodops_external_conflicts"]) {
    assert.match(SQL, new RegExp(`'public\\.${f}\\(`), `${f} ليست في قائمة السحب الداخلية`);
  }
});

test("قائمة المنح تغطّي كلّ دالّة عامّة — لا دالّة تبقى بلا قرار صريح", () => {
  const grantBlock = SQL.match(/\(أ\) الدوالّ العامّة[\s\S]*?end loop;/);
  assert.ok(grantBlock, "كتلة منح الدوالّ العامّة غير موجودة");
  for (const f of PUBLIC_FNS) {
    assert.match(grantBlock[0], new RegExp(`'public\\.${f}\\(`), `${f} خارج قائمة المنح`);
  }
});

test("العميل لا يُشعَر ولا يُذكر: الإشعار لمستخدم داخليّ فقط", () => {
  const n = funcBody("prodops_notify");
  assert.match(n, /p_user is null or p_user = auth\.uid\(\) then return/i, "الإشعار لا يتخطّى الفاعل/الفارغ");
  // لا استدعاء notify بدور 'admin' جماعيّ ولا بأيّ دور عميل
  assert.doesNotMatch(SQL, /prodops_notify\([^)]*'client'/i, "إشعار موجّه لعميل");
});

test("لا مسار خادم يتجاوز RLS: صفر service_role وصفر مفتاح خدمة في الموديول", () => {
  assert.doesNotMatch(SQL, /service_role/i, "منح لـservice_role في حزمة تشغيلية");
  const ts = read("lib/portal/opsCenter.ts");
  assert.doesNotMatch(ts, /service_role|SERVICE_KEY|SUPABASE_SERVICE/i, "مفتاح خدمة في طبقة المتصفّح");
  assert.match(ts, /from "\.\/client"/, "لا يستعمل عميل البوابة الموحّد");
});
