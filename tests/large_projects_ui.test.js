// ════════════════════════════════════════════════════════════════════════════
// tests/large_projects_ui.test.js — حرّاس واجهة المشاريع الكبيرة.
// تُثبّت السلوكيات التي لا يلتقطها المترجم: «بانتظار الجدولة» لا يُرسم أحمر،
// الإجراءات الجماعية لا تعمل بلا خادم، الأعمدة الاختيارية مُقنَّنة، الأداء
// محميّ بـ memo/useMemo، والاتجاه RTL والجوال.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const ATOMS = read("components/portal/LargeProjectAtoms.tsx");
const MATRIX = read("components/portal/DeliverableMatrix.tsx");
const BULK = read("components/portal/LargeProjectBulkBar.tsx");
const DASH = read("components/portal/LargeProjectDashboard.tsx");
const TREE = read("components/portal/LargeProjectHierarchy.tsx");
const LIB = read("lib/portal/large-projects.ts");
const ALL = { ATOMS, MATRIX, BULK, DASH, TREE, LIB };

// ─── (أ) «بانتظار الجدولة» في كلّ مكان ─────────────────────────────────────

test("شارة «بانتظار الجدولة» موجودة ولا تُرسم بالأحمر أبدًا", () => {
  const m = ATOMS.match(/if \(lpIsAwaitingSchedule\(d\)\) \{([\s\S]*?)\n  \}/);
  assert.ok(m, "فرع «بانتظار الجدولة» غير موجود في الشارة");
  assert.doesNotMatch(m[1], /red-|#(dc2626|ef4444|e31e24)/i, "اللون الأحمر ممنوع لهذه الحالة");
  assert.match(m[1], /sky-/, "يُتوقَّع لون معلوماتيّ (سماويّ)");
  assert.match(m[1], /LP_SCHEDULE_LABELS\.awaiting_schedule/);
});

test("الأحمر محجوز للتأخّر الحقيقيّ داخل الشارة نفسها", () => {
  assert.match(ATOMS, /const late = lpIsOverdue\(d, iso\)/);
  assert.match(ATOMS, /late \? "bg-red-500\/10/);
});

test("فلتر «بانتظار الجدولة» موجود في الجدول ومفصول عن «متأخّر»", () => {
  assert.match(MATRIX, /filters\.awaitingSchedule/);
  assert.match(MATRIX, /filters\.overdue/);
  assert.match(MATRIX, /tone="info"[\s\S]{0,120}بانتظار الجدولة/);
  assert.match(MATRIX, /tone="danger"[\s\S]{0,120}متأخّر/);
});

test("اللوحة تعرض «بانتظار الجدولة» و«متأخّر» كبطاقتين منفصلتين مع تنبيه الاستثناء", () => {
  assert.match(DASH, /counters\.awaiting_schedule/);
  assert.match(DASH, /counters\.overdue/);
  assert.match(DASH, /بلا «بانتظار الجدولة»/, "بطاقة المتأخّر يجب أن تُصرّح باستثناء بانتظار الجدولة");
});

test("التواريخ قابلة للتحرير لاحقًا والحفظ بلا تاريخ مقبول صراحةً", () => {
  assert.match(BULK, /type="date"/);
  assert.match(BULK, /due_date: dueDate \|\| null/);
  assert.match(BULK, /يبقى «بانتظار الجدولة»/);
  assert.match(BULK, /clear_schedule/, "إرجاع الجدولة إلى «بانتظار الجدولة» إجراء قائم");
});

// ─── (ب) الإجراءات الجماعية ───────────────────────────────────────────────

test("الشريط يعرض العدد المتأثّر قبل التنفيذ وفي زرّ التنفيذ", () => {
  assert.match(BULK, /const count = ids\.length/);
  assert.match(BULK, /إجراء جماعيّ على/);
  assert.match(BULK, /\$\{count\}`/, "زرّ التنفيذ يجب أن يحمل العدد");
});

test("تأكيد ثانٍ إلزاميّ عند الأثر الكبير", () => {
  assert.match(BULK, /const big = count > LP_BULK_CONFIRM_THRESHOLD/);
  assert.match(BULK, /typedCount\.trim\(\) !== String\(count\)/);
});

test("السبب إلزاميّ (نصّ أثر التدقيق) في الواجهة وفي الطبقة معًا", () => {
  assert.match(BULK, /السبب إلزاميّ/);
  assert.match(LIB, /error: "reason_required"/);
});

test("بلا دالّة الخادم: الشريط معطَّل برسالة عربية صريحة، ولا مسار التفافيّ", () => {
  assert.match(BULK, /const blocked = !caps\.bulk \|\| missing\.length > 0/);
  assert.match(BULK, /disabled=\{busy \|\| blocked\}/);
  assert.match(BULK, /الإجراءات الجماعية معطَّلة/);
  assert.doesNotMatch(BULK, /ppatch|fetch\(/, "لا كتابة مباشرة من المكوّن");
});

test("التقرير يفصّل النجاح والفشل ولا يُخفي فشلًا جزئيًّا", () => {
  assert.match(BULK, /outcome\.applied/);
  assert.match(BULK, /outcome\.failed/);
  assert.match(BULK, /نجاح جزئيّ/);
  assert.match(BULK, /failures\.map/, "قائمة العناصر الفاشلة بأسبابها");
});

test("غياب تأكيد أثر التدقيق يُعلَن، والنتيجة المجهولة لا تُعرض كنجاح", () => {
  assert.match(BULK, /!outcome\.audited/);
  assert.match(BULK, /لم يؤكّد الخادم كتابة أثر التدقيق/);
  assert.match(BULK, /outcome\.detailUnknown/);
  assert.match(BULK, /لا يمكن تأكيد نجاح أيّ عنصر/);
});

test("التقرير يعيش في الجدول لا في الشريط — فتفريغ التحديد لا يبتلع الفشل الجزئيّ", () => {
  assert.match(BULK, /export function DeliverableBulkReport/);
  assert.match(BULK, /onApplied\(r\.data\)/, "الشريط يُسلّم النتيجة للأب");
  assert.doesNotMatch(BULK, /\{outcome && <DeliverableBulkReport/, "لا يجوز عرض التقرير داخل الشريط الزائل");
  assert.match(MATRIX, /lastOutcome && <DeliverableBulkReport/);
  assert.match(MATRIX, /setLastOutcome\(o\); clearSelection\(\); onChanged\(\);/);
});

test("الإجراءات الثمانية المطلوبة كلّها معرّفة", () => {
  for (const k of ["assign_owner", "set_priority", "set_status", "set_client_visibility",
    "set_schedule", "clear_schedule", "move_to_stage", "set_requirements"]) {
    assert.match(LIB, new RegExp(`"${k}"|kind: "${k}"|${k}:`), `الإجراء ${k} غير معرّف`);
    assert.ok(BULK.includes(k), `الإجراء ${k} غير موصول بالواجهة`);
  }
});

test("الإجراء الجماعيّ لا يقع إلّا على الصفوف الظاهرة في النتائج", () => {
  assert.match(MATRIX, /selectedIds = useMemo\(\(\) => filtered\.filter\(\(d\) => selected\.has\(d\.id\)\)/);
  assert.match(MATRIX, /ids=\{selectedIds\}/);
  assert.match(MATRIX, /setSelected\(new Set\(\)\); setShown\(PAGE\);[\s\S]{0,40}\[filterKey\]/,
    "تغيير الفلاتر يجب أن يمسح التحديد");
});

// ─── (ج) الكشف عن القدرات في كلّ حقل اختياريّ ──────────────────────────────

test("كلّ حقل اختياريّ في الجدول محميّ بـ caps.columns", () => {
  for (const col of ["priority", "platforms", "client_visible", "recurrence_type", "requires_shooting"]) {
    assert.match(MATRIX, new RegExp(`caps\\.columns\\.${col}`), `الفلتر ${col} غير مقيَّد بالكشف`);
  }
});

test("رسالة «الترحيلة غير مطبّقة» ظاهرة ولا تُسقط الصفحة", () => {
  assert.match(LIB, /export function lpMigrationNotice/);
  assert.match(LIB, /الترحيلة الإضافية لم تُطبَّق بعد/);
  assert.match(DASH, /lpMigrationNotice\(snap\.caps\)/);
  assert.match(DASH, /snap\.degraded\.length > 0/, "المصادر المتعذّرة تُعلن بدل الصمت");
});

test("أعمدة القراءة تُبنى من المكتشَف فقط (لا select لعمود غير موجود)", () => {
  assert.match(LIB, /LP_OPTIONAL_COLUMNS\.filter\(\(c\) => caps\.columns\[c\]\)/);
});

test("فشل جلب ثانويّ لا يُسقط اللقطة", () => {
  assert.match(LIB, /degraded\.push\("project_core"\)/);
  assert.match(LIB, /degraded\.push\("deliverables"\)/);
  assert.match(LIB, /degraded\.push\("client"\)/);
});

test("النوع نصّ حرّ: لا قائمة أنواع مثبّتة في الواجهة", () => {
  assert.doesNotMatch(MATRIX, /"video".*"photo".*"other"/s, "قائمة أنواع مثبّتة تكسر الأنواع الجديدة");
  assert.match(MATRIX, /lpTypesOf\(rows\)/, "الأنواع تُشتقّ من البيانات");
  assert.match(LIB, /export function lpTypeOf/, "content_type الموسَّع يسبق type القديم");
  assert.match(LIB, /content_type \?\? d\?\.type/);
});

// ─── (د) الأداء مع مئتي مخرج ──────────────────────────────────────────────

test("الترشيح والخرائط في useMemo، والصفّ memo", () => {
  assert.match(MATRIX, /const filtered = useMemo\(\(\) => lpFilter\(rows, filters, today\), \[rows, filters, today\]\)/);
  assert.match(MATRIX, /const stageName = useMemo/);
  assert.match(MATRIX, /const staffName = useMemo/);
  assert.match(MATRIX, /const DeliverableRow = memo\(/);
});

test("لا بحث خطّيّ داخل حلقة الرسم (لا .find داخل .map)", () => {
  for (const [name, src] of Object.entries(ALL)) {
    const bad = /\.map\(\([^)]*\)\s*=>\s*\{[\s\S]{0,600}?\.find\(/.test(src);
    assert.equal(bad, false, `${name}: بحث خطّيّ داخل .map ⇒ عمل تربيعيّ`);
  }
});

test("عرض متدرّج يقيّد DOM", () => {
  assert.match(MATRIX, /const PAGE = \d+/);
  assert.match(MATRIX, /filtered\.slice\(0, shown\)/);
  assert.match(MATRIX, /setShown\(\(s\) => s \+ PAGE\)/);
});

test("سقف الجلب معلن ويُبلَّغ عنه بدل صمت جزئيّ", () => {
  assert.match(LIB, /LP_FETCH_LIMIT/);
  assert.match(LIB, /truncated = all\.length > LP_FETCH_LIMIT/);
  assert.match(MATRIX, /truncated &&/);
  assert.match(DASH, /snap\.truncated/);
});

test("حارس السباق: طلب قديم لا يكتب فوق جديد", () => {
  assert.match(DASH, /const my = \+\+seq\.current/);
  assert.match(DASH, /my !== seq\.current/);
  assert.match(DASH, /alive\.current/);
});

// ─── (هـ) الهرمية وفتات الخبز ─────────────────────────────────────────────

test("فتات الخبز موجودة في الشجرة واللوحة", () => {
  assert.match(ATOMS, /export function LargeProjectBreadcrumbs/);
  assert.match(TREE, /<LargeProjectBreadcrumbs/);
  assert.match(DASH, /<LargeProjectBreadcrumbs/);
});

test("المستوى الثالث مجموعة داخل المرحلة لا مشروع — والقرار موثَّق للمستخدم", () => {
  assert.match(TREE, /lpGroupOf/);
  assert.match(TREE, /LP_HIERARCHY_MAX_DEPTH/);
  assert.match(TREE, /parent_must_be_master/, "دليل المنع يجب أن يبقى في التوثيق");
  assert.match(TREE, /مجموعة داخل المرحلة/);
  assert.match(LIB, /LP_THIRD_LEVEL_MODEL = "metadata\.group"/);
});

test("المخرج يبقى مرتبطًا بمرحلته الحقيقية (لا تسطيح للعلاقة)", () => {
  assert.match(TREE, /lpGroupByStage/);
  assert.match(LIB, /لا نُسطّح البيانات ولا نفقد العلاقة الأصلية/);
  // stage_id أوّلًا ثم project_id — لا اعتماد على project_id وحده
  assert.match(LIB, /export function lpStageIdOf[\s\S]*?stage_id \?\? d\?\.project_id/);
});

test("غياب أعمدة الهرمية يعرض مشروعًا واحدًا بدل خطأ", () => {
  assert.match(TREE, /!snapshot\.caps\.hierarchy/);
  assert.match(LIB, /fetchProjects\(projectId, false\)/);
});

test("المرحلة الفارغة تُشرح للمستخدم بأنها لا تؤثّر في النسبة", () => {
  assert.match(TREE, /يؤثّر في نسبة المشروع/);
  assert.match(ATOMS, /غير متاح/);
});

// ─── (و) اللوحة: كلّ ما طُلب عرضه ─────────────────────────────────────────

test("اللوحة تعرض العميل والمدير والحالة وحالة الجدولة والتقدّم", () => {
  for (const re of [/العميل/, /مدير المشروع/, /الحالة/, /الجدولة/, /LpProgressBar/]) {
    assert.match(DASH, re);
  }
});

test("اللوحة تعرض عدد المراحل والمجموعات والمخرجات وتوزيع الحالات", () => {
  assert.match(DASH, /snap\.stages\.length/);
  assert.match(DASH, /groups\.length/);
  assert.match(DASH, /counters\.total/);
  assert.match(DASH, /counters\.by_status/);
});

test("اللوحة تعرض تقدّم كلّ مرحلة والنشاط والمخاطر والقرارات وطلبات التغيير", () => {
  assert.match(DASH, /lpStageBreakdown/);
  assert.match(DASH, /activity\.slice/);
  assert.match(DASH, /gov\.risks/);
  assert.match(DASH, /gov\.decisions/);
  assert.match(DASH, /gov\.change_requests/);
});

test("طريقة حساب التقدّم معروضة للمستخدم لا مخفيّة", () => {
  assert.match(DASH, /progress\.method/);
  assert.match(ATOMS, /مُجمَّد عند الإغلاق/);
  assert.match(ATOMS, /تقديريّ/);
});

// ─── (ز) RTL والجوال ──────────────────────────────────────────────────────

test("الاتجاه RTL على الحاويات الجذرية", () => {
  assert.match(DASH, /dir="rtl"/);
  for (const [name, src] of Object.entries({ ATOMS, MATRIX, BULK, DASH, TREE })) {
    assert.doesNotMatch(src, /\bml-\d|\bmr-\d|\bpl-\d|\bpr-\d|left:\s|right:\s/,
      `${name}: هوامش يسار/يمين مثبّتة تكسر RTL — استعمل ms-/me-/ps-/pe-`);
  }
});

test("النصوص التي قد تكون عربية أو إنجليزية تحمل dir=auto، والأرقام dir=ltr", () => {
  assert.match(MATRIX, /dir="auto"/);
  assert.match(MATRIX, /dir="ltr"/);
  assert.match(TREE, /dir="auto"/);
});

test("تخطيط الجوال: شبكات متكيّفة و flex-wrap بلا عرض ثابت كبير", () => {
  assert.match(DASH, /grid-cols-3 sm:grid-cols-4/);
  assert.match(MATRIX, /flex-wrap/);
  for (const [name, src] of Object.entries({ MATRIX, BULK, DASH, TREE })) {
    assert.doesNotMatch(src, /w-\[[4-9]\d{2}px\]|min-w-\[[4-9]\d{2}px\]/,
      `${name}: عرض ثابت كبير يكسر الجوال`);
  }
});

// ─── (ح) حدود الملكية والحياد ─────────────────────────────────────────────

test("لا مساس بالملفات المجمَّدة ولا بمكوّنات وكلاء آخرين", () => {
  const forbidden = /portal\/mfa|useSensitiveWrite|MfaStepUp|AdminStaff|AdminAccounts|AdminProfessions|ProfessionPicker|ProfessionPermissionsEditor|EmployeeAccessModal/;
  for (const [name, src] of Object.entries(ALL)) {
    assert.doesNotMatch(src, forbidden, `${name}: استيراد ملفّ مملوك لوكيل آخر`);
  }
});

test("لا اسم مشروع بعينه في أيّ ملفّ من هذه الدفعة", () => {
  for (const [name, src] of Object.entries(ALL)) {
    assert.doesNotMatch(src, /misbar|مسبار/i, `${name}: اسم مشروع بعينه في قلب المنصّة`);
  }
});

test("لا افتراض بأن المخرج فيديو/سوشال، ولا عدد مراحل مثبّت", () => {
  for (const [name, src] of Object.entries(ALL)) {
    assert.doesNotMatch(src, /\b(11|79)\s*(stages|deliverables)/i, `${name}: عدد مثبّت`);
  }
  assert.doesNotMatch(LIB, /instagram|tiktok|snapchat|twitter/i, "قائمة منصّات مثبّتة في الطبقة");
});

// ─── (ط) تطابق المفردات مع الترحيلة الفعلية ───────────────────────────────

test("أسماء الأعمدة مطابقة حرفيًّا لملفّ الترحيلة (لا تخمين)", () => {
  const SQL_PATH = path.join(ROOT, "docs/project_platform_large_projects_RUNME.sql");
  if (!fs.existsSync(SQL_PATH)) return;   // الترحيلة ملك وكيل آخر؛ غيابها لا يُفشل الواجهة
  const SQL = fs.readFileSync(SQL_PATH, "utf8");
  const block = LIB.match(/LP_OPTIONAL_COLUMNS = \[([\s\S]*?)\] as const;/);
  assert.ok(block, "LP_OPTIONAL_COLUMNS غير موجودة");
  const optional = [...block[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  assert.ok(optional.length >= 15, "قائمة الأعمدة الاختيارية تقلّصت بغير قصد");
  for (const col of optional) {
    assert.ok(SQL.includes(`add column if not exists ${col}`),
      `العمود ${col} غير موجود في الترحيلة — الواجهة تتحدّث مفردات غير موجودة`);
  }
});

test("قيم حالة الجدولة مطابقة لقيد CHECK في الترحيلة", () => {
  const SQL_PATH = path.join(ROOT, "docs/project_platform_large_projects_RUNME.sql");
  if (!fs.existsSync(SQL_PATH)) return;
  const SQL = fs.readFileSync(SQL_PATH, "utf8");
  const m = SQL.match(/check \(schedule_status in \(([^)]*)\)\)/);
  assert.ok(m, "قيد schedule_status غير موجود");
  const dbVals = [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
  const uiVals = [...LIB.matchAll(/^  (awaiting_schedule|scheduled|in_progress|done|on_hold|cancelled): \{/gm)].map((x) => x[1]).sort();
  assert.deepEqual(uiVals, dbVals, "مفردات الجدولة في الواجهة تخالف قاعدة البيانات");
});

test("نِسَب الحالات مطابقة لدالّة الخادم — رقمان مختلفان لنسبة واحدة ممنوعان", () => {
  const SQL_PATH = path.join(ROOT, "docs/project_platform_large_projects_RUNME.sql");
  if (!fs.existsSync(SQL_PATH)) return;
  const SQL = fs.readFileSync(SQL_PATH, "utf8");
  const fn = SQL.match(/deliverable_status_progress_fraction[\s\S]*?\$\$([\s\S]*?)\$\$/);
  assert.ok(fn, "دالّة النِسَب غير موجودة");
  const server = {};
  for (const m2 of fn[1].matchAll(/when '([a-z_]+)'\s*then ([0-9.]+)/g)) server[m2[1]] = Number(m2[2]);
  const uiBlock = LIB.match(/LP_STATUS_FRACTION[^=]*=\s*\{([\s\S]*?)\n\};/);
  const ui = {};
  for (const pair of uiBlock[1].split(",")) {
    const kv = pair.match(/([a-z_]+)\s*:\s*([0-9.]+)/);
    if (kv) ui[kv[1]] = Number(kv[2]);
  }
  for (const k of Object.keys(ui)) {
    assert.equal(ui[k], server[k], `نسبة ${k} تخالف الخادم`);
  }
});

test("نسبة واحدة على الشاشة: رقم الخادم يتقدّم، والمصدر مُعلَن للمستخدم", () => {
  assert.match(DASH, /lpServerProgress\(projectId\)/);
  assert.match(DASH, /server && server\.calculation_method/);
  assert.match(DASH, /المصدر: الخادم/);
  assert.match(DASH, /المصدر: حساب محلّيّ \(الترحيلة غير مطبّقة\)/);
  assert.match(LIB, /if \(pct !== null && typeof pct !== "number"\) return null;/,
    "شكل غير متوقَّع من الخادم يجب ألّا يُعرض كنسبة");
});
