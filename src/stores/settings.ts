import { ref } from 'vue'
import { defineStore } from 'pinia'

import type { ConditionPreset, DrawConditions, NotificationPrefs } from '@/types/models'
import { makeDefaultConditions } from '@/lib/draw/defaults'
import { type AppLocale, matchLocale } from '@/lib/i18n/locales'

export type { AppLocale }
export type ThemePref = 'light' | 'dark' | 'system'

/**
 * Locale-preference schema. v1 stored 'zh-TW' for what was really Cantonese
 * copy; v2 renamed that to 'zh-HK' and made 'zh-TW' written Taiwan Mandarin.
 */
const LOCALE_SCHEMA = 2

function detectLocale(): AppLocale {
  if (typeof navigator === 'undefined') return 'en'
  const tags = navigator.languages?.length ? navigator.languages : [navigator.language ?? 'en']
  return matchLocale(tags)
}

export const useSettingsStore = defineStore(
  'settings',
  () => {
    const locale = ref<AppLocale>(detectLocale())
    const localeSchema = ref(0)
    const theme = ref<ThemePref>('system')

    // BYO keys — stored only on this device, never shipped in the build
    const googleApiKey = ref('')
    const aiBaseUrl = ref('https://api.openai.com/v1')
    const aiApiKey = ref('')
    const aiModel = ref('')

    // Starting point for every session's draw conditions
    const defaultConditions = ref<DrawConditions>(makeDefaultConditions())

    // Named condition bundles for one-tap habits ("公司午餐", "週末探店"…)
    const presets = ref<ConditionPreset[]>([])

    // Chain-filter tuning: curated patterns the user switched off, plus
    // their own brand keywords (used when 唔要快餐/唔要連鎖店 is on)
    const chainDisabled = ref<string[]>([])
    const chainCustom = ref<string[]>([])

    // Meal notification schedule (Phase 2) — delivery lives on the push
    // worker; this is the local editing copy, synced on change
    const notifications = ref<NotificationPrefs>({
      lunch: { enabled: false, time: '12:00', days: [1, 2, 3, 4, 5] },
      dinner: { enabled: false, time: '18:00', days: [1, 2, 3, 4, 5, 6, 0] },
    })

    // Onboarding checklist state
    const setupDismissed = ref(false)
    const setupTicks = ref({ project: false, restrict: false, cap: false })
    /** Runtime-only: whether the setup checklist overlay is open */
    const setupOpen = ref(false)

    return {
      locale,
      localeSchema,
      theme,
      googleApiKey,
      aiBaseUrl,
      aiApiKey,
      aiModel,
      defaultConditions,
      presets,
      chainDisabled,
      chainCustom,
      notifications,
      setupDismissed,
      setupTicks,
      setupOpen,
    }
  },
  {
    persist: {
      pick: [
        'locale',
        'localeSchema',
        'theme',
        'googleApiKey',
        'aiBaseUrl',
        'aiApiKey',
        'aiModel',
        'defaultConditions',
        'presets',
        'chainDisabled',
        'chainCustom',
        'notifications',
        'setupDismissed',
        'setupTicks',
      ],
      afterHydrate: (ctx) => {
        const store = ctx.store as unknown as { locale: string; localeSchema: number }
        if (store.localeSchema >= LOCALE_SCHEMA) return
        // Only a PERSISTED pre-v2 'zh-TW' was Cantonese; a fresh detection that
        // lands on 'zh-TW' is a real Taiwan user and must stay.
        let legacy = false
        try {
          const raw = localStorage.getItem(ctx.store.$id)
          legacy = !!raw && !('localeSchema' in (JSON.parse(raw) as Record<string, unknown>))
        } catch {
          legacy = false
        }
        if (legacy && store.locale === 'zh-TW') store.locale = 'zh-HK'
        store.localeSchema = LOCALE_SCHEMA
        // Hydration-time writes happen before the persistence subscription
        // exists — flush explicitly so the migration runs exactly once.
        ;(ctx.store as { $persist?: () => void }).$persist?.()
      },
    },
  },
)
