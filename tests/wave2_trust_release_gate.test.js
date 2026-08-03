// ════════════════════════════════════════════════════════════════════════════
// tests/wave2_trust_release_gate.test.js
//
// Wave 2 release hardening — the /trust page is held behind
// NEXT_PUBLIC_SHOW_TRUST_PAGE, and the things it must never publish stay
// unpublished whether the gate is open or shut.
//
// ★ WHAT THIS FILE IS ACTUALLY GUARDING ★
// /trust is the page a procurement officer reads before approving a supplier.
// Three separate failures are possible and each is tested here:
//
//   1. THE GATE — with the flag off the routes must 404, stay out of the
//      sitemap, and advertise no canonical or hreflang. A canonical pointing at
//      a URL that returns 404 is worse than silence: it asks a crawler to fetch
//      a dead page and marks the language cluster as broken.
//
//   2. THE CLAIMS — a claim that is not true today (backups, HSE, monitoring)
//      must not reach the page even when the gate is open.
//
//   3. THE IDENTIFIERS — and this is the one that had actually gone wrong. The
//      commercial-registration and VAT numbers were in content/nap.ts, which
//      components/Footer.tsx and components/Contact.tsx import as `"use
//      client"`. They were therefore compiled into a browser chunk that the
//      HOMEPAGE downloads — shipping to every visitor while the page meant to
//      gate them was not even enabled. Rendering guards do not fix that: a
//      `verified &&` check decides what the HTML shows, not what the bundle
//      contains. So (T-8) greps the built client chunks, not the source.
//
// Static + behavioural. No network · no database · no Production · no build
// required (artifact checks skip themselves when .next is absent).
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const ROOT = path.resolve(__dirname, "..");
const read = (r) => fs.readFileSync(path.join(ROOT, r), "utf8");
const exists = (r) => fs.existsSync(path.join(ROOT, r));

/** Transpile a TS module and run it, so the gate is executed rather than grepped. */
function loadTs(rel, fakeRequire = () => ({}), source = null) {
  const js = ts.transpileModule(source ?? read(rel), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React },
  }).outputText;
  const module = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function("exports", "module", "require", js)(module.exports, module, fakeRequire);
  return module.exports;
}

/** Run `fn` with NEXT_PUBLIC_SHOW_TRUST_PAGE set to `value`, then restore. */
function withFlag(value, fn) {
  const KEY = "NEXT_PUBLIC_SHOW_TRUST_PAGE";
  const had = Object.prototype.hasOwnProperty.call(process.env, KEY);
  const prev = process.env[KEY];
  if (value === undefined) delete process.env[KEY];
  else process.env[KEY] = value;
  try { return fn(); } finally {
    if (had) process.env[KEY] = prev; else delete process.env[KEY];
  }
}

const AR_ROUTE = "app/(ar)/trust/page.tsx";
const EN_ROUTE = "app/(en)/en/trust/page.tsx";

// ═══ 1 · THE GATE ══════════════════════════════════════════════════════════

test("(T-1) ★★ الافتراض OFF: غياب المتغيّر لا يعني النشر ★★", () => {
  const TRUST = loadTs("content/trust.ts");
  // The dangerous default is "unset means on". Both unset and every
  // near-miss value must read as off — only the exact string "true" opens it.
  for (const v of [undefined, "", "false", "FALSE", "0", "no", "True", "1", "yes"]) {
    assert.equal(withFlag(v, () => TRUST.trustPageEnabled()), false,
      `القيمة ${JSON.stringify(v)} فتحت البوّابة — الافتراض يجب أن يكون OFF`);
  }
  assert.equal(withFlag("true", () => TRUST.trustPageEnabled()), true,
    '"true" لم تفتح البوّابة');
});

test("(T-2) ★★ المساران يستدعيان notFound() خلف البوّابة ★★", () => {
  for (const rel of [AR_ROUTE, EN_ROUTE]) {
    const src = read(rel);
    assert.match(src, /import\s*\{\s*notFound\s*\}\s*from\s*"next\/navigation"/, `${rel}: لا استيراد لـ notFound`);
    assert.match(src, /trustPageEnabled/, `${rel}: لا استدعاء للبوّابة`);
    assert.match(src, /if\s*\(\s*!\s*trustPageEnabled\(\)\s*\)\s*notFound\(\)/,
      `${rel}: البوّابة ليست 404 حقيقيًّا`);
  }
});

