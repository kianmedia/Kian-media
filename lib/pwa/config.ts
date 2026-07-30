// ════════════════════════════════════════════════════════════════════════════
// PWA V1 — single source of truth for the caching CONTRACT.
//
// public/sw.js is a plain static file: Next does not compile it, so it cannot
// import from here. Every constant below is therefore MIRRORED literally inside
// public/sw.js, and tests/pwa_service_worker_security.test.js fails the build if
// the two ever drift. Do not "fix" a drift by editing only one side.
//
// ★ THE RULE THIS FILE EXISTS TO ENFORCE ★
//   A service worker is a persistent, origin-wide, user-invisible proxy. A
//   cache-everything worker on an authenticated portal is a data-leak engine:
//   one cached response outlives the session, the logout and the user switch,
//   and a second employee on the same device reads the first one's screen.
//   So this app caches by ALLOWLIST only. Anything not named here is
//   network-only, forever.
// ════════════════════════════════════════════════════════════════════════════

/** Bumping this invalidates EVERY cache on the next activate. Mirror in sw.js. */
export const PWA_VERSION = "1.0.0";

/** Human-facing build identifier shown in the UI and on the offline page. */
export const PWA_BUILD_ID = `kian-pwa-${PWA_VERSION}`;

export const CACHE_PREFIX = "kian-pwa";
export const STATIC_CACHE = `${CACHE_PREFIX}-static-v${PWA_VERSION}`;
export const PUBLIC_CACHE = `${CACHE_PREFIX}-public-v${PWA_VERSION}`;

export const SW_URL = "/sw.js";
/** Root scope: the worker must see marketing pages AND the portal to be able to
 *  refuse to cache the portal. A narrower scope cannot protect what it never sees. */
export const SW_SCOPE = "/";

export const OFFLINE_URL = "/offline";
export const MANIFEST_URL = "/manifest.webmanifest";

/** The exact wording required for the offline state. Do not paraphrase. */
export const OFFLINE_NOTICE =
  "أنت غير متصل — بعض البيانات قديمة والعمليات الحساسة غير متاحة";

export const OFFLINE_NOTICE_EN =
  "You are offline — some data is stale and sensitive operations are unavailable.";

// ─── postMessage protocol (page ⇄ worker) ───────────────────────────────────
export const MSG = {
  /** Page → worker: activate the waiting worker (only ever on a user click). */
  SKIP_WAITING: "KIAN_PWA_SKIP_WAITING",
  /** Page → worker: destroy every cache this app owns (logout / user switch). */
  PURGE_ALL: "KIAN_PWA_PURGE_ALL",
  /** Page → worker: which version is actually ACTIVE (not which one shipped). */
  GET_VERSION: "KIAN_PWA_GET_VERSION",
} as const;

// ─── DENY: never cached, at any layer, under any condition ──────────────────

/**
 * Same-origin path prefixes that must never enter a cache. These are the
 * authenticated surfaces plus every API route (all user-scoped).
 */
export const NEVER_CACHE_PATH_PREFIXES: readonly string[] = [
  "/api/",
  "/client-portal",
  "/admin",
  "/secure-document",
  "/quick-access",
  "/upload-files",
  "/_next/data/",
];

/**
 * Substrings that disqualify a URL anywhere in the string (lowercased compare).
 * Covers Supabase REST/Auth/Storage/Realtime/Edge, every token-bearing query
 * string, S3/Supabase SIGNED URLs, and React Server Component payloads — an RSC
 * response is page DATA, not markup, and it is the least obvious leak of the set.
 */
export const NEVER_CACHE_URL_TOKENS: readonly string[] = [
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

/** Response headers that mark a payload as private; never cache such a response. */
export const NEVER_CACHE_RESPONSE_HEADERS: readonly string[] = [
  "set-cookie",
  "authorization",
];

// ─── ALLOW: the only things that may ever be stored ─────────────────────────

/**
 * Cache-FIRST. Immutable or effectively-immutable public static assets.
 * `/_next/static/` is content-hashed by the build, so a stale entry is
 * impossible by construction.
 */
export const STATIC_CACHE_ALLOWLIST: readonly string[] = [
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

/**
 * Network-FIRST with a cached fallback. Public, published, non-user-scoped
 * pages only — the marketing shell and PUBLISHED case studies. Everything
 * else (including every portal route) is network-only.
 */
export const PUBLIC_PAGE_ALLOWLIST: readonly string[] = [
  "/",
  "/case-studies",
  "/privacy-policy",
  "/terms",
];

/** Prefix form of the above, for `/case-studies/<slug>` detail pages. */
export const PUBLIC_PAGE_PREFIXES: readonly string[] = ["/case-studies/"];

/** Precached at install so the offline fallback exists before the first failure. */
export const PRECACHE_URLS: readonly string[] = [OFFLINE_URL, "/logo.png", MANIFEST_URL];

// ─── Shared predicate (used by the UI layer and by the tests) ───────────────

/**
 * The single decision function, mirrored in sw.js. Returns true only for URLs
 * that are provably public and safe to persist. Explicitly boolean on every
 * path — never undefined, never null.
 */
export function isCacheableUrl(rawUrl: string, origin: string): boolean {
  let u: URL;
  try {
    u = new URL(rawUrl, origin);
  } catch {
    return false;
  }
  // Cross-origin is never cached: fonts, YouTube thumbnails and Supabase all
  // live off-origin, and an opaque response cannot be inspected or trusted.
  if (u.origin !== origin) return false;

  const full = u.href.toLowerCase();
  for (const tok of NEVER_CACHE_URL_TOKENS) {
    if (full.includes(tok)) return false;
  }
  const path = u.pathname;
  for (const pre of NEVER_CACHE_PATH_PREFIXES) {
    if (path === pre || path.startsWith(pre)) return false;
  }
  for (const pre of STATIC_CACHE_ALLOWLIST) {
    if (path === pre || path.startsWith(pre)) return true;
  }
  if (PUBLIC_PAGE_ALLOWLIST.includes(path)) return true;
  for (const pre of PUBLIC_PAGE_PREFIXES) {
    if (path.startsWith(pre)) return true;
  }
  return false;
}

// ─── PUSH ───────────────────────────────────────────────────────────────────
/**
 * FOUNDATION ONLY — DISABLED.
 * No permission request, no subscription, no application-server key material,
 * no send path, and no `push` listener in the worker.
 *
 * The key material is named only in docs/PWA_PUSH_CONTRACT.md, never here and
 * never in `.env.example`: an env var advertised before the feature exists is
 * how a half-built channel gets switched on by someone filling in blanks.
 * See docs/PWA_PUSH_CONTRACT.md.
 */
export const PUSH_STATUS = "FOUNDATION ONLY — DISABLED" as const;
export const PUSH_ENABLED = false;
