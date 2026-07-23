// ════════════════════════════════════════════════════════════════════════════
// tests/project_templates_7a.test.js — حراس Batch 7A (القوالب والإعداد السريع).
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const SQL = read("docs/project_templates_batch7a_RUNME.sql");
const CORE = read("docs/project_core_FINAL_RUNME.sql");
const ABS = read("docs/project_core_ABSOLUTE_FINAL_RUNME.sql");
const TS = read("lib/portal/projectTemplates.ts");
const UI = read("components/portal/projectcore/TemplateLibrary.tsx");
const OPS = read("components/portal/projectcore/ProjectOps.tsx");
const DASH = read("components/portal/projectcore/ProjectCoreDashboard.tsx");
const P0 = read("docs/phase0_migration.sql");
const TPLUI = read("components/portal/projectcore/ProjectTemplates.tsx");

function funcBody(name, src = SQL) {
  const m = src.match(new RegExp("create\\s+or\\s+replace\\s+function\\s+public\\." + name + "\\s*\\([^)]*\\)[\\s\\S]*?\\bas\\s*\\$\\$([\\s\\S]*?)\\$\\$\\s*;", "i"));
  assert.ok(m, `تعذّر إيجاد ${name}`); return m[1];
}

test("SQL 7A بنيوي: Preflight، Transaction، self-test، notify، بلا Temp/DROP", () => {
  assert.match(SQL, /do \$pre\$[\s\S]*7A PREFLIGHT/i, "لا Preflight");
  assert.match(SQL, /\bbegin;[\s\S]*\bcommit;/i, "ليس داخل Transaction");
  assert.match(SQL, /do \$selftest\$[\s\S]*raise exception '7A FAIL/i, "لا self-test");
  assert.match(SQL, /notify pgrst/i, "لا notify pgrst");
  assert.doesNotMatch(SQL, /create\s+temp(orary)?\s+table/i, "جداول مؤقتة");
  assert.doesNotMatch(SQL, /^\s*(drop function|drop table)/im, "DROP function/table");
  // Preflight يتوقّف إن كان محرّك التطبيق القائم مفقودًا (لا يبني بديلًا)
  assert.match(SQL, /project_core_apply_template_v2[\s\S]{0,200}raise exception '7A PREFLIGHT/i, "Preflight لا يتحقّق من محرّك التطبيق");
});

test("لا متغيّر plpgsql غير مُعرّف في دوال 7A", () => {
  const re = /create or replace function public\.([a-z_]+)\s*\([^)]*\)[\s\S]*?\bas\s*\$\$([\s\S]*?)\$\$\s*;/gi;
  let m, checked = 0;
  while ((m = re.exec(SQL))) {
    // التعليقات ليست شيفرة: ذكر اسم متغيّر داخل شرح لا يعني استخدامه.
    const name = m[1], body = m[2].split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
    const dm = body.match(/\bdeclare\b([\s\S]*?)\bbegin\b/i);
    const declared = new Set([...(dm ? dm[1] : "").matchAll(/\b(v_[a-z_0-9]+)\b/g)].map((x) => x[1]));
    [...body.matchAll(/\bfor(?:each)?\s+(v_[a-z_0-9]+)\s+in/gi)].forEach((x) => declared.add(x[1]));
    const used = new Set([...body.matchAll(/\b(v_[a-z_0-9]+)\b/g)].map((x) => x[1]));
    const missing = [...used].filter((u) => !declared.has(u));
    assert.deepEqual(missing, [], `${name}: متغيّرات غير معرّفة ${missing.join(",")}`);
    checked++;
  }
  assert.ok(checked >= 6, `عدد الدوال المفحوصة ${checked} أقل من المتوقّع`);
});

test("7A لا تبني نظامًا موازيًا: تُركّب جدول ومحرّك القوالب القائمين", () => {
  // الجدول موجود في Project Core ⇒ 7A تُضيف أعمدة فقط، لا تُنشئه من جديد
  assert.match(CORE, /create table if not exists public\.project_templates/, "project_templates ليس في Project Core");
  assert.doesNotMatch(SQL, /create table if not exists public\.project_templates\s*\(/, "7A يُعيد إنشاء جدول القوالب");
  assert.match(SQL, /alter table public\.project_templates add column if not exists/, "7A لا يوسّع الجدول القائم");
  // محرّك التطبيق موجود ⇒ 7A لا تكتب محرّكًا ثانيًا
  assert.match(ABS, /create or replace function public\.project_core_apply_template_v2/, "المحرّك ليس في ABSOLUTE_FINAL");
  assert.doesNotMatch(SQL, /create or replace function public\.project_core_apply_template/, "7A يكرّر محرّك التطبيق");
  // ولا تعيد تعريف الإنشاء
  assert.doesNotMatch(SQL, /create or replace function public\.project_core_create_project/, "7A يعيد تعريف إنشاء المشروع");
});

test("الإنشاء من قالب: ذرّي، يُركّب الدالتين، ويتحقّق من القالب قبل الإنشاء", () => {
  const b = funcBody("project_create_from_template");
  assert.match(b, /public\.project_core_create_project\(p_data\)/, "لا يستدعي دالة الإنشاء الرسمية");
  assert.match(b, /public\.project_core_apply_template_v2\(v_project, v_tpl, v_modules, v_start\)/, "لا يستدعي محرّك التطبيق");
  // التحقّق من القالب قبل إنشاء المشروع ⇒ لا مشروع يتيم عند قالب خاطئ
  // نقارن بموضع الاستدعاء الفعليّ لا بذكر الاسم في تعليق
  assert.ok(b.indexOf("template_not_found") < b.indexOf("public.project_core_create_project(p_data)"),
    "التحقّق من القالب بعد الإنشاء");
  assert.match(b, /is_active = true/, "يقبل قالبًا مؤرشفًا");
  // البوابة صارت can_manage_projects صراحةً: الصلاحية الدقيقة كانت وعدًا لا يتحقّق
  assert.match(b, /if not public\.can_manage_projects\(\) then raise exception 'not authorized'/, "بلا بوابة صلاحية");
  // projects.template_id عمود اختياري ⇒ محاط بحارس
  assert.match(b, /exception when undefined_column then null/, "تحديث template_id بلا حارس عمود");
  assert.match(b, /'template_draft_version', v_tpl_ver/, "لا يسجّل رقم مسودّة القالب المطبَّق");
});

test("حفظ كقالب: تواريخ نسبية فقط ولا ينسخ ما هو ممنوع", () => {
  const b = funcBody("project_save_as_template");
  assert.match(b, /pc_can_read_project\(p_project\)/, "بلا بوابة قراءة المشروع");
  assert.match(b, /tpl_can\('templates\.manage'\)/, "بلا بوابة صلاحية القوالب");
  // ممنوع نسخها: عميل/ميزانية/ملفات/تعليقات/اعتمادات/مسنَدون/حالات
  ["client_id", "budget", "project_files", "internal_comments", "project_approvals", "assigned_to", "assignee"].forEach((k) =>
    assert.doesNotMatch(b, new RegExp("\\b" + k + "\\b"), `القالب ينسخ ${k}`));
  // التواريخ نسبية فقط
  assert.match(b, /'offset_days'[\s\S]{0,200}- v_start/, "لا يحوّل التواريخ إلى offset");
  assert.doesNotMatch(b, /'due_date', t\.due_date/, "ينسخ تاريخًا مطلقًا");
  // كل مصدر معزول (جدول غائب لا يُسقط الحفظ)
  const excepts = (b.match(/exception when undefined_table or undefined_column/g) || []).length;
  assert.ok(excepts >= 4, `كتل العزل قليلة (${excepts})`);
  assert.match(b, /name_required/, "اسم القالب غير إلزامي");
});

test("الإصدارات: غير مُتلِفة، مقفولة ضدّ التسابق، والاستعادة تُكتب كإصدار جديد", () => {
  const pub = funcBody("project_template_publish_version");
  assert.match(pub, /for update/, "النشر بلا قفل (تسابق ⇒ 23505 على unique)");
  assert.match(pub, /on conflict \(template_id, version\) do update/, "النشر غير Idempotent");
  const res = funcBody("project_template_restore_version");
  assert.match(res, /for update/, "الاستعادة بلا قفل");
  assert.match(res, /insert into public\.project_template_versions[\s\S]{0,400}قبل الاستعادة/, "الاستعادة لا تحفظ الحالي أولًا");
  assert.match(res, /version = v_cur \+ 1/, "الاستعادة لا تُنشئ إصدارًا جديدًا");
  assert.doesNotMatch(res, /delete from public\.project_template_versions/, "الاستعادة تحذف تاريخًا");
  // جدول الإصدارات محميّ: قراءة للموظّفين وكتابة عبر RPC فقط
  assert.match(SQL, /alter table public\.project_template_versions enable row level security/, "الإصدارات بلا RLS");
  assert.match(SQL, /create policy ptv_read on public\.project_template_versions for select/, "لا سياسة قراءة");
  assert.doesNotMatch(SQL, /create policy [a-z_]+ on public\.project_template_versions for (all|insert|update)/, "سياسة كتابة مباشرة على الإصدارات");
  assert.match(SQL, /grant select on public\.project_template_versions to authenticated/, "لا منح قراءة");
});

test("البذور: Idempotent بمفتاح مستقرّ ولا تكتب فوق تعديلات المستخدم", () => {
  assert.match(SQL, /on conflict \(template_key\) where template_key is not null do nothing/,
    "البذور تكتب فوق تعديلات المستخدم (do update) أو بلا شرط الفهرس الجزئي");
  assert.match(SQL, /create unique index if not exists ux_project_templates_key/, "لا فهرس فريد على template_key");
  const seeds = (SQL.match(/\('seed_[a-z_]+',/g) || []).length;
  assert.ok(seeds >= 4, `بذور قليلة (${seeds})`);
  // البذور تستخدم أنواع مخرجات يفهمها محرّك التطبيق القائم
  const types = [...SQL.matchAll(/'type','([a-z_]+)'/g)].map((m) => m[1]);
  // CHECK الحقيقي على deliverables.type = ('video','photo','other') — راجع docs/phase0_migration.sql:219
  types.forEach((x) => assert.ok(["video", "photo", "other"].includes(x), `نوع مخرَج يخالف CHECK: ${x}`));
  // وشدّات مخاطر ضمن CHECK القائم
  const sev = [...SQL.matchAll(/'severity','([a-z]+)'/g)].map((m) => m[1]);
  sev.forEach((x) => assert.ok(["low", "medium", "high", "critical"].includes(x), `شدّة مخاطرة غير صالحة: ${x}`));
  // وأولويات ضمن CHECK القائم
  const pri = [...SQL.matchAll(/'priority','([a-z]+)'/g)].map((m) => m[1]);
  pri.forEach((x) => assert.ok(["low", "normal", "high", "urgent"].includes(x), `أولوية غير صالحة: ${x}`));
});

test("البوابة: tpl_can تسقط بأمان إلى البوابة الخشنة ولا تفتح صلاحية لغير الموظّف", () => {
  const b = funcBody("tpl_can");
  assert.match(b, /if not public\.is_staff\(\) then return false/, "غير الموظّف قد يمرّ");
  assert.match(b, /can_manage_projects/, "لا يسقط إلى البوابة الخشنة القائمة");
  assert.match(b, /exception when undefined_function or undefined_table then v := false/, "غياب كتالوج الصلاحيات يُسقط الدالة");
  assert.match(b, /coalesce\(v, false\)/, "NULL قد يمرّ كصلاحية (منطق ثلاثي القيم)");
});

test("المنح والإبطال لكل دوال 7A", () => {
  const fns = [...SQL.matchAll(/create or replace function public\.([a-z_]+)\s*\(/g)].map((m) => m[1]);
  assert.ok(fns.length >= 6, "عدد الدوال أقل من المتوقّع");
  fns.forEach((f) => {
    assert.match(SQL, new RegExp("revoke execute on function public\\." + f + "\\([^)]*\\) from public, anon"), `${f} بلا revoke`);
    assert.match(SQL, new RegExp("grant execute on function public\\." + f + "\\([^)]*\\) to authenticated"), `${f} بلا grant`);
  });
});

test("أغلفة TS + رسائل الخطأ العربية", () => {
  ["project_templates_library", "project_create_from_template", "project_save_as_template",
   "project_template_versions_list", "project_template_publish_version", "project_template_restore_version"].forEach((f) =>
    assert.match(TS, new RegExp(f), `غلاف ${f} مفقود`));
  assert.match(TS, /export function tplErr/, "لا مُترجم أخطاء");
  ["template_not_found", "version_not_found", "already_applied", "not authorized"].forEach((k) =>
    assert.match(TS, new RegExp(k), `رسالة ${k} مفقودة`));
});

test("الواجهة: الإعداد السريع مربوط، بلا بيانات وهمية، ومع منع الإرسال المزدوج", () => {
  assert.match(UI, /projectCreateFromTemplate\(/, "لا نداء للإنشاء من قالب");
  assert.match(UI, /projectTemplatesLibrary\(/, "لا نداء للمكتبة");
  assert.match(UI, /projectTemplateVersionsList\(/, "لا نداء للإصدارات");
  assert.match(UI, /projectTemplatePublishVersion\(/, "لا نشر إصدار");
  assert.match(UI, /projectTemplateRestoreVersion\(/, "لا استعادة إصدار");
  assert.match(UI, /if \(busy\) return;/, "لا حارس ضدّ الإرسال المزدوج");
  assert.match(UI, /disabled=\{busy\}/, "أزرار بلا disabled");
  assert.doesNotMatch(UI, /\bmockData|dummyData|fakeData\b/i, "بيانات وهمية");
  assert.match(UI, /process\.env\.NODE_ENV !== "production"/, "تسجيل الخطأ الخام غير محصور");
  assert.match(UI, /tpl_timeout/, "لا مهلة");
  assert.match(UI, /my !== seq\.current/, "لا تسلسل للطلبات");
  assert.match(UI, /mounted\.current/, "لا حارس Unmount");
  // أزرار النشر/الاستعادة تظهر لمن يملك الإدارة فقط (can_manage من الخادم)
  assert.match(UI, /canManage && \(/, "أزرار الإدارة بلا حارس صلاحية");
});

test("الواجهة: حفظ كقالب على الخادم + مكتبة القوالب مربوطة بالدشبورد", () => {
  assert.match(OPS, /projectSaveAsTemplate\(projectId/, "لا ربط لحفظ كقالب على الخادم");
  assert.match(OPS, /if \(!name \|\| !name\.trim\(\)\) return;/, "اسم القالب غير إلزامي في الواجهة");
  assert.match(DASH, /import TemplateLibrary/, "الدشبورد لا يستورد المكتبة");
  assert.match(DASH, /setShowTplLib\(true\)/, "لا زرّ للإعداد السريع");
  assert.match(DASH, /showTplLib && <TemplateLibrary/, "المكتبة غير مُصيَّرة");
});

test("7A لا يمسّ core_stage ولا المالية ولا Zoho", () => {
  const code = SQL.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
  assert.doesNotMatch(code, /update\s+public\.project_core\s+set[\s\S]{0,160}core_stage/i, "يكتب على core_stage");
  assert.doesNotMatch(code, /insert into public\.(invoices|payments|project_expenses)/i, "يكتب بيانات مالية");
  assert.doesNotMatch(code, /zoho/i, "يمسّ Zoho");
  // الكتابة الوحيدة على projects هي template_id (عمود وسم، لا حالة)
  const upd = [...code.matchAll(/update\s+public\.projects\s+set\s+([a-z_]+)/gi)].map((m) => m[1]);
  upd.forEach((c) => assert.equal(c, "template_id", `7A يكتب على projects.${c}`));
});

test("الوحدات: مصفوفة فارغة تُرفض صراحةً (وإلّا طُبِّق كل شيء)", () => {
  const b = funcBody("project_create_from_template");
  // محرّك التطبيق يعتبر NULL = كل الوحدات، وarray_agg على مصفوفة فارغة تُعيد NULL
  assert.match(ABS, /p_modules is null or 'tasks' = any\(p_modules\)/, "افتراض NULL=الكل تغيّر في المحرّك");
  assert.match(b, /jsonb_array_length\(p_data->'modules'\) = 0 then raise exception 'no_modules'/,
    "اختيار صفر وحدات يُطبّق كل الوحدات صامتًا");
  assert.match(UI, /mods\.length === 0.*setErr/s, "الواجهة تسمح بإرسال صفر وحدات");
  assert.match(TS, /no_modules/, "لا رسالة عربية لـno_modules");
});

test("نصّ تاريخ البداية صادق (المحرّك يسقط إلى start_date ثم اليوم)", () => {
  assert.match(ABS, /v_base := coalesce\(p_start, \(select start_date from public\.project_core[\s\S]{0,80}current_date\)/,
    "سلوك تاريخ الأساس في المحرّك تغيّر");
  assert.doesNotMatch(UI, /بدونه تُنشأ العناصر بلا تواريخ/, "نصّ مضلِّل: العناصر لا تُنشأ بلا تواريخ");
  assert.match(UI, /تاريخ بداية المشروع، وإلّا تاريخ اليوم/, "لا شرح صادق لتاريخ الأساس");
});

test("الإزاحات السالبة مقبولة في المحرّك (مهمة تبدأ قبل بداية المشروع)", () => {
  // المستخرِج قد يكتب offset سالبًا؛ لو رفضه المحرّك لسقط التاريخ صامتًا
  const negs = (ABS.match(/'\^-\?\[0-9\]\+\$'/g) || []).length;
  assert.ok(negs >= 5, `أنماط الإزاحة لا تقبل السالب في كل الكيانات (${negs})`);
});

test("أمانة الالتقاط: القالب يلتقط كل ما يقرأه محرّك التطبيق فعلًا", () => {
  const b = funcBody("project_save_as_template");
  // المحرّك يقرأ هذه المفاتيح؛ إغفالها ينتج قالبًا أفقر من المشروع (عيب الالتقاط في المتصفّح)
  assert.match(ABS, /elem->'checklist'/, "المحرّك لم يعد يقرأ checklist");
  assert.match(ABS, /elem->>'depends_on'/, "المحرّك لم يعد يقرأ depends_on");
  assert.match(ABS, /elem->>'likelihood'/, "المحرّك لم يعد يقرأ likelihood");
  assert.match(b, /'checklist',[\s\S]{0,220}project_task_checklists/, "القالب يفقد قوائم التحقّق");
  assert.match(b, /'depends_on',[\s\S]{0,220}task_dependencies/, "القالب يفقد اعتماديات المهام");
  assert.match(b, /'likelihood', r\.likelihood/, "القالب يفقد احتمالية المخاطرة");
  assert.match(b, /'subtasks',[\s\S]{0,200}'priority', s\.priority/, "المهام الفرعية بلا أولوية رغم أنّ المحرّك يقرأها");
  // depends_on يجب أن يكون فهرسًا لمهمة **أسبق** (شرط المحرّك v_dep < v_idx)
  assert.match(b, /row_number\(\) over \(order by t\.sort_order[\s\S]{0,80}- 1\)::int as idx/, "لا ترقيم فهرسيّ للمهام");
  assert.match(b, /where d\.task_id = r\.id and p\.idx < r\.idx/, "depends_on قد يشير إلى مهمة لاحقة فيُتجاهل");
  assert.match(ABS, /v_dep < v_idx and v_dep >= 0/, "شرط الفهرس في المحرّك تغيّر");
});

// ════════════════════════════════════════════════════════════════════════════
// حراس مراجعة 7A العدائية — كلّ إصلاح مثبّت باختبار.
// ════════════════════════════════════════════════════════════════════════════
test("حرج: أنواع المخرجات في البذور تطابق CHECK الحقيقي (لا 23514 عند التطبيق)", () => {
  const chk = P0.match(/type\s+text not null default 'video' check \(type in \(([^)]*)\)\)/);
  assert.ok(chk, "تعذّر إيجاد CHECK على deliverables.type");
  const allowed = chk[1].split(",").map((x) => x.trim().replace(/'/g, ""));
  assert.deepEqual(allowed, ["video", "photo", "other"], "قائمة CHECK تغيّرت — أعد مواءمة البذور");
  [...SQL.matchAll(/'type','([a-z_]+)'/g)].map((m) => m[1]).forEach((x) =>
    assert.ok(allowed.includes(x), `بذرة تستخدم نوع مخرَج '${x}' يخالف CHECK ⇒ التطبيق يُجهض بـ23514`));
});

test("حرج: ON CONFLICT يستنتج الفهرس الجزئي (لا 42P10 يُجهض الترحيل)", () => {
  // الفهرس جزئي (where template_key is not null) ⇒ لا بدّ من تكرار الشرط في ON CONFLICT
  assert.match(SQL, /create unique index if not exists ux_project_templates_key[\s\S]{0,160}where template_key is not null/,
    "الفهرس لم يعد جزئيًّا — راجع ON CONFLICT");
  assert.match(SQL, /on conflict \(template_key\) where template_key is not null do nothing/,
    "ON CONFLICT بلا شرط الفهرس الجزئي ⇒ 42P10");
  assert.doesNotMatch(SQL, /on conflict \(template_key\) do nothing/, "بقي ON CONFLICT بلا شرط");
});

test("الصلاحيات: فئة موجودة فعلًا + لا صلاحية ميتة", () => {
  const cats = read("lib/portal/professions.ts");
  const keys = [...cats.matchAll(/\{ key: "([a-z_]+)", ar:/g)].map((m) => m[1]);
  [...SQL.matchAll(/\('templates\.[a-z_]+','([a-z_]+)'/g)].map((m) => m[1]).forEach((c) =>
    assert.ok(keys.includes(c), `فئة الصلاحية '${c}' غير موجودة في PERMISSION_CATEGORIES ⇒ تختفي من المحرّرات`));
  // templates.create_project كانت وعدًا لا يتحقّق (create_project يشترط can_manage_projects)
  assert.doesNotMatch(SQL, /'templates\.create_project'/, "صلاحية ميتة ما زالت في الكتالوج");
  const b = funcBody("project_create_from_template");
  assert.match(b, /if not public\.can_manage_projects\(\) then raise exception 'not authorized'/, "البوابة ليست صريحة");
});

test("الوحدات: عنصر null داخل المصفوفة لا يُسقط كل الوحدات صامتًا", () => {
  const b = funcBody("project_create_from_template");
  // any(array[null]) تُعيد NULL ⇒ mod_on تصير NULL ⇒ تُتخطّى كل الوحدات ويعود ok بأصفار
  assert.match(b, /where value is not null and btrim\(value\) <> ''/, "العناصر الفارغة لا تُستبعد");
  assert.match(b, /if v_modules is null or array_length\(v_modules,1\) is null then raise exception 'no_modules'/,
    "لا إعادة تحقّق بعد استبعاد الفارغ");
});

test("حفظ كقالب: بوابة التحرير + التصريح بغياب تاريخ البداية + منطقة زمنية صحيحة", () => {
  const b = funcBody("project_save_as_template");
  assert.match(b, /can_manage_projects\(\),false\) or coalesce\(public\.can_edit_project\(p_project\)/,
    "الاستخراج بحقّ القراءة وحده رغم أنّ الدالة DEFINER");
  assert.match(b, /'start_date_missing', \(v_start is null\)/, "قالب بلا تواريخ يعود ok صامتًا");
  assert.match(b, /at time zone coalesce\(s\.timezone,'Asia\/Riyadh'\)/, "المنطقة الزمنية مثبّتة على UTC");
  assert.match(TS, /start_date_missing: boolean/, "النوع لا يحمل العلم");
  assert.match(OPS, /start_date_missing/, "الواجهة لا تُبلّغ بغياب تاريخ البداية");
  assert.match(OPS, /c\.risks/, "رسالة الحفظ تُسقط عدد المخاطر");
});

test("الإصدار: تسمية صادقة (عدّاد مسودّة لا إصدار منشور)", () => {
  assert.match(SQL, /'template_draft_version', v_tpl_ver/, "السجلّ يسمّيه إصدارًا منشورًا");
  assert.doesNotMatch(SQL, /'template_version', v_tpl_ver/, "بقيت التسمية المضلِّلة");
  assert.match(TS, /template_draft_version/, "نوع نتيجة الإنشاء لم يُحدَّث");
  assert.match(UI, /المسودّة الجارية/, "الواجهة تقول «الإصدار الحالي» لعدّاد مسودّة");
});

test("الواجهة: نوافذ متداخلة، نجاح≠خطأ، رقم حيّ، فشل العملاء ظاهر، اسم وصول للبحث", () => {
  assert.match(UI, /onClick=\{\(e\) => \{ e\.stopPropagation\(\); onClose\(\); \}\}/, "نقر خلفية الابنة يغلق الأمّ أيضًا");
  assert.match(UI, /const \[okMsg, setOkMsg\] = useState\(""\)/, "النجاح والخطأ في نفس الحقل");
  assert.match(UI, /okMsg && <p className="text-\[11px\] text-emerald-300">/, "النجاح ليس مميّزًا لونيًّا");
  assert.match(UI, /err && <p className="text-\[11px\] text-red-300">/, "الخطأ ليس أحمر");
  assert.match(UI, /const \[curVer, setCurVer\] = useState\(tpl\.version\)/, "العنوان يقرأ prop قديمًا بعد النشر");
  assert.match(UI, /setClientsFailed\(true\)/, "فشل جلب العملاء مبتلَع");
  assert.match(UI, /aria-label=\{t\(\{ ar: "بحث في القوالب"/, "حقل البحث بلا اسم وصول");
  assert.match(UI, /if \(n === null\) return;/, "إلغاء prompt النشر ينفّذ العملية");
});

test("لا مساران متضاربان لإنشاء قالب من مشروع", () => {
  // الالتقاط في المتصفّح أُزيل لصالح RPC الخادم (نفس النتيجة، أعلى أمانة وذرّية)
  assert.doesNotMatch(TPLUI, /fromProject/, "الالتقاط في المتصفّح ما زال موجودًا بجوار مسار الخادم");
  assert.match(TPLUI, /7A: أُزيل التقاط «من هذا المشروع»/, "لا توثيق لسبب الإزالة");
  assert.match(OPS, /projectSaveAsTemplate\(projectId/, "مسار الخادم غير مربوط");
});

test("قفل القالب أثناء التطبيق + عدّادات كل الوحدات + خيارات لا أثر لها", () => {
  const b = funcBody("project_create_from_template");
  assert.match(b, /where id = v_tpl and is_active = true for share/, "spec قد يتبدّل بنشر متزامن بين القراءة والتطبيق");
  const lib = funcBody("project_templates_library");
  ["tasks", "milestones", "deliverables", "risks", "meetings", "shoots"].forEach((k) =>
    assert.match(lib, new RegExp("'" + k + "',\\s*jsonb_array_length"), `المكتبة لا تعيد عدّاد ${k}`));
  // الواجهة تعطّل الوحدة الفارغة بدل خيار بلا أثر
  assert.match(UI, /disabled=\{off\}/, "وحدة فارغة تبقى قابلة للاختيار");
  assert.match(UI, /TEMPLATE_MODULES\.filter\(\(m\) => \(\(tpl\.counts/, "الاختيار الابتدائي يشمل وحدات فارغة");
});

test("قاعدة عامّة: كل ON CONFLICT على عمود بفهرس فريد جزئيّ يحمل شرط الفهرس", () => {
  // 42P10 لا يظهر إلّا وقت التشغيل ويُجهض الترحيل كاملًا ⇒ نمنعه بنيويًّا لا بحالة واحدة.
  const partialCols = [...SQL.matchAll(/create unique index[^;]*?on public\.[a-z_]+\s*\(([a-z_]+)\)\s*where\s+([^;]+);/gi)]
    .map((m) => ({ col: m[1].trim(), pred: m[2].trim().replace(/\s+/g, " ") }));
  assert.ok(partialCols.length >= 1, "لا فهارس جزئية — حدّث الحارس إن تغيّرت البنية");
  partialCols.forEach(({ col, pred }) => {
    [...SQL.matchAll(new RegExp("on conflict \\(" + col + "\\)([^;]*?)(do nothing|do update)", "gi"))].forEach((m) => {
      const between = m[1].replace(/\s+/g, " ").trim();
      assert.ok(/^where\s+/i.test(between),
        `ON CONFLICT (${col}) بلا شرط الفهرس الجزئي «${pred}» ⇒ 42P10 يُجهض الترحيل`);
    });
  });
});
