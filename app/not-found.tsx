// ════════════════════════════════════════════════════════════════════════════
// V2-1.8-C — branded 404.
//
// The site had NO not-found.tsx, so a mistyped URL fell through to Next's
// unstyled default: white background, black Helvetica, no way back. On a site
// whose whole proposition is production quality, that page was the one screen a
// visitor could reach that looked like nobody owned it.
//
// A Server Component on purpose. It ships no JavaScript, has no client state and
// cannot use the i18n context (a 404 is rendered outside the page tree that
// mounts the provider), so both languages are shown side by side rather than
// guessing wrong. Links use plain <a>: the router is not guaranteed on this path.
// ════════════════════════════════════════════════════════════════════════════
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "الصفحة غير موجودة | Page Not Found | Kian Media",
  // A 404 must never be indexed — otherwise "page not found" competes in search
  // results with the real pages.
  robots: { index: false, follow: true },
};

const LINKS = [
  { href: "/", ar: "الرئيسية", en: "Home" },
  { href: "/quote-request", ar: "اطلب عرض سعر", en: "Request a quote" },
  { href: "/book-meeting", ar: "احجز موعدًا", en: "Book a meeting" },
];

export default function NotFound() {
  return (
    <main
      style={{
        minHeight: "80vh", background: "#050505", color: "#fff",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "clamp(32px, 8vw, 96px) 24px", textAlign: "center",
      }}
    >
      <div style={{ maxWidth: "640px" }}>
        <div
          className="f-display"
          style={{ fontSize: "clamp(72px, 18vw, 160px)", lineHeight: 1, color: "#E31E24", opacity: 0.9 }}
        >
          404
        </div>

        <h1 className="editorial" style={{ fontSize: "clamp(24px, 4vw, 38px)", marginTop: "8px" }}>
          الصفحة غير موجودة
        </h1>
        <p style={{ color: "rgba(255,255,255,0.6)", fontSize: "15px", lineHeight: 1.9, marginTop: "14px" }}>
          الرابط الذي فتحته غير صحيح أو أن الصفحة نُقلت.
        </p>

        <hr style={{ border: 0, borderTop: "1px solid rgba(255,255,255,0.1)", margin: "28px 0" }} />

        <h2 style={{ fontSize: "clamp(18px, 3vw, 24px)", fontWeight: 500 }} dir="ltr">
          Page not found
        </h2>
        <p dir="ltr" style={{ color: "rgba(255,255,255,0.6)", fontSize: "15px", lineHeight: 1.8, marginTop: "10px" }}>
          The link you opened is incorrect, or the page has moved.
        </p>

        <nav
          aria-label="روابط مفيدة / Useful links"
          style={{ display: "flex", flexWrap: "wrap", gap: "12px", justifyContent: "center", marginTop: "34px" }}
        >
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              style={{
                border: "1px solid rgba(255,255,255,0.18)", padding: "11px 20px", borderRadius: "3px",
                color: "rgba(255,255,255,0.9)", fontSize: "13.5px", textDecoration: "none",
              }}
            >
              {l.ar} · {l.en}
            </a>
          ))}
        </nav>
      </div>
    </main>
  );
}
