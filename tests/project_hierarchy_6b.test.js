// ════════════════════════════════════════════════════════════════════════════
// tests/project_hierarchy_6b.test.js — حراس Batch 6B (تجربة الهرمية وعملياتها).
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const SQL = read("docs/project_hierarchy_batch6b_RUNME.sql");
const SQL6A = read("docs/project_hierarchy_batch6a_RUNME.sql");
const TS = read("lib/portal/projectHierarchy.ts");
const TREE = read("components/portal/projectcore/HierarchyTree.tsx");
const TAB = read("components/portal/projectcore/SubprojectsTab.tsx");
const OPS = read("components/portal/projectcore/ProjectOps.tsx");
const DASH = read("components/portal/projectcore/ProjectCoreDashboard.tsx");

function funcBody(name, src = SQL) {
  const m = src.match(new RegExp("create\\s+or\\s+replace\\s+function\\s+public\\." + name + "\\s*\\([^)]*\\)[\\s\\S]*?\\bas\\s*\\$\\$([\\s\\S]*?)\\$\\$\\s*;", "i"));
  assert.ok(m, `تعذّر إيجاد ${name}`); return m[1];
}

test("SQL 6B بنيوي: Preflight، Transaction، self-test، notify، بلا Temp/DROP", () => {
  assert.match(SQL, /do \$pre\$[\s\S]*6B PREFLIGHT/i, "لا Preflight");
  assert.match(SQL, /\bbegin;[\s\S]*\bcommit;/i, "ليس داخل Transaction");
  assert.match(SQL, /do \$selftest\$[\s\S]*raise exception '6B FAIL/i, "لا self-test");
  assert.match(SQL, /notify pgrst/i, "لا notify pgrst");
  assert.doesNotMatch(SQL, /create\s+temp(orary)?\s+table/i, "جداول مؤقتة");
  assert.doesNotMatch(SQL, /^\s*(drop function|drop table)/im, "DROP function/table");
});

test("لا متغيّر plpgsql غير مُعرّف في دوال 6B", () => {
  const re = /create or replace function public\.([a-z_]+)\s*\([^)]*\)[\s\S]*?\bas\s*\$\$([\s\S]*?)\$\$\s*;/gi;
  let m;
  while ((m = re.exec(SQL))) {
    const name = m[1], body = m[2];
    if (/language sql/i.test(SQL.slice(m.index, m.index + 300))) continue;
    const dm = body.match(/\bdeclare\b([\s\S]*?)\bbegin\b/i);
    const declared = new Set([...(dm ? dm[1] : "").matchAll(/\b(v_[a-z_0-9]+)\b/g)].map((x) => x[1]));
    [...body.matchAll(/\bfor(?:each)?\s+(v_[a-z_0-9]+)\s+in/gi)].forEach((x) => declared.add(x[1]));
    const used = new Set([...body.matchAll(/\b(v_[a-z_0-9]+)\s*:=/g)].map((x) => x[1]));
    [...body.matchAll(/\binto\s+((?:v_[a-z_0-9]+\s*,?\s*)+)/gi)].forEach((g) => [...g[1].matchAll(/v_[a-z_0-9]+/g)].forEach((v) => used.add(v[0])));
    assert.deepEqual([...used].filter((v) => !declared.has(v)), [], `${name} متغيّرات غير مُعرّفة`);
  }
});

test("الشجرة: مستوى أعلى فقط (لا تكرار المشروع) + عزل per-row + بحث يشمل الفرع", () => {
  const b = funcBody("project_hierarchy_tree");
  // الصفوف الافتراضية = standalone+master فقط ⇒ الفرع لا يظهر مرّتين (كصفّ مستقل وكابن)
  assert.match(b, /then p\.project_scope in \('standalone','master'\)/i, "الشجرة قد تكرّر الفروع في المستوى الأعلى");
  assert.match(b, /public\.pc_can_read_project\(p\.id\)/i, "لا عزل per-row");
  assert.match(b, /ch\.project_name ilike '%'\|\|v_search\|\|'%'/i, "البحث لا يشمل اسم الفرع");
  assert.match(b, /public\.pc_can_read_project\(ch\.id\)/i, "بحث الفرع بلا عزل");
});

