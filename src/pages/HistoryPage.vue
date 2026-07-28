<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import type { DrawRecord, Meal, PlaceNote, Restaurant } from '@/types/models'
import AddMealSheet from '@/components/history/AddMealSheet.vue'
import DiarySheet from '@/components/history/DiarySheet.vue'
import ResultCard from '@/components/result/ResultCard.vue'
import SwipeToDelete from '@/components/ui/SwipeToDelete.vue'
import { createHistoryRepo, type DayGroup } from '@/lib/db/historyRepo'
import { createPlaceNotesRepo } from '@/lib/db/placeNotesRepo'
import { getDb } from '@/lib/db/schema'
import { emojiForTypes } from '@/lib/places/cuisines'

const { t, locale } = useI18n()
const repo = createHistoryRepo(getDb())
const notesRepo = createPlaceNotesRepo(getDb())

const MEAL_EMOJI: Record<Meal, string> = {
  breakfast: '🍳',
  lunch: '🥪',
  tea: '☕️',
  dinner: '🌙',
  lateNight: '🌜',
}

type Stats = Awaited<ReturnType<typeof repo.stats>>

const groups = ref<DayGroup[]>([])
const upcoming = ref<DrawRecord[]>([])
const notes = ref<Map<string, PlaceNote>>(new Map())
const stats = ref<Stats | null>(null)
const selected = ref<Restaurant | null>(null)
const cardOpen = ref(false)

async function load() {
  ;[groups.value, upcoming.value, notes.value, stats.value] = await Promise.all([
    repo.listGroupedByDay(),
    repo.upcoming(),
    notesRepo.allByPlaceId(),
    repo.stats(5),
  ])
}
onMounted(load)

