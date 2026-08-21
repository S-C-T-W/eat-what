/**
 * Search-area geometry: offset circles, direction sectors, multi-spot
 * unions and A→B corridors — plus the coverage planner that turns any of
 * them into AT MOST `MAX_FETCH_CIRCLES` Nearby fetch circles (cost is the
 * constraint the user set; client-side filtering restores the exact shape).
 *
 * Local math is equirectangular (lat/lng → metres around a reference
 * point) — plenty accurate at the ≤8 km scale these shapes are capped to.
 */
import type { LatLng } from '@/types/models'
import { haversineMeters } from './distance'

export interface FetchCircle {
  center: LatLng
  radius: number
}

export type Geometry =
  | { kind: 'circle'; center: LatLng; radius: number }
  | { kind: 'sector'; center: LatLng; radius: number; bearing: number; angle: 90 | 180 }
  | { kind: 'multi'; spots: LatLng[]; radius: number }
  | { kind: 'corridor'; a: LatLng; b: LatLng; width: number }

/** Hard ceiling the user chose: a draw never spends more than 3 nearby calls. */
export const MAX_FETCH_CIRCLES = 3
/** Soft per-circle radius target — the SPLIT threshold (keeps result density). */
export const MAX_FETCH_RADIUS = 4000
/** Hard per-circle ceiling. Coverage is a contract: a spot the user added must
 *  be searched, so a forced merge may grow to this before density gives way. */
export const HARD_FETCH_RADIUS = 8000
export const CORRIDOR_MAX_LENGTH = 8000

const METERS_PER_DEG_LAT = 111_320

function metersPerDegLng(lat: number): number {
  return METERS_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180)
}

/** Destination point from `origin` along `bearingDeg` (0 = north, 90 = east). */
export function offsetPoint(origin: LatLng, bearingDeg: number, meters: number): LatLng {
  const rad = (bearingDeg * Math.PI) / 180
  const dNorth = Math.cos(rad) * meters
  const dEast = Math.sin(rad) * meters
  return {
    lat: origin.lat + dNorth / METERS_PER_DEG_LAT,
    lng: origin.lng + dEast / metersPerDegLng(origin.lat),
  }
}

/** Bearing from → to in degrees, 0 = north, clockwise. */
export function bearingBetween(from: LatLng, to: LatLng): number {
  const dNorth = (to.lat - from.lat) * METERS_PER_DEG_LAT
  const dEast = (to.lng - from.lng) * metersPerDegLng(from.lat)
  const deg = (Math.atan2(dEast, dNorth) * 180) / Math.PI
  return (deg + 360) % 360
}

/** Smallest absolute difference between two bearings (≤180). */
export function angleDiff(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360) + 360) % 360
  return d > 180 ? 360 - d : d
}

/** Distance from point to the A→B segment, in metres. */
export function pointToSegmentMeters(p: LatLng, a: LatLng, b: LatLng): number {
  const perLng = metersPerDegLng(a.lat)
  const px = (p.lng - a.lng) * perLng
  const py = (p.lat - a.lat) * METERS_PER_DEG_LAT
  const bx = (b.lng - a.lng) * perLng
  const by = (b.lat - a.lat) * METERS_PER_DEG_LAT
  const len2 = bx * bx + by * by
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / len2))
  const dx = px - t * bx
  const dy = py - t * by
  return Math.hypot(dx, dy)
}

/** Fraction [0,1] of p's projection along A→B (for corridor fairness buckets). */
export function segmentFraction(p: LatLng, a: LatLng, b: LatLng): number {
  const perLng = metersPerDegLng(a.lat)
  const px = (p.lng - a.lng) * perLng
  const py = (p.lat - a.lat) * METERS_PER_DEG_LAT
  const bx = (b.lng - a.lng) * perLng
  const by = (b.lat - a.lat) * METERS_PER_DEG_LAT
  const len2 = bx * bx + by * by
  return len2 === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / len2))
}

/**
 * Is the point inside the shape? `grace` loosens the SIZE parameters
 * (radius/width) the same way the plain radius check always has — never
 * the sector angle, which is a hard preference.
 */
export function inGeometry(p: LatLng, g: Geometry, grace = 1): boolean {
  switch (g.kind) {
    case 'circle':
      return haversineMeters(g.center, p) <= g.radius * grace
    case 'sector':
      return (
        haversineMeters(g.center, p) <= g.radius * grace &&
        angleDiff(bearingBetween(g.center, p), g.bearing) <= g.angle / 2
      )
    case 'multi':
      return g.spots.some((s) => haversineMeters(s, p) <= g.radius * grace)
    case 'corridor':
      return pointToSegmentMeters(p, g.a, g.b) <= g.width * grace
  }
}

