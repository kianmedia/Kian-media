// ════════════════════════════════════════════════════════════════════════════
// tests/project_governance_5c.test.js — حراس Phase 5C (إغلاق المشروع/القبول/الأرشفة).
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const SQL = read("docs/project_governance_batch5c_RUNME.sql");
const TS = read("lib/portal/projectClosure.ts");
const UI = read("components/portal/projectcore/ClosureTab.tsx");
const OPS = read("components/portal/projectcore/ProjectOps.tsx");
const CRON = read("app/api/cron/notify-email/route.ts");

function funcBody(name) {
  const m = SQL.match(new RegExp("create\\s+or\\s+replace\\s+function\\s+public\\." + name + "\\s*\\([^)]*\\)[\\s\\S]*?\\bas\\s*\\$\\$([\\s\\S]*?)\\$\\$\\s*;", "i"));
  assert.ok(m, `تعذّر إيجاد ${name}`); return m[1];
}

test("SQL 5C بنيوي: جداول/دوال، بلا Temp/DROP fn-tbl، Transaction، Preflight، self-test، notify", () => {
  for (const tbl of ["project_closure_requests", "project_final_acceptances", "project_lessons_learned", "project_post_reviews", "project_reopen_requests", "project_archives"])
    assert.match(SQL, new RegExp("create table if not exists public\\." + tbl, "i"), `الجدول ${tbl} مفقود`);
  assert.doesNotMatch(SQL, /create\s+temp(orary)?\s+table/i, "جداول مؤقتة");
  assert.doesNotMatch(SQL, /^\s*(drop function|drop table)/im, "DROP function/table");
  assert.match(SQL, /do \$pre\$[\s\S]*5C PREFLIGHT/i, "لا Preflight");
  assert.match(SQL, /\bbegin;[\s\S]*\bcommit;/i, "ليس داخل Transaction");
  assert.match(SQL, /do \$selftest\$[\s\S]*raise exception '5C FAIL/i, "لا self-test");
  assert.match(SQL, /notify pgrst/i, "لا notify pgrst");
});

test("لا متغيّر plpgsql غير مُعرّف في دوال 5C", () => {
  const re = /create or replace function public\.([a-z_]+)\s*\([^)]*\)[\s\S]*?\bas\s*\$\$([\s\S]*?)\$\$\s*;/gi;
  let m;
  while ((m = re.exec(SQL))) {
    const name = m[1], body = m[2];
    if (/language sql/i.test(SQL.slice(m.index, m.index + 300))) continue;
    const dm = body.match(/\bdeclare\b([\s\S]*?)\bbegin\b/i);
    const declared = new Set([...(dm ? dm[1] : "").matchAll(/\b(v_[a-z_0-9]+)\b/g)].map((x) => x[1]));
    [...body.matchAll(/\bfor\s+(v_[a-z_0-9]+)\s+in/gi)].forEach((x) => declared.add(x[1]));
    const used = new Set([...body.matchAll(/\b(v_[a-z_0-9]+)\s*:=/g)].map((x) => x[1]));
    [...body.matchAll(/\binto\s+((?:v_[a-z_0-9]+\s*,?\s*)+)/gi)].forEach((g) => [...g[1].matchAll(/v_[a-z_0-9]+/g)].forEach((v) => used.add(v[0])));
    assert.deepEqual([...used].filter((v) => !declared.has(v)), [], `${name} متغيّرات غير مُعرّفة`);
  }
});

