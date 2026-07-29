// ════════════════════════════════════════════════════════════════════════════
// tests/project_import_ui_mounted.test.js — حارس «الشيفرة الميتة» للاستيراد.
//
// محرّك الاستيراد ومساراته بُنيت كاملةً ثم لم تُستدعَ من أي واجهة: ميزة لا
// يستطيع أحد النقر عليها ليست ميزة. هذا الملف يمنع التراجع الصامت إلى تلك
// الحالة (وقد وقع في هذا المستودع مرّتين من قبل).
//
// لا يكتفي بـgrep على اسم الملف: يمشي رسم الاستيراد الحقيقيّ ابتداءً من ملفات
// المسارات تحت app/ ويثبت أن الشاشة يبلغها مستخدم فعليًّا.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const EXTS = [".tsx", ".ts", ".jsx", ".js"];
const PANEL = "components/portal/ProjectImportPanel.tsx";
const OPS_PATH = "components/portal/projectcore/ProjectOps.tsx";

function resolveImport(spec, fromFile) {
  let base;
  if (spec.startsWith("@/")) base = path.join(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(path.join(ROOT, fromFile)), spec);
  else return null;
  for (const e of EXTS) if (fs.existsSync(base + e)) return path.relative(ROOT, base + e);
  for (const e of EXTS) {
    const idx = path.join(base, "index" + e);
    if (fs.existsSync(idx)) return path.relative(ROOT, idx);
  }
  return null;
}

function importsOf(rel) {
  const src = read(rel);
  const specs = [];
  const re = /(?:import|export)\s[^;]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|require\(\s*["']([^"']+)["']\s*\)/g;
  let m;
  while ((m = re.exec(src)) !== null) specs.push(m[1] || m[2] || m[3]);
  return specs;
}

function routeFiles(dir = "app", acc = []) {
  for (const ent of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, ent.name);
    if (ent.isDirectory()) routeFiles(rel, acc);
    else if (/^(page|layout|template|route|default|error|loading)\.(tsx|ts|jsx|js)$/.test(ent.name)) acc.push(rel);
  }
  return acc;
}

