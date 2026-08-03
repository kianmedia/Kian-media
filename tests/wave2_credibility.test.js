// ════════════════════════════════════════════════════════════════════════════
// Wave 2 · مصداقية الموقع — V2-2.2 / V2-2.3 / V2-2.4 / V2-2.5
//
// ساكنة بالكامل: ملفات المستودع + مخرَج البناء. لا شبكة · لا قاعدة · لا Production.
//
// ★ أهم حارس هنا هو الأول: صفحة /trust صفحة مشتريات، وكل سطر فيها تعهّد.
//   ادّعاء غير متحقق عليها أسوأ من غياب الصفحة كلها.
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

const TRUST = loadTs("content/trust.ts");
const NAPMOD = loadTs("content/nap.ts");
const REC = loadTs("content/recognition.ts");

// ═══ V2-2.3 · /trust — الادّعاءات ══════════════════════════════════════════

test("★ V2-2.3-A: لا يُعرض إلا ما هو متحقق اليوم", () => {
  const live = TRUST.liveTrustClaims();
  const pending = TRUST.pendingTrustClaims();
  assert.ok(live.length >= 5, "الصفحة شبه فارغة");
  assert.ok(pending.length >= 1, "لا شيء مؤجَّل؟ راجع الحالة");
  for (const c of live) assert.equal(c.status, "live");
  for (const c of pending) assert.equal(c.status, "pending");
  assert.equal(live.length + pending.length, TRUST.TRUST_CLAIMS.length, "حالة غير معروفة");
});

test("🔴 V2-2.3-A: النسخ الاحتياطي والسلامة والرصد مؤجَّلة — لأنها غير صحيحة اليوم", () => {
  const pendingIds = TRUST.pendingTrustClaims().map((c) => c.id).sort();
  for (const id of ["backups", "hse", "monitoring"]) {
    assert.ok(pendingIds.includes(id),
      `🔴 "${id}" صار يُعرض على صفحة مشتريات وهو غير مُنفَّذ`);
  }
});

test("★ V2-2.3-A: ولا ادّعاء مؤجَّل يتسرّب إلى HTML المُولَّد", () => {
  const files = [".next/server/app/trust.html", ".next/server/app/en/trust.html"]
    .map((f) => path.join(ROOT, f)).filter(fs.existsSync);
  if (files.length === 0) return;                 // no build to inspect
  for (const f of files) {
    const html = fs.readFileSync(f, "utf8");

    // ⛔ لا ادّعاء مؤجَّل — سواء نُشرت الصفحة أم لا.
    for (const c of TRUST.pendingTrustClaims()) {
      assert.ok(!html.includes(c.titleAr), `🔴 ${path.basename(f)} يعرض ادّعاءً مؤجَّلًا: ${c.titleAr}`);
      assert.ok(!html.includes(c.titleEn), `🔴 ${path.basename(f)} يعرض ادّعاءً مؤجَّلًا: ${c.titleEn}`);
    }

    // الصفحة خلف علم NEXT_PUBLIC_SHOW_TRUST_PAGE. وهي مغلقة تُبنى كمستند خطأ
    // (404)، فالمطلوب حينها العكس تمامًا: ألّا يتسرّب أيّ نصّ منها — حيًّا كان
    // أو مؤجَّلًا. البوّابة نفسها مُختبَرة في wave2_trust_release_gate.test.js.
    const published = !/<html[^>]*id="__next_error__"/.test(html);
    const live = TRUST.liveTrustClaims();
    if (published) {
      // وما هو حيّ يجب أن يظهر فعلًا — وإلا فالصفحة فارغة بلا سبب.
      assert.ok(html.includes(live[0].titleAr) || html.includes(live[0].titleEn),
        "لم يُعرض أي ادّعاء حيّ");
    } else {
      for (const c of live) {
        assert.ok(!html.includes(c.titleAr) && !html.includes(c.titleEn),
          `🔴 ${path.basename(f)} خلف بوّابة مغلقة ومع ذلك سرّب: ${c.titleAr}`);
      }
    }
  }
});

test("V2-2.3-A: كل ادّعاء يحمل دليلًا مكتوبًا، والمؤجَّل يقول لماذا", () => {
  for (const c of TRUST.TRUST_CLAIMS) {
    assert.ok(c.evidence && c.evidence.trim().length > 20, `${c.id}: بلا دليل`);
    if (c.status === "pending") {
      assert.ok(/BLOCKED/.test(c.evidence), `${c.id}: مؤجَّل بلا سبب مكتوب`);
    }
  }
});

