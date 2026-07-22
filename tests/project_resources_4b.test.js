// ════════════════════════════════════════════════════════════════════════════
// tests/project_resources_4b.test.js — حراس انحدار لـPhase 4B (الموارد والحجوزات).
// فحوص ساكنة/بنيوية/عقدية/RLS/عزل-عميل (بلا قاعدة بيانات).
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const SQL = fs.readFileSync(path.join(ROOT, "docs/project_resources_batch4b_RUNME.sql"), "utf8");
const TS = fs.readFileSync(path.join(ROOT, "lib/portal/projectResources.ts"), "utf8");
const UI = fs.readFileSync(path.join(ROOT, "components/portal/projectcore/ProjectResources.tsx"), "utf8");
const OPS = fs.readFileSync(path.join(ROOT, "components/portal/projectcore/ProjectOps.tsx"), "utf8");

function funcBody(name) {
  const re = new RegExp("create\\s+or\\s+replace\\s+function\\s+public\\." + name +
    "\\s*\\([\\s\\S]*?\\bas\\s*\\$\\$([\\s\\S]*?)\\$\\$\\s*;", "i");
  const m = SQL.match(re);
  assert.ok(m, `تعذّر إيجاد جسم الدالة ${name}`);
  return m[1];
}

const READ_RPCS = ["resource_booking_conflicts", "employee_workload_core", "project_team_workload_core",
  "project_resources_dashboard", "resource_timeline_snapshot", "resource_conflict_center", "resource_suggestions",
  "resource_booking_detail_core", "res_card"];
const INTERNAL_CORES = ["resource_booking_conflicts", "res_card", "resource_booking_detail_core",
  "employee_workload_core", "project_team_workload_core"];
const PUBLIC_RPCS = ["resource_booking_create", "resource_booking_update", "resource_booking_cancel",
  "resource_booking_confirm", "resource_booking_batch_create", "resource_booking_detail",
  "employee_workload_snapshot", "project_team_workload", "project_resources_dashboard",
  "resource_timeline_snapshot", "resource_conflict_center", "resource_suggestions", "planning_resources_sync"];

test("لا CREATE TEMPORARY TABLE في أي دالة قراءة 4B", () => {
  for (const fn of READ_RPCS) {
    assert.doesNotMatch(funcBody(fn), /create\s+temp(orary)?\s+table/i, `${fn} تحتوي جدولًا مؤقتًا`);
    assert.doesNotMatch(funcBody(fn), /\bdrop\s+table\b/i, `${fn} تحتوي DROP TABLE`);
  }
});

test("الدوال الداخلية (cores) مسحوبة الصلاحية من anon/authenticated", () => {
  for (const fn of INTERNAL_CORES) {
    const re = new RegExp("revoke\\s+execute\\s+on\\s+function\\s+public\\." + fn + "\\([^)]*\\)\\s+from\\s+[^;]*\\bauthenticated\\b", "i");
    assert.match(SQL, re, `${fn} غير مسحوبة من authenticated`);
  }
});

test("الدوال العامة ممنوحة لـauthenticated", () => {
  for (const fn of PUBLIC_RPCS) {
    const re = new RegExp("grant\\s+execute\\s+on\\s+function\\s+public\\." + fn + "\\([^)]*\\)\\s+to\\s+authenticated", "i");
    assert.match(SQL, re, `${fn} غير ممنوحة لـauthenticated`);
  }
});

test("محرك التعارض يعيد الأعمدة العقدية المطلوبة", () => {
  const sig = SQL.match(/create\s+or\s+replace\s+function\s+public\.resource_booking_conflicts[\s\S]*?returns\s+table\(([\s\S]*?)\)\s*language/i);
  assert.ok(sig, "لم يُعثر على توقيع resource_booking_conflicts");
  for (const col of ["conflict_type", "severity", "conflicting_booking_id", "project_id", "starts_at", "ends_at", "explanation_ar", "explanation_en", "can_override"]) {
    assert.match(sig[1], new RegExp("\\b" + col + "\\b"), `عمود التعارض ${col} مفقود`);
  }
});

