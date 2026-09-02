import { describe, expect, it } from 'vitest'

import en from './en.json'
import ja from './ja.json'
import zhHK from './zh-HK.json'
import zhTW from './zh-TW.json'

const LOCALES: Record<string, Record<string, unknown>> = { en, 'zh-HK': zhHK, 'zh-TW': zhTW, ja }

function flatten(obj: Record<string, unknown>, prefix = ''): Map<string, string> {
  const out = new Map<string, string>()
  for (const [key, value] of Object.entries(obj)) {
    if (value !== null && typeof value === 'object') {
      for (const [k, v] of flatten(value as Record<string, unknown>, `${prefix}${key}.`))
        out.set(k, v)
    } else out.set(`${prefix}${key}`, String(value))
  }
  return out
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

describe('locale resources', () => {
  const base = flatten(en)

  for (const [name, messages] of Object.entries(LOCALES)) {
    const flat = flatten(messages)

    it(`${name} exposes exactly the English key set`, () => {
      expect([...flat.keys()].sort()).toEqual([...base.keys()].sort())
    })

    it(`${name} leaves no message empty`, () => {
      for (const [key, value] of flat) expect(value.trim(), key).not.toHaveLength(0)
    })

    it(`${name} keeps every {placeholder} the English source uses`, () => {
      for (const [key, value] of flat)
        expect(placeholders(value), key).toEqual(placeholders(base.get(key)!))
    })
  }
})
