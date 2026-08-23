import Dexie, { type EntityTable } from 'dexie'

import type { DrawRecord, PlaceNote, Restaurant, VisitDiary } from '@/types/models'

/**
 * v2 kept ONE diary per place (rating/note/spend on placeNotes) — a second
 * visit silently replaced the first (field-reported). v3 moves visit data
 * onto the visit itself: split a legacy note into the visit part (goes to
 * the newest record of that place) and the place part that stays.
 */
export function splitLegacyNote(note: PlaceNote): { visit: VisitDiary | null; place: PlaceNote } {
  const visit: VisitDiary = {}
  if (note.myRating) visit.rating = note.myRating
  if (note.note) visit.note = note.note
  if (note.spend) visit.spend = note.spend
  const place: PlaceNote = {
    placeId: note.placeId,
    name: note.name,
    ...(note.cuisines?.length ? { cuisines: note.cuisines } : {}),
    ...(note.keywords?.length ? { keywords: note.keywords } : {}),
    ...(note.closed ? { closed: note.closed } : {}),
    updatedAt: note.updatedAt,
  }
  return { visit: Object.keys(visit).length ? visit : null, place }
}

export function placeNoteHasPlaceContent(place: PlaceNote): boolean {
  return !!(place.cuisines?.length || place.keywords?.length || place.closed)
}

export interface SearchCacheRow {
  key: string
  fetchedAt: number
  results: Restaurant[]
}

export interface BlockRow {
  placeId: string
  name: string
  addedAt: number
}

export class EatWhatDB extends Dexie {
  draws!: EntityTable<DrawRecord, 'id'>
  searchCache!: EntityTable<SearchCacheRow, 'key'>
  placeCache!: EntityTable<Restaurant, 'id'>
  blocklist!: EntityTable<BlockRow, 'placeId'>
  placeNotes!: EntityTable<PlaceNote, 'placeId'>

  constructor(name = 'eatwhat') {
    super(name)
    this.version(1).stores({
      draws: '++id, timestamp, restaurant.id, action',
      searchCache: 'key, fetchedAt',
      placeCache: 'id, fetchedAt',
      blocklist: 'placeId',
    })
    // v2: food diary / per-place corrections (unchanged tables carry over)
    this.version(2).stores({
      placeNotes: 'placeId',
    })
    // v3: diary becomes PER-VISIT (DrawRecord.diary); legacy per-place visit
    // data migrates onto the newest record of that place. Notes for places
    // with no record keep their legacy fields as a seed.
    this.version(3)
      .stores({})
      .upgrade(async (tx) => {
        const notes = (await tx.table('placeNotes').toArray()) as PlaceNote[]
        for (const note of notes) {
          const { visit, place } = splitLegacyNote(note)
          if (!visit) continue
          const recs = (await tx
            .table('draws')
            .where('restaurant.id')
            .equals(note.placeId)
            .toArray()) as DrawRecord[]
          if (!recs.length) continue
          const latest = recs.sort((a, b) => b.timestamp - a.timestamp)[0]!
          await tx.table('draws').update(latest.id!, { diary: visit })
          if (placeNoteHasPlaceContent(place)) await tx.table('placeNotes').put(place)
          else await tx.table('placeNotes').delete(note.placeId)
        }
      })
  }
}

let instance: EatWhatDB | null = null

/** Lazy singleton so importing repo modules has no side effects (tests make their own). */
export function getDb(): EatWhatDB {
  if (!instance) instance = new EatWhatDB()
  return instance
}
