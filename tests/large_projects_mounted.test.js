// ════════════════════════════════════════════════════════════════════════════
// tests/large_projects_mounted.test.js — حارس «الشيفرة الميتة».
//
// واجهة المشاريع الكبيرة بُنيت كاملةً ثم لم يستوردها أحد: لوحة لا يستطيع أحد
// فتحها ليست ميزة. هذا الملف يمنع التراجع الصامت إلى تلك الحالة.
//
// الاختبار لا يكتفي بـ grep على اسم الملف: يمشي **رسم الاستيراد الحقيقيّ**
// ابتداءً من ملفات المسارات تحت app/ ويثبت أن كل مكوّن من مكوّنات المشاريع
// الكبيرة قابل للوصول فعليًّا من صفحة يفتحها مستخدم.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const EXTS = [".tsx", ".ts", ".jsx", ".js"];

/** يحوّل مواصفة استيراد إلى مسار حقيقيّ داخل المستودع (أو null للحزم الخارجية). */
function resolveImport(spec, fromFile) {
  let base;
  if (spec.startsWith("@/")) base = path.join(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(path.join(ROOT, fromFile)), spec);
  else return null;                                   // حزمة من node_modules
  for (const e of EXTS) { if (fs.existsSync(base + e)) return path.relative(ROOT, base + e); }
  for (const e of EXTS) {
    const idx = path.join(base, "index" + e);
    if (fs.existsSync(idx)) return path.relative(ROOT, idx);
  }
  return null;
}

/** كل مواصفات الاستيراد/إعادة التصدير/الاستيراد الديناميكيّ في ملف. */
function importsOf(rel) {
  const src = read(rel);
  const specs = [];
  const re = /(?:import|export)\s[^;]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|require\(\s*["']([^"']+)["']\s*\)/g;
  let m;
  while ((m = re.exec(src)) !== null) specs.push(m[1] || m[2] || m[3]);
  return specs;
}

/** كل ملفات المسارات تحت app/ (page/layout/template/route). */
function routeFiles(dir = "app", acc = []) {
  for (const ent of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, ent.name);
    if (ent.isDirectory()) routeFiles(rel, acc);
    else if (/^(page|layout|template|route|default|error|loading)\.(tsx|ts|jsx|js)$/.test(ent.name)) acc.push(rel);
  }
  return acc;
}

/** المجموعة المغلقة للملفات التي يمكن بلوغها من أيّ مسار. */
const reachable = (() => {
  const seen = new Set();
  const queue = routeFiles();
  assert.ok(queue.length > 0, "لم يُعثر على أيّ ملف مسار تحت app/");
  for (const f of queue) seen.add(f);
  while (queue.length) {
    const cur = queue.shift();
    for (const spec of importsOf(cur)) {
      const next = resolveImport(spec, cur);
      if (next && !seen.has(next)) { seen.add(next); queue.push(next); }
    }
  }
  return seen;
})();

const COMPONENTS = [
  "components/portal/LargeProjectDashboard.tsx",
  "components/portal/DeliverableMatrix.tsx",
  "components/portal/LargeProjectHierarchy.tsx",
  "components/portal/LargeProjectBulkBar.tsx",
  "components/portal/LargeProjectAtoms.tsx",
];

// ─── (أ) الحارس الأساسيّ: لا شيء منها شيفرة ميتة ───────────────────────────

for (const c of COMPONENTS) {
  test(`«${path.basename(c)}» يبلغه المستخدم فعليًّا من مسار حقيقيّ تحت app/`, () => {
    assert.ok(
      reachable.has(c),
      `${c} غير مستورد من أيّ صفحة — عاد شيفرةً ميتة. رَكِّبه في تبويب حقيقيّ.`,
    );
  });
}

// ─── (ب) نقطة التركيب: صفحة تفاصيل المشروع عبر سجلّ التبويبات ──────────────

test("صفحة تفاصيل المشروع تُركِّب ProjectOps (سلسلة التركيب سليمة)", () => {
  const PAGE = read("app/client-portal/project-core/[projectId]/page.tsx");
  assert.match(PAGE, /from "@\/components\/portal\/projectcore\/ProjectOps"/);
  assert.match(PAGE, /<ProjectOps[\s\S]{0,300}projectId=\{projectId\}/);
});

