import { describe, expect, it } from 'vitest'

import { haversineMeters } from './distance'
import {
  angleDiff,
  bearingBetween,
  groupIndexOf,
  HARD_FETCH_RADIUS,
  inGeometry,
  MAX_FETCH_CIRCLES,
  MAX_FETCH_RADIUS,
  offsetPoint,
  planCoverage,
  pointToSegmentMeters,
  primaryAnchor,
  type Geometry,
} from './geometry'

const HK = { lat: 22.2819, lng: 114.158 }

describe('offsetPoint / bearingBetween', () => {
  it('shifts by the right distance in the right direction', () => {
    const east = offsetPoint(HK, 90, 200)
    expect(haversineMeters(HK, east)).toBeCloseTo(200, -1)
    expect(bearingBetween(HK, east)).toBeCloseTo(90, 0)
    const north = offsetPoint(HK, 0, 500)
    expect(haversineMeters(HK, north)).toBeCloseTo(500, -1)
    expect(bearingBetween(HK, north)).toBeCloseTo(0, 0)
  })

  it('angleDiff wraps around north', () => {
    expect(angleDiff(350, 10)).toBe(20)
    expect(angleDiff(90, 270)).toBe(180)
  })
})

describe('pointToSegmentMeters', () => {
  const a = HK
  const b = offsetPoint(HK, 90, 2000) // 2 km east
  it('measures perpendicular distance inside the segment and radial beyond ends', () => {
    const above = offsetPoint(offsetPoint(HK, 90, 1000), 0, 300) // mid, 300 m north
    expect(pointToSegmentMeters(above, a, b)).toBeCloseTo(300, -1)
    const beyond = offsetPoint(b, 90, 400) // 400 m past B
    expect(pointToSegmentMeters(beyond, a, b)).toBeCloseTo(400, -1)
  })
})

describe('inGeometry', () => {
  it('sector: radius with grace, angle without', () => {
    const g: Geometry = { kind: 'sector', center: HK, radius: 1000, bearing: 270, angle: 90 }
    expect(inGeometry(offsetPoint(HK, 270, 800), g)).toBe(true) // due west
    expect(inGeometry(offsetPoint(HK, 240, 800), g)).toBe(true) // 30° off, inside 45°
    expect(inGeometry(offsetPoint(HK, 200, 800), g)).toBe(false) // 70° off — angle is hard
    expect(inGeometry(offsetPoint(HK, 270, 1100), g, 1.15)).toBe(true) // radius grace
    expect(inGeometry(offsetPoint(HK, 90, 300), g)).toBe(false) // east — wrong half entirely
  })

  it('corridor: within width of the A→B line only', () => {
    const b = offsetPoint(HK, 90, 3000)
    const g: Geometry = { kind: 'corridor', a: HK, b, width: 300 }
    expect(inGeometry(offsetPoint(offsetPoint(HK, 90, 1500), 0, 250), g)).toBe(true)
    expect(inGeometry(offsetPoint(offsetPoint(HK, 90, 1500), 0, 500), g)).toBe(false)
  })
})

describe('planCoverage', () => {
  it('plain and 180° shapes cost exactly one call', () => {
    expect(planCoverage({ kind: 'circle', center: HK, radius: 1000 })).toHaveLength(1)
    expect(
      planCoverage({ kind: 'sector', center: HK, radius: 1000, bearing: 0, angle: 180 }),
    ).toHaveLength(1)
  })

  it('90° sector fetches a smaller circle pushed along the bearing', () => {
    const [c] = planCoverage({ kind: 'sector', center: HK, radius: 2000, bearing: 90, angle: 90 })
    expect(c!.radius).toBeLessThan(2000)
    expect(bearingBetween(HK, c!.center)).toBeCloseTo(90, 0)
    // the fetch circle still covers the sector's far corners
    for (const brg of [45, 90, 135]) {
      const corner = offsetPoint(HK, brg, 2000)
      expect(haversineMeters(c!.center, corner)).toBeLessThanOrEqual(c!.radius + 5)
    }
  })

  it('overlapping spots merge into one call; far-apart spots split, capped at 3', () => {
    const near: Geometry = {
      kind: 'multi',
      spots: [HK, offsetPoint(HK, 90, 400), offsetPoint(HK, 180, 300)],
      radius: 800,
    }
    expect(planCoverage(near)).toHaveLength(1)

    const far: Geometry = {
      kind: 'multi',
      spots: [
        HK,
        offsetPoint(HK, 90, 6000),
        offsetPoint(HK, 180, 6000),
        offsetPoint(HK, 270, 6000),
        offsetPoint(HK, 0, 6000),
      ],
      radius: 500,
    }
    const circles = planCoverage(far)
    expect(circles.length).toBeLessThanOrEqual(MAX_FETCH_CIRCLES)
    for (const c of circles) expect(c.radius).toBeLessThanOrEqual(HARD_FETCH_RADIUS)
    // every spot must be covered by some circle (spot circle ⊆ fetch circle)
    for (const s of far.spots) {
      expect(circles.some((c) => haversineMeters(c.center, s) + 500 <= c.radius + 5)).toBe(true)
    }
  })

  it('corridor splits only when one circle would blow the radius ceiling', () => {
    const short: Geometry = { kind: 'corridor', a: HK, b: offsetPoint(HK, 90, 3000), width: 500 }
    expect(planCoverage(short)).toHaveLength(1)
    const long: Geometry = { kind: 'corridor', a: HK, b: offsetPoint(HK, 90, 8000), width: 2000 }
    const circles = planCoverage(long)
    expect(circles).toHaveLength(2)
    for (const c of circles) expect(c.radius).toBeLessThanOrEqual(MAX_FETCH_RADIUS)
  })
})

describe('primaryAnchor / groupIndexOf', () => {
  it('anchors: shifted center, first spot, corridor midpoint', () => {
    const b = offsetPoint(HK, 90, 2000)
    expect(primaryAnchor({ kind: 'multi', spots: [HK, b], radius: 500 })).toEqual(HK)
    const mid = primaryAnchor({ kind: 'corridor', a: HK, b, width: 300 })
    expect(haversineMeters(mid, HK)).toBeCloseTo(1000, -2)
  })

  it('groups: nearest spot for multi, along-line thirds for corridor', () => {
    const b = offsetPoint(HK, 90, 3000)
    const multi: Geometry = { kind: 'multi', spots: [HK, b], radius: 500 }
    expect(groupIndexOf(offsetPoint(HK, 90, 200), multi)).toBe(0)
    expect(groupIndexOf(offsetPoint(b, 270, 200), multi)).toBe(1)
    const corridor: Geometry = { kind: 'corridor', a: HK, b, width: 300 }
    expect(groupIndexOf(offsetPoint(HK, 90, 300), corridor)).toBe(0)
    expect(groupIndexOf(offsetPoint(HK, 90, 1500), corridor)).toBe(1)
    expect(groupIndexOf(offsetPoint(HK, 90, 2800), corridor)).toBe(2)
  })
})
