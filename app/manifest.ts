// ════════════════════════════════════════════════════════════════════════════
// /manifest.webmanifest — the installability contract (PWA V1).
//
// Next serves this file-based manifest at /manifest.webmanifest and injects the
// <link rel="manifest"> tag itself; app/layout.tsx must NOT add a second one.
//
// ★ ICONS: REFERENCES ONLY ★
//   Every `src` below points at a file that ALREADY EXISTS in the repo. No icon
//   file was fabricated. What is genuinely missing is listed in
//   docs/PWA_V1_CONTRACT.md — dedicated 192×192 and 512×512 PNGs and a padded
//   `maskable` variant. Declaring a `maskable` purpose on the existing square
//   logo would be a lie the launcher punishes: Android crops maskable icons to
//   the inner 80% safe zone, so an unpadded logo ships visibly clipped.
//   The 800×800 logo satisfies the installability floor (an icon ≥144px), so
//   the app installs today; the missing sizes are a polish gap, not a blocker.
// ════════════════════════════════════════════════════════════════════════════
import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    // A stable `id` keeps the installed app identified across start_url changes.
    id: "/?source=pwa",

    // Arabic first (the product's primary language), English after it.
    name: "كيان الابتكار للإنتاج الفني | Kian Media Production",
    short_name: "كيان | Kian",
    description:
      "بوابة كيان الابتكار للإنتاج الفني — المشاريع والعهد والتشغيل والإشعارات. " +
      "Kian Media Production portal — projects, custody, operations and notifications.",

    lang: "ar",
    dir: "rtl",

    // Installed users are staff and clients, so the app opens on the portal.
    // Anyone not signed in lands on the portal's own login screen — never on a
    // blank or half-rendered surface.
    start_url: "/client-portal?source=pwa",

    // Root scope so marketing pages, case studies and the offline page all stay
    // inside the installed window instead of bouncing out to the browser.
    scope: "/",

    display: "standalone",
    display_override: ["standalone", "minimal-ui", "browser"],
    orientation: "any",

    // Matches the shipped chrome: <meta name="theme-color" content="#000000">
    // in app/layout.tsx and the #050505 page background in <body>.
    theme_color: "#000000",
    background_color: "#050505",

    categories: ["business", "productivity"],
    prefer_related_applications: false,

    icons: [
      // public/logo.png — 800×800 PNG, verified present.
      { src: "/logo.png", sizes: "800x800", type: "image/png", purpose: "any" },
      // app/favicon.ico — 32×32, verified present.
      { src: "/favicon.ico", sizes: "32x32", type: "image/x-icon", purpose: "any" },
    ],

    shortcuts: [
      { name: "الإشعارات", short_name: "الإشعارات", url: "/client-portal/notifications?source=pwa" },
      { name: "مشاريعي", short_name: "المشاريع", url: "/client-portal/projects?source=pwa" },
      { name: "دراسات الحالة", short_name: "دراسات", url: "/case-studies?source=pwa" },
    ],
  };
}