test("ProjectOps يستورد اللوحة ويُركِّبها في تبويبين بمفتاحين مسجَّلين", () => {
  const OPS = read("components/portal/projectcore/ProjectOps.tsx");
  assert.match(OPS, /import LargeProjectDashboard from "@\/components\/portal\/LargeProjectDashboard"/);
  // المفاتيح مسجَّلة في نوع التبويبات وفي سجلّ TABS معًا — وإلّا فالتبويب غير قابل للاختيار.
  for (const k of ["large", "matrix"]) {
    assert.match(OPS, new RegExp(`type TabKey =[^;]*"${k}"`), `المفتاح ${k} غير معرَّف في TabKey`);
    assert.match(OPS, new RegExp(`\\{ k: "${k}", ar: "[^"]+", en: "[^"]+", group: "\\w+" \\}`), `المفتاح ${k} غير مسجَّل في TABS`);
    assert.match(OPS, new RegExp(`tab === "${k}" && <LargeProjectDashboard`), `المفتاح ${k} بلا جسم يُرسم`);
  }
  // تبويب المصفوفة يهبط على سطح الإدخال الجماعيّ مباشرةً لا على النظرة العامة.
  assert.match(OPS, /tab === "matrix" && <LargeProjectDashboard projectId=\{projectId\} initialTab="deliverables"/);
  assert.match(OPS, /tab === "large" && <LargeProjectDashboard projectId=\{projectId\} initialTab="overview"/);
});

// ─── (ج) لا توسيع صلاحيات: نفس بوّابة الجيران، بلا نموذج جديد ──────────────

test("التبويبان لا يضيفان أيّ شرط صلاحية جديد", () => {
  const OPS = read("components/portal/projectcore/ProjectOps.tsx");
  const filter = OPS.match(/const visibleTabs = TABS\.filter\([^\n]*\n?/);
  assert.ok(filter, "لم يُعثر على مُصفّي التبويبات");
  // لا شرط خاصّ بالمفتاحين ⇒ يرثان بوّابة الصفحة (فريق كيان) كتبويب «المخرجات».
  assert.doesNotMatch(filter[0], /"large"|"matrix"/, "لا يجوز اختراع بوّابة خاصّة لهذين التبويبين");
  // بوّابة الصفحة نفسها لم تُلمَس.
  const PAGE = read("app/client-portal/project-core/[projectId]/page.tsx");
  assert.match(PAGE, /if \(!\(caps\.isStaff \|\| caps\.isAdminArea\)\) \{ setPhase\("denied"\); return; \}/);
});

// ─── (د) قبل تطبيق الـSQL: حالة «الترحيل معلّق» لا شاشة فارغة ولا انهيار ────

test("اللوحة تُظهر «الترحيل معلّق» صراحةً بدل الانهيار أو الفراغ", () => {
  const DASH = read("components/portal/LargeProjectDashboard.tsx");
  // الحالتان: نقص جزئيّ (شريط تنبيه) وفشل جلب من صنف الترحيلة (بطاقة معلومة).
  assert.ok(DASH.split('"الترحيل معلّق"').length - 1 >= 2, "يجب أن تُغطّى حالتا النقص الجزئيّ وفشل الجلب");
  assert.match(DASH, /lpClassify\(r\.error, r\.status\)/, "تصنيف الخطأ مطلوب للتمييز بين العطل وغياب الترحيلة");
  assert.match(DASH, /setMigrationPending\(\s*k === "missing_table" \|\| k === "missing_function" \|\| k === "missing_column"\s*\)/);
  // خطأ الترحيلة لا يُرسم أحمر (ليس عطلًا).
  assert.match(DASH, /migrationPending \? "text-stone-400" : "text-red-300"/);
});

test("سطح الإدخال الجماعيّ موصول: فلاتر + شريط إجراءات + إعادة تحميل", () => {
  const DASH = read("components/portal/LargeProjectDashboard.tsx");
  const MATRIX = read("components/portal/DeliverableMatrix.tsx");
  assert.match(DASH, /<DeliverableMatrix/);
  // الفلاتر والتحديث مربوطان فعليًّا لا مُمرَّرَين فارغَين.
  assert.match(DASH, /filters=\{filters\}\s+onFilters=\{setFilters\}/);
  assert.match(DASH, /onChanged=\{/);
  assert.match(MATRIX, /import LargeProjectBulkBar[^\n]*from "@\/components\/portal\/LargeProjectBulkBar"/);
  assert.match(MATRIX, /<LargeProjectBulkBar/);
});

test("اللوحة تقبل نقطة دخول ابتدائية بدل حالة داخلية ثابتة", () => {
  const DASH = read("components/portal/LargeProjectDashboard.tsx");
  assert.match(DASH, /initialTab\?: LargeProjectTab/);
  assert.match(DASH, /useState<Tab>\(initialTab \?\? "overview"\)/);
});
