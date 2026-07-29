// ════════════════════════════════════════════════════════════════════════════
// tests/large_projects_progress.test.js — حرّاس محرّك التقدّم والجدولة والفلاتر.
//
// الدوالّ النقيّة تُستخرَج من lib/portal/large-projects.ts وتُنفَّذ فعليًّا هنا
// (أجسامها JavaScript صِرف عمدًا). نموذج مكتوب باليد كان سيثبت النموذج لا الكود،
// والخطأ الذي يخشاه المالك — احتساب «بانتظار الجدولة» متأخّرًا — لا يُكشَف إلا
// بتنفيذ الشيفرة المشحونة نفسها.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const LIB = read("lib/portal/large-projects.ts");

// جسم الدالّة = ما بين «{ يليها سطر جديد» وأوّل «}» في العمود صفر.
function bodyOf(src, name) {
  // القوس مقصود: "lpFilter" وحدها كانت تلتقط "lpFiltersActive" السابقة لها.
  const at = src.indexOf(`export function ${name}(`);
  assert.ok(at >= 0, `${name} غير موجودة`);
  const open = src.indexOf("{\n", at);
  const close = src.indexOf("\n}", open);
  assert.ok(open > 0 && close > open, `تعذّر استخراج جسم ${name}`);
  return src.slice(open + 1, close + 1);
}

const isAwaiting = new Function("d", bodyOf(LIB, "lpIsAwaitingSchedule"));
const isOverdueRaw = new Function("d", "todayISO", bodyOf(LIB, "lpIsOverdue"));
const isOverdue = (d, t) => new Function("d", "todayISO", "lpIsAwaitingSchedule",
  bodyOf(LIB, "lpIsOverdue"))(d, t, isAwaiting);
const weightOf = new Function("d", "maxWeight", bodyOf(LIB, "lpWeight"));
const fractionOf = new Function("d", "statusMap", bodyOf(LIB, "lpFraction"));
const isRecurring = new Function("d", bodyOf(LIB, "lpIsRecurring"));
const groupOf = new Function("d", bodyOf(LIB, "lpGroupOf"));
const stageIdOf = new Function("d", bodyOf(LIB, "lpStageIdOf"));
const typeOf = new Function("d", bodyOf(LIB, "lpTypeOf"));
// سقف الوزن يُقرأ من المصدر ولا يُكتب يدويًّا.
const MAX_W = Number((LIB.match(/LP_MAX_UNIT_WEIGHT = (\d+)/) || [])[1]);
assert.equal(Number.isFinite(MAX_W) && MAX_W > 0, true);
const w1 = (d) => weightOf(d, MAX_W);

const computeRaw = new Function("rows", "opts", "weightOf", "fractionOf", "recurringOf",
  bodyOf(LIB, "lpComputeProgress"));
const summarizeRaw = new Function("rows", "todayISO", "awaitingOf", "overdueOf", "recurringOf",
  bodyOf(LIB, "lpSummarize"));

// خريطة الحالة الحقيقية تُقرأ من المصدر — لا تُكرَّر يدويًّا.
const STATUS_FRACTION = (() => {
  const m = LIB.match(/LP_STATUS_FRACTION[^=]*=\s*\{([\s\S]*?)\n\};/);
  assert.ok(m, "LP_STATUS_FRACTION غير موجودة");
  const out = {};
  for (const pair of m[1].split(",")) {
    const kv = pair.match(/([a-z_]+)\s*:\s*([0-9.]+)/);
    if (kv) out[kv[1]] = Number(kv[2]);
  }
  return out;
})();

const progress = (rows, opts) => computeRaw(rows, { statusMap: STATUS_FRACTION, maxWeight: MAX_W, ...(opts || {}) },
  weightOf, fractionOf, isRecurring);
const counters = (rows, today) => summarizeRaw(rows, today, isAwaiting, isOverdue, isRecurring);

