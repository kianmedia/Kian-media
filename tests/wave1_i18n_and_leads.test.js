// ════════════════════════════════════════════════════════════════════════════
// Wave 1 · V2-1.1 / V2-1.5 / V2-1.6 / V2-1.8 / V2-1.9
// اختبارات ساكنة + سلوكية. لا شبكة · لا قاعدة · لا Production · لا إرسال حقيقي.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const ROOT = path.resolve(__dirname, "..");
const read = (r) => fs.readFileSync(path.join(ROOT, r), "utf8");
const exists = (r) => fs.existsSync(path.join(ROOT, r));

function loadTs(rel, fakeRequire = () => ({})) {
  const js = ts.transpileModule(read(rel), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React },
  }).outputText;
  const module = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function("exports", "module", "require", js)(module.exports, module, fakeRequire);
  return module.exports;
}

// ═══ V2-1.1 · i18n ═════════════════════════════════════════════════════════

const I18N = loadTs("lib/i18n.tsx", (id) => {
  if (id === "react") return { createContext: () => ({}), useContext: () => null, useEffect: () => {}, useState: () => [null, () => {}] };
  if (id === "next/navigation") return { usePathname: () => "/", useRouter: () => ({ push: () => {} }) };
  return {};
});

test("V2-1.1: تحويل المسارات بين اللغتين متسق وعكوس", () => {
  const cases = [["/", "/en"], ["/terms", "/en/terms"], ["/quote-request", "/en/quote-request"]];
  for (const [ar, en] of cases) {
    assert.equal(I18N.withLocale(ar, "en"), en, `ar→en فشل لـ${ar}`);
    assert.equal(I18N.withLocale(en, "ar"), ar, `en→ar فشل لـ${en}`);
    assert.equal(I18N.stripLocale(en), ar);
    assert.ok(I18N.isEnglishPath(en) && !I18N.isEnglishPath(ar));
  }
  // idempotent — لا يتراكم البادئة
  assert.equal(I18N.withLocale("/en/terms", "en"), "/en/terms");
});

test("V2-1.1: '/english' ليس مسارًا إنجليزيًا — لا مطابقة بالبادئة النصّية", () => {
  assert.equal(I18N.isEnglishPath("/english"), false, "🔴 /english عُومل كأنه /en");
  assert.equal(I18N.isEnglishPath("/enterprise"), false);
  assert.equal(I18N.isEnglishPath("/en"), true);
  assert.equal(I18N.isEnglishPath("/en/terms"), true);
});

test("★ V2-1.1: كل مسار عربي عام له نظير /en فعلي على القرص", () => {
  for (const r of ["", "quote-request", "book-meeting", "upload-files",
                   "opportunities", "privacy-policy", "terms", "case-studies"]) {
    const p = r ? `app/(en)/en/${r}/page.tsx` : "app/(en)/en/page.tsx";
    assert.ok(exists(p), `نظير إنجليزي مفقود: ${p}`);
    // نسخة واحدة من التنفيذ — النظير يعيد التصدير ولا يكرر الصفحة.
    assert.ok(/export \{ default \} from/.test(read(p)), `${p} يكرر التنفيذ بدل إعادة تصديره`);
  }
});

test("🔒 V2-1.1: البوابة والإدارة وAPI لم تُنقل تحت [locale]", () => {
  assert.ok(!exists("app/[locale]"), "🔴 أُنشئ مقطع [locale] — البوابة «fragile cargo»");
  for (const p of ["app/(portal)/client-portal/layout.tsx", "app/(portal)/admin/layout.tsx", "app/api/public/intake/route.ts"]) {
    assert.ok(exists(p), `🔴 نُقل مسار محمي: ${p}`);
  }
  for (const p of ["app/(en)/en/client-portal", "app/(en)/en/admin", "app/(en)/en/api"]) {
    assert.ok(!exists(p), `🔴 أُنشئ نظير إنجليزي لمسار غير عام: ${p}`);
  }
});

