import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'

import type { Restaurant } from '@/types/models'
import { makeDefaultConditions } from '@/lib/draw/defaults'
import { EatWhatDB } from './schema'
import { createBlocklistRepo, createHistoryRepo, mealForHour } from './historyRepo'

let seq = 0
const dbs: EatWhatDB[] = []
function freshDb(): EatWhatDB {
  const db = new EatWhatDB(`hist-${Date.now()}-${seq++}`)
  dbs.push(db)
  return db
}
afterEach(async () => {
  for (const db of dbs.splice(0)) await db.delete()
})

function restaurant(id: string, types: string[] = ['cantonese_restaurant']): Restaurant {
  return {
    id,
    name: `R-${id}`,
    location: { lat: 22.28, lng: 114.16 },
    types,
    photoNames: [],
    fetchedAt: 0,
  }
}

describe('mealForHour', () => {
  it('covers the full HK day: 早餐 → 午餐 → 下午茶 → 晚餐 → 宵夜', () => {
    expect(mealForHour(5)).toBe('breakfast')
    expect(mealForHour(8)).toBe('breakfast')
    expect(mealForHour(10)).toBe('breakfast')
    expect(mealForHour(11)).toBe('lunch')
    expect(mealForHour(14)).toBe('lunch')
    expect(mealForHour(15)).toBe('tea')
    expect(mealForHour(17)).toBe('tea')
    expect(mealForHour(18)).toBe('dinner')
    expect(mealForHour(21)).toBe('dinner')
    expect(mealForHour(22)).toBe('lateNight')
    expect(mealForHour(2)).toBe('lateNight')
    expect(mealForHour(4)).toBe('lateNight')
  })
})

describe('historyRepo', () => {
  it('records accepted draws and groups them by day (newest first)', async () => {
    let t = new Date('2026-07-04T12:00:00').getTime()
    const repo = createHistoryRepo(freshDb(), () => t)
    await repo.addAccepted(restaurant('a'), makeDefaultConditions())
    t = new Date('2026-07-05T19:00:00').getTime()
    await repo.addAccepted(restaurant('b'), makeDefaultConditions())
    t = new Date('2026-07-05T12:30:00').getTime()
    await repo.addAccepted(restaurant('c'), makeDefaultConditions())

    const groups = await repo.listGroupedByDay()
    expect(groups.map((g) => g.day)).toEqual(['2026-07-05', '2026-07-04'])
    expect(groups[0]!.records.map((r) => r.restaurant.id)).toEqual(['b', 'c'])
    expect(groups[0]!.records[0]!.meal).toBe('dinner')
    expect(groups[1]!.records[0]!.meal).toBe('lunch')
  })

  it('reports recently accepted place ids within the window', async () => {
    let t = 10 * 24 * 60 * 60 * 1000
    const repo = createHistoryRepo(freshDb(), () => t)
    await repo.addAccepted(restaurant('old'), makeDefaultConditions())
    t += 8 * 24 * 60 * 60 * 1000
    await repo.addAccepted(restaurant('recent'), makeDefaultConditions())
    t += 1000

    const ids = await repo.recentAcceptedPlaceIds(7)
    expect(ids.has('recent')).toBe(true)
    expect(ids.has('old')).toBe(false)
  })

  it('computes top cuisines', async () => {
    const repo = createHistoryRepo(freshDb(), () => 1)
    await repo.addAccepted(restaurant('a', ['cantonese_restaurant']), makeDefaultConditions())
    await repo.addAccepted(restaurant('b', ['cantonese_restaurant']), makeDefaultConditions())
    await repo.addAccepted(restaurant('c', ['ramen_restaurant']), makeDefaultConditions())
    const top = await repo.topCuisines(2)
    expect(top[0]).toMatchObject({ id: 'cantonese', count: 2 })
    expect(top[1]).toMatchObject({ id: 'japanese', count: 1 })
  })

  it('exports and clears', async () => {
    const db = freshDb()
    const repo = createHistoryRepo(db, () => 1)
    const block = createBlocklistRepo(db, () => 1)
    await repo.addAccepted(restaurant('a'), makeDefaultConditions())
    await block.add('bad-place', 'Bad Place')
    const json = JSON.parse(await repo.exportJson()) as { draws: unknown[]; blocklist: unknown[] }
    expect(json.draws).toHaveLength(1)
    expect(json.blocklist).toHaveLength(1)
    await repo.clearAll()
    expect(await repo.count()).toBe(0)
  })
})

