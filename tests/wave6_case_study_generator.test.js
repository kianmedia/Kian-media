// ════════════════════════════════════════════════════════════════════════════
// tests/wave6_case_study_generator.test.js
//
// Wave 6 · V2-6.8-A/B/C — مولّد دراسات الحالة داخل منصّة cs_* القائمة.
//
// المُصدِّر يُنفَّذ **فعليًّا** في مجلّد مؤقّت — لا داخل المستودع.
// ⛔ لا SQL · لا قاعدة · لا شبكة · لا AI · لا Push · لا PR.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (r) => fs.readFileSync(path.join(ROOT, r), "utf8");
const has = (r) => fs.existsSync(path.join(ROOT, r));

function codeOnly(sql) {
  let out = "", i = 0, q = false;
  while (i < sql.length) {
    const c = sql[i];
    if (q) { if (c === "'") { if (sql.startsWith("''", i)) { out += "  "; i += 2; continue; } q = false; } out += c === "\n" ? "\n" : " "; i++; continue; }
    if (c === "'") { q = true; out += " "; i++; continue; }
    if (sql.startsWith("--", i)) { while (i < sql.length && sql[i] !== "\n") { out += " "; i++; } continue; }
    out += c; i++;
  }
  return out;
}
const noComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
const bodyOf = (src, name) => {
  const t = noComments(src);
  const i = t.indexOf(`function public.${name}`);
  return i < 0 ? "" : t.slice(i, t.indexOf("$$;", i));
};

const GEN = () => read("docs/wave6_case_study_generator_RUNME.sql");
const SCRIPT = () => read("scripts/export-case-studies.mjs");
const UI = () => read("components/portal/registers/CaseStudyDrafts.tsx");

const catches = (label, src, mutate, check) => {
  const m = mutate(src);
  assert.notEqual(m, src, `الطفرة لم تغيّر شيئًا: ${label}`);
  let threw = false;
  try { check(m); } catch { threw = true; }
  assert.ok(threw, `🔴 الطفرة لم تُرصد: ${label}`);
};

// ═══ لا منصّة ثانية ═════════════════════════════════════════════════════════