test("الشجرة: الفلاتر Server-side (نطاق/متأخر/حرج/عميل/مدير) + Pagination", () => {
  const b = funcBody("project_hierarchy_tree");
  assert.match(b, /v_scope not in \('all','standalone','master','subproject'\)[\s\S]*?bad_scope/i, "لا تحقّق من النطاق");
  assert.match(b, /not v_delayed or exists/i, "فلتر الفروع المتأخرة ليس server-side");
  assert.match(b, /not v_critical or exists/i, "فلتر الفروع الحرجة ليس server-side");
  assert.match(b, /limit v_limit \+ 1 offset v_offset/i, "لا Pagination");
});

test("الشجرة: العدّادات تُحسب للصفحة فقط (لا عمل لكل مشروع مرئيّ)", () => {
  const b = funcBody("project_hierarchy_tree");
  assert.match(b, /\), paged as \([\s\S]*?limit v_limit \+ 1 offset v_offset/i, "لا مرحلة paged قبل حساب العدّادات");
  const pagedIdx = b.indexOf("paged as (");
  const childrenIdx = b.indexOf("'children_total'");
  assert.ok(pagedIdx > 0 && childrenIdx > pagedIdx, "عدّادات الفروع تُحسب قبل التصفّح (N+1)");
});

test("إعادة الترتيب: ذرّية + FOR UPDATE على الأب + بلا max()+1 + بلا تكرار تسلسل + Audit", () => {
  const b = funcBody("project_hierarchy_reorder_subprojects");
  assert.match(b, /where id = p_parent for update/i, "لا قفل على الأب");
  assert.doesNotMatch(b, /max\(sequence_number\)\s*\)\s*\+\s*1/i, "يعتمد max()+1 بلا قفل");
  assert.match(b, /set sequence_number = null where parent_project_id = p_parent/i, "لا تفريغ قبل إعادة الإسناد (تصادم unique)");
  assert.match(b, /order_set_mismatch/i, "لا تحقّق من مطابقة مجموعة الإخوة");
  assert.match(b, /duplicate_ids/i, "لا منع تكرار المعرّفات");
  assert.match(b, /hier_can\(p_parent, 'hierarchy\.manage'\)/i, "بلا صلاحية");
  assert.match(b, /pc_log\(p_parent, 'subprojects_reordered'/i, "بلا Audit");
  assert.match(b, /public\.pc_can_read_project\(c\.id\)/i, "بلا عزل للفروع");
});

test("لوحة الأب: مؤشرات مشتقّة فقط (لا كتابة على الأب) + معزولة عند غياب الأنظمة", () => {
  const b = funcBody("project_hierarchy_parent_dashboard");
  for (const k of ["own_health", "children_aggregate_health", "earliest_child_due", "latest_child_due",
                   "children_critical_risks", "children_critical_issues", "children_open_bookings", "children_overdue_approvals", "children_closure"])
    assert.match(b, new RegExp("'" + k + "'"), `لوحة الأب ينقصها ${k}`);
  assert.match(b, /exception when undefined_table or undefined_column/i, "غير معزولة عن غياب 4B/5A");
  assert.doesNotMatch(SQL, /update public\.project_core set (progress_pct|health)/i, "تكتب مؤشرات مشتقّة على المشروع");
});

test("تنقّل الإخوة: prev/next حسب sequence_number + معزول per-row", () => {
  const b = funcBody("project_hierarchy_context");
  assert.match(b, /prev_sibling/i, "لا أخ سابق");
  assert.match(b, /next_sibling/i, "لا أخ تالٍ");
  assert.match(b, /row_number\(\) over \(order by coalesce\(s\.sequence_number, 9999\), s\.project_name\)/i, "الترتيب ليس حسب sequence_number");
  assert.match(b, /public\.pc_can_read_project\(s\.id\)/i, "الإخوة بلا عزل");
});

