<script setup lang="ts">
/**
 * Live map projection of the active search area — the user's ask: an OSM
 * map element with an SVG-like overlay marking exactly where the draw will
 * search. Read-only in v1 (pan/zoom only; picking on the map is v2).
 *
 * MapLibre is loaded lazily so the ~220 KB chunk costs nothing until the
 * advanced panel opens. Tiles: OpenFreeMap (keyless, no limits, commercial
 * use allowed) — noted in the README's privacy section; self-hosted
 * PMTiles stays the documented migration path.
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import {
  geometryBounds,
  geometryPoints,
  geometryShape,
  previewGeometry,
} from '@/lib/geo/geoJson'
import { DEMO_ORIGIN } from '@/lib/places/mockProvider'
import { useDrawStore } from '@/stores/draw'

const { t } = useI18n()
const drawStore = useDrawStore()

const el = ref<HTMLDivElement | null>(null)
const failed = ref(false)
const usingFallbackBase = ref(false)

// maplibre types stay out of the main graph — everything through `any`-free
// structural typing on the bits we use
interface MapLike {
  on(ev: string, cb: (e?: { error?: { message?: string } }) => void): void
  addSource(id: string, src: unknown): void
  addLayer(l: unknown): void
  getSource(id: string): { setData(d: unknown): void } | undefined
  fitBounds(b: [[number, number], [number, number]], o: { padding: number; duration: number; maxZoom?: number }): void
  remove(): void
}

let map: MapLike | null = null
let loaded = false

function currentGeometry() {
  const base = drawStore.lastOrigin ?? DEMO_ORIGIN
  usingFallbackBase.value = drawStore.lastOrigin === null
  return previewGeometry(drawStore.conditions.origin, drawStore.conditions.radiusMeters, base)
}

function collection() {
  const g = currentGeometry()
  return {
    shape: { type: 'FeatureCollection', features: [geometryShape(g)] },
    points: { type: 'FeatureCollection', features: geometryPoints(g) },
    bounds: geometryBounds(g),
  }
}

function sync() {
  if (!map || !loaded) return
  const { shape, points, bounds } = collection()
  map.getSource('area')?.setData(shape)
  map.getSource('spots')?.setData(points)
  map.fitBounds(bounds, { padding: 28, duration: 250, maxZoom: 15 })
}

onMounted(async () => {
  try {
    const lib = await import('maplibre-gl')
    await import('maplibre-gl/dist/maplibre-gl.css')
    const { shape, points, bounds } = collection()
    const created = new lib.Map({
      container: el.value!,
      style: 'https://tiles.openfreemap.org/styles/liberty',
      bounds,
      fitBoundsOptions: { padding: 28, maxZoom: 15 },
      // OSM's licence wants attribution VISIBLE — no collapsed ⓘ on our tiny map
      attributionControl: { compact: false },
      dragRotate: false,
      pitchWithRotate: false,
    }) as unknown as MapLike
    // MapLibre swallows tile/style failures unless someone listens
    created.on('error', (e) => console.warn('[map]', e?.error?.message ?? e))
    if (import.meta.env.DEV) {
      ;(window as unknown as { __map?: unknown }).__map = created
    }
    const ready = () => {
      created.addSource('area', { type: 'geojson', data: shape })
      created.addSource('spots', { type: 'geojson', data: points })
      created.addLayer({
        id: 'area-fill',
        type: 'fill',
        source: 'area',
        paint: { 'fill-color': '#f97316', 'fill-opacity': 0.16 },
      })
      created.addLayer({
        id: 'area-line',
        type: 'line',
        source: 'area',
        paint: { 'line-color': '#f97316', 'line-width': 2 },
      })
      created.addLayer({
        id: 'spot-dots',
        type: 'circle',
        source: 'spots',
        paint: {
          'circle-radius': 5,
          'circle-color': '#f97316',
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
      })
      created.addLayer({
        id: 'spot-labels',
        type: 'symbol',
        source: 'spots',
        layout: {
          'text-field': ['get', 'label'],
          'text-size': 11,
          'text-offset': [0, -1.2],
        },
        paint: { 'text-color': '#ea580c', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
      })
      loaded = true
      sync()
    }
    // 'load' needs a render frame — guard against registering after it fired
    if ((created as unknown as { isStyleLoaded(): boolean }).isStyleLoaded()) ready()
    else created.on('load', ready)
    map = created
  } catch {
    failed.value = true
  }
})

onBeforeUnmount(() => {
  map?.remove()
  map = null
})

watch(
  () => [drawStore.conditions.origin, drawStore.conditions.radiusMeters],
  sync,
  { deep: true },
)
</script>

<template>
  <div>
    <div
      v-if="!failed"
      ref="el"
      class="h-48 w-full overflow-hidden rounded-2xl border border-stone-200 dark:border-stone-800"
    />
    <p v-if="failed" class="text-xs text-stone-400 dark:text-stone-500">
      🗺️ {{ t('conditions.adv.mapFailed') }}
    </p>
    <p v-else-if="usingFallbackBase" class="mt-1 text-xs text-stone-400 dark:text-stone-500">
      {{ t('conditions.adv.mapApprox') }}
    </p>
  </div>
</template>
