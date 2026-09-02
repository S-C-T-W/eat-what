import { describe, expect, it } from 'vitest'

import { keywordTagById, tagQuery } from '@/lib/places/keywords'
import { isAppLocale, matchLocale, speechLang } from './locales'

describe('matchLocale', () => {
  it('maps Chinese by REGION, not script — Cantonese and Taiwan Mandarin are different products', () => {
    expect(matchLocale(['zh-HK'])).toBe('zh-HK')
    expect(matchLocale(['zh-Hant-HK'])).toBe('zh-HK')
    expect(matchLocale(['zh-MO'])).toBe('zh-HK')
    expect(matchLocale(['yue-Hant-HK'])).toBe('zh-HK')
    expect(matchLocale(['zh-TW'])).toBe('zh-TW')
    expect(matchLocale(['zh-Hant'])).toBe('zh-TW')
    expect(matchLocale(['zh'])).toBe('zh-TW')
    // Simplified readers get the closest written Traditional we ship
    expect(matchLocale(['zh-CN'])).toBe('zh-TW')
  })

  it('honours the preference order and falls back to English', () => {
    expect(matchLocale(['fr', 'ja-JP', 'en'])).toBe('ja')
    expect(matchLocale(['en-GB', 'zh-HK'])).toBe('en')
    expect(matchLocale(['fr', 'de'])).toBe('en')
    expect(matchLocale([])).toBe('en')
  })

  it('exposes speech-recognition tags and a type guard', () => {
    expect(speechLang('zh-HK')).toBe('zh-HK')
    expect(speechLang('zh-TW')).toBe('zh-TW')
    expect(speechLang('ja')).toBe('ja-JP')
    expect(speechLang('en')).toBe('en-US')
    expect(isAppLocale('ja')).toBe(true)
    expect(isAppLocale('zh')).toBe(false)
  })
})

describe('tagQuery', () => {
  it('shares Chinese queries across both zh locales and falls back to English for Japanese', () => {
    const ramen = keywordTagById('ramen')!
    const chaChaanTeng = keywordTagById('chaChaanTeng')!
    expect(tagQuery(ramen, 'zh-HK')).toBe('拉麵')
    expect(tagQuery(ramen, 'zh-TW')).toBe('拉麵')
    expect(tagQuery(ramen, 'ja')).toBe('ラーメン')
    expect(tagQuery(ramen, 'en')).toBe('ramen')
    expect(tagQuery(chaChaanTeng, 'ja')).toBe(chaChaanTeng.q.en)
  })
})
