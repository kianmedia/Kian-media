// ════════════════════════════════════════════════════════════════════════════
// tests/ops_ui_contract.test.js — Phase 2: عقد الواجهة.
//
// كشف الميزة (needs_migration ≠ denied) · العقد مع القاعدة اسمًا اسمًا ·
// عربيّ/RTL/Unicode · Mobile-first · لا صلاحية مُشتقّة في المتصفّح.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const { read, SQL, CHILD_KINDS, PUBLIC_FNS } = require("./ops_helpers.js");

const TS = read("lib/portal/opsCenter.ts");
const ATOMS = read("components/portal/operations/OpsAtoms.tsx");
const CENTER = read("components/portal/operations/OpsCenter.tsx");
const PANEL = read("components/portal/operations/OpsJobPanel.tsx");
const FORM = read("components/portal/operations/OpsChildForm.tsx");
const PAGE = read("app/(portal)/client-portal/operations/page.tsx");
const UI = [ATOMS, CENTER, PANEL, FORM, PAGE].join("\n");

test("كشف الميزة: needs_migration حالة مستقلّة عن denied — لا خلط", () => {
  assert.match(TS, /state:\s*"needs_migration"/, "لا حالة ترحيلة معلّقة");
  assert.match(TS, /state:\s*"denied"/, "لا حالة منع");
  assert.match(TS, /pgIsMigrationPending\(d\)/, "لا تصنيف عبر pgerror");
  // 42501/not authorized ⇒ denied، لا needs_migration
  assert.match(TS, /d\.kind === "permission_denied"[\s\S]{0,120}state:\s*"denied"/,
    "المنع يُصنَّف خطأً");
  // ترتيب الفحص: الترحيلة أوّلًا ثمّ المنع، وكلاهما قبل error العامّ
  const iMig = TS.indexOf('return { state: "needs_migration"');
  const iDen = TS.indexOf('return { state: "denied"');
  const iErr = TS.indexOf('return { state: "error", message: pgMessageAr');
  assert.ok(iMig > 0 && iDen > iMig && iErr > iDen, "ترتيب تصنيف الحالات خاطئ");
  assert.match(TS, /operations_center_RUNME\.sql/, "رسالة الترحيلة لا تسمّي الملفّ الذي يجب تشغيله");
});

test("الواجهة تعرض الحالات الثلاث بأشكال مختلفة — لا شاشة فارغة", () => {
  assert.match(ATOMS, /function MigrationPending/, "لا شاشة «بانتظار تفعيل قاعدة البيانات»");
  assert.match(ATOMS, /الميزة بانتظار تفعيل قاعدة البيانات/, "النصّ المطلوب غير موجود");
  assert.match(ATOMS, /function Denied/, "لا شاشة منع");
  assert.match(ATOMS, /function ErrorBox/, "لا شاشة خطأ");
  assert.match(ATOMS, /st\.state === "needs_migration"[\s\S]{0,80}MigrationPending/,
    "الموزّع لا يربط الحالة بالشاشة");
  assert.match(ATOMS, /st\.state === "denied"[\s\S]{0,60}Denied/, "الموزّع لا يعرض المنع");
  // شاشة الترحيلة لا تدّعي مشكلة صلاحية والعكس
  const mig = ATOMS.slice(ATOMS.indexOf("function MigrationPending"), ATOMS.indexOf("function Denied"));
  assert.match(mig, /ليست مشكلة في حسابك/, "شاشة الترحيلة لا تنفي مشكلة الصلاحية");
});

