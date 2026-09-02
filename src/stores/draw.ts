import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import type { DrawConditions, LatLng, Restaurant, RelaxationSuggestion } from '@/types/models'
import { detectRegion, type Region } from '@/lib/geo/region'
import { conditionsFingerprint, selectCandidates, type DrawOutcome } from '@/lib/draw/engine'
import { chainConfigKey } from '@/lib/places/chains'
import { hydrateConditions } from '@/lib/draw/defaults'
import { useSettingsStore } from './settings'

export type DrawPhase = 'idle' | 'loading' | 'spinning' | 'landed'

function cloneConditions(c: DrawConditions): DrawConditions {
  // Hydration fills fields added since the conditions were persisted and
  // migrates the v1 $-level budget into the money-window shape
  return hydrateConditions(JSON.parse(JSON.stringify(c)) as DrawConditions)
}

export const useDrawStore = defineStore(
  'draw',
  () => {
    const settings = useSettingsStore()

    const phase = ref<DrawPhase>('idle')
    const conditions = ref<DrawConditions>(cloneConditions(settings.defaultConditions))
    const pool = ref<Restaurant[]>([])
    const candidates = ref<Restaurant[]>([])
    const winnerIndex = ref(-1)
    const relaxations = ref<RelaxationSuggestion[]>([])
    const lastOrigin = ref<LatLng | null>(null)
    /** Fresh GPS fix grabbed when the filter drawer opens — centres the map
     *  preview on where the user actually is (no draw needed first) */
    const liveFix = ref<LatLng | null>(null)
    /** Fingerprint of the conditions the current pool was fetched with */
    const poolFingerprint = ref<string | null>(null)
    /** Region of the last completed draw — persisted so the app reopens with
     *  the right currency instead of snapping back to HK$ */
    const lastRegion = ref<Region>('HK')
    /**
     * Where the NEXT draw will centre, as far as we can tell without asking
     * for GPS: a picked spot / offset base / first multi spot / corridor end
     * → the live fix grabbed when the drawer opened → the last draw's origin.
     */
    const previewAnchor = computed<LatLng | null>(() => {
      const o = conditions.value.origin
      const spot =
        o.mode === 'picked'
          ? o.picked?.location
          : o.mode === 'offset'
            ? o.offset?.base?.location
            : o.mode === 'multi'
              ? o.spots?.find((sp) => sp)?.location
              : o.mode === 'corridor'
                ? (o.corridor?.a ?? o.corridor?.b)?.location
                : undefined
      return spot ?? liveFix.value ?? lastOrigin.value
    })
    /** Currency / price-band region: follows the preview anchor the moment it
     *  is known (drawer opened, spot picked) and otherwise the last draw's */
    const region = computed<Region>(() =>
      previewAnchor.value ? detectRegion(previewAnchor.value, lastRegion.value) : lastRegion.value,
    )
    const errorKey = ref<string | null>(null)
    const drawerOpen = ref(false)
    const showResult = ref(false)
    /** Free-text mood for the AI concierge (only used when AI is configured) */
    const mood = ref('')
    /** AI's one-line justification when the winner was concierge-picked */
    const aiReason = ref<string | null>(null)

    const winner = computed<Restaurant | null>(() =>
      winnerIndex.value >= 0 ? (candidates.value[winnerIndex.value] ?? null) : null,
    )

    // Chain-config edits (Settings) change which places qualify, so they are
    // part of the pool's identity alongside the conditions themselves
    function currentFingerprint(): string {
      return `${conditionsFingerprint(conditions.value)}#${chainConfigKey(
        settings.chainDisabled,
        settings.chainCustom,
      )}`
    }

    function setOutcome(outcome: DrawOutcome, origin: LatLng, detectedRegion: Region) {
      pool.value = outcome.pool
      candidates.value = outcome.candidates
      winnerIndex.value = outcome.winnerIndex
      relaxations.value = outcome.relaxations
      lastOrigin.value = origin
      poolFingerprint.value = currentFingerprint()
      lastRegion.value = detectedRegion
    }

    /** False once the user edits any condition (or the chain list) post-fetch. */
    function poolMatchesConditions(): boolean {
      return poolFingerprint.value !== null && poolFingerprint.value === currentFingerprint()
    }

    /** Exclude the current winner and spin again from the remaining pool — no refetch. */
    function respin() {
      const current = winner.value
      showResult.value = false
      // The rejected winner's AI justification must not ride along onto the
      // next one — the card falls back to a fresh per-restaurant blurb.
      aiReason.value = null
      if (current) pool.value = pool.value.filter((r) => r.id !== current.id)
      if (pool.value.length === 0) {
        candidates.value = []
        winnerIndex.value = -1
        phase.value = 'idle'
        errorKey.value = 'draw.exhausted'
        return
      }
      const sel = selectCandidates(pool.value)
      candidates.value = sel.candidates
      winnerIndex.value = sel.winnerIndex
      phase.value = 'spinning'
    }

    function acceptWinner() {
      showResult.value = false
      phase.value = 'idle'
    }

    function saveConditionsAsDefault() {
      settings.defaultConditions = cloneConditions(conditions.value)
    }

    function resetConditions() {
      conditions.value = cloneConditions(settings.defaultConditions)
    }

    /** Replace conditions wholesale (presets) — clone-merged for forward compat. */
    function applyConditions(c: DrawConditions) {
      conditions.value = cloneConditions(c)
    }

    return {
      phase,
      conditions,
      pool,
      candidates,
      winnerIndex,
      relaxations,
      lastOrigin,
      liveFix,
      poolFingerprint,
      lastRegion,
      previewAnchor,
      region,
      errorKey,
      drawerOpen,
      showResult,
      mood,
      aiReason,
      winner,
      setOutcome,
      poolMatchesConditions,
      respin,
      acceptWinner,
      saveConditionsAsDefault,
      resetConditions,
      applyConditions,
    }
  },
  { persist: { pick: ['lastRegion'] } },
)
