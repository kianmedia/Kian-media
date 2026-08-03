"use client";
import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";

export type Lang = "ar" | "en";

// ════════════════════════════════════════════════════════════════════════════
// Wave 1 · V2-1.1 — the locale now lives in the URL, for PUBLIC routes only.
//
// ★ WHAT CHANGED AND WHY ★
// The language used to be client state persisted in localStorage. That is
// invisible to a crawler: /quote-request served identical HTML whether the
// visitor wanted Arabic or English, so the English copy — which already existed
// in every component via t({ ar, en }) — could never be indexed, linked or
// shared. One URL cannot rank in two languages.
//
// Arabic stays the default and keeps its clean paths (/, /terms). English is a
// mirror under /en (/en, /en/terms). The locale is DERIVED from the pathname, so
// a page never has to be told which language it is in.
//
// ★ WHAT DELIBERATELY DID NOT MOVE ★
// /api, /client-portal and /admin are NOT localised and NOT relocated. v2.0 §1
// calls the portal "fragile cargo, additive changes only", and moving ~100 route
// directories under a [locale] segment to add a marketing feature is not
// additive. Those paths keep the stored-preference behaviour unchanged.
//
// ★ KNOWN LIMITATION — stated, not hidden ★
// Next allows one root <html>, and app/layout.tsx renders lang="ar" dir="rtl".
// Fixing that per-locale on the SERVER needs either multiple root layouts (which
// forces every route, portal included, into a route group) or headers() in the
// root layout (which opts the whole site out of static rendering). Both were
// rejected as disproportionate to the gain.
//
// So on /en the FIRST HTML still carries lang="ar" dir="rtl", corrected before
// paint by the inline script in app/en/layout.tsx and by the effect below. A
// JS-less crawler sees English content tagged Arabic. hreflang, canonicals and
// the visible copy are correct; that one attribute is not. Recorded as a
// deviation in the Wave 1 report — it is the part of i18n that is NOT complete.
// ════════════════════════════════════════════════════════════════════════════

/** Prefix of the English mirror. Arabic is unprefixed. */
export const EN_PREFIX = "/en";

/** Is this pathname inside the English mirror? */
export function isEnglishPath(pathname: string | null | undefined): boolean {
  const p = pathname ?? "";
  return p === EN_PREFIX || p.startsWith(`${EN_PREFIX}/`);
}

/** Strip the locale prefix: "/en/terms" → "/terms", "/en" → "/". */
export function stripLocale(pathname: string): string {
  if (!isEnglishPath(pathname)) return pathname;
  const rest = pathname.slice(EN_PREFIX.length);
  return rest === "" ? "/" : rest;
}

/** Add the locale prefix: ("/terms","en") → "/en/terms". Arabic is unchanged. */
export function withLocale(pathname: string, lang: Lang): string {
  const bare = stripLocale(pathname);
  if (lang === "ar") return bare;
  return bare === "/" ? EN_PREFIX : `${EN_PREFIX}${bare}`;
}

/**
 * Routes that are NOT part of the public bilingual site. There the language stays
 * a stored preference — no URL segment, no redirect, no behaviour change.
 */
const NON_LOCALISED = ["/client-portal", "/admin", "/api"];
const isNonLocalised = (p: string) => NON_LOCALISED.some((r) => p === r || p.startsWith(`${r}/`));

type Ctx = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (s: { ar: string; en: string }) => string;
  isAr: boolean;
  /** true when the locale comes from the URL, so switching means navigating. */
  urlLocked: boolean;
};

const I18n = createContext<Ctx | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  // On a public route the URL is authoritative and known on the FIRST render, so
  // /en renders English immediately — no flash, no hydration mismatch.
  const urlLocked = !isNonLocalised(pathname ?? "");
  const urlLang: Lang = isEnglishPath(pathname) ? "en" : "ar";

  const [storedLang, setStoredLang] = useState<Lang>("ar");
  const [ready, setReady] = useState(false);

  const lang: Lang = urlLocked ? urlLang : storedLang;

  // The stored preference still exists — but only for the portal/admin surface.
  useEffect(() => {
    try {
      const saved = localStorage.getItem("kian-lang") as Lang | null;
      if (saved === "ar" || saved === "en") setStoredLang(saved);
    } catch { /* private mode / disabled storage must never break the page */ }
    setReady(true);
  }, []);

  // Keep <html lang|dir> in step. On /en this CORRECTS the root layout's Arabic
  // default (see the limitation above); on the portal it applies the preference.
  useEffect(() => {
    if (!ready && !urlLocked) return;
    const html = document.documentElement;
    html.lang = lang;
    html.dir = lang === "ar" ? "rtl" : "ltr";
  }, [lang, ready, urlLocked]);

  // Persist only a real user choice on a non-localised surface. Writing the
  // URL-derived locale would let one visit to /en silently flip the portal too.
  useEffect(() => {
    if (!ready || urlLocked) return;
    try { localStorage.setItem("kian-lang", storedLang); } catch { /* ignore */ }
  }, [storedLang, ready, urlLocked]);

  /**
   * On a public route, switching language is NAVIGATION — that is the point of
   * putting the locale in the URL. Elsewhere it stays local state.
   */
  const setLang = (l: Lang) => {
    if (urlLocked) {
      const target = withLocale(pathname ?? "/", l);
      if (target !== pathname) router.push(target);
      return;
    }
    setStoredLang(l);
  };

  const t = (s: { ar: string; en: string }) => s[lang];

  return (
    <I18n.Provider value={{ lang, setLang, t, isAr: lang === "ar", urlLocked }}>
      {children}
    </I18n.Provider>
  );
}

export function useI18n() {
  const c = useContext(I18n);
  if (!c) {
    // Safe fallback so accidental use outside a provider cannot crash a page.
    return {
      lang: "ar" as Lang,
      setLang: () => {},
      t: (s: { ar: string; en: string }) => s.ar,
      isAr: true,
      urlLocked: false,
    };
  }
  return c;
}
