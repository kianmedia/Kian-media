// ════════════════════════════════════════════════════════════════════════════
// /en — nested layout for the English mirror.
//
// Wave 1 · V2-1.1 (D-3)
//
// Every page under here RE-EXPORTS its Arabic counterpart, so there is exactly
// one implementation of each page and only the URL differs. lib/i18n.tsx derives
// the locale from that URL.
//
// ⚠️ THE INLINE lang/dir SCRIPT THAT USED TO LIVE HERE IS GONE. <html lang="en"
// dir="ltr"> is now emitted by the server from app/(en)/layout.tsx, so the very
// first byte is correct and no client-side correction is needed. Re-adding a
// script here would mask a regression in the root layout rather than fix it —
// tests/wave1_ssr_lang_dir.test.js fails if one reappears.
// ════════════════════════════════════════════════════════════════════════════
export default function EnLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
