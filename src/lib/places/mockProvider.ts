import type { LatLng, PlaceSuggestion, Restaurant } from '@/types/models'
import type {
  AutocompleteParams,
  PlacesProvider,
  SearchNearbyParams,
  SearchTextParams,
} from './provider'
import { haversineMeters } from '@/lib/geo/distance'
import { type AppLocale, isChinese } from '@/lib/i18n/locales'

export const DEMO_ORIGIN: LatLng = { lat: 22.2819, lng: 114.158 }
export const DEMO_ORIGIN_LABEL = { en: 'Central, Hong Kong', zh: '香港中環' }
export function demoOriginLabel(locale: string): string {
  return isChinese(locale) ? DEMO_ORIGIN_LABEL.zh : DEMO_ORIGIN_LABEL.en
}

interface Fixture {
  id: string
  en: string
  zh: string
  lat: number
  lng: number
  types: string[]
  rating?: number
  count?: number
  level?: 1 | 2 | 3 | 4
  rangeHKD?: [number, number]
  open?: boolean
  hours?: string
  status?: Restaurant['businessStatus']
}

// Fictional demo restaurants scattered around Central / Sheung Wan / TST.
// Deliberately messy like real Google data: some have no price, no rating,
// one is temporarily closed, a few sit outside a 1 km radius.
const FIXTURES: Fixture[] = [
  {
    id: 'm01',
    en: 'Golden Roast',
    zh: '金華燒味',
    lat: 22.2836,
    lng: 114.1562,
    types: ['cantonese_restaurant', 'restaurant'],
    rating: 4.4,
    count: 1823,
    level: 1,
    open: true,
    hours: '10:00–21:30',
  },
  {
    id: 'm02',
    en: 'Lung Kee Cha Chaan Teng',
    zh: '龍記冰室',
    lat: 22.2851,
    lng: 114.1543,
    types: ['cantonese_restaurant', 'breakfast_restaurant', 'restaurant'],
    rating: 4.1,
    count: 967,
    open: true,
    hours: '07:00–19:00',
  },
  {
    id: 'm03',
    en: 'Menya Isshin',
    zh: '麵屋一心',
    lat: 22.2809,
    lng: 114.1553,
    types: ['ramen_restaurant', 'japanese_restaurant', 'restaurant'],
    rating: 4.5,
    count: 2210,
    level: 2,
    open: true,
    hours: '11:30–22:00',
  },
  {
    id: 'm04',
    en: 'Sushi Den',
    zh: '壽司田',
    lat: 22.2798,
    lng: 114.1571,
    types: ['sushi_restaurant', 'japanese_restaurant', 'restaurant'],
    rating: 4.6,
    count: 1345,
    level: 3,
    rangeHKD: [250, 480],
    open: true,
    hours: '12:00–22:30',
  },
  {
    id: 'm05',
    en: 'Hanjung BBQ',
    zh: '韓亭燒肉',
    lat: 22.2827,
    lng: 114.1602,
    types: ['korean_barbecue_restaurant', 'korean_restaurant', 'restaurant'],
    rating: 4.3,
    count: 890,
    level: 3,
    open: true,
    hours: '17:30–23:00',
  },
  {
    id: 'm06',
    en: 'Baan Thai',
    zh: '泰香',
    lat: 22.2843,
    lng: 114.1611,
    types: ['thai_restaurant', 'restaurant'],
    rating: 4.2,
    count: 743,
    level: 2,
    open: true,
    hours: '11:00–22:00',
  },
  {
    id: 'm07',
    en: 'Saigon River',
    zh: '西貢河',
    lat: 22.2862,
    lng: 114.1528,
    types: ['vietnamese_restaurant', 'restaurant'],
    rating: 4.0,
    count: 512,
    level: 1,
    rangeHKD: [55, 95],
    open: true,
    hours: '11:00–21:00',
  },
  {
    id: 'm08',
    en: 'Bombay Pavilion',
    zh: '孟買閣',
    lat: 22.2812,
    lng: 114.1618,
    types: ['indian_restaurant', 'restaurant'],
    rating: 4.4,
    count: 1102,
    level: 2,
    open: true,
    hours: '11:30–22:30',
  },
  {
    id: 'm09',
    en: 'Trattoria Nonna',
    zh: '意婆婆小館',
    lat: 22.2805,
    lng: 114.1539,
    types: ['italian_restaurant', 'restaurant'],
    rating: 4.5,
    count: 987,
    level: 3,
    open: true,
    hours: '12:00–22:00',
  },
  {
    id: 'm10',
    en: 'Le Petit Jardin',
    zh: '小花園法菜',
    lat: 22.2793,
    lng: 114.1585,
    types: ['french_restaurant', 'fine_dining_restaurant', 'restaurant'],
    rating: 4.7,
    count: 654,
    level: 4,
    rangeHKD: [680, 1280],
    open: false,
    hours: '18:30–23:00',
  },
  {
    id: 'm11',
    en: 'Ah Mei Diner',
    zh: '阿美茶餐廳',
    lat: 22.2874,
    lng: 114.1508,
    types: ['cantonese_restaurant', 'diner', 'restaurant'],
    rating: 3.9,
    count: 2301,
    level: 1,
    open: true,
    hours: '06:30–20:00',
  },
  {
    id: 'm12',
    en: 'Burger Dept.',
    zh: '漢堡部',
    lat: 22.2831,
    lng: 114.1589,
    types: ['hamburger_restaurant', 'fast_food_restaurant', 'restaurant'],
    rating: 4.1,
    count: 1560,
    level: 1,
    open: true,
    hours: '10:00–23:00',
  },
  {
    id: 'm13',
    en: 'Ocean Emperor Seafood',
    zh: '海皇漁港',
    lat: 22.2856,
    lng: 114.1633,
    types: ['seafood_restaurant', 'cantonese_restaurant', 'restaurant'],
    rating: 4.2,
    count: 876,
    level: 4,
    rangeHKD: [420, 880],
    open: true,
    hours: '11:00–23:00',
  },
  {
    id: 'm14',
    en: 'Sichuan House',
    zh: '川湘居',
    lat: 22.2789,
    lng: 114.1557,
    types: ['chinese_restaurant', 'restaurant'],
    rating: 4.3,
    count: 1230,
    level: 2,
    open: true,
    hours: '11:00–22:00',
  },
  {
    id: 'm15',
    en: 'Green Fields',
    zh: '綠田園',
    lat: 22.2825,
    lng: 114.1532,
    types: ['vegetarian_restaurant', 'restaurant'],
    rating: 4.4,
    count: 445,
    level: 2,
    open: false,
    hours: '11:00–20:00',
  },
  {
    id: 'm16',
    en: 'Taco Loco',
    zh: '狂想墨西哥',
    lat: 22.2841,
    lng: 114.1575,
    types: ['mexican_restaurant', 'restaurant'],
    rating: 4.0,
    count: 389,
    level: 2,
    open: false,
    hours: '12:00–21:30',
  },
  {
    id: 'm17',
    en: 'Beirut Grill',
    zh: '貝魯特烤爐',
    lat: 22.2807,
    lng: 114.1606,
    types: ['middle_eastern_restaurant', 'restaurant'],
    rating: 4.3,
    count: 267,
    level: 2,
    open: true,
    hours: '11:30–22:00',
  },
  {
    id: 'm18',
    en: 'Sweetheart Atelier',
    zh: '甜心工房',
    lat: 22.2848,
    lng: 114.1556,
    types: ['dessert_shop', 'bakery'],
    rating: 4.6,
    count: 1876,
    level: 1,
    open: true,
    hours: '10:00–22:00',
  },
  {
    id: 'm19',
    en: 'Kopi & Toast',
    zh: '咖啡多士坊',
    lat: 22.2816,
    lng: 114.1544,
    types: ['cafe', 'coffee_shop', 'brunch_restaurant'],
    rating: 4.2,
    count: 734,
    level: 1,
    open: true,
    hours: '08:00–18:00',
  },
  {
    id: 'm20',
    en: 'Taipei Night Bites',
    zh: '台北夜宵',
    lat: 22.2833,
    lng: 114.1623,
    types: ['taiwanese_restaurant', 'restaurant'],
    rating: 4.1,
    count: 656,
    rangeHKD: [60, 120],
    open: true,
    hours: '12:00–23:30',
  },
  {
    id: 'm21',
    en: 'Old Beijing',
    zh: '老北京',
    lat: 22.2796,
    lng: 114.1613,
    types: ['chinese_restaurant', 'chinese_noodle_restaurant', 'restaurant'],
    rating: 3.7,
    count: 892,
    level: 2,
    open: true,
    hours: '11:00–21:30',
  },
  {
    id: 'm22',
    en: 'Nyonya Corner',
    zh: '星馬香',
    lat: 22.2867,
    lng: 114.1595,
    types: ['malaysian_restaurant', 'restaurant'],
    rating: 4.2,
    count: 478,
    level: 2,
    open: true,
    hours: '11:00–21:00',
  },
  {
    id: 'm23',
    en: 'Sumibi Yakitori',
    zh: '炭火燒鳥',
    lat: 22.2802,
    lng: 114.1596,
    types: ['japanese_izakaya_restaurant', 'japanese_restaurant', 'restaurant'],
    rating: 4.5,
    count: 567,
    level: 3,
    open: false,
    hours: '18:00–00:00',
  },
  {
    id: 'm24',
    en: 'The Chop House',
    zh: '牛排工房',
    lat: 22.2839,
    lng: 114.1547,
    types: ['steak_house', 'western_restaurant', 'restaurant'],
    rating: 4.6,
    count: 1034,
    level: 4,
    rangeHKD: [520, 950],
    open: true,
    hours: '12:00–23:00',
  },
  {
    id: 'm25',
    en: 'Congee & Noodle House',
    zh: '粥麵世家',
    lat: 22.2858,
    lng: 114.1571,
    types: ['noodle_shop', 'cantonese_restaurant', 'restaurant'],
    rating: 4.2,
    count: 1489,
    open: true,
    hours: '07:00–21:00',
  },
  {
    id: 'm26',
    en: 'Bella Pizza',
    zh: '貝拉薄餅',
    lat: 22.2871,
    lng: 114.1552,
    types: ['pizza_restaurant', 'italian_restaurant', 'restaurant'],
    rating: 3.9,
    count: 623,
    level: 2,
    open: true,
    hours: '11:30–22:30',
  },
  {
    id: 'm27',
    en: 'Lanzhou Pull Noodles',
    zh: '蘭州拉麵',
    lat: 22.2785,
    lng: 114.1594,
    types: ['chinese_noodle_restaurant', 'noodle_shop', 'restaurant'],
    rating: 4.0,
    count: 856,
    level: 1,
    open: true,
    hours: '10:30–21:00',
  },
  {
    id: 'm28',
    en: 'Jade Garden Social',
    zh: '翠園小聚',
    lat: 22.2823,
    lng: 114.1567,
    types: ['cantonese_restaurant', 'restaurant'],
    rating: 4.3,
    count: 712,
    level: 3,
    open: true,
    hours: '11:00–22:00',
    status: 'CLOSED_TEMPORARILY',
  },
  // Farther out — only reachable with a bigger radius
  {
    id: 'm29',
    en: 'Harbour Ramen',
    zh: '海港拉麵',
    lat: 22.2963,
    lng: 114.1717,
    types: ['ramen_restaurant', 'japanese_restaurant', 'restaurant'],
    rating: 4.4,
    count: 998,
    level: 2,
    open: true,
    hours: '11:00–22:00',
  },
  {
    id: 'm30',
    en: 'Bay Dim Sum Palace',
    zh: '灣景點心皇',
    lat: 22.2799,
    lng: 114.1861,
    types: ['cantonese_restaurant', 'restaurant'],
    rating: 4.5,
    count: 2450,
    level: 2,
    open: true,
    hours: '09:00–21:30',
  },
]