const TODAY = "2026-07-29";
const d = (o) => Object.assign({ id: "x", project_id: "p", title: "t", status: "draft" }, o);

// ─── (أ) «بانتظار الجدولة» — القاعدة الأهمّ ────────────────────────────────

test("بلا أيّ تاريخ ⇒ بانتظار الجدولة (يعمل على الأعمدة الأصلية قبل الترحيلة)", () => {
  assert.equal(isAwaiting(d({ due_date: null })), true);
  assert.equal(isAwaiting(d({})), true);
});

test("schedule_status الصريح يتقدّم على الاشتقاق في الاتجاهين", () => {
  assert.equal(isAwaiting(d({ schedule_status: "awaiting_schedule", due_date: "2020-01-01" })), true);
  assert.equal(isAwaiting(d({ schedule_status: "scheduled", due_date: null })), false);
});

test("وجود تاريخ بدء مخطَّط وحده يُخرِج المخرج من «بانتظار الجدولة»", () => {
  assert.equal(isAwaiting(d({ planned_start_date: "2026-08-01" })), false);
});

test("🔴 مخرج «بانتظار الجدولة» لا يُحسب متأخّرًا أبدًا — ولو حمل تاريخًا ماضيًا", () => {
  const late = d({ schedule_status: "awaiting_schedule", due_date: "2020-01-01" });
  assert.equal(isOverdue(late, TODAY), false, "غياب الالتزام ليس تأخّرًا");
  assert.equal(isOverdue(d({ due_date: null }), TODAY), false);
});

test("المجدول بتاريخ ماضٍ متأخّر، وبتاريخ قادم غير متأخّر", () => {
  assert.equal(isOverdue(d({ due_date: "2020-01-01" }), TODAY), true);
  assert.equal(isOverdue(d({ due_date: "2027-01-01" }), TODAY), false);
  assert.equal(isOverdue(d({ due_date: TODAY }), TODAY), false, "اليوم نفسه ليس تأخّرًا");
});

test("المسلَّم نهائيًّا والمؤرشف لا يُحسبان متأخّرَين", () => {
  assert.equal(isOverdue(d({ due_date: "2020-01-01", status: "final_delivered" }), TODAY), false);
  assert.equal(isOverdue(d({ due_date: "2020-01-01", status: "archived" }), TODAY), false);
  assert.equal(isOverdue(d({ due_date: "2020-01-01", status: "approved" }), TODAY), false,
    "المعتمد f=1 على الخادم ⇒ لا يُعدّ متأخّرًا (تطابق مع project_units_progress)");
  assert.equal(isOverdue(d({ due_date: "2020-01-01", schedule_status: "on_hold" }), TODAY), false,
    "المعلَّق ليس متأخّرًا");
  assert.equal(isOverdue(d({ due_date: "2020-01-01", schedule_status: "cancelled" }), TODAY), false,
    "الملغى ليس متأخّرًا");
  assert.equal(isOverdue(d({ due_date: "2020-01-01", schedule_status: "in_progress" }), TODAY), true,
    "قيد التنفيذ ومتجاوز التاريخ ⇒ متأخّر");
  assert.equal(isOverdue(d({ due_date: "2020-01-01", expected_units: 5, completed_units: 5 }), TODAY), false,
    "اكتملت وحداته ⇒ f=1 ⇒ ليس متأخّرًا");
});

test("الدالّة الأصلية (بلا حقن) تستدعي فحص «بانتظار الجدولة» داخليًّا", () => {
  assert.match(bodyOf(LIB, "lpIsOverdue"), /lpIsAwaitingSchedule\(d\)/,
    "استبعاد «بانتظار الجدولة» يجب أن يكون داخل lpIsOverdue نفسها لا في نداءاتها");
  assert.equal(typeof isOverdueRaw, "function");
});

// ─── (ب) الوزن والنسبة ─────────────────────────────────────────────────────

