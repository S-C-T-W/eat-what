import type { AppLocale } from '@/lib/i18n/locales'
import type {
  DrawConditions,
  DrawStyle,
  LatLng,
  PlaceNote,
  Restaurant,
  RelaxationSuggestion,
} from '@/types/models'
import { typesForCuisines, CUISINES } from '@/lib/places/cuisines'
import {
  keywordTagById,
  matchesKeywordTag,
  MAX_KEYWORD_TAGS,
  type KeywordTag,
  tagQuery,
} from '@/lib/places/keywords'
import {
  CHAIN_PATTERNS,
  dedupeBrands,
  isChainBranch,
  isFastFood,
  matchesChainPattern,
  multiBranchBrands,
} from '@/lib/places/chains'
import { isOpenAt, minutesFromHHmm } from '@/lib/places/openingHours'
import type { PlacesProvider } from '@/lib/places/provider'
import { haversineMeters } from '@/lib/geo/distance'
import type { Region } from '@/lib/geo/region'
import { bandWindow, windowsOverlap, type BudgetWindow } from '@/lib/format/price'
import { cryptoRandomInt, shuffle, weightedRandomIndex } from './random'
import { MAX_WHEEL_SEGMENTS, RADIUS_STEPS } from './defaults'
import {
  groupIndexOf,
  inGeometry,
  planCoverage,
  primaryAnchor,
  type Geometry,
} from '@/lib/geo/geometry'
import { suggestRelaxations } from './relaxation'

/** Broad food-type net used when no cuisine is selected ("any cuisine"). */
export const ALL_FOOD_TYPES: string[] = [
  ...new Set([
    'restaurant',
    'food_court',
    'meal_takeaway',
    ...CUISINES.flatMap((c) => c.includedTypes),
  ]),
]

export interface FilterContext {
  origin: LatLng
  region: Region
  blockedIds: ReadonlySet<string>
  recentIds: ReadonlySet<string>
  /** Advanced search shape; absent = classic circle around origin */
  geometry?: Geometry
  /** Diner's own diary corrections by place id — newer truth than Google */
  notes?: ReadonlyMap<string, PlaceNote>
  /** Brand roots seen at 2+ locations in this search — local chain evidence */
  chainBrands?: ReadonlySet<string>
  /** Chain patterns in force (Settings-editable); defaults to the curated list */
  chainPatterns?: readonly string[]
  /** "Today" for the arrive-at weekday; injectable for tests */
  now?: Date
}

export interface FilterOverrides {
  skipOpenNow?: boolean
  skipArriveAt?: boolean
  skipMinRating?: boolean
  skipBudget?: boolean
  skipRequirePrice?: boolean
  skipChains?: boolean
  skipRecent?: boolean
}

/**
 * Did the pool a draw produced still match what the user asks for now?
 * partySize is excluded — it never changes which places qualify.
 */
export function conditionsFingerprint(cond: DrawConditions): string {
  return JSON.stringify({ ...cond, partySize: 0 })
}

/** Origin drift beyond this means the cached pool is describing somewhere else. */
export const STALE_ORIGIN_METERS = 200

/**
 * Radius actually sent to the API / used in cache keys: the free-form slider
 * value snapped UP to the next fetch step, so 900 m and 1 km draws share one
 * cached search instead of each metre minting new billable calls. The 8000
 * step exists for merged coverage circles (multi-spot / corridor).
 */
const FETCH_RADIUS_STEPS = [...RADIUS_STEPS, 8000] as const

export function queryRadiusFor(radiusMeters: number): number {
  return (
    FETCH_RADIUS_STEPS.find((r) => r >= radiusMeters) ??
    FETCH_RADIUS_STEPS[FETCH_RADIUS_STEPS.length - 1]!
  )
}

// Nearby ranking can be fuzzy at the boundary; allow a small grace margin
// instead of dropping borderline places the user would happily walk to.
const RADIUS_GRACE = 1.15

/**
 * A place's per-person money window: diary spend (newest truth) → Google's
 * explicit priceRange → the $-level's regional band. Undefined = no data.
 */
export function placeBudgetWindow(
  r: Restaurant,
  note: PlaceNote | undefined,
  region: Region,
): BudgetWindow | undefined {
  if (note?.spend) return note.spend
  const start = r.priceRange?.start?.units
  const end = r.priceRange?.end?.units
  if (start !== undefined || end !== undefined) {
    return { min: start ?? 0, max: end ?? null }
  }
  if (r.priceLevel) return bandWindow(r.priceLevel, region)
  return undefined
}