test("🔴 V2-2.3-A: لا شهادة ولا اعتماد ولا تدقيق خارجي مُدّعى", () => {
  const blob = TRUST.TRUST_CLAIMS.flatMap((c) => [c.titleAr, c.titleEn, c.bodyAr, c.bodyEn]).join(" | ");
  const BANNED = [
    /\bISO\s?\d{4,}/i, /\bSOC\s?2\b/i, /\bcertified\b/i, /\bاعتماد دولي|شهادة اعتماد|حاصل على شهادة/,
    /\baudited by\b/i, /\bمدقَّق من\b/, /\bpenetration test(ed)?\b/i, /\bاختبار اختراق\b/,
    /\bGDPR compliant\b/i, /\bمطابق لـ?GDPR\b/,
  ];
  for (const rx of BANNED) assert.ok(!rx.test(blob), `🔴 ادّعاء اعتماد غير موجود: ${rx}`);
});

test("V2-2.3-A: «تسجيل الإجراءات» لا «سجل تدقيق مركزي» — الفرق حقيقي", () => {
  const c = TRUST.TRUST_CLAIMS.find((x) => x.id === "activity-log");
  assert.ok(c && c.status === "live");
  // السجلّ موزَّع على 15 مصدرًا ولا عارض موحّد — فادّعاء «سجل تدقيق واحد» مبالغة.
  assert.ok(!/سجل تدقيق (مركزي|موحّد)/.test(c.bodyAr), "🔴 ادّعاء سجل تدقيق موحّد");
  assert.ok(!/\b(central|unified|comprehensive) audit (log|trail)\b/i.test(c.bodyEn), "🔴 same in English");
});

test("V2-2.3-B: الصفحة بلغتين بمسارين وcanonical وhreflang", () => {
  for (const p of ["app/(ar)/trust/page.tsx", "app/(en)/en/trust/page.tsx"]) {
    assert.ok(exists(p), `مفقود: ${p}`);
    const s = read(p);
    assert.ok(s.includes("canonicalFor"), `${p}: لا canonical`);
    assert.ok(s.includes('"x-default"'), `${p}: لا x-default`);
    assert.ok(s.includes("TrustPage"), `${p}: لا يستخدم العارض الموحّد`);
  }
  const c = read("components/TrustPage.tsx");
  assert.ok(c.includes("liveTrustClaims"), "🔴 العارض لا يرشّح الادّعاءات المؤجَّلة");
  assert.ok(!c.includes("TRUST_CLAIMS"), "🔴 العارض يقرأ القائمة كاملة بدل الحيّة فقط");
});

// ═══ V2-2.5 · NAP ══════════════════════════════════════════════════════════

test("★ V2-2.5-B: مصدر واحد للعنوان والهاتف والبريد", () => {
  assert.ok(NAPMOD.NAP.email.primary.includes("@"));
  assert.equal(NAPMOD.primaryPhone.e164, "+966503422999");
  assert.equal(NAPMOD.NAP.phones.length, 2, "الرقمان المنشوران");
  assert.ok(NAPMOD.formattedAddress("ar").includes("الدمام"));
  assert.ok(NAPMOD.formattedAddress("en").includes("Dammam"));
  assert.ok(NAPMOD.waLink("مرحبا").startsWith("https://wa.me/966503422999?text="));
});

test("★ V2-2.5-B: لا رقم ولا بريد مكتوب حرفيًا في الواجهات بعد الآن", () => {
  for (const f of ["components/Footer.tsx", "components/Contact.tsx"]) {
    const s = read(f).replace(/^\s*\/\/.*$/gm, "");
    assert.ok(!/966503422999|966543553038/.test(s.replace(/NAP|primaryPhone|waLink/g, "")),
      `🔴 ${f} ما زال يحمل رقمًا حرفيًا`);
    assert.ok(!/"(info|sales)@kianmedia\.com"/.test(s), `🔴 ${f} ما زال يحمل بريدًا حرفيًا`);
    assert.ok(s.includes('from "@/content/nap"'), `${f} لا يستهلك المصدر الموحّد`);
  }
});

