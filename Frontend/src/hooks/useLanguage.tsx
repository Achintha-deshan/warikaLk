import { useEffect, useState, type ReactNode } from 'react'
import { translate, type Language } from '../lib/i18n'
import { LanguageContext } from './languageContext'

const STORAGE_KEY = 'warikalk_lang'
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(() => localStorage.getItem(STORAGE_KEY) === 'si' ? 'si' : 'en')
  useEffect(() => { localStorage.setItem(STORAGE_KEY, language) }, [language])
  return <LanguageContext.Provider value={{ language, setLanguage, t: (key, values) => translate(language, key, values) }}>{children}</LanguageContext.Provider>
}