export function filterPool(
  raw: readonly Restaurant[],
  cond: DrawConditions,
  ctx: FilterContext,
  o: FilterOverrides = {},
): Restaurant[] {
  const excludedTypes = new Set(typesForCuisines(cond.cuisines.exclude))

  return raw.filter((r) => {
    const note = ctx.notes?.get(r.id)

    // -- hard filters --
    if (r.businessStatus && r.businessStatus !== 'OPERATIONAL') return false
    // Self-reported closure outranks Google still listing it as open
    if (note?.closed) return false
    if (ctx.blockedIds.has(r.id)) return false
    if (!o.skipRecent && cond.excludeRecentDays !== null && ctx.recentIds.has(r.id)) return false
    // Exclusion wins over inclusion (a Korean BBQ place is dropped when
    // "Korean" is excluded even if "BBQ" is included). A diary cuisine
    // correction replaces Google's types for this check — it can rescue a
    // miscategorized place or condemn one Google got wrong.
    if (note?.cuisines?.length) {
      if (note.cuisines.some((id) => cond.cuisines.exclude.includes(id))) return false
    } else if (excludedTypes.size && r.types.some((t) => excludedTypes.has(t))) {
      return false
    }
    // Shape check: the advanced geometry when set, the classic circle otherwise.
    // Grace loosens sizes (radius/width) only — a sector's angle stays hard.
    if (ctx.geometry) {
      if (!inGeometry(r.location, ctx.geometry, RADIUS_GRACE)) return false
    } else if (haversineMeters(ctx.origin, r.location) > cond.radiusMeters * RADIUS_GRACE) {
      return false
    }

    // -- soft filters --
    // Fast food by Google's own typing. The brand pattern list (curated
    // defaults ± user's Settings edits) applies under EITHER toggle; the
    // "2+ branches inside this very search" self-evidence is chain-only.
    if (!o.skipChains && cond.noFastFood && isFastFood(r.types)) return false
    if (!o.skipChains && (cond.noFastFood || cond.noChains)) {
      if (matchesChainPattern(r.name, ctx.chainPatterns ?? CHAIN_PATTERNS)) return false
    }
    if (!o.skipChains && cond.noChains && ctx.chainBrands) {
      if (isChainBranch(r.name, ctx.chainBrands)) return false
    }
    // Craving opt-outs: no search cost — matched by name terms, Table A
    // types, and the diner's own diary craving tags
    if (cond.keywordsExclude?.length) {
      const diaryKeywords = note?.keywords
      const excluded = cond.keywordsExclude.some((id) => {
        const tag = keywordTagById(id)
        return tag !== undefined && matchesKeywordTag(r, tag, diaryKeywords)
      })
      if (excluded) return false
    }
    if (!o.skipOpenNow && cond.openNowOnly && r.openNow !== true) return false
    // Pre-draw for later: drop places whose known hours don't cover the
    // arrival time. Places with no structured hours pass (same philosophy
    // as unknown prices — don't punish sparse data). A planned date picks
    // the weekday; hours repeat weekly so next Monday ≈ this Monday.
    if (!o.skipArriveAt && !cond.openNowOnly && cond.arriveAt) {
      const minutes = minutesFromHHmm(cond.arriveAt)
      if (minutes !== null && r.openPeriods?.length) {
        const when = cond.arriveDate
          ? new Date(`${cond.arriveDate}T12:00:00`)
          : (ctx.now ?? new Date())
        if (!isOpenAt(r.openPeriods, when.getDay(), minutes)) return false
      }
    }
    if (!o.skipMinRating && cond.minRating !== null) {
      const rating = effectiveRating(r.rating, note?.myRating)
      if (rating === undefined || rating < cond.minRating) return false
    }
    // Budget: everything maps into one money window per person — the diary
    // spend (newest truth) beats Google's explicit priceRange, which beats
    // the coarse $-level band. Overlap = the place can fit the wallet.
    const window = placeBudgetWindow(r, note, ctx.region)
    if (!o.skipRequirePrice && cond.requirePrice && !window) return false
    if (!o.skipBudget && cond.budgetRange && window) {
      // Price-unknown places pass — dropping them would bias against small
      // local shops that simply have no price data on Google. (requirePrice
      // above is the explicit opt-in to drop them.)
      if (!windowsOverlap(cond.budgetRange, window)) return false
    }
    return true
  })
}

export interface Selection {
  candidates: Restaurant[]
  winnerIndex: number
}

