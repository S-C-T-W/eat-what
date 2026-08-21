import { computed } from 'vue'

import type { LatLng, RelaxationSuggestion } from '@/types/models'
import { runDraw, styleWeight, STALE_ORIGIN_METERS } from '@/lib/draw/engine'
import {
  CORRIDOR_MAX_LENGTH,
  offsetPoint,
  primaryAnchor,
  type Geometry,
} from '@/lib/geo/geometry'
import { effectivePatterns } from '@/lib/places/chains'
import { plannedEpoch } from '@/lib/draw/planning'
import { GooglePlacesError } from '@/lib/places/googlePlaces'
import { getProvider } from '@/lib/places'
import { DEMO_ORIGIN } from '@/lib/places/mockProvider'
import { detectRegion } from '@/lib/geo/region'
import { haversineMeters } from '@/lib/geo/distance'
import { conciergePick } from '@/lib/ai/client'
import { createCacheRepo } from '@/lib/db/cacheRepo'
import { createBlocklistRepo, createHistoryRepo } from '@/lib/db/historyRepo'
import { createPlaceNotesRepo } from '@/lib/db/placeNotesRepo'
import { getDb } from '@/lib/db/schema'
import { getCurrentLocation } from './useOrigin'
import { useDrawStore } from '@/stores/draw'
import { useSettingsStore } from '@/stores/settings'

