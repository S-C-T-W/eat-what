<script setup lang="ts">
/**
 * The advanced search shapes, hidden behind a ⚙️ disclosure so the drawer
 * stays short (Samson's spec): 🧭 offset/direction, 🗺️ multi-spot (≤5),
 * ↔️ A→B corridor. Active advanced mode keeps the panel open and shows a
 * summary chip on the collapsed row; "簡單模式" drops back to GPS.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import type { OriginSpot } from '@/types/models'
import RangeSlider from '@/components/ui/RangeSlider.vue'
import OriginMapPreview from './OriginMapPreview.vue'
import PlaceSearchField from './PlaceSearchField.vue'
import { useDrawStore } from '@/stores/draw'

const { t } = useI18n()
const drawStore = useDrawStore()

const origin = computed(() => drawStore.conditions.origin)
const advancedActive = computed(() =>
  ['offset', 'multi', 'corridor'].includes(origin.value.mode),
)

const expanded = ref(false)
const open = computed(() => expanded.value || advancedActive.value)

// ── mode entry (each seeds a sane default config) ──
function enterOffset() {
  drawStore.conditions.origin = {
    mode: 'offset',
    offset: origin.value.offset ?? { bearing: 90, meters: 300, sector: 0 },
  }
}
function enterMulti() {
  drawStore.conditions.origin = { mode: 'multi', spots: origin.value.spots ?? [null] }
}
function enterCorridor() {
  drawStore.conditions.origin = {
    mode: 'corridor',
    corridor: origin.value.corridor ?? { a: null, b: null, widthMeters: 500 },
  }
}
function exitAdvanced() {
  drawStore.conditions.origin = { mode: 'gps' }
  expanded.value = false
}

// ── offset controls ──
const offsetBase = computed(() => origin.value.offset?.base ?? null)
function setOffsetBase(base: OriginSpot | null) {
  drawStore.conditions.origin = { mode: 'offset', offset: { ...offset.value, base } }
}
const DIRECTIONS: { bearing: number; arrow: string; key: string }[] = [
  { bearing: 315, arrow: '↖', key: 'nw' },
  { bearing: 0, arrow: '↑', key: 'n' },
  { bearing: 45, arrow: '↗', key: 'ne' },
  { bearing: 270, arrow: '←', key: 'w' },
  { bearing: -1, arrow: '📍', key: 'here' },
  { bearing: 90, arrow: '→', key: 'e' },
  { bearing: 225, arrow: '↙', key: 'sw' },
  { bearing: 180, arrow: '↓', key: 's' },
  { bearing: 135, arrow: '↘', key: 'se' },
]
const offset = computed(() => origin.value.offset ?? { bearing: 90, meters: 300, sector: 0 as const })
function setBearing(bearing: number) {
  if (bearing < 0) return
  drawStore.conditions.origin = { mode: 'offset', offset: { ...offset.value, bearing } }
}
function setMeters(meters: number) {
  drawStore.conditions.origin = { mode: 'offset', offset: { ...offset.value, meters } }
}
function setSector(sector: 0 | 90 | 180) {
  drawStore.conditions.origin = { mode: 'offset', offset: { ...offset.value, sector } }
}
const directionKey = computed(
  () => DIRECTIONS.find((d) => d.bearing === offset.value.bearing)?.key ?? 'e',
)

// ── multi-spot controls ──
const spots = computed(() => origin.value.spots ?? [])
const hasGpsSpot = computed(() => spots.value.some((s) => s === null))
function setSpots(next: (OriginSpot | null)[]) {
  drawStore.conditions.origin = { mode: 'multi', spots: next.slice(0, 5) }
}
function addGpsSpot() {
  if (spots.value.length >= 5 || hasGpsSpot.value) return
  setSpots([...spots.value, null])
}
function addSpot(spot: OriginSpot) {
  if (spots.value.length >= 5) return
  setSpots([...spots.value, spot])
}
function removeSpot(index: number) {
  setSpots(spots.value.filter((_, i) => i !== index))
}

// ── corridor controls ──
const corridor = computed(
  () => origin.value.corridor ?? { a: null, b: null, widthMeters: 500 },
)
function setCorridor(patch: Partial<typeof corridor.value>) {
  drawStore.conditions.origin = { mode: 'corridor', corridor: { ...corridor.value, ...patch } }
}
const pickingEnd = ref<'a' | 'b'>('a')
function corridorPicked(spot: OriginSpot) {
  setCorridor(pickingEnd.value === 'a' ? { a: spot } : { b: spot })
  pickingEnd.value = pickingEnd.value === 'a' ? 'b' : 'a'
}

const summary = computed(() => {
  const o = origin.value
  if (o.mode === 'offset' && o.offset) {
    const dir = t(`conditions.adv.dir.${directionKey.value}`)
    return o.offset.sector !== 0
      ? `📐 ${dir} ${o.offset.sector}°`
      : `🧭 ${dir} ${o.offset.meters}m`
  }
  if (o.mode === 'multi') return `🗺️ ${t('conditions.adv.spotCount', { n: spots.value.length })}`
  if (o.mode === 'corridor') return `↔️ ${corridor.value.widthMeters}m`
  return ''
})

function label(meters: number): string {
  return meters < 1000 ? `${meters} m` : `${meters / 1000} km`
}

const modeChip = (active: boolean) =>
  active
    ? 'border-orange-500 bg-orange-500/10 font-semibold text-orange-600 dark:text-orange-400'
    : 'border-stone-300 text-stone-600 dark:border-stone-700 dark:text-stone-300'
</script>

<template>
  <div class="mt-3">
    <!-- disclosure row -->
    <button
      type="button"
      class="flex w-full items-center justify-between rounded-xl border border-stone-200 px-3 py-2 text-sm dark:border-stone-800"
      @click="advancedActive ? undefined : (expanded = !expanded)"
    >
      <span class="font-semibold text-stone-600 dark:text-stone-300">
        ⚙️ {{ t('conditions.adv.title') }}
      </span>
      <span v-if="advancedActive" class="rounded-full bg-orange-500/10 px-2.5 py-0.5 text-xs font-bold text-orange-600 dark:text-orange-400">
        {{ summary }}
      </span>
      <span v-else class="text-stone-400 transition-transform" :class="expanded ? 'rotate-90' : ''" aria-hidden="true">›</span>
    </button>

    <div v-if="open" class="mt-2 space-y-3 rounded-2xl border border-stone-200 p-3 dark:border-stone-800">
      <!-- live projection of the search area (OSM + overlay) -->
      <OriginMapPreview />

      <!-- mode chips -->
      <div class="flex flex-wrap gap-2">
        <button type="button" class="rounded-full border px-3 py-1.5 text-sm transition-all active:scale-95" :class="modeChip(origin.mode === 'offset')" @click="enterOffset">
          🧭 {{ t('conditions.adv.offset') }}
        </button>
        <button type="button" class="rounded-full border px-3 py-1.5 text-sm transition-all active:scale-95" :class="modeChip(origin.mode === 'multi')" @click="enterMulti">
          🗺️ {{ t('conditions.adv.multi') }}
        </button>
        <button type="button" class="rounded-full border px-3 py-1.5 text-sm transition-all active:scale-95" :class="modeChip(origin.mode === 'corridor')" @click="enterCorridor">
          ↔️ {{ t('conditions.adv.corridor') }}
        </button>
        <button
          v-if="advancedActive"
          type="button"
          class="rounded-full border border-stone-300 px-3 py-1.5 text-sm text-stone-500 active:scale-95 dark:border-stone-700 dark:text-stone-400"
          @click="exitAdvanced"
        >
          ✕ {{ t('conditions.adv.simple') }}
        </button>
      </div>

      <!-- offset / direction -->
      <template v-if="origin.mode === 'offset'">
        <!-- base: current location, or any searched spot -->
        <div class="flex items-center gap-2 rounded-xl border border-stone-200 px-3 py-1.5 text-sm dark:border-stone-800">
          <span class="min-w-0 flex-1 truncate">
            {{ offsetBase ? `🎯 ${offsetBase.label}` : `📍 ${t('conditions.originGps')}` }}
          </span>
          <button
            v-if="offsetBase"
            type="button"
            class="shrink-0 text-stone-400"
            :aria-label="t('conditions.originGps')"
            @click="setOffsetBase(null)"
          >
            ✕
          </button>
        </div>
        <PlaceSearchField :placeholder="t('conditions.adv.basePlaceholder')" @picked="setOffsetBase" />
        <div class="flex items-start gap-4">
          <div class="grid w-28 shrink-0 grid-cols-3 gap-1">
            <button
              v-for="d in DIRECTIONS"
              :key="d.key"
              type="button"
              class="flex h-8 items-center justify-center rounded-lg border text-sm transition-all active:scale-95"
              :class="
                d.bearing < 0
                  ? 'cursor-default border-transparent'
                  : d.bearing === offset.bearing
                    ? 'border-orange-500 bg-orange-500/10 font-bold text-orange-600 dark:text-orange-400'
                    : 'border-stone-200 text-stone-500 dark:border-stone-800 dark:text-stone-400'
              "
              :aria-label="d.bearing < 0 ? undefined : t(`conditions.adv.dir.${d.key}`)"
              @click="setBearing(d.bearing)"
            >
              {{ d.arrow }}
            </button>
          </div>
          <div class="min-w-0 flex-1 space-y-2">
            <p class="text-xs text-stone-500 dark:text-stone-400">
              {{ offset.sector === 0 ? t('conditions.adv.offsetHint', { dir: t(`conditions.adv.dir.${directionKey}`), m: offset.meters }) : t('conditions.adv.sectorHint', { dir: t(`conditions.adv.dir.${directionKey}`), deg: offset.sector }) }}
            </p>
            <template v-if="offset.sector === 0">
              <RangeSlider :min="100" :max="2000" :step="100" :hi="offset.meters" :aria-label="t('conditions.adv.offset')" @update:hi="setMeters($event)" />
              <p class="text-right text-xs font-bold text-orange-600 dark:text-orange-400">{{ label(offset.meters) }}</p>
            </template>
            <div class="flex gap-1.5">
              <button
                v-for="s in ([0, 180, 90] as const)"
                :key="s"
                type="button"
                class="rounded-full border px-2.5 py-1 text-xs transition-all"
                :class="offset.sector === s ? 'border-orange-500 bg-orange-500/10 font-semibold text-orange-600 dark:text-orange-400' : 'border-stone-300 text-stone-500 dark:border-stone-700 dark:text-stone-400'"
                @click="setSector(s)"
              >
                {{ s === 0 ? t('conditions.adv.fullCircle') : `${s}°` }}
              </button>
            </div>
          </div>
        </div>
      </template>

      <!-- multi-spot -->
      <template v-if="origin.mode === 'multi'">
        <ul v-if="spots.length" class="space-y-1.5">
          <li
            v-for="(s, i) in spots"
            :key="i"
            class="flex items-center gap-2 rounded-xl border border-stone-200 px-3 py-1.5 text-sm dark:border-stone-800"
          >
            <span class="min-w-0 flex-1 truncate">
              {{ s ? `🎯 ${s.label}` : `📍 ${t('conditions.originGps')}` }}
            </span>
            <button type="button" class="shrink-0 text-stone-400" :aria-label="t('history.delete')" @click="removeSpot(i)">✕</button>
          </li>
        </ul>
        <div v-if="spots.length < 5" class="space-y-2">
          <button
            v-if="!hasGpsSpot"
            type="button"
            class="rounded-full border border-stone-300 px-3 py-1.5 text-sm text-stone-600 active:scale-95 dark:border-stone-700 dark:text-stone-300"
            @click="addGpsSpot"
          >
            ＋📍 {{ t('conditions.originGps') }}
          </button>
          <PlaceSearchField :placeholder="t('conditions.adv.addSpotPlaceholder')" @picked="addSpot" />
        </div>
        <p class="text-xs text-stone-400 dark:text-stone-500">{{ t('conditions.adv.multiHint') }}</p>
      </template>

      <!-- corridor -->
      <template v-if="origin.mode === 'corridor'">
        <div class="space-y-1.5">
          <div
            v-for="end in (['a', 'b'] as const)"
            :key="end"
            class="flex items-center gap-2 rounded-xl border px-3 py-1.5 text-sm"
            :class="pickingEnd === end ? 'border-orange-400' : 'border-stone-200 dark:border-stone-800'"
          >
            <span class="shrink-0 font-bold">{{ end.toUpperCase() }}</span>
            <span class="min-w-0 flex-1 truncate">
              {{ corridor[end] ? `🎯 ${corridor[end]!.label}` : `📍 ${t('conditions.originGps')}` }}
            </span>
            <button
              type="button"
              class="shrink-0 text-xs text-stone-400 underline"
              @click="pickingEnd = end"
            >
              {{ t('manual.change') }}
            </button>
            <button
              v-if="corridor[end]"
              type="button"
              class="shrink-0 text-stone-400"
              :aria-label="t('conditions.originGps')"
              @click="setCorridor(end === 'a' ? { a: null } : { b: null })"
            >
              ✕
            </button>
          </div>
        </div>
        <PlaceSearchField
          :placeholder="t('conditions.adv.corridorPickPlaceholder', { end: pickingEnd.toUpperCase() })"
          @picked="corridorPicked"
        />
        <div>
          <div class="mb-1 flex items-center justify-between">
            <span class="text-xs text-stone-400 dark:text-stone-500">{{ t('conditions.adv.width') }}</span>
            <span class="rounded-full bg-orange-500/10 px-2.5 py-0.5 text-xs font-bold text-orange-600 dark:text-orange-400">
              ↔️ {{ label(corridor.widthMeters) }}
            </span>
          </div>
          <RangeSlider :min="100" :max="2000" :step="100" :hi="corridor.widthMeters" :aria-label="t('conditions.adv.width')" @update:hi="setCorridor({ widthMeters: $event })" />
        </div>
        <p class="text-xs text-stone-400 dark:text-stone-500">{{ t('conditions.adv.corridorHint') }}</p>
      </template>
    </div>
  </div>
</template>
