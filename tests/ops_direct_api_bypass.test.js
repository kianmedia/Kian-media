// ════════════════════════════════════════════════════════════════════════════
// tests/ops_direct_api_bypass.test.js
// تجاوز الواجهة: ماذا يحدث لو استُدعي PostgREST مباشرةً بمفتاح anon أو بجلسة
// موظّف عاديّ — POST/PATCH/DELETE على الجدول، أو استدعاء دالّة داخلية؟
//
// القاعدة المعماريّة: **لا سياسة كتابة على أيّ جدول**. الجداول SELECT فقط عبر
// RLS، والكتابة كلّها عبر SECURITY DEFINER RPC تفحص الهويّة بنفسها. إخفاء الزرّ
// ليس تصريحًا، وتصفية الواجهة ليست عزلًا.
//
// المسارات المطلوب تغطيتها صراحةً: إسناد الطاقم · حجز المعدّات · التصاريح ·
// التقارير · التحقّق من النسخ · الحوادث · الجاهزية.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const { SQL, funcBody, TABLES } = require("./ops_helpers");

const RLS = SQL.slice(SQL.indexOf("§5)"), SQL.indexOf("§6)"));
const GRANTS = SQL.slice(SQL.indexOf("§12)"));

test("PATCH/POST/DELETE مباشر مرفوض: صفر سياسة كتابة على كلّ جدول", () => {
  const policies = RLS.match(/create policy[\s\S]*?;/g) ?? [];
  assert.ok(policies.length > 0 || /for select to authenticated/.test(RLS), "لا سياسات أصلًا");
  assert.doesNotMatch(RLS, /for\s+(insert|update|delete|all)\b/i,
    "سياسة كتابة مباشرة — PATCH على الجدول سينجح");
  assert.doesNotMatch(RLS, /with check/i, "سياسة كتابة مخفيّة عبر WITH CHECK");
  // ولا منح كتابة على أيّ جدول
  assert.doesNotMatch(GRANTS, /grant\s+(insert|update|delete|all)\s+on\s+table/i,
    "منح كتابة على جدول — الـRPC صارت اختيارية");
  assert.match(GRANTS, /grant select on table public\.%I to authenticated/i,
    "لا منح قراءة صريح — الشاشات ستقرأ 42501 بلا سبب");
});

test("كلّ جدول عليه RLS مفعّلة — لا جدول يُنسى فيصير مفتوحًا", () => {
  const enable = RLS.match(/alter table public\.%I enable row level security/i);
  assert.ok(enable, "لا تفعيل RLS");
  for (const t of TABLES) assert.ok(RLS.includes(`'${t}'`), `${t} خارج حلقة تفعيل RLS`);
});

test("anon لا يملك شيئًا: لا جدول ولا دالّة ولا تسلسل", () => {
  assert.match(GRANTS, /revoke all on table public\.%I from public/i, "لا سحب عامّ على الجداول");
  assert.match(GRANTS, /revoke all on table public\.%I from anon/i, "لا سحب صريح من anon");
  assert.match(GRANTS, /revoke all on function %s from anon/i, "لا سحب صريح من anon على الدوالّ");
  assert.match(GRANTS, /revoke all on sequence public\.ops_job_code_seq from anon/i,
    "تسلسل رقم المهمّة مكشوف لـanon");
  assert.doesNotMatch(SQL, /grant[^\n]*to anon/i, "منح صريح لـanon في مكان ما");
});