test("الوزن = expected_units حين يكون معلومًا موجبًا، وإلّا 1", () => {
  assert.equal(w1(d({})), 1);
  assert.equal(w1(d({ expected_units: 12 })), 12);
  assert.equal(w1(d({ expected_units: 0 })), 1);
  assert.equal(w1(d({ expected_units: null })), 1);
  assert.equal(w1(d({ expected_units: -4 })), 1);
  assert.equal(w1(d({ expected_units: 999999 })), MAX_W,
    "سقف الوزن يمنع خطأ إدخال واحد من محو بقية المخرجات من المعادلة");
});

test("النسبة: الوحدات حين تُعرف، وإلّا خريطة الحالة، ومحصورة في [0,1]", () => {
  assert.equal(fractionOf(d({ expected_units: 10, completed_units: 5 }), STATUS_FRACTION), 0.5);
  assert.equal(fractionOf(d({ expected_units: 10, completed_units: 40 }), STATUS_FRACTION), 1);
  assert.equal(fractionOf(d({ status: "draft" }), STATUS_FRACTION), 0);
  assert.equal(fractionOf(d({ status: "client_review" }), STATUS_FRACTION), STATUS_FRACTION.client_review);
  assert.equal(fractionOf(d({ status: "approved" }), STATUS_FRACTION), 1, "المعتمد مُنجَز على الخادم");
  assert.equal(fractionOf(d({ status: "draft", completed_units: 3 }), STATUS_FRACTION), 0.5,
    "وحدات منجَزة بلا هدف معلوم لا تُخفض النسبة ولا تمنح 100%");
  assert.equal(fractionOf(d({ status: "final_delivered", expected_units: 10, completed_units: 0 }), STATUS_FRACTION), 1,
    "التسليم النهائيّ يتقدّم على عدّاد الوحدات");
  assert.equal(fractionOf(d({ status: "حالة_غريبة" }), STATUS_FRACTION), 0, "حالة غير معروفة ⇒ صفر لا NaN");
});

// ─── (ج) التقدّم الموزون — لا متوسّط نِسَب ─────────────────────────────────

test("🔴 الوزن بالمخرجات لا بمتوسّط المراحل: 1 منجَز مقابل 9 صفر = 10% لا 50%", () => {
  const stageA = [d({ status: "final_delivered" })];
  const stageB = Array.from({ length: 9 }, () => d({ status: "draft" }));
  const naiveAverage = (progress(stageA).pct + progress(stageB).pct) / 2;
  assert.equal(naiveAverage, 50, "المتوسّط الساذج (المرفوض) يعطي 50");
  assert.equal(progress([...stageA, ...stageB]).pct, 10, "الحساب الموزون يعطي 10");
});

test("الوحدات تُثقِّل الوزن: مخرج متكرّر بعشر وحدات يساوي عشرة مخرجات", () => {
  const rec = d({ expected_units: 10, completed_units: 10, recurrence_type: "weekly" });
  const singles = Array.from({ length: 10 }, () => d({ status: "draft" }));
  assert.equal(progress([rec, ...singles]).pct, 50);
  assert.equal(progress([rec]).weight, 10);
});

test("مرحلة فارغة ⇒ «غير متاح» (null) لا صفر، ووزنها صفر فلا تُشوِّه الأب", () => {
  const empty = progress([]);
  assert.equal(empty.pct, null);
  assert.equal(empty.weight, 0);
  assert.equal(empty.method, "no_countable_deliverables");
  // مشروع فيه مرحلة كاملة ومرحلة فارغة يبقى 100%
  assert.equal(progress([d({ status: "final_delivered" })]).pct, 100);
});

