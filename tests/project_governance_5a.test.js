// ════════════════════════════════════════════════════════════════════════════
// tests/project_governance_5a.test.js — حراس Phase 5A (الحوكمة والتحكّم بالتغيير).
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const SQL = read("docs/project_governance_batch5a_RUNME.sql");
const TS = read("lib/portal/projectGovernance.ts");
const UI = read("components/portal/projectcore/GovernanceTab.tsx");
const OPS = read("components/portal/projectcore/ProjectOps.tsx");

function funcBody(name) {
  const m = SQL.match(new RegExp("create\\s+or\\s+replace\\s+function\\s+public\\." + name + "\\s*\\([^)]*\\)[\\s\\S]*?\\bas\\s*\\$\\$([\\s\\S]*?)\\$\\$\\s*;", "i"));
  assert.ok(m, `تعذّر إيجاد ${name}`); return m[1];
}

test("SQL 5A بنيوي: جداول/دوال، بلا Temp/DROP fn-tbl، Transaction، self-test، notify", () => {
  for (const tbl of ["project_member_roles", "project_governance_settings", "project_issues", "project_decisions", "project_assumptions", "project_change_requests"])
    assert.match(SQL, new RegExp("create table if not exists public\\." + tbl, "i"), `الجدول ${tbl} مفقود`);
  assert.doesNotMatch(SQL, /create\s+temp(orary)?\s+table/i, "جداول مؤقتة");
  assert.doesNotMatch(SQL, /^\s*(drop function|drop table)/im, "DROP function/table");
  assert.match(SQL, /\bbegin;[\s\S]*\bcommit;/i, "ليس داخل Transaction");
  assert.match(SQL, /do \$selftest\$[\s\S]*raise exception '5A FAIL/i, "لا self-test");
  assert.match(SQL, /notify pgrst/i, "لا notify pgrst");
});

test("لا متغيّر plpgsql غير مُعرّف في دوال 5A", () => {
  const re = /create or replace function public\.([a-z_]+)\s*\([^)]*\)[\s\S]*?\bas\s*\$\$([\s\S]*?)\$\$\s*;/gi;
  let m;
  while ((m = re.exec(SQL))) {
    const name = m[1], body = m[2];
    if (/language sql/i.test(SQL.slice(m.index, m.index + 220))) continue;
    const dm = body.match(/\bdeclare\b([\s\S]*?)\bbegin\b/i);
    const declared = new Set([...(dm ? dm[1] : "").matchAll(/\b(v_[a-z_0-9]+)\b/g)].map((x) => x[1]));
    [...body.matchAll(/\bfor\s+(v_[a-z_0-9]+)\s+in/gi)].forEach((x) => declared.add(x[1]));
    const used = new Set([...body.matchAll(/\b(v_[a-z_0-9]+)\s*:=/g)].map((x) => x[1]));
    [...body.matchAll(/\binto\s+((?:v_[a-z_0-9]+\s*,?\s*)+)/gi)].forEach((g) => [...g[1].matchAll(/v_[a-z_0-9]+/g)].forEach((v) => used.add(v[0])));
    assert.deepEqual([...used].filter((v) => !declared.has(v)), [], `${name} متغيّرات غير مُعرّفة`);
  }
});

