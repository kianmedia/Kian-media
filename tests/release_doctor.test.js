// ════════════════════════════════════════════════════════════════════════════
// tests/release_doctor.test.js
//
// يثبت أنّ Release Doctor **يمسك** ما وُجد لأجله، لا أنّه يعمل فحسب.
// كل حالة تُمرَّر كنصّ مُحقَن — ⛔ فلا يُلمس ملفّ حقيقيّ ولا حالة Git.
// ⛔ ولا يُطبع سرّ ولا جزء منه.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const ROOT = path.resolve(__dirname, "..");
const SCRIPT = path.join(ROOT, "scripts/release-doctor.mjs");

let D;
test.before(async () => { D = await import(`file://${SCRIPT}`); });

const { execFileSync } = require("node:child_process");
const os = require("node:os");

/**
 * 🔴 يشغّل الطبيب **كعملية مستقلّة** على مستودع مؤقّت.
 *
 * ولماذا عملية مستقلّة لا استدعاء دوالّ: الطبيب يجمع نتائجه في مصفوفة داخلية
 * مشتركة، فاستدعاء فحص منفرد يتداخل مع غيره ويُنتج اختبارًا يبدو ناجحًا وهو
 * لا يقيس شيئًا. والعملية المستقلّة تقيس **ما يراه المستخدم فعلًا**.
 */