/**
 * The rating the ★-filter judges by when the diner rated a place themselves.
 * Google's stars are a crowd average compressed into ~3.5–4.5, while a diary
 * star is a personal VERDICT on a 1–5 spread — substituting one for the
 * other made 3★ ("okay") a death sentence. Since v3 `mine` is the AVERAGE
 * across visits, so the bands are continuous:
 *   ≤2.5 condemns (the average IS the score — below every filter choice) ·
 *   2.5–3.5 abstains (the crowd decides) · ≥3.5 endorses (a floor Google
 *   can only raise). Integer verdicts behave exactly as before.
 */
export function effectiveRating(
  google: number | undefined,
  mine: number | undefined,
): number | undefined {
  if (!mine) return google
  if (mine <= 2.5) return mine
  if (mine < 3.5) return google
  return Math.max(google ?? 0, mine)
}

/**
 * Winner weight per restaurant given how often it was accepted before.
 * favor: regulars up to ~4× base chance · explore: never-tried boosted,
 * repeat visits decay · uniform: everything equal.
 */
export function styleWeight(style: DrawStyle, acceptedCount: number): number {
  switch (style) {
    case 'favor':
      return 1 + Math.min(acceptedCount, 4) * 0.75
    case 'explore':
      return acceptedCount === 0 ? 1.5 : 1 / (1 + acceptedCount)
    default:
      return 1
  }
}

/**
 * Pick up to MAX_WHEEL_SEGMENTS candidates (uniformly — every match deserves
 * a wheel slot) and the winner among them, optionally weighted by id.
 * With `groups` (multi-spot / corridor fairness), wheel slots are dealt
 * round-robin across groups so a dense area can't drown out the others.
 */
export function selectCandidates(
  pool: readonly Restaurant[],
  weights?: ReadonlyMap<string, number>,
  groups?: ReadonlyMap<string, number>,
): Selection {
  if (pool.length === 0) return { candidates: [], winnerIndex: -1 }
  let candidates: Restaurant[]
  if (groups && new Set([...groups.values()]).size > 1) {
    const buckets = new Map<number, Restaurant[]>()
    for (const r of shuffle(pool)) {
      const idx = groups.get(r.id) ?? 0
      const bucket = buckets.get(idx) ?? []
      bucket.push(r)
      buckets.set(idx, bucket)
    }
    const rings = [...buckets.values()]
    candidates = []
    for (let round = 0; candidates.length < MAX_WHEEL_SEGMENTS; round++) {
      let dealt = false
      for (const ring of rings) {
        if (round < ring.length && candidates.length < MAX_WHEEL_SEGMENTS) {
          candidates.push(ring[round]!)
          dealt = true
        }
      }
      if (!dealt) break
    }
    candidates = shuffle(candidates)
  } else {
    candidates = shuffle(pool).slice(0, MAX_WHEEL_SEGMENTS)
  }
  if (!weights) return { candidates, winnerIndex: cryptoRandomInt(candidates.length) }
  const winnerIndex = weightedRandomIndex(candidates.map((c) => weights.get(c.id) ?? 1))
  return { candidates, winnerIndex }
}

export interface DrawEngineDeps {
  provider: PlacesProvider
  lang: AppLocale
  region: Region
  blockedIds?: ReadonlySet<string>
  recentIds?: ReadonlySet<string>
  /** Diary corrections by place id (place notes) */
  notes?: ReadonlyMap<string, PlaceNote>
  /** Chain patterns in force (Settings-editable) */
  chainPatterns?: readonly string[]
  /** Advanced search shape (offset/sector/multi/corridor); absent = plain circle */
  geometry?: Geometry
  /** Optional read-through cache (wired in with IndexedDB) */
  cache?: {
    get(key: string): Promise<Restaurant[] | null>
    put(key: string, value: Restaurant[]): Promise<void>
  }
  /** Winner weights by place id (drawStyle favor/explore) */
  weights?: ReadonlyMap<string, number>
  signal?: AbortSignal
}

export interface DrawOutcome {
  /** Everything that passed the filters (kept for re-spins — no refetch) */
  pool: Restaurant[]
  candidates: Restaurant[]
  winnerIndex: number
  relaxations: RelaxationSuggestion[]
}

export function searchCacheKey(
  origin: LatLng,
  cond: DrawConditions,
  lang: string,
  radiusMeters = cond.radiusMeters,
): string {
  const cell = `${origin.lat.toFixed(3)},${origin.lng.toFixed(3)}`
  const include = [...cond.cuisines.include].sort().join('+') || 'any'
  const exclude = [...cond.cuisines.exclude].sort().join('+') || 'none'
  return `${cell}|${queryRadiusFor(radiusMeters)}|${include}|${exclude}|${lang}`
}

