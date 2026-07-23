// ════════════════════════════════════════════════════════════════════════════
// tests/project_programs_8a.test.js — حراس Batch 8A (البرامج والإنتاج المستمرّ).
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const SQL = read("docs/project_programs_batch8a_RUNME.sql");
const SQL6A = read("docs/project_hierarchy_batch6a_RUNME.sql");
const TS = read("lib/portal/programs.ts");
const UI = read("components/portal/projectcore/ProgramTab.tsx");
const OPS = read("components/portal/projectcore/ProjectOps.tsx");

function funcBody(name, src = SQL) {
  const m = src.match(new RegExp("create\\s+or\\s+replace\\s+function\\s+public\\." + name + "\\s*\\([^)]*\\)[\\s\\S]*?\\bas\\s*\\$\\$([\\s\\S]*?)\\$\\$\\s*;", "i"));
  assert.ok(m, `تعذّر إيجاد ${name}`); return m[1];
}

test("SQL 8A بنيوي: Preflight، Transaction، self-test، notify، بلا Temp/DROP", () => {
  assert.match(SQL, /do \$pre\$[\s\S]*8A PREFLIGHT/i, "لا Preflight");
  assert.match(SQL, /\bbegin;[\s\S]*\bcommit;/i, "ليس داخل Transaction");
  assert.match(SQL, /do \$selftest\$[\s\S]*raise exception '8A FAIL/i, "لا self-test");
  assert.match(SQL, /notify pgrst/i, "لا notify pgrst");
  assert.doesNotMatch(SQL, /create\s+temp(orary)?\s+table/i, "جداول مؤقتة في دوال القراءة");
  assert.doesNotMatch(SQL, /^\s*(drop function|drop table)/im, "DROP function/table");
  assert.match(SQL, /pc_is_master[\s\S]{0,160}raise exception '8A PREFLIGHT/i, "Preflight لا يتحقّق من هرمية 6A");
});

test("لا متغيّر plpgsql غير مُعرّف في دوال 8A", () => {
  const re = /create or replace function public\.([a-z_]+)\s*\([^)]*\)[\s\S]*?\blanguage plpgsql[\s\S]*?\bas\s*\$\$([\s\S]*?)\$\$\s*;/gi;
  let m, checked = 0;
  while ((m = re.exec(SQL))) {
    const name = m[1];
    const body = m[2].split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
    const dm = body.match(/\bdeclare\b([\s\S]*?)\bbegin\b/i);
    const declared = new Set([...(dm ? dm[1] : "").matchAll(/\b(v_[a-z_0-9]+)\b/g)].map((x) => x[1]));
    [...body.matchAll(/\bfor(?:each)?\s+(v_[a-z_0-9]+)\s+in/gi)].forEach((x) => declared.add(x[1]));
    const used = new Set([...body.matchAll(/\b(v_[a-z_0-9]+)\b/g)].map((x) => x[1]));
    const missing = [...used].filter((u) => !declared.has(u));
    assert.deepEqual(missing, [], `${name}: متغيّرات غير معرّفة ${missing.join(",")}`);
    checked++;
  }
  assert.ok(checked >= 4, `عدد دوال plpgsql المفحوصة ${checked} أقل من المتوقّع`);
});

test("البرنامج للمشروع الرئيسي فقط — والفرع لا يصبح برنامجًا", () => {
  // حارس DB على الجدول (لا يعتمد على الواجهة)
  assert.match(SQL, /create or replace function public\.program_settings_guard\(\)[\s\S]{0,600}program_requires_master/,
    "لا حارس master على مستوى الجدول");
  assert.match(SQL, /create trigger trg_program_settings_guard before insert or update on public\.project_program_settings/,
    "الحارس غير مربوط كـtrigger");
  // والـRPC يتحقّق أيضًا (دفاع بالعمق)
  const up = funcBody("project_program_settings_upsert");
  assert.match(up, /pc_is_master\(p_project\)[\s\S]{0,80}program_requires_master/, "RPC الإعدادات لا يتحقّق من master");
  const dash = funcBody("project_program_dashboard");
  assert.match(dash, /pc_is_master\(p_project\)[\s\S]{0,80}program_requires_master/, "اللوحة لا تتحقّق من master");
  // بيانات الوحدة للفرع فقط
  const um = funcBody("project_unit_metadata_upsert");
  assert.match(um, /v_scope <> 'subproject'[\s\S]{0,80}unit_requires_subproject/, "بيانات الوحدة تُقبل على غير الفرع");
});

test("لا مستوى هرميّ ثالث ولا نظام موازٍ", () => {
  // لا جدول مشاريع/مهام/تقدّم جديد
  assert.doesNotMatch(SQL, /create table[\s\S]{0,80}(project_tasks|project_progress|project_approvals|projects)\b/i, "8A ينشئ نظامًا موازيًا");
  // لا إعادة تعريف بوّابات الوصول أو دوال الهرمية
  ["can_access_project", "pc_can_read_project", "is_client_owner", "is_client_side", "pc_is_master",
   "project_hierarchy_rollup", "project_core_create_project"].forEach((f) =>
    assert.doesNotMatch(SQL, new RegExp("create or replace function public\\." + f + "\\s*\\("), `8A يعيد تعريف ${f}`));
  // لا core_stage جديد
  assert.doesNotMatch(SQL, /core_stage[^;]{0,200}check \(core_stage in/i, "8A يضيف core_stage جديدًا");
});

test("تفرّد رقم الوحدة داخل الأب (فهرس جزئي لا يتأثّر بالنقل)", () => {
  assert.match(SQL, /create unique index if not exists ux_projects_parent_unit_number[\s\S]{0,220}on public\.projects\(parent_project_id, unit_number\)/,
    "لا فهرس تفرّد لرقم الوحدة داخل الأب");
  assert.match(SQL, /where parent_project_id is not null and unit_number is not null and coalesce\(is_deleted,false\) = false/,
    "الفهرس ليس جزئيًّا (سيصطدم بالمستقلّة/المحذوفة)");
  // نفس نمط الهرمية القائم (تسلسل الترتيب)
  assert.match(SQL6A, /ux_projects_parent_seq/, "نمط ux_projects_parent_seq تغيّر في 6A");
  // sequence_number يبقى للترتيب ولا يُستبدل
  assert.doesNotMatch(SQL, /update public\.projects set sequence_number/i, "8A يعبث بترتيب الهرمية");
  const um = funcBody("project_unit_metadata_upsert");
  assert.match(um, /exception when unique_violation then\s*\n?\s*raise exception 'duplicate_unit_number'/, "تصادم الرقم يعطي خطأ خامًا");
});

test("لا كتابة على التقدّم أو المرحلة أو المالية أو العهدة أو Zoho", () => {
  const code = SQL.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
  assert.doesNotMatch(code, /update\s+public\.project_core/i, "8A يكتب على project_core (تقدّم/مرحلة)");
  assert.doesNotMatch(code, /progress_pct\s*=/i, "8A يكتب progress_pct");
  assert.doesNotMatch(code, /insert into public\.(invoices|payments|project_expenses)|update public\.(invoices|payments)/i, "كتابة مالية");
  assert.doesNotMatch(code, /zoho/i, "مساس بـZoho");
  assert.doesNotMatch(code, /update\s+public\.(custody|asset_custody)/i, "تعديل عهدة");
  // اللوحة والسجل قراءة فقط
  ["project_program_dashboard", "project_program_units"].forEach((f) =>
    assert.match(SQL, new RegExp("function public\\." + f + "\\([^)]*\\)\\s*\\n?\\s*returns jsonb language plpgsql stable"), `${f} ليست stable`));
});

test("target_units لا يغيّر الإنجاز — الإنجاز مشتقّ من محرّك 6A/3C", () => {
  const dash = funcBody("project_program_dashboard");
  assert.match(dash, /public\.project_hierarchy_rollup\(p_project\)/, "اللوحة لا تُركّب محرّك التقدّم القائم");
  // نسبة العدد التشغيلية منفصلة عن الإنجاز ولا تُخلط به
  assert.match(dash, /'operational_by_count_pct', v_op_pct/, "لا نسبة تشغيلية بالعدد");
  assert.match(dash, /case when coalesce\(v_set\.target_units, v_total\) > 0[\s\S]{0,200}else null end/, "المقام صفر لا يعيد null");
  // صحّة الأب وصحّة الفروع منفصلتان
  assert.match(dash, /'own_health', v_own_health/, "لا صحّة مستقلّة للأب");
  assert.match(dash, /'children_aggregate_health'/, "لا صحّة مجمّعة للوحدات");
});

test("العزل: كل صفوف الوحدات per-row، والعميل لا يرث رؤية الوحدات", () => {
  const units = funcBody("project_program_units");
  assert.match(units, /public\.pc_can_read_project\(c\.id\)/, "سجلّ الوحدات بلا عزل per-row");
  const dash = funcBody("project_program_dashboard");
  assert.match(dash, /public\.pc_can_read_project\(c\.id\)/, "عدّادات اللوحة بلا عزل per-row");
  // البوابة تُركّب pc_can_read_project لا بوابة جديدة
  const gate = funcBody("program_can");
  assert.match(gate, /if not public\.pc_can_read_project\(p_project\) then return false/, "بوابة البرنامج لا تبدأ بالعزل");
  // client_program_view_enabled علم عرض فقط — لا يمنح وصولًا
  assert.doesNotMatch(SQL, /client_program_view_enabled[\s\S]{0,200}or public\.pc_can_read_project/i, "علم العميل يوسّع الوصول");
  // RLS على جدول الإعدادات + لا سياسة كتابة مباشرة
  assert.match(SQL, /alter table public\.project_program_settings enable row level security/, "لا RLS");
  assert.match(SQL, /create policy pps_read on public\.project_program_settings for select/, "لا سياسة قراءة");
  assert.doesNotMatch(SQL, /create policy [a-z_]+ on public\.project_program_settings for (all|insert|update)/, "سياسة كتابة مباشرة");
});

test("Parent–Child: لا Double Counting — كل وحدة تُحسب مرّة واحدة", () => {
  const dash = funcBody("project_program_dashboard");
  // العدّ على الفروع المباشرة فقط (مستويان: لا أحفاد)
  assert.match(dash, /where c\.parent_project_id = p_project/, "العدّ ليس على الفروع المباشرة");
  assert.doesNotMatch(dash, /recursive|with recursive/i, "عدّ تكراريّ يخاطر بمستوى ثالث/تكرار");
  const units = funcBody("project_program_units");
  assert.match(units, /where c\.parent_project_id = p_project/, "السجلّ ليس على الفروع المباشرة");
});

test("لا N+1: العدّادات مجموعية والسجلّ مُصفَّح", () => {
  const dash = funcBody("project_program_dashboard");
  // لا حلقات، ولا استدعاء دالة لكل مشروع خارج المجموعة
  assert.doesNotMatch(dash, /\bfor\s+\w+\s+in\s+select/i, "حلقة لكل مشروع في اللوحة (N+1)");
  assert.doesNotMatch(dash, /loop\b/i, "حلقة في اللوحة");
  const units = funcBody("project_program_units");
  // التصفّح داخل CTE (LIMIT/OFFSET) لا عبر FILTER على التجميع ⇒ الاستعلامات المرتبطة للصفحة فقط
  assert.match(units, /select b\.\* from base b[\s\S]{0,220}limit v_limit offset v_offset/, "سجلّ الوحدات بلا Pagination داخل الـCTE");
  assert.doesNotMatch(units, /filter \(where p\.rn > v_offset/, "التصفّح عبر FILTER يُقيّم الاستعلامات المرتبطة لكل صف");
  assert.match(units, /has_more/, "لا has_more");
});

test("قيم غير المتاحة تعيد unavailable/null لا صفرًا مضلِّلًا", () => {
  const dash = funcBody("project_program_dashboard");
  assert.match(dash, /v_unplanned := case when v_set\.target_units is null then null/, "غير المخطط يعيد صفرًا بلا هدف");
  assert.match(dash, /'available', false, 'reason'/, "التوقّع لا يصرّح بسبب عدم التوفّر");
});

test("المنح والإبطال لكل دوال 8A", () => {
  const fns = [...SQL.matchAll(/create or replace function public\.([a-z_]+)\s*\(/g)].map((m) => m[1])
    .filter((f) => !["program_settings_guard", "program_scope_cleanup"].includes(f));
  assert.ok(fns.length >= 5, "عدد الدوال أقل من المتوقّع");
  fns.forEach((f) => {
    assert.match(SQL, new RegExp("revoke execute on function public\\." + f + "\\([^)]*\\) from public, anon"), `${f} بلا revoke`);
    assert.match(SQL, new RegExp("grant execute on function public\\." + f + "\\([^)]*\\) to authenticated"), `${f} بلا grant`);
  });
  // الحارس ممنوع على الجميع (trigger فقط)
  ["program_settings_guard", "program_scope_cleanup"].forEach((g) =>
    assert.match(SQL, new RegExp("revoke execute on function public\\." + g + "\\(\\) from public, anon, authenticated"), `${g} ممنوح للمستخدمين`));
});

test("أغلفة TS + رسائل عربية + تسميات بلا قيم خام", () => {
  ["project_program_dashboard", "project_program_units", "project_program_settings_upsert", "project_unit_metadata_upsert"].forEach((f) =>
    assert.match(TS, new RegExp('"' + f + '"'), `غلاف ${f} مفقود`));
  assert.match(TS, /export function programErr/, "لا مُترجم أخطاء");
  ["program_requires_master", "duplicate_unit_number", "unit_requires_subproject", "stale_update"].forEach((k) =>
    assert.match(TS, new RegExp(k), `رسالة ${k} مفقودة`));
  assert.match(TS, /OPERATING_MODEL_AR|UNIT_TYPE_AR|CADENCE_AR/, "لا تسميات عربية للقيم");
});

test("الواجهة: تبويب البرنامج للمشروع الرئيسي فقط ومربوط بـRPCs حقيقية", () => {
  assert.match(OPS, /import ProgramTab/, "ProjectOps لا يستورد تبويب البرنامج");
  assert.match(OPS, /\(tb\.k !== "program" \|\| isMaster\)/, "تبويب البرنامج يظهر لغير الرئيسي");
  assert.match(OPS, /tab === "program" && isMaster && <ProgramTab/, "التبويب غير مُصيَّر أو بلا حارس master");
  assert.match(OPS, /\(tab === "subprojects" \|\| tab === "program"\) && !isMaster\) setTab\("tasks"\)/, "لا سقوط عند فقدان صفة master");
  ["projectProgramDashboard", "projectProgramUnits", "projectProgramSettingsUpsert"].forEach((f) =>
    assert.match(UI, new RegExp(f + "\\("), `الواجهة لا تستدعي ${f}`));
  assert.doesNotMatch(UI, /\bmockData|dummyData|fakeData|TODO: wire\b/i, "بيانات وهمية");
  assert.match(UI, /process\.env\.NODE_ENV !== "production"/, "تسجيل الخطأ الخام غير محصور");
  assert.match(UI, /my !== seq\.current/, "لا تسلسل للطلبات");
  assert.match(UI, /mounted\.current/, "لا حارس Unmount");
  assert.match(UI, /if \(busy\) return;/, "لا منع للإرسال المزدوج");
});

test("الواجهة: فلاتر server-side + CSV + وصول (aria) + بلا قيم DB خام", () => {
  assert.match(UI, /projectProgramUnits\(projectId, \{ \.\.\.f, limit: 50, offset \}\)/, "الفلاتر ليست Server-side");
  assert.match(UI, /csvDownload\(/, "لا تصدير CSV");
  assert.match(UI, /aria-label=\{t\(\{ ar: "بحث بالاسم أو الكود أو الرقم"/, "حقل البحث بلا اسم وصول");
  assert.match(UI, /aria-label=\{t\(\{ ar: "النوع"/, "قائمة النوع بلا اسم وصول");
  assert.match(UI, /PC_STAGE_LABELS\[u\.core_stage as PcStage\]/, "المرحلة تُعرض خامًا");
  assert.match(UI, /HEALTH_LABELS\[u\.health as PcHealth\]/, "الصحّة تُعرض خامًا");
  assert.match(UI, /UNIT_TYPE_AR\[u\.unit_type\]/, "نوع الوحدة يُعرض خامًا");
  assert.match(UI, /role="alert"/, "حالة الخطأ بلا دور ARIA");
});

test("لا Regression في 6A/6B: الهرمية ودوالها كما هي", () => {
  ["project_hierarchy_rollup", "project_hierarchy_parent_dashboard", "project_hierarchy_tree",
   "project_hierarchy_reorder_subprojects"].forEach((f) =>
    assert.doesNotMatch(SQL, new RegExp("create or replace function public\\." + f + "\\s*\\("), `8A يعيد تعريف ${f} (6A/6B)`));
  // تبويب الفروع ما زال موجودًا بجانب تبويب البرنامج
  assert.match(OPS, /tab === "subprojects" && isMaster && <SubprojectsTab/, "تبويب الفروع فُقد");
});

// ════════════════════════════════════════════════════════════════════════════
// حراس مراجعة 8A العدائية — كل إصلاح مثبّت باختبار.
// ════════════════════════════════════════════════════════════════════════════
test("الصحّة المجمّعة تُشتقّ محليًّا (rollup لا تُعيد children_aggregate_health)", () => {
  const R6A = read("docs/project_hierarchy_batch6a_RUNME.sql");
  const roll = R6A.match(/create or replace function public\.project_hierarchy_rollup[\s\S]*?\bas\s*\$\$([\s\S]*?)\$\$\s*;/i);
  assert.ok(roll, "تعذّر إيجاد rollup");
  assert.doesNotMatch(roll[1], /children_aggregate_health/, "rollup صارت تُعيد المفتاح — بسّط الاشتقاق");
  const dash = funcBody("project_program_dashboard");
  assert.doesNotMatch(dash, /v_roll->'children_aggregate_health'/, "قراءة مفتاح غير موجود ⇒ null دائمًا");
  assert.match(dash, /when count\(\*\) filter \(where pc\.health='off_track'\) > 0 then 'off_track'/, "لا اشتقاق «أسوأ صحّة»");
  assert.match(dash, /'children_aggregate_health', to_jsonb\(v_agg_health\)/, "الصحّة المجمّعة غير موصولة");
});

test("السرعة صادقة: delivery_date يدويّ ⇒ تشترط delivered/closed وتاريخًا ماضيًا", () => {
  const dash = funcBody("project_program_dashboard");
  assert.match(dash, /pc\.core_stage in \('delivered','closed'\)\s*\n?\s*and pc\.delivery_date is not null and pc\.delivery_date <= v_today/,
    "السرعة تعدّ تواريخ مستقبلية أو وحدات غير مُسلَّمة");
  assert.match(dash, /'available', \(v_dated > 0\)/, "لا تمييز بين «سرعة صفر» و«لا بيانات»");
  assert.match(dash, /'basis'/, "أساس السرعة غير معلن");
});

test("لا رقم مضلِّل: الحوكمة unavailable، والتعارضات لا تُنسب للبرنامج", () => {
  const dash = funcBody("project_program_dashboard");
  ["critical_risks", "critical_issues", "overdue_approvals", "change_requests_pending"].forEach((k) =>
    assert.match(dash, new RegExp("'" + k + "', case when v_[a-z_]+ is null then to_jsonb\\('unavailable'"), `${k} يعيد صفرًا عند غياب المصدر`));
  // resource_conflict_center لا تقبل تصفية بالمشروع ⇒ رقمها منظّميّ ولا يُعرض هنا
  const dashCode = dash.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
  assert.doesNotMatch(dashCode, /resource_conflict_center/, "رقم تعارضات منظّميّ يُنسب للبرنامج");
});

test("المقام والتسمية: نسبة العدد على المستهدف، و«متبقٍّ إنشاؤه» لا «غير مخططة»", () => {
  const dash = funcBody("project_program_dashboard");
  assert.match(dash, /coalesce\(v_set\.target_units, v_total\)/, "النسبة تُقسم على المنشأ فقط");
  assert.match(dash, /least\(\s*\n?\s*ceil\(/, "التوقّع بلا حماية من تجاوز نطاق integer");
  assert.match(UI, /ar="متبقٍّ إنشاؤه"/, "التسمية ما زالت «غير مخططة»");
});

test("تنظيف النطاق: الخفض/الفصل لا يترك برنامجًا يتيمًا ولا بيانات وحدة معلّقة", () => {
  assert.match(SQL, /create trigger trg_program_scope_cleanup before update of project_scope on public\.projects/,
    "لا حارس تنظيف عند تغيّر النطاق");
  const cl = SQL.match(/create or replace function public\.program_scope_cleanup\(\)[\s\S]*?\$\$([\s\S]*?)\$\$/i)[1];
  assert.match(cl, /delete from public\.project_program_settings where project_id = new\.id/, "الخفض يترك صفّ برنامج يتيمًا");
  assert.match(cl, /new\.unit_number := null/, "الفصل يترك بيانات وحدة خارج برنامج");
});

test("بيانات الوحدة: عزل الابن + ترتيب أقفال موحّد + تحقّق النوع + حماية البحث", () => {
  const um = funcBody("project_unit_metadata_upsert");
  assert.match(um, /if not public\.pc_can_read_project\(p_project\) then raise exception 'not authorized'/, "لا عزل على الابن");
  // القفل child ثمّ parent (نفس ترتيب 6A move) تفاديًا للجمود
  assert.ok(um.indexOf("where id = p_project for update") < um.indexOf("where id = v_parent for update"),
    "ترتيب الأقفال معكوس مقابل 6A move (خطر deadlock)");
  assert.match(um, /bad_unit_type/, "نوع الوحدة بلا تحقّق صريح");
  const units = funcBody("project_program_units");
  assert.match(units, /\^\[0-9\]\{1,9\}\$/, "بحث رقميّ طويل يرفع integer out of range");
});

test("الواجهة: اللوحة تظهر بلا إعدادات + محرّر بيانات الوحدة موجود ومربوط", () => {
  // كانت اللوحة كلّها داخل {s && ...} فتختفي قبل ضبط الإعدادات
  assert.doesNotMatch(UI, /\{s && \(\s*\n\s*<section className=\{`\$\{card\} p-3 space-y-2`\}>/, "اللوحة مخفيّة بلا ملف إعدادات");
  // محرّر بيانات الوحدة يغلق حلقة «RPC بلا مستهلك»
  assert.match(UI, /projectUnitMetadataUpsert\(unit\.project_id/, "لا مستهلك لـprojectUnitMetadataUpsert");
  assert.match(UI, /function UnitMetaModal/, "لا محرّر لبيانات الوحدة");
  assert.match(UI, /if \(!r \|\| !r\.trim\(\)\) return;/, "إعادة الترقيم تمرّ بلا سبب");
  // خلفية النوافذ لا تُغلق عند سحب التحديد
  assert.match(UI, /onMouseDown=\{\(e\) => \{ if \(e\.target === e\.currentTarget\) onClose\(\); \}\}/, "سحب التحديد يغلق النافذة ويفقد الإدخال");
  assert.match(UI, /role="alert"/, "خطأ الحفظ غير مُعلَن");
  // CSV يصرّح أنّه الصفحة الحالية ويترجم القيم
  assert.match(UI, /تصدير الصفحة الحالية CSV/, "زرّ CSV يوحي بتصدير كامل السجلّ");
  assert.match(UI, /t\(PC_STAGE_LABELS\[u\.core_stage as PcStage\]/, "CSV يكتب enums خامًا");
});