test("المؤرشف يُستبعَد من البسط والمقام معًا", () => {
  const rows = [d({ status: "final_delivered" }), d({ status: "archived" })];
  const p = progress(rows);
  assert.equal(p.pct, 100, "المؤرشف لا يخفض النسبة");
  assert.equal(p.counted, 1);
  assert.equal(p.excluded, 1);
  assert.equal(progress([d({ status: "archived" })]).pct, null, "مؤرشف فقط ⇒ غير متاح");
  const withCancelled = progress([d({ status: "final_delivered" }), d({ schedule_status: "cancelled" })]);
  assert.equal(withCancelled.pct, 100, "الملغى جدولته يخرج من المعادلة كالمؤرشف");
  assert.equal(withCancelled.excluded, 1);
});

test("المتكرّر بلا expected_units: وزن 1 مع تعليم النتيجة «تقديرية»", () => {
  const p = progress([d({ recurrence_type: "monthly", status: "draft" })]);
  assert.equal(p.weight, 1);
  assert.equal(p.estimated, true);
  assert.equal(p.method, "units_weighted_estimated");
  assert.equal(progress([d({ recurrence_type: "monthly", expected_units: 4 })]).estimated, false);
});

test("المشروع المُغلق يحتفظ بنتيجته المخزَّنة ولا يُعاد حسابها", () => {
  const rows = [d({ status: "draft" })];
  const p = progress(rows, { closed: true, frozenPct: 87 });
  assert.equal(p.pct, 87);
  assert.equal(p.frozen, true);
  assert.equal(p.method, "closed_frozen");
  // مُغلق بلا نتيجة مخزَّنة ⇒ يُحسب عاديًّا بدل إخفاء الرقم
  assert.equal(progress(rows, { closed: true, frozenPct: null }).frozen, false);
});

test("لا NaN ولا انهيار على مدخلات فاسدة", () => {
  const p = progress([null, undefined, d({ expected_units: "abc" })]);
  assert.equal(Number.isFinite(p.pct), true);
  assert.equal(progress(null).pct, null);
});

// ─── (د) العدّادات ─────────────────────────────────────────────────────────

test("العدّادات: «بانتظار الجدولة» يُعدّ منفصلًا ولا يدخل المتأخّر", () => {
  const rows = [
    d({ schedule_status: "awaiting_schedule", due_date: "2020-01-01" }),
    d({ due_date: "2020-01-01" }),
    d({ due_date: "2026-08-02", status: "client_review" }),
    d({ status: "internal_review" }),
    d({ status: "revision_requested", due_date: "2027-01-01" }),
    d({ status: "approved", due_date: "2027-01-01" }),
    d({ status: "final_delivered", due_date: "2020-01-01" }),
  ];
  const c = counters(rows, TODAY);
  assert.equal(c.total, 7);
  assert.equal(c.overdue, 1, "المتأخّر الحقيقيّ واحد فقط");
  assert.equal(c.awaiting_schedule, 2, "الصفّ الأوّل صريح والرابع مشتقّ (بلا تاريخ)");
  assert.equal(c.waiting_for_client, 1);
  assert.equal(c.waiting_for_internal_review, 1);
  assert.equal(c.revision_requested, 1);
  assert.equal(c.approved, 1);
  assert.equal(c.final_delivered, 1);
  assert.equal(c.by_status.draft, 2);
  assert.equal(c.due_soon, 1, "خلال سبعة أيام: 2026-08-02 فقط");
});

test("عدّاد «بلا مسؤول» و«مخفيّ عن العميل» و«متكرّر»", () => {
  const c = counters([
    d({ assignee_id: "u1", client_visible: false }),
    d({ assignee_id: null, recurrence_type: "weekly" }),
    d({ assignee_id: "u2", client_visible: true }),
  ], TODAY);
  assert.equal(c.unassigned, 1);
  assert.equal(c.hidden_from_client, 1);
  assert.equal(c.recurring, 1);
});

// ─── (هـ) الفلاتر ──────────────────────────────────────────────────────────

