// ════════════════════════════════════════════════════════════════════════════
// tests/pwa_offline_readonly.test.js
//
// OFFLINE IS READ-ONLY IN V1. The failure this guards against is not a crash —
// it is a background replay: a queued approval, custody issue or payment that
// re-fires hours later against state that has since changed, with nobody
// watching. So the worker must not merely "avoid" write queues; it must have no
// mechanism for one, and non-GET traffic must not be intercepted at all.
// ════════════════════════════════════════════════════════════════════════════
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { ROOT, R, ORIGIN, loadServiceWorker, fakeRequest, fakeNavigation, fakeResponse, tsConst } =
  require("./pwa_helpers");

const SW = R("public/sw.js");
const CONFIG = R("lib/pwa/config.ts");
const OFFLINE_SCREEN = R("components/pwa/OfflineScreen.tsx");
const PROVIDER = R("components/pwa/PwaProvider.tsx");
const { ctx, listeners, sandbox, cacheStub } = loadServiceWorker();

const NOTICE = "أنت غير متصل — بعض البيانات قديمة والعمليات الحساسة غير متاحة";

// ─── The offline page ───────────────────────────────────────────────────────

test("the offline route exists, is static, noindex, and carries no user data", () => {
  const page = path.join(ROOT, "app/offline/page.tsx");
  assert.ok(fs.existsSync(page), "app/offline/page.tsx exists");
  const src = fs.readFileSync(page, "utf8");
  assert.ok(/force-static/.test(src), "it is statically rendered so it can be precached");
  assert.ok(/index:\s*false/.test(src), "it is not indexed");
  // A fallback page that fetched anything could cache account data.
  assert.ok(!/fetch\(/.test(src) && !/fetch\(/.test(OFFLINE_SCREEN), "it makes no network call");
  assert.ok(!/localStorage|sessionStorage/.test(OFFLINE_SCREEN), "it reads no session storage");
  assert.ok(!/supabase|Supabase/.test(OFFLINE_SCREEN), "it touches no data layer");
});

test("the offline page states the required Arabic notice verbatim", () => {
  assert.equal(tsConst(CONFIG, "OFFLINE_NOTICE"), NOTICE, "the constant is the exact required wording");
  assert.ok(/OFFLINE_NOTICE/.test(OFFLINE_SCREEN), "the page renders the shared constant, not a copy");
  assert.ok(SW.includes(NOTICE), "the worker's inline last-resort fallback carries it too");
  assert.ok(/dir="rtl"/.test(OFFLINE_SCREEN) && /lang="ar"/.test(OFFLINE_SCREEN), "Arabic + RTL");
});

test("the offline page names the operations that are unavailable", () => {
  for (const word of ["مالية", "مشروع", "عهدة", "اعتماد", "رسالة", "حجز"]) {
    assert.ok(OFFLINE_SCREEN.includes(word), `the page tells the user "${word}" is unavailable offline`);
  }
  assert.ok(/لا تُنفَّذ لاحقًا تلقائيًّا/.test(OFFLINE_SCREEN),
    "and states plainly that nothing is replayed automatically later");
});

test("the offline page is precached, and there is a fallback even if precaching failed", () => {
  assert.ok(/PRECACHE_URLS = \[OFFLINE_URL/.test(SW), "the offline page is precached at install");
  assert.ok(/async function offlineResponse/.test(SW), "a fallback responder exists");
  assert.ok(/cache\.match\(OFFLINE_URL/.test(SW), "it prefers the real precached page");
  assert.ok(/<!doctype html>/i.test(SW), "and falls back to self-contained HTML if the page is missing");
  assert.ok(/status: 503/.test(SW), "the synthetic fallback is honestly a 503, not a fake 200");
});

test("a failed navigation lands on the offline page rather than a browser error", () => {
  assert.ok(/request\.mode === "navigate"/.test(SW), "navigations are recognised");
  assert.ok(/networkOnlyWithOfflineFallback/.test(SW), "and get the offline fallback");
  // Including navigations to private routes: the fallback holds no data, so
  // showing it for /client-portal/finance leaks nothing.
  assert.ok(/return offlineResponse\(\)/.test(SW));
});

test("a REAL browser navigation is handled — public and private alike", () => {
  // REGRESSION. Browsers set credentials:"include" on every top-level
  // navigation. A worker that reads that as a privacy signal returns early and
  // never responds to a navigation at all, so the offline page cannot appear in
  // any real browser — while synthetic requests built with the "same-origin"
  // default keep every other test in this file green. The bug is invisible
  // except from here.
  const fetchHandler = listeners.fetch[0];
  for (const u of [`${ORIGIN}/`, `${ORIGIN}/case-studies`, `${ORIGIN}/client-portal/finance`]) {
    let responded = false;
    fetchHandler({
      request: fakeNavigation(u),
      respondWith: () => { responded = true; },
      waitUntil: () => {},
    });
    assert.equal(responded, true, `the worker must handle the navigation to ${u} to be able to serve the offline page`);
  }
});

test("a private navigation is served the offline page and writes NOTHING to any cache", async () => {
  cacheStub._put.length = 0;
  // Network is disabled in the sandbox, so this takes the offline branch.
  const res = await ctx.networkOnlyWithOfflineFallback(fakeNavigation(`${ORIGIN}/client-portal/finance`));
  assert.equal(res.init.status, 503, "an honest 503, never a fake 200");
  assert.ok(String(res.body).includes(NOTICE), "carrying the exact required notice");
  assert.deepEqual(cacheStub._put, [], "the private route left no trace in any cache");
  assert.equal(ctx.isCacheableUrl(`${ORIGIN}/client-portal/finance`), false, "and is still not cacheable");
});

test("the worker is not inert: an allowlisted public page really is stored", async () => {
  cacheStub._put.length = 0;
  const previousFetch = sandbox.fetch;
  sandbox.fetch = async () => fakeResponse({ headers: { "cache-control": "public, max-age=60" } });
  try {
    await ctx.networkFirst(fakeNavigation(`${ORIGIN}/case-studies`), "kian-pwa-public-v1.0.0");
    assert.deepEqual(cacheStub._put, [`${ORIGIN}/case-studies`],
      "a published case-studies page IS cached — otherwise the offline shell is decorative");
    // The same code path must still refuse a private response body.
    cacheStub._put.length = 0;
    sandbox.fetch = async () => fakeResponse({ headers: { "cache-control": "private" } });
    await ctx.networkFirst(fakeNavigation(`${ORIGIN}/case-studies`), "kian-pwa-public-v1.0.0");
    assert.deepEqual(cacheStub._put, [], "a response that declares itself private is still refused");
  } finally {
    sandbox.fetch = previousFetch;
  }
});

// ─── NO BACKGROUND WRITE REPLAY ─────────────────────────────────────────────

test("the worker has NO mechanism for a background write replay", () => {
  for (const banned of [
    'addEventListener("sync"',
    'addEventListener("periodicsync"',
    "SyncManager",
    "periodicSync",
    "registration.sync",
    "BackgroundFetch",
    "backgroundFetch",
    "IndexedDB",
    "indexedDB",
  ]) {
    assert.ok(!SW.includes(banned), `public/sw.js must not contain ${banned} — that is a replay mechanism`);
  }
  assert.ok(!listeners.sync, "no sync listener was registered at runtime");
  assert.ok(!listeners.periodicsync, "no periodicsync listener was registered at runtime");
  assert.deepEqual(
    Object.keys(listeners).sort(),
    ["activate", "fetch", "install", "message"],
    "the worker registers exactly four listeners and no more"
  );
});

test("non-GET requests are not intercepted at all — no queue, no replay, honest failure", () => {
  const fetchHandler = listeners.fetch[0];
  for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
    let responded = false;
    fetchHandler({
      request: fakeRequest(`${ORIGIN}/api/finance/approve`, { method }),
      respondWith: () => { responded = true; },
      waitUntil: () => {},
    });
    assert.equal(responded, false, `${method} must pass straight through to the network`);
  }
  assert.ok(/if \(request\.method !== "GET"\) return;/.test(SW),
    "the guard is the first thing the fetch handler does");
});

test("a GET to a private surface is never intercepted for caching", () => {
  const fetchHandler = listeners.fetch[0];
  let responded = false;
  fetchHandler({
    request: fakeRequest(`${ORIGIN}/api/exec/report`, { mode: "cors" }),
    respondWith: () => { responded = true; },
    waitUntil: () => {},
  });
  assert.equal(responded, false, "an API GET is left entirely to the browser");

  // An authenticated GET of the home page is also left alone.
  responded = false;
  fetchHandler({
    request: fakeRequest(`${ORIGIN}/`, { headers: { authorization: "Bearer x" } }),
    respondWith: () => { responded = true; },
    waitUntil: () => {},
  });
  assert.equal(responded, false, "a bearer-token request is never handled by the worker");
});

test("no local draft or outbox is implemented anywhere in the PWA layer", () => {
  for (const f of [
    "components/pwa/PwaProvider.tsx",
    "components/pwa/InstallGuide.tsx",
    "components/pwa/OfflineScreen.tsx",
    "lib/pwa/config.ts",
    "lib/pwa/privateCache.ts",
  ]) {
    const src = R(f);
    for (const banned of ["outbox", "replay", "queueWrite", "pendingMutation", "navigator.sendBeacon"]) {
      assert.ok(!src.includes(banned), `${f} must not implement ${banned} in V1`);
    }
  }
});

test("the read-only rule is written into the contract, including the one future exception", () => {
  const doc = R("docs/PWA_V1_CONTRACT.md");
  assert.ok(doc.includes(NOTICE), "the contract quotes the exact notice");
  assert.ok(/قراءة فقط/.test(doc), "it states offline is read-only");
  assert.ok(/Background Sync/.test(doc), "it names the mechanism that is refused");
  assert.ok(/إرسال يدويّ صريح/.test(doc),
    "and records that any future local draft needs an explicit manual submit, never a replay");
});

// ─── The update flow ────────────────────────────────────────────────────────

/**
 * Strip whole-line comments so a ban can scan CODE rather than prose.
 * This matters precisely here: the install handler must NOT call skipWaiting,
 * AND must say so at the call site. Asserting both against the same raw text is
 * self-contradictory — the documenting comment contains the banned call — so an
 * un-stripped version of this test could never have passed, in either direction.
 */
const codeOnly = (s) => s.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

test("a new worker WAITS — it never swaps itself in mid-session", () => {
  const install = SW.slice(SW.indexOf('addEventListener("install"'), SW.indexOf('addEventListener("activate"'));
  assert.ok(!/self\.skipWaiting\(\)/.test(codeOnly(install)),
    "install must NOT call skipWaiting — swapping a worker under an open form loses work");
  assert.ok(/NO self\.skipWaiting\(\)/.test(install), "and the refusal is documented at the site");
  assert.equal((codeOnly(SW).match(/self\.skipWaiting\(\)/g) || []).length, 1,
    "exactly ONE skipWaiting call exists in the worker — the message handler's, driven by the user's click");
});

test("the swap happens only on the user's click, then the page reloads once", () => {
  assert.ok(/MSG_SKIP_WAITING/.test(SW) && /self\.skipWaiting\(\)/.test(SW),
    "the worker exposes an explicit skip-waiting message");
  assert.ok(/reg\.waiting\.postMessage\(\{ type: MSG\.SKIP_WAITING \}\)/.test(PROVIDER),
    "the page sends it from applyUpdate()");
  assert.ok(/onClick=\{applyUpdate\}/.test(PROVIDER), "which is bound to a button, not an effect");
  assert.ok(/controllerchange/.test(PROVIDER), "and reloads on controllerchange");
  assert.ok(/reloadingRef/.test(PROVIDER),
    "guarded by a flag so an unrelated controller change cannot cause a surprise reload loop");
});

test("the update indicator does not fire on a first install", () => {
  assert.ok(/incoming\.state === "installed" && navigator\.serviceWorker\.controller/.test(PROVIDER),
    "an 'update' is only announced when a controller already exists");
});

test("the version shown is the ACTIVE worker's, not the bundle's claim", () => {
  assert.ok(/MSG_GET_VERSION/.test(SW), "the worker answers a version query");
  assert.ok(/version: PWA_VERSION/.test(SW), "with the version it is actually running");
  assert.ok(/MSG\.GET_VERSION/.test(PROVIDER), "the page asks");
  assert.ok(/answer !== PWA_VERSION\) setUpdateReady\(true\)/.test(PROVIDER),
    "and a mismatch between active and shipped IS the update signal");
  assert.ok(/setTimeout\(\(\) => resolve\(null\), 2000\)/.test(PROVIDER),
    "a silent worker times out instead of hanging the indicator");
});

test("a build identifier is exposed to the UI and to the offline page", () => {
  assert.ok(/PWA_BUILD_ID/.test(CONFIG), "a build id constant exists");
  assert.ok(/kian-pwa-\$\{PWA_VERSION\}/.test(CONFIG), "derived from the version, so it cannot drift");
  assert.ok(/PWA_BUILD_ID/.test(PROVIDER) && /data-kian-pwa-build/.test(PROVIDER), "surfaced in the DOM");
  assert.ok(/PWA_BUILD_ID/.test(OFFLINE_SCREEN), "and visible on the offline page for support calls");
});

test("the offline indicator reacts to real connectivity events", () => {
  assert.ok(/addEventListener\("online"/.test(PROVIDER) && /addEventListener\("offline"/.test(PROVIDER),
    "both events are observed");
  assert.ok(/navigator\.onLine/.test(PROVIDER), "and the initial state is read once mounted");
  assert.ok(PROVIDER.includes("OFFLINE_NOTICE"), "the banner uses the shared exact wording");
  assert.ok(/role="status"/.test(PROVIDER) && /aria-live="polite"/.test(PROVIDER), "announced to assistive tech");
  // Reading navigator.onLine during render would mismatch SSR; it must be in an effect.
  assert.ok(/useState\(true\)/.test(PROVIDER), "initial render assumes online, so hydration cannot mismatch");
});
