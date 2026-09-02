<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AiSettings from '@/components/settings/AiSettings.vue'
import BlocklistManager from '@/components/settings/BlocklistManager.vue'
import ChainFilterSheet from '@/components/settings/ChainFilterSheet.vue'
import DataControls from '@/components/settings/DataControls.vue'
import NotificationSettings from '@/components/settings/NotificationSettings.vue'
import { validateGoogleKey } from '@/lib/places/validateKey'
import { useSettingsStore, type AppLocale, type ThemePref } from '@/stores/settings'

const { t } = useI18n()
const settings = useSettingsStore()

const themes: ThemePref[] = ['light', 'dark', 'system']
const languages: { value: AppLocale; label: string }[] = [
  { value: 'zh-HK', label: '廣東話（香港）' },
  { value: 'zh-TW', label: '繁體中文（台灣）' },
  { value: 'ja', label: '日本語' },
  { value: 'en', label: 'English' },
]

const keyDraft = ref(settings.googleApiKey)
const keyStatus = ref<'idle' | 'checking' | 'valid' | 'invalid' | 'network'>('idle')

const chainSheetOpen = ref(false)

async function saveKey() {
  const key = keyDraft.value.trim()
  if (!key) return
  keyStatus.value = 'checking'
  const result = await validateGoogleKey(key)
  if (result.ok) {
    settings.googleApiKey = key
    keyStatus.value = 'valid'
  } else {
    keyStatus.value = result.reason === 'invalid' ? 'invalid' : 'network'
  }
}

function clearKey() {
  settings.googleApiKey = ''
  keyDraft.value = ''
  keyStatus.value = 'idle'
}
</script>

<template>
  <div class="mx-auto max-w-md px-6 pt-10">
    <h1 class="mb-6 text-2xl font-bold">{{ t('settings.title') }}</h1>

    <section class="mb-8">
      <h2
        class="mb-2 text-sm font-semibold tracking-wide text-stone-500 uppercase dark:text-stone-400"
      >
        {{ t('settings.appearance') }}
      </h2>
      <div class="flex gap-2">
        <button
          v-for="opt in themes"
          :key="opt"
          class="flex-1 rounded-xl border px-3 py-2 text-sm transition-colors"
          :class="
            settings.theme === opt
              ? 'border-orange-500 bg-orange-500/10 font-semibold text-orange-600 dark:text-orange-400'
              : 'border-stone-300 text-stone-600 dark:border-stone-700 dark:text-stone-300'
          "
          @click="settings.theme = opt"
        >
          {{ t(`settings.theme.${opt}`) }}
        </button>
      </div>
    </section>

    <section class="mb-8">
      <h2
        class="mb-2 text-sm font-semibold tracking-wide text-stone-500 uppercase dark:text-stone-400"
      >
        {{ t('settings.language') }}
      </h2>
      <div class="grid grid-cols-2 gap-2">
        <button
          v-for="lang in languages"
          :key="lang.value"
          class="rounded-xl border px-3 py-2 text-sm transition-colors"
          :class="
            settings.locale === lang.value
              ? 'border-orange-500 bg-orange-500/10 font-semibold text-orange-600 dark:text-orange-400'
              : 'border-stone-300 text-stone-600 dark:border-stone-700 dark:text-stone-300'
          "
          @click="settings.locale = lang.value"
        >
          {{ lang.label }}
        </button>
      </div>
    </section>

    <section class="mb-8">
      <h2
        class="mb-2 text-sm font-semibold tracking-wide text-stone-500 uppercase dark:text-stone-400"
      >
        {{ t('settings.google.title') }}
      </h2>
      <p class="mb-2 text-xs text-stone-500 dark:text-stone-400">
        {{ settings.googleApiKey ? t('settings.google.active') : t('settings.google.inactive') }}
      </p>
      <div class="flex gap-2">
        <input
          v-model="keyDraft"
          type="text"
          autocomplete="off"
          spellcheck="false"
          :placeholder="t('setup.keyPlaceholder')"
          class="min-w-0 flex-1 rounded-xl border border-stone-300 bg-transparent px-3 py-2 font-mono text-xs outline-none focus:border-orange-500 dark:border-stone-700"
        />
        <button
          type="button"
          class="rounded-xl bg-orange-500 px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
          :disabled="keyStatus === 'checking' || !keyDraft.trim()"
          @click="saveKey"
        >
          {{ keyStatus === 'checking' ? '…' : t('setup.validate') }}
        </button>
        <button
          v-if="settings.googleApiKey"
          type="button"
          class="rounded-xl border border-stone-300 px-3 py-2 text-sm text-stone-500 dark:border-stone-700"
          @click="clearKey"
        >
          ✕
        </button>
      </div>
      <p
        v-if="keyStatus === 'valid'"
        class="mt-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400"
      >
        ✅ {{ t('setup.keyValid') }}
      </p>
      <p v-else-if="keyStatus === 'invalid'" class="mt-2 text-xs font-semibold text-red-500">
        {{ t('setup.keyInvalid') }}
      </p>
      <p v-else-if="keyStatus === 'network'" class="mt-2 text-xs font-semibold text-amber-600">
        {{ t('setup.keyNetwork') }}
      </p>
      <button
        type="button"
        class="mt-3 text-sm font-semibold text-orange-600 underline dark:text-orange-400"
        @click="settings.setupOpen = true"
      >
        🚀 {{ t('settings.google.guide') }}
      </button>
    </section>

    <NotificationSettings />

    <section class="mb-8">
      <h2
        class="mb-2 text-sm font-semibold tracking-wide text-stone-500 uppercase dark:text-stone-400"
      >
        ⛓️ {{ t('settings.chains.title') }}
      </h2>
      <p class="mb-2 text-xs text-stone-500 dark:text-stone-400">
        {{ t('settings.chains.sectionNote') }}
      </p>
      <button
        type="button"
        class="rounded-xl border border-orange-300 bg-orange-500/10 px-4 py-2.5 text-sm font-semibold text-orange-600 active:scale-95 dark:border-orange-800 dark:text-orange-400"
        @click="chainSheetOpen = true"
      >
        ✏️ {{ t('settings.chains.edit') }}
      </button>
    </section>

    <AiSettings />
    <BlocklistManager />
    <DataControls />

    <ChainFilterSheet :open="chainSheetOpen" @close="chainSheetOpen = false" />
  </div>
</template>
