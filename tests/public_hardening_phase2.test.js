// ════════════════════════════════════════════════════════════════════════════
// tests/public_hardening_phase2.test.js — «المرحلة الثانية — تقوية بوابة كيان العامة»
//
// Pins the public-surface hardening:
//   • the build no longer IGNORES TypeScript and ESLint errors (it used to ship them
//     silently — a deploy would go green while a real defect was live);
//   • security headers gained Permissions-Policy and a CSP that CANNOT break the app;
//   • API responses are no-store and the authenticated portal is noindex;
//   • robots.txt / sitemap.xml / favicon exist at all (none did) and never expose a
//     private route.
//
// The CSP test is the important one: `default-src` cascades to script-src, style-src and
// connect-src, so an enforced `default-src 'self'` would have blocked Next's inline
// bootstrap, this app's inline styles, and every browser call to Supabase — white-screening
// the portal. That mistake was made and caught during this work; this test makes it
// impossible to reintroduce.
// Static only — no DB, no network.
// ════════════════════════════════════════════════════════════════════════════
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(root, p), "utf8");
const exists = (p) => fs.existsSync(path.join(root, p));

const CFG = R("next.config.js");
const ROBOTS = R("app/robots.ts");
const SITEMAP = R("app/sitemap.ts");
const SITE = R("lib/site.ts");

// ─── build gates ───
test("B1: the build no longer ignores TypeScript or ESLint errors", () => {
  assert.ok(/typescript: \{ ignoreBuildErrors: false \}/.test(CFG), "TS errors fail the build");
  assert.ok(/eslint: \{ ignoreDuringBuilds: false \}/.test(CFG), "lint errors fail the build");
  assert.ok(!/ignoreBuildErrors: true/.test(CFG) && !/ignoreDuringBuilds: true/.test(CFG), "no leftover bypass");
});

// ─── CSP safety (the critical one) ───
function headerGroups() {
  // Evaluate the real config rather than regexing it, so the test sees what ships.
  delete require.cache[require.resolve(path.join(root, "next.config.js"))];
  return require(path.join(root, "next.config.js")).headers();
}
const groupFor = (hs, src) => hs.find((h) => h.source === src);
const valueOf = (g, key) => g.headers.find((h) => h.key === key)?.value ?? "";

test("C1: the ENFORCED CSP contains no cascading directive that would break the app", async () => {
  const hs = await headerGroups();
  const csp = valueOf(groupFor(hs, "/(.*)"), "Content-Security-Policy");
  assert.ok(csp, "an enforced CSP is set");
  for (const d of ["default-src", "script-src", "style-src", "connect-src", "img-src", "font-src", "media-src"]) {
    assert.ok(!csp.includes(d), `${d} must NOT be enforced — it would block Next inline code or Supabase calls`);
  }
});

test("C2: the enforced CSP still carries the directives that are safe AND valuable", async () => {
  const hs = await headerGroups();
  const csp = valueOf(groupFor(hs, "/(.*)"), "Content-Security-Policy");
  for (const d of ["frame-ancestors 'self'", "base-uri 'self'", "form-action", "object-src 'none'"]) {
    assert.ok(csp.includes(d), `${d} present`);
  }
  // form-action must still allow the relay the public forms actually POST to
  assert.ok(/form-action[^;]*script\.google\.com/.test(csp), "the working form target is not broken");
});

test("C3: the strict policy ships as Report-Only so violations are measured, not enforced", async () => {
  const hs = await headerGroups();
  const ro = valueOf(groupFor(hs, "/(.*)"), "Content-Security-Policy-Report-Only");
  assert.ok(ro.includes("default-src 'self'"), "the aspirational policy is expressed");
  assert.ok(/connect-src[^;]*supabase\.co/.test(ro), "Supabase is allowed in the target policy");
  assert.ok(!ro.includes("report-uri"), "no report endpoint is claimed that does not exist");
});

test("C4: Permissions-Policy denies hardware the site never uses", async () => {
  const hs = await headerGroups();
  const pp = valueOf(groupFor(hs, "/(.*)"), "Permissions-Policy");
  for (const f of ["camera=()", "microphone=()", "geolocation=()", "payment=()"]) {
    assert.ok(pp.includes(f), `${f} denied`);
  }
});

// ─── caching / indexing of private surfaces ───
test("C5: API responses are never cached by a shared cache, and are noindex", async () => {
  const hs = await headerGroups();
  const api = groupFor(hs, "/api/(.*)");
  assert.ok(api, "an /api header group exists");
  assert.ok(/no-store/.test(valueOf(api, "Cache-Control")), "no-store — a cached user-scoped response is how data leaks between users");
  assert.ok(/noindex/.test(valueOf(api, "X-Robots-Tag")), "noindex");
});

test("C6: the authenticated portal is noindex and privately cached", async () => {
  const hs = await headerGroups();
  const portal = groupFor(hs, "/client-portal/:path*");
  assert.ok(portal, "a portal header group exists");
  assert.ok(/noindex/.test(valueOf(portal, "X-Robots-Tag")));
  assert.ok(/private|no-store/.test(valueOf(portal, "Cache-Control")));
});

// ─── SEO assets that did not exist at all ───
test("S1: robots.txt exists and hides every authenticated surface", () => {
  assert.ok(exists("app/robots.ts"), "generated robots route exists");
  for (const p of ["/api/", "/client-portal/", "/admin/", "/quick-access/"]) {
    assert.ok(ROBOTS.includes(`"${p}"`), `${p} disallowed`);
  }
  assert.ok(/sitemap:/.test(ROBOTS), "points at the sitemap");
});

test("S2: sitemap.xml exists and lists ONLY public pages", () => {
  assert.ok(exists("app/sitemap.ts"), "generated sitemap route exists");
  for (const p of ["/", "/quote-request", "/book-meeting", "/privacy-policy", "/terms"]) {
    assert.ok(SITEMAP.includes(`"${p}"`), `${p} listed`);
  }
  for (const bad of ["/client-portal", "/admin", "/quick-access", "/api"]) {
    assert.ok(!new RegExp(`path: "${bad}`).test(SITEMAP), `${bad} must NOT be in the sitemap`);
  }
});

test("S3: the site origin has ONE definition shared by metadata, robots and sitemap", () => {
  assert.ok(/export const SITE_URL/.test(SITE), "single constant");
  assert.ok(/from "@\/lib\/site"/.test(ROBOTS) && /from "@\/lib\/site"/.test(SITEMAP), "both derive from it");
  assert.ok(/replace\(\/\\\/\+\$\/, ""\)/.test(SITE), "trailing slash normalised so URLs cannot double up");
});

test("S4: a favicon exists (there was none)", () => {
  assert.ok(exists("app/icon.png"), "app/icon.png — Next serves this as the favicon");
  assert.ok(exists("app/apple-icon.png"), "apple touch icon");
});

test("SAFE: static only (no DB/network)", () => {
  const self = R("tests/public_hardening_phase2.test.js");
  const reqs = [...self.matchAll(/require\(["']([^"']+)["']\)/g)].map((m) => m[1]);
  for (const r of reqs) {
    assert.ok(["node:test", "node:assert", "node:fs", "node:path"].includes(r) || r.includes("next.config"),
      `static (got ${r})`);
  }
});
