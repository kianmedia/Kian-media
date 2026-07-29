// ════════════════════════════════════════════════════════════════════════════
// tests/large_projects_schema_contract.test.js
//
// حادثة الإنتاج 2026-07-28: لوحة المشروع الكبير كانت تطلب `projects.due_date` —
// عمود لم يوجد قطّ على الجدول — فيعود 400 / 42703 مرّتين، وتظهر رسالة كاذبة
// «الترحيل معلّق» بينما الترحيلة مطبَّقة بالكامل. الموعد النهائيّ للمشروع يعيش
// على public.project_core.due_date وحده.
//
// هذه الاختبارات **تُنفّذ الشيفرة المشحونة فعلًا** (عبر sucrase) مع بديل لـ pget
// يلتقط كلّ طلب PostgREST حرفيًّا. أي عودة للخلل تُسقِط هذا الملفّ فورًا:
//   • أي `select=` على projects يذكر due_date  ⇒ فشل
//   • غياب due_date من طلب project_core       ⇒ فشل
//   • احتساب «بانتظار الجدولة» متأخّرًا          ⇒ فشل
//   • «الترحيل معلّق» على مخطّط كامل            ⇒ فشل
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ROOT, TS_AVAILABLE, loadTs } = require("./import_engine_loader.js");

const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

// ─── تحميل الوحدة الحقيقية واعتراض طبقة الشبكة ─────────────────────────────
const lp = TS_AVAILABLE ? loadTs("lib/portal/large-projects.ts") : null;
const client = TS_AVAILABLE ? loadTs("lib/portal/client.ts") : null;

/** كلّ الطلبات التي أصدرتها الوحدة في السيناريو الجاري. */
let CALLS = [];
/** مُوجِّه السيناريو: (query) => Result. */
let ROUTE = () => ({ ok: true, data: [] });

if (TS_AVAILABLE) {
  client.pget = async (q) => { CALLS.push(String(q)); return ROUTE(String(q)); };
  client.prpc = async (fn) => { CALLS.push(`rpc:${fn}`); return { ok: true, data: null }; };
}

const PROJ = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const CHILD = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const PARENT = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";

/** يبني موجِّهًا لسيناريو واحد ويصفّر الالتقاط والقدرات المخزَّنة. */
function scenario({ projectRows, coreRows = [], hierarchy = true }) {
  CALLS = [];
  lp.lpResetCapabilities();
  ROUTE = (q) => {
    // فحص القدرات: أعمدة الهرمية على projects
    if (/^projects\?select=id,parent_project_id,project_scope/.test(q)) {
      return hierarchy ? { ok: true, data: [] }
        : { ok: false, error: 'column projects.parent_project_id does not exist', status: 400 };
    }
    if (/^projects\?/.test(q)) return { ok: true, data: projectRows };
    if (/^project_core\?/.test(q)) return { ok: true, data: coreRows };
    return { ok: true, data: [] };
  };
}

/** كلّ طلبات جدول public.projects التي حملت select= (بلا فحص القدرات). */
const projectSelects = () =>
  CALLS.filter((q) => /^projects\?/.test(q) && !/^projects\?select=id,parent_project_id,project_scope/.test(q));

const coreSelects = () => CALLS.filter((q) => /^project_core\?/.test(q));

const skip = { skip: TS_AVAILABLE ? false : "sucrase unavailable" };

