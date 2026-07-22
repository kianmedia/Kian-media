// ════════════════════════════════════════════════════════════════════════════
// tests/project_planning_4c.test.js — حراس انحدار لـPhase 4C (Leveling/Portfolio/Closure).
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const SQL = fs.readFileSync(path.join(ROOT, "docs/project_planning_batch4c_closure_RUNME.sql"), "utf8");
const CORE_TS = fs.readFileSync(path.join(ROOT, "lib/portal/projectCore.ts"), "utf8");
const GANTT = fs.readFileSync(path.join(ROOT, "components/portal/projectcore/ProjectGantt.tsx"), "utf8");
const DASH = fs.readFileSync(path.join(ROOT, "components/portal/projectcore/ProjectCoreDashboard.tsx"), "utf8");
const SCHED = fs.readFileSync(path.join(ROOT, "components/portal/projectcore/ProjectSchedule.tsx"), "utf8");

function funcBody(name) {
  const re = new RegExp("create\\s+or\\s+replace\\s+function\\s+public\\." + name +
    "\\s*\\([\\s\\S]*?\\bas\\s*\\$\\$([\\s\\S]*?)\\$\\$\\s*;", "i");
  const m = SQL.match(re);
  assert.ok(m, `تعذّر إيجاد جسم ${name}`);
  return m[1];
}

const READ_FNS = ["project_resource_leveling_core", "project_resource_leveling_preview", "project_schedule_health", "portfolio_schedule_dashboard"];

test("add_working_days يدعم السالب (لا قصّ greatest(p_n,0))", () => {
  const b = funcBody("add_working_days");
  assert.doesNotMatch(b, /greatest\(p_n,\s*0\)/i, "ما زال يقصّ السالب إلى صفر");
  assert.match(b, /abs\(coalesce\(p_n,0\)\)/i, "لا يحسب abs للخطوات");
  assert.match(b, /step int := case when coalesce\(p_n,0\) < 0 then -1 else 1 end/i, "لا يحدّد اتجاه الخطوة");
});

test("موازنة الموارد: بلا Temp Tables، auto فقط، لا تلمس done/status/progress/core_stage/baseline", () => {
  for (const fn of READ_FNS) assert.doesNotMatch(funcBody(fn), /create\s+temp(orary)?\s+table/i, `${fn} فيها جدول مؤقت`);
  const core = funcBody("project_resource_leveling_core");
  assert.match(core, /scheduling_mode,'manual'\) = 'auto'/i, "لا يقصر على auto");
  assert.match(core, /status not in \('done','cancelled'\)/i, "لا يستبعد done/cancelled");
  const apply = funcBody("project_resource_leveling_apply");
  assert.match(apply, /scheduling_mode='auto' and status not in \('done','cancelled'\)/i, "apply قد يلمس مهام غير auto/done");
  assert.doesNotMatch(apply, /set[^;]*\b(status|progress_pct|core_stage|baseline_start|baseline_end)\b\s*=/i, "apply يعدّل status/progress/core_stage/baseline");
  assert.match(apply, /stale_update/i, "apply بلا optimistic lock");
});

test("Leveling: core داخلي REVOKE؛ preview/apply مبوّبة وممنوحة", () => {
  assert.match(SQL, /revoke execute on function public\.project_resource_leveling_core\([^)]*\) from public, anon, authenticated/i, "core غير مسحوب");
  assert.match(funcBody("project_resource_leveling_preview"), /pc_can_read_project\(p_project\)/i, "preview بلا بوابة");
  assert.match(funcBody("project_resource_leveling_apply"), /can_manage_projects\(\) or public\.can_edit_project|projects\.auto_schedule/i, "apply بلا بوابة كتابة");
  for (const fn of ["project_resource_leveling_preview(uuid,jsonb)", "project_resource_leveling_apply(uuid,timestamptz,jsonb)", "project_schedule_health(uuid)", "portfolio_schedule_dashboard(jsonb)"]) {
    assert.match(SQL, new RegExp("grant\\s+execute\\s+on\\s+function\\s+public\\." + fn.replace(/([()])/g, "\\$1") + "\\s+to\\s+authenticated", "i"), `${fn} غير ممنوحة`);
  }
});

