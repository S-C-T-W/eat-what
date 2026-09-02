import { createI18n } from 'vue-i18n'
import messages from '@intlify/unplugin-vue-i18n/messages'

import type { AppLocale } from '@/lib/i18n/locales'

export type { AppLocale } from '@/lib/i18n/locales'
export { APP_LOCALES, matchLocale } from '@/lib/i18n/locales'

export function createAppI18n(locale: AppLocale) {
  return createI18n({
    legacy: false,
    globalInjection: true,
    locale,
    fallbackLocale: 'en',
    messages,
  })
}