function dayLabel(day: string): string {
  const date = new Date(`${day}T12:00:00`)
  return new Intl.DateTimeFormat(locale.value, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(date)
}

function timeLabel(ts: number): string {
  return new Intl.DateTimeFormat(locale.value, { hour: '2-digit', minute: '2-digit' }).format(ts)
}

function plannedLabel(ts: number): string {
  return new Intl.DateTimeFormat(locale.value, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(ts)
}

function openRecord(r: Restaurant) {
  selected.value = r
  cardOpen.value = true
}

// Food diary editor
const diaryFor = ref<Restaurant | null>(null)
const diaryOpen = ref(false)
function openDiary(r: Restaurant) {
  diaryFor.value = r
  diaryOpen.value = true
}

// Manual meal logging → straight into the diary for that place
const addOpen = ref(false)
async function onMealLogged(r: Restaurant) {
  await load()
  openDiary(r)
}

// Swipe-to-delete: one open row at a time, iOS style
const openRowId = ref<number | null>(null)
async function removeRecord(id: number | undefined) {
  if (id === undefined) return
  await repo.remove(id)
  openRowId.value = null
  await load()
}
</script>

<template>
  <div class="mx-auto max-w-md px-6 pt-10">
    <div class="mb-4 flex items-center justify-between">
      <h1 class="text-2xl font-bold">{{ t('nav.history') }}</h1>
      <button
        type="button"
        class="rounded-full border border-orange-300 bg-orange-500/10 px-3 py-1.5 text-sm font-semibold text-orange-600 active:scale-95 dark:border-orange-800 dark:text-orange-400"
        @click="addOpen = true"
      >
        ➕ {{ t('manual.cta') }}
      </button>
    </div>

    <!-- upcoming plans (future draws) -->
    <section v-if="upcoming.length" class="mb-6">
      <h2 class="mb-2 text-xs font-bold tracking-wide text-sky-500 uppercase dark:text-sky-400">
        📅 {{ t('history.upcoming') }}
      </h2>
      <ul class="space-y-2">
        <li v-for="rec in upcoming" :key="rec.id">
          <SwipeToDelete
            :open="openRowId === rec.id"
            :label="t('history.delete')"
            @update:open="openRowId = $event ? (rec.id ?? null) : null"
            @delete="removeRecord(rec.id)"
          >
            <div
              class="flex w-full items-center gap-1 rounded-2xl border border-sky-200 bg-sky-50 pr-1 dark:border-sky-900 dark:bg-sky-950/40"
            >
              <button
                type="button"
                class="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left active:scale-[0.99]"
                @click="openRecord(rec.restaurant)"
              >
                <span class="text-2xl" aria-hidden="true">{{ emojiForTypes(rec.restaurant.types) }}</span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm font-semibold">{{ rec.restaurant.name }}</span>
                  <span class="block text-xs font-semibold text-sky-600 dark:text-sky-400">
                    📅 {{ plannedLabel(rec.plannedAt!) }}
                  </span>
                </span>
                <span
                  v-if="rec.source === 'group'"
                  class="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-700 dark:bg-violet-950 dark:text-violet-300"
                  :title="t('history.groupBadge')"
                >
                  👥
                </span>
              </button>
            </div>
          </SwipeToDelete>
        </li>
      </ul>
    </section>

    <!-- stats block -->
    <section
      v-if="stats && stats.total > 0"
      class="mb-6 rounded-2xl border border-stone-200 p-4 dark:border-stone-800"
    >
      <div class="grid grid-cols-3 gap-2 text-center">
        <div>
          <p class="text-xl font-black">{{ stats.total }}</p>
          <p class="text-[11px] text-stone-400 dark:text-stone-500">{{ t('history.statTotal') }}</p>
        </div>
        <div>
          <p class="text-xl font-black">{{ stats.distinctPlaces }}</p>
          <p class="text-[11px] text-stone-400 dark:text-stone-500">{{ t('history.statPlaces') }}</p>
        </div>
        <div>
          <p class="text-xl font-black">
            {{ stats.streakDays }}<span v-if="stats.streakDays >= 3">🔥</span>
          </p>
          <p class="text-[11px] text-stone-400 dark:text-stone-500">{{ t('history.statStreak') }}</p>
        </div>
      </div>

      <div v-if="stats.topCuisines.length" class="mt-4 space-y-1.5">
        <p class="text-xs font-semibold text-stone-500 dark:text-stone-400">
          {{ t('history.topCuisines') }}
        </p>
        <div v-for="c in stats.topCuisines" :key="c.id" class="flex items-center gap-2 text-xs">
          <span class="w-24 shrink-0 truncate">{{ c.emoji }} {{ t(`cuisine.${c.id}`) }}</span>
          <span class="h-2.5 flex-1 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
            <span
              class="block h-full rounded-full bg-orange-400"
              :style="{ width: `${Math.round(c.share * 100)}%` }"
            />
          </span>
          <span class="w-6 text-right text-stone-400">{{ c.count }}</span>
        </div>
      </div>
    </section>

    <p v-if="!groups.length" class="text-sm text-stone-500 dark:text-stone-400">
      {{ t('history.empty') }}
    </p>

    <section v-for="g in groups" :key="g.day" class="mb-6">
      <h2 class="mb-2 text-xs font-bold tracking-wide text-stone-400 uppercase dark:text-stone-500">
        {{ dayLabel(g.day) }}
      </h2>
      <ul class="space-y-2">
        <li v-for="rec in g.records" :key="rec.id">
          <SwipeToDelete
            :open="openRowId === rec.id"
            :label="t('history.delete')"
            @update:open="openRowId = $event ? (rec.id ?? null) : null"
            @delete="removeRecord(rec.id)"
          >
            <div
              class="flex w-full items-center gap-1 rounded-2xl border border-stone-200 bg-orange-50 pr-1 dark:border-stone-800 dark:bg-stone-950"
            >
              <button
                type="button"
                class="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left active:scale-[0.99]"
                @click="openRecord(rec.restaurant)"
              >
                <span class="text-2xl" aria-hidden="true">{{ emojiForTypes(rec.restaurant.types) }}</span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm font-semibold">{{ rec.restaurant.name }}</span>
                  <span class="block text-xs text-stone-400 dark:text-stone-500">
                    {{ MEAL_EMOJI[rec.meal] ?? '🍽️' }} {{ t(`history.${rec.meal}`) }} ·
                    {{ timeLabel(rec.plannedAt ?? rec.timestamp) }}
                    <span v-if="rec.plannedAt">📅</span>
                  </span>
                </span>
                <span
                  v-if="rec.source === 'group'"
                  class="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-700 dark:bg-violet-950 dark:text-violet-300"
                  :title="t('history.groupBadge')"
                >
                  👥
                </span>
                <span
                  v-else-if="rec.source === 'manual'"
                  class="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                  :title="t('history.manualBadge')"
                >
                  📔
                </span>
                <span
                  v-if="notes.get(rec.restaurant.id)?.myRating"
                  class="rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                >
                  ⭐{{ notes.get(rec.restaurant.id)!.myRating }}
                </span>
                <span v-else-if="rec.restaurant.rating" class="text-xs text-stone-400">
                  ★ {{ rec.restaurant.rating.toFixed(1) }}
                </span>
              </button>
              <button
                type="button"
                class="shrink-0 rounded-xl px-2 py-2 text-lg active:scale-90"
                :class="notes.has(rec.restaurant.id) ? '' : 'opacity-35 grayscale'"
                :aria-label="t('diary.title')"
                @click="openDiary(rec.restaurant)"
              >
                ✍️
              </button>
            </div>
          </SwipeToDelete>
        </li>
      </ul>
    </section>

    <ResultCard :restaurant="selected" :open="cardOpen" @close="cardOpen = false" />
    <DiarySheet :restaurant="diaryFor" :open="diaryOpen" @close="diaryOpen = false" @saved="load" />
    <AddMealSheet :open="addOpen" @close="addOpen = false" @saved="onMealLogged" />
  </div>
</template>
