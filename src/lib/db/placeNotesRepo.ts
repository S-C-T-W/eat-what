import type { PlaceNote } from '@/types/models'
import type { EatWhatDB } from './schema'

/** A note with no PLACE-level content left is deleted rather than stored as
 *  a husk (visit-level diary lives on the records since v3). */
function hasContent(n: Omit<PlaceNote, 'updatedAt'>): boolean {
  return !!(n.cuisines?.length || n.keywords?.length || n.closed)
}

export function createPlaceNotesRepo(db: EatWhatDB, now: () => number = Date.now) {
  return {
    async get(placeId: string): Promise<PlaceNote | undefined> {
      return db.placeNotes.get(placeId)
    },

    async upsert(note: Omit<PlaceNote, 'updatedAt'>): Promise<void> {
      if (!hasContent(note)) {
        await db.placeNotes.delete(note.placeId)
        return
      }
      await db.placeNotes.put({ ...note, updatedAt: now() })
    },

    /** Mark/unmark a place as permanently closed without touching the diary. */
    async setClosed(placeId: string, name: string, closed: boolean): Promise<void> {
      const existing = await db.placeNotes.get(placeId)
      await this.upsert({ ...(existing ?? { placeId, name }), closed })
    },

    /** Everything, keyed by place id — handed to the draw engine per draw. */
    async allByPlaceId(): Promise<Map<string, PlaceNote>> {
      const rows = await db.placeNotes.toArray()
      return new Map(rows.map((r) => [r.placeId, r]))
    },
  }
}
