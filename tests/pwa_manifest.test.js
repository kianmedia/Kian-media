// ════════════════════════════════════════════════════════════════════════════
// tests/pwa_manifest.test.js — the manifest is VALID, INSTALLABLE, Arabic/RTL,
// and references only icon files that actually exist.
//
// The last clause is the one with history behind it: a manifest that points at
// /icons/icon-192.png "to be added later" produces a silently broken install
// (Chrome fails installability, iOS shows a blank tile) with no error anywhere.
// So the test resolves every icon `src` against the filesystem.
// ════════════════════════════════════════════════════════════════════════════
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { ROOT, R } = require("./pwa_helpers");

const SRC = R("app/manifest.ts");

/** Evaluate the object literal the manifest route returns (it is plain JS). */
function readManifest() {
  const start = SRC.indexOf("return {");
  const end = SRC.lastIndexOf("};");
  assert.ok(start !== -1 && end > start, "app/manifest.ts must return an object literal");
  const literal = SRC.slice(start + "return ".length, end + 1);
  // eslint-disable-next-line no-new-func
  return new Function(`return (${literal});`)();
}

test("the manifest route exists and produces a parseable object", () => {
  assert.ok(/export default function manifest\(\)/.test(SRC), "a default manifest() export exists");
  assert.ok(/MetadataRoute\.Manifest/.test(SRC), "it is typed as a Next manifest route");
  const m = readManifest();
  assert.equal(typeof m, "object");
  assert.ok(m !== null, "the manifest is an object");
});

test("installability: name, short_name, start_url, scope, display, icons", () => {
  const m = readManifest();
  // The Chrome installability floor.
  assert.ok(typeof m.name === "string" && m.name.length > 0, "name is present");
  assert.ok(typeof m.short_name === "string" && m.short_name.length > 0, "short_name is present");
  assert.ok(m.short_name.length <= 24, "short_name is short enough for a launcher label");
  assert.ok(typeof m.start_url === "string" && m.start_url.startsWith("/"), "start_url is a same-origin path");
  assert.equal(m.scope, "/", "scope is the whole origin, so marketing + portal + offline all stay in-app");
  assert.equal(m.display, "standalone", "standalone display");
  assert.ok(Array.isArray(m.icons) && m.icons.length > 0, "at least one icon");
  assert.ok(typeof m.id === "string" && m.id.length > 0, "a stable id survives start_url changes");
});

test("start_url is inside scope — an out-of-scope start_url silently breaks the install", () => {
  const m = readManifest();
  const startPath = m.start_url.split("?")[0];
  assert.ok(startPath.startsWith(m.scope), `start_url ${startPath} must live under scope ${m.scope}`);
});

test("theme and background colours are declared and are real hex colours", () => {
  const m = readManifest();
  for (const key of ["theme_color", "background_color"]) {
    assert.ok(/^#[0-9a-fA-F]{3,8}$/.test(m[key] || ""), `${key} is a hex colour`);
  }
  // Must match the shipped chrome, or the splash screen flashes a different colour.
  // D-3: the <head> now lives in the shared shell, not in a root layout.
  const layout = R("components/RootDocument.tsx");
  const meta = layout.match(/<meta name="theme-color" content="([^"]+)"/);
  assert.ok(meta, "the document still declares a theme-color meta tag");
  assert.equal(
    m.theme_color.toLowerCase(), meta[1].toLowerCase(),
    "manifest theme_color and the meta theme-color must agree"
  );
});

test("Arabic-first metadata with RTL direction", () => {
  const m = readManifest();
  assert.equal(m.lang, "ar", "primary language is Arabic");
  assert.equal(m.dir, "rtl", "direction is RTL");
  const arabic = /[؀-ۿ]/;
  assert.ok(arabic.test(m.name), "name carries the Arabic identity");
  assert.ok(arabic.test(m.short_name), "short_name carries the Arabic identity");
  assert.ok(arabic.test(m.description || ""), "description is available in Arabic");
  assert.ok(/Kian/i.test(m.name), "and the English identity is present too");
  assert.ok(/[A-Za-z]/.test(m.description || ""), "description carries English as well");
});

