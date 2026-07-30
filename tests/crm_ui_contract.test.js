// ════════════════════════════════════════════════════════════════════════════
// tests/crm_ui_contract.test.js — Phase 3: عقد الواجهة.
//
// أهمّ ما هنا: **الكود يُنشر قبل تشغيل الـSQL**. كلّ سطح يجب أن يعرض
// «الميزة بانتظار تفعيل قاعدة البيانات» بدل أن ينهار، وألّا يخلط ذلك أبدًا
// مع «لا تملك صلاحية» — خلطهما أضاع دورة إنتاج كاملة في هذا المستودع.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const { LIB, read, exists, READ_FNS, WRITE_FNS } = require("./crm_helpers.js");

const ATOMS = read("components/portal/crm/CrmAtoms.tsx");
const CENTER = read("components/portal/crm/CrmCenter.tsx");
const LEADP = read("components/portal/crm/CrmLeadPanel.tsx");
const OPPP = read("components/portal/crm/CrmOpportunityPanel.tsx");
const PAGE = read("app/client-portal/crm/page.tsx");
const UI = [["CrmAtoms", ATOMS], ["CrmCenter", CENTER], ["CrmLeadPanel", LEADP],
            ["CrmOpportunityPanel", OPPP], ["page", PAGE]];

test("كلّ ملفّات الواجهة موجودة، وللمسار حدّ خطأ خاصّ به", () => {
  for (const f of ["components/portal/crm/CrmAtoms.tsx", "components/portal/crm/CrmCenter.tsx",
                   "components/portal/crm/CrmLeadPanel.tsx", "components/portal/crm/CrmOpportunityPanel.tsx",
                   "app/client-portal/crm/page.tsx", "app/client-portal/crm/error.tsx"]) {
    assert.ok(exists(f), `ملفّ الواجهة مفقود: ${f}`);
  }
  const err = read("app/client-portal/crm/error.tsx");
  assert.match(err, /"use client"/, "حدّ الخطأ ليس مكوّن عميل");
  assert.match(err, /reset\(\)/, "حدّ الخطأ بلا إعادة محاولة");
  assert.match(err, /تعذّر تحميل وحدة المبيعات/, "حدّ الخطأ بلا رسالة عربية خاصّة بالمسار");
});

// ─── الكشف قبل الـSQL: الحالة الثلاثية ─────────────────────────────────────

test("الحالة ثلاثية لا ثنائية — والترحيلة الناقصة ليست منعًا", () => {
  assert.match(LIB, /export type CrmState<T>[\s\S]{0,300}"needs_migration"[\s\S]{0,200}"denied"/,
    "لا حالة ثلاثية");
  assert.match(LIB, /pgIsMigrationPending\(d\)\) return \{ state: "needs_migration"/,
    "غياب الدالّة لا يُترجَم إلى «بانتظار التفعيل»");
  assert.match(LIB, /d\.kind === "permission_denied"[\s\S]{0,120}state: "denied"/,
    "المنع لا يُترجَم إلى «لا تملك صلاحية»");
  // الترتيب حاسم: لا يجوز أن يُعالَج المنع كترحيلة ناقصة
  const migIdx = LIB.indexOf('return { state: "needs_migration"');
  const denIdx = LIB.indexOf('return { state: "denied"');
  assert.ok(migIdx !== -1 && denIdx !== -1, "إحدى الحالتين غائبة");
  assert.match(LIB, /CRM_MIGRATION_AR[\s\S]{0,220}crm_sales_FOUNDATION_RUNME\.sql/,
    "رسالة «بانتظار التفعيل» لا تسمّي الملفّ الذي يجب تشغيله");
  assert.match(LIB, /لا يوجد خطأ في صلاحياتك/, "رسالة الترحيلة لا تنفي مشكلة الصلاحيات صراحةً");
});