function toRestaurant(f: Fixture, lang: AppLocale): Restaurant {
  const zh = isChinese(lang)
  return {
    id: f.id,
    name: zh ? f.zh : f.en,
    location: { lat: f.lat, lng: f.lng },
    address: zh ? '香港中環（示範資料）' : 'Central, Hong Kong (demo data)',
    types: f.types,
    primaryType: f.types[0],
    rating: f.rating,
    userRatingCount: f.count,
    priceLevel: f.level,
    priceRange: f.rangeHKD
      ? {
          start: { currencyCode: 'HKD', units: f.rangeHKD[0] },
          end: { currencyCode: 'HKD', units: f.rangeHKD[1] },
        }
      : undefined,
    openNow: f.open,
    todayHours: f.hours,
    photoNames: [],
    businessStatus: f.status ?? 'OPERATIONAL',
    fetchedAt: Date.now(),
  }
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export const mockProvider: PlacesProvider = {
  kind: 'mock',

  async searchNearby(params: SearchNearbyParams): Promise<Restaurant[]> {
    await delay(350 + Math.random() * 250)
    const included = new Set(params.includedTypes)
    const excluded = new Set(params.excludedTypes ?? [])
    return FIXTURES.filter((f) => {
      if (haversineMeters(params.origin, { lat: f.lat, lng: f.lng }) > params.radiusMeters) {
        return false
      }
      if (!f.types.some((t) => included.has(t))) return false
      if (f.types.some((t) => excluded.has(t))) return false
      return true
    })
      .slice(0, params.maxResults ?? 20)
      .map((f) => toRestaurant(f, params.languageCode))
  },

  async searchText(params: SearchTextParams): Promise<Restaurant[]> {
    await delay(300 + Math.random() * 200)
    // Demo mode has no text index — return an in-radius slice so the
    // fine-tag flow stays demoable end to end
    return FIXTURES.filter(
      (f) => haversineMeters(params.origin, { lat: f.lat, lng: f.lng }) <= params.radiusMeters * 2,
    )
      .slice(0, Math.min(params.maxResults ?? 8, 8))
      .map((f) => toRestaurant(f, params.languageCode))
  },

  async autocomplete(params: AutocompleteParams): Promise<PlaceSuggestion[]> {
    await delay(150)
    const q = params.input.trim().toLowerCase()
    if (!q) return []
    return [
      {
        placeId: 'demo-central',
        label: isChinese(params.languageCode) ? '香港中環' : 'Central, Hong Kong',
      },
      { placeId: 'demo-tst', label: isChinese(params.languageCode) ? '尖沙咀' : 'Tsim Sha Tsui' },
    ].filter((s) => s.label.toLowerCase().includes(q) || true)
  },

  async resolvePlaceLocation(placeId: string) {
    await delay(100)
    if (placeId === 'demo-tst') {
      return { location: { lat: 22.2976, lng: 114.1722 }, label: 'Tsim Sha Tsui' }
    }
    return { location: DEMO_ORIGIN, label: 'Central, Hong Kong' }
  },

  photoUrl() {
    return null
  },
}
