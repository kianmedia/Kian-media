#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// scripts/release-doctor.mjs — فحص جاهزية **قرائيّ بحت** داخل المستودع.
//
// ⛔ **لا يغيّر شيئًا.** لا Push · لا SQL · لا Deploy · لا كتابة ملفّ · لا شبكة.
//    الأوامر الوحيدة المسموحة هنا أوامر `git` **قرائية**.
//
// ★ لماذا يوجد ★
//   قائمة المراجعة الصباحية بشرية، والبشر يقرؤون ما يتوقّعونه. هذا السكربت
//   يُعيد فحص ما يسهل أن يُنسى: علم رُفع سهوًا · بذرة تسلّلت لترتيب التشغيل ·
//   فتيلة سرّ بقيت بعد اختبار · ادّعاء اكتمال Wave 5.
//
// المخرَج: PASS / WARN / BLOCK. وأيّ BLOCK ⇒ خروج 1.
// ════════════════════════════════════════════════════════════════════════════
import { readFileSync, existsSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const results = [];
const add = (level, check, detail) => results.push({ level, check, detail });
const PASS = (c, d) => add("PASS", c, d);
const WARN = (c, d) => add("WARN", c, d);
const BLOCK = (c, d) => add("BLOCK", c, d);

const rel = (p) => path.join(ROOT, p);
const read = (p) => readFileSync(rel(p), "utf8");
const has = (p) => existsSync(rel(p));

/** git قرائيّ فقط — ⛔ ولا أمر يغيّر الحالة. */
function git(args) {
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
  } catch { return ""; }
}

// ─── ١ · حالة الشجرة والفرع ─────────────────────────────────────────────────
export function checkTree() {
  const dirty = git(["status", "--porcelain"]);
  if (dirty) BLOCK("working tree", `${dirty.split("\n").length} ملفًّا غير مثبَّت`);
  else PASS("working tree", "نظيفة");

  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch === "main") BLOCK("branch", "أنت على main — ⛔ لا تطوير هنا");
  else PASS("branch", branch || "(unknown)");
}

/**
 * 🔴 هل سجّل المالك السياسة المالية في الشيفرة؟
 *
 * الحارسان أدناه كانا يمنعان **أيّ** ادّعاء اكتمال لـWave 5، لأنّ W5-2 كان
 * معلَّقًا. وبعد اعتماد المالك صار المنع المطلق كذبًا في الاتّجاه الآخر.
 * ⛔ ولم يُحذف الحارس: رُبِط **بالدليل** بدل التاريخ — فادّعاء الاكتمال يبقى
 *    ممنوعًا ما لم تكن السياسة المعتمَدة مسجَّلة فعلًا بمعتمِد وتاريخ.
 */
export function ownerPolicyRecorded(srcText) {
  const rel = "lib/finance/financialSourcePolicy.ts";
  const t = srcText ?? (has(rel) ? read(rel) : "");
  if (!t) return false;
  if (!/OWNER_APPROVED_POLICY/.test(t)) return false;
  const m = t.match(/approvedBy:\s*"([^"]*)"/);
  return Boolean(m && m[1].trim());
}

// ─── ٢ · الأوسمة ────────────────────────────────────────────────────────────
export function checkTags(tagsRaw) {
  const tags = (tagsRaw ?? git(["tag", "--list"])).split("\n").filter(Boolean);
  if (tags.includes("overnight-wave-8-complete")) PASS("tag wave-8", "موجود");
  else WARN("tag wave-8", "overnight-wave-8-complete مفقود");

  // 🔴 وسم اكتمال Wave 5 مشروع **فقط** مع سياسة مالية معتمَدة مسجَّلة.
  const w5 = tags.filter((t) => /wave-5.*complete/i.test(t));
  if (w5.length && !ownerPolicyRecorded()) {
    BLOCK("wave-5 tag", `ادّعاء اكتمال بلا سياسة معتمَدة: ${w5.join(", ")}`);
  } else if (w5.length) {
    PASS("wave-5 tag", "اكتمال بسياسة معتمَدة — ⚠️ وبيانات الإنتاج لم تُتحقَّق");
  } else PASS("wave-5 tag", "لا وسم اكتمال");
}