describe('historyRepo planned draws', () => {
  it('future plans live in upcoming(), not the timeline', async () => {
    let t = new Date('2026-07-10T15:00:00').getTime()
    const repo = createHistoryRepo(freshDb(), () => t)
    await repo.addAccepted(restaurant('now'), makeDefaultConditions())
    const monday = new Date('2026-07-13T19:00:00').getTime()
    await repo.addAccepted(restaurant('plan'), makeDefaultConditions(), { plannedAt: monday })

    const up = await repo.upcoming()
    expect(up.map((r) => r.restaurant.id)).toEqual(['plan'])
    expect(up[0]!.meal).toBe('dinner') // meal derived from the planned hour
    const groups = await repo.listGroupedByDay()
    expect(groups.flatMap((g) => g.records.map((r) => r.restaurant.id))).toEqual(['now'])

    // …until the day passes: then it files under the PLANNED day
    t = new Date('2026-07-14T09:00:00').getTime()
    expect(await repo.upcoming()).toHaveLength(0)
    const later = await repo.listGroupedByDay()
    expect(later.map((g) => g.day)).toEqual(['2026-07-13', '2026-07-10'])
    expect(later[0]!.records[0]!.restaurant.id).toBe('plan')
  })

  it('manual entries backdate: timestamp, meal slot and day all follow `at`', async () => {
    const nowTs = new Date('2026-07-12T20:00:00').getTime()
    const repo = createHistoryRepo(freshDb(), () => nowTs)
    const yesterdayTea = new Date('2026-07-11T15:30:00').getTime()
    await repo.addAccepted(restaurant('m'), makeDefaultConditions(), {
      source: 'manual',
      at: yesterdayTea,
    })
    const groups = await repo.listGroupedByDay()
    expect(groups[0]!.day).toBe('2026-07-11')
    const rec = groups[0]!.records[0]!
    expect(rec.timestamp).toBe(yesterdayTea)
    expect(rec.meal).toBe('tea')
    expect(rec.source).toBe('manual')
    // backdated meals count for the recent-exclusion window
    expect((await repo.recentAcceptedPlaceIds(3)).has('m')).toBe(true)
  })

  it('group source and plannedAt persist together', async () => {
    const t = new Date('2026-07-10T15:00:00').getTime()
    const repo = createHistoryRepo(freshDb(), () => t)
    await repo.addAccepted(restaurant('g'), makeDefaultConditions(), {
      source: 'group',
      plannedAt: t + 60 * 60 * 1000,
    })
    const up = await repo.upcoming()
    expect(up[0]!.source).toBe('group')
    expect(up[0]!.plannedAt).toBe(t + 60 * 60 * 1000)
  })
})

describe('per-visit diary (v3)', () => {
  it('each visit keeps its own diary; the place aggregates to an average', async () => {
    let t = new Date('2026-08-01T12:00:00').getTime()
    const repo = createHistoryRepo(freshDb(), () => t)
    const id1 = await repo.addAccepted(restaurant('a'), makeDefaultConditions())
    t = new Date('2026-08-10T12:00:00').getTime()
    const id2 = await repo.addAccepted(restaurant('a'), makeDefaultConditions())
    await repo.setDiary(id1, { rating: 5, note: '牛腩麵正', spend: { min: 60, max: 60 } })
    await repo.setDiary(id2, { rating: 2, note: '水準跌咗' })

    const stats = (await repo.diaryStatsByPlaceId()).get('a')!
    expect(stats.avgRating).toBeCloseTo(3.5)
    expect(stats.ratedVisits).toBe(2)
    expect(stats.latestNote).toBe('水準跌咗')
    expect(stats.latestSpend).toEqual({ min: 60, max: 60 }) // latest with spend

    // clearing one visit's diary re-averages
    await repo.setDiary(id2, null)
    const after = (await repo.diaryStatsByPlaceId()).get('a')!
    expect(after.avgRating).toBe(5)
    expect(after.ratedVisits).toBe(1)
  })
})

describe('v2 → v3 migration', () => {
  it('moves legacy per-place diary onto the newest record, keeps place fields', async () => {
    const name = `mig-${Date.now()}`
    // build a v2 database shape
    const { default: Dexie } = await import('dexie')
    const v2 = new Dexie(name)
    v2.version(1).stores({
      draws: '++id, timestamp, restaurant.id, action',
      searchCache: 'key, fetchedAt',
      placeCache: 'id, fetchedAt',
      blocklist: 'placeId',
    })
    v2.version(2).stores({ placeNotes: 'placeId' })
    await v2.open()
    await v2.table('draws').add({
      timestamp: 100,
      meal: 'lunch',
      conditions: makeDefaultConditions(),
      restaurant: restaurant('p1'),
      action: 'accepted',
    })
    await v2.table('draws').add({
      timestamp: 200,
      meal: 'dinner',
      conditions: makeDefaultConditions(),
      restaurant: restaurant('p1'),
      action: 'accepted',
    })
    await v2.table('placeNotes').put({
      placeId: 'p1',
      name: 'R-p1',
      myRating: 4,
      note: '炒飯好食',
      spend: { min: 80, max: 80 },
      cuisines: ['cantonese'],
      updatedAt: 1,
    })
    v2.close()

    // opening with the real schema runs the v3 upgrade
    const db = new EatWhatDB(name)
    dbs.push(db)
    const recs = await db.draws.where('restaurant.id').equals('p1').toArray()
    const newest = recs.sort((a, b) => b.timestamp - a.timestamp)[0]!
    expect(newest.diary).toEqual({ rating: 4, note: '炒飯好食', spend: { min: 80, max: 80 } })
    expect(recs.find((r) => r.timestamp === 100)!.diary).toBeUndefined()
    const note = await db.placeNotes.get('p1')
    expect(note?.cuisines).toEqual(['cantonese'])
    expect(note?.myRating).toBeUndefined()
  })
})

describe('blocklistRepo', () => {
  it('adds, lists, removes and reports ids', async () => {
    const repo = createBlocklistRepo(freshDb(), () => 1)
    await repo.add('p1', 'Nope Diner')
    await repo.add('p2', 'Never Again')
    expect((await repo.ids()).has('p1')).toBe(true)
    await repo.remove('p1')
    expect((await repo.ids()).has('p1')).toBe(false)
    expect(await repo.list()).toHaveLength(1)
  })
})