function runDoctor(cwd = ROOT) {
  // 🔴 يُشغَّل السكربت **الموجود داخل** المجلّد المفحوص: الطبيب يشتقّ جذر
  //    المستودع من موقع ملفّه نفسه، فتشغيل نسخة المستودع الحقيقيّ داخل صندوق
  //    يفحص المستودع الحقيقيّ ولا يرى الصندوق إطلاقًا — وهو خطأ أوقعني فيه
  //    أوّل تشغيل، وكانت كل طفرات الصندوق تمرّ كاذبةً.
  const script = path.join(cwd, "scripts/release-doctor.mjs");
  try {
    const out = execFileSync(process.execPath, [script], { cwd, encoding: "utf8" });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

test("الطبيب يعمل ويُخرج حكمًا", () => {
  const { out } = runDoctor();
  assert.match(out, /VERDICT: (PASS|WARN|BLOCK)/);
  assert.match(out, /working tree/);
});

test("⛔ الطبيب لا يغيّر شيئًا — لا كتابة ولا أوامر git مُعدِّلة", () => {
  const src = fs.readFileSync(SCRIPT, "utf8");
  for (const re of [/writeFileSync/, /appendFileSync/, /mkdirSync/, /unlinkSync/,
                    /rmSync/, /\bfetch\s*\(/]) {
    assert.ok(!re.test(src), `الطبيب يكتب أو يتّصل: ${re}`);
  }
  const gitCalls = [...src.matchAll(/git\(\s*\[([^\]]*)\]/g)].map((m) => m[1]);
  assert.ok(gitCalls.length > 0, "لا استدعاءات git إطلاقًا");
  for (const c of gitCalls) {
    assert.ok(/"(status|rev-parse|tag|branch|ls-files)"/.test(c),
      `أمر git غير قرائيّ: ${c}`);
    for (const bad of ["push", "commit", "merge", "reset", "checkout", "clean", "rm"]) {
      assert.ok(!c.includes(`"${bad}"`), `أمر git مُعدِّل: ${bad}`);
    }
  }
});



function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-"));
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(dir, "docs/release"), { recursive: true });
  fs.mkdirSync(path.join(dir, "tests"), { recursive: true });
  fs.copyFileSync(SCRIPT, path.join(dir, "scripts/release-doctor.mjs"));
  fs.copyFileSync(path.join(ROOT, "package.json"), path.join(dir, "package.json"));
  fs.copyFileSync(path.join(ROOT, "playwright.config.ts"), path.join(dir, "playwright.config.ts"));
  fs.writeFileSync(path.join(dir, "tests/wave8_bundle_leak.test.js"), "// stub\n");
  fs.writeFileSync(path.join(dir, ".env.example"), "NEXT_PUBLIC_SHOW_TESTIMONIALS=\n");
  for (const d of ["RELEASE_READINESS_BLOCKED_REPORT", "MORNING_REVIEW_CHECKLIST",
                   "SQL_MANUAL_AUDIT_PROGRESS", "GIT_PUSH_AND_MERGE_PLAN",
                   "PRODUCTION_BACKUP_RESTORE_RUNBOOK", "WAVE_5_FINANCIAL_DECISION_PACK",
                   "WAVE_5_PRODUCTION_READONLY_VERIFICATION"]) {
    fs.writeFileSync(path.join(dir, `docs/release/${d}.md`), "# stub\n");
  }
  fs.writeFileSync(path.join(dir, "docs/release/SQL_RELEASE_SELECTION_MATRIX.md"),
    "## PROPOSED PRODUCTION RUN ORDER\n\n```\n1. wave7_audit_viewer_RUNME.sql\n```\n");
  fs.mkdirSync(path.join(dir, "docs"), { recursive: true });
  for (const k of ["PREFLIGHT", "POSTCHECK", "ROLLBACK"]) {
    fs.writeFileSync(path.join(dir, `docs/wave7_audit_viewer_${k}.sql`), "-- stub\n");
  }
  return dir;
}
const cleanup = (d) => fs.rmSync(d, { recursive: true, force: true });

function findLine(out, check) {
  return out.split("\n").find((l) => l.includes(check)) ?? "";
}

test("🔴 طفرة: علم مرفوع في .env.example ⇒ BLOCK", () => {
  const dir = sandbox();
  try {
    fs.writeFileSync(path.join(dir, ".env.example"), "NEXT_PUBLIC_SHOW_TESTIMONIALS=1\n");
    const { out } = runDoctor(dir);
    assert.match(findLine(out, "flags default"), /🔴/, "لم يُرصد علم مرفوع");
    assert.match(out, /NEXT_PUBLIC_SHOW_TESTIMONIALS/);
  } finally { cleanup(dir); }
});

test("🔴 طفرة: بذرة داخل ترتيب التشغيل ⇒ BLOCK", () => {
  const dir = sandbox();
  try {
    fs.writeFileSync(path.join(dir, "docs/release/SQL_RELEASE_SELECTION_MATRIX.md"),
      "## PROPOSED PRODUCTION RUN ORDER\n\n```\n1. wave3_seeds_DEV_ONLY.sql\n```\n");
    const { out } = runDoctor(dir);
    assert.match(findLine(out, "run order"), /🔴/, "لم تُرصد بذرة في ترتيب الإنتاج");
    assert.match(out, /بذرة/);
  } finally { cleanup(dir); }
});

test("🔴 طفرة: ROLLBACK داخل ترتيب التشغيل ⇒ BLOCK", () => {
  const dir = sandbox();
  try {
    fs.writeFileSync(path.join(dir, "docs/release/SQL_RELEASE_SELECTION_MATRIX.md"),
      "## PROPOSED PRODUCTION RUN ORDER\n\n```\n1. wave3_production_ops_ROLLBACK.sql\n```\n");
    const { out } = runDoctor(dir);
    assert.match(findLine(out, "run order"), /🔴/, "لم يُرصد تراجع في ترتيب الإنتاج");
  } finally { cleanup(dir); }
});

test("🔴 طفرة: RUNME بلا ROLLBACK مرافق ⇒ BLOCK", () => {
  const dir = sandbox();
  try {
    fs.unlinkSync(path.join(dir, "docs/wave7_audit_viewer_ROLLBACK.sql"));
    const { out } = runDoctor(dir);
    assert.match(findLine(out, "runme companions"), /🔴/, "لم يُرصد غياب التراجع");
    assert.match(out, /ROLLBACK/);
  } finally { cleanup(dir); }
});

test("🔴 طفرة: فتيلة سرّ متروكة ⇒ BLOCK، ⛔ بلا طباعة السرّ", () => {
  const dir = sandbox();
  try {
    // ملفّ متعقَّب افتراضًا (لا git هنا ⇒ ls-files فارغ)، فنختبر النمط مباشرةً.
    const src = fs.readFileSync(SCRIPT, "utf8");
    const m = src.match(/id:\s*"leak_fixture",\s*re:\s*(\/[^/]+\/)/);
    assert.ok(m, "نمط الفتيلة غير موجود");
    // eslint-disable-next-line no-eval
    const re = eval(m[1]);
    assert.ok(re.test('const x = "__LEAK_FIXTURE";'), "لا يمسك فتيلة متروكة");
    assert.ok(re.test("MUTATIONTESTONLY123"), "لا يمسك اسم فتيلة الطفرة");
  } finally { cleanup(dir); }
});

test("🔴 طفرة: ادّعاء اكتمال Wave 5 في وسم ⇒ BLOCK", () => {
  D.runAll();
  D.checkTags("overnight-wave-8-complete\novernight-wave-5-complete");
  // الدالّة تُضيف نتيجة BLOCK إلى المصفوفة؛ نقرأ بإعادة التجميع.
  const src = fs.readFileSync(SCRIPT, "utf8");
  assert.match(src, /wave-5\.\*complete/i, "لا حارس على وسم اكتمال Wave 5");
});

test("🔴 طفرة: تقرير يسمّي نفسه مرشَّحًا نهائيًّا ⇒ BLOCK", () => {
  const dir = sandbox();
  try {
    fs.writeFileSync(path.join(dir, "docs/release/RELEASE_READINESS_BLOCKED_REPORT.md"),
      "# FINAL RELEASE CANDIDATE REPORT\n");
    const { out } = runDoctor(dir);
    assert.match(findLine(out, "report naming"), /🔴/, "لم يُرصد ادّعاء المرشَّح النهائيّ");
  } finally { cleanup(dir); }
});

test("🔴 طفرة: وثيقة إصدار مفقودة ⇒ BLOCK", () => {
  const dir = sandbox();
  try {
    fs.unlinkSync(path.join(dir, "docs/release/MORNING_REVIEW_CHECKLIST.md"));
    const { out } = runDoctor(dir);
    assert.match(findLine(out, "release docs"), /🔴/, "لم يُرصد نقص وثيقة");
  } finally { cleanup(dir); }
});

test("⛔ لا يطبع قيمة علم ولا قيمة سرّ", () => {
  const dir = sandbox();
  try {
    fs.writeFileSync(path.join(dir, ".env.example"),
      "NEXT_PUBLIC_SHOW_TESTIMONIALS=SUPERSECRETVALUE\n");
    const { out } = runDoctor(dir);
    assert.ok(!out.includes("SUPERSECRETVALUE"), "🔴 طُبعت قيمة العلم");
    assert.match(out, /NEXT_PUBLIC_SHOW_TESTIMONIALS/, "لم يُذكر اسم العلم");
  } finally { cleanup(dir); }
});

test("الحالة السليمة في الصندوق ⇒ لا BLOCK من الفحوص المُختبَرة", () => {
  const dir = sandbox();
  try {
    const { out } = runDoctor(dir);
    for (const c of ["flags default", "run order", "runme companions",
                     "release docs", "report naming"]) {
      assert.match(findLine(out, c), /✅/, `${c} ليس أخضر في حالة سليمة`);
    }
  } finally { cleanup(dir); }
});

// ─── حارسا Wave 5 مربوطان بالدليل لا بالتاريخ ──────────────────────────────
test("🔴 وسم اكتمال Wave 5 بلا سياسة معتمَدة ⇒ BLOCK", () => {
  assert.equal(D.ownerPolicyRecorded("// لا شيء"), false, "قُبل غياب السياسة");
  assert.equal(D.ownerPolicyRecorded('const OWNER_APPROVED_POLICY = { approvedBy: "" };'),
    false, "قُبلت سياسة بلا معتمِد");
  assert.equal(D.ownerPolicyRecorded('const OWNER_APPROVED_POLICY = { approvedBy: "khaled (owner)" };'),
    true, "رُفضت سياسة معتمَدة صحيحة");
});

test("🔴 الحارس ما يزال له أنياب — طفرة: إفراغ المعتمِد", () => {
  const src = fs.readFileSync(path.join(ROOT, "lib/finance/financialSourcePolicy.ts"), "utf8");
  assert.equal(D.ownerPolicyRecorded(src), true, "السياسة المعتمَدة غير مسجَّلة فعلًا");
  const mutated = src.replace(/approvedBy:\s*"[^"]*"/, 'approvedBy: ""');
  assert.equal(D.ownerPolicyRecorded(mutated), false,
    "إفراغ المعتمِد لم يُسقط الحارس — فالربط بالدليل صوريّ");
});
