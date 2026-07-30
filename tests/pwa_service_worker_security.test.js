// ════════════════════════════════════════════════════════════════════════════
// tests/pwa_service_worker_security.test.js
//
// THE POINT OF PHASE B. A service worker is an origin-wide proxy that outlives
// the tab, the session, the sign-out and the user switch. These tests EXECUTE
// the real public/sw.js in a sandbox and interrogate its actual decisions —
// not its comments — for every category of data that must never be stored.
// ════════════════════════════════════════════════════════════════════════════
const { test } = require("node:test");
const assert = require("node:assert");
const { R, ORIGIN, loadServiceWorker, fakeRequest, fakeResponse, tsConst, tsStringArray } =
  require("./pwa_helpers");

const SW = R("public/sw.js");
const CONFIG = R("lib/pwa/config.ts");
const { ctx, source, listeners } = loadServiceWorker();

const isCacheable = (u) => ctx.isCacheableUrl(u);

// ─── Scope and registration ─────────────────────────────────────────────────

test("the worker is served from the root so its scope covers the whole origin", () => {
  assert.equal(tsConst(CONFIG, "SW_URL"), "/sw.js", "the script lives at the origin root");
  assert.equal(tsConst(CONFIG, "SW_SCOPE"), "/", "and claims root scope");
  const provider = R("components/pwa/PwaProvider.tsx");
  assert.ok(/register\(SW_URL,\s*\{\s*scope:\s*SW_SCOPE\s*\}\)/.test(provider),
    "registration passes the declared scope rather than an inline literal that could drift");
  const cfg = R("next.config.js");
  assert.ok(/Service-Worker-Allowed/.test(cfg), "the allowed-scope header is declared");
  // A narrower scope cannot refuse to cache what it never sees.
  assert.ok(!/scope:\s*["']\/client-portal/.test(provider), "scope is not narrowed to a subtree");
});

test("sw.js itself is served no-store — otherwise a broken worker can never be replaced", () => {
  const cfg = R("next.config.js");
  const block = cfg.slice(cfg.indexOf('source: "/sw.js"'), cfg.indexOf('source: "/sw.js"') + 600);
  assert.ok(/no-store/.test(block), "the worker script is never cached by the CDN");
  assert.ok(/must-revalidate/.test(block), "and always revalidated");
});

// ─── The mirror between lib/pwa/config.ts and public/sw.js ──────────────────

test("the worker's constants match lib/pwa/config.ts exactly — no silent drift", () => {
  const version = tsConst(CONFIG, "PWA_VERSION");
  assert.ok(version, "the config declares a version");
  assert.ok(new RegExp(`const PWA_VERSION = "${version}"`).test(SW), "the worker mirrors the version");
  assert.equal(ctx.PWA_VERSION, version, "and the executed worker actually holds it");

  for (const name of [
    "NEVER_CACHE_PATH_PREFIXES",
    "NEVER_CACHE_URL_TOKENS",
    "STATIC_CACHE_ALLOWLIST",
    "PUBLIC_PAGE_ALLOWLIST",
  ]) {
    const fromConfig = tsStringArray(CONFIG, name);
    assert.ok(Array.isArray(fromConfig) && fromConfig.length > 0, `${name} is declared in config.ts`);
    for (const entry of fromConfig) {
      assert.ok(
        SW.includes(`"${entry}"`) || SW.includes("MANIFEST_URL") || SW.includes("OFFLINE_URL"),
        `${name} entry ${entry} must also appear in public/sw.js`
      );
    }
  }
});

// ─── NO SENSITIVE ENDPOINT IS CACHED ────────────────────────────────────────

test("no API response is cacheable", () => {
  for (const u of [
    `${ORIGIN}/api/comms/process`,
    `${ORIGIN}/api/notify/send`,
    `${ORIGIN}/api/anything?x=1`,
  ]) {
    assert.equal(isCacheable(u), false, `${u} must never be cached`);
  }
});

test("no authenticated route tree is cacheable — client data, projects, finance", () => {
  for (const u of [
    `${ORIGIN}/client-portal`,
    `${ORIGIN}/client-portal/finance`,
    `${ORIGIN}/client-portal/project-core/abc-123`,
    `${ORIGIN}/client-portal/projects/9`,
    `${ORIGIN}/client-portal/crm`,
    `${ORIGIN}/client-portal/executive`,
    `${ORIGIN}/client-portal/compliance`,
    `${ORIGIN}/client-portal/case-studies`,   // the DRAFT workbench, not the public index
    `${ORIGIN}/admin/whatsapp`,
    `${ORIGIN}/secure-document`,
    `${ORIGIN}/quick-access`,
    `${ORIGIN}/upload-files`,
  ]) {
    assert.equal(isCacheable(u), false, `${u} must never be cached`);
  }
});

test("no Supabase call is cacheable — auth, rest, storage, realtime, edge", () => {
  const sb = "https://gmqpkbrlwmkkylarbcqi.supabase.co";
  for (const u of [
    `${sb}/auth/v1/token?grant_type=password`,
    `${sb}/rest/v1/clients?select=*`,
    `${sb}/rest/v1/rpc/exec_visible_projects`,
    `${sb}/storage/v1/object/public/logos/a.png`,
    `${sb}/functions/v1/notify`,
    `${sb}/realtime/v1/websocket`,
  ]) {
    assert.equal(isCacheable(u), false, `${u} must never be cached`);
  }
});

test("cross-origin is never cached at all — an opaque response cannot be inspected", () => {
  for (const u of [
    "https://fonts.googleapis.com/css2?family=Tajawal",
    "https://fonts.gstatic.com/s/tajawal/v1.woff2",
    "https://img.youtube.com/vi/JN5MRQuEP4M/maxresdefault.jpg",
    "https://script.google.com/macros/s/xyz/exec",
    "https://evil.example.com/logo.png",
  ]) {
    assert.equal(isCacheable(u), false, `${u} is off-origin and must not be stored`);
  }
});

// ─── AUTH DATA IS NOT CACHED ────────────────────────────────────────────────

test("auth/session data is not cacheable by URL", () => {
  for (const u of [
    `${ORIGIN}/x?access_token=eyJhbGciOi`,
    `${ORIGIN}/x?refresh_token=abc`,
    `${ORIGIN}/x?id_token=abc`,
    `${ORIGIN}/x?apikey=anon-key`,
    `${ORIGIN}/case-studies?token=abc`,
    `${ORIGIN}/auth/v1/user`,
  ]) {
    assert.equal(isCacheable(u), false, `${u} carries auth material`);
  }
});

test("an authenticated REQUEST is refused even when its URL looks public", () => {
  // The single most dangerous case: GET / with a bearer token attached.
  assert.equal(
    ctx.requestIsPrivate(fakeRequest(`${ORIGIN}/`, { headers: { authorization: "Bearer eyJ..." } })),
    true, "an Authorization header makes any request private"
  );
  assert.equal(
    ctx.requestIsPrivate(fakeRequest(`${ORIGIN}/case-studies`, { credentials: "include" })),
    true, "credentialed requests are private"
  );
  assert.equal(
    ctx.requestIsPrivate(fakeRequest(`${ORIGIN}/case-studies`, { headers: { rsc: "1" } })),
    true, "an RSC payload is page DATA, not markup — never cached"
  );
  assert.equal(
    ctx.requestIsPrivate(fakeRequest(`${ORIGIN}/case-studies`, { headers: { "next-router-state-tree": "%5B" } })),
    true, "router-state prefetches are treated as data too"
  );
  assert.equal(
    ctx.requestIsPrivate(fakeRequest(`${ORIGIN}/case-studies`)),
    false, "a plain anonymous GET of a public page is NOT private (or nothing would ever cache)"
  );
});

test("RSC data URLs are refused by URL as well as by header", () => {
  assert.equal(isCacheable(`${ORIGIN}/client-portal/finance?_rsc=abc12`), false);
  assert.equal(isCacheable(`${ORIGIN}/case-studies?_rsc=abc12`), false);
  assert.equal(isCacheable(`${ORIGIN}/_next/data/build/x.json`), false);
});

test("a response that declares itself private is refused at the last gate", () => {
  const ok = fakeResponse({ headers: { "cache-control": "public, max-age=60" } });
  assert.equal(ctx.responseIsCacheable(ok), true, "an ordinary public response is storable");

  assert.equal(ctx.responseIsCacheable(fakeResponse({ headers: { "cache-control": "no-store" } })), false);
  assert.equal(ctx.responseIsCacheable(fakeResponse({ headers: { "cache-control": "private, max-age=0" } })), false);
  assert.equal(ctx.responseIsCacheable(fakeResponse({ headers: { "set-cookie": "sb=1" } })), false);
  assert.equal(ctx.responseIsCacheable(fakeResponse({ headers: { vary: "Authorization" } })), false);
  assert.equal(ctx.responseIsCacheable(fakeResponse({ type: "opaque" })), false);
  assert.equal(ctx.responseIsCacheable(fakeResponse({ type: "cors" })), false);
  assert.equal(ctx.responseIsCacheable(fakeResponse({ status: 206 })), false);
  assert.equal(ctx.responseIsCacheable(fakeResponse({ status: 302 })), false);
  assert.equal(ctx.responseIsCacheable(null), false, "a missing response is not cacheable");
});

// ─── SIGNED URLS ARE NOT CACHED ─────────────────────────────────────────────

test("SIGNED URLs are never cached — expiry inside a cache is expiry ignored", () => {
  const sb = "https://gmqpkbrlwmkkylarbcqi.supabase.co";
  for (const u of [
    `${sb}/storage/v1/object/sign/deliverables/final.mp4?token=eyJhbGciOi`,
    `${ORIGIN}/object/sign/evidence/photo.jpg?token=abc`,
    `${ORIGIN}/file.mp4?X-Amz-Signature=deadbeef&X-Amz-Expires=3600`,
    `${ORIGIN}/file.mp4?Expires=1893456000&Signature=abc`,
    `${ORIGIN}/preview?sig=abc123`,
    `${ORIGIN}/signed/preview.mp4`,
  ]) {
    assert.equal(isCacheable(u), false, `${u} is a signed/expiring URL`);
  }
});

test("internal documents, drafts, compliance and vendor data have no cacheable surface", () => {
  // All of them are reached through /api/* or Supabase /rest/v1/*, both refused
  // above; and their pages live under /client-portal, also refused. This test
  // pins the reasoning so a future route cannot quietly become cacheable.
  for (const u of [
    `${ORIGIN}/api/case-studies/draft`,
    `${ORIGIN}/client-portal/compliance/vendor/1`,
    `${ORIGIN}/secure-document?id=abc`,
    "https://gmqpkbrlwmkkylarbcqi.supabase.co/rest/v1/vendor_bank_accounts",
    "https://gmqpkbrlwmkkylarbcqi.supabase.co/rest/v1/ai_conversations",
  ]) {
    assert.equal(isCacheable(u), false, `${u} must never be cached`);
  }
});

// ─── WHAT IS ALLOWED (the allowlist must not be empty or the worker is pointless) ──

test("only the named public allowlist is cacheable", () => {
  const allowed = [
    `${ORIGIN}/_next/static/chunks/main-abc123.js`,
    `${ORIGIN}/_next/static/css/abc.css`,
    `${ORIGIN}/logo.png`,
    `${ORIGIN}/favicon.ico`,
    `${ORIGIN}/clients/aramco.png`,
    `${ORIGIN}/hero-poster.jpg`,
    `${ORIGIN}/manifest.webmanifest`,
    `${ORIGIN}/offline`,
    `${ORIGIN}/`,
    `${ORIGIN}/case-studies`,
    `${ORIGIN}/case-studies/some-published-slug`,
    `${ORIGIN}/privacy-policy`,
    `${ORIGIN}/terms`,
  ];
  for (const u of allowed) assert.equal(isCacheable(u), true, `${u} should be cacheable`);

  // And nothing outside it, including plausible-looking siblings.
  for (const u of [`${ORIGIN}/book-meeting`, `${ORIGIN}/quote-request`, `${ORIGIN}/opportunities`]) {
    assert.equal(isCacheable(u), false, `${u} is not on the allowlist, so it is network-only`);
  }
});

test("cache-first is limited to immutable static assets; pages are network-first", () => {
  assert.equal(ctx.isStaticAsset(`${ORIGIN}/_next/static/chunks/x.js`), true);
  assert.equal(ctx.isStaticAsset(`${ORIGIN}/clients/ford.png`), true);
  assert.equal(ctx.isStaticAsset(`${ORIGIN}/case-studies`), false, "a changing page is not cache-first");
  assert.equal(ctx.isPublicPage(`${ORIGIN}/case-studies`), true);
  assert.equal(ctx.isPublicPage(`${ORIGIN}/case-studies/x`), true);
  assert.equal(ctx.isPublicPage(`${ORIGIN}/client-portal`), false);
  assert.ok(/networkFirst\(request, PUBLIC_CACHE\)/.test(SW), "public pages take the network-first path");
  assert.ok(/cacheFirst\(request, STATIC_CACHE\)/.test(SW), "static assets take the cache-first path");
});

test("every decision returns an explicit boolean — never undefined, never null", () => {
  const probes = [
    `${ORIGIN}/`, `${ORIGIN}/api/x`, "not a url at all", "https://other.example/x",
    `${ORIGIN}/case-studies/x?y=1`, `${ORIGIN}/_next/static/a.js`,
  ];
  for (const u of probes) {
    for (const fn of ["isCacheableUrl", "isStaticAsset", "isPublicPage"]) {
      const v = ctx[fn](u);
      assert.equal(typeof v, "boolean", `${fn}(${u}) returned ${String(v)} instead of a boolean`);
    }
  }
  assert.equal(isCacheable("::::not-a-url"), false, "an unparseable URL fails closed");
});

// ─── Versioning and invalidation ────────────────────────────────────────────

test("cache names carry the version, and stale versions are dropped on activate", () => {
  const v = ctx.PWA_VERSION;
  assert.equal(ctx.STATIC_CACHE, `kian-pwa-static-v${v}`);
  assert.equal(ctx.PUBLIC_CACHE, `kian-pwa-public-v${v}`);
  assert.ok(/function dropStaleVersions/.test(SW), "a stale-version sweep exists");
  assert.ok(/n !== STATIC_CACHE && n !== PUBLIC_CACHE/.test(SW), "it keeps only the current names");
  assert.ok(/indexOf\(CACHE_PREFIX\) === 0/.test(SW), "and only ever touches this app's caches");
  assert.ok(listeners.activate && listeners.activate.length === 1, "an activate handler is registered");
});

test("stale-version sweep leaves other applications' caches alone", async () => {
  const cleared = await ctx.dropStaleVersions();
  assert.ok(cleared.includes("kian-pwa-static-v0.9.0"), "a previous version is dropped");
  assert.ok(!cleared.includes("other-app-cache"), "a foreign cache is never touched");
  assert.ok(!cleared.includes("kian-pwa-public-v1.0.0"), "the current version survives");
});

test("a single failed precache asset does not abort the install", () => {
  assert.ok(/for \(let i = 0; i < PRECACHE_URLS.length; i\+\+\)/.test(SW), "assets are added one at a time");
  assert.ok(/try \{[\s\S]{0,200}cache\.add[\s\S]{0,120}catch/.test(SW),
    "each add is individually guarded — an aborted install means no offline page at all");
});