// ════════════════════════════════════════════════════════════════════════════
// (١) اللوحة لا تطلب projects.due_date — لا في الشيفرة ولا على السلك
// ════════════════════════════════════════════════════════════════════════════
test("1. لا يُطلب projects.due_date من أيّ استعلام تُصدره اللوحة", skip, async () => {
  scenario({
    projectRows: [{ id: PROJ, project_name: "P", status: "active", client_id: null, created_at: "2026-01-01", parent_project_id: null, project_scope: "master" }],
  });
  const r = await lp.lpLoadSnapshot(PROJ);
  assert.equal(r.ok, true, "اللقطة يجب أن تنجح");

  const sels = projectSelects();
  assert.ok(sels.length > 0, "لا استعلام على projects — الاختبار بلا معنى");
  for (const q of sels) {
    const list = /[?&]select=([^&]*)/.exec(q);
    assert.ok(list, `استعلام projects بلا select: ${q}`);
    const cols = list[1].split(",");
    assert.equal(cols.includes("due_date"), false,
      `★ عودة الخلل: استعلام projects يطلب due_date ⇒ 400/42703 — ${q}`);
  }

  // وحارس نصّي على المصدر: الثابت نفسه يجب ألّا يحمل الاسم.
  const LIB = read("lib/portal/large-projects.ts");
  const m = /LP_PROJECT_COLUMNS = \[([^\]]*)\]/.exec(LIB);
  assert.ok(m, "LP_PROJECT_COLUMNS غير موجود");
  assert.equal(/due_date/.test(m[1]), false, "★ due_date عاد إلى LP_PROJECT_COLUMNS");
  const h = /LP_PROJECT_HIERARCHY_COLUMNS = \[([^\]]*)\]/.exec(LIB);
  assert.equal(/due_date/.test(h ? h[1] : ""), false, "★ due_date في أعمدة الهرمية");
});

// ════════════════════════════════════════════════════════════════════════════
// (٢) الموعد النهائيّ يُطلب من project_core — المصدر الوحيد
// ════════════════════════════════════════════════════════════════════════════
test("2. الموعد النهائيّ يُطلب من project_core.due_date", skip, async () => {
  scenario({
    projectRows: [{ id: PROJ, project_name: "P", status: "active", client_id: null, created_at: "2026-01-01", parent_project_id: null, project_scope: "master" }],
    coreRows: [{ project_id: PROJ, core_stage: "in_production", progress_pct: 40, project_type: "campaign", health: "on_track", due_date: "2026-07-25" }],
  });
  const r = await lp.lpLoadSnapshot(PROJ);
  assert.equal(r.ok, true);

  const core = coreSelects();
  assert.equal(core.length, 1, "طلب project_core واحد بالضبط");
  const cols = /[?&]select=([^&]*)/.exec(core[0])[1].split(",");
  assert.ok(cols.includes("due_date"), "project_core لا يطلب due_date");
  assert.ok(cols.includes("project_id"), "project_core لا يطلب project_id");
  assert.equal(r.data.coreByProject[PROJ].due_date, "2026-07-25");
  // ولا طلب إضافيّ للموعد: الرقم جاء من الطلب نفسه.
  assert.equal(coreSelects().length, 1);
});

// ════════════════════════════════════════════════════════════════════════════
// (٣) فتح مشروع رئيسيّ (or=(...)) ينجح  ·  (٥) وشكل الاستعلام سليم
// ════════════════════════════════════════════════════════════════════════════
test("3. فتح مشروع رئيسيّ بفروعه ينجح", skip, async () => {
  scenario({
    projectRows: [
      { id: PROJ, project_name: "الرئيسيّ", status: "active", client_id: null, created_at: "2026-01-01", parent_project_id: null, project_scope: "master" },
      { id: CHILD, project_name: "مرحلة ١", status: "active", client_id: null, created_at: "2026-01-02", parent_project_id: PROJ, project_scope: "subproject" },
    ],
    coreRows: [
      { project_id: PROJ, core_stage: "in_production", progress_pct: 10, project_type: null, health: "on_track", due_date: "2026-07-25" },
      { project_id: CHILD, core_stage: "planning", progress_pct: 0, project_type: null, health: "on_track", due_date: null },
    ],
  });
  const r = await lp.lpLoadSnapshot(PROJ);
  assert.equal(r.ok, true, `فشل فتح المشروع الرئيسيّ: ${r.error}`);
  assert.equal(r.data.project.id, PROJ);
  assert.equal(r.data.stages.length, 2, "المرحلتان: المشروع نفسه + الفرع");
  assert.equal(r.data.stages[0].is_master, true);
});

