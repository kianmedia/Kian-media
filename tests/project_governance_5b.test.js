// ════════════════════════════════════════════════════════════════════════════
// tests/project_governance_5b.test.js — حراس Phase 5B (اللوحة التنفيذية/KPIs/المحفظة).
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const SQL = read("docs/project_governance_batch5b_RUNME.sql");
const TS = read("lib/portal/executive.ts");
const UI = read("components/portal/projectcore/ExecutiveDashboard.tsx");
const DASH = read("components/portal/projectcore/ProjectCoreDashboard.tsx");
const CRON = read("app/api/cron/notify-email/route.ts");

function funcBody(name) {
  const m = SQL.match(new RegExp("create\\s+or\\s+replace\\s+function\\s+public\\." + name + "\\s*\\([^)]*\\)[\\s\\S]*?\\bas\\s*\\$\\$([\\s\\S]*?)\\$\\$\\s*;", "i"));
  assert.ok(m, `تعذّر إيجاد ${name}`); return m[1];
}

test("SQL 5B بنيوي: جداول/دوال، بلا Temp/DROP fn-tbl، Transaction، Preflight، self-test، notify", () => {
  for (const tbl of ["executive_kpi_catalog", "executive_kpi_snapshots", "executive_alert_rules"])
    assert.match(SQL, new RegExp("create table if not exists public\\." + tbl, "i"), `الجدول ${tbl} مفقود`);
  assert.doesNotMatch(SQL, /create\s+temp(orary)?\s+table/i, "جداول مؤقتة");
  assert.doesNotMatch(SQL, /^\s*(drop function|drop table)/im, "DROP function/table");
  assert.match(SQL, /do \$pre\$[\s\S]*5B PREFLIGHT/i, "لا Preflight");
  assert.match(SQL, /\bbegin;[\s\S]*\bcommit;/i, "ليس داخل Transaction");
  assert.match(SQL, /do \$selftest\$[\s\S]*raise exception '5B FAIL/i, "لا self-test");
  assert.match(SQL, /notify pgrst/i, "لا notify pgrst");
});

test("لا متغيّر plpgsql غير مُعرّف في دوال 5B", () => {
  const re = /create or replace function public\.([a-z_]+)\s*\([^)]*\)[\s\S]*?\bas\s*\$\$([\s\S]*?)\$\$\s*;/gi;
  let m;
  while ((m = re.exec(SQL))) {
    const name = m[1], body = m[2];
    if (/language sql/i.test(SQL.slice(m.index, m.index + 240))) continue;
    const dm = body.match(/\bdeclare\b([\s\S]*?)\bbegin\b/i);
    const declared = new Set([...(dm ? dm[1] : "").matchAll(/\b(v_[a-z_0-9]+)\b/g)].map((x) => x[1]));
    [...body.matchAll(/\bfor\s+(v_[a-z_0-9]+)\s+in/gi)].forEach((x) => declared.add(x[1]));
    const used = new Set([...body.matchAll(/\b(v_[a-z_0-9]+)\s*:=/g)].map((x) => x[1]));
    [...body.matchAll(/\binto\s+((?:v_[a-z_0-9]+\s*,?\s*)+)/gi)].forEach((g) => [...g[1].matchAll(/v_[a-z_0-9]+/g)].forEach((v) => used.add(v[0])));
    assert.deepEqual([...used].filter((v) => !declared.has(v)), [], `${name} متغيّرات غير مُعرّفة`);
  }
});

test("العزل الحاسم: exec_visible_projects تُرشِّح بـ pc_can_read_project لكل صف (لا تسرّب كـ project_core_dashboard)", () => {
  const b = funcBody("exec_visible_projects");
  assert.match(b, /public\.pc_can_read_project\(p\.id\)/i, "لا فلترة per-row عبر pc_can_read_project");
  assert.match(b, /coalesce\(p\.is_deleted,false\)\s*=\s*false/i, "لا استبعاد Soft-Delete");
});

test("exec_can مرساة is_staff (العميل مُستبعَد) + owner/management/permission", () => {
  const b = funcBody("exec_can");
  assert.match(b, /public\.is_staff\(\)\s+and\s+\(public\.is_owner\(\)\s+or\s+public\.can_manage_projects\(\)\s+or\s+public\.emp_has_permission\(p_key\)\)/i, "exec_can غير مرساة is_staff");
});

