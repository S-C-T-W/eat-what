<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { watchDebounced } from '@vueuse/core'

import type { PlaceSuggestion } from '@/types/models'
import AdvancedOriginPanel from './AdvancedOriginPanel.vue'
import { getProvider } from '@/lib/places'
import { DEMO_ORIGIN } from '@/lib/places/mockProvider'
import { useDrawStore } from '@/stores/draw'
import { useSettingsStore } from '@/stores/settings'

const { t, locale } = useI18n()
const drawStore = useDrawStore()
const settings = useSettingsStore()

const query = ref('')
const suggestions = ref<PlaceSuggestion[]>([])
const searching = ref(false)
const resolveFailed = ref(false)
let sessionToken = crypto.randomUUID()

const provider = computed(() => getProvider(settings.googleApiKey))
const isGps = computed(() => drawStore.conditions.origin.mode === 'gps')

watchDebounced(
  query,
  async (q) => {
    resolveFailed.value = false
    if (!q.trim()) {
      suggestions.value = []
      return
    }
    // Skip 1-char queries — they only return noise and burn quota
    if (q.trim().length < 2) {
      suggestions.value = []
      return
    }
    searching.value = true
    try {
      suggestions.value = await provider.value.autocomplete({
        input: q,
        sessionToken,
        biasCenter: drawStore.lastOrigin ?? DEMO_ORIGIN,
        biasRadiusMeters: 30_000,
        languageCode: locale.value,
      })
    } catch {
      suggestions.value = []
    } finally {
      searching.value = false
    }
  },
  // Long pause before firing: each keystroke burst = one request at most
  { debounce: 2000 },
)

async function pick(s: PlaceSuggestion) {
  try {
    const resolved = await provider.value.resolvePlaceLocation(s.placeId, sessionToken)
    drawStore.conditions.origin = {
      mode: 'picked',
      picked: { label: s.label || resolved.label, location: resolved.location },
    }
    query.value = ''
    suggestions.value = []
  } catch {
    resolveFailed.value = true
  } finally {
    // A session ends with the details call — start a fresh one either way.
    sessionToken = crypto.randomUUID()
  }
}

function useGps() {
  drawStore.conditions.origin = { mode: 'gps' }
}
</script>

<template>
  <div class="space-y-2">
    <div class="flex flex-wrap items-center gap-2">
      <button
        type="button"
        class="rounded-full border px-3 py-1.5 text-sm transition-all active:scale-95"
        :class="
          isGps
            ? 'border-orange-500 bg-orange-500/10 font-semibold text-orange-600 dark:text-orange-400'
            : 'border-stone-300 text-stone-600 dark:border-stone-700 dark:text-stone-300'
        "
        @click="useGps"
      >
        📍 {{ t('conditions.originGps') }}
      </button>
      <span
        v-if="!isGps && drawStore.conditions.origin.picked"
        class="inline-flex items-center gap-1 rounded-full border border-orange-500 bg-orange-500/10 px-3 py-1.5 text-sm font-semibold text-orange-600 dark:text-orange-400"
      >
        🎯 {{ drawStore.conditions.origin.picked.label }}
        <button type="button" class="ml-1" :aria-label="t('conditions.originGps')" @click="useGps">
          ✕
        </button>
      </span>
    </div>

    <input
      v-model="query"
      type="search"
      :placeholder="t('conditions.originSearchPlaceholder')"
      class="w-full rounded-xl border border-stone-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-orange-500 dark:border-stone-700"
    />
    <p v-if="searching" class="text-xs text-stone-400">…</p>
    <p v-if="resolveFailed" class="text-xs text-red-500">{{ t('draw.error') }}</p>
    <ul v-if="suggestions.length" class="overflow-hidden rounded-xl border border-stone-200 dark:border-stone-700">
      <li v-for="s in suggestions" :key="s.placeId">
        <button
          type="button"
          class="w-full px-3 py-2 text-left text-sm hover:bg-orange-500/10"
          @click="pick(s)"
        >
          {{ s.label }}
        </button>
      </li>
    </ul>

    <!-- advanced shapes live behind a disclosure so the drawer stays short -->
    <AdvancedOriginPanel />
  </div>
</template>
