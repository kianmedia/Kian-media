// ════════════════════════════════════════════════════════════════════════════
// tests/pwa_helpers.js — load the REAL service worker and exercise its real
// decision functions.
//
// Why a VM sandbox instead of asserting on the source text: a regex can only
// prove a deny-list is *written down*. It cannot prove the worker actually
// refuses a signed Supabase URL. public/sw.js is plain JavaScript with no
// imports, so it can be executed against a stubbed `self` and its predicates
// called directly — which is the difference between testing the comment and
// testing the code.
// ════════════════════════════════════════════════════════════════════════════
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const ORIGIN = "https://kianmedia.com";

/** Load public/sw.js into a sandbox. Returns its predicates + captured listeners. */
function loadServiceWorker() {
  const source = R("public/sw.js");
  const listeners = Object.create(null);
  // `_put` records every write. "Nothing private is cached" is only worth
  // asserting if a test can see what was actually written to disk.
  const cacheStub = {
    _put: [],
    match: async () => null,
    add: async () => undefined,
    put: async (req) => { cacheStub._put.push(req && req.url ? req.url : String(req)); },
    keys: async () => [],
  };

  const selfStub = {
    location: { origin: ORIGIN, href: `${ORIGIN}/sw.js` },
    addEventListener(type, fn) {
      (listeners[type] || (listeners[type] = [])).push(fn);
    },
    skipWaiting() { selfStub._skipWaitingCalls++; },
    clients: { claim: async () => undefined },
    registration: {},
    _skipWaitingCalls: 0,
  };

  const sandbox = {
    self: selfStub,
    caches: {
      _deleted: [],
      keys: async () => ["kian-pwa-static-v0.9.0", "kian-pwa-public-v1.0.0", "other-app-cache"],
      open: async () => cacheStub,
      delete: async (n) => { sandbox.caches._deleted.push(n); return true; },
      match: async () => null,
    },
    fetch: async () => { throw new Error("network disabled in tests"); },
    URL,
    Response: class { constructor(b, i) { this.body = b; this.init = i; } },
    Request: class { constructor(u, i) { this.url = u; this.init = i; } },
    MessageChannel: class {},
    console,
  };
  sandbox.globalThis = sandbox;

  const ctx = vm.createContext(sandbox);
  vm.runInContext(source, ctx, { filename: "public/sw.js" });

  return { source, ctx, sandbox, self: selfStub, listeners, cacheStub };
}

/**
 * A REALISTIC top-level navigation.
 *
 * Browsers create navigation requests with credentials mode "include"
 * unconditionally — cookies accompany every page load. Building navigations with
 * fakeRequest()'s "same-origin" default is precisely what let a real bug hide:
 * the worker treated every navigation as private, so it never responded to one,
 * and the offline page could not appear in any real browser — while every
 * synthetic test stayed green.
 */
function fakeNavigation(url, opts = {}) {
  return fakeRequest(url, Object.assign({ mode: "navigate", credentials: "include" }, opts));
}

/**
 * Read a top-level `const` out of the loaded worker.
 * V8 keeps script-level const/let in the context's global LEXICAL scope, not on
 * globalThis — so `ctx.PWA_VERSION` is undefined while evaluating the name in
 * the same context returns it. (Function declarations do land on globalThis,
 * which is why ctx.isCacheableUrl works directly.)
 */
function swConst(ctx, name) {
  return vm.runInContext(name, ctx);
}

/** Minimal Request-alike for requestIsPrivate() / the fetch listener. */
function fakeRequest(url, opts = {}) {
  const headers = new Map(
    Object.entries(opts.headers || {}).map(([k, v]) => [k.toLowerCase(), v])
  );
  return {
    url,
    method: opts.method || "GET",
    mode: opts.mode || "cors",
    credentials: opts.credentials || "same-origin",
    cache: opts.cache || "default",
    headers: { get: (k) => (headers.has(String(k).toLowerCase()) ? headers.get(String(k).toLowerCase()) : null) },
  };
}

/** Minimal Response-alike for responseIsCacheable(). */
function fakeResponse(opts = {}) {
  const headers = new Map(
    Object.entries(opts.headers || {}).map(([k, v]) => [k.toLowerCase(), v])
  );
  const res = {
    type: opts.type || "basic",
    status: opts.status === undefined ? 200 : opts.status,
    headers: { get: (k) => (headers.has(String(k).toLowerCase()) ? headers.get(String(k).toLowerCase()) : null) },
    clone: () => res,
  };
  return res;
}

/** Pull an exported string constant out of a TS source file. */
function tsConst(source, name) {
  const m = source.match(new RegExp(`export const ${name}\\s*=\\s*"([^"]*)"`));
  return m ? m[1] : null;
}

/**
 * Pull an exported readonly string[] out of a TS source file.
 *
 * Anchor on the `=`, not on the declaration: `export const X: readonly string[] = [...]`
 * puts an EMPTY `[]` in the type annotation before the real initialiser. Scanning
 * for the first `[` after the name therefore matched the annotation and returned
 * an empty list — which reads as "declared but empty" and quietly turns the
 * drift check between config.ts and sw.js into a no-op.
 */
function tsStringArray(source, name) {
  const start = source.indexOf(`export const ${name}`);
  if (start === -1) return null;
  const eq = source.indexOf("=", start);
  if (eq === -1) return null;
  const open = source.indexOf("[", eq);
  const close = source.indexOf("]", open);
  if (open === -1 || close === -1) return null;
  return source
    .slice(open + 1, close)
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.startsWith('"') || s.startsWith("'"))
    .map((s) => s.slice(1, -1));
}

module.exports = {
  ROOT, R, ORIGIN, loadServiceWorker, swConst, fakeRequest, fakeNavigation, fakeResponse,
  tsConst, tsStringArray,
};
