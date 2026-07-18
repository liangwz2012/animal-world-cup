"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import zh from "./dict/zh.json";
import en from "./dict/en.json";
import ja from "./dict/ja.json";
import es from "./dict/es.json";
import pt from "./dict/pt.json";
import fr from "./dict/fr.json";

const DICTS = { zh, en, ja, es, pt, fr };
export const LOCALES = [
  { id: "zh", label: "中文" },
  { id: "en", label: "EN" },
  { id: "ja", label: "日本語" },
  { id: "es", label: "ES" },
  { id: "pt", label: "PT" },
  { id: "fr", label: "FR" },
];
const STORAGE_KEY = "animalCupLocale";
const DEFAULT_LOCALE = "zh";

const LocaleContext = createContext({ locale: DEFAULT_LOCALE, setLocale: () => {}, t: (k) => k });

export function LocaleProvider({ children }) {
  // SSR-safe: render the default Chinese UI on the server, then honor an
  // explicit language switch persisted in localStorage after mount.
  const [locale, setLocaleState] = useState(DEFAULT_LOCALE);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && DICTS[saved]) setLocaleState(saved);
  }, []);

  const setLocale = useCallback((id) => {
    if (!DICTS[id]) return;
    setLocaleState(id);
    try { localStorage.setItem(STORAGE_KEY, id); } catch {}
  }, []);

  const t = useCallback(
    (key, vars) => {
      let str = DICTS[locale][key] ?? DICTS.zh[key] ?? DICTS.en[key] ?? key;
      if (vars) for (const [k, v] of Object.entries(vars)) str = str.replaceAll(`{${k}}`, v);
      return str;
    },
    [locale],
  );

  return (
    <LocaleContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  return useContext(LocaleContext);
}
