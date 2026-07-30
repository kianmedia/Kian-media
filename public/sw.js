/* ═══════════════════════════════════════════════════════════════════════════
   Kian Media — Service Worker (PWA V1)

   ⚠️ SECURITY IS THE POINT OF THIS FILE. ⚠️
   A service worker is an origin-wide proxy that outlives the tab, the session,
   the logout and the user switch. On a portal where one device is shared by
   several employees, a single over-cached response is how employee A reads
   employee B's screen. This worker therefore caches by ALLOWLIST only.

   NEVER CACHED — enforced below, at three independent layers:
     · every /api/* route and every authenticated route tree
     · every Supabase call (auth / rest / storage / realtime / edge functions)
     · every access token, refresh token, apikey or SIGNED URL
     · every React Server Component payload (?_rsc — page DATA, not markup)
     · every cross-origin response (opaque responses cannot be inspected)
     · every non-GET request (it is not even intercepted)
     · any response carrying Set-Cookie, or Cache-Control no-store / private

   CACHED — and nothing else:
     · content-hashed build assets under /_next/static/
     · a named list of public images and the app icons
     · the public marketing shell and PUBLISHED case studies (network-first)
     · the offline fallback page

   OFFLINE IS READ-ONLY. There is no `sync` listener, no `periodicsync`
   listener, no write queue and no replay. Non-GET requests are passed straight
   through to the network so an offline write fails HONESTLY and immediately.

   PUSH: FOUNDATION ONLY — DISABLED. There is deliberately no `push` and no
   `pushsubscriptionchange` listener here. See docs/PWA_PUSH_CONTRACT.md.

   ★ MIRROR ★ Every constant below is mirrored from lib/pwa/config.ts.
   tests/pwa_service_worker_security.test.js fails if the two drift.
   ═══════════════════════════════════════════════════════════════════════════ */

"use strict";

const PWA_VERSION = "1.0.0";
const CACHE_PREFIX = "kian-pwa";
const STATIC_CACHE = CACHE_PREFIX + "-static-v" + PWA_VERSION;
const PUBLIC_CACHE = CACHE_PREFIX + "-public-v" + PWA_VERSION;

const OFFLINE_URL = "/offline";
const MANIFEST_URL = "/manifest.webmanifest";

const MSG_SKIP_WAITING = "KIAN_PWA_SKIP_WAITING";
const MSG_PURGE_ALL = "KIAN_PWA_PURGE_ALL";
const MSG_GET_VERSION = "KIAN_PWA_GET_VERSION";

const OFFLINE_NOTICE = "أنت غير متصل — بعض البيانات قديمة والعمليات الحساسة غير متاحة";

// ─── DENY lists ─────────────────────────────────────────────────────────────
const NEVER_CACHE_PATH_PREFIXES = [
  "/api/",
  "/client-portal",
  "/admin",
  "/secure-document",
  "/quick-access",
  "/upload-files",
  "/_next/data/",
];

const NEVER_CACHE_URL_TOKENS = [
  "/auth/v1/",
  "/rest/v1/",
  "/storage/v1/",
  "/functions/v1/",
  "/realtime/v1/",
  "access_token",
  "refresh_token",
  "id_token",
  "apikey",
  "token=",
  "signature=",
  "x-amz-",
  "expires=",
  "/object/sign/",
  "signed",
  "sig=",
  "_rsc",
];

const NEVER_CACHE_RESPONSE_HEADERS = ["set-cookie", "authorization"];

// ─── ALLOW lists ────────────────────────────────────────────────────────────
const STATIC_CACHE_ALLOWLIST = [
  "/_next/static/",
  "/clients/",
  "/logo.png",
  "/icon.png",
  "/apple-icon.png",
  "/favicon.ico",
  "/hero-poster.jpg",
  MANIFEST_URL,
  OFFLINE_URL,
];

const PUBLIC_PAGE_ALLOWLIST = ["/", "/case-studies", "/privacy-policy", "/terms"];
const PUBLIC_PAGE_PREFIXES = ["/case-studies/"];
const PRECACHE_URLS = [OFFLINE_URL, "/logo.png", MANIFEST_URL];

