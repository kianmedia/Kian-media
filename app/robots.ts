import type { MetadataRoute } from "next";

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.kianmedia.com").replace(/\/+$/, "");

// Crawl the marketing site; keep the private portal, API, and tokenised pages out of the index.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/client-portal", "/admin", "/api/", "/rate", "/quick-access", "/upload-files"],
      },
    ],
    sitemap: `${SITE}/sitemap.xml`,
    host: SITE,
  };
}
