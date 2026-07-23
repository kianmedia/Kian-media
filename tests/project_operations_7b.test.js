// ════════════════════════════════════════════════════════════════════════════
// tests/project_operations_7b.test.js — حراس Batch 7B (مركز العمليات).
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const SQL = read("docs/project_operations_batch7b_RUNME.sql");
const TS = read("lib/portal/operations.ts");
const UI = read("components/portal/projectcore/OperationsCenter.tsx");
const DASH = read("components/portal/projectcore/ProjectCoreDashboard.tsx");

function funcBody(name, src = SQL) {
  const m = src.match(new RegExp("create\\s+or\\s+replace\\s+function\\s+public\\." + name + "\\s*\\([^)]*\\)[\\s\\S]*?\\bas\\s*\\$\\$([\\s\\S]*?)\\$\\$\\s*;", "i"));
  assert.ok(m, `تعذّر إيجاد ${name}`); return m[1];
}

test("SQL 7B بنيوي: Preflight، Transaction، self-test، notify، بلا Temp/DROP", () => {
  assert.match(SQL, /do \$pre\$[\s\S]*7B PREFLIGHT/i, "لا Preflight");
  assert.match(SQL, /\bbegin;[\s\S]*\bcommit;/i, "ليس داخل Transaction");
  assert.match(SQL, /do \$selftest\$[\s\S]*raise exception '7B FAIL/i, "لا self-test");
  assert.match(SQL, /notify pgrst/i, "لا notify pgrst");
  assert.doesNotMatch(SQL, /create\s+temp(orary)?\s+table/i, "جداول مؤقتة داخل دوال القراءة");
  assert.doesNotMatch(SQL, /^\s*(drop function|drop table)/im, "DROP function/table");
  // Preflight يتوقّف بوضوح إن كانت المصادر الأساسية غائبة
  assert.match(SQL, /exec_visible_projects[\s\S]{0,120}raise exception '7B PREFLIGHT/i, "Preflight لا يتحقّق من exec_visible_projects");
});

test("لا متغيّر plpgsql غير مُعرّف في دوال 7B", () => {
  const re = /create or replace function public\.([a-z_]+)\s*\([^)]*\)[\s\S]*?\blanguage plpgsql[\s\S]*?\bas\s*\$\$([\s\S]*?)\$\$\s*;/gi;
  let m, checked = 0;
  while ((m = re.exec(SQL))) {
    const name = m[1];
    // التعليقات ليست شيفرة
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

test("العميل مستبعد: بوابة is_staff على كل دالة عمليات", () => {
  ["operations_command_center", "operations_my_work", "operations_attention_queue", "operations_schedule"].forEach((f) => {
    const b = funcBody(f);
    assert.match(b, /if not public\.ops_can_view\(\) then raise exception 'not authorized'/, `${f} بلا بوابة المركز`);
  });
  // ops_can_view = is_staff فقط (العميل مستبعد)
  assert.match(SQL, /create or replace function public\.ops_can_view\(\)[\s\S]{0,200}select public\.is_staff\(\)/i, "بوابة المركز لا تستبعد العميل");
});

test("عزل per-row: كل النطاق يُشتقّ من exec_visible_projects لا تجميع كل الجداول", () => {
  const cc = funcBody("operations_command_center");
  assert.match(cc, /ops_visible_ids\(p_filters\)/, "المركز لا يُركّب المجموعة المرئية");
  const aq = funcBody("operations_attention_queue");
  assert.match(aq, /ops_visible_ids\(p_filters\)/, "الانتباه بلا مجموعة مرئية");
  const sc = funcBody("operations_schedule");
  assert.match(sc, /ops_visible_ids\(p_filters\)/, "الجدول بلا مجموعة مرئية");
  // ops_visible_ids يُركّب exec_visible_projects (الذي يطبّق pc_can_read_project per row)
  assert.match(funcBody("ops_visible_ids"), /exec_visible_projects\(p_filters\)/, "المجموعة المرئية لا تُركّب 5B");
  // my_work يقيّد بـauth.uid() + pc_can_read_project
  const mw = funcBody("operations_my_work");
  assert.match(mw, /t2\.assignee_id = v_uid[\s\S]{0,160}project_task_assignees a where a\.user_id = v_uid/, "مهامي غير مقيّدة بالمستخدم");
  assert.match(mw, /public\.pc_can_read_project\(t\.project_id\)/, "مهامي بلا عزل per-row");
});

test("لا نظام موازٍ: يُركّب الاعتمادات/الإغلاق/التعارضات القائمة", () => {
  const cc = funcBody("operations_command_center");
  assert.match(cc, /public\.my_approval_inbox\('\{\}'::jsonb\)/, "لا تركيب لصندوق الاعتمادات (5A)");
  assert.match(cc, /public\.my_closure_inbox\('\{\}'::jsonb\)/, "لا تركيب لصندوق الإغلاق (5C)");
  assert.match(cc, /resource_conflict_center\('\{\}'::jsonb\)/, "لا تركيب لمركز التعارضات (4B)");
  // لا إنشاء جداول مهام/إشعارات/اعتمادات جديدة
  assert.doesNotMatch(SQL, /create table[\s\S]{0,60}(notifications|project_tasks|project_approvals)\b/i, "7B ينشئ نظامًا موازيًا");
});

test("الجدول: منع التكرار عبر (entity_type,entity_id) واستبعاد schedule_items المرتبطة", () => {
  const b = funcBody("operations_schedule");
  // نستبعد فقط ما نُصدره مباشرةً (المهام/الجلسات)؛ المخرجات/الاجتماعات مصدرها الوحيد schedule_items
  assert.match(b, /si\.task_id is null and si\.shoot_session_id is null\b/, "schedule_items المرتبطة بمهمة/جلسة قد تُكرّر الحدث");
  assert.doesNotMatch(b, /si\.deliverable_id is null and si\.meeting_id is null/, "استبعاد المخرجات/الاجتماعات يُسقطها كليًّا (مصدرها الوحيد)");
  // نافذة 'tomorrow' لا تشمل اليوم
  assert.match(b, /v_from := case v_win when 'tomorrow' then v_today\+1 else v_today end/, "نافذة الغد تشمل اليوم");
  // كل مصدر يُصدر entity_type مميّزًا
  ["'task'", "'shoot_session'", "'schedule_item'", "'resource_booking'"].forEach((k) =>
    assert.match(b, new RegExp(k.replace(/'/g, "'")), `مصدر ${k} مفقود من الجدول`));
});

test("Asia/Riyadh: كل التواريخ التشغيلية بتوقيت الرياض لا UTC", () => {
  ["operations_command_center", "operations_my_work", "operations_attention_queue", "operations_schedule"].forEach((f) => {
    const b = funcBody(f);
    if (/v_today/.test(b)) assert.match(b, /at time zone 'Asia\/Riyadh'\)::date/, `${f} يحسب "اليوم" بغير توقيت الرياض`);
    assert.doesNotMatch(b, /at time zone 'utc'\)::date/i, `${f} يستخدم UTC لحساب التاريخ`);
  });
});

test("قيم غير المتاحة تعيد unavailable لا صفرًا مضلِّلًا", () => {
  const cc = funcBody("operations_command_center");
  assert.match(cc, /'bookings_today'[\s\S]{0,120}unavailable/, "حجوزات اليوم تعيد صفرًا بلا صلاحية");
  assert.match(cc, /'resource_conflicts'[\s\S]{0,120}unavailable/, "التعارضات تعيد صفرًا بلا صلاحية");
  assert.match(cc, /'notifications_unread'[\s\S]{0,120}unavailable/, "الإشعارات تعيد صفرًا حين المصدر غائب");
  assert.match(TS, /export type MaybeCount = number \| "unavailable"/, "النوع لا يعبّر عن unavailable");
});

test("طابور الانتباه: قواعد معلنة + urgency مشتقّة + Pagination", () => {
  const b = funcBody("operations_attention_queue");
  ["health_off_track", "due_overdue", "no_manager", "delivered_not_closed", "risk_critical", "issue_critical", "change_pending", "client_review_pending"].forEach((code) =>
    assert.match(b, new RegExp("'" + code + "'"), `سبب ${code} مفقود`));
  assert.match(b, /'urgency', p\.urgency, 'reason_code'/, "العنصر بلا urgency/reason_code");
  assert.match(b, /has_more/, "لا Pagination");
  // urgency مشتقّة (case) لا مخزّنة
  assert.match(b, /case i\.urgency when 'critical' then 0/, "الترتيب لا يشتقّ urgency");
});

test("المنح والإبطال + العميل محروم من الدوال", () => {
  ["operations_command_center", "operations_my_work", "operations_attention_queue", "operations_schedule", "ops_can_view", "ops_visible_ids"].forEach((f) => {
    assert.match(SQL, new RegExp("revoke execute on function public\\." + f + "\\([^)]*\\) from public, anon"), `${f} بلا revoke من public/anon`);
    assert.match(SQL, new RegExp("grant execute on function public\\." + f + "\\([^)]*\\) to authenticated"), `${f} بلا grant`);
  });
});

test("لا كتابة: قراءة فقط، لا مالية/عهدة/Zoho/core_stage/progress", () => {
  const code = SQL.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
  assert.doesNotMatch(code, /update\s+public\.project_core/i, "يكتب على project_core");
  assert.doesNotMatch(code, /update\s+public\.project_tasks|insert into public\.project_tasks/i, "يكتب على المهام");
  assert.doesNotMatch(code, /insert into public\.(invoices|payments|project_expenses)|update public\.(invoices|payments)/i, "يكتب بيانات مالية");
  assert.doesNotMatch(code, /zoho/i, "يمسّ Zoho");
  assert.doesNotMatch(code, /update\s+public\.(custody|asset_custody)|update public\.notifications/i, "يكتب على العهدة/الإشعارات");
  // كل الدوال قراءة: stable (لا volatile)
  ["operations_command_center", "operations_my_work", "operations_attention_queue", "operations_schedule"].forEach((f) =>
    assert.match(SQL, new RegExp("function public\\." + f + "\\([^)]*\\)\\s*\\n?\\s*returns jsonb language plpgsql stable"), `${f} ليست stable`));
});

test("أغلفة TS: كل RPC ملفوف + رسائل خطأ عربية", () => {
  ["operations_command_center", "operations_my_work", "operations_attention_queue", "operations_schedule"].forEach((f) =>
    assert.match(TS, new RegExp('"' + f + '"'), `غلاف ${f} مفقود`));
  assert.match(TS, /export const operationsCommandCenter/, "لا تصدير للمركز");
  assert.match(TS, /export function opsErr/, "لا مُترجم أخطاء");
});

test("الواجهة: مربوطة بـRPCs حقيقية، بلا بيانات وهمية، مع تسلسل/مهلة/Unmount", () => {
  ["operationsCommandCenter", "operationsMyWork", "operationsAttentionQueue", "operationsSchedule"].forEach((f) =>
    assert.match(UI, new RegExp(f + "\\("), `الواجهة لا تستدعي ${f}`));
  assert.match(UI, /import NotificationsView/, "الإشعارات ليست مركّبة من المركز القائم");
  assert.doesNotMatch(UI, /\bmockData|dummyData|fakeData|TODO: wire\b/i, "بيانات وهمية");
  assert.match(UI, /process\.env\.NODE_ENV !== "production"/, "تسجيل الخطأ الخام غير محصور");
  assert.match(UI, /my !== seq\.current/, "لا تسلسل للطلبات");
  assert.match(UI, /mounted\.current/, "لا حارس Unmount");
  assert.match(UI, /ops_timeout/, "لا مهلة");
  // بطاقات الملخّص قابلة للنقر تفتح التبويب المكوّن للرقم
  assert.match(UI, /onGoto\("mywork"\)/, "بطاقات المهام لا تفتح تبويبها");
  assert.match(UI, /onGoto\("attention"\)/, "بطاقات الانتباه لا تفتح تبويبها");
});

test("الواجهة: ARIA (tablist/tabpanel/aria-selected) + بلا قيم خام + إجراءات سريعة حقيقية", () => {
  assert.match(UI, /role="tablist"/, "لا tablist");
  assert.match(UI, /role="tabpanel"/, "لا tabpanel");
  assert.match(UI, /aria-controls="ops-panel"/, "التبويبات غير مرتبطة باللوحة");
  assert.match(UI, /aria-selected=\{tab === x\.k\}/, "لا aria-selected");
  // الإجراءات السريعة تنفّذ onNavigate (لوحات قائمة) لا روابط إلى مُعامِل غير موجود
  assert.match(UI, /const go = \(p: OpsPanel\) => \{ onClose\(\); onNavigate\(p\); \}/, "الإجراء السريع لا يفتح لوحة حقيقية");
  assert.doesNotMatch(UI, /\?panel=executive/, "رابط إلى مُعامِل غير مقروء");
  // مربوطة بالدشبورد + بوابة تشمل المالك
  assert.match(DASH, /import OperationsCenter/, "الدشبورد لا يستورد المركز");
  assert.match(DASH, /\(caps\.isStaff \|\| caps\.isAdminArea\) && <button onClick=\{\(\) => setShowOps\(true\)\}/, "زرّ المركز يحجب المالك");
  assert.match(DASH, /showOps && <OperationsCenter/, "المركز غير مُصيَّر");
});

// ════════════════════════════════════════════════════════════════════════════
// حراس مراجعة 7B العدائية (8 نتائج مؤكَّدة) — كلٌّ مثبّت باختبار.
// ════════════════════════════════════════════════════════════════════════════
test("المراجعات: حالة المراجعة الحيّة internal_review/client_review لا in_review (3A)", () => {
  const cc = funcBody("operations_command_center");
  assert.match(cc, /t\.status in \('internal_review','client_review'\)/, "reviews_pending ما زالت على in_review الميتة");
  assert.doesNotMatch(cc, /t\.status = 'in_review'/, "بقيت in_review في المركز");
  const mw = funcBody("operations_my_work");
  assert.match(mw, /t\.status in \('internal_review','client_review'\)/, "قائمة مراجعاتي على in_review الميتة");
});

test("المخاطر/المشكلات: المفردات المطابقة لـ5A (استبعاد accepted، لا rejected/resolved وهمية)", () => {
  const cc = funcBody("operations_command_center");
  assert.match(cc, /r\.status not in \('closed','accepted'\)/, "المخاطر الحرجة لا تستبعد accepted");
  assert.doesNotMatch(cc, /r\.status not in \('closed','rejected','resolved'\)/, "بقيت مفردات مخاطر وهمية");
  assert.match(cc, /i\.status not in \('resolved','closed','rejected'\)/, "المشكلات لا تطابق فلتر 5A");
  const aq = funcBody("operations_attention_queue");
  assert.match(aq, /r\.status not in \('closed','accepted'\)/, "طابور الانتباه: مخاطر بمفردات خاطئة");
  assert.match(aq, /i\.status not in \('resolved','closed','rejected'\)/, "طابور الانتباه: مشكلات بمفردات خاطئة");
});

test("جلساتي: مشتقّة من العضوية لا من crew النصّية (لا نتيجة فارغة دائمًا)", () => {
  const mw = funcBody("operations_my_work");
  assert.doesNotMatch(mw, /crew @> to_jsonb/, "ما زال يطابق crew ككائنات user_id (فارغ دائمًا)");
  assert.match(mw, /project_members m\s*\n?\s*where m\.project_id = s\.project_id and m\.user_id = v_uid/, "الجلسات لا تُشتقّ من العضوية");
});

test("الجدول: يبقي أحداث المخرجات والاجتماعات (schedule_items المرتبطة بها مصدرها الوحيد)", () => {
  const b = funcBody("operations_schedule");
  assert.match(b, /si\.task_id is null and si\.shoot_session_id is null\b/, "لا استبعاد للمهام/الجلسات المكرّرة");
  assert.doesNotMatch(b, /si\.deliverable_id is null and si\.meeting_id is null/, "استبعاد المخرجات/الاجتماعات يُسقطها كليًّا");
  assert.match(b, /v_from date; v_to date/, "لا حدّ سفليّ متغيّر للنافذة");
  assert.match(b, /b\.ends_at   at time zone 'Asia\/Riyadh'\)::date >= v_from/, "الحجوزات لا تُحسب بالتقاطُع مع النافذة");
});

test("المهام «بلا مسؤول»: تستبعد المراقب/المراجع (owner/contributor فقط)", () => {
  const cc = funcBody("operations_command_center");
  assert.match(cc, /a\.assignment_role in \('owner','contributor'\)/, "المراقب يُحسب مسؤولًا");
});

test("الاعتمادات المتأخرة مقيّدة بـmine (اتّساق مع «تنتظر قراري»)", () => {
  const cc = funcBody("operations_command_center");
  assert.match(cc, /\(e->>'overdue'\)::boolean and \(e->>'mine'\)::boolean/, "المتأخرة لا تُقيَّد بـmine");
});

test("عملي/المهام: UNION يتيح الفهارس بدل OR+EXISTS ماسح", () => {
  const mw = funcBody("operations_my_work");
  assert.match(mw, /t2\.assignee_id = v_uid\s*\n?\s*union\s*\n?\s*select a\.task_id from public\.project_task_assignees a where a\.user_id = v_uid/, "لا UNION مفهرس للمهام");
  assert.doesNotMatch(mw, /t\.assignee_id = v_uid\s*\n?\s*or exists/, "بقي OR+EXISTS الماسح");
});

test("الواجهة: عملي يعرض الإغلاق، بطاقة التعارضات تحمرّ، والوقت بتوقيت الرياض", () => {
  assert.match(UI, /MiniList title=\{t\(\{ ar: "إغلاق\/قبول\/إعادة فتح مطلوب منّي"/, "عملي لا يعرض الإغلاق (بطاقة معلّقة بلا وجهة)");
  assert.match(UI, /closRows\.length === 0/, "empty لا يحتسب الإغلاق");
  assert.match(UI, /n === "unavailable" \? "—" : n/, "Sc لا يعالج unavailable");
  assert.match(UI, /<Sc n=\{data\.summary\.resource_conflicts\} ar="تعارضات الموارد" red/, "بطاقة التعارضات ما زالت مُنمّطة نصًّا فلا تحمرّ");
  assert.match(UI, /const riyadhTime = /, "لا تنسيق وقت بتوقيت الرياض");
  assert.match(UI, /riyadhTime\(data\.generated_at\)/, "الوقت ما زال شريحة UTC");
});