test("schedule_health يجمع الإشارات؛ portfolio مبوّبة + يحترم pc_can_read_project", () => {
  const h = funcBody("project_schedule_health");
  for (const sig of ["tasks_without_dates", "baseline_slippage", "overdue_tasks", "unscheduled_auto_tasks", "booking_conflicts", "project_finish_forecast"]) {
    assert.match(h, new RegExp(sig), `schedule_health ينقصه ${sig}`);
  }
  assert.match(h, /pc_can_read_project\(p_project\)/i, "schedule_health بلا بوابة");
  const p = funcBody("portfolio_schedule_dashboard");
  assert.match(p, /can_manage_projects\(\) or public\.emp_has_permission\('projects\.view_schedule'\)/i, "portfolio بلا بوابة");
  assert.match(p, /public\.pc_can_read_project\(p\.id\)/i, "portfolio لا يفلتر بقابلية القراءة (تسريب عبر المشاريع)");
});

test("اختبار ذاتي 4C يختبر add_working_days± + leveling ويُلغي المعاملة عند الفشل", () => {
  assert.match(SQL, /do \$selftest\$/i, "لا اختبار ذاتي");
  assert.match(SQL, /add_working_days\('2026-03-16'::date, -3\)/i, "لا يختبر السالب");
  assert.match(SQL, /raise exception '4C FAIL/i, "لا يرفع Exception عند الفشل");
  assert.match(SQL, /\bbegin;[\s\S]*\bcommit;/i, "ليس داخل Transaction");
  assert.match(SQL, /notify pgrst/i, "لا notify pgrst");
});

test("TS wrappers 4C موجودة وتستدعي RPCs الصحيحة", () => {
  assert.match(CORE_TS, /prpc<LevelingPreview>\("project_resource_leveling_preview"/);
  assert.match(CORE_TS, /prpc<[^>]*>\("project_resource_leveling_apply"/);
  assert.match(CORE_TS, /prpc<ScheduleHealth>\("project_schedule_health"/);
  assert.match(CORE_TS, /prpc<[^>]*>\("portfolio_schedule_dashboard"/);
});

test("الواجهة مربوطة: زر موازنة في Planner + Portfolio في اللوحة + مؤشّر إهمال للقديم", () => {
  assert.match(GANTT, /projectResourceLevelingPreview\(|projectResourceLevelingApply\(/, "Planner لا يربط الموازنة");
  assert.match(GANTT, /موازنة الموارد/, "لا زر موازنة في Planner");
  assert.match(DASH, /import PortfolioSchedule/, "اللوحة لا تستورد Portfolio");
  assert.match(DASH, /showPortfolio && <PortfolioSchedule/, "Portfolio غير مربوط");
  // مؤشّر إهمال UnifiedGanttTab يوجّه لـPlanner
  assert.match(SCHED, /gotoTab\("planning"\)/, "لا مؤشّر إهمال يوجّه لـPlanner");
});

test("مصدر الحقيقة موثّق (Single Source of Truth)", () => {
  const doc = fs.readFileSync(path.join(ROOT, "docs/PHASE4_PLANNING_SINGLE_SOURCE_OF_TRUTH.md"), "utf8");
  assert.match(doc, /project_tasks\.start_date/, "الوثيقة لا تحدّد مصدر تواريخ المهام");
  assert.match(doc, /project_core\.start_date/, "الوثيقة لا تحدّد مصدر تواريخ المشروع");
  assert.match(doc, /core_stage/, "الوثيقة لا تذكر core_stage كمصدر وحيد");
  assert.match(doc, /Deprecated/i, "الوثيقة لا توثّق الأنظمة القديمة");
});