export function useDraw() {
  const drawStore = useDrawStore()
  const settings = useSettingsStore()
  const history = createHistoryRepo(getDb())
  const blocklist = createBlocklistRepo(getDb())
  const placeNotes = createPlaceNotesRepo(getDb())

  const busy = computed(() => drawStore.phase === 'loading' || drawStore.phase === 'spinning')
  const isDemo = computed(() => !settings.googleApiKey)

  async function gpsFix(): Promise<LatLng | null> {
    if (isDemo.value) return DEMO_ORIGIN
    const fix = await getCurrentLocation()
    if (fix.ok) return fix.location
    drawStore.errorKey = fix.reason === 'denied' ? 'draw.locationDenied' : 'draw.locationFailed'
    return null
  }

  /**
   * Turn the origin setting into a concrete anchor + (for advanced modes)
   * a search Geometry. GPS is fetched only when some part needs it.
   */
  async function resolveGeometry(): Promise<{ origin: LatLng; geometry?: Geometry } | null> {
    const o = drawStore.conditions.origin
    const radius = drawStore.conditions.radiusMeters

    if (o.mode === 'picked' && o.picked) return { origin: o.picked.location }
    if (o.mode === 'gps' || o.mode === 'picked') {
      const fix = await gpsFix()
      return fix ? { origin: fix } : null
    }

    if (o.mode === 'offset') {
      const fix = await gpsFix()
      if (!fix) return null
      const off = o.offset ?? { bearing: 90, meters: 300, sector: 0 as const }
      if (off.sector !== 0) {
        // Direction-limited exploration: wedge apex at the CURRENT location
        const geometry: Geometry = {
          kind: 'sector',
          center: fix,
          radius,
          bearing: off.bearing,
          angle: off.sector,
        }
        return { origin: fix, geometry }
      }
      const center = offsetPoint(fix, off.bearing, off.meters)
      return { origin: center, geometry: { kind: 'circle', center, radius } }
    }

    if (o.mode === 'multi') {
      const raw = (o.spots ?? []).slice(0, 5)
      if (!raw.length) {
        const fix = await gpsFix()
        return fix ? { origin: fix } : null
      }
      let fix: LatLng | null = null
      if (raw.some((s) => s === null)) {
        fix = await gpsFix()
        if (!fix) return null
      }
      const spots = raw.map((s) => s?.location ?? fix!)
      const geometry: Geometry = { kind: 'multi', spots, radius }
      return { origin: primaryAnchor(geometry), geometry }
    }

    // corridor
    const c = o.corridor
    if (!c) {
      const fix = await gpsFix()
      return fix ? { origin: fix } : null
    }
    let fix: LatLng | null = null
    if (c.a === null || c.b === null) {
      fix = await gpsFix()
      if (!fix) return null
    }
    const a = c.a?.location ?? fix!
    const b = c.b?.location ?? fix!
    if (haversineMeters(a, b) < 50) {
      // both ends effectively the same point — behave as a plain circle
      return { origin: a }
    }
    if (haversineMeters(a, b) > CORRIDOR_MAX_LENGTH) {
      drawStore.errorKey = 'draw.corridorTooLong'
      return null
    }
    const geometry: Geometry = { kind: 'corridor', a, b, width: c.widthMeters }
    return { origin: primaryAnchor(geometry), geometry }
  }

  async function resolveOrigin(): Promise<LatLng | null> {
    return (await resolveGeometry())?.origin ?? null
  }

  /**
   * Fetch + filter + pick. `spin: false` fills the wheel without spinning —
   * used by group draw, where the final pick happens in the room.
   * Returns whether at least one candidate landed on the wheel.
   */
  async function startDraw(opts: { spin?: boolean } = {}): Promise<boolean> {
    const spin = opts.spin !== false
    if (busy.value) return false
    drawStore.errorKey = null
    drawStore.showResult = false
    drawStore.relaxations = []
    drawStore.phase = 'loading'
    try {
      const resolved = await resolveGeometry()
      if (!resolved) {
        drawStore.phase = 'idle'
        return false
      }
      const { origin, geometry } = resolved
      const region = detectRegion(origin, 'HK')
      const provider = getProvider(settings.googleApiKey)
      const cond = drawStore.conditions

      const notes = await placeNotes.allByPlaceId()

      // drawStyle: bias the winner pick by how often each place was accepted.
      // Places absent from the map default to weight 1 in selectCandidates,
      // so store each weight RELATIVE to the never-tried weight — that keeps
      // explore's boost for unknown places without enumerating them.
      let weights: Map<string, number> | undefined
      if (cond.drawStyle !== 'uniform') {
        const counts = await history.acceptedCountsByPlaceId()
        const base = styleWeight(cond.drawStyle, 0)
        weights = new Map()
        for (const [id, count] of counts) {
          weights.set(id, styleWeight(cond.drawStyle, count) / base)
        }
        // Diary ratings personalize "favor": a 5★ place gets 1.5×, a 1★ 0.5×
        if (cond.drawStyle === 'favor') {
          for (const [id, note] of notes) {
            if (!note.myRating) continue
            const boost = 1 + (note.myRating - 3) * 0.25
            weights.set(id, Math.max(0.1, (weights.get(id) ?? 1) * boost))
          }
        }
      }

      const outcome = await runDraw(cond, origin, {
        provider,
        lang: settings.locale,
        region,
        cache: provider.kind === 'google' ? createCacheRepo(getDb()) : undefined,
        blockedIds: await blocklist.ids(),
        recentIds:
          cond.excludeRecentDays !== null
            ? await history.recentAcceptedPlaceIds(cond.excludeRecentDays)
            : new Set(),
        notes,
        chainPatterns: effectivePatterns(settings.chainDisabled, settings.chainCustom),
        geometry,
        weights,
      })
      drawStore.setOutcome(outcome, origin, region)
      drawStore.aiReason = null
      if (outcome.candidates.length === 0) {
        drawStore.phase = 'idle'
        if (outcome.relaxations.length === 0) drawStore.errorKey = 'draw.noMatches'
        return false
      }
      if (!spin) {
        drawStore.phase = 'idle'
        return true
      }
      // Concierge: with a mood set and AI configured, the "random" winner is
      // AI-picked instead — the wheel still spins to it like any other draw.
      const mood = drawStore.mood.trim()
      if (mood) {
        const pick = await conciergePick(
          { baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel },
          outcome.candidates,
          mood,
          settings.locale,
          cond.partySize,
        )
        if (pick) {
          const idx = outcome.candidates.findIndex((c) => c.id === pick.placeId)
          if (idx >= 0) {
            drawStore.winnerIndex = idx
            drawStore.aiReason = pick.reason
          }
        }
      }
      drawStore.phase = 'spinning'
      return true
    } catch (e) {
      drawStore.phase = 'idle'
      if (e instanceof GooglePlacesError) {
        drawStore.errorKey =
          e.kind === 'keyInvalid'
            ? 'draw.keyInvalid'
            : e.kind === 'quota'
              ? 'draw.quotaReached'
              : 'draw.error'
      } else {
        drawStore.errorKey = 'draw.error'
      }
      return false
    }
  }

  async function applyRelaxation(s: RelaxationSuggestion) {
    const cond = drawStore.conditions
    switch (s.kind) {
      case 'dropOpenNow':
        cond.openNowOnly = false
        break
      case 'dropArriveAt':
        cond.arriveAt = null
        cond.arriveDate = null
        break
      case 'dropMinRating':
        cond.minRating = null
        break
      case 'dropBudget':
        cond.budgetRange = null
        break
      case 'dropRequirePrice':
        cond.requirePrice = false
        break
      case 'dropChains':
        cond.noFastFood = false
        cond.noChains = false
        break
      case 'dropRecentExclusion':
        cond.excludeRecentDays = null
        break
      case 'widenRadius':
        if (s.nextRadius) {
          // corridor mode: "widen" grows the corridor, not the radius
          if (cond.origin.mode === 'corridor' && cond.origin.corridor) {
            cond.origin.corridor.widthMeters = s.nextRadius
          } else {
            cond.radiusMeters = s.nextRadius
          }
        }
        break
    }
    await startDraw()
  }

  /**
   * Is the fetched pool still describing what the user asks for now?
   * True when conditions changed since the fetch, or (opt-in, costs a GPS
   * fix) the user moved ≥200 m from where the pool was fetched.
   */
  async function poolIsStale(opts: { checkOrigin?: boolean } = {}): Promise<boolean> {
    if (!drawStore.poolMatchesConditions()) return true
    if (opts.checkOrigin && drawStore.lastOrigin) {
      const origin = await resolveOrigin()
      if (origin && haversineMeters(origin, drawStore.lastOrigin) > STALE_ORIGIN_METERS) {
        return true
      }
    }
    return false
  }

  /**
   * Re-spin honouring condition edits: same pool while conditions are
   * untouched, full re-query the moment they changed (the reported bug —
   * stale pools must never outlive the filters that produced them).
   */
  async function respin() {
    if (drawStore.poolMatchesConditions()) drawStore.respin()
    else await startDraw()
  }

  /** Accept the winner: close the card and persist the draw to local history. */
  async function accept() {
    const winner = drawStore.winner
    const plannedAt = plannedEpoch(drawStore.conditions)
    drawStore.acceptWinner()
    if (winner) {
      try {
        await history.addAccepted(winner, drawStore.conditions, {
          ...(plannedAt !== null ? { plannedAt } : {}),
        })
      } catch {
        // history is best-effort; never block the happy path
      }
    }
  }

  /** "Never suggest this again": blocklist the winner and spin a replacement. */
  async function blockCurrent() {
    const winner = drawStore.winner
    if (!winner) return
    try {
      await blocklist.add(winner.id, winner.name)
    } catch {
      // best-effort
    }
    drawStore.respin()
  }

  /** "It closed down": remember permanently and spin a replacement. */
  async function reportClosed() {
    const winner = drawStore.winner
    if (!winner) return
    try {
      await placeNotes.setClosed(winner.id, winner.name, true)
    } catch {
      // best-effort
    }
    drawStore.respin()
  }

  return {
    busy,
    isDemo,
    startDraw,
    applyRelaxation,
    poolIsStale,
    respin,
    accept,
    blockCurrent,
    reportClosed,
  }
}