// ─── ٣ · Wave 5 تبقى خارج integration ──────────────────────────────────────
export function checkWave5Unmerged() {
  const merged = git(["branch", "--merged", "integration/v2-1-overnight"]);
  if (!merged) { WARN("wave-5 merge", "تعذّر فحص الدمج"); return; }
  const isMerged = /feat\/wave-5-delivery-rights-finance/.test(merged);
  if (isMerged && !ownerPolicyRecorded()) {
    BLOCK("wave-5 merge", "Wave 5 مدمجة بلا سياسة مالية معتمَدة");
  } else if (isMerged) {
    PASS("wave-5 merge", "مدمجة بسياسة معتمَدة — ⚠️ التحقّق من البيانات معلَّق");
  } else PASS("wave-5 merge", "غير مدمجة");
}

// ─── ٤ · الأعلام — لا علم مرفوع افتراضيًّا ─────────────────────────────────
/** ⚠️ يقرأ `.env.example` فقط: ⛔ ولا يلمس `.env.local` ولا يطبع أيّ قيمة. */
export function checkFlags(envText) {
  const text = envText ?? (has(".env.example") ? read(".env.example") : "");
  if (!text) { WARN("flags", ".env.example مفقود"); return; }
  const on = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*(NEXT_PUBLIC_SHOW_[A-Z_]+|NEXT_PUBLIC_ENABLE_[A-Z_]+|PUSH_EXPO_ENABLED)\s*=\s*([^#\s]*)/);
    if (!m) continue;
    const v = (m[2] ?? "").trim();
    // ⛔ القيمة نفسها لا تُطبع — الاسم فقط.
    if (v && !["false", "0", '""', "''"].includes(v)) on.push(m[1]);
  }
  if (on.length) BLOCK("flags default", `أعلام مرفوعة افتراضيًّا: ${on.join(", ")}`);
  else PASS("flags default", "كل الأعلام مطفأة");
}

// ─── ٥ · وثائق الإصدار ──────────────────────────────────────────────────────
const REQUIRED_DOCS = [
  "docs/release/RELEASE_READINESS_BLOCKED_REPORT.md",
  "docs/release/MORNING_REVIEW_CHECKLIST.md",
  "docs/release/SQL_RELEASE_SELECTION_MATRIX.md",
  "docs/release/SQL_MANUAL_AUDIT_PROGRESS.md",
  "docs/release/GIT_PUSH_AND_MERGE_PLAN.md",
  "docs/release/PRODUCTION_BACKUP_RESTORE_RUNBOOK.md",
  "docs/release/WAVE_5_FINANCIAL_DECISION_PACK.md",
  "docs/release/WAVE_5_PRODUCTION_READONLY_VERIFICATION.md",
];
export function checkDocs() {
  const missing = REQUIRED_DOCS.filter((d) => !has(d));
  if (missing.length) BLOCK("release docs", `مفقودة: ${missing.join(", ")}`);
  else PASS("release docs", `${REQUIRED_DOCS.length} وثيقة`);

  if (has("docs/release/RELEASE_READINESS_BLOCKED_REPORT.md")) {
    const t = read("docs/release/RELEASE_READINESS_BLOCKED_REPORT.md");
    if (/FINAL[ _]RELEASE[ _]CANDIDATE/i.test(t)) {
      BLOCK("report naming", "التقرير يسمّي نفسه مرشَّح إصدار نهائيًّا");
    } else PASS("report naming", "لا ادّعاء مرشَّح نهائيّ");
  }
}

// ─── ٦ · ترتيب التشغيل المقترَح ────────────────────────────────────────────
/**
 * 🔴 يستخرج ترتيب التشغيل ويرفض ما لا يجوز أن يكون فيه.
 * البذرة داخل ترتيب إنتاج تُدخل بيانات وهمية إلى قاعدة حيّة؛ وROLLBACK داخله
 * يُشغَّل في اتّجاه خاطئ.
 */
export function checkRunOrder(matrixText) {
  const text = matrixText ?? (has("docs/release/SQL_RELEASE_SELECTION_MATRIX.md")
    ? read("docs/release/SQL_RELEASE_SELECTION_MATRIX.md") : "");
  if (!text) { BLOCK("run order", "المصفوفة مفقودة"); return; }

  const block = text.split("PROPOSED PRODUCTION RUN ORDER")[1] ?? "";
  const fence = block.match(/```[\s\S]*?```/);
  if (!fence) { WARN("run order", "لم يُعثر على كتلة الترتيب"); return; }
  const files = [...fence[0].matchAll(/([a-z0-9_]+\.sql)/gi)].map((m) => m[1]);
  if (files.length === 0) { WARN("run order", "الترتيب فارغ"); return; }

  const bad = [];
  for (const f of files) {
    if (/seed|DEV_ONLY/i.test(f)) bad.push(`بذرة: ${f}`);
    if (/_ROLLBACK\.sql$/i.test(f)) bad.push(`تراجع: ${f}`);
    if (/_PREFLIGHT\.sql$/i.test(f)) bad.push(`preflight: ${f}`);
    if (/_POSTCHECK\.sql$/i.test(f)) bad.push(`postcheck: ${f}`);
    // ⚠️ يُطابَق **نوع** الملفّ لا اسم ميزته: `wave7_audit_viewer_RUNME.sql`
    //    ملفّ RUNME مشروع اسم ميزته «عارض تدقيق» — ورصدُه إنذار كاذب.
    if (/_AUDIT_READONLY\.sql$|_DIAGNOSTIC\.sql$/i.test(f)) bad.push(`تدقيق: ${f}`);
  }
  if (bad.length) BLOCK("run order", bad.join(" · "));
  else PASS("run order", `${files.length} ملفًّا، كلّها RUNME`);

  // 🔴 كل RUNME في الترتيب يجب أن يملك رفاقه الثلاثة.
  const orphans = [];
  for (const f of files) {
    const base = f.replace(/_RUNME\.sql$/i, "");
    for (const kind of ["PREFLIGHT", "POSTCHECK", "ROLLBACK"]) {
      if (!has(`docs/${base}_${kind}.sql`)) orphans.push(`${base}:${kind}`);
    }
  }
  if (orphans.length) BLOCK("runme companions", `ناقصة: ${orphans.join(", ")}`);
  else PASS("runme companions", "كل RUNME له PREFLIGHT وPOSTCHECK وROLLBACK");
}

// ─── ٧ · أسرار في ملفّات متعقَّبة ──────────────────────────────────────────
const SECRET_PATTERNS = [
  { id: "supabase_secret_key", re: /\bsb_secret_[A-Za-z0-9_-]{8,}/ },
  { id: "pg_connection_string", re: /postgres(?:ql)?:\/\/[^\s"'`]+:[^\s"'`]+@/ },
  { id: "private_key_block", re: /-----BEGIN (RSA |EC )?PRIVATE KEY-----/ },
  // ⚠️ يشترط جسمًا واقعيًّا للرمز (≥18 محرفًا من مجموعة الرمز)، فلا يُرصد شرحٌ
  //    مثل `ExponentPushToken[…]` داخل تعليق يصف الشكل — وهو إنذار كاذب أوقعني
  //    فيه أوّل تشغيل، والإنذار الكاذب يُدرِّب القارئ على تجاهل الحارس.
  { id: "expo_push_token", re: /ExponentPushToken\[[A-Za-z0-9_-]{18,}\]/ },
  { id: "leak_fixture", re: /__LEAK_FIXTURE|MUTATIONTESTONLY/ },
];
/** ⛔ لا يطبع السرّ — معرّف النمط والمسار فقط. */
export function checkSecrets(files) {
  const tracked = files ?? git(["ls-files"]).split("\n").filter(Boolean);
  const skip = /^(docs\/|tests\/|scripts\/release-doctor\.mjs)/;
  const hits = [];
  for (const f of tracked) {
    if (skip.test(f)) continue;
    if (!/\.(ts|tsx|js|jsx|mjs|json|env|example|sql|md)$/.test(f)) continue;
    let t;
    try { t = readFileSync(rel(f), "utf8"); } catch { continue; }
    for (const p of SECRET_PATTERNS) if (p.re.test(t)) hits.push(`${p.id}@${f}`);
  }
  if (hits.length) BLOCK("secrets", hits.join(" · "));
  else PASS("secrets", `${tracked.length} ملفًّا متعقَّبًا — نظيفة`);
}

// ─── ٨ · أدوات الفحص قائمة ──────────────────────────────────────────────────
export function checkTooling() {
  if (!has("package.json")) { BLOCK("tooling", "package.json مفقود"); return; }
  const pkg = JSON.parse(read("package.json"));
  const s = pkg.scripts ?? {};
  for (const k of ["test", "build", "lint"]) {
    if (s[k]) PASS(`script:${k}`, "موجود"); else BLOCK(`script:${k}`, "مفقود");
  }
  if (has("playwright.config.ts")) {
    const cfg = read("playwright.config.ts");
    const missing = ["desktop", "phone", "tablet"].filter((p) => !cfg.includes(`"${p}"`));
    if (missing.length) BLOCK("playwright projects", `مفقودة: ${missing.join(",")}`);
    else PASS("playwright projects", "desktop · phone · tablet");
  } else BLOCK("playwright", "playwright.config.ts مفقود");

  if (has("tests/wave8_bundle_leak.test.js")) PASS("bundle leak guard", "موجود");
  else BLOCK("bundle leak guard", "مفقود");
}

// ─── ٩ · مخلَّفات مولَّدة داخل التعقّب ─────────────────────────────────────
export function checkArtifacts(files) {
  const tracked = files ?? git(["ls-files"]).split("\n").filter(Boolean);
  const bad = tracked.filter((f) =>
    /^\.next\//.test(f) || /^node_modules\//.test(f) ||
    /^test-results\//.test(f) || /^playwright-report\//.test(f) ||
    /\.tmp\.(mjs|js|ts)$/.test(f) || /^tmp\//.test(f));
  if (bad.length) BLOCK("artifacts", `مخلَّفات متعقَّبة: ${bad.slice(0, 5).join(", ")}`);
  else PASS("artifacts", "لا مخلَّفات مولَّدة");
}

// ─── التشغيل ────────────────────────────────────────────────────────────────
export function runAll() {
  results.length = 0;
  checkTree(); checkTags(); checkWave5Unmerged(); checkFlags();
  checkDocs(); checkRunOrder(); checkSecrets(); checkTooling(); checkArtifacts();
  return results.slice();
}

export function summarize(rs) {
  const n = (l) => rs.filter((r) => r.level === l).length;
  return { pass: n("PASS"), warn: n("WARN"), block: n("BLOCK"),
           verdict: n("BLOCK") > 0 ? "BLOCK" : n("WARN") > 0 ? "WARN" : "PASS" };
}

// ⚠️ يُقارَن **المسار الحقيقيّ** لا المُحلَّل: على macOS يعيد `os.tmpdir()`
//    مسارًا عبر رابط رمزيّ (`/var/…`) بينما `import.meta.url` يعطي الهدف
//    (`/private/var/…`). فمقارنة `path.resolve` وحدها تجعل السكربت **يصمت
//    تمامًا** حين يُشغَّل من مجلّد مؤقّت — وهو ما أخفى فشل اختبارات الصندوق.
const isMain = (() => {
  if (!process.argv[1]) return false;
  const here = fileURLToPath(import.meta.url);
  try { return realpathSync(here) === realpathSync(process.argv[1]); }
  catch { return path.resolve(process.argv[1]) === here; }
})();
if (isMain) {
  const rs = runAll();
  const icon = { PASS: "✅", WARN: "⚠️ ", BLOCK: "🔴" };
  console.log("═══ RELEASE DOCTOR — قرائيّ بحت، ⛔ لا يغيّر شيئًا ═══\n");
  for (const r of rs) console.log(`${icon[r.level]} ${r.check.padEnd(22)} ${r.detail}`);
  const s = summarize(rs);
  console.log(`\nPASS ${s.pass} · WARN ${s.warn} · BLOCK ${s.block}`);
  console.log(`VERDICT: ${s.verdict}`);
  if (s.verdict === "BLOCK") {
    console.log("\n🔴 لا يُنشر ولا يُشغَّل SQL قبل معالجة كل BLOCK.");
    process.exit(1);
  }
}