test("Final Close ذرّي: يعيد استخدام المسار الرسمي project_core_set_stage ولا يكتب core_stage مباشرة", () => {
  const b = funcBody("project_final_close");
  assert.match(b, /public\.project_core_set_stage\(b\.project_id,\s*'closed'/i, "لا يستدعي المسار الرسمي للإغلاق");
  assert.doesNotMatch(SQL, /update\s+public\.project_core\s+set\s+core_stage/i, "يكتب core_stage مباشرة (ممنوع)");
  assert.match(b, /for update/i, "لا FOR UPDATE (ذرّية)");
  assert.match(b, /not_approved/i, "لا يتطلّب اعتمادًا");
  assert.match(b, /non_overrideable_blockers/i, "لا يمنع الحواجز غير القابلة للتجاوز");
  assert.match(b, /override_reason_required/i, "لا يتطلّب سبب تجاوز");
  // self-test يثبّت المبدأ
  assert.match(SQL, /project_final_close لا يستخدم project_core_set_stage/i, "self-test لا يحرس المسار الرسمي");
});

test("دورة الإغلاق في جدول مستقل لا في core_stage + optimistic locking + طلب نشط واحد", () => {
  assert.match(SQL, /create table if not exists public\.project_closure_requests[\s\S]*?status in\s*\(\s*'draft','submitted','under_review','changes_requested','approved','rejected','cancelled','closed','reopened'\)/i, "حالات الإغلاق ناقصة/في core_stage");
  assert.match(SQL, /create unique index if not exists ux_closure_active_one on public\.project_closure_requests\(project_id\)\s*\n?\s*where is_deleted=false and status in/i, "لا فهرس «طلب نشط واحد»");
  assert.match(funcBody("project_closure_submit"), /p_expected_version <> b\.version then raise exception 'stale_update'/i, "لا optimistic locking");
  assert.match(funcBody("project_closure_request_create"), /duplicate_active_request/i, "لا منع طلب مكرّر");
});

test("Readiness: denominator=المطلوب فقط، blockers مفسّرة (code/severity/source/overrideable/ar/en)، 0→null", () => {
  const b = funcBody("project_closure_readiness");
  assert.match(b, /'readiness_percent', case when v_total>0 then round\(v_passed::numeric\/v_total\*100\)::int else null end/i, "النسبة لا تعيد null عند denominator=0");
  assert.match(b, /'overrideable_blockers'[\s\S]*?coalesce\(\(b->>'overrideable'\)::boolean,false\)/i, "لا فصل overrideable/non-overrideable");
  assert.match(b, /'code','open_tasks','severity','major','source','project_tasks'/i, "الحواجز بلا code/severity/source");
  // الفحص غير المطلوب لا يدخل المقام: مشروط بـ require_* قبل v_total+1
  assert.match(b, /if coalesce\(s\.require_tasks_complete_before_close,true\) then\s*\n?\s*v_total := v_total\+1/i, "المقام يحسب فحوصًا غير مطلوبة");
});

test("إعادة الاستخدام: approval_type='project_closure' عبر نظام 5A (لا اعتماد موازٍ)", () => {
  assert.match(funcBody("project_closure_submit"), /pc_governance_approval_request\(b\.project_id, jsonb_build_object\(\s*\n?\s*'approval_type','project_closure'/i, "لا يستخدم اعتماد 5A");
  assert.doesNotMatch(SQL, /create table if not exists public\.closure_approvals/i, "أنشأ نظام اعتماد موازيًا");
});

test("closure_can مرساة is_staff + المفاتيح الحسّاسة لا تُمنح عبر can_edit_project", () => {
  const b = funcBody("closure_can");
  assert.match(b, /public\.is_staff\(\) and public\.pc_can_read_project\(p_project\)/i, "غير مرساة is_staff");
  assert.match(b, /p_key in \('closure\.approve','closure\.reject','closure\.override','closure\.final_close'[\s\S]*?then \(public\.can_manage_projects\(\) or public\.emp_has_permission\(p_key\)\)/i, "المفاتيح الحسّاسة تُمنح عبر can_edit_project");
});

test("المالية قراءة فقط: adapter يلتقط غياب الصلاحية → unavailable (لا يفترض «مسدَّد»)", () => {
  const b = funcBody("pc_financial_clearance");
  assert.match(b, /exception when others then v_available := false; v_reason := 'no_finance_permission'/i, "لا يلتقط غياب صلاحية المالية");
  assert.doesNotMatch(SQL, /update public\.(project_finance|project_revenue|project_delivery_release)/i, "كتابة مالية (ممنوع)");
  // Zoho: تجاهل أسطر التعليق (--) — نتأكّد أنه لا مساس تنفيذيّ فعليّ بـ Zoho.
  const executable = SQL.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
  assert.doesNotMatch(executable, /zoho/i, "مساس Zoho تنفيذيّ (ممنوع)");
});

test("العهدة قراءة فقط: عدّ عبر definer، لا إغلاق تلقائي", () => {
  assert.match(funcBody("pc_project_open_custody_count"), /select count\(\*\) into v from public\.custody_inventory_assignments/i, "لا عدّ عهدة");
  assert.doesNotMatch(SQL, /update public\.custody_inventory_assignments|update public\.custody_inventory_reservations/i, "كتابة/إغلاق عهدة (ممنوع)");
});

test("إلغاء حجوزات المشروع Soft (status=cancelled، لا حذف) + سبب إلزامي", () => {
  const b = funcBody("resource_booking_cancel_for_project");
  assert.match(b, /update public\.resource_bookings set status='cancelled', cancelled_at=now\(\)/i, "الإلغاء ليس Soft");
  assert.doesNotMatch(b, /delete from public\.resource_bookings/i, "حذف حجوزات");
  assert.match(b, /reason_required/i, "السبب غير إلزامي");
});

test("إعادة الفتح: لا رجوع مباشر من closed (عبر set_stage + workflow) + الطلب السابق يُحفظ reopened", () => {
  const b = funcBody("project_reopen_approve");
  assert.match(b, /public\.project_core_set_stage\(b\.project_id, b\.requested_target_stage/i, "لا يستخدم المسار الرسمي للرجوع");
  assert.match(b, /update public\.project_closure_requests set status='reopened'/i, "الطلب السابق لا يُحفظ كـ reopened");
  assert.match(funcBody("project_reopen_request_create"), /requested_target_stage not in \('revision','post_production','client_review','delivered'\)/i, "المرحلة المستهدفة غير مقيّدة");
});

test("§18 RLS + عزل العميل: acceptance client_final فقط + lessons client_visible", () => {
  assert.match(SQL, /create policy pfa_read on public\.project_final_acceptances[\s\S]*?acceptance_type='client_final' and[\s\S]*?is_client_owner\(project_id\)/i, "acceptance بلا عزل client_final");
  assert.match(SQL, /create policy pll_read on public\.project_lessons_learned[\s\S]*?client_visible and[\s\S]*?is_client_owner\(project_id\)/i, "lessons بلا عزل client_visible");
  assert.match(SQL, /revoke insert, update, delete on public\.project_closure_requests[\s\S]*?from authenticated, anon/i, "الكتابة غير محظورة");
});

test("Parent–Child معزول للعمود غير المطبّق (parent_project_id) — لا يفشل", () => {
  const b = funcBody("project_closure_readiness");
  assert.match(b, /c\.parent_project_id = p_project[\s\S]*?exception when undefined_column then/i, "فحص المشاريع الفرعية غير معزول");
});

test("مراجعة CRIT: project_final_acceptance_decide null-safe (لا 3VL bypass)", () => {
  const b = funcBody("project_final_acceptance_decide");
  assert.match(b, /v_is_target := \(b\.requested_from is not null and b\.requested_from = auth\.uid\(\)\)/i, "v_is_target ليست null-safe");
  assert.match(b, /if not coalesce\(v_is_target or[\s\S]*?, false\) then raise exception 'not authorized'/i, "بوابة القبول ليست محاطة بـ coalesce(...,false)");
});

test("مراجعة MAJOR: pc_project_closure_status تفحص pc_can_read_project (لا تسرّب حالة عبر المشاريع)", () => {
  assert.match(funcBody("pc_project_closure_status"), /if not public\.pc_can_read_project\(p_project\) then raise exception 'not authorized'/i, "pc_project_closure_status بلا بوابة قراءة");
});

test("مراجعة MAJOR: دوال الكتابة §12 مُبطَلة من public/anon قبل المنح", () => {
  assert.match(SQL, /revoke execute on function public\.project_closure_request_create\(uuid,text,date,int\)[\s\S]*?project_archive_set_legal_hold\(uuid,boolean,text\)\s*\n?\s*from public, anon;/i, "لا revoke لدوال الكتابة من public/anon");
});

test("مراجعة MAJOR: إعادة الفتح — فهرس ذرّي + إعادة تحقّق core_stage=closed حيًّا + manager_required", () => {
  assert.match(SQL, /create unique index if not exists ux_reopen_active_one on public\.project_reopen_requests\(project_id\) where is_deleted=false and status='pending'/i, "لا فهرس «طلب إعادة فتح نشط واحد»");
  const b = funcBody("project_reopen_approve");
  assert.match(b, /select core_stage into pc\.core_stage from public\.project_core where project_id=b\.project_id for update/i, "لا إعادة تحقّق حيّ لـ core_stage");
  assert.match(b, /coalesce\(pc\.core_stage,''\) <> 'closed' then raise exception 'not_closed'/i, "لا يمنع الاعتماد على مشروع غير مغلق");
  assert.match(b, /manager_required/i, "لا فشل مبكر manager_required");
});

test("مراجعة MINOR: final_close manager_required مبكرًا + cancel لحالات نشطة فقط", () => {
  assert.match(funcBody("project_final_close"), /if not public\.can_manage_projects\(\) then raise exception 'manager_required'/i, "final_close بلا فشل مبكر manager_required");
  assert.match(funcBody("project_closure_review"), /b\.status not in \('draft','submitted','under_review','changes_requested','approved'\) then raise exception 'bad_state'/i, "cancel يسمح بحالات تاريخية");
});

test("مراجعة MINOR: الجاهزية متّسقة (كل حاجز فحص محسوب؛ has_manager تحذير فقط) ⇒ ready⟺100%", () => {
  const b = funcBody("project_closure_readiness");
  assert.match(b, /'code','no_tasks_in_review'[\s\S]*?v_total := v_total\+1|v_total := v_total\+1[\s\S]*?'no_tasks_in_review'/i, "tasks_in_review لا يدخل المقام");
  assert.match(b, /'no_pending_approvals'/i, "pending_approvals لا يدخل المقام");
  // has_manager أصبح تحذير جودة فقط (لا يُحسب): لا v_total+1 مرتبطة بـ has_manager
  assert.doesNotMatch(b, /has_manager','ar','مدير مشروع مُسنَد'\);\s*\n?\s*if exists[\s\S]*?v_passed := v_passed\+1/i, "has_manager ما زال يدخل المقام");
});

test("§26 صلاحيات: ≥18 مفتاح closure", () => {
  const keys = [...SQL.matchAll(/\('closure\.[a-z_]+'/g)];
  assert.ok(keys.length >= 18, `مفاتيح الإغلاق ${keys.length} < 18`);
});

test("TS wrappers 5C تطابق أسماء RPC ومعاملاتها", () => {
  assert.match(TS, /prpc<ClosureDashboard>\("project_closure_dashboard",\s*\{\s*p_project:/);
  assert.match(TS, /prpc<[^>]*>\("project_final_close",\s*\{[^}]*p_request:[^}]*p_override_payload:/s);
  assert.match(TS, /prpc<[^>]*>\("project_closure_readiness"/);
  assert.match(TS, /prpc<[^>]*>\("project_reopen_approve"/);
  assert.match(TS, /prpc<[^>]*>\("resource_booking_cancel_for_project"/);
});

test("الواجهة مربوطة فعليًا: تبويب «إغلاق المشروع» + RPCs + تأكيد قبل Final Close + نص الحالة + لا mock", () => {
  assert.match(OPS, /import ClosureTab/, "ProjectOps لا يستورد ClosureTab");
  assert.match(OPS, /tab === "closure".*ClosureTab/s, "لا render لتبويب الإغلاق");
  assert.match(OPS, /k: "closure"/, "تبويب الإغلاق غير مُدرج");
  assert.match(UI, /projectClosureDashboard\(/, "المكوّن لا يستدعي الدشبورد");
  assert.match(UI, /projectFinalClose\(/, "لا ربط للإغلاق النهائي");
  assert.match(UI, /للتأكيد اكتب|Type "close"/, "لا تأكيد قبل الإغلاق النهائي");
  assert.match(UI, /CLOSURE_STATUS\[[^\]]*\]/, "الحالة بلا تسمية نصية");
  assert.match(UI, /process\.env\.NODE_ENV !== "production"/, "تسجيل الخطأ الخام غير محصور");
  assert.doesNotMatch(UI, /\bmockData|dummyData|fakeData\b/i, "بيانات وهمية");
});

test("Alerts: closure_alerts_scan idempotent (reminder_tracking) + مربوط في cron القائم (لا Cron جديد)", () => {
  const b = funcBody("closure_alerts_scan");
  assert.match(b, /reminder_tracking[\s\S]*?next_eligible_at>now\(\)/i, "لا بوابة cadence");
  assert.match(b, /pc_event_emit\(/i, "لا pc_event_emit");
  assert.match(CRON, /closure_alerts_scan/i, "cron لا يستدعي closure_alerts_scan");
});
