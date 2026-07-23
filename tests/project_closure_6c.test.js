// ════════════════════════════════════════════════════════════════════════════
// tests/project_closure_6c.test.js — حراس Batch 6C (دمج الإغلاق في المسارات التنفيذية).
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const SQL = read("docs/project_closure_batch6c_RUNME.sql");
const SQL5B = read("docs/project_governance_batch5b_RUNME.sql");
const SQL5C = read("docs/project_governance_batch5c_RUNME.sql");
const TS = read("lib/portal/projectClosure.ts");
const UI = read("components/portal/projectcore/ClosureCenter.tsx");
const DASH = read("components/portal/projectcore/ProjectCoreDashboard.tsx");

function funcBody(name, src = SQL) {
  const m = src.match(new RegExp("create\\s+or\\s+replace\\s+function\\s+public\\." + name + "\\s*\\([^)]*\\)[\\s\\S]*?\\bas\\s*\\$\\$([\\s\\S]*?)\\$\\$\\s*;", "i"));
  assert.ok(m, `تعذّر إيجاد ${name}`); return m[1];
}

test("SQL 6C بنيوي: Preflight، Transaction، self-test، notify، بلا Temp/DROP", () => {
  assert.match(SQL, /do \$pre\$[\s\S]*6C PREFLIGHT/i, "لا Preflight");
  assert.match(SQL, /\bbegin;[\s\S]*\bcommit;/i, "ليس داخل Transaction");
  assert.match(SQL, /do \$selftest\$[\s\S]*raise exception '6C FAIL/i, "لا self-test");
  assert.match(SQL, /notify pgrst/i, "لا notify pgrst");
  assert.doesNotMatch(SQL, /create\s+temp(orary)?\s+table/i, "جداول مؤقتة");
  assert.doesNotMatch(SQL, /^\s*(drop function|drop table)/im, "DROP function/table");
  // Preflight يتوقّف بوضوح إن كانت 5C غير مطبّقة بدل الفشل الغامض
  assert.match(SQL, /project_closure_requests[\s\S]{0,400}raise exception '6C PREFLIGHT/i, "Preflight لا يتحقّق من جداول 5C");
});

test("لا متغيّر plpgsql غير مُعرّف في دوال 6C", () => {
  const re = /create or replace function public\.([a-z_]+)\s*\([^)]*\)[\s\S]*?\bas\s*\$\$([\s\S]*?)\$\$\s*;/gi;
  let m, checked = 0;
  while ((m = re.exec(SQL))) {
    const name = m[1], body = m[2];
    const dm = body.match(/\bdeclare\b([\s\S]*?)\bbegin\b/i);
    const declared = new Set([...(dm ? dm[1] : "").matchAll(/\b(v_[a-z_0-9]+)\b/g)].map((x) => x[1]));
    [...body.matchAll(/\bfor(?:each)?\s+(v_[a-z_0-9]+)\s+in/gi)].forEach((x) => declared.add(x[1]));
    const used = new Set([...body.matchAll(/\b(v_[a-z_0-9]+)\b/g)].map((x) => x[1]));
    const missing = [...used].filter((u) => !declared.has(u));
    assert.deepEqual(missing, [], `${name}: متغيّرات غير معرّفة ${missing.join(",")}`);
    checked++;
  }
  assert.ok(checked >= 3, "عدد الدوال المفحوصة أقل من المتوقّع");
});

test("سجلّ المعرفة: عزل per-row + احترام السرّية + لا تسريب دروس الإدارة", () => {
  const b = funcBody("closure_knowledge_register");
  assert.match(b, /public\.pc_can_read_project\(l\.project_id\)/, "لا عزل per-row على الدروس");
  // بوابة واحدة ثم تجميع الكل = نمط التسريب المعروف؛ يجب أن يكون العزل داخل الاستعلام
  assert.match(b, /v_mgmt or l\.confidentiality <> 'management'/, "دروس السرّية management غير محميّة");
  // الإحصاءات تخضع لنفس الشروط (لا إحصاء يكشف ما لا يُقرأ)
  const stats = b.slice(b.indexOf("into v_stats"));
  assert.match(stats, /pc_can_read_project/, "الإحصاءات بلا عزل");
  assert.match(stats, /confidentiality <> 'management'/, "الإحصاءات تتجاوز السرّية");
  assert.match(b, /has_more/, "لا Pagination صادقة");
  assert.match(b, /limit v_limit \+ 1/, "has_more ليست عبر limit+1");
});

test("العدسة التنفيذية: محرّك الحالة يُستدعى مرّة واحدة لكل مشروع + لا تجاوز للعزل", () => {
  const b = funcBody("executive_closure_metrics");
  const calls = (b.match(/pc_project_closure_status\(/g) || []).length;
  assert.equal(calls, 1, `pc_project_closure_status تُستدعى ${calls} مرّة (يجب مرّة واحدة)`);
  assert.match(b, /where public\.pc_can_read_project\(x\)/, "لا فلترة قراءة قبل اشتقاق الحالة");
  assert.match(b, /exec_visible_projects/, "لا يُركّب المجموعة المرئية من 5B");
  // بوابة حقيقية لا is_staff فقط
  assert.match(b, /if not \(public\.is_staff\(\)[\s\S]{0,300}raise exception 'not authorized'/, "بوابة ناقصة");
  // المقام صفر ⇒ null لا 0/100
  assert.match(b, /case when count\(\*\) > 0 then round\([\s\S]{0,240}else null end/, "capture_rate بلا حماية القسمة على صفر");
});

test("العدسة التنفيذية: كل كتلة اختيارية معزولة (5C/5B غير مطبّقة لا تُسقط الدالة)", () => {
  const b = funcBody("executive_closure_metrics");
  const begins = (b.match(/\bbegin\b/g) || []).length;
  const excepts = (b.match(/exception when/g) || []).length;
  assert.ok(excepts >= 5, `كتل exception قليلة (${excepts})`);
  assert.ok(begins > excepts, "كتل begin/exception غير متوازنة");
});

test("لقطة المؤشّرات: نفس التوقيع (لا 42P13) + كتلة الإغلاق معزولة + لا فقدان مؤشّرات 5B", () => {
  // نفس التوقيع تمامًا كما في 5B — تغيير نوع الإرجاع يُجهض الترحيل بـ42P13
  const sig6c = SQL.match(/create or replace function public\.executive_snapshot_capture\(([^)]*)\)\s*\n?\s*returns (\w+)/i);
  const sig5b = SQL5B.match(/create or replace function public\.executive_snapshot_capture\(([^)]*)\)\s*\n?\s*returns (\w+)/i);
  assert.ok(sig6c && sig5b, "تعذّر إيجاد توقيع اللقطة");
  assert.equal(sig6c[1].trim(), sig5b[1].trim(), "توقيع اللقطة تغيّر");
  assert.equal(sig6c[2], sig5b[2], "نوع إرجاع اللقطة تغيّر (42P13)");
  const b = funcBody("executive_snapshot_capture");
  // مؤشّرات 5B الثلاثة ما زالت تُكتب (لا نستبدل نظامًا بآخر)
  ["project_completion_rate", "overdue_task_rate", "active_projects"].forEach((k) =>
    assert.match(b, new RegExp(k), `مؤشّر 5B ${k} فُقد`));
  ["closure_cycle_time", "overdue_closure_count", "lessons_capture_rate", "delivered_not_closed"].forEach((k) =>
    assert.match(b, new RegExp(k), `مؤشّر إغلاق ${k} مفقود`));
  // «when others» عمدًا وليس undefined_table فقط: أيّ فشل في كتلة الإغلاق يجب ألّا يُسقط لقطة 5B
  assert.match(b, /exception when others then[\s\S]{0,240}v_closure_rows := 0/, "كتلة الإغلاق غير معزولة بحارس واسع");
  assert.match(b, /case when v_closed>0 then round[\s\S]{0,120}else null end/, "capture_rate في اللقطة بلا حماية القسمة على صفر");
});

test("§5 محاط بحارس: لا يُعاد تعريف دالة 5B على قاعدة بلا 5B", () => {
  assert.match(SQL, /do \$snap\$[\s\S]{0,400}to_regclass\('public\.executive_kpi_snapshots'\) is null[\s\S]{0,200}return;/,
    "§5 يُعيد التعريف دون التحقّق من وجود 5B");
  assert.match(SQL, /execute \$f\$[\s\S]*create or replace function public\.executive_snapshot_capture/,
    "إعادة التعريف ليست داخل الحارس");
  // والاختبار الذاتي لا يفشل على قاعدة بلا 5B
  assert.match(SQL, /if to_regclass\('public\.executive_kpi_snapshots'\) is not null then[\s\S]{0,400}closure_cycle_time/,
    "الاختبار الذاتي يفترض وجود 5B");
});

test("كتالوج المؤشّرات: قائمة أعمدة صريحة + unit غير فارغة (تكرار حادثة 23502)", () => {
  const ins = SQL.match(/insert into public\.executive_kpi_catalog\s*\(([\s\S]*?)\)\s*values([\s\S]*?)on conflict/i);
  assert.ok(ins, "لا إدراج في كتالوج المؤشّرات");
  assert.match(ins[1], /\bunit\b/, "قائمة الأعمدة بلا unit");
  const rows = ins[2].split(/\),\s*\n\s*\(/);
  assert.ok(rows.length >= 4, "صفوف المؤشّرات أقل من المتوقّع");
  rows.forEach((r) => {
    assert.doesNotMatch(r, /,\s*null\s*,\s*'(avg|count|ratio|sum)'/i, "unit فارغة (null) في صفّ مؤشّر — نفس سبب 23502");
  });
  assert.match(SQL, /on conflict \(key\) do nothing/i, "الإدراج غير Idempotent");
  assert.match(SQL, /unit is null or btrim\(unit\) = ''/, "self-test لا يفحص unit الفارغة");
});

test("6C إضافي فقط: لا إعادة تعريف لبوّابات الوصول ولا لدوال 5C ولا كتابة على core_stage", () => {
  ["can_access_project", "is_client_owner", "is_client_side", "pc_can_read_project", "closure_can",
   "pc_project_closure_status", "project_final_close", "portfolio_closure_dashboard", "project_lessons_register",
   "my_closure_inbox", "archive_register"].forEach((f) =>
    assert.doesNotMatch(SQL, new RegExp("create or replace function public\\." + f + "\\s*\\("), `6C يعيد تعريف ${f}`));
  assert.doesNotMatch(SQL, /update\s+public\.project_core\s+set[\s\S]{0,120}core_stage/i, "6C يكتب على core_stage مباشرة");
  assert.doesNotMatch(SQL, /update\s+public\.projects\s+set/i, "6C يكتب على projects مباشرة");
  // لا كتابة مالية ولا Zoho — تُفحص على الشيفرة لا على التعليقات
  const code = SQL.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
  assert.doesNotMatch(code, /insert into public\.(invoices|payments|project_expenses)/i, "6C يكتب بيانات مالية");
  assert.doesNotMatch(code, /update\s+public\.(invoices|payments|project_expenses)/i, "6C يعدّل بيانات مالية");
  assert.doesNotMatch(code, /zoho/i, "6C يمسّ Zoho");
});

test("أغلفة TS مطابقة لتوقيعات RPC ورسائل الخطأ العربية موجودة", () => {
  assert.match(TS, /closure_knowledge_register/, "غلاف سجلّ المعرفة مفقود");
  assert.match(TS, /executive_closure_metrics/, "غلاف العدسة التنفيذية مفقود");
  assert.match(TS, /export const closureKnowledgeRegister/, "لا تصدير لسجلّ المعرفة");
  assert.match(TS, /export const executiveClosureMetrics/, "لا تصدير للعدسة");
  assert.match(TS, /capture_rate: number \| null/, "capture_rate ليست Nullable في النوع (المقام صفر)");
  assert.match(TS, /function closureErr/, "لا مُترجم أخطاء");
});

test("الواجهة: أربعة تبويبات مربوطة بـRPCs حقيقية (لا زرّ بلا RPC، لا بيانات وهمية)", () => {
  ["myClosureInbox", "executiveClosureMetrics", "closureKnowledgeRegister", "archiveRegister"].forEach((f) =>
    assert.match(UI, new RegExp(f + "\\("), `التبويب لا يستدعي ${f}`));
  ["projectClosureApprove", "projectClosureReject", "projectClosureRequestChanges", "projectFinalAcceptanceDecide",
   "projectReopenApprove", "projectLessonApproveKnowledge", "projectArchiveRestore", "projectArchiveSetLegalHold"].forEach((f) =>
    assert.match(UI, new RegExp(f + "\\("), `إجراء ${f} غير مربوط`));
  assert.doesNotMatch(UI, /\bmockData|dummyData|fakeData|TODO: wire\b/i, "بيانات وهمية أو زرّ غير مربوط");
  assert.match(UI, /process\.env\.NODE_ENV !== "production"/, "تسجيل الخطأ الخام غير محصور");
  assert.match(UI, /role="tablist"/, "التبويبات بلا دور ARIA");
  assert.match(UI, /aria-selected=\{tab === x\.k\}/, "التبويبات بلا aria-selected");
});

test("الواجهة: منع الإرسال المزدوج + الأسباب الإلزامية + الحجز القانوني يمنع الاستعادة", () => {
  assert.match(UI, /if \(busy\) return;/, "لا حارس ضدّ الإرسال المزدوج");
  assert.match(UI, /disabled=\{busy\}/, "أزرار الإجراءات بلا disabled");
  // الرفض/طلب التعديل/الاستعادة تتطلّب سببًا غير فارغ قبل النداء
  assert.match(UI, /const ask = \(label: string\) => \{ const v = window\.prompt\(label\); return v && v\.trim\(\)/, "لا تحقّق من السبب الإلزامي");
  assert.match(UI, /if \(r && r\.trim\(\)\) void act\(\(\) => projectArchiveRestore/, "الاستعادة تُنفَّذ بسبب فارغ");
  assert.match(UI, /disabled=\{busy \|\| hold\}/, "الاستعادة غير معطّلة تحت الحجز القانوني");
});

test("الواجهة: مركز الإغلاق مربوط بالدشبورد + مهلة/تسلسل طلبات/حارس Unmount", () => {
  assert.match(DASH, /import ClosureCenter/, "الدشبورد لا يستورد مركز الإغلاق");
  assert.match(DASH, /setShowClosure\(true\)/, "لا زرّ لفتح مركز الإغلاق");
  assert.match(DASH, /showClosure && <ClosureCenter/, "مركز الإغلاق غير مُصيَّر");
  assert.match(UI, /closure_timeout/, "لا مهلة للطلبات");
  assert.match(UI, /my !== seq\.current/, "لا تسلسل للطلبات (سباق آخر-طلب-يفوز)");
  assert.match(UI, /mounted\.current/, "لا حارس Unmount");
});

test("لا ازدواج مصدر حقيقة: 6C لا يعيد بناء ما توفّره 5C", () => {
  // 5C تملك صندوق الوارد/لوحة المحفظة/سجلّ الأرشيف — 6C يستهلكها ولا ينسخها
  ["my_closure_inbox", "archive_register"].forEach((f) => {
    assert.match(SQL5C, new RegExp("create or replace function public\\." + f), `${f} ليست في 5C`);
    assert.doesNotMatch(SQL, new RegExp("create or replace function public\\." + f), `6C يكرّر ${f}`);
  });
  // سجلّ المعرفة عبر المشاريع لم يكن موجودًا في 5C (لكل مشروع فقط) ⇒ إضافته مبرّرة
  assert.doesNotMatch(SQL5C, /create or replace function public\.closure_knowledge_register/, "سجلّ المعرفة موجود مسبقًا");
  assert.match(SQL5C, /create or replace function public\.project_lessons_register\(p_project uuid/, "توقيع 5C لكل مشروع تغيّر");
});

// ════════════════════════════════════════════════════════════════════════════
// حراس مراجعة 6C العدائية — كلّ إصلاح مثبّت باختبار.
// ════════════════════════════════════════════════════════════════════════════
test("العدسة: مجموعة 5B الفارغة لا تعني «اعرض كل شيء»", () => {
  const b = funcBody("executive_closure_metrics");
  // array_agg على صفر صفوف = NULL؛ استخدام «v_ids is null» كإشارة سقوط يحوّل فلترًا
  // لا يطابق شيئًا إلى عرض المحفظة كاملة.
  assert.match(b, /v_used_5b boolean|v_used_5b := true/, "لا علم صريح لاستخدام مسار 5B");
  assert.match(b, /if not v_used_5b then/, "السقوط ما زال مبنيًّا على v_ids is null");
  assert.doesNotMatch(b, /if v_ids is null then\s*\n\s*select array_agg\(p\.id\)/, "سقوط خاطئ على NULL");
});

test("العدسة: الأرشيف والدروس لا تُقيَّد بمجموعة تستثني المؤرشف", () => {
  const b = funcBody("executive_closure_metrics");
  // الأرشفة تضع projects.is_deleted=true ⇒ تقييد العدّاد بـv_ids يجعله صفرًا دائمًا
  const arch = b.slice(b.indexOf("into v_archived"));
  assert.doesNotMatch(arch.slice(0, 400), /a\.project_id = any\(v_ids\)/, "عدّاد الأرشيف مقيّد بـv_ids (صفر دائمًا)");
  assert.match(arch.slice(0, 400), /pc_can_read_project\(a\.project_id\)/, "عدّاد الأرشيف بلا عزل per-row");
  const les = b.slice(b.indexOf("into v_lessons"));
  assert.doesNotMatch(les.slice(0, 500), /pc\.project_id = any\(v_ids\)/, "مقام الدروس يستثني المشاريع المؤرشفة");
  assert.match(les.slice(0, 600), /pc_can_read_project\(pc\.project_id\)/, "مقام الدروس بلا عزل per-row");
});

test("العدسة: حالات الإغلاق تطابق تعريفات 5C (لا متأخّر وهميّ ولا قبول مفقود)", () => {
  const b = funcBody("executive_closure_metrics");
  // 'reopened' حالة نهائية للطلب ⇒ ليست تأخّرًا مفتوحًا
  assert.match(b, /status not in \('closed','cancelled','rejected','reopened'\)/, "طلب reopened يُحسب متأخّرًا للأبد");
  // القبول المرتجع للتعديل ما زال مطلوبًا — نفس تعريف my_closure_inbox
  assert.match(b, /a\.status in \('pending','changes_requested'\)/, "بانتظار قبول العميل يفقد changes_requested");
  assert.match(SQL5C, /a\.status in \('pending','changes_requested'\)/, "تعريف 5C تغيّر — أعد المواءمة");
});

test("اللقطة: حجم عيّنة زمن الإغلاق هو المُحتسَب لا كل المشاريع", () => {
  const b = funcBody("executive_snapshot_capture");
  assert.match(b, /'closure_cycle_time', v_cycle, v_cycle_n/, "sample_size ما زال v_total (يكذب حجم العيّنة)");
  assert.match(b, /into v_cycle, v_cycle_n/, "عدّاد العيّنة غير محسوب");
});

test("الواجهة: إلغاء الـprompt يوقف الإجراء (لا حجز قانوني بالخطأ)", () => {
  // window.prompt تُعيد null عند الإلغاء؛ تمريرها كـundefined كان ينفّذ الإجراء
  assert.match(UI, /if \(c === null\) return; void act\(\(\) => projectReopenApprove/, "اعتماد إعادة الفتح ينفَّذ عند الإلغاء");
  assert.match(UI, /if \(r === null\) return; void act\(\(\) => projectArchiveSetLegalHold/, "الحجز القانوني يُبدَّل عند الإلغاء");
});

test("الواجهة: صندوق الإغلاق الشخصي متاح لكل موظّف مخوّل لا لمنطقة الإدارة فقط", () => {
  assert.match(DASH, /\(caps\.isAdminArea \|\| caps\.isEditor\) && <button onClick=\{\(\) => setShowClosure\(true\)\}/,
    "الصندوق الشخصي محجوب خلف صلاحية الإدارة");
  assert.match(DASH, /setShowClosure\(false\); void load\(filter, search\)/, "إغلاق المركز لا يُحدّث القائمة");
});

test("الواجهة: تفاصيل الصدق والوصول (CSV كامل، مفاتيح فريدة، ARIA، بلا قيم خام)", () => {
  assert.match(UI, /in_progress_rows \?\? \[\]\)\.forEach\(\(r\) => rows\.push\(\["قيد الإغلاق"/, "CSV يُسقط مجموعة ظاهرة على الشاشة");
  assert.match(UI, /key=\{`\$\{r\.id\}-\$\{i\}`\}/, "مفاتيح الصفوف قد تتصادم");
  assert.match(UI, /aria-controls="closure-panel"/, "التبويبات غير مرتبطة بلوحة");
  assert.match(UI, /role="tabpanel"/, "لا لوحة tabpanel");
  assert.match(UI, /empty=\{data\?\.lessons\.length === 0 && offset === 0\}/, "صفحة فارغة تحبس المستخدم بلا «السابق»");
  assert.match(UI, /LESSON_CAT_AR\[l\.category\]/, "تصنيف الدرس يُعرض خامًا");
  assert.match(UI, /PC_STAGE_LABELS\[str\(r\.requested_target_stage\)/, "مرحلة إعادة الفتح تُعرض خامًا");
  assert.match(UI, /!restored && <button/, "زرّ الاستعادة يظهر لأرشيف مُستعاد أصلًا");
});

test("العدسة واللقطة: زمن دورة الإغلاق لا يُقيَّد بمجموعة تستثني المؤرشف", () => {
  const b = funcBody("executive_closure_metrics");
  const cutAt = (src, from) => { const i = src.indexOf(from); return src.slice(i, src.indexOf(";", i) + 1); };
  const cyc = cutAt(b, "into v_cycle, v_cycle_n");
  assert.doesNotMatch(cyc, /c\.project_id = any\(v_ids\)/, "زمن الدورة يُسقط الطلبات المكتملة لمشاريع أُرشفت");
  assert.match(cyc, /pc_can_read_project\(c\.project_id\)/, "زمن الدورة بلا عزل per-row");
  const s = funcBody("executive_snapshot_capture");
  const scyc = cutAt(s, "into v_cycle, v_cycle_n");
  assert.doesNotMatch(scyc, /c\.project_id = any\(v_ids\)/, "لقطة زمن الدورة تُسقط المؤرشف");
  assert.doesNotMatch(cutAt(s, "into v_closed"), /any\(v_ids\)/, "مقام لقطة الدروس يُسقط المؤرشف");
  assert.doesNotMatch(cutAt(s, "into v_with_lessons"), /pc\.project_id = any\(v_ids\)/, "بسط لقطة الدروس يُسقط المؤرشف");
});

test("السرّية حاجز حقيقي: RLS تُشدّ ولا تبقى الحماية داخل الدالة فقط", () => {
  assert.match(SQL, /do \$rls\$[\s\S]{0,900}create policy pll_read on public\.project_lessons_learned/,
    "لا تشديد لسياسة قراءة الدروس");
  assert.match(SQL, /confidentiality <> 'management'[\s\S]{0,200}emp_has_permission\('closure\.view_knowledge'\)/,
    "السياسة الجديدة لا تُنفّذ شرط السرّية");
  // والصلاحية موصوفة بما تفعله فعلًا (لا «عرض السجلّ» وهو متاح للجميع)
  assert.match(SQL, /'closure\.view_knowledge', 'closure','sensitive'/, "الصلاحية ليست حسّاسة رغم أنّها تكشف سرّية");
  assert.match(SQL, /عرض الدروس المصنّفة «إدارة»/, "تسمية الصلاحية مضلِّلة");
});
