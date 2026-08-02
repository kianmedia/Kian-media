// ════════════════════════════════════════════════════════════════════════════
// Wave 1 · V2-1.2 / V2-1.4 — عقد طبقة المحتوى
//
// اختبارات ساكنة على المستودع. لا شبكة · لا قاعدة · لا Production.
//
// ★ أهم حارس هنا: الأوصاف الثمانية الحيّة. v2.1 §1 يصنّفها
//   «KEEP, do not rewrite» — فهي منشورة على الإنتاج. تُثبَّت ببصمة كي لا
//   تُعاد صياغتها بصمت في تحرير لاحق.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.resolve(__dirname, "..");
const read = (r) => fs.readFileSync(path.join(ROOT, r), "utf8");

/**
 * يحمّل وحدة TS من طبقة المحتوى في سياق معزول.
 *
 * ⚠️ يستخدم مُصرِّف TypeScript الحقيقي (المثبَّت أصلًا للـtypecheck) بدل تجريد
 *    الأنواع بـregex. المحاولة الأولى كانت regex فانكسرت على أول دالّة بمعاملين
 *    (`thumb(yt: string, quality: "hq" | "maxres" = "hq")`). كتابة مُحلِّل TS
 *    باليد معركة خاسرة، والمصرّف موجود مجانًا.
 */
const ts = require("typescript");
function loadTs(rel, exportNames) {
  const js = ts.transpileModule(read(rel), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: rel,
  }).outputText;
  const module = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function("exports", "module", "require", js)(module.exports, module, require);
  const out = {};
  for (const n of exportNames) {
    assert.ok(n in module.exports, `التصدير ${n} غير موجود في ${rel}`);
    out[n] = module.exports[n];
  }
  return out;
}

const P = loadTs("content/portfolio.ts",
  ["WORKS", "CATEGORIES", "categoryCount", "TOTAL_MEMBERSHIPS", "thumb", "watchUrl", "embedUrl"]);
const S = loadTs("content/stats.ts", ["STATS", "statDisplay"]);

// ═══ V2-1.4-A · استخراج المحتوى ════════════════════════════════════════════

test("V2-1.4-A: 46 عملًا في content/portfolio.ts", () => {
  assert.equal(P.WORKS.length, 46);
});