test("(C-1) ★★★ لا منصّة دراسات حالة ثانية ولا محرّك حالات ثانٍ ★★★", () => {
  const c = codeOnly(GEN());
  // ⛔ لا جدول: التوسعة أعمدة على الجدول القائم.
  assert.doesNotMatch(c, /create\s+table/i, "🔴 جدول جديد — منصّة ثانية");
  assert.match(c, /alter table public\.cs_case_studies/i, "لا توسعة على المنصّة القائمة");
  // ⛔ ولا طابور منفصل (V2-6.8-B: حالة داخل cs_* لا جدولًا).
  for (const bad of ["portfolio_drafts", "case_study_drafts", "cs_drafts"]) {
    assert.ok(!c.includes(bad), `🔴 طابور منفصل: ${bad}`);
  }
  // ⛔ ولا مفردات حالة جديدة: يُقرأ ما هو قائم.
  assert.doesNotMatch(c, /check \(status in/i, "🔴 محرّك حالات ثانٍ");
  // والصلاحية عبر بوّابات المنصّة.
  assert.match(c, /public\.cs_is_staff\(\)/, "🔴 نموذج صلاحيات ثانٍ");
  assert.match(c, /public\.cs_is_admin\(\)/, "🔴 التصدير بلا بوّابة إدارة");
});

// ═══ التوليد ════════════════════════════════════════════════════════════════

test("(C-2) ★★★ المولّد يُنشئ **مسوّدة** — ولا ينشر ولا يتخطّى مراجعة ★★★", () => {
  const fn = bodyOf(GEN(), "cs_generate_draft");
  assert.ok(fn.length > 0, "المولّد مفقود");
  // 🔴 الحالة مثبَّتة على draft حرفيًّا.
  assert.match(fn, /'draft',/, "🔴 لا يُنشئ مسوّدة");
  for (const s of ["published", "approved", "scheduled"]) {
    assert.ok(!new RegExp(`'${s}'`).test(fn), `🔴 المولّد يضع حالة ${s}`);
  }
  assert.match(fn, /'auto_published', false/, "🔴 لا إعلان بعدم النشر التلقائيّ");
  // ⛔ ولا يكتب في نسخة أو ينشر.
  assert.doesNotMatch(fn, /cs_publish|published_version_id/i, "🔴 يمسّ النشر");

  catches("جعل المولّد ينشر", GEN(),
    (m) => m.replace("     'draft',", "     'published',"),
    // ⚠️ مثبَّت على قيمة الإدراج نفسها: الجسم يذكر 'draft' مرّة أخرى في الردّ،
    //    ففحص عامّ كان سيمرّ رغم قلب الحالة المُدرَجة.
    (m) => {
      const f = bodyOf(m, "cs_generate_draft");
      const ins = f.slice(f.indexOf("values"), f.indexOf("returning id"));
      assert.match(ins, /'draft',/);
    });
});

test("(C-3) ★★★ لا نصّ مخترَع ولا نسخ محتوى تسويقيّ ★★★", () => {
  const fn = bodyOf(GEN(), "cs_generate_draft");
  // 🔴 الحقول العامّة كلّها تبقى فارغة — القالب هيكل لا محتوى.
  for (const f of ["public_title_ar", "summary_ar", "challenge_ar", "solution_ar",
                   "results_ar", "testimonial_ar", "client_display_name"]) {
    assert.ok(!fn.includes(f), `🔴 المولّد يملأ حقلًا عامًّا: ${f}`);
  }
  // ولا يقرأ من جدول المشاريع قيمًا.
  assert.doesNotMatch(fn, /select[\s\S]{0,120}from public\.projects/i,
    "🔴 يقرأ قيمًا من المشروع — نسخ محتوى");
  // provenance مفاتيح لا قيم.
  assert.match(fn, /'allowed_fields', to_jsonb\(public\.cs_source_allowed_fields\(\)\)/,
    "🔴 لا تسجيل للحقول المسموح بها");
  assert.match(fn, /PENDING KHALED CONTENT REVIEW/, "🔴 لا إعلان أنّ النصّ ينتظر مراجعة");
});

test("(C-4) ★★★ قائمة بيضاء للحقول — لا قائمة ممنوعات ★★★", () => {
  const fn = bodyOf(GEN(), "cs_source_allowed_fields");
  assert.ok(fn.length > 0, "القائمة البيضاء مفقودة");
  // ⛔ ما ليس فيها لا يصل مسوّدة عامّة.
  for (const banned of ["internal_notes", "budget", "cost", "margin", "contact",
                        "employee", "phone", "email", "storage_path", "signed"]) {
    assert.ok(!fn.includes(banned), `🔴 حقل حسّاس في القائمة البيضاء: ${banned}`);
  }
  assert.match(fn, /project_title/, "القائمة فارغة من الحقول المتوقّعة");

  catches("إضافة حقل مالي إلى القائمة البيضاء", GEN(),
    (m) => m.replace("'project_title','project_type','city','sector',",
                     "'project_title','project_type','city','sector','budget',"),
    (m) => {
      const f = bodyOf(m, "cs_source_allowed_fields");
      assert.ok(!f.includes("budget"));
    });
});

// ═══ الاعتماد قبل التصدير ═══════════════════════════════════════════════════

test("(C-5) ★★★ التصدير يشترط الاعتماد · والاعتماد ≠ النشر ★★★", () => {
  const fn = bodyOf(GEN(), "cs_mark_exported");
  assert.match(fn, /status not in \('approved','scheduled','published'\)/,
    "🔴 مسوّدة يمكن تصديرها");
  assert.match(fn, /'not_approved'/, "لا رفض صريح");
  // والطابور يُعلن الفرق مشتقًّا.
  const q = bodyOf(GEN(), "cs_draft_queue");
  assert.match(q, /'exportable', \(c\.status = 'approved'\)/, "🔴 لا تمييز للقابل للتصدير");
  assert.match(q, /'is_published', \(c\.status = 'published'\)/, "🔴 لا تمييز للمنشور");
  // والواجهة تُظهرهما مختلفَين.
  assert.match(UI(), /r\.is_published \? "text-emerald-500"/, "🔴 الواجهة تخلط المعتمَد بالمنشور");
  assert.match(UI(), /⛔ لا يُصدَّر قبل الاعتماد/, "🔴 الواجهة لا تشرح المنع");

  catches("السماح بتصدير مسوّدة", GEN(),
    (m) => m.replace("  if r.status not in ('approved','scheduled','published') then\n    return jsonb_build_object('ok', false, 'reason', 'not_approved', 'status', r.status);\n  end if;\n", ""),
    (m) => assert.match(bodyOf(m, "cs_mark_exported"), /status not in \('approved'/));
});

// ═══ 🔴 القيد الصلب: لا كتابة ملفّ وقت التشغيل ══════════════════════════════

test("(C-6) ★★★ لا كتابة نظام ملفّات في أيّ مسار خادميّ ★★★", () => {
  // ⛔ لا مسار API يكتب ملفًّا — الكتابة تُفقد عند أوّل نشر على Vercel.
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : walk(p);
    return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
  const apiFiles = has("app/api") ? walk(path.join(ROOT, "app/api")) : [];
  for (const f of apiFiles) {
    const src = fs.readFileSync(f, "utf8");
    for (const re of [/\bwriteFile\b/, /\bwriteFileSync\b/, /\bappendFile\b/, /\bmkdirSync\b/,
                      /from ["']node:fs["']/, /from ["']fs["']/]) {
      assert.doesNotMatch(src, re,
        `🔴 ${path.relative(ROOT, f)} يكتب في نظام الملفّات — يُفقد عند أوّل نشر`);
    }
  }
  // ولا القاعدة تكتب ملفًّا ولا تخرج إلى الشبكة.
  const c = codeOnly(GEN());
  for (const re of [/pg_net/i, /copy\s+.*\bto\b/i, /pg_write/i, /lo_export/i]) {
    assert.doesNotMatch(c, re, "🔴 القاعدة تكتب ملفًّا أو تخرج للشبكة");
  }
});

test("(C-7) ★★★ المُصدِّر يرفض بيئة النشر صراحةً ★★★", async () => {
  const s = SCRIPT();
  assert.match(s, /assertNotDeployedRuntime/, "لا حارس بيئة");
  assert.match(s, /env\.VERCEL \|\| env\.VERCEL_ENV \|\| env\.NEXT_RUNTIME/,
    "🔴 الحارس لا يفحص متغيّرات بيئة النشر");
  const mod = await import(path.join(ROOT, "scripts/export-case-studies.mjs"));
  // يمرّ في بيئة نظيفة…
  assert.equal(mod.assertNotDeployedRuntime({}), true);
  // …ويرفض في كلّ صورة من صور النشر.
  for (const env of [{ VERCEL: "1" }, { VERCEL_ENV: "production" }, { NEXT_RUNTIME: "nodejs" }]) {
    assert.throws(() => mod.assertNotDeployedRuntime(env), /EXPORT_FORBIDDEN_IN_DEPLOYED_RUNTIME/,
      `🔴 لم يُرفض التشغيل في ${JSON.stringify(env)}`);
  }
  // ⛔ ولا Push ولا PR من السكربت.
  for (const re of [/child_process/, /execSync/, /\bgit\s+push\b/, /\bgh\s+pr\b/]) {
    assert.doesNotMatch(s, re, "🔴 السكربت يدفع أو يفتح PR");
  }
});

test("(C-8) ★★★ اسم الملفّ مُعقَّم · ولا خروج من المجلّد · ولا استبدال صامت ★★★", async () => {
  const mod = await import(path.join(ROOT, "scripts/export-case-studies.mjs"));
  // 🔴 slug يأتي من قاعدة بيانات: «../» فيه يكتب خارج الهدف.
  assert.equal(mod.safeFileName("Hello World/../etc"), "hello-world-etc");
  // الحروف غير اللاتينية تسقط، ثمّ تُقصّ الشرطة الطرفية — والنتيجة "slug".
  assert.equal(mod.safeFileName("عربي-slug"), "slug");
  for (const bad of ["", "..", "/", "///"]) {
    assert.throws(() => mod.safeFileName(bad), /UNSAFE_SLUG/, `لم يُرفض: ${JSON.stringify(bad)}`);
  }
  assert.throws(() => mod.resolveInside("/tmp/out", "../escape.json"), /PATH_TRAVERSAL_BLOCKED/);

  // ─── تشغيل فعليّ في مجلّد مؤقّت — ⛔ لا كتابة داخل المستودع ───
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "cs-export-"));
  try {
    const rows = [
      { slug: "approved-one", status: "approved", public_title_ar: "دراسة", client_display_name: "عميل", client_identity_visibility: "named" },
      { slug: "draft-one", status: "draft", public_title_ar: "مسوّدة" },
    ];
    const out1 = await mod.exportRows(rows, { outDir: dir, format: "json" });
    // 🔴 المسوّدة لا تُصدَّر.
    assert.equal(out1.find((r) => r.slug === "draft-one").written, false);
    assert.equal(out1.find((r) => r.slug === "draft-one").reason, "not_approved");
    assert.equal(out1.find((r) => r.slug === "approved-one").written, true);
    assert.ok(fs.existsSync(path.join(dir, "approved-one.json")));

    // ⛔ لا استبدال صامت في التشغيل الثاني.
    const out2 = await mod.exportRows(rows, { outDir: dir, format: "json" });
    assert.equal(out2.find((r) => r.slug === "approved-one").written, false);
    assert.equal(out2.find((r) => r.slug === "approved-one").reason, "exists");

    // الإخراج ثابت: نفس المدخل ⇒ نفس البايتات.
    assert.equal(mod.toJson(rows[0]), mod.toJson(rows[0]));
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test("(C-9) ★★★ التقنيع: لا حقل خارج القائمة · والتجهيل يُطبَّق فعليًّا ★★★", async () => {
  const mod = await import(path.join(ROOT, "scripts/export-case-studies.mjs"));
  const row = {
    slug: "x", status: "approved",
    public_title_ar: "عنوان",
    client_display_name: "شركة حقيقية",
    client_identity_visibility: "anonymized",
    anonymized_label_ar: "جهة صناعية",
    // ⛔ كلّ ما يلي يجب أن يسقط.
    internal_notes: "ملاحظة داخلية", budget: 100000, margin: 0.4,
    contact_email: "a@b.c", employee_name: "موظّف",
    storage_path: "bucket/secret.pdf", signed_url: "https://x/y?token=z",
  };
  const out = mod.redact(row);
  for (const leaked of ["internal_notes", "budget", "margin", "contact_email",
                        "employee_name", "storage_path", "signed_url"]) {
    assert.ok(!(leaked in out), `🔴 تسرّب حقل: ${leaked}`);
  }
  // 🔴 التجهيل يُطبَّق فعليًّا: الاسم الحقيقيّ يُحذف لا يُخفى بالعرض.
  assert.ok(!("client_display_name" in out), "🔴 اسم العميل بقي رغم التجهيل");
  assert.equal(out.anonymized_label_ar, "جهة صناعية");
  // والمسمّى يظهر حين يكون معلنًا.
  const named = mod.redact({ ...row, client_identity_visibility: "named" });
  assert.equal(named.client_display_name, "شركة حقيقية");

  // ونفس التقنيع في المخرَج النصّيّ.
  const md = mod.toMarkdown(row);
  for (const leaked of ["شركة حقيقية", "ملاحظة داخلية", "100000", "a@b.c", "bucket/secret.pdf"]) {
    assert.ok(!md.includes(leaked), `🔴 تسرّب في Markdown: ${leaked}`);
  }
});

// ═══ العلم والأمن ═══════════════════════════════════════════════════════════

test("(C-10) ★★★ العلم مطفأ ⇒ لا شاشة ولا توليد ولا استدعاء ★★★", () => {
  const lib = read("lib/portal/caseStudies.ts");
  assert.match(lib, /NEXT_PUBLIC_SHOW_CASE_STUDY_DRAFTS === "true"/, "العلم ليس مقارنة صارمة");
  const page = read("app/(portal)/client-portal/registers/page.tsx");
  assert.match(page, /caseStudyDraftsEnabled\(\) && <CaseStudyDrafts \/>/,
    "🔴 الشاشة تُركَّب ثمّ تُخفى — استدعاء خلف بوّابة مغلقة");
});

test("(C-11) ★★ الأمن: REVOKE قبل GRANT · لا anon · search_path مثبَّت ★★", () => {
  const c = codeOnly(GEN());
  const fns = [...c.matchAll(/create\s+or\s+replace\s+function\s+public\.([a-z0-9_]+)/gi)].map((m) => m[1]);
  assert.ok(fns.length >= 4, `عدد الدوالّ ${fns.length}`);
  for (const f of fns) {
    assert.ok(f.startsWith("cs_"), `🔴 ${f} خارج بادئة المنصّة`);
    assert.match(c, new RegExp(`revoke all on function public\\.${f}\\(`), `🔴 ${f} بلا REVOKE`);
  }
  assert.doesNotMatch(c, /grant execute on function[^;]*\banon\b/i, "🔴 دالّة لـanon");
  assert.doesNotMatch(c, /grant\s+all\b/i, "🔴 منح شامل");
  // 🔴 الشرط: **كلّ** security definer بـsearch_path مثبَّت. والعكس ليس شرطًا —
  //    دالّة `sql immutable` غير definer قد تثبّته أيضًا، وهو تشدّد لا خلل.
  const defs = (c.match(/security\s+definer/gi) || []).length;
  const paths = (c.match(/set\s+search_path\s*=\s*public/gi) || []).length;
  assert.ok(defs > 0, "لا دوالّ security definer");
  assert.ok(paths >= defs, `🔴 ${defs - paths} دالّة security definer بلا search_path مثبَّت`);
  // ولا تعريف definer يخلو من التثبيت في سطره.
  for (const m of c.matchAll(/language plpgsql[^;]*?security definer([^;]*?)as \$\$/gi)) {
    assert.match(m[1], /set search_path = public/, "🔴 security definer بلا search_path");
  }
  // PREFLIGHT/POSTCHECK لا يكتبان.
  for (const n of ["PREFLIGHT", "POSTCHECK"]) {
    const q = codeOnly(read(`docs/wave6_case_study_generator_${n}.sql`));
    for (const re of [/\bcreate\s+(table|function|index|view)/i, /\balter\s+table/i,
                      /\binsert\s+into/i, /\bdelete\s+from/i, /\bdrop\s+/i]) {
      assert.doesNotMatch(q, re, `🔴 ${n} يكتب`);
    }
  }
});
