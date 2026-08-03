// ════════════════════════════════════════════════════════════════════════════
// Wave 1 · V2-1.1 (D-3) — <html lang|dir> must be correct IN THE FIRST BYTE.
//
// ★ WHY THIS TEST READS HTML AND NOT THE DOM ★
// The previous implementation emitted lang="ar" dir="rtl" for /en and corrected
// it with an inline script. Any DOM-based check would have PASSED that build,
// because by the time you can query the DOM the script has already run. The only
// thing that distinguishes the two implementations is the bytes the server sent
// — which is exactly what a JS-less crawler reads. So this test parses the
// PRERENDERED HTML produced by `next build`.
//
// Two layers, deliberately:
//   1. the built HTML, when .next exists — the real proof;
//   2. the source contract, always — so `npm test` before `npm run build`
//      (the order CI uses) still catches a regression instead of silently
//      skipping. Layer 2 alone can never produce a false PASS for layer 1's
//      failure mode, because it also forbids the correcting script.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (r) => fs.readFileSync(path.join(ROOT, r), "utf8");
const exists = (r) => fs.existsSync(path.join(ROOT, r));

const BUILD_DIR = path.join(ROOT, ".next/server/app");
const built = fs.existsSync(BUILD_DIR);

/** <html …> of a prerendered route, or null when that page was not prerendered. */
function htmlTagOf(routeFile) {
  const f = path.join(BUILD_DIR, routeFile);
  if (!fs.existsSync(f)) return null;
  const m = /<html[^>]*>/.exec(fs.readFileSync(f, "utf8"));
  return m ? m[0] : null;
}

const attr = (tag, name) => {
  const m = new RegExp(`${name}="([^"]*)"`).exec(tag || "");
  return m ? m[1] : null;
};

// ═══ LAYER 1 — the bytes the server actually sends ═════════════════════════

test("★ D-3: prerendered HTML carries the right lang/dir per locale", (t) => {
  if (!built) {
    t.skip("no .next build present — layer 2 below still enforces the contract");
    return;
  }
  const cases = [
    ["index.html",        "ar", "rtl"],
    ["terms.html",        "ar", "rtl"],
    ["quote-request.html","ar", "rtl"],
    ["en/terms.html",     "en", "ltr"],
    ["en/index.html",     "en", "ltr"],
  ];
  let checked = 0;
  for (const [file, lang, dir] of cases) {
    const tag = htmlTagOf(file);
    if (!tag) continue;                 // not prerendered in this build
    checked++;
    assert.equal(attr(tag, "lang"), lang, `${file}: lang wrong in the FIRST HTML`);
    assert.equal(attr(tag, "dir"), dir, `${file}: dir wrong in the FIRST HTML`);
  }
  assert.ok(checked >= 3, `expected several prerendered pages, checked ${checked}`);
});

test("★ D-3: the portal's served HTML is unchanged (still ar/rtl)", (t) => {
  if (!built) { t.skip("no .next build present"); return; }
  const tag = htmlTagOf("client-portal.html");
  if (!tag) { t.skip("portal not prerendered in this build"); return; }
  assert.equal(attr(tag, "lang"), "ar");
  assert.equal(attr(tag, "dir"), "rtl");
});

test("★ D-3: no English page is served tagged Arabic", (t) => {
  if (!built) { t.skip("no .next build present"); return; }
  const enDir = path.join(BUILD_DIR, "en");
  if (!fs.existsSync(enDir)) { t.skip("no /en output"); return; }
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const pages = walk(enDir).filter((f) => f.endsWith(".html"));
  assert.ok(pages.length > 0, "no prerendered /en pages found");
  let served = 0;
  for (const f of pages) {
    const src = fs.readFileSync(f, "utf8");
    // A route behind a closed feature flag prerenders as Next's error document
    // (<html id="__next_error__">), which carries no lang/dir because it is a
    // 404, not a page. Judging it would assert a locale on something nobody is
    // served. The gate is tested where it belongs — wave2_trust_release_gate.
    if (/<html[^>]*id="__next_error__"/.test(src)) continue;
    served++;
    const m = /<html[^>]*>/.exec(src);
    assert.ok(m, `${f}: no <html> tag`);
    assert.equal(attr(m[0], "lang"), "en", `🔴 ${path.relative(BUILD_DIR, f)} served as Arabic`);
    assert.equal(attr(m[0], "dir"), "ltr");
  }
  assert.ok(served > 0, "every /en page prerendered as an error document");
});

// ═══ LAYER 2 — the source contract, always enforced ════════════════════════

test("D-3: three root layouts exist and hardcode their locale", () => {
  const roots = [
    ["app/(ar)/layout.tsx", 'lang="ar"', 'dir="rtl"'],
    ["app/(en)/layout.tsx", 'lang="en"', 'dir="ltr"'],
    ["app/(portal)/layout.tsx", 'lang="ar"', 'dir="rtl"'],
  ];
  for (const [f, lang, dir] of roots) {
    assert.ok(exists(f), `missing root layout: ${f}`);
    const s = read(f);
    assert.ok(s.includes(lang) && s.includes(dir), `${f} does not pin ${lang} ${dir}`);
    assert.ok(s.includes("RootDocument"), `${f} must render the shared shell, not its own copy`);
  }
  // Multiple root layouts only work once the single top-level layout is gone.
  assert.ok(!exists("app/layout.tsx"),
    "🔴 app/layout.tsx is back — it would override the per-locale roots");
});

test("★ D-3: the client-side lang-correcting script is gone for good", () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const offenders = [...walk(path.join(ROOT, "app")), ...walk(path.join(ROOT, "components"))]
    .filter((f) => /\.tsx?$/.test(f))
    .filter((f) => /documentElement\.(lang|dir)\s*=/.test(fs.readFileSync(f, "utf8")))
    // lib/i18n.tsx keeps the portal's stored-preference behaviour; app/ and
    // components/ must not correct the attribute at all any more.
    .map((f) => path.relative(ROOT, f));
  assert.deepEqual(offenders, [],
    `🔴 a script is correcting lang/dir again — the server should already be right:\n${offenders.join("\n")}`);
});

test("🔒 D-3: the portal kept its URLs — the group is invisible", () => {
  // Route groups are stripped from the URL, so these paths must still resolve
  // from inside the (portal) group and NOT from a locale segment.
  assert.ok(exists("app/(portal)/client-portal/layout.tsx"), "portal layout missing");
  assert.ok(exists("app/(portal)/admin"), "admin missing");
  assert.ok(!exists("app/[locale]"), "🔴 a [locale] segment appeared");
  assert.ok(!exists("app/(en)/en/client-portal"), "🔴 the portal was localised");
  assert.ok(exists("app/api/public/intake/route.ts"), "🔴 the API moved");
});

test("D-3: one document shell, so the three roots cannot drift", () => {
  assert.ok(exists("components/RootDocument.tsx"));
  const s = read("components/RootDocument.tsx");
  assert.ok(/<html lang=\{lang\} dir=\{dir\}>/.test(s), "shell must take lang/dir as props");
  // The analytics + JSON-LD + PWA provider live here once, not three times.
  for (const marker of ["googletagmanager", "application/ld+json", "PwaProvider"]) {
    assert.ok(s.includes(marker), `shell lost: ${marker}`);
  }
});
