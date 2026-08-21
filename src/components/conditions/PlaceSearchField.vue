<script setup lang="ts">
/**
 * Reusable place autocomplete (2 s debounce, session tokens) — emits the
 * picked spot and clears itself. Used by multi-spot rows and corridor
 * endpoints; OriginPicker keeps its own inline copy for the simple mode.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { watchDebounced } from '@vueuse/core'

import type { OriginSpot, PlaceSuggestion } from '@/types/models'
import { getProvider } from '@/lib/places'
import { DEMO_ORIGIN } from '@/lib/places/mockProvider'
import { useDrawStore } from '@/stores/draw'
import { useSettingsStore } from '@/stores/settings'

const props = defineProps<{ placeholder?: string }>()
const emit = defineEmits<{ picked: [spot: OriginSpot] }>()

const { t, locale } = useI18n()
const drawStore = useDrawStore()
const settings = useSettingsStore()

const query = ref('')
const suggestions = ref<PlaceSuggestion[]>([])
const searching = ref(false)
const failed = ref(false)
let sessionToken = crypto.randomUUID()

const provider = computed(() => getProvider(settings.googleApiKey))

watchDebounced(
  query,
  async (q) => {
    failed.value = false
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
  { debounce: 2000 },
)

async function pick(s: PlaceSuggestion) {
  try {
    const resolved = await provider.value.resolvePlaceLocation(s.placeId, sessionToken)
    emit('picked', { label: s.label || resolved.label, location: resolved.location })
    query.value = ''
    suggestions.value = []
  } catch {
    failed.value = true
  } finally {
    sessionToken = crypto.randomUUID()
  }
}
</script>

<template>
  <div class="space-y-1.5">
    <input
      v-model="query"
      type="search"
      :placeholder="props.placeholder ?? t('conditions.originSearchPlaceholder')"
      class="w-full rounded-xl border border-stone-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-orange-500 dark:border-stone-700"
    />
    <p v-if="searching" class="text-xs text-stone-400">…</p>
    <p v-if="failed" class="text-xs text-red-500">{{ t('draw.error') }}</p>
    <ul
      v-if="suggestions.length"
      class="overflow-hidden rounded-xl border border-stone-200 dark:border-stone-700"
    >
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
  </div>
</template>