/* Publish the identity of the RUNNING worker on the global scope.
   A service worker is the one script you cannot re-read from the page: the file
   on the CDN may already be the next version while an older worker is still the
   one serving every request. Exposing the constants lets DevTools — and the test
   suite — interrogate what is ACTUALLY active rather than what the source text
   says, which is the whole difference when diagnosing a stale cache.
   Assignment only; no behaviour reads these back. */
globalThis.PWA_VERSION = PWA_VERSION;
globalThis.CACHE_PREFIX = CACHE_PREFIX;
globalThis.STATIC_CACHE = STATIC_CACHE;
globalThis.PUBLIC_CACHE = PUBLIC_CACHE;

// ════════════════════════════════════════════════════════════════════════════
// Decisions — every one returns an explicit boolean, never undefined.
// ════════════════════════════════════════════════════════════════════════════

function startsWithAny(path, prefixes) {
  for (let i = 0; i < prefixes.length; i++) {
    const p = prefixes[i];
    if (path === p || path.indexOf(p) === 0) return true;
  }
  return false;
}

/** Same-origin, token-free, allowlisted URL? */
function isCacheableUrl(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl, self.location.origin);
  } catch (e) {
    return false;
  }
  if (u.origin !== self.location.origin) return false;

  const full = u.href.toLowerCase();
  for (let i = 0; i < NEVER_CACHE_URL_TOKENS.length; i++) {
    if (full.indexOf(NEVER_CACHE_URL_TOKENS[i]) !== -1) return false;
  }
  if (startsWithAny(u.pathname, NEVER_CACHE_PATH_PREFIXES)) return false;
  if (startsWithAny(u.pathname, STATIC_CACHE_ALLOWLIST)) return true;
  if (PUBLIC_PAGE_ALLOWLIST.indexOf(u.pathname) !== -1) return true;
  if (startsWithAny(u.pathname, PUBLIC_PAGE_PREFIXES)) return true;
  return false;
}

/** Immutable/static asset → cache-first. */
function isStaticAsset(rawUrl) {
  if (!isCacheableUrl(rawUrl)) return false;
  let u;
  try {
    u = new URL(rawUrl, self.location.origin);
  } catch (e) {
    return false;
  }
  return startsWithAny(u.pathname, STATIC_CACHE_ALLOWLIST);
}

/** Public page → network-first with a cached fallback. */
function isPublicPage(rawUrl) {
  if (!isCacheableUrl(rawUrl)) return false;
  let u;
  try {
    u = new URL(rawUrl, self.location.origin);
  } catch (e) {
    return false;
  }
  if (PUBLIC_PAGE_ALLOWLIST.indexOf(u.pathname) !== -1) return true;
  return startsWithAny(u.pathname, PUBLIC_PAGE_PREFIXES);
}

/**
 * Request-level veto. A URL can look public and still be an authenticated
 * fetch: an Authorization header, credentialed mode, or an RSC data request.
 * Any of those and the response is treated as private, unconditionally.
 */
function requestIsPrivate(request) {
  if (request.method !== "GET") return true;
  try {
    if (request.headers.get("authorization")) return true;
    if (request.headers.get("rsc")) return true;
    if (request.headers.get("next-router-state-tree")) return true;
    if (request.headers.get("range")) return true;
  } catch (e) {
    // Header access should not throw; if it ever does, fail CLOSED.
    return true;
  }
  // `credentials: "include"` is a deliberate opt-in on a SUB-RESOURCE fetch, so
  // there it is a genuine privacy signal. On a TOP-LEVEL NAVIGATION it is the
  // browser's unconditional default — every page load carries cookies — so
  // reading it as a signal marks EVERY navigation private. That is not a
  // conservative failure: it silently disables the offline page (the navigate
  // branch below becomes unreachable) and stops any public page from ever being
  // cached, while every test using a synthetic request still passes.
  //
  // Navigations are judged instead by the three gates that do carry meaning:
  // the URL allowlist, the Authorization/RSC header vetoes above, and the
  // response gates (Set-Cookie, Cache-Control private/no-store, Vary).
  if (request.mode !== "navigate" && request.credentials === "include") return true;

  if (request.cache === "no-store") return true;
  return false;
}

