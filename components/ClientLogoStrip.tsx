"use client";
// ════════════════════════════════════════════════════════════════════════════
// components/ClientLogoStrip.tsx — the 62 processed client logos.
//
// Wave 2 · V2-2.2-A/B
//
// 🔴 BEHIND NEXT_PUBLIC_SHOW_CLIENT_LOGOS, DEFAULT OFF — AND THAT IS THE POINT.
// public/clients holds 62 logo PNGs, but V2-2.2-B records that usage
// confirmations do NOT exist. Publishing a client's mark without permission is
// a legal exposure, not a design decision, and it is one the brief flags as
// 🔴 legal. So the component is built and ready, and stays dark until Khaled
// confirms which logos may be shown.
//
// With the flag off, components/Clients.tsx keeps rendering the existing text
// name-cards exactly as today — nothing about the current page changes.
//
// ⚠️ Deliberately plain <img>: the same D-5 reasoning as the portfolio grid.
// Converting to next/image could not be proven safe at grid scale, so it is not
// repeated here. width/height are set so the strip reserves space (CLS), and the
// grayscale→colour transition is CSS only.
// ════════════════════════════════════════════════════════════════════════════
import { useI18n } from "@/lib/i18n";

export const clientLogosEnabled = (): boolean =>
  process.env.NEXT_PUBLIC_SHOW_CLIENT_LOGOS === "true";

/** Filenames only — the alt text is derived, never a claim about the client. */
export default function ClientLogoStrip({ logos }: { logos: string[] }) {
  const { t } = useI18n();
  if (!clientLogosEnabled() || logos.length === 0) return null;

  return (
    <section aria-labelledby="client-logos-heading" style={{ background: "#050505", padding: "80px 0" }}>
      <div className="max-w-7xl mx-auto px-6 lg:px-12">
        <h2 id="client-logos-heading" className="eyebrow mb-10 mx-auto text-center">
          {t({ ar: "جهات عملنا معها", en: "Organizations we have worked with" })}
        </h2>
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(130px,1fr))", gap: "26px", alignItems: "center" }}>
          {logos.map((file) => {
            // "alandalus-hall.png" → "Alandalus Hall". Derived from the asset
            // name, so no client name is asserted beyond the file we were given.
            const name = file.replace(/\.[a-z]+$/i, "").replace(/[-_]/g, " ")
              .replace(/\b\w/g, (m) => m.toUpperCase());
            return (
              <li key={file} style={{ display: "flex", justifyContent: "center" }}>
                {/* eslint-disable-next-line @next/next/no-img-element --
                    Deliberate, same reasoning as D-5 for the portfolio grid: a
                    next/image conversion could not be proven safe at grid scale
                    in a browser, and a blank logo wall is worse than a lint
                    warning. width/height are set, so CLS is handled anyway. */}
                <img
                  src={`/clients/${file}`}
                  alt={name}
                  width={160}
                  height={80}
                  loading="lazy"
                  decoding="async"
                  style={{
                    maxWidth: "100%", height: "auto", objectFit: "contain",
                    filter: "grayscale(1)", opacity: 0.55,
                    transition: "filter .4s ease, opacity .4s ease",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.filter = "grayscale(0)"; e.currentTarget.style.opacity = "1"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.filter = "grayscale(1)"; e.currentTarget.style.opacity = "0.55"; }}
                />
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
