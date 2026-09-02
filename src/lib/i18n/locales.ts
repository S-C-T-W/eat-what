/**
 * The four UI locales. Pure module (no vue-i18n import) so stores, workers
 * and tests can use it freely.
 *
 * `zh-HK` is spoken-style Cantonese — the app's original voice — and `zh-TW`
 * is written Taiwan Mandarin. They are NOT interchangeable, which is why
 * Chinese device tags are matched by REGION below rather than by script.
 */
export const APP_LOCALES = ['en', 'zh-HK', 'zh-TW', 'ja'] as const
export type AppLocale = (typeof APP_LOCALES)[number]

export function isAppLocale(v: unknown): v is AppLocale {
  return typeof v === 'string' && (APP_LOCALES as readonly string[]).includes(v)
}

/**
 * Best UI locale for a browser's language preference list — first tag that
 * maps to something we ship wins, so a device set to [ja, en] gets Japanese
 * and one set to [zh-Hant-HK, zh-TW] gets Cantonese.
 */
export function matchLocale(tags: readonly string[]): AppLocale {
  for (const raw of tags) {
    const tag = raw.toLowerCase()
    if (tag.startsWith('ja')) return 'ja'
    if (tag.startsWith('yue')) return 'zh-HK'
    if (tag.startsWith('zh')) {
      // zh-HK, zh-MO, zh-Hant-HK, zh-Hant-MO → Cantonese
      if (/-(hk|mo)(?:-|$)/.test(tag)) return 'zh-HK'
      // zh-TW, zh-Hant, bare zh — and Simplified users get the closest
      // written Traditional we have
      return 'zh-TW'
    }
    if (tag.startsWith('en')) return 'en'
  }
  return 'en'
}

/** BCP-47 tag for the Web Speech API. */
export function speechLang(locale: AppLocale): string {
  return { en: 'en-US', 'zh-HK': 'zh-HK', 'zh-TW': 'zh-TW', ja: 'ja-JP' }[locale]
}

/** Human-readable language name, for LLM prompt instructions. */
export function languageName(locale: string): string {
  switch (locale) {
    case 'zh-HK':
      return 'Cantonese in Traditional Chinese (香港廣東話)'
    case 'zh-TW':
      return 'Taiwanese Mandarin in Traditional Chinese (台灣繁體中文)'
    case 'ja':
      return 'Japanese (日本語)'
    default:
      return 'English'
  }
}

/** True for both Chinese locales — shared search queries, fixtures, links. */
export function isChinese(locale: string): boolean {
  return locale.startsWith('zh')
}