test("العقد مع القاعدة: كلّ دالّة تستدعيها الواجهة موجودة في الحزمة، والعكس", () => {
  const called = [...TS.matchAll(/prpc<[^>]*>\("(\w+)"/g)].map((m) => m[1]);
  assert.ok(called.length >= 20, `عدد الاستدعاءات ${called.length} أقلّ من المتوقّع`);
  for (const fn of called) {
    assert.match(SQL, new RegExp(`create or replace function public\\.${fn}\\s*\\(`, "i"),
      `الواجهة تستدعي ${fn} وهي غير معرَّفة في الحزمة`);
    assert.match(SQL, new RegExp(`'public\\.${fn}\\(`), `${fn} غير ممنوحة لـauthenticated`);
  }
  for (const fn of PUBLIC_FNS) {
    assert.ok(called.includes(fn), `${fn} معرَّفة وممنوحة لكنّها غير مستعملة — سطح بلا مستهلك`);
  }
});

test("العقد مع القاعدة: أسماء المعاملات مطابقة (p_job/p_payload/…)", () => {
  const pairs = [
    ["prodops_job_detail", "p_job"], ["prodops_jobs_list", "p_filters"],
    ["prodops_job_upsert", "p_payload"], ["prodops_child_upsert", "p_kind"],
    ["prodops_child_delete", "p_id"], ["prodops_backup_step", "p_card"],
    ["prodops_calendar", "p_from"], ["prodops_confirm_attendance", "p_status"],
  ];
  for (const [fn, arg] of pairs) {
    const call = TS.match(new RegExp(`prpc<[^>]*>\\("${fn}",\\s*\\{([^}]*)\\}`));
    assert.ok(call, `${fn}: تعذّرت قراءة الاستدعاء`);
    assert.match(call[1], new RegExp(`\\b${arg}\\b`), `${fn}: المعامل ${arg} مفقود في الاستدعاء`);
    assert.match(SQL, new RegExp(`function public\\.${fn}\\s*\\([^)]*${arg}`, "i"),
      `${fn}: المعامل ${arg} غير موجود في التوقيع`);
  }
});

test("أنواع الأبناء في الواجهة تطابق القائمة البيضاء على الخادم — لا زيادة ولا نقص", () => {
  const uiKinds = [...FORM.matchAll(/^\s{2}(\w+):\s*\{\s*$/gm)].map((m) => m[1])
    .filter((k) => CHILD_KINDS.includes(k) || k.length > 2);
  for (const k of CHILD_KINDS) {
    assert.match(FORM, new RegExp(`^\\s{2}${k}:\\s*\\{`, "m"), `النوع ${k} بلا نموذج في الواجهة`);
  }
  // ولا نوع في الواجهة لا يقبله الخادم
  const declared = TS.match(/export type OpsChildKind =([\s\S]*?);/);
  assert.ok(declared, "نوع OpsChildKind غير معرَّف");
  const tsKinds = [...declared[1].matchAll(/"(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual([...tsKinds].sort(), [...CHILD_KINDS].sort(), "قائمة الأنواع لا تطابق الخادم");
  assert.ok(uiKinds.length >= CHILD_KINDS.length, "قائمة النماذج ناقصة");
});

test("لا صلاحية مُشتقّة في المتصفّح: القدرة تأتي من الخادم لا من الدور المحلّيّ", () => {
  assert.match(CENTER, /acc\.can_view/, "الشاشة لا تقرأ قدرة العرض من الخادم");
  assert.match(CENTER, /acc\.can_manage/, "الشاشة لا تقرأ قدرة الإدارة من الخادم");
  // لا اشتقاق من caps/staff_role
  for (const [n, src] of [["OpsCenter", CENTER], ["OpsJobPanel", PANEL], ["OpsChildForm", FORM]]) {
    assert.doesNotMatch(src, /usePortal\(\)/, `${n}: يشتقّ الصلاحية من سياق البوابة بدل الخادم`);
    assert.doesNotMatch(src, /staff_role|account_type/, `${n}: يقرأ الدور مباشرةً`);
  }
  assert.match(PANEL, /d\.can_manage/, "لوحة المهمّة لا تحترم قدرة الخادم");
});

test("عربيّ · RTL · بلا محارف تالفة", () => {
  for (const [n, src] of [["TS", TS], ["Atoms", ATOMS], ["Center", CENTER], ["Panel", PANEL], ["Form", FORM], ["Page", PAGE]]) {
    assert.ok(/[؀-ۿ]/.test(src), `${n}: بلا نصّ عربيّ`);
    assert.doesNotMatch(src, /�/, `${n}: محارف تالفة`);
    // لا اتجاه مفروض يكسر RTL للبوابة
    assert.doesNotMatch(src, /dir=["']ltr["']/, `${n}: يفرض اتجاهًا يساريًّا`);
  }
  // القواميس العربية مكتملة لكلّ مفردة يعرضها الخادم
  for (const k of ["filming", "photography", "drone", "live_stream", "podcast", "editing",
                   "design", "field_execution", "event", "other"]) {
    assert.match(TS, new RegExp(`\\b${k}:\\s*"`), `نوع المهمّة ${k} بلا ترجمة عربية`);
  }
  for (const s of ["draft", "scheduled", "confirmed", "in_progress", "on_hold", "completed", "cancelled"]) {
    assert.match(TS, new RegExp(`JOB_STATUS_AR[\\s\\S]{0,400}\\b${s}:`), `الحالة ${s} بلا ترجمة`);
  }
  // التاريخ والوقت بتوقيت الرياض لا UTC
  assert.match(TS, /timeZone:\s*"Asia\/Riyadh"/, "الوقت المعروض ليس بتوقيت الرياض");
});

test("Mobile-first: مساحات لمس ≥44px، وشبكة تبدأ بعمود واحد، وتبويبات لا تنكسر", () => {
  assert.match(ATOMS, /min-h-\[44px\]/, "لا حدّ أدنى لمساحة اللمس");
  assert.match(CENTER, /overflow-x-auto/, "شريط التبويبات لا يمرّر أفقيًّا على شاشة ضيّقة");
  assert.match(CENTER, /whitespace-nowrap/, "التبويبات تنكسر");
  // كلّ شبكة تبدأ بعمود واحد ثمّ تتوسّع
  const grids = [...UI.matchAll(/grid-cols-(\d+)/g)].map((m) => m[1]);
  assert.ok(grids.length > 0, "لا شبكات");
  const bad = [...UI.matchAll(/className="[^"]*\bgrid\b[^"]*"/g)]
    .map((m) => m[0])
    .filter((c) => /grid-cols-[2-9]/.test(c) && !/grid-cols-1/.test(c) && !/grid-cols-2 sm:/.test(c));
  assert.deepEqual(bad, [], "شبكة تبدأ بأكثر من عمود على الجوّال");
  // العرض الميدانيّ هو التبويب الافتراضيّ لغير المدير
  assert.match(CENTER, /\[\{ k: "mine", ar: "مهامّي" \}/, "«مهامّي» ليست التبويب الأوّل لغير المدير");
  // أرقام الهواتف قابلة للاتّصال من الموقع
  assert.match(PANEL, /href=\{`tel:/, "رقم مسؤول الموقع غير قابل للاتّصال");
  assert.match(CENTER, /tel:/, "لا اتّصال مباشر في العرض الميدانيّ");
});

test("صدق العرض: «غير متاح» لا يُعرض «سليم»، و«مؤكَّد» لا يُعرض بلا تأكيد", () => {
  assert.match(CENTER, /غير متاح \(الموديول غير مطبَّق\) — لا يُقال إنّه سليم/,
    "حالة المصدر غير المقروء تُعرض كأنّها سليمة");
  assert.match(CENTER, /assets_source === "unavailable"/, "لا إعلان عن غياب مصدر الأصول");
  assert.match(CENTER, /بانتظار تأكيدك/, "حالة الحضور غير المؤكَّدة تُعرض كمؤكَّدة");
  assert.match(PANEL, /التحقّق لا يُقبل قبل وجود نسختين/, "لا تحذير من ادّعاء التحقّق");
  assert.match(PANEL, /تقريرك مُرسَل ولا يُعدَّل/, "لا توضيح لقفل التقرير");
  assert.match(FORM, /النظام لا يتّصل بأيّ خدمة طقس خارجية/, "الطقس يُعرض كأنّه آليّ");
});

test("لا اتصال خارجيّ من الواجهة: كلّ الطلبات عبر prpc على القاعدة", () => {
  for (const [n, src] of [["Center", CENTER], ["Panel", PANEL], ["Form", FORM], ["Atoms", ATOMS]]) {
    assert.doesNotMatch(src, /\bfetch\s*\(/, `${n}: استدعاء fetch مباشر`);
    assert.doesNotMatch(src, /https?:\/\/[a-z]/i, `${n}: عنوان خارجيّ`);
  }
  assert.doesNotMatch(TS, /\bfetch\s*\(/, "طبقة الأغلفة تستدعي fetch مباشرةً");
});

test("مقاومة الشبكة الضعيفة: مهلة + آخر-طلب-يفوز + حارس unmount", () => {
  assert.match(ATOMS, /ops_timeout/, "لا مهلة");
  assert.match(ATOMS, /my !== seq\.current/, "لا حماية من سباق الطلبات");
  assert.match(ATOMS, /mounted\.current/, "لا حارس unmount");
  assert.match(ATOMS, /انتهت المهلة/, "رسالة المهلة ليست عربية");
});

test("المسار مسجَّل وله حدّ خطأ محلّيّ", () => {
  assert.match(PAGE, /OpsCenter/, "الصفحة لا تركّب المركز");
  const err = read("app/(portal)/client-portal/operations/error.tsx");
  assert.match(err, /تعذّر تحميل مركز التشغيل/, "لا حدّ خطأ محلّيّ");
  const nav = read("components/portal/nav.ts");
  assert.match(nav, /"\/client-portal\/operations"/, "المسار غير مسجَّل في التنقّل");
});
