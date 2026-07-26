// ════════════════════════════════════════════════════════════════════════════
// The canonical public origin — ONE definition, shared by metadata, robots and
// sitemap so they can never drift apart.
//
// It was previously hardcoded in app/layout.tsx only, which meant robots.txt and
// sitemap.xml (both missing) had nothing to derive from. Reads NEXT_PUBLIC_SITE_URL
// when set so a preview deployment advertises itself correctly, and falls back to the
// production origin already used by metadataBase.
// ════════════════════════════════════════════════════════════════════════════
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://kianmedia.com")
  .trim()
  .replace(/\/+$/, "");