const SENSITIVE = [
  ["إسناد الطاقم",        "crew",        /if not coalesce\(public\.prodops_can_edit_job/],
  ["حجز المعدّات",         "equipment",   /if not coalesce\(public\.prodops_can_edit_job/],
  ["التصاريح",            "permit",      /if not coalesce\(public\.prodops_can_edit_job/],
  ["الحوادث",             "incident",    /if not coalesce\(public\.prodops_can_edit_job/],
];

test("المسارات الحسّاسة تفحص الهويّة داخل الدالّة لا قبل الزرّ", () => {
  const b = funcBody("prodops_child_upsert");
  assert.match(b, /if auth\.uid\(\) is null then raise exception 'not authorized'/,
    "لا فحص جلسة");
  for (const [ar, kind, re] of SENSITIVE) {
    assert.ok(b.includes(`'${kind}'`), `${ar}: النوع خارج القائمة البيضاء`);
    assert.match(b, re, `${ar}: بلا فحص صلاحية داخل الدالّة`);
  }
  // القائمة البيضاء مغلقة: نوع غير معروف يُرفض بدل أن يُبنى اسم جدول من المدخل
  assert.match(b, /if v_tbl is null then raise exception 'unknown_kind'/, "قائمة الأنواع مفتوحة");
  assert.doesNotMatch(b, /format\([^)]*p_kind/i, "اسم الجدول يُبنى من مدخل المستخدم");
  // ولا نقل صامت لصفّ بين المهامّ
  assert.match(b, /if v_owner <> v_job then raise exception 'job_mismatch'/,
    "يمكن نقل صفّ إلى مهمّة أخرى بتزوير job_id");
});

test("التحقّق من النسخ الاحتياطي لا يُزوَّر: لا نيابة، ولا نسخة واحدة، ولا مُوقِّع من الحمولة", () => {
  const b = funcBody("prodops_backup_step");
  // (1) لا يوقّع أحدٌ عن أحد
  assert.match(b, /holder_user_id/, "حامل البطاقة غير مقروء");
  assert.match(b, /v_holder is null or v_holder <> auth\.uid\(\)/, "لا مقارنة بالحامل");
  assert.match(b, /not_card_holder/, "لا رفض صريح لغير الحامل");
  // (2) المُوقِّع من الجلسة لا من الحمولة
  assert.match(b, /verified_by\s+=[\s\S]{0,120}auth\.uid\(\)/, "المُوقِّع ليس من الجلسة");
  assert.doesNotMatch(b, /p_verified_by|p_user|p_actor/, "الدالّة تقبل مُوقِّعًا من المُستدعي");
  // (3) لا تحقّق قبل نسختين — والقيد في القاعدة هو الفاصل
  assert.match(b, /needs_two_copies/, "لا رفض قبل نسختين");
  assert.match(SQL, /constraint ops_backup_verify_needs_two/, "لا قيد في الجدول");
  // (4) حالة البطاقة تُشتقّ من الواقع لا من نيّة المُستدعي
  assert.match(b, /when v_row\.verified then 'verified'/, "حالة البطاقة لا تُشتقّ من الصفّ الفعليّ");
});

test("تأكيد الحضور لا يقبل النيابة من أيّ مسار", () => {
  const b = funcBody("prodops_confirm_attendance");
  assert.match(b, /user_id = auth\.uid\(\)/, "الشرط غائب");
  assert.match(b, /'not_assigned'/, "لا ردّ صريح لمن ليس ضمن الطاقم");
  // ولا يوجد مسار آخر يكتب حالة الحضور
  const others = ["prodops_child_upsert"];
  for (const fn of others) {
    const ob = funcBody(fn);
    assert.doesNotMatch(ob, /attendance_confirmed_at\s*=/,
      `${fn} تكتب تأكيد الحضور — طريق التفاف حول شرط صاحب الجلسة`);
  }
});

test("الجاهزية مشتقّة بالكامل: لا عمود يُكتب فيُزوَّر", () => {
  const b = funcBody("prodops_readiness_core");
  assert.match(b, /select \* into j from public\.ops_jobs/, "لا تقرأ المهمّة");
  assert.doesNotMatch(b, /update public\.|insert into public\./i, "الجاهزية تكتب — يمكن تثبيتها");
  assert.doesNotMatch(SQL, /readiness_score\s+(int|numeric)/i, "درجة جاهزية محفوظة كعمود");
  // ولا تُقبل من الحمولة في أيّ دالّة كتابة
  assert.doesNotMatch(SQL, /p->>'readiness/i, "الجاهزية تُقرأ من حمولة المُستدعي");
});

test("لا مسار خادم يتجاوز RLS في هذا الموديول", () => {
  const fs = require("node:fs"); const path = require("node:path");
  const root = path.join(__dirname, "..");
  const files = [
    "lib/portal/opsCenter.ts",
    "app/client-portal/operations/page.tsx",
    ...fs.readdirSync(path.join(root, "components/portal/operations"))
        .map((f) => `components/portal/operations/${f}`),
  ];
  for (const f of files) {
    const src = fs.readFileSync(path.join(root, f), "utf8");
    assert.doesNotMatch(src, /service_role|SUPABASE_SERVICE|createClient\(/,
      `${f}: يتجاوز RLS أو ينشئ عميلًا بمفتاح خدمة`);
  }
  // ولا Route Handler يكتب في جداول التشغيل
  const apiRoot = path.join(root, "app/api");
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  const offenders = walk(apiRoot).filter((p) => {
    const s = fs.readFileSync(p, "utf8");
    return /from\(['"]ops_/.test(s) || /\.rpc\(['"]prodops_/.test(s);
  });
  assert.deepEqual(offenders, [], `مسارات خادم تلمس التشغيل: ${offenders.join(", ")}`);
});