test("§1 أدوار المشروع علائقية متعددة، منفصلة عن System roles", () => {
  assert.match(SQL, /create table if not exists public\.project_member_roles[\s\S]*?unique \(project_id, user_id, project_role\)/i, "لا تعدد أدوار / لا unique");
  assert.match(SQL, /project_role in\s*\([\s\S]*?'project_owner'[\s\S]*?'sponsor'[\s\S]*?'observer'/i, "قيم الأدوار ناقصة");
  assert.match(funcBody("pc_project_role_add"), /governance\.manage_roles/i, "إضافة الدور بلا بوابة");
});

test("§3 risk: severity/score مشتقّة عبر trigger + backfill آمن مُتكرِّر (لا يناقض score)", () => {
  assert.match(SQL, /create trigger trg_project_risk_derive before insert or update on public\.project_risks/i, "لا trigger اشتقاق");
  assert.match(funcBody("project_risk_derive"), /new\.risk_score := coalesce\(new\.probability,3\) \* coalesce\(new\.impact,3\)/i, "risk_score غير مشتق");
  assert.match(funcBody("project_risk_derive"), /new\.severity := case when new\.risk_score >= 20 then 'critical'/i, "severity غير مشتقة");
  assert.match(SQL, /update public\.project_risks[\s\S]*?where probability = 3 and impact = 3 and risk_score = 9 and severity in \('critical','high','low'\)/i, "backfill غير آمن/غير idempotent");
});

test("A: توسيع vocabulary لحالة المخاطر ليشمل 'occurred' (pc_risk_to_issue لا يفشل بـ check)", () => {
  // القيد الأساسي (project_risks_status_check) لا يسمح بـ'occurred'؛ يجب أن يوسّعه 5A بـdrop-by-definition ثم إعادة.
  assert.match(SQL, /conrelid = 'public\.project_risks'::regclass and con\.contype = 'c'[\s\S]*?pg_get_constraintdef\(con\.oid\) ~\* '\\ystatus\\y'/i, "لا إسقاط قيد status للمخاطر بالتعريف");
  assert.match(SQL, /add constraint project_risks_status_ck2 check\s*\(status in \([^)]*'occurred'/i, "قيد status الموسّع لا يشمل 'occurred'");
  assert.match(funcBody("pc_risk_to_issue"), /update public\.project_risks set status = 'occurred'/i, "pc_risk_to_issue لا يعلّم المخاطرة occurred");
});

test("B: pc_risk_upsert لا يدهس probability/impact في التعديل الجزئي (لا فساد بيانات)", () => {
  const b = funcBody("pc_risk_upsert");
  // يجب ألّا يظهر الإسناد غير المشروط probability = v_prob في فرع UPDATE.
  assert.doesNotMatch(b, /\bprobability = v_prob, impact = v_imp\b/i, "UPDATE يدهس probability/impact بلا شرط");
  assert.match(b, /probability = case when nullif\(p_data->>'probability',''\) is not null or nullif\(p_data->>'severity',''\) is not null then v_prob else probability end/i, "لا حماية probability عند التعديل الجزئي");
  assert.match(b, /impact\s*= case when nullif\(p_data->>'impact',''\)\s*is not null or nullif\(p_data->>'severity',''\) is not null then v_imp\s*else impact end/i, "لا حماية impact عند التعديل الجزئي");
});

test("C: decision supersede لا يقع إلا للقرار المعتمَد (لا يُبطِل approved بمسوّدة)", () => {
  const b = funcBody("pc_decision_upsert");
  assert.match(b, /if r\.supersedes_decision_id is not null and r\.status = 'approved' then/i, "الإبطال في INSERT بلا شرط approved");
  assert.match(b, /r\.status = 'approved' and coalesce\(v_old\.status,''\) <> 'approved'/i, "الإبطال في UPDATE لا يقع مرّة واحدة عند الاعتماد");
});

test("D: pc_approval_decide يخزّن 'revision_requested' لا 'changes_requested' (يوافق ApprovalsTab القديمة)", () => {
  const b = funcBody("pc_approval_decide");
  assert.match(b, /when 'request_changes' then 'revision_requested' when 'revision_requested' then 'revision_requested'/i, "طلب التعديل لا يُطبَّع إلى revision_requested");
  assert.doesNotMatch(b, /then 'changes_requested'/i, "ما زال يخزّن changes_requested (يكسر تسميات الواجهة القديمة)");
  // الحالة المخزَّنة موجودة في خريطة تسميات الاعتماد القديمة.
  assert.match(read("lib/portal/projectCore.ts"), /APPROVAL_STATUS_LABELS[\s\S]*?revision_requested:/i, "APPROVAL_STATUS_LABELS بلا revision_requested");
});

test("F: gov_can — المفاتيح الحسّاسة لا يمنحها can_edit_project (least-privilege)", () => {
  const b = funcBody("gov_can");
  assert.match(b, /p_key in \('governance\.manage_roles','governance\.manage_settings','changes\.approve','changes\.apply'[\s\S]*?'stage_gates\.override'[\s\S]*?\)\s*then \(public\.can_manage_projects\(\) or public\.emp_has_permission\(p_key\)\)/i, "المفاتيح الحسّاسة تُمنَح عبر can_edit_project");
  assert.match(b, /else \(public\.can_manage_projects\(\) or public\.can_edit_project\(p_project\) or public\.emp_has_permission\(p_key\)\)/i, "المفاتيح التشغيلية فقدت فرع can_edit_project");
});

test("E: عزل العميل عبر is_client_owner (client_visible يصبح قابلًا للوصول لمالك العميل)", () => {
  assert.match(SQL, /create policy pi_read on public\.project_issues[\s\S]*?client_visible and public\.is_client_owner\(project_id\)/i, "issues بلا مسار مالك العميل");
  assert.match(SQL, /create policy pd_read on public\.project_decisions[\s\S]*?client_visible and public\.is_client_owner\(project_id\)/i, "decisions بلا مسار مالك العميل");
  assert.match(SQL, /create policy prisk_client_read on public\.project_risks[\s\S]*?client_visible and public\.is_client_owner\(project_id\)/i, "risks بلا مسار مالك العميل");
});

test("G: risk_matrix ومصفوفة risks بنفس المرشِّح (status not in 'closed') — عدّاد الخلية = عناصر القائمة", () => {
  const b = funcBody("project_governance_dashboard");
  // كلاهما يستثني 'closed' فقط (لا 'accepted' في المصفوفة وحدها).
  assert.doesNotMatch(b, /risk_matrix'[\s\S]*?status not in \('closed','accepted'\)/i, "المصفوفة تستثني accepted بينما القائمة لا");
  const matrixSeg = b.match(/'risk_matrix'[\s\S]*?group by probability, impact/i);
  assert.ok(matrixSeg && /status not in \('closed'\)/i.test(matrixSeg[0]), "مرشِّح المصفوفة لا يطابق القائمة");
});

test("H: اعتماد القرار/التغيير مُسوَّر بمفتاح حسّاس (decisions.approve/changes.approve) لا مجرّد .create", () => {
  const dec = funcBody("pc_decision_upsert");
  // إنشاء قرار «معتمَد» يتطلّب decisions.approve
  assert.match(dec, /coalesce\(nullif\(p_data->>'status',''\),'proposed'\) = 'approved'\s*\n?\s*and not public\.gov_can\(p_project, 'decisions\.approve'\)/i, "إنشاء قرار معتمَد بلا بوابة حسّاسة");
  // الانتقال إلى معتمَد يتطلّب decisions.approve
  assert.match(dec, /coalesce\(nullif\(p_data->>'status',''\), v_old\.status\) = 'approved' and coalesce\(v_old\.status,''\) <> 'approved'\s*\n?\s*and not public\.gov_can\(p_project, 'decisions\.approve'\)/i, "الانتقال إلى معتمَد بلا بوابة حسّاسة");
  // القرار المعتمَد ثابت تمامًا (لا خفض حالته من قِبل محرِّر) — لا مشروط ببقاء الحالة approved.
  assert.match(dec, /if v_old\.status = 'approved' then raise exception 'approved_immutable'/i, "القرار المعتمَد ليس ثابتًا تمامًا (يمكن تحييده بخفض الحالة)");
  const chg = funcBody("pc_change_request_upsert");
  assert.match(chg, /gov_can\(p_project, 'changes\.approve'\)/i, "بتّ طلب التغيير بلا بوابة حسّاسة");
  assert.match(chg, /v_old public\.project_change_requests/i, "لا جلب للحالة السابقة لطلب التغيير (كشف الانتقال)");
  // البوابة تُشترط عند: (أ) طلب معتمَد أصلًا (سلامة ما سيُطبَّق) أو (ب) انتقال فعليّ إلى حالة مبتوتة — echo-safe عبر is distinct from.
  assert.match(chg, /coalesce\(v_old\.status,''\) = 'approved'\s*\n?\s*or \(v_new in \('approved','rejected'\)[\s\S]*?is distinct from coalesce\(v_old\.status,''\)\)/i, "بوابة البتّ لطلب التغيير ليست دقيقة/echo-safe");
  // حالات التنفيذ/الإنهاء تتطلّب changes.apply (لا يقفز محرِّر فوق آلية التطبيق/not_approved).
  assert.match(chg, /v_new in \('implementing','implemented','verified','closed'\)[\s\S]*?not public\.gov_can\(p_project, 'changes\.apply'\)/i, "الانتقال إلى التنفيذ/الإنهاء بلا بوابة changes.apply");
  assert.match(chg, /coalesce\(nullif\(p_data->>'status',''\),'draft'\) in \('implementing','implemented','verified','closed'\)\s*\n?\s*and not public\.gov_can\(p_project, 'changes\.apply'\)/i, "الإنشاء المباشر بحالة تنفيذ بلا بوابة changes.apply");
  // catalog: decisions.approve أصبح حسّاسًا (متوافق مع gov_can)
  assert.match(SQL, /\('decisions\.approve',\s*'governance','sensitive'/i, "decisions.approve ما زال normal في الكتالوج");
  assert.match(SQL, /update public\.permissions set sensitivity = 'sensitive'[\s\S]*?'decisions\.approve','changes\.approve'/i, "لا محاذاة idempotent لحساسية مفاتيح الاعتماد");
});

test("§4/§15 approvals: pc_approval_decide بنفس التوقيع 3-args (لا Overload) + منع self-approval + already_decided", () => {
  assert.match(SQL, /create or replace function public\.pc_approval_decide\(p_approval uuid, p_decision text, p_note text default null\)/i, "توقيع decide تغيّر (Overload)");
  const b = funcBody("pc_approval_decide");
  assert.match(b, /self_approval_not_allowed/i, "لا منع self-approval");
  assert.match(b, /already_decided/i, "لا منع القرار المزدوج");
  assert.match(b, /for update/i, "لا FOR UPDATE (تزامن)");
  assert.match(funcBody("pc_governance_approval_request"), /duplicate_pending/i, "لا منع Duplicate Pending");
});

test("§13 decision المعتمد لا يُعدّل بصمت (approved_immutable) + supersede", () => {
  const b = funcBody("pc_decision_upsert");
  assert.match(b, /approved_immutable/i, "القرار المعتمد قابل للتعديل الصامت");
  assert.match(b, /supersedes_decision_id[\s\S]*?status='superseded'/i, "لا يُبطِل القرار القديم");
});

test("§14 change: impact preview قراءة-فقط (STABLE)؛ apply يتطلّب اعتماد؛ لا يمسّ core_stage/تواريخ المهام", () => {
  assert.match(SQL, /create or replace function public\.project_change_impact_preview\(p_change uuid\)\s*returns jsonb language plpgsql stable/i, "impact preview ليست STABLE (قد تحفظ)");
  const ap = funcBody("project_change_request_apply");
  assert.match(ap, /not_approved/i, "apply لا يتطلّب اعتمادًا");
  assert.doesNotMatch(ap, /update public\.project_tasks|core_stage|update public\.project_core set (?!updated)/i, "apply يمسّ tasks/core_stage");
});

test("§18 RLS + عزل العميل (client_visible على issues/decisions/risks؛ الداخلي staff-only)", () => {
  for (const tbl of ["project_member_roles", "project_governance_settings", "project_issues", "project_decisions", "project_assumptions", "project_change_requests"])
    assert.match(SQL, new RegExp("alter table public\\." + tbl + "\\s+enable row level security", "i"), `${tbl} بلا RLS`);
  assert.match(SQL, /create policy pi_read on public\.project_issues[\s\S]*?pc_can_read_project\(project_id\) or \(client_visible and public\.is_client_owner\(project_id\)\)/i, "issues بلا عزل client_visible");
  assert.match(SQL, /create policy pd_read on public\.project_decisions[\s\S]*?pc_can_read_project\(project_id\) or \(client_visible and public\.is_client_owner\(project_id\)\)/i, "decisions بلا عزل client_visible");
  assert.match(SQL, /create policy pcr_read on public\.project_change_requests[\s\S]*?public\.is_staff\(\)/i, "change requests ليست staff-only");
  assert.match(SQL, /revoke insert, update, delete on public\.project_member_roles[\s\S]*?from authenticated, anon/i, "الكتابة غير محظورة");
});

test("gov_can مرساة is_staff + pc_can_read_project؛ pc_has_project_role داخلية (REVOKE)", () => {
  assert.match(funcBody("gov_can"), /is_staff\(\) and public\.pc_can_read_project\(p_project\)/i, "gov_can غير مرساة");
  assert.match(SQL, /revoke execute on function public\.pc_has_project_role\(uuid,uuid,text\) from public, anon, authenticated/i, "pc_has_project_role ليست داخلية");
});

test("§19 الصلاحيات: ≥25 مفتاح governance", () => {
  const keys = [...SQL.matchAll(/\('(governance|approvals|risks|issues|decisions|assumptions|changes|stage_gates)\.[a-z_]+'/g)];
  assert.ok(keys.length >= 25, `مفاتيح الحوكمة ${keys.length} < 25`);
});

test("§21 لوحة الحوكمة RPC واحد بلا N+1 + مصفوفة المخاطر + health مشتقة", () => {
  const b = funcBody("project_governance_dashboard");
  for (const k of ["settings", "health", "stage_gate", "pending_approvals", "risks", "issues", "decisions", "change_requests", "roles", "risk_matrix"])
    assert.match(b, new RegExp("'" + k + "'"), `الدشبورد ينقصه ${k}`);
  assert.match(funcBody("project_governance_health"), /health_score|reasons|health_status/i, "health بلا score/reasons");
});

test("TS wrappers 5A تطابق أسماء RPC ومعاملاتها", () => {
  assert.match(TS, /prpc<GovernanceDashboard>\("project_governance_dashboard",\s*\{\s*p_project:/);
  assert.match(TS, /prpc<[^>]*>\("pc_approval_decide",\s*\{[^}]*p_approval:[^}]*p_decision:/);
  assert.match(TS, /prpc<[^>]*>\("pc_risk_upsert",\s*\{[^}]*p_data:/);
  assert.match(TS, /prpc<[^>]*>\("project_change_request_apply"/);
});

test("الواجهة مربوطة فعليًا: تبويب «الحوكمة» + RPCs حقيقية + مصفوفة + لا mock", () => {
  assert.match(OPS, /import GovernanceTab/, "ProjectOps لا يستورد GovernanceTab");
  assert.match(OPS, /tab === "governance".*GovernanceTab/s, "لا render لتبويب الحوكمة");
  assert.match(OPS, /k: "governance"/, "تبويب الحوكمة غير مُدرج");
  assert.match(UI, /projectGovernanceDashboard\(/, "المكوّن لا يستدعي الدشبورد");
  assert.match(UI, /pcApprovalDecide\(|pcRiskUpsert\(/, "لا ربط لقرار/مخاطرة");
  assert.match(UI, /RiskMatrix/, "لا مصفوفة مخاطر");
  assert.match(UI, /process\.env\.NODE_ENV !== "production"/, "تسجيل الخطأ الخام غير محصور");
  assert.doesNotMatch(UI, /\bmockData|dummyData|fakeData\b/i, "بيانات وهمية");
});