test("التصنيف يمرّ بالمصنِّف الموحّد لا بتخمين نصّيّ", () => {
  assert.match(LIB, /from "@\/lib\/portal\/pgerror"/, "لا استعمال للمصنِّف الموحّد");
  assert.match(LIB, /pgClassify|pgIsMigrationPending|pgMessageAr/, "لا استدعاء لدوالّ التصنيف");
  assert.doesNotMatch(LIB, /الترحيلة غير مطبّقة['"]?\s*[:=]/,
    "رسالة ترحيلة مكتوبة يدويًّا بدل المصنِّف");
});

test("كلّ سطح يمرّ بـStateView فيرث الحالات الثلاث تلقائيًّا", () => {
  assert.match(ATOMS, /export function StateView<T>/, "لا مكوّن حالة موحّد");
  for (const branch of ["needs_migration", "denied", "error"]) {
    assert.match(ATOMS, new RegExp(`st\\.state === "${branch}"`), `StateView لا يعالج ${branch}`);
  }
  assert.match(ATOMS, /export function MigrationPending/, "لا شاشة «بانتظار التفعيل»");
  assert.match(ATOMS, /export function Denied/, "لا شاشة منع");
  assert.match(ATOMS, /الميزة بانتظار تفعيل قاعدة البيانات/, "نصّ الانتظار غائب");
  assert.match(ATOMS, /ليست مشكلة في حسابك/, "شاشة الانتظار لا تطمئن المستخدم");
  assert.match(ATOMS, /لا تملك صلاحية/, "نصّ المنع غائب");
  // والشاشتان مختلفتان فعلًا
  const mig = ATOMS.match(/export function MigrationPending[\s\S]*?\n\}/)[0];
  const den = ATOMS.match(/export function Denied[\s\S]*?\n\}/)[0];
  assert.doesNotMatch(mig, /لا تملك صلاحية/, "شاشة الانتظار تقول «لا تملك صلاحية»");
  assert.doesNotMatch(den, /بانتظار تفعيل/, "شاشة المنع تدّعي ترحيلة ناقصة");
  for (const [name, src] of UI.filter(([n]) => n !== "CrmAtoms" && n !== "page")) {
    assert.match(src, /StateView/, `${name}: لا يمرّ بمكوّن الحالة`);
  }
});

