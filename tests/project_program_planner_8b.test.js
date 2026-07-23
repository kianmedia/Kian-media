// ════════════════════════════════════════════════════════════════════════════
// tests/project_program_planner_8b.test.js — حراس Batch 8B (مخطّط الموجة المتدرّجة).
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const SQL = read("docs/project_program_planner_batch8b_RUNME.sql");
const SQL8A = read("docs/project_programs_batch8a_RUNME.sql");
const TS = read("lib/portal/programs.ts");
const UI = read("components/portal/projectcore/ProgramPlanner.tsx");
const TAB = read("components/portal/projectcore/ProgramTab.tsx");

function funcBody(name, src = SQL) {
  const m = src.match(new RegExp("create\\s+or\\s+replace\\s+function\\s+public\\." + name + "\\s*\\([^)]*\\)[\\s\\S]*?\\bas\\s*\\$\\$([\\s\\S]*?)\\$\\$\\s*;", "i"));
  assert.ok(m, `تعذّر إيجاد ${name}`); return m[1];
}
const codeOf = (s) => s.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");

test("SQL 8B بنيوي: Preflight، Transaction، self-test، notify، بلا Temp/DROP", () => {
  assert.match(SQL, /do \$pre\$[\s\S]*8B PREFLIGHT/i, "لا Preflight");
  assert.match(SQL, /\bbegin;[\s\S]*\bcommit;/i, "ليس داخل Transaction");
  assert.match(SQL, /do \$selftest\$[\s\S]*raise exception '8B FAIL/i, "لا self-test");
  assert.match(SQL, /notify pgrst/i, "لا notify pgrst");
  assert.doesNotMatch(SQL, /create\s+temp(orary)?\s+table/i, "جداول مؤقتة");
  assert.doesNotMatch(SQL, /^\s*(drop function|drop table)/im, "DROP function/table");
  // يعتمد على 8A والمسارات الرسمية
  assert.match(SQL, /project_program_settings[\s\S]{0,140}raise exception '8B PREFLIGHT/i, "Preflight لا يتحقّق من 8A");
  assert.match(SQL, /project_core_apply_template_v2[\s\S]{0,160}raise exception '8B PREFLIGHT/i, "Preflight لا يتحقّق من محرّك القوالب");
});

test("لا متغيّر plpgsql غير مُعرّف في دوال 8B", () => {
  const re = /create or replace function public\.([a-z_]+)\s*\([^)]*\)[\s\S]*?\blanguage plpgsql[\s\S]*?\bas\s*\$\$([\s\S]*?)\$\$\s*;/gi;
  let m, checked = 0;
  while ((m = re.exec(SQL))) {
    const name = m[1];
    const body = codeOf(m[2]);
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

test("المعاينة قراءة فقط — لا تكتب شيئًا إطلاقًا", () => {
  assert.match(SQL, /function public\.project_program_plan_preview\([^)]*\)\s*\n?\s*returns jsonb language plpgsql stable/,
    "المعاينة ليست stable");
  const b = codeOf(funcBody("project_program_plan_preview"));
  assert.doesNotMatch(b, /insert into|update\s+public\.|delete from/i, "المعاينة تكتب بيانات");
  // المولّد المشترك أيضًا قراءة فقط ⇒ الأسماء/الأرقام/التواريخ لا تنحرف بين المعاينة والتطبيق
  assert.match(SQL, /function public\.program_plan_build\([^)]*\)\s*\n?\s*returns jsonb language plpgsql stable/, "المولّد ليس stable");
  assert.doesNotMatch(codeOf(funcBody("program_plan_build")), /insert into|update\s+public\.|delete from/i, "المولّد يكتب");
  // التطبيق يستدعي نفس المولّد عبر المعاينة (مصدر واحد)
  assert.match(funcBody("project_program_plan_apply"), /public\.project_program_plan_preview\(p_parent, p_payload\)/,
    "التطبيق لا يعيد التحقّق عبر نفس المعاينة");
});

test("التطبيق ذرّي ويُركّب المسارات الرسمية (لا إنشاء مباشر ولا محرّك قوالب جديد)", () => {
  const b = funcBody("project_program_plan_apply");
  assert.match(b, /public\.project_core_create_project\(/, "لا يُركّب مسار الإنشاء الرسميّ");
  assert.match(b, /public\.project_core_apply_template_v2\(/, "لا يُركّب محرّك القوالب القائم");
  // لا INSERT مباشر في projects (يتجاوز الحرّاس والصلاحيات)
  assert.doesNotMatch(codeOf(b), /insert into public\.projects/i, "إنشاء مباشر يتجاوز المسار الرسميّ");
  // قفل الأب يسلسل التطبيقات المتزامنة
  assert.match(b, /from public\.projects where id = p_parent for update/, "بلا قفل على الأب");
  // فشل أيّ وحدة ⇒ استثناء ⇒ Rollback كامل للمعاملة (لا وحدات جزئية)
  assert.match(b, /if v_created is null then raise exception 'create_failed'/, "فشل الإنشاء لا يُجهض الدفعة");
});

test("Idempotency: نفس المفتاح لا يُنشئ دفعة ثانية", () => {
  assert.match(SQL, /unique \(parent_project_id, idempotency_key\)/, "لا قيد فريد لمفتاح منع التكرار");
  const b = funcBody("project_program_plan_apply");
  assert.match(b, /idempotency_key_required/, "المفتاح غير إلزاميّ");
  assert.match(b, /if v_prev\.id is not null then\s*\n?\s*return jsonb_build_object\('ok', true, 'replayed', true/,
    "إعادة التشغيل بنفس المفتاح تُنشئ من جديد");
  // الفحص يتمّ بعد قفل الأب (وإلّا تسابق تطبيقين بنفس المفتاح)
  assert.ok(b.indexOf("for update") < b.indexOf("idempotency_key = btrim"), "فحص المفتاح قبل القفل (سباق)");
});

test("الموجة المتدرّجة: الترقيم يُكمل بعد آخر رقم ولا يتصادم", () => {
  const b = funcBody("program_plan_build");
  assert.match(b, /select coalesce\(array_agg\(unit_number\), '\{\}'::int\[\]\) into v_taken/, "لا قراءة للأرقام المستخدمة");
  assert.match(b, /else \(select max\(x\) \+ 1 from unnest\(v_taken\) x\) end\)/, "لا استكمال بعد آخر رقم");
  assert.match(b, /'duplicate_number', \(v_num = any\(v_taken\)\)/, "لا كشف للتكرار في المعاينة");
  // التكرار يمنع التطبيق
  const pv = funcBody("project_program_plan_preview");
  assert.match(pv, /duplicate_numbers[\s\S]{0,120}v_can := false/, "الأرقام المكرّرة لا تمنع التطبيق");
});

test("حدود وسلامة: سقف الدفعة، والقالب المؤرشف مرفوض", () => {
  const pv = funcBody("project_program_plan_preview");
  assert.match(pv, /v_count > 100[\s\S]{0,120}count_too_large/, "لا سقف لحجم الدفعة");
  assert.match(pv, /is_active = true[\s\S]{0,140}template_not_found/, "يقبل قالبًا مؤرشفًا");
  assert.match(pv, /v_count <= 0[\s\S]{0,120}count_required/, "يقبل عددًا صفريًّا");
});

test("ممنوعات الجملة: لا اعتماد/إغلاق/أرشفة/حذف/تغيير مرحلة بالجملة", () => {
  const code = codeOf(SQL);
  assert.doesNotMatch(code, /update\s+public\.project_core[\s\S]{0,200}core_stage\s*=/i, "تغيير مرحلة بالجملة");
  assert.doesNotMatch(code, /progress_pct\s*=/i, "كتابة تقدّم");
  assert.doesNotMatch(code, /project_final_close|project_archive_create|closure_approve/i, "إغلاق/أرشفة بالجملة");
  assert.doesNotMatch(code, /update\s+public\.project_approvals|approval_decide/i, "اعتماد بالجملة");
  assert.doesNotMatch(code, /delete from public\.projects/i, "حذف بالجملة");
  assert.doesNotMatch(code, /insert into public\.(invoices|payments|project_expenses)/i, "كتابة مالية");
  assert.doesNotMatch(code, /zoho/i, "مساس بـZoho");
  assert.doesNotMatch(code, /resource_booking_create/i, "حجز موارد آليّ");
});

test("إزاحة التواريخ: نطاق الأب فقط + عزل per-row + سبب إلزاميّ + لا مرحلة/تقدّم", () => {
  const b = funcBody("project_program_units_shift_dates");
  assert.match(b, /c\.parent_project_id = p_parent/, "تكتب على وحدات خارج البرنامج");
  assert.match(b, /public\.pc_can_read_project\(c\.id\)/, "بلا عزل per-row");
  assert.match(b, /p_apply and coalesce\(btrim\(p_reason\),''\) = ''[\s\S]{0,60}reason_required/, "التطبيق بلا سبب");
  assert.doesNotMatch(codeOf(b), /core_stage|progress_pct/, "تمسّ المرحلة أو التقدّم");
  // معاينة ثمّ تطبيق (p_apply)
  assert.match(b, /if p_apply then/, "لا فصل بين المعاينة والتطبيق");
});

test("العزل والصلاحيات: بوابة 8A + master فقط + منح/إبطال", () => {
  ["project_program_plan_preview", "project_program_plan_apply"].forEach((f) => {
    const b = funcBody(f);
    assert.match(b, /program_can\(p_parent, 'programs\.manage_units'\)/, `${f} بلا بوابة`);
    assert.match(b, /pc_is_master\(p_parent\)[\s\S]{0,80}program_requires_master/, `${f} لا يشترط master`);
  });
  const fns = [...SQL.matchAll(/create or replace function public\.([a-z_]+)\s*\(/g)].map((m) => m[1]);
  fns.forEach((f) => {
    assert.match(SQL, new RegExp("revoke execute on function public\\." + f + "\\([^)]*\\) from public, anon"), `${f} بلا revoke`);
    assert.match(SQL, new RegExp("grant execute on function public\\." + f + "\\([^)]*\\) to authenticated"), `${f} بلا grant`);
  });
  // RLS على سجلّ التشغيلات + لا سياسة كتابة مباشرة
  assert.match(SQL, /alter table public\.project_program_plan_runs enable row level security/, "لا RLS");
  assert.match(SQL, /create policy pppr_read on public\.project_program_plan_runs for select/, "لا سياسة قراءة");
  assert.doesNotMatch(SQL, /create policy [a-z_]+ on public\.project_program_plan_runs for (all|insert|update)/, "سياسة كتابة مباشرة");
});

test("لا نظام موازٍ ولا مستوى ثالث: الوحدات فروع مباشرة", () => {
  const b = funcBody("project_program_plan_apply");
  assert.match(b, /'project_scope',\s*'subproject'/, "الوحدات ليست فروعًا مباشرة");
  assert.match(b, /'parent_project_id', p_parent/, "الوحدة لا تُربط بالبرنامج مباشرة");
  ["can_access_project", "pc_can_read_project", "project_core_create_project", "project_core_apply_template_v2",
   "pc_is_master", "project_hierarchy_rollup"].forEach((f) =>
    assert.doesNotMatch(SQL, new RegExp("create or replace function public\\." + f + "\\s*\\("), `8B يعيد تعريف ${f}`));
  // 8A هي مصدر بيانات الوحدة (لا جدول وحدات جديد)
  assert.match(SQL8A, /add column if not exists unit_number/, "بيانات الوحدة ليست في 8A");
  assert.doesNotMatch(SQL, /create table[\s\S]{0,60}project_unit/i, "8B ينشئ جدول وحدات موازيًا");
});

test("أنماط التسمية معلنة ومتطابقة بين SQL والواجهة", () => {
  const b = funcBody("program_plan_build");
  ["{unit_number:02}", "{unit_number}", "{parent_name}", "{prefix}", "{month_name}"].forEach((tok) =>
    assert.ok(b.includes(tok), `النمط ${tok} غير مدعوم في SQL`));
  // الواجهة لا تعرض نمطًا لا يفهمه المولّد
  const uiPatterns = [...TS.matchAll(/pattern: "([^"]+)"/g)].map((m) => m[1]);
  assert.ok(uiPatterns.length >= 4, "أنماط الواجهة قليلة");
  uiPatterns.forEach((p) => {
    [...p.matchAll(/\{[a-z_0-9:]+\}/g)].map((m) => m[0]).forEach((tok) =>
      assert.ok(b.includes(tok), `الواجهة تعرض نمطًا (${tok}) لا يفهمه المولّد`));
  });
  // {unit_number:02} يجب أن يُستبدل قبل {unit_number} وإلّا بقيت ":02}" نصًّا
  assert.ok(b.indexOf("'{unit_number:02}'") < b.indexOf("'{unit_number}'"), "ترتيب استبدال الأنماط يترك بقايا");
});

test("الواجهة: معالج خطوتين، معاينة قبل تطبيق، مفتاح ثابت، منع إرسال مزدوج", () => {
  assert.match(UI, /const p = payload\(\);\s*\n\s*const r = await programPlanPreview\(projectId, p\)/, "لا معاينة");
  assert.match(UI, /programPlanApply\(projectId, previewedRef\.current \?\? payload\(\), idemRef\.current\)/, "لا تطبيق بمفتاح ثابت");
  assert.match(UI, /const idemRef = useRef<string>\(/, "المفتاح يتغيّر بين المحاولات (تكرار الإنشاء)");
  assert.match(UI, /if \(busy \|\| !preview\?\.can_apply\) return;/, "تطبيق بلا معاينة صالحة");
  assert.match(UI, /disabled=\{busy \|\| !preview\?\.can_apply\}/, "زرّ التطبيق بلا حارس");
  assert.match(UI, /my !== seq\.current/, "لا تسلسل للطلبات");
  assert.match(UI, /mounted\.current/, "لا حارس Unmount");
  assert.match(UI, /already_applied/, "لا تنبيه لإعادة التطبيق");
  assert.doesNotMatch(UI, /\bmockData|dummyData|fakeData\b/i, "بيانات وهمية");
  assert.match(UI, /role="alert"/, "الأخطاء بلا دور ARIA");
  assert.match(UI, /onMouseDown=\{\(e\) => \{ if \(e\.target === e\.currentTarget && !busy\) onClose\(\); \}\}/, "سحب التحديد يغلق المعالج");
});

test("الواجهة مربوطة بتبويب البرنامج (لا RPC بلا مستهلك)", () => {
  assert.match(TAB, /import ProgramPlanner/, "التبويب لا يستورد المعالج");
  assert.match(TAB, /setShowPlanner\(true\)/, "لا زرّ لإنشاء دفعة");
  assert.match(TAB, /showPlanner && \(\s*\n?\s*<ProgramPlanner/, "المعالج غير مُصيَّر");
  ["programPlanPreview", "programPlanApply"].forEach((f) =>
    assert.match(TS, new RegExp("export const " + f), `غلاف ${f} مفقود`));
  assert.match(TS, /export function planErr/, "لا مُترجم أخطاء للمخطّط");
});

test("سيناريوهات المستخدم مدعومة بنيويًّا (مسبار/سوالف أسرية/عقد شهري)", () => {
  const b = funcBody("program_plan_build");
  // مراحل متسلسلة بمدّة وفجوة (مسبار)
  assert.match(b, /v_i \* \(coalesce\(v_dur,0\) \+ v_gap\)/, "لا تسلسل بالمدّة والفجوة");
  // حلقات بتواتر أسبوعي/نصف شهري (سوالف أسرية)
  assert.match(b, /when 'weekly'   then v_i \* 7 \* v_interval/, "لا تواتر أسبوعي");
  // أشهر (عقد شهري) — بالشهور لا بالأيام
  assert.match(b, /v_cadence = 'monthly' then v_s := \(v_first \+ \(v_i \* v_interval\) \* interval '1 month'\)::date/,
    "التواتر الشهري محسوب بالأيام (ينحرف عبر الأشهر)");
  // الموسم والدفعة يمرّان إلى الوحدات
  assert.match(b, /'season_number', v_season, 'batch_number', v_batch/, "الموسم/الدفعة لا يمرّان");
});

test("المعاينة تُلزم التطبيق: تعديل الحقول بعدها يُبطلها، والتطبيق يرسل حمولة المعاينة", () => {
  // بدون هذا: «عاينتُ ٥ وحدات» ثم تغيير العدد إلى ٥٠ والضغط على تطبيق ⇒ تُنشأ ٥٠
  assert.match(UI, /const previewedRef = useRef<PlanPayload \| null>\(null\)/, "لا حفظ للحمولة المعاينة");
  assert.match(UI, /previewedRef\.current = p; setPreview\(r\.data\)/, "الحمولة المعاينة لا تُحفظ");
  assert.match(UI, /programPlanApply\(projectId, previewedRef\.current \?\? payload\(\), idemRef\.current\)/,
    "التطبيق يرسل حالة النموذج الحالية لا المعاينة");
  assert.match(UI, /previewedRef\.current = null; setPreview\(null\); setStep\(1\);\s*\n\s*\}, \[f\]\)/,
    "تعديل الحقول لا يُبطل المعاينة");
});

// ════════════════════════════════════════════════════════════════════════════
// حراس مراجعة 8B العدائية — كل إصلاح مثبّت باختبار.
// ════════════════════════════════════════════════════════════════════════════
test("حرجة: مولّد الخطة SECURITY DEFINER ⇒ بوابة إلزامية (لا تسريب أسماء/إعدادات)", () => {
  const b = funcBody("program_plan_build");
  assert.match(b, /if not public\.program_can\(p_parent, 'programs\.manage_units'\) then raise exception 'not authorized'/,
    "المولّد بلا تصريح رغم أنّه DEFINER وممنوح لكل مستخدم مسجَّل");
  // البوابة أوّل شيء قبل أيّ قراءة
  assert.ok(b.indexOf("not authorized") < b.indexOf("from public.project_program_settings"), "القراءة تسبق البوابة");
});

test("الترقيم: lpad لا يقطع الأرقام ≥100، و{prefix} الفارغ لا ينتج «-01»", () => {
  const b = funcBody("program_plan_build");
  assert.doesNotMatch(b, /lpad\(v_num::text, 2, '0'\)/, "lpad بطول ثابت يقطع 100 إلى 10");
  assert.match(b, /lpad\(v_num::text, greatest\(2, length\(v_num::text\)\), '0'\)/, "لا حماية من قطع الأرقام الطويلة");
  assert.match(b, /replace\(replace\(v_name, '\{prefix\}-', ''\), '\{prefix\}', ''\)/, "بادئة فارغة تنتج اسمًا مثل «-01»");
});

test("المعاينة تنمذج بوّابات مسار الإنشاء (can_apply ليس وعدًا كاذبًا)", () => {
  const pv = funcBody("project_program_plan_preview");
  assert.match(pv, /can_manage_projects\(\), false\)[\s\S]{0,140}requires_manage_projects[\s\S]{0,60}v_can := false/,
    "المعاينة لا تتحقّق من can_manage_projects رغم اشتراط مسار الإنشاء لها");
  assert.match(pv, /project_hierarchy_enabled\(\), false\)[\s\S]{0,140}hierarchy_disabled[\s\S]{0,60}v_can := false/,
    "المعاينة لا تتحقّق من تفعيل الهرمية");
});

test("لا تعيين مرحلة بالجملة: الإنشاء مقصور على مراحل البداية", () => {
  const b = funcBody("project_program_plan_apply");
  assert.match(b, /in \('lead_approved','project_created','planning','ready'\)/, "core_stage يمرّ كما هو (delivered/closed بالجملة)");
  assert.match(b, /else 'planning' end/, "لا سقوط آمن للمرحلة");
});

test("إزاحة التواريخ تحتاج حقّ التحرير لا القراءة", () => {
  const b = funcBody("project_program_units_shift_dates");
  const n = (b.match(/can_edit_project\(c\.id\)/g) || []).length;
  assert.ok(n >= 2, `حقّ التحرير غير مشترط في المعاينة والتطبيق معًا (${n})`);
  assert.match(b, /coalesce\(public\.can_manage_projects\(\),false\) or coalesce\(public\.can_edit_project\(c\.id\),false\)/,
    "الكتابة بحقّ القراءة فقط");
});

test("الواجهة: مفتاح منع التكرار يصل المعاينة، وإعادة التشغيل لا تُبلَّغ كإنشاء", () => {
  assert.match(UI, /idempotency_key: idemRef\.current/, "المفتاح لا يصل المعاينة ⇒ already_applied ميت");
  assert.match(TS, /idempotency_key\?: string;/, "النوع لا يحمل المفتاح");
  assert.match(UI, /onCreated\(r\.data\.replayed \? 0 : r\.data\.created_count\)/, "إعادة التشغيل تُبلَّغ كإنشاء ناجح");
});

test("الواجهة: إبطال المعاينة يُلغي الطلب الجاري، ولا إغلاق أثناء التطبيق", () => {
  assert.match(UI, /seq\.current \+= 1;\s*\n?\s*\/\/[^\n]*\n?\s*previewedRef\.current = null/, "ردّ معاينة متأخّر يعيد الخطوة ٢");
  assert.match(UI, /if \(e\.target === e\.currentTarget && !busy\) onClose\(\)/, "الخلفية تُغلق أثناء تطبيق جارٍ");
  assert.match(UI, /<button onClick=\{onClose\} disabled=\{busy\}/, "زرّ الإلغاء فعّال أثناء التطبيق");
});

test("الواجهة: التواتر لا يدوس إعداد البرنامج، والعدد مقصور، والصفّ يلتفّ", () => {
  assert.match(UI, /cadence: f\.cadence \|\| undefined/, "التواتر يُرسل دائمًا فيدوس إعداد البرنامج");
  assert.match(UI, /من إعداد البرنامج/, "لا خيار «من إعداد البرنامج»");
  assert.match(UI, /Math\.min\(Math\.max\(Number\(f\.count\) \|\| 0, 0\), 100\)/, "العدد بلا سقف في الواجهة");
  assert.match(UI, /flex items-center gap-2 flex-wrap text-\[11px\] border-b/, "صفّ المعاينة لا يلتفّ على الجوال");
});