test("V2-2.5-B: البيانات المنظَّمة تقرأ من نفس المصدر فلا تتباعد", () => {
  const SD = loadTs("lib/structuredData.ts", (id) => {
    if (id === "@/lib/site") return { SITE_URL: "https://kianmedia.com" };
    if (id === "@/content/portfolio") return loadTs("content/portfolio.ts");
    if (id === "@/content/nap") return NAPMOD;
    return {};
  });
  const b = SD.localBusinessJsonLd();
  assert.equal(b.telephone, NAPMOD.primaryPhone.e164, "🔴 الهاتف في Schema يخالف NAP");
  assert.equal(b.email, NAPMOD.NAP.email.primary, "🔴 البريد في Schema يخالف NAP");
  assert.equal(b.address.addressLocality, NAPMOD.NAP.address.cityEn);
  assert.equal(b.openingHoursSpecification.opens, NAPMOD.NAP.hours.opens);
});

// ═══ V2-2.2 · الشعارات ═════════════════════════════════════════════════════

test("★ V2-2.2-B: شريط الشعارات خلف علم مطفأ — حقوق الاستخدام غير مؤكَّدة", () => {
  const s = read("components/ClientLogoStrip.tsx");
  assert.ok(s.includes("NEXT_PUBLIC_SHOW_CLIENT_LOGOS"), "لا علم");
  assert.ok(/if \(!clientLogosEnabled\(\)[\s\S]{0,40}\) return null;/.test(s),
    "🔴 يجب ألّا يُعرض أي شعار والعلم مطفأ");
  // وغير مركَّب في أي صفحة بعد — لا يظهر إطلاقًا اليوم.
  const mounted = ["app", "components"].flatMap((d) => {
    const walk = (x) => fs.readdirSync(x, { withFileTypes: true })
      .flatMap((e) => (e.isDirectory() ? walk(path.join(x, e.name)) : [path.join(x, e.name)]));
    return walk(path.join(ROOT, d));
  }).filter((f) => /\.tsx$/.test(f) && !/ClientLogoStrip/.test(f))
    .filter((f) => /<ClientLogoStrip/.test(fs.readFileSync(f, "utf8")));
  assert.deepEqual(mounted.map((f) => path.relative(ROOT, f)), [],
    "🔴 رُكِّب شريط الشعارات قبل تأكيد حقوق الاستخدام");
});

test("V2-2.2-A: البديل النصّي مشتق من اسم الملف، بلا ادّعاء عن العميل", () => {
  const s = read("components/ClientLogoStrip.tsx");
  assert.ok(/alt=\{name\}/.test(s), "لا بديل نصّي");
  assert.ok(/width=\{160\}/.test(s) && /height=\{80\}/.test(s), "لا أبعاد ثابتة (CLS)");
  assert.ok(/loading="lazy"/.test(s) && /decoding="async"/.test(s));
  assert.ok(!/عميلنا|client of|partner of/i.test(s), "🔴 ادّعاء علاقة غير موثّقة");
});

// ═══ V2-2.4 · التقدير والجوائز ═════════════════════════════════════════════

test("🔴 V2-2.4-A: قائمة الجوائز فارغة — لا جائزة مخترَعة", () => {
  assert.deepEqual(REC.RECOGNITION, [], "🔴 أُضيفت جائزة/تغطية بلا مصدر موثّق");
  assert.equal(REC.hasRecognition(), false);
  const s = read("content/recognition.ts");
  assert.ok(/EMPTY BY DESIGN|EMPTY, ON PURPOSE/.test(s), "سبب الفراغ يجب أن يكون مكتوبًا");
});

// ═══ V2-2.1 · دراسات الحالة — لا نظام موازٍ ════════════════════════════════

test("🔒 V2-2.1-A: لم يُنشأ نظام ملفات موازٍ لمنصة دراسات الحالة", () => {
  assert.ok(!exists("content/case-studies"), "🔴 أُنشئ نظام ملفات موازٍ للمنصة القائمة");
  // والمنصة القائمة وصفحاتها كما هي.
  assert.ok(exists("app/(ar)/case-studies/page.tsx"));
  assert.ok(exists("app/(ar)/case-studies/[slug]/page.tsx"));
  assert.ok(exists("docs/case_studies_platform_RUNME.sql"), "منصة دراسات الحالة اختفت");
});
