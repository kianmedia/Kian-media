// ════════════════════════════════════════════════════════════════════════════
// tests/talent_reuse_contract.test.js — ★ لا مصدر حقيقة ثانٍ ★
//
// نظام أصول ومورّدين كامل موجود مسبقًا (custody_*). هذا الاختبار يفشل إن
// أنشأت الحزمة نسخة موازية منه، أو لمست سطح الفرص العامّ، أو ربطت نفسها
// بمنصّة المشاريع المجمَّدة.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const { SQL, PREFLIGHT, ROLLBACK, funcBody, doBlock, tableDef } = require("./talent_helpers.js");

test("لا جدول مورّدين ثانٍ — الموجود يُوسَّع لا يُستنسَخ", () => {
  for (const t of ["vendors", "tvn_vendors", "talent_vendors", "freelancers", "crew_members"]) {
    assert.doesNotMatch(SQL, new RegExp(`create table if not exists public\\.${t}\\b`),
      `★ خرق ★ الحزمة تُنشئ ${t} بجانب custody_vendors`);
  }
  const bridge = doBlock("bridge");
  assert.match(bridge, /alter table public\.custody_vendors add column if not exists tvn_profile_id uuid/,
    "لا جسر إلى جدول المورّدين القائم");
  assert.match(bridge, /if to_regclass\('public\.custody_vendors'\) is not null then/,
    "الجسر يفترض وجود الجدول بدل اكتشافه");
});

test("التوسيع إضافيّ بحت: لا حذف عمود ولا تغيير نوع ولا إسقاط قيد قائم", () => {
  assert.doesNotMatch(SQL, /alter table public\.custody_vendors[^\n]*drop/i,
    "الحزمة تحذف من جدول حيّ");
  assert.doesNotMatch(SQL, /alter table[^\n]*alter column[^\n]*type/i, "تغيير نوع عمود قائم");
  assert.doesNotMatch(SQL, /drop table[^\n]*custody_/i, "إسقاط جدول عهد قائم");
  // الربط واحد لواحد كي لا يُنسَب مورّدان لملفّ واحد.
  assert.match(SQL, /create unique index if not exists uq_custody_vendors_tvn_profile/,
    "الربط يسمح بملفّ واحد لعدّة مورّدين");
});

test("لا نظام أصول ثانٍ — الأصول تُشار إليها ولا تُنسَخ", () => {
  assert.doesNotMatch(SQL, /create table if not exists public\.asset_\w+/,
    "★ خرق ★ جدول asset_* بجانب custody_inventory_*");
  assert.doesNotMatch(SQL, /create table if not exists public\.tvn_assets\b/, "نسخة أصول داخل الوحدة");
  const bridge = doBlock("bridge");
  assert.match(bridge, /references public\.custody_inventory_assets\(id\)/,
    "وثائق الأصول لا تشير إلى جدول الأصول القائم");
});

test("★ سطح الفرص العامّ لم يُمسّ، ولا مرحّل بريد ★", () => {
  assert.doesNotMatch(SQL, /alter table public\.opportunity_requests/i,
    "★ خرق ★ تعديل على سطح الفرص");
  assert.doesNotMatch(SQL, /create trigger[^\n]*on public\.opportunity_requests/i,
    "★ خرق ★ مُشغِّل على سطح الفرص");
  assert.doesNotMatch(SQL, /insert into public\.opportunity_requests/i, "كتابة في سطح الفرص");
  assert.doesNotMatch(SQL, /update public\.opportunity_requests/i, "تعديل صفوف الفرص");
  assert.doesNotMatch(SQL, /create policy[^\n]*on public\.opportunity_requests/i,
    "إعادة تعريف سياسات الفرص");
});

test("الترقية يدوية بالكامل: بوّابة + قراءة فقط + لا إشعار للمتقدّم", () => {
  const body = funcBody("tvn_promote_opportunity");
  assert.match(body, /can_manage_talent_profiles\(\)/, "الترقية بلا بوّابة");
  assert.match(body, /feature unavailable/, "غياب سطح الفرص لا يُصرَّح به");
  assert.match(body, /select full_name, email, phone, city from public\.opportunity_requests/,
    "الترقية لا تقرأ الطلب");
  assert.doesNotMatch(body, /tvn_emit\(/, "★ خرق ★ الترقية تُدرج إشعارًا للمتقدّم");
  assert.match(body, /لم يُرسَل أيّ إشعار أو بريد/, "لا تصريح بأنّ شيئًا لم يُرسَل");
  assert.match(body, /conflict: هذا الطلب مُرقّى مسبقًا/, "الترقية المزدوجة تُنشئ ملفّين لشخص واحد");
  assert.match(body, /'draft'/, "الملفّ المُرقّى يصير نشطًا فورًا بلا مراجعة");
});

test("مرجع الطلب للقراءة فقط وفريد", () => {
  assert.match(tableDef("tvn_profiles"), /source_opportunity_request_id uuid,/,
    "لا مرجع لمصدر الترقية");
  assert.match(SQL, /create unique index if not exists uq_tvn_profiles_src_opp/,
    "طلب واحد يمكن ترقيته مرارًا");
  assert.match(doBlock("bridge"), /on delete set null/,
    "حذف طلب فرص سيجرّ ملفّ شبكة معه");
});

test("★ تجميد منصّة المشاريع محترَم ★", () => {
  for (const t of ["projects", "project_core", "deliverables", "deliverable_internal",
                   "project_transition_requests"]) {
    assert.doesNotMatch(SQL, new RegExp(`alter table public\\.${t}\\b`, "i"),
      `★ خرق التجميد ★ تعديل على ${t}`);
    assert.doesNotMatch(SQL, new RegExp(`references public\\.${t}\\(`, "i"),
      `★ خرق التجميد ★ مفتاح أجنبيّ إلى ${t}`);
  }
  assert.doesNotMatch(SQL, /create or replace function public\.(project_|large_project_)/i,
    "★ خرق التجميد ★ إعادة تعريف دالّة من المنصّة");
});

test("PREFLIGHT يحذّر من الازدواج قبل التشغيل لا بعده", () => {
  assert.match(PREFLIGHT, /ازدواج مصدر الحقيقة/, "PREFLIGHT لا يفحص وجود نظام مواز");
  assert.match(PREFLIGHT, /custody_vendors/, "PREFLIGHT لا يذكر جدول المورّدين القائم");
  assert.match(PREFLIGHT, /لا يُنشئ RUNME جدول مورّدين بديلًا|لا يُنشئ RUNME بديلًا/,
    "PREFLIGHT لا يوضّح أنّ الغياب لا يعني إنشاء بديل");
});

test("ROLLBACK يقول بصوت عالٍ إنّه يلمس جدولًا حيًّا", () => {
  assert.match(ROLLBACK, /⚠️/, "لا تحذير بارز");
  assert.match(ROLLBACK, /_bak_custody_vendor_link/, "لا وصفة نسخ للربط قبل حذفه");
  assert.match(ROLLBACK, /لا يحذف صفًّا واحدًا\*{0,2}\s*من custody_vendors/,
    "لا تصريح بما لا يُمسّ");
});

test("الجسر يعترف بغياب الطرف الآخر بدل اختراع بديل", () => {
  const body = funcBody("tvn_vendor_link");
  assert.match(body, /vendor_table_absent/, "غياب جدول المورّدين لا يُصرَّح به");
  assert.match(body, /لم يُنشأ جدول مورّدين بديل/, "لا تصريح بعدم إنشاء بديل");
  assert.doesNotMatch(body, /create table/i, "الجسر يُنشئ جدولًا عند الغياب");
});