test("5. استعلام or=(...) على projects حسن التكوين", skip, async () => {
  scenario({
    projectRows: [{ id: PROJ, project_name: "P", status: "active", client_id: null, created_at: "2026-01-01", parent_project_id: null, project_scope: "master" }],
  });
  await lp.lpLoadSnapshot(PROJ);
  const q = projectSelects().find((s) => s.includes("or=("));
  assert.ok(q, "لم يُصدر استعلام or=(...) رغم توفّر أعمدة الهرمية");
  // الأقواس متوازنة، والشرطان بصيغة PostgREST الصحيحة، والمرشّح والترتيب حاضران.
  assert.match(q, /^projects\?or=\(id\.eq\.[^,()]+,parent_project_id\.eq\.[^,()]+\)&is_deleted=eq\.false&select=[a-z_,]+&order=created_at\.asc$/);
  assert.equal((q.match(/\(/g) || []).length, (q.match(/\)/g) || []).length, "أقواس غير متوازنة");
  // قائمة الأعمدة: أسماء sql صالحة فقط، ولا اسم فارغ (فاصلة مزدوجة/معلّقة).
  const cols = /[?&]select=([^&]*)/.exec(q)[1].split(",");
  for (const c of cols) assert.match(c, /^[a-z][a-z0-9_]*$/, `اسم عمود غير صالح: "${c}"`);
});

// ════════════════════════════════════════════════════════════════════════════
// (٤) فتح مشروع فرعيّ (id=eq.) ينجح  ·  (٦) وشكل الاستعلام سليم
// ════════════════════════════════════════════════════════════════════════════
test("4. فتح مشروع فرعيّ ينجح (المسار بلا هرمية)", skip, async () => {
  scenario({
    hierarchy: false,
    projectRows: [{ id: CHILD, project_name: "فرع", status: "active", client_id: null, created_at: "2026-01-02" }],
    coreRows: [{ project_id: CHILD, core_stage: "planning", progress_pct: 5, project_type: null, health: "on_track", due_date: "2026-08-01" }],
  });
  const r = await lp.lpLoadSnapshot(CHILD);
  assert.equal(r.ok, true, `فشل فتح المشروع الفرعيّ: ${r.error}`);
  assert.equal(r.data.project.id, CHILD);
  assert.equal(r.data.stages.length, 1);
  assert.equal(r.data.stages[0].due_date, "2026-08-01");
});

test("6. استعلام المشروع بالمعرّف حسن التكوين", skip, async () => {
  scenario({
    hierarchy: false,
    projectRows: [{ id: CHILD, project_name: "فرع", status: "active", client_id: null, created_at: "2026-01-02" }],
  });
  await lp.lpLoadSnapshot(CHILD);
  const q = projectSelects().find((s) => s.startsWith("projects?id=eq."));
  assert.ok(q, "لم يُصدر استعلام id=eq.");
  assert.match(q, /^projects\?id=eq\.[^&]+&is_deleted=eq\.false&select=id,project_name,status,client_id,created_at$/);
  assert.equal(/due_date/.test(q), false, "★ due_date في استعلام المشروع بالمعرّف");
});

// ════════════════════════════════════════════════════════════════════════════
// (٧) مشروع له موعد ⇒ القيمة الصحيحة   (٨) بلا موعد ⇒ null / «غير محدَّد»
// ════════════════════════════════════════════════════════════════════════════
test("7. مشروع له موعد نهائيّ يعرض القيمة الصحيحة", skip, async () => {
  scenario({
    projectRows: [{ id: PROJ, project_name: "P", status: "active", client_id: null, created_at: "2026-01-01", parent_project_id: null, project_scope: "master" }],
    coreRows: [{ project_id: PROJ, core_stage: "in_production", progress_pct: 40, project_type: null, health: "on_track", due_date: "2026-07-25" }],
  });
  const r = await lp.lpLoadSnapshot(PROJ);
  assert.equal(r.data.stages[0].due_date, "2026-07-25");
  assert.equal(lp.lpProjectDueDate(r.data.coreByProject, PROJ), "2026-07-25");
  assert.equal(lp.lpDueLabel(r.data.stages[0].due_date), "2026-07-25");
  assert.equal(lp.lpDueLabel("2026-07-25T00:00:00+03:00"), "2026-07-25", "الطابع الزمنيّ يُقصّ إلى يوم");
});

