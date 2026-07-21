// ════════════════════════════════════════════════════════════════════════════
// tests/project_gantt_v2.test.js
// حراس انحدار لمسار «المخطط الزمني» V2 (Phase 4 · 4A — الإصلاح النهائي).
// يمنعان رجوع السبب الهش: جداول مؤقتة في مسار القراءة، Overloads، تفكّك عقد JSON،
// أو انفصال أسماء معاملات TypeScript عن SQL. فحوص ساكنة/بنيوية (بلا قاعدة بيانات).
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const SQL = fs.readFileSync(path.join(ROOT, "docs/project_planning_batch4a_final_fix_RUNME.sql"), "utf8");
const CORE_TS = fs.readFileSync(path.join(ROOT, "lib/portal/projectCore.ts"), "utf8");

// يستخرج جسم دالة plpgsql بين create...as $$ و $$ التالي (يكفي لفحوص «لا يحتوي X»).
function funcBody(sql, name) {
  const re = new RegExp(
    "create\\s+or\\s+replace\\s+function\\s+public\\." + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
    "\\s*\\([^)]*\\)[\\s\\S]*?\\bas\\s*\\$\\$([\\s\\S]*?)\\$\\$\\s*;",
    "i"
  );
  const m = sql.match(re);
  assert.ok(m, `تعذّر إيجاد جسم الدالة ${name} في SQL`);
  return m[1];
}

const RUNTIME_FUNCS = [
  "project_gantt_snapshot_v2",
  "project_gantt_snapshot_core",
  "project_critical_path_v2",
  "project_schedule_preview_v2",
];

test("لا CREATE TEMPORARY TABLE ولا DROP TABLE في أي دالة V2/Core", () => {
  for (const fn of RUNTIME_FUNCS) {
    const body = funcBody(SQL, fn);
    assert.doesNotMatch(body, /create\s+temp(orary)?\s+table/i, `${fn} تحتوي CREATE TEMPORARY TABLE`);
    assert.doesNotMatch(body, /\bdrop\s+table\b/i, `${fn} تحتوي DROP TABLE`);
    assert.doesNotMatch(body, /\bexecute\s+format\b/i, `${fn} تحتوي Dynamic SQL (execute format)`);
  }
});

test("كل دالة V2/Core مُعرّفة مرّة واحدة فقط (لا Overload غير مقصود)", () => {
  for (const fn of RUNTIME_FUNCS) {
    const count = (SQL.match(new RegExp("create\\s+or\\s+replace\\s+function\\s+public\\." + fn + "\\s*\\(", "gi")) || []).length;
    assert.equal(count, 1, `${fn} مُعرّفة ${count} مرّة`);
  }
});

test("gantt_snapshot_v2: توقيع واحد (uuid, boolean) بلا Default", () => {
  const m = SQL.match(/create\s+or\s+replace\s+function\s+public\.project_gantt_snapshot_v2\s*\(([^)]*)\)/i);
  assert.ok(m, "لم يُعثر على توقيع project_gantt_snapshot_v2");
  const sig = m[1].replace(/\s+/g, " ").trim().toLowerCase();
  assert.match(sig, /p_project uuid\s*,\s*p_include_children boolean/, "توقيع V2 غير متوقّع");
  assert.doesNotMatch(sig, /default/, "V2 يجب ألّا يحوي Default Arguments (يمنع Overload ambiguity)");
});

test("الدوال الداخلية (Core/critical_path_v2) مسحوبة الصلاحية من anon/authenticated", () => {
  assert.match(SQL, /revoke\s+execute\s+on\s+function\s+public\.project_critical_path_v2\(uuid\)\s+from\s+public,\s*anon,\s*authenticated/i);
  assert.match(SQL, /revoke\s+execute\s+on\s+function\s+public\.project_gantt_snapshot_core\(uuid,\s*boolean\)\s+from\s+public,\s*anon,\s*authenticated/i);
});

test("الدوال العامة V2/preview_v2 ممنوحة لـauthenticated (لا تسريب لـanon)", () => {
  assert.match(SQL, /grant\s+execute\s+on\s+function\s+public\.project_gantt_snapshot_v2\(uuid,\s*boolean\)\s+to\s+authenticated/i);
  assert.match(SQL, /grant\s+execute\s+on\s+function\s+public\.project_schedule_preview_v2\(uuid\)\s+to\s+authenticated/i);
  assert.match(SQL, /revoke\s+execute\s+on\s+function\s+public\.project_gantt_snapshot_v2\(uuid,\s*boolean\)\s+from\s+public,\s*anon/i);
});

