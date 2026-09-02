import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useDrawStore } from './draw'

const EMPTY = { pool: [], candidates: [], winnerIndex: -1, relaxations: [] }
const TAIPEI = { lat: 25.033, lng: 121.565 }
const SHINJUKU = { lat: 35.69, lng: 139.7 }
const MACAU = { lat: 22.19, lng: 113.55 }
const LONDON = { lat: 51.5, lng: -0.12 }

describe('draw store region', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('follows the best-known anchor: picked spot → live fix → last draw origin', () => {
    const s = useDrawStore()
    expect(s.region).toBe('HK')
    s.liveFix = TAIPEI // drawer opened in Taipei → NT$ before any draw
    expect(s.region).toBe('TW')
    s.conditions.origin = { mode: 'picked', picked: { label: 'Shinjuku', location: SHINJUKU } }
    expect(s.region).toBe('JP')
    s.conditions.origin = {
      mode: 'offset',
      offset: { base: { label: 'Macau', location: MACAU }, bearing: 90, meters: 300, sector: 0 },
    }
    expect(s.region).toBe('MO')
    s.conditions.origin = { mode: 'gps' }
    s.liveFix = null
    s.setOutcome(EMPTY, MACAU, 'MO')
    expect(s.lastRegion).toBe('MO')
    expect(s.region).toBe('MO')
  })

  it('keeps the last region when the anchor is outside every known box', () => {
    const s = useDrawStore()
    s.setOutcome(EMPTY, SHINJUKU, 'JP')
    s.liveFix = LONDON
    expect(s.region).toBe('JP')
  })
})