/** Response-level veto — the last gate before anything is written to disk. */
function responseIsCacheable(response) {
  if (!response) return false;
  // `basic` = same-origin and fully readable. opaque / opaqueredirect / cors
  // responses are either unreadable or off-origin; neither is stored.
  if (response.type !== "basic") return false;
  if (response.status !== 200) return false;
  let cc = "";
  try {
    cc = (response.headers.get("cache-control") || "").toLowerCase();
    for (let i = 0; i < NEVER_CACHE_RESPONSE_HEADERS.length; i++) {
      if (response.headers.get(NEVER_CACHE_RESPONSE_HEADERS[i])) return false;
    }
    const vary = (response.headers.get("vary") || "").toLowerCase();
    if (vary.indexOf("authorization") !== -1 || vary === "*") return false;
  } catch (e) {
    return false;
  }
  if (cc.indexOf("no-store") !== -1) return false;
  if (cc.indexOf("private") !== -1) return false;
  return true;
}

// ════════════════════════════════════════════════════════════════════════════
// Cache lifecycle
// ════════════════════════════════════════════════════════════════════════════

/** Delete EVERY cache this app owns. Used on activate-drift, logout and user switch. */
async function purgeAllAppCaches() {
  const names = await caches.keys();
  const mine = names.filter(function (n) {
    return n.indexOf(CACHE_PREFIX) === 0;
  });
  await Promise.all(mine.map(function (n) { return caches.delete(n); }));
  return mine;
}

/** Delete only caches from a PREVIOUS version — normal invalidation on activate. */
async function dropStaleVersions() {
  const names = await caches.keys();
  const stale = names.filter(function (n) {
    return n.indexOf(CACHE_PREFIX) === 0 && n !== STATIC_CACHE && n !== PUBLIC_CACHE;
  });
  await Promise.all(stale.map(function (n) { return caches.delete(n); }));
  return stale;
}

self.addEventListener("install", function (event) {
  event.waitUntil(
    (async function () {
      const cache = await caches.open(STATIC_CACHE);
      // One missing asset must not abort the whole install — an aborted install
      // means no offline page at all, which is worse than a partial precache.
      for (let i = 0; i < PRECACHE_URLS.length; i++) {
        try {
          await cache.add(new Request(PRECACHE_URLS[i], { cache: "reload" }));
        } catch (e) {
          /* asset unavailable at install time; runtime caching will retry */
        }
      }
    })()
  );
  // NO self.skipWaiting() here. The new worker waits until the USER accepts the
  // update, so a running session is never swapped out from under an open form.
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    (async function () {
      await dropStaleVersions();
      await self.clients.claim();
    })()
  );
});

// ════════════════════════════════════════════════════════════════════════════
// Fetch
// ════════════════════════════════════════════════════════════════════════════

self.addEventListener("fetch", function (event) {
  const request = event.request;

  // ── OFFLINE IS READ-ONLY ──────────────────────────────────────────────────
  // Non-GET is not intercepted AT ALL: no queue, no Background Sync, no replay.
  // An offline POST/PATCH/DELETE fails immediately and the app classifies it as
  // "offline". A silent background replay could re-fire an approval, a custody
  // issue or a payment hours later, against state that has since changed.
  if (request.method !== "GET") return;

  const isNavigation = request.mode === "navigate";

  if (requestIsPrivate(request)) {
    // Never read from a cache, never written to one. A NAVIGATION still gets
    // the offline fallback rather than the browser's error screen: the fallback
    // is a static page holding no data, so serving it for /client-portal/finance
    // reveals nothing about the account that asked for it.
    if (isNavigation) event.respondWith(networkOnlyWithOfflineFallback(request));
    return;
  }

  const url = request.url;

  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  if (isPublicPage(url)) {
    event.respondWith(networkFirst(request, PUBLIC_CACHE));
    return;
  }

  // Everything else — including every portal and admin navigation — is
  // network-only. It is never read from a cache and never written to one.
  if (isNavigation) {
    event.respondWith(networkOnlyWithOfflineFallback(request));
    return;
  }

  // Not a navigation and not allowlisted: leave the browser to it.
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request, { ignoreSearch: false });
  if (hit) return hit;
  try {
    const res = await fetch(request);
    if (responseIsCacheable(res) && isCacheableUrl(request.url)) {
      cache.put(request, res.clone()).catch(function () {});
    }
    return res;
  } catch (e) {
    const fallback = await cache.match(request, { ignoreSearch: true });
    if (fallback) return fallback;
    if (request.mode === "navigate") return offlineResponse();
    throw e;
  }
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (responseIsCacheable(res) && isCacheableUrl(request.url)) {
      cache.put(request, res.clone()).catch(function () {});
    }
    return res;
  } catch (e) {
    const hit = await cache.match(request, { ignoreSearch: true });
    if (hit) return hit;
    if (request.mode === "navigate") return offlineResponse();
    throw e;
  }
}

