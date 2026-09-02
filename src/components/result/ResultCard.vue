<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import type { AppLocale } from '@/lib/i18n/locales'

import type { LatLng, Restaurant } from '@/types/models'
import ModalShell from '@/components/ui/ModalShell.vue'
import RatingStars from '@/components/ui/RatingStars.vue'
import { createHistoryRepo } from '@/lib/db/historyRepo'
import { createPlaceNotesRepo } from '@/lib/db/placeNotesRepo'
import { getDb } from '@/lib/db/schema'
import AiBlurb from './AiBlurb.vue'
import { useShareResult } from '@/composables/useShareResult'
import { drawCardImage, shareCardImage } from '@/lib/share/cardImage'
import { cuisinesOfTypes, emojiForTypes } from '@/lib/places/cuisines'
import { formatPrice } from '@/lib/format/price'
import { formatDistance, haversineMeters } from '@/lib/geo/distance'
import { detectRegion } from '@/lib/geo/region'
import { buildGoogleMapsUrl } from '@/lib/links/gmaps'
import { buildOpenRiceUrl } from '@/lib/links/openrice'
import { buildTabelogUrl } from '@/lib/links/tabelog'
import { wheelColor } from '@/lib/draw/palette'
import { getProvider } from '@/lib/places'
import { useDraw } from '@/composables/useDraw'
import { useDrawStore } from '@/stores/draw'
import { useSettingsStore } from '@/stores/settings'

const props = defineProps<{
  /** History mode: show this restaurant read-only instead of the live winner */
  restaurant?: Restaurant | null
  open?: boolean
}>()
const emit = defineEmits<{ close: [] }>()

const { t, locale } = useI18n()
const drawStore = useDrawStore()
const settings = useSettingsStore()
const { accept, blockCurrent, reportClosed, respin } = useDraw()
const { share, copied } = useShareResult()

const readonly = computed(() => props.restaurant !== undefined)
const r = computed(() => (readonly.value ? (props.restaurant ?? null) : drawStore.winner))
const isOpen = computed(() =>
  readonly.value ? !!props.open && !!r.value : drawStore.showResult && !!r.value,
)

const region = computed(() =>
  readonly.value && r.value ? detectRegion(r.value.location, 'HK') : drawStore.region,
)
const origin = computed<LatLng | null>(() => (readonly.value ? null : drawStore.lastOrigin))

const photoFailed = ref(false)
watch(r, () => (photoFailed.value = false))

// Own diary aggregate for this place — "you average 4.5★ across 3 visits"
const myDiary = ref<{ avg: number; n: number; note?: string } | null>(null)
watch(
  r,
  async (cur) => {
    if (!cur) {
      myDiary.value = null
      return
    }
    const stats = (await createHistoryRepo(getDb()).diaryStatsByPlaceId()).get(cur.id)
    // legacy per-place note still counts as a seed for never-migrated places
    const legacy = await createPlaceNotesRepo(getDb()).get(cur.id)
    if (stats?.ratedVisits) {
      myDiary.value = { avg: stats.avgRating, n: stats.ratedVisits, note: stats.latestNote }
    } else if (legacy?.myRating) {
      myDiary.value = { avg: legacy.myRating, n: 1, note: legacy.note }
    } else {
      myDiary.value = null
    }
  },
  { immediate: true },
)

// Photos are the scarcest quota (1,000 free/month) — load exactly one,
// only for the winner, at a capped width.
const photoSrc = computed(() => {
  const first = r.value?.photoNames[0]
  if (!first || photoFailed.value) return null
  return getProvider(settings.googleApiKey).photoUrl(first, 800)
})

const price = computed(() => (r.value ? formatPrice(r.value, locale.value, region.value) : null))

const distanceText = computed(() => {
  if (!r.value || !origin.value) return null
  return formatDistance(haversineMeters(origin.value, r.value.location), locale.value)
})

const cuisineTags = computed(() => (r.value ? cuisinesOfTypes(r.value.types).slice(0, 2) : []))

const heroEmoji = computed(() => (r.value ? emojiForTypes(r.value.types) : '🍽️'))
const heroColor = computed(() => wheelColor(drawStore.winnerIndex >= 0 ? drawStore.winnerIndex : 2))