test("8. مشروع بلا موعد ⇒ null و«غير محدَّد» — لا تاريخ مُختلَق ولا انهيار", skip, async () => {
  scenario({
    projectRows: [{ id: PROJ, project_name: "P", status: "active", client_id: null, created_at: "2026-01-01", parent_project_id: null, project_scope: "master" }],
    coreRows: [{ project_id: PROJ, core_stage: "planning", progress_pct: 0, project_type: null, health: "on_track", due_date: null }],
  });
  const r = await lp.lpLoadSnapshot(PROJ);
  assert.equal(r.ok, true);
  assert.equal(r.data.stages[0].due_date, null);
  assert.equal(lp.lpProjectDueDate(r.data.coreByProject, PROJ), null);
  assert.equal(lp.lpDueLabel(null), "غير محدَّد");
  assert.equal(lp.lpDueLabel(undefined), "غير محدَّد");
  assert.equal(lp.lpDueLabel(null, "en"), "Not set");
  // ومشروع لا صفّ له في project_core إطلاقًا (لم يُهيَّأ بعد) ⇒ null لا استثناء.
  assert.equal(lp.lpProjectDueDate(r.data.coreByProject, "no-such-project"), null);
  assert.equal(lp.lpProjectDueDate({}, PROJ), null);
  assert.equal(/\d{4}-\d{2}-\d{2}/.test(lp.lpDueLabel(null)), false, "★ تاريخ مُختلَق عند غياب الموعد");

  // والواجهة تعرضه فعلًا عبر lpDueLabel — لا خانة فارغة غامضة.
  const UI = read("components/portal/LargeProjectDashboard.tsx");
  assert.match(UI, /lpDueLabel\(stage\.due_date/, "اللوحة لا تعرض الموعد عبر lpDueLabel");
});

// ════════════════════════════════════════════════════════════════════════════
// (٩) «بانتظار الجدولة» ليست تأخّرًا — الواجهة والخادم معًا
// ════════════════════════════════════════════════════════════════════════════
test("9. awaiting_schedule لا يُحتسب متأخّرًا أبدًا", skip, () => {
  const past = "1999-01-01";
  const today = "2026-07-28";
  // (أ) صريحة: حتى مع تاريخ ماضٍ.
  assert.equal(lp.lpIsOverdue({ schedule_status: "awaiting_schedule", due_date: past, status: "draft" }, today), false);
  // (ب) مشتقّة: لا تاريخ ولا بداية مخطّطة.
  assert.equal(lp.lpIsAwaitingSchedule({ due_date: null, planned_start_date: null }), true);
  assert.equal(lp.lpIsOverdue({ due_date: null, planned_start_date: null, status: "draft" }, today), false);
  // (ج) المعلَّق والملغى كذلك.
  assert.equal(lp.lpIsOverdue({ schedule_status: "on_hold", due_date: past, status: "draft" }, today), false);
  assert.equal(lp.lpIsOverdue({ schedule_status: "cancelled", due_date: past, status: "draft" }, today), false);
  // (د) الضدّ: مجدول بتاريخ ماضٍ = متأخّر فعلًا (وإلا لم يكن الاختبار ذا معنى).
  assert.equal(lp.lpIsOverdue({ schedule_status: "scheduled", due_date: past, status: "draft" }, today), true);
  // (هـ) والعدّاد لا يعدّه.
  const c = lp.lpCounters([
    { id: "1", status: "draft", schedule_status: "awaiting_schedule", due_date: past },
    { id: "2", status: "draft", schedule_status: "scheduled", due_date: past },
  ], today);
  assert.equal(c.overdue, 1, "★ «بانتظار الجدولة» دخل عدّاد التأخير");
  assert.equal(c.awaiting_schedule, 1);

  // (و) الخادم: شرط التأخير في SQL مقصور على scheduled/in_progress.
  const SQL = read("docs/project_platform_large_projects_RUNME.sql");
  const overdueClauses = SQL.match(/coalesce\(schedule_status,'awaiting_schedule'\) in \([^)]*\)\s*\n\s*and due_date is not null and due_date < v_today/g) || [];
  assert.ok(overdueClauses.length >= 2, "لم يُعثر على شرطَي التأخير في الخادم");
  for (const cl of overdueClauses) {
    assert.equal(/'awaiting_schedule'\s*,|,\s*'awaiting_schedule'/.test(cl.replace("coalesce(schedule_status,'awaiting_schedule')", "")), false,
      "★ awaiting_schedule صار ضمن حالات التأخير في الخادم");
    assert.match(cl, /in \('scheduled','in_progress'\)/);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// (١٠) مخطّط كامل ⇒ لا «الترحيل معلّق»
// ════════════════════════════════════════════════════════════════════════════
test("10. لا رسالة «الترحيل معلّق» حين يكون المخطّط كاملًا", skip, () => {
  // 42703 ليس ترحيلة معلّقة — هذا جوهر الحادثة.
  assert.equal(lp.lpIsMigrationPending(lp.lpClassify("column projects.due_date does not exist", 400)), false);
  assert.equal(lp.lpIsMigrationPending(lp.lpClassify("42501 permission denied", 403)), false);
  assert.equal(lp.lpIsMigrationPending(lp.lpClassify("", 200)), false);
  // ولا عند نجاح بلا صفوف (RLS).
  assert.equal(lp.lpIsMigrationPending(lp.lpClassify("", undefined)), false);
  // الحالتان الوحيدتان المسموح بهما:
  assert.equal(lp.lpIsMigrationPending(lp.lpClassify("PGRST202 could not find the function x", 404)), true);
  assert.equal(lp.lpIsMigrationPending(lp.lpClassify('relation "public.x" does not exist', 404)), true);
  // واللوحة تشتقّ الشارة من هذه الدالّة وحدها.
  const UI = read("components/portal/LargeProjectDashboard.tsx");
  assert.match(UI, /setMigrationPending\(lpIsMigrationPending\(/);
});

// ════════════════════════════════════════════════════════════════════════════
// (١٣) انحدار: منصّة المشاريع القائمة ما تزال تعمل
// ════════════════════════════════════════════════════════════════════════════
test("13. انحدار — منصّة المشاريع القائمة سليمة", skip, () => {
  const PC = read("lib/portal/projectCore.ts");
  // project_core ما يزال يملك الموعد (لا نقله ولا حذفه).
  const pcCols = /PC_CORE_COLS\s*=\s*\n?\s*"([^"]+)"/.exec(PC);
  assert.ok(pcCols, "PC_CORE_COLS غير موجود");
  assert.ok(pcCols[1].split(",").includes("due_date"), "★ project_core فقد due_date من قائمة أعمدته");
  assert.ok(pcCols[1].split(",").includes("project_id"));
  // موعد المخرج شيء آخر تمامًا وما يزال يُطلب من deliverables.
  assert.match(PC, /deliverables\?project_id=eq\.[^`]*due_date/);
  // اللقطة ما تزال تُرجع كامل عقدها.
  const LIB = read("lib/portal/large-projects.ts");
  for (const k of ["caps", "project", "parent", "stages", "deliverables", "truncated", "clientName", "managerName", "coreByProject", "degraded"]) {
    assert.ok(new RegExp(`\\b${k}\\b`).test(LIB), `مفتاح اللقطة ${k} اختفى`);
  }
  // الأعمدة الأساسية للمخرجات لم تُمسّ (موعد المخرج ضمنها عمدًا).
  const base = /LP_BASE_COLUMNS = \[([\s\S]*?)\]/.exec(LIB)[1];
  for (const c of ["id", "project_id", "title", "type", "version", "status", "assignee_id", "due_date", "created_at", "preview_url", "vimeo_review_url", "allow_download", "watermark_required"]) {
    assert.ok(base.includes(`"${c}"`), `LP_BASE_COLUMNS فقد ${c}`);
  }
});

test("13ب. انحدار — اللقطة الكاملة تُجلب بطلبات صحيحة وتعيد بيانات مترابطة", skip, async () => {
  scenario({
    projectRows: [
      { id: PROJ, project_name: "الرئيسيّ", status: "active", client_id: null, created_at: "2026-01-01", parent_project_id: PARENT, project_scope: "master" },
      { id: CHILD, project_name: "فرع", status: "active", client_id: null, created_at: "2026-01-02", parent_project_id: PROJ, project_scope: "subproject" },
    ],
    coreRows: [{ project_id: PROJ, core_stage: "in_production", progress_pct: 30, project_type: null, health: "on_track", due_date: "2026-07-25" }],
  });
  const r = await lp.lpLoadSnapshot(PROJ);
  assert.equal(r.ok, true);
  assert.equal(r.data.stages[1].due_date, null, "فرع بلا صفّ core ⇒ null لا انهيار");
  // كلّ طلبات الجداول الأربعة خالية من projects.due_date.
  for (const q of CALLS) {
    if (/^projects\?/.test(q)) assert.equal(/due_date/.test(q), false, `★ ${q}`);
  }
  // واستعلام الأب (فتات الخبز) بالأعمدة الموجودة فقط.
  const par = CALLS.find((q) => q.includes(`projects?id=eq.${PARENT}`));
  assert.ok(par, "لم يُطلب المشروع الأب");
  assert.equal(/due_date/.test(par), false, "★ استعلام الأب يطلب due_date");
});

// ════════════════════════════════════════════════════════════════════════════
// (١٤) انحدار: الاستيراد الجماعيّ ما يزال يعمل
// ════════════════════════════════════════════════════════════════════════════
test("14. انحدار — الاستيراد الجماعيّ سليم", skip, () => {
  const keys = loadTs("lib/portal/import/keys.ts");
  const profile = loadTs("lib/portal/import/profile.ts");
  // موعد المخرج ما يزال حقلًا مستوردًا معروفًا (deliverables.due_date موجود).
  assert.ok(String(profile.IMPORT_FIELDS ? profile.IMPORT_FIELDS.join(",") : read("lib/portal/import/profile.ts")).includes("due_date"));
  // مفتاح الصفّ ما يزال مستقرًّا ويشمل الموعد.
  const row = { title: "مخرج", type: "video", due_date: "2026-07-25" };
  const a = keys.deliverableFingerprint ? keys.deliverableFingerprint(row) : null;
  if (a !== null) assert.equal(a, keys.deliverableFingerprint({ ...row }), "البصمة غير مستقرّة");
  // ولا استيراد يكتب إلى projects.due_date.
  for (const f of ["execute.ts", "batchBackend.ts", "rpc.ts", "preview.ts", "keys.ts"]) {
    const src = read(`lib/portal/import/${f}`);
    assert.equal(/projects[^)\n]{0,80}due_date/.test(src.replace(/^\s*\/\/.*$/gm, "")), false,
      `★ ${f} يربط due_date بجدول projects`);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// حارس شامل: لا طلب لـ projects.due_date في أيّ مكان من الشيفرة
// ════════════════════════════════════════════════════════════════════════════
test("حارس المستودع: لا `projects?...select=...due_date` في lib/ app/ components/", () => {
  const roots = ["lib", "app", "components"];
  const files = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
      const rel = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== "node_modules") walk(rel); }
      else if (/\.tsx?$/.test(e.name)) files.push(rel);
    }
  };
  roots.forEach(walk);
  assert.ok(files.length > 50, "المسح لم يجد ملفّات — الحارس بلا معنى");

  const offenders = [];
  for (const f of files) {
    const src = read(f);
    // كلّ `projects?…select=…` — مع قائمة الأعمدة التي تليه.
    const re = /projects\?[^`"'\n]*?select=([A-Za-z0-9_,*.()$\{\}]+)/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      // استثناء المسمّيات الأخرى: project_core / subprojects / …
      const at = m.index;
      const before = src.slice(Math.max(0, at - 24), at);
      if (/[A-Za-z0-9_]$/.test(before)) continue;
      if (m[1].split(/[,()]/).includes("due_date")) offenders.push(`${f}: ${m[0]}`);
    }
  }
  assert.deepEqual(offenders, [], `★ عاد طلب projects.due_date:\n${offenders.join("\n")}`);
});

test("SAFE: ثابت فقط — لا قاعدة بيانات ولا شبكة", skip, async () => {
  // طبقة الشبكة مستبدَلة بالكامل: pget/prpc بديلان محليّان يعيدان بيانات ثابتة.
  assert.equal(typeof client.pget, "function");
  const q = [];
  ROUTE = () => ({ ok: true, data: [] });
  CALLS = q;
  assert.equal(globalThis.__kianRealNetwork, undefined);
  // ولا مفتاح خدمة في البيئة يُستعمل من هنا: الوحدات المحمَّلة لا تقرأ إلا
  // متغيّرات العميل العامّة، وكلّ نداء يمرّ بالبديلين أعلاه.
  const r = await client.pget("projects?select=id");
  assert.deepEqual(r, { ok: true, data: [] }, "طلب فعليّ تسرّب خارج البديل");
  assert.deepEqual(q, ["projects?select=id"]);
});
