import type { LatLng, PlaceSuggestion, Restaurant } from '@/types/models'
import type { AppLocale } from '@/lib/i18n/locales'

export interface SearchNearbyParams {
  origin: LatLng
  radiusMeters: number
  /** Places Table A type values; required in practice — pass ALL_FOOD_TYPES for "any" */
  includedTypes: string[]
  excludedTypes?: string[]
  languageCode: AppLocale
  regionCode?: string
  maxResults?: number
}

export interface SearchTextParams {
  /** Free-text query, e.g. 茶餐廳 — for tags Table A types can't express */
  query: string
  /** Bias circle only — results can fall outside; the engine re-checks radius */
  origin: LatLng
  radiusMeters: number
  languageCode: AppLocale
  regionCode?: string
  maxResults?: number
}

export interface AutocompleteParams {
  input: string
  sessionToken: string
  biasCenter?: LatLng
  biasRadiusMeters?: number
  languageCode: string
  includedRegionCodes?: string[]
}

export interface PlacesProvider {
  readonly kind: 'google' | 'mock'
  searchNearby(params: SearchNearbyParams, signal?: AbortSignal): Promise<Restaurant[]>
  searchText(params: SearchTextParams, signal?: AbortSignal): Promise<Restaurant[]>
  autocomplete(params: AutocompleteParams, signal?: AbortSignal): Promise<PlaceSuggestion[]>
  resolvePlaceLocation(
    placeId: string,
    sessionToken: string,
  ): Promise<{ location: LatLng; label: string }>
  /** Pure URL builder; null when the provider has no photos (demo mode). */
  photoUrl(photoName: string, maxWidthPx: number): string | null
}
