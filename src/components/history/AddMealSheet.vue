<script setup lang="ts">
/**
 * Manually log a meal that happened without a draw — the food-diary door.
 * Explicit keyword search (one Text Search per tap, never per keystroke —
 * it's an Enterprise-tier call) returns FULL restaurant snapshots, so a
 * hand-logged place gets the same diary powers as a drawn one. Saved
 * records are backdated to when the meal happened, file under that day
 * with the right meal slot, and feed streaks, "don't repeat recent days"
 * and the Favourites wheel exactly like any accepted draw.
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import type { LatLng, Restaurant } from '@/types/models'
import BottomSheet from '@/components/ui/BottomSheet.vue'
import { getProvider } from '@/lib/places'
import { GooglePlacesError } from '@/lib/places/googlePlaces'
import { DEMO_ORIGIN } from '@/lib/places/mockProvider'
import { emojiForTypes } from '@/lib/places/cuisines'
import { formatDistance, haversineMeters } from '@/lib/geo/distance'
import { makeDefaultConditions } from '@/lib/draw/defaults'
import { createHistoryRepo, mealForHour } from '@/lib/db/historyRepo'
import { getDb } from '@/lib/db/schema'
import { getCurrentLocation } from '@/composables/useOrigin'
import { useHaptics } from '@/composables/useHaptics'
import { useDrawStore } from '@/stores/draw'
import { useSettingsStore } from '@/stores/settings'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; saved: [restaurant: Restaurant] }>()

const { t, locale } = useI18n()
const haptics = useHaptics()
const drawStore = useDrawStore()
const settings = useSettingsStore()
const history = createHistoryRepo(getDb())

const MEAL_EMOJI: Record<string, string> = {
  breakfast: '🍳',
  lunch: '🥪',
  tea: '☕️',
  dinner: '🌙',
  lateNight: '🌜',
}

const query = ref('')
const searching = ref(false)
const searched = ref(false)
const results = ref<Restaurant[]>([])
const errorKey = ref<string | null>(null)
const selected = ref<Restaurant | null>(null)
const origin = ref<LatLng | null>(null)

function localIso(d: Date): { date: string; time: string } {
  const pad = (n: number) => `${n}`.padStart(2, '0')
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(Math.floor(d.getMinutes() / 15) * 15)}`,
  }
}
const nowParts = localIso(new Date())
const dateStr = ref(nowParts.date)
const timeStr = ref(nowParts.time)
const todayIso = nowParts.date

watch(
  () => props.open,
  (open) => {
    if (!open) return
    const parts = localIso(new Date())
    dateStr.value = parts.date
    timeStr.value = parts.time
    query.value = ''
    results.value = []
    searched.value = false
    selected.value = null
    errorKey.value = null
  },
)

async function resolveOrigin(): Promise<LatLng> {
  const picked = drawStore.conditions.origin
  if (picked.mode === 'picked' && picked.picked) return picked.picked.location
  if (drawStore.lastOrigin) return drawStore.lastOrigin
  if (!settings.googleApiKey) return DEMO_ORIGIN
  const fix = await getCurrentLocation()
  return fix.ok ? fix.location : DEMO_ORIGIN
}

async function search() {
  const q = query.value.trim()
  if (!q || searching.value) return
  searching.value = true
  errorKey.value = null
  selected.value = null
  try {
    origin.value = await resolveOrigin()
    results.value = await getProvider(settings.googleApiKey).searchText({
      query: q,
      origin: origin.value,
      radiusMeters: 5000,
      languageCode: locale.value as 'en' | 'zh-TW',
      maxResults: 8,
    })
    searched.value = true
  } catch (e) {
    errorKey.value =
      e instanceof GooglePlacesError && e.kind === 'quota' ? 'draw.quotaReached' : 'draw.error'
  } finally {
    searching.value = false
  }
}

function distanceLabel(r: Restaurant): string | null {
  if (!origin.value) return null
  return formatDistance(haversineMeters(origin.value, r.location), locale.value)
}

const eatenAt = computed(() => {
  const at = new Date(`${dateStr.value}T${timeStr.value || '12:00'}:00`).getTime()
  // manual logs live in the past — planning belongs to the draw
  return Number.isNaN(at) ? Date.now() : Math.min(at, Date.now())
})
const mealSlot = computed(() => mealForHour(new Date(eatenAt.value).getHours()))

const saving = ref(false)
async function save() {
  const r = selected.value
  if (!r || saving.value) return
  saving.value = true
  try {
    await history.addAccepted(r, makeDefaultConditions(), { source: 'manual', at: eatenAt.value })
    haptics.tap()
    emit('saved', r)
    emit('close')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <BottomSheet :open="open" @close="emit('close')">
    <div class="space-y-4 px-6 pt-1 pb-4">
      <div>
        <h2 class="text-lg font-bold">📔 {{ t('manual.title') }}</h2>
        <p class="mt-1 text-xs text-stone-400 dark:text-stone-500">{{ t('manual.subtitle') }}</p>
      </div>

      <!-- find the place -->
      <div class="flex gap-2">
        <input
          v-model="query"
          type="search"
          enterkeyhint="search"
          maxlength="60"
          :placeholder="t('manual.searchPlaceholder')"
          class="min-w-0 flex-1 rounded-2xl border border-stone-300 bg-transparent px-4 py-2.5 text-sm outline-none placeholder:text-stone-400 focus:border-orange-500 dark:border-stone-700"
          @keyup.enter="search"
        />
        <button
          type="button"
          class="rounded-2xl bg-orange-500 px-4 text-sm font-bold text-white active:scale-95 disabled:opacity-50"
          :disabled="!query.trim() || searching"
          @click="search"
        >
          {{ searching ? '…' : '🔍' }}
        </button>
      </div>

      <p v-if="errorKey" class="text-sm text-red-500 dark:text-red-400">{{ t(errorKey) }}</p>

      <!-- results -->
      <ul v-if="results.length && !selected" class="space-y-2">
        <li v-for="r in results" :key="r.id">
          <button
            type="button"
            class="flex w-full items-center gap-3 rounded-2xl border border-stone-200 px-3 py-2.5 text-left active:scale-[0.99] dark:border-stone-800"
            @click="selected = r"
          >
            <span class="text-2xl" aria-hidden="true">{{ emojiForTypes(r.types) }}</span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-semibold">{{ r.name }}</span>
              <span class="block truncate text-xs text-stone-400 dark:text-stone-500">
                <template v-if="r.rating">★ {{ r.rating.toFixed(1) }} · </template>
                <template v-if="distanceLabel(r)">{{ distanceLabel(r) }} · </template>
                {{ r.address }}
              </span>
            </span>
          </button>
        </li>
      </ul>
      <p
        v-else-if="searched && !results.length && !selected"
        class="text-sm text-stone-500 dark:text-stone-400"
      >
        {{ t('manual.noResults') }}
      </p>

      <!-- chosen place + when -->
      <template v-if="selected">
        <div
          class="flex items-center gap-3 rounded-2xl border border-orange-400 bg-orange-500/10 px-3 py-2.5"
        >
          <span class="text-2xl" aria-hidden="true">{{ emojiForTypes(selected.types) }}</span>
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm font-semibold">{{ selected.name }}</span>
            <span class="block truncate text-xs text-stone-400 dark:text-stone-500">
              {{ selected.address }}
            </span>
          </span>
          <button
            type="button"
            class="shrink-0 text-xs text-stone-400 underline dark:text-stone-500"
            @click="selected = null"
          >
            {{ t('manual.change') }}
          </button>
        </div>

        <div class="flex items-center justify-between gap-3">
          <span class="shrink-0 text-sm">{{ t('manual.when') }}</span>
          <div class="flex items-center gap-1.5">
            <input
              v-model="dateStr"
              type="date"
              :max="todayIso"
              class="rounded-lg border border-stone-300 bg-transparent px-2 py-1 text-sm font-semibold dark:border-stone-700"
            />
            <input
              v-model="timeStr"
              type="time"
              step="900"
              class="rounded-lg border border-stone-300 bg-transparent px-2 py-1 text-sm font-semibold dark:border-stone-700"
            />
          </div>
        </div>
        <p class="text-xs text-stone-400 dark:text-stone-500">
          {{ MEAL_EMOJI[mealSlot] }} {{ t(`history.${mealSlot}`) }} · {{ t('manual.diaryNext') }}
        </p>

        <button
          type="button"
          class="w-full rounded-2xl bg-orange-500 py-3 text-sm font-bold text-white shadow-md active:scale-95 disabled:opacity-60"
          :disabled="saving"
          @click="save"
        >
          💾 {{ t('manual.save') }}
        </button>
      </template>

      <p v-if="!selected" class="text-xs text-stone-400 dark:text-stone-500">
        {{ t('manual.quotaHint') }}
      </p>
    </div>
  </BottomSheet>
</template>