test("الدشبورد التجميعي: نداء واحد، لا حلقة RPC صريحة، معزول، ومصفحّن", () => {
  const b = funcBody("executive_portfolio_dashboard");
  assert.match(b, /exec_can\('executive\.view_dashboard'\)/i, "الدشبورد بلا بوابة صلاحية");
  assert.match(b, /exec_visible_projects\(p_filters\)/i, "الدشبورد لا يمرّ عبر المجموعة المعزولة");
  assert.match(b, /limit v_limit offset v_offset/i, "لا Pagination");
  assert.match(b, /skip_scorecards/i, "لا مسار تحميل سريع (skip_scorecards)");
});

test("تقنيع مالي: الدشبورد لا يُسرّب budget/cost غير مقنّع (يُظهر financial_visible فقط)", () => {
  const b = funcBody("executive_portfolio_dashboard");
  assert.match(b, /exec_fin_visible\(\)/i, "لا فحص رؤية المالية");
  assert.doesNotMatch(b, /sum\(pc\.budget_amount\)|sum\(pc\.actual_cost\)|total_budget|total_cost/i, "تسريب مالي غير مقنّع في الدشبورد");
});

test("عزل مراجع 5A/الهرمية غير المطبّقة (to_regclass/undefined_table) + pc_is_subproject", () => {
  assert.match(SQL, /to_regprocedure\('public\.project_governance_health\(uuid\)'\)/i, "governance_health غير معزولة");
  assert.match(SQL, /to_regclass\('public\.project_(risks|approvals|change_requests)'\)/i, "جداول 5A غير معزولة");
  assert.match(funcBody("exec_gov_counts"), /exception when undefined_table or undefined_column/i, "exec_gov_counts لا تعزل غياب 5A");
  assert.match(funcBody("exec_visible_projects"), /exception when undefined_table/i, "فلاتر الأدوار (project_member_roles) غير معزولة");
  assert.match(SQL, /public\.pc_is_subproject\(/i, "لا استخدام pc_is_subproject للأب/الفرع");
});

test("قاعدة KPI: denominator=0 ⇒ null لا 0 (snapshot_capture) + self-test يؤكّدها", () => {
  const b = funcBody("executive_snapshot_capture");
  assert.match(b, /case when v_open_tasks>0 then [\s\S]*?else null end/i, "overdue_task_rate لا يعيد null عند denominator=0");
  assert.match(b, /case when v_total>0 then [\s\S]*?else null end/i, "completion_rate لا يعيد null عند denominator=0");
  assert.match(SQL, /case when 0 > 0 then[\s\S]*?else null end\) is not null then\s*\n?\s*raise exception '5B FAIL: قاعدة denominator/i, "self-test لا يؤكّد قاعدة denominator");
});

test("تطبيع مفردات الحالة المتضاربة إلى موحّدة (off_track→critical، on_track→healthy)", () => {
  const b = funcBody("exec_norm_status");
  assert.match(b, /when 'off_track' then 'critical'/i, "off_track لا يُطبَّع إلى critical");
  assert.match(b, /when 'on_track' then 'healthy'/i, "on_track لا يُطبَّع إلى healthy");
  assert.match(b, /else 'unavailable'/i, "لا حالة unavailable افتراضية");
});

test("Scorecard: 6 محاور مُركّبة من الدوال القائمة (لا إعادة حساب موازية) + الحالة العامة أسوأ محور", () => {
  const b = funcBody("executive_project_scorecard");
  for (const axis of ["execution", "schedule", "resources", "governance", "quality", "delivery_readiness"])
    assert.match(b, new RegExp("'" + axis + "'"), `المحور ${axis} مفقود`);
  assert.match(b, /public\.project_execution_health\(p_project\)/i, "لا تركيب project_execution_health");
  assert.match(b, /public\.project_schedule_health\(p_project\)/i, "لا تركيب project_schedule_health");
  // الموارد تُشتقّ محليًّا (لا إعادة حساب عبر project_planning_health التي تكرّر التنفيذ+الجدول).
  assert.doesNotMatch(b, /public\.project_planning_health\(/i, "ما زال يستدعي project_planning_health (إعادة حساب مزدوجة)");
  assert.match(b, /public\.exec_gov_health\(p_project\)/i, "لا تركيب صحّة الحوكمة المعزولة");
});

// عقد كتالوج المؤشرات: قائمة أعمدة صريحة + تطابق عدد القيم + لا unit=null (حارس انحدار 23502).
function parseCatalogInsert() {
  const m = SQL.match(/insert into public\.executive_kpi_catalog \(([^)]*)\) values([\s\S]*?)on conflict/i);
  assert.ok(m, "لا INSERT صريح لكتالوج المؤشرات");
  const cols = m[1].split(",").map((c) => c.trim());
  const rows = [];
  for (const line of m[2].split(/\),\s*\n/)) {
    const t = line.trim().replace(/^\(/, "").replace(/\)\s*$/, "");
    if (!t) continue;
    const parts = []; let cur = "", q = false, br = 0;
    for (const ch of t) {
      if (ch === "'") q = !q;
      if (ch === "{") br++;
      if (ch === "}") br--;
      if (ch === "," && !q && br === 0) { parts.push(cur.trim()); cur = ""; }
      else cur += ch;
    }
    parts.push(cur.trim());
    rows.push(parts);
  }
  return { cols, rows };
}