test("(T-3) ★★ خلف البوّابة لا canonical ولا hreflang قابل للفهرسة ★★", () => {
  for (const rel of [AR_ROUTE, EN_ROUTE]) {
    const src = read(rel);
    // Metadata must be a function — a static `export const metadata` cannot
    // withhold alternates, so it would advertise a URL that 404s.
    assert.match(src, /export\s+function\s+generateMetadata\s*\(/,
      `${rel}: البيانات الوصفية ثابتة، فلا يمكنها الامتناع خلف البوّابة`);
    const guard = src.slice(src.indexOf("generateMetadata"), src.indexOf("export default"));
    assert.match(guard, /if\s*\(\s*!\s*trustPageEnabled\(\)\s*\)\s*return/,
      `${rel}: generateMetadata لا يمتنع خلف البوّابة`);
    const early = guard.slice(guard.indexOf("!trustPageEnabled"), guard.indexOf("!trustPageEnabled") + 260);
    assert.match(early, /index:\s*false/, `${rel}: لا noindex في مسار البوّابة المغلقة`);
    assert.doesNotMatch(early, /alternates|canonical|languages/,
      `${rel}: يصدر canonical/hreflang لصفحة تُرجع 404`);
  }
});

test("(T-4) ★★ Sitemap يشترط البوّابة، ولا يذكر /trust بدونها ★★", () => {
  const src = read("app/sitemap.ts");
  assert.match(src, /trustPageEnabled/, "sitemap لا يقرأ البوّابة إطلاقًا");
  // The /trust entry must be produced conditionally, not listed unconditionally
  // and filtered later — a filter is easy to drop, a conditional list is not.
  assert.match(src, /trustPageEnabled\(\)[\s\S]{0,200}"\/trust"/,
    "مدخل /trust ليس مشروطًا بالبوّابة");
  const routesConst = src.match(/const\s+PUBLIC_ROUTES[\s\S]*?\n\];/);
  assert.ok(routesConst, "تعذّر قراءة PUBLIC_ROUTES");
  assert.doesNotMatch(routesConst[0], /"\/trust"/,
    "/trust مدرج في القائمة غير المشروطة");
});