/** The shape's anchor point — keyword tags search here, distances display from here. */
export function primaryAnchor(g: Geometry): LatLng {
  switch (g.kind) {
    case 'circle':
    case 'sector':
      return g.center
    case 'multi':
      return g.spots[0]!
    case 'corridor':
      return {
        lat: (g.a.lat + g.b.lat) / 2,
        lng: (g.a.lng + g.b.lng) / 2,
      }
  }
}

/**
 * Fairness bucket for the wheel: which spot (multi) or which along-line
 * third (corridor) a place belongs to. Single-shape geometries are one
 * bucket.
 */
export function groupIndexOf(p: LatLng, g: Geometry): number {
  switch (g.kind) {
    case 'multi': {
      let best = 0
      let bestDist = Infinity
      g.spots.forEach((s, i) => {
        const d = haversineMeters(s, p)
        if (d < bestDist) {
          bestDist = d
          best = i
        }
      })
      return best
    }
    case 'corridor':
      return Math.min(2, Math.floor(segmentFraction(p, g.a, g.b) * 3))
    default:
      return 0
  }
}

function clampRadius(r: number): number {
  return Math.min(r, HARD_FETCH_RADIUS)
}

/**
 * Cover the shape with as FEW fetch circles as possible (≤ MAX_FETCH_CIRCLES).
 * Fewest first, splitting only when one circle would exceed the per-call
 * radius ceiling; over-fetch is cut back by inGeometry() client-side.
 */
export function planCoverage(g: Geometry): FetchCircle[] {
  switch (g.kind) {
    case 'circle':
      return [{ center: g.center, radius: clampRadius(g.radius) }]
    case 'sector': {
      if (g.angle === 90) {
        // A 90° sector of radius r fits in a circle of ~0.75r centred at
        // r/2 along the bearing — denser results than fetching the full disc
        return [
          { center: offsetPoint(g.center, g.bearing, g.radius / 2), radius: clampRadius(g.radius * 0.75) },
        ]
      }
      // 180°: the full disc is the smallest single covering circle
      return [{ center: g.center, radius: clampRadius(g.radius) }]
    }
    case 'multi': {
      // Greedy clustering: join a cluster when the merged covering circle
      // stays reasonable; force-merge nearest pairs if we exceed the cap
      interface Cluster {
        members: LatLng[]
      }
      const mergedRadius = (members: LatLng[]): { center: LatLng; radius: number } => {
        const center = {
          lat: members.reduce((s, m) => s + m.lat, 0) / members.length,
          lng: members.reduce((s, m) => s + m.lng, 0) / members.length,
        }
        const radius = Math.max(...members.map((m) => haversineMeters(center, m))) + g.radius
        return { center, radius }
      }
      const mergeCap = Math.max(g.radius * 2, 2000)
      const clusters: Cluster[] = []
      for (const spot of g.spots) {
        const fit = clusters.find(
          (c) => mergedRadius([...c.members, spot]).radius <= Math.min(mergeCap, HARD_FETCH_RADIUS),
        )
        if (fit) fit.members.push(spot)
        else clusters.push({ members: [spot] })
      }
      while (clusters.length > MAX_FETCH_CIRCLES) {
        // merge the two clusters whose combination stays smallest
        let bi = 0
        let bj = 1
        let bestR = Infinity
        for (let i = 0; i < clusters.length; i++) {
          for (let j = i + 1; j < clusters.length; j++) {
            const r = mergedRadius([...clusters[i]!.members, ...clusters[j]!.members]).radius
            if (r < bestR) {
              bestR = r
              bi = i
              bj = j
            }
          }
        }
        clusters[bi]!.members.push(...clusters[bj]!.members)
        clusters.splice(bj, 1)
      }
      return clusters.map((c) => {
        const { center, radius } = mergedRadius(c.members)
        return { center, radius: clampRadius(radius) }
      })
    }
    case 'corridor': {
      const length = Math.min(haversineMeters(g.a, g.b), CORRIDOR_MAX_LENGTH)
      // smallest N with per-circle radius (L/2N + width) inside the ceiling
      let n = 1
      while (n < MAX_FETCH_CIRCLES && length / (2 * n) + g.width > MAX_FETCH_RADIUS) n++
      const circles: FetchCircle[] = []
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n
        circles.push({
          center: {
            lat: g.a.lat + (g.b.lat - g.a.lat) * t,
            lng: g.a.lng + (g.b.lng - g.a.lng) * t,
          },
          radius: clampRadius(length / (2 * n) + g.width),
        })
      }
      return circles
    }
  }
}
