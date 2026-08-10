import React from "react";
import { defaultLanguage, languages, translations, type LanguageCode, type TranslationKey } from "./translations";

const storageKey = "obs-effect.language";

interface I18nContextValue {
  language: LanguageCode;
  setLanguage: (language: LanguageCode) => void;
  t: (key: TranslationKey) => string;
}

const I18nContext = React.createContext<I18nContextValue | null>(null);

function isLanguageCode(value: string | null): value is LanguageCode {
  return languages.some((language) => language.code === value);
}

export function I18nProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [language, setLanguageState] = React.useState<LanguageCode>(() => {
    if (typeof window === "undefined") return defaultLanguage;
    const storedLanguage = window.localStorage.getItem(storageKey);
    return isLanguageCode(storedLanguage) ? storedLanguage : defaultLanguage;
  });

  const setLanguage = React.useCallback((nextLanguage: LanguageCode): void => {
    setLanguageState(nextLanguage);
    window.localStorage.setItem(storageKey, nextLanguage);
    document.documentElement.lang = nextLanguage;
  }, []);

  React.useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const value = React.useMemo<I18nContextValue>(
    () => ({
      language,
      setLanguage,
      t: (key) => translations[language][key] ?? translations[defaultLanguage][key] ?? key
    }),
    [language, setLanguage]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const value = React.useContext(I18nContext);
  if (!value) {
    throw new Error("useI18n must be used inside I18nProvider");
  }
  return value;
}