test("(T-5) ★ لا رابط إلى /trust من التنقل أو التذييل ★", () => {
  for (const rel of ["components/Footer.tsx", "components/Nav.tsx", "components/Header.tsx"]) {
    if (!exists(rel)) continue;
    assert.doesNotMatch(read(rel), /["'`]\/(en\/)?trust["'`]/,
      `${rel}: يربط بصفحة خلف بوّابة مغلقة`);
  }
});

// ═══ 2 · THE CLAIMS ════════════════════════════════════════════════════════

test("(T-6) ★★ ادّعاء غير متحقق لا يصل الصفحة ★★", () => {
  const TRUST = loadTs("content/trust.ts");
  const live = TRUST.liveTrustClaims();
  const pending = TRUST.pendingTrustClaims();

  assert.ok(pending.length > 0, "لا ادّعاءات معلّقة إطلاقًا — الاختبار بلا معنى");
  assert.equal(live.some((c) => c.status !== "live"), false, "liveTrustClaims سرّبت حالة غير live");

  // The three that are known-false today, named explicitly so that flipping one
  // to "live" without doing the work fails here.
  for (const id of ["backups", "hse", "monitoring"]) {
    const c = TRUST.TRUST_CLAIMS.find((x) => x.id === id);
    assert.ok(c, `الادّعاء ${id} اختفى`);
    assert.equal(c.status, "pending", `${id} أُعلن live بلا دليل`);
    assert.match(c.evidence, /^BLOCKED:/, `${id} لا يذكر سبب الحجب`);
    assert.equal(live.some((x) => x.id === id), false, `${id} وصل الصفحة`);
  }
});

test("(T-7) ★★ الصفحة تعرض live فقط — لا TRUST_CLAIMS كاملة ★★", () => {
  const src = read("components/TrustPage.tsx");
  assert.match(src, /liveTrustClaims\(\)/, "الصفحة لا تستخدم المرشِّح");
  assert.doesNotMatch(src, /\bTRUST_CLAIMS\b/, "الصفحة تقرأ القائمة الكاملة بما فيها المعلّق");
  assert.doesNotMatch(src, /pendingTrustClaims/, "الصفحة تعرض المعلّق");
});

// ═══ 3 · THE IDENTIFIERS ═══════════════════════════════════════════════════

test("(T-8) ★★★ رقما السجل والضريبة لا يدخلان حزمة المتصفّح ★★★", () => {
  const REG = loadTs("content/registration.ts");
  const numbers = [REG.REGISTRATION.commercialRegistration, REG.REGISTRATION.vat];

  // (a) Source: the module that client components import must not carry them.
  const nap = read("content/nap.ts");
  for (const n of numbers) {
    assert.equal(nap.includes(n), false,
      `content/nap.ts يحمل ${n} — وهو مستورَد من مكوّنات "use client" فيصل المتصفّح`);
  }

  // (b) Nothing marked "use client" may import the identifiers, directly.
  const roots = ["app", "components", "lib"];
  const walk = (d, re) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : walk(p, re);
    return re.test(e.name) ? [p] : [];
  });
  for (const abs of roots.filter((r) => exists(r)).flatMap((r) => walk(path.join(ROOT, r), /\.tsx?$/))) {
    const src = fs.readFileSync(abs, "utf8");
    if (!/^\s*["']use client["']/m.test(src)) continue;
    assert.doesNotMatch(src, /@\/content\/registration/,
      `${path.relative(ROOT, abs)}: مكوّن عميل يستورد المعرّفات القانونية`);
    for (const n of numbers) {
      assert.equal(src.includes(n), false, `${path.relative(ROOT, abs)}: يحمل ${n} حرفيًّا`);
    }
  }

  // (c) The build itself — the only check that proves what a browser receives.
  const staticDir = path.join(ROOT, ".next", "static");
  if (!exists(".next/static")) {
    console.log("      (تخطّي فحص المخرجات: لا وجود لـ .next — شغّل npm run build)");
    return;
  }
  // Every asset a browser can download — .js chunks above all.
  const files = walk(staticDir, /\.(js|css|json|txt|map|html)$/);
  assert.ok(files.length > 0, ".next/static فارغ");
  for (const abs of files) {
    const src = fs.readFileSync(abs, "utf8");
    for (const n of numbers) {
      assert.equal(src.includes(n), false,
        `${path.relative(ROOT, abs)} يُسلَّم للمتصفّح وفيه ${n}`);
    }
  }
});

test("(T-9) ★★ المعرّفات تُعرض بحالة تحقق صريحة، لا بوجود النص ★★", () => {
  const REG = loadTs("content/registration.ts");
  assert.equal(typeof REG.registrationVerified, "function", "لا بوّابة تحقق");
  // PENDING OFFICIAL DOCUMENT VERIFICATION — must be false until certificates
  // are compared. Flipping it is a deliberate act with a document behind it.
  assert.equal(REG.registrationVerified(), false,
    "المعرّفات أُعلنت متحقَّقة بلا وثيقة (PENDING OFFICIAL DOCUMENT VERIFICATION)");

  const src = read("components/TrustPage.tsx");
  assert.match(src, /registrationVerified\(\)\s*&&/, "العرض غير مشروط بحالة التحقق");
  // And the guard must actually wrap both numbers, not sit beside them.
  const i = src.indexOf("registrationVerified()");
  const j = src.indexOf("REGISTRATION.commercialRegistration");
  const k = src.indexOf("REGISTRATION.vat");
  assert.ok(i > -1 && j > i && k > i, "الأرقام خارج نطاق الشرط");
});

test("(T-10) ★ لا ادّعاء بتحقّق رسميّ لم يحدث ★", () => {
  const blob = read("components/TrustPage.tsx") + read("content/registration.ts");
  // "verified by", "certified", "audited" would assert an external check that
  // nobody performed. The page may state facts; it may not claim attestation.
  assert.doesNotMatch(blob, /موثَّق رسميًّا|مصدَّق|شهادة تحقق|officially verified|certified by|independently audited/i,
    "ادّعاء تحقّق رسميّ لا سند له");
});

// ═══ 4 · MUTATION — do the tests above actually bite? ═══════════════════════
//
// Each mutation breaks one guard and asserts the matching check FAILS. A guard
// whose removal keeps the suite green is not a guard.

/** Assert that `fn` throws — i.e. the detector caught the mutation. */
const catches = (label, fn) => {
  let threw = false;
  try { fn(); } catch { threw = true; }
  assert.ok(threw, `الطفرة لم تُرصد: ${label}`);
};

test("(T-11) ★★★ فحص طفرات: إزالة أيّ حارس تُسقِط الاختبار ★★★", () => {
  // M1 — the route gate is deleted.
  catches("حذف notFound من المسار", () => {
    const m = read(AR_ROUTE).replace(/if\s*\(\s*!\s*trustPageEnabled\(\)\s*\)\s*notFound\(\);?/, "");
    assert.match(m, /if\s*\(\s*!\s*trustPageEnabled\(\)\s*\)\s*notFound\(\)/);
  });

  // M2 — the flag defaults to on when unset.
  catches("قلب الافتراض إلى ON", () => {
    const mutated = read("content/trust.ts")
      .replace('process.env.NEXT_PUBLIC_SHOW_TRUST_PAGE === "true"',
               'process.env.NEXT_PUBLIC_SHOW_TRUST_PAGE !== "false"');
    const T = loadTs("content/trust.ts", () => ({}), mutated);
    for (const v of [undefined, "", "0"]) {
      assert.equal(withFlag(v, () => T.trustPageEnabled()), false);
    }
  });

  // M3 — a pending claim is promoted without evidence.
  catches("ترقية ادّعاء معلّق إلى live", () => {
    const mutated = read("content/trust.ts")
      .replace(/id:\s*"backups",\s*\n\s*status:\s*"pending"/, 'id: "backups",\n    status: "live"');
    const T = loadTs("content/trust.ts", () => ({}), mutated);
    assert.equal(T.liveTrustClaims().some((c) => c.id === "backups"), false);
  });

  // M4 — the page renders every claim instead of the live ones.
  catches("عرض TRUST_CLAIMS كاملة", () => {
    const m = read("components/TrustPage.tsx").replace(/liveTrustClaims\(\)/g, "TRUST_CLAIMS");
    assert.doesNotMatch(m, /\bTRUST_CLAIMS\b/);
  });

  // M5 — the identifiers are declared verified without a certificate.
  catches("إعلان المعرّفات متحقَّقة", () => {
    const mutated = read("content/registration.ts")
      .replace("const REGISTRATION_VERIFIED: boolean = false;", "const REGISTRATION_VERIFIED: boolean = true;");
    const R = loadTs("content/registration.ts", () => ({}), mutated);
    assert.equal(R.registrationVerified(), false);
  });

  // M6 — the identifiers move back into the client-reachable module.
  catches("إعادة الأرقام إلى content/nap.ts", () => {
    const REG = loadTs("content/registration.ts");
    const mutated = read("content/nap.ts")
      .replace("export const NAP = {", `export const NAP = {\n  cr: "${REG.REGISTRATION.commercialRegistration}",`);
    assert.equal(mutated.includes(REG.REGISTRATION.commercialRegistration), false);
  });

  // M7 — the sitemap lists /trust unconditionally.
  catches("إدراج /trust في sitemap بلا شرط", () => {
    const routesConst = read("app/sitemap.ts").match(/const\s+PUBLIC_ROUTES[\s\S]*?\n\];/)[0]
      .replace("\n];", '\n  { path: "/trust", changeFrequency: "yearly", priority: 0.5 },\n];');
    assert.doesNotMatch(routesConst, /"\/trust"/);
  });

  // M8 — generateMetadata regresses to a static export that cannot withhold.
  catches("تحويل generateMetadata إلى ثابت", () => {
    const m = read(EN_ROUTE).replace(/export\s+function\s+generateMetadata\s*\(\s*\)\s*:\s*Metadata\s*\{/, "export const metadata: Metadata = {");
    assert.match(m, /export\s+function\s+generateMetadata\s*\(/);
  });
});