test("§22 عزل: 6B لا يعيد تعريف دوال الوصول ولا يمنح توريثًا من الأب", () => {
  for (const fn of ["can_access_project", "is_client_side", "is_client_owner", "pc_can_read_project"])
    assert.doesNotMatch(SQL, new RegExp("create or replace function public\\." + fn + "\\s*\\(", "i"), `6B يعيد تعريف ${fn}`);
  assert.match(funcBody("project_hierarchy_tree"), /and public\.pc_can_read_project\(p\.id\)/i, "الشجرة بلا عزل");
});

test("لا Regression في 6A: دوال 6A لم تُعَد كتابتها في 6B", () => {
  for (const fn of ["projects_hierarchy_guard", "project_core_create_project", "project_hierarchy_move_subproject",
                    "project_hierarchy_detach_subproject", "project_hierarchy_promote_to_master", "project_hierarchy_rollup"])
    assert.doesNotMatch(SQL, new RegExp("create or replace function public\\." + fn + "\\s*\\(", "i"), `6B يعيد تعريف ${fn} (يخاطر بانحدار 6A)`);
  // 6A ما زال يحمل حراسه
  assert.match(SQL6A, /circular_hierarchy/i, "حارس الدورات فُقد من 6A");
  assert.match(SQL6A, /master_has_live_subprojects/i, "حارس حذف الأب فُقد من 6A");
});