const setOfSrc = LIB.match(/const lpSetOf =[\s\S]*?;\n/);
assert.ok(setOfSrc, "lpSetOf غير موجودة");
const lpSetOf = (a) => (a && a.length ? new Set(a) : null);
const REQ_COL = { shooting: "requires_shooting", editing: "requires_editing", design: "requires_design", printing: "requires_printing" };
// رمز «بلا مسؤول» يُقرأ من المصدر لا يُكتب يدويًّا.
const LP_UNASSIGNED = (LIB.match(/LP_UNASSIGNED = "([^"]+)"/) || [])[1];
assert.equal(typeof LP_UNASSIGNED, "string");
const filterRows = new Function(
  "rows", "f", "todayISO", "lpSetOf", "lpTodayISO", "lpIsAwaitingSchedule", "lpIsOverdue", "lpIsRecurring",
  "REQ_COL", "LP_UNASSIGNED", "lpStageIdOf", "lpGroupOf", "lpTypeOf",
  bodyOf(LIB, "lpFilter"));
const filter = (rows, f) => filterRows(rows, f, TODAY, lpSetOf, () => TODAY, isAwaiting, isOverdue, isRecurring,
  REQ_COL, LP_UNASSIGNED, stageIdOf, groupOf, typeOf);

test("فلتر «متأخّر» لا يلتقط «بانتظار الجدولة» أبدًا", () => {
  const rows = [
    d({ id: "a", schedule_status: "awaiting_schedule", due_date: "2020-01-01" }),
    d({ id: "b", due_date: "2020-01-01" }),
  ];
  assert.deepEqual(filter(rows, { overdue: true }).map((x) => x.id), ["b"]);
  assert.deepEqual(filter(rows, { awaitingSchedule: true }).map((x) => x.id), ["a"]);
});

test("فلاتر الحالة/النوع/الأولوية/المرحلة/المجموعة", () => {
  const rows = [
    d({ id: "a", status: "approved", content_type: "video", priority: "high", project_id: "m", stage_id: "s1", metadata: { group: "g1" } }),
    d({ id: "b", status: "draft", type: "print", priority: "low", project_id: "s2", metadata: { group: "g2" } }),
  ];
  assert.deepEqual(filter(rows, { statuses: ["approved"] }).map((x) => x.id), ["a"]);
  assert.deepEqual(filter(rows, { types: ["print"] }).map((x) => x.id), ["b"], "نوع خارج video/photo/other يمرّ");
  assert.deepEqual(filter(rows, { priorities: ["low"] }).map((x) => x.id), ["b"]);
  assert.deepEqual(filter(rows, { stageIds: ["s1"] }).map((x) => x.id), ["a"],
    "المرحلة تُقرأ من stage_id لا من project_id");
  assert.deepEqual(filter(rows, { stageIds: ["s2"] }).map((x) => x.id), ["b"],
    "وعند غياب stage_id يقع الاحتياطيّ على project_id");
  assert.deepEqual(filter(rows, { stageGroups: ["g2"] }).map((x) => x.id), ["b"]);
});

test("المنصّات «أيّ تطابق»، والمتطلّبات «كلّها معًا»", () => {
  const rows = [
    d({ id: "a", platforms: ["instagram", "x"], requires_shooting: true, requires_editing: true }),
    d({ id: "b", platforms: ["tiktok"], requires_shooting: true }),
    d({ id: "c", platforms: null }),
  ];
  assert.deepEqual(filter(rows, { platforms: ["x", "tiktok"] }).map((x) => x.id), ["a", "b"]);
  assert.deepEqual(filter(rows, { requires: ["shooting", "editing"] }).map((x) => x.id), ["a"]);
  assert.deepEqual(filter(rows, { requires: ["shooting"] }).map((x) => x.id), ["a", "b"]);
  assert.deepEqual(filter(rows, { platforms: ["snapchat"] }).map((x) => x.id), []);
});

