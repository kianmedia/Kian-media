// ════════════════════════════════════════════════════════════════════════════
// tests/project_platform_freeze.test.js
//
// منصّة المشاريع **مجمَّدة** طوال برنامج ما بعد المنصّة. هذا الاختبار يفشل إذا
// لمس أيّ عمل جديد ملفًّا من ملفاتها، مقارنةً بنقطة التجميد المسجَّلة في
// tests/fixtures/project_platform_freeze.json.
//
// لماذا اختبار لا مجرّد وعد: التجميد الذي لا يُفرَض آليًّا يُخترق سهوًا — يكفي
// «إصلاح صغير» في مكوّن مشترك. هنا يظهر الخرق فورًا وباسم الملفّ.
//
// رفع التجميد قرار صريح: يُحدَّث ملفّ النقطة بـcommit مستقلّ يشرح السبب.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const FREEZE = require("./fixtures/project_platform_freeze.json");

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
}

/** هل نقطة التجميد ما زالت في التاريخ؟ لو غابت فالمقارنة بلا معنى. */
function baseExists() {
  try { git(["cat-file", "-e", `${FREEZE.start_head}^{commit}`]); return true; }
  catch { return false; }
}

test("منصّة المشاريع مجمَّدة — لا ملفّ منها تغيّر منذ نقطة التجميد", () => {
  if (!baseExists()) {
    assert.fail(
      `نقطة التجميد ${FREEZE.start_head} غير موجودة في التاريخ. ` +
      `لا تُعدّل الاختبار — حقّق سبب اختفاء الـcommit أوّلًا.`
    );
  }
  const out = git(["diff", "--name-only", FREEZE.start_head, "--", ...FREEZE.paths]).trim();
  const changed = out ? out.split("\n").filter(Boolean) : [];
  assert.deepEqual(
    changed, [],
    "ملفّات منصّة المشاريع تغيّرت رغم التجميد:\n  " + changed.join("\n  ") +
    "\nإن كان التغيير مقصودًا فارفع التجميد بقرار صريح وcommit مستقلّ."
  );
});

test("قائمة مسارات التجميد تغطّي القلب فعلًا", () => {
  // حارس ضدّ تفريغ الاختبار: لو قُلّصت القائمة لصار يمرّ دائمًا.
  const must = [
    "components/portal/projectcore",
    "lib/portal/large-projects.ts",
    "docs/project_platform_large_projects_RUNME.sql",
    "docs/project_bulk_import_RUNME.sql",
    "docs/project_editor_permissions_RUNME.sql",
    "docs/project_transition_approval_RUNME.sql",
  ];
  for (const m of must) {
    assert.ok(FREEZE.paths.includes(m), `مسار جوهريّ سقط من قائمة التجميد: ${m}`);
  }
  assert.ok(FREEZE.paths.length >= 15, "قائمة التجميد قصيرة على نحو مريب");
});

test("الملفّات المجمَّدة ما زالت موجودة — لا حذف صامت", () => {
  const fs = require("node:fs");
  const critical = [
    "lib/portal/large-projects.ts",
    "components/portal/projectcore/ProjectOps.tsx",
    "docs/project_editor_permissions_RUNME.sql",
    "docs/project_transition_approval_RUNME.sql",
  ];
  for (const f of critical) {
    assert.ok(fs.existsSync(path.join(ROOT, f)), `ملفّ مجمَّد اختفى: ${f}`);
  }
});
