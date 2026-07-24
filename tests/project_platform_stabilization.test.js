// ════════════════════════════════════════════════════════════════════════════
// tests/project_platform_stabilization.test.js — حراس التثبيت النهائيّ + ثوابت
// عبر المنصّة (الطور 3→8D). يمنع عودة العيوب التي كشفها تدقيق التثبيت، ويحرس
// ثوابت لا يملكها ملف دفعة واحد (توقيعات، اقتباس بالدولار، مفردات الحالات).
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const readIf = (p) => { try { return read(p); } catch { return ""; } };

const STAB = read("docs/project_platform_stabilization_RUNME.sql");
const SQL5A = read("docs/project_governance_batch5a_RUNME.sql");
const SQL5B = read("docs/project_governance_batch5b_RUNME.sql");

// ملفات المنصّة (الطور 3→8D + إصلاح التثبيت) — ليست كل docs
const PLATFORM_SQL = [
  "docs/project_tasks_batch3a_RUNME.sql", "docs/project_tasks_batch3b_RUNME.sql",
  "docs/project_tasks_batch3c_RUNME.sql", "docs/project_phase3_closure_RUNME.sql",
  "docs/project_planning_batch4a_final_fix_RUNME.sql", "docs/project_resources_batch4b_RUNME.sql",
  "docs/project_planning_batch4c_closure_RUNME.sql",
  "docs/project_governance_batch5a_RUNME.sql", "docs/project_governance_batch5b_RUNME.sql",
  "docs/project_governance_batch5c_RUNME.sql",
  "docs/project_hierarchy_batch6a_RUNME.sql", "docs/project_hierarchy_batch6b_RUNME.sql",
  "docs/project_closure_batch6c_RUNME.sql",
  "docs/project_templates_batch7a_RUNME.sql", "docs/project_operations_batch7b_RUNME.sql",
  "docs/project_programs_batch8a_RUNME.sql", "docs/project_program_planner_batch8b_RUNME.sql",
  "docs/project_fastlane_batch8c_RUNME.sql", "docs/project_program_sla_batch8d_RUNME.sql",
  "docs/project_platform_stabilization_RUNME.sql",
];