test("V2/preview_v2 يتحققان من pc_can_read_project قبل إرجاع البيانات (لا يرى العميل الداخلي)", () => {
  assert.match(funcBody(SQL, "project_gantt_snapshot_v2"), /pc_can_read_project\s*\(\s*p_project\s*\)/i);
  assert.match(funcBody(SQL, "project_schedule_preview_v2"), /pc_can_read_project\s*\(\s*p_project\s*\)/i);
});

test("Core يعزل المسار الحرج (begin/exception) فلا يُفشل المخطط", () => {
  const body = funcBody(SQL, "project_gantt_snapshot_core");
  assert.match(body, /project_critical_path_v2\s*\(\s*p_project\s*\)/i, "Core لا يستدعي critical_path_v2");
  assert.match(body, /exception\s+when\s+others\s+then/i, "Core لا يعزل المسار الحرج بـexception handler");
});

test("عقد JSON ثابت: Arrays عبر coalesce '[]'، Objects عبر coalesce '{}'، لا null", () => {
  const body = funcBody(SQL, "project_gantt_snapshot_core");
  // المفاتيح المطلوبة موجودة في jsonb_build_object النهائي
  for (const key of ["project", "tasks", "dependencies", "calendar", "critical_path", "warnings", "generated_at"]) {
    assert.match(body, new RegExp("'" + key + "'\\s*,", "i"), `المفتاح ${key} مفقود من عقد Core`);
  }
  // الحاويات مضمونة غير null
  assert.match(body, /'tasks'\s*,\s*coalesce\(\s*v_tasks\s*,\s*'\[\]'::jsonb\)/i, "tasks غير مضمونة Array");
  assert.match(body, /'dependencies'\s*,\s*coalesce\(\s*v_deps\s*,\s*'\[\]'::jsonb\)/i, "dependencies غير مضمونة Array");
  assert.match(body, /'warnings'\s*,\s*coalesce\(\s*v_warn\s*,\s*'\[\]'::jsonb\)/i, "warnings غير مضمونة Array");
});

test("critical_path_v2 يعيد نتيجة آمنة (لا Exception) عند غياب المهام/الاعتماديات", () => {
  const body = funcBody(SQL, "project_critical_path_v2");
  // فرع v_n = 0 يعيد computable=false بدل رمي خطأ
  assert.match(body, /if\s+v_n\s*=\s*0\s+then[\s\S]*?'computable'\s*,\s*false/i, "لا فرع آمن لغياب المهام");
  // computable مبني على وجود اعتماديات
  assert.match(body, /'computable'\s*,\s*\(\s*v_dep_ct\s*>\s*0\s*\)/i, "computable لا يعتمد على عدد الاعتماديات");
});

