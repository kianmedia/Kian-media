/** @type {import('next').NextConfig} */
const nextConfig = {
  // Phase 2: the build used to IGNORE TypeScript and ESLint errors, so a real type error
  // or lint error would ship to production silently — the deploy would go green while the
  // defect was live. Both gates are now enforced. Verified safe at the time of the change:
  // `tsc --noEmit` reports 0 errors and `eslint .` reports 0 errors (41 pre-existing
  // <img> warnings, which do not fail a build).
  eslint: { ignoreDuringBuilds: false },
  typescript: { ignoreBuildErrors: false },
  images: {
    formats: ["image/avif", "image/webp"],
    unoptimized: true,
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options",            value: "nosniff" },
          { key: "X-Frame-Options",                   value: "SAMEORIGIN" },
          { key: "X-XSS-Protection",                  value: "1; mode=block" },
          { key: "Referrer-Policy",                   value: "strict-origin-when-cross-origin" },

          // ── Wave 0 · V2-0.6-B — HSTS ────────────────────────────────────────
          // The only header from the v2.1 Wave-0 list that was genuinely absent;
          // everything else here already shipped in Phase 2.
          //
          // Vercel already serves this app over HTTPS and redirects HTTP, but that
          // redirect is one plaintext round trip on the FIRST visit — enough for an
          // attacker on a hostile network to intercept before the redirect lands.
          // HSTS removes that window for every subsequent visit.
          //
          // ⚠️ NO `preload`, deliberately. Preload submits the apex domain to a
          // browser-baked list that is slow and painful to reverse, and it would
          // cover EVERY subdomain of kianmedia.com — including any that is not on
          // HTTPS yet. `includeSubDomains` is already the aggressive part; preload
          // is a separate, irreversible decision that needs Khaled's sign-off and a
          // confirmed inventory of subdomains.
          //
          // Two years, matching the common baseline.
          { key: "Strict-Transport-Security",         value: "max-age=63072000; includeSubDomains" },

          // ── Phase 2 hardening ──────────────────────────────────────────────
          // Deny the hardware APIs this app provably does not use, so an injected script
          // or an embedded third party cannot reach them.
          //
          // ⚠️ geolocation is `(self)`, NOT `()`. An empty allowlist blocks the document's
          // OWN origin too, and HR attendance depends on the browser geolocation API:
          // lib/portal/hr.ts getPositionOnce() feeds check-in, check-out, start-task and
          // complete-task, and every caller in components/portal/hr/EmployeeHome.tsx
          // ABORTS when it fails (no degraded path). Shipping `geolocation=()` would have
          // stopped every employee from clocking in or out, with only a toast and no
          // server-side error to alert anyone. `(self)` keeps first-party access while
          // still denying every embedded third party.
          // camera/microphone verified unused (no getUserMedia / mediaDevices anywhere).
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), payment=(), usb=(), magnetometer=(), gyroscope=(), browsing-topics=(), geolocation=(self)",
          },

          // The ENFORCED half of the CSP: ONLY directives that cannot break a working
          // Next.js page. frame-ancestors is the modern, stronger form of X-Frame-Options
          // (kept above for old browsers); base-uri blocks <base> injection from rewriting
          // every relative URL on the page; form-action stops an injected form from POSTing
          // to an attacker's origin; object-src kills legacy plugin embedding.
          //
          // ⚠️ NO `default-src` here, deliberately. default-src CASCADES to script-src,
          // style-src, connect-src and img-src — so `default-src 'self'` would block Next's
          // inline bootstrap script, the inline styles this app uses throughout, and every
          // browser call to Supabase. That would white-screen the portal. Locking those down
          // needs a nonce pipeline; until then they are only MEASURED, in Report-Only below.
          {
            key: "Content-Security-Policy",
            value: [
              "frame-ancestors 'self'",
              "base-uri 'self'",
              "form-action 'self' https://script.google.com",
              "object-src 'none'",
              "upgrade-insecure-requests",
            ].join("; "),
          },

          // Report-Only: the stricter policy we would LIKE to enforce. Browsers do not block
          // anything from this header — they only log violations to the console — so it is
          // safe to ship and gives real data on what a future enforced policy must allow
          // before anyone turns it on. Nothing here can break the site.
          {
            key: "Content-Security-Policy-Report-Only",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https:",
              "font-src 'self' data:",
              "connect-src 'self' https://*.supabase.co https://script.google.com",
              "media-src 'self' blob: https:",
              "frame-ancestors 'self'",
              "base-uri 'self'",
              "object-src 'none'",
            ].join("; "),
          },
        ],
      },
      {
        // API responses must never be cached by the CDN or a shared proxy: several of
        // them are user-scoped, and a cached response is exactly how one user's data
        // reaches another. Vercel will not cache a no-store response.
        source: "/api/(.*)",
        headers: [
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate, max-age=0" },
          { key: "X-Robots-Tag",  value: "noindex, nofollow" },
        ],
      },
      {
        // The authenticated portal must never be indexed or cached by an intermediary.
        source: "/client-portal/:path*",
        headers: [
          // noindex only. An earlier version also set `Cache-Control: private, no-store`
          // here — that was a pure CDN regression with no security benefit: every page
          // under /client-portal is a client component and the SSR shell carries NO user
          // data (all user data travels over /api/*, which IS no-store above). Forcing
          // no-store turned a cached shell into an origin round-trip on every portal
          // navigation for every user, protecting a document with nothing in it.
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
      {
        // /admin is equally authenticated and equally a data-free shell — noindex it too.
        source: "/admin/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },

      // ── PWA V1 ────────────────────────────────────────────────────────────
      {
        // The service worker script must NEVER be served from a stale cache.
        // A CDN-cached sw.js is how a fixed worker fails to reach the users who
        // already have the broken one: the browser re-checks this URL on every
        // navigation, and if the answer comes from cache the fix never lands.
        //
        // Service-Worker-Allowed is belt-and-braces: /sw.js already gets root
        // scope by its own location, but the header makes the intent explicit
        // and survives the file being moved.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control",         value: "no-cache, no-store, must-revalidate, max-age=0" },
          { key: "Service-Worker-Allowed", value: "/" },
          { key: "Content-Type",          value: "application/javascript; charset=utf-8" },
          { key: "X-Robots-Tag",          value: "noindex, nofollow" },
        ],
      },
      {
        // The manifest is public and tiny; revalidate hourly so an icon or name
        // change reaches installed users without a hard refresh.
        source: "/manifest.webmanifest",
        headers: [{ key: "Cache-Control", value: "public, max-age=0, must-revalidate" }],
      },
      {
        // The offline fallback is precached by the worker; it must not also be
        // held indefinitely by the HTTP cache, or a stale copy outlives a fix.
        source: "/offline",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
          { key: "X-Robots-Tag",  value: "noindex, nofollow" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
