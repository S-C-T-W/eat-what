import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config'

/**
 * Icon set from public/logo.svg. The transparent PNGs + favicon.ico keep the
 * preset defaults; the maskable (Android) and Apple touch icons get the app's
 * cream background instead of the generator's white, and just enough
 * padding to keep the knife pointer inside the maskable safe zone.
 */
export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    ...minimal2023Preset,
    maskable: { sizes: [512], padding: 0.12, resizeOptions: { background: '#fff7ed' } },
    apple: { sizes: [180], padding: 0.08, resizeOptions: { background: '#fff7ed' } },
  },
  images: ['public/logo.svg'],
})