const reachable = (() => {
  const seen = new Set();
  const queue = routeFiles();
  assert.ok(queue.length > 0, "لم يُعثر على أيّ ملف مسار تحت app/");
  for (const f of queue) seen.add(f);
  while (queue.length) {
    const cur = queue.shift();
    for (const spec of importsOf(cur)) {
      const next = resolveImport(spec, cur);
      if (next && !seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
})();

// ─── (أ) الحارس الأساسيّ: الشاشة يبلغها مستخدم من مسار حقيقيّ ──────────────

test("شاشة الاستيراد يبلغها المستخدم فعليًّا من مسار حقيقيّ تحت app/", () => {
  assert.ok(
    reachable.has(PANEL),
    `${PANEL} غير مستورد من أيّ صفحة — عاد شيفرةً ميتة. رَكِّبه في تبويب حقيقيّ.`,
  );
});

test("مسارات الاستيراد الثلاثة لها مستدعٍ حقيقيّ في الواجهة", () => {
  const panel = read(PANEL);
  for (const route of ["/api/portal/import/profiles", "/api/portal/import/preview", "/api/portal/import/execute"]) {
    assert.ok(panel.includes(route), `المسار ${route} بلا مستدعٍ في الواجهة — يبقى غير قابل للنقر`);
  }
});

// ─── (ب) نقطة التركيب: سجلّ التبويبات في ProjectOps ────────────────────────

test("ProjectOps يستورد الشاشة ويُركِّبها بمفتاح مسجَّل كاملًا", () => {
  const OPS = read(OPS_PATH);
  assert.match(OPS, /import ProjectImportPanel from "@\/components\/portal\/ProjectImportPanel"/);
  assert.match(OPS, /type TabKey =[^;]*"import"/, "المفتاح import غير معرَّف في TabKey");
  assert.match(OPS, /\{ k: "import", ar: "[^"]+", en: "[^"]+", group: "\w+" \}/, "المفتاح import غير مسجَّل في TABS");
  assert.match(OPS, /tab === "import" && canManage && <ProjectImportPanel/, "المفتاح import بلا جسم يُرسم");
  assert.match(OPS, /<ProjectImportPanel projectId=\{projectId\}/, "الشاشة تُركَّب بلا معرّف مشروع");
});

test("صفحة تفاصيل المشروع تُركِّب ProjectOps (سلسلة التركيب سليمة)", () => {
  const PAGE = read("app/client-portal/project-core/[projectId]/page.tsx");
  assert.match(PAGE, /from "@\/components\/portal\/projectcore\/ProjectOps"/);
  assert.match(PAGE, /<ProjectOps[\s\S]{0,300}projectId=\{projectId\}/);
});

// ─── (ج) البوّابة: نفس نموذج الجيران، بلا توسيع صلاحية ──────────────────────

test("الاستيراد مقصور على الفريق بنفس بوّابة «المحذوفات» — بلا نموذج صلاحيات جديد", () => {
  const OPS = read(OPS_PATH);
  const filter = OPS.match(/const visibleTabs = TABS\.filter\([^\n]*\n?/);
  assert.ok(filter, "لم يُعثر على مُصفّي التبويبات");
  // نفس الشرط حرفيًّا الذي يحرس «المحذوفات»: canManage = isAdminArea || isEditor.
  assert.match(filter[0], /\(tb\.k !== "import" \|\| canManage\)/, "تبويب الاستيراد بلا بوّابة");
  assert.match(OPS, /const canManage = caps\.isAdminArea \|\| caps\.isEditor;/, "تغيّر تعريف canManage");
  // ولا اختراع صلاحية جديدة داخل الشاشة نفسها.
  const panel = read(PANEL);
  assert.doesNotMatch(panel, /usePortal|caps\.|staff_role/, "الشاشة يجب أن ترث البوّابة من ProjectOps لا أن تخترع واحدة");
  // بوّابة الصفحة نفسها لم تُلمَس — العميل لا يبلغ هذه الشاشة إطلاقًا.
  const PAGE = read("app/client-portal/project-core/[projectId]/page.tsx");
  assert.match(PAGE, /if \(!\(caps\.isStaff \|\| caps\.isAdminArea\)\) \{ setPhase\("denied"\); return; \}/);
});

// ─── (د) قبل تطبيق الـSQL: «الترحيل معلّق» لا شاشة فارغة ولا انهيار ────────

test("الشاشة تُظهر «الترحيل معلّق» صراحةً وترفض التنفيذ بدل الانهيار", () => {
  const panel = read(PANEL);
  assert.ok(panel.includes("الترحيل معلّق"), "لا بدّ من حالة «الترحيل معلّق» مسمّاة");
  assert.match(panel, /backend != null && backend\.available === false/, "لا بدّ من كشف صريح لغياب الترحيلة");
  // المعاينة تبقى متاحة (تحليل نصّيّ صرف) — زرّها لا يقرأ حالة قاعدة البيانات.
  assert.match(panel, /disabled=\{!file \|\| busy !== null\}/, "المعاينة يجب أن تبقى متاحة قبل الترحيلة");
  // التنفيذ يُرفض برسالة — حارس داخل المعالج لا مجرّد زرّ معطّل.
  assert.match(panel, /if \(!backend\?\.available\)\s*\{[\s\S]{0,200}setExecErr/, "التنفيذ يجب أن يرفض برسالة صريحة");
  // فشل الإقلاع نفسه يعرض خطأ + إعادة محاولة، لا منطقة فارغة.
  assert.match(panel, /boot === "error"/);
  assert.match(panel, /boot === "loading"/);
});

// ─── (هـ) الخطوات الثلاث والصدق في النتيجة ─────────────────────────────────

test("الخطوات الثلاث موجودة، والتنفيذ معطّل حتى تُشغَّل معاينة وبتأكيد صريح", () => {
  const panel = read(PANEL);
  assert.match(panel, /runPreview/);
  assert.match(panel, /runExecute\("dry_run"\)/, "خطوة التشغيل التجريبي مفقودة");
  assert.match(panel, /runExecute\("commit"\)/, "خطوة التنفيذ مفقودة");
  // التنفيذ محجوب بلا خطّة معروضة وبلا تأكيد.
  assert.match(panel, /const commitBlocked =[\s\S]{0,400}!plan \|\|/, "التنفيذ يجب أن يُعطَّل قبل المعاينة");
  assert.match(panel, /const commitBlocked =[\s\S]{0,400}!confirmSatisfied/, "التنفيذ يجب أن يطلب تأكيدًا صريحًا");
  // الاستيراد الكبير يطلب كتابة العدد الفعليّ.
  assert.match(panel, /confirmCount\.trim\(\) === String\(toCreate\)/, "الاستيراد الكبير يجب أن يطلب العدد الدقيق");
});

test("المعاينة تعرض كل ما يحتاجه المالك لتصحيح الجدول", () => {
  const panel = read(PANEL);
  for (const c of [
    "parentProjectsToCreate",
    "stagesToCreate",
    "subgroupsToCreate",
    "deliverablesToCreate",
    "counts.accepted",
    "counts.skipped",
    "counts.duplicate",
    "counts.invalid",
  ]) {
    assert.ok(panel.includes(c), `العدّاد ${c} غير معروض`);
  }
  // الأسطر غير الصالحة برقم السطر والسبب معًا.
  assert.match(panel, /plan\.invalidRows\.map\(\(r\) => \(\{[\s\S]{0,200}row: r\.rowNumber[\s\S]{0,200}r\.message/);
  assert.ok(panel.includes("plan.warnings"), "التنبيهات غير معروضة");
});

test("النتيجة لا تُخفي فشلًا جزئيًّا: «نجح كذا من كذا» وقائمة كل ما لم ينجح", () => {
  const panel = read(PANEL);
  assert.match(panel, /const succeeded = result\.created \+ result\.updated \+ result\.unchanged;/);
  assert.ok(panel.includes('t({ ar: "نجح", en: "Succeeded" })'), "لا بدّ من عبارة «نجح X من Y» صريحة");
  // كل سطر لم ينجح يُعرض — بلا slice ولا اقتطاع على هذه القائمة.
  assert.match(panel, /const bad = useMemo\(\(\) => result\.rows\.filter\(\(r\) => r\.action === "failed" \|\| r\.action === "not_attempted"\)/);
  assert.match(panel, /\{bad\.map\(\(r\) =>/, "الأسطر الفاشلة يجب أن تُعرض كاملةً");
  assert.doesNotMatch(panel, /bad\.slice\(/, "لا يجوز اقتطاع قائمة الأسطر الفاشلة");
  assert.ok(panel.includes("result.notAttempted"), "الأسطر بلا نتيجة يجب أن تُذكر");
});

test("إعادة الاستيراد: يقال صراحةً إنّ الملف سبق استيراده ولن يُنشأ شيء", () => {
  const panel = read(PANEL);
  assert.match(
    panel,
    /counts\.duplicate > 0 && counts\.deliverablesToCreate === 0/,
    "شرط «سبق استيراد هذا الملف» مفقود",
  );
  assert.ok(panel.includes("سبق استيراد هذا الملف"), "الرسالة العربية الصريحة مفقودة");
});

// ─── (و) الشاشة عامّة: لا مشروع بعينه ولا أرقام مثبّتة ─────────────────────

test("الشاشة لا تعرف عميلًا ولا عدد أسطر — ملفّ التعيين بيانات من المسار", () => {
  const panel = read(PANEL);
  assert.doesNotMatch(panel, /misbar/i, "الشاشة تسمّي مشروعًا بعينه");
  const code = panel
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n");
  for (const re of [/\b79\b/, /\b11\s*(stages|مرحلة)/i, /const\s+STAGES\b/, /const\s+PLATFORMS\b/]) {
    assert.doesNotMatch(code, re, `الشاشة تثبّت محتوى مشروع (${re})`);
  }
  // قائمة ملفّات التعيين تأتي من المسار لا من الشيفرة.
  assert.match(panel, /setProfiles\(list\)/);
  assert.match(panel, /profiles\.map\(\(p\) => \(/);
});

test("الشاشة تعمل على الجوال وبالاتجاه العربي", () => {
  const panel = read(PANEL);
  assert.ok(panel.includes('dir="rtl"'), "الاتجاه العربي غير مضبوط");
  assert.match(panel, /grid-cols-2 sm:grid-cols-4/, "الأرقام يجب أن تنضغط على الجوال");
  assert.match(panel, /flex-wrap/, "أشرطة الأزرار يجب أن تلتفّ على الشاشات الضيّقة");
});
