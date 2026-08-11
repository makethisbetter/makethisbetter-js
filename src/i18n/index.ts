import en from './en'
import zhCN from './zh-CN'
import ja from './ja'
import ko from './ko'
import es from './es'
import fr from './fr'
import de from './de'

export type I18nMessages = typeof en

const locales: Record<string, I18nMessages> = {
  en,
  'zh-CN': zhCN,
  ja,
  ko,
  es,
  fr,
  de,
}

export function getMessages(locale: string): I18nMessages {
  if (locales[locale]) return locales[locale]
  const lang = locale.split('-')[0]
  if (locales[lang]) return locales[lang]
  return locales['en']
}
