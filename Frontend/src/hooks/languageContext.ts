import { createContext } from 'react'
import type { Language } from '../lib/i18n'

export type LanguageContextValue = { language: Language; setLanguage: (language: Language) => void; t: (key: string, values?: Record<string, string | number>) => string }
export const LanguageContext = createContext<LanguageContextValue | null>(null)