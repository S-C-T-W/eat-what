<script setup lang="ts">
import { watch } from 'vue'
import { useI18n } from 'vue-i18n'

import BottomSheet from '@/components/ui/BottomSheet.vue'
import CuisineChips from './CuisineChips.vue'
import KeywordChips from './KeywordChips.vue'
import VoiceConditions from './VoiceConditions.vue'
import PresetBar from './PresetBar.vue'
import BudgetSelect from './BudgetSelect.vue'
import RadiusSelect from './RadiusSelect.vue'
import MiscToggles from './MiscToggles.vue'
import OriginPicker from './OriginPicker.vue'
import { getCurrentLocation } from '@/composables/useOrigin'
import { useDrawStore } from '@/stores/draw'
import { useSettingsStore } from '@/stores/settings'

const { t } = useI18n()
const drawStore = useDrawStore()
const settings = useSettingsStore()

// Opening the filter IS the moment to ask for location (user gesture, and
// the map preview wants to centre on where they actually are). Users who
// never open the drawer keep the old behaviour: permission is asked at
// draw time. Demo mode stays on the demo origin for consistency.
let lastFixAt = 0
watch(
  () => drawStore.drawerOpen,
  async (open) => {
    if (!open || !settings.googleApiKey) return
    if (Date.now() - lastFixAt < 60_000) return
    const fix = await getCurrentLocation()
    if (fix.ok) {
      drawStore.liveFix = fix.location
      lastFixAt = Date.now()
    }
  },
)
</script>

<template>
  <BottomSheet :open="drawStore.drawerOpen" @close="drawStore.drawerOpen = false">
    <div class="space-y-6 px-6 pt-1 pb-4">
      <h2 class="text-lg font-bold">{{ t('conditions.title') }}</h2>

      <VoiceConditions />

      <PresetBar />

      <section>
        <h3 class="mb-2 text-sm font-semibold tracking-wide text-stone-500 uppercase dark:text-stone-400">
          {{ t('conditions.cuisine') }}
        </h3>
        <CuisineChips />
      </section>

      <section>
        <h3 class="mb-2 text-sm font-semibold tracking-wide text-stone-500 uppercase dark:text-stone-400">
          {{ t('conditions.keywords') }}
        </h3>
        <KeywordChips />
      </section>

      <section>
        <h3 class="mb-2 text-sm font-semibold tracking-wide text-stone-500 uppercase dark:text-stone-400">
          {{ t('conditions.budget') }}
        </h3>
        <BudgetSelect />
      </section>

      <section>
        <h3 class="mb-2 text-sm font-semibold tracking-wide text-stone-500 uppercase dark:text-stone-400">
          {{ t('conditions.radius') }}
        </h3>
        <RadiusSelect />
      </section>

      <section>
        <h3 class="mb-2 text-sm font-semibold tracking-wide text-stone-500 uppercase dark:text-stone-400">
          {{ t('conditions.origin') }}
        </h3>
        <OriginPicker />
      </section>

      <section>
        <h3 class="mb-2 text-sm font-semibold tracking-wide text-stone-500 uppercase dark:text-stone-400">
          {{ t('conditions.more') }}
        </h3>
        <MiscToggles />
      </section>

      <div class="flex gap-2 border-t border-stone-200 pt-4 dark:border-stone-800">
        <button
          type="button"
          class="flex-1 rounded-xl border border-stone-300 px-3 py-2.5 text-sm text-stone-600 dark:border-stone-700 dark:text-stone-300"
          @click="drawStore.resetConditions()"
        >
          {{ t('conditions.reset') }}
        </button>
        <button
          type="button"
          class="flex-1 rounded-xl border border-orange-300 bg-orange-500/10 px-3 py-2.5 text-sm font-semibold text-orange-600 dark:border-orange-800 dark:text-orange-400"
          @click="drawStore.saveConditionsAsDefault()"
        >
          {{ t('conditions.saveDefault') }}
        </button>
        <button
          type="button"
          class="flex-1 rounded-xl bg-orange-500 px-3 py-2.5 text-sm font-bold text-white shadow-md active:scale-95"
          @click="drawStore.drawerOpen = false"
        >
          {{ t('conditions.done') }}
        </button>
      </div>
    </div>
  </BottomSheet>
</template>