test("V2-1.4-A: المكوّن لم يعد يحمل نسخة ثانية من الكتالوج", () => {
  const c = read("components/Portfolio.tsx");
  assert.ok(!/const ITEMS:\s*Item\[\]\s*=\s*\[/.test(c), "🔴 مصفوفة أعمال محلية عادت — مصدران للحقيقة");
  assert.ok(!/const CATEGORIES:\s*\{/.test(c), "🔴 قائمة فئات محلية عادت");
  assert.ok(c.includes('from "@/content/portfolio"'), "المكوّن يجب أن يستهلك طبقة المحتوى");
});

test("معرّفات ومقاطع فريدة — لا عمل مكرر", () => {
  assert.equal(new Set(P.WORKS.map((w) => w.id)).size, 46, "معرّف مكرر");
  assert.equal(new Set(P.WORKS.map((w) => w.yt)).size, 46, "مقطع YouTube مكرر");
});

test("كل عمل ينتمي لفئة معروفة واحدة على الأقل", () => {
  const known = new Set(P.CATEGORIES.map((c) => c.key).filter((k) => k !== "all"));
  for (const w of P.WORKS) {
    assert.ok(w.cats.length > 0, `العمل ${w.id} بلا فئة`);
    for (const c of w.cats) assert.ok(known.has(c), `فئة مجهولة "${c}" في العمل ${w.id}`);
  }
});

// ═══ V2-1.4-B · الأوصاف ════════════════════════════════════════════════════

test("★ V2-1.4-B: كل عمل يحمل وصفًا عربيًا وإنجليزيًا — صفر اعتماد على وصف الفئة", () => {
  const missing = P.WORKS.filter((w) => !w.dAr?.trim() || !w.dEn?.trim());
  assert.deepEqual(missing.map((w) => w.id), [], "أعمال بلا وصف خاص");
});

test("★ V2-1.4-B: الأوصاف العربية فريدة — لا نصّ مكرر", () => {
  const seen = new Map();
  for (const w of P.WORKS) {
    if (seen.has(w.dAr)) assert.fail(`وصف مكرر بين العملين ${seen.get(w.dAr)} و ${w.id}`);
    seen.set(w.dAr, w.id);
  }
  assert.equal(seen.size, 46);
});

test("العناوين العربية فريدة — عنوان مكرر يضرّ SEO ويربك الزائر", () => {
  const seen = new Map();
  for (const w of P.WORKS) {
    if (seen.has(w.ar)) assert.fail(`عنوان مكرر بين ${seen.get(w.ar)} و ${w.id}: «${w.ar}»`);
    seen.set(w.ar, w.id);
  }
});

test("🔒 V2-1.4-C: لم يبقَ عمل بعنوان «إعلان قصير» المجرّد", () => {
  const bare = P.WORKS.filter((w) => w.ar.trim() === "إعلان قصير");
  assert.deepEqual(bare.map((w) => w.id), [], "العناوين الثلاثة المتطابقة ما زالت كما هي");
});

test("🔒 الأوصاف الثمانية الحيّة محفوظة حرفيًا (v2.1 §1: KEEP, do not rewrite)", () => {
  const live = P.WORKS.filter((w) => w.live === true);
  assert.equal(live.length, 8, "عدد الأوصاف الحيّة تغيّر");
  assert.deepEqual(live.map((w) => w.id).sort((a, b) => a - b), [1, 2, 4, 5, 38, 39, 40, 41]);
  // بصمة النصّ العربي لكل وصف حيّ — أي إعادة صياغة تُسقط هذا الاختبار.
  const fp = crypto.createHash("sha256")
    .update(live.sort((a, b) => a.id - b.id).map((w) => `${w.id}:${w.dAr}`).join("|"))
    .digest("hex").slice(0, 16);
  assert.equal(fp, "463e621c90a29b9e",
    "🔴 أُعيدت صياغة وصف حيّ. v2.1 §1 يمنع ذلك — استعِد النصّ، أو أثبت قرار خالد ثم حدّث البصمة.");
});

// ═══ V2-1.4-D · العدّادات ══════════════════════════════════════════════════

test("★ V2-1.4-D: العدّادات مشتقّة، و«الكل» عدد الأعمال لا مجموع العضويات", () => {
  assert.equal(P.categoryCount("all"), 46, "«الكل» يجب أن يكون عدد الأعمال المتمايزة");
  for (const c of P.CATEGORIES) {
    if (c.key === "all") continue;
    const expected = P.WORKS.filter((w) => w.cats.includes(c.key)).length;
    assert.equal(P.categoryCount(c.key), expected, `عدّاد ${c.key} غير مشتقّ`);
  }
});

test("★ V2-1.4-D: مجموع العضويات يفوق عدد الأعمال — وهذا صحيح لا عطل", () => {
  const sum = P.CATEGORIES.filter((c) => c.key !== "all")
    .reduce((n, c) => n + P.categoryCount(c.key), 0);
  assert.equal(sum, P.TOTAL_MEMBERSHIPS);
  // ⚠️ 54 لا 56. الرقم 56 في مستندات التدقيق كان **خطأً مني**: عددتُ سطر تعليق
  //    داخل ITEMS يحوي `cats: ["corporate", "realestate"]` وكأنه بيانات، فأضاف
  //    عضويتين وهميتين. الفحص الخارجي كان محقًّا. (وهذا عين الصنف C3 الذي يحذّر
  //    منه tests/sql_package_hardening_guards.test.js — إدانة تعليق كأنه شيفرة.)
  assert.equal(sum, 54, "مجموع العضويات الحقيقي 54");
  assert.ok(sum > P.WORKS.length,
    "العمل الواحد قد ينتمي لعدة فئات عمدًا — التساوي هنا يعني أن العضوية المتعددة أُلغيت");
  // ولا عدّاد مكتوب يدويًا في المكوّن.
  assert.ok(!/count:\s*\d+/.test(read("components/Portfolio.tsx")), "عدّاد مكتوب يدويًا");
});

// ═══ V2-1.2 · الأرقام ══════════════════════════════════════════════════════

test("V2-1.2-A: STATS في content/stats.ts والمكوّن يستهلكها", () => {
  assert.equal(S.STATS.length, 4);
  assert.deepEqual(S.STATS.map((s) => s.key), ["years", "productions", "clients", "regions"]);
  const c = read("components/Stats.tsx");
  assert.ok(c.includes('from "@/content/stats"'), "Stats.tsx لا يستهلك طبقة المحتوى");
  assert.ok(!/const STATS = \[/.test(c), "🔴 مصفوفة أرقام محلية عادت");
});

test("V2-1.2-C: الأرقام المعتمدة كما في v2.1، وسنوات الخبرة معلَّمة غير مؤكَّدة", () => {
  const by = Object.fromEntries(S.STATS.map((s) => [s.key, s]));
  assert.equal(by.productions.to, 4000);
  assert.equal(by.clients.to, 2000);
  assert.equal(by.regions.to, 13);
  assert.equal(by.years.confirmed, false, "سنوات الخبرة تنتظر قرار خالد — يجب أن تبقى معلَّمة");
  for (const k of ["productions", "clients", "regions"]) assert.equal(by[k].confirmed, true);
});

test("★ V2-1.2-B: قيمة الخادم أرقام غربية ثابتة — لا اختلاف يسبّب hydration mismatch", () => {
  assert.equal(S.statDisplay({ to: 4000, suffix: "+" }), "4,000+");
  assert.equal(S.statDisplay({ to: 13, suffix: "" }), "13");
  // toLocaleString بلا وسيط قد يُخرج أرقامًا عربية شرقية على العميل بينما
  // أخرج الخادم غربية ⇒ عدم تطابق يُفرغ الشريط بالكامل.
  assert.ok(read("content/stats.ts").includes('toLocaleString("en-US")'), "اللغة غير مثبَّتة");
  assert.ok(read("components/Counter.tsx").includes('toLocaleString("en-US")'), "اللغة غير مثبَّتة في العدّاد");
});

test("★ V2-1.2-B: العدّاد لا يبدأ من صفر بعد الآن", () => {
  const c = read("components/Counter.tsx");
  assert.ok(!/useState\(0\)/.test(c), "🔴 العدّاد عاد ليبدأ من 0 — عطل «0+» في HTML الأولي");
  assert.ok(/useState<number \| null>\(null\)/.test(c), "الحالة الابتدائية يجب أن تعني «لم تبدأ» لا «صفر»");
  assert.ok(c.includes("display"), "يجب أن يقبل القيمة المرسومة من الخادم");
});

test("V2-1.10-B: العدّاد يحترم prefers-reduced-motion", () => {
  const c = read("components/Counter.tsx");
  assert.ok(c.includes("prefers-reduced-motion"), "لا احترام لتفضيل تقليل الحركة");
  assert.ok(/if \(reduced\) \{ setVal\(to\); return; \}/.test(c),
    "مع تقليل الحركة يجب أن تصل القيمة النهائية فورًا — الرقم معلومة لا زخرفة");
});

// ═══ روابط المحتوى ═════════════════════════════════════════════════════════

test("مساعدات الروابط تبني عناوين صحيحة", () => {
  assert.equal(P.thumb("ABC"), "https://i.ytimg.com/vi/ABC/hqdefault.jpg");
  assert.equal(P.thumb("ABC", "maxres"), "https://i.ytimg.com/vi/ABC/maxresdefault.jpg");
  assert.equal(P.watchUrl("ABC"), "https://www.youtube.com/watch?v=ABC");
  assert.ok(P.embedUrl("ABC").includes("youtube-nocookie.com"), "التضمين يجب أن يستخدم النطاق بلا كوكيز");
});