test("V2-1.1 (D-3): /en/layout لم يعد يصحّح lang بسكربت — الخادم يفعلها", () => {
  // ⚠️ انقلب هذا العقد عمدًا بعد قرار خالد في D-3: التصحيح بسكربت **مرفوض**،
  // والخادم صار يُخرج lang/dir صحيحين من أول بايت. الحارس الموجب في
  // tests/wave1_ssr_lang_dir.test.js؛ والمطلوب هنا ألّا يعود السكربت أبدًا.
  const s = read("app/(en)/en/layout.tsx");
  assert.ok(!/documentElement\.(lang|dir)/.test(s),
    "🔴 عاد تصحيح اللغة بسكربت — الخادم يجب أن يكون صحيحًا أصلًا");
});

// ═══ V2-1.3 · hreflang و OG ════════════════════════════════════════════════

const SEO = loadTs("lib/seo.ts", (id) =>
  id === "@/lib/site" ? { SITE_URL: "https://kianmedia.com" } : {});

test("★ V2-1.3: hreflang يُعلَن فقط للمسارات التي لها نظير إنجليزي فعلي", () => {
  const mirrored = new Set(SEO.BILINGUAL_ROUTES);
  for (const [key, r] of Object.entries(SEO.ROUTE_SEO)) {
    const langs = SEO.seoFor(key).alternates.languages;
    if (mirrored.has(r.path)) {
      assert.ok(langs, `${r.path} ثنائي اللغة بلا hreflang`);
      assert.equal(langs.en, SEO.canonicalFor(SEO.localePath(r.path, "en")));
      // يُقارَن بالبانِي نفسه: الصفحة الرئيسية بلا شرطة ختامية عمدًا،
      // مطابقةً لـcanonical الجذر في app/layout.tsx.
      assert.equal(langs["x-default"], SEO.canonicalFor(r.path), "x-default يجب أن يكون العربية");
      assert.equal(langs.ar, SEO.canonicalFor(r.path));
      // النظير المُعلَن يجب أن يوجد فعلًا على القرص — بديل مكسور أسوأ من غيابه.
      const dir = r.path === "/" ? "app/(en)/en/page.tsx" : `app/(en)/en${r.path}/page.tsx`;
      assert.ok(exists(dir), `🔴 hreflang يشير إلى صفحة غير موجودة: ${dir}`);
    } else {
      assert.equal(langs, undefined, `🔴 ${r.path} يعلن بديلًا إنجليزيًا لا وجود له`);
    }
  }
});

test("V2-1.3: النسخة الإنجليزية تحمل نصًّا إنجليزيًا وcanonical إنجليزيًا", () => {
  const m = SEO.seoFor("terms", "en");
  assert.equal(m.alternates.canonical, "https://kianmedia.com/en/terms");
  assert.ok(!/[؀-ۿ]/.test(m.title), "العنوان الإنجليزي يحوي حروفًا عربية");
  assert.equal(m.openGraph.locale, "en_US");
});

test("★ V2-1.3-B: بطاقة OG بقياس 1200×630 مطلقة — لا شعار مربّع", () => {
  const m = SEO.seoFor("terms");
  const img = m.openGraph.images[0];
  assert.equal(img.width, 1200);
  assert.equal(img.height, 630);
  assert.ok(img.url.startsWith("https://"), "رابط OG يجب أن يكون مطلقًا");
  assert.ok(exists("public/og-default.svg"), "ملف بطاقة OG مفقود");
  // D-3: metadata moved into the per-locale roots; the OG image is asserted
  // through lib/seo.ts above, which is the single builder both roots use.
  assert.ok(!/logo\.png/.test(read("lib/seo.ts")), "الشعار المربّع ما زال بطاقة المشاركة");
});

// ═══ V2-1.6 · حفظ الطلب والإسناد ═══════════════════════════════════════════

