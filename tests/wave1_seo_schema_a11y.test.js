// ════════════════════════════════════════════════════════════════════════════
// Wave 1 · V2-1.11 / V2-1.7 / V2-1.10 — SEO pages · JSON-LD · إتاحة
//
// ساكنة بالكامل: تقرأ ملفات المستودع ومخرَج البناء. لا شبكة · لا قاعدة · لا
// Production. **لم يُشغَّل axe ولا Lighthouse، ولا يُدّعى اجتيازهما.**
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const ROOT = path.resolve(__dirname, "..");
const read = (r) => fs.readFileSync(path.join(ROOT, r), "utf8");
const exists = (r) => fs.existsSync(path.join(ROOT, r));

function loadTs(rel, fake = () => ({})) {
  const js = ts.transpileModule(read(rel), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const m = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function("exports", "module", "require", js)(m.exports, m, fake);
  return m.exports;
}

const SEO = loadTs("content/seo-pages.ts");
const SD = loadTs("lib/structuredData.ts", (id) => {
  if (id === "@/lib/site") return { SITE_URL: "https://kianmedia.com" };
  if (id === "@/content/portfolio") return loadTs("content/portfolio.ts");
  return {};
});
const P = loadTs("content/portfolio.ts");

// ═══ V2-1.11 · صفحات SEO ═══════════════════════════════════════════════════

test("V2-1.11: ٦ خدمات + ٣ مدن، بمسارات فريدة", () => {
  assert.equal(SEO.seoPagesOfKind("service").length, 6);
  assert.equal(SEO.seoPagesOfKind("city").length, 3);
  const slugs = SEO.SEO_PAGES.map((p) => `${p.kind}/${p.slug}`);
  assert.equal(new Set(slugs).size, 9, "مسار مكرر");
  assert.deepEqual(SEO.seoPagesOfKind("service").map((p) => p.slug).sort(),
    ["corporate-films", "documentary-production", "drone-filming",
     "live-streaming", "podcast-production", "real-estate-videography"]);
  assert.deepEqual(SEO.seoPagesOfKind("city").map((p) => p.slug).sort(),
    ["dammam", "jeddah", "riyadh"]);
});

test("★ V2-1.11: العلم مطفأ افتراضيًا، وأي قيمة غير 'true' تعني OFF", () => {
  const load = (v) => {
    const js = ts.transpileModule(read("content/seo-pages.ts"),
      { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    const m = { exports: {} };
    // eslint-disable-next-line no-new-func
    new Function("exports", "module", "require", "process", js)(m.exports, m, () => ({}),
      { env: v === undefined ? {} : { NEXT_PUBLIC_SHOW_SEO_PAGES: v } });
    return m.exports.seoPagesEnabled();
  };
  for (const v of [undefined, "", "false", "1", "yes", "TRUE"]) assert.equal(load(v), false, `${v} فعّل العلم`);
  assert.equal(load("true"), true);
});

test("★ V2-1.11: كل صفحة عربية وإنجليزية معًا، بلا حقل فارغ", () => {
  for (const p of SEO.SEO_PAGES) {
    for (const k of ["titleAr", "descriptionAr", "h1Ar", "introAr", "titleEn", "descriptionEn", "h1En", "introEn"]) {
      assert.ok(typeof p[k] === "string" && p[k].trim().length > 10, `${p.slug}: ${k} فارغ أو قصير`);
    }
    assert.ok(p.pointsAr.length >= 3 && p.pointsEn.length >= 3, `${p.slug}: نقاط ناقصة`);
    assert.ok(!/[؀-ۿ]/.test(p.titleEn), `${p.slug}: العنوان الإنجليزي يحوي عربية`);
    assert.ok(/[؀-ۿ]/.test(p.titleAr), `${p.slug}: العنوان العربي ليس عربيًا`);
  }
});

test("★ V2-1.11: عناوين وأوصاف فريدة عبر الصفحات التسع", () => {
  for (const k of ["titleAr", "descriptionAr", "titleEn", "descriptionEn"]) {
    const seen = new Map();
    for (const p of SEO.SEO_PAGES) {
      if (seen.has(p[k])) assert.fail(`${k} مكرر بين ${seen.get(p[k])} و ${p.slug}`);
      seen.set(p[k], p.slug);
    }
  }
});

test("🔴 V2-1.11: لا ادّعاءات مختلقة — أرقام أو جوائز أو عملاء أو تقييمات", () => {
  const BANNED = [
    /\bجائزة|جوائز\b/, /\baward/i, /معتمد من|شهادة اعتماد/, /\bcertified by\b/i,
    /\bتقييم\s*[0-9]/, /\b[0-9](\.[0-9])?\s*\/\s*5\b/, /\brating\b/i,
    /\bأكثر من\s*[٠-٩0-9]+\s*(عميل|مشروع|شركة)/, /\bover\s+[0-9,]+\s+(clients|projects|brands)/i,
    /\b(الأفضل|الأول|الرائد|الأكبر)\b/, /\b(best|leading|number one|#1)\b/i,
    /\bخلال\s*[٠-٩0-9]+\s*(ساعة|يوم)\b/, /\bwithin\s+[0-9]+\s+(hours|days)\b/i,
    /\bريال|SAR\s*[0-9]|\$[0-9]/,
  ];
  for (const p of SEO.SEO_PAGES) {
    const blob = [p.titleAr, p.descriptionAr, p.h1Ar, p.introAr, ...p.pointsAr,
                  p.titleEn, p.descriptionEn, p.h1En, p.introEn, ...p.pointsEn].join(" | ");
    for (const rx of BANNED) {
      assert.ok(!rx.test(blob), `🔴 ادّعاء غير موثّق في ${p.slug} يطابق ${rx}`);
    }
  }
});

test("V2-1.11: مسارات اللغتين صحيحة", () => {
  const svc = SEO.seoPageBySlug("service", "drone-filming");
  assert.equal(SEO.seoPagePath(svc, "ar"), "/services/drone-filming");
  assert.equal(SEO.seoPagePath(svc, "en"), "/en/services/drone-filming");
  const city = SEO.seoPageBySlug("city", "riyadh");
  assert.equal(SEO.seoPagePath(city, "ar"), "/cities/riyadh");
  assert.equal(SEO.seoPagePath(city, "en"), "/en/cities/riyadh");
});

test("★ V2-1.11: الأربع مسارات موجودة وكلها تستدعي notFound خلف العلم", () => {
  const routes = ["app/(ar)/services/[slug]/page.tsx", "app/(ar)/cities/[slug]/page.tsx",
                  "app/(en)/en/services/[slug]/page.tsx", "app/(en)/en/cities/[slug]/page.tsx"];
  for (const r of routes) {
    assert.ok(exists(r), `مسار مفقود: ${r}`);
    const s = read(r);
    assert.ok(/if \(!seoPagesEnabled\(\)\) notFound\(\);/.test(s), `${r}: لا حارس علم`);
    assert.ok(/if \(!seoPagesEnabled\(\)\) return \[\];/.test(s), `${r}: يبني مسارات والعلم مطفأ`);
    assert.ok(s.includes('"x-default"'), `${r}: لا x-default`);
    assert.ok(s.includes("SeoLandingPage"), `${r}: لا يستخدم العارض الموحّد`);
    // ❌ لا نسخة محتوى داخل المسار — طبقة واحدة (G13).
    // القراءة من `page.titleAr` استهلاك لا تكرار؛ التكرار هو **نصّ عربي حرفي**
    // داخل المسار. (الفحص الأول أدان الاستهلاك — خطأ في الاختبار لا في الكود.)
    const arabicLiteral = /["'`][^"'`]*[؀-ۿ]{6,}[^"'`]*["'`]/.test(s.replace(/^\s*\/\/.*$/gm, ""));
    assert.ok(!arabicLiteral, `${r}: يحوي نصًّا عربيًا حرفيًا — المحتوى مكانه content/seo-pages.ts`);
  }
});

test("★ V2-1.11: العلم مطفأ ⇒ لا صفحة SEO في مخرَج البناء", () => {
  const dir = path.join(ROOT, ".next/server/app");
  if (!fs.existsSync(dir)) return;                 // no build to inspect
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const leaked = walk(dir).filter((f) => /\/(services|cities)\/[^/]+\.html$/.test(f));
  assert.deepEqual(leaked.map((f) => path.relative(dir, f)), [],
    "🔴 صُدِّرت صفحة SEO والعلم مطفأ");
});

test("★ V2-1.11: sitemap لا يذكر صفحات SEO والعلم مطفأ", () => {
  const s = read("app/sitemap.ts");
  assert.ok(s.includes("seoPagesEnabled()"), "sitemap لا يفحص العلم");
  assert.ok(/seoPagesEnabled\(\)\s*\?[\s\S]{0,600}:\s*\[\]/.test(s),
    "🔴 يجب أن يعيد [] عندما يكون العلم مطفأ");
  const built = path.join(ROOT, ".next/server/app/sitemap.xml.body");
  if (fs.existsSync(built)) {
    const xml = fs.readFileSync(built, "utf8");
    assert.ok(!/\/services\/|\/cities\//.test(xml), "🔴 sitemap المُولَّد يحوي صفحات SEO");
  }
});

test("★ V2-1.11: لا رابط إلى صفحات SEO من التنقل الرئيسي", () => {
  for (const f of ["components/Navbar.tsx", "components/Footer.tsx"]) {
    const s = read(f);
    assert.ok(!/href="\/(services|cities)\//.test(s), `🔴 ${f} يربط بصفحة SEO والعلم مطفأ`);
  }
});

// ═══ V2-1.7 · JSON-LD ══════════════════════════════════════════════════════

test("V2-1.7-A: LocalBusiness صالح وبلا حقل مختلق", () => {
  const b = SD.localBusinessJsonLd();
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(b)));
  assert.equal(b["@context"], "https://schema.org");
  assert.ok(b.url.startsWith("https://"));
  assert.ok(b.image.startsWith("https://"));
  assert.equal(b.address.addressCountry, "SA");
  // ❌ لا تقييمات ولا جوائز ولا أسعار — لا يملكها المستودع.
  for (const k of ["aggregateRating", "review", "priceRange", "award", "numberOfEmployees"]) {
    assert.ok(!(k in b), `🔴 حقل مختلق: ${k}`);
  }
  const empty = Object.entries(b).filter(([, v]) => v === "" || v === null || v === undefined);
  assert.deepEqual(empty, [], "حقول فارغة في LocalBusiness");
});

test("★ V2-1.7-C: BreadcrumbList مواضعه 1-based وروابطه مطلقة", () => {
  for (const locale of ["ar", "en"]) {
    for (const p of SEO.SEO_PAGES) {
      const b = SD.breadcrumbJsonLd(p, locale);
      assert.equal(b["@type"], "BreadcrumbList");
      assert.equal(b.itemListElement.length, 3);
      b.itemListElement.forEach((it, i) => {
        assert.equal(it.position, i + 1, "المواضع يجب أن تبدأ من 1");
        assert.ok(it.name && it.name.trim(), "اسم فارغ في المسار");
        assert.ok(/^https:\/\/kianmedia\.com/.test(it.item), `رابط غير مطلق: ${it.item}`);
        assert.ok(!/undefined|null|\/\/$/.test(it.item), `رابط مشوَّه: ${it.item}`);
      });
      // آخر عنصر يجب أن يطابق مسار الصفحة الفعلي
      assert.equal(b.itemListElement[2].item, `https://kianmedia.com${SEO.seoPagePath(p, locale)}`);
    }
  }
});

test("🔴 V2-1.7-B: VideoObject لا يُصدَر بلا بيانات حقيقية", () => {
  // لا عمل يحمل uploadDate اليوم ⇒ لا عمل مؤهَّل.
  for (const w of P.WORKS) {
    assert.equal(SD.isVideoEligible(w), false, `العمل ${w.id} اعتُبر مؤهَّلًا بلا uploadDate`);
    assert.equal(SD.videoObjectJsonLd(w, "ar"), null, `🔴 صُدِّرت Schema للعمل ${w.id} بلا بيانات`);
  }
  // ومع تاريخ حقيقي يصبح مؤهَّلًا وتُبنى Schema كاملة.
  const w = P.WORKS[0];
  const v = SD.videoObjectJsonLd(w, "ar", { uploadDate: "2025-03-01" });
  assert.ok(v, "لم تُبنَ Schema رغم توفر البيانات");
  assert.equal(v.uploadDate, "2025-03-01");
  assert.ok(v.thumbnailUrl.startsWith("https://"));
  assert.ok(v.contentUrl.includes(w.yt));
  assert.ok(!("duration" in v), "duration لم يُعطَ فيجب ألّا يظهر");
  const empty = Object.entries(v).filter(([, x]) => x === "" || x === null || x === undefined);
  assert.deepEqual(empty, [], "حقول فارغة في VideoObject");
});

test("🔴 V2-1.7-B: التاريخ الملفَّق 2026-01-01 اختفى من الشيفرة", () => {
  const s = read("components/RootDocument.tsx");
  const code = s.replace(/^\s*\/\/.*$/gm, "");   // التعليق يشرحه عمدًا
  assert.ok(!/uploadDate/.test(code), "🔴 عاد uploadDate المختلق إلى الشيفرة");
  assert.ok(!/videoSchema/.test(code), "🔴 عاد إصدار VideoObject من الغلاف");
});

test("V2-1.7: كل JSON-LD مُصدَّر قابل للتحليل", () => {
  const blobs = [SD.localBusinessJsonLd(),
                 ...SEO.SEO_PAGES.map((p) => SD.breadcrumbJsonLd(p, "ar"))];
  for (const b of blobs) {
    const s = JSON.stringify(b);
    assert.doesNotThrow(() => JSON.parse(s));
    assert.ok(!/undefined/.test(s), "قيمة undefined تسرّبت إلى JSON-LD");
  }
});

// ═══ V2-1.10 · الإتاحة ═════════════════════════════════════════════════════

test("★ V2-1.10-A: skip link أول عنصر قابل للتركيز، ويشير إلى #main", () => {
  const s = read("components/RootDocument.tsx");
  const body = s.slice(s.indexOf("<body"));
  assert.ok(/<a href="#main" className="skip-link"/.test(body), "لا skip link");
  assert.ok(body.indexOf('href="#main"') < body.indexOf("{children}"),
    "🔴 skip link يجب أن يسبق المحتوى ليكون أول ما يُركَّز عليه");
  const css = read("app/globals.css");
  assert.ok(/\.skip-link\s*\{/.test(css) && /\.skip-link:focus\s*\{/.test(css), "لا أنماط skip link");
  // display:none يُخرجه من ترتيب التنقل كليًا ويُبطل الغرض منه.
  const block = css.slice(css.indexOf(".skip-link"), css.indexOf(".skip-link:focus"));
  assert.ok(!/display:\s*none/.test(block), "🔴 skip link مخفي بـdisplay:none — غير قابل للتركيز");
});

test("★ V2-1.10-A: هدف #main موجود على الصفحات العامة", () => {
  const pages = ["app/(ar)/page.tsx", "app/(ar)/terms/page.tsx", "app/(ar)/privacy-policy/page.tsx",
                 "app/(ar)/opportunities/page.tsx", "components/forms/FormShell.tsx",
                 "components/SeoLandingPage.tsx", "app/(ar)/not-found.tsx"];
  for (const p of pages) assert.ok(/id="main"/.test(read(p)), `${p}: لا معلَم main بمعرّف`);
});

test("V2-1.10-A: حلقة تركيز مرئية، واحترام تقليل الحركة عالميًا", () => {
  const css = read("app/globals.css");
  assert.ok(/:focus-visible/.test(css), "لا حلقة تركيز");
  assert.ok(/outline:\s*3px/.test(css), "حلقة التركيز رفيعة جدًا على خلفية داكنة");
  assert.ok(/@media \(prefers-reduced-motion: reduce\)/.test(css), "لا احترام لتقليل الحركة");
});

test("🔴 V2-1.10-A: لا tabindex موجب في أي مكان", () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const files = [...walk(path.join(ROOT, "app")), ...walk(path.join(ROOT, "components"))]
    .filter((f) => /\.tsx$/.test(f));
  const bad = files.filter((f) => /tabIndex=\{[1-9]/.test(fs.readFileSync(f, "utf8")))
    .map((f) => path.relative(ROOT, f));
  assert.deepEqual(bad, [], "🔴 tabindex موجب يكسر ترتيب التنقل الطبيعي");
});

test("V2-1.10-A: بدائل نصية حقيقية — لا 'thumbnail' ولا نصّ فارغ للأعمال", () => {
  const s = read("components/Portfolio.tsx");
  assert.ok(/alt=\{alt\}/.test(s), "المصغّرة لا تستقبل بديلًا نصيًا");
  assert.ok(!/alt="(thumbnail|image|صورة)"/i.test(s), "بديل نصّي عام لا يصف العمل");
  // البدائل تأتي من عناوين الأعمال الحقيقية.
  for (const w of P.WORKS) assert.ok(w.ar && w.ar.trim().length > 3, `العمل ${w.id} بلا عنوان صالح كبديل نصّي`);
});

test("V2-1.9: صور الأعمال بأبعاد ثابتة ولا تُخفى بشفافية صفرية", () => {
  const s = read("components/Portfolio.tsx");
  assert.ok(/width=\{1280\}/.test(s) && /height=\{720\}/.test(s), "لا أبعاد ثابتة (CLS)");
  assert.ok(/loading="lazy"/.test(s) && /decoding="async"/.test(s));
  assert.ok(!/opacity:\s*loaded\s*\?\s*0\.55\s*:\s*0/.test(s),
    "🔴 عادت الشفافية الصفرية — أي فشل في معالج التحميل يُخفي الصورة للأبد");
  assert.ok(/hqdefault/.test(s), "🔴 فُقد السقوط إلى hqdefault");
});
