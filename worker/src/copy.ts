import type { Meal } from './schedule'

export interface NotificationCopy {
  title: string
  body: string
}

interface LocaleCopy {
  lunch: NotificationCopy
  dinner: NotificationCopy
  test: NotificationCopy
}

/**
 * Final notification strings live here (not in the app) because the push
 * payload must be self-contained — the service worker just displays it.
 * Keep in step with the app's four locales (src/lib/i18n/locales.ts).
 */
const COPY: Record<string, LocaleCopy> = {
  en: {
    lunch: { title: 'Lunch time! 🍜', body: "Can't decide? Give the wheel a spin." },
    dinner: { title: 'Dinner time! 🍚', body: "Can't decide? Give the wheel a spin." },
    test: { title: 'EatWhat ✅', body: 'Notifications are working!' },
  },
  'zh-HK': {
    lunch: { title: '午餐時間！🍜', body: '食乜好？抽一下！' },
    dinner: { title: '晚餐時間！🍚', body: '食乜好？抽一下！' },
    test: { title: '食乜好 ✅', body: '通知設定成功！' },
  },
  'zh-TW': {
    lunch: { title: '午餐時間！🍜', body: '今天吃什麼？抽一下！' },
    dinner: { title: '晚餐時間！🍚', body: '今天吃什麼？抽一下！' },
    test: { title: '呷什麼 ✅', body: '通知設定成功！' },
  },
  ja: {
    lunch: { title: 'ランチの時間！🍜', body: 'なに食べる？ルーレットで決めよう！' },
    dinner: { title: 'ディナーの時間！🍚', body: 'なに食べる？ルーレットで決めよう！' },
    test: { title: 'なに食べる？ ✅', body: '通知の設定が完了しました！' },
  },
}

export const SUPPORTED_LOCALES: ReadonlySet<string> = new Set(Object.keys(COPY))

function copyFor(locale: string): LocaleCopy {
  return COPY[locale] ?? COPY.en!
}

export function mealCopy(meal: Meal, locale: string): NotificationCopy {
  const c = copyFor(locale)
  return meal === 'lunch' ? c.lunch : c.dinner
}

export function testCopy(locale: string): NotificationCopy {
  return copyFor(locale).test
}