test("★ V2-1.6-A: النموذج الرئيسي يحفظ في Supabase قبل فتح واتساب", () => {
  const s = read("components/Contact.tsx");
  assert.ok(s.includes("captureIntake"), "🔴 النموذج الرئيسي ما زال لا يحفظ شيئًا");
  const iSave = s.indexOf("await captureIntake");
  const iWa = s.indexOf("window.open(`https://wa.me");
  assert.ok(iSave > -1 && iWa > -1);
  assert.ok(iSave < iWa, "🔴 واتساب يُفتح قبل الحفظ — الطلب قد يضيع");
  // Apps Script ليس قاعدة الـLeads: لا يسبق الحفظ في هذا النموذج.
  assert.ok(!s.includes("submitToSheets"), "النموذج الرئيسي يجب ألّا يعتمد Apps Script مخزنًا");
});

const ATTR = loadTs("lib/attribution.ts");

test("V2-1.6-C: الإسناد آمن على الخادم ولا يرمي أبدًا", () => {
  assert.deepEqual(ATTR.captureAttribution(), {}, "يجب أن يعيد {} بلا window");
  assert.equal(ATTR.hasAttribution({}), false);
  assert.equal(ATTR.hasAttribution({ utm_source: "x" }), true);
});

test("★ V2-1.6-C: يلتقط الوسوم، ويحفظ أصل الإحالة فقط بلا مسار أو query", () => {
  global.window = {
    location: { search: "?utm_source=ig&utm_campaign=eid&utm_medium=paid", pathname: "/quote-request", origin: "https://kianmedia.com" },
  };
  global.document = { referrer: "https://partner.example.com/some/path?their_user=12345" };
  try {
    const a = ATTR.captureAttribution();
    assert.equal(a.utm_source, "ig");
    assert.equal(a.utm_campaign, "eid");
    assert.equal(a.landing_path, "/quote-request");
    // 🔴 الأهم: أصل فقط — رابط الإحالة الكامل قد يحمل بيانات مستخدم موقع آخر.
    assert.equal(a.referrer, "https://partner.example.com");
    assert.ok(!JSON.stringify(a).includes("their_user"), "🔴 تسرّبت query الإحالة");
    assert.ok(!("utm_term" in a), "المفاتيح الغائبة يجب ألّا تُرسَل");
  } finally { delete global.window; delete global.document; }
});

test("V2-1.6-C: الإحالة الذاتية تُهمَل — ليست مصدرًا", () => {
  global.window = { location: { search: "", pathname: "/", origin: "https://kianmedia.com" } };
  global.document = { referrer: "https://kianmedia.com/terms" };
  try {
    assert.equal(ATTR.captureAttribution().referrer, undefined);
  } finally { delete global.window; delete global.document; }
});

test("★ V2-1.6-C: شقّ الإسناد إضافي ولا يمسّ نداء الالتقاط", () => {
  const r = read("app/api/public/intake/route.ts");
  assert.ok(r.includes("public_intake_set_attribution"), "الشقّ غير موصول");
  const call = r.slice(r.indexOf('rpcAsService<string>("capture_public_intake"'),
                       r.indexOf("});", r.indexOf("capture_public_intake")));
  assert.ok(!/utm|attribution|referrer/i.test(call),
    "🔴 أُضيف معامل إسناد إلى capture_public_intake — سيكسر كل إرسال قبل تطبيق SQL");
  assert.ok(r.includes("PUBLIC_INTAKE_ATTRIBUTION_NOT_RECORDED"), "غياب الترحيلة يجب أن يُسجَّل");
});

// ═══ V2-1.5 · الشهادات ═════════════════════════════════════════════════════

