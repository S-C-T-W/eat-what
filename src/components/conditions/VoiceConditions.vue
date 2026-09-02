<script setup lang="ts">
import { speechLang } from '@/lib/i18n/locales'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { aiConfigured, parseConditions } from '@/lib/ai/client'
import { applyConditionPatch } from '@/lib/ai/conditionsSchema'
import { useDrawStore } from '@/stores/draw'
import { useSettingsStore } from '@/stores/settings'

const { t } = useI18n()
const drawStore = useDrawStore()
const settings = useSettingsStore()

const cfg = computed(() => ({
  baseUrl: settings.aiBaseUrl,
  apiKey: settings.aiApiKey,
  model: settings.aiModel,
}))
const enabled = computed(() => aiConfigured(cfg.value))

const text = ref('')
const state = ref<'idle' | 'listening' | 'parsing' | 'applied' | 'failed'>('idle')
const appliedCount = ref(0)

// Web Speech API — on-device/system speech-to-text; Cantonese for the
// zh-TW UI since that's what HK users actually speak
type SpeechRecognitionCtor = new () => {
  lang: string
  interimResults: boolean
  maxAlternatives: number
  onresult:
    ((e: { results: { [i: number]: { [j: number]: { transcript: string } } } }) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
}
const SR: SpeechRecognitionCtor | undefined =
  (window as { SpeechRecognition?: SpeechRecognitionCtor }).SpeechRecognition ??
  (window as { webkitSpeechRecognition?: SpeechRecognitionCtor }).webkitSpeechRecognition
const micSupported = !!SR

function listen() {
  if (!SR || state.value === 'listening') return
  const rec = new SR()
  rec.lang = speechLang(settings.locale)
  rec.interimResults = false
  rec.maxAlternatives = 1
  state.value = 'listening'
  rec.onresult = (e) => {
    const transcript = e.results[0]?.[0]?.transcript ?? ''
    if (transcript) {
      text.value = transcript
      void submit()
    } else {
      state.value = 'idle'
    }
  }
  rec.onerror = () => {
    if (state.value === 'listening') state.value = 'idle'
  }
  rec.onend = () => {
    if (state.value === 'listening') state.value = 'idle'
  }
  rec.start()
}

async function submit() {
  const utterance = text.value.trim()
  if (!utterance || state.value === 'parsing') return
  state.value = 'parsing'
  const patch = await parseConditions(cfg.value, utterance, settings.locale)
  if (!patch) {
    state.value = 'failed'
    return
  }
  const applied = applyConditionPatch(drawStore.conditions, patch)
  appliedCount.value = applied.length
  state.value = 'applied'
  text.value = ''
  setTimeout(() => {
    if (state.value === 'applied') state.value = 'idle'
  }, 3500)
}
</script>

<template>
  <div
    v-if="enabled"
    class="rounded-2xl border border-violet-200 bg-violet-500/5 p-3 dark:border-violet-900"
  >
    <div class="flex gap-2">
      <input
        v-model="text"
        type="text"
        maxlength="200"
        :placeholder="t('conditions.voice.placeholder')"
        class="min-w-0 flex-1 rounded-xl border border-violet-300 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-stone-400 focus:border-violet-500 dark:border-violet-900"
        @keyup.enter="submit"
      />
      <button
        v-if="micSupported"
        type="button"
        class="rounded-xl border border-violet-300 px-3 py-2 text-lg active:scale-95 dark:border-violet-800"
        :class="state === 'listening' ? 'animate-pulse bg-violet-500/20' : ''"
        :aria-label="t('conditions.voice.mic')"
        @click="listen"
      >
        🎙️
      </button>
      <button
        type="button"
        class="rounded-xl bg-violet-500 px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
        :disabled="state === 'parsing' || !text.trim()"
        @click="submit"
      >
        {{ state === 'parsing' ? '…' : '✨' }}
      </button>
    </div>
    <p v-if="state === 'listening'" class="mt-1.5 text-xs text-violet-500">
      🎙️ {{ t('conditions.voice.listening') }}
    </p>
    <p
      v-else-if="state === 'applied'"
      class="mt-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400"
    >
      ✅ {{ t('conditions.voice.applied', { n: appliedCount }) }}
    </p>
    <p v-else-if="state === 'failed'" class="mt-1.5 text-xs text-amber-600">
      {{ t('conditions.voice.failed') }}
    </p>
  </div>
</template>
