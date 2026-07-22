// ════════════════════════════════════════════════════════════════════════════
// tests/project_phase4_final_closure.test.js — حراس Phase 4D (الإقفال النهائي).
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const SQL = read("docs/project_phase4_final_closure_RUNME.sql");
const WARN = read("lib/portal/planningWarnings.ts");
const RLABEL = read("components/portal/projectcore/ResourceLabel.tsx");
const CC = read("components/portal/projectcore/ConflictCenter.tsx");
const REP = read("components/portal/projectcore/PlanningReports.tsx");
const HEALTH = read("components/portal/projectcore/PlanningHealthCard.tsx");
const WG = read("components/portal/projectcore/WarningGroups.tsx");
const GANTT = read("components/portal/projectcore/ProjectGantt.tsx");
const RES = read("components/portal/projectcore/ProjectResources.tsx");
const DASH = read("components/portal/projectcore/ProjectCoreDashboard.tsx");
const SCHED = read("components/portal/projectcore/ProjectSchedule.tsx");
const CORE_TS = read("lib/portal/projectCore.ts");

function funcBody(name) {
  const m = SQL.match(new RegExp("create\\s+or\\s+replace\\s+function\\s+public\\." + name + "\\s*\\([\\s\\S]*?\\bas\\s*\\$\\$([\\s\\S]*?)\\$\\$\\s*;", "i"));
  assert.ok(m, `تعذّر إيجاد ${name}`); return m[1];
}

const NEW_FNS = ["project_planning_health", "resource_conflict_resolutions", "resource_alerts_scan", "project_subprojects_summary"];