/** One cache entry per fine-grained tag — reusable across tag combinations. */
export function keywordCacheKey(
  origin: LatLng,
  radiusMeters: number,
  tagId: string,
  lang: string,
): string {
  const cell = `${origin.lat.toFixed(3)},${origin.lng.toFixed(3)}`
  return `kw|${cell}|${radiusMeters}|${tagId}|${lang}`
}

async function fetchNearby(
  cond: DrawConditions,
  origin: LatLng,
  deps: DrawEngineDeps,
  radiusMeters = cond.radiusMeters,
): Promise<Restaurant[]> {
  const includedTypes = cond.cuisines.include.length
    ? typesForCuisines(cond.cuisines.include)
    : ALL_FOOD_TYPES
  // Server-side exclusion must not overlap inclusion (API rejects conflicts);
  // the client backstop in filterPool still enforces the full exclusion.
  const includedSet = new Set(includedTypes)
  const excludedTypes = typesForCuisines(cond.cuisines.exclude).filter((t) => !includedSet.has(t))

  const key = searchCacheKey(origin, cond, deps.lang, radiusMeters)
  const cached = await deps.cache?.get(key)
  if (cached) return cached
  const results = await deps.provider.searchNearby(
    {
      origin,
      radiusMeters: queryRadiusFor(radiusMeters),
      includedTypes,
      excludedTypes: excludedTypes.length ? excludedTypes : undefined,
      languageCode: deps.lang,
      maxResults: 20,
    },
    deps.signal,
  )
  await deps.cache?.put(key, results)
  return results
}

async function fetchKeyword(
  tag: KeywordTag,
  cond: DrawConditions,
  origin: LatLng,
  deps: DrawEngineDeps,
): Promise<Restaurant[]> {
  const key = keywordCacheKey(origin, queryRadiusFor(cond.radiusMeters), tag.id, deps.lang)
  const cached = await deps.cache?.get(key)
  if (cached) return cached
  const results = await deps.provider.searchText(
    {
      query: tagQuery(tag, deps.lang),
      origin,
      radiusMeters: queryRadiusFor(cond.radiusMeters),
      languageCode: deps.lang,
      maxResults: 20,
    },
    deps.signal,
  )
  await deps.cache?.put(key, results)
  return results
}

export async function runDraw(
  cond: DrawConditions,
  origin: LatLng,
  deps: DrawEngineDeps,
): Promise<DrawOutcome> {
  const tags = (cond.keywords ?? [])
    .map(keywordTagById)
    .filter((t): t is KeywordTag => t !== undefined)
    .slice(0, MAX_KEYWORD_TAGS)

  // Advanced geometry expands to ≤3 planned fetch circles; the classic
  // circle is one. Fine tags act as extra "include" selections anchored at
  // the shape's primary point (the user's decision: tags search spot #1
  // only). Tags alone ⇒ tag results only — a generic nearby sweep would
  // drown 茶餐廳 hits in everything else.
  const circles = deps.geometry
    ? planCoverage(deps.geometry)
    : [{ center: origin, radius: cond.radiusMeters }]
  const anchor = deps.geometry ? primaryAnchor(deps.geometry) : origin

  const searches: Promise<Restaurant[]>[] = []
  if (cond.cuisines.include.length > 0 || tags.length === 0) {
    for (const circle of circles) {
      searches.push(fetchNearby(cond, circle.center, deps, circle.radius))
    }
  }
  for (const tag of tags) searches.push(fetchKeyword(tag, cond, anchor, deps))

  const seen = new Set<string>()
  const raw = (await Promise.all(searches)).flat().filter((r) => {
    if (seen.has(r.id)) return false
    seen.add(r.id)
    return true
  })

  const ctx: FilterContext = {
    origin,
    region: deps.region,
    blockedIds: deps.blockedIds ?? new Set(),
    recentIds: deps.recentIds ?? new Set(),
    geometry: deps.geometry,
    notes: deps.notes,
    chainBrands: multiBranchBrands(raw),
    chainPatterns: deps.chainPatterns,
  }

  // One wheel slot per brand, nearest branch wins — three McDonald's at
  // three addresses is one option, not three (field-reported).
  const pool = dedupeBrands(filterPool(raw, cond, ctx), origin)
  if (pool.length === 0) {
    return {
      pool,
      candidates: [],
      winnerIndex: -1,
      relaxations: suggestRelaxations(raw, cond, ctx),
    }
  }
  // Multi-spot / corridor: deal wheel slots round-robin across spots/thirds
  const groups = deps.geometry
    ? new Map(pool.map((r) => [r.id, groupIndexOf(r.location, deps.geometry!)]))
    : undefined
  const { candidates, winnerIndex } = selectCandidates(pool, deps.weights, groups)
  return { pool, candidates, winnerIndex, relaxations: [] }
}
