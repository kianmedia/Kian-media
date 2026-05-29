"use client";
import { createContext, useContext, useEffect, useState, ReactNode } from "react";

export type Lang = "ar" | "en";

type Ctx = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (s: { ar: string; en: string }) => string;
  isAr: boolean;
};

const I18n = createContext<Ctx | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("ar");
  const [ready, setReady] = useState(false);

  // Read saved language on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem("kian-lang") as Lang | null;
      if (saved === "ar" || saved === "en") setLangState(saved);
    } catch {}
    setReady(true);
  }, []);

  // Apply dir/lang to <html> whenever it changes
  useEffect(() => {
    if (!ready) return;
    const html = document.documentElement;
    html.lang = lang;
    html.dir = lang === "ar" ? "rtl" : "ltr";
    try { localStorage.setItem("kian-lang", lang); } catch {}
  }, [lang, ready]);

  const setLang = (l: Lang) => setLangState(l);
  const t = (s: { ar: string; en: string }) => s[lang];

  return (
    <I18n.Provider value={{ lang, setLang, t, isAr: lang === "ar" }}>
      {children}
    </I18n.Provider>
  );
}

export function useI18n() {
  const c = useContext(I18n);
  if (!c) {
    // Safe fallback so any accidental use outside provider doesn't crash
    return { lang: "ar" as Lang, setLang: () => {}, t: (s: { ar: string; en: string }) => s.ar, isAr: true };
  }
  return c;
}