test("SQL 4D: بلا Temp Tables، بلا DROP function/table، داخل Transaction، self-test، notify", () => {
  for (const fn of NEW_FNS) assert.doesNotMatch(funcBody(fn).replace(/scan/g, ""), /create\s+temp(orary)?\s+table/i, `${fn} فيها جدول مؤقت`);
  assert.doesNotMatch(SQL, /^\s*(drop function|drop table)/im, "يوجد DROP function/table");
  assert.match(SQL, /\bbegin;[\s\S]*\bcommit;/i, "ليس داخل Transaction");
  assert.match(SQL, /do \$selftest\$[\s\S]*raise exception '4D FAIL/i, "لا self-test يرفع Exception");
  assert.match(SQL, /notify pgrst/i, "لا notify pgrst");
});

test("SQL 4D: بوابات + REVOKE داخلية + GRANT عامة + Preflight", () => {
  assert.match(funcBody("project_planning_health"), /pc_can_read_project\(p_project\)/i, "planning_health بلا بوابة");
  assert.match(funcBody("resource_conflict_resolutions"), /pc_can_read_project|res_can\('resources\.view'\)/i, "conflict_resolutions بلا بوابة");
  assert.match(funcBody("project_subprojects_summary"), /pc_can_read_project\(p_project\)/i, "subprojects بلا بوابة");
  for (const fn of ["project_planning_health(uuid)", "resource_conflict_resolutions(uuid)", "resource_alerts_scan()", "project_subprojects_summary(uuid)"]) {
    assert.match(SQL, new RegExp("grant\\s+execute\\s+on\\s+function\\s+public\\." + fn.replace(/([()])/g, "\\$1") + "\\s+to\\s+authenticated", "i"), `${fn} غير ممنوحة`);
  }
  assert.match(SQL, /information_schema\.columns[\s\S]*?pc_event_emit|to_regprocedure\('public\.pc_event_emit/i, "Preflight ناقص لـpc_event_emit");
});

test("resource_alerts_scan: Idempotent (reminder_tracking dedup) + شدّات صالحة + آمن للـservice", () => {
  const b = funcBody("resource_alerts_scan");
  assert.match(b, /reminder_tracking where reminder_key=v_key and next_eligible_at > now\(\)/i, "لا dedup");
  assert.match(b, /on conflict \(reminder_key\) do update/i, "لا upsert للـreminder");
  assert.doesNotMatch(b, /'attention'/i, "شدّة 'attention' غير صالحة (CHECK: critical/action/info/digest)");
  assert.match(b, /auth\.uid\(\) is not null and not \(public\.can_manage_projects|alerts\.manage_project_alerts/i, "بوابة الإساءة/service ناقصة");
});

test("subprojects_summary معزول ضد parent_project_id المفقود؛ لا استدعاء health لكل ابن (لا N+1 مكلف)", () => {
  const b = funcBody("project_subprojects_summary");
  assert.match(b, /exception when undefined_column then v := '\[\]'::jsonb/i, "غير معزول ضد undefined_column");
  assert.doesNotMatch(b, /project_schedule_health|project_critical_path_v2/i, "يستدعي health/CPM لكل ابن (auth-lateral/N+1)");
});

test("الصلاحيات الجديدة مُدرجة (تقارير/مسار حرج/تنبيهات)", () => {
  for (const k of ["projects.view_critical_path", "projects.view_execution_reports", "projects.export_execution_reports", "alerts.manage_project_alerts"]) {
    assert.match(SQL, new RegExp("'" + k.replace(".", "\\.") + "'"), `الصلاحية ${k} غير مُدرجة`);
  }
});

test("§3 groupWarnings: دمج حسب code، دعم strings، لا دمج أنواع مختلفة", () => {
  assert.match(WARN, /export function groupWarnings/, "لا groupWarnings");
  assert.match(WARN, /typeof w === "string"/, "لا يدعم العقود القديمة (strings)");
  assert.match(WARN, /map\.set\(code/, "لا يجمع حسب code");
  assert.match(WG, /groupWarnings\(warnings\)/, "WarningGroups لا يستخدم groupWarnings");
  assert.match(GANTT, /<WarningGroups warnings=/, "Gantt لا يستخدم WarningGroups المجمّعة");
  assert.doesNotMatch(GANTT, /\.map\(\(w\) => t\(\{ ar: w\.ar, en: w\.type \}\)\)\.join\(" · "\)/, "Gantt ما زال يعرض التحذيرات مسطّحة");
});

test("§2 هوية الموارد: ResourceLabel يعرض الدور/النوع، ومفاتيح React بالـid لا الاسم", () => {
  assert.match(RLABEL, /export function resourceRole/, "لا دالة الدور");
  assert.match(RLABEL, /job_title \|\| r\.employee\.department/, "لا يميّز بالمهنة");
  assert.match(RLABEL, /TYPE_BADGE/, "لا Badge للنوع");
  // المكوّنات تستخدم resource_id/user_id كمفاتيح (لا display_name)
  for (const [name, src] of [["ProjectResources", RES], ["ConflictCenter", CC]]) {
    assert.doesNotMatch(src, /key=\{[^}]*\.display_name[^}]*\}/, `${name} يستخدم الاسم كمفتاح React`);
  }
  assert.match(RES, /<ResourceLabel r=\{b\.resource\}/, "قائمة الحجوزات لا تستخدم ResourceLabel");
});

test("§6 Conflict Center مربوط ببيانات حقيقية + إجراءات ذرّية + optimistic version + عزل", () => {
  assert.match(CC, /resourceConflictCenter\(/, "لا يستدعي resource_conflict_center");
  assert.match(CC, /resourceBookingUpdate\(b\.id,[\s\S]*?,\s*b\.version\)/, "reschedule/override بلا optimistic version");
  assert.match(CC, /resourceBookingCancel\(b\.id,[^,]*,\s*b\.version\)/, "cancel بلا version");
  assert.match(CC, /resourceConflictResolutions\(/, "لا اقتراحات حل");
  assert.match(CC, /reqSeq/, "بلا حارس تسلسل");
  assert.doesNotMatch(CC, /\bmock\b|dummyData|fakeData/i, "بيانات وهمية");
});

test("§8/§9 التقارير + CSV: يعيد استخدام csvDownload (BOM) وRPCs مبوّبة", () => {
  assert.match(REP, /import \{ csvDownload \} from "@\/lib\/portal\/csv"/, "لا يعيد استخدام csvDownload");
  assert.match(REP, /projectScheduleHealth|portfolioScheduleDashboard|projectTeamWorkload|resourceTimelineSnapshot/, "لا يستخدم RPCs مبوّدة");
  assert.doesNotMatch(REP, /new Blob|xlsx|exceljs/i, "أضاف مكتبة Excel/blob جديدة");
});

test("§11 HealthCard: يجمع الثلاثة بلا Black Box + Drill-down", () => {
  assert.match(HEALTH, /projectPlanningHealth\(/, "لا يستدعي planning_health");
  assert.match(HEALTH, /combined_status/, "لا حالة إجمالية");
  assert.match(HEALTH, /gotoTab/, "لا Drill-down");
  assert.match(RES, /<PlanningHealthCard projectId=/, "بطاقة الصحّة غير مربوطة في تبويب الموارد");
});

test("§5 Aggregate Gantt: زر المشاريع الفرعية + RPC واحد (لا N+1)", () => {
  assert.match(GANTT, /projectSubprojectsSummary\(projectId\)/, "لا يستدعي subprojects RPC");
  assert.match(GANTT, /المشاريع الفرعية/, "لا زر مشاريع فرعية");
  assert.match(GANTT, /if \(subs === null\)/, "لا تحميل عند الطلب (lazy)");
  assert.match(CORE_TS, /export const projectSubprojectsSummary/, "لا wrapper subprojects");
});

test("§13 النظام القديم موسوم «عرض تشغيلي (قديم)» ويوجّه لـPlanner", () => {
  assert.match(SCHED, /عرض تشغيلي \(قديم\)|Legacy operational view/, "لا Badge قديم");
  assert.match(SCHED, /لا يكتب تواريخ المهام/, "لا توضيح لعدم كتابة التواريخ");
  assert.match(SCHED, /gotoTab\("planning"\)/, "لا توجيه لـPlanner");
});

test("لا متغيّر plpgsql غير مُعرّف في دوال 4D (check_function_bodies لن يرفضها)", () => {
  const re = /create or replace function public\.([a-z_]+)\s*\([^)]*\)[\s\S]*?\bas\s*\$\$([\s\S]*?)\$\$\s*;/gi;
  let m;
  while ((m = re.exec(SQL))) {
    const name = m[1], body = m[2];
    const dm = body.match(/\bdeclare\b([\s\S]*?)\bbegin\b/i);
    const declared = new Set([...(dm ? dm[1] : "").matchAll(/\b(v_[a-z_0-9]+)\b/g)].map((x) => x[1]));
    [...body.matchAll(/\bfor\s+(v_[a-z_0-9]+)\s+in/gi)].forEach((x) => declared.add(x[1]));
    const used = new Set([...body.matchAll(/\b(v_[a-z_0-9]+)\s*:=/g)].map((x) => x[1]));
    [...body.matchAll(/\binto\s+((?:v_[a-z_0-9]+\s*,?\s*)+)/gi)].forEach((g) => [...g[1].matchAll(/v_[a-z_0-9]+/g)].forEach((v) => used.add(v[0])));
    const undeclared = [...used].filter((v) => !declared.has(v));
    assert.deepEqual(undeclared, [], `الدالة ${name} تستخدم متغيّرات غير مُعرّفة: ${undeclared.join(", ")}`);
  }
});

test("إصلاحات المراجعة العدائية 4D مثبّتة", () => {
  assert.doesNotMatch(SQL, /\bv_overloaded\b/, "بقي مرجع v_overloaded غير المُعرّف");
  const cr = funcBody("resource_conflict_resolutions");
  // #1: ترتيب المتاح أولًا قبل LIMIT (cross join lateral + order by av.ok desc)
  assert.match(cr, /cross join lateral[\s\S]*?order by av\.ok desc[\s\S]*?limit 8/i, "البدائل تُرتّب بعد LIMIT (تُسقط المتاح)");
  // #3: بوابة resolutions = resources.view فقط (لا OR pc_can_read_project)
  assert.match(cr, /if not public\.res_can\('resources\.view'\) then raise exception 'not authorized'/i, "بوابة resolutions أوسع من resource_conflict_center");
  assert.doesNotMatch(cr, /res_can\('resources\.view'\) or \(b\.project_id/i, "ما زالت البوابة تسمح بـpc_can_read_project");
  // #2: self-test لا يستدعي resource_alerts_scan() حيًّا (قراءة-فقط)
  const st = SQL.match(/do \$selftest\$([\s\S]*?)\$selftest\$/)[1];
  assert.doesNotMatch(st, /v_a := public\.resource_alerts_scan\(\)|:= public\.resource_alerts_scan/i, "الاختبار الذاتي يستدعي alerts_scan (آثار جانبية على النشر)");
  assert.match(st, /to_regprocedure\('public\.resource_alerts_scan\(\)'\)/i, "الاختبار لا يتحقق من وجود alerts_scan");
  // #4/#5 UI
  assert.match(CC, /isNaN\(sd\.getTime\(\)\) \|\| isNaN\(ed\.getTime\(\)\)/, "reschedule لا يتحقق من صلاحية التاريخ (يعلّق الصف)");
  assert.match(HEALTH, /reqSeq = useRef\(0\)/, "HealthCard بلا حارس تسلسل");
  assert.match(HEALTH, /my !== reqSeq\.current/, "HealthCard لا يتجاهل الردّ الأقدم");
});

test("الواجهات الإدارية مربوطة (ConflictCenter/Reports/Portfolio)", () => {
  assert.match(DASH, /import ConflictCenter/, "الدشبورد لا يستورد ConflictCenter");
  assert.match(DASH, /import PlanningReports/, "الدشبورد لا يستورد PlanningReports");
  assert.match(DASH, /showConflicts && <ConflictCenter/, "ConflictCenter غير مربوط");
  assert.match(DASH, /showReports && <PlanningReports/, "PlanningReports غير مربوط");
});