test("wrapper القديم project_gantt_snapshot يفوّض إلى V2 (بلا جداول مؤقتة)", () => {
  const body = funcBody(SQL, "project_gantt_snapshot");
  assert.match(body, /project_gantt_snapshot_v2\s*\(/i, "الدالة القديمة لا تفوّض إلى V2");
  assert.doesNotMatch(body, /create\s+temp(orary)?\s+table/i, "الدالة القديمة ما زالت تنشئ جدولًا مؤقتًا");
});

test("اختبار ذاتي داخل SQL: يستدعي Core مباشرة + يرفع Exception عند الفشل (rollback)", () => {
  assert.match(SQL, /project_gantt_snapshot_core\s*\(\s*v_id\s*,\s*false\s*\)/i, "الاختبار الذاتي لا يستدعي Core مباشرة");
  assert.match(SQL, /raise\s+exception\s+'final_fix FAIL/i, "الاختبار الذاتي لا يرفع Exception عند الفشل");
  assert.match(SQL, /\bbegin;[\s\S]*\bcommit;/i, "الاختبار الذاتي ليس داخل Transaction");
  assert.match(SQL, /notify\s+pgrst/i, "لا notify pgrst");
});

test("wrapper TypeScript يستدعي project_gantt_snapshot_v2 بمعاملات p_project/p_include_children", () => {
  assert.match(CORE_TS, /prpc<GanttSnapshot>\(\s*"project_gantt_snapshot_v2"\s*,\s*\{\s*p_project:\s*projectId\s*,\s*p_include_children:\s*includeChildren\s*\}/,
    "wrapper الـGantt لا يستدعي V2 بالمعاملات الصحيحة");
  assert.match(CORE_TS, /prpc<SchedulePreview>\(\s*"project_schedule_preview_v2"\s*,\s*\{\s*p_project:\s*projectId\s*\}/,
    "wrapper الـpreview لا يستدعي preview_v2");
  assert.doesNotMatch(CORE_TS, /prpc<[^>]*>\(\s*"project_gantt_snapshot"\s*,/, "ما زال هناك استدعاء للدالة القديمة project_gantt_snapshot");
});

test("عقد TypeScript V2: GanttSnapshot يحوي الحقول الجديدة (project/warnings/generated_at)", () => {
  // GanttSnapshot متعدّد الأسطر: القوس الخاتم على سطر مستقل (\n}) — يتجاوز أقواس الحقول المتداخلة.
  const m = CORE_TS.match(/export interface GanttSnapshot \{([\s\S]*?)\n\}/);
  assert.ok(m, "لم يُعثر على interface GanttSnapshot");
  for (const f of ["project", "tasks", "dependencies", "critical_path", "calendar", "warnings", "today", "generated_at"]) {
    assert.match(m[1], new RegExp("\\b" + f + "\\b"), `GanttSnapshot ينقصه الحقل ${f}`);
  }
  // CriticalPath سطر واحد: القوس الخاتم الأخير على السطر (greedy) يتجاوز الأقواس المتداخلة.
  const cp = CORE_TS.match(/export interface CriticalPath \{([^\n]*)\}/);
  assert.ok(cp, "لم يُعثر على interface CriticalPath");
  assert.match(cp[1], /task_floats/, "CriticalPath ينقصه task_floats");
  assert.match(cp[1], /total_duration\b/, "CriticalPath ينقصه total_duration");
  assert.doesNotMatch(cp[1], /total_duration_working_days/, "CriticalPath ما زال يحوي الحقل القديم total_duration_working_days");
});

test("core لا يشير إلى أعمدة تواريخ غير موجودة على projects؛ يشتق من project_core ثم المهام", () => {
  const body = funcBody(SQL, "project_gantt_snapshot_core");
  // regression: projects لا تحوي start_date/due_date — يجب ألّا يشير إليها
  assert.doesNotMatch(body, /\bp\.start_date\b/, "core يشير إلى p.start_date غير الموجود على public.projects");
  assert.doesNotMatch(body, /\bp\.due_date\b/, "core يشير إلى p.due_date غير الموجود على public.projects");
  // المصدر الصحيح: project_core ثم اشتقاق من المهام
  assert.match(body, /left join public\.project_core pc/i, "core لا يربط project_core لمصدر التواريخ");
  assert.match(body, /coalesce\(\s*pc\.start_date\s*,[\s\S]*?min\(\s*tt\.start_date\s*\)/i, "start_date لا يشتق (project_core ثم min مهام)");
  assert.match(body, /coalesce\(\s*pc\.due_date\s*,[\s\S]*?max\(\s*tt\.due_date\s*\)/i, "due_date لا يشتق (project_core ثم max مهام)");
  for (const k of ["'id'", "'name'", "'start_date'", "'due_date'", "'status'"]) {
    assert.match(body, new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*,"), `عقد project ينقصه المفتاح ${k}`);
  }
});

test("الاختبار الذاتي يغطي: مشروع غير موجود + مفاتيح project حاضرة + نجاح v2 + include_children", () => {
  assert.match(SQL, /project_gantt_snapshot_core\s*\(\s*gen_random_uuid\(\)\s*,\s*false\s*\)/i, "لا اختبار ذاتي لمشروع غير موجود");
  assert.match(SQL, /jsonb_exists\(v_proj,\s*'start_date'\)/i, "الاختبار الذاتي لا يفحص حضور مفتاح start_date");
  assert.match(SQL, /jsonb_exists\(v_proj,\s*'due_date'\)/i, "الاختبار الذاتي لا يفحص حضور مفتاح due_date");
  assert.match(SQL, /project_gantt_snapshot_v2\s*\(\s*v_id\s*,\s*false\s*\)/i, "الاختبار الذاتي لا يستدعي v2");
  assert.match(SQL, /project_gantt_snapshot_core\s*\(\s*v_id\s*,\s*true\s*\)/i, "الاختبار الذاتي لا يغطّي include_children=true");
});

test("فرع الأبناء في core معزول ضد عمود parent_project_id غير المطبّق (undefined_column → [])", () => {
  const body = funcBody(SQL, "project_gantt_snapshot_core");
  // parent_project_id (هجرة hierarchy) قد يغيب على prod — يجب التقاط undefined_column وعدم إفشال اللقطة
  assert.match(body, /parent_project_id/i, "فرع الأبناء لا يشير إلى parent_project_id (تحقّق من المرجع)");
  assert.match(body, /exception\s+when\s+undefined_column\s+then[\s\S]*?v_children\s*:=\s*'\[\]'::jsonb/i,
    "فرع الأبناء غير معزول ضد undefined_column — مسار V2 غير محصّن من عمود projects غير موجود");
});
