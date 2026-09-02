/**
 * Group-draw rooms as a Durable Object — one strongly-consistent instance
 * per room. Rooms originally lived in KV, but KV caches reads at the edge
 * for a minimum of 60 s, so pollers watched stale state for up to a minute
 * (field-verified). A DO has no read cache: every GET sees the last write,
 * and latency collapses to the client's poll interval.
 *
 * Privacy unchanged: candidate names/emoji/links only, host token never
 * exposed on reads, room self-destructs after 1 hour via alarm.
 */
import { SUPPORTED_LOCALES } from './copy'

/** Enough of a Restaurant for a participant to save the winner to history */
export interface SlimRestaurant {
  id: string
  name: string
  location: { lat: number; lng: number }
  types: string[]
  rating?: number
  userRatingCount?: number
  priceLevel?: number
  address?: string
  googleMapsUri?: string
}

export interface RoomCandidate {
  id: string
  name: string
  emoji: string
  mapsUrl?: string
  /** Snapshot for "add to my history" — absent in rooms from older builds */
  r?: SlimRestaurant
}

export interface Room {
  candidates: RoomCandidate[]
  /** placeId → voterId of whoever vetoed it (one veto per voter) */
  vetoes: Record<string, string>
  result: { placeId: string } | null
  hostToken: string
  locale: string
  createdAt: string
  /** Epoch ms of the planned meal (host drew for a future time) */
  plannedAt?: number
}

const ROOM_TTL_MS = 60 * 60 * 1000
const ID_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789' // no 0/O/1/I/L

export function newRoomId(): string {
  const buf = new Uint8Array(6)
  crypto.getRandomValues(buf)
  return [...buf].map((b) => ID_ALPHABET[b % ID_ALPHABET.length]).join('')
}

export function isRoomId(id: string): boolean {
  return /^[A-Za-z0-9]{6}$/.test(id)
}

function slimRestaurant(v: unknown): SlimRestaurant | undefined {
  const r = v as Record<string, unknown> | null
  const loc = r?.location as Record<string, unknown> | undefined
  if (
    typeof r?.id !== 'string' ||
    typeof r?.name !== 'string' ||
    typeof loc?.lat !== 'number' ||
    typeof loc?.lng !== 'number'
  ) {
    return undefined
  }
  return {
    id: r.id.slice(0, 300),
    name: r.name.slice(0, 200),
    location: { lat: loc.lat, lng: loc.lng },
    types: Array.isArray(r.types)
      ? r.types.filter((t): t is string => typeof t === 'string').slice(0, 10)
      : [],
    rating: typeof r.rating === 'number' ? r.rating : undefined,
    userRatingCount: typeof r.userRatingCount === 'number' ? r.userRatingCount : undefined,
    priceLevel:
      typeof r.priceLevel === 'number' && r.priceLevel >= 1 && r.priceLevel <= 4
        ? r.priceLevel
        : undefined,
    address: typeof r.address === 'string' ? r.address.slice(0, 200) : undefined,
    googleMapsUri:
      typeof r.googleMapsUri === 'string' && r.googleMapsUri.startsWith('https://')
        ? r.googleMapsUri
        : undefined,
  }
}

function parseCandidates(v: unknown): RoomCandidate[] | null {
  if (!Array.isArray(v) || v.length < 2 || v.length > 10) return null
  const out: RoomCandidate[] = []
  for (const item of v) {
    const c = item as Record<string, unknown>
    if (typeof c?.id !== 'string' || typeof c?.name !== 'string') return null
    if (c.id.length > 300 || c.name.length > 200) return null
    out.push({
      id: c.id,
      name: c.name,
      emoji: typeof c.emoji === 'string' ? c.emoji.slice(0, 8) : '🍽️',
      mapsUrl:
        typeof c.mapsUrl === 'string' && c.mapsUrl.startsWith('https://') ? c.mapsUrl : undefined,
      r: slimRestaurant(c.r),
    })
  }
  return out
}

/** Planned-meal timestamp: only sane values survive (past hour…+90 days). */
export function parsePlannedAt(v: unknown, now = Date.now()): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined
  const ms = Math.round(v)
  const min = now - 60 * 60 * 1000
  const max = now + 90 * 24 * 60 * 60 * 1000
  return ms >= min && ms <= max ? ms : undefined
}

/** Public view: everything except the host token. */
function publicRoom(room: Room): Omit<Room, 'hostToken'> {
  return {
    candidates: room.candidates,
    vetoes: room.vetoes,
    result: room.result,
    locale: room.locale,
    createdAt: room.createdAt,
    plannedAt: room.plannedAt,
  }
}

function reply(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export class RoomDO {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const room = await this.state.storage.get<Room>('room')

    if (request.method === 'POST' && url.pathname === '/create') {
      if (room) return reply({ error: 'room already exists' }, 409)
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
      const candidates = parseCandidates(body?.candidates)
      if (!candidates) return reply({ error: 'invalid candidates' }, 400)
      const plannedAt = parsePlannedAt(body?.plannedAt)
      const created: Room = {
        candidates,
        vetoes: {},
        result: null,
        hostToken: crypto.randomUUID(),
        locale:
          typeof body?.locale === 'string' && SUPPORTED_LOCALES.has(body.locale)
            ? body.locale
            : 'en',
        createdAt: new Date().toISOString(),
        ...(plannedAt !== undefined ? { plannedAt } : {}),
      }
      await this.state.storage.put('room', created)
      await this.state.storage.setAlarm(Date.now() + ROOM_TTL_MS)
      return reply({ hostToken: created.hostToken })
    }

    if (!room) return reply({ error: 'room not found' }, 404)

    if (request.method === 'GET') return reply(publicRoom(room))

    if (request.method === 'POST' && url.pathname === '/veto') {
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
      const placeId = body?.placeId
      const voterId = body?.voterId
      if (typeof placeId !== 'string' || typeof voterId !== 'string' || voterId.length > 64) {
        return reply({ error: 'bad request' }, 400)
      }
      if (room.result) return reply({ error: 'already drawn' }, 409)
      if (!room.candidates.some((c) => c.id === placeId)) {
        return reply({ error: 'unknown candidate' }, 400)
      }
      const alreadyVetoedBy = Object.values(room.vetoes).includes(voterId)
      const vetoCount = Object.keys(room.vetoes).length
      // One veto per person, and at least one candidate must survive
      if (!alreadyVetoedBy && vetoCount < room.candidates.length - 1 && !room.vetoes[placeId]) {
        room.vetoes[placeId] = voterId
        await this.state.storage.put('room', room)
      }
      return reply(publicRoom(room))
    }

    if (request.method === 'POST' && url.pathname === '/result') {
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
      if (body?.hostToken !== room.hostToken) return reply({ error: 'not the host' }, 403)
      const placeId = body?.placeId
      if (typeof placeId !== 'string' || !room.candidates.some((c) => c.id === placeId)) {
        return reply({ error: 'unknown candidate' }, 400)
      }
      if (!room.result) {
        room.result = { placeId }
        await this.state.storage.put('room', room)
      }
      return reply(publicRoom(room))
    }

    return reply({ error: 'not found' }, 404)
  }

  async alarm(): Promise<void> {
    await this.state.storage.deleteAll()
  }
}