test("محرك التعارض يغطّي أنواع التعارض المطلوبة", () => {
  const b = funcBody("resource_booking_conflicts");
  for (const ctype of ["hard_conflict", "capacity_conflict", "availability_conflict", "maintenance_conflict", "custody_conflict"]) {
    assert.match(b, new RegExp("'" + ctype + "'"), `نوع التعارض ${ctype} غير مُنتَج`);
  }
  // يقرأ واقع العهدة (صيانة/توفر/حجوزات) والإجازات
  assert.match(b, /custody_inventory_maintenance/i, "لا يفحص صيانة العهدة");
  assert.match(b, /custody_inventory_reservations/i, "لا يفحص حجوزات العهدة");
  assert.match(b, /custody_inventory_assets/i, "لا يفحص حالة أصل العهدة");
  assert.match(b, /hr_leave_requests/i, "لا يفحص إجازات الموظف");
});

test("resource_bookings: قيود ends>starts + quantity>0 + soft delete + version", () => {
  const tbl = SQL.match(/create table if not exists public\.resource_bookings\s*\(([\s\S]*?)\n\);/i);
  assert.ok(tbl, "لم يُعثر على جدول resource_bookings");
  assert.match(tbl[1], /check\s*\(ends_at\s*>\s*starts_at\)/i, "لا قيد ends_at>starts_at");
  assert.match(tbl[1], /quantity[\s\S]*?check\s*\(quantity\s*>\s*0\)/i, "لا قيد quantity>0");
  assert.match(tbl[1], /is_deleted\s+boolean/i, "لا Soft delete");
  assert.match(tbl[1], /version\s+int/i, "لا Optimistic version");
});

test("دورة حياة الحجز: بوابات صلاحية + optimistic lock + منع hard_conflict بلا تجاوز", () => {
  assert.match(funcBody("resource_booking_create"), /res_can\('resources\.book'\)/, "create لا يفحص resources.book");
  assert.match(funcBody("resource_booking_create"), /hard_conflict/, "create لا يمنع hard_conflict");
  assert.match(funcBody("resource_booking_create"), /resources\.override_conflict/, "create لا يشترط صلاحية التجاوز");
  assert.match(funcBody("resource_booking_create"), /override_reason_required/, "create لا يشترط سبب التجاوز");
  assert.match(funcBody("resource_booking_update"), /stale_update/, "update بلا optimistic lock");
  assert.match(funcBody("resource_booking_cancel"), /res_can\('resources\.cancel_booking'\)/, "cancel بلا بوابة");
  assert.match(funcBody("resource_booking_confirm"), /res_can\('resources\.confirm_booking'\)/, "confirm بلا بوابة");
  // ربط المهمة/الجلسة بنفس المشروع
  assert.match(funcBody("resource_booking_create"), /bad_link/, "create لا يتحقق من انتماء المهمة/الجلسة للمشروع");
});

