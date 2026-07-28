import type { DrawConditions, DrawRecord, Meal, Restaurant } from '@/types/models'
import { cuisinesOfTypes } from '@/lib/places/cuisines'
import type { BlockRow, EatWhatDB } from './schema'

/** Which meal a local hour belongs to — HK rhythm: 早餐 → 午餐 → 下午茶 → 晚餐 → 宵夜. */
export function mealForHour(hour: number): Meal {
  if (hour >= 5 && hour <= 10) return 'breakfast'
  if (hour >= 11 && hour <= 14) return 'lunch'
  if (hour >= 15 && hour <= 17) return 'tea'
  if (hour >= 18 && hour <= 21) return 'dinner'
  return 'lateNight'
}

export interface DayGroup {
  /** local date key YYYY-MM-DD */
  day: string
  records: DrawRecord[]
}

function dayKey(ts: number): string {
  const d = new Date(ts)
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

export interface AddAcceptedOpts {
  source?: 'group' | 'manual'
  /** Epoch ms of the planned meal (future draws) */
  plannedAt?: number
  /** Backdate the record (manual diary entries): becomes the timestamp,
   *  drives the meal slot and the day it files under */
  at?: number
}

/** When the meal actually happens: the planned slot if any, else accept time. */
export function effectiveTs(rec: Pick<DrawRecord, 'timestamp' | 'plannedAt'>): number {
  return rec.plannedAt ?? rec.timestamp
}

export function createHistoryRepo(db: EatWhatDB, now: () => number = Date.now) {
  return {
    async addAccepted(
      restaurant: Restaurant,
      conditions: DrawConditions,
      opts: AddAcceptedOpts = {},
    ): Promise<void> {
      const ts = opts.at ?? now()
      const mealTs = opts.plannedAt ?? ts
      await db.draws.add({
        timestamp: ts,
        meal: mealForHour(new Date(mealTs).getHours()),
        conditions: JSON.parse(JSON.stringify(conditions)) as DrawConditions,
        restaurant: JSON.parse(JSON.stringify(restaurant)) as Restaurant,
        action: 'accepted',
        ...(opts.source ? { source: opts.source } : {}),
        ...(opts.plannedAt ? { plannedAt: opts.plannedAt } : {}),
      })
    },

    async remove(id: number): Promise<void> {
      await db.draws.delete(id)
    },

    /**
     * Timeline, grouped by the day the meal happens (planned day for future
     * draws). Plans still in the future live in upcoming(), not here.
     */
    async listGroupedByDay(limit = 200): Promise<DayGroup[]> {
      const nowTs = now()
      // Only records still PLANNED for the future move out (to upcoming());
      // ordinary records always stay, whatever the clock says.
      const records = (await db.draws.orderBy('timestamp').reverse().limit(limit).toArray())
        .filter((rec) => !(rec.plannedAt && rec.plannedAt > nowTs))
        .sort((a, b) => effectiveTs(b) - effectiveTs(a))
      const groups: DayGroup[] = []
      for (const rec of records) {
        const day = dayKey(effectiveTs(rec))
        const last = groups[groups.length - 1]
        if (last && last.day === day) last.records.push(rec)
        else groups.push({ day, records: [rec] })
      }
      return groups
    },

    /** Planned draws whose time hasn't passed yet, soonest first. */
    async upcoming(): Promise<DrawRecord[]> {
      const nowTs = now()
      const records = await db.draws.toArray()
      return records
        .filter((rec) => (rec.plannedAt ?? 0) > nowTs)
        .sort((a, b) => a.plannedAt! - b.plannedAt!)
    },

    async recentAcceptedPlaceIds(days: number): Promise<Set<string>> {
      const cutoff = now() - days * 24 * 60 * 60 * 1000
      const records = await db.draws.where('timestamp').above(cutoff).toArray()
      return new Set(records.filter((r) => r.action === 'accepted').map((r) => r.restaurant.id))
    },

    /** How often each place was accepted recently — drives drawStyle weights. */
    async acceptedCountsByPlaceId(days = 90): Promise<Map<string, number>> {
      const cutoff = now() - days * 24 * 60 * 60 * 1000
      const records = await db.draws.where('timestamp').above(cutoff).toArray()
      const counts = new Map<string, number>()
      for (const rec of records) {
        if (rec.action !== 'accepted') continue
        counts.set(rec.restaurant.id, (counts.get(rec.restaurant.id) ?? 0) + 1)
      }
      return counts
    },

    async topCuisines(n = 3): Promise<{ id: string; emoji: string; count: number }[]> {
      const records = await db.draws.toArray()
      const counts = new Map<string, { emoji: string; count: number }>()
      for (const rec of records) {
        const cuisine = cuisinesOfTypes(rec.restaurant.types)[0]
        if (!cuisine) continue
        const entry = counts.get(cuisine.id) ?? { emoji: cuisine.emoji, count: 0 }
        entry.count += 1
        counts.set(cuisine.id, entry)
      }
      return [...counts.entries()]
        .map(([id, v]) => ({ id, ...v }))
        .sort((a, b) => b.count - a.count)
        .slice(0, n)
    },

    async count(): Promise<number> {
      return db.draws.count()
    },

    /** Aggregates for the History stats block — one pass over all records. */
    async stats(topN = 5): Promise<{
      total: number
      last30: number
      distinctPlaces: number
      streakDays: number
      topCuisines: { id: string; emoji: string; count: number; share: number }[]
    }> {
      const records = await db.draws.toArray()
      const nowTs = now()
      const cutoff30 = nowTs - 30 * 24 * 60 * 60 * 1000

      const places = new Set<string>()
      const days = new Set<string>()
      const cuisineCounts = new Map<string, { emoji: string; count: number }>()
      let last30 = 0
      for (const rec of records) {
        places.add(rec.restaurant.id)
        days.add(dayKey(rec.timestamp))
        if (rec.timestamp >= cutoff30) last30++
        const cuisine = cuisinesOfTypes(rec.restaurant.types)[0]
        if (cuisine) {
          const entry = cuisineCounts.get(cuisine.id) ?? { emoji: cuisine.emoji, count: 0 }
          entry.count += 1
          cuisineCounts.set(cuisine.id, entry)
        }
      }

      // Streak: consecutive days ending today (or yesterday, so a streak
      // isn't "broken" before today's meal happened)
      let streakDays = 0
      const dayMs = 24 * 60 * 60 * 1000
      let cursor = nowTs
      if (!days.has(dayKey(cursor))) cursor -= dayMs
      while (days.has(dayKey(cursor))) {
        streakDays++
        cursor -= dayMs
      }

      const maxCount = Math.max(1, ...[...cuisineCounts.values()].map((v) => v.count))
      const topCuisines = [...cuisineCounts.entries()]
        .map(([id, v]) => ({ id, emoji: v.emoji, count: v.count, share: v.count / maxCount }))
        .sort((a, b) => b.count - a.count)
        .slice(0, topN)

      return { total: records.length, last30, distinctPlaces: places.size, streakDays, topCuisines }
    },

    async clearAll(): Promise<void> {
      await db.draws.clear()
    },

    async exportJson(): Promise<string> {
      const [draws, blocklist] = await Promise.all([db.draws.toArray(), db.blocklist.toArray()])
      return JSON.stringify({ exportedAt: now(), draws, blocklist }, null, 2)
    },
  }
}

export function createBlocklistRepo(db: EatWhatDB, now: () => number = Date.now) {
  return {
    async add(placeId: string, name: string): Promise<void> {
      await db.blocklist.put({ placeId, name, addedAt: now() })
    },
    async remove(placeId: string): Promise<void> {
      await db.blocklist.delete(placeId)
    },
    async list(): Promise<BlockRow[]> {
      return db.blocklist.toArray()
    },
    async ids(): Promise<Set<string>> {
      return new Set((await db.blocklist.toArray()).map((b) => b.placeId))
    },
  }
}
