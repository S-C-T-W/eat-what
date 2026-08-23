<script setup lang="ts">
/**
 * Diary editor for ONE VISIT (v3): this visit's rating / what I ate / what
 * I paid — every history record carries its own, and the place's effective
 * rating becomes the AVERAGE across visits. Place-level corrections
 * (cuisines / craving tags / blacklist / closed) still live here because
 * history is where the user curates their own map.
 */
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import type { Restaurant, VisitDiary } from '@/types/models'
import type { CuisineId } from '@/lib/places/cuisines'
import BottomSheet from '@/components/ui/BottomSheet.vue'
import BudgetRangeSlider from '@/components/conditions/BudgetRangeSlider.vue'
import { CUISINES } from '@/lib/places/cuisines'
import { KEYWORD_GROUPS, MAX_KEYWORD_TAGS } from '@/lib/places/keywords'
import { formatBudgetWindow, type BudgetWindow } from '@/lib/format/price'
import { detectRegion } from '@/lib/geo/region'
import { createBlocklistRepo, createHistoryRepo } from '@/lib/db/historyRepo'
import { createPlaceNotesRepo } from '@/lib/db/placeNotesRepo'
import { getDb } from '@/lib/db/schema'
import { useHaptics } from '@/composables/useHaptics'

/** Enough of a DrawRecord to edit its diary */
export interface DiaryTarget {
  id?: number
  restaurant: Restaurant
  diary?: VisitDiary
}

const props = defineProps<{ open: boolean; record: DiaryTarget | null }>()
const emit = defineEmits<{ close: []; saved: [] }>()

const { t, locale } = useI18n()
const haptics = useHaptics()
const notesRepo = createPlaceNotesRepo(getDb())
const blocklist = createBlocklistRepo(getDb())
const history = createHistoryRepo(getDb())

const restaurant = computed(() => props.record?.restaurant ?? null)

const MAX_CUISINES = 3
const ALL_TAGS = KEYWORD_GROUPS.flatMap((g) => g.tags)

const form = reactive({
  myRating: 0,
  note: '',
  spend: null as BudgetWindow | null,
  cuisines: [] as CuisineId[],
  keywords: [] as string[],
  blacklisted: false,
  closed: false,
})
const wasBlacklisted = ref(false)
const saving = ref(false)
const aggregate = ref<{ avg: number; n: number } | null>(null)

const region = computed(() =>
  restaurant.value ? detectRegion(restaurant.value.location, 'HK') : 'HK',
)

watch(
  () => props.open,
  async (open) => {
    const rec = props.record
    if (!open || !rec) return
    const [note, blockedIds, stats] = await Promise.all([
      notesRepo.get(rec.restaurant.id),
      blocklist.ids(),
      history.diaryStatsByPlaceId(),
    ])
    // visit part comes from THIS record; place part from the place note
    form.myRating = rec.diary?.rating ?? 0
    form.note = rec.diary?.note ?? ''
    form.spend = rec.diary?.spend ? { ...rec.diary.spend } : null
    form.cuisines = [...(note?.cuisines ?? [])]
    form.keywords = [...(note?.keywords ?? [])]
    form.closed = note?.closed ?? false
    form.blacklisted = blockedIds.has(rec.restaurant.id)
    wasBlacklisted.value = form.blacklisted
    const s = stats.get(rec.restaurant.id)
    aggregate.value = s?.ratedVisits ? { avg: s.avgRating, n: s.ratedVisits } : null
  },
)

function toggleCuisine(id: CuisineId) {
  const i = form.cuisines.indexOf(id)
  if (i >= 0) form.cuisines.splice(i, 1)
  else if (form.cuisines.length < MAX_CUISINES) form.cuisines.push(id)
}

function toggleKeyword(id: string) {
  const i = form.keywords.indexOf(id)
  if (i >= 0) form.keywords.splice(i, 1)
  else if (form.keywords.length < MAX_KEYWORD_TAGS) form.keywords.push(id)
}