test("عقد الكتالوج: قائمة أعمدة صريحة، تطابق عدد القيم، لا unit=null، critical_issue_count.unit='count'", () => {
  const { cols, rows } = parseCatalogInsert();
  for (const need of ["key", "category", "label_ar", "label_en", "unit", "aggregation_method", "required_permissions"])
    assert.ok(cols.includes(need), `قائمة أعمدة الكتالوج ينقصها ${need}`);
  const ui = cols.indexOf("unit");
  assert.ok(rows.length >= 17, `صفوف الكتالوج ${rows.length} < 17`);
  for (const r of rows) {
    assert.equal(r.length, cols.length, `انزياح: صف ${r[0]} فيه ${r.length} قيمة بدل ${cols.length}`);
    const unit = (r[ui] || "").trim();
    assert.ok(unit !== "null" && unit !== "" , `unit=null في الصف ${r[0]}`);
    assert.match(unit, /^'(count|percent|days|hours|ratio|score)'$/, `unit غير صالحة في ${r[0]}: ${unit}`);
  }
  const cic = rows.find((r) => r[0] === "'critical_issue_count'");
  assert.ok(cic, "critical_issue_count مفقود");
  assert.equal(cic[ui].trim(), "'count'", "critical_issue_count.unit ≠ 'count'");
  // لا literal null في موضع unit مطلقًا داخل قيم الكتالوج
  const valuesBlock = SQL.match(/insert into public\.executive_kpi_catalog[\s\S]*?on conflict/i)[0];
  assert.doesNotMatch(valuesBlock, /',\s*null\s*,\s*'(count|percent|days|hours|ratio|score|distribution)'/i, "قيمة null في موضع unit");
});

test("self-test الكتالوج داخل SQL: يفحص unit=null + توافق النوع + critical_issue_count", () => {
  assert.match(SQL, /where unit is null\) then raise exception '5B FAIL: مؤشر بـunit=null'/i, "self-test لا يفحص unit=null");
  assert.match(SQL, /critical_issue_count'\),''\) <> 'count'/i, "self-test لا يثبّت critical_issue_count.unit=count");
  assert.match(SQL, /unit<>'percent'[\s\S]*?unit<>'days'[\s\S]*?unit<>'count'/i, "self-test لا يفحص توافق unit مع النوع");
});

test("لا مسار آخر يكتب executive_kpi_catalog بـ unit=null (INSERT واحد DO NOTHING)", () => {
  const inserts = [...SQL.matchAll(/insert into public\.executive_kpi_catalog/gi)];
  assert.equal(inserts.length, 1, "أكثر من INSERT للكتالوج");
  assert.doesNotMatch(SQL, /update public\.executive_kpi_catalog/i, "يوجد UPDATE للكتالوج قد يكتب null");
  assert.match(SQL, /insert into public\.executive_kpi_catalog[\s\S]*?on conflict \(key\) do nothing/i, "الكتالوج ليس DO NOTHING (قد يدهس بقيمة null)");
});

test("§19 صلاحيات: ≥10 مفاتيح executive في الكتالوج", () => {
  const keys = [...SQL.matchAll(/\('executive\.[a-z_]+'/g)];
  assert.ok(keys.length >= 10, `مفاتيح executive ${keys.length} < 10`);
});

test("Alerts: idempotent عبر reminder_tracking + pc_event_emit، لا للعميل، لا Cron جديد", () => {
  const b = funcBody("executive_alerts_scan");
  assert.match(b, /reminder_tracking[\s\S]*?next_eligible_at\s*>\s*now\(\)/i, "لا بوابة cadence عبر reminder_tracking");
  assert.match(b, /pc_event_emit\(/i, "لا استخدام pc_event_emit");
  assert.match(b, /kian_manager/i, "المستلمون لا يشملون مدير المشروع");
  // لا ملف cron جديد: يُعاد استخدام notify-email.
  assert.match(CRON, /executive_alerts_scan/i, "cron لا يستدعي executive_alerts_scan");
  assert.match(CRON, /executive_snapshot_capture/i, "cron لا يلتقط لقطة KPI");
});

test("TS wrappers 5B تطابق أسماء RPC ومعاملاتها", () => {
  assert.match(TS, /prpc<ExecPortfolio>\("executive_portfolio_dashboard",\s*\{\s*p_filters:/);
  assert.match(TS, /prpc<ExecScorecard>\("executive_project_scorecard",\s*\{\s*p_project:/);
  assert.match(TS, /prpc<[^>]*>\("executive_delivery_forecast",\s*\{\s*p_project:/);
  assert.match(TS, /prpc<[^>]*>\("executive_portfolio_risks_issues"/);
  assert.match(TS, /prpc<[^>]*>\("executive_data_quality_report"/);
});

test("الواجهة مربوطة فعليًا: زر «الإدارة التنفيذية» + RPCs حقيقية + نص الحالة (لا لون فقط) + لا mock", () => {
  assert.match(DASH, /import ExecutiveDashboard/, "ProjectCoreDashboard لا يستورد المكوّن");
  assert.match(DASH, /showExecutive.*ExecutiveDashboard|ExecutiveDashboard onClose/s, "لا render للّوحة التنفيذية");
  assert.match(DASH, /setShowExecutive\(true\)/, "لا زر لفتح اللوحة");
  assert.match(UI, /executivePortfolioDashboard\(/, "المكوّن لا يستدعي الدشبورد");
  assert.match(UI, /EXEC_STATUS\[[^\]]*\]\??\.ar/, "الحالة تعتمد اللون فقط (لا نص)");
  assert.match(UI, /process\.env\.NODE_ENV !== "production"/, "تسجيل الخطأ الخام غير محصور");
  assert.match(UI, /csvDownload\(|csvExport\(/, "لا تصدير CSV");
  assert.doesNotMatch(UI, /\bmockData|dummyData|fakeData\b/i, "بيانات وهمية");
});

test("مراجعة: readiness_percent يتّسق مع ready (الفحوص الإرشادية لا تُضخّم المقام؛ الملفات النهائية حاجب)", () => {
  const b = funcBody("executive_delivery_readiness");
  assert.match(b, /if v_dlv_total = 0 then\s*\n?\s*v_adv/i, "لا مخرجات = إرشادي، لا يُحسب في المقام");
  assert.match(b, /'no_final_files'[\s\S]{0,40}?v_blockers|v_blockers[\s\S]{0,80}?'no_final_files'/i, "غياب الملفات النهائية ليس حاجبًا");
});

test("مراجعة: forecast confidence=unavailable عند غياب التوقّع (لا medium/high لتوقّع غير موجود)", () => {
  assert.match(funcBody("executive_delivery_forecast"), /when v_forecast is null then 'unavailable'/i, "الثقة لا تصبح unavailable عند غياب التوقّع");
});

test("مراجعة: near_delivery لا يشمل 'delivered' (لا bucket مزدوج) + risks rows تستثني accepted كالعدّاد", () => {
  assert.doesNotMatch(funcBody("executive_portfolio_dashboard"), /'near_delivery'[\s\S]{0,120}?core_stage in \([^)]*'delivered'/i, "near_delivery يشمل delivered");
  assert.match(funcBody("executive_portfolio_risks_issues"), /r\.status not in \('closed','accepted'\)/i, "صفوف المخاطر لا تستثني accepted (تناقض العدّاد)");
});

test("مراجعة: change control يُقنّع financial_impact_reference خلف exec_fin_visible", () => {
  assert.match(funcBody("executive_portfolio_change_control"), /'financial_impact_reference',\s*case when public\.exec_fin_visible\(\) then/i, "المرجع المالي غير مقنّع");
});

test("مراجعة: الدشبورد يحسب الملخّصات set-based inline (لا 5× exec_visible_projects ولا حلقة حوكمة per-project)", () => {
  const b = funcBody("executive_portfolio_dashboard");
  assert.doesNotMatch(b, /public\.executive_portfolio_risks_issues\(|public\.executive_governance_exceptions\(/i, "الدشبورد ما زال يستدعي دوال الملخّص (recompute)");
  assert.match(b, /count\(distinct project_id\)[\s\S]*?severity='critical'/i, "لا حساب set-based لملخّص الحوكمة");
});

test("Parent–Child: المشاريع الفرعية تُحسب منفصلة (لا عدّ مزدوج ضمني)", () => {
  const b = funcBody("executive_portfolio_dashboard");
  assert.match(b, /'subprojects',\s*\(select count\(\*\) from unnest\(v_ids\) x where public\.pc_is_subproject\(x\)\)/i, "لا فصل عدّ المشاريع الفرعية");
});
