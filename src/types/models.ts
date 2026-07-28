import type { CuisineId } from '@/lib/places/cuisines'
import type { BudgetWindow } from '@/lib/format/price'

export interface LatLng {
  lat: number
  lng: number
}

export interface MoneyLite {
  currencyCode: string
  units: number
}

export type PriceLevel = 1 | 2 | 3 | 4

export type BusinessStatus = 'OPERATIONAL' | 'CLOSED_TEMPORARILY' | 'CLOSED_PERMANENTLY'

/** One opening interval; close missing = open 24 h. Days are JS 0=Sun…6=Sat. */
export interface OpenPeriod {
  open: { day: number; hour: number; minute: number }
  close?: { day: number; hour: number; minute: number }
}

/**
 * Provider-agnostic restaurant shape. This exact object is snapshotted into
 * draw history, so keep it JSON-serializable and additive-only.
 */
export interface Restaurant {
  id: string
  name: string
  location: LatLng
  address?: string
  types: string[]
  primaryType?: string
  rating?: number
  userRatingCount?: number
  priceLevel?: PriceLevel
  priceRange?: { start?: MoneyLite; end?: MoneyLite }
  openNow?: boolean
  todayHours?: string
  /** Structured hours for the next week — drives the arrive-at filter */
  openPeriods?: OpenPeriod[]
  photoNames: string[]
  googleMapsUri?: string
  businessStatus?: BusinessStatus
  fetchedAt: number
}

export interface OriginSetting {
  mode: 'gps' | 'picked'
  picked?: { label: string; location: LatLng }
}

/** Every condition supports "Any": empty arrays / null mean unconstrained. */
export interface DrawConditions {
  cuisines: { include: CuisineId[]; exclude: CuisineId[] }
  /** Fine-grained tag ids (keywords.ts) — each adds one Text Search per draw */
  keywords: string[]
  /** Tags to AVOID — no search cost; matched by name/type/diary tags */
  keywordsExclude: string[]
  /** Drop fast-food places (Google's fast_food_restaurant type) */
  noFastFood: boolean
  /** Drop chain restaurants — curated brand list + 2+-branches-in-range evidence */
  noChains: boolean
  /** Per-person spend window in local currency; null = any. Filtered
   *  client-side (the API has no price filter) against a place's explicit
   *  priceRange, its $-level band, or the diner's own diary spend. */
  budgetRange: BudgetWindow | null
  /** Drop places Google has no price data for (off by default — small local
   *  shops often have none and hiding them would bias the wheel) */
  requirePrice: boolean
  radiusMeters: number
  origin: OriginSetting
  /** Metadata + AI hint only — Places cannot filter on it */
  partySize: number
  openNowOnly: boolean
  /** "HH:mm" — only places open at that time pass (openNowOnly off) */
  arriveAt: string | null
  /** "YYYY-MM-DD" future planning: hours checked for that weekday, and the
   *  accepted result is saved as an upcoming plan. Only meaningful with arriveAt. */
  arriveDate: string | null
  minRating: number | null
  /** Don't suggest places accepted within the last N days; null = off */
  excludeRecentDays: number | null
  /** Winner weighting: uniform | favor past favourites | explore new places */
  drawStyle: DrawStyle
}

export type DrawStyle = 'uniform' | 'favor' | 'explore'

/** A saved conditions bundle with a user-chosen label ("公司午餐"…) */
export interface ConditionPreset {
  id: string
  label: string
  conditions: DrawConditions
}

export type DrawAction = 'accepted' | 'respun'

/** Meal slots by local hour — history labelling only (notifications stay
 *  lunch/dinner; nobody wants a push about 宵夜). */
export type Meal = 'breakfast' | 'lunch' | 'tea' | 'dinner' | 'lateNight'

export interface DrawRecord {
  id?: number
  timestamp: number
  meal: Meal
  conditions: DrawConditions
  restaurant: Restaurant
  action: DrawAction
  /** 'group' = from a friends-draw room · 'manual' = diary entry logged by
   *  hand (no draw happened) · absent = solo draw */
  source?: 'group' | 'manual'
  /** Epoch ms of the planned meal (future draws) — shows under 📅 Upcoming
   *  until the time passes, then files into the timeline on that day */
  plannedAt?: number
}

/**
 * The diner's own diary + corrections for one place. Where set, these are
 * treated as a NEWER source of truth than Google data in every future draw.
 */
export interface PlaceNote {
  placeId: string
  name: string
  /** Own rating 1–5 — outranks Google's rating in filters and favor-weights */
  myRating?: number
  /** Food diary free text: what I ate, how it was */
  note?: string
  /** What I actually paid per person — exact (min===max) or a range;
   *  replaces Google's price data in the budget filter */
  spend?: BudgetWindow
  /** Corrected cuisines — replace Google types for include/exclude matching */
  cuisines?: CuisineId[]
  /** Craving tags (keyword tag ids) the diner says fit this place */
  keywords?: string[]
  /** Self-reported permanently closed — hard-filtered from every draw */
  closed?: boolean
  updatedAt: number
}

export type RelaxationKind =
  | 'dropOpenNow'
  | 'dropArriveAt'
  | 'dropMinRating'
  | 'dropBudget'
  | 'dropRequirePrice'
  | 'dropChains'
  | 'dropRecentExclusion'
  | 'widenRadius'

export interface RelaxationSuggestion {
  kind: RelaxationKind
  /** How many places become available after this relaxation (0 for refetch kinds) */
  resultCount: number
  /** True when applying it needs a new provider query (e.g. wider radius) */
  requiresRefetch?: boolean
  nextRadius?: number
}

export interface PlaceSuggestion {
  placeId: string
  label: string
  distanceMeters?: number
}

/** One meal's notification schedule (Phase 2). Times are device-local. */
export interface MealNotifPref {
  enabled: boolean
  /** "HH:mm" */
  time: string
  /** JS weekday numbers, 0 = Sunday … 6 = Saturday */
  days: number[]
}

export interface NotificationPrefs {
  lunch: MealNotifPref
  dinner: MealNotifPref
}