async function save() {
  const rec = props.record
  if (!rec || saving.value) return
  const r = rec.restaurant
  saving.value = true
  try {
    // this visit's diary → the record itself
    if (rec.id !== undefined) {
      const diary: VisitDiary = {
        ...(form.myRating ? { rating: form.myRating } : {}),
        ...(form.note.trim() ? { note: form.note.trim() } : {}),
        ...(form.spend ? { spend: { ...form.spend } } : {}),
      }
      await history.setDiary(rec.id, Object.keys(diary).length ? diary : null)
    }
    // place-level corrections → the place note
    await notesRepo.upsert({
      placeId: r.id,
      name: r.name,
      cuisines: form.cuisines.length ? [...form.cuisines] : undefined,
      keywords: form.keywords.length ? [...form.keywords] : undefined,
      closed: form.closed || undefined,
    })
    if (form.blacklisted !== wasBlacklisted.value) {
      if (form.blacklisted) await blocklist.add(r.id, r.name)
      else await blocklist.remove(r.id)
    }
    haptics.tap()
    emit('saved')
    emit('close')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <BottomSheet :open="open" @close="emit('close')">
    <div v-if="restaurant" class="space-y-5 px-6 pt-1 pb-4">
      <div>
        <h2 class="text-lg font-bold">✍️ {{ t('diary.title') }}</h2>
        <p class="text-sm text-stone-400 dark:text-stone-500">{{ restaurant.name }}</p>
        <p
          v-if="aggregate"
          class="mt-1 inline-block rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-950 dark:text-amber-300"
        >
          {{ t('diary.avgLine', { avg: aggregate.avg.toFixed(1), n: aggregate.n }) }}
        </p>
      </div>

      <!-- this visit's rating -->
      <section>
        <h3 class="mb-2 text-sm font-semibold tracking-wide text-stone-500 uppercase dark:text-stone-400">
          {{ t('diary.thisVisit') }}
        </h3>
        <div class="flex items-center gap-1">
          <button
            v-for="star in 5"
            :key="star"
            type="button"
            class="p-1 text-2xl transition-transform active:scale-90"
            :class="star <= form.myRating ? '' : 'opacity-25 grayscale'"
            :aria-label="`${star}★ ${t(`diary.star${star}`)}`"
            @click="form.myRating = form.myRating === star ? 0 : star"
          >
            ⭐
          </button>
          <span v-if="form.myRating" class="ml-2 text-sm font-bold text-amber-600 dark:text-amber-400">
            {{ t(`diary.star${form.myRating}`) }}
          </span>
        </div>
        <p class="mt-1 text-xs text-stone-400 dark:text-stone-500">{{ t('diary.myRatingHint') }}</p>
      </section>

      <!-- what I ate -->
      <section>
        <h3 class="mb-2 text-sm font-semibold tracking-wide text-stone-500 uppercase dark:text-stone-400">
          {{ t('diary.note') }}
        </h3>
        <textarea
          v-model="form.note"
          rows="3"
          maxlength="500"
          :placeholder="t('diary.notePlaceholder')"
          class="w-full rounded-2xl border border-stone-300 bg-transparent px-3 py-2.5 text-sm outline-none placeholder:text-stone-400 focus:border-orange-500 dark:border-stone-700"
        />
      </section>

      <!-- what I actually paid per person (exact when both thumbs meet) -->
      <section>
        <div class="mb-2 flex items-center justify-between">
          <h3 class="text-sm font-semibold tracking-wide text-stone-500 uppercase dark:text-stone-400">
            {{ t('diary.price') }}
          </h3>
          <button
            v-if="form.spend"
            type="button"
            class="rounded-full bg-orange-500/10 px-2.5 py-0.5 text-xs font-bold text-orange-600 dark:text-orange-400"
            @click="form.spend = null"
          >
            💰 {{ formatBudgetWindow(form.spend, region, locale) }} ✕
          </button>
          <span v-else class="text-xs text-stone-400 dark:text-stone-500">
            {{ t('diary.priceUnset') }}
          </span>
        </div>
        <BudgetRangeSlider v-model="form.spend" :region="region" :aria-label="t('diary.price')" />
        <p class="mt-1 text-xs text-stone-400 dark:text-stone-500">{{ t('diary.priceHint') }}</p>
      </section>

      <!-- corrected cuisines -->
      <section>
        <h3 class="mb-2 text-sm font-semibold tracking-wide text-stone-500 uppercase dark:text-stone-400">
          {{ t('diary.cuisines') }}
        </h3>
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="c in CUISINES"
            :key="c.id"
            type="button"
            class="rounded-full border px-2.5 py-1 text-xs transition-all active:scale-95"
            :class="
              form.cuisines.includes(c.id)
                ? 'border-orange-500 bg-orange-500/10 font-semibold text-orange-600 dark:text-orange-400'
                : 'border-stone-300 text-stone-500 dark:border-stone-700 dark:text-stone-400'
            "
            @click="toggleCuisine(c.id)"
          >
            {{ c.emoji }} {{ t(`cuisine.${c.id}`) }}
          </button>
        </div>
        <p class="mt-1 text-xs text-stone-400 dark:text-stone-500">{{ t('diary.cuisinesHint') }}</p>
      </section>

      <!-- craving tags that fit this place -->
      <section>
        <h3 class="mb-2 text-sm font-semibold tracking-wide text-stone-500 uppercase dark:text-stone-400">
          {{ t('diary.keywords') }}
        </h3>
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="tag in ALL_TAGS"
            :key="tag.id"
            type="button"
            class="rounded-full border px-2.5 py-1 text-xs transition-all active:scale-95"
            :class="
              form.keywords.includes(tag.id)
                ? 'border-orange-500 bg-orange-500/10 font-semibold text-orange-600 dark:text-orange-400'
                : 'border-stone-300 text-stone-500 dark:border-stone-700 dark:text-stone-400'
            "
            @click="toggleKeyword(tag.id)"
          >
            {{ t(`kw.${tag.id}`) }}
          </button>
        </div>
      </section>

      <!-- never again / closed down -->
      <section class="space-y-3">
        <div class="flex items-center justify-between gap-3">
          <span class="text-sm">🚫 {{ t('diary.blacklist') }}</span>
          <button
            type="button"
            role="switch"
            :aria-checked="form.blacklisted"
            class="relative h-7 w-12 shrink-0 rounded-full transition-colors"
            :class="form.blacklisted ? 'bg-red-500' : 'bg-stone-300 dark:bg-stone-700'"
            @click="form.blacklisted = !form.blacklisted"
          >
            <span
              class="absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all"
              :class="form.blacklisted ? 'left-6' : 'left-1'"
            />
          </button>
        </div>
        <div class="flex items-center justify-between gap-3">
          <span class="text-sm">⛔ {{ t('diary.closed') }}</span>
          <button
            type="button"
            role="switch"
            :aria-checked="form.closed"
            class="relative h-7 w-12 shrink-0 rounded-full transition-colors"
            :class="form.closed ? 'bg-red-500' : 'bg-stone-300 dark:bg-stone-700'"
            @click="form.closed = !form.closed"
          >
            <span
              class="absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all"
              :class="form.closed ? 'left-6' : 'left-1'"
            />
          </button>
        </div>
        <p class="text-xs text-stone-400 dark:text-stone-500">{{ t('diary.closedHint') }}</p>
      </section>

      <div class="flex gap-2 border-t border-stone-200 pt-4 dark:border-stone-800">
        <button
          type="button"
          class="flex-1 rounded-xl border border-stone-300 px-3 py-2.5 text-sm text-stone-600 dark:border-stone-700 dark:text-stone-300"
          @click="emit('close')"
        >
          {{ t('common.cancel') }}
        </button>
        <button
          type="button"
          class="flex-[2] rounded-xl bg-orange-500 px-3 py-2.5 text-sm font-bold text-white shadow-md active:scale-95 disabled:opacity-60"
          :disabled="saving"
          @click="save"
        >
          💾 {{ t('diary.save') }}
        </button>
      </div>
    </div>
  </BottomSheet>
</template>
