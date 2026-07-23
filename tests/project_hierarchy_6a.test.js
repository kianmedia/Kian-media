// ════════════════════════════════════════════════════════════════════════════
// tests/project_hierarchy_6a.test.js — حراس Batch 6A (تفعيل هرمية المشاريع).
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const SQL = read("docs/project_hierarchy_batch6a_RUNME.sql");
const TS = read("lib/portal/projectHierarchy.ts");
const WIZ = read("components/portal/projectcore/CreateProjectWizard.tsx");
const TAB = read("components/portal/projectcore/SubprojectsTab.tsx");
const OPS = read("components/portal/projectcore/ProjectOps.tsx");

function funcBody(name) {
  const m = SQL.match(new RegExp("create\\s+or\\s+replace\\s+function\\s+public\\." + name + "\\s*\\([^)]*\\)[\\s\\S]*?\\bas\\s*\\$\\$([\\s\\S]*?)\\$\\$\\s*;", "i"));
  assert.ok(m, `تعذّر إيجاد ${name}`); return m[1];
}

test("SQL 6A بنيوي: Preflight، Transaction، self-test، notify، بلا Temp/DROP fn-tbl", () => {
  assert.match(SQL, /do \$pre\$[\s\S]*6A PREFLIGHT/i, "لا Preflight");
  assert.match(SQL, /\bbegin;[\s\S]*\bcommit;/i, "ليس داخل Transaction");
  assert.match(SQL, /do \$selftest\$[\s\S]*raise exception '6A FAIL/i, "لا self-test");
  assert.match(SQL, /notify pgrst/i, "لا notify pgrst");
  assert.doesNotMatch(SQL, /create\s+temp(orary)?\s+table/i, "جداول مؤقتة");
  assert.doesNotMatch(SQL, /^\s*(drop function|drop table)/im, "DROP function/table");
});

test("لا متغيّر plpgsql غير مُعرّف في دوال 6A", () => {
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

test("§1-§2 الأعمدة والقيود: scope(standalone/master/subproject) + منع أب لنفسه + ربط scope↔parent", () => {
  assert.match(SQL, /add column if not exists parent_project_id\s+uuid references public\.projects\(id\) on delete restrict/i, "لا علاقة ذاتية");
  assert.match(SQL, /projects_scope_ck check \(project_scope in \('standalone','master','subproject'\)\)/i, "قيم النطاق غير صحيحة");
  assert.match(SQL, /projects_no_self_parent_ck check \(parent_project_id is null or parent_project_id <> id\)/i, "لا منع «أب لنفسه»");
  assert.match(SQL, /projects_scope_parent_ck check \([\s\S]*?project_scope = 'subproject' and parent_project_id is not null[\s\S]*?project_scope in \('standalone','master'\) and parent_project_id is null/i, "لا ربط scope↔parent");
});

test("الحارس: أب=master، نفس العميل، منع الدورات، منع حذف رئيسي له فروع، تجميد هوية الأب", () => {
  const b = funcBody("projects_hierarchy_guard");
  assert.match(b, /parent_must_be_master/i, "لا يفرض أن الأب رئيسي");
  assert.match(b, /subproject_client_must_match_master/i, "لا يفرض نفس العميل");
  assert.match(b, /circular_hierarchy/i, "لا حارس دورات");
  assert.match(b, /while v_cur is not null and v_depth < 16 loop/i, "حارس الدورات ليس تكراريًّا/محدودًا");
  assert.match(b, /master_has_live_subprojects/i, "لا يمنع حذف رئيسي له فروع حيّة");
  assert.match(b, /master_with_children_immutable_scope_parent_client/i, "لا يجمّد هوية الأب");
  assert.match(SQL, /create trigger trg_projects_hierarchy_guard before insert or update on public\.projects/i, "الحارس غير مربوط");
});

test("لا يُطبَّق انحراف Batch 1 (progress_mode/operational_stage/closure_status) — لا مصدر حقيقة مكرّر", () => {
  assert.doesNotMatch(SQL, /add column if not exists progress_mode/i, "يضيف projects.progress_mode (يعارض project_core)");
  assert.doesNotMatch(SQL, /add column if not exists operational_stage/i, "يضيف operational_stage (يعارض core_stage)");
  assert.doesNotMatch(SQL, /add column if not exists closure_status/i, "يضيف closure_status (يعارض 5C)");
  assert.doesNotMatch(SQL, /add column if not exists closed_at|add column if not exists reopened_at/i, "يضيف أعمدة إغلاق تعارض 5C");
});

test("لا يعيد تعريف دوال الوصول الأساسية (blast radius ≈50 سياسة RLS)", () => {
  for (const fn of ["can_access_project", "is_client_side", "is_client_owner", "pc_can_read_project"])
    assert.doesNotMatch(SQL, new RegExp("create or replace function public\\." + fn + "\\s*\\(", "i"), `6A يعيد تعريف ${fn}`);
});

test("§22 عزل: لا توريث رؤية من الأب — كل قراءة تمرّ per-row عبر pc_can_read_project", () => {
  assert.match(funcBody("project_subprojects_summary"), /public\.pc_can_read_project\(c\.id\)/i, "قائمة الفروع لا تُرشّح كل فرع على حدة");
  assert.match(funcBody("project_hierarchy_rollup"), /public\.pc_can_read_project\(c\.id\)/i, "التجميع لا يُرشّح الفروع");
  assert.match(funcBody("project_hierarchy_masters_list"), /public\.pc_can_read_project\(p\.id\)/i, "قائمة الرئيسية بلا عزل");
  assert.match(funcBody("project_hierarchy_context"), /public\.pc_can_read_project\(v_parent\)/i, "Breadcrumb يكشف أبًا غير مصرّح");
});

test("الإنشاء: نوع المشروع + الأب + وراثة اختيارية محدودة (لا ميزانية/تواريخ/مهام/مخرجات)", () => {
  const b = funcBody("project_core_create_project");
  assert.match(b, /v_scope not in \('standalone','master','subproject'\)[\s\S]*?bad_scope/i, "لا تحقّق من النطاق");
  assert.match(b, /parent_must_be_master/i, "لا يتحقّق أن الأب رئيسي");
  assert.match(b, /project_hierarchy_enabled\(\)/i, "علم التفعيل غير مُستشار (علم زخرفي)");
  assert.match(b, /v_client := pr\.client_id/i, "الفرع لا يرث عميل أبيه");
  assert.match(b, /inherit_manager[\s\S]*?inherit_team[\s\S]*?inherit_governance/i, "لا وراثة اختيارية");
  // لا وراثة للميزانية/التواريخ/المهام/المخرجات
  assert.doesNotMatch(b, /inherit_budget|inherit_dates|inherit_tasks|inherit_deliverables/i, "وراثة ممنوعة (ميزانية/تواريخ/مهام/مخرجات)");
});

test("النقل والفصل: صلاحية حسّاسة + سبب إلزامي + Audit", () => {
  const mv = funcBody("project_hierarchy_move_subproject");
  assert.match(mv, /reason_required/i, "النقل بلا سبب إلزامي");
  assert.match(mv, /hier_can\(p_project, 'hierarchy\.move'\)/i, "النقل بلا صلاحية");
  assert.match(mv, /subproject_client_must_match_master/i, "النقل لا يتحقّق من العميل");
  assert.match(mv, /pc_log\(p_project, 'subproject_moved'/i, "النقل بلا Audit");
  const dt = funcBody("project_hierarchy_detach_subproject");
  assert.match(dt, /reason_required/i, "الفصل بلا سبب");
  assert.match(dt, /hier_can\(p_project, 'hierarchy\.detach'\)/i, "الفصل بلا صلاحية");
  assert.match(dt, /project_scope = 'standalone', parent_project_id = null/i, "الفصل لا يحوّله إلى مستقل");
  assert.match(dt, /pc_log\(p_project, 'subproject_detached'/i, "الفصل بلا Audit");
  assert.match(funcBody("hier_can"), /p_key in \('hierarchy\.move','hierarchy\.detach','hierarchy\.manage_settings'\)/i, "مفاتيح حسّاسة غير مقيّدة");
});

test("§16/§17 التجميع مشتقّ فقط — لا يُكتب على تقدّم الأب (لا عدّ مزدوج)", () => {
  const b = funcBody("project_hierarchy_rollup");
  for (const k of ["own_progress", "children_aggregate_progress", "total_children", "active_children", "delayed_children", "critical_children"])
    assert.match(b, new RegExp("'" + k + "'"), `التجميع ينقصه ${k}`);
  assert.doesNotMatch(SQL, /update public\.project_core set progress_pct/i, "يكتب تقدّم الأب من التجميع (عدّ مزدوج)");
  assert.match(b, /else null end/i, "لا فروع ⇒ يجب null لا 0 مضلّل");
  assert.match(b, /children_aggregate_progress', v_agg/i, "التجميع لا يُعيد قيمة مشتقّة");
});

test("العزل عند غياب الهجرة: undefined_column محفوظ في الدوال المعتمدة على الأعمدة", () => {
  assert.match(funcBody("project_subprojects_summary"), /exception when undefined_column/i, "قائمة الفروع غير معزولة");
  assert.match(funcBody("project_hierarchy_rollup"), /exception when undefined_column/i, "التجميع غير معزول");
  assert.match(funcBody("pc_is_master"), /exception when undefined_column then return false/i, "pc_is_master غير معزولة");
});

test("TS wrappers 6A تطابق أسماء RPC + تسميات عربية فوق قيم DB", () => {
  assert.match(TS, /prpc<HierarchyRollup>\("project_hierarchy_rollup",\s*\{\s*p_project:/);
  assert.match(TS, /prpc<[^>]*>\("project_hierarchy_move_subproject",\s*\{[^}]*p_new_parent:[^}]*p_reason:/s);
  assert.match(TS, /prpc<[^>]*>\("project_hierarchy_detach_subproject"/);
  assert.match(TS, /prpc<[^>]*>\("project_hierarchy_masters_list"/);
  assert.match(TS, /standalone: \{ ar: "مشروع مستقل"[\s\S]*?master: \{ ar: "مشروع رئيسي"[\s\S]*?subproject: \{ ar: "مشروع فرعي"/, "تسميات النوع العربية ناقصة");
});

test("الواجهة: نوع المشروع + حقل الرئيسي + تبويب الفروع + Breadcrumb + زر الإضافة", () => {
  assert.match(WIZ, /SCOPES\.map/, "الويزارد بلا اختيار نوع المشروع");
  assert.match(WIZ, /isSub && \(/, "لا يظهر حقل «المشروع الرئيسي» للفرعي");
  assert.match(WIZ, /projectHierarchyMastersList\(/, "لا مصدر لقائمة المشاريع الرئيسية");
  assert.match(WIZ, /inherit_manager: inherit\.manager[\s\S]*?inherit_team[\s\S]*?inherit_governance/, "لا يمرّر الوراثة الاختيارية");
  assert.match(WIZ, /parentProjectId\?: string/, "لا يدعم تحديد الأب تلقائيًّا");
  assert.match(OPS, /import SubprojectsTab/, "ProjectOps لا يستورد تبويب الفروع");
  assert.match(OPS, /k: "subprojects"/, "تبويب الفروع غير مُدرج");
  assert.match(OPS, /tb\.k !== "subprojects" \|\| isMaster/, "تبويب الفروع غير مقصور على الرئيسي");
  assert.match(OPS, /aria-label=\{t\(\{ ar: "مسار المشروع"/, "لا Breadcrumb");
  assert.match(OPS, /setAddSub\(true\)/, "لا زر «إضافة مشروع فرعي»");
  assert.match(TAB, /projectSubprojectsSummary\(/, "التبويب لا يستهلك القائمة القائمة");
  // 6B رقّى التبويب إلى project_hierarchy_parent_dashboard الذي يحوي rollup داخله (مجموعة أشمل).
  assert.match(TAB, /projectHierarchyRollup\(|projectHierarchyParentDashboard\(/, "التبويب بلا تجميع");
  assert.match(TAB, /process\.env\.NODE_ENV !== "production"/, "تسجيل الخطأ الخام غير محصور");
  assert.doesNotMatch(TAB, /\bmockData|dummyData|fakeData\b/i, "بيانات وهمية");
});

test("مراجعة MAJOR: قفل صف الأب (FOR SHARE/UPDATE) يمنع Write-Skew وتضارب sequence_number", () => {
  assert.match(funcBody("projects_hierarchy_guard"), /where id = new\.parent_project_id for share/i, "الحارس يقرأ الأب بلا قفل (TOCTOU)");
  assert.match(funcBody("project_core_create_project"), /where id = v_parent for update/i, "الإنشاء يقرأ الأب بلا قفل (تضارب التسلسل)");
  // النقل يستخدم FOR UPDATE (أقوى من FOR SHARE) — يمنع TOCTOU وتضارب التسلسل معًا.
  assert.match(funcBody("project_hierarchy_move_subproject"), /where id = p_new_parent for update/i, "النقل يقرأ الأب الجديد بلا قفل حصريّ");
});

test("مراجعة MAJOR: النقل/الفصل يتطلّبان صلاحية على الأب الحالي أيضًا + رفض المحذوف", () => {
  const mv = funcBody("project_hierarchy_move_subproject");
  assert.match(mv, /c\.parent_project_id is not null and not public\.hier_can\(c\.parent_project_id, 'hierarchy\.move'\)/i, "النقل لا يتحقّق من صلاحية الأب الحالي");
  assert.match(mv, /coalesce\(c\.is_deleted,false\) then raise exception 'project_is_deleted'/i, "النقل يقبل فرعًا محذوفًا");
  const dt = funcBody("project_hierarchy_detach_subproject");
  assert.match(dt, /c\.parent_project_id is not null and not public\.hier_can\(c\.parent_project_id, 'hierarchy\.detach'\)/i, "الفصل لا يتحقّق من صلاحية الأب الحالي");
  assert.match(dt, /coalesce\(c\.is_deleted,false\) then raise exception 'project_is_deleted'/i, "الفصل يقبل فرعًا محذوفًا");
});

test("مراجعة MAJOR: توقيع admin_update_flags يطابق Batch 1 (returns boolean) — لا 42P13", () => {
  assert.match(SQL, /create or replace function public\.project_hierarchy_admin_update_flags\(p_data jsonb\)\s*\n?\s*returns boolean/i, "تغيير نوع الإرجاع يُجهض الدفعة (42P13)");
  assert.match(read("lib/portal/projectHierarchy.ts"), /prpc<boolean>\("project_hierarchy_admin_update_flags"/, "الغلاف لا يطابق boolean");
});

test("مراجعة MAJOR: مسار الترقية إلى «رئيسي» موجود (وإلا تبقى كل المشاريع standalone للأبد)", () => {
  const b = funcBody("project_hierarchy_promote_to_master");
  assert.match(b, /reason_required/i, "الترقية بلا سبب");
  assert.match(b, /hier_can\(p_project, 'hierarchy\.move'\)/i, "الترقية بلا صلاحية حسّاسة");
  assert.match(b, /only_standalone_can_be_promoted/i, "الترقية لا تقيّد المصدر");
  assert.match(b, /pc_log\(p_project, 'project_promoted_to_master'/i, "الترقية بلا Audit");
  assert.match(SQL, /create or replace function public\.project_hierarchy_demote_to_standalone/i, "لا مسار خفض معاكس");
});

test("مراجعة MAJOR: التقدّم من محرّك 3C الرسميّ لا من كاش progress_pct (مصدر واحد)", () => {
  assert.match(funcBody("project_hierarchy_rollup"), /project_progress_snapshot\(p_project\)->>'effective_progress'/i, "own_progress من الكاش لا من المحرّك");
  assert.match(funcBody("project_hierarchy_rollup"), /pc_hier_effective_progress\(c\.id\)/i, "تجميع الفروع من الكاش لا من المحرّك");
  assert.match(funcBody("pc_hier_effective_progress"), /project_progress_snapshot/i, "دالة التقدّم لا تستخدم المحرّك الرسميّ");
});

test("مراجعة MINOR: الحارس يتحقّق عند الإنشاء/تغيّر الهرمية/الاستعادة فقط (لا على كل تعديل)", () => {
  const b = funcBody("projects_hierarchy_guard");
  assert.match(b, /tg_op = 'INSERT'\s*\n?\s*or new\.parent_project_id is distinct from old\.parent_project_id/i, "شرط الحارس لا يبدأ بـINSERT/تغيّر الأب");
  assert.match(b, /or new\.client_id\s+is distinct from old\.client_id/i, "لا يتحقّق عند تغيّر العميل");
});

test("مراجعة MINOR: سجل الأب لا يحمل اسم الفرع (§22) + Preflight يغطّي تبعيات الصلاحيات", () => {
  assert.match(funcBody("project_core_create_project"), /pc_log\(v_parent, 'subproject_created', 'project', v_project, '\{\}'::jsonb\)/i, "سجل الأب يسرّب اسم الفرع");
  assert.match(SQL, /to_regclass\('public\.permissions'\) is null or to_regprocedure\('public\.emp_has_permission\(text\)'\) is null/i, "Preflight لا يغطّي كتالوج الصلاحيات");
});

test("مراجعة MINOR: الواجهة — deep-link + تسميات النشاط + خطأ قائمة الرئيسية", () => {
  assert.match(OPS, /initialTab === "subprojects" && isMaster\) setTab\("subprojects"\)/, "deep-link لتبويب الفروع لا يعمل");
  assert.match(OPS, /subproject_created: "إنشاء مشروع فرعي"[\s\S]*?project_promoted_to_master:/, "تسميات أحداث الهرمية ناقصة");
  assert.match(WIZ, /setMastersErr\(hierErr\(r\.error\)\)/, "فشل جلب المشاريع الرئيسية يُبتلع بصمت");
});

test("مراجعة 2: مصدر تقدّم واحد — القائمة والتجميع يستخدمان pc_hier_effective_progress نفسها", () => {
  assert.match(funcBody("project_subprojects_summary"), /'progress_pct', public\.pc_hier_effective_progress\(c\.id\)/i, "القائمة تعرض كاش progress_pct بينما التجميع يستخدم المحرّك (رقمان مختلفان)");
  assert.match(funcBody("project_hierarchy_rollup"), /pc_hier_effective_progress\(c\.id\)/i, "التجميع لا يستخدم نفس الدالة");
});

test("مراجعة 2: النقل يقفل الأب الجديد FOR UPDATE (يمنع 23505 على ux_projects_parent_seq) + kill-switch", () => {
  const b = funcBody("project_hierarchy_move_subproject");
  assert.match(b, /where id = p_new_parent for update/i, "FOR SHARE لا يسلسل النقلين ⇒ تضارب تسلسل");
  assert.match(b, /project_hierarchy_enabled\(\)/i, "النقل يتجاهل علم التفعيل");
  assert.match(funcBody("project_hierarchy_demote_to_standalone"), /coalesce\(c\.is_deleted,false\) then raise exception 'project_is_deleted'/i, "الخفض يقبل مشروعًا مؤرشفًا (يحبس فروعه)");
});

test("مراجعة 2: الحارس لا يقفل الأب عند كل كتابة على فرع حيّ (فرعا ب/ج يحميان الأب)", () => {
  const b = funcBody("projects_hierarchy_guard");
  assert.doesNotMatch(b, /or coalesce\(new\.is_deleted,false\) = false/i, "ما زال يتحقّق/يقفل عند كل تعديل لفرع حيّ");
  assert.match(b, /coalesce\(old\.is_deleted,false\) = true and coalesce\(new\.is_deleted,false\) = false/i, "لا يتحقّق عند الاستعادة");
});

test("مراجعة 2: أغلفة الترقية/الخفض موجودة + زر الترقية في الواجهة (بلا هذا لا يمكن بناء هرمية)", () => {
  const ts = read("lib/portal/projectHierarchy.ts");
  assert.match(ts, /prpc<[^>]*>\("project_hierarchy_promote_to_master"/, "لا غلاف للترقية");
  assert.match(ts, /prpc<[^>]*>\("project_hierarchy_demote_to_standalone"/, "لا غلاف للخفض");
  assert.match(OPS, /projectHierarchyPromoteToMaster\(projectId, reason\)/, "لا زر ترقية في الواجهة");
});

test("لا عمل ثقيل لكل فرع داخل قائمة الفروع عدا محرّك التقدّم الموحّد", () => {
  const b = funcBody("project_subprojects_summary");
  assert.doesNotMatch(b, /executive_project_scorecard\(|project_closure_readiness\(|project_schedule_health\(/i, "قائمة الفروع تستدعي RPC ثقيلًا لكل فرع");
});

test("يعيد استخدام pc_is_subproject ولا ينشئ أوراكل هرمية موازيًا", () => {
  assert.doesNotMatch(SQL, /create or replace function public\.pc_is_subproject/i, "6A يعيد تعريف pc_is_subproject");
  assert.match(SQL, /pc_is_subproject مفقودة \(Phase 4C\)/i, "Preflight لا يتطلّب pc_is_subproject");
  assert.match(SQL, /create or replace function public\.pc_is_master/i, "لا دالة pc_is_master بنفس الشكل");
});