const mapsUrl = computed(() => (r.value ? buildGoogleMapsUrl(r.value) : null))
const openRiceUrl = computed(() =>
  r.value ? buildOpenRiceUrl(r.value.name, region.value, locale.value as AppLocale) : null,
)
const tabelogUrl = computed(() => (r.value ? buildTabelogUrl(r.value.name, region.value) : null))

function close() {
  if (readonly.value) emit('close')
  else drawStore.acceptWinner()
}

const imageBusy = ref(false)
async function shareAsImage() {
  if (!r.value || imageBusy.value) return
  imageBusy.value = true
  try {
    const canvas = drawCardImage({
      restaurant: r.value,
      emoji: heroEmoji.value,
      color: heroColor.value,
      priceText: price.value && price.value.source !== 'none' ? price.value.text : null,
      distanceText: distanceText.value ? t('result.distanceAway', { d: distanceText.value }) : null,
      cuisineText: cuisineTags.value.map((c) => `${c.emoji} ${t(`cuisine.${c.id}`)}`).join('  '),
      footer: `🎡 ${t('app.name')} · eat-what.samsonchoi.hk`,
    })
    await shareCardImage(canvas)
  } finally {
    imageBusy.value = false
  }
}
</script>

<template>
  <ModalShell :open="isOpen" @close="close">
    <div v-if="r">
      <!-- hero: real photo when the live provider has one, emoji art otherwise -->
      <img
        v-if="photoSrc"
        :src="photoSrc"
        alt=""
        class="h-44 w-full rounded-t-3xl object-cover"
        loading="lazy"
        @error="photoFailed = true"
      />
      <div
        v-else
        class="flex h-40 items-center justify-center rounded-t-3xl text-7xl"
        :style="{ background: `linear-gradient(135deg, ${heroColor}66, ${heroColor})` }"
      >
        <span aria-hidden="true">{{ heroEmoji }}</span>
      </div>

      <div class="space-y-3 p-5">
        <div>
          <h2 class="text-2xl font-black tracking-tight">{{ r.name }}</h2>
          <div class="mt-1 flex flex-wrap items-center gap-2">
            <RatingStars :rating="r.rating" :count="r.userRatingCount" />
            <span
              v-if="myDiary"
              class="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-950 dark:text-amber-300"
            >
              ⭐ {{ t('diary.avgShort', { avg: myDiary.avg.toFixed(1), n: myDiary.n }) }}
            </span>
          </div>
          <p
            v-if="myDiary?.note"
            class="mt-1 truncate text-xs text-stone-400 italic dark:text-stone-500"
          >
            ✍️ {{ myDiary.note }}
          </p>
        </div>

        <div class="flex flex-wrap items-center gap-2 text-sm">
          <span
            v-for="c in cuisineTags"
            :key="c.id"
            class="rounded-full bg-orange-100 px-2.5 py-0.5 text-orange-700 dark:bg-orange-950 dark:text-orange-300"
          >
            {{ c.emoji }} {{ t(`cuisine.${c.id}`) }}
          </span>
          <span
            v-if="price && price.source !== 'none'"
            class="rounded-full bg-emerald-100 px-2.5 py-0.5 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
          >
            {{ price.text }}
          </span>
          <span
            v-else
            class="rounded-full bg-stone-100 px-2.5 py-0.5 text-stone-500 dark:bg-stone-800 dark:text-stone-400"
          >
            {{ t('result.priceUnknown') }}
          </span>
        </div>

        <div class="space-y-1.5 text-sm text-stone-600 dark:text-stone-300">
          <p v-if="distanceText">📍 {{ t('result.distanceAway', { d: distanceText }) }}</p>
          <p v-if="r.openNow !== undefined">
            <span v-if="r.openNow" class="text-emerald-600 dark:text-emerald-400">
              🟢 {{ t('result.openNow') }}
            </span>
            <span v-else class="text-red-500 dark:text-red-400">🔴 {{ t('result.closed') }}</span>
            <span v-if="r.todayHours" class="text-stone-400 dark:text-stone-500">
              · {{ r.todayHours }}</span
            >
          </p>
          <p v-if="r.address" class="text-stone-500 dark:text-stone-400">🏠 {{ r.address }}</p>
        </div>

        <!-- AI: concierge reason (this winner WAS the AI's pick) or a generic blurb -->
        <p
          v-if="!readonly && drawStore.aiReason"
          class="text-sm text-stone-500 italic dark:text-stone-400"
        >
          <span
            class="mr-1 inline-block rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold not-italic text-violet-700 dark:bg-violet-950 dark:text-violet-300"
          >
            🤖 {{ t('result.aiPick') }}
          </span>
          {{ drawStore.aiReason }}
        </p>
        <AiBlurb v-else-if="!readonly" :restaurant="r" />

        <!-- external links -->
        <div class="flex flex-wrap gap-2 pt-1">
          <a
            v-if="mapsUrl"
            :href="mapsUrl"
            target="_blank"
            rel="noopener"
            class="rounded-full border border-stone-300 px-3 py-1.5 text-sm font-semibold text-stone-600 active:scale-95 dark:border-stone-700 dark:text-stone-300"
          >
            🗺️ {{ t('result.openInMaps') }}
          </a>
          <a
            v-if="openRiceUrl"
            :href="openRiceUrl"
            target="_blank"
            rel="noopener"
            class="rounded-full border border-stone-300 px-3 py-1.5 text-sm font-semibold text-stone-600 active:scale-95 dark:border-stone-700 dark:text-stone-300"
          >
            🍚 {{ t('result.openInOpenRice') }}
          </a>
          <a
            v-if="tabelogUrl"
            :href="tabelogUrl"
            target="_blank"
            rel="noopener"
            class="rounded-full border border-stone-300 px-3 py-1.5 text-sm font-semibold text-stone-600 active:scale-95 dark:border-stone-700 dark:text-stone-300"
          >
            🍱 Tabelog
          </a>
          <button
            type="button"
            class="rounded-full border border-stone-300 px-3 py-1.5 text-sm font-semibold text-stone-600 active:scale-95 dark:border-stone-700 dark:text-stone-300"
            @click="share(r, t('app.name'))"
          >
            {{ copied ? '✅ ' + t('result.copied') : '📤 ' + t('result.share') }}
          </button>
          <button
            type="button"
            class="rounded-full border border-stone-300 px-3 py-1.5 text-sm font-semibold text-stone-600 active:scale-95 disabled:opacity-50 dark:border-stone-700 dark:text-stone-300"
            :disabled="imageBusy"
            @click="shareAsImage"
          >
            🖼️ {{ t('result.shareImage') }}
          </button>
        </div>

        <div v-if="!readonly" class="flex gap-2 pt-2">
          <button
            type="button"
            class="flex-1 rounded-xl border border-stone-300 px-3 py-3 text-sm font-semibold text-stone-600 active:scale-95 dark:border-stone-700 dark:text-stone-300"
            @click="respin()"
          >
            🔁 {{ t('result.respin') }}
          </button>
          <button
            type="button"
            class="flex-[2] rounded-xl bg-orange-500 px-3 py-3 text-sm font-bold text-white shadow-md active:scale-95"
            @click="accept()"
          >
            😋 {{ t('result.accept') }}
          </button>
        </div>
        <div v-if="!readonly" class="flex justify-center gap-5 pb-1">
          <button
            type="button"
            class="text-xs text-stone-400 underline dark:text-stone-500"
            @click="blockCurrent()"
          >
            🚫 {{ t('result.never') }}
          </button>
          <button
            type="button"
            class="text-xs text-stone-400 underline dark:text-stone-500"
            @click="reportClosed()"
          >
            ⛔ {{ t('result.reportClosed') }}
          </button>
        </div>
        <button
          v-else
          type="button"
          class="w-full rounded-xl border border-stone-300 px-3 py-3 text-sm font-semibold text-stone-600 dark:border-stone-700 dark:text-stone-300"
          @click="close"
        >
          {{ t('common.close') }}
        </button>
      </div>
    </div>
  </ModalShell>
</template>
