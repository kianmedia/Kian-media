// ════════════════════════════════════════════════════════════════════════════
// Wave 1 · V2-1.3-A — عقد metadata والcanonical لكل مسار
//
// ★ العطل الذي يحرسه هذا الملف ★
// app/layout.tsx يعلن canonical واحدًا مطلقًا للموقع كله. في App Router تَرِثه
// كل صفحة لا تتجاوزه — فكانت تسع صفحات عامة تخبر محركات البحث أن «النسخة
// الأساسية من هذه الصفحة هي الرئيسية». ذلك ليس نقصًا تجميليًا: canonical ذاتي
// المرجع هو ما يجعل الصفحة تستحق إدراجًا مستقلًا.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const ROOT = path.resolve(__dirname, "..");
const read = (r) => fs.readFileSync(path.join(ROOT, r), "utf8");

/** يحمّل lib/seo.ts بمصرّف TS الحقيقي، مع تعويض الاستيرادات. */
function loadSeo() {
  const js = ts.transpileModule(read("lib/seo.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  const fakeRequire = (id) => {
    if (id === "@/lib/site") return { SITE_URL: "https://kianmedia.com" };
    return {}; // "next" — النوع فقط، يُمحى عند التصريف
  };
  // eslint-disable-next-line no-new-func
  new Function("exports", "module", "require", js)(module.exports, module, fakeRequire);
  return module.exports;
}
const SEO = loadSeo();

/** المسارات العامة التي يجب أن تحمل metadata خاصة. */
const ROUTES = ["quote-request", "book-meeting", "upload-files", "opportunities",
                "privacy-policy", "terms", "live-status", "quick-access", "assistant"];

test("★ V2-1.3-A: كل مسار عام يحمل canonical ذاتي المرجع لا canonical الرئيسية", () => {
  for (const k of ROUTES) {
    const m = SEO.seoFor(k);
    const expected = `https://kianmedia.com/${k}`;
    assert.equal(m.alternates.canonical, expected, `canonical خاطئ في /${k}`);
    assert.notEqual(m.alternates.canonical, "https://kianmedia.com",
      `🔴 /${k} ما زال يشير إلى الرئيسية`);
    assert.equal(m.openGraph.url, expected, `openGraph.url لا يطابق canonical في /${k}`);
  }
});

test("★ كل مسار له عنوان ووصف فريدان", () => {
  const titles = new Map(), descs = new Map();
  for (const k of ROUTES) {
    const m = SEO.seoFor(k);
    assert.ok(m.title && m.title.length > 10, `عنوان قصير أو مفقود في /${k}`);
    // صفحة noindex لا تُعرض في نتائج البحث، فيكفيها وصف مختصر؛ أمّا الصفحات
    // المُدرَجة فوصفها هو ما يُقرأ في النتيجة ويجب أن يكون كافيًا.
    const min = SEO.ROUTE_SEO[k].noindex ? 20 : 60;
    assert.ok(m.description && m.description.length >= min,
      `وصف قصير (${m.description?.length}) في /${k} — الحد ${min}`);
    if (titles.has(m.title)) assert.fail(`عنوان مكرر بين /${titles.get(m.title)} و /${k}`);
    if (descs.has(m.description)) assert.fail(`وصف مكرر بين /${descs.get(m.description)} و /${k}`);
    titles.set(m.title, k); descs.set(m.description, k);
  }
});

test("لكل مسار ملف layout.tsx يصدّر metadata من المصدر الموحّد", () => {
  for (const k of ROUTES) {
    const rel = `app/${k}/layout.tsx`;
    assert.ok(fs.existsSync(path.join(ROOT, rel)), `مفقود: ${rel}`);
    const src = read(rel);
    assert.ok(src.includes("export const metadata"), `${rel} لا يصدّر metadata`);
    assert.ok(src.includes(`seoFor("${k}")`), `${rel} لا يستخدم المفتاح الصحيح`);
    // ❌ لا نسخة يدوية من الـcanonical داخل الـlayout — مصدر واحد فقط (G13).
    assert.ok(!src.includes("canonical:"), `${rel} يكتب canonical يدويًا بدل استخدام lib/seo.ts`);
  }
});

test("صفحات الأدوات noindex ولكن بـcanonical — الإدراج والهوية أمران منفصلان", () => {
  for (const k of ["live-status", "quick-access", "assistant"]) {
    const m = SEO.seoFor(k);
    assert.equal(m.robots.index, false, `/${k} يجب أن يكون noindex`);
    assert.equal(m.robots.follow, true, `/${k} يجب أن يظل follow — الروابط الخارجة تبقى نافذة`);
    assert.ok(m.alternates.canonical, `/${k} فقد canonical — noindex لا يلغي الهوية`);
  }
  // والصفحات ذات القيمة البحثية يجب ألّا تكون noindex.
  for (const k of ["quote-request", "book-meeting", "opportunities", "privacy-policy", "terms"]) {
    assert.ok(!SEO.seoFor(k).robots, `🔴 /${k} صار noindex — هذه صفحة يجب أن تُدرَج`);
  }
});

test("canonicalFor يبني عناوين مطلقة بلا شرطة زائدة", () => {
  assert.equal(SEO.canonicalFor("/"), "https://kianmedia.com");
  assert.equal(SEO.canonicalFor("/terms"), "https://kianmedia.com/terms");
});

test("G13: مصدر واحد للـSEO — لا نسخة ثانية من نصوص الوصف", () => {
  const seoSrc = read("lib/seo.ts");
  for (const k of ROUTES) {
    const desc = SEO.ROUTE_SEO[k].description;
    // النصّ يجب أن يظهر مرة واحدة فقط في المستودع: داخل lib/seo.ts.
    assert.ok(seoSrc.includes(desc), `وصف /${k} ليس في المصدر الموحّد`);
    assert.ok(!read(`app/${k}/layout.tsx`).includes(desc.slice(0, 25)),
      `🔴 وصف /${k} مكرر داخل layout.tsx`);
  }
});
