import type { Restaurant } from '@/types/models'
import { languageName as langName } from '@/lib/i18n/locales'

export function candidateDigest(candidates: Restaurant[]): string {
  return JSON.stringify(
    candidates.map((r) => ({
      id: r.id,
      name: r.name,
      types: r.types.slice(0, 3),
      rating: r.rating,
      priceLevel: r.priceLevel,
    })),
  )
}

export function conciergeMessages(
  candidates: Restaurant[],
  mood: string,
  locale: string,
  partySize?: number,
) {
  return [
    {
      role: 'system' as const,
      content:
        'You are a food concierge. Pick exactly ONE restaurant from the provided JSON list that best fits the diner. Reply with ONLY a JSON object: {"placeId": "<id from the list>", "reason": "<one short sentence>"}. The reason must be in ' +
        langName(locale) +
        ' and under 90 characters. No other text.',
    },
    {
      role: 'user' as const,
      content: `Diner mood/request: ${mood}\nParty size: ${partySize ?? 2}\nCandidates: ${candidateDigest(candidates)}`,
    },
  ]
}

export function blurbMessages(r: Restaurant, locale: string) {
  return [
    {
      role: 'system' as const,
      content:
        'Write ONE appetizing sentence (max 80 characters, no quotes, no emoji spam — one emoji allowed) about the restaurant, in ' +
        langName(locale) +
        '. Reply with the sentence only.',
    },
    {
      role: 'user' as const,
      content: JSON.stringify({
        name: r.name,
        types: r.types.slice(0, 3),
        rating: r.rating,
        priceLevel: r.priceLevel,
      }),
    },
  ]
}
