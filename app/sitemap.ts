import type { MetadataRoute } from "next";

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.kianmedia.com").replace(/\/+$/, "");

// Public, indexable marketing routes only. The portal (/client-portal), API, and
// tokenised pages are excluded (see app/robots.ts). New SEO landing pages
// (/services/*, /locations/*) should be appended here as they ship.
export default function sitemap(): MetadataRoute.Sitemap {
  const routes: { path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"] }[] = [
    { path: "/", priority: 1.0, changeFrequency: "weekly" },
    { path: "/quote-request", priority: 0.9, changeFrequency: "monthly" },
    { path: "/book-meeting", priority: 0.8, changeFrequency: "monthly" },
    { path: "/opportunities", priority: 0.7, changeFrequency: "weekly" },
    { path: "/privacy-policy", priority: 0.3, changeFrequency: "yearly" },
    { path: "/terms", priority: 0.3, changeFrequency: "yearly" },
  ];
  const lastModified = new Date("2026-06-21");
  return routes.map((r) => ({
    url: `${SITE}${r.path === "/" ? "" : r.path}`,
    lastModified,
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));
}
