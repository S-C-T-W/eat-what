import { describe, expect, it } from 'vitest'

import type { OriginSetting } from '@/types/models'
import { haversineMeters } from './distance'
import { offsetPoint, type Geometry } from './geometry'
import {
  circleRing,
  corridorRing,
  geometryBounds,
  geometryPoints,
  geometryShape,
  previewGeometry,
  sectorRing,
} from './geoJson'

const HK = { lat: 22.2819, lng: 114.158 }
const at = ([lng, lat]: [number, number]) => ({ lat, lng })

describe('rings', () => {
  it('circle ring closes and sits on the radius', () => {
    const ring = circleRing(HK, 1000, 32)
    expect(ring[0]).toEqual(ring[ring.length - 1])
    for (const p of ring) expect(haversineMeters(HK, at(p))).toBeCloseTo(1000, -1)
  })

  it('sector ring starts and ends at the apex', () => {
    const ring = sectorRing(HK, 800, 270, 90)
    expect(ring[0]).toEqual([HK.lng, HK.lat])
    expect(ring[ring.length - 1]).toEqual([HK.lng, HK.lat])
  })

  it('corridor ring closes, sides sit at the width, caps round the ends', () => {
    const b = offsetPoint(HK, 90, 2000)
    const ring = corridorRing(HK, b, 300)
    expect(ring[0]).toEqual(ring[ring.length - 1])
    // first vertex = A shifted to the left side (north, for an eastward line)
    expect(haversineMeters(at(ring[0]!), offsetPoint(HK, 0, 300))).toBeLessThan(2)
    // the B cap passes through the point width-east of B (arc apex)
    const capApex = offsetPoint(b, 90, 300)
    const nearest = Math.min(...ring.map((p) => haversineMeters(capApex, at(p))))
    expect(nearest).toBeLessThan(35)
  })
})

describe('geometryShape / points / bounds', () => {
  it('multi renders one polygon per spot and one labelled point each', () => {
    const g: Geometry = { kind: 'multi', spots: [HK, offsetPoint(HK, 90, 3000)], radius: 500 }
    const shape = geometryShape(g)
    expect(shape.geometry.type).toBe('MultiPolygon')
    expect((shape.geometry.coordinates as unknown[]).length).toBe(2)
    expect(geometryPoints(g).map((p) => p.properties.label)).toEqual(['1', '2'])
  })

  it('bounds cover the whole shape', () => {
    const b = offsetPoint(HK, 90, 2000)
    const [[west, south], [east, north]] = geometryBounds({
      kind: 'corridor',
      a: HK,
      b,
      width: 300,
    })
    expect(west).toBeLessThan(HK.lng)
    expect(east).toBeGreaterThan(b.lng)
    expect(north).toBeGreaterThan(HK.lat)
    expect(south).toBeLessThan(HK.lat)
  })
})

describe('previewGeometry', () => {
  it('mirrors draw-time resolution with a fallback base and no GPS', () => {
    const spot = { label: 'X', location: offsetPoint(HK, 90, 1500) }
    const offsetOrigin: OriginSetting = {
      mode: 'offset',
      offset: { base: spot, bearing: 0, meters: 400, sector: 0 },
    }
    const g = previewGeometry(offsetOrigin, 800, HK)
    expect(g.kind).toBe('circle')
    if (g.kind === 'circle') {
      expect(haversineMeters(g.center, offsetPoint(spot.location, 0, 400))).toBeLessThan(2)
    }
    // null base falls back to the provided point, not to GPS
    const gpsBased = previewGeometry(
      { mode: 'offset', offset: { bearing: 90, meters: 200, sector: 90 } },
      800,
      HK,
    )
    expect(gpsBased.kind).toBe('sector')
    if (gpsBased.kind === 'sector') expect(gpsBased.center).toEqual(HK)
    // degenerate corridor (both ends unset) collapses to a circle
    const degenerate = previewGeometry(
      { mode: 'corridor', corridor: { a: null, b: null, widthMeters: 300 } },
      800,
      HK,
    )
    expect(degenerate.kind).toBe('circle')
  })
})