test("EVERY icon src resolves to a file that exists — no fabricated icons", () => {
  const m = readManifest();
  for (const icon of m.icons) {
    assert.ok(typeof icon.src === "string" && icon.src.startsWith("/"), "icon src is a rooted path");
    // Served either from public/ or from the app/ file convention.
    const rel = icon.src.replace(/^\//, "");
    const candidates = [path.join(ROOT, "public", rel), path.join(ROOT, "app", rel)];
    const found = candidates.some((p) => fs.existsSync(p));
    assert.ok(found, `icon ${icon.src} must exist on disk (looked in public/ and app/)`);
    assert.ok(/^\d+x\d+$/.test(icon.sizes || ""), `icon ${icon.src} declares its size`);
  }
});

test("no icon claims `maskable` — the existing logo has no safe-zone padding", () => {
  const m = readManifest();
  for (const icon of m.icons) {
    assert.ok(
      !String(icon.purpose || "").includes("maskable"),
      `icon ${icon.src} must not claim maskable: Android crops maskable icons to the inner 80%, ` +
      "so an unpadded square logo ships visibly clipped. Add a padded asset first."
    );
  }
  // The gap must be written down, not just avoided.
  const doc = R("docs/PWA_V1_CONTRACT.md");
  assert.ok(/maskable/.test(doc), "the missing maskable asset is documented");
  assert.ok(/192/.test(doc) && /512/.test(doc), "the missing 192/512 icons are documented");
});

test("at least one icon clears the installability size floor (>= 144px)", () => {
  const m = readManifest();
  const big = m.icons.some((i) => {
    const n = parseInt(String(i.sizes).split("x")[0], 10);
    return Number.isFinite(n) && n >= 144;
  });
  assert.ok(big, "an icon of at least 144px is required for Chrome to offer installation");
});

test("shortcuts point at real routes", () => {
  const m = readManifest();
  if (!m.shortcuts) return;
  for (const s of m.shortcuts) {
    assert.ok(s.name && s.url, "each shortcut has a name and a url");
    const p = s.url.split("?")[0].replace(/\/$/, "");
    // D-3: routes now live inside route groups — (ar), (en), (portal) — which
    // are invisible in the URL. So a shortcut URL maps to a file under ONE of
    // those prefixes. Same guarantee as before (the URL must resolve to a real
    // page), just resolved the way the router actually resolves it.
    const GROUPS = ["", "(ar)", "(en)", "(portal)"];
    const found = GROUPS.some((g) => fs.existsSync(path.join(ROOT, "app", g, p, "page.tsx")));
    assert.ok(found, `shortcut ${s.url} must resolve to an existing route (${p}/page.tsx)`);
  }
});

test("the document does not hand-roll a second <link rel=manifest>", () => {
  // Next injects the tag from app/manifest.ts. A hand-written one in the layout
  // would ship two tags that can disagree after a rename.
  // D-3: the <head> moved to the shared shell.
  const layout = R("components/RootDocument.tsx");
  assert.ok(
    !/rel=["']manifest["']/.test(layout),
    "RootDocument must not add its own manifest link — Next injects it from app/manifest.ts"
  );
});

test("iOS installation metadata is present (iOS ignores the manifest for these)", () => {
  // D-3: `metadata` is per-root now; the Arabic root is the public default.
  const layout = R("app/(ar)/layout.tsx");
  assert.ok(/appleWebApp/.test(layout), "appleWebApp metadata is declared");
  assert.ok(/capable:\s*true/.test(layout), "the app is declared web-app capable on iOS");
  assert.ok(/statusBarStyle/.test(layout), "the iOS status bar style is declared");
  assert.ok(/applicationName/.test(layout), "applicationName is declared");
  // D-3: the <meta viewport> lives in the shared shell, not in a root layout.
  assert.ok(/viewport-fit=cover/.test(R("components/RootDocument.tsx")), "viewport-fit=cover for standalone safe areas");
});