test("★ V2-1.5: قسم التقييمات خلف علم مطفأ افتراضيًا", () => {
  const s = read("components/Reviews.tsx");
  assert.ok(s.includes("NEXT_PUBLIC_SHOW_TESTIMONIALS"), "لا علم");
  assert.ok(/if \(!testimonialsEnabled\(\)\) return null;/.test(s),
    "🔴 القسم الفارغ ما زال يُعرض — وهو عين العطل الذي رصده الفحص الخارجي");
  // ❌ ولا شهادات مكتوبة يدويًا (خطر §M).
  assert.ok(!/name:\s*"[^"]*"[\s\S]{0,80}(quote|q:)/i.test(s), "شهادات ثابتة في المكوّن");
});

// ═══ V2-1.8 / V2-1.9 ═══════════════════════════════════════════════════════

test("V2-1.8-C: صفحة 404 بهوية وnoindex", () => {
  assert.ok(exists("app/(ar)/not-found.tsx"), "صفحة 404 مفقودة");
  const s = read("app/(ar)/not-found.tsx");
  assert.ok(/index:\s*false/.test(s), "🔴 صفحة 404 قابلة للفهرسة — ستنافس الصفحات الحقيقية");
  assert.ok(s.includes("404") && s.includes("الصفحة غير موجودة"), "لا محتوى عربي");
  assert.ok(!s.includes('"use client"'), "لا داعي لجافاسكربت في صفحة 404");
});

test("★ V2-1.9-A: فيديو الهيرو لا يُحمَّل بلا داعٍ", () => {
  const s = read("components/Hero.tsx");
  assert.ok(s.includes('preload="none"'), "🔴 المتصفح سيجلب 10MB أثناء التحميل الأولي");
  assert.ok(s.includes("prefers-reduced-motion"), "لا احترام لتقليل الحركة");
  assert.ok(s.includes("saveData"), "لا احترام لوضع توفير البيانات");
  assert.ok(/\{play && <source/.test(s), "المصدر يجب أن يُركَّب بعد القرار لا قبله");
  assert.ok(s.includes('poster="/hero-poster.jpg"'), "🔴 فُقد الـposter — سيظهر إطار أسود");
});

test("V2-1.9-C: الخطوط تُحمَّل بـdisplay=swap", () => {
  assert.ok(/display=swap/.test(read("components/RootDocument.tsx")), "الخطوط تحجب الرسم");
});

// ═══ حزمة SQL — ملفات فقط ══════════════════════════════════════════════════

test("V2-1.6-C: حزمة SQL كاملة، إضافية، وPOSTCHECK قراءة فقط", () => {
  for (const f of ["RUNME", "ROLLBACK", "POSTCHECK"]) {
    assert.ok(exists(`docs/lead_attribution_utm_EXTENSION_${f}.sql`), `مفقود: ${f}`);
  }
  const runme = read("docs/lead_attribution_utm_EXTENSION_RUNME.sql");
  assert.ok(!/^\s*drop\s+(table|column|function)/im.test(runme), "RUNME يحوي DROP");
  assert.equal((runme.match(/^\s*begin;/gim) || []).length, 1);
  assert.equal((runme.match(/^\s*commit;/gim) || []).length, 1);
  assert.ok((runme.match(/add column if not exists/g) || []).length === 7, "الأعمدة السبعة بحارس");
  assert.ok(!/create policy/i.test(runme), "سياسة RLS جديدة تُوسّع الوصول");
  assert.ok(/security definer set search_path = public/i.test(runme));
  assert.ok(/to service_role/i.test(runme));
  assert.ok(!/create or replace function public\.capture_public_intake/i.test(runme),
    "🔴 RUNME يعيد تعريف دالّة الالتقاط");

  const post = read("docs/lead_attribution_utm_EXTENSION_POSTCHECK.sql");
  assert.ok(!/^\s*(insert|update|delete|drop|alter|create|grant|revoke)\b/im.test(post),
    "POSTCHECK يجب أن يكون قراءة فقط");

  const rb = read("docs/lead_attribution_utm_EXTENSION_ROLLBACK.sql");
  assert.ok(!/^\s*alter table public\.public_intake drop column/im.test(rb),
    "🔴 drop column غير معلَّق — لصق الملف سيُتلف بيانات إسناد");
});
