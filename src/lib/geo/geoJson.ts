/**
 * Geometry → GeoJSON projection for the map preview: the same objects the
 * draw engine searches with are drawn as overlay polygons, so what you see
 * IS what gets searched. Pure functions — the map component just renders.
 */
import type { LatLng, OriginSetting } from '@/types/models'
import { offsetPoint, type Geometry } from './geometry'

type Position = [number, number] // [lng, lat] per GeoJSON

export interface ShapeFeature {
  type: 'Feature'
  properties: Record<string, never>
  geometry:
    | { type: 'Polygon'; coordinates: Position[][] }
    | { type: 'MultiPolygon'; coordinates: Position[][][] }
}

export interface PointFeature {
  type: 'Feature'
  properties: { label: string }
  geometry: { type: 'Point'; coordinates: Position }
}

const pos = (p: LatLng): Position => [p.lng, p.lat]

/** Closed circle ring (counter-clockwise-ish; MapLibre fills either way). */
export function circleRing(center: LatLng, radius: number, steps = 64): Position[] {
  const ring: Position[] = []
  for (let i = 0; i <= steps; i++) {
    ring.push(pos(offsetPoint(center, (360 * i) / steps, radius)))
  }
  return ring
}

/** Wedge: apex at center, arc from bearing−angle/2 to bearing+angle/2. */
export function sectorRing(
  center: LatLng,
  radius: number,
  bearing: number,
  angle: number,
  steps = 32,
): Position[] {
  const ring: Position[] = [pos(center)]
  for (let i = 0; i <= steps; i++) {
    const b = bearing - angle / 2 + (angle * i) / steps
    ring.push(pos(offsetPoint(center, b, radius)))
  }
  ring.push(pos(center))
  return ring
}

/** Stadium shape: the A→B band with rounded caps. */
export function corridorRing(a: LatLng, b: LatLng, width: number, capSteps = 16): Position[] {
  const dNorth = (b.lat - a.lat) * 111_320
  const dEast = (b.lng - a.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180)
  const heading = (Math.atan2(dEast, dNorth) * 180) / Math.PI
  const left = heading - 90
  const right = heading + 90

  const ring: Position[] = []
  ring.push(pos(offsetPoint(a, left, width)))
  ring.push(pos(offsetPoint(b, left, width)))
  // cap around B: left → right sweeping through the far side
  for (let i = 0; i <= capSteps; i++) {
    ring.push(pos(offsetPoint(b, left + (180 * i) / capSteps, width)))
  }
  ring.push(pos(offsetPoint(a, right, width)))
  // cap around A: right → left through the near side
  for (let i = 0; i <= capSteps; i++) {
    ring.push(pos(offsetPoint(a, right + (180 * i) / capSteps, width)))
  }
  ring.push(ring[0]!)
  return ring
}

export function geometryShape(g: Geometry): ShapeFeature {
  switch (g.kind) {
    case 'circle':
      return {
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: [circleRing(g.center, g.radius)] },
      }
    case 'sector':
      return {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Polygon',
          coordinates: [sectorRing(g.center, g.radius, g.bearing, g.angle)],
        },
      }
    case 'multi':
      return {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'MultiPolygon',
          coordinates: g.spots.map((s) => [circleRing(s, g.radius)]),
        },
      }
    case 'corridor':
      return {
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: [corridorRing(g.a, g.b, g.width)] },
      }
  }
}

/** Marker points: spots / endpoints / the (shifted) center. */
export function geometryPoints(g: Geometry): PointFeature[] {
  const point = (p: LatLng, label: string): PointFeature => ({
    type: 'Feature',
    properties: { label },
    geometry: { type: 'Point', coordinates: pos(p) },
  })
  switch (g.kind) {
    case 'circle':
      return [point(g.center, '')]
    case 'sector':
      return [point(g.center, '')]
    case 'multi':
      return g.spots.map((s, i) => point(s, `${i + 1}`))
    case 'corridor':
      return [point(g.a, 'A'), point(g.b, 'B')]
  }
}

/** [[west,south],[east,north]] over every ring coordinate — for fitBounds. */
export function geometryBounds(g: Geometry): [Position, Position] {
  const shape = geometryShape(g)
  const rings =
    shape.geometry.type === 'Polygon'
      ? shape.geometry.coordinates
      : shape.geometry.coordinates.flat()
  let west = Infinity
  let south = Infinity
  let east = -Infinity
  let north = -Infinity
  for (const ring of rings) {
    for (const [lng, lat] of ring) {
      west = Math.min(west, lng)
      east = Math.max(east, lng)
      south = Math.min(south, lat)
      north = Math.max(north, lat)
    }
  }
  return [
    [west, south],
    [east, north],
  ]
}

/**
 * Synchronous mirror of the draw-time resolver for PREVIEW purposes: no GPS
 * prompt — unset bases/spots/ends fall back to the last known location the
 * caller provides. What renders is exactly what a draw from there would use.
 */
export function previewGeometry(
  origin: OriginSetting,
  radiusMeters: number,
  fallbackBase: LatLng,
): Geometry {
  switch (origin.mode) {
    case 'picked':
      return { kind: 'circle', center: origin.picked?.location ?? fallbackBase, radius: radiusMeters }
    case 'offset': {
      const off = origin.offset ?? { bearing: 90, meters: 300, sector: 0 as const }
      const base = off.base?.location ?? fallbackBase
      if (off.sector !== 0) {
        return { kind: 'sector', center: base, radius: radiusMeters, bearing: off.bearing, angle: off.sector }
      }
      return { kind: 'circle', center: offsetPoint(base, off.bearing, off.meters), radius: radiusMeters }
    }
    case 'multi': {
      const spots = (origin.spots ?? []).slice(0, 5).map((s) => s?.location ?? fallbackBase)
      if (!spots.length) return { kind: 'circle', center: fallbackBase, radius: radiusMeters }
      return { kind: 'multi', spots, radius: radiusMeters }
    }
    case 'corridor': {
      const c = origin.corridor
      const a = c?.a?.location ?? fallbackBase
      const b = c?.b?.location ?? fallbackBase
      if (a.lat === b.lat && a.lng === b.lng) {
        return { kind: 'circle', center: a, radius: radiusMeters }
      }
      return { kind: 'corridor', a, b, width: c?.widthMeters ?? 500 }
    }
    default:
      return { kind: 'circle', center: fallbackBase, radius: radiusMeters }
  }
}
