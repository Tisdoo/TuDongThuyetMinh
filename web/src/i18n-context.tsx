import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { normalizeLang, translate, type I18nKey } from './lib/i18n';
import { getItem, KEYS, setItem } from './lib/storage';

interface I18nCtx {
  lang: string;
  setLang: (code: string) => void;
  t: (key: I18nKey, vars?: Record<string, string | number>) => string;
}
const Ctx = createContext<I18nCtx | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState(() => getItem(KEYS.lang) ?? normalizeLang(navigator.language));
  const setLang = useCallback((code: string) => {
    setItem(KEYS.lang, code);
    setLangState(code);
    document.documentElement.lang = code;
  }, []);
  const t = useCallback((key: I18nKey, vars?: Record<string, string | number>) => translate(lang, key, vars), [lang]);
  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18nCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useI18n must be used inside I18nProvider');
  return v;
}