test("الحجز الجماعي ذرّي (يفوّض لـcreate فيؤدي فشل أي عنصر إلى Rollback)", () => {
  const b = funcBody("resource_booking_batch_create");
  assert.match(b, /resource_booking_create\(/, "batch لا يستدعي create");
  assert.match(b, /jsonb_array_elements/i, "batch لا يمرّ على العناصر");
});

test("الصلاحيات (Catalog): مفاتيح resources.* المطلوبة", () => {
  for (const key of ["resources.view", "resources.book", "resources.edit_booking", "resources.cancel_booking",
    "resources.confirm_booking", "resources.override_conflict", "resources.view_workload",
    "resources.view_team_capacity", "resources.manage_calendar"]) {
    assert.match(SQL, new RegExp("'" + key.replace(".", "\\.") + "'"), `مفتاح الصلاحية ${key} غير مُدرج`);
  }
});

test("RLS مفعّلة + الكتابة عبر RPCs فقط + عزل العميل (is_staff)", () => {
  for (const tbl of ["planning_resources", "resource_bookings", "resource_unavailability", "resource_availability_rules"]) {
    assert.match(SQL, new RegExp("alter table public\\." + tbl + "\\s+enable row level security", "i"), `${tbl} بلا RLS`);
  }
  assert.match(SQL, /revoke insert, update, delete on public\.planning_resources[\s\S]*?from authenticated, anon/i, "الكتابة غير محظورة على authenticated");
  // العميل (غير staff) لا يرى الموارد/الحجوزات
  assert.match(SQL, /create policy pr_read[\s\S]*?is_staff\(\)/i, "سياسة قراءة الموارد لا تشترط is_staff");
  assert.match(SQL, /create policy rb_read[\s\S]*?is_staff\(\)/i, "سياسة قراءة الحجوزات لا تشترط is_staff");
});

test("Workload: بلا Double Counting (يستبعد المهام الأب)، ويحسب متاح/مخطّط/مسجّل/تصنيف", () => {
  const b = funcBody("employee_workload_core");
  assert.match(b, /not exists\s*\(select 1 from public\.project_tasks ch where ch\.parent_task_id = t\.id/i, "لا يستبعد المهام الأب (Double Counting)");
  assert.match(b, /project_time_logs/i, "لا يحسب الساعات المسجّلة");
  for (const cls of ["available", "balanced", "high", "overloaded", "unavailable"]) {
    assert.match(b, new RegExp("'" + cls + "'"), `تصنيف العبء ${cls} مفقود`);
  }
  assert.match(b, /is_working_day/i, "لا يعتمد أيام العمل");
  assert.match(b, /hr_holidays/i, "لا يحسب العطلات الرسمية");
});

test("Registry: لا يكرّر المعدات/الموظفين (يشير للمصدر، unique على source)", () => {
  assert.match(SQL, /ux_planning_resources_source[\s\S]*?on public\.planning_resources\(source_type, source_id\)/i, "لا فهرس فريد لمنع تكرار المصدر");
  assert.match(funcBody("planning_resources_sync"), /custody_inventory_assets/i, "sync لا يربط أصول العهدة");
  assert.match(funcBody("planning_resources_sync"), /hr_employee_profiles/i, "sync لا يربط موظفي HR");
  assert.match(funcBody("planning_resources_sync"), /not exists \(select 1 from public\.planning_resources/i, "sync قد يُنشئ تكرارًا");
});

test("اختبار ذاتي داخل SQL: يختبر التعارض/السعة عبر savepoint ويُلغي المعاملة عند الفشل", () => {
  assert.match(SQL, /do \$selftest\$/i, "لا اختبار ذاتي");
  assert.match(SQL, /resource_booking_conflicts\(/, "الاختبار لا يستدعي محرك التعارض");
  assert.match(SQL, /raise exception '4B FAIL/i, "الاختبار لا يرفع Exception عند الفشل");
  assert.match(SQL, /__sp_rollback__/i, "الاختبار لا يتراجع عن بيانات الاختبار (savepoint)");
  assert.match(SQL, /\bbegin;[\s\S]*\bcommit;/i, "ليس داخل Transaction");
  assert.match(SQL, /notify pgrst/i, "لا notify pgrst");
});

test("TS wrappers تستدعي RPCs الصحيحة بالأسماء والمعاملات", () => {
  assert.match(TS, /prpc<ResourcesDashboard>\("project_resources_dashboard",\s*\{\s*p_project:[^}]*p_from:[^}]*p_to:/);
  assert.match(TS, /prpc<BookingResult>\("resource_booking_create",\s*\{\s*p_payload:/);
  assert.match(TS, /prpc<[^>]*>\("resource_booking_cancel",\s*\{[^}]*p_expected_version:/);
  assert.match(TS, /prpc<[^>]*>\("resource_timeline_snapshot"/);
  assert.match(TS, /prpc<[^>]*>\("planning_resources_sync"/);
});

test("إصلاحات المراجعة العدائية 4B مثبّتة (لا تنكسر مستقبلًا)", () => {
  // AUTHZ-13: res_can مرساتها is_staff
  assert.match(SQL, /create or replace function public\.res_can[\s\S]*?is_staff\(\)\s+and\s+\(public\.can_manage_projects/i, "res_can بلا مرساة is_staff");
  // AUTHZ-10: update/cancel/confirm تفحص pc_can_read_project على مشروع الحجز
  assert.match(funcBody("resource_booking_update"), /b\.project_id is not null and not public\.pc_can_read_project\(b\.project_id\)/i, "update بلا نطاق مشروع");
  assert.match(funcBody("resource_booking_cancel"), /b\.project_id is not null and not public\.pc_can_read_project\(b\.project_id\)/i, "cancel بلا نطاق مشروع");
  assert.match(funcBody("resource_booking_confirm"), /b\.project_id is not null and not public\.pc_can_read_project\(b\.project_id\)/i, "confirm بلا نطاق مشروع");
  // CW-5: capacity_conflict يحجب create/update (ضمن مجموعة الحجب)
  assert.match(funcBody("resource_booking_create"), /filter \(where c\.severity in \('hard_conflict','capacity_conflict'\)\)/i, "create لا يحجب capacity_conflict");
  assert.match(funcBody("resource_booking_update"), /filter \(where c\.severity in \('hard_conflict','capacity_conflict'\)\)/i, "update لا يحجب capacity_conflict");
  // AUTHZ-11: لا كشف لنوع الإجازة
  assert.doesNotMatch(funcBody("resource_booking_conflicts"), /lr\.leave_type/i, "يكشف نوع الإجازة (leave_type)");
  // AUTHZ-12: لوحة الموارد تحجب عبء الفريق خلف view_team_capacity
  assert.match(funcBody("project_resources_dashboard"), /res_can\('resources\.view_team_capacity'\)[\s\S]*?project_team_workload_core/i, "الدشبورد لا يحجب الفريق خلف view_team_capacity");
  // CW-7: أيام الإجازة تستبعد العطلات الرسمية (لا طرح مزدوج)
  assert.match(funcBody("employee_workload_core"), /count\(distinct d::date\) into v_leavedays[\s\S]*?not exists \(select 1 from public\.hr_holidays/i, "أيام الإجازة تُطرح مرتين مع العطلات");
  // CW-8: العدّادات (active/overdue/projects) على كل المهام لا المقيّدة بالتقدير/النافذة
  assert.match(funcBody("employee_workload_core"), /into v_active, v_overdue, v_projects[\s\S]*?from public\.project_tasks t\s*where coalesce\(t\.is_deleted,false\)=false\s*and \(t\.assignee_id = p_user/i, "العدّادات مقيّدة خطأً بالتقدير/النافذة");
  // CW-9: سقف سعة المعدة = quantity_available
  assert.match(funcBody("resource_booking_conflicts"), /a\.quantity_available\s+into v_avail_status, v_cond, v_qtotal/i, "سعة المعدة لا تعتمد quantity_available");
  // UI-2: RPC فحص التعارضات موجود + ممنوح
  assert.match(SQL, /create or replace function public\.resource_check_conflicts/i, "لا RPC لفحص التعارضات");
  assert.match(SQL, /grant\s+execute\s+on\s+function\s+public\.resource_check_conflicts\([^)]*\)\s+to\s+authenticated/i, "resource_check_conflicts غير ممنوح");
});

test("UI: توقيت Riyadh للعرض + مهلة واحدة + قائمة موارد كاملة للنموذج + تدفق التجاوز", () => {
  assert.match(UI, /timeZone: "Asia\/Riyadh"/, "لا يعرض الأوقات بتوقيت الشركة");
  assert.match(UI, /resourceTimelineSnapshot\(from, to, \{\}\)/, "الخط الزمني/قائمة النموذج مفلترة بالمشروع (لا موارد جديدة)");
  assert.match(UI, /resourceCheckConflicts\(/, "لا يفحص التعارضات قبل الحجز (تدفق التجاوز غير قابل للوصول)");
  assert.match(UI, /Promise\.race\(\[\s*Promise\.all/s, "لا مهلة واحدة للطلبين (تسرّب مؤقّت)");
});

test("الواجهة مربوطة فعليًا: تبويب «الموارد» في ProjectOps + مكوّن يستدعي الـRPCs (لا بيانات وهمية)", () => {
  assert.match(OPS, /import ProjectResources from "\.\/ProjectResources"/, "ProjectOps لا يستورد ProjectResources");
  assert.match(OPS, /tab === "resources".*ProjectResources/s, "لا render لتبويب الموارد");
  assert.match(OPS, /k: "resources"/, "تبويب الموارد غير مُدرج في القائمة");
  assert.match(UI, /projectResourcesDashboard\(/, "المكوّن لا يستدعي لوحة الموارد");
  assert.match(UI, /resourceBookingCreate\(|resourceBookingCancel\(|resourceBookingConfirm\(/, "المكوّن لا يربط دورة حياة الحجز");
  assert.doesNotMatch(UI, /mock|dummy|fakeData|placeholderData/i, "المكوّن يستخدم بيانات وهمية");
  // لا يطبع تفاصيل PostgreSQL في Production
  assert.match(UI, /process\.env\.NODE_ENV !== "production"/, "تسجيل الخطأ الخام غير محصور بـdev");
});
