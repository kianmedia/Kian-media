// ════════════════════════════════════════════════════════════════════════════
// /en — the English mirror of the public site.
//
// Wave 1 · V2-1.1-A/B/C/E
//
// Every page under here RE-EXPORTS its Arabic counterpart. There is exactly one
// implementation of each page; only the URL differs, and lib/i18n.tsx derives the
// locale from that URL. So English is a routing concern, not a second codebase —
// no copy is duplicated and no page can drift between languages.
//
// ⚠️ The inline script below is deliberate and must run BEFORE paint. Next allows
// a single root <html>, and app/layout.tsx renders lang="ar" dir="rtl". Waiting
// for React to hydrate would show a right-to-left English page for a frame. This
// corrects the attributes while the document is still parsing.
// It touches only documentElement — no data, no storage, no network.
// ════════════════════════════════════════════════════════════════════════════
export default function EnLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{
          __html:
            "document.documentElement.lang='en';document.documentElement.dir='ltr';",
        }}
      />
      {children}
    </>
  );
}