test("المسؤول: رمز «بلا مسؤول» يعمل، وظهور العميل ثلاثيّ الحالة", () => {
  const rows = [
    d({ id: "a", assignee_id: "u1", client_visible: true }),
    d({ id: "b", assignee_id: null, client_visible: false }),
  ];
  assert.deepEqual(filter(rows, { assignees: ["__none__"] }).map((x) => x.id), ["b"]);
  assert.deepEqual(filter(rows, { assignees: ["u1"] }).map((x) => x.id), ["a"]);
  assert.deepEqual(filter(rows, { clientVisibility: "hidden" }).map((x) => x.id), ["b"]);
  assert.deepEqual(filter(rows, { clientVisibility: "visible" }).map((x) => x.id), ["a"]);
  assert.deepEqual(filter(rows, { clientVisibility: "any" }).map((x) => x.id), ["a", "b"]);
});

test("البحث يشمل العنوان والمفتاح الخارجيّ والمجموعة", () => {
  const rows = [
    d({ id: "a", title: "إعلان افتتاح" }),
    d({ id: "b", title: "x", external_key: "ROW-42" }),
    d({ id: "c", title: "y", metadata: { group: "المرحلة الثانية" } }),
  ];
  assert.deepEqual(filter(rows, { search: "افتتاح" }).map((x) => x.id), ["a"]);
  assert.deepEqual(filter(rows, { search: "row-42" }).map((x) => x.id), ["b"]);
  assert.deepEqual(filter(rows, { search: "الثانية" }).map((x) => x.id), ["c"]);
});

test("فلاتر مركّبة تعمل معًا، والفلتر الفارغ يعيد كلّ شيء", () => {
  const rows = [
    d({ id: "a", status: "client_review", due_date: "2020-01-01", project_id: "s1" }),
    d({ id: "b", status: "client_review", due_date: null, project_id: "s1" }),
  ];
  assert.deepEqual(filter(rows, { waitingForClient: true, overdue: true }).map((x) => x.id), ["a"]);
  assert.equal(filter(rows, {}).length, 2);
});

// ─── (و) أداء: خطّيّ لا تربيعيّ ────────────────────────────────────────────

test("مئتا مخرج: الترشيح والعدّ والتقدّم في زمن خطّيّ", () => {
  const rows = Array.from({ length: 200 }, (_, i) => d({
    id: `d${i}`, project_id: `s${i % 10}`, status: i % 3 === 0 ? "draft" : "client_review",
    due_date: i % 4 === 0 ? null : "2020-01-01", platforms: ["instagram"],
  }));
  const t0 = Date.now();
  for (let i = 0; i < 50; i++) {
    filter(rows, { statuses: ["client_review"], platforms: ["instagram"] });
    counters(rows, TODAY);
    progress(rows);
  }
  assert.ok(Date.now() - t0 < 2000, "الحساب المتكرّر بطيء — يُرجَّح عمل تربيعيّ");
});

// ─── (ز) حرّاس نصّية على المصدر ────────────────────────────────────────────

test("لا كتابة مباشرة في الجداول من المتصفّح (لا ppatch/ppost)", () => {
  assert.doesNotMatch(LIB, /\bppatch\b|\bppost\b/, "الكتابة يجب أن تمرّ بـ RPC يتحقّق ويكتب أثر تدقيق");
});

test("الإجراء الجماعيّ يتوقّف على الدالّة، ويفرض السبب، ويقسّم الدفعات", () => {
  assert.match(LIB, /if \(!caps\.bulk\) return \{ ok: false, error: "bulk_rpc_missing" \}/);
  assert.match(LIB, /if \(!reason \|\| !reason\.trim\(\)\) return \{ ok: false, error: "reason_required" \}/);
  assert.match(LIB, /LP_BULK_CHUNK/);
  assert.match(LIB, /LP_BULK_CONFIRM_THRESHOLD = \d+/);
});

test("النتيجة المجهولة لا تُعدّ نجاحًا، والعنصر بلا ردّ يُعدّ فاشلًا", () => {
  assert.match(LIB, /detailUnknown: true/);
  assert.match(LIB, /if \(merged\.detailUnknown\) merged\.applied = 0;/);
  assert.match(LIB, /ok: false, error: "no_response"/);
});