test("كلّ استدعاء يمرّ بـtoState — لا مسار يتجاوز التصنيف", () => {
  const calls = [...LIB.matchAll(/prpc<[^>]*>\("(crm_[a-z_]+)"[^;]*?\)\s*\n?\s*\.then\(\(r\) => toState/g)];
  const raw = [...LIB.matchAll(/prpc<[^>]*>\("(crm_[a-z_]+)"/g)].map((m) => m[1]);
  const wrapped = new Set(calls.map((m) => m[1]));
  // الاستثناء الوحيد المسموح: النداء الخام الذي يعرض المطابقات كما هي، وهو
  // يستدعي toState صراحةً في كلّ مسار فشل.
  const rawFn = LIB.match(/export async function crmLeadUpsertRaw[\s\S]*?\n\}/)[0];
  assert.match(rawFn, /toState<never>\(r\)/, "النداء الخام لا يصنّف الفشل");
  for (const fn of raw) {
    assert.ok(wrapped.has(fn) || fn === "crm_lead_upsert", `${fn}: استدعاء بلا toState`);
  }
});

test("طبقة TS تغطّي كلّ دوالّ القاعدة العامّة — لا سطح بلا غلاف", () => {
  for (const f of [...READ_FNS, ...WRITE_FNS]) {
    assert.ok(LIB.includes(`"${f}"`), `لا غلاف TypeScript للدالّة ${f}`);
  }
});

test("أسباب الخادم تُترجَم ولا تُخترَع", () => {
  for (const reason of ["duplicate_suspected", "self_target_denied", "self_commission_denied",
                        "lost_reason_required", "already_converted", "handoff_recorded",
                        "idempotency_key_required", "project_not_found", "not_won"]) {
    assert.ok(LIB.includes(`"${reason}"`), `السبب ${reason} بلا ترجمة عربية`);
  }
  assert.match(LIB, /default:\s*return "تعذّر تنفيذ الطلب\."/, "لا حالة افتراضية صادقة");
  // ورسالة الخادم تُقدَّم على الترجمة المحلّية حين توجد
  assert.match(LIB, /String\(data\.message \?\? crmReasonAr/, "الواجهة تتجاهل رسالة الخادم");
});

// ─── عربيّ · RTL · جوّال ───────────────────────────────────────────────────

test("النصوص عربية، والمساحات لمسية، والأعمدة تمرّ داخل حاويتها", () => {
  for (const [name, src] of UI) {
    assert.match(src, /[؀-ۿ]{4,}/, `${name}: بلا نصّ عربيّ`);
  }
  assert.match(ATOMS, /min-h-\[44px\]/, "لا حدّ أدنى لمساحة اللمس (44px)");
  assert.match(ATOMS, /export function Scroller/, "لا حاوية تمرير أفقيّ");
  assert.match(ATOMS, /overflow-x-auto/, "الجداول ستدفع الصفحة للتمرير الأفقيّ");
  // التبويبات تمرّ أفقيًّا ولا تنكسر على 360px
  assert.match(CENTER, /overflow-x-auto/, "شريط التبويبات لا يمرّ أفقيًّا");
  assert.match(CENTER, /whitespace-nowrap/, "التبويبات تنكسر على الشاشة الضيّقة");
  // الأرقام المالية بأرقام لاتينية تُقرأ وتُنسخ
  assert.match(LIB, /toLocaleString\("en-US"/, "الأرقام المالية غير قابلة للنسخ بصيغة موحّدة");
  assert.match(LIB, /timeZone: "Asia\/Riyadh"/, "التواريخ بتوقيت UTC لا بتوقيت الرياض");
  // حقول البريد/الهاتف/المعرّفات باتجاه LTR داخل صفحة RTL
  for (const [name, src] of [["CrmCenter", CENTER], ["CrmOpportunityPanel", OPPP]]) {
    assert.match(src, /dir="ltr"/, `${name}: حقول لاتينية بلا dir="ltr" داخل RTL`);
  }
});

test("الحالات الفارغة والأخطاء لها شكل صريح — لا شاشة بيضاء", () => {
  assert.match(ATOMS, /export function Empty/, "لا مكوّن حالة فارغة");
  assert.match(ATOMS, /export function ErrorBox/, "لا مكوّن خطأ");
  assert.match(ATOMS, /export function Flash/, "لا رسالة عابرة موحّدة");
  for (const [name, src] of [["CrmCenter", CENTER], ["CrmLeadPanel", LEADP], ["CrmOpportunityPanel", OPPP]]) {
    assert.match(src, /Empty message=/, `${name}: بلا حالة فارغة صريحة`);
  }
  // ومهلة تمنع الدوران الأبديّ
  assert.match(ATOMS, /crm_timeout/, "لا مهلة للطلبات");
  assert.match(ATOMS, /انتهت المهلة/, "المهلة بلا رسالة مفهومة");
  assert.match(ATOMS, /mounted\.current/, "لا حارس ضدّ التحديث بعد إزالة المكوّن");
  assert.match(ATOMS, /my !== seq\.current/, "لا تسلسل للطلبات — ردّ قديم قد يغلب ردًّا جديدًا");
});

test("الواجهة تصرّح بحدود الصلاحية بدل إخفائها صامتة", () => {
  assert.match(CENTER, /يرى سجلّاته هو|يرى فريقه/, "شريط الصلاحيات لا يقول للمستخدم ما يراه");
  assert.match(CENTER, /يرى عمولته هو فقط/, "لا تصريح بحدّ العمولة");
  assert.match(CENTER, /ContractNote/, "لا ملاحظات عقد في الأماكن التي تُتوقَّع فيها أتمتة");
  assert.match(ATOMS, /export function ContractNote/, "لا مكوّن لملاحظة العقد");
  assert.match(OPPP, /خارج صلاحيتك/, "بطاقة الفرصة لا تشرح إخفاء العمولة");
});

test("الشاشة تعتمد على قدرات الخادم لا على تخمين الدور", () => {
  assert.match(CENTER, /acc\.can_manage/, "لا اعتماد على قدرات الخادم");
  assert.match(CENTER, /acc\.can_view_team/, "قدرة رؤية الفريق غير مقروءة من الخادم");
  assert.match(CENTER, /acc\.can_view_others_commission/, "قدرة رؤية العمولات غير مقروءة من الخادم");
  assert.match(CENTER, /acc\.quotes_available/, "توفّر طلبات الأسعار غير مكتشَف");
  assert.match(OPPP, /acc\.projects_available/, "توفّر جدول المشاريع غير مكتشَف");
  // ولا تخمين دور من نصّ محلّيّ
  assert.doesNotMatch(CENTER, /staff_role\s*===|account_type\s*===/,
    "الواجهة تخمّن الدور محلّيًّا بدل قراءة القدرات");
});

test("لا نداء خارجيّ ولا إرسال من الوحدة", () => {
  for (const [name, src] of UI) {
    assert.doesNotMatch(src, /fetch\(|XMLHttpRequest|WebSocket|sendBeacon/i,
      `${name}: نداء شبكة مباشر خارج طبقة العميل الموحّدة`);
    assert.doesNotMatch(src, /whatsapp\.com|api\.twilio|sendgrid|mailto:/i, `${name}: مسار إرسال خارجيّ`);
  }
  // ملاحظة: whatsapp_note نوع نشاط وحقل بيانات، لا قناة إرسال — الممنوع هو
  // النداء الخارجيّ نفسه.
  assert.doesNotMatch(LIB, /fetch\(|zoho|graph\.facebook|api\.whatsapp|https?:\/\//i,
    "طبقة TS تتّصل بخدمة خارجية");
});