test("TS wrappers 6B تطابق أسماء RPC", () => {
  assert.match(TS, /prpc<[^>]*>\("project_hierarchy_tree",\s*\{\s*p_filters:/);
  assert.match(TS, /prpc<[^>]*>\("project_hierarchy_reorder_subprojects",\s*\{[^}]*p_ordered_ids:/s);
  assert.match(TS, /prpc<ParentDashboard>\("project_hierarchy_parent_dashboard"/);
});

test("الواجهة: شجرة مربوطة + Expand/Collapse + aria-expanded + لا زرّ داخل رابط", () => {
  assert.match(DASH, /import HierarchyTree/, "الدشبورد لا يستورد الشجرة");
  assert.match(DASH, /setShowTree\(true\)/, "لا زر لفتح الشجرة");
  assert.match(TREE, /projectHierarchyTree\(/, "الشجرة لا تستدعي RPC");
  assert.match(TREE, /aria-expanded=\{open\}/, "زر التوسيع بلا aria-expanded");
  assert.match(TREE, /aria-controls=\{panelId\}/, "لا ربط aria-controls");
  // لا <button> داخل <Link>: الرابط على العنوان فقط داخل <div> خارجي
  assert.doesNotMatch(TREE, /<Link[^>]*>[\s\S]{0,400}?<button/i, "زرّ داخل رابط (HTML غير صالح)");
  assert.match(TREE, /kids === null/, "الفروع لا تُجلب بكسل (Lazy)");
  assert.match(TREE, /process\.env\.NODE_ENV !== "production"/, "تسجيل الخطأ الخام غير محصور");
  assert.doesNotMatch(TREE, /\bmockData|dummyData|fakeData\b/i, "بيانات وهمية");
});

test("الواجهة: إعادة ترتيب + خفض + تنقّل الإخوة مربوطة بـRPCs حقيقية", () => {
  assert.match(TAB, /projectHierarchyReorderSubprojects\(projectId, ids\)/, "لا ربط لإعادة الترتيب");
  assert.match(TAB, /aria-label=\{t\(\{ ar: "تحريك لأعلى"/, "أزرار الترتيب بلا aria-label");
  assert.match(TAB, /projectHierarchyParentDashboard\(/, "التبويب لا يستهلك لوحة الأب");
  assert.match(OPS, /projectHierarchyDemoteToStandalone\(projectId, reason\)/, "لا ربط للخفض");
  assert.match(OPS, /hier\.prev_sibling/, "لا تنقّل للأخ السابق");
  assert.match(OPS, /hier\.next_sibling/, "لا تنقّل للأخ التالي");
  assert.match(OPS, /\?tab=subprojects/, "العودة لا تفتح تبويب الفروع");
});

test("منع Double Submit في إجراءات الهرمية", () => {
  assert.match(TAB, /if \(busy \|\| next < 0/, "إعادة الترتيب بلا حارس busy");
  assert.match(TAB, /disabled=\{busy \|\| idx === 0\}/, "زر أعلى بلا disabled");
  assert.match(TAB, /disabled=\{busy \|\| idx === rows\.length - 1\}/, "زر أسفل بلا disabled");
});

// ════════════════════════════════════════════════════════════════════════════
// حراس مراجعة 6B العدائية (15 نتيجة مؤكَّدة) — كلٌّ منها مثبّت باختبار.
// ════════════════════════════════════════════════════════════════════════════
test("الشجرة: LEFT JOIN على project_core (مشروع بلا صفّ core لا يختفي صامتًا)", () => {
  const b = funcBody("project_hierarchy_tree");
  assert.match(b, /left join public\.project_core pc on pc\.project_id = p\.id/i, "INNER JOIN يُسقط المشاريع بلا project_core");
  assert.doesNotMatch(b, /\n\s*join public\.project_core pc on/i, "ما زال هناك INNER JOIN على project_core في base");
  assert.match(b, /coalesce\(pc\.core_stage,'project_created'\)/i, "core_stage بلا coalesce");
  // children_active أيضًا: كان يُحسب بـINNER بينما children_total بلا join ⇒ «٣ فروع / ٠ نشط»
  assert.match(b, /'children_active',[\s\S]{0,220}left join public\.project_core cc/i, "children_active ما زال INNER JOIN");
  assert.match(b, /'children_active',[\s\S]{0,320}coalesce\(cc\.core_stage,'project_created'\)/i, "children_active بلا coalesce");
});

test("الشجرة: has_more عبر limit+1 لا عبر returned>=limit", () => {
  const b = funcBody("project_hierarchy_tree");
  assert.match(b, /limit v_limit \+ 1 offset v_offset/i, "لا يُجلب صفّ إضافي لتحديد has_more");
  assert.match(b, /row_number\(\) over \(order by[\s\S]*?\) as rn/i, "لا rn محدَّد الترتيب لقصّ الصفّ الإضافي");
  assert.match(b, /filter \(where f\.rn <= v_limit\)/i, "الصفّ الإضافي غير مقصوص من المخرجات");
  assert.match(b, /count\(\*\) > v_limit\)?\s*\n?\s*into v_rows, v_has_more/i, "has_more غير محسوب من العدّ الفعلي");
  assert.doesNotMatch(b, /jsonb_array_length\(v_rows\) >= v_limit/i, "ما زال has_more = returned>=limit (يكذب عند مضاعف تامّ)");
});

test("الشجرة: client_name يشمل company و manager_name مرتَّب (لا اختيار عشوائي)", () => {
  const b = funcBody("project_hierarchy_tree");
  assert.match(b, /coalesce\(cl\.full_name, cl\.company\)/i, "client_name بلا coalesce مع company");
  assert.match(b, /'manager_name',[\s\S]{0,320}order by m\.created_at limit 1/i, "manager_name بلا order by (يتغيّر بين نداءين)");
});

test("إعادة الترتيب: رؤية كاملة + قفل مجموعة الإخوة + إعادة تحقّق داخل UPDATE", () => {
  const b = funcBody("project_hierarchy_reorder_subprojects");
  // (١) لا يُسمح بإعادة ترتيب مجموعة يرى المستخدم بعضها فقط — الدالة DEFINER وتكتب على الجميع
  assert.match(b, /not public\.pc_can_read_project\(c\.id\)[\s\S]{0,120}order_set_partial_visibility/i, "لا حارس رؤية كاملة");
  // (٢) قفل الإخوة أنفسهم: move/detach يقفلان الابن والأب الجديد فقط، فقفل الأب لا يسلسلهما
  assert.match(b, /perform 1 from public\.projects c where c\.parent_project_id = p_parent order by c\.id for update/i, "مجموعة الإخوة غير مقفلة");
  // (٣) كل UPDATE يعيد التحقّق من الأب/الحذف ويرفض عند التغيّر المتزامن
  assert.match(b, /set sequence_number = v_i\s*\n?\s*where id = v_id and parent_project_id = p_parent and coalesce\(is_deleted,false\)=false/i, "UPDATE بلا إعادة تحقّق من الأب");
  assert.match(b, /if not found then raise exception 'order_set_mismatch'/i, "لا رفض عند نقل متزامن");
  // ترتيب منطقي: الرؤية الكاملة قبل التفريغ
  assert.ok(b.indexOf("order_set_partial_visibility") < b.indexOf("set sequence_number = null"), "حارس الرؤية بعد التفريغ");
  assert.ok(b.indexOf("for update") < b.indexOf("order_set_partial_visibility"), "الحارس خارج القفل");
});

test("إعادة الترتيب: لا إعادة استخدام أرقام تسلسل يحملها فرع مؤرشف (23505 عند الاستعادة)", () => {
  const b = funcBody("project_hierarchy_reorder_subprojects");
  assert.match(b, /into v_arch from public\.projects c[\s\S]{0,200}coalesce\(c\.is_deleted,false\)=true/i, "الفروع المؤرشفة غير مُلتقطة");
  // التفريغ يشمل المؤرشفة (بلا شرط is_deleted) ثم تُلحق بعد N
  assert.match(b, /set sequence_number = null where parent_project_id = p_parent;/i, "التفريغ ما زال يستثني المؤرشفة");
  assert.match(b, /foreach v_id in array v_arch loop/i, "المؤرشفة لا تُعاد ترقيمها بعد N");
  assert.match(b, /v_i := array_length\(p_ordered_ids,1\)/i, "عدّاد السجلّ يشمل المؤرشفة");
});

test("الواجهة: فشل جلب الفروع لا يُخزَّن كـ«لا فروع» + حارس طلب جارٍ + مسح فلاتر الفروع", () => {
  assert.match(TREE, /setKidsErr\(hierErr\(r\.error\)\); return;/, "فشل الجلب ما زال يُخزَّن كقائمة فارغة");
  assert.doesNotMatch(TREE, /setKids\(r\.ok \? /, "ما زال يُسند [] عند الفشل");
  assert.match(TREE, /kids === null && !loadingKids/, "لا حارس للطلب الجاري (نداءان عند توسيع سريع)");
  assert.match(TREE, /if \(loadingKids\) return;/, "loadKids بلا حارس تزامن");
  assert.match(TREE, /const childFiltersOff = scope === "standalone" \|\| scope === "subproject"/, "فلاتر الفروع لا تُعطَّل خارج النطاقات ذات الفروع");
  assert.match(TREE, /setDelayed\(false\); setCritical\(false\);/, "الفلاتر لا تُمسح عند تبديل النطاق");
  assert.match(TREE, /disabled=\{childFiltersOff\}/, "خانات الفروع بلا disabled");
});

test("الواجهة: تسميات الصحّة مترجَمة + الخفض لا يترك تبويبًا فارغًا", () => {
  assert.match(TAB, /pdash\.own_health \? t\(HEALTH_LABELS\[/, "own_health يُطبع خامًا");
  assert.match(TAB, /pdash\.children_aggregate_health \? t\(HEALTH_LABELS\[/, "children_aggregate_health يُطبع خامًا");
  assert.match(OPS, /if \(tab === "subprojects" && !isMaster\) setTab\("tasks"\)/, "الخفض يترك منطقة المحتوى فارغة");
});

test("رسائل الخطأ العربية تغطّي الرموز الجديدة", () => {
  assert.match(TS, /order_set_partial_visibility[\s\S]{0,120}صلاحية رؤيتها/, "لا رسالة عربية لـpartial_visibility");
});