test("فحص الدالّة الجماعية لا يُعدّل شيئًا (قائمة فارغة + dry run)", () => {
  const probe = LIB.match(/async function probeBulkRpc[\s\S]*?\n}/);
  assert.ok(probe, "probeBulkRpc غير موجودة");
  assert.match(probe[0], /p_ids: \[\]/);
  assert.match(probe[0], /p_dry_run: true/);
});

test("تصنيف أخطاء الترحيلة الثلاثة موجود (دالّة/عمود/جدول)", () => {
  assert.match(LIB, /PGRST202/);
  assert.match(LIB, /PGRST204\|42703/);
  assert.match(LIB, /PGRST205\|42P01/);
});

test("الحفظ بلا تاريخ مسموح: لا رفض، ويعود إلى «بانتظار الجدولة»", () => {
  const patch = LIB.match(/case "set_schedule": \{[\s\S]*?\n    \}/);
  assert.ok(patch, "فرع set_schedule غير موجود");
  assert.match(patch[0], /due_date: a\.due_date \?\? null/);
  assert.match(patch[0], /"scheduled" : "awaiting_schedule"/);
  assert.doesNotMatch(patch[0], /throw|return null/, "لا يجوز رفض الحفظ بلا تاريخ");
});

test("اسم «مدير المشروع» لا يُلتقط من دور عميل (client_owner)", () => {
  const fn = LIB.match(/async function fetchManagerName[\s\S]*?\n}/);
  assert.ok(fn, "fetchManagerName غير موجودة");
  assert.match(fn[0], /filter\(\(m\) => !\/client\/i\.test/, "أدوار العميل يجب أن تُستبعَد أوّلًا");
  assert.doesNotMatch(fn[0], /\?\? rows\[0\]/, "لا يجوز اللجوء إلى أوّل عضو أيًّا كان دوره");
  // محاكاة الاختيار على مفردات الأدوار الحقيقية
  const rows = [{ user_id: "c", role: "client_owner" }, { user_id: "m", role: "kian_manager" }]
    .filter((m) => !/client/i.test(m.role));
  const pick = rows.find((m) => /manager/i.test(m.role)) ?? null;
  assert.equal(pick.user_id, "m");
  const onlyClient = [{ user_id: "c", role: "client_owner" }].filter((m) => !/client/i.test(m.role));
  assert.equal(onlyClient.length, 0, "مشروع بعضو عميل فقط ⇒ «غير محدَّد» لا اسم العميل");
});

test("قرار العمق الهرميّ موثَّق في الكود ومستواه اثنان", () => {
  assert.match(LIB, /LP_HIERARCHY_MAX_DEPTH = 2/);
  assert.match(LIB, /LP_THIRD_LEVEL_MODEL = "metadata\.group"/);
  assert.match(LIB, /parent_must_be_master/, "يجب توثيق دليل منع المستوى الثالث");
  assert.match(LIB, /only_standalone_can_be_promoted/);
});

test("لا مفردات مخترعة: قيم الحالة هي قيم قاعدة البيانات وحدها", () => {
  const m = LIB.match(/export const LP_STATUSES[^=]*=\s*\[([\s\S]*?)\];/);
  assert.ok(m);
  const vals = [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]).sort();
  assert.deepEqual(vals, ["approved", "archived", "client_review", "draft",
    "final_delivered", "internal_review", "revision_requested"]);
});

test("لا أثر لأيّ مشروع بعينه في قلب المنصّة", () => {
  assert.doesNotMatch(LIB, /misbar|مسبار/i, "اسم مشروع بعينه ممنوع في الوحدة العامّة");
  assert.doesNotMatch(LIB, /\b(11|79)\s*(stages|deliverables|مرحلة|مخرج)/i);
});