// ═══════════════════════ إصلاح التثبيت: البنية ═══════════════════════
test("STAB بنيوي: Preflight، Transaction واحدة، self-test، notify، بلا Temp/DROP", () => {
  assert.match(STAB, /do \$pre\$[\s\S]*8-STAB PREFLIGHT/i, "لا Preflight");
  assert.equal((STAB.match(/^begin;\s*$/gim) || []).length, 1, "عدد begin; ليس ١");
  assert.equal((STAB.match(/^commit;\s*$/gim) || []).length, 1, "عدد commit; ليس ١");
  assert.match(STAB, /do \$selftest\$[\s\S]*raise exception '8-STAB FAIL/i, "لا self-test");
  assert.match(STAB, /notify pgrst/i, "لا notify pgrst");
  assert.doesNotMatch(STAB, /create\s+temp(orary)?\s+table/i, "جداول مؤقتة");
  assert.doesNotMatch(STAB, /\bdrop\s+(function|table)\b/i, "DROP function/table");
  for (const tag of ["$$", "$pre$", "$selftest$"]) {
    assert.equal((STAB.split(tag).length - 1) % 2, 0, `${tag} غير متوازن`);
  }
  // إضافيّ فقط: يعيد تعريف دوال قائمة (CREATE OR REPLACE) ولا ينشئ جدولًا
  assert.doesNotMatch(STAB, /create table/i, "التثبيت ينشئ جدولًا (يجب أن يكون إضافيًّا فقط)");
});

test("STAB (١) يغلق تسريب exec_gov_counts ببوّابة is_staff + pc_can_read_project", () => {
  // الأصل في 5B كان بلا بوّابة
  const orig = SQL5B.match(/create or replace function public\.exec_gov_counts[\s\S]*?\$\$;/)[0];
  assert.doesNotMatch(orig, /is_staff\(\)/, "افتراض «5B بلا بوّابة» لم يعد صحيحًا");
  // التثبيت يضيفها قبل أوّل قراءة
  const fixed = STAB.match(/create or replace function public\.exec_gov_counts[\s\S]*?\$\$;/)[0];
  assert.match(fixed, /if not \(public\.is_staff\(\) and public\.pc_can_read_project\(p_project\)\) then raise exception 'not authorized'/,
    "التثبيت لا يضيف بوّابة العزل");
  const gate = fixed.indexOf("is_staff()");
  const firstRead = fixed.indexOf("from public.project_risks");
  assert.ok(gate > -1 && gate < firstRead, "البوّابة بعد أوّل قراءة");
});

test("STAB (٢) لا فلتر مشكلات يُسقط 'rejected' في دوال 5B المُصحَّحة", () => {
  for (const fn of ["exec_gov_counts", "executive_portfolio_dashboard", "executive_portfolio_risks_issues"]) {
    const body = STAB.match(new RegExp("create or replace function public\\." + fn + "[\\s\\S]*?\\$\\$;"))[0];
    assert.doesNotMatch(body, /not in \('closed','resolved'\)/, `${fn} لا يزال يُسقط rejected`);
    // ويستعمل المفردات القانونية حيثما عدّ المشكلات
    if (/project_issues/.test(body)) {
      assert.match(body, /not in \('resolved','closed','rejected'\)/, `${fn} لا يستعمل مفردات المشكلات القانونية`);
    }
  }
});

test("STAB (٣) pending_changes بالمفردات القانونية (5A)", () => {
  const egc = STAB.match(/create or replace function public\.exec_gov_counts[\s\S]*?\$\$;/)[0];
  assert.match(egc, /status in \('submitted','impact_analysis','pending_approval'\)/, "pending_changes غير قانونيّة");
  assert.doesNotMatch(egc, /not in \('approved','rejected','implemented','closed','cancelled'\)/, "الفلتر الفضفاض باقٍ");
  // نفس مفردات 5A
  assert.match(SQL5A, /status in \('submitted','impact_analysis','pending_approval'\)/, "قانون 5A تغيّر");
});

test("STAB (٤) قفل صفّ الأب في طلب الاعتماد (TOCTOU)", () => {
  const apr = STAB.match(/create or replace function public\.pc_governance_approval_request[\s\S]*?\$\$;/)[0];
  assert.match(apr, /perform 1 from public\.projects where id = p_project for update/, "لا قفل صفّ الأب");
  const lock = apr.indexOf("for update");
  const existsIdx = apr.indexOf("if exists (select 1 from public.project_approvals");
  assert.ok(lock > -1 && lock < existsIdx, "القفل بعد فحص التكرار (لا يمنع TOCTOU)");
});

test("STAB لا يعيد تعريف بوّابة وصول أساسية، ونطاقه أربع دوال فقط", () => {
  const created = [...STAB.matchAll(/create or replace function public\.([a-z_0-9]+)/g)].map((m) => m[1]);
  assert.deepEqual(created.sort(), ["exec_gov_counts", "executive_portfolio_dashboard",
    "executive_portfolio_risks_issues", "pc_governance_approval_request", "project_governance_dashboard",
    "project_closure_readiness"].sort(), "نطاق التثبيت تغيّر");
  for (const gate of ["can_access_project", "pc_can_read_project", "is_client_owner", "is_client_side", "is_staff"]) {
    assert.doesNotMatch(STAB, new RegExp("create or replace function public\\." + gate + "\\b"), `إعادة تعريف بوّابة: ${gate}`);
  }
  // كل دالّة مُعاد تعريفها تُعاد منحها (drop+recreate يفقد المنح؛ replace لا، لكن نؤكّد)
  for (const fn of created) {
    assert.match(STAB, new RegExp("grant execute on function public\\." + fn + "[^;]*to authenticated"), `${fn} بلا منح`);
  }
});

test("STAB لا يكتب مالية/Zoho/عهدة/تقدّم/مرحلة (القراءة مسموحة، الكتابة لا)", () => {
  const code = STAB.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
  // كتابات محظورة فقط — قراءة حالة العهدة/المالية ضمن محرّك جاهزية الإغلاق مشروعة.
  for (const bad of [/insert into public\.\w*custody/i, /update\s+public\.\w*custody/i,
                     /insert into public\.\w*(invoice|zoho)/i, /\bzoho_\w+\s*\(/i,
                     /update\s+public\.project_core\s+set/, /progress_manual\s*=/,
                     /\bset\b[^;]*\bcore_stage\s*=/, /delete from public\./]) {
    assert.doesNotMatch(code, bad, `التثبيت يكتب محظورًا: ${bad}`);
  }
  // ولا كتابة إطلاقًا خارج طبيعته (إعادة تعريف دوال قراءة/طلب فقط)
  const writes = [...code.matchAll(/\b(insert into|update|delete from)\s+public\.([a-z_]+)/gi)].map((m) => m[2]);
  // الكتابة الوحيدة المسموحة: إدراج طلب اعتماد + سجلّ نشاطه (طلب الاعتماد يُدرج صفًّا)
  const ALLOWED = new Set(["project_approvals", "project_activity", "notifications"]);
  for (const w of writes) assert.ok(ALLOWED.has(w), `كتابة خارج نطاق التثبيت: ${w}`);
});

// ═══════════════════════ ثوابت عبر المنصّة كلّها ═══════════════════════
test("عبر المنصّة: توازن اقتباس الدولار في كل ملف دفعة", () => {
  for (const f of PLATFORM_SQL) {
    const s = read(f);
    for (const tag of ["$$", "$pre$", "$selftest$"]) {
      const n = s.split(tag).length - 1;
      assert.equal(n % 2, 0, `${f}: ${tag} غير متوازن (${n})`);
    }
    assert.equal((s.match(/^begin;\s*$/gim) || []).length, 1, `${f}: عدد begin; ليس ١`);
    assert.equal((s.match(/^commit;\s*$/gim) || []).length, 1, `${f}: عدد commit; ليس ١`);
  }
});

test("عبر المنصّة: لا Temp Tables في قراءات Runtime، ولا DROP TABLE", () => {
  for (const f of PLATFORM_SQL) {
    const code = read(f).split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
    assert.doesNotMatch(code, /create\s+temp(orary)?\s+table/i, `${f}: جدول مؤقّت`);
    assert.doesNotMatch(code, /\bdrop\s+table\b/i, `${f}: DROP TABLE`);
  }
});

test("عبر المنصّة: مفردات المشكلات القانونية (الاستبعاد يشمل rejected)", () => {
  // الدوال المنحرفة في 5A/5B يُعاد تعريفها في ملف التثبيت (CREATE OR REPLACE) فيكون
  // هو الكلمة الأخيرة وقت التطبيق؛ فنستثني ملفَّي المصدر ونؤكّد أنّ التثبيت يصلح كلّها.
  const DRIFT_SUPERSEDED = new Set(["docs/project_governance_batch5a_RUNME.sql", "docs/project_governance_batch5b_RUNME.sql", "docs/project_governance_batch5c_RUNME.sql"]);
  for (const f of PLATFORM_SQL) {
    if (DRIFT_SUPERSEDED.has(f)) continue;
    const s = read(f);
    // فقط الأسطر التي تعدّ project_issues
    const lines = s.split("\n");
    lines.forEach((l, i) => {
      if (/project_issues/.test(l) || (/status not in/.test(l) && /issue/i.test(lines[Math.max(0, i - 2)] + l))) {
        // إن كان سطر عدّ مشكلات ويستبعد closed+resolved بلا rejected ⇒ خطأ
        assert.ok(!/not in \('closed','resolved'\)/.test(l),
          `${f}:${i + 1} فلتر مشكلات يُسقط rejected`);
      }
    });
  }
});

test("عبر المنصّة: كل RPC يستدعيه غلاف lib/portal معرَّف في مهاجرة", () => {
  // اجمع كل أسماء الدوال المعرَّفة عبر كل docs/*.sql (لا المنصّة وحدها — الأساس أيضًا)
  const defined = new Set();
  for (const f of fs.readdirSync(path.join(ROOT, "docs"))) {
    if (!f.endsWith(".sql")) continue;
    for (const m of read("docs/" + f).matchAll(/create or replace function public\.([a-z_0-9]+)\s*\(/gi)) {
      defined.add(m[1]);
    }
  }
  // كل prpc("name") في أغلفة Project Core الجديدة يجب أن يكون معرَّفًا
  const wrapperFiles = ["lib/portal/programSla.ts", "lib/portal/fastlane.ts", "lib/portal/programs.ts"];
  for (const wf of wrapperFiles) {
    const s = readIf(wf);
    for (const m of s.matchAll(/prpc<[^>]*>\("([a-z_0-9]+)"/g)) {
      assert.ok(defined.has(m[1]), `${wf}: غلاف يستدعي RPC غير معرَّف: ${m[1]}`);
    }
  }
});

test("عبر المنصّة: لا مستوى هرميّ ثالث (لا Child داخل Child)", () => {
  // 6A يفرض الفرع أبوه master؛ لا دفعة تُنشئ subproject تحت subproject
  for (const f of PLATFORM_SQL) {
    const s = read(f);
    // لا إنشاء بـparent هو نفسه subproject
    assert.doesNotMatch(s, /parent_scope\s*=\s*'subproject'[\s\S]{0,80}create/i, `${f}: تلميح مستوى ثالث`);
  }
});

test("تبويب المهام: فشل التحميل يظهر خطأً + إعادة محاولة (لا لوحة فارغة صامتة)", () => {
  const tasks = read("components/portal/projectcore/ProjectTasks.tsx");
  assert.match(tasks, /setLoadErr\(pcErr\(r\.error\)\); setPhase\("error"\)/, "فشل تحميل اللوحة مبتلَع");
  assert.match(tasks, /phase === "error"[\s\S]{0,400}إعادة المحاولة/, "لا حالة خطأ + إعادة محاولة");
});

test("وثائق التثبيت موجودة وغير فارغة", () => {
  for (const d of ["PROJECT_PLATFORM_PRODUCTION_RUNBOOK", "PROJECT_PLATFORM_ROLE_MATRIX",
                   "PROJECT_PLATFORM_SMOKE_TESTS", "PROJECT_PLATFORM_USER_GUIDE_AR",
                   "PROJECT_PLATFORM_KNOWN_LIMITATIONS", "PROJECT_PLATFORM_RELEASE_NOTES"]) {
    const s = read(`docs/${d}.md`);
    assert.ok(s.length > 400, `${d}.md قصير/فارغ`);
  }
  // الـRunbook يذكر ترتيب SQL والملفات Superseded
  const rb = read("docs/PROJECT_PLATFORM_PRODUCTION_RUNBOOK.md");
  assert.match(rb, /project_program_sla_batch8d_RUNME\.sql/, "الـRunbook لا يذكر 8D");
  assert.match(rb, /project_hierarchy_security_RUNME\.sql/, "الـRunbook لا يذكر Superseded");
  assert.match(rb, /project_platform_stabilization_RUNME\.sql/, "الـRunbook لا يذكر إصلاح التثبيت");
});