async function networkOnlyWithOfflineFallback(request) {
  try {
    return await fetch(request);
  } catch (e) {
    return offlineResponse();
  }
}

/** The precached offline page, or a self-contained Arabic/RTL fallback. */
async function offlineResponse() {
  const cache = await caches.open(STATIC_CACHE);
  const page = await cache.match(OFFLINE_URL, { ignoreSearch: true });
  if (page) return page;
  const html =
    '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    "<title>غير متصل — كيان</title></head>" +
    '<body style="background:#050505;color:#fff;font-family:system-ui,sans-serif;' +
    'display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;text-align:center">' +
    "<div><p style=\"font-size:16px;line-height:2\">" + OFFLINE_NOTICE + "</p>" +
    '<p style="font-size:12px;color:rgba(255,255,255,0.45)">kian-pwa-' + PWA_VERSION + "</p></div></body></html>";
  return new Response(html, {
    status: 503,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

// ════════════════════════════════════════════════════════════════════════════
// Messages — update control and cache purging
// ════════════════════════════════════════════════════════════════════════════

self.addEventListener("message", function (event) {
  const data = event.data || {};
  const type = typeof data === "string" ? data : data.type;
  const reply = function (payload) {
    if (event.ports && event.ports[0]) {
      try { event.ports[0].postMessage(payload); } catch (e) {}
    }
  };

  if (type === MSG_SKIP_WAITING) {
    // Only ever sent from an explicit user click on "update now".
    self.skipWaiting();
    reply({ ok: true });
    return;
  }

  if (type === MSG_PURGE_ALL) {
    // Logout / user switch. Deliberately a FULL purge, not a selective one:
    // proving "this entry is not private" for every entry is harder than
    // dropping the lot and re-warming from the network.
    event.waitUntil(
      purgeAllAppCaches().then(function (cleared) {
        reply({ ok: true, cleared: cleared });
      }).catch(function () {
        reply({ ok: false });
      })
    );
    return;
  }

  if (type === MSG_GET_VERSION) {
    // Reports the version ACTUALLY RUNNING, not the one the page shipped with —
    // the difference is exactly what the update indicator needs to know.
    reply({ ok: true, version: PWA_VERSION, caches: [STATIC_CACHE, PUBLIC_CACHE] });
    return;
  }
});

/* ─── DELIBERATELY ABSENT ───────────────────────────────────────────────────
   The following are NOT registered anywhere in this file. They are described
   here rather than written out verbatim: the tests assert their absence by
   scanning for the literal call, and a comment that spells the call exactly is
   indistinguishable from the call itself to a text scan — and very nearly so
   to a reader skimming at 2am.

   · a "push" listener                    → PUSH: FOUNDATION ONLY — DISABLED
   · a "pushsubscriptionchange" listener  → same
   · any subscription-manager lookup, or application server key material
   · any notification raised from the registration — V1 delivers nothing
   · a "sync" listener                    → no background write replay
   · a "periodicsync" listener            → no background write replay
   · any background-fetch API, or a local database used as a write queue

   Adding any of these is a scope change, not a tweak: it turns a read-only
   offline shell into a background actor that acts while nobody is watching —
   re-firing an approval, a custody issue or a payment against state that has
   since moved on. See docs/PWA_PUSH_CONTRACT.md and docs/PWA_V1_CONTRACT.md.
   ─────────────────────────────────────────────────────────────────────────── */